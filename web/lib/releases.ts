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
  vendor: string | null;
  source: string | null;
  endpoint_count: number;
  probe_url: string | null;
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

export type PriorResult = Pick<
  ServerResult,
  "address" | "vendor" | "software_version" | "release_month"
>;

export const EPIC = "Epic Systems Corporation";

const VENDOR_ALIASES: Record<string, string> = {
  [EPIC]: "Epic",
  "Medical Information Technology, Inc. (MEDITECH)": "MEDITECH",
};

/** Short display name for a CHPL developer: alias, else the name minus corporate suffixes. */
export function vendorLabel(vendor: string | null): string {
  if (!vendor) return "Unknown";
  if (VENDOR_ALIASES[vendor]) return VENDOR_ALIASES[vendor];
  let name = vendor;
  for (;;) {
    const next = name.replace(/,?\s+(Inc\.?|LLC|L\.L\.C\.|Corporation|Corp\.?|Co\.|Ltd\.?)$/i, "");
    if (next === name) return name;
    name = next;
  }
}

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

/**
 * Display name for a server: the organization(s) listed on it, or for a multi-tenant
 * host (more names than we store) the host itself.
 */
export function serverName(
  r: Pick<ServerResult, "endpoint_names" | "host" | "brand_count" | "source">
): string {
  if (r.source === "lantern" && r.brand_count > 3) return r.host ?? "Unknown";
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
