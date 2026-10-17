import { defineConfig } from "vitest/config";

// The performance report (src/*.perf.ts): only measured and reported, see docs/KENNZAHLEN.md.
export default defineConfig({
  test: { include: ["src/**/*.perf.ts"], testTimeout: 120_000 },
});
