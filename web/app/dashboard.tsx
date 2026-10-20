"use client";

import { useEffect, useMemo, useState } from "react";
import {
  EPIC,
  ageLabel,
  customerKey,
  isStale,
  serverName,
  shortDate,
  vendorLabel,
  type PriorResult,
  type ScanRun,
  type ServerResult,
} from "@/lib/releases";
import { signOut } from "./actions";
import BarChart, { type Bucket, type Measure } from "./bar-chart";
import ServerTable, { type VersionOption } from "./server-table";
import LocationSearch from "./location-search";

type Props = {
  latest: ScanRun;
  previous: ScanRun | null;
  history: ScanRun[];
  results: ServerResult[];
  prior: PriorResult[];
  userEmail: string | null;
};

const TOP_VENDORS = 15;
const TOP_VERSIONS = 12;
const NONE = "__none"; // no response
const NO_VERSION = "__noversion"; // responded, reported no software.version
const OTHER = "__other";
const REPORTED = "__reported";
const STALE = "__stale";

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "—");

type Agg = { servers: number; endpoints: number; customers: Set<string> };
const emptyAgg = (): Agg => ({ servers: 0, endpoints: 0, customers: new Set() });
const add = (a: Agg, r: ServerResult) => {
  a.servers += 1;
  a.endpoints += r.endpoint_count;
  a.customers.add(customerKey(r));
};

export default function Dashboard({ latest, previous, history, results, prior, userEmail }: Props) {
  const asOf = useMemo(() => new Date(latest.started_at), [latest.started_at]);
  const [ehr, setEhrState] = useState<string>(""); // "" = all EHRs
  const [measure, setMeasure] = useState<Measure>("servers");
  const [versionFilter, setVersionFilter] = useState<string>("");

  // Keep the EHR choice in the URL so a filtered view can be bookmarked or shared.
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("ehr");
    if (v) setEhrState(v);
  }, []);
  const setEhr = (v: string) => {
    setEhrState(v);
    setVersionFilter("");
    if (v !== EPIC) setMeasure((m) => (m === "customers" ? "servers" : m));
    const url = new URL(window.location.href);
    if (v) url.searchParams.set("ehr", v);
    else url.searchParams.delete("ehr");
    window.history.replaceState(null, "", url);
  };

  const vendors = useMemo(() => {
    const m = new Map<string, Agg>();
    for (const r of results) {
      const v = r.vendor ?? "Unknown";
      if (!m.has(v)) m.set(v, emptyAgg());
      add(m.get(v)!, r);
    }
    return [...m.entries()]
      .map(([vendor, a]) => ({ vendor, servers: a.servers, endpoints: a.endpoints }))
      .sort((a, b) => b.servers - a.servers || a.vendor.localeCompare(b.vendor));
  }, [results]);

  const scoped = useMemo(
    () => (ehr ? results.filter((r) => (r.vendor ?? "Unknown") === ehr) : results),
    [results, ehr]
  );
  const isEpic = ehr === EPIC;

  const versionCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of scoped)
      if (r.software_version) c.set(r.software_version, (c.get(r.software_version) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [scoped]);

  // Top versions for the selected EHR; the rest fold into "Other versions".
  const topVersions = useMemo(
    () => new Set(ehr ? versionCounts.slice(0, TOP_VERSIONS).map(([v]) => v) : []),
    [versionCounts, ehr]
  );

  const keyOf = useMemo(
    () =>
      (r: ServerResult): string => {
        if (r.error) return NONE;
        if (!r.software_version) return NO_VERSION;
        if (!ehr) return REPORTED;
        return topVersions.has(r.software_version) ? r.software_version : OTHER;
      },
    [ehr, topVersions]
  );

  const buckets = useMemo<Bucket[]>(() => {
    const toBucket = (key: string, label: string, a: Agg, kind: Bucket["kind"]): Bucket => ({
      key,
      label,
      servers: a.servers,
      endpoints: a.endpoints,
      customers: a.customers.size,
      kind,
    });
    if (!ehr) {
      // All EHRs: one bar per developer, top N by the chosen measure + Other.
      const m = new Map<string, Agg>();
      for (const r of results) {
        const k = r.vendor ?? "Unknown";
        if (!m.has(k)) m.set(k, emptyAgg());
        add(m.get(k)!, r);
      }
      const all = [...m.entries()]
        .map(([k, a]) => toBucket(k, vendorLabel(k), a, "current"))
        .sort((a, b) => b[measure] - a[measure]);
      const top = all.slice(0, TOP_VENDORS);
      const rest = all.slice(TOP_VENDORS);
      if (rest.length) {
        top.push({
          key: OTHER,
          label: `${rest.length} other EHRs`,
          servers: rest.reduce((s, b) => s + b.servers, 0),
          endpoints: rest.reduce((s, b) => s + b.endpoints, 0),
          customers: rest.reduce((s, b) => s + b.customers, 0),
          kind: "current",
        });
      }
      return top;
    }
    const m = new Map<string, { a: Agg; month: string | null; stale: boolean }>();
    for (const r of scoped) {
      const k = keyOf(r);
      if (!m.has(k)) m.set(k, { a: emptyAgg(), month: r.release_month, stale: isStale(r, asOf) });
      add(m.get(k)!.a, r);
    }
    const label = (k: string) =>
      k === NONE ? "No response" : k === NO_VERSION ? "No version reported" : k === OTHER ? "Other versions" : k;
    const special = (k: string) => (k === NONE ? 3 : k === NO_VERSION ? 2 : k === OTHER ? 1 : 0);
    return [...m.entries()]
      .map(([k, { a, stale }]) =>
        toBucket(k, label(k), a, k === NONE || k === NO_VERSION ? "none" : stale ? "stale" : "current")
      )
      .sort((a, b) => {
        const s = special(a.key) - special(b.key);
        if (s) return s;
        if (isEpic) return (m.get(b.key)!.month ?? "").localeCompare(m.get(a.key)!.month ?? "");
        return b[measure] - a[measure];
      });
  }, [results, scoped, ehr, isEpic, keyOf, measure, asOf]);

  const versionOptions: VersionOption[] = ehr
    ? [
        ...(isEpic ? [{ key: STALE, label: "⚠ Over a year old" }] : []),
        ...buckets.map((b) => ({ key: b.key, label: b.label })),
      ]
    : [
        { key: REPORTED, label: "Reported a version" },
        { key: NO_VERSION, label: "No version reported" },
        { key: NONE, label: "No response" },
        { key: STALE, label: "⚠ Epic, over a year old" },
      ];

  const matchesVersion = (r: ServerResult) =>
    !versionFilter || (versionFilter === STALE ? isStale(r, asOf) : keyOf(r) === versionFilter);

  // Headline numbers for the current scope.
  const withVersion = scoped.filter((r) => r.software_version);
  const failed = scoped.filter((r) => r.error).length;
  const endpoints = scoped.reduce((s, r) => s + r.endpoint_count, 0);
  const epicRows = results.filter((r) => r.vendor === EPIC);
  const epicResponding = epicRows.filter((r) => r.software_version);
  const epicStale = epicRows.filter((r) => isStale(r, asOf));
  const newestEpic = [...epicResponding].sort((a, b) =>
    (b.release_month ?? "").localeCompare(a.release_month ?? "")
  )[0];
  const newestEpicCount = newestEpic
    ? epicResponding.filter((r) => r.software_version === newestEpic.software_version).length
    : 0;

  const showStale = () => {
    if (ehr !== EPIC) setEhr(EPIC);
    setTimeout(() => {
      setVersionFilter(STALE);
      document.getElementById("servers")?.scrollIntoView({ behavior: "smooth" });
    }, 0);
  };

  const changes = useMemo(() => {
    if (!previous) return null;
    const priorVendors = new Set(prior.map((p) => p.vendor ?? EPIC));
    const before = new Map(prior.map((p) => [p.address.toLowerCase(), p]));
    const upgraded: { r: ServerResult; from: string | null }[] = [];
    let added = 0;
    let wentQuiet = 0;
    // Only compare EHRs the previous scan covered; an EHR's first scan isn't "new servers".
    for (const r of scoped) {
      if (!priorVendors.has(r.vendor ?? EPIC)) continue;
      const p = before.get(r.address.toLowerCase());
      if (!p) added += 1;
      else if (p.software_version && !r.software_version) wentQuiet += 1;
      else if (r.software_version && p.software_version && r.software_version !== p.software_version)
        upgraded.push({ r, from: p.software_version });
    }
    const now = new Set(results.map((r) => r.address.toLowerCase()));
    const removed = prior.filter(
      (p) => !now.has(p.address.toLowerCase()) && (!ehr || (p.vendor ?? EPIC) === ehr)
    ).length;
    const firstScan = [...new Set(scoped.map((r) => r.vendor ?? EPIC))].filter(
      (v) => !priorVendors.has(v)
    );
    return { upgraded, added, removed, wentQuiet, firstScan };
  }, [previous, prior, scoped, results, ehr]);

  const downloadCsv = () => {
    const cols = [
      "ehr",
      "server",
      "customer",
      "software",
      "version",
      "release_month",
      "age",
      "over_a_year_old",
      "endpoints",
      "organizations",
      "states",
      "address",
      "error",
    ];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = scoped.map((r) =>
      [
        r.vendor,
        serverName(r),
        r.managing_orgs.join("; "),
        r.software_name,
        r.software_version,
        r.release_month,
        r.release_month ? ageLabel(r.release_month, asOf) : "",
        isStale(r, asOf) ? "yes" : "no",
        r.endpoint_count,
        r.brand_count + r.location_count,
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
    const scope = ehr ? vendorLabel(ehr).toLowerCase().replace(/[^a-z0-9]+/g, "-") : "all-ehrs";
    a.download = `fhir-versions-${scope}-${latest.started_at.slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const measures: Measure[] = isEpic ? ["servers", "customers", "endpoints"] : ["servers", "endpoints"];
  const scopeName = ehr ? vendorLabel(ehr) : "all EHRs";

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <h1>EHR version tracker</h1>
          <p className="muted">
            Last scan {shortDate(latest.started_at)} · {latest.server_count?.toLocaleString()} servers
            from {latest.endpoint_count?.toLocaleString()} published endpoints
          </p>
        </div>
        <div className="topbar-actions">
          <label className="ehr-picker">
            <span>EHR</span>
            <select value={ehr} onChange={(e) => setEhr(e.target.value)} aria-label="Filter by EHR">
              <option value="">All EHRs ({vendors.length})</option>
              {vendors.map((v) => (
                <option key={v.vendor} value={v.vendor}>
                  {vendorLabel(v.vendor)} ({v.servers.toLocaleString()})
                </option>
              ))}
            </select>
          </label>
          <button onClick={downloadCsv}>Download CSV</button>
          <form action={signOut}>
            <button type="submit" title={userEmail ?? undefined}>
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="stats">
        {isEpic ? (
          <div className="card hero stale-accent">
            <span className="stat-label">Epic servers on a release over a year old</span>
            <span className="hero-value">{epicStale.length}</span>
            <span className="muted">
              {pct(epicStale.length, epicResponding.length)} of responding servers ·{" "}
              {new Set(epicStale.map(customerKey)).size} customers
            </span>
            {epicStale.length > 0 && (
              <button className="link" onClick={showStale}>
                Show them →
              </button>
            )}
          </div>
        ) : (
          <div className="card hero">
            <span className="stat-label">Servers scanned{ehr ? "" : ", all EHRs"}</span>
            <span className="hero-value">{scoped.length.toLocaleString()}</span>
            <span className="muted">
              {endpoints.toLocaleString()} endpoints
              {ehr ? "" : ` · ${vendors.length} EHR developers`}
            </span>
          </div>
        )}

        {isEpic ? (
          <>
            <div className="card stat">
              <span className="stat-label">Servers scanned</span>
              <span className="stat-value">{scoped.length.toLocaleString()}</span>
              <span className="muted">{new Set(scoped.map(customerKey)).size} Epic customers</span>
            </div>
            <div className="card stat">
              <span className="stat-label">On the newest release</span>
              <span className="stat-value">{newestEpicCount}</span>
              <span className="muted">
                {newestEpic?.software_version} · {pct(newestEpicCount, epicResponding.length)}
              </span>
            </div>
          </>
        ) : (
          <div className="card stat">
            <span className="stat-label">Report a version</span>
            <span className="stat-value">{pct(withVersion.length, scoped.length)}</span>
            <span className="muted">
              {withVersion.length.toLocaleString()} servers
              {ehr ? ` · ${versionCounts.length} distinct` : ""}
            </span>
          </div>
        )}

        <div className="card stat">
          <span className="stat-label">Most common version</span>
          {ehr ? (
            <>
              <span className="stat-value small" title={versionCounts[0]?.[0]}>
                {versionCounts[0]?.[0] ?? "None reported"}
              </span>
              <span className="muted">
                {versionCounts[0] ? `${pct(versionCounts[0][1], scoped.length)} of servers` : ""}
              </span>
            </>
          ) : (
            <>
              <span className="stat-value small">Varies by EHR</span>
              <span className="muted">Pick an EHR to compare versions</span>
            </>
          )}
        </div>

        {!isEpic && (
          <div className="card stat">
            <span className="stat-label">Epic, over a year old</span>
            <span className="stat-value">{epicStale.length}</span>
            <button className="link" onClick={showStale}>
              View Epic →
            </button>
          </div>
        )}

        <div className="card stat">
          <span className="stat-label">No response</span>
          <span className="stat-value">{failed.toLocaleString()}</span>
          <span className="muted">failed twice ({pct(failed, scoped.length)})</span>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <h2>
              {measure === "servers" ? "Servers" : measure === "customers" ? "Customers" : "Endpoints"}{" "}
              {ehr ? (isEpic ? "by release" : "by reported version") : "by EHR"}
            </h2>
            <p className="muted">
              {!ehr
                ? `Top ${TOP_VENDORS} EHR developers. Click a bar to focus on that EHR.`
                : isEpic
                  ? "Each unique FHIR server address counted once. Click a bar to filter the list."
                  : `What ${scopeName} servers report as software.version. Click a bar to filter the list.`}
            </p>
          </div>
          <div className="segmented" role="group" aria-label="Count by">
            {measures.map((k) => (
              <button
                key={k}
                className={measure === k ? "active" : ""}
                aria-pressed={measure === k}
                onClick={() => setMeasure(k)}
              >
                {k[0].toUpperCase() + k.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <BarChart
          buckets={buckets}
          measure={measure}
          selected={ehr ? versionFilter : ""}
          onSelect={(key) => {
            if (!ehr) {
              if (key !== OTHER) setEhr(key);
              return;
            }
            setVersionFilter((cur) => (cur === key ? "" : key));
            document.getElementById("servers")?.scrollIntoView({ behavior: "smooth" });
          }}
        />
        {ehr && !isEpic && (
          <p className="muted caveat">
            Version strings are whatever the vendor puts in its CapabilityStatement. Some are real
            builds; others are a FHIR-layer or placeholder version (e.g. 1.0.0) that doesn&rsquo;t
            change with the EHR release, so compare within one EHR, not across them.
          </p>
        )}
      </section>

      {changes && (
        <section className="card">
          <h2>Since the previous scan ({shortDate(previous!.started_at)})</h2>
          <p className="muted">
            {changes.upgraded.length} servers changed version · {changes.added} new ·{" "}
            {changes.removed} no longer listed · {changes.wentQuiet} stopped responding
            {changes.firstScan.length > 0 &&
              ` · first scan for ${
                changes.firstScan.length === 1
                  ? vendorLabel(changes.firstScan[0])
                  : `${changes.firstScan.length} EHRs`
              }`}
          </p>
          {changes.upgraded.length > 0 && (
            <ul className="changes">
              {changes.upgraded.slice(0, 50).map(({ r, from }) => (
                <li key={r.address}>
                  <strong>
                    {serverName(r)}
                    {!ehr && <span className="muted"> · {vendorLabel(r.vendor)}</span>}
                  </strong>
                  <span className="muted">
                    {from} → {r.software_version}
                  </span>
                </li>
              ))}
              {changes.upgraded.length > 50 && (
                <li className="muted">…and {changes.upgraded.length - 50} more (see CSV)</li>
              )}
            </ul>
          )}
        </section>
      )}

      <LocationSearch results={results} asOf={asOf} ehr={ehr} />

      <ServerTable
        results={scoped}
        asOf={asOf}
        showVendor={!ehr}
        epicColumns={isEpic}
        versionOptions={versionOptions}
        versionFilter={versionFilter}
        setVersionFilter={setVersionFilter}
        matchesVersion={matchesVersion}
      />

      <section className="card footnote">
        <h2>How this works</h2>
        <p className="muted">
          An on-demand GitHub Action builds the server list from two public sources: Epic&rsquo;s{" "}
          <a href="https://open.epic.com/Endpoints/Brands">Brands bundle</a> (every unique Epic
          server address) and ONC&rsquo;s <a href="https://lantern.healthit.gov">Lantern</a> daily
          export of every other certified EHR developer&rsquo;s published endpoints. Lantern
          endpoints are grouped by developer and host, since many vendors serve thousands of
          practices from one host, and one tenant is probed per host. Each server gets{" "}
          <code>[base]/metadata</code> with <code>Accept: application/fhir+json</code>, one retry,
          and its <code>software.version</code> is recorded. &ldquo;Over a year old&rdquo; applies
          to Epic only, whose versions name a release month. Method after Brendan Keeler,{" "}
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
                <td className="num">{h.server_count?.toLocaleString()}</td>
                <td className="num">{h.failure_count?.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
