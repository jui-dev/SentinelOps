"use client";

import { Lock } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { ErrorAlert } from "@/components/ui/alert";
import { Button, buttonClasses } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { DialogActions, FormDialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { LocalDateTime, useMinuteClock } from "@/components/ui/timestamp";
import { Status } from "@/components/ui/status";
import type {
  ActivityEntryDetailResponse,
  ActivityEntryResponse,
} from "@/lib/api/contracts";

import {
  ACTION_TITLE,
  AREA_META,
  clientText,
  clockTime,
  isUnusualClient,
  resultOf,
  securityNote,
  fieldLabel,
  formatValue,
  sentenceText,
  subjectLink,
  timeAgo,
} from "./activity-meta";
import { useActivityEntry } from "./activity-queries";

/** One labelled part of the window. */
function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold tracking-[0.06em] text-fg-subtle uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** The area an entry belongs to: its icon and name, in its colour. */
export function AreaLabel({ area }: { area: ActivityEntryResponse["area"] }) {
  const meta = AREA_META[area];
  const Icon = meta.icon;

  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap",
        meta.text,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {meta.label}
    </span>
  );
}

/**
 * Everything about one entry, opened from its row's View button: every
 * field it changed, exactly when, by whom and from where, what happened to
 * the same person or thing before, and a way to it while it exists. The
 * table stays short because this holds the rest.
 */
export function EntryDetails({
  organizationId,
  orgSlug,
  entry,
  onClose,
}: {
  organizationId: string;
  orgSlug: string;
  /** The row it was opened from: shown at once while the rest loads. */
  entry: ActivityEntryResponse;
  onClose: () => void;
}) {
  const details = useActivityEntry(organizationId, entry.id);
  const now = useMinuteClock();
  const full = details.data;
  const link = full ? subjectLink(orgSlug, full) : null;

  if (entry.area === "SECURITY") {
    return (
      <SignInDetails
        entry={entry}
        full={full}
        loading={details.isPending}
        error={details.isError ? details.error : null}
        link={link}
        now={now.getTime()}
        onClose={onClose}
      />
    );
  }

  return (
    <FormDialog
      title={ACTION_TITLE[entry.action]}
      description={`${entry.actor.name} — ${sentenceText(entry).replace(/^./, (first) => first.toLowerCase())}.`}
      onClose={onClose}
      size="lg"
    >
      <div className="flex flex-col gap-5">
        <AreaLabel area={entry.area} />

        {entry.changes.length > 0 && (
          <Part title="What changed">
            <div className="overflow-x-auto rounded-md border border-line-subtle">
              <table className="w-full text-sm">
                <caption className="sr-only">What changed</caption>
                <thead className="bg-thead text-left text-xs text-fg-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Field
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Before
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      After
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entry.changes.map((change) => (
                    <tr key={change.field} className="border-t border-line-subtle">
                      <th scope="row" className="px-3 py-2 text-left font-normal text-fg-muted">
                        {fieldLabel(change.field)}
                      </th>
                      <td className="px-3 py-2 text-fg-muted">
                        {formatValue(change.field, change.before)}
                      </td>
                      <td className="px-3 py-2 font-medium text-fg">
                        {formatValue(change.field, change.after)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Part>
        )}

        <Part title="Details">
          <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
            <dt className="text-fg-subtle">When</dt>
            <dd className="flex flex-col">
              <span className="text-fg">
                <LocalDateTime value={entry.occurredAt} />
              </span>
              <span className="text-xs text-fg-subtle">
                {timeAgo(entry.occurredAt, now.getTime())}
              </span>
            </dd>
            <dt className="text-fg-subtle">Done by</dt>
            <dd className="text-fg">{entry.actor.name}</dd>
            <dt className="text-fg-subtle">From</dt>
            <dd className="data text-fg-muted">
              {entry.client
                ? [entry.client.ipAddress, entry.client.browser]
                    .filter(Boolean)
                    .join(" · ") || "Not known"
                : "Not known"}
            </dd>
            <dt className="text-fg-subtle">Reference</dt>
            <dd className="data text-fg-muted">{entry.reference}</dd>
          </dl>
        </Part>

        {entry.subject && (
          <Part title={`Earlier history of ${entry.subject.name}`}>
            {details.isPending ? (
              <Spinner label="Loading the history" />
            ) : details.isError ? (
              <ErrorAlert error={details.error} />
            ) : full && full.history.length > 0 ? (
              <ol className="flex flex-col rounded-md border border-line-subtle">
                {full.history.map((earlier) => (
                  <li
                    key={earlier.id}
                    className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3 border-t border-line-subtle px-3 py-2 text-sm first:border-t-0"
                  >
                    <span className="data text-xs text-fg-subtle">
                      <LocalDateTime value={earlier.occurredAt} />
                    </span>
                    <span className="text-fg-muted">
                      {earlier.actor.name} — {sentenceText(earlier).replace(/^./, (first) => first.toLowerCase())}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-fg-muted">
                Nothing earlier. This was the first entry about it.
              </p>
            )}
          </Part>
        )}

        <DialogActions>
          <p className="mr-auto inline-flex items-center gap-1.5 text-xs text-fg-subtle">
            <Lock aria-hidden="true" className="size-3" />
            Entries can&apos;t be edited or deleted.
          </p>
          {link && "href" in link && (
            <Link
              href={link.href}
              className={buttonClasses({ variant: "secondary" })}
            >
              {link.label}
            </Link>
          )}
          {link && "gone" in link && (
            <span className="text-xs text-fg-subtle">{link.gone}</span>
          )}
          <Button onClick={onClose}>Done</Button>
        </DialogActions>
      </div>
    </FormDialog>
  );
}

/**
 * One sign-in event in full: for wrong passwords, each attempt; what
 * happened to the account next; and where it came from beside where the
 * account usually signs in from, so a stranger's attempt stands out. A
 * password is reset on the Members page, which this links to.
 */
function SignInDetails({
  entry,
  full,
  loading,
  error,
  link,
  now,
  onClose,
}: {
  entry: ActivityEntryResponse;
  full: ActivityEntryDetailResponse | undefined;
  loading: boolean;
  error: unknown;
  link: ReturnType<typeof subjectLink>;
  now: number;
  onClose: () => void;
}) {
  const result = resultOf(entry);
  const note = securityNote(entry);
  const usual = full?.usualClient ?? null;
  const unusual = isUnusualClient(entry.client, usual);
  const next = full?.next ?? null;
  const attempts = full?.attempts ?? null;

  return (
    <FormDialog
      title={entry.actor.name}
      description={ACTION_TITLE[entry.action]}
      onClose={onClose}
      size="lg"
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-0.5">
          <Status tone={result.tone} className="font-medium">
            {result.label}
          </Status>
          {note && <span className="text-sm text-fg-muted">{note}</span>}
        </div>

        {error !== null && <ErrorAlert error={error} />}
        {loading && <Spinner label="Loading what happened" />}

        {next && (
          <div
            className={cx(
              "flex flex-col gap-0.5 rounded-md border px-3 py-2.5 text-sm",
              next.action === "SIGN_IN_BLOCKED"
                ? "border-danger-line bg-danger-subtle"
                : "border-line-subtle bg-sunken",
            )}
          >
            <span className="font-semibold text-fg">What happened next</span>
            <span className="text-fg-muted">
              {ACTION_TITLE[next.action]} at {clockTime(next.occurredAt)}
              {securityNote(next) ? ` · ${securityNote(next)}` : ""}
            </span>
          </div>
        )}

        {attempts && attempts.length > 1 && (
          <Part title="Each attempt">
            <ol className="flex flex-col rounded-md border border-line-subtle">
              {attempts.map((at, index) => (
                <li
                  key={at}
                  className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 border-t border-line-subtle px-3 py-2 text-sm first:border-t-0"
                >
                  <span className="data text-xs text-fg-subtle">
                    {new Date(at).toLocaleTimeString()}
                  </span>
                  <span className="text-fg-muted">
                    Wrong password
                    {index === attempts.length - 1 &&
                    next?.action === "SIGN_IN_BLOCKED"
                      ? ", the last before sign-ins were blocked"
                      : ""}
                  </span>
                </li>
              ))}
            </ol>
          </Part>
        )}

        <Part title="Details">
          <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
            <dt className="text-fg-subtle">When</dt>
            <dd className="flex flex-col">
              <span className="text-fg">
                <LocalDateTime value={entry.occurredAt} />
              </span>
              <span className="text-xs text-fg-subtle">
                {timeAgo(entry.occurredAt, now)}
              </span>
            </dd>
            <dt className="text-fg-subtle">From</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <span className="data text-fg-muted">{clientText(entry.client)}</span>
              {unusual && <Status tone="warning">New for this account</Status>}
            </dd>
            <dt className="text-fg-subtle">Usually from</dt>
            <dd className="data text-fg-muted">
              {full === undefined
                ? "…"
                : usual
                  ? clientText(usual)
                  : "No sign-ins in the 30 days before"}
            </dd>
            <dt className="text-fg-subtle">Reference</dt>
            <dd className="data text-fg-muted">{entry.reference}</dd>
          </dl>
        </Part>

        <DialogActions>
          <p className="mr-auto text-xs text-fg-subtle">
            If this wasn&apos;t them, reset their password from Members.
          </p>
          {link && "href" in link && (
            <Link
              href={link.href}
              className={buttonClasses({ variant: "secondary" })}
            >
              {link.label}
            </Link>
          )}
          <Button onClick={onClose}>Done</Button>
        </DialogActions>
      </div>
    </FormDialog>
  );
}
