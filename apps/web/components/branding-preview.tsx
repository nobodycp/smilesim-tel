'use client';

import { usePrefs } from '../lib/prefs';

/**
 * The live preview beside the identity form: a browser tab, the sidebar head, and the sign-in
 * lockup, drawn from the draft so a change shows before it is saved. Logo copies swap with the
 * theme through `.brand-logo-light` / `.brand-logo-dark`.
 */
export function BrandingPreview({
  name,
  tagline,
  logo,
  logoDark,
  favicon,
}: {
  name: string;
  tagline: string;
  logo: string;
  logoDark: string;
  favicon: string;
}) {
  const { t } = usePrefs();
  const initial = name.trim().charAt(0);
  const logoPair = logo ? (
    <>
      <img src={logo} alt="" className="brand-logo brand-logo-light" />
      <img src={logoDark || logo} alt="" className="brand-logo brand-logo-dark" />
    </>
  ) : null;

  return (
    <aside className="brand-preview" aria-label={t.brandingPreview}>
      <p className="brand-preview-label">{t.brandingPreview}</p>

      <div className="bp-browser" aria-label={t.brandingPreviewTab}>
        <div className="bp-tab">
          <span className={favicon ? 'bp-tab-icon has-image' : 'bp-tab-icon'} aria-hidden="true">
            {favicon && <img src={favicon} alt="" />}
          </span>
          <span className="bp-tab-title">{name}</span>
          <span className="bp-tab-close" aria-hidden="true">×</span>
        </div>
        <div className="bp-body">
          <div className="bp-side" aria-label={t.brandingPreviewSidebar}>
            {logoPair ?? <span className="bp-mark" aria-hidden="true">{initial}</span>}
            <span className="bp-name">{name}</span>
            <span className="bp-tag">{tagline}</span>
          </div>
          <div className="bp-lines" aria-hidden="true">
            <span style={{ width: '70%' }} />
            <span style={{ width: '45%' }} />
            <span style={{ width: '58%' }} />
          </div>
        </div>
      </div>

      <div className="bp-login" aria-label={t.brandingPreviewLogin}>
        {logoPair}
        <span className="bp-login-name">{name}</span>
        <span className="bp-login-tag">{tagline}</span>
        <span className="bp-field" aria-hidden="true" />
        <span className="bp-field" aria-hidden="true" />
        <span className="bp-btn" aria-hidden="true">{t.signIn}</span>
      </div>
    </aside>
  );
}
