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
import type { ActivityEntryResponse } from "@/lib/api/contracts";

import {
  ACTION_TITLE,
  AREA_META,
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
