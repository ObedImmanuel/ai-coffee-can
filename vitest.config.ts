import { defineConfig } from "vitest/config";

// Unit tests cover the pure portfolio and analysis code, so they run in Node without the Workers runtime.
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
