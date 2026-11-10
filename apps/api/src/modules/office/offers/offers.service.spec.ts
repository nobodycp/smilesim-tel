import { OffersRepository } from './offers.repository';
import { OfficeGraph } from '../testing/office-graph';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import type { Actor } from '../kernel/types';
import { OfficeFailure } from '../../shared/office-failure';
import { OffersService, offerShows } from './offers.service';

// Offers on the home hero (spec 2026-11-09-offers-tasks-addons-wallet-esim, 1).
type Row = Record<string, unknown> & { id: string; position: number };

function setup() {
  const kernel = new OfficeGraph(new MemoryAuthStore());
  const rows: Row[] = [];
  const offer = {
    findMany: async () => [...rows].sort((a, b) => a.position - b.position),
    findUnique: async ({ where }: { where: { id: string } }) => rows.find((row) => row.id === where.id) ?? null,
    count: async () => rows.length,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `o${rows.length + 1}`, body: '', image: null, actionLabel: null, actionHref: null, seconds: 7, active: true, layers: 'branch,main_agent,agent,pos', startsAt: null, endsAt: null, createdAt: new Date(), position: 0, ...data } as Row;
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(rows.find((row) => row.id === where.id)!, data),
    delete: async ({ where }: { where: { id: string } }) => rows.splice(rows.findIndex((row) => row.id === where.id), 1)[0],
  };
  kernel.prismaClient = { offer, $transaction: async (run: (tx: unknown) => Promise<unknown>) => run({ offer }) } as unknown as OfficeGraph['prismaClient'];
  return { service: new OffersService(kernel.uow, new OffersRepository(kernel.uow)), rows };
}

const actor = (layer: string, owner = false, grants: string[] = []): Actor => ({ id: layer, loginName: layer, nickname: layer, layer, isBranchOwner: owner, grants, operatorId: layer, impersonating: false });
const owner = actor('branch', true);
const picture = 'data:image/png;base64,iVBORw0KGgo=';

describe('offers', () => {
  it('lets the owner and the editors manage offers, and nobody else', async () => {
    const { service } = setup();
    await service.save(owner, { title: 'عرض الشتاء', body: 'خصم 10٪', image: picture, seconds: 5, layers: ['pos', 'agent'] });
    await service.save(actor('branch', false, ['edit']), { title: 'عرض ثانٍ' });
    await expect(service.save(actor('branch'), { title: 'x' })).rejects.toBeInstanceOf(OfficeFailure);
    await expect(service.list(actor('pos'))).rejects.toBeInstanceOf(OfficeFailure);
    const { offers } = await service.list(owner);
    expect(offers.map((row) => [row.title, row.seconds, row.layers, row.position])).toEqual([['عرض الشتاء', 5, ['pos', 'agent'], 0], ['عرض ثانٍ', 7, ['branch', 'main_agent', 'agent', 'pos'], 1]]);
  });

  it('refuses a bad picture, an oversized one, a bad link, out-of-range seconds and unknown layers', async () => {
    const { service } = setup();
    await expect(service.save(owner, { title: 't', image: 'data:text/html;base64,PGI+' })).rejects.toBeInstanceOf(OfficeFailure);
    await expect(service.save(owner, { title: 't', image: `data:image/png;base64,${'A'.repeat(960_000)}` })).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE' });
    await expect(service.save(owner, { title: 't', actionHref: 'javascript:alert(1)' })).rejects.toBeInstanceOf(OfficeFailure);
    await expect(service.save(owner, { title: 't', actionHref: '//evil.example' })).rejects.toBeInstanceOf(OfficeFailure);
    await expect(service.save(owner, { title: 't', seconds: 2 })).rejects.toBeInstanceOf(OfficeFailure);
    await expect(service.save(owner, { title: 't', layers: ['staff'] })).rejects.toBeInstanceOf(OfficeFailure);
    await expect(service.save(owner, { title: '' })).rejects.toBeInstanceOf(OfficeFailure);
  });

  it('shows each layer only the live offers meant for it, inside their dates, in order', async () => {
    const { service } = setup();
    await service.save(owner, { title: 'للنقاط', layers: ['pos'] });
    await service.save(owner, { title: 'للجميع' });
    await service.save(owner, { title: 'موقوف', active: false });
    await service.save(owner, { title: 'لاحقاً', startsAt: '2099-01-01T00:00:00.000Z' });
    expect((await service.live(actor('pos'))).offers.map((row) => row.title)).toEqual(['للنقاط', 'للجميع']);
    expect((await service.live(actor('agent'))).offers.map((row) => row.title)).toEqual(['للجميع']);
    expect(offerShows({ active: true, layers: ['pos'], startsAt: null, endsAt: '2000-01-01T00:00:00.000Z' }, 'pos')).toBe(false);
  });

  it('switches an offer off, moves it, and deletes it', async () => {
    const { service } = setup();
    await service.save(owner, { title: 'أ' });
    await service.save(owner, { title: 'ب' });
    await service.save(owner, { active: false }, 'o1');
    expect((await service.list(owner)).offers.find((row) => row.id === 'o1')?.active).toBe(false);
    const moved = await service.move(owner, 'o2', { direction: 'up' });
    expect(moved.offers.map((row) => row.title)).toEqual(['ب', 'أ']);
    const left = await service.remove(owner, 'o1');
    expect(left.offers.map((row) => row.title)).toEqual(['ب']);
  });
});
