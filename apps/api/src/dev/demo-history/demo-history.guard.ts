/**
 * TEMPORARY — what the demo-history command will run against. Checked by the
 * command before the application boots, so nothing connects to a database it
 * refuses.
 *
 * Two independent rules. NODE_ENV must be `development`: `test` and
 * `production` never get a demo history from the command. And DATABASE_URL
 * must name this machine, because NODE_ENV defaults to `development` when it
 * is unset — a shell holding a remote database's URL and no NODE_ENV would
 * pass the first rule alone.
 *
 * A hosted demo would need a rule of its own here, deliberately; nothing
 * about this one is meant to be switched off.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Why the command must not run against this target, or undefined. */
export const demoHistoryRefusal = (target: {
  environment: string;
  databaseUrl: string;
}): string | undefined => {
  if (target.environment !== 'development') {
    return `NODE_ENV is "${target.environment}"; the demo history is written only in development.`;
  }

  let host: string;

  try {
    host = new URL(target.databaseUrl).hostname;
  } catch {
    return 'DATABASE_URL is not a URL.';
  }

  if (!LOCAL_HOSTS.has(host)) {
    return `DATABASE_URL points at "${host}"; the demo history is written only to a database on this machine.`;
  }

  return undefined;
};

const DAY = 24 * 60 * 60 * 1000;

/**
 * The anchor from the command's arguments: `--anchor=YYYY-MM-DD` pins the
 * day the history ends on; without it, today (UTC). Always 00:00 UTC, and
 * never after today, so nothing is written in the future. Throws on anything
 * else.
 */
export const resolveAnchor = (args: readonly string[], now: Date): Date => {
  const today = new Date(Math.floor(now.getTime() / DAY) * DAY);
  const unknown = args.filter(
    (arg) => arg !== '--' && !arg.startsWith('--anchor='),
  );

  if (unknown.length > 0) {
    throw new Error(`Unknown arguments: ${unknown.join(' ')}`);
  }

  const value = args
    .find((arg) => arg.startsWith('--anchor='))
    ?.slice('--anchor='.length);

  if (value === undefined) {
    return today;
  }

  const anchor = new Date(`${value}T00:00:00.000Z`);

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(anchor.getTime()) ||
    anchor.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`--anchor must be a date, YYYY-MM-DD; got "${value}"`);
  }

  if (anchor.getTime() > today.getTime()) {
    throw new Error('--anchor cannot be after today (UTC)');
  }

  return anchor;
};
