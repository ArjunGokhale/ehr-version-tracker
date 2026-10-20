# EHR Version Tracker

Which software version every public certified-EHR FHIR server reports, rescanned on demand, with a
login-gated dashboard filterable by EHR.

Method after Brendan Keeler, ["Your Version Is Showing"](https://healthapiguy.substack.com/p/your-version-is-showing):
request `[base]/metadata` from each server with `Accept: application/fhir+json`, retry failures once, and
record `CapabilityStatement.software.version`.

## Sources

- **Epic:** Epic's public [Brands bundle](https://open.epic.com/Endpoints/Brands). Every unique server
  address is probed (~770). Lantern lists only ~450 Epic servers, so Epic always comes from here.
- **Every other certified EHR:** ONC [Lantern](https://lantern.healthit.gov)'s daily CHPL export
  (`/api/daily/download?source=CHPL`, no key needed), ~96k endpoints from ~180 developers. Multi-tenant
  vendors put thousands of practices on one host (athenahealth: ~23k endpoints on 5 hosts), so endpoints
  are grouped **by host** and one tenant is probed per host; the retry uses a different tenant. A host
  listed by two developers (parent and subsidiary) goes to the one listing more endpoints on it.

**What "version" means varies by vendor.** Epic reports a release month (`February 2026`), and Altera,
athenaPractice, Veradigm and a few others report real builds. MEDITECH reports `1.0.0` everywhere (its
interoperability layer, not the Expanse release), many vendors report a template or HAPI server version,
and Oracle Health and others report nothing. Compare versions within one EHR, not across them; release
age ("over a year old") is computed for Epic only.

## Pieces

| Path | What it is |
|---|---|
| `scanner/scan.py` | Standard-library Python scanner (`--sources epic,lantern`). Writes each scan to Supabase and a local `data/latest_scan.json`. |
| `.github/workflows/scan.yml` | Runs the scanner on demand (no schedule). |
| `supabase/migrations/` | Schema, row-level security, and the token-gated ingest functions. |
| `web/` | Next.js dashboard (charts, server list, hospital/clinic search, CSV export). |

Supabase project: `epic-version-tracker` (`omrxqhtjluzujbdpfrrd`, us-east-1, free tier). Free projects pause
after about a week without activity; if the dashboard errors, restore the project from the Supabase dashboard
(takes a few minutes) before running a scan.

## Requery

- **From GitHub:** Actions → *Scan Epic FHIR servers* → *Run workflow*, or
  `gh workflow run scan.yml`. Takes about 10 minutes for all EHRs; the dashboard shows it on refresh.
- **Locally:** `set -a; . ./.env; set +a; python3 scanner/scan.py`
  (`--no-upload` to just write `data/latest_scan.json` and print the table).

## Run the dashboard

```bash
cd web && cp .env.local.example .env.local && npm install && npm run dev
```

Deploy: `vercel login` once, then from `web/` link the project, add the two `NEXT_PUBLIC_*` values from
`.env.local.example` as Vercel env vars, and `vercel deploy --prod`.

## Access model

- **Search:** the hospital/clinic search goes through `search_brands()`, a definer function that checks
  the reader allowlist itself, because under RLS Postgres can't use the trigram index for `ILIKE`.
- **Readers:** the dashboard requires a login, and data is readable only by logins listed in
  `public.allowed_users`. Signing up on your own grants nothing. The shared team login is
  `demo` (credentials in the git-ignored `DEMO_CREDENTIALS.txt`). To add someone, create a user in
  Supabase Auth and insert their email into `allowed_users`.
- **Scanner:** writes only through `ingest_*` RPC functions that check a token against a sha256 hash
  in `ingest_tokens`. CI holds the publishable key and that token, never the service-role key, so a
  leaked CI secret can add scans and nothing else. Rotate by inserting a new hash, updating the
  `INGEST_TOKEN` secret (`scripts/setup_secrets.sh`), and deleting the old row.

## Definitions

- **Server:** for Epic, a unique FHIR base address (case-insensitive, trailing slash ignored); for
  other EHRs, a unique host. **Endpoints** counts the published endpoints a server represents.
- **Customer (Epic only):** the endpoint's `managingOrganization`, i.e. the Epic instance owner. All
  addresses under one customer report the same release.
- **Over a year old (Epic only):** the release month is more than 12 months before the scan date.
  Epic ships quarterly (February, May, August, November).
- **No response:** both attempts failed (timeout, HTTP error, or a non-FHIR reply).
