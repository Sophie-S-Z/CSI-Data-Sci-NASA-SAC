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
        navigateFallback: 'index.html',
      },
      manifest: {
        name: 'Storm Shelter',
        short_name: 'Storm Shelter',
        description: 'Health monitor for a Mars crew: radiation, cabin air, and body systems.',
        theme_color: '#12151C',
        background_color: '#12151C',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
