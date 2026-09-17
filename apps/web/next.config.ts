import type { NextConfig } from "next";

/**
 * Baseline response headers for every page. A nonce-based Content Security
 * Policy is deliberately not attempted yet; these are the headers that cost
 * nothing and constrain nothing the app does.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The app is never meant to be framed; this refuses clickjacking.
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
