"use client";

import { useState } from "react";

export type Measure = "servers" | "endpoints" | "customers";

export type Bucket = {
  key: string; // what a click selects
  label: string;
  servers: number;
  endpoints: number;
  customers: number;
  // current = the one data series; stale = Epic release over a year old (status color);
  // none = no response or no version reported (neutral gray)
  kind: "current" | "stale" | "none";
};

type Props = {
  buckets: Bucket[];
  measure: Measure;
  selected: string;
  onSelect: (key: string) => void;
};

const MEASURE_LABEL: Record<Measure, string> = {
  servers: "servers",
  endpoints: "endpoints",
  customers: "customers",
};

// Horizontal bars, one series (blue). Epic releases over a year old switch to the "serious"
// status color and carry a ⚠ + text label; gray marks "no response / no version".
export default function BarChart({ buckets, measure, selected, onSelect }: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...buckets.map((b) => b[measure]));
  const total = buckets.reduce((s, b) => s + b[measure], 0);
  const kinds = new Set(buckets.map((b) => b.kind));
  const showLegend = kinds.size > 1;

  return (
    <div className="chart">
      {showLegend && (
        <div className="legend" aria-hidden="true">
          {kinds.has("current") && (
            <span>
              <i className="swatch current" /> {kinds.has("stale") ? "Within the last year" : "Reported"}
            </span>
          )}
          {kinds.has("stale") && (
            <span>
              <i className="swatch stale" /> ⚠ Over a year old
            </span>
          )}
          {kinds.has("none") && (
            <span>
              <i className="swatch none" /> No response or no version
            </span>
          )}
        </div>
      )}
      <ul className="bars" role="list">
        {buckets.map((b) => {
          const value = b[measure];
          const isSel = selected === b.key;
          return (
            <li key={b.key}>
              <button
                className={`bar-row ${isSel ? "selected" : ""} ${selected && !isSel ? "dimmed" : ""}`}
                onClick={() => onSelect(b.key)}
                onMouseEnter={() => setHover(b.key)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(b.key)}
                onBlur={() => setHover(null)}
                aria-label={`${b.label}: ${b.servers} servers, ${b.endpoints} endpoints${
                  b.kind === "stale" ? ", over a year old" : ""
                }`}
              >
                <span className="bar-label" title={b.label}>
                  {b.kind === "stale" && <span aria-hidden="true">⚠ </span>}
                  {b.label}
                </span>
                <span className="bar-track">
                  <span className={`bar ${b.kind}`} style={{ width: `${(100 * value) / max}%` }} />
                  <span className="bar-value">{value.toLocaleString()}</span>
                </span>
                {hover === b.key && (
                  <span className="tooltip" role="tooltip">
                    <strong>{b.label}</strong>
                    <span>
                      {b.servers.toLocaleString()} servers · {b.endpoints.toLocaleString()} endpoints
                      {measure === "customers" ? ` · ${b.customers} customers` : ""}
                    </span>
                    <span>
                      {((100 * value) / total).toFixed(1)}% of {MEASURE_LABEL[measure]} shown
                    </span>
                    {b.kind === "stale" && <span>⚠ Over a year old</span>}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
