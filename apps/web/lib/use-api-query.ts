'use client';

import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { useConnection } from './connection';
import { usePrefs } from './prefs';
import { ApiFailure } from './query';
import type { Fetched } from './fetched';

/**
 * One read, kept in the query cache under `key` so every screen that asks for it shares one answer (ADR 0001).
 * Same shape as `useLoad`: `data`, a translated `error`, `loaded`, `reload`. The cached answer shows at once when a
 * screen opens and is asked again in the background; `reload` asks again now (a write's `onDone`).
 * `fresh` drops the answer when the last screen using it closes, so the next opening waits for a new one: for
 * an editor that copies the answer into drafts once (branding, line prices), where a cached copy would seed stale drafts.
 */
export function useApiQuery<T>(key: QueryKey, fetcher: () => Promise<Fetched<T>>, { enabled = true, fresh = false }: { enabled?: boolean; fresh?: boolean } = {}) {
  const { apiText } = usePrefs();
  const latest = useRef(fetcher);
  useEffect(() => {
    latest.current = fetcher;
  });
  const query = useQuery<T>({
    queryKey: key,
    queryFn: async () => {
      const result = await latest.current();
      if (!result.ok) throw new ApiFailure(0, result.message, result.code);
      return result.data;
    },
    staleTime: 0,
    ...(fresh ? { gcTime: 0 } : {}),
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
  return { data: query.data ?? null, error, loaded: query.data !== undefined || query.isError, reload };
}
