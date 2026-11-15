/**
 * TEMPORARY — `pnpm --filter @sentinelops/api demo -- <command>`: the demo
 * workspace's buttons on the command line, for the demo organization on
 * this machine.
 *
 *   demo -- status              what each part holds
 *   demo -- reset               the full demo, its history ending today
 *   demo -- remove-all          every part but the organization and accounts
 *   demo -- generate <part>     a part, and first whatever it needs
 *   demo -- remove <part>       a part, and before it whatever needs it
 *
 * Parts: accounts teams services knownIssues history live analyses activity.
 *
 * The target is checked before the application boots, as demo:history
 * checks it (demo-history.guard.ts): development, and a database on this
 * machine. Booting then ensures the organization and its accounts, exactly
 * as `start:dev` does. No HTTP server is started.
 */
import { existsSync } from 'node:fs';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../../app.module.js';
import { ROOT_ENV_FILE } from '../../config/env.js';
import { envSchema } from '../../config/env.validation.js';
import { PrismaService } from '../../database/prisma.service.js';
import { DEV_ORGANIZATION } from '../dev-account.js';
import { demoHistoryRefusal } from '../demo-history/demo-history.guard.js';
import { ADMIN } from '../demo-history/demo-story.js';
import { DEMO_PARTS, isDemoPart } from './demo-parts.js';
import type { DemoPart } from './demo-parts.js';
import type { DemoWorkspaceResponse } from './demo-workspace.contract.js';
import { DemoWorkspaceService } from './demo-workspace.service.js';

const USAGE = `Usage: demo -- status | reset | remove-all | generate <part> | remove <part>
Parts: ${DEMO_PARTS.join(' ')}`;

const fail = (message: string): never => {
  console.error(`demo refused: ${message}`);
  process.exit(1);
};

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const [command, partName] = args;

const COMMANDS = ['status', 'reset', 'remove-all', 'generate', 'remove'];

if (!command || !COMMANDS.includes(command)) {
  console.error(USAGE);
  process.exit(1);
}

let part: DemoPart | undefined;

if (command === 'generate' || command === 'remove') {
  if (!partName || !isDemoPart(partName)) {
    fail(`name a part: ${DEMO_PARTS.join(', ')}`);
  }

  part = partName as DemoPart;
} else if (partName !== undefined) {
  fail(`"${command}" takes no part`);
}

// The same file, read the same way, as the application's configuration.
if (existsSync(ROOT_ENV_FILE)) {
  process.loadEnvFile(ROOT_ENV_FILE);
}

const env = envSchema.safeParse(process.env);

if (!env.success) {
  fail('the environment is invalid; see .env.example.');
}

const refusal = demoHistoryRefusal({
  environment: env.data!.NODE_ENV,
  databaseUrl: env.data!.DATABASE_URL,
});

if (refusal) {
  fail(refusal);
}

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
});

const print = (workspace: DemoWorkspaceResponse) => {
  const width = Math.max(...workspace.parts.map(({ id }) => id.length));

  console.log(
    [
      `Demo workspace of ${DEV_ORGANIZATION.name} (${DEV_ORGANIZATION.slug})`,
      ...workspace.parts.map(
        ({ id, required, count }) =>
          `  ${id.padEnd(width)}  ${String(count).padStart(4)}  ${required ? 'required' : 'optional'}`,
      ),
      `  last reset:   ${workspace.lastResetAt ?? 'never'}${workspace.lastResetBy ? ` by ${workspace.lastResetBy.name}` : ''}`,
      `  history ends: ${workspace.historyEndsAt?.slice(0, 10) ?? '—'}`,
    ].join('\n'),
  );
};

try {
  const prisma = app.get(PrismaService);
  const demo = app.get(DemoWorkspaceService);
  const { id: organizationId } = await prisma.organization.findUniqueOrThrow({
    where: { slug: DEV_ORGANIZATION.slug },
    select: { id: true },
  });

  switch (command) {
    case 'status':
      print(await demo.status(organizationId));
      break;
    case 'reset': {
      // Reset in the Admin's name, as the button would be.
      const { id: admin } = await prisma.user.findUniqueOrThrow({
        where: { email: ADMIN },
        select: { id: true },
      });

      print(await demo.reset(organizationId, admin));
      break;
    }
    case 'remove-all':
      print(await demo.removeAll(organizationId));
      break;
    case 'generate':
      print(await demo.generate(organizationId, part!));
      break;
    case 'remove':
      print(await demo.remove(organizationId, part!));
      break;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await app.close();
}
