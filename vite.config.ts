import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode, command }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  if (command === 'build' && (!(env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URI) || !env.VITE_SUPABASE_ANON_KEY)) {
    throw new Error('Supabase bağlantı ayarları eksik: VITE_SUPABASE_URL ve VITE_SUPABASE_ANON_KEY gerekli.');
  }
  return {
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(env.VITE_APP_VERSION || '1.0.4.1') },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      filename: 'pwa-sw.js',
      selfDestroying: true,
      injectRegister: false,
      registerType: 'prompt',
      workbox: {
        skipWaiting: false,
        clientsClaim: false,
      },
      includeAssets: ['favicon.png', 'pwa-192x192.png', 'pwa-512x512.png'],
      manifest: {
        name: 'PerdePRO',
        short_name: 'PerdePRO',
        description: 'Perde ve jaluzi firmalari icin yonetim sistemi',
        theme_color: '#4f46e5',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
  base: './',
  build: {
    // Agir kutuphaneler ayri parcalara alinir: ana paket kucuk kalir, Excel/PDF
    // ve grafik kodu yalnizca o ozellik kullanildiginda indirilir.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-xlsx': ['xlsx', 'exceljs'],
        },
      },
    },
  },

  };
})
