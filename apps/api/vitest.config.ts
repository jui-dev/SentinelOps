import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // Workers load Nest modules and the generated Prisma client. Uncapped, one
    // per core, they exhaust memory on a modest machine, and the paging that
    // follows times out tests and kills workers at random.
    maxWorkers: 3,
  },
});
