'use client';

import { FilterBar } from '../../components/filter-bar';
import { Segmented, SegmentedItem } from '../../components/ui/segmented';
import { Select, SelectItem } from '../../components/ui/select';
import type { TwoFactorMethod } from '../../lib/api-types';
import { usePrefs } from '../../lib/prefs';
import { methodName } from './sign-in-methods';

// The two-step rule of a layer or of an account (spec 2026-11-11-two-factor-policy): a segmented choice of how it
// applies and, only while it is required, the list of methods. Both screens use these two pieces so they cannot drift.

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

/**
 * The system's segmented choice (`Segmented`, Tailwind migration T3.2; the legacy `.seg.role-seg`): one segment per
 * option, full width inside a dialog or pane, each 8px in at its sides.
 */
export function ModeSeg<T extends string>({ value, options, label, onChange, disabled }: {
  value: T;
  options: readonly { value: T; label: string }[];
  label: string;
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <Segmented fill value={value} onValueChange={(next) => onChange(next as T)} aria-label={label} disabled={disabled}>
      {options.map((option) => (
        <SegmentedItem key={option.value} value={option.value} className="px-2">
          {option.label}
        </SegmentedItem>
      ))}
    </Segmented>
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
        <Select value={value} disabled={disabled} onValueChange={(next) => onChange(next as TwoFactorMethod | '')}>
          {followLabel ? <SelectItem value="">{followLabel}</SelectItem> : null}
          {SHOWN_METHODS.map((method) => <SelectItem key={method} value={method}>{methodName(t, method)}</SelectItem>)}
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
  // The block's own look is utilities (Tailwind migration T3.2, from graphite.css's two-step rule): its title 14px
  // bold, the hint 12px muted (4px over, 12px under; the closing note 10px over), the method list 12px under the
  // choice. Where it sits in the role dialog (a hairline and 14px above it) stays the dialog's rule, through
  // `data-slot="layer-two-factor"`, until the roles screen is ported (T4.10).
  return (
    <section
      data-slot="layer-two-factor"
      className="grid gap-0 [&_[data-slot=filter-bar][data-bare]]:mt-3"
      aria-label={t.twoFactor}
    >
      <h3 className="m-0 text-base font-bold text-ink">{t.twoFactor}</h3>
      <p className="mx-0 mt-1 mb-3 text-sm leading-normal text-muted">{t.layerTwoFactorHint}</p>
      <ModeSeg
        value={value.required ? 'required' : 'optional'}
        label={t.twoFactor}
        options={[{ value: 'optional', label: t.twoFactorOptional }, { value: 'required', label: t.twoFactorModeRequired }]}
        onChange={(next) => onChange({ ...value, required: next === 'required' })}
      />
      {value.required ? (
        <>
          <MethodField label={t.defaultMethod} value={value.method} onChange={(method) => method && onChange({ ...value, method })} />
          <p className="mx-0 mt-2.5 mb-0 text-sm leading-normal text-muted">{t.layerTwoFactorEnds}</p>
        </>
      ) : null}
    </section>
  );
}
