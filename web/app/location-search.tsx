"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ageLabel, isStale, serverName, vendorLabel, type ServerResult } from "@/lib/releases";

type Brand = {
  org_id: string;
  name: string;
  kind: "primary" | "location";
  city: string | null;
  state: string | null;
  vendor: string | null;
  addresses: string[];
};

// Searches every organization name in the directory (Epic brands and locations, plus the
// organization names other EHR developers publish) and shows the server each sits on.
export default function LocationSearch({
  results,
  asOf,
  ehr,
}: {
  results: ServerResult[];
  asOf: Date;
  ehr: string; // "" = all EHRs
}) {
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
      let req = createClient()
        .from("brands")
        .select("org_id,name,kind,city,state,vendor,addresses")
        .ilike("name", pattern);
      if (ehr) req = req.eq("vendor", ehr);
      const { data } = await req
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
  }, [query, ehr]);

  return (
    <section className="card">
      <div className="section-head">
        <div>
          <h2>Find a hospital or clinic</h2>
          <p className="muted">
            Searches every organization name the EHR developers publish
            {ehr ? ` for ${vendorLabel(ehr)}` : ""}, including Epic&rsquo;s ~97,000 locations.
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
                    {vendorLabel(h.vendor)} · {h.kind === "primary" ? "Organization" : "Location"}
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
                          {s.error ? "No response" : (s.software_version ?? "Not reported")}
                        </span>
                        <span className="muted">
                          {s.release_month ? `${ageLabel(s.release_month, asOf)} · ` : ""}via{" "}
                          {serverName(s)}
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
