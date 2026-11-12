import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  // Relative asset paths, so the build works from any sub-path (e.g. GitHub Pages /<repo>/).
  base: './',
})
