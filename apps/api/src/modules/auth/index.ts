// The public surface of the identity module (ADR 0020): what other modules may import from it. A module imports
// another through its surface only (`module-surface`, architecture-boundaries.spec.ts); the composition roots
// (`app`) and the specs may reach inside.

export { AuthModule } from './auth.module';
export { AUTH_STORE, AuthStore } from './auth.store';
export { hashPassword } from './password';
export { hashSessionToken } from './session-token';
export { SESSION_COOKIE_SECONDS } from './sessions';
export { fullNameProblem, newPasswordProblem } from './validators';
