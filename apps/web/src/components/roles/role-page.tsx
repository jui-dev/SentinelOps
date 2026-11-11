"use client";

import { ArrowLeft, Check, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { initialsOf } from "@/components/app/shell-utilities";
import { useMemberships } from "@/components/organizations/membership-list";
import { useOrganization } from "@/components/organizations/organization-scope";
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
import { RoleIcon, SectionHeading, peopleCount, useRoles } from "./roles-view";

/** The four roles as tabs, the one shown marked as the current page. */
function RoleTabs({ shown }: { shown: Role }) {
  const organization = useOrganization();

  return (
    <nav
      aria-label="Roles"
      className="flex flex-wrap gap-1.5 self-start rounded-xl border border-line-subtle bg-sunken p-1.5"
    >
      {FLOW_ORDER.map((role) => {
        const meta = ROLE_META[role];
        const on = role === shown;

        return (
          <Link
            key={role}
            href={roleHref(organization.slug, role)}
            aria-current={on ? "page" : undefined}
            className={cx(
              "inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-sm font-medium transition-colors duration-(--duration-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
              on
                ? cx(meta.tone.subtle, meta.tone.line, meta.tone.text)
                : "border-transparent text-fg-muted hover:bg-hover hover:text-fg",
            )}
          >
            <span
              aria-hidden="true"
              className={cx("size-2 rounded-full border", meta.tone.line, meta.tone.subtle)}
            />
            {meta.label}
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
  const shown = people.slice(0, 3);
  const others = count - shown.length;

  return (
    <div className="flex w-full flex-col gap-2.5 sm:w-64">
      <span className="text-2xs font-bold tracking-[0.08em] text-fg-subtle uppercase">
        Who has this role
      </span>
      {count === 0 ? (
        <p className="rounded-lg border border-line-subtle bg-canvas px-3 py-2.5 text-sm text-fg-muted">
          Nobody yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {shown.map((person) => (
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
          {others > 0 && (
            <li className="px-1 text-xs text-fg-subtle">
              {shown.length === 0
                ? peopleCount(others)
                : `and ${peopleCount(others)} more`}
            </li>
          )}
        </ul>
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
      <PageBody width="list">
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
    <PageBody width="list" className="pt-8">
      <div className="flex flex-col gap-5">
        <nav aria-label="Breadcrumb" className="text-sm text-fg-subtle">
          <Link
            href={rolesHref(organization.slug)}
            className="inline-flex items-center gap-1 rounded-sm hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            Roles
          </Link>
        </nav>
        <RoleTabs shown={role} />
        <header
          className={cx(
            "flex flex-wrap items-start justify-between gap-x-10 gap-y-6 rounded-2xl border bg-linear-to-br to-surface to-60% p-7",
            meta.tone.wash,
            meta.tone.line,
          )}
        >
          <div className="flex min-w-0 flex-[1_1_32rem] items-start gap-5">
            <RoleIcon role={role} size="lg" />
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

      <section aria-labelledby="when-h" className="flex flex-col gap-6">
        <SectionHeading
          id="when-h"
          title={`When ${/^[AEIOU]/.test(meta.label) ? "an" : "a"} ${meta.label} acts`}
          aside="Over one incident's life"
        />
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
                  "absolute top-0 left-0 size-3.5 rounded-full border-2 ring-4 ring-canvas",
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
      </section>

      <section aria-labelledby="jobs-h" className="flex flex-col gap-6">
        <SectionHeading
          id="jobs-h"
          title="Jobs"
          aside="The same rules SentinelOps checks every time"
        />
        <div className="grid items-stretch gap-5 lg:grid-cols-3">
          <div className="flex flex-col gap-4 rounded-xl border border-line-subtle bg-surface p-6">
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
          <div className="flex flex-col gap-4 rounded-xl border border-line-subtle bg-surface p-6">
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
          <div className="flex flex-col gap-4 rounded-xl border border-line-subtle bg-surface p-6">
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
      </section>

      <Link
        href={rolesHref(organization.slug)}
        className={cx(linkClasses, "self-start text-sm font-medium")}
      >
        ← Compare all roles
      </Link>
    </PageBody>
  );
}
