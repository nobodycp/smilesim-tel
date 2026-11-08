'use client';

import { useBranding } from '../lib/branding';
import { DataImage } from './data-image';

/**
 * The saved logo as its two copies; `base.css` shows the light one by default and the dark one
 * under `.dark`. `onInk` wraps them in `.on-ink` for an ink panel (the sign-in banner), where the
 * copies swap the other way. Renders nothing when no logo is saved.
 */
export function BrandLogo({ className, onInk }: { className?: string; onInk?: boolean }) {
  const { logo, logoDark, name } = useBranding();
  if (!logo) return null;
  const light = <DataImage src={logo} alt={name} className={['brand-logo brand-logo-light', className].filter(Boolean).join(' ')} />;
  const dark = <DataImage src={logoDark || logo} alt="" className={['brand-logo brand-logo-dark', className].filter(Boolean).join(' ')} />;
  if (!onInk) {
    return (
      <>
        {light}
        {dark}
      </>
    );
  }
  return (
    <span className="on-ink brand-logo-wrap">
      {light}
      {dark}
    </span>
  );
}
