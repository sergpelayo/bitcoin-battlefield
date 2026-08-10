import { defineConfig } from 'vite';

export default defineConfig({
  // Rutas relativas: el build de dist/ funciona servido desde cualquier subcarpeta.
  base: './',
  server: {
    port: 5173,
    open: true,
  },
});
