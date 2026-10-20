"""Create (or rotate) the scanner's ingest token.

Writes INGEST_TOKEN into .env (git-ignored) and prints the SQL that registers its hash in
your Supabase project. The database only ever stores the sha256, never the token.

    python3 scripts/new_ingest_token.py
"""

import hashlib
import os
import secrets

ENV = os.path.join(os.path.dirname(__file__), "..", ".env")

token = secrets.token_urlsafe(32)
lines = []
if os.path.exists(ENV):
    with open(ENV) as f:
        lines = [l for l in f.read().splitlines() if not l.startswith("INGEST_TOKEN=")]
lines.append(f"INGEST_TOKEN={token}")
fd = os.open(ENV, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    f.write("\n".join(lines) + "\n")
os.chmod(ENV, 0o600)  # also tighten a pre-existing .env

digest = hashlib.sha256(token.encode()).hexdigest()
print("Wrote INGEST_TOKEN to .env\n")
print("Run this in the Supabase SQL editor:\n")
print(f"  insert into public.ingest_tokens (token_sha256, label) values ('{digest}', 'scanner');\n")
print("Rotating? Delete the old row afterwards:  delete from public.ingest_tokens where token_sha256 <> "
      f"'{digest}';")
