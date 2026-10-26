import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import process from 'node:process'

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'Taily',
        short_name: 'Taily',
        description: 'Three seconds to logged.',
        start_url: '/',
        display: 'standalone',
        background_color: '#EDF0F5',
        theme_color: '#EDF0F5',
        shortcuts: [
          {
            name: 'Add expense',
            short_name: 'Add',
            url: '/?add=1',
            icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }]
          }
        ],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-styles' }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-files',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          }
        ]
      }
    }),
    {
      // Names the channel this bundle was built for (see src/lib/distribution.ts).
      // android/app/build.gradle reads it and refuses to package a bundle meant
      // for another channel — e.g. a self-updating build into the Play AAB.
      name: 'distribution-marker',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'distribution.txt',
          source: mode === 'play' ? 'play' : mode === 'web' ? 'web' : 'sideload'
        })
      }
    }
  ],
  server: { host: true, port: Number(process.env.PORT) || 5173 }
}))
