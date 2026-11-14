// The public surface of the tasks module (ADR 0020, slice R.9): what other modules may import from it.
// A module imports another through its surface only (`module-surface`, architecture-boundaries.spec.ts);
// the composition roots (`app`) and the specs may reach inside.

export { canHandleTasks, esimCodeReaders, taskWhereFor } from './task-access';
export { DECISION_GRANT, mayDecide, phaseOf, shownPhase } from './task-operation.rules';
export type { OperationPhase, TaskOperation, TaskRequest } from './task-operation.rules';
export { assertOperationAllows, lockedTask, lockedTaskOperation } from './task-operation';
export { TasksModule } from './tasks.module';
export { TasksService } from './tasks.service';
export type { OpeningLocks } from './tasks.service';
