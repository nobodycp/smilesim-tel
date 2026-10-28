import 'reflect-metadata';
import { AuthModule } from './auth.module';
import { AUTH_STORE, MemoryAuthStore } from './auth.store';
import { PrismaAuthStore } from './prisma-auth.store';

type Provider = { provide?: unknown; useClass?: unknown; useFactory?: unknown; useValue?: unknown };

// Reads the module's metadata and never boots it: npm test must not open PostgreSQL or Redis.
// The trial accounts a booted server gets are covered in prisma-auth.store.spec.ts.
describe('AuthModule storage', () => {
  const providers = Reflect.getMetadata('providers', AuthModule) as Provider[];
  const authStore = providers.find((provider) => typeof provider === 'object' && provider.provide === AUTH_STORE);

  it('provides AUTH_STORE with the Prisma store', () => {
    expect(authStore).toBeDefined();
    expect(authStore?.useClass).toBe(PrismaAuthStore);
    expect(authStore?.useValue).toBeUndefined();
    expect(authStore?.useFactory).toBeUndefined();
  });

  it('does not ship the memory store as the default', () => {
    expect(authStore?.useClass).not.toBe(MemoryAuthStore);
  });
});
