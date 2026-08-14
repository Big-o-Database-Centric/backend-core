import * as crypto from 'crypto';
import type { Request } from 'express';

const COOKIE = 'oauth_state';
const MAX_AGE_MS = 10 * 60 * 1000;

type Cb = (err: Error | null, ok?: boolean | string) => void;

/**
 * State store for passport-oauth2 that keeps the CSRF nonce in an
 * HMAC-signed, httpOnly cookie instead of express-session. No server-side
 * state, survives container restarts.
 */
export class SignedStateStore {
  constructor(private readonly secret: string) {}

  private sign(nonce: string): string {
    return crypto.createHmac('sha256', this.secret).update(nonce).digest('hex');
  }

  store(req: Request, _meta: unknown, cb: Cb): void {
    const nonce = crypto.randomBytes(16).toString('hex');
    const value = `${nonce}.${this.sign(nonce)}`;
    req.res?.cookie(COOKIE, value, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: MAX_AGE_MS,
    });
    cb(null, nonce);
  }

  verify(req: Request, providedState: string, _meta: unknown, cb: Cb): void {
    const cookie = req.cookies?.[COOKIE];
    req.res?.clearCookie(COOKIE);

    if (!cookie || !providedState) return cb(null, false);

    const [nonce, mac] = cookie.split('.');
    if (!nonce || !mac) return cb(null, false);

    const expected = this.sign(nonce);
    const macBuf = Buffer.from(mac);
    const expBuf = Buffer.from(expected);

    const valid =
      macBuf.length === expBuf.length &&
      crypto.timingSafeEqual(macBuf, expBuf) &&
      nonce === providedState;

    cb(null, valid);
  }
}
