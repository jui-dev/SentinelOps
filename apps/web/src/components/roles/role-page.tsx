"use client";

import { Check, ChevronRight, ListChecks, Route } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { initialsOf } from "@/components/app/shell-utilities";
import { useMemberships } from "@/components/organizations/membership-list";
import { useOrganization } from "@/components/organizations/organization-scope";
import { INSTRUMENT } from "@/components/overview/analytical-view-header";
import { OverviewPanel } from "@/components/overview/overview-panel";
import { cx } from "@/components/ui/cx";
import { EmptyNote } from "@/components/ui/empty-state";
import { linkClasses } from "@/components/ui/link";
import { PageBody } from "@/components/ui/page";
import type { Role } from "@/lib/api/contracts";

import {
  FLOW_ORDER,
  ROLE_CONTENT,
  roleFromSlug,
  roleHref,
  rolesHref,
} from "./role-content";
import { RoleBadge, ROLE_META } from "./role-meta";
import { LABEL, RoleIcon, peopleCount, useRoles } from "./roles-view";

/** The four roles as tabs, the one shown marked as the current page. */
function RoleTabs({ shown }: { shown: Role }) {
  const organization = useOrganization();
  const roles = useRoles(organization.id);
  const counts = new Map(roles.data?.map((each) => [each.role, each.memberCount]));

  return (
    <nav
      aria-label="Roles"
      className="flex flex-wrap gap-0.5 self-start rounded-lg border border-line-subtle bg-sunken p-0.75"
    >
      {FLOW_ORDER.map((role) => {
        const meta = ROLE_META[role];
        const on = role === shown;
        const count = counts.get(role);

        return (
          <Link
            key={role}
            href={roleHref(organization.slug, role)}
            aria-current={on ? "page" : undefined}
            className={cx(
              "inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm transition-colors duration-(--duration-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
              on
                ? cx("bg-surface font-semibold text-fg", meta.tone.underline)
                : "font-medium text-fg-muted hover:bg-hover hover:text-fg",
            )}
          >
            <span aria-hidden="true" className={cx("size-2 rounded-full", meta.tone.dot)} />
            {meta.label}
            {count !== undefined && (
              // How many hold it, at a glance; the role's page says so in words.
              <span
                aria-hidden="true"
                className={cx(
                  "numeric min-w-5 rounded-full px-1.5 text-center text-2xs leading-4 font-semibold",
                  on ? meta.tone.solid : "bg-line-subtle text-fg-muted",
                )}
              >
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/** Whoever holds the role, of the people the reader may see. */
function Holders({ role }: { role: Role }) {
  const organization = useOrganization();
  const memberships = useMemberships(organization.id);
  const roles = useRoles(organization.id);
  const people = memberships.data?.filter((member) => member.role === role) ?? [];
  const count =
    roles.data?.find((each) => each.role === role)?.memberCount ?? people.length;
  // Holders the reader may not see by name: counted, never listed.
  const unseen = count - people.length;

  return (
    <div
      className={cx(
        "flex w-full flex-col gap-2.5 rounded-lg border bg-hero-inset p-4 shadow-[0_1px_2px_light-dark(rgb(15_29_51/0.06),transparent)] sm:w-72",
        ROLE_META[role].tone.heroLine,
      )}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="text-2xs font-bold tracking-[0.08em] text-fg-subtle uppercase">
          Who has this role
        </span>
        <span className={cx("text-xs font-semibold", ROLE_META[role].tone.text)}>
          {peopleCount(count)}
        </span>
      </span>
      {count === 0 ? (
        <p className="rounded-lg border border-line-subtle bg-canvas px-3 py-2.5 text-sm text-fg-muted">
          Nobody yet.
        </p>
      ) : (
        // A fixed height, scrolling past about three, so the card keeps its
        // size however many hold the role.
        <div
          role="region"
          aria-label={`Who has the ${ROLE_META[role].label} role`}
          tabIndex={0}
          className="scrollbar-thin h-44 overflow-y-auto overscroll-contain rounded-md pr-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <ul className="flex flex-col gap-1.5">
            {people.map((person) => (
              <li
                key={person.id}
                className="flex items-center gap-2.5 rounded-lg border border-line-subtle bg-canvas px-3 py-2"
              >
                <span
                  aria-hidden="true"
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-hover text-xs font-semibold text-fg"
                >
                  {initialsOf(person.user.name)}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold text-fg">
                    {person.user.name}
                    {person.id === organization.membership.id && (
                      <span className="font-normal text-fg-subtle"> (you)</span>
                    )}
                  </span>
                  <span className="truncate text-xs text-fg-subtle">
                    {person.teams.length > 0
                      ? `On ${person.teams.map(({ name }) => name).join(", ")}`
                      : "On no team"}
                  </span>
                </span>
              </li>
            ))}
            {/* The count beside the label says how many; this, who is unseen. */}
            {unseen > 0 && people.length > 0 && (
              <li className="px-1 text-xs text-fg-subtle">
                and {peopleCount(unseen)} more
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * One role in detail, for anyone: what it is for, when it acts over an
 * incident's life, what it can do and whose job the rest is, where it works,
 * and what is put in front of it. Read-only, like the Roles page above it.
 */
export function RolePage() {
  const organization = useOrganization();
  const params = useParams<{ role: string }>();
  const role = roleFromSlug(params.role ?? "");

  if (!role) {
    return (
      <PageBody width="full">
        <EmptyNote title="There is no such role">
          SentinelOps has four roles.{" "}
          <Link href={rolesHref(organization.slug)} className={linkClasses}>
            See them all
          </Link>
          .
        </EmptyNote>
      </PageBody>
    );
  }

  const meta = ROLE_META[role];
  const content = ROLE_CONTENT[role];
  const yours = organization.membership.role === role;

  return (
    <PageBody width="full" className="pt-8">
      <div className="flex flex-col gap-5">
        <RoleTabs shown={role} />
        <header
          className={cx(
            "flex flex-wrap items-start justify-between gap-x-10 gap-y-6 rounded-lg border p-7 shadow-card",
            meta.tone.hero,
          )}
        >
          <div className="flex min-w-0 flex-[1_1_32rem] items-start gap-5">
            <RoleIcon role={role} size="lg" raised />
            <div className="flex flex-col gap-2">
              <span className={cx("text-sm font-semibold", meta.tone.text)}>
                {content.place}
              </span>
              <h1 className="flex flex-wrap items-center gap-3 text-3xl font-semibold text-fg">
                {meta.label}
                {yours && <RoleBadge role={role} className="text-2xs" />}
              </h1>
              <p className="max-w-xl text-base leading-relaxed text-fg-muted">
                {meta.purpose}
              </p>
            </div>
          </div>
          <Holders role={role} />
        </header>
      </div>

      {/*
       * Two sections in the Overview's frame, as the Roles page's are: a
       * header with its icon, label and description, and the content on its
       * own panel (INSTRUMENT) — the darkest ground in dark, white in light.
       */}
      <OverviewPanel
        id="when"
        title={`When ${/^[AEIOU]/.test(meta.label) ? "an" : "a"} ${meta.label} acts`}
        icon={Route}
        family="flow"
        label={<span className={LABEL}>{content.moments.length} moments</span>}
        description="Over one incident's life."
      >
        <div className={cx(INSTRUMENT, "p-4 sm:p-6")}>
          <ol
            className={cx(
              "grid gap-6 sm:grid-cols-2",
              content.moments.length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4",
            )}
          >
            {content.moments.map((moment, index) => (
              <li key={moment.title} className="relative flex flex-col gap-2 pt-7">
                <span
                  aria-hidden="true"
                  className={cx(
                    "absolute top-0 left-0 size-3.5 rounded-full border-2 ring-4 ring-ink",
                    meta.tone.line,
                    meta.tone.subtle,
                  )}
                />
                {index < content.moments.length - 1 && (
                  <span
                    aria-hidden="true"
                    className={cx(
                      "absolute top-1.5 right-[-1.5rem] left-5 hidden h-0.5 border-t-2 lg:block",
                      meta.tone.line,
                    )}
                  />
                )}
                <span
                  className={cx(
                    "text-2xs font-bold tracking-[0.08em] uppercase",
                    meta.tone.text,
                  )}
                >
                  {moment.when}
                </span>
                <span className="text-[15px] font-semibold text-fg">
                  {moment.title}
                </span>
                <span className="text-sm leading-relaxed text-fg-muted">
                  {moment.text}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </OverviewPanel>

      <OverviewPanel
        id="jobs"
        title="Jobs"
        icon={ListChecks}
        family="decision"
        label={<span className={LABEL}>{content.can.length} it can do</span>}
        description="What this role does, what someone else does, and where it's told."
      >
        <div className="flex flex-col gap-3">
          <div className={cx(INSTRUMENT, "grid items-stretch gap-5 p-4 sm:p-5 lg:grid-cols-3")}>
            <div className="flex flex-col gap-4 rounded-lg border border-line-subtle bg-surface p-6">
              <h3 className="text-2xs font-bold tracking-[0.08em] text-success-text uppercase">
                Can
              </h3>
              <ul className="flex flex-col gap-3">
                {content.can.map((text) => (
                  <li key={text} className="flex items-start gap-2.5 text-sm text-fg">
                    <Check
                      aria-hidden="true"
                      strokeWidth={2.5}
                      className="mt-0.5 size-4 shrink-0 text-success-text"
                    />
                    {text}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-4 rounded-lg border border-line-subtle bg-surface p-6">
              <h3 className="text-2xs font-bold tracking-[0.08em] text-fg-subtle uppercase">
                Someone else does
              </h3>
              <ul className="flex flex-col gap-3">
                {content.elsewhere.map(({ text, role: whose }) => (
                  <li
                    key={text}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm text-fg-muted"
                  >
                    {text}
                    <Link
                      href={roleHref(organization.slug, whose)}
                      aria-label={`${text}: the ${ROLE_META[whose].label}`}
                      className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                      <RoleBadge role={whose} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-4 rounded-lg border border-line-subtle bg-surface p-6">
              <h3 className="text-2xs font-bold tracking-[0.08em] text-fg-subtle uppercase">
                Where, and what they&apos;re told
              </h3>
              <ul className="flex flex-col gap-2">
                {content.where(organization.slug).map((place) => {
                  const body = (
                    <>
                      <span className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium text-fg">
                          {place.label}
                        </span>
                        <span className="text-xs text-fg-subtle">
                          {place.detail}
                        </span>
                      </span>
                      {place.href && (
                        <ChevronRight
                          aria-hidden="true"
                          className="ml-auto size-4 shrink-0 text-fg-subtle"
                        />
                      )}
                    </>
                  );

                  return (
                    <li key={place.label}>
                      {place.href ? (
                        <Link
                          href={place.href}
                          className="flex items-center gap-3 rounded-lg border border-line-subtle bg-sunken px-3.5 py-2.5 hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                        >
                          {body}
                        </Link>
                      ) : (
                        <div className="flex items-center gap-3 rounded-lg border border-line-subtle bg-sunken px-3.5 py-2.5">
                          {body}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              <ul className="flex flex-col gap-2.5 border-t border-line-subtle pt-4">
                {content.told.map((item) => (
                  <li key={item.title} className="flex items-start gap-2.5 text-sm">
                    <span
                      aria-hidden="true"
                      className={cx(
                        "mt-1.5 size-2 shrink-0 rounded-full border",
                        meta.tone.line,
                        meta.tone.subtle,
                      )}
                    />
                    <span>
                      <span className="font-semibold text-fg">{item.title}</span>
                      <span className="text-fg-muted"> · {item.text}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="text-sm text-fg-muted">
            The same rules SentinelOps checks every time.
          </p>
        </div>
      </OverviewPanel>

    </PageBody>
  );
}
