import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Force immediate activation of new service worker — no waiting for old tabs to close
      injectRegister: 'auto',
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        // Use NetworkFirst for JS/CSS so users always get the latest code
        runtimeCaching: [
          {
            urlPattern: /\.(?:js|css)$/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'assets-cache',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 }
            }
          }
        ]
      },
      devOptions: { enabled: true },
      manifest: {
        name: 'Baby Monitor',
        short_name: 'Baby Monitor',
        description: 'Peer-to-peer baby monitor with WebRTC',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      }
    })
  ],
})
