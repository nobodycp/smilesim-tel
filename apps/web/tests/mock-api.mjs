// Test double for the backend: answers every login with 401 and the Arabic message,
// serves the account profile, and plays the voluntary authenticator enrollment used by the settings page.
import { createServer } from 'node:http';

const port = Number(process.env.MOCK_API_PORT ?? 3911);
const origin = process.env.MOCK_WEB_ORIGIN ?? 'http://localhost:3910';
const linesLog = [];

const mockLine = (n, status) => ({
  id: `ln${n}`,
  msisdn: `055${String(n).padStart(7, '0')}`,
  iccid: null,
  esim: false,
  status,
  packageCode: 'cell-400',
  packageName: '400 جيجا',
  companyName: 'سلكوم',
  posLoginName: 'pos',
  posPrice: 26,
  createdAt: '2026-10-01T00:00:00.000Z',
  endsAt: '2026-11-12T00:00:00.000Z',
});

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  req.resume();
  req.on('end', () => {
    const json = { 'content-type': 'application/json; charset=utf-8' };
    const route = `${req.method} ${req.url}`;
    if (route === 'GET /auth/profile') {
      res.writeHead(200, json).end(JSON.stringify({ loginName: 'pos', nickname: 'الكاشير', email: 'pos@example.com', city: 'ramallah', address: 'شارع الإرسال' }));
      return;
    }
    if (route === 'GET /auth/sessions') {
      res.writeHead(200, json).end(
        JSON.stringify({
          sessions: [
            {
              id: 's1',
              userAgent: 'اختبار',
              ip: '127.0.0.1',
              createdAt: '2026-10-28T00:00:00.000Z',
              lastSeenAt: '2026-10-28T00:00:00.000Z',
              current: true,
            },
          ],
        }),
      );
      return;
    }
    if (req.method === 'DELETE' && (req.url ?? '').startsWith('/auth/sessions/')) {
      res.writeHead(200, json).end(JSON.stringify({ ok: true }));
      return;
    }
    if (route === 'GET /auth/sign-in-methods') {
      res.writeHead(200, json).end(JSON.stringify({ twoFactorEnabled: false, twoFactorMethod: 'app', canDisable: false, phone: null, email: 'p•••@example.com', passkeys: [] }));
      return;
    }
    if (route === 'POST /auth/two-factor/setup') {
      res.writeHead(200, json).end(JSON.stringify({ otpauth: 'otpauth://totp/Smilesim:pos?secret=MOCKSECRET' }));
      return;
    }
    if (route === 'POST /auth/two-factor/confirm') {
      res.writeHead(200, json).end(JSON.stringify({ next: 'app' }));
      return;
    }
    // The paged numbers list. Only a browser carrying the `mock-branch` cookie gets a branch session,
    // so the tests that expect the unsigned mock are untouched. The first page has 31 rows and a cursor,
    // the page after it has 5, and a status filter answers with 3 rows. Every request is logged for the test.
    const url = new URL(req.url ?? '/', 'http://mock');
    if (url.pathname === '/__lines/log') {
      res.writeHead(200, json).end(JSON.stringify(linesLog));
      return;
    }
    if (url.pathname === '/__lines/reset') {
      linesLog.length = 0;
      res.writeHead(200, json).end(JSON.stringify({ ok: true }));
      return;
    }
    if ((req.headers.cookie ?? '').includes('mock-branch=1') && req.method === 'GET') {
      if (url.pathname === '/office/me') {
        res.writeHead(200, json).end(
          JSON.stringify({
            loginName: 'admin',
            nickname: 'الإدارة',
            layer: 'branch',
            isBranchOwner: true,
            grants: ['edit', 'reports', 'staff'],
            stops: [],
            impersonating: false,
            balance: 1000,
            ceiling: 0,
          }),
        );
        return;
      }
      if (url.pathname === '/office/directory') {
        res.writeHead(200, json).end(JSON.stringify({
          items: [
            { loginName: 'admin', nickname: 'الإدارة', layer: 'branch', parentLoginName: null, frozen: false, mine: true },
            { loginName: 'pos', nickname: 'الكاشير', layer: 'pos', parentLoginName: 'admin', frozen: false, mine: true },
          ],
          nextCursor: null,
          total: 2,
        }));
        return;
      }
      if (url.pathname === '/office/packages') {
        res.writeHead(200, json).end(
          JSON.stringify({
            packages: [
              {
                code: 'cell-400', name: '400 جيجا', providerName: 'سلكوم', sellable: true, activateInput: 'generated', companyName: 'سلكوم', dataGb: 400, months: 1,
                sim: { length: null, prefix: '', esim: true },
                branchCost: 20, mainPrice: 22, agentPrice: 24, posPrice: 26, subscriberPrice: 30, editableField: null,
                autoActivate: true, autoCharge: true, autoDisconnect: false, autoFreeze: false, autoSwitch: false,
              },
            ],
            companies: [],
          }),
        );
        return;
      }
      if (url.pathname === '/office/lines') {
        linesLog.push(Object.fromEntries(url.searchParams));
        const status = url.searchParams.get('status');
        const cursor = url.searchParams.get('cursor');
        const [from, count, next] = status ? [100, 3, null] : cursor === 'c31' ? [32, 5, null] : [1, 31, 'c31'];
        res.writeHead(200, json).end(
          JSON.stringify({
            items: Array.from({ length: count }, (_, i) => mockLine(from + i, status || 'active')),
            nextCursor: next,
            total: status ? 3 : 36,
            poses: [{ loginName: 'pos', nickname: 'الكاشير' }],
          }),
        );
        return;
      }
    }
    res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ message: 'بيانات الدخول غير صحيحة' }));
  });
}).listen(port, () => console.log(`mock api on ${port}`));
