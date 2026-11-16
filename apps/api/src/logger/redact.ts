/** Replaces the value of any key considered sensitive. */
export const REDACTED = '[REDACTED]';

/** Rendered in place of anything nested deeper than {@link MAX_DEPTH}. */
const TRUNCATED = '[Object]';

/**
 * Structured log params are shallow by nature. Eight levels is far more than a
 * log line should ever carry, and the cap means a logger call can never turn
 * into an unbounded walk of an object graph.
 */
const MAX_DEPTH = 8;

/**
 * Key names whose values never reach a log, matched case-insensitively as a
 * substring — so one `token` entry covers `accessToken`, `refresh_token`, and
 * `X-CSRF-TOKEN` alike.
 *
 * This is a backstop, not a licence. The actual rule is that request bodies,
 * response bodies, and headers are not logged at all (the only exception being
 * the correlation id). Redaction exists to catch the case where a future
 * caller passes an object that turns out to hold a secret.
 */
export const SENSITIVE_KEY_PATTERN =
  /pass(word|wd)?|secret|token|api[-_]?key|authorization|auth|cookie|session|jwt|credential|private[-_]?key|refresh|otp|pin|ssn/i;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);

/**
 * Returns a copy of `value` with every sensitive key's value masked.
 *
 * Only plain objects and arrays are traversed. Class instances, `Error`s,
 * `Date`s, `Map`/`Set`, and primitives are returned as-is: a stack trace must
 * survive this untouched, and rebuilding an arbitrary class is not something a
 * logger should attempt. Non-objects pass straight through, so this is safe to
 * map over log messages that are ordinary strings.
 *
 * Never mutates its input.
 */
export const redact = (value: unknown): unknown =>
  redactValue(value, 0, new WeakSet());

const redactValue = (
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown => {
  if (!isPlainObject(value) && !Array.isArray(value)) {
    return value;
  }

  if (depth >= MAX_DEPTH) {
    return TRUNCATED;
  }

  // A cycle is masked rather than followed. Returning the same marker used for
  // the depth cap keeps the output shape predictable.
  if (seen.has(value)) {
    return TRUNCATED;
  }

  // `seen` tracks the current path, not everything ever visited, so it is
  // cleared again below. A DAG — the same object referenced by two sibling
  // keys — is legitimate and must be rendered twice; only a genuine ancestor
  // reference is a cycle.
  seen.add(value);

  let result: unknown;

  if (Array.isArray(value)) {
    // An array index is never a meaningful key name, so entries are only
    // descended into, never masked on their own account.
    result = value.map((entry) => redactValue(entry, depth + 1, seen));
  } else {
    const object: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(value)) {
      object[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? REDACTED
        : redactValue(entry, depth + 1, seen);
    }

    result = object;
  }

  seen.delete(value);

  return result;
};

const decodeKey = (key: string): string => {
  try {
    return decodeURIComponent(key);
  } catch {
    // A malformed escape (`?%=1`) makes decodeURIComponent throw. The raw key
    // is still worth testing, and a logger must never be the thing that
    // crashes a request.
    return key;
  }
};

/**
 * Masks the values of sensitive query parameters while keeping their keys, so
 * `/x?token=abc&page=2` logs as `/x?token=[REDACTED]&page=2`.
 *
 * The path is kept diagnosable — which endpoint was called, and which
 * parameters were supplied — without the credential itself. Parsed by hand
 * rather than through `URLSearchParams`, whose round-trip re-encodes the whole
 * string and would make the logged path stop matching the request.
 */
export const redactUrl = (url: string): string => {
  const separator = url.indexOf('?');

  if (separator === -1) {
    return url;
  }

  const path = url.slice(0, separator);
  const query = url
    .slice(separator + 1)
    .split('&')
    .map((pair) => {
      const equals = pair.indexOf('=');

      if (equals === -1) {
        return pair;
      }

      const key = pair.slice(0, equals);

      return SENSITIVE_KEY_PATTERN.test(decodeKey(key))
        ? `${key}=${REDACTED}`
        : pair;
    })
    .join('&');

  return `${path}?${query}`;
};
