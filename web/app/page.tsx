import { createClient } from "@/lib/supabase/server";
import type { PriorResult, ScanRun, ServerResult } from "@/lib/releases";
import Dashboard from "./dashboard";

export const dynamic = "force-dynamic";

const PAGE = 1000; // PostgREST's default max rows per request

async function fetchAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

export default async function Home() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: runs, error } = await supabase
    .from("scan_runs")
    .select("*")
    .eq("status", "complete")
    .order("id", { ascending: false })
    .limit(12);
  if (error) throw error;

  const latest = (runs?.[0] ?? null) as ScanRun | null;
  const previous = (runs?.[1] ?? null) as ScanRun | null;

  if (!latest) {
    return (
      <main className="page">
        <h1>Epic version tracker</h1>
        <p className="muted">
          No completed scans yet{user ? "" : " (or this login isn't on the reader list)"}. Run the
          scan workflow in GitHub Actions to load data.
        </p>
      </main>
    );
  }

  const [results, prior] = await Promise.all([
    fetchAll<ServerResult>((from, to) =>
      supabase
        .from("server_results")
        .select(
          "address,host,endpoint_names,managing_orgs,brand_count,location_count,states,software_name,software_version,release_month,build_date,fhir_version,attempts,error"
        )
        .eq("run_id", latest.id)
        .order("address")
        .range(from, to)
    ),
    previous
      ? fetchAll<PriorResult>((from, to) =>
          supabase
            .from("server_results")
            .select("address,software_version,release_month")
            .eq("run_id", previous.id)
            .order("address")
            .range(from, to)
        )
      : Promise.resolve([] as PriorResult[]),
  ]);

  return (
    <Dashboard
      latest={latest}
      previous={previous}
      history={(runs ?? []) as ScanRun[]}
      results={results}
      prior={prior}
      userEmail={user?.email ?? null}
    />
  );
}
