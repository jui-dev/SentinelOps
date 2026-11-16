import { BadRequestException } from '@nestjs/common';

import {
  VALIDATION_FAILED_MESSAGE,
  formatIssuePath,
  validationExceptionFactory,
} from './validation-exception.factory.js';

type Issue = Parameters<typeof validationExceptionFactory>[0][number];

const issue = (message: string, path?: Issue['path']): Issue =>
  ({ message, path }) as Issue;

const responseOf = (...issues: Issue[]) =>
  validationExceptionFactory(issues).getResponse() as {
    message: string;
    details: { field: string; message: string }[];
  };

describe('formatIssuePath', () => {
  it('should render a flat path', () => {
    expect(formatIssuePath(['email'])).toBe('email');
  });

  it('should render nested and array segments as a dotted path', () => {
    expect(formatIssuePath(['items', 0, 'qty'])).toBe('items.0.qty');
  });

  it('should accept segments given as key objects', () => {
    expect(
      formatIssuePath([{ key: 'items' }, { key: 0 }, { key: 'qty' }]),
    ).toBe('items.0.qty');
  });

  it('should accept a mix of raw keys and key objects', () => {
    expect(formatIssuePath(['items', { key: 0 }])).toBe('items.0');
  });

  it.each([
    ['an undefined path', undefined],
    ['an empty path', [] as Issue['path']],
  ])('should return an empty field for %s', (_case, path) => {
    expect(formatIssuePath(path)).toBe('');
  });
});

describe('validationExceptionFactory', () => {
  it('should throw a BadRequestException', () => {
    expect(validationExceptionFactory([issue('nope')])).toBeInstanceOf(
      BadRequestException,
    );
  });

  it('should use a single fixed string message', () => {
    const response = responseOf(issue('Invalid email address', ['email']));

    expect(response.message).toBe(VALIDATION_FAILED_MESSAGE);
    expect(typeof response.message).toBe('string');
  });

  it('should map an issue to its field and message', () => {
    expect(
      responseOf(issue('Invalid email address', ['email'])).details,
    ).toEqual([{ field: 'email', message: 'Invalid email address' }]);
  });

  it('should report every issue, not just the first', () => {
    const response = responseOf(
      issue('Invalid email address', ['email']),
      issue('Too small', ['items', 0, 'qty']),
      issue('Required', ['title']),
    );

    expect(response.details).toEqual([
      { field: 'email', message: 'Invalid email address' },
      { field: 'items.0.qty', message: 'Too small' },
      { field: 'title', message: 'Required' },
    ]);
  });

  it('should report a root-level issue against an empty field', () => {
    expect(responseOf(issue('Expected an object')).details).toEqual([
      { field: '', message: 'Expected an object' },
    ]);
  });

  it('should not leak schema internals into the details', () => {
    const noisy = {
      message: 'Too small',
      path: ['qty'],
      code: 'too_small',
      expected: 'number',
      received: 0,
      input: { secret: 'value' },
    } as unknown as Issue;

    expect(responseOf(noisy).details).toEqual([
      { field: 'qty', message: 'Too small' },
    ]);
  });
});
