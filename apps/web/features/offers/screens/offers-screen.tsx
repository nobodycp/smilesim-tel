'use client';

import { DateField } from '../../../components/date-field';
import { Plus } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { DataTable, type Column } from '../../../components/data-table';
import { DataImage } from '../../../components/data-image';
import { Desk, Pane, layerName } from '../../../components/desk';
import { Dialog } from '../../../components/dialog';
import { EmptyState } from '../../../components/empty-state';
import { LiveSwitch } from '../../../components/live-switch';
import { OfferHero } from '../../../components/offer-hero';
import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Textarea } from '../../../components/ui/textarea';
import { RowMenu } from '../../../components/row-menu';
import { api, type Offer, type OfferInput } from '../../../lib/api';
import { shrinkImage } from '../../../lib/branding-image';
import { cn } from '../../../lib/cn';
import { usePrefs } from '../../../lib/prefs';
import { sharedKeys } from '../../../lib/query';
import { useAction } from '../../../lib/use-action';
import { useApiQuery } from '../../../lib/use-api-query';
import { useRequireLayer } from '../../../lib/use-require-layer';

const LAYERS = ['branch', 'main_agent', 'agent', 'pos'] as const;
/** About 700 KB of picture; the API refuses more. */
// Decision 11 (speed plan PF.6): an offer picture is stored as WebP, 1600 px on its longest side at most (the hero
// is a 2:1 tile at most ~60% of the page wide), and at most 300 KB — the API's `OFFER_IMAGE_BYTES`.
const OFFER_SIDE = 1600;
const OFFER_IMAGE_BYTES = 300_000;
const OFFER_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const OFFER_QUALITIES = [0.85, 0.75, 0.6];

/*
 * The page and its form:
 * - an offer's picture: a block 64px wide at 2:1, cut to fill, 4px corners on `--rd-surface-2` (also
 *   the empty frame when there is none); 200px wide in the form;
 * - the head's action: a wrapping inline row, items centred, 8px apart;
 * - the preview's caption: 12px bold muted, 2px over and 8px under it;
 * - the form: a column 12px apart; its captions are the dialog's (`Label tone="dialog"`); two fields side by side 8px
 *   apart, one column under 768px; a tick box in a row 8px from its name, at least 36px high (44px at 720px and
 *   under), 13px ink 600; the picture beside its buttons in a wrapping row 12px apart, at the top, the buttons a
 *   column 12px apart; the audience a borderless fieldset with no margin or padding, its boxes a wrapping row 12px
 *   apart, its legend bold 6px over them;
 * - the body's text area takes the dialog's field height (34px, 44px at 720px and under) with no padding above or under
 *   its text (the `[data-slot='dialog'] textarea` rule of app/tailwind.css; its `rows` gives no height).
 * The image hint under the buttons is a plain paragraph: no `.hint` rule reaches it in a dialog.
 */
const THUMB = 'block w-16 aspect-2/1 rounded-xs bg-surface-2 object-cover';
const THUMB_LARGE = 'w-50';
const PAIR = 'grid grid-cols-2 gap-2 max-md:grid-cols-1';
const CHECK_ROW = 'm-0 flex min-h-9 cursor-pointer items-center gap-2 text-ink max-touch:min-h-11';

type Draft = { id: string | null; title: string; body: string; image: string | null; actionLabel: string; actionHref: string; seconds: string; layers: string[]; startsAt: string; endsAt: string; active: boolean };
const empty: Draft = { id: null, title: '', body: '', image: null, actionLabel: '', actionHref: '', seconds: '7', layers: [...LAYERS], startsAt: '', endsAt: '', active: true };

/**
 * «الإعلانات» (spec 2026-11-09-offers-tasks-addons-wallet-esim, 1): the offers on every account's home hero — add,
 * edit, switch on or off, order and delete; a preview of the live ones on top. Branch owner and the edit grant.
 */
export function OffersScreen() {
  const { t, apiText } = usePrefs();
  const allowed = useRequireLayer(['branch']);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const read = useApiQuery(sharedKeys.offers, () => api.offers(), { enabled: allowed });
  const { run, busy } = useAction({ setError, setNote, onDone: read.reload });
  const offers = read.data?.offers ?? [];

  function edit(offer: Offer | null) {
    setError('');
    setDraft(offer ? {
      id: offer.id, title: offer.title, body: offer.body, image: offer.image, actionLabel: offer.actionLabel ?? '', actionHref: offer.actionHref ?? '',
      seconds: String(offer.seconds), layers: offer.layers, startsAt: offer.startsAt?.slice(0, 10) ?? '', endsAt: offer.endsAt?.slice(0, 10) ?? '', active: offer.active,
    } : { ...empty });
  }

  async function pickImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !draft) return;
    if (!OFFER_TYPES.includes(file.type)) { setError(t.offerImageType); return; }
    // Shrunk in the browser, the way the logo is (lib/branding-image.ts): the API stores what it is sent.
    const image = await shrinkImage(file, OFFER_SIDE, { types: OFFER_TYPES, limit: OFFER_IMAGE_BYTES, qualities: OFFER_QUALITIES });
    if (!image) { setError(apiText({ message: '', code: 'IMAGE_TOO_LARGE' })); return; }
    setError('');
    setDraft((current) => (current ? { ...current, image } : current));
  }

  async function save() {
    if (!draft) return;
    const seconds = Number(draft.seconds);
    if (!draft.title.trim() || !Number.isInteger(seconds) || seconds < 3 || seconds > 60 || draft.layers.length === 0) {
      setError(apiText('بيانات غير صالحة'));
      return;
    }
    // The picture goes only when it changed (speed plan PF.7): a data URL replaces it, null removes it; the URL the
    // list carries is the stored picture, so its key is left out and the API keeps it.
    const image = draft.image === null || draft.image.startsWith('data:') ? { image: draft.image } : {};
    const body: OfferInput = {
      title: draft.title.trim(), body: draft.body.trim(), ...image, actionLabel: draft.actionLabel.trim() || null, actionHref: draft.actionHref.trim() || null,
      seconds, layers: draft.layers, startsAt: draft.startsAt || null, endsAt: draft.endsAt ? `${draft.endsAt}T23:59:59.999Z` : null, active: draft.active,
    };
    await run(() => (draft.id ? api.saveOffer(draft.id, body) : api.addOffer(body)), { note: t.saved, then: () => setDraft(null) });
  }

  const columns: Column<Offer>[] = [
    { key: 'image', header: '', fit: true, render: (row) => (row.image ? <DataImage className={THUMB} src={row.image} alt="" /> : <span className={THUMB} aria-hidden="true" />) },
    { key: 'title', header: t.offerTitle, render: (row) => <strong>{row.title}</strong> },
    { key: 'layers', header: t.offerAudience, render: (row) => row.layers.map((layer) => layerName(t, layer)).join('، ') },
    { key: 'seconds', header: t.offerSeconds, num: true, render: (row) => <span>{row.seconds}</span> },
    {
      key: 'active',
      header: t.status,
      fit: true,
      render: (row) => <LiveSwitch checked={row.active} label={row.title} disabled={busy} onChange={(next) => run(() => api.saveOffer(row.id, { active: next }), { note: t.saved })} />,
    },
    {
      key: 'actions',
      header: t.rowActions,
      actions: true,
      // The row's actions in its ⋯ menu, as on every list (owner 2026-11-11).
      render: (row) => {
        const first = offers[0]?.id === row.id;
        const last = offers[offers.length - 1]?.id === row.id;
        return (
          <RowMenu
            label={`${t.rowActions} ${row.title}`}
            items={[
              { label: t.edit, icon: 'edit' as const, onClick: () => edit(row) },
              ...(first ? [] : [{ label: t.moveUp, icon: 'move' as const, onClick: () => void run(() => api.moveOffer(row.id, 'up'), { note: t.saved }) }]),
              ...(last ? [] : [{ label: t.moveDown, icon: 'move' as const, onClick: () => void run(() => api.moveOffer(row.id, 'down'), { note: t.saved }) }]),
              { label: t.deleteAccount, icon: 'trash' as const, danger: true, onClick: () => void run(() => api.removeOffer(row.id), { note: t.saved }) },
            ]}
          />
        );
      },
    },
  ];
  const live = offers.filter((offer) => offer.active);

  if (!allowed) return <Desk title="" lede="" error="" note=""><span /></Desk>;
  return (
    <Desk
      title={t.offersTitle}
      lede={t.offersLede}
      action={<div className="inline-flex flex-wrap items-center gap-2"><Button type="button" onClick={() => edit(null)}><Plus size={16} aria-hidden="true" />{t.newOffer}</Button></div>}
      error={draft ? '' : error || read.error}
      note={note}
    >
      {live.length > 0 ? (
        <section>
          <p className="mx-0 mt-0.5 mb-2 text-sm font-bold text-muted">{t.offerPreview}</p>
          <OfferHero offers={live} />
        </section>
      ) : null}
      <Pane>
        {offers.length === 0 && read.loaded ? <EmptyState>{t.noPromos}</EmptyState> : <DataTable columns={columns} rows={offers} rowKey={(row) => row.id} />}
      </Pane>
      <Dialog
        open={draft !== null}
        size="wide"
        title={draft?.id ? t.editOffer : t.newOffer}
        lede={t.offerFormHint}
        closeLabel={t.closeMenu}
        error={error}
        onClose={() => { if (!busy) setDraft(null); }}
        footer={(
          <>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setDraft(null)}>{t.cancel}</Button>
            <Button type="button" disabled={busy} onClick={() => void save()}>{t.save}</Button>
          </>
        )}
      >
        {draft ? (
          <div className="grid gap-3">
            <Label tone="dialog">
              {t.offerTitle}
              <Input value={draft.title} maxLength={80} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
            </Label>
            <Label tone="dialog">
              {t.offerBody}
              <Textarea
                className="h-8.5 min-h-0 resize py-0 max-touch:h-11"
                rows={3}
                maxLength={240}
                value={draft.body}
                onChange={(event) => setDraft({ ...draft, body: event.target.value })}
              />
            </Label>
            <div className="flex flex-wrap items-start gap-3">
              {draft.image ? <DataImage className={cn(THUMB, THUMB_LARGE)} src={draft.image} alt="" /> : <span className={cn(THUMB, THUMB_LARGE)} aria-hidden="true" />}
              <div className="grid content-start gap-3 *:min-w-0">
                {/* The dialog's field captions (`[data-slot=dialog-body] label`) set its text: a grid, muted, 11px bold, a 4px gap. */}
                <Button asChild variant="secondary" size="sm" className="grid cursor-pointer gap-1 text-start text-xs font-bold text-muted">
                  <label>
                    {t.offerImage}
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => void pickImage(event)} />
                  </label>
                </Button>
                {draft.image ? <Button type="button" variant="secondary" size="sm" onClick={() => setDraft({ ...draft, image: null })}>{t.offerImageRemove}</Button> : null}
                <p>{t.offerImageHint}</p>
              </div>
            </div>
            <div className={PAIR}>
              <Label tone="dialog">
                {t.offerActionLabel}
                <Input value={draft.actionLabel} maxLength={30} onChange={(event) => setDraft({ ...draft, actionLabel: event.target.value })} />
              </Label>
              <Label tone="dialog">
                {t.offerActionHref}
                <Input dir="ltr" value={draft.actionHref} placeholder="/packages" onChange={(event) => setDraft({ ...draft, actionHref: event.target.value })} />
              </Label>
            </div>
            <div className={PAIR}>
              <Label tone="dialog">
                {t.offerSeconds}
                <Input inputMode="numeric" dir="ltr" value={draft.seconds} onChange={(event) => setDraft({ ...draft, seconds: event.target.value })} />
              </Label>
              <Label className={CHECK_ROW}>
                <Checkbox checked={draft.active} onCheckedChange={(next) => setDraft({ ...draft, active: next === true })} />
                <span>{t.offerActive}</span>
              </Label>
            </div>
            <fieldset className="m-0 flex flex-wrap gap-3 border-0 p-0">
              <legend className="mb-1.5 font-bold">{t.offerAudience}</legend>
              {LAYERS.map((layer) => (
                <Label key={layer} className={CHECK_ROW}>
                  <Checkbox
                    checked={draft.layers.includes(layer)}
                    onCheckedChange={(next) => setDraft({ ...draft, layers: next === true ? [...draft.layers, layer] : draft.layers.filter((item) => item !== layer) })}
                  />
                  <span>{layerName(t, layer)}</span>
                </Label>
              ))}
            </fieldset>
            <div className={PAIR}>
              <Label tone="dialog">
                {t.offerStarts}
                <DateField value={draft.startsAt} onChange={(next) => setDraft({ ...draft, startsAt: next })} />
              </Label>
              <Label tone="dialog">
                {t.offerEnds}
                <DateField value={draft.endsAt} onChange={(next) => setDraft({ ...draft, endsAt: next })} />
              </Label>
            </div>
          </div>
        ) : null}
      </Dialog>
    </Desk>
  );
}
