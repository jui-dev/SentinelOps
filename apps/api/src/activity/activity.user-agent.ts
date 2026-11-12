/**
 * A User-Agent described the way a person names it: "Chrome on Windows".
 *
 * Only the common browsers and systems, checked in an order that matters:
 * Edge and Opera also say "Chrome", Chrome also says "Safari", and Android
 * also says "Linux". Anything else — a script, curl, a test — is null, so
 * the log shows nothing rather than a string nobody can read.
 */
const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\b(?:OPR|Opera)\//, 'Opera'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

const SYSTEMS: [RegExp, string][] = [
  [/\bWindows NT\b/, 'Windows'],
  [/\b(?:iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

const first = (agent: string, table: [RegExp, string][]): string | null =>
  table.find(([pattern]) => pattern.test(agent))?.[1] ?? null;

export const describeUserAgent = (agent: string | null): string | null => {
  if (agent === null) return null;

  const browser = first(agent, BROWSERS);
  const system = first(agent, SYSTEMS);

  if (browser && system) return `${browser} on ${system}`;

  return browser ?? system;
};
