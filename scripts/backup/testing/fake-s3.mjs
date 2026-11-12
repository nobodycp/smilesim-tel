// A stand-in for an S3-compatible bucket, for the backup specs only (never used in production, holds nothing
// real). It is strict where the scripts rely on the storage being strict:
//   - every request must carry a valid AWS SigV4 signature for the key pair it was started with;
//   - the body must match the x-amz-content-sha256 and Content-MD5 sent with it;
//   - `If-None-Match: *` refuses to replace an object (412);
//   - objects are locked, as a bucket-lock rule would: DELETE and a plain overwrite answer 409;
// and it can be told to misbehave (FAKE_S3_FAIL_PUTS=n answers 500 to the first n uploads,
// FAKE_S3_DROP_PUTS=n cuts the connection in the middle of the first n).
//
//   node fake-s3.mjs <port> <directory> <access key id> <secret access key>
import { createHash, createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [port, root, keyId, secret] = process.argv.slice(2);
let failPuts = Number(process.env.FAKE_S3_FAIL_PUTS ?? 0);
let dropPuts = Number(process.env.FAKE_S3_DROP_PUTS ?? 0);
const sha = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
const enc = (text) => encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const xml = (res, status, code) => { res.writeHead(status, { 'content-type': 'application/xml' }); res.end(`<Error><Code>${code}</Code></Error>`); };

function signedBy(req, url, bodyHash) {
  const auth = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, ?SignedHeaders=([^,]+), ?Signature=([0-9a-f]+)$/.exec(req.headers.authorization ?? '');
  if (!auth) return false;
  const [, id, day, region, signedHeaders, signature] = auth;
  if (id !== keyId) return false;
  const query = [...url.searchParams.entries()].map(([k, v]) => [enc(k), enc(v)]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('&');
  const headers = signedHeaders.split(';').map((name) => `${name}:${String(req.headers[name] ?? '').trim().replace(/\s+/g, ' ')}\n`).join('');
  const canonical = [req.method, url.pathname.split('/').map(enc).join('/'), query, headers, signedHeaders, bodyHash].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', req.headers['x-amz-date'], `${day}/${region}/s3/aws4_request`, sha(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), 's3'), 'aws4_request');
  return createHmac('sha256', key).update(toSign).digest('hex') === signature;
}

createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const chunks = [];
  let seen = 0;
  req.on('data', (chunk) => {
    chunks.push(chunk);
    seen += chunk.length;
    if (req.method === 'PUT' && dropPuts > 0 && seen > 1024) { dropPuts -= 1; req.socket.destroy(); }
  });
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const claimed = req.headers['x-amz-content-sha256'] ?? sha('');
    if (!signedBy(req, url, claimed)) return xml(res, 403, 'SignatureDoesNotMatch');
    const [, bucket, ...rest] = decodeURIComponent(url.pathname).split('/');
    const key = rest.join('/');
    const path = join(root, bucket, key);
    if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const walk = (dir) => (existsSync(dir) ? readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)])) : []);
      const keys = walk(join(root, bucket)).map((file) => file.slice(join(root, bucket).length + 1)).filter((name) => name.startsWith(prefix)).sort();
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(`<ListBucketResult>${keys.map((name) => `<Contents><Key>${name}</Key></Contents>`).join('')}</ListBucketResult>`);
    }
    if (req.method === 'PUT') {
      if (failPuts > 0) { failPuts -= 1; return xml(res, 500, 'InternalError'); }
      if (claimed !== 'UNSIGNED-PAYLOAD' && sha(body) !== claimed) return xml(res, 400, 'XAmzContentSHA256Mismatch');
      const md5 = req.headers['content-md5'];
      if (md5 && createHash('md5').update(body).digest('base64') !== md5) return xml(res, 400, 'BadDigest');
      if (existsSync(path)) return xml(res, req.headers['if-none-match'] === '*' ? 412 : 409, req.headers['if-none-match'] === '*' ? 'PreconditionFailed' : 'ObjectLockedByBucketPolicy');
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, body);
      res.writeHead(200); return res.end();
    }
    if (req.method === 'DELETE') return xml(res, existsSync(path) ? 409 : 204, 'ObjectLockedByBucketPolicy');
    if (!existsSync(path) || statSync(path).isDirectory()) return xml(res, 404, 'NoSuchKey');
    const data = readFileSync(path);
    res.writeHead(200, { 'content-length': data.length, 'content-type': 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}).listen(Number(port), '127.0.0.1');
