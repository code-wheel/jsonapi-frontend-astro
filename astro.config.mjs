// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel/serverless';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: vercel(),
  vite: {
    ssr: {
      // Bundle the client so Node ESM doesn't need to resolve its internal imports.
      // This also protects starters pinned to older versions.
      noExternal: ['@codewheel/jsonapi-frontend-client'],
    },
  },
});
