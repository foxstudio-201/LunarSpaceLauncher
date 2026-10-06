import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        installer: 'installer.html',
      },
    },
  },
  server: {
    port: 5175,
    open: false,
  },
})
