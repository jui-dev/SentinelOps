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
    env: { NEXT_PUBLIC_API_URL: "http://api.test" },
    restoreMocks: true,
    unstubGlobals: true,
  },
});
