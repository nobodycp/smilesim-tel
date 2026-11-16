'use client';

import { Check, Info, RadioTower, Wallet, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PagedTable, type Column } from '../../../components/data-table';
import { Desk, Pane, latinWhen } from '../../../components/desk';
import { FilterBar } from '../../../components/filter-bar';
import { Tabs } from '../../../components/tabs';
import { Button } from '../../../components/ui/button';
import { Select, SelectItem } from '../../../components/ui/select';
import { api, type NoticeRow } from '../../../lib/api';
import { cn } from '../../../lib/cn';
import { noticeAge, noticeDetail, noticeGroup, noticeTitle } from '../../../lib/notice-text';
import { usePrefs } from '../../../lib/prefs';
import { pick } from '../../../lib/fetched';
import { pageRows, usePaged } from '../../../lib/use-paged';
import { ReportFilters } from '../../reports/report-kit';

const GROUPS = ['tasks', 'wallet', 'providers'] as const;

/*
 * The notices as card rows (Tailwind migration T4.10), ported from graphite.css's notice rules:
 * - the list's pane hides its table head from the eye (readers keep it): out of the flow, 1px, clipped, one line;
 * - a card: one row 14px apart, the cell's whole width, 12px / 18px padding, no border, no fill, the text's own colour
 *   and type, at the reading start; `--rd-surface-2` under the pointer. Unread: `--rd-accent-soft`, and under the
 *   pointer that soft fill mixed 70% into `--rd-surface-2` (graphite's `color-mix`, drawn as the two fills stacked:
 *   `--rd-surface-2` at 30% under `--rd-accent-soft` at 70%: the same colour to well under one RGB step);
 * - the group's mark: a 36px tile, 6px corners, `--rd-accent` on `--rd-accent-soft`, never shrinking;
 * - the title over its detail (12.5px muted) 2px apart, taking the room left. The title is 700 read or unread: graphite's
 *   600 for a read one lost to desk/table.css `[data-slot='table'] td strong` (700, more specific), so 700 is the look;
 * - the age: 11.5px muted on one line; the unread diamond: an 8px square turned 45deg, 1px corners, `--rd-accent`
 *   glowing 8px in it.
 */
const LIST_HEAD_HIDDEN =
  '[&_[data-slot=table]_thead]:absolute [&_[data-slot=table]_thead]:size-px [&_[data-slot=table]_thead]:overflow-hidden [&_[data-slot=table]_thead]:[clip:rect(0_0_0_0)] [&_[data-slot=table]_thead]:whitespace-nowrap';
const CARD = 'flex w-full cursor-pointer items-center gap-3.5 border-0 bg-transparent px-4.5 py-3 text-start text-inherit [font:inherit] hover:bg-surface-2';
const CARD_UNREAD =
  'bg-accent-soft hover:bg-surface-2/30 hover:bg-linear-to-b hover:from-accent-soft/70 hover:to-accent-soft/70';

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
        await api.notices({ cursor, group: group || undefined, unread: unreadOnly }),
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
      kind: 'block',
      cell: 'w-full',
      render: (row) => {
        const Mark = markOf(row);
        return (
          <button type="button" className={cn(CARD, !row.read && CARD_UNREAD)} data-slot="notice-card" onClick={() => void open(row)}>
            <span className="grid size-9 flex-none place-items-center rounded-sm bg-accent-soft text-accent" aria-hidden="true"><Mark size={17} strokeWidth={1.9} /></span>
            <span className="grid min-w-0 flex-1 gap-0.5">
              <strong className="font-bold">{noticeTitle(t, row)}</strong>
              <span className="text-chip text-muted">{noticeDetail(t, row) || groupLabel(noticeGroup(row.kind))}</span>
            </span>
            <span className="flex-none text-caption whitespace-nowrap text-muted" title={latinWhen(row.createdAt)}>{noticeAge(t, row.createdAt)}</span>
            {row.read ? null : <i className="size-2 flex-none rotate-45 rounded-4xs bg-accent text-accent shadow-glow" aria-label={t.unreadOnly} />}
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
      <ReportFilters>
        <Tabs
          label={t.notices}
          items={[{ key: 'all', label: t.tasksAllTab }, { key: 'unread', label: t.unreadTab, count: unread }]}
          value={unreadOnly ? 'unread' : 'all'}
          onChange={(next) => setUnreadOnly(next === 'unread')}
        />
        <FilterBar loose onClear={() => setGroup('')} clearLabel={t.clearFilters}>
          <label>
            {t.noticeGroup}
            <Select value={group} onValueChange={setGroup}>
              <SelectItem value="">{t.allRows}</SelectItem>
              {GROUPS.map((code) => (
                <SelectItem key={code} value={code}>
                  {groupLabel(code)}
                </SelectItem>
              ))}
            </Select>
          </label>
        </FilterBar>
      </ReportFilters>
      <Pane className={LIST_HEAD_HIDDEN}>
        <PagedTable list={list} columns={columns} rowKey={(row) => row.id} empty={t.noNotices} skeleton={{ rows: 6, columns: 1 }} cards={false} striped={false} />
      </Pane>
    </Desk>
  );
}
