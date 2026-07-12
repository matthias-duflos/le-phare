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
    plugins: [tailwindcss()],
    // pre-bundle heavy deps so dev never serves stale optimize chunks (504s)
    optimizeDeps: {
      include: ['three', 'maplibre-gl', 'gsap', 'gsap/ScrollTrigger', 'gsap/SplitText', 'lenis', '@observablehq/plot', 'react', 'react-dom']
    }
  }
});