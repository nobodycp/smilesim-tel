'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Desk, Money } from '../../../components/desk';
import { TableSkeleton } from '../../../components/loading';
import { api, type ProviderRow } from '../../../lib/api';
import { useDoor } from '../../../lib/door-context';
import { useOffice } from '../../../lib/office-session';
import { usePrefs } from '../../../lib/prefs';

async function compactImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return '';
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return '';
  const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const image = canvas.toDataURL('image/webp', 0.86);
  return image.length < 200_000 ? image : '';
}

export default function ProviderPackagesPage() {
  const { t, apiText } = usePrefs();
  const params = useParams<{ code: string }>();
  const [provider, setProvider] = useState<ProviderRow | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [loaded, setLoaded] = useState(false);
  const { me } = useOffice();
  const door = useDoor();
  const allowed = door.layer === 'branch' && me?.layer === 'branch';

  const load = useCallback(async () => {
    const result = await api.officeProviders();
    if (!result.ok) {
      setError(apiText(result.message));
      setLoaded(true);
      return;
    }
    setProvider(result.data.providers.find((row) => row.code === params.code) ?? null);
    setLoaded(true);
  }, [apiText, params.code]);

  useEffect(() => {
    if (door.layer !== 'branch' || (me && me.layer !== 'branch')) window.location.replace('/');
  }, [door.layer, me]);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  async function chooseImage(name: string, file: File) {
    const image = await compactImage(file);
    if (!image) {
      setError(apiText('بيانات غير صالحة'));
      return;
    }
    const result = await api.setCompanyImage(name, image);
    if (!result.ok) setError(apiText(result.message));
    else {
      setNote(t.save);
      await load();
    }
  }

  return (
    <Desk title={provider?.name ?? ''} lede="" error={error} note={note}>
      <Link className="back-link" href="/providers">{t.providersTitle}</Link>
      <section className="pane">
        <div className="sheet">
          {!loaded ? <TableSkeleton rows={4} columns={3} /> : provider?.companies.map((company) => (
            <div key={company.name} className="stack">
              <div className="company-head">
                {company.image ? <img className="company-logo" src={company.image} alt="" /> : <span className="company-mark">{company.name.slice(0, 1)}</span>}
                <strong>{company.name}</strong>
                <label className="quiet-file">
                  {t.companyImage}
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void chooseImage(company.name, file);
                  }} />
                </label>
              </div>
              <table className="data">
                <thead>
                  <tr>
                    <th>{t.packageName}</th>
                    <th>{t.status}</th>
                    <th className="num">{t.branchCost}</th>
                  </tr>
                </thead>
                <tbody>
                  {company.packages.map((item) => (
                    <tr key={item.code}>
                      <td><Link className="row-link" href={`/providers/${params.code}/${encodeURIComponent(item.code)}`}>{item.name}</Link></td>
                      <td><span className={item.enabled ? 'badge' : 'badge cancelled'}>{item.enabled ? t.lineActive : t.stopped}</span></td>
                      <td><Money value={item.price} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </section>
    </Desk>
  );
}
