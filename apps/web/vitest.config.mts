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
    restoreMocks: true,
    unstubGlobals: true,
  },
});
