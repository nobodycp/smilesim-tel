// The provider codes this build can dispatch for (ADR 0019, D18). Names only: no adapter, no endpoint, no
// credential, nothing that reaches a provider. It is what `PROVIDER_ADAPTERS` may name, and it is all the API
// knows of adapters: the start-up check of both processes reads it, and the API imports nothing else from the
// worker's side.
//
// Three things, kept apart:
//   - this MANIFEST: which codes the build supports. Shared by the API and the worker.
//   - the REGISTRY (`provider-adapters.ts`): the code that reaches each provider. The worker's only; the API's
//     import graph never reaches it (`provider-dispatch-switch.spec.ts` walks it).
//   - the worker's ATTESTATION in the database: what a running worker actually built. The API opens the dispatch
//     route on that, never on this list.
// Adding an adapter (S.12b) adds its factory to the registry and its code here; a spec keeps the two equal.
//
// SLICE S.12a: THE LIST IS EMPTY. No adapter exists, so no production process starts with a provider named.
export const SUPPORTED_ADAPTERS: readonly string[] = Object.freeze([]);
