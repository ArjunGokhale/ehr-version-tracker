"""Scan every FHIR server in Epic's public Brands bundle and record its Epic release.

Method (after Brendan Keeler, "Your Version Is Showing"): download the Brands bundle,
request [address]/metadata for each unique server with Accept: application/fhir+json,
retry failures once, and read CapabilityStatement.software.version.

Standard library only. Writes to Supabase through the ingest_* RPCs when SUPABASE_URL,
SUPABASE_ANON_KEY and INGEST_TOKEN are set; always writes a local JSON copy.

    python3 scanner/scan.py                  # scan + upload (if env is set)
    python3 scanner/scan.py --no-upload      # scan, local JSON only
"""

import argparse
import collections
import datetime as dt
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
USER_AGENT = "epic-version-tracker/1.0 (+https://github.com/ArjunGokhale/epic-version-tracker)"
MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august",
     "september", "october", "november", "december"], start=1)}

SSL_CTX = ssl.create_default_context()


def http_json(url, *, method="GET", body=None, headers=None, timeout=30):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"User-Agent": USER_AGENT, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as resp:
        raw = resp.read()
    return json.loads(raw) if raw else None


def parse_release_month(version):
    """'February 2026' -> date(2026, 2, 1); anything else -> None."""
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


def load_bundle(path=None):
    if path:
        with open(path) as f:
            return json.load(f)
    return http_json(BRANDS_URL, timeout=180)


def index_bundle(bundle):
    """Group the bundle into unique servers and a flat brand directory."""
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
        s = servers.setdefault(addr.lower(), {
            "address": addr, "host": urllib.parse.urlparse(addr).hostname,
            "endpoint_names": set(), "managing_orgs": set(), "brands": set(),
            "locations": 0, "states": set()})
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
                       "parent_org_id": None, "addresses": addrs, "city": None, "state": state})

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
                       "addresses": addrs, "city": addr0.get("city"), "state": addr0.get("state")})

    return list(servers.values()), brands, len(endpoints)


def fetch_metadata(address):
    cs = http_json(address + "/metadata", headers={"Accept": "application/fhir+json"})
    sw = cs.get("software") or {}
    return {"software_name": sw.get("name"), "software_version": sw.get("version"),
            "build_date": parse_date(sw.get("releaseDate")), "fhir_version": cs.get("fhirVersion")}


def probe(server, retry_delay):
    err = None
    for attempt in (1, 2):
        try:
            return {**fetch_metadata(server["address"]), "attempts": attempt, "error": None}
        except Exception as ex:  # any failure counts; one retry, then record the error
            err = f"{type(ex).__name__}: {ex}"[:300]
            if attempt == 1:
                time.sleep(retry_delay)
    return {"software_name": None, "software_version": None, "build_date": None,
            "fhir_version": None, "attempts": 2, "error": err}


def scan(servers, workers, retry_delay):
    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(lambda s: probe(s, retry_delay), servers))
    rows = []
    for s, r in zip(servers, results):
        month = parse_release_month(r["software_version"])
        rows.append({"address": s["address"], "host": s["host"],
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
    ap.add_argument("--bundle", help="use a local Brands bundle file instead of downloading")
    ap.add_argument("--out", default="data/latest_scan.json", help="local JSON output path")
    ap.add_argument("--workers", type=int, default=24)
    ap.add_argument("--retry-delay", type=float, default=5.0)
    ap.add_argument("--no-upload", action="store_true")
    ap.add_argument("--trigger", default=os.environ.get("SCAN_TRIGGER", "manual"))
    args = ap.parse_args()

    env = {k: os.environ.get(k) for k in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "INGEST_TOKEN")}
    upload = not args.no_upload
    if upload and not all(env.values()):
        missing = ", ".join(k for k, v in env.items() if not v)
        sys.exit(f"Missing {missing}. Set them or pass --no-upload.")

    print("Downloading Brands bundle...", flush=True)
    bundle = load_bundle(args.bundle)
    servers, brands, endpoint_count = index_bundle(bundle)
    print(f"{endpoint_count} endpoints -> {len(servers)} unique servers, {len(brands)} brands", flush=True)

    db = run_id = None
    if upload:
        db = Supabase(env["SUPABASE_URL"], env["SUPABASE_ANON_KEY"], env["INGEST_TOKEN"])
        run_id = db.rpc("ingest_start_scan", p_trigger=args.trigger,
                        p_bundle_last_updated=(bundle.get("meta") or {}).get("lastUpdated"),
                        p_endpoint_count=endpoint_count)
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

    counts = collections.Counter(r["software_version"] or "(no response)" for r in rows)
    order = sorted(counts, key=lambda v: parse_release_month(v) or dt.date.min, reverse=True)
    print("\nServers by release:")
    for v in order:
        print(f"  {v:<16} {counts[v]:>4}")


if __name__ == "__main__":
    main()
