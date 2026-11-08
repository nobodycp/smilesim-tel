'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { BrandingDrop } from '../../../components/branding-drop';
import { BrandingPreview } from '../../../components/branding-preview';
import { Desk } from '../../../components/desk';
import { api } from '../../../lib/api';
import { brandingImageUrl } from '../../../lib/branding-load';
import { darkVariant, FAVICON_SIDE, fetchAsDataUrl, LOGO_SIDE, shrinkImage } from '../../../lib/branding-image';
import { useOffice } from '../../../lib/office-session';
import { usePrefs } from '../../../lib/prefs';
import { useAction } from '../../../lib/use-action';
import { pick, type Fetched } from '../../../lib/fetched';
import { useApiQuery } from '../../../lib/use-api-query';
import { sharedKeys } from '../../../lib/query';
import { useRequireLayer } from '../../../lib/use-require-layer';
import { Button } from '../../../components/ui/button';

// Every image is a data URL or '' (none), so an untouched image is re-sent as it was stored.
type Draft = { siteName: string; tagline: string; logo: string; logoDark: string; favicon: string };

const EMPTY: Draft = { siteName: '', tagline: '', logo: '', logoDark: '', favicon: '' };

async function loadDraft(): Promise<Fetched<Draft>> {
  const summary = await api.branding();
  if (!summary.ok) return pick(summary, () => EMPTY);
  const { siteName, tagline, hasLogo, hasFavicon, version } = summary.data;
  const [logo, logoDark, favicon] = await Promise.all([
    hasLogo ? fetchAsDataUrl(brandingImageUrl('logo', version)) : '',
    hasLogo ? fetchAsDataUrl(brandingImageUrl('logo-dark', version)) : '',
    hasFavicon ? fetchAsDataUrl(brandingImageUrl('favicon', version)) : '',
  ]);
  return { ok: true, data: { siteName, tagline, logo, logoDark, favicon } };
}

const same = (a: Draft, b: Draft) => (Object.keys(EMPTY) as (keyof Draft)[]).every((key) => a[key] === b[key]);

export function BrandingScreen() {
  const { t } = usePrefs();
  const router = useRouter();
  const { me } = useOffice();
  const allowed = useRequireLayer(['branch']);
  const owner = allowed && Boolean(me?.isBranchOwner);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const { data, error: loadError } = useApiQuery(sharedKeys.brandingDraft, loadDraft, { enabled: owner, fresh: true });

  useEffect(() => {
    if (me && !me.isBranchOwner) router.replace('/');
  }, [me, router]);

  if (!owner) return null;

  return (
    <Desk title={t.brandingTitle} lede={t.brandingLede} error={loadError || error} note={note}>
      {data ? <BrandingEditor initial={data} setError={setError} setNote={setNote} /> : null}
    </Desk>
  );
}

function BrandingEditor({
  initial,
  setError,
  setNote,
}: {
  initial: Draft;
  setError: (message: string) => void;
  setNote: (message: string) => void;
}) {
  const { t } = usePrefs();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(initial);
  const [saved, setSaved] = useState<Draft>(initial);
  const { run, busy } = useAction({ setError, setNote });
  const dirty = !same(draft, saved);
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  async function pickLogo(file: File) {
    setError('');
    const logo = await shrinkImage(file, LOGO_SIDE);
    if (!logo) {
      setError(t.brandingTooLarge);
      return;
    }
    const logoDark = (await darkVariant(logo)) || logo;
    set({ logo, logoDark });
  }

  async function pickFavicon(file: File) {
    setError('');
    const favicon = await shrinkImage(file, FAVICON_SIDE);
    if (!favicon) {
      setError(t.brandingTooLarge);
      return;
    }
    set({ favicon });
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!dirty) return;
    void run(
      () =>
        api.saveBranding({
          siteName: draft.siteName.trim(),
          tagline: draft.tagline.trim(),
          logo: draft.logo || null,
          logoDark: draft.logoDark || null,
          favicon: draft.favicon || null,
        }),
      {
        note: t.brandingSaved,
        then: () => {
          setSaved(draft);
          // The layout holds the identity; refreshing it repaints the shell, title and favicon.
          router.refresh();
        },
      },
    );
  }

  return (
    <div className="brand-layout">
      <form className="brand-form" onSubmit={save} aria-busy={busy}>
        <section className="pane">
          <header className="pane-head"><h2>{t.brandingNames}</h2></header>
          <div className="pane-body">
            <div className="pair">
              <label>
                {t.brandingSiteName}
                <input
                  value={draft.siteName}
                  maxLength={120}
                  placeholder={t.brand}
                  onChange={(event) => set({ siteName: event.target.value })}
                />
              </label>
              <label>
                {t.brandingTagline}
                <input
                  value={draft.tagline}
                  maxLength={160}
                  placeholder={t.brandSub}
                  onChange={(event) => set({ tagline: event.target.value })}
                />
              </label>
            </div>
          </div>
        </section>

        <section className="pane">
          <header className="pane-head"><h2>{t.brandingImages}</h2></header>
          <div className="pane-body">
            <p className="hint">{t.brandingImagesHint}</p>
            <div className="brand-drops">
              <BrandingDrop
                id="brand-logo"
                title={t.brandingLogo}
                value={draft.logo}
                dark={draft.logoDark}
                onPick={(file) => void pickLogo(file)}
                onClear={() => set({ logo: '', logoDark: '' })}
              />
              <BrandingDrop
                id="brand-favicon"
                title={t.brandingFavicon}
                value={draft.favicon}
                square
                onPick={(file) => void pickFavicon(file)}
                onClear={() => set({ favicon: '' })}
              />
            </div>
          </div>
        </section>

        <div className="brand-foot">
          <Button type="submit" disabled={!dirty || busy}>{t.saveChanges}</Button>
          <Button type="button" variant="secondary" disabled={!dirty || busy} onClick={() => setDraft(saved)}>
            {t.discardChanges}
          </Button>
        </div>
      </form>

      <BrandingPreview
        name={draft.siteName.trim() || t.brand}
        tagline={draft.tagline.trim() || t.brandSub}
        logo={draft.logo}
        logoDark={draft.logoDark}
        favicon={draft.favicon}
      />
    </div>
  );
}
