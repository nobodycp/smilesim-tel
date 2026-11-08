'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConnection } from './connection';
import { usePrefs } from './prefs';
import type { Fetched } from './use-load';

export type PageOf<Row, Extra = undefined> = {
  rows: Row[];
  next: string | null | undefined;
  // How many rows match on the server, across every chunk. The pager counts its pages from it.
  total?: number;
  extra?: Extra;
};

type Chunk<Row> = { rows: Row[]; next: string | null };
type Book<Row> = { key: string; chunks: Chunk<Row>[]; total: number | null };

/**
 * A list the server pages by cursor, with filters the server applies.
 *
 * The chunks the server answered with are kept in a book and handed out flattened as `all`, with the
 * server's `total` beside them. `loadMore` reads the next cursor and appends it. Changing the filter
 * key drops the book and starts again.
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
  const shelf = useRef<Book<Row> | null>(null);
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

  const keep = useCallback((next: Book<Row> | null) => {
    shelf.current = next;
    setBook(next);
  }, []);

  const reload = useCallback(async () => {
    const mine = ++ticket.current;
    const { key: asked, fetchPage: ask } = latest.current;
    const result = await ask(null);
    if (!live.current || mine !== ticket.current) return;
    if (!result.ok) {
      setError(apiText(result));
      keep({ key: asked, chunks: [{ rows: [], next: null }], total: 0 });
      return;
    }
    setError('');
    keep({ key: asked, chunks: [{ rows: result.data.rows, next: result.data.next ?? null }], total: result.data.total ?? null });
    if (result.data.extra !== undefined) setExtra(result.data.extra);
  }, [apiText, keep]);

  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload, key]);

  // The API came back: a list that failed while it was away asks again on its own.
  const { generation } = useConnection();
  const seenGeneration = useRef(0);
  useEffect(() => {
    if (generation === seenGeneration.current) return;
    seenGeneration.current = generation;
    if (enabled && error) void reload();
  }, [generation, enabled, error, reload]);

  const fresh = book?.key === key ? book : null;
  const last = fresh?.chunks[fresh.chunks.length - 1];
  const hasNext = Boolean(last?.next);
  const all = useMemo(() => (fresh ? fresh.chunks.flatMap((chunk) => chunk.rows) : []), [fresh]);

  // Reads the chunk after the last one. Answers true when a chunk was added.
  const loadMore = useCallback(async (): Promise<boolean> => {
    const current = shelf.current;
    if (!current || current.key !== latest.current.key) return false;
    const tail = current.chunks[current.chunks.length - 1];
    if (!tail?.next || asking.current) return false;
    asking.current = true;
    const mine = ticket.current;
    setMore(true);
    const result = await latest.current.fetchPage(tail.next);
    asking.current = false;
    if (!live.current) return false;
    setMore(false);
    if (mine !== ticket.current) return false;
    if (!result.ok) {
      setError(apiText(result));
      return false;
    }
    const now = shelf.current;
    if (!now || now.key !== current.key) return false;
    keep({
      key: now.key,
      chunks: [...now.chunks, { rows: result.data.rows, next: result.data.next ?? null }],
      total: result.data.total ?? now.total,
    });
    return true;
  }, [apiText, keep]);

  return {
    key,
    all,
    total: fresh?.total ?? null,
    ready: fresh !== null,
    started: book !== null,
    hasNext,
    more,
    error,
    extra,
    loadMore,
    reload,
  };
}
