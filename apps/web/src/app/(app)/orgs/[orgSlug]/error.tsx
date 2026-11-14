"use client";

import { ErrorContent } from "@/components/app/fallback-pages";
import { PageBody } from "@/components/ui/page";

/**
 * An error in one of an organization's pages. Only the page is replaced:
 * the rail and the strip above it stay, so every other page is a click
 * away, and Try again re-renders this one.
 */
export default function OrganizationPageError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <PageBody width="form">
      <div className="mt-6 rounded-lg border border-line bg-surface px-5 py-6 sm:px-7">
        <ErrorContent error={error} retry={retry} />
      </div>
    </PageBody>
  );
}
