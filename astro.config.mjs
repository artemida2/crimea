// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://artemida2.github.io',
  base: '/crimea',
  trailingSlash: 'always',
  integrations: [sitemap()],
  build: {
    format: 'directory',
  },
});
