import { expect, test } from '@playwright/test';
import { api, type TransferPreview } from '../lib/api';

// The transfer calls reach the user through a dialog that is built separately, so these read the
// request each call makes, with `fetch` replaced. Pure logic: no browser page.
type Sent = { path: string; method: string; body: unknown };

async function sentBy<T>(reply: unknown, call: () => Promise<T>): Promise<{ sent: Sent[]; result: T }> {
  const original = globalThis.fetch;
  const sent: Sent[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    sent.push({
      path: `${url.pathname}${url.search}`,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    return { sent, result: await call() };
  } finally {
    globalThis.fetch = original;
  }
}

test('transferAccount posts every choice to the transfer route of the account', async () => {
  const choices = {
    parentLoginName: 'ma2',
    ownPrices: 'keep',
    ownStops: 'reset',
    childPrices: 'reset',
    childStops: 'keep',
    linePrices: 'recapture',
  } as const;
  const { sent, result } = await sentBy({ ok: true, lines: 37 }, () => api.transferAccount('ag1', choices));
  expect(sent).toEqual([{ path: '/office/users/ag1/transfer', method: 'POST', body: choices }]);
  expect(result).toEqual({ ok: true, status: 200, data: { ok: true, lines: 37 } });
});

test('transferAccount sends no child choice for a point of sale', async () => {
  const choices = { parentLoginName: 'ag2', ownPrices: 'keep', ownStops: 'keep', linePrices: 'keep' } as const;
  const { sent } = await sentBy({ ok: true, lines: 0 }, () => api.transferAccount('pos1', choices));
  expect(sent).toEqual([{ path: '/office/users/pos1/transfer', method: 'POST', body: choices }]);
});

test('transferPreview asks about the new parent in the query', async () => {
  const preview: TransferPreview = {
    balance: 120000,
    subtreeBalance: 340000,
    own: { customPrices: 2, hidden: 1, stops: 0, belowNewFloor: 1 },
    child: { customPrices: 4, hidden: 0, stops: 3, sellPrices: 2 },
    lines: 5,
  };
  const { sent, result } = await sentBy(preview, () => api.transferPreview('ag1', 'ma2'));
  expect(sent).toEqual([{ path: '/office/users/ag1/transfer-preview?parentLoginName=ma2', method: 'GET' }]);
  expect(result).toEqual({ ok: true, status: 200, data: preview });
});

test('transferLine posts the point of sale and the price choice', async () => {
  const { sent, result } = await sentBy({ ok: true }, () => api.transferLine('ln1', 'pos2', 'recapture'));
  expect(sent).toEqual([
    { path: '/office/lines/ln1/transfer', method: 'POST', body: { posLoginName: 'pos2', linePrices: 'recapture' } },
  ]);
  expect(result).toEqual({ ok: true, status: 200, data: { ok: true } });
});
