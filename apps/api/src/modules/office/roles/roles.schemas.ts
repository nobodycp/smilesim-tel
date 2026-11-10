import { z } from 'zod';
import { GRANT_CODES } from '../office-grants';

// The body of the role route (backend-engineering.mdc 4.1). The service parses it with `parseInput` after its
// permission check; the controller documents the route from the same schema.

const flag = z.boolean().optional();

/**
 * POST roles — a new job role, or a change to the role `id` names. The grants come as a list of codes; without a
 * list, the seven older yes/no flags are read instead. A layer role keeps its name, so the name's minimum is the
 * service's to check.
 */
export const RoleBody = z.object({
  id: z.string().max(64).optional(),
  name: z.string().trim().max(60).optional(),
  grants: z.array(z.enum(GRANT_CODES)).max(64).optional(),
  read: flag,
  edit: flag,
  accounting: flag,
  tasks: flag,
  reports: flag,
  staff: flag,
  enter: flag,
});
export type RoleBody = z.input<typeof RoleBody>;
