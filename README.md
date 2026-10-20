# Epic Version Tracker

Which Epic release every public FHIR server reports, rescanned on demand, with a login-gated dashboard.

Method after Brendan Keeler, ["Your Version Is Showing"](https://healthapiguy.substack.com/p/your-version-is-showing):
download Epic's public [Brands bundle](https://open.epic.com/Endpoints/Brands), request `[address]/metadata`
from each unique server with `Accept: application/fhir+json`, retry failures once, and record
`CapabilityStatement.software.version` (e.g. `February 2026`). Each server is counted once even though
many brands share one.

## Pieces

| Path | What it is |
|---|---|
| `scanner/scan.py` | Standard-library Python scanner. Writes each scan to Supabase and a local `data/latest_scan.json`. |
| `.github/workflows/scan.yml` | Runs the scanner on demand (no schedule). |
| `supabase/migrations/` | Schema, row-level security, and the token-gated ingest functions. |
| `web/` | Next.js dashboard (charts, server list, hospital/clinic search, CSV export). |

Supabase project: `epic-version-tracker` (`omrxqhtjluzujbdpfrrd`, us-east-1, free tier). Free projects pause
after about a week without activity; if the dashboard errors, restore the project from the Supabase dashboard
(takes a few minutes) before running a scan.

## Requery

- **From GitHub:** Actions → *Scan Epic FHIR servers* → *Run workflow*, or
  `gh workflow run scan.yml`. Takes about two minutes; the dashboard shows it on refresh.
- **Locally:** `set -a; . ./.env; set +a; python3 scanner/scan.py`
  (`--no-upload` to just write `data/latest_scan.json` and print the table).

## Run the dashboard

```bash
cd web && cp .env.local.example .env.local && npm install && npm run dev
```

Deploy: `vercel login` once, then from `web/` link the project, add the two `NEXT_PUBLIC_*` values from
`.env.local.example` as Vercel env vars, and `vercel deploy --prod`.

## Access model

- **Readers:** the dashboard requires a login, and data is readable only by logins listed in
  `public.allowed_users`. Signing up on your own grants nothing. The shared team login is
  `demo` (credentials in the git-ignored `DEMO_CREDENTIALS.txt`). To add someone, create a user in
  Supabase Auth and insert their email into `allowed_users`.
- **Scanner:** writes only through `ingest_*` RPC functions that check a token against a sha256 hash
  in `ingest_tokens`. CI holds the publishable key and that token, never the service-role key, so a
  leaked CI secret can add scans and nothing else. Rotate by inserting a new hash, updating the
  `INGEST_TOKEN` secret (`scripts/setup_secrets.sh`), and deleting the old row.

## Definitions

- **Server:** a unique FHIR base address (case-insensitive, trailing slash ignored).
- **Customer:** the endpoint's `managingOrganization`, i.e. the Epic instance owner. All addresses
  under one customer report the same release.
- **Over a year old:** the release month is more than 12 months before the scan date. Epic ships
  quarterly (February, May, August, November).
- **No response:** both attempts failed (timeout, HTTP error, or a non-FHIR reply).
