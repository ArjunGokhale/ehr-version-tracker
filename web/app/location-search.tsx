"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ageLabel, isStale, serverName, type ServerResult } from "@/lib/releases";

type Brand = {
  org_id: string;
  name: string;
  kind: "primary" | "location";
  city: string | null;
  state: string | null;
  addresses: string[];
};

// Searches all ~98k brands and locations in the bundle (hospitals, clinics, practices)
// and shows which server — and so which Epic release — each one sits on.
export default function LocationSearch({ results, asOf }: { results: ServerResult[]; asOf: Date }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(false);
  const byAddress = useMemo(
    () => new Map(results.map((r) => [r.address.toLowerCase(), r])),
    [results]
  );

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      const pattern = `%${q.replace(/[%_\\]/g, (c) => "\\" + c)}%`;
      const { data } = await createClient()
        .from("brands")
        .select("org_id,name,kind,city,state,addresses")
        .ilike("name", pattern)
        .order("kind", { ascending: false }) // "primary" brands before their locations
        .order("name")
        .limit(25);
      if (!cancelled) {
        setHits((data ?? []) as Brand[]);
        setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  return (
    <section className="card">
      <div className="section-head">
        <div>
          <h2>Find a hospital or clinic</h2>
          <p className="muted">
            Searches every brand and location Epic lists (about 98,000), not just the endpoint
            names.
          </p>
        </div>
        <div className="filters">
          <input
            type="search"
            placeholder="e.g. Naples, Children's, Cedars"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search hospitals and clinics"
          />
        </div>
      </div>
      {query.trim().length >= 3 && (
        <ul className="hits">
          {loading && hits.length === 0 && <li className="muted">Searching…</li>}
          {!loading && hits.length === 0 && <li className="muted">No matches.</li>}
          {hits.map((h) => {
            const servers = h.addresses
              .map((a) => byAddress.get(a.toLowerCase()))
              .filter((s): s is ServerResult => Boolean(s));
            return (
              <li key={h.org_id}>
                <div>
                  <strong>{h.name}</strong>
                  <span className="muted">
                    {h.kind === "primary" ? "Brand" : "Location"}
                    {h.city || h.state ? ` · ${[h.city, h.state].filter(Boolean).join(", ")}` : ""}
                  </span>
                </div>
                <div className="hit-servers">
                  {servers.length === 0 && <span className="muted">No server listed</span>}
                  {servers.map((s) => {
                    const stale = isStale(s, asOf);
                    return (
                      <span key={s.address} className="hit-server">
                        <span className={`pill ${stale ? "stale" : s.software_version ? "" : "none"}`}>
                          {stale && <span aria-hidden="true">⚠ </span>}
                          {s.software_version ?? "No response"}
                        </span>
                        <span className="muted">
                          {ageLabel(s.release_month, asOf)} · via {serverName(s)}
                        </span>
                      </span>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
