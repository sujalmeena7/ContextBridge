import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 120000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
        execArgv: ['--max-old-space-size=2048'],
      },
    },
    environmentMatchGlobs: [
      ['tests/bug-condition-exploration.test.js', 'node'],
      ['tests/preservation-property.test.js', 'node'],
      ['tests/bounded-clone.test.js', 'jsdom'],
    ],
  },
});
