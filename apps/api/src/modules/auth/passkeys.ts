import { wholeEnv } from '../../config';
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { allowedOrigins } from '../../cors';
import { ERROR_MESSAGES, type ErrorCode } from '../../errors';
import { PasskeyBody, PasskeyLoginBody, parseBody } from './auth.schemas';
import { AUTH_STORE, AuthStore, PasskeyRow } from './auth.store';
import { AuthService, type Failure, type Outcome } from './auth.service';
import { Layer } from './decide-login';

// Passkeys (spec 2026-11-08-signin-methods): added from settings with a full session, and a sign-in of their own
// that stands for the password and the second step together. Challenges live CHALLENGE_SECONDS and are spent once.

export const CHALLENGE_SECONDS = 300;
const RP_NAME = 'SmileSim';
const NAME_LIMIT = 40;

type Meta = { userAgent: string; ip: string };
type Challenge = { challenge: string; rpID: string; origin: string };
type PasskeyView = { id: string; name: string; createdAt: Date; lastUsedAt: Date | null };

const fail = (status: Failure['status'], code: ErrorCode): Failure => ({ kind: 'error', status, message: ERROR_MESSAGES[code], code });
const view = (row: PasskeyRow): PasskeyView => ({ id: row.id, name: row.name, createdAt: row.createdAt, lastUsedAt: row.lastUsedAt });
const registerKey = (sessionId: string) => `passkey-register:${sessionId}`;
const loginKey = (loginId: string) => `passkey-login:${loginId}`;

/**
 * The relying party for a page origin: `WEBAUTHN_RP_ID` when set, else the host without its first label, so every
 * door (admin., main., agent., pos.) shares one passkey. Null when the origin is not one the API serves.
 */
export function relyingParty(origin: string | undefined, env: Record<string, string | undefined> = wholeEnv()): Challenge | null {
  if (!origin || !allowedOrigins().includes(origin)) return null;
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return null;
  }
  const configured = env.WEBAUTHN_RP_ID?.trim();
  const labels = host.split('.');
  const rpID = configured || (labels.length > 1 && !/^\d+$/.test(labels.at(-1) ?? '') ? labels.slice(1).join('.') : host);
  return { challenge: '', rpID, origin };
}

@Injectable()
export class PasskeyService {
  constructor(
    @Inject(AUTH_STORE) private readonly store: AuthStore,
    private readonly auth: AuthService,
  ) {}

  private async fullSession(sessionId: string | undefined) {
    const authed = await this.auth.authenticate(sessionId);
    if (!authed) return fail(401, 'LOGIN_REQUIRED');
    if (authed.session.scope !== 'full' || authed.session.kind !== 'account') return fail(403, 'FORBIDDEN');
    return { kind: 'ok' as const, ...authed };
  }

  private async takeChallenge(key: string): Promise<Challenge | null> {
    // Read and removed in one step: a challenge answers one request.
    const raw = await this.store.takeSecret(key);
    if (!raw) return null;
    return JSON.parse(raw) as Challenge;
  }

  async list(sessionId: string | undefined): Promise<Outcome<{ passkeys: PasskeyView[] }>> {
    const authed = await this.fullSession(sessionId);
    if (authed.kind === 'error') return authed;
    return { kind: 'ok', passkeys: (await this.store.listPasskeys(authed.user.id)).map(view) };
  }

  async registrationOptions(sessionId: string | undefined, origin: string | undefined): Promise<Outcome<{ options: unknown }>> {
    const authed = await this.fullSession(sessionId);
    if (authed.kind === 'error') return authed;
    const party = relyingParty(origin);
    if (!party) return fail(400, 'INVALID');
    const { user, session } = authed;
    const existing = await this.store.listPasskeys(user.id);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: party.rpID,
      userName: user.loginName,
      userDisplayName: user.nickname || user.loginName,
      userID: new TextEncoder().encode(user.id),
      attestationType: 'none',
      excludeCredentials: existing.map((row) => ({ id: row.credentialId, transports: row.transports })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    await this.store.putSecret(registerKey(session.id), JSON.stringify({ ...party, challenge: options.challenge }), CHALLENGE_SECONDS);
    return { kind: 'ok', options };
  }

  async register(
    sessionId: string | undefined,
    body: PasskeyBody,
  ): Promise<Outcome<{ passkey: PasskeyView }>> {
    const authed = await this.fullSession(sessionId);
    if (authed.kind === 'error') return authed;
    const input = parseBody(PasskeyBody, body);
    if (!input) return fail(400, 'INVALID');
    const challenge = await this.takeChallenge(registerKey(authed.session.id));
    if (!challenge) return fail(400, 'CODE_EXPIRED');
    const response = input.response as unknown as RegistrationResponseJSON;
    let verified: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verified = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: challenge.origin,
        expectedRPID: challenge.rpID,
        // A passkey stands for the password and the second step, so the device must have checked its holder.
        requireUserVerification: true,
      });
    } catch {
      return fail(400, 'PASSKEY_FAILED');
    }
    if (!verified.verified) return fail(400, 'PASSKEY_FAILED');
    const { credential } = verified.registrationInfo;
    if (await this.store.passkeyByCredential(credential.id)) return fail(400, 'PASSKEY_FAILED');
    const name = (input.name ?? '').trim().slice(0, NAME_LIMIT) || RP_NAME;
    const row = await this.store.addPasskey({
      userId: authed.user.id,
      credentialId: credential.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: credential.transports ?? response.response?.transports ?? [],
      name,
    });
    return { kind: 'ok', passkey: view(row) };
  }

  async remove(sessionId: string | undefined, id: string): Promise<Outcome<unknown>> {
    const authed = await this.fullSession(sessionId);
    if (authed.kind === 'error') return authed;
    if (!(await this.store.removePasskey(authed.user.id, id))) return fail(404, 'NOT_FOUND');
    return { kind: 'ok' };
  }

  /** The first half of a passkey sign-in: a challenge any passkey of this site can answer. */
  async loginOptions(origin: string | undefined): Promise<Outcome<{ loginId: string; options: unknown }>> {
    const party = relyingParty(origin);
    if (!party) return fail(400, 'INVALID');
    const options = await generateAuthenticationOptions({ rpID: party.rpID, userVerification: 'required' });
    const loginId = randomUUID();
    await this.store.putSecret(loginKey(loginId), JSON.stringify({ ...party, challenge: options.challenge }), CHALLENGE_SECONDS);
    return { kind: 'ok', loginId, options };
  }

  /**
   * The second half: the passkey stands for the password and the second step. The door, a disabled account, a forced
   * password change and the session limit apply as they do to a password sign-in.
   */
  async login(
    body: PasskeyLoginBody,
    meta: Meta,
    door: Layer | null,
  ): Promise<Outcome<{ next: 'app' | 'password'; sessionId: string; loginName: string }> | (Failure & { loginName?: string })> {
    const input = parseBody(PasskeyLoginBody, body);
    if (!input) return fail(400, 'INVALID');
    const challenge = await this.takeChallenge(loginKey(input.loginId));
    if (!challenge) return fail(401, 'CODE_EXPIRED');
    const response = input.response as unknown as AuthenticationResponseJSON;
    const found = typeof response.id === 'string' ? await this.store.passkeyByCredential(response.id) : null;
    if (!found) return fail(401, 'PASSKEY_FAILED');
    const { passkey, user } = found;
    let verified: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verified = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: challenge.origin,
        expectedRPID: challenge.rpID,
        credential: { id: passkey.credentialId, publicKey: new Uint8Array(passkey.publicKey), counter: passkey.counter, transports: passkey.transports },
        // A passkey stands for the password and the second step, so the device must have checked its holder.
        requireUserVerification: true,
      });
    } catch {
      return { ...fail(401, 'PASSKEY_FAILED'), loginName: user.loginName };
    }
    if (!verified.verified) return { ...fail(401, 'PASSKEY_FAILED'), loginName: user.loginName };
    if (user.disabledAt) return { ...fail(403, 'ACCOUNT_DISABLED'), loginName: user.loginName };
    if (door && user.layer !== door) return { ...fail(403, 'DOOR_MISMATCH'), loginName: user.loginName };
    await this.store.usePasskey(passkey.id, verified.authenticationInfo.newCounter);
    if (user.mustChangePassword) {
      const sessionId = await this.store.saveSession({ userId: user.id, scope: 'password_change', userAgent: meta.userAgent, ip: meta.ip });
      return { kind: 'ok', next: 'password', sessionId, loginName: user.loginName };
    }
    await this.auth.makeRoom(user);
    const sessionId = await this.store.saveSession({ userId: user.id, scope: 'full', userAgent: meta.userAgent, ip: meta.ip });
    return { kind: 'ok', next: 'app', sessionId, loginName: user.loginName };
  }
}
