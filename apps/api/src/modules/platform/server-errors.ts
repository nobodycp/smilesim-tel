// The port a server error (a 5xx) is kept through (system monitor M.4; ADR 0020, as the activity log's port).
//
// The platform owns the port: the abstract `ServerErrorRecorder` and what a record holds (`ServerErrorDraft`). The
// error filter (`api-exception.filter.ts`), where a 5xx is decided, records through it; `modules/monitoring` owns the
// one implementation (its request log's writer, bound under this class by `MonitoringModule`), so the platform
// imports nothing of monitoring. Nest resolves the abstract class as the token.

/** One server error, beside its request's row in the request log (the same `requestId`). Nothing of the request's values. */
export type ServerErrorDraft = {
  requestId: string;
  at: Date;
  method: string;
  /** The route pattern (`/v1/lines/:id`); empty when no route matched. */
  route: string;
  /** What `errorReport` (`log.ts`) keeps of the error: its class, a code for its message, the top of its stack. */
  name: string;
  message: string;
  frames: string[];
};

export abstract class ServerErrorRecorder {
  /** Takes one error; never throws and never waits, so the answer is not held by it. */
  abstract record(draft: ServerErrorDraft): void;
}
