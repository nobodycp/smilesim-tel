// Smoke requests against the new API running on a restored copy (rehearse-upgrade.sh). Prints what passed; exits
// non-zero on the first thing that did not. Never prints a cookie, a password or an eSIM code.
import { readFileSync } from 'node:fs';

const base = process.env.REHEARSAL_BASE;
const origin = 'https://rehearsal.invalid';
const fail = (what) => { console.error(`rehearsal-smoke: FAILED: ${what}`); process.exit(1); };
const ok = (what) => console.error(`rehearsal-smoke: ${what}`);

async function call(method, path, { cookie, body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { origin, ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await response.json(); } catch { /* no body */ }
  const set = response.headers.getSetCookie?.() ?? [];
  const sid = set.map((line) => line.split(';')[0]).find((pair) => pair.startsWith('sid='));
  return { status: response.status, data, sid };
}

const health = await call('GET', '/health');
if (health.status !== 200 || health.data?.ok !== true) fail('GET /health');
if ((await call('GET', '/office/me')).status !== 401) fail('a request with no session is not refused with 401');
ok('health answers, and a request with no session is refused');

// A cookie issued by the version deployed before (the session row's id). The rehearsal puts the live-session key
// in Redis under the name that version used, as production's Redis holds it. What happens is reported, not
// judged here: the plan states which outcome is expected.
if (process.env.REHEARSAL_OLD_COOKIE) {
  const me = await call('GET', '/office/me', { cookie: `sid=${process.env.REHEARSAL_OLD_COOKIE}` });
  if (me.status === 200) ok('OLD-SESSION: a session opened before the upgrade is still signed in');
  else if (me.status === 401) ok('OLD-SESSION: a session opened before the upgrade is signed out by it (401) and must sign in again');
  else fail(`a session opened before the upgrade answers ${me.status}`);
} else ok('SKIPPED: no live session on the copy to try an old cookie with');

const login = process.env.REHEARSAL_LOGIN;
const passwordFile = process.env.REHEARSAL_PASSWORD_FILE;
if (!login || !passwordFile) {
  ok('SKIPPED: the signed-in checks (no REHEARSAL_LOGIN / REHEARSAL_PASSWORD_FILE)');
  process.exit(0);
}
const password = readFileSync(passwordFile, 'utf8').trim();
if ((await call('POST', '/auth/login', { body: { loginName: login, password: `${password}-wrong` } })).status !== 401) fail('a wrong password is not refused');
const signIn = await call('POST', '/auth/login', { body: { loginName: login, password } });
if (signIn.status !== 200 || !signIn.sid) fail('signing in with the account of the copy');
if (signIn.data?.next && signIn.data.next !== 'app') { ok(`signed in; the next step is ${signIn.data.next}, so the office checks are skipped`); process.exit(0); }
const cookie = signIn.sid;
// The new cookie is a token: it is not the row id an old cookie was.
if (/^sid=sess-/.test(cookie)) fail('the new session cookie is still a row id');
ok('signing in works, and a wrong password is refused');

const lines = await call('GET', '/office/lines', { cookie });
if (lines.status !== 200 || !Array.isArray(lines.data?.items) || typeof lines.data.total !== 'number' || !('nextCursor' in lines.data)) fail('GET /office/lines does not answer { items, nextCursor, total }');
ok(`the numbers list answers its envelope (${lines.data.total} lines for this account)`);
const esims = await call('GET', '/office/lines?sim=esim', { cookie });
if (esims.status !== 200 || esims.data.items.some((row) => !row.esim)) fail('the SIM / eSIM filter');
const withCode = esims.data.items.find((row) => typeof row.esimQr === 'string');
if (withCode) {
  const detail = await call('GET', `/office/lines/${withCode.id}`, { cookie });
  if (detail.status !== 200 || typeof detail.data?.line?.esimQr !== 'string' || !detail.data.line.esimQr.startsWith('data:image/')) fail('an eSIM code stored before the upgrade is not read from the line detail');
  ok('an eSIM code stored before the upgrade is read from the line detail');
} else ok('SKIPPED: this account has no eSIM with a code');
if (process.env.REHEARSAL_OTHER_LINE) {
  const other = await call('GET', `/office/lines/${process.env.REHEARSAL_OTHER_LINE}`, { cookie });
  if (other.status !== 404) fail('a line outside the account\'s tree is not answered 404');
  ok('a line outside the account\'s tree answers 404');
}
const packages = await call('GET', '/office/packages', { cookie });
if (packages.status !== 200 || !Array.isArray(packages.data?.packages)) fail('GET /office/packages');
ok(`packages answer under their new codes (${packages.data.packages.length})`);
const tasks = await call('GET', '/office/tasks', { cookie });
if (tasks.status !== 200 || !Array.isArray(tasks.data?.items)) fail('GET /office/tasks');
const notices = await call('GET', '/office/notices', { cookie });
if (notices.status !== 200) fail('GET /office/notices');
ok('tasks and notices answer');
const out = await call('POST', '/auth/logout', { cookie });
if (out.status >= 500) fail('signing out');
