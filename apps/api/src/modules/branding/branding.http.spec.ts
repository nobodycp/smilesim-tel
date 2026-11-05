import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthModule } from '../auth/auth.module';
import { AUTH_STORE, MemoryAuthStore, StoredUser } from '../auth/auth.store';
import { hashPassword } from '../auth/password';
import { BrandingModule } from './branding.module';
import { BRANDING_STORE, MemoryBrandingStore } from './branding.store';

function cookieOf(response: request.Response): string {
  const header = response.headers['set-cookie'];
  const first = (Array.isArray(header) ? header[0] : header) as string;
  return first.split(';')[0];
}

const png = `data:image/png;base64,${Buffer.alloc(64, 7).toString('base64')}`;
const webp = `data:image/webp;base64,${Buffer.alloc(64, 9).toString('base64')}`;
const EMPTY = { siteName: '', tagline: '', hasLogo: false, hasFavicon: false, version: 0 };

describe('branding endpoints', () => {
  let app: INestApplication;
  let store: MemoryAuthStore;
  let posCookie: string;
  let staffCookie: string;
  let ownerCookie: string;

  async function user(overrides: Partial<StoredUser> & { loginName: string }, password: string): Promise<StoredUser> {
    return {
      id: overrides.loginName,
      disabledAt: null,
      mustChangePassword: false,
      layer: 'pos',
      twoFactorExempt: true,
      twoFactorEnabled: false,
      isBranchOwner: false,
      passwordHash: await hashPassword(password),
      ...overrides,
    };
  }

  const login = (loginName: string, password: string) =>
    request(app.getHttpServer()).post('/auth/login').send({ loginName, password });

  beforeEach(async () => {
    store = new MemoryAuthStore();
    store.addUser(await user({ loginName: 'pos' }, '123456'));
    store.addUser(await user({ loginName: 'staff', layer: 'branch' }, 'staffpass1'));
    store.addUser(await user({ loginName: 'owner', layer: 'branch', isBranchOwner: true }, 'ownerpass1'));
    const moduleRef = await Test.createTestingModule({ imports: [AuthModule, BrandingModule] })
      .overrideProvider(AUTH_STORE)
      .useValue(store)
      .overrideProvider(BRANDING_STORE)
      .useValue(new MemoryBrandingStore())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    posCookie = cookieOf(await login('pos', '123456'));
    staffCookie = cookieOf(await login('staff', 'staffpass1'));
    ownerCookie = cookieOf(await login('owner', 'ownerpass1'));
  });

  afterEach(async () => {
    await app.close();
  });

  it('answers GET /branding to anyone, with defaults before anything is saved', async () => {
    const response = await request(app.getHttpServer()).get('/branding');
    expect(response.status).toBe(200);
    expect(response.body).toEqual(EMPTY);
    expect((await request(app.getHttpServer()).get('/branding/logo')).status).toBe(404);
    expect((await request(app.getHttpServer()).get('/branding/favicon')).status).toBe(404);
  });

  it('lets only the branch owner write', async () => {
    const body = { siteName: 'Pro Sim', tagline: '', logo: null, logoDark: null, favicon: null };
    const anonymous = await request(app.getHttpServer()).put('/branding').send(body);
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.code).toBe('LOGIN_REQUIRED');
    const pos = await request(app.getHttpServer()).put('/branding').set('Cookie', posCookie).send(body);
    expect(pos.status).toBe(403);
    expect(pos.body.code).toBe('FORBIDDEN');
    const staff = await request(app.getHttpServer()).put('/branding').set('Cookie', staffCookie).send(body);
    expect(staff.status).toBe(403);
    expect((await request(app.getHttpServer()).get('/branding')).body).toEqual(EMPTY);
  });

  it('saves the identity and serves the images with a long cache', async () => {
    const saved = await request(app.getHttpServer())
      .put('/branding')
      .set('Cookie', ownerCookie)
      .send({ siteName: ' Pro Sim ', tagline: 'Desk', logo: png, logoDark: null, favicon: webp });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ siteName: 'Pro Sim', tagline: 'Desk', hasLogo: true, hasFavicon: true });
    expect(saved.body.version).toBeGreaterThan(0);

    const summary = await request(app.getHttpServer()).get('/branding');
    expect(summary.body).toEqual(saved.body);

    const logo = await request(app.getHttpServer()).get('/branding/logo');
    expect(logo.status).toBe(200);
    expect(logo.headers['content-type']).toBe('image/png');
    expect(logo.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(Buffer.from(logo.body)).toEqual(Buffer.alloc(64, 7));

    // No dark copy was sent: the dark route answers the light bytes.
    const dark = await request(app.getHttpServer()).get('/branding/logo-dark');
    expect(dark.status).toBe(200);
    expect(Buffer.from(dark.body)).toEqual(Buffer.alloc(64, 7));

    const favicon = await request(app.getHttpServer()).get('/branding/favicon');
    expect(favicon.status).toBe(200);
    expect(favicon.headers['content-type']).toBe('image/webp');
  });

  it('clears everything when the owner saves an empty identity', async () => {
    await request(app.getHttpServer())
      .put('/branding')
      .set('Cookie', ownerCookie)
      .send({ siteName: 'Pro Sim', tagline: 'Desk', logo: png, logoDark: png, favicon: png });
    const cleared = await request(app.getHttpServer())
      .put('/branding')
      .set('Cookie', ownerCookie)
      .send({ siteName: '', tagline: '', logo: null, logoDark: null, favicon: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ siteName: '', tagline: '', hasLogo: false, hasFavicon: false });
    expect(cleared.body.version).toBeGreaterThan(0);
    expect((await request(app.getHttpServer()).get('/branding/logo')).status).toBe(404);
    expect((await request(app.getHttpServer()).get('/branding/logo-dark')).status).toBe(404);
  });

  it('refuses a jpeg with INVALID', async () => {
    const response = await request(app.getHttpServer())
      .put('/branding')
      .set('Cookie', ownerCookie)
      .send({ siteName: '', tagline: '', logo: 'data:image/jpeg;base64,AAAAAAAAAAAAAAAAAAAAAAAAAAAA' });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID');
  });
});
