import { Inject, Injectable } from '@nestjs/common';
import { Layer } from './decide-login';
import { ExemptionBody, PolicyBody, TwoFactorModeBody, parseBody } from './auth.schemas';
import { AUTH_STORE, AuthStore, TwoFactorMethod } from './auth.store';
import { AuthService, fail, type Outcome } from './auth.service';
import { MESSAGE_SENDER, type MessageSender } from './message-sender';
import { availableMethods, endUnenrolledSessions, policyView, settingsView, type LayerRule, type UserSettingsView } from './two-factor-policy';

/**
 * The branch owner's two-step rules (spec 2026-11-11-two-factor-policy): a layer is required or optional with a
 * default method, an account follows its layer, is required, or is optional. Becoming required signs out the
 * accounts that have no two-step verification.
 */
@Injectable()
export class TwoFactorPolicyService {
  constructor(
    @Inject(AUTH_STORE) private readonly store: AuthStore,
    private readonly auth: AuthService,
    @Inject(MESSAGE_SENDER) private readonly sender: MessageSender,
  ) {}

  async overview(sessionId: string | undefined): Promise<Outcome<{ policy: Record<Layer, LayerRule> }>> {
    const owner = await this.auth.ownerSession(sessionId);
    if (owner.kind === 'error') return owner;
    return { kind: 'ok', policy: await policyView(this.store) };
  }

  /** A layer is required or optional, with the method its accounts enrol with; going required signs out the unenrolled. */
  async setPolicy(sessionId: string | undefined, body: PolicyBody): Promise<Outcome<{ policy: Record<Layer, LayerRule>; endedAccounts: number }>> {
    const owner = await this.auth.ownerSession(sessionId);
    if (owner.kind === 'error') return owner;
    const input = parseBody(PolicyBody, body);
    if (!input) return fail(400, 'INVALID');
    // Refused before anything is written or anyone is signed out: a method that cannot be carried out now, named
    // here or already stored on a layer that is being made required (spec 2026-11-12-two-factor-available-methods).
    const method = (input.method as TwoFactorMethod | undefined) ?? (await this.store.layerMethods())[input.layer];
    const usable = availableMethods(this.sender).includes(method);
    if (!usable && (input.method !== undefined || input.required === true)) return fail(400, 'METHOD_UNAVAILABLE');
    if (input.method !== undefined) await this.store.setLayerMethod(input.layer, input.method as TwoFactorMethod);
    if (input.required !== undefined) await this.store.setPolicy(input.layer, input.required);
    const endedAccounts = input.required === true ? await endUnenrolledSessions(this.store, await this.store.unenrolledUsers(input.layer), owner.user.id) : 0;
    return { kind: 'ok', policy: await policyView(this.store), endedAccounts };
  }

  /** Shorthand kept for older callers: exempt = mode optional, not exempt = follow the layer. */
  async setExemption(sessionId: string | undefined, loginName: string, body: ExemptionBody): Promise<Outcome<{ twoFactorExempt: boolean }>> {
    const owner = await this.auth.ownerSession(sessionId);
    if (owner.kind === 'error') return owner;
    const input = parseBody(ExemptionBody, body);
    if (!input) return fail(400, 'INVALID');
    const target = await this.store.findByLogin(loginName);
    if (!target) return fail(404, 'NOT_FOUND');
    await this.store.updateUser(target.id, { twoFactorExempt: input.exempt, twoFactorRequired: false, requiredMethod: null });
    return { kind: 'ok', twoFactorExempt: input.exempt };
  }

  /** The account's own two-step mode: follow its layer, required (with its own method or the layer's), or optional. */
  async setAccountMode(sessionId: string | undefined, loginName: string, body: TwoFactorModeBody): Promise<Outcome<{ settings: UserSettingsView; endedAccounts: number }>> {
    const owner = await this.auth.ownerSession(sessionId);
    if (owner.kind === 'error') return owner;
    const input = parseBody(TwoFactorModeBody, body);
    if (!input) return fail(400, 'INVALID');
    const target = await this.store.findByLogin(loginName);
    if (!target) return fail(404, 'NOT_FOUND');
    // Required of this account with a method that cannot be carried out now, its own or the layer's it would
    // follow: refused before anything is written or anyone is signed out.
    if (input.mode === 'required') {
      const method = input.method ?? (await this.store.layerMethods())[target.layer];
      if (!availableMethods(this.sender).includes(method)) return fail(400, 'METHOD_UNAVAILABLE');
    }
    await this.store.updateUser(target.id, {
      twoFactorExempt: input.mode === 'optional',
      twoFactorRequired: input.mode === 'required',
      requiredMethod: input.mode === 'required' ? (input.method ?? null) : null,
    });
    const stored = (await this.store.findByLogin(loginName)) ?? target;
    const endedAccounts = await endUnenrolledSessions(this.store, [stored], owner.user.id);
    return { kind: 'ok', settings: await settingsView(this.store, stored), endedAccounts };
  }
}
