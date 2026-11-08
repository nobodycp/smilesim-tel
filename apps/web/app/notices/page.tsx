'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PagedTable, type Column } from '../../components/data-table';
import { Desk, latinWhen } from '../../components/desk';
import { FilterBar } from '../../components/filter-bar';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { api, type NoticeRow } from '../../lib/api';
import { noticeDetail, noticeGroup, noticeTitle } from '../../lib/notice-text';
import { usePrefs } from '../../lib/prefs';
import { pick } from '../../lib/use-load';
import { usePaged } from '../../lib/use-paged';

const GROUPS = ['tasks', 'wallet', 'announcements'] as const;

export default function NoticesPage() {
  const { t, apiText } = usePrefs();
  const router = useRouter();
  const [group, setGroup] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState('');
  const list = usePaged<NoticeRow, { unread: number }>(
    `${group}|${unreadOnly ? 1 : 0}`,
    async (cursor) =>
      pick(
        await api.officeNotices({ cursor, group: group || undefined, unread: unreadOnly }),
        (data) => ({ rows: data.notices, next: data.nextCursor, total: data.total, extra: { unread: data.unread } }),
      ),
  );
  const unread = list.extra?.unread ?? 0;

  function groupLabel(code: string): string {
    if (code === 'tasks') return t.noticeGroupTasks;
    if (code === 'wallet') return t.noticeGroupWallet;
    return t.noticeGroupAnnouncements;
  }

  async function open(row: NoticeRow) {
    if (!row.read) {
      const result = await api.readNotices(row.id);
      if (!result.ok) {
        setError(apiText(result));
        return;
      }
    }
    router.push(row.href);
  }

  async function markAll() {
    const result = await api.readNotices();
    if (!result.ok) {
      setError(apiText(result));
      return;
    }
    await list.reload();
  }

  const columns: Column<NoticeRow>[] = [
    {
      key: 'when',
      header: t.when,
      cell: 'when',
      fit: true,
      render: (row) => <bdi dir="ltr">{latinWhen(row.createdAt)}</bdi>,
    },
    {
      key: 'group',
      header: t.noticeGroup,
      fit: true,
      render: (row) => <Badge variant={row.read ? 'muted' : 'warning'} dot={!row.read}>{groupLabel(noticeGroup(row.kind))}</Badge>,
    },
    {
      key: 'title',
      header: t.notices,
      render: (row) => (
        <button type="button" className="link-btn" onClick={() => void open(row)}>
          {row.read ? noticeTitle(t, row) : <strong>{noticeTitle(t, row)}</strong>}
        </button>
      ),
    },
    { key: 'detail', header: t.note, render: (row) => noticeDetail(t, row) || '—' },
  ];

  return (
    <Desk
      title={t.notices}
      lede=""
      error={error}
      note=""
      action={unread > 0 ? <Button type="button" variant="secondary" size="sm" onClick={() => void markAll()}>{t.markAllRead}</Button> : undefined}
    >
      <FilterBar
        onClear={() => {
          setGroup('');
          setUnreadOnly(false);
        }}
        clearLabel={t.clearFilters}
      >
        <label>
          {t.noticeGroup}
          <Select value={group} onChange={(event) => setGroup(event.target.value)}>
            <option value="">{t.allRows}</option>
            {GROUPS.map((code) => (
              <option key={code} value={code}>
                {groupLabel(code)}
              </option>
            ))}
          </Select>
        </label>
        <label className="check">
          <input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} />
          {t.unreadOnly}
        </label>
      </FilterBar>
      <section className="pane">
        <PagedTable list={list} columns={columns} rowKey={(row) => row.id} empty={t.noNotices} skeleton={{ rows: 6, columns: 4 }} />
      </section>
    </Desk>
  );
}
