import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only the pure-logic suites; test/e2e/*.spec.js belongs to Playwright.
    include: ['test/**/*.test.js'],
    environment: 'node',
  },
});
