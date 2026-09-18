import { slugify } from '../common/slug.js';
import {
  emailSchema,
  loginSchema,
  passwordSchema,
  registerSchema,
  slugSchema,
} from './auth.schemas.js';

const validRegistration = {
  email: 'ada@example.com',
  password: 'a-sufficiently-long-passphrase',
  name: 'Ada Lovelace',
  organizationName: 'Acme Operations',
};

describe('auth schemas', () => {
  describe('emailSchema', () => {
    it('should lowercase and trim before validating', () => {
      // Order matters: the format check runs after normalisation, so a padded
      // address is cleaned rather than rejected.
      expect(emailSchema.parse('  ADA@Example.COM  ')).toBe('ada@example.com');
    });

    it('should produce the value the unique index is built on', () => {
      // users.email is a case-sensitive Postgres unique index. Normalising here
      // is what makes "Ada@example.com" and "ada@example.com" one account.
      expect(emailSchema.parse('Ada@Example.com')).toBe(
        emailSchema.parse('ada@example.com'),
      );
    });

    it.each(['not-an-email', '', '  ', 'ada@', '@example.com'])(
      'should reject %j',
      (value) => {
        expect(emailSchema.safeParse(value).success).toBe(false);
      },
    );

    it('should reject an address longer than 254 characters', () => {
      expect(
        emailSchema.safeParse(`${'a'.repeat(250)}@example.com`).success,
      ).toBe(false);
    });
  });

  describe('passwordSchema', () => {
    it('should accept a long passphrase without composition rules', () => {
      expect(
        passwordSchema.safeParse('correct horse battery staple').success,
      ).toBe(true);
    });

    it('should reject fewer than 12 characters', () => {
      expect(passwordSchema.safeParse('short1!A').success).toBe(false);
    });

    it('should accept exactly 12 characters', () => {
      expect(passwordSchema.safeParse('a'.repeat(12)).success).toBe(true);
    });

    it('should reject more than 128 characters', () => {
      expect(passwordSchema.safeParse('a'.repeat(129)).success).toBe(false);
    });

    it('should not trim, because whitespace is part of a passphrase', () => {
      expect(passwordSchema.parse('  spaces  matter  ')).toBe(
        '  spaces  matter  ',
      );
    });
  });

  describe('slugSchema', () => {
    it.each(['acme', 'acme-ops', 'a1-b2-c3'])('should accept %s', (slug) => {
      expect(slugSchema.safeParse(slug).success).toBe(true);
    });

    it('should lowercase and trim', () => {
      expect(slugSchema.parse('  Acme-Ops  ')).toBe('acme-ops');
    });

    it.each([
      ['a', 'shorter than two characters'],
      ['-acme', 'a leading hyphen'],
      ['acme-', 'a trailing hyphen'],
      ['acme--ops', 'a doubled hyphen'],
      ['acme ops', 'a space'],
      ['acme_ops', 'an underscore'],
      ['acme/ops', 'a slash'],
    ])('should reject %j: %s', (slug) => {
      expect(slugSchema.safeParse(slug).success).toBe(false);
    });
  });

  describe('registerSchema', () => {
    it('should accept a registration without an explicit slug', () => {
      const parsed = registerSchema.parse(validRegistration);

      expect(parsed.organizationSlug).toBeUndefined();
      expect(parsed.email).toBe('ada@example.com');
    });

    it('should trim the display names', () => {
      const parsed = registerSchema.parse({
        ...validRegistration,
        name: '  Ada Lovelace  ',
        organizationName: '  Acme Operations  ',
      });

      expect(parsed.name).toBe('Ada Lovelace');
      expect(parsed.organizationName).toBe('Acme Operations');
    });

    it('should strip unknown keys rather than trust them', () => {
      const parsed = registerSchema.parse({
        ...validRegistration,
        role: 'OWNER',
      });

      expect(parsed).not.toHaveProperty('role');
    });

    it('should report every invalid field at once', () => {
      const result = registerSchema.safeParse({
        email: 'nope',
        password: 'short',
        name: '',
        organizationName: '',
      });

      expect(result.success).toBe(false);
      expect(
        result.error?.issues.map((issue) => issue.path.join('.')).sort(),
      ).toEqual(['email', 'name', 'organizationName', 'password']);
    });
  });

  describe('loginSchema', () => {
    it('should normalise the email exactly as registration does', () => {
      expect(
        loginSchema.parse({ email: ' ADA@Example.com ', password: 'x' }).email,
      ).toBe('ada@example.com');
    });

    it('should not apply the password policy to a login', () => {
      // Applying it would reject anyone whose password predates a tightening of
      // the rule, and would answer 400 where the contract promises 401.
      expect(
        loginSchema.safeParse({ email: 'ada@example.com', password: 'old' })
          .success,
      ).toBe(true);
    });

    it('should still reject an empty password', () => {
      expect(
        loginSchema.safeParse({ email: 'ada@example.com', password: '' })
          .success,
      ).toBe(false);
    });
  });

  describe('slugify, as registration uses it', () => {
    it('should produce output that satisfies slugSchema', () => {
      for (const name of ['Acme Operations', 'A  B', '99 Problems', 'Ops!!!']) {
        const slug = slugify(name);

        expect(slug).toBeDefined();
        expect(slugSchema.safeParse(slug).success).toBe(true);
      }
    });
  });
});
