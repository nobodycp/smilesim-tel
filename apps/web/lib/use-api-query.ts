'use client';

import { hashKey, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { useConnection } from './connection';
import { usePrefs } from './prefs';
import { ApiFailure } from './query';
import type { Fetched } from './fetched';
import { noWriteSince, readMark } from './write-mark';

/** How long one answer is shared with a second asker of the same key, when no write was sent since it was asked. */
const SHARE_MS = 5_000;

// The write mark each key's current answer was asked under (lib/write-mark.ts), by the query's hash.
const askedUnder = new Map<string, number>();

/**
 * One read, kept in the query cache under `key` so every screen that asks for it shares one answer (ADR 0001).
 * Same shape as `useLoad`: `data`, a translated `error`, `loaded`, `reload`. The cached answer shows at once when a
 * screen opens and is asked again in the background; `reload` asks again now (a write's `onDone`).
 * `fresh` drops the answer when the last screen using it closes, so the next opening waits for a new one: for
 * an editor that copies the answer into drafts once (branding, line prices), where a cached copy would seed stale drafts.
 * `every` (milliseconds) asks again on that beat while the tab is in view (TanStack Query pauses the beat in a hidden
 * tab); `fetching` is true while an ask is on the way, the first one or a later one.
 * Two askers of one key within 5 s share one request (a sidebar badge and its screen, a double mount), unless a write
 * was on its way or sent since that answer was asked: then the next asker goes to the server, so nothing shown after
 * an action is older than the action (decision 12, speed plan PF.4). `reload`, `every`, the API's return and an
 * invalidation always ask the server.
 */
export function useApiQuery<T>(
  key: QueryKey,
  fetcher: () => Promise<Fetched<T>>,
  { enabled = true, fresh = false, every }: { enabled?: boolean; fresh?: boolean; every?: number } = {},
) {
  const { apiText } = usePrefs();
  const latest = useRef(fetcher);
  useEffect(() => {
    latest.current = fetcher;
  });
  const query = useQuery<T>({
    queryKey: key,
    queryFn: async ({ queryKey }) => {
      const mark = readMark();
      const result = await latest.current();
      if (!result.ok) throw new ApiFailure(0, result.message, result.code);
      askedUnder.set(hashKey(queryKey), mark);
      return result.data;
    },
    staleTime: (cached) => (noWriteSince(askedUnder.get(cached.queryHash)) ? SHARE_MS : 0),
    ...(fresh ? { gcTime: 0 } : {}),
    ...(every ? { refetchInterval: every } : {}),
    enabled,
  });

  const client = useQueryClient();
  // The key is compared by value: callers build it inline.
  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
  });
  const reload = useCallback(async () => {
    await client.invalidateQueries({ queryKey: keyRef.current });
  }, [client]);

  // The API came back: a read that failed while it was away asks again on its own.
  const { generation } = useConnection();
  const seenGeneration = useRef(generation);
  const { isError, refetch } = query;
  useEffect(() => {
    if (generation === seenGeneration.current) return;
    seenGeneration.current = generation;
    if (enabled && isError) void refetch();
  }, [generation, enabled, isError, refetch]);

  const error = query.error instanceof ApiFailure ? apiText(query.error) : query.error ? apiText(query.error.message) : '';
  return { data: query.data ?? null, error, loaded: query.data !== undefined || query.isError, fetching: query.isFetching, reload };
}
