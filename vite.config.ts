import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// `base: './'` lets the build run from any folder or from GitHub Pages.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        // NFR-01: fonts, rules, procedures, and replay data ship with the app.
        globPatterns: ['**/*.{js,css,html,svg,woff,woff2,json,webmanifest}'],
        navigateFallback: 'index.html',
      },
      manifest: {
        name: 'Storm Shelter',
        short_name: 'Storm Shelter',
        description: 'Radiation health tool for one crew member on a Mars transit.',
        theme_color: '#F1F3F6',
        background_color: '#F1F3F6',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
