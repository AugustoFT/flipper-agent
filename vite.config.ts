import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base relativa: o build funciona em qualquer subcaminho (ex.: GitHub Pages em /flipper-agent/).
export default defineConfig({
  base: './',
  plugins: [react()],
})
