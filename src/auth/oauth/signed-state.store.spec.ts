import { SignedStateStore } from './signed-state.store';

function fakeReqRes() {
  const cookies: Record<string, string> = {};
  const req: any = {
    cookies,
    res: {
      cookie: (name: string, value: string) => { cookies[name] = value; },
      clearCookie: (name: string) => { delete cookies[name]; },
    },
  };
  return req;
}

describe('SignedStateStore', () => {
  it('stores a signed state and verifies it back', (done) => {
    const store = new SignedStateStore('test-secret');
    const req = fakeReqRes();

    store.store(req, {}, (storeErr: Error | null, state?: string) => {
      expect(storeErr).toBeNull();
      expect(typeof state).toBe('string');

      store.verify(req, state as string, {}, (verifyErr: Error | null, ok?: boolean) => {
        expect(verifyErr).toBeNull();
        expect(ok).toBe(true);
        done();
      });
    });
  });

  it('rejects a tampered state', (done) => {
    const store = new SignedStateStore('test-secret');
    const req = fakeReqRes();

    store.store(req, {}, (_e: Error | null, state?: string) => {
      store.verify(req, (state as string) + 'x', {}, (verifyErr: Error | null, ok?: boolean) => {
        expect(ok).toBe(false);
        done();
      });
    });
  });

  it('rejects when no state cookie is present', (done) => {
    const store = new SignedStateStore('test-secret');
    const req = fakeReqRes();

    store.verify(req, 'anything', {}, (_e: Error | null, ok?: boolean) => {
      expect(ok).toBe(false);
      done();
    });
  });
});
