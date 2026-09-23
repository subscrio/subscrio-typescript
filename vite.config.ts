import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(import.meta.dirname, 'src/index.ts'),
        'config/index': resolve(import.meta.dirname, 'src/config/index.ts'),
        'subscrio-migrate': resolve(import.meta.dirname, 'src/cli/migrate.ts')
      },
      name: 'Subscrio',
      formats: ['es', 'cjs']
    },
    rollupOptions: {
      external: [
        /^node:/,
        'pg',
        'drizzle-orm',
        'stripe',
        'zod',
        'bcryptjs',
        'dotenv',
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

