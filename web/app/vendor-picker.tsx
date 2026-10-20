"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { vendorLabel } from "@/lib/releases";

export type VendorOption = { vendor: string; servers: number };

type Props = {
  options: VendorOption[];
  selected: string[]; // [] = all EHRs
  onChange: (selected: string[]) => void;
};

/** Does any word of `label` start with `q`? Whole-label prefix matches rank first. */
function matchRank(label: string, q: string): number {
  if (!q) return 1;
  const l = label.toLowerCase();
  if (l.startsWith(q)) return 0;
  return l.split(/[\s,.()/&-]+/).some((w) => w.startsWith(q)) ? 1 : -1;
}

// Searchable, alphabetical, multi-select EHR filter.
export default function VendorPicker({ options, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const chosen = useMemo(() => new Set(selected), [selected]);

  // Label each vendor; when two developers shorten to the same label, show full names.
  const labeled = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of options) counts.set(vendorLabel(o.vendor), (counts.get(vendorLabel(o.vendor)) ?? 0) + 1);
    return options
      .map((o) => {
        const short = vendorLabel(o.vendor);
        return { ...o, label: (counts.get(short) ?? 0) > 1 ? o.vendor : short };
      })
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  }, [options]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      labeled
        .map((o) => ({ o, rank: matchRank(o.label, q) }))
        .filter((x) => x.rank >= 0)
        .sort((a, b) => a.rank - b.rank || a.o.label.localeCompare(b.o.label, undefined, { sensitivity: "base" }))
        .map((x) => x.o),
    [labeled, q]
  );

  useEffect(() => setActive(0), [q]);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const toggle = (vendor: string) =>
    onChange(chosen.has(vendor) ? selected.filter((v) => v !== vendor) : [...selected, vendor]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[active]) {
        toggle(shown[active].vendor);
        setQuery(""); // ready to type the next EHR
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const summary =
    selected.length === 0
      ? `All EHRs (${options.length})`
      : selected.length <= 2
        ? selected.map(vendorLabel).join(", ")
        : `${selected.length} EHRs`;

  return (
    <div className="vendor-picker" ref={root}>
      <span className="picker-label" id="ehr-label">
        EHR
      </span>
      <button
        type="button"
        className="picker-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby="ehr-label"
        onClick={() => {
          if (!open) setQuery(""); // each opening starts a fresh search
          setOpen(!open);
        }}
        title={selected.map(vendorLabel).join(", ") || undefined}
      >
        <span className="picker-summary">{summary}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="picker-pop" role="dialog" aria-label="Choose EHRs">
          <input
            ref={input}
            type="search"
            placeholder="Type to search, e.g. epi"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            aria-label="Search EHRs"
            aria-controls="ehr-options"
            aria-activedescendant={shown[active] ? `ehr-opt-${active}` : undefined}
          />
          <div className="picker-actions">
            <span className="muted">
              {selected.length ? `${selected.length} selected` : "Showing all EHRs"}
            </span>
            {selected.length > 0 && (
              <button type="button" className="link" onClick={() => onChange([])}>
                Clear
              </button>
            )}
          </div>
          <ul
            id="ehr-options"
            ref={list}
            role="listbox"
            aria-multiselectable="true"
            aria-labelledby="ehr-label"
          >
            {shown.length === 0 && <li className="muted empty">No EHR matches &ldquo;{query}&rdquo;</li>}
            {shown.map((o, i) => {
              const on = chosen.has(o.vendor);
              return (
                <li
                  key={o.vendor}
                  id={`ehr-opt-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={on}
                  className={`${i === active ? "active" : ""} ${on ? "on" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => toggle(o.vendor)}
                  title={o.vendor}
                >
                  <span className="check" aria-hidden="true">
                    {on ? "✓" : ""}
                  </span>
                  <span className="opt-label">{o.label}</span>
                  <span className="opt-count">{o.servers.toLocaleString()}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
