/** Single-user auth: one APP_PASSWORD (Netlify env var) → signed, httpOnly session cookie. Also encrypts stored API keys. */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE = 'me_session';
const SESSION_DAYS = 30;

const secret = () => process.env.APP_SECRET || process.env.APP_PASSWORD || 'local-dev-only';
const hmac = (msg: string) => createHmac('sha256', secret()).update(msg).digest('base64url');

export function authMode(): 'password' | 'open' | 'misconfigured' {
  if (process.env.APP_PASSWORD) return 'password';
  return process.env.ALLOW_NO_AUTH === '1' ? 'open' : 'misconfigured';
}

export function checkPassword(pw: string): boolean {
  const a = createHash('sha256').update(pw).digest();
  const b = createHash('sha256').update(process.env.APP_PASSWORD ?? '').digest();
  return !!process.env.APP_PASSWORD && timingSafeEqual(a, b);
}

export function sessionCookie(secure: boolean): string {
  const exp = Date.now() + SESSION_DAYS * 86400_000;
  const token = `${exp}.${hmac(`session:${exp}`)}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export function isAuthed(req: Request): boolean {
  const mode = authMode();
  if (mode === 'open') return true;
  if (mode === 'misconfigured') return false;
  const m = (req.headers.get('cookie') ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = hmac(`session:${exp}`);
  return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/** Token the API function uses to call the background worker. */
export const workerToken = () => hmac('worker');
export function isWorker(req: Request) {
  const t = req.headers.get('x-worker-token') ?? '';
  const e = workerToken();
  return t.length === e.length && timingSafeEqual(Buffer.from(t), Buffer.from(e));
}

// ---- API keys at rest: AES-256-GCM ----
const encKey = () => createHash('sha256').update(`keys:${secret()}`).digest();

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', encKey(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `enc:v1:${iv.toString('base64url')}:${c.getAuthTag().toString('base64url')}:${ct.toString('base64url')}`;
}

export function decrypt(stored: string): string | null {
  if (!stored.startsWith('enc:v1:')) return stored;
  try {
    const [, , iv, tag, ct] = stored.split(':');
    const d = createDecipheriv('aes-256-gcm', encKey(), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  } catch {
    return null; // secret changed: key must be re-entered
  }
}
