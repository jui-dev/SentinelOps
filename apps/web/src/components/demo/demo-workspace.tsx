"use client";

import {
  Boxes,
  FilePenLine,
  FlaskConical,
  History,
  Info,
  Lock,
  Package,
  Plus,
  RefreshCw,
  ScrollText,
  Siren,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { useOrganization } from "@/components/organizations/organization-scope";
import { INSTRUMENT } from "@/components/overview/analytical-view-header";
import { OverviewPanel } from "@/components/overview/overview-panel";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { DialogActions, FormDialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { LocalDateTime } from "@/components/ui/timestamp";
import type {
  DemoPart,
  DemoPartResponse,
  DemoWorkspaceResponse,
} from "@/lib/api/contracts";

import { useDemoAction, useDemoWorkspace } from "./demo-queries";
import type { DemoAction } from "./demo-queries";

/** What each part is, in words: the Settings page's copy. */
const PARTS: Record<
  DemoPart,
  { name: string; short: string; icon: LucideIcon; text: string; unit: (n: number) => string }
> = {
  accounts: {
    name: "Organization and demo accounts",
    short: "Demo accounts",
    icon: UserRound,
    text: "AcmePay, and seven people to sign in as — an Admin, an Incident Manager, a Reporter and four Responders. All share one password.",
    unit: (n) => `${n} ${n === 1 ? "account" : "accounts"}`,
  },
  teams: {
    name: "Teams",
    short: "Teams",
    icon: Users,
    text: "Payments, Platform and Risk, and who is on each. A Responder sees and works only their teams’ incidents.",
    unit: (n) => `${n} ${n === 1 ? "team" : "teams"}`,
  },
  services: {
    name: "Services",
    short: "Services",
    icon: Boxes,
    text: "Payment API, Authentication and Fraud Detection, each owned by a team. Every incident is declared against one.",
    unit: (n) => `${n} ${n === 1 ? "service" : "services"}`,
  },
  knownIssues: {
    name: "Known issues",
    short: "Known issues",
    icon: Package,
    text: "Problems that come back, so declaring can start from one — and an incident can say it happened before.",
    unit: (n) => `${n} known ${n === 1 ? "issue" : "issues"}`,
  },
  history: {
    name: "Incident history",
    short: "Incident history",
    icon: History,
    text: "26 weeks of resolved incidents: who responded, every update, the resolution notes. Feeds the Overview’s trends and Incident history.",
    unit: (n) => `${n} resolved`,
  },
  live: {
    name: "Live incidents",
    short: "Live incidents",
    icon: Siren,
    text: "Five incidents happening now: one needs a decision, one a responder, two are being investigated, one is ready to resolve.",
    unit: (n) => `${n} active`,
  },
  analyses: {
    name: "Incident analyses",
    short: "Incident analyses",
    icon: FilePenLine,
    text: "Write-ups of the biggest incidents — six published, two drafts — so the Learn step has something to read.",
    unit: (n) => `${n} ${n === 1 ? "analysis" : "analyses"}`,
  },
  activity: {
    name: "Activity log",
    short: "Activity log",
    icon: ScrollText,
    text: "The last week’s setup changes and sign-ins, including one blocked sign-in.",
    unit: (n) => `${n} ${n === 1 ? "entry" : "entries"}`,
  },
};

/** A part's count as a removal lists it: "5 live incidents". */
const LISTED: Record<DemoPart, (n: number) => string> = {
  accounts: (n) => `${n} demo ${n === 1 ? "account" : "accounts"}`,
  teams: (n) => `${n} ${n === 1 ? "team" : "teams"}`,
  services: (n) => `${n} ${n === 1 ? "service" : "services"}`,
  knownIssues: (n) => `${n} known ${n === 1 ? "issue" : "issues"}`,
  history: (n) => `${n} resolved ${n === 1 ? "incident" : "incidents"}`,
  live: (n) => `${n} live ${n === 1 ? "incident" : "incidents"}`,
  analyses: (n) => `${n} incident ${n === 1 ? "analysis" : "analyses"}`,
  activity: (n) => `${n} activity log ${n === 1 ? "entry" : "entries"}`,
};

const OPTIONAL_COUNT = 5;

/** "Demo loaded", "Essentials only", …: the workspace in two words. */
const standing = (workspace: DemoWorkspaceResponse) => {
  const optional = workspace.parts.filter((part) => !part.required);
  const loaded = optional.filter((part) => part.loaded).length;
  const teams = workspace.parts.find((part) => part.id === "teams")!;

  if (workspace.complete) return { title: "Full demo loaded", note: "every part" };
  if (!teams.loaded) return { title: "Demo data removed", note: "accounts kept" };
  if (loaded === 0) return { title: "Essentials only", note: "no incidents yet" };

  return {
    title: "Partly loaded",
    note: `${loaded} of ${OPTIONAL_COUNT} optional parts`,
  };
};

function Tile({
  label,
  value,
  note,
  wash,
}: {
  label: string;
  value: ReactNode;
  note: ReactNode;
  wash: string;
}) {
  return (
    <div className={cx("card-wash flex flex-col gap-1 rounded-md border px-4 py-3 shadow-card", wash)}>
      <dt className="label-caps text-fg-subtle">{label}</dt>
      <dd className="flex flex-col">
        <span className="text-base font-semibold text-fg">{value}</span>
        <span className="text-xs text-fg-muted">{note}</span>
      </dd>
    </div>
  );
}

function PartRow({
  part,
  busy,
  onAct,
}: {
  part: DemoPartResponse;
  busy: boolean;
  onAct: (action: DemoAction) => void;
}) {
  const copy = PARTS[part.id];
  const Icon = copy.icon;

  return (
    <li className="grid gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[2.25rem_minmax(0,1fr)_8.5rem_13.5rem] sm:items-center">
      <span
        aria-hidden="true"
        className="hidden size-9 place-items-center rounded-md border border-line text-fg-muted sm:grid"
      >
        <Icon strokeWidth={1.75} className="size-4" />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm font-semibold text-fg">{copy.name}</p>
        <p className="text-sm text-fg-muted">{copy.text}</p>
        {part.needs.length > 0 && (
          <p className="flex flex-wrap items-center gap-1.5 pt-1 text-xs text-fg-subtle">
            Needs
            {part.needs.map((need) => (
              <span key={need} className="rounded-full border border-line px-2 py-px text-fg-muted">
                {PARTS[need].short}
              </span>
            ))}
          </p>
        )}
      </div>
      <p className="flex flex-col text-xs text-fg-muted">
        <span
          className={cx(
            "inline-flex items-center gap-1.5 font-semibold",
            part.loaded ? "text-status-resolved-text" : "text-fg-subtle",
          )}
        >
          <span
            aria-hidden="true"
            className={cx(
              "size-2 rounded-full",
              part.loaded ? "bg-current" : "border-[1.5px] border-current",
            )}
          />
          {part.loaded ? "Loaded" : "Not loaded"}
        </span>
        {part.loaded && <span className="numeric">{copy.unit(part.count)}</span>}
      </p>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {part.id === "accounts" ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-fg-subtle">
            <Lock aria-hidden="true" className="size-3" /> Always kept
          </span>
        ) : part.loaded ? (
          <>
            <Button
              size="sm"
              variant="restore"
              icon={RefreshCw}
              disabled={busy}
              onClick={() => onAct({ kind: "generate", part: part.id })}
              aria-label={`Regenerate ${copy.name}`}
            >
              Regenerate
            </Button>
            {part.required ? (
              <span
                title="Removed only with all the demo data"
                className="inline-flex items-center gap-1.5 text-xs text-fg-subtle"
              >
                <Lock aria-hidden="true" className="size-3" /> Needed
              </span>
            ) : (
              <Button
                size="sm"
                variant="destructive"
                icon={Trash2}
                disabled={busy}
                onClick={() => onAct({ kind: "remove", part: part.id })}
                aria-label={`Remove ${copy.name}`}
              >
                Remove
              </Button>
            )}
          </>
        ) : (
          <Button
            size="sm"
            variant="add"
            icon={Plus}
            disabled={busy}
            onClick={() => onAct({ kind: "generate", part: part.id })}
            aria-label={`Generate ${copy.name}`}
          >
            Generate
          </Button>
        )}
      </div>
    </li>
  );
}

function PartGroup({
  title,
  tag,
  text,
  parts,
  busy,
  onAct,
}: {
  title: string;
  tag: "Required" | "Optional";
  text: string;
  parts: DemoPartResponse[];
  busy: boolean;
  onAct: (action: DemoAction) => void;
}) {
  return (
    <section aria-label={title} className={cx(INSTRUMENT, "overflow-hidden")}>
      {/* A band in its own colour, so each group's head stands out. */}
      <div
        className={cx(
          "flex flex-wrap items-center gap-x-3 gap-y-1 bg-linear-to-r px-4 py-3",
          tag === "Required"
            ? "from-group-required-from to-group-required-to"
            : "from-group-optional-from to-group-optional-to",
        )}
      >
        <span className="rounded-full border border-group-fg/40 bg-group-fg/15 px-2 py-0.5 text-2xs font-bold tracking-[0.05em] text-group-fg uppercase">
          {tag}
        </span>
        <h3 className="text-sm font-semibold text-group-fg">{title}</h3>
        <p className="text-sm text-group-fg-muted">{text}</p>
      </div>
      <ul className="divide-y divide-line-subtle">
        {parts.map((part) => (
          <PartRow key={part.id} part={part} busy={busy} onAct={onAct} />
        ))}
      </ul>
    </section>
  );
}

/** The parts a removal takes with it, loaded ones only. */
const takenWith = (workspace: DemoWorkspaceResponse, part: DemoPart): DemoPart[] => {
  const found: DemoPart[] = [];
  const visit = (current: DemoPart) => {
    for (const candidate of workspace.parts) {
      if (candidate.needs.includes(current) && !found.includes(candidate.id)) {
        found.push(candidate.id);
        visit(candidate.id);
      }
    }
  };

  visit(part);

  return found.filter((id) => workspace.parts.find((p) => p.id === id)!.loaded);
};

function ConfirmReset({
  onConfirm,
  onClose,
  busy,
}: {
  onConfirm: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  return (
    <FormDialog
      title="Reset the demo?"
      description="AcmePay goes back to the full demo, its history moved forward to end today."
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <Lists
          gone={{ title: "Replaced", items: ["Every incident, known issue, analysis and activity entry", "Changes to the teams and services", "Changes to the demo accounts’ roles and teams"] }}
          kept={{ title: "Kept", items: ["The organization", "The seven demo accounts and their password", "Anyone you added"] }}
        />
        <DialogActions>
          <Button variant="quiet" icon={X} onClick={onClose}>
            Cancel
          </Button>
          <Button icon={RefreshCw} onClick={onConfirm} disabled={busy}>
            {busy ? "Resetting…" : "Reset demo"}
          </Button>
        </DialogActions>
      </div>
    </FormDialog>
  );
}

function Lists({
  gone,
  kept,
}: {
  gone: { title: string; items: string[] };
  kept: { title: string; items: string[] };
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-md border border-danger-line bg-danger-subtle px-3.5 py-3">
        <p className="label-caps text-danger-text">{gone.title}</p>
        <ul className="mt-1.5 flex flex-col gap-1 text-sm text-fg">
          {gone.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <div className="rounded-md border border-status-resolved-line bg-status-resolved-subtle px-3.5 py-3">
        <p className="label-caps text-status-resolved-text">{kept.title}</p>
        <ul className="mt-1.5 flex flex-col gap-1 text-sm text-fg">
          {kept.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const CONFIRM_WORD = "REMOVE";

function ConfirmRemoveAll({
  workspace,
  onConfirm,
  onClose,
  busy,
}: {
  workspace: DemoWorkspaceResponse;
  onConfirm: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  const [typed, setTyped] = useState("");
  const ready = typed.trim() === CONFIRM_WORD;
  const gone = workspace.parts
    .filter((part) => part.id !== "accounts" && part.loaded)
    .map((part) => LISTED[part.id](part.count));

  return (
    <FormDialog
      title="Remove the demo data?"
      description="Everything generated in AcmePay is deleted. It cannot be undone, but it can be generated again from here."
      onClose={onClose}
      closeOnBackdrop={false}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) onConfirm();
        }}
      >
        <Lists
          gone={{ title: "Removed", items: gone.length > 0 ? gone : ["Nothing is loaded"] }}
          kept={{ title: "Kept", items: ["The organization, AcmePay", "The seven demo accounts", "Anyone you added"] }}
        />
        <Field
          label={`Type ${CONFIRM_WORD} to confirm`}
          required
          autoComplete="off"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
        <DialogActions>
          {!ready && (
            <span className="mr-auto text-xs text-fg-muted">
              Type {CONFIRM_WORD} to continue.
            </span>
          )}
          <Button variant="quiet" icon={X} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" icon={Trash2} disabled={!ready || busy}>
            {busy ? "Removing…" : "Remove demo data"}
          </Button>
        </DialogActions>
      </form>
    </FormDialog>
  );
}

function ConfirmRemovePart({
  workspace,
  part,
  onConfirm,
  onClose,
  busy,
}: {
  workspace: DemoWorkspaceResponse;
  part: DemoPart;
  onConfirm: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  const withIt = takenWith(workspace, part);

  return (
    <FormDialog title={`Remove ${PARTS[part].name.toLowerCase()}?`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-fg-muted">
          {withIt.length > 0
            ? `${withIt.map((id) => PARTS[id].name).join(" and ")} ${withIt.length === 1 ? "needs" : "need"} it, so ${withIt.length === 1 ? "it goes" : "they go"} too.`
            : "Nothing else needs it. You can generate it again at any time."}
        </p>
        <DialogActions>
          <Button variant="quiet" icon={X} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" icon={Trash2} onClick={onConfirm} disabled={busy}>
            {busy ? "Removing…" : "Remove"}
          </Button>
        </DialogActions>
      </div>
    </FormDialog>
  );
}

type Asking =
  | { kind: "reset" }
  | { kind: "removeAll" }
  | { kind: "remove"; part: DemoPart }
  | null;

/**
 * The demo workspace, in Settings: a demo organization's parts — what
 * SentinelOps needs to work, and what only makes it look lived-in — each
 * with its count and the buttons that generate, regenerate or remove it,
 * then resetting the whole demo, or removing its data with the accounts
 * kept. Only for a demo organization, in development; the API answers
 * nothing else.
 */
export function DemoWorkspace() {
  const organization = useOrganization();
  const workspace = useDemoWorkspace(organization.id, organization.demo);
  const action = useDemoAction(organization.id);
  const [asking, setAsking] = useState<Asking>(null);
  const busy = action.isPending;

  const act = (next: DemoAction) => {
    // Generating is safe to do at once; removing and resetting ask first.
    if (next.kind === "generate") {
      action.mutate(next);
    } else {
      setAsking(next.kind === "remove" ? { kind: "remove", part: next.part } : { kind: next.kind });
    }
  };
  const confirm = (next: DemoAction) =>
    action.mutate(next, { onSettled: () => setAsking(null) });

  if (!organization.demo) return null;

  const data = workspace.data;
  const teams = data?.parts.find((part) => part.id === "teams");
  const removed = teams !== undefined && !teams.loaded;
  const state = data && standing(data);
  const hasHistory = data?.parts.some(
    (part) => (part.id === "history" || part.id === "live") && part.loaded,
  );

  return (
    <OverviewPanel
      id="demo-workspace"
      title="Demo workspace"
      icon={FlaskConical}
      family="waiting"
      label={
        <span className="inline-flex items-center rounded-full border border-line bg-surface px-2 py-0.5 text-xs font-medium text-fg-muted">
          Only on this machine
        </span>
      }
      description="AcmePay is a demo organization: everything in it is generated. Manage it here, part by part."
      actions={
        removed && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="add"
              icon={Plus}
              disabled={busy}
              onClick={() => action.mutate({ kind: "generate", part: "services" })}
            >
              Generate essentials
            </Button>
            <Button
              icon={FlaskConical}
              disabled={busy}
              onClick={() => action.mutate({ kind: "reset" })}
            >
              Generate full demo
            </Button>
          </div>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {workspace.isError && <ErrorAlert error={workspace.error} />}
        {action.isError && <ErrorAlert error={action.error} />}
        {!data ? (
          !workspace.isError && <Spinner label="Loading the demo workspace…" />
        ) : (
          <>
            {busy && (
              <p role="status" className="text-sm text-fg-muted">
                Working on the demo…
              </p>
            )}
            {removed && (
              <div className="flex gap-2.5 rounded-md border border-warning-line bg-warning-subtle px-3.5 py-3 text-sm text-fg">
                <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-text" />
                <p>
                  <span className="font-semibold">The demo data is removed.</span>{" "}
                  The organization and the seven demo accounts are kept, so you can sign in
                  and bring it back. Generate the essentials to make SentinelOps usable, or
                  the full demo for everything.
                </p>
              </div>
            )}
            {/* On an inner panel of their own: white in light, the darkest ground in dark. */}
            <dl
              aria-label="The demo at a glance"
              className={cx(INSTRUMENT, "grid gap-2.5 p-3 sm:grid-cols-2 xl:grid-cols-4")}
            >
              <Tile
                label="Status"
                value={state!.title}
                note={state!.note}
                wash={data.complete ? "wash-mint" : "wash-sand"}
              />
              <Tile
                label="Last reset"
                value={data.lastResetAt ? <LocalDateTime value={data.lastResetAt} /> : "Never"}
                note={data.lastResetBy ? `by ${data.lastResetBy.name}` : "since it was set up"}
                wash="wash-steel"
              />
              <Tile
                label="History ends"
                value={
                  data.historyEndsAt && hasHistory
                    ? new Date(data.historyEndsAt).toLocaleDateString(undefined, {
                        timeZone: "UTC",
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })
                    : "—"
                }
                note={data.historyEndsAt && hasHistory ? "moves forward on reset" : "no history loaded"}
                wash="wash-steel"
              />
              <Tile label="Lives on" value="This machine" note="development only" wash="wash-steel" />
            </dl>
            <PartGroup
              title="Needed for SentinelOps to work"
              tag="Required"
              text="Without these nobody can declare or respond to an incident."
              parts={data.parts.filter((part) => part.required)}
              busy={busy}
              onAct={act}
            />
            <PartGroup
              title="Makes it look lived-in"
              tag="Optional"
              text="Each can be generated or removed on its own; what it needs is generated first."
              parts={data.parts.filter((part) => !part.required)}
              busy={busy}
              onAct={act}
            />
            {!removed && (
              <div className="grid gap-3 md:grid-cols-2">
                <div className={cx(INSTRUMENT, "flex flex-col items-start gap-2 px-4 py-3.5")}>
                  <p className="flex items-center gap-2 text-sm font-semibold text-fg">
                    <RefreshCw aria-hidden="true" className="size-4" /> Reset demo
                  </p>
                  <p className="text-sm text-fg-muted">
                    Back to the full demo, with its history moved forward to end today.
                    Anything changed in AcmePay — incidents declared, teams renamed — is
                    replaced.
                  </p>
                  <Button icon={RefreshCw} disabled={busy} onClick={() => act({ kind: "reset" })}>
                    Reset demo…
                  </Button>
                </div>
                <div className={cx(INSTRUMENT, "flex flex-col items-start gap-2 border-danger-line px-4 py-3.5")}>
                  <p className="flex items-center gap-2 text-sm font-semibold text-danger-text">
                    <Trash2 aria-hidden="true" className="size-4" /> Remove demo data
                  </p>
                  <p className="text-sm text-fg-muted">
                    Clears every part above except the organization and the demo accounts.
                    Bring it back from here at any time.
                  </p>
                  <Button
                    variant="destructive"
                    icon={Trash2}
                    disabled={busy}
                    onClick={() => act({ kind: "removeAll" })}
                  >
                    Remove demo data…
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {asking?.kind === "reset" && (
        <ConfirmReset
          busy={busy}
          onClose={() => setAsking(null)}
          onConfirm={() => confirm({ kind: "reset" })}
        />
      )}
      {asking?.kind === "removeAll" && data && (
        <ConfirmRemoveAll
          workspace={data}
          busy={busy}
          onClose={() => setAsking(null)}
          onConfirm={() => confirm({ kind: "removeAll" })}
        />
      )}
      {asking?.kind === "remove" && data && (
        <ConfirmRemovePart
          workspace={data}
          part={asking.part}
          busy={busy}
          onClose={() => setAsking(null)}
          onConfirm={() => confirm({ kind: "remove", part: asking.part })}
        />
      )}
    </OverviewPanel>
  );
}
