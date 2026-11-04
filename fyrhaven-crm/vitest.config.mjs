import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests of plugin logic: `test/*.test.mjs`. The logic lives in plain ES
// modules under `src/lib/` so tests import it directly; `src/index.js` only
// wires it to the api (it is covered through the bundle in `bundle.test.mjs`).
export default defineConfig({
  // The UI kit the sandbox gives plugins at run time; tests get a stand-in.
  resolve: { alias: { '@plugin-host/ui': fileURLToPath(new URL('./test-utils/ui-kit.mjs', import.meta.url)) } },
  test: {
    include: ['test/**/*.test.{js,mjs}'],
    exclude: ['node_modules/**'],
    environment: 'node',
    // `bundle.test.mjs` builds the plugin with esbuild in beforeAll.
    hookTimeout: 60_000,
  },
});
