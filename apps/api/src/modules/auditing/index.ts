// The public surface of the auditing module (ADR 0020, slice R.9): what other modules may import from it.
// A module imports another through its surface only (`module-surface`, architecture-boundaries.spec.ts);
// the composition roots (`app`) and the specs may reach inside.
// Nothing of it is imported by another module today.
