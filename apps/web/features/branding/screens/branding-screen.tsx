'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { BrandingDrop } from '../../../components/branding-drop';
import { BrandingPreview } from '../../../components/branding-preview';
import { Desk, Pane } from '../../../components/desk';
import { api } from '../../../lib/api';
import { brandingImageUrl } from '../../../lib/branding-load';
import { darkVariant, FAVICON_SIDE, fetchAsDataUrl, LOGO_SIDE, shrinkImage } from '../../../lib/branding-image';
import { useDesk } from '../../../lib/desk-session';
import { usePrefs } from '../../../lib/prefs';
import { useAction } from '../../../lib/use-action';
import { pick, type Fetched } from '../../../lib/fetched';
import { useApiQuery } from '../../../lib/use-api-query';
import { sharedKeys } from '../../../lib/query';
import { useRequireLayer } from '../../../lib/use-require-layer';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';

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

/*
 * The identity page:
 * - the layout: the form fills the width and the live preview keeps a 360px column beside it, 12px apart, both at the
 *   top; one column at 960px and under (the preview then stops being sticky, components/branding-preview.tsx);
 * - the form: a column 12px apart; its foot a wrapping row 8px apart;
 * - a pane's head: one row, 8px apart, at least 52px high, 14px / 18px padding, a hairline under it; its title an
 *   inline row 8px apart, 14px bold ink, no margin. Its body: a column 12px apart, 14px / 18px / 18px padding, its
 *   rows at their own height and never wider than it; in the desk it scrolls inside the pane;
 * - the fields: the pane's captions (`Label tone="pane"`) and fields (34px on `--rd-surface`, 13px); the two names
 *   side by side 8px apart, one column under 768px; the hint 12px muted with no margin;
 * - the drops: as many 16rem-or-wider columns as fit, 12px apart.
 */
const PANE_HEAD = 'flex min-h-13 items-center justify-between gap-2 border-b border-line bg-transparent px-4.5 py-3.5';
const PANE_TITLE = 'm-0 inline-flex items-center gap-2 text-base font-bold text-ink';
const PANE_BODY = 'grid content-start gap-3 px-4.5 pt-3.5 pb-4.5 *:min-w-0 [.desk_&]:min-h-0 [.desk_&]:overflow-auto';
const FIELD = 'text-md';

const same = (a: Draft, b: Draft) => (Object.keys(EMPTY) as (keyof Draft)[]).every((key) => a[key] === b[key]);

export function BrandingScreen() {
  const { t } = usePrefs();
  const router = useRouter();
  const { me } = useDesk();
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
    <div className="grid grid-cols-[minmax(0,1fr)_360px] items-start gap-3 max-[961px]:grid-cols-1">
      <form className="grid content-start gap-3" onSubmit={save} aria-busy={busy}>
        <Pane>
          <header className={PANE_HEAD}><h2 className={PANE_TITLE}>{t.brandingNames}</h2></header>
          <div className={PANE_BODY}>
            <div className="grid grid-cols-2 gap-2 max-md:grid-cols-1">
              <Label tone="pane">
                {t.brandingSiteName}
                <Input
                  surface="surface"
                  className={FIELD}
                  value={draft.siteName}
                  maxLength={120}
                  placeholder={t.brand}
                  onChange={(event) => set({ siteName: event.target.value })}
                />
              </Label>
              <Label tone="pane">
                {t.brandingTagline}
                <Input
                  surface="surface"
                  className={FIELD}
                  value={draft.tagline}
                  maxLength={160}
                  placeholder={t.brandSub}
                  onChange={(event) => set({ tagline: event.target.value })}
                />
              </Label>
            </div>
          </div>
        </Pane>

        <Pane>
          <header className={PANE_HEAD}><h2 className={PANE_TITLE}>{t.brandingImages}</h2></header>
          <div className={PANE_BODY}>
            <p className="m-0 text-sm text-muted">{t.brandingImagesHint}</p>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] gap-3">
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
        </Pane>

        <div className="flex flex-wrap gap-2">
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
