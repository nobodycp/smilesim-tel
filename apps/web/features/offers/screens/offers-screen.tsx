'use client';

import { DateField } from '../../../components/date-field';
import { Plus } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { DataTable, type Column } from '../../../components/data-table';
import { DataImage } from '../../../components/data-image';
import { Desk, layerName } from '../../../components/desk';
import { Dialog } from '../../../components/dialog';
import { EmptyState } from '../../../components/empty-state';
import { LiveSwitch } from '../../../components/live-switch';
import { OfferHero } from '../../../components/offer-hero';
import { Button, buttonClass } from '../../../components/ui/button';
import { RowMenu } from '../../../components/row-menu';
import { api, type Offer, type OfferInput } from '../../../lib/api';
import { usePrefs } from '../../../lib/prefs';
import { sharedKeys } from '../../../lib/query';
import { useAction } from '../../../lib/use-action';
import { useApiQuery } from '../../../lib/use-api-query';
import { useRequireLayer } from '../../../lib/use-require-layer';

const LAYERS = ['branch', 'main_agent', 'agent', 'pos'] as const;
/** About 700 KB of picture; the API refuses more. */
const IMAGE_BYTES = 700 * 1024;

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

  function pickImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !draft) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { setError(t.offerImageType); return; }
    if (file.size > IMAGE_BYTES) { setError(apiText({ message: '', code: 'IMAGE_TOO_LARGE' })); return; }
    const reader = new FileReader();
    reader.onload = () => setDraft((current) => (current ? { ...current, image: String(reader.result) } : current));
    reader.readAsDataURL(file);
  }

  async function save() {
    if (!draft) return;
    const seconds = Number(draft.seconds);
    if (!draft.title.trim() || !Number.isInteger(seconds) || seconds < 3 || seconds > 60 || draft.layers.length === 0) {
      setError(apiText('بيانات غير صالحة'));
      return;
    }
    const body: OfferInput = {
      title: draft.title.trim(), body: draft.body.trim(), image: draft.image, actionLabel: draft.actionLabel.trim() || null, actionHref: draft.actionHref.trim() || null,
      seconds, layers: draft.layers, startsAt: draft.startsAt || null, endsAt: draft.endsAt ? `${draft.endsAt}T23:59:59.999Z` : null, active: draft.active,
    };
    await run(() => (draft.id ? api.saveOffer(draft.id, body) : api.addOffer(body)), { note: t.saved, then: () => setDraft(null) });
  }

  const columns: Column<Offer>[] = [
    { key: 'image', header: '', fit: true, render: (row) => (row.image ? <DataImage className="offer-thumb" src={row.image} alt="" /> : <span className="offer-thumb" aria-hidden="true" />) },
    { key: 'title', header: t.offerTitle, render: (row) => <strong>{row.title}</strong> },
    { key: 'layers', header: t.offerAudience, render: (row) => row.layers.map((layer) => layerName(t, layer)).join('، ') },
    { key: 'seconds', header: t.offerSeconds, num: true, render: (row) => <span className="num">{row.seconds}</span> },
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
      action={<div className="page-actions"><Button type="button" onClick={() => edit(null)}><Plus size={16} aria-hidden="true" />{t.newOffer}</Button></div>}
      error={draft ? '' : error || read.error}
      note={note}
    >
      {live.length > 0 ? (
        <section>
          <p className="section-label">{t.offerPreview}</p>
          <OfferHero offers={live} />
        </section>
      ) : null}
      <section className="pane">
        {offers.length === 0 && read.loaded ? <EmptyState>{t.noPromos}</EmptyState> : <DataTable columns={columns} rows={offers} rowKey={(row) => row.id} />}
      </section>
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
          <div className="dialog-form offer-form">
            <label>
              {t.offerTitle}
              <input value={draft.title} maxLength={80} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
            </label>
            <label>
              {t.offerBody}
              <textarea rows={3} maxLength={240} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
            </label>
            <div className="offer-image-field">
              {draft.image ? <DataImage className="offer-thumb large" src={draft.image} alt="" /> : <span className="offer-thumb large" aria-hidden="true" />}
              <div className="stack">
                <label className={`${buttonClass({ variant: 'outline', size: 'sm' })} offer-file`}>
                  {t.offerImage}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={pickImage} />
                </label>
                {draft.image ? <Button type="button" variant="outline" size="sm" onClick={() => setDraft({ ...draft, image: null })}>{t.offerImageRemove}</Button> : null}
                <p className="hint">{t.offerImageHint}</p>
              </div>
            </div>
            <div className="pair">
              <label>
                {t.offerActionLabel}
                <input value={draft.actionLabel} maxLength={30} onChange={(event) => setDraft({ ...draft, actionLabel: event.target.value })} />
              </label>
              <label>
                {t.offerActionHref}
                <input dir="ltr" value={draft.actionHref} placeholder="/packages" onChange={(event) => setDraft({ ...draft, actionHref: event.target.value })} />
              </label>
            </div>
            <div className="pair">
              <label>
                {t.offerSeconds}
                <input className="num" inputMode="numeric" dir="ltr" value={draft.seconds} onChange={(event) => setDraft({ ...draft, seconds: event.target.value })} />
              </label>
              <label className="check">
                <input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />
                <span>{t.offerActive}</span>
              </label>
            </div>
            <fieldset className="offer-layers">
              <legend>{t.offerAudience}</legend>
              {LAYERS.map((layer) => (
                <label key={layer} className="check">
                  <input
                    type="checkbox"
                    checked={draft.layers.includes(layer)}
                    onChange={(event) => setDraft({ ...draft, layers: event.target.checked ? [...draft.layers, layer] : draft.layers.filter((item) => item !== layer) })}
                  />
                  <span>{layerName(t, layer)}</span>
                </label>
              ))}
            </fieldset>
            <div className="pair">
              <label>
                {t.offerStarts}
                <DateField value={draft.startsAt} onChange={(next) => setDraft({ ...draft, startsAt: next })} />
              </label>
              <label>
                {t.offerEnds}
                <DateField value={draft.endsAt} onChange={(next) => setDraft({ ...draft, endsAt: next })} />
              </label>
            </div>
          </div>
        ) : null}
      </Dialog>
    </Desk>
  );
}
