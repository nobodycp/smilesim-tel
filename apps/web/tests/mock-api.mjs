// Test double for the backend: answers every login with 401 and the Arabic message.
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
    res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ message: 'بيانات الدخول غير صحيحة' }));
  });
}).listen(port, () => console.log(`mock api on ${port}`));
