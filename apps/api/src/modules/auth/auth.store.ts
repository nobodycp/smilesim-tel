import { Layer, LoginUser } from './decide-login';
import { SessionRuleValues, SessionRules } from './sessions';

export const AUTH_STORE = Symbol('AUTH_STORE');

export type StoredUser = LoginUser & {
  passwordHash: string;
  /** The full name; the field keeps its historical name. */
  nickname?: string;
  email?: string;
  phone?: string;
  /** A key from PALESTINE_CITIES, or null when unset. */
  city?: string | null;
  address?: string | null;
  /** Confirmed authenticator secret; only meaningful while twoFactorEnabled is true. */
  twoFactorSecret?: string | null;
  /** Secret issued by setup and not yet proven with a code. */
  pendingTwoFactorSecret?: string | null;
  /** How the second step is proven: the authenticator app (default), or a code sent by SMS or email. */
  twoFactorMethod?: TwoFactorMethod;
  /** This account's own session rules; null follows its layer. */
  maxSessions?: number | null;
  sessionMinutes?: number | null;
};
export type TwoFactorMethod = 'app' | 'sms' | 'email';
export const TWO_FACTOR_METHODS: readonly TwoFactorMethod[] = ['app', 'sms', 'email'];
export type PasskeyRow = {
  id: string;
  userId: string;
  /** Base64url, as the browser reports it. */
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
};
export type NewPasskey = Pick<PasskeyRow, 'userId' | 'credentialId' | 'publicKey' | 'counter' | 'transports' | 'name'>;
export type UserPatch = Partial<
  Pick<
    StoredUser,
    | 'nickname'
    | 'email'
    | 'phone'
    | 'city'
    | 'address'
    | 'passwordHash'
    | 'mustChangePassword'
    | 'twoFactorEnabled'
    | 'twoFactorExempt'
    | 'twoFactorSecret'
    | 'pendingTwoFactorSecret'
    | 'twoFactorMethod'
    | 'maxSessions'
    | 'sessionMinutes'
    | 'disabledAt'
  >
>;
export type SessionScope = 'full' | 'password_change' | 'two_factor';
export type SessionKind = 'account' | 'impersonation';
export type FullSessionRow = {
  id: string;
  createdAt: Date;
  scope: 'full';
  kind: 'account';
  revokedAt: Date | null;
};
export type SessionRow = {
  id: string;
  userId: string;
  scope: SessionScope;
  kind: SessionKind;
  /** On an entered session: the account that entered. */
  operatorId?: string | null;
  userAgent: string;
  ip: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};

export interface AuthStore {
  failedCount(loginName: string): Promise<number>;
  recordFailure(loginName: string): Promise<void>;
  clearFailures(loginName: string): Promise<void>;
  findByLogin(loginName: string): Promise<StoredUser | null>;
  policy(): Promise<Record<Layer, boolean>>;
  setPolicy(layer: Layer, required: boolean): Promise<void>;
  listFullSessions(userId: string): Promise<FullSessionRow[]>;
  saveSession(input: { userId: string; scope: SessionScope; userAgent: string; ip: string }): Promise<string>;
  /** A full session that does not take one of the account's three slots. */
  saveImpersonation(input: { userId: string; operatorId: string; userAgent: string; ip: string }): Promise<string>;
  revokeSessions(ids: string[]): Promise<void>;
  userBySession(sessionId: string): Promise<LoginUser | null>;
  /** The live session, its owner and the owner's rules; null when missing, revoked, expired, or idle past the rules. */
  liveSession(sessionId: string): Promise<{ session: SessionRow; user: StoredUser; rules: SessionRules } | null>;
  /** Sets lastSeenAt to now and pushes the expiry the owner's idle time ahead (given, or read from the rules). */
  touchSession(sessionId: string, idleSeconds?: number): Promise<void>;
  /** Each layer's own session values (null follows the default). */
  sessionRules(): Promise<Record<Layer, SessionRuleValues>>;
  setSessionRules(layer: Layer, values: SessionRuleValues): Promise<void>;
  /** The account's effective rules: account, then layer, then default. */
  rulesFor(user: Pick<StoredUser, 'layer' | 'maxSessions' | 'sessionMinutes'>): Promise<SessionRules>;
  listSessions(userId: string): Promise<SessionRow[]>;
  updateUser(userId: string, patch: UserPatch): Promise<void>;
  /** Revokes every session of the user, whatever its scope, and deletes their live keys. */
  dropLiveSessions(userId: string): Promise<void>;
  /** A short-lived value (codes, passkey challenges). `ttlSeconds` 0 keeps the current expiry. */
  putSecret(key: string, value: string, ttlSeconds: number): Promise<void>;
  getSecret(key: string): Promise<string | null>;
  dropSecret(key: string): Promise<void>;
  /** Reads a one-time secret and removes it in one step, so two requests cannot both redeem it. */
  takeSecret(key: string): Promise<string | null>;
  listPasskeys(userId: string): Promise<PasskeyRow[]>;
  passkeyByCredential(credentialId: string): Promise<{ passkey: PasskeyRow; user: StoredUser } | null>;
  addPasskey(input: NewPasskey): Promise<PasskeyRow>;
  /** Records a sign-in with the passkey and its new signature counter. */
  usePasskey(id: string, counter: number): Promise<void>;
  /** False when the passkey is not the user's. */
  removePasskey(userId: string, id: string): Promise<boolean>;
}
