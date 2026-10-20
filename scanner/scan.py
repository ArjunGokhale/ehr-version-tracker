"""Scan public EHR FHIR servers and record the software version each one reports.

Sources
  epic     Epic's public Brands bundle (https://open.epic.com/Endpoints/Brands). Every unique
           server address is probed. This is Brendan Keeler's method from "Your Version Is
           Showing" and is more complete for Epic than any aggregator.
  lantern  ONC Lantern's daily CHPL endpoint export (every other certified EHR developer's
           published endpoint list). Many vendors host thousands of tenants on one host, so
           endpoints are grouped by host and one tenant is probed per host; the
           retry uses a different tenant on the same host when there is one.

For each server: GET [base]/metadata with Accept: application/fhir+json, retry failures
once, and read CapabilityStatement.software.{name,version,releaseDate}.

Standard library only. Writes to Supabase through the ingest_* RPCs when SUPABASE_URL,
SUPABASE_ANON_KEY and INGEST_TOKEN are set; always writes a local JSON copy.

    python3 scanner/scan.py                      # all sources, scan + upload
    python3 scanner/scan.py --sources epic       # Epic only
    python3 scanner/scan.py --no-upload          # scan, local JSON only
"""

import argparse
import collections
import csv
import datetime as dt
import hashlib
import io
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BRANDS_URL = "https://open.epic.com/Endpoints/Brands"
LANTERN_URL = "https://lantern.healthit.gov/api/daily/download?source=CHPL"
EPIC_VENDOR = "Epic Systems Corporation"
USER_AGENT = "epic-version-tracker/1.0 (+https://github.com/ArjunGokhale/epic-version-tracker)"
MAX_NAMES_PER_SERVER = 5  # org names stored on a server row; the full list goes to `brands`
MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august",
     "september", "october", "november", "december"], start=1)}

SSL_CTX = ssl.create_default_context()


def http_get(url, *, headers=None, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as resp:
        return resp.read()


def http_json(url, *, method="GET", body=None, headers=None, timeout=30):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"User-Agent": USER_AGENT, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as resp:
        raw = resp.read()
    return json.loads(raw) if raw else None


def parse_release_month(version):
    """Epic-style 'February 2026' -> date(2026, 2, 1); anything else -> None."""
    m = re.fullmatch(r"\s*([A-Za-z]+)\s+(\d{4})\s*", version or "")
    if not m or m.group(1).lower() not in MONTHS:
        return None
    return dt.date(int(m.group(2)), MONTHS[m.group(1).lower()], 1)


def parse_date(value):
    try:
        return dt.date.fromisoformat((value or "")[:10]).isoformat()
    except ValueError:
        return None


def normalize(address):
    return address.strip().rstrip("/")


def new_server(address, vendor, source):
    return {"address": address, "host": urllib.parse.urlparse(address).hostname,
            "vendor": vendor, "source": source, "candidates": [address],
            "endpoint_names": set(), "managing_orgs": set(), "brands": set(),
            "locations": 0, "states": set(), "endpoint_count": 0}


# --- Epic: Brands bundle -------------------------------------------------------------------

def index_epic(bundle):
    """Group Epic's bundle into unique servers and a flat brand directory."""
    resources = [e["resource"] for e in bundle["entry"]]
    endpoints = {"urn:uuid:" + r["id"]: r for r in resources if r["resourceType"] == "Endpoint"}
    orgs = [r for r in resources if r["resourceType"] == "Organization"]
    primaries = {"urn:uuid:" + o["id"]: o for o in orgs if "endpoint" in o}

    def addresses_of(org):
        return sorted({normalize(endpoints[ref["reference"]]["address"])
                       for ref in org.get("endpoint", []) if ref["reference"] in endpoints})

    servers = {}
    for ep in endpoints.values():
        addr = normalize(ep["address"])
        s = servers.setdefault(addr.lower(), new_server(addr, EPIC_VENDOR, "epic-brands"))
        s["endpoint_count"] += 1
        if ep.get("name"):
            s["endpoint_names"].add(ep["name"])
        mo = (ep.get("managingOrganization") or {}).get("display")
        if mo:
            s["managing_orgs"].add(mo)

    brands = []
    primary_addrs = {}
    for ref, org in primaries.items():
        addrs = addresses_of(org)
        primary_addrs[ref] = addrs
        state = next((a.get("state") for a in org.get("address", []) if a.get("state")), None)
        for addr in addrs:
            s = servers[addr.lower()]
            s["brands"].add(org.get("name"))
            if state:
                s["states"].add(state)
        brands.append({"org_id": org["id"], "name": org.get("name") or "", "kind": "primary",
                       "parent_org_id": None, "addresses": addrs, "city": None, "state": state,
                       "vendor": EPIC_VENDOR})

    for org in orgs:
        if "endpoint" in org:
            continue
        parent = (org.get("partOf") or {}).get("reference")
        addrs = primary_addrs.get(parent, [])
        addr0 = next(iter(org.get("address", [])), {})
        for addr in addrs:
            servers[addr.lower()]["locations"] += 1
            if addr0.get("state"):
                servers[addr.lower()]["states"].add(addr0["state"])
        brands.append({"org_id": org["id"], "name": org.get("name") or "", "kind": "location",
                       "parent_org_id": parent.removeprefix("urn:uuid:") if parent else None,
                       "addresses": addrs, "city": addr0.get("city"), "state": addr0.get("state"),
                       "vendor": EPIC_VENDOR})

    return list(servers.values()), brands, len(endpoints)


# --- Everyone else: ONC Lantern's CHPL export ------------------------------------------------

def index_lantern(raw_csv, skip_vendors):
    """Group Lantern's endpoint rows by host; one server per host.

    A host can appear under more than one CHPL developer (a parent company and a subsidiary
    both certifying the same product); it is attributed to the developer listing the most
    endpoints on it, ties going to the more specific (longer) name.
    """
    reader = csv.DictReader(io.StringIO(raw_csv.decode("utf-8", errors="replace")))
    groups = collections.defaultdict(
        lambda: {"urls": set(), "names": set(), "vendors": collections.Counter()})
    endpoint_count = 0
    for row in reader:
        vendor = (row.get("api_developer_name") or "").strip()
        url = normalize(row.get("url") or "")
        if not vendor or not url or vendor in skip_vendors:
            continue
        host = urllib.parse.urlparse(url).hostname
        if not host:
            continue
        endpoint_count += 1
        g = groups[host.lower()]
        g["urls"].add(url)
        g["vendors"][vendor] += 1
        for name in (row.get("api_information_source_name") or "").split(";"):
            if name.strip():
                g["names"].add(name.strip())

    servers, brands = [], []
    for host, g in groups.items():
        vendor = max(g["vendors"].items(), key=lambda kv: (kv[1], len(kv[0])))[0]
        urls = sorted(g["urls"], key=str.lower)
        names = sorted(g["names"], key=str.lower)
        s = new_server(urls[0], vendor, "lantern")
        # Retry against a different tenant on the same host when one exists.
        s["candidates"] = urls[:2]
        s["endpoint_count"] = len(urls)
        s["endpoint_names"] = set(names[:MAX_NAMES_PER_SERVER])
        s["brands"] = set(names)
        servers.append(s)
        for name in names:
            org_id = "lantern:" + hashlib.sha1(f"{host}|{name}".encode()).hexdigest()[:24]
            brands.append({"org_id": org_id, "name": name, "kind": "primary", "parent_org_id": None,
                           "addresses": [urls[0]], "city": None, "state": None, "vendor": vendor})
    return servers, brands, endpoint_count


def dedupe(servers):
    """One row per address (case-insensitive); the first source listed wins."""
    seen, out = set(), []
    for s in servers:
        if s["address"].lower() not in seen:
            seen.add(s["address"].lower())
            out.append(s)
    return out


# --- Probing ---------------------------------------------------------------------------------

def fetch_metadata(base):
    cs = json.loads(http_get(base + "/metadata", headers={"Accept": "application/fhir+json"}, timeout=20))
    if not isinstance(cs, dict) or cs.get("resourceType") != "CapabilityStatement":
        raise ValueError(f"not a CapabilityStatement ({type(cs).__name__})")
    sw = cs.get("software") or {}
    return {"software_name": (sw.get("name") or "").strip() or None,
            "software_version": (sw.get("version") or "").strip() or None,
            "build_date": parse_date(sw.get("releaseDate")), "fhir_version": cs.get("fhirVersion")}


def probe(server, retry_delay):
    err, url = None, server["candidates"][0]
    for attempt in (1, 2):
        url = server["candidates"][min(attempt - 1, len(server["candidates"]) - 1)]
        try:
            return {**fetch_metadata(url), "attempts": attempt, "error": None, "probe_url": url}
        except Exception as ex:  # any failure counts; one retry, then record the error
            err = f"{type(ex).__name__}: {ex}"[:300]
            if attempt == 1:
                time.sleep(retry_delay)
    return {"software_name": None, "software_version": None, "build_date": None,
            "fhir_version": None, "attempts": 2, "error": err, "probe_url": url}


def scan(servers, workers, retry_delay):
    done = 0

    def run(s):
        nonlocal done
        r = probe(s, retry_delay)
        done += 1
        if done % 500 == 0:
            print(f"  {done}/{len(servers)} probed", flush=True)
        return r

    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(run, servers))
    rows = []
    for s, r in zip(servers, results):
        month = parse_release_month(r["software_version"]) if s["vendor"] == EPIC_VENDOR else None
        rows.append({"address": s["address"], "host": s["host"], "vendor": s["vendor"],
                     "source": s["source"], "endpoint_count": s["endpoint_count"],
                     "endpoint_names": sorted(s["endpoint_names"]),
                     "managing_orgs": sorted(s["managing_orgs"]),
                     "brand_count": len(s["brands"]), "location_count": s["locations"],
                     "states": sorted(s["states"]),
                     "release_month": month.isoformat() if month else None, **r})
    return rows


class Supabase:
    def __init__(self, url, anon_key, token):
        self.base, self.token = url.rstrip("/") + "/rest/v1/rpc/", token
        self.headers = {"apikey": anon_key, "Content-Type": "application/json"}

    def rpc(self, fn, **args):
        for attempt in range(3):
            try:
                return http_json(self.base + fn, method="POST", headers=self.headers,
                                 body={"p_token": self.token, **args}, timeout=120)
            except urllib.error.HTTPError as ex:
                detail = ex.read().decode(errors="replace")[:500]
                if ex.code < 500 or attempt == 2:
                    raise RuntimeError(f"{fn} failed: HTTP {ex.code} {detail}") from None
            except urllib.error.URLError:
                if attempt == 2:
                    raise
            time.sleep(5 * (attempt + 1))


def chunks(items, size):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sources", default="epic,lantern", help="comma list: epic, lantern")
    ap.add_argument("--bundle", help="use a local Epic Brands bundle file instead of downloading")
    ap.add_argument("--lantern-csv", help="use a local Lantern CSV instead of downloading")
    ap.add_argument("--out", default="data/latest_scan.json", help="local JSON output path")
    ap.add_argument("--workers", type=int, default=64)
    ap.add_argument("--retry-delay", type=float, default=5.0)
    ap.add_argument("--no-upload", action="store_true")
    ap.add_argument("--trigger", default=os.environ.get("SCAN_TRIGGER", "manual"))
    args = ap.parse_args()
    sources = {s.strip() for s in args.sources.split(",") if s.strip()}
    if not sources <= {"epic", "lantern"}:
        sys.exit(f"Unknown source(s): {', '.join(sources - {'epic', 'lantern'})}")

    env = {k: os.environ.get(k) for k in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "INGEST_TOKEN")}
    upload = not args.no_upload
    if upload and not all(env.values()):
        missing = ", ".join(k for k, v in env.items() if not v)
        sys.exit(f"Missing {missing}. Set them or pass --no-upload.")

    servers, brands, endpoint_count, bundle_updated = [], [], 0, None
    if "epic" in sources:
        print("Downloading Epic Brands bundle...", flush=True)
        if args.bundle:
            with open(args.bundle) as f:
                bundle = json.load(f)
        else:
            bundle = json.loads(http_get(BRANDS_URL, timeout=180))
        bundle_updated = (bundle.get("meta") or {}).get("lastUpdated")
        s, b, n = index_epic(bundle)
        print(f"  Epic: {n} endpoints -> {len(s)} servers, {len(b)} brands", flush=True)
        servers += s; brands += b; endpoint_count += n
    if "lantern" in sources:
        print("Downloading ONC Lantern CHPL endpoint export...", flush=True)
        if args.lantern_csv:
            with open(args.lantern_csv, "rb") as f:
                raw = f.read()
        else:
            raw = http_get(LANTERN_URL, timeout=600)
        # Epic comes from its own bundle when that source is on (Lantern's Epic list is a subset).
        s, b, n = index_lantern(raw, {EPIC_VENDOR} if "epic" in sources else set())
        print(f"  Lantern: {n} endpoints -> {len(s)} servers across "
              f"{len({x['vendor'] for x in s})} developers, {len(b)} org names", flush=True)
        servers += s; brands += b; endpoint_count += n

    servers = dedupe(servers)

    db = run_id = None
    if upload:
        db = Supabase(env["SUPABASE_URL"], env["SUPABASE_ANON_KEY"], env["INGEST_TOKEN"])
        run_id = db.rpc("ingest_start_scan", p_trigger=args.trigger,
                        p_bundle_last_updated=bundle_updated, p_endpoint_count=endpoint_count)
        print(f"Started scan run {run_id}", flush=True)

    try:
        t0 = time.time()
        rows = scan(servers, args.workers, args.retry_delay)
        failures = sum(1 for r in rows if r["error"])
        print(f"Probed {len(rows)} servers in {time.time() - t0:.0f}s; {failures} failed after retry", flush=True)

        os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
        with open(args.out, "w") as f:
            json.dump({"scanned_at": dt.datetime.now(dt.timezone.utc).isoformat(), "servers": rows}, f, indent=1)

        if upload:
            for batch in chunks(rows, 200):
                db.rpc("ingest_add_results", p_run_id=run_id, p_rows=batch)
            for batch in chunks(brands, 5000):
                db.rpc("ingest_upsert_brands", p_run_id=run_id, p_rows=batch)
            db.rpc("ingest_finish_scan", p_run_id=run_id, p_status="complete",
                   p_server_count=len(rows), p_success_count=len(rows) - failures,
                   p_failure_count=failures)
            print(f"Uploaded scan run {run_id}", flush=True)
    except BaseException:
        if upload and run_id is not None:
            try:
                db.rpc("ingest_finish_scan", p_run_id=run_id, p_status="failed",
                       p_server_count=None, p_success_count=None, p_failure_count=None)
            except Exception as ex:
                print(f"Could not mark run {run_id} failed: {ex}", file=sys.stderr)
        raise

    by_vendor = collections.defaultdict(list)
    for r in rows:
        by_vendor[r["vendor"]].append(r)
    print("\nServers by EHR (top 15):")
    for vendor, rs in sorted(by_vendor.items(), key=lambda kv: -len(kv[1]))[:15]:
        ok = sum(1 for r in rs if not r["error"])
        print(f"  {vendor[:44]:<44} {len(rs):>5} servers  {ok:>5} responding")
    epic = by_vendor.get(EPIC_VENDOR, [])
    if epic:
        counts = collections.Counter(r["software_version"] or "(no response)" for r in epic)
        order = sorted(counts, key=lambda v: parse_release_month(v) or dt.date.min, reverse=True)
        print("\nEpic servers by release:")
        for v in order:
            print(f"  {v:<16} {counts[v]:>4}")


if __name__ == "__main__":
    main()
