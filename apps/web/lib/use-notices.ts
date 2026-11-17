'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type NoticeRow } from './api';

// Live notices for the shell: one EventSource per tab, a reconnect that backs off from 1s to 30s.
// The list is read once each time the stream opens (the first open and every re-open after a drop, so nothing sent
// while it was down is missed); a slow poll keeps it honest only while the stream is down, and a stream that fails
// before it ever opened reads the list once at once, so the bell is not empty. The read asks for the rows the panel
// shows (speed plan PF.3). The latest arrival is exposed as `fresh` so the shell can show it as a toast.

const PANEL = 10;
const POLL_MS = 60_000;
const TOAST_MS = 4_000;
const STREAM = '/api/v1/notices/stream';

export function useNotices(ready: boolean) {
  const [notices, setNotices] = useState<NoticeRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [fresh, setFresh] = useState<NoticeRow | null>(null);
  const toastTimer = useRef<number | null>(null);

  const pull = useCallback(async () => {
    const result = await api.notices({ limit: PANEL });
    if (!result.ok) return;
    setNotices(result.data.items.slice(0, PANEL));
    setUnread(result.data.unread);
  }, []);

  useEffect(() => {
    if (!ready) return;
    let stopped = false;
    let source: EventSource | null = null;
    let retry = 1_000;
    let retryTimer: number | null = null;
    let poll: number | null = null;
    let everOpened = false;

    const onNotice = (event: MessageEvent<string>) => {
      let row: NoticeRow;
      try {
        row = JSON.parse(event.data) as NoticeRow;
      } catch {
        return;
      }
      setNotices((current) => [row, ...current.filter((item) => item.id !== row.id)].slice(0, PANEL));
      setUnread((count) => count + 1);
      setFresh(row);
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setFresh(null), TOAST_MS);
    };

    const open = () => {
      if (stopped) return;
      source = new EventSource(STREAM, { withCredentials: true });
      source.addEventListener('notice', onNotice as EventListener);
      source.onopen = () => {
        retry = 1_000;
        everOpened = true;
        if (poll !== null) window.clearInterval(poll);
        poll = null;
        void pull();
      };
      source.onerror = () => {
        source?.close();
        source = null;
        if (stopped) return;
        if (poll === null) {
          if (!everOpened) void pull();
          poll = window.setInterval(() => void pull(), POLL_MS);
        }
        retryTimer = window.setTimeout(open, retry);
        retry = Math.min(retry * 2, 30_000);
      };
    };

    open();
    return () => {
      stopped = true;
      source?.close();
      if (retryTimer) window.clearTimeout(retryTimer);
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      if (poll !== null) window.clearInterval(poll);
    };
  }, [ready, pull]);

  const markRead = useCallback(async (id?: string) => {
    const result = await api.readNotices(id);
    if (!result.ok) return;
    if (id) {
      setNotices((current) => current.map((row) => (row.id === id && !row.read ? { ...row, read: true } : row)));
      setUnread((count) => Math.max(0, count - 1));
    } else {
      setNotices((current) => current.map((row) => (row.read ? row : { ...row, read: true })));
      setUnread(0);
    }
  }, []);

  const dismiss = useCallback(() => setFresh(null), []);

  return { notices, unread, fresh, markRead, dismiss, refresh: pull };
}