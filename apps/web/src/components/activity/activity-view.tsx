"use client";

import { Lock } from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import { useMemberships } from "@/components/organizations/membership-list";
import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { roleMeta } from "@/components/roles/role-meta";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyNote } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs } from "@/components/ui/tabs";
import { useMinuteClock } from "@/components/ui/timestamp";
import {
  Table,
  TableEmpty,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui/table";
import { Permission } from "@/lib/api/contracts";
import type {
  ActivityEntryResponse,
  ActivityFilters,
  ChangeArea,
} from "@/lib/api/contracts";

import {
  AREA_META,
  CHANGE_AREAS,
  dayHeading,
  dayKey,
  formatValue,
  inlineChange,
  noteOf,
  PERIODS,
  periodStart,
  sentenceOf,
  sentenceText,
} from "./activity-meta";
import type { PeriodValue } from "./activity-meta";
import { useActivity } from "./activity-queries";
import { AreaLabel, EntryDetails } from "./entry-details";
import { SecurityLog } from "./security-log";
import { useSettled } from "./use-settled";
import { ViewButton } from "./view-button";

const VIEWS = [
  { value: "changes", label: "Changes" },
  { value: "security", label: "Sign-ins & security" },
] as const;

type View = (typeof VIEWS)[number]["value"];

/**
 * The organization's activity log, on two tabs: every change to its setup,
 * by whom and when; and every sign-in to a member's account. Sign-ins come
 * many times a day, so they have a tab of their own rather than burying the
 * changes. The Admin's alone; anyone else reaching the address is told so.
 */
export function ActivityView() {
  const canRead = useCan(Permission.ACTIVITY_READ);
  const [view, setView] = useState<View>("changes");

  if (!canRead) {
    return (
      <>
        <PageHeader width="full" title="Activity log" />
        <PageBody width="full">
          <EmptyNote title="Only the Admin sees the activity log">
            It records every change to the organization&apos;s setup, and
            who made it.
          </EmptyNote>
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader
        width="full"
        title="Activity log"
        description="Every change to your organization's setup, and every sign-in: who, when, and from where."
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line-subtle px-3 py-1 text-xs text-fg-subtle">
            <Lock aria-hidden="true" className="size-3" />
            Only Admins can see this page
          </span>
        }
      />
      <PageBody width="full">
        <Tabs label="Activity" tabs={VIEWS} value={view} onChange={setView}>
          {view === "changes" ? <ChangesLog /> : <SecurityLog />}
        </Tabs>
      </PageBody>
    </>
  );
}

function ChangesLog() {
  const organization = useOrganization();
  const memberships = useMemberships(organization.id);
  const [search, setSearch] = useState("");
  const [area, setArea] = useState<ChangeArea | undefined>(undefined);
  const [actorId, setActorId] = useState("");
  const [period, setPeriod] = useState<PeriodValue>("7d");
  // The period's start is fixed when it is chosen, so the query keeps one key.
  const [since, setSince] = useState(() => periodStart("7d", Date.now()));
  const [open, setOpen] = useState<ActivityEntryResponse | null>(null);
  const q = useSettled(search.trim());

  const filters: ActivityFilters = {
    area,
    actorId: actorId || undefined,
    q: q || undefined,
    since,
  };
  const log = useActivity(organization.id, "changes", filters);
  const entries = useMemo(
    () => log.data?.pages.flatMap((page) => page.entries) ?? [],
    [log.data],
  );
  const counts = log.data?.pages[0]?.areaCounts ?? null;
  const total = counts
    ? Object.values(counts).reduce((sum, count) => sum + count, 0)
    : null;

  // Who did it, by account: their name is on the entry, their role here.
  const people = useMemo(
    () =>
      [...(memberships.data ?? [])].sort((a, b) =>
        a.user.name.localeCompare(b.user.name),
      ),
    [memberships.data],
  );
  const roleOf = (userId: string) =>
    people.find((member) => member.user.id === userId)?.role;

  const now = useMinuteClock();
  const filtered = Boolean(area || actorId || q);
  const periodLabel = PERIODS.find((each) => each.value === period)?.label;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Field
            label="Search"
            type="search"
            placeholder="People, teams, services…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="w-52">
          <Select
            label="Done by"
            value={actorId}
            onChange={(event) => setActorId(event.target.value)}
          >
            <option value="">Anyone</option>
            {people.map((member) => (
              <option key={member.id} value={member.user.id}>
                {member.user.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-48">
          <Select
            label="Area"
            value={area ?? ""}
            onChange={(event) =>
              setArea((event.target.value || undefined) as ChangeArea | undefined)
            }
          >
            <option value="">
              {total === null ? "All areas" : `All areas (${total})`}
            </option>
            {CHANGE_AREAS.map((each) => (
              <option key={each} value={each}>
                {counts
                  ? `${AREA_META[each].label} (${counts[each]})`
                  : AREA_META[each].label}
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
        <Spinner label="Loading the activity log" />
      ) : (
        <Table label="Changes" variant="operational" fixed>
          <colgroup>
            <col className="w-20" />
            <col className="w-48" />
            <col />
            <col className="w-40" />
            <col className="w-24" />
          </colgroup>
          <THead>
            <tr>
              <TH>When</TH>
              <TH>Done by</TH>
              <TH>What happened</TH>
              <TH>Area</TH>
              <TH>
                <span className="sr-only">Details</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {entries.length === 0 && (
              <TableEmpty columns={5}>
                {filtered
                  ? "No changes match these filters. Try another person, area or search."
                  : period === "all"
                    ? "Nothing has been changed yet. Changes appear here as they are made."
                    : `Nothing was changed in the ${periodLabel?.toLowerCase()}.`}
              </TableEmpty>
            )}
            {entries.map((entry, index) => {
              const newDay =
                index === 0 ||
                dayKey(entry.occurredAt) !== dayKey(entries[index - 1].occurredAt);

              return (
                <Fragment key={entry.id}>
                  {newDay && (
                    <tr>
                      <th
                        scope="colgroup"
                        colSpan={5}
                        className="border-b border-line-subtle bg-canvas px-3 py-1.5 text-left text-xs font-semibold text-fg-muted sm:px-4"
                      >
                        {dayHeading(entry.occurredAt, now)}
                      </th>
                    </tr>
                  )}
                  <ChangeRow
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

      {entries.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-fg-subtle">
          <span className="numeric">
            Showing {entries.length}{" "}
            {entries.length === 1 ? "change" : "changes"}
            {periodLabel && period !== "all"
              ? ` from the ${periodLabel.toLowerCase()}`
              : ""}
          </span>
          {log.hasNextPage && (
            <Button
              variant="secondary"
              size="sm"
              disabled={log.isFetchingNextPage}
              onClick={() => void log.fetchNextPage()}
            >
              {log.isFetchingNextPage ? "Loading…" : "Show older"}
            </Button>
          )}
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

function ChangeRow({
  entry,
  role,
  onView,
}: {
  entry: ActivityEntryResponse;
  role: string | undefined;
  onView: () => void;
}) {
  const sentence = sentenceOf(entry);
  const inline = inlineChange(entry);
  const note = noteOf(entry);

  return (
    <TR>
      <TD kind="data" className="align-top pt-3">
        <time
          dateTime={entry.occurredAt}
          title={new Date(entry.occurredAt).toLocaleString()}
        >
          {new Date(entry.occurredAt).toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
      </TD>
      <TD className="align-top py-2.5">
        <span className="flex flex-col">
          <span className="truncate font-medium text-fg">{entry.actor.name}</span>
          {role && (
            <span className="truncate text-xs text-fg-subtle">
              {roleMeta(role).label}
            </span>
          )}
        </span>
      </TD>
      <TD className="align-top py-2.5">
        <span className="flex flex-col gap-1">
          <span className="text-fg">
            {sentence.before}
            {sentence.target && (
              <>
                {" "}
                <strong className="font-semibold">{sentence.target}</strong>
              </>
            )}
            {sentence.after && ` ${sentence.after}`}
          </span>
          {inline && (
            <span className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="rounded-xs border border-line bg-sunken px-1.5 text-fg-muted">
                {formatValue(inline.change.field, inline.change.before)}
              </span>
              <span aria-hidden="true" className="text-fg-subtle">
                →
              </span>
              <span className="sr-only">to</span>
              <span className="rounded-xs border border-line-strong px-1.5 text-fg">
                {formatValue(inline.change.field, inline.change.after)}
              </span>
              {inline.more > 0 && (
                <span className="text-fg-subtle">
                  and {inline.more} more {inline.more === 1 ? "change" : "changes"}
                </span>
              )}
            </span>
          )}
          {note && <span className="text-xs text-fg-subtle">{note}</span>}
        </span>
      </TD>
      <TD className="align-top pt-3">
        <AreaLabel area={entry.area} />
      </TD>
      <TD kind="actions" className="align-top pt-2">
        <ViewButton
          label={`View details: ${sentenceText(entry)}`}
          onClick={onView}
        />
      </TD>
    </TR>
  );
}
