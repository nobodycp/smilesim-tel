'use client';

import { keepPreviousData, useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useConnection } from './connection';
import { usePrefs } from './prefs';
import { ApiFailure } from './query';
import type { Fetched } from './fetched';

export type PageOf<Row, Extra = undefined> = {
  rows: Row[];
  next: string | null | undefined;
  // How many rows match on the server, across every chunk. The pager counts its pages from it.
  total?: number;
  extra?: Extra;
};

/**
 * A list the server pages by cursor, with filters the server applies (ADR 0001: an infinite query).
 *
 * The chunks the server answered with are handed out flattened as `all`, with the server's `total` beside them.
 * `loadMore` reads the next cursor and appends it. Changing the filter `key` asks for the new list and keeps the
 * previous rows on screen until it lands (`stale`), so a table never blanks between filters. `reload` asks again
 * for every chunk already read, in the background, so a write does not send the reader back to page one, and
 * marks the list's other filters out of date. A list
 * read before is shown from the cache at once when its page opens again.
 */
export function usePaged<Row, Extra = undefined>(
  key: string,
  fetchPage: (cursor: string | null) => Promise<Fetched<PageOf<Row, Extra>>>,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const { apiText } = usePrefs();
  // The page's path keeps two screens with the same filter key apart in the cache.
  const pathname = usePathname();
  const latest = useRef(fetchPage);
  useEffect(() => {
    latest.current = fetchPage;
  });

  const query = useInfiniteQuery<PageOf<Row, Extra>, Error, InfiniteData<PageOf<Row, Extra>, string | null>, readonly unknown[], string | null>({
    queryKey: ['paged', pathname, key],
    queryFn: async ({ pageParam }) => {
      const result = await latest.current(pageParam);
      if (!result.ok) throw new ApiFailure(0, result.message, result.code);
      return result.data;
    },
    initialPageParam: null,
    getNextPageParam: (last) => last.next ?? undefined,
    placeholderData: keepPreviousData,
    // A list is always asked again when it opens or its filter comes back: the cached rows show at once and the
    // server's answer replaces them. A list is never trusted from the cache alone.
    staleTime: 0,
    enabled,
  });

  const pages = query.data?.pages;
  const all = useMemo(() => (pages ? pages.flatMap((chunk) => chunk.rows) : []), [pages]);
  const total = pages ? (pages[pages.length - 1].total ?? pages[0].total ?? null) : query.isError ? 0 : null;
  const extra = useMemo(() => {
    const withExtra = pages ? [...pages].reverse().find((chunk) => chunk.extra !== undefined) : undefined;
    return withExtra ? (withExtra.extra as Extra) : null;
  }, [pages]);
  const stale = query.isPlaceholderData;

  const { fetchNextPage, hasNextPage, isFetchingNextPage, refetch } = query;
  // Reads the chunk after the last one. Answers true when a chunk was added. Never for rows of an older filter.
  const loadMore = useCallback(async (): Promise<boolean> => {
    if (stale || !hasNextPage || isFetchingNextPage) return false;
    const before = pages?.length ?? 0;
    const after = await fetchNextPage();
    return (after.data?.pages.length ?? 0) > before;
  }, [stale, hasNextPage, isFetchingNextPage, pages, fetchNextPage]);

  // After a write: every filter of this list is out of date, not only the one on screen. The one on screen is asked
  // again now (all its chunks), the others when they open.
  const client = useQueryClient();
  const reload = useCallback(async () => {
    await client.invalidateQueries({ queryKey: ['paged', pathname] });
  }, [client, pathname]);

  // The API came back: a list that failed while it was away asks again on its own.
  const { generation } = useConnection();
  const seenGeneration = useRef(generation);
  const failed = query.isError;
  useEffect(() => {
    if (generation === seenGeneration.current) return;
    seenGeneration.current = generation;
    if (enabled && failed) void refetch();
  }, [generation, enabled, failed, refetch]);

  // Translated when drawn, so an error on screen follows a change of language.
  const error = query.error instanceof ApiFailure ? apiText(query.error) : query.error ? apiText(query.error.message) : '';

  return {
    key,
    all,
    total,
    ready: query.data !== undefined || query.isError,
    started: query.data !== undefined || query.isError,
    stale,
    hasNext: Boolean(hasNextPage) && !stale,
    more: isFetchingNextPage,
    error,
    extra,
    loadMore,
    reload,
  };
}
