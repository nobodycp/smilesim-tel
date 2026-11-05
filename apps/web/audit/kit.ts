import { expect, type Page } from '@playwright/test';
import pg from 'pg';

export const WEB_PORT = 3930;
export const DOORS = {
  admin: `http://admin.localhost:${WEB_PORT}`,
  pos: `http://pos.localhost:${WEB_PORT}`,
} as const;
export type Door = keyof typeof DOORS;

export const PASSWORD = '123456';
export const NOTE_DEBITED = 'تم التنفيذ وخصم الرصيد.';
export const NOTE_DONE = 'تم التنفيذ.';
export const NOTE_TASK = 'أُرسلت مهمة للفرع. لم يُخصم شيء.';

const database = 'postgresql://smilesim:smilesim@127.0.0.1:5432/smilesim_audit';
let pool: pg.Pool | null = null;

export async function sql<T extends Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  pool ??= new pg.Pool({ connectionString: database, max: 2 });
  const result = await pool.query(text, values);
  return result.rows as T[];
}

export async function closeDb() {
  await pool?.end();
  pool = null;
}

export async function balance(loginName: string): Promise<number> {
  const rows = await sql<{ balance: number }>(
    `SELECT w.balance FROM "Wallet" w JOIN "User" u ON u.id = w."userId" WHERE u."loginName" = $1`,
    [loginName],
  );
  if (!rows[0]) throw new Error(`no wallet for ${loginName}`);
  return Number(rows[0].balance);
}

/** Signs in through the login screen of that door and waits for the home page. */
export async function login(page: Page, door: Door, loginName: string, password = PASSWORD) {
  await page.goto(`${DOORS[door]}/login`);
  await page.getByLabel('اسم الدخول').fill(loginName);
  await page.getByLabel('كلمة السر').fill(password);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

/** Calls the API as the signed-in user of that door. Only for fixtures, never for the operation under test. */
export async function apiCall<T = unknown>(page: Page, door: Door, method: string, path: string, data?: unknown): Promise<T> {
  const response = await page.request.fetch(`${DOORS[door]}/api${path}`, {
    method,
    headers: { 'x-door': new URL(DOORS[door]).host, 'content-type': 'application/json' },
    data: data === undefined ? undefined : JSON.stringify(data),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok()) throw new Error(`${method} ${path} → ${response.status()} ${JSON.stringify(body)}`);
  return body as T;
}

/** The page note after an action: waits for it and returns its text. */
export async function noteText(page: Page): Promise<string> {
  const note = page.getByRole('status').filter({ hasText: /\S/ }).first();
  await expect(note).toBeVisible();
  return (await note.innerText()).trim();
}

/** The first message an action leaves: the note, or the error when the action was refused. */
export async function outcomeText(page: Page): Promise<string> {
  const message = page.locator('[role="status"], [role="alert"]').filter({ hasText: /\S/ }).first();
  await expect(message).toBeVisible({ timeout: 15_000 });
  return (await message.innerText()).trim();
}

export async function lineByMsisdn(msisdn: string) {
  const rows = await sql<{ id: string; status: string; iccid: string | null; posId: string; packageId: string; endsAt: Date }>(
    `SELECT id, status, iccid, "posId", "packageId", "endsAt" FROM "Line" WHERE msisdn = $1`,
    [msisdn],
  );
  return rows[0] ?? null;
}

export async function entriesFor(lineId: string, kind?: string) {
  return sql<{ id: string; kind: string; amount: number; providerCost: number | null; userId: string }>(
    `SELECT id, kind, amount, "providerCost", "userId" FROM "WalletEntry" WHERE "lineId" = $1 ${kind ? 'AND kind = $2' : ''} ORDER BY "createdAt"`,
    kind ? [lineId, kind] : [lineId],
  );
}
