/// <reference types="vite/client" />
export default defineConfig({
  optimizeDeps: {
    include: ['@clockworklabs/spacetimedb-sdk']
  }
});