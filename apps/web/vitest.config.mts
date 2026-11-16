import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    // The env module validates at import; tests get a fixed, valid origin.
    // Invitations are on, so their suites exercise them; the switched-off
    // behaviour is tested by mocking the env module.
    env: {
      NEXT_PUBLIC_API_URL: "http://api.test",
      NEXT_PUBLIC_INVITATIONS_ENABLED: "true",
    },
    // Full-page suites (axe scans, calendar flows) pass in a few seconds alone
    // but can outrun the 5s default when many files run at once on a busy
    // machine or a CI runner; the longer limit only matters for a test that
    // would otherwise fail on time, never one that fails on an assertion.
    testTimeout: 20_000,
    restoreMocks: true,
    unstubGlobals: true,
  },
});
