/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// One UI codebase: `react-native` imports resolve to react-native-web here,
// and `.web.*` files win over shared ones so platform adapters can diverge.
const extensions = ['.web.tsx', '.web.ts', '.tsx', '.ts', '.web.js', '.js', '.mjs', '.json'];

// Brand type: react-native-web draws every Text and TextInput in its "System" font stack.
// Putting Alegreya Sans (src/ui/fonts.css) first in that stack gives every screen the brand
// font; an explicit fontFamily (monospace, the serif) still wins.
// Runs on the dependency pre-bundle (dev) and on the build.
const RNW_STACK = /(var SYSTEM_FONT_STACK = ')(-apple-system,)/;
const brandFontStack: Plugin = {
  name: 'sala-brand-font-stack',
  transform(code, id) {
    if (!/react-native-web[\\/]dist[\\/](cjs[\\/])?exports[\\/]StyleSheet[\\/]compiler[\\/]createReactDOMStyle\.js$/.test(id)) return null;
    if (!RNW_STACK.test(code)) throw new Error('react-native-web changed its system font stack; update brandFontStack in vite.config.ts');
    return { code: code.replace(RNW_STACK, '$1"Alegreya Sans",$2'), map: null };
  },
};

export default defineConfig({
  plugins: [react(), brandFontStack],
  resolve: {
    alias: { 'react-native': 'react-native-web' },
    extensions,
  },
  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
  },
  optimizeDeps: {
    esbuildOptions: { resolveExtensions: extensions },
    rolldownOptions: { plugins: [brandFontStack] },
  },
  clearScreen: false,
  server: { port: 1420, strictPort: true, fs: { allow: ['..'] } },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
  },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    testTimeout: 60_000,
  },
});
