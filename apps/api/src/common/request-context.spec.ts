import {
  getRequestId,
  runWithRequestContext,
} from './request-context.js';

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

    await expect(Promise.all([observe('slow'), observe('fast')])).resolves.toEqual([
      'slow',
      'fast',
    ]);
  });
});
