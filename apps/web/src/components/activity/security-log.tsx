"use client";

import { Fragment, useMemo, useState } from "react";

import { useMemberships } from "@/components/organizations/membership-list";
import { useOrganization } from "@/components/organizations/organization-scope";
import { roleMeta } from "@/components/roles/role-meta";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableEmpty,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui/table";
import { useMinuteClock } from "@/components/ui/timestamp";
import type {
  ActivityEntryResponse,
  ActivityFilters,
  SecurityAction,
} from "@/lib/api/contracts";

import {
  clientText,
  clockTime,
  dayKey,
  PERIODS,
  periodStart,
  resultOf,
  SECURITY_RESULTS,
  securityNote,
} from "./activity-meta";
import type { PeriodValue } from "./activity-meta";
import { useActivity } from "./activity-queries";
import { DayHeading } from "./day-heading";
import { EntryDetails } from "./entry-details";
import { ResultPill } from "./result-pill";
import { useSettled } from "./use-settled";
import { ViewButton } from "./view-button";

/**
 * Every sign-in to a member's account, and every wrong password, block and
 * password change, newest first. Three totals say at a glance whether
 * anything needs a look; wrong passwords tried one after another read as one
 * row, and a block stands out.
 */
export function SecurityLog() {
  const organization = useOrganization();
  const memberships = useMemberships(organization.id);
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<SecurityAction | "">("");
  const [period, setPeriod] = useState<PeriodValue>("7d");
  const [since, setSince] = useState(() => periodStart("7d", Date.now()));
  const [open, setOpen] = useState<ActivityEntryResponse | null>(null);
  const q = useSettled(search.trim());
  const now = useMinuteClock();

  const filters: ActivityFilters = {
    result: result || undefined,
    q: q || undefined,
    since,
  };
  const log = useActivity(organization.id, "security", filters);
  const entries = useMemo(
    () => log.data?.pages.flatMap((page) => page.entries) ?? [],
    [log.data],
  );
  const totals = log.data?.pages[0]?.securityTotals ?? null;
  const periodLabel = PERIODS.find((each) => each.value === period)?.label;
  const inPeriod =
    period === "all" ? "in all" : `in the ${periodLabel?.toLowerCase()}`;
  const roleOf = (userId: string) =>
    memberships.data?.find((member) => member.user.id === userId)?.role;

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-3 sm:grid-cols-3">
        <Total value={totals?.signIns} label={`Sign-ins ${inPeriod}`} />
        <Total
          value={totals?.failedSignIns}
          label="Wrong passwords"
          tone={totals && totals.failedSignIns > 0 ? "warning" : undefined}
        />
        <Total
          value={totals?.blocked}
          label="Sign-ins blocked for 15 minutes"
          tone={totals && totals.blocked > 0 ? "danger" : undefined}
        />
      </dl>

      {/* The filters on a sunken panel of their own, apart from the results. */}
      <div
        role="search"
        aria-label="Filter the sign-ins"
        className="flex flex-wrap items-end gap-3 rounded-md border border-line-subtle bg-sunken px-4 py-3.5"
      >
        <div className="min-w-56 flex-1">
          <Field
            label="Search"
            type="search"
            placeholder="A person's name…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="w-48">
          <Select
            label="Result"
            value={result}
            onChange={(event) =>
              setResult(event.target.value as SecurityAction | "")
            }
          >
            <option value="">All results</option>
            {SECURITY_RESULTS.map((each) => (
              <option key={each.value} value={each.value}>
                {each.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <Select
            label="Period"
            value={period}
            onChange={(event) => {
              const next = event.target.value as PeriodValue;

              setPeriod(next);
              setSince(periodStart(next, Date.now()));
            }}
          >
            {PERIODS.map((each) => (
              <option key={each.value} value={each.value}>
                {each.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {log.isError && <ErrorAlert error={log.error} />}

      {log.isPending ? (
        <Spinner label="Loading the sign-ins" />
      ) : (
        <Table label="Sign-ins and security" variant="operational" fixed>
          <colgroup>
            <col className="w-20" />
            <col />
            <col className="w-52" />
            <col className="w-72" />
            <col className="w-24" />
          </colgroup>
          <THead>
            <tr>
              <TH>When</TH>
              <TH>Result</TH>
              <TH>Account</TH>
              <TH>From</TH>
              <TH>
                <span className="sr-only">Details</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {entries.length === 0 && (
              <TableEmpty columns={5}>
                {result || q
                  ? "No sign-ins match these filters."
                  : period === "all"
                    ? "Nobody has signed in yet."
                    : `Nobody signed in ${inPeriod}.`}
              </TableEmpty>
            )}
            {entries.map((entry, index) => {
              const newDay =
                index === 0 ||
                dayKey(entry.occurredAt) !==
                  dayKey(entries[index - 1].occurredAt);

              return (
                <Fragment key={entry.id}>
                  {newDay && (
                    <DayHeading
                      at={entry.occurredAt}
                      now={now}
                      count={
                        entries.filter(
                          (other) => dayKey(other.occurredAt) === dayKey(entry.occurredAt),
                        ).length
                      }
                      noun="event"
                      columns={5}
                    />
                  )}
                  <SignInRow
                    entry={entry}
                    role={roleOf(entry.actor.id)}
                    onView={() => setOpen(entry)}
                  />
                </Fragment>
              );
            })}
          </TBody>
        </Table>
      )}

      {log.hasNextPage && (
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            disabled={log.isFetchingNextPage}
            onClick={() => void log.fetchNextPage()}
          >
            {log.isFetchingNextPage ? "Loading…" : "Show older"}
          </Button>
        </div>
      )}

      {open && (
        <EntryDetails
          organizationId={organization.id}
          orgSlug={organization.slug}
          entry={open}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

/** One of the three totals: a number and what it counts. */
function Total({
  value,
  label,
  tone,
}: {
  value: number | undefined;
  label: string;
  tone?: "warning" | "danger";
}) {
  return (
    <div className="flex flex-col-reverse gap-0.5 rounded-md border border-line-subtle bg-surface px-4 py-3">
      <dt className="text-xs text-fg-subtle">{label}</dt>
      <dd
        className={cx(
          "numeric text-2xl font-semibold",
          tone === "warning" && "text-warning-text",
          tone === "danger" && "text-danger-text",
          tone === undefined && "text-fg",
        )}
      >
        {value ?? "—"}
      </dd>
    </div>
  );
}

function SignInRow({
  entry,
  role,
  onView,
}: {
  entry: ActivityEntryResponse;
  role: string | undefined;
  onView: () => void;
}) {
  const result = resultOf(entry);
  const note = securityNote(entry);
  const blocked = entry.action === "SIGN_IN_BLOCKED";

  return (
    <TR className={cx(blocked && "[&>td]:bg-danger-subtle")}>
      <TD kind="data" className="pt-3 align-top">
        <time dateTime={entry.occurredAt} title={new Date(entry.occurredAt).toLocaleString()}>
          {clockTime(entry.occurredAt)}
        </time>
      </TD>
      <TD className="py-2.5 align-top">
        <span className="flex flex-col items-start gap-1">
          <ResultPill entry={entry} />
          {note && <span className="text-xs text-fg-subtle">{note}</span>}
        </span>
      </TD>
      <TD className="py-2.5 align-top">
        <span className="flex flex-col">
          <span className="truncate font-medium text-fg">{entry.actor.name}</span>
          {role && (
            <span className="truncate text-xs text-fg-subtle">
              {roleMeta(role).label}
            </span>
          )}
        </span>
      </TD>
      <TD kind="data" className="truncate pt-3 align-top">
        {clientText(entry.client)}
      </TD>
      <TD kind="actions" className="pt-2 align-top">
        <ViewButton
          label={`View details: ${result.label}, ${entry.actor.name}`}
          onClick={onView}
        />
      </TD>
    </TR>
  );
}
