import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { providerDispatchOn } from './config';
import { PROVIDER_GATEWAY, type ProviderGateway } from './modules/office/providers/gateway/provider-gateway';
import { SimulatedProviderGateway } from './modules/office/providers/gateway/simulated-gateway';
import { PROVIDERS_PROVIDERS } from './modules/office/providers/providers.module';

// No activation can reach a provider today (ADR 0019, D13 and D18; plan slice S.11, before S.12a). Slice S.11
// gave `activate` a dispatch route that records an operation and an outbox message; this spec pins that nothing
// the application builds can put a sale on that route, and that nothing it runs can send one. It reads the code
// that is deployed, not the data of a database: an empty provider table proves nothing.

const src = __dirname;
const ENV_KEYS = ['NODE_ENV', 'PROVIDER_DISPATCH', 'PROVIDER_SIMULATION', 'PROVIDER_ADAPTERS', 'PROVIDER_TARGET', 'PROVIDER_DISPATCH_ON', 'DISPATCH'];

/** Every source file the application ships: no spec, nothing under a `testing` folder, not the generated client. */
function shipped(dir: string = src): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'testing' || name === 'generated' ? [] : shipped(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}
const files = shipped().map((path) => ({ path: relative(src, path), text: readFileSync(path, 'utf8') }));

describe('provider dispatch is off, and nothing deployed today can turn it on', () => {
  const before: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const key of ENV_KEYS) before[key] = process.env[key];
  });
  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  });

  it('the gateway the application binds is the simulated one, and no other gateway is shipped', () => {
    const binding = PROVIDERS_PROVIDERS.find((provider) => typeof provider === 'object' && 'provide' in provider && provider.provide === PROVIDER_GATEWAY);
    expect(binding).toEqual({ provide: PROVIDER_GATEWAY, useClass: SimulatedProviderGateway });
    // One implementation in what ships; the scripted gateway lives under `testing/` and is imported by specs only.
    expect(files.filter((file) => /implements\s+ProviderGateway/.test(file.text)).map((file) => file.path)).toEqual(['modules/office/providers/gateway/simulated-gateway.ts']);
    expect(files.filter((file) => /scripted-gateway|testing\/office-test-app/.test(file.text)).map((file) => file.path)).toEqual([]);
    // The worker builds its dispatcher over the same gateway, and names no other.
    const worker = files.find((file) => file.path === 'worker.ts')?.text ?? '';
    expect(worker).toContain('buildProviderDispatch(dispatchPrisma, relayRedis, new SimulatedProviderGateway())');
    expect(worker.match(/buildProviderDispatch\(/g)).toHaveLength(1);
  });

  it('that gateway never takes an activation on the dispatch route: under no environment, for no provider', () => {
    const settings: Record<string, string | undefined>[] = [];
    for (const NODE_ENV of ['production', 'staging', 'development', 'test', undefined]) {
      for (const PROVIDER_DISPATCH of ['1', 'true', undefined]) {
        for (const PROVIDER_SIMULATION of ['0', '1', undefined]) {
          settings.push({ NODE_ENV, PROVIDER_DISPATCH, PROVIDER_SIMULATION, PROVIDER_ADAPTERS: 'lian,sky', PROVIDER_TARGET: 'live', PROVIDER_DISPATCH_ON: '1', DISPATCH: '1' });
          settings.push({ NODE_ENV, PROVIDER_DISPATCH, PROVIDER_SIMULATION });
        }
      }
    }
    expect(settings).toHaveLength(90);
    for (const setting of settings) {
      for (const key of ENV_KEYS) {
        if (setting[key] === undefined) delete process.env[key];
        else process.env[key] = setting[key];
      }
      // Asked through the port, as the activation asks it.
      const gateway: ProviderGateway = new SimulatedProviderGateway();
      for (const code of ['lian', 'sky', '', '*', 'any-provider']) expect(gateway.dispatches(code)).toBe(false);
    }
  });

  it('is a constant in the code: the method reads no environment, no setting and no argument', () => {
    const source = files.find((file) => file.path === 'modules/office/providers/gateway/simulated-gateway.ts')?.text ?? '';
    const method = /dispatches\(\): boolean \{([\s\S]*?)\n {2}\}/.exec(source);
    expect(method?.[1].trim()).toBe('return false;');
    // And it is asked in one place, for the activation only.
    const asked = files.filter((file) => /\.dispatches\(/.test(file.text)).map((file) => file.path);
    expect(asked).toEqual(['modules/office/lines/lines.service.ts']);
    const service = files.find((file) => file.path === 'modules/office/lines/lines.service.ts')?.text ?? '';
    expect(service.match(/\.dispatches\(/g)).toHaveLength(1);
    // The request's simulation hint is not part of the question.
    expect(service).toContain("if (runsNow(pkg, 'activate') && this.gateway.dispatches(pkg.provider.code)) {");
  });

  it('a recorded operation never leaves through it either: `send` opens no connection, whatever the environment says', async () => {
    for (const NODE_ENV of ['production', 'development', 'test']) {
      process.env.NODE_ENV = NODE_ENV;
      process.env.PROVIDER_DISPATCH = '1';
      process.env.PROVIDER_SIMULATION = '1';
      const gateway = new SimulatedProviderGateway();
      expect(await gateway.send()).toEqual({ left: false, error: 'not-connected' });
    }
  });

  it('PROVIDER_DISPATCH=1 alone starts no dispatcher on a production-grade deployment, and even where it does, it starts no provider', () => {
    process.env.PROVIDER_DISPATCH = '1';
    process.env.NODE_ENV = 'production';
    expect(providerDispatchOn()).toBe(false);
    // Outside production the worker's relay and consumer do run with it, over the simulated gateway (above): an
    // operation is taken, found unsendable, put back, and fails after its attempts. The API does not read the
    // variable at all, so it cannot move a sale onto the dispatch route.
    process.env.NODE_ENV = 'development';
    expect(providerDispatchOn()).toBe(true);
    const readers = files.filter((file) => /providerDispatchOn\(|env\('PROVIDER_DISPATCH'\)|process\.env\.PROVIDER_DISPATCH\b/.test(file.text)).map((file) => file.path).sort();
    expect(readers).toEqual(['config.ts', 'worker.ts']);
  });

  it('the application holds no provider credential and no way to call out: no adapter, no HTTP client, no credential read', () => {
    const lines = files.flatMap((file) => file.text.split('\n').map((text) => ({ path: file.path, text })));
    const code = lines.filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line.text));
    // The sealed credential table exists in the schema (S.1) and nothing that ships reads or writes it.
    expect(code.filter((line) => /providerCredential\b/.test(line.text)).map((line) => line.path)).toEqual([]);
    // Nothing under the providers domain or the dispatch wiring opens an outgoing connection.
    const outgoing = /\bfetch\(|from 'node:https?'|from 'https?'|from 'axios'|from 'undici'|from 'got'|XMLHttpRequest|net\.connect\(|tls\.connect\(/;
    const providerSide = code.filter((line) => line.path.startsWith('modules/office/providers/') || line.path === 'provider-dispatch.ts' || line.path === 'worker.ts');
    expect(providerSide.filter((line) => outgoing.test(line.text)).map((line) => `${line.path}: ${line.text.trim()}`)).toEqual([]);
    // The only adapters that ship are the catalog's (what a provider sells, made up from the seeded catalog): they
    // run no line operation and, being under the providers domain, were just shown to open no connection. No
    // adapter for sending an operation exists, and the two settings of D18 that S.12a will add are read by nothing.
    expect(files.filter((file) => /adapter/i.test(file.path)).map((file) => file.path).sort()).toEqual(['modules/office/providers/adapters/provider-adapter.ts', 'modules/office/providers/adapters/simulated-adapter.ts']);
    expect(files.filter((file) => /adapter/i.test(file.path)).every((file) => !/OutgoingOperation|SendEvidence|idempotencyKey|\bsend\(/.test(file.text))).toBe(true);
    expect(code.filter((line) => /PROVIDER_ADAPTERS|PROVIDER_TARGET/.test(line.text)).map((line) => line.path)).toEqual([]);
  });
});
