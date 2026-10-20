// Shared shapes and release-age helpers. Epic ships quarterly (Feb / May / Aug / Nov) and
// each server reports its release as CapabilityStatement.software.version, e.g. "February 2026".

export type ScanRun = {
  id: number;
  started_at: string;
  finished_at: string | null;
  trigger: string | null;
  bundle_last_updated: string | null;
  endpoint_count: number | null;
  server_count: number | null;
  success_count: number | null;
  failure_count: number | null;
};

export type ServerResult = {
  address: string;
  host: string | null;
  endpoint_names: string[];
  managing_orgs: string[];
  brand_count: number;
  location_count: number;
  states: string[];
  software_name: string | null;
  software_version: string | null;
  release_month: string | null; // YYYY-MM-01
  build_date: string | null;
  fhir_version: string | null;
  attempts: number | null;
  error: string | null;
};

export type PriorResult = Pick<ServerResult, "address" | "software_version" | "release_month">;

export const STALE_MONTHS = 12;

export function monthsBetween(releaseMonth: string, asOf: Date): number {
  const [y, m] = releaseMonth.split("-").map(Number);
  return (asOf.getUTCFullYear() - y) * 12 + (asOf.getUTCMonth() + 1 - m);
}

/** "Over a year old" means the release month is more than 12 months before the scan. */
export function isStale(r: Pick<ServerResult, "release_month">, asOf: Date): boolean {
  return r.release_month != null && monthsBetween(r.release_month, asOf) > STALE_MONTHS;
}

export function ageLabel(releaseMonth: string | null, asOf: Date): string {
  if (!releaseMonth) return "—";
  const months = monthsBetween(releaseMonth, asOf);
  if (months <= 0) return "current";
  if (months < 12) return `${months} mo`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest ? `${years} yr ${rest} mo` : `${years} yr`;
}

/** Display name for a server: the brand(s) Epic lists on its endpoint entry. */
export function serverName(r: Pick<ServerResult, "endpoint_names" | "host">): string {
  return r.endpoint_names.join(" · ") || r.host || "Unknown";
}

/** The Epic customer that runs the instance; falls back to the server name. */
export function customerKey(r: ServerResult): string {
  return r.managing_orgs[0] ?? serverName(r);
}

export function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
