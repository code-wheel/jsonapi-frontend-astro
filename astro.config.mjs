// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel/serverless';
import node from '@astrojs/node';

const isVercel = Boolean(process.env.VERCEL);

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: isVercel
    ? vercel({})
    : node({
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
