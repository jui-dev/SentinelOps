/**
 * TEMPORARY — `pnpm --filter @sentinelops/api demo:history`: replaces the
 * development organization's incidents with the demo history. See the
 * README's "Demo history" section.
 *
 *   demo:history                        26 weeks up to 00:00 UTC today
 *   demo:history -- --anchor=YYYY-MM-DD 26 weeks up to 00:00 UTC that day
 *
 * The target is checked before the application boots (demo-history.guard.ts),
 * so a refused run opens no connection. Booting then ensures the development
 * organization and its personas, exactly as `start:dev` does, before the
 * history is written. No HTTP server is started.
 */
import { existsSync } from 'node:fs';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../../app.module.js';
import { ROOT_ENV_FILE } from '../../config/env.js';
import { envSchema } from '../../config/env.validation.js';
import { DemoHistoryService } from './demo-history.service.js';
import { demoHistoryRefusal, resolveAnchor } from './demo-history.guard.js';

const fail = (message: string): never => {
  console.error(`demo:history refused: ${message}`);
  process.exit(1);
};

// The same file, read the same way, as the application's configuration.
if (existsSync(ROOT_ENV_FILE)) {
  process.loadEnvFile(ROOT_ENV_FILE);
}

const env = envSchema.safeParse(process.env);

if (!env.success) {
  fail('the environment is invalid; see .env.example.');
}

const { NODE_ENV, DATABASE_URL } = env.data!;
const refusal = demoHistoryRefusal({
  environment: NODE_ENV,
  databaseUrl: DATABASE_URL,
});

if (refusal) {
  fail(refusal);
}

let anchor: Date;

try {
  anchor = resolveAnchor(process.argv.slice(2), new Date());
} catch (error) {
  fail((error as Error).message);
}

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
});

try {
  const result = await app.get(DemoHistoryService).replace(anchor!);

  console.log(
    [
      `Demo history written to ${new URL(DATABASE_URL).pathname.slice(1)}: 26 weeks up to ${result.anchor.toISOString().slice(0, 10)} 00:00 UTC.`,
      `  removed:     ${result.removed} incidents`,
      `  incidents:   ${result.incidents} (${result.active} active)`,
      `  responders:  ${result.responders}`,
      `  activities:  ${result.activities}`,
    ].join('\n'),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await app.close();
}
