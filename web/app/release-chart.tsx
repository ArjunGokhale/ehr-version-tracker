"use client";

import { useState } from "react";

export type ReleaseBucket = {
  label: string;
  releaseMonth: string | null;
  servers: number;
  customers: number;
  stale: boolean;
};

type Props = {
  buckets: ReleaseBucket[];
  measure: "servers" | "customers";
  selected: string;
  onSelect: (label: string) => void;
};

// Horizontal bars, newest release on top. One series (blue); releases over a year old
// switch to the "serious" status color and always carry a ⚠ + text label.
export default function ReleaseChart({ buckets, measure, selected, onSelect }: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...buckets.map((b) => b[measure]));
  const total = buckets.reduce((s, b) => s + b[measure], 0);

  return (
    <div className="chart">
      <div className="legend" aria-hidden="true">
        <span>
          <i className="swatch current" /> Within the last year
        </span>
        <span>
          <i className="swatch stale" /> ⚠ Over a year old
        </span>
        <span>
          <i className="swatch none" /> No response
        </span>
      </div>
      <ul className="bars" role="list">
        {buckets.map((b) => {
          const value = b[measure];
          const kind = !b.releaseMonth ? "none" : b.stale ? "stale" : "current";
          const isSel = selected === b.label;
          return (
            <li key={b.label}>
              <button
                className={`bar-row ${isSel ? "selected" : ""} ${
                  selected && !isSel ? "dimmed" : ""
                }`}
                onClick={() => onSelect(b.label)}
                onMouseEnter={() => setHover(b.label)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(b.label)}
                onBlur={() => setHover(null)}
                aria-label={`${b.label}: ${b.servers} servers, ${b.customers} customers${
                  b.stale ? ", over a year old" : ""
                }`}
              >
                <span className="bar-label">
                  {b.stale && <span aria-hidden="true">⚠ </span>}
                  {b.label}
                </span>
                <span className="bar-track">
                  <span
                    className={`bar ${kind}`}
                    style={{ width: `${(100 * value) / max}%` }}
                  />
                  <span className="bar-value">{value}</span>
                </span>
                {hover === b.label && (
                  <span className="tooltip" role="tooltip">
                    <strong>{b.label}</strong>
                    <span>
                      {b.servers} servers · {b.customers} customers
                    </span>
                    <span>{((100 * value) / total).toFixed(1)}% of {measure}</span>
                    {b.stale && <span>⚠ Over a year old</span>}
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
