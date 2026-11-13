import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test, type TestingModule } from '@nestjs/testing';
import type IORedis from 'ioredis';
import type { PrismaClient } from './generated/prisma/client';
import { AUTH_STORE } from './modules/auth/auth.store';
import { ActivityRecorder } from './modules/office/activity/activity-recorder';
import { ProviderDecisions } from './modules/office/lines/provider-decisions';
import { OFFICE_PROVIDERS } from './modules/office/office.module';
import type { SendGate } from './modules/office/providers/dispatch/dispatch-gate';
import { API_PROVIDERS } from './modules/shared/api-providers';
import { buildProviderDispatch } from './provider-dispatch';

// The worker builds the money path by hand (`provider-dispatch.ts`); the API builds the same classes through its
// Nest modules (audit finding H2, ADR 0020). The compiler makes sure each constructor gets its arguments on both
// sides. It cannot see what this spec checks:
//
//   - that the two sides give a critical class the SAME KINDS of collaborators (a stand-in, a subclass or a
//     second implementation on one side only);
//   - that the worker's graph is ONE graph: one unit of work, one ledger, one task service, so a hold and its
//     capture, and a transaction and its notices, go through the same objects;
//   - that no critical class relies on something only Nest does (a lifecycle hook the worker never calls);
//   - that the worker runs every part: the two queues, the relay, recovery, the waiting pass and the sweeper.
//
// It does not ask the two graphs to be equal. The API holds controllers, interceptors and sixty providers the
// worker has no use for; only the classes named in CRITICAL are compared.

/**
 * The classes a verdict's settlement and a person's decision run through, on both sides. What each must be
 * given is read from the API's graph, which Nest built from the constructors: the worker must match it.
 */
const CRITICAL = ['TaskCompletion', 'TasksService', 'WalletLedger', 'LinePricing', 'AccountTree', 'PriceLadder', 'ProviderOperationsService', 'UnitOfWork'] as const;

/** One of each in the worker: two would split a transaction from its notices, or a hold from its capture. */
const ONE_OF_EACH = ['UnitOfWork', 'WalletLedger', 'TasksService', 'TaskCompletion', 'AccountTree', 'PriceLadder', 'LinesRepository', 'ProviderOperationsService'] as const;

/** What only one side has, on purpose. */
const ONLY_IN_THE_API: Record<string, string[]> = {
  // The API's unit of work takes its client from the PrismaService; the worker is handed a client.
  UnitOfWork: ['PrismaService'],
};

const PLAIN = new Set(['Object', 'Array', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Function', 'Promise', 'Date', 'RegExp', 'Number', 'String', 'Boolean']);

/** The class of a value that is an instance of one of the application's classes; null for anything else. */
function classOf(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  try {
    const name = (Object.getPrototypeOf(value) as { constructor?: { name?: string } } | null)?.constructor?.name;
    return name && !PLAIN.has(name) ? name : null;
  } catch {
    // A stand-in that refuses to be read (the worker's "no sessions" store).
    return null;
  }
}

type Graph = { collaborators: Map<string, Set<string>>; instances: Map<string, Set<object>> };

/** Every application object reachable from `root` through its own fields: what each class holds, and how many of each there are. */
function graphOf(root: object): Graph {
  const collaborators = new Map<string, Set<string>>();
  const instances = new Map<string, Set<object>>();
  const seen = new Set<object>();
  const visit = (node: object) => {
    const name = classOf(node);
    if (!name || seen.has(node)) return;
    seen.add(node);
    instances.set(name, (instances.get(name) ?? new Set()).add(node));
    const held = collaborators.get(name) ?? new Set<string>();
    collaborators.set(name, held);
    for (const key of Object.keys(node)) {
      let value: unknown;
      try {
        value = (node as Record<string, unknown>)[key];
      } catch {
        continue;
      }
      const inner = classOf(value);
      if (!inner) continue;
      held.add(inner);
      visit(value as object);
    }
  };
  visit(root);
  return { collaborators, instances };
}

/** What is wrong with the worker's graph, measured against the API's. Empty when the contract holds. */
function contractProblems(worker: Graph, api: Graph): string[] {
  const problems: string[] = [];
  for (const name of CRITICAL) {
    const inApi = api.collaborators.get(name);
    const inWorker = worker.collaborators.get(name);
    if (!inApi) problems.push(`${name}: not in the API's graph`);
    if (!inWorker) problems.push(`${name}: not in the worker's graph`);
    if (!inApi || !inWorker) continue;
    const allowed = new Set(ONLY_IN_THE_API[name] ?? []);
    for (const held of inApi) if (!inWorker.has(held) && !allowed.has(held)) problems.push(`${name}: the API gives it ${held}, the worker does not`);
    for (const held of inWorker) if (!inApi.has(held)) problems.push(`${name}: the worker gives it ${held}, the API does not`);
  }
  for (const name of ONE_OF_EACH) {
    const count = worker.instances.get(name)?.size ?? 0;
    if (count !== 1) problems.push(`${name}: the worker holds ${count} of it, not one`);
  }
  return problems;
}

const NO_GATE = { permits: async () => null } as unknown as SendGate;
const buildWorker = () => buildProviderDispatch({} as PrismaClient, {} as IORedis, NO_GATE, 'wiring');

describe('the worker and the API build the money path alike', () => {
  let api: TestingModule;
  let apiGraph: Graph;
  let workerGraph: Graph;
  let dispatch: ReturnType<typeof buildWorker>;

  beforeAll(async () => {
    // The API's providers, as its modules list them, compiled by Nest. Nothing is started: no hook runs.
    api = await Test.createTestingModule({
      providers: [...OFFICE_PROVIDERS, ...API_PROVIDERS, { provide: AUTH_STORE, useValue: {} }, { provide: ActivityRecorder, useValue: { recordOffice: async () => undefined } }],
    }).compile();
    apiGraph = graphOf(api.get(ProviderDecisions));
    dispatch = buildWorker();
    workerGraph = graphOf(dispatch.settlement);
  });

  afterAll(async () => {
    await dispatch.publisher.close();
    await api.close();
  });

  it('looks at real graphs: both hold every critical class', () => {
    for (const name of CRITICAL) {
      expect({ name, api: apiGraph.instances.has(name), worker: workerGraph.instances.has(name) }).toEqual({ name, api: true, worker: true });
    }
    // The ledger is given the unit of work, the tree and the ladder: the walk went that deep.
    expect([...(apiGraph.collaborators.get('WalletLedger') ?? [])].sort()).toEqual(['AccountTree', 'PriceLadder', 'UnitOfWork']);
  });

  it('the settlement in the worker and the decisions in the API are given the same five collaborators', () => {
    const five = ['LinesRepository', 'ProviderOperationsService', 'TaskCompletion', 'TasksService', 'UnitOfWork'];
    expect([...(workerGraph.collaborators.get('ActivationSettlement') ?? [])].sort()).toEqual(five);
    expect([...(apiGraph.collaborators.get('ProviderDecisions') ?? [])].sort()).toEqual(five);
  });

  it('every critical class is given the same kinds of collaborators on both sides, and the worker has one of each', () => {
    expect(contractProblems(workerGraph, apiGraph)).toEqual([]);
  });

  it('the parts the worker runs share the settlement’s unit of work and operations', () => {
    const one = <T>(items: T[]) => new Set(items).size;
    const field = (object: object, key: string) => (object as Record<string, unknown>)[key];
    expect(one([dispatch.uow, field(dispatch.settlement, 'uow'), field(dispatch.operations, 'uow'), field(dispatch.relay, 'uow')])).toBe(1);
    expect(one([dispatch.operations, field(dispatch.settlement, 'operations'), field(dispatch.dispatcher, 'operations'), field(dispatch.waiting, 'operations')])).toBe(1);
    expect(field(dispatch.dispatcher, 'gate')).toBe(NO_GATE);
  });

  it('no critical class waits for a Nest lifecycle hook: the worker calls none', () => {
    const hooks = ['onModuleInit', 'onApplicationBootstrap', 'onModuleDestroy', 'beforeApplicationShutdown', 'onApplicationShutdown'];
    for (const name of [...CRITICAL, 'ActivationSettlement', 'LinesRepository', 'TasksRepository', 'ActorResolver'] as const) {
      const instance = [...(workerGraph.instances.get(name) ?? [])][0];
      expect({ name, built: Boolean(instance) }).toEqual({ name, built: true });
      // The unit of work's notice writer closes its connection on shutdown; the worker's process ends instead.
      expect({ name, hooks: hooks.filter((hook) => typeof (instance as Record<string, unknown>)[hook] === 'function') }).toEqual({ name, hooks: [] });
    }
  });

  it('the worker runs every part: both queues, the relay, recovery, the waiting pass and the sweeper, and stops them', () => {
    const worker = readFileSync(join(__dirname, 'worker.ts'), 'utf8');
    expect(worker).toContain('processors.push({ queue: OPERATIONS_QUEUE, handle: dispatch.handle });');
    expect(worker).toContain('processors.push({ queue: SETTLEMENTS_QUEUE, handle: dispatch.settle });');
    expect(worker).toContain('startProviderDispatchTimers(dispatch)');
    const timers = readFileSync(join(__dirname, 'provider-dispatch.ts'), 'utf8');
    for (const part of ['parts.relay.runOnce()', 'recoverExpired(parts.operations, new Date(), 100, parts.gate)', 'parts.waiting.round()', 'parts.settlement.applyPending()', 'parts.waiting.stop()', 'parts.settlement.stopSweeping()']) {
      expect({ part, there: timers.includes(part) }).toEqual({ part, there: true });
    }
  });
});

describe('the contract can fail (made-up breaks of the worker’s graph)', () => {
  const api = (): Graph => {
    const graph: Graph = { collaborators: new Map(), instances: new Map() };
    for (const name of CRITICAL) graph.collaborators.set(name, new Set(['UnitOfWork']));
    graph.collaborators.set('TaskCompletion', new Set(['UnitOfWork', 'WalletLedger', 'TasksService', 'LinePricing', 'LinesRepository']));
    return graph;
  };
  const worker = (change: (graph: Graph) => void): Graph => {
    const graph = api();
    for (const name of ONE_OF_EACH) graph.instances.set(name, new Set([{}]));
    change(graph);
    return graph;
  };

  it('a sound graph has no problem', () => {
    expect(contractProblems(worker(() => undefined), api())).toEqual([]);
  });

  it('the completion built without its ledger', () => {
    const broken = worker((graph) => graph.collaborators.get('TaskCompletion')?.delete('WalletLedger'));
    expect(contractProblems(broken, api())).toEqual(['TaskCompletion: the API gives it WalletLedger, the worker does not']);
  });

  it('a stand-in on the worker’s side only', () => {
    const broken = worker((graph) => graph.collaborators.get('TasksService')?.add('NullLedger'));
    expect(contractProblems(broken, api())).toEqual(['TasksService: the worker gives it NullLedger, the API does not']);
  });

  it('a second unit of work, a second ledger', () => {
    const broken = worker((graph) => {
      graph.instances.get('UnitOfWork')?.add({});
      graph.instances.get('WalletLedger')?.add({});
    });
    expect(contractProblems(broken, api())).toEqual(['UnitOfWork: the worker holds 2 of it, not one', 'WalletLedger: the worker holds 2 of it, not one']);
  });

  it('a critical class that one side does not build at all', () => {
    const broken = worker((graph) => graph.collaborators.delete('LinePricing'));
    expect(contractProblems(broken, api())).toContain("LinePricing: not in the worker's graph");
  });

  it('the walk itself: a real object without a collaborator reads as without it', () => {
    class Ledger {}
    class Completion {
      constructor(readonly ledger: Ledger | undefined, readonly uow: object) {}
    }
    class Uow {}
    expect([...(graphOf(new Completion(new Ledger(), new Uow())).collaborators.get('Completion') ?? [])].sort()).toEqual(['Ledger', 'Uow']);
    expect([...(graphOf(new Completion(undefined, new Uow())).collaborators.get('Completion') ?? [])]).toEqual(['Uow']);
  });
});
