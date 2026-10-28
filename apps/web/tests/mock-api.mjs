// Test double for the backend: answers every login with 401 and the Arabic message,
// serves the account profile, and plays the voluntary authenticator enrollment used by the settings page.
import { createServer } from 'node:http';

const port = Number(process.env.MOCK_API_PORT ?? 3911);
const origin = process.env.MOCK_WEB_ORIGIN ?? 'http://localhost:3910';

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
      res.writeHead(200, json).end(JSON.stringify({ loginName: 'pos', nickname: 'الكاشير', email: 'pos@example.com' }));
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
    if (route === 'POST /auth/two-factor/setup') {
      res.writeHead(200, json).end(JSON.stringify({ otpauth: 'otpauth://totp/Smilesim:pos?secret=MOCKSECRET' }));
      return;
    }
    if (route === 'POST /auth/two-factor/confirm') {
      res.writeHead(200, json).end(JSON.stringify({ next: 'app' }));
      return;
    }
    res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ message: 'بيانات الدخول غير صحيحة' }));
  });
}).listen(port, () => console.log(`mock api on ${port}`));
