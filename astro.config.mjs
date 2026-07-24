// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  // Cloudflare Pages project "le-phare"; override with SITE=https://… at build
  // time once a custom domain is attached.
  site: process.env.SITE ?? 'https://le-phare.pages.dev',

  devToolbar: { enabled: false },
  integrations: [react(), mdx(), sitemap()],

  vite: {
    plugins: [tailwindcss()],
    // pre-bundle heavy deps so dev never serves stale optimize chunks (504s)
    optimizeDeps: {
      include: ['three', 'maplibre-gl', 'gsap', 'gsap/ScrollTrigger', 'gsap/SplitText', 'lenis', '@observablehq/plot', 'react', 'react-dom']
    }
  },

  adapter: cloudflare()
});