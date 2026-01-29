import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, '.', '');

  return {
    plugins: [react()],
    define: {
      // Map process.env.API_KEY to the Vercel/System environment variable
      'process.env.API_KEY': JSON.stringify(env.API_KEY || env.VITE_API_KEY)
    },
    build: {
      target: 'esnext', // Required for Top-level await and modern APIs
    },
    optimizeDeps: {
      exclude: ['@mediapipe/tasks-vision'] // Prevent optimization issues with WASM packages
    }
  };
});