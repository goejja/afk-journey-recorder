import { configDefaults, defineConfig } from 'vitest/config';

// cache/ holds third-party checkouts, which have tests of its own that are not ours to run.
export default defineConfig({
  test: { setupFiles: ['tests/setup.ts'], exclude: [...configDefaults.exclude, 'cache/**', 'web/dist/**'] },
});
