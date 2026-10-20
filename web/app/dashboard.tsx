"use client";

import { useMemo, useState } from "react";
import {
  ageLabel,
  customerKey,
  isStale,
  serverName,
  shortDate,
  type PriorResult,
  type ScanRun,
  type ServerResult,
} from "@/lib/releases";
import { signOut } from "./actions";
import ReleaseChart, { type ReleaseBucket } from "./release-chart";
import ServerTable from "./server-table";
import LocationSearch from "./location-search";

type Props = {
  latest: ScanRun;
  previous: ScanRun | null;
  history: ScanRun[];
  results: ServerResult[];
  prior: PriorResult[];
  userEmail: string | null;
};

const NO_RESPONSE = "No response";

export default function Dashboard({ latest, previous, history, results, prior, userEmail }: Props) {
  const asOf = useMemo(() => new Date(latest.started_at), [latest.started_at]);
  const [countBy, setCountBy] = useState<"servers" | "customers">("servers");
  const [releaseFilter, setReleaseFilter] = useState<string>("");

  const responding = results.filter((r) => r.software_version);
  const stale = responding.filter((r) => isStale(r, asOf));
  const failed = results.filter((r) => !r.software_version);

  const buckets = useMemo<ReleaseBucket[]>(() => {
    const map = new Map<string, ReleaseBucket & { customerSet: Set<string> }>();
    for (const r of results) {
      const label = r.software_version ?? NO_RESPONSE;
      const b =
        map.get(label) ??
        ({
          label,
          releaseMonth: r.release_month,
          servers: 0,
          customers: 0,
          stale: isStale(r, asOf),
          customerSet: new Set<string>(),
        } as ReleaseBucket & { customerSet: Set<string> });
      b.servers += 1;
      b.customerSet.add(customerKey(r));
      map.set(label, b);
    }
    return [...map.values()]
      .map(({ customerSet, ...b }) => ({ ...b, customers: customerSet.size }))
      .sort((a, b) => {
        if (!a.releaseMonth) return 1;
        if (!b.releaseMonth) return -1;
        return b.releaseMonth.localeCompare(a.releaseMonth);
      });
  }, [results, asOf]);

  const newest = buckets.find((b) => b.releaseMonth);
  const mostCommon = [...buckets]
    .filter((b) => b.releaseMonth)
    .sort((a, b) => b.servers - a.servers)[0];
  const customerCount = new Set(results.map(customerKey)).size;
  const staleCustomers = new Set(stale.map(customerKey)).size;
  const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "—");

  const changes = useMemo(() => {
    if (!previous) return null;
    const before = new Map(prior.map((p) => [p.address.toLowerCase(), p]));
    const upgraded: { r: ServerResult; from: string | null }[] = [];
    const added: ServerResult[] = [];
    let wentQuiet = 0;
    for (const r of results) {
      const p = before.get(r.address.toLowerCase());
      if (!p) added.push(r);
      else if (p.software_version && !r.software_version) wentQuiet += 1;
      else if (
        r.software_version &&
        p.software_version &&
        r.software_version !== p.software_version
      )
        upgraded.push({ r, from: p.software_version });
    }
    const now = new Set(results.map((r) => r.address.toLowerCase()));
    const removed = prior.filter((p) => !now.has(p.address.toLowerCase())).length;
    return { upgraded, added, removed, wentQuiet };
  }, [previous, prior, results]);

  const downloadCsv = () => {
    const cols = [
      "server",
      "customer",
      "release",
      "release_month",
      "age",
      "over_a_year_old",
      "brands",
      "locations",
      "states",
      "address",
      "error",
    ];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = results.map((r) =>
      [
        serverName(r),
        r.managing_orgs.join("; "),
        r.software_version,
        r.release_month,
        ageLabel(r.release_month, asOf),
        isStale(r, asOf) ? "yes" : "no",
        r.brand_count,
        r.location_count,
        r.states.join(" "),
        r.address,
        r.error,
      ]
        .map(esc)
        .join(",")
    );
    const blob = new Blob([[cols.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `epic-versions-${latest.started_at.slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <h1>Epic version tracker</h1>
          <p className="muted">
            Last scan {shortDate(latest.started_at)} · {latest.server_count} servers from{" "}
            {latest.endpoint_count} endpoints in Epic&rsquo;s Brands bundle
          </p>
        </div>
        <div className="topbar-actions">
          <button onClick={downloadCsv}>Download CSV</button>
          <form action={signOut}>
            <button type="submit" title={userEmail ?? undefined}>
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="stats">
        <div className="card hero">
          <span className="stat-label">Servers on a release over a year old</span>
          <span className="hero-value">{stale.length}</span>
          <span className="muted">
            {pct(stale.length, responding.length)} of responding servers · {staleCustomers}{" "}
            customers
          </span>
          {stale.length > 0 && (
            <button
              className="link"
              onClick={() => {
                setReleaseFilter("__stale");
                document.getElementById("servers")?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              Show them →
            </button>
          )}
        </div>
        <div className="card stat">
          <span className="stat-label">Servers scanned</span>
          <span className="stat-value">{results.length.toLocaleString()}</span>
          <span className="muted">{customerCount} Epic customers</span>
        </div>
        <div className="card stat">
          <span className="stat-label">On the newest release</span>
          <span className="stat-value">{newest?.servers ?? 0}</span>
          <span className="muted">
            {newest?.label} · {pct(newest?.servers ?? 0, responding.length)}
          </span>
        </div>
        <div className="card stat">
          <span className="stat-label">Most common release</span>
          <span className="stat-value small">{mostCommon?.label}</span>
          <span className="muted">{pct(mostCommon?.servers ?? 0, responding.length)} of servers</span>
        </div>
        <div className="card stat">
          <span className="stat-label">No response</span>
          <span className="stat-value">{failed.length}</span>
          <span className="muted">failed twice (timeout or HTTP error)</span>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <h2>{countBy === "servers" ? "Servers" : "Customers"} by release</h2>
            <p className="muted">
              {countBy === "servers"
                ? "Each unique FHIR server address counted once. Click a bar to filter the list."
                : "Each Epic customer (the endpoint's managing organization) counted once; customers with several addresses run one release."}
            </p>
          </div>
          <div className="segmented" role="group" aria-label="Count by">
            {(["servers", "customers"] as const).map((k) => (
              <button
                key={k}
                className={countBy === k ? "active" : ""}
                aria-pressed={countBy === k}
                onClick={() => setCountBy(k)}
              >
                {k === "servers" ? "Servers" : "Customers"}
              </button>
            ))}
          </div>
        </div>
        <ReleaseChart
          buckets={buckets}
          measure={countBy}
          selected={releaseFilter}
          onSelect={(label) => {
            setReleaseFilter((cur) => (cur === label ? "" : label));
            document.getElementById("servers")?.scrollIntoView({ behavior: "smooth" });
          }}
        />
      </section>

      {changes && (
        <section className="card">
          <h2>Since the previous scan ({shortDate(previous!.started_at)})</h2>
          <p className="muted">
            {changes.upgraded.length} servers changed release · {changes.added.length} new ·{" "}
            {changes.removed} no longer listed · {changes.wentQuiet} stopped responding
          </p>
          {changes.upgraded.length > 0 && (
            <ul className="changes">
              {changes.upgraded.map(({ r, from }) => (
                <li key={r.address}>
                  <strong>{serverName(r)}</strong>
                  <span className="muted">
                    {from} → {r.software_version}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <LocationSearch results={results} asOf={asOf} />

      <ServerTable
        results={results}
        asOf={asOf}
        releases={buckets.map((b) => b.label)}
        releaseFilter={releaseFilter}
        setReleaseFilter={setReleaseFilter}
      />

      <section className="card footnote">
        <h2>How this works</h2>
        <p className="muted">
          A weekly GitHub Action downloads Epic&rsquo;s public{" "}
          <a href="https://open.epic.com/Endpoints/Brands">Brands bundle</a>, requests{" "}
          <code>[address]/metadata</code> from every unique FHIR server with{" "}
          <code>Accept: application/fhir+json</code>, retries failures once, and records{" "}
          <code>software.version</code>. &ldquo;Over a year old&rdquo; means the release month is
          more than 12 months before the scan date. Method after Brendan Keeler,{" "}
          <a href="https://healthapiguy.substack.com/p/your-version-is-showing">
            &ldquo;Your Version Is Showing&rdquo;
          </a>
          .
        </p>
        <table className="history">
          <thead>
            <tr>
              <th>Scan</th>
              <th>Trigger</th>
              <th className="num">Servers</th>
              <th className="num">Failed</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <td>{shortDate(h.started_at)}</td>
                <td>{h.trigger}</td>
                <td className="num">{h.server_count}</td>
                <td className="num">{h.failure_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
