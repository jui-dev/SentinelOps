import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  let service: PasswordService;

  beforeAll(async () => {
    service = new PasswordService();
    // The dummy hash is computed here in the real application too; without it
    // verifyDummy would have nothing to verify against.
    await service.onModuleInit();
  });

  describe('hash', () => {
    it('should produce an argon2id PHC string, not the password', async () => {
      const hash = await service.hash('correct horse battery staple');

      expect(hash).not.toContain('correct horse battery staple');
      expect(hash.startsWith('$argon2id$')).toBe(true);
    });

    it('should encode the configured parameters into the hash', () => {
      // Verification reads these back out of the string, which is why raising
      // them later does not invalidate an existing password.
      return expect(service.hash('a-long-enough-password')).resolves.toContain(
        '$m=19456,t=2,p=1$',
      );
    });

    it('should produce a different hash each time for one password', async () => {
      const [first, second] = await Promise.all([
        service.hash('the same password'),
        service.hash('the same password'),
      ]);

      // Distinct random salts. Equal hashes would mean two people with the same
      // password are visibly identical in the table.
      expect(first).not.toBe(second);
    });
  });

  describe('verify', () => {
    it('should accept the password it was hashed from', async () => {
      const hash = await service.hash('correct horse battery staple');

      await expect(
        service.verify(hash, 'correct horse battery staple'),
      ).resolves.toBe(true);
    });

    it('should reject a different password', async () => {
      const hash = await service.hash('correct horse battery staple');

      await expect(service.verify(hash, 'incorrect horse')).resolves.toBe(
        false,
      );
    });

    it('should be case sensitive', async () => {
      const hash = await service.hash('correct horse battery staple');

      await expect(
        service.verify(hash, 'Correct Horse Battery Staple'),
      ).resolves.toBe(false);
    });

    it.each([['not-a-hash'], [''], ['$argon2id$v=19$truncated']])(
      'should answer false rather than throw for %j',
      async (stored) => {
        // A corrupt row is a failed login, not a 500 that tells the caller their
        // email exists.
        await expect(service.verify(stored, 'any password')).resolves.toBe(
          false,
        );
      },
    );
  });

  describe('verifyDummy', () => {
    it('should resolve without throwing', async () => {
      await expect(service.verifyDummy('anything')).resolves.toBeUndefined();
    });

    it('should cost roughly what a real verification costs', async () => {
      const hash = await service.hash('a-real-password');

      const startReal = performance.now();
      await service.verify(hash, 'a-real-password');
      const real = performance.now() - startReal;

      const startDummy = performance.now();
      await service.verifyDummy('a-real-password');
      const dummy = performance.now() - startDummy;

      // The point of the dummy is that an unknown email cannot be told from a
      // known one by timing. A generous ratio: this asserts the same order of
      // magnitude, not a constant-time guarantee, which no test can give.
      expect(dummy).toBeGreaterThan(real / 4);
      expect(dummy).toBeLessThan(real * 4);
    });
  });
});
