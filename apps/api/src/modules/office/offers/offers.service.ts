import { capList } from '../../shared/paging';
import { OffersRepository } from './offers.repository';
import { UnitOfWork } from '../kernel/unit-of-work';
import { refuseEntered, requireGrant } from '../policy';
import { Injectable } from '@nestjs/common';
import type { Offer } from '../../../generated/prisma/client';
import { parseInput } from '../../shared/input';
import { fail } from '../../shared/office-failure';
import type { Actor } from '../kernel/types';
import { OFFER_IMAGE_LIMIT, OfferBody, OfferMoveBody, OfferUpdateBody } from './offers.schemas';

// Offers (spec 2026-11-09-offers-tasks-addons-wallet-esim, 1): picture-and-text announcements on the home hero,
// managed by the branch owner and staff with the edit grant, shown to the layers each one names.
export { OFFER_IMAGE_LIMIT, OFFER_LAYERS } from './offers.schemas';
const IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export type OfferView = {
  id: string; title: string; body: string; image: string | null; actionLabel: string | null; actionHref: string | null;
  seconds: number; active: boolean; position: number; layers: string[]; startsAt: string | null; endsAt: string | null;
};

function viewOf(row: Offer): OfferView {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    image: row.image,
    actionLabel: row.actionLabel,
    actionHref: row.actionHref,
    seconds: row.seconds,
    active: row.active,
    position: row.position,
    layers: row.layers.split(',').filter(Boolean),
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
  };
}

/** Whether an offer shows now to a layer: live, for that layer, and inside its dates. */
export function offerShows(offer: Pick<OfferView, 'active' | 'layers' | 'startsAt' | 'endsAt'>, layer: string, now: Date = new Date()): boolean {
  if (!offer.active || !offer.layers.includes(layer)) return false;
  if (offer.startsAt && new Date(offer.startsAt) > now) return false;
  if (offer.endsAt && new Date(offer.endsAt) < now) return false;
  return true;
}

@Injectable()
export class OffersService {
  constructor(private readonly uow: UnitOfWork, private readonly repo: OffersRepository) {}

  private gate(actor: Actor) {
    refuseEntered(actor);
    requireGrant(actor, 'edit');
  }

  /** The offers the signed-in account sees on its home now, in order. */
  async live(actor: Actor) {
    const rows = await this.repo.activeOffers();
    const now = new Date();
    return { offers: rows.map(viewOf).filter((offer) => offerShows(offer, actor.layer, now)) };
  }

  /** Every offer, for the «الإعلانات» page. */
  async list(actor: Actor) {
    this.gate(actor);
    const { rows, capped } = capList(await this.repo.allOffers());
    return { offers: rows.map(viewOf), capped };
  }

  async save(actor: Actor, body: unknown, id?: string) {
    this.gate(actor);
    const data = this.parse(body, !id);
    if (id) {
      const found = await this.repo.offerById(id);
      if (!found) fail(404, 'NOT_FOUND');
      await this.repo.updateOffer(id, data);
    } else {
      const count = await this.repo.offerCount();
      await this.repo.addOffer({ title: data.title as string, ...data, position: data.position ?? count });
    }
    return this.list(actor);
  }

  async remove(actor: Actor, id: string) {
    this.gate(actor);
    const found = await this.repo.offerById(id);
    if (!found) fail(404, 'NOT_FOUND');
    await this.repo.removeOffer(id);
    return this.list(actor);
  }

  /** Moves an offer one place up or down, swapping positions with its neighbour. */
  async move(actor: Actor, id: string, body: unknown) {
    this.gate(actor);
    const { direction } = parseInput(OfferMoveBody, body);
    const rows = await this.repo.allOffers();
    const at = rows.findIndex((row) => row.id === id);
    if (at < 0) fail(404, 'NOT_FOUND');
    const other = direction === 'up' ? at - 1 : at + 1;
    if (other >= 0 && other < rows.length) {
      const order = rows.map((row) => row.id);
      [order[at], order[other]] = [order[other], order[at]];
      await this.uow.runTx(async (tx) => {
        for (const [index, rowId] of order.entries()) await this.repo.setPosition(tx, rowId, index);
      });
    }
    return this.list(actor);
  }

  private parse(body: unknown, creating: boolean) {
    const input = parseInput(creating ? OfferBody : OfferUpdateBody, body);
    const { image, startsAt, endsAt } = input;
    if (typeof image === 'string') {
      if (image.length > OFFER_IMAGE_LIMIT) fail(400, 'IMAGE_TOO_LARGE');
      if (!IMAGE.test(image)) fail(400, 'INVALID');
    }
    if (startsAt && endsAt && endsAt < startsAt) fail(400, 'INVALID');
    const layers = input.layers === undefined ? undefined : [...new Set(input.layers)].join(',');
    return {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(image !== undefined ? { image } : {}),
      ...(input.actionLabel !== undefined ? { actionLabel: input.actionLabel || null } : {}),
      ...(input.actionHref !== undefined ? { actionHref: input.actionHref || null } : {}),
      ...(input.seconds !== undefined ? { seconds: input.seconds } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(layers !== undefined ? { layers } : {}),
      ...(startsAt !== undefined ? { startsAt } : {}),
      ...(endsAt !== undefined ? { endsAt } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
    };
  }
}
