// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  // [PLACEHOLDER] replace with the real domain before deployment
  site: 'https://lephare.example',
  devToolbar: { enabled: false },
  integrations: [react(), sitemap()],

  vite: {
    plugins: [tailwindcss()]
  }
});