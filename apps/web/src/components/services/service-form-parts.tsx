"use client";

import { Select } from "@/components/ui/select";
import type { ServiceCriticality } from "@/lib/api/contracts";

import { CRITICALITY_LEVELS, criticalityOf } from "./criticality";

/** Shared by creating and editing a service. */

export const SERVICE_NAME_TAKEN_MESSAGE =
  "A service with this name, or a very similar one, already exists.";

export const OWNER_TEAM_GONE_MESSAGE =
  "That team no longer exists. The list of teams has been refreshed.";

/**
 * The criticality picker, with the chosen level's definition beneath it so
 * the words mean the same thing to everyone choosing them.
 */
export function CriticalitySelect({
  value,
  onChange,
  error,
}: {
  value: ServiceCriticality;
  onChange: (value: ServiceCriticality) => void;
  error?: string;
}) {
  return (
    <Select
      label="Criticality"
      name="criticality"
      value={value}
      onChange={(event) => onChange(event.target.value as ServiceCriticality)}
      hint={criticalityOf(value).definition}
      error={error}
    >
      {CRITICALITY_LEVELS.map((level) => (
        <option key={level.value} value={level.value}>
          {level.label}
        </option>
      ))}
    </Select>
  );
}
