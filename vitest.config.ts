import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Modules that legitimately import the editor API are loaded against a
      // stand-in so they can be unit-tested in plain node.
      vscode: path.resolve(root, 'test/helpers/fakes.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/unit/**/*.test.ts'],
  },
});
