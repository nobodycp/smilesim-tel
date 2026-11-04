'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePrefs } from './prefs';
import type { Fetched } from './use-load';

export type PageOf<Row, Extra = undefined> = { rows: Row[]; next: string | null | undefined; extra?: Extra };

type Chunk<Row> = { rows: Row[]; next: string | null };
type Book<Row> = { key: string; chunks: Chunk<Row>[]; index: number };

/**
 * A list the server pages by cursor, with filters the server applies.
 *
 * Each cursor answer is its own page. `goTo` shows a page already read, or reads the next cursor
 * when the asked page is the one after the last. Changing the filter key drops the book.
 */
export function usePaged<Row, Extra = undefined>(
  key: string,
  fetchPage: (cursor: string | null) => Promise<Fetched<PageOf<Row, Extra>>>,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const { apiText } = usePrefs();
  const [book, setBook] = useState<Book<Row> | null>(null);
  const [extra, setExtra] = useState<Extra | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef({ key, fetchPage });
  const live = useRef(true);
  const ticket = useRef(0);
  const asking = useRef(false);

  useEffect(() => {
    latest.current = { key, fetchPage };
  });

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    const mine = ++ticket.current;
    const { key: asked, fetchPage: ask } = latest.current;
    const result = await ask(null);
    if (!live.current || mine !== ticket.current) return;
    if (!result.ok) {
      setError(apiText(result.message));
      setBook({ key: asked, chunks: [{ rows: [], next: null }], index: 0 });
      return;
    }
    setError('');
    setBook({ key: asked, chunks: [{ rows: result.data.rows, next: result.data.next ?? null }], index: 0 });
    if (result.data.extra !== undefined) setExtra(result.data.extra);
  }, [apiText]);

  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload, key]);

  const fresh = book?.key === key ? book : null;
  const chunk = fresh ? fresh.chunks[fresh.index] : undefined;
  const last = fresh?.chunks[fresh.chunks.length - 1];
  const hasNext = fresh ? fresh.index < fresh.chunks.length - 1 || Boolean(last?.next) : false;

  const goTo = useCallback(async (pageNumber: number) => {
    const current = book?.key === key ? book : null;
    if (!current) return;
    const index = pageNumber - 1;
    if (index < 0) return;
    if (index < current.chunks.length) {
      setBook({ ...current, index });
      return;
    }
    const tail = current.chunks[current.chunks.length - 1];
    if (index !== current.chunks.length || !tail?.next || asking.current) return;
    asking.current = true;
    const mine = ticket.current;
    setMore(true);
    const result = await latest.current.fetchPage(tail.next);
    asking.current = false;
    if (!live.current) return;
    setMore(false);
    if (mine !== ticket.current) return;
    if (!result.ok) {
      setError(apiText(result.message));
      return;
    }
    const next = result.data.next ?? null;
    setBook((now) => (
      now && now.key === current.key
        ? { key: now.key, chunks: [...now.chunks, { rows: result.data.rows, next }], index: now.chunks.length }
        : now
    ));
  }, [apiText, book, key]);

  return {
    rows: chunk?.rows ?? [],
    ready: fresh !== null,
    started: book !== null,
    page: (fresh?.index ?? 0) + 1,
    pageCount: fresh?.chunks.length ?? 0,
    hasNext,
    more,
    error,
    extra,
    goTo,
    reload,
  };
}
