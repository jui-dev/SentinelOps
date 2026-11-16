"use client";

import {
  Archive,
  Check,
  Merge,
  Package,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";

import { incidentHref } from "@/components/incidents/incident-queries";
import { SeveritySelect } from "@/components/incidents/incidents-view";
import { incidentKey, SeverityMark } from "@/components/incidents/severity";
import {
  useCan,
  useOrganization,
} from "@/components/organizations/organization-scope";
import { useServices } from "@/components/services/service-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { DialogActions, FormDialog } from "@/components/ui/dialog";
import { howItWorksHref } from "@/components/app/shell-utilities";
import { EmptyNote } from "@/components/ui/empty-state";
import { FirstRun } from "@/components/ui/first-run";
import {
  FilterBar,
  FilterDivider,
  FilterGroup,
  FilterOption,
  FilterSearch,
  FilterSelect,
} from "@/components/ui/filter-bar";
import { Field, TextArea } from "@/components/ui/field";
import { linkClasses } from "@/components/ui/link";
import { PageBody, PageHeader } from "@/components/ui/page";
import {
  RequiredNote,
  SubmitHint,
  useRequiredFields,
} from "@/components/ui/required";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Duration } from "@/components/ui/timestamp";
import { ApiErrorCode, Permission } from "@/lib/api/contracts";
import type { IncidentSeverity, KnownIssueResponse } from "@/lib/api/contracts";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";

import {
  useAllKnownIssues,
  useCreateKnownIssue,
  useMergeKnownIssue,
  useUpdateKnownIssue,
} from "./known-issue-queries";
import { likelyDuplicateOf } from "./similarity";

const times = (total: number) =>
  total === 0 ? "Not happened yet" : total === 1 ? "Happened once" : `Happened ${total} times`;

const NAME_TAKEN =
  "This service already has a known issue with this name.";

/**
 * The problems each service has had before, kept by the Admin: the one
 * place they are added, renamed, archived and merged. Declaring offers them;
 * this page looks after them.
 *
 * Grouped by service. One saved while declaring something new is marked New
 * until the Admin keeps, edits or merges it, and one that looks like an
 * existing known issue says which, with Merge ready.
 */
export function KnownIssuesView() {
  // The Admin's. Anyone else reaching the address is told why it is empty.
  const canManage = useCan(Permission.SERVICES_MANAGE);

  if (!canManage) {
    return (
      <>
        <PageHeader width="full" title="Known issues" />
        <PageBody width="full">
          <EmptyNote title="The Admin keeps this list">
            Known issues are offered when an incident is declared. Each
            incident you can see says which one it is, if any.
          </EmptyNote>
        </PageBody>
      </>
    );
  }

  return <KnownIssuesList />;
}

type Dialog =
  | { kind: "add" }
  | { kind: "edit"; issue: KnownIssueResponse }
  | { kind: "merge"; issue: KnownIssueResponse };

function KnownIssuesList() {
  const organization = useOrganization();
  const knownIssues = useAllKnownIssues(organization.id);
  const services = useServices(organization.id);
  const update = useUpdateKnownIssue(organization.id);
  const [search, setSearch] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const all = knownIssues.data ?? [];
  const inUse = all.filter((issue) => !issue.archivedAt);
  const pending = inUse.filter((issue) => issue.pendingReview);
  const needle = search.trim().toLowerCase();
  const shown = all.filter(
    (issue) =>
      (showArchived || !issue.archivedAt) &&
      (!serviceId || issue.service.id === serviceId) &&
      (!needle || issue.name.toLowerCase().includes(needle)),
  );

  // By service, in name order; each keeps the API's most-frequent order.
  const groups = [...new Set(shown.map((issue) => issue.service.id))]
    .map((id) => shown.filter((issue) => issue.service.id === id))
    .sort((a, b) => a[0].service.name.localeCompare(b[0].service.name));

  return (
    <>
      <PageHeader
        width="full"
        title="Known issues"
        meta={knownIssues.data ? inUse.length : undefined}
        description="The problems each service has had before. Declaring an incident starts from these, and their repeats are counted."
        // While there are none, the page's own panel offers the first: one
        // place for the action.
        actions={
          (!knownIssues.data || all.length > 0) && (
            <Button icon={Plus} onClick={() => setDialog({ kind: "add" })}>
              Add known issue
            </Button>
          )
        }
      />
      <PageBody width="full">
        <div className="flex flex-col gap-4">
          {update.isError && <ErrorAlert error={update.error} />}
          {pending.length > 0 && (
            <p className="rounded-md border border-warning-line bg-warning-subtle px-4 py-3 text-sm text-warning-text">
              {pending.length === 1
                ? "1 known issue was saved while declaring something new."
                : `${pending.length} known issues were saved while declaring something new.`}{" "}
              Keep, edit or merge each one marked New.
            </p>
          )}
          {/* Nothing to find in an empty list. */}
          {(!knownIssues.data || all.length > 0) && (
          <FilterBar label="Find known issues">
            <FilterSearch
              label="Find a known issue"
              value={search}
              onChange={setSearch}
              placeholder="Issue name"
            />
            <FilterDivider />
            <FilterGroup label="Show">
              <FilterOption
                pressed={!showArchived}
                onClick={() => setShowArchived(false)}
                count={knownIssues.data ? inUse.length : undefined}
              >
                In use
              </FilterOption>
              <FilterOption
                pressed={showArchived}
                onClick={() => setShowArchived(true)}
                count={knownIssues.data ? all.length : undefined}
              >
                With archived
              </FilterOption>
            </FilterGroup>
            <FilterSelect
              label="Service"
              className="w-44"
              value={serviceId}
              onChange={(event) => setServiceId(event.target.value)}
            >
              <option value="">All services</option>
              {(services.data ?? []).map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </FilterSelect>
          </FilterBar>
          )}

          {knownIssues.isError ? (
            <ErrorAlert error={knownIssues.error} />
          ) : !knownIssues.data ? (
            <Spinner label="Loading known issues…" />
          ) : all.length === 0 ? (
            <FirstRun
              icon={Package}
              title="Keep your first known issue"
              action={
                <Button icon={Plus} onClick={() => setDialog({ kind: "add" })}>
                  Add known issue
                </Button>
              }
              learn={{
                href: `${howItWorksHref(organization.slug)}#step-report`,
                label: "How known issues are used",
              }}
            >
              <p>
                The problems your services tend to have — a slow database, a
                provider timing out. Declaring an incident can then start from
                one, and each time it comes back is counted. One saved while
                declaring something new shows up here too.
              </p>
            </FirstRun>
          ) : groups.length === 0 ? (
            <EmptyNote kind="noMatch" title="No known issues match">
              Try another search or service, or include archived ones.
            </EmptyNote>
          ) : (
            // Every service's group on one shared tray, each drawn as a table is.
            <div className="flex flex-col gap-2 rounded-lg bg-table-tray p-2">
            {groups.map((issues) => (
              <section
                key={issues[0].service.id}
                aria-labelledby={`known-${issues[0].service.id}`}
              >
                <div className="overflow-hidden rounded-md border border-line bg-surface shadow-[0_1px_2px_light-dark(rgb(15_29_51/0.08),transparent)]">
                  <h2
                    id={`known-${issues[0].service.id}`}
                    className="border-b border-table-head-line-subtle bg-list-head px-4 py-2.5 text-sm font-semibold text-list-head-fg"
                  >
                    {issues[0].service.name}
                    <span className="font-normal text-list-head-muted">
                      {" "}
                      · {issues[0].service.team.name} · {issues.length}{" "}
                      {issues.length === 1 ? "known issue" : "known issues"}
                    </span>
                  </h2>
                  <ul className="divide-y divide-line-subtle">
                    {issues.map((issue) => (
                      <KnownIssueRow
                        key={issue.id}
                        issue={issue}
                        duplicateOf={issue.pendingReview ? likelyDuplicateOf(issue, all) : undefined}
                        busy={update.isPending}
                        onEdit={() => setDialog({ kind: "edit", issue })}
                        onMerge={() => setDialog({ kind: "merge", issue })}
                        onKeep={() => update.mutate({ id: issue.id, reviewed: true })}
                        onArchive={(archived) => update.mutate({ id: issue.id, archived })}
                        canMerge={inUse.some(
                          (other) => other.id !== issue.id && other.service.id === issue.service.id,
                        )}
                      />
                    ))}
                  </ul>
                </div>
              </section>
            ))}
            </div>
          )}
        </div>
      </PageBody>
      {dialog?.kind === "add" && <KnownIssueDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === "edit" && (
        <KnownIssueDialog issue={dialog.issue} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "merge" && (
        <MergeDialog issue={dialog.issue} all={all} onClose={() => setDialog(null)} />
      )}
    </>
  );
}

function KnownIssueRow({
  issue,
  duplicateOf,
  busy,
  canMerge,
  onEdit,
  onMerge,
  onKeep,
  onArchive,
}: {
  issue: KnownIssueResponse;
  duplicateOf: KnownIssueResponse | undefined;
  busy: boolean;
  canMerge: boolean;
  onEdit: () => void;
  onMerge: () => void;
  onKeep: () => void;
  onArchive: (archived: boolean) => void;
}) {
  const organization = useOrganization();
  const { total, lastAt, active } = issue.occurrences;
  const archived = issue.archivedAt !== null;

  return (
    <li
      className={cx(
        "flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 transition-colors duration-(--duration-fast) hover:bg-list-hover hover:shadow-[inset_3px_0_0_var(--color-row-hover-edge)]",
        issue.pendingReview && !archived && "bg-warning-subtle/40",
      )}
    >
      <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className={cx("font-medium", archived ? "text-fg-muted" : "text-fg")}>
            {issue.name}
          </span>
          {issue.pendingReview && !archived && (
            <span className="inline-flex h-5 items-center rounded-full border border-accent-line bg-accent-subtle px-2 text-xs font-semibold text-accent-text">
              New
            </span>
          )}
          {archived && (
            <span className="inline-flex h-5 items-center rounded-full border border-line px-2 text-xs text-fg-muted">
              Archived
            </span>
          )}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-muted">
          <span className="inline-flex items-center gap-1">
            Usually <SeverityMark severity={issue.usualSeverity} />
          </span>
          <span aria-hidden="true">·</span>
          <span>{times(total)}</span>
          {active !== null ? (
            <>
              <span aria-hidden="true">·</span>
              <Link
                href={incidentHref(organization.slug, active)}
                className={cx("font-medium text-warning-text", linkClasses)}
              >
                Happening now: {incidentKey(active)}
              </Link>
            </>
          ) : (
            lastAt && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  Last <Duration from={lastAt} /> ago
                </span>
              </>
            )
          )}
        </p>
        {duplicateOf && (
          <p className="text-xs text-warning-text">
            Saved while declaring · looks like “{duplicateOf.name}”
          </p>
        )}
        {issue.pendingReview && !duplicateOf && !archived && (
          <p className="text-xs text-fg-muted">Saved while declaring something new</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {issue.pendingReview && !archived ? (
          <>
            {canMerge && (
              <Button icon={Merge} variant="edit" size="sm" onClick={onMerge}>
                Merge…
              </Button>
            )}
            <Button icon={Check}
              variant="add"
              size="sm"
              disabled={busy}
              onClick={onKeep}
              aria-label={`Keep ${issue.name}`}
            >
              Keep
            </Button>
            <Button icon={Pencil} variant="edit" size="sm" onClick={onEdit} aria-label={`Edit ${issue.name}`}>
              Edit
            </Button>
          </>
        ) : (
          <>
            <Button icon={Pencil} variant="edit" size="sm" onClick={onEdit} aria-label={`Edit ${issue.name}`}>
              Edit
            </Button>
            <Button icon={archived ? RotateCcw : Archive}
              variant={archived ? "restore" : "destructive"}
              size="sm"
              disabled={busy}
              onClick={() => onArchive(!archived)}
              aria-label={`${archived ? "Restore" : "Archive"} ${issue.name}`}
            >
              {archived ? "Restore" : "Archive"}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

/** Adds a known issue, or edits one: name, usual severity, description. */
function KnownIssueDialog({
  issue,
  onClose,
}: {
  issue?: KnownIssueResponse;
  onClose: () => void;
}) {
  const organization = useOrganization();
  const services = useServices(organization.id);
  const create = useCreateKnownIssue(organization.id);
  const update = useUpdateKnownIssue(organization.id);
  const save = issue ? update : create;
  const [name, setName] = useState(issue?.name ?? "");
  const [serviceId, setServiceId] = useState(issue?.service.id ?? "");
  const [severity, setSeverity] = useState<IncidentSeverity | "">(
    issue?.usualSeverity ?? "",
  );
  const [description, setDescription] = useState(issue?.description ?? "");
  const { attach, ...required } = useRequiredFields(severity);
  const fields = fieldErrorsOf(save.error);
  const nameTaken =
    isApiError(save.error, 409) && save.error.code === ApiErrorCode.KNOWN_ISSUE_NAME_TAKEN;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = {
      name,
      description,
      usualSeverity: severity as IncidentSeverity,
    };

    if (issue) {
      update.mutate({ id: issue.id, ...body }, { onSuccess: onClose });
    } else {
      create.mutate({ ...body, serviceId }, { onSuccess: onClose });
    }
  };

  return (
    <FormDialog
      title={issue ? "Edit known issue" : "Add known issue"}
      description={
        issue
          ? `One of ${issue.service.name}'s. Its incidents keep their own titles and severities.`
          : "A problem a service tends to have, so it can be chosen when declaring."
      }
      onClose={onClose}
    >
      <form ref={attach} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <RequiredNote />
        {save.isError && !nameTaken && Object.keys(fields).length === 0 && (
          <ErrorAlert error={save.error} />
        )}
        {issue ? (
          <p className="text-sm text-fg-muted">
            Service: <span className="text-fg">{issue.service.name}</span>
          </p>
        ) : (
          <Select
            label="Service"
            required
            value={serviceId}
            onChange={(event) => setServiceId(event.target.value)}
            error={fields.serviceId}
          >
            <option value="" disabled>
              Choose a service
            </option>
            {(services.data ?? [])
              .filter((service) => !service.archivedAt)
              .map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
          </Select>
        )}
        <Field
          label="Name"
          required
          maxLength={200}
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
          hint="What happens, as people would say it when it does."
          error={nameTaken ? NAME_TAKEN : fields.name}
        />
        <SeveritySelect
          value={severity}
          onChange={setSeverity}
          placeholder="Choose the usual severity"
          error={fields.usualSeverity}
        />
        <TextArea
          label="Description"
          optional
          maxLength={2000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          hint="What it looks like, and what usually fixes it."
          error={fields.description}
        />
        <DialogActions>
          <SubmitHint id={required.hintId} missing={required.missing} />
          <Button icon={X} variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button icon={issue ? Save : Plus}
            type="submit"
            disabled={save.isPending || !required.ready}
            aria-describedby={required.ready ? undefined : required.hintId}
          >
            {save.isPending ? "Saving…" : issue ? "Save changes" : "Add known issue"}
          </Button>
        </DialogActions>
      </form>
    </FormDialog>
  );
}

/** Folds one known issue into another of the same service. */
function MergeDialog({
  issue,
  all,
  onClose,
}: {
  issue: KnownIssueResponse;
  all: readonly KnownIssueResponse[];
  onClose: () => void;
}) {
  const organization = useOrganization();
  const merge = useMergeKnownIssue(organization.id);
  const candidates = all.filter(
    (other) =>
      other.id !== issue.id && other.service.id === issue.service.id && !other.archivedAt,
  );
  const [intoId, setIntoId] = useState(likelyDuplicateOf(issue, all)?.id ?? "");
  const { attach, ...required } = useRequiredFields(intoId);
  const count = issue.occurrences.total;

  return (
    <FormDialog
      title={`Merge “${issue.name}”`}
      description="Its incidents move to the known issue you choose, and it is removed from the list. Each incident keeps its own title."
      onClose={onClose}
    >
      <form
        ref={attach}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          merge.mutate({ id: issue.id, intoId }, { onSuccess: onClose });
        }}
        className="flex flex-col gap-4"
      >
        <RequiredNote />
        {merge.isError && <ErrorAlert error={merge.error} />}
        <Select
          label="Merge into"
          required
          value={intoId}
          onChange={(event) => setIntoId(event.target.value)}
          hint={`Only ${issue.service.name}'s known issues can be chosen.`}
        >
          <option value="" disabled>
            Choose a known issue
          </option>
          {candidates.map((other) => (
            <option key={other.id} value={other.id}>
              {other.name} · {times(other.occurrences.total).toLowerCase()}
            </option>
          ))}
        </Select>
        <DialogActions>
          <SubmitHint id={required.hintId} missing={required.missing} />
          <Button icon={X} variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button icon={Merge}
            type="submit"
            disabled={merge.isPending || !required.ready}
            aria-describedby={required.ready ? undefined : required.hintId}
          >
            {merge.isPending
              ? "Merging…"
              : count === 0
                ? "Merge"
                : `Merge ${count} ${count === 1 ? "incident" : "incidents"}`}
          </Button>
        </DialogActions>
      </form>
    </FormDialog>
  );
}
