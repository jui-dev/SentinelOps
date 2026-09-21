import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Each worker loads the Nest application and the generated Prisma client.
    // Uncapped, one per core, they exhaust memory on a modest machine, and the
    // paging that follows times out hooks and kills workers at random.
    maxWorkers: 3,
  },
});
