import { describeUserAgent } from './activity.user-agent.js';

const AGENTS = {
  chromeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  operaMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/115.0.0.0',
  firefoxLinux:
    'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  chromeOs:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};

describe('describeUserAgent', () => {
  it.each([
    ['chromeWindows', 'Chrome on Windows'],
    ['edgeWindows', 'Edge on Windows'],
    ['operaMac', 'Opera on macOS'],
    ['firefoxLinux', 'Firefox on Linux'],
    ['safariMac', 'Safari on macOS'],
    ['safariIphone', 'Safari on iOS'],
    ['chromeAndroid', 'Chrome on Android'],
    ['chromeOs', 'Chrome on ChromeOS'],
  ] as const)('should name %s as "%s"', (agent, expected) => {
    expect(describeUserAgent(AGENTS[agent])).toBe(expected);
  });

  it('should say nothing for what is not a browser', () => {
    expect(describeUserAgent(null)).toBeNull();
    expect(describeUserAgent('curl/8.4.0')).toBeNull();
    expect(describeUserAgent('node-superagent/3.8.3')).toBeNull();
  });
});
