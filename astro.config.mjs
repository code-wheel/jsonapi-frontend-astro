// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: node({
    mode: 'standalone',
  }),
  vite: {
    ssr: {
      // Bundle the client so Node ESM doesn't need to resolve its internal imports.
      // This also protects starters pinned to older versions.
      noExternal: ['@codewheel/jsonapi-frontend-client'],
    },
  },
});
