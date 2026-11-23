# DEPLOY.md — Deploy your own instance

This guide is written for an **AI agent** setting up the shared shopping list
on the owner's Cloudflare account. Each step states what to run and what
result to expect. Ask the owner before anything that is not covered here.

**Scope:** this document covers the one-time infrastructure build
(D1 + Worker). Adding a person to an already-running instance is a
separate, smaller procedure: see [SETUP.md](SETUP.md).

## 0. Prerequisites

- A Cloudflare account (the free tier is enough).
- One of these tool paths:
  - **wrangler** (Cloudflare's CLI) — the commands below use this path, or
  - the **Cloudflare API** directly (dashboard or REST calls) — the same
    resources in the same order.
- `curl`, and a way to compute SHA-256 (`shasum -a 256`, `sha256sum`, or
  Python's `hashlib`).

Naming used below: Worker and database are both named `katte`.
The owner may rename them; if so, use the chosen names consistently.

## 1. Create the D1 database

```bash
wrangler d1 create katte
```

Note the returned `database_id` (a UUID). You will put it into
`wrangler.jsonc` in step 3.

## 2. Apply the schema

```bash
wrangler d1 execute katte --remote --file=migrations/0001_init.sql
```

This creates two tables: `events` (append-only log) and `tokens`
(per-person token hashes). Verify:

```bash
wrangler d1 execute katte --remote \
  --command="SELECT name FROM sqlite_master WHERE type='table';"
```

Expected: `events` and `tokens` are listed.

## 3. Configure the Worker

Edit `wrangler.jsonc`: replace `YOUR_D1_DATABASE_ID` with the `database_id`
from step 1. Leave the binding name as `DB` — the Worker code reads
`env.DB`.

## 4. Deploy the Worker

```bash
wrangler deploy
```

wrangler prints the public URL, of the form:

```
https://katte.<your-subdomain>.workers.dev
```

Call this the **base URL** below. (If the deploy does not enable the
workers.dev route, enable it: wrangler does this by default for a new
Worker; in the dashboard it is Settings → Domains & Routes → workers.dev.)

Sanity check — an unauthenticated request must be rejected:

```bash
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/items"
```

Expected: `401`.

## 5. Issue the first token(s)

Verification in step 6 needs at least one working token. Issuing a token
is the same procedure as adding a person later, so follow
[SETUP.md](SETUP.md) steps 1–3 for each of the initial people now
(generate token → register only its SHA-256 hash in `tokens` → hand the
plaintext to that person). Then continue with step 6 below.

To add more people at any later time, use [SETUP.md](SETUP.md) only — no
infrastructure changes are needed.

## 6. End-to-end verification

Run through one full cycle with a real token and confirm each result.
(Use the helper `shopping.py`, or raw curl as below.)

```bash
export BASE="https://katte.<your-subdomain>.workers.dev"
export TOKEN="<TOKEN_FOR_ALICE>"

# add an item -> expect 201 and the created item JSON
curl -s -X POST "$BASE/items" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"milk","memo":"2 bottles"}'

# list -> expect the item, checked=false
curl -s "$BASE/items" -H "Authorization: Bearer $TOKEN"

# mark purchased (use the id returned above) -> expect checked=true
curl -s -X PATCH "$BASE/items/<ITEM_ID>" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"checked":true}'

# undo the purchase -> expect checked=false
curl -s -X PATCH "$BASE/items/<ITEM_ID>" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"checked":false}'

# mark purchased again, then clear purchased items -> expect {"removed":1}
curl -s -X PATCH "$BASE/items/<ITEM_ID>" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"checked":true}'
curl -s -X POST "$BASE/items/clear-checked" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{}'

# list -> expect {"items":[]}
curl -s "$BASE/items" -H "Authorization: Bearer $TOKEN"

# a second person's token sees the same (now empty) list, and their
# additions are recorded with added_by set to their own actor name.
```

Also confirm the error cases: no token → `401`, unknown item id on PATCH →
`404`, POST without `name` → `400`.

Clean up any test items (DELETE them or clear-checked) so the list starts
empty.

## 7. Set up each person's agent

For every person — the initial members and anyone added later — follow
[SETUP.md](SETUP.md): it covers token issuance, installing `SKILL.md`
into their agent, and configuring the agent's token. Nothing in that
procedure touches the infrastructure built here.
