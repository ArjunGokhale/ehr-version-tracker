"use client";

import { Fragment, useMemo, useState } from "react";
import { ageLabel, isStale, serverName, vendorLabel, type ServerResult } from "@/lib/releases";

type SortKey = "name" | "vendor" | "customer" | "version" | "endpoints" | "orgs";

export type VersionOption = { key: string; label: string };

type Props = {
  results: ServerResult[]; // already scoped to the chosen EHR
  asOf: Date;
  showVendor: boolean; // all-EHR view
  epicColumns: boolean; // Epic view: customer, release age, states
  versionOptions: VersionOption[];
  versionFilter: string;
  setVersionFilter: (v: string) => void;
  matchesVersion: (r: ServerResult) => boolean;
};

const PAGE = 500;

export default function ServerTable({
  results,
  asOf,
  showVendor,
  epicColumns,
  versionOptions,
  versionFilter,
  setVersionFilter,
  matchesVersion,
}: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "version", dir: 1 });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = results.filter((r) => {
      if (!matchesVersion(r)) return false;
      if (!q) return true;
      return [
        ...r.endpoint_names,
        ...r.managing_orgs,
        r.host ?? "",
        vendorLabel(r.vendor),
        r.software_name ?? "",
        r.software_version ?? "",
        ...r.states,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
    const val = (r: ServerResult): string | number => {
      switch (sort.key) {
        case "name":
          return serverName(r).toLowerCase();
        case "vendor":
          return vendorLabel(r.vendor).toLowerCase();
        case "customer":
          return (r.managing_orgs[0] ?? "").toLowerCase();
        case "endpoints":
          return r.endpoint_count;
        case "orgs":
          return r.brand_count + r.location_count;
        case "version":
          // Epic sorts oldest release first; others alphabetically; no response last.
          if (r.error) return "~~";
          return r.release_month ?? `~${r.software_version ?? "~"}`;
      }
    };
    return filtered.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      // Number-aware so version 3.13 sorts after 3.4.
      const c =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb), undefined, { numeric: true });
      return c * sort.dir || serverName(a).localeCompare(serverName(b));
    });
  }, [results, query, matchesVersion, sort]);

  const header = (key: SortKey, label: string, className = "") => (
    <th
      className={className}
      aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
    >
      <button
        className="sort"
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : 1 }))}
      >
        {label}
        {sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );

  const colCount = 4 + (showVendor ? 1 : 0) + (epicColumns ? 3 : 1);

  return (
    <section className="card" id="servers">
      <div className="section-head">
        <div>
          <h2>All servers</h2>
          <p className="muted">
            {rows.length.toLocaleString()} of {results.length.toLocaleString()} shown
          </p>
        </div>
        <div className="filters">
          <input
            type="search"
            placeholder="Search organization, host, version, state"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
            aria-label="Search servers"
          />
          <select
            value={versionFilter}
            onChange={(e) => {
              setVersionFilter(e.target.value);
              setLimit(PAGE);
            }}
            aria-label="Filter by version"
          >
            <option value="">All versions</option>
            {versionOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="table-wrap">
        <table className="servers">
          <thead>
            <tr>
              {header("name", epicColumns ? "Brand on endpoint" : "Server")}
              {showVendor && header("vendor", "EHR")}
              {epicColumns && header("customer", "Epic customer")}
              {header("version", epicColumns ? "Release" : "Version")}
              {epicColumns ? <th className="num">Age</th> : <th>Software</th>}
              {header("endpoints", "Endpoints", "num")}
              {header("orgs", epicColumns ? "Brands · locations" : "Orgs", "num")}
              {epicColumns && <th>States</th>}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((r) => {
              const stale = isStale(r, asOf);
              const open = expanded === r.address;
              return (
                <Fragment key={r.address}>
                  <tr
                    className={`${stale ? "stale" : ""} ${open ? "open" : ""}`}
                    onClick={() => setExpanded(open ? null : r.address)}
                  >
                    <td>
                      <button className="row-toggle" aria-expanded={open}>
                        {serverName(r)}
                      </button>
                    </td>
                    {showVendor && <td className="secondary">{vendorLabel(r.vendor)}</td>}
                    {epicColumns && <td className="secondary">{r.managing_orgs.join("; ")}</td>}
                    <td>
                      {r.error ? (
                        <span className="pill none">No response</span>
                      ) : r.software_version ? (
                        <span className={`pill ${stale ? "stale" : ""}`} title={r.software_version}>
                          {stale && <span aria-hidden="true">⚠ </span>}
                          {r.software_version}
                        </span>
                      ) : (
                        <span className="pill none">Not reported</span>
                      )}
                    </td>
                    {epicColumns ? (
                      <td className="num">{ageLabel(r.release_month, asOf)}</td>
                    ) : (
                      <td className="secondary">{r.software_name ?? "—"}</td>
                    )}
                    <td className="num">{r.endpoint_count.toLocaleString()}</td>
                    <td className="num">
                      {epicColumns
                        ? `${r.brand_count} · ${r.location_count.toLocaleString()}`
                        : r.brand_count.toLocaleString()}
                    </td>
                    {epicColumns && <td className="secondary">{r.states.join(" ")}</td>}
                  </tr>
                  {open && (
                    <tr className="detail">
                      <td colSpan={colCount}>
                        <dl>
                          <dt>EHR</dt>
                          <dd>{r.vendor ?? "—"}</dd>
                          <dt>FHIR base</dt>
                          <dd>
                            <code>{r.probe_url ?? r.address}</code>
                            {r.endpoint_count > 1 && r.source === "lantern" && (
                              <span className="muted">
                                {" "}
                                (one of {r.endpoint_count.toLocaleString()} endpoints on this host)
                              </span>
                            )}
                          </dd>
                          {r.source === "lantern" && r.brand_count > 0 && (
                            <>
                              <dt>Organizations</dt>
                              <dd>
                                {r.endpoint_names.join("; ")}
                                {r.brand_count > r.endpoint_names.length &&
                                  ` and ${(r.brand_count - r.endpoint_names.length).toLocaleString()} more`}
                              </dd>
                            </>
                          )}
                          <dt>Software</dt>
                          <dd>
                            {r.software_name ?? "—"} {r.software_version ?? ""}
                            {r.build_date ? ` (release date ${r.build_date})` : ""} · FHIR{" "}
                            {r.fhir_version ?? "—"}
                          </dd>
                          {r.error && (
                            <>
                              <dt>Error</dt>
                              <dd>
                                {r.error} (after {r.attempts} attempts)
                              </dd>
                            </>
                          )}
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <button className="show-more" onClick={() => setLimit((l) => l + PAGE * 4)}>
          Show more ({(rows.length - limit).toLocaleString()} remaining)
        </button>
      )}
    </section>
  );
}
