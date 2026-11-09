import { Injectable } from '@nestjs/common';
import type { Offer } from '../../../generated/prisma/client';
import { fail } from '../../shared/office-failure';
import { OfficeKernel } from '../kernel/office-kernel';
import type { Actor } from '../kernel/types';

// Offers (spec 2026-11-09-offers-tasks-addons-wallet-esim, 1): picture-and-text announcements on the home hero,
// managed by the branch owner and staff with the edit grant, shown to the layers each one names.
export const OFFER_LAYERS = ['branch', 'main_agent', 'agent', 'pos'] as const;
/** A data URL of about 700 KB of picture is about 950,000 characters of base64. */
export const OFFER_IMAGE_LIMIT = 950_000;
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
  constructor(private readonly kernel: OfficeKernel) {}

  private gate(actor: Actor) {
    if (actor.layer !== 'branch' || actor.impersonating || (!actor.isBranchOwner && !actor.grants.includes('edit'))) fail(403, 'FORBIDDEN');
  }

  /** The offers the signed-in account sees on its home now, in order. */
  async live(actor: Actor) {
    const rows = await this.kernel.prisma.offer.findMany({ where: { active: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
    const now = new Date();
    return { offers: rows.map(viewOf).filter((offer) => offerShows(offer, actor.layer, now)) };
  }

  /** Every offer, for the «الإعلانات» page. */
  async list(actor: Actor) {
    this.gate(actor);
    const rows = await this.kernel.prisma.offer.findMany({ orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
    return { offers: rows.map(viewOf) };
  }

  async save(actor: Actor, body: Record<string, unknown>, id?: string) {
    this.gate(actor);
    const data = this.parse(body, !id);
    if (id) {
      const found = await this.kernel.prisma.offer.findUnique({ where: { id } });
      if (!found) fail(404, 'NOT_FOUND');
      await this.kernel.prisma.offer.update({ where: { id }, data });
    } else {
      const count = await this.kernel.prisma.offer.count();
      await this.kernel.prisma.offer.create({ data: { title: data.title as string, ...data, position: typeof data.position === 'number' ? data.position : count } });
    }
    return this.list(actor);
  }

  async remove(actor: Actor, id: string) {
    this.gate(actor);
    const found = await this.kernel.prisma.offer.findUnique({ where: { id } });
    if (!found) fail(404, 'NOT_FOUND');
    await this.kernel.prisma.offer.delete({ where: { id } });
    return this.list(actor);
  }

  /** Moves an offer one place up or down, swapping positions with its neighbour. */
  async move(actor: Actor, id: string, body: Record<string, unknown>) {
    this.gate(actor);
    if (body.direction !== 'up' && body.direction !== 'down') fail(400, 'INVALID');
    const rows = await this.kernel.prisma.offer.findMany({ orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
    const at = rows.findIndex((row) => row.id === id);
    if (at < 0) fail(404, 'NOT_FOUND');
    const other = body.direction === 'up' ? at - 1 : at + 1;
    if (other >= 0 && other < rows.length) {
      const order = rows.map((row) => row.id);
      [order[at], order[other]] = [order[other], order[at]];
      await this.kernel.runTx(async (tx) => {
        for (const [index, rowId] of order.entries()) await tx.offer.update({ where: { id: rowId }, data: { position: index } });
      });
    }
    return this.list(actor);
  }

  private parse(body: Record<string, unknown>, creating: boolean) {
    const text = (value: unknown) => (typeof value === 'string' ? value.trim() : undefined);
    const title = text(body.title);
    if (creating && !title) fail(400, 'INVALID');
    if (title !== undefined && (!title || title.length > 80)) fail(400, 'INVALID');
    const bodyText = text(body.body);
    if (bodyText !== undefined && bodyText.length > 240) fail(400, 'INVALID');
    let image: string | null | undefined;
    if (body.image === null) image = null;
    else if (typeof body.image === 'string') {
      if (body.image.length > OFFER_IMAGE_LIMIT) fail(400, 'IMAGE_TOO_LARGE');
      if (!IMAGE.test(body.image)) fail(400, 'INVALID');
      image = body.image;
    }
    const actionLabel = body.actionLabel === null ? null : text(body.actionLabel);
    if (typeof actionLabel === 'string' && actionLabel.length > 30) fail(400, 'INVALID');
    const actionHref = body.actionHref === null ? null : text(body.actionHref);
    if (typeof actionHref === 'string' && actionHref && !(/^\/(?!\/)/.test(actionHref) || /^https:\/\//.test(actionHref))) fail(400, 'INVALID');
    const seconds = body.seconds;
    if (seconds !== undefined && !(typeof seconds === 'number' && Number.isInteger(seconds) && seconds >= 3 && seconds <= 60)) fail(400, 'INVALID');
    if (body.active !== undefined && typeof body.active !== 'boolean') fail(400, 'INVALID');
    let layers: string | undefined;
    if (body.layers !== undefined) {
      if (!Array.isArray(body.layers) || body.layers.length === 0 || !body.layers.every((layer) => (OFFER_LAYERS as readonly string[]).includes(layer as string))) fail(400, 'INVALID');
      layers = [...new Set(body.layers as string[])].join(',');
    }
    const date = (value: unknown) => {
      if (value === null || value === '') return null;
      if (typeof value !== 'string') return undefined;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) fail(400, 'INVALID');
      return parsed;
    };
    const startsAt = date(body.startsAt);
    const endsAt = date(body.endsAt);
    if (startsAt && endsAt && endsAt < startsAt) fail(400, 'INVALID');
    return {
      ...(title !== undefined ? { title } : {}),
      ...(bodyText !== undefined ? { body: bodyText } : {}),
      ...(image !== undefined ? { image } : {}),
      ...(actionLabel !== undefined ? { actionLabel: actionLabel || null } : {}),
      ...(actionHref !== undefined ? { actionHref: actionHref || null } : {}),
      ...(typeof seconds === 'number' ? { seconds } : {}),
      ...(typeof body.active === 'boolean' ? { active: body.active } : {}),
      ...(layers !== undefined ? { layers } : {}),
      ...(startsAt !== undefined ? { startsAt } : {}),
      ...(endsAt !== undefined ? { endsAt } : {}),
      ...(typeof body.position === 'number' && Number.isInteger(body.position) ? { position: body.position } : {}),
    };
  }
}
