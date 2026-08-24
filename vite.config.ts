import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(import.meta.dirname, 'src/index.ts'),
        'config/index': resolve(import.meta.dirname, 'src/config/index.ts')
      },
      name: 'Subscrio',
      formats: ['es', 'cjs']
    },
    rollupOptions: {
      external: [
        'pg',
        'drizzle-orm',
        'stripe',
        'zod',
        'bcryptjs',
        'uuidv7',
        'crypto',
        'fs/promises',
        'fs',
        'path',
        'util'
      ]
    }
  },
  plugins: [
    dts({
      include: ['src'],
      outDir: 'dist'
    })
  ]
});

