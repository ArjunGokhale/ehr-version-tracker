"use client";

import { Fragment, useMemo, useState } from "react";
import { ageLabel, isStale, serverName, type ServerResult } from "@/lib/releases";

type SortKey = "name" | "customer" | "release" | "brands";

type Props = {
  results: ServerResult[];
  asOf: Date;
  releases: string[];
  releaseFilter: string; // "" = all, "__stale" = over a year old, else a release label
  setReleaseFilter: (v: string) => void;
};

const NO_RESPONSE = "No response";

export default function ServerTable({ results, asOf, releases, releaseFilter, setReleaseFilter }: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "release", dir: 1 });
  const [expanded, setExpanded] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = results.filter((r) => {
      if (releaseFilter === "__stale" && !isStale(r, asOf)) return false;
      if (
        releaseFilter &&
        releaseFilter !== "__stale" &&
        (r.software_version ?? NO_RESPONSE) !== releaseFilter
      )
        return false;
      if (!q) return true;
      return [...r.endpoint_names, ...r.managing_orgs, r.host ?? "", ...r.states]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
    const val = (r: ServerResult): string | number => {
      switch (sort.key) {
        case "name":
          return serverName(r).toLowerCase();
        case "customer":
          return (r.managing_orgs[0] ?? "").toLowerCase();
        case "brands":
          return r.brand_count + r.location_count;
        case "release":
          return r.release_month ?? "9999"; // no response sorts last when oldest-first
      }
    };
    return filtered.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return c * sort.dir || serverName(a).localeCompare(serverName(b));
    });
  }, [results, asOf, query, releaseFilter, sort]);

  const header = (key: SortKey, label: string, className = "") => (
    <th className={className} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button
        className="sort"
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : 1 }))}
      >
        {label}
        {sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );

  return (
    <section className="card" id="servers">
      <div className="section-head">
        <div>
          <h2>All servers</h2>
          <p className="muted">
            {rows.length} of {results.length} shown
          </p>
        </div>
        <div className="filters">
          <input
            type="search"
            placeholder="Search brand, customer, host, state"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search servers"
          />
          <select
            value={releaseFilter}
            onChange={(e) => setReleaseFilter(e.target.value)}
            aria-label="Filter by release"
          >
            <option value="">All releases</option>
            <option value="__stale">⚠ Over a year old</option>
            {releases.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="table-wrap">
        <table className="servers">
          <thead>
            <tr>
              {header("name", "Brand on endpoint")}
              {header("customer", "Epic customer")}
              {header("release", "Release")}
              <th className="num">Age</th>
              {header("brands", "Brands · locations", "num")}
              <th>States</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
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
                    <td className="secondary">{r.managing_orgs.join("; ")}</td>
                    <td>
                      {r.software_version ? (
                        <span className={`pill ${stale ? "stale" : ""}`}>
                          {stale && <span aria-hidden="true">⚠ </span>}
                          {r.software_version}
                        </span>
                      ) : (
                        <span className="pill none">No response</span>
                      )}
                    </td>
                    <td className="num">{ageLabel(r.release_month, asOf)}</td>
                    <td className="num">
                      {r.brand_count} · {r.location_count.toLocaleString()}
                    </td>
                    <td className="secondary">{r.states.join(" ")}</td>
                  </tr>
                  {open && (
                    <tr className="detail">
                      <td colSpan={6}>
                        <dl>
                          <dt>FHIR base</dt>
                          <dd>
                            <code>{r.address}</code>
                          </dd>
                          <dt>Software</dt>
                          <dd>
                            {r.software_name ?? "—"} {r.software_version ?? ""}
                            {r.build_date ? ` (build ${r.build_date})` : ""} · FHIR{" "}
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
    </section>
  );
}
