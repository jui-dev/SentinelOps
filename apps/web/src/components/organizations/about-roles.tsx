"use client";

import { Info, X } from "lucide-react";
import { useId, useState } from "react";

import { cx } from "@/components/ui/cx";
import { Popover } from "@/components/ui/popover";

const BADGE =
  "self-start rounded-sm border px-2 py-px text-xs font-semibold";

/** What each role does, in a few plain words. Fixed: two roles, no editing. */
const ROLES = [
  {
    name: "Admin",
    badge: "border-accent-line bg-accent-subtle text-accent-text",
    frame: "border-accent-line",
    does: [
      "Sets up teams, services and members",
      "Declares, triages and resolves incidents",
      "Sees every incident and the organization's history",
    ],
  },
  {
    name: "Member",
    badge: "border-line-strong bg-hover text-fg-muted",
    frame: "border-line",
    does: [
      "Responds to incidents on their teams' services",
      "Posts updates and writes analyses they own",
      "Sees the incidents they're responsible for",
    ],
  },
];

/**
 * "About roles": what an Admin and a Member each do, opened beside the
 * Members page's description. A reference, not a setting — the roles are
 * fixed, and each organization has one Admin.
 */
export function AboutRoles() {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      labelledBy={titleId}
      className="absolute top-full left-0 z-20 mt-2 w-[min(32rem,calc(100vw-2rem))]"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          className="inline-flex items-center gap-1.5 rounded-sm text-sm text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <Info aria-hidden="true" className="size-3.5" />
          About roles
        </button>
      )}
    >
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <h2 id={titleId} className="flex-1 text-sm font-semibold text-fg">
            Roles in SentinelOps
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="grid size-7 place-items-center rounded-md text-fg-subtle hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
          >
            <X aria-hidden="true" className="size-3.5" />
            <span className="sr-only">Close</span>
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {ROLES.map((role) => (
            <section
              key={role.name}
              aria-label={role.name}
              className={cx(
                "flex flex-col gap-2 rounded-md border bg-surface p-3",
                role.frame,
              )}
            >
              <span className={cx(BADGE, role.badge)}>{role.name}</span>
              <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-fg-muted">
                {role.does.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="text-xs text-fg-subtle">
          Each organization has one Admin: whoever created it. Everyone added
          afterwards is a Member, and their teams decide what they respond to.
        </p>
      </div>
    </Popover>
  );
}
