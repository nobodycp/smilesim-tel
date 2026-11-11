'use client';

import { Check, Info, RadioTower, Wallet, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PagedTable, type Column } from '../../../components/data-table';
import { Desk, latinWhen } from '../../../components/desk';
import { FilterBar } from '../../../components/filter-bar';
import { Tabs } from '../../../components/tabs';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { api, type NoticeRow } from '../../../lib/api';
import { noticeAge, noticeDetail, noticeGroup, noticeTitle } from '../../../lib/notice-text';
import { usePrefs } from '../../../lib/prefs';
import { pick } from '../../../lib/fetched';
import { pageRows, usePaged } from '../../../lib/use-paged';

const GROUPS = ['tasks', 'wallet', 'providers'] as const;

export function NoticesScreen() {
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
        (data) => ({ ...pageRows(data), extra: { unread: data.unread } }),
      ),
  );
  const unread = list.extra?.unread ?? 0;

  function groupLabel(code: string): string {
    if (code === 'tasks') return t.noticeGroupTasks;
    if (code === 'providers') return t.noticeGroupProviders;
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

  // One card per notice, as in the design: the group's mark, the title over its detail, the age, a crimson diamond
  // while unread. The table head stays for screen readers only.
  const markOf = (row: NoticeRow) => {
    const group = noticeGroup(row.kind);
    if (row.kind === 'task.done') return Check;
    if (group === 'tasks') return Zap;
    if (group === 'wallet') return Wallet;
    if (group === 'providers') return RadioTower;
    return Info;
  };
  const columns: Column<NoticeRow>[] = [
    {
      key: 'notice',
      header: t.notices,
      cell: 'notice-cell',
      render: (row) => {
        const Mark = markOf(row);
        return (
          <button type="button" className={row.read ? 'notice-card' : 'notice-card unread'} onClick={() => void open(row)}>
            <span className="notice-mark" aria-hidden="true"><Mark size={17} strokeWidth={1.9} /></span>
            <span className="notice-main">
              <strong>{noticeTitle(t, row)}</strong>
              <span className="notice-text">{noticeDetail(t, row) || groupLabel(noticeGroup(row.kind))}</span>
            </span>
            <span className="notice-age" title={latinWhen(row.createdAt)}>{noticeAge(t, row.createdAt)}</span>
            {row.read ? null : <i className="unread-dot" aria-label={t.unreadOnly} />}
          </button>
        );
      },
    },
  ];

  return (
    <Desk
      title={t.notices}
      lede={t.noticesLede}
      error={error}
      note=""
      action={unread > 0 ? <Button type="button" variant="secondary" onClick={() => void markAll()}>{t.markAllRead}</Button> : undefined}
    >
      <div className="report-filters">
        <Tabs
          label={t.notices}
          items={[{ key: 'all', label: t.tasksAllTab }, { key: 'unread', label: t.unreadTab, count: unread }]}
          value={unreadOnly ? 'unread' : 'all'}
          onChange={(next) => setUnreadOnly(next === 'unread')}
        />
        <FilterBar loose onClear={() => setGroup('')} clearLabel={t.clearFilters}>
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
        </FilterBar>
      </div>
      <section className="pane notice-list">
        <PagedTable list={list} columns={columns} rowKey={(row) => row.id} empty={t.noNotices} skeleton={{ rows: 6, columns: 1 }} />
      </section>
    </Desk>
  );
}
