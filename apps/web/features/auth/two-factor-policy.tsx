'use client';

import { FilterBar } from '../../components/filter-bar';
import { Select } from '../../components/ui/select';
import type { TwoFactorMethod } from '../../lib/api-types';
import { usePrefs } from '../../lib/prefs';
import { methodName } from './sign-in-methods';

// The two-step rule of a layer or of an account (spec 2026-11-11-two-factor-policy): a `.seg` to choose how it applies
// and, only while it is required, the list of methods. Both screens use these two pieces so they cannot drift.

export const TWO_FACTOR_METHODS: readonly TwoFactorMethod[] = ['app', 'sms', 'email'];

/**
 * The methods the screens offer (owner 2026-11-11): SMS and email stay in the API as a spare path, switched off in the
 * interface until their gateways work. Add them here to show them again, everywhere at once.
 */
export const SHOWN_METHODS: readonly TwoFactorMethod[] = ['app'];

/**
 * The offered methods among those the API allows. The API allows only what can be carried out and what the account
 * is held to (spec 2026-11-12-two-factor-available-methods), so when none of them is on the screens' own list the
 * API's list is shown as it is: a screen never proposes a method the API would refuse.
 */
export function shownAmong(allowed: readonly TwoFactorMethod[]): TwoFactorMethod[] {
  const shown = allowed.filter((method) => SHOWN_METHODS.includes(method));
  return shown.length ? shown : [...allowed];
}

/**
 * The method to save with a rule that is being set to required: the chosen one when the screens offer it, else the
 * first they offer. A rule stored with a method that is switched off is saved again with one the owner can see.
 */
export function savableMethod(method: TwoFactorMethod): TwoFactorMethod {
  return SHOWN_METHODS.includes(method) ? method : SHOWN_METHODS[0];
}

/** The system's segmented choice (`.seg`), one button per option, full width inside a dialog or pane. */
export function ModeSeg<T extends string>({ value, options, label, onChange, disabled }: {
  value: T;
  options: readonly { value: T; label: string }[];
  label: string;
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="seg role-seg" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" role="radio" aria-checked={value === option.value} disabled={disabled} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The method list as a labelled field. `followLabel` adds a first choice with no method of its own (an account that
 * follows its layer's default); the value is then ''.
 */
export function MethodField({ value, label, onChange, followLabel, disabled }: {
  label: string;
  value: TwoFactorMethod | '';
  onChange: (next: TwoFactorMethod | '') => void;
  followLabel?: string;
  disabled?: boolean;
}) {
  const { t } = usePrefs();
  // With one method on offer there is nothing to choose.
  if (SHOWN_METHODS.length < 2) return null;
  // The list is the system's filter chip and its own opened list (`FilterBar`, bare: no drawer, no «×»).
  return (
    <FilterBar loose bare>
      <label>
        {label}
        <Select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as TwoFactorMethod | '')}>
          {followLabel ? <option value="">{followLabel}</option> : null}
          {SHOWN_METHODS.map((method) => <option key={method} value={method}>{methodName(t, method)}</option>)}
        </Select>
      </label>
    </FilterBar>
  );
}

/** The layer's rule, inside the layer role dialog: optional | required, and the default method while required. */
export function LayerTwoFactor({ value, onChange }: {
  value: { required: boolean; method: TwoFactorMethod };
  onChange: (next: { required: boolean; method: TwoFactorMethod }) => void;
}) {
  const { t } = usePrefs();
  return (
    <section className="role-block role-twofactor" aria-label={t.twoFactor}>
      <h3>{t.twoFactor}</h3>
      <p className="role-hint">{t.layerTwoFactorHint}</p>
      <ModeSeg
        value={value.required ? 'required' : 'optional'}
        label={t.twoFactor}
        options={[{ value: 'optional', label: t.twoFactorOptional }, { value: 'required', label: t.twoFactorModeRequired }]}
        onChange={(next) => onChange({ ...value, required: next === 'required' })}
      />
      {value.required ? (
        <>
          <MethodField label={t.defaultMethod} value={value.method} onChange={(method) => method && onChange({ ...value, method })} />
          <p className="role-hint role-note">{t.layerTwoFactorEnds}</p>
        </>
      ) : null}
    </section>
  );
}
