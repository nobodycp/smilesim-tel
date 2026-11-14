// Tables that answer every read with nothing and record every write: for specs that call many routes and only ask
// what a route did to the database (`get-writes-nothing`, `query-filters`).

const WRITES = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);

/** The one account these tables hold: the branch owner. */
export const OWNER_ROW = { id: 'admin', loginName: 'admin', nickname: 'الإدارة', layer: 'branch', parentId: null, deniedOps: '', disabledAt: null, isBranchOwner: true, liveGrants: '', role: null };

export function emptyTables() {
  const written: string[] = [];
  const table = (model: string) =>
    new Proxy({}, {
      get: (_target, method: string) => async () => {
        if (WRITES.has(method)) {
          written.push(`${model}.${method}`);
          return {};
        }
        if (method === 'findMany') return model === 'user' ? [OWNER_ROW] : [];
        if (method === 'findUnique' || method === 'findFirst') return model === 'user' ? OWNER_ROW : null;
        if (method === 'count') return 0;
        if (method === 'groupBy') return [];
        if (method === 'aggregate') return { _sum: {}, _count: {}, _max: {}, _min: {}, _avg: {} };
        return null;
      },
    });
  const tables: Record<string, unknown> = new Proxy({}, {
    get: (_target, model: string) => {
      if (model === '$transaction') return async (run: (client: unknown) => Promise<unknown>) => run(tables);
      if (model === '$queryRaw' || model === '$executeRaw') return async () => [];
      if (model === 'then') return undefined;
      return table(model);
    },
  });
  return { tables, written };
}
