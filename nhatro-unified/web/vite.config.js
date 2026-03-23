import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
 
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // các request bắt đầu bằng /api sẽ được proxy sang API
      '/api': {
        target: 'https://loidt132-nhatro.vercel.app',
        changeOrigin: true,
      }
    }
  }
});
