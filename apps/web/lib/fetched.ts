// The shape every `api.*` call answers with. It is declared here, structurally,
// so a page can also build one from several calls (see `pick`).
export type Fetched<T> = { ok: true; data: T } | { ok: false; message: string; code?: string };

// Turns the data of a successful call into another shape and passes a failure through.
export function pick<T, U>(result: Fetched<T>, map: (data: T) => U): Fetched<U> {
  return result.ok ? { ok: true, data: map(result.data) } : { ok: false, message: result.message, code: result.code };
}
