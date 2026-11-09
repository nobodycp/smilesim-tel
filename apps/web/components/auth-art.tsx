import { Wifi } from 'lucide-react';
import { BrandLogo } from './brand-logo';
import { useBranding } from '../lib/branding';
import { usePrefs } from '../lib/prefs';

/**
 * The Graphite sign-in art (spec 2026-11-09-graphite-identity, from design/night-desk-family): a dark panel with the
 * crimson tag rising from its corner and one line about the office. Decoration beside the form, hidden from
 * assistive tech.
 */
export function AuthArt() {
  const { t } = usePrefs();
  const branding = useBranding();
  return (
    <aside className="gauth-art" aria-hidden="true">
      <div className="gauth-art-tag" />
      <div className="gauth-art-mark">
        {branding.logo ? <BrandLogo className="gauth-logo" onInk /> : <span className="gauth-mark"><Wifi size={24} strokeWidth={1.9} /></span>}
      </div>
      <h2>{t.loginArtTitle}</h2>
      <p>{t.loginArtText}</p>
    </aside>
  );
}

/** The brand row above a sign-in form: the saved logo, or the crimson cut tile; the name and the tagline. */
export function AuthBrand() {
  const branding = useBranding();
  return (
    <div className="gauth-brand">
      {branding.logo ? (
        <BrandLogo className="gauth-logo" />
      ) : (
        <span className="gauth-mark" aria-hidden="true"><Wifi size={22} strokeWidth={1.9} /></span>
      )}
      <div>
        <b>{branding.name}</b>
        <small>{branding.tagline}</small>
      </div>
    </div>
  );
}
