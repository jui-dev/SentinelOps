import { ConsoleLogger, Inject, Injectable, LOG_LEVELS } from '@nestjs/common';
import type { LogLevel } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import {
  getRequestId,
  getRequestOrganization,
  getRequestUser,
} from '../common/request-context.js';
import { loggingConfig } from '../config/configuration.js';
import { redact } from './redact.js';

/**
 * Every level at or above `minimum`, in Nest's own severity order.
 *
 * Sliced explicitly rather than passing `[minimum]` and relying on
 * `isLogLevelEnabled` treating the highest entry of the array as the threshold.
 * That behaviour is real but incidental, and a reader should not have to know
 * it to understand what LOG_LEVEL does.
 */
export const levelsFrom = (minimum: LogLevel): LogLevel[] =>
  LOG_LEVELS.slice(LOG_LEVELS.indexOf(minimum));

/**
 * The application's only LoggerService, installed globally in main.ts via
 * `app.useLogger()`.
 *
 * It extends Nest 12's ConsoleLogger rather than wrapping a logging library:
 * that class already provides JSON output, level filtering, structured params,
 * and the colourised development format, so a third-party logger would add
 * dependencies to obtain what the framework ships. Extending it also keeps the
 * `Logger` facade intact — `new Logger(MyService.name)` in a domain module
 * routes here automatically, with its context preserved, so nothing downstream
 * imports or injects this class.
 *
 * Exactly one behaviour is added, in exactly one place: `printMessages` is the
 * funnel every level method passes through, in both output formats, so
 * overriding it applies correlation and redaction to every line the process
 * emits — including ones written by code that never considered either.
 *
 * Correlation means three ambient fields, all taken from the request context:
 * `requestId` from the moment the request arrived, `userId` from the moment the
 * guard verified one, and `organizationId` from the moment membership admitted
 * the request to an organization. None is passed by a caller, so every line a
 * domain service logs is attributable without that service knowing any of
 * these values exist.
 */
@Injectable()
export class AppLogger extends ConsoleLogger {
  constructor(
    @Inject(loggingConfig.KEY)
    config: ConfigType<typeof loggingConfig>,
  ) {
    const json = config.format === 'json';

    super({
      json,
      // Both are pinned rather than left to the defaults because together they
      // decide the serialiser: ConsoleLogger only takes the single-line
      // JSON.stringify path when colours are off and compact is true, and
      // otherwise falls back to multi-line util.inspect.
      colors: !json,
      compact: json,
      logLevels: levelsFrom(config.level),
      // Structured fields at the JSON root, where log aggregators index them,
      // rather than nested under `params`. Nest's own keys win on collision, so
      // a field named `message` or `level` cannot displace the real one.
      flattenParams: true,
    });
  }

  protected override printMessages(
    messages: unknown[],
    context = '',
    logLevel: LogLevel = 'log',
    writeStreamType?: 'stdout' | 'stderr',
    errorStack?: unknown,
    params?: Record<string, any>,
  ): void {
    const requestId = getRequestId();
    const userId = getRequestUser();
    const organizationId = getRequestOrganization()?.organizationId;

    // Spread first so a caller-supplied value is not silently overwritten by
    // the ambient one — they are the same in every normal path, and where they
    // differ the caller was explicit and should win.
    //
    // userId is absent on anything logged before the guard runs, which includes
    // every public route and every failed authentication. An absent field is
    // the honest representation of "nobody was authenticated". The same holds
    // for organizationId on any route that is not organization-scoped.
    const merged = {
      ...(requestId ? { requestId } : {}),
      ...(userId ? { userId } : {}),
      ...(organizationId ? { organizationId } : {}),
      ...params,
    };

    super.printMessages(
      // Non-objects, the overwhelmingly common case, pass through untouched.
      messages.map((message) => redact(message)),
      context,
      logLevel,
      writeStreamType,
      // Deliberately not redacted: a stack trace is a string, and rewriting one
      // would corrupt the most valuable field on an error line.
      errorStack,
      // `undefined` rather than an empty object, so a line with no structured
      // fields does not carry an empty `params` key.
      Object.keys(merged).length > 0
        ? (redact(merged) as Record<string, any>)
        : undefined,
    );
  }
}
