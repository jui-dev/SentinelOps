import {
  getRequestId,
  getRequestOrganization,
  getRequestUser,
  runWithRequestContext,
  setRequestOrganization,
  setRequestUser,
} from './request-context.js';
import type { OrganizationContext } from './request-context.js';

const ORGANIZATION: OrganizationContext = {
  organizationId: 'org-a',
  membershipId: 'membership-a',
  role: 'MEMBER',
};

describe('request context', () => {
  it('should expose the id inside the context', () => {
    runWithRequestContext({ requestId: 'req-1' }, () => {
      expect(getRequestId()).toBe('req-1');
    });
  });

  it('should return undefined outside any context', () => {
    // The normal case for bootstrap, shutdown hooks, and background work — not
    // an error, and never a fabricated id.
    expect(getRequestId()).toBeUndefined();
  });

  it('should return undefined again after the context exits', () => {
    runWithRequestContext({ requestId: 'req-1' }, () => undefined);

    expect(getRequestId()).toBeUndefined();
  });

  it('should return the callback result', () => {
    expect(runWithRequestContext({ requestId: 'req-1' }, () => 42)).toBe(42);
  });

  it('should invoke the callback synchronously', () => {
    // Load-bearing: RequestIdMiddleware wraps `next()` in this, and must behave
    // exactly as it did when it called `next()` directly.
    const order: string[] = [];

    runWithRequestContext({ requestId: 'req-1' }, () => order.push('inside'));
    order.push('after');

    expect(order).toEqual(['inside', 'after']);
  });

  it('should survive an await', async () => {
    await runWithRequestContext({ requestId: 'req-1' }, async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));

      expect(getRequestId()).toBe('req-1');
    });
  });

  it('should survive into a deferred callback scheduled inside the context', async () => {
    // The propagation HttpLoggerMiddleware's res.once('finish') handler relies
    // on: a callback scheduled from inside the context runs inside it, however
    // much later it fires.
    const seen = await runWithRequestContext(
      { requestId: 'req-1' },
      () =>
        new Promise<string | undefined>((resolve) => {
          setTimeout(() => resolve(getRequestId()), 1);
        }),
    );

    expect(seen).toBe('req-1');
  });

  it('should not carry into a listener invoked synchronously from outside', async () => {
    // The boundary, asserted so it is not rediscovered later: context follows
    // async resources, not listener registration. An emit() from outside any
    // context runs the listener outside it, even though it was registered
    // inside one.
    //
    // This is why HttpLoggerMiddleware captures the id at entry and passes it
    // explicitly, rather than trusting the ambient lookup at 'finish' time.
    const { EventEmitter } = await import('node:events');
    const emitter = new EventEmitter();
    let seen: string | undefined = 'unset';

    runWithRequestContext({ requestId: 'req-1' }, () => {
      emitter.once('finish', () => {
        seen = getRequestId();
      });
    });

    emitter.emit('finish');

    expect(seen).toBeUndefined();
  });

  it('should isolate nested contexts', () => {
    runWithRequestContext({ requestId: 'outer' }, () => {
      runWithRequestContext({ requestId: 'inner' }, () => {
        expect(getRequestId()).toBe('inner');
      });

      expect(getRequestId()).toBe('outer');
    });
  });

  it('should not bleed between concurrent contexts', async () => {
    const observe = (requestId: string) =>
      runWithRequestContext({ requestId }, async () => {
        await new Promise((resolve) =>
          setTimeout(resolve, requestId === 'slow' ? 10 : 1),
        );

        return getRequestId();
      });

    await expect(
      Promise.all([observe('slow'), observe('fast')]),
    ).resolves.toEqual(['slow', 'fast']);
  });

  describe('the authenticated user', () => {
    it('should be absent until the guard records one', () => {
      runWithRequestContext({ requestId: 'req-1' }, () => {
        expect(getRequestUser()).toBeUndefined();
      });
    });

    it('should be readable after being set', () => {
      runWithRequestContext({ requestId: 'req-1' }, () => {
        setRequestUser('user-1');

        expect(getRequestUser()).toBe('user-1');
      });
    });

    it('should mutate the existing context rather than opening a new one', () => {
      // A guard writes the user id and returns; the handler that runs
      // afterwards must still see it. Opening a scope here would end it at the
      // guard's own return.
      runWithRequestContext({ requestId: 'req-1' }, () => {
        setRequestUser('user-1');

        return Promise.resolve().then(() => {
          expect(getRequestUser()).toBe('user-1');
          expect(getRequestId()).toBe('req-1');
        });
      });
    });

    it('should survive an await', async () => {
      await runWithRequestContext({ requestId: 'req-1' }, async () => {
        setRequestUser('user-1');
        await new Promise((resolve) => setTimeout(resolve, 1));

        expect(getRequestUser()).toBe('user-1');
      });
    });

    it('should not throw outside a request', () => {
      // A unit test constructs a guard with no middleware ahead of it. That is
      // not a failure worth throwing over.
      expect(() => setRequestUser('user-1')).not.toThrow();
      expect(getRequestUser()).toBeUndefined();
    });

    it('should not bleed between concurrent contexts', async () => {
      const observe = (requestId: string, userId: string) =>
        runWithRequestContext({ requestId }, async () => {
          setRequestUser(userId);
          await new Promise((resolve) =>
            setTimeout(resolve, requestId === 'slow' ? 10 : 1),
          );

          return getRequestUser();
        });

      await expect(
        Promise.all([
          observe('slow', 'user-slow'),
          observe('fast', 'user-fast'),
        ]),
      ).resolves.toEqual(['user-slow', 'user-fast']);
    });

    it('should accept a user supplied at context creation', () => {
      runWithRequestContext({ requestId: 'req-1', userId: 'user-1' }, () => {
        expect(getRequestUser()).toBe('user-1');
      });
    });
  });

  describe('the admitted organization', () => {
    it('should be absent until admission records one', () => {
      runWithRequestContext({ requestId: 'req-1' }, () => {
        expect(getRequestOrganization()).toBeUndefined();
      });
    });

    it('should be readable after being set', () => {
      runWithRequestContext({ requestId: 'req-1' }, () => {
        setRequestOrganization(ORGANIZATION);

        expect(getRequestOrganization()).toEqual(ORGANIZATION);
      });
    });

    it('should remain visible to work that runs after the guard returns', async () => {
      await runWithRequestContext({ requestId: 'req-1' }, async () => {
        setRequestOrganization(ORGANIZATION);
        await new Promise((resolve) => setTimeout(resolve, 1));

        expect(getRequestOrganization()).toEqual(ORGANIZATION);
      });
    });

    it('should accept the same organization being recorded again', () => {
      runWithRequestContext({ requestId: 'req-1' }, () => {
        setRequestOrganization(ORGANIZATION);

        expect(() => setRequestOrganization(ORGANIZATION)).not.toThrow();
      });
    });

    it('should refuse to replace one organization with another', () => {
      // A request acts within exactly one tenant. A second admission naming a
      // different one is a wiring mistake, and must not silently win.
      runWithRequestContext({ requestId: 'req-1' }, () => {
        setRequestOrganization(ORGANIZATION);

        expect(() =>
          setRequestOrganization({
            ...ORGANIZATION,
            organizationId: 'org-b',
          }),
        ).toThrow();
        expect(getRequestOrganization()?.organizationId).toBe('org-a');
      });
    });

    it('should not throw outside a request', () => {
      expect(() => setRequestOrganization(ORGANIZATION)).not.toThrow();
      expect(getRequestOrganization()).toBeUndefined();
    });

    it('should not bleed between concurrent contexts', async () => {
      const observe = (requestId: string, organizationId: string) =>
        runWithRequestContext({ requestId }, async () => {
          setRequestOrganization({ ...ORGANIZATION, organizationId });
          await new Promise((resolve) =>
            setTimeout(resolve, requestId === 'slow' ? 10 : 1),
          );

          return getRequestOrganization()?.organizationId;
        });

      await expect(
        Promise.all([observe('slow', 'org-slow'), observe('fast', 'org-fast')]),
      ).resolves.toEqual(['org-slow', 'org-fast']);
    });
  });
});
