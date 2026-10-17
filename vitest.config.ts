import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Logic tests run in Node; component tests opt into jsdom with `// @vitest-environment jsdom`.
export default defineConfig({
  plugins: [react()],
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.perf.ts", "src/__fixtures__/**"],
      reporter: ["text-summary", "text"],
    },
  },
});
