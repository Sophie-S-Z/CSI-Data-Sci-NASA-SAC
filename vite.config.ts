import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { VitePWA } from 'vite-plugin-pwa';

// `base: './'` lets the build run from any folder or from GitHub Pages.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        // NFR-01: fonts, rules, procedures, and replay data ship with the app.
        globPatterns: ['**/*.{js,css,html,svg,woff,woff2,json,webmanifest}'],
        // The AI runtimes (WebLLM, 6 MB, and the Anthropic SDK) load only when a crew member picks them. They are cached on first use.
        globIgnores: ['**/assets/{lib,sdk}-*.js'],
        runtimeCaching: [{ urlPattern: /\/assets\/(lib|sdk)-[\w-]+\.js$/, handler: 'CacheFirst', options: { cacheName: 'ai-runtime' } }],
        navigateFallback: 'index.html',
      },
      manifest: {
        name: 'Storm Shelter',
        short_name: 'Storm Shelter',
        description: 'Health monitor for a Mars crew: radiation, cabin air, and body systems.',
        theme_color: '#08090B',
        background_color: '#08090B',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
