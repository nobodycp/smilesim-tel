import 'reflect-metadata';
import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { UnitOfWork } from '../../../platform/unit-of-work';
import { TermsRepository } from '../../pricing/terms.repository';
import { ProvidersRepository } from '../../../providers/providers.repository';
import { LinesRepository } from '../../sales/lines.repository';
import { TasksRepository } from '../../../tasks/tasks.repository';
import { CompaniesRepository } from '../companies/companies.repository';
import { PackagesRepository } from '../packages/packages.repository';
import { companyMarkUrls } from '../companies/company-marks';
import { companyMarkUrl, markVersion } from '../rules/pictures';
import { offerPictureUrl } from '../../../site/rules/pictures';
import { PICTURES_CONTROLLERS, PICTURES_PROVIDERS } from './pictures.module';
import { OFFER_PICTURES_CONTROLLERS, OFFER_PICTURES_PROVIDERS } from '../../../site/pictures/offer-pictures.module';

// Company marks and offer pictures by URL (speed plan PF.7, spec 2026-11-17-scale-speed-cleanup "Pictures by URL").
// The two routes share the `/pictures` prefix: the company mark is the postpaid catalog's, the offer picture the
// site's (slice F.7e); both are served here, as by the app.

const webpBytes = Buffer.alloc(64, 9);
const jpegBytes = Buffer.alloc(48, 5);
const mark = `data:image/webp;base64,${webpBytes.toString('base64')}`;
const offerPicture = `data:image/jpeg;base64,${jpegBytes.toString('base64')}`;
const updatedAt = new Date('2026-11-17T08:00:00Z');
const OFFER_ID = '8b346876-67cc-4707-afe1-75a89e2ce2c7';

describe('the picture routes', () => {
  let app: INestApplication;
  const companies: Record<string, { image: string | null }> = { wecom: { image: mark }, kalam: { image: null }, odd: { image: 'https://example.com/a.png' } };
  const offers: Record<string, { image: string | null; updatedAt: Date; active: boolean }> = {
    [OFFER_ID]: { image: offerPicture, updatedAt, active: true },
    'off-0000': { image: offerPicture, updatedAt, active: false },
    'bare-000': { image: null, updatedAt, active: true },
  };
  const selects: Record<string, boolean>[] = [];

  beforeAll(async () => {
    const prisma = {
      postpaidCompany: { findUnique: async ({ where, select }: { where: { code: string }; select: Record<string, boolean> }) => (selects.push(select), companies[where.code] ?? null) },
      offer: { findUnique: async ({ where, select }: { where: { id: string }; select: Record<string, boolean> }) => (selects.push(select), offers[where.id] ?? null) },
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [...PICTURES_CONTROLLERS, ...OFFER_PICTURES_CONTROLLERS],
      providers: [...PICTURES_PROVIDERS, ...OFFER_PICTURES_PROVIDERS, { provide: UnitOfWork, useValue: { prisma } }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (path: string) => request(app.getHttpServer()).get(path).buffer(true).parse((res, done) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => done(null, Buffer.concat(chunks)));
  });

  it('serves a company mark with no session: its bytes, its type, a year under the current ?v= and no-cache otherwise', async () => {
    const version = markVersion(mark);
    expect(version).toBe(createHash('md5').update(mark).digest('hex').slice(0, 16));
    const named = await get(`/pictures/postpaid/companies/wecom?v=${version}`);
    expect(named.status).toBe(200);
    expect(named.headers['content-type']).toBe('image/webp');
    expect(named.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(named.headers.etag).toBe(`"${version}"`);
    expect(named.body).toEqual(webpBytes);
    for (const path of ['/pictures/postpaid/companies/wecom', '/pictures/postpaid/companies/wecom?v=0123456789abcdef']) {
      const other = await get(path);
      expect({ path, status: other.status, cache: other.headers['cache-control'] }).toEqual({ path, status: 200, cache: 'no-cache' });
      expect(other.body).toEqual(webpBytes);
    }
    // The ETag is the version: a browser that revalidates the bare URL is answered 304 with no bytes.
    const again = await request(app.getHttpServer()).get('/pictures/postpaid/companies/wecom').set('If-None-Match', `"${version}"`);
    expect(again.status).toBe(304);
    // The route reads the picture column of one row, nothing else.
    expect(selects.at(-1)).toEqual({ image: true });
  });

  it('answers 404 for a company with no mark, an unknown one, and a stored value that is not a picture', async () => {
    for (const code of ['kalam', 'none', 'odd']) {
      const answer = await request(app.getHttpServer()).get(`/pictures/postpaid/companies/${code}`);
      expect({ code, status: answer.status, body: answer.body.code }).toEqual({ code, status: 404, body: 'NOT_FOUND' });
    }
  });

  it('serves an offer picture by its id, versioned by updatedAt; switched off too, since the id is the only key', async () => {
    const version = String(updatedAt.getTime());
    const named = await get(`/pictures/offers/${OFFER_ID}?v=${version}`);
    expect(named.status).toBe(200);
    expect(named.headers['content-type']).toBe('image/jpeg');
    expect(named.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(named.headers.etag).toBe(`"${version}"`);
    expect(named.body).toEqual(jpegBytes);
    expect(selects.at(-1)).toEqual({ image: true, updatedAt: true });
    expect((await get(`/pictures/offers/${OFFER_ID}`)).headers['cache-control']).toBe('no-cache');
    // The rule (spec, "Who may fetch what"): an advertising picture is not a secret; an offer that is not live answers
    // to whoever holds its id, which only the accounts that list every offer were given.
    expect((await get(`/pictures/offers/off-0000?v=${version}`)).status).toBe(200);
    for (const id of ['bare-000', 'unknown']) {
      const answer = await request(app.getHttpServer()).get(`/pictures/offers/${id}`);
      expect({ id, status: answer.status, body: answer.body.code }).toEqual({ id, status: 404, body: 'NOT_FOUND' });
    }
  });

  it('builds the URLs the lists carry, as the web reaches the API', () => {
    expect(companyMarkUrl('wecom', 'abc')).toBe('/api/pictures/postpaid/companies/wecom?v=abc');
    expect(offerPictureUrl(OFFER_ID, updatedAt)).toBe(`/api/pictures/offers/${OFFER_ID}?v=${updatedAt.getTime()}`);
  });
});

describe('the lists read no picture column (speed plan PF.7)', () => {
  type Args = { select?: Record<string, unknown>; include?: Record<string, unknown> };

  /** A unit of work over tables that record what each read asks for. */
  function recording() {
    const asked: Record<string, Args[]> = {};
    const statements: string[] = [];
    const table = (model: string) => ({
      findMany: async (args: Args) => {
        (asked[model] ??= []).push(args);
        return [];
      },
      findUnique: async (args: Args) => {
        (asked[model] ??= []).push(args);
        return null;
      },
    });
    const prisma = {
      postpaidCompany: table('company'),
      postpaidPackage: table('package'),
      provider: table('provider'),
      postpaidLine: table('line'),
      task: table('task'),
      $queryRaw: async (sql: TemplateStringsArray) => {
        statements.push(sql.join('?'));
        return [{ code: 'wecom', version: 'abcdef0123456789' }];
      },
    };
    return { uow: { prisma } as unknown as UnitOfWork, asked, statements };
  }

  /** Every key a read names, at any depth, where the read names `image`. */
  function namesImage(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, inner]) => key === 'image' || (key === 'company' && inner === true) || namesImage(inner));
  }

  it('reads the marks as code and MD5 only: the picture never leaves the database', async () => {
    const { uow, statements } = recording();
    expect(await companyMarkUrls(uow.prisma)).toEqual(new Map([['wecom', '/api/pictures/postpaid/companies/wecom?v=abcdef0123456789']]));
    const selected = /SELECT([\s\S]*)FROM/.exec(statements[0])![1];
    expect(selected.replace(/\s+/g, ' ').trim()).toBe(`"code", left(md5("image"), 16) AS "version"`);
    // The same version as the route computes over the same text.
    expect(markVersion(mark)).toBe(createHash('md5').update(mark, 'utf8').digest('hex').slice(0, 16));
  });

  it('the companies shelf, the priced shelf and the providers list select companies without the picture', async () => {
    const { uow, asked } = recording();
    const companiesRepo = new CompaniesRepository(uow);
    await companiesRepo.storedCompanies();
    await companiesRepo.shelfPackages();
    await new TermsRepository(uow).shelfPackages();
    await new ProvidersRepository(uow).providersWithCatalog();
    expect(Object.keys(asked.company[0].select!).sort()).toEqual(['code', 'esim', 'esimPrice', 'iccidLength', 'iccidPrefix', 'name']);
    expect(asked.package[0].include!.company).toEqual({ select: { code: true } });
    expect(asked.package[1].include!.company).toEqual({ select: { code: true, name: true, iccidLength: true, iccidPrefix: true, esim: true, esimPrice: true } });
    expect(asked.provider[0].include).toEqual({ packages: { include: { company: { select: { id: true, code: true, name: true } } }, orderBy: { code: 'asc' } } });
    for (const reads of Object.values(asked)) for (const read of reads) expect(namesImage(read)).toBe(false);
  });

  it('the numbers list, the number card, the inbox, a task and the package sheet select companies without the picture', async () => {
    const { uow, asked, statements } = recording();
    const lines = new LinesRepository(uow);
    await lines.linesPage({}, 31);
    await lines.lineCard('ln-1');
    await lines.packagesByIds(['pk-1']);
    // The mark's URL comes from the one read of code and MD5 the shelves use.
    expect(await lines.markUrls()).toEqual(new Map([['wecom', '/api/pictures/postpaid/companies/wecom?v=abcdef0123456789']]));
    expect(statements).toHaveLength(1);
    const tasks = new TasksRepository(uow);
    await tasks.packageNames();
    await tasks.taskDetail('tk-1', {});
    await tasks.packageOfTask('pk-1');
    const packages = new PackagesRepository(uow);
    await packages.packageSheet('pk');
    await packages.packageWithCompany('pk');
    await packages.packagesByCodes(['pk-2']);
    const [page, card] = asked.line;
    expect((page.include!.package as Args).include!.company).toEqual({ select: { code: true, name: true, esim: true } });
    expect((card.include!.package as Args).include!.company).toEqual({ select: { code: true, name: true, iccidLength: true, iccidPrefix: true, esim: true, esimPrice: true } });
    // The point of sale on a list row and on the card: its login only, never the whole user row (password hash included).
    expect(page.include!.pos).toEqual({ select: { loginName: true } });
    expect(card.include!.pos).toEqual({ select: { loginName: true } });
    const [history, inbox, ofTask, sheet, owner, targets] = asked.package;
    expect(history.select).toEqual({ id: true, name: true, company: { select: { name: true } } });
    expect(inbox.select).toEqual({ id: true, name: true, company: { select: { name: true } }, provider: { select: { name: true } } });
    const taskCompany = { select: { name: true, iccidLength: true, iccidPrefix: true, esim: true } };
    expect((((asked.task[0].include!.line as Args).include!.package) as Args).include!.company).toEqual(taskCompany);
    expect(ofTask.include!.company).toEqual(taskCompany);
    expect(sheet.include!.company).toEqual({ select: { code: true, name: true, esimPrice: true } });
    expect(owner.include!.company).toEqual({ select: { code: true } });
    expect(targets.include!.company).toEqual({ select: { code: true } });
    for (const reads of Object.values(asked)) for (const read of reads) expect(namesImage(read)).toBe(false);
  });
});
