# SETUP.md — Add a person to a running instance

Use this procedure when an instance of katte is **already deployed**
(see [DEPLOY.md](DEPLOY.md)) and you want to give one more person access.
It also covers the initial members right after a fresh deployment.

**This procedure does not touch the infrastructure.** No D1 database is
created, no Worker is deployed or changed. The only server-side change is
one row in the `tokens` table.

## What you need before starting

- The instance's **base URL** (e.g. `https://katte.<subdomain>.workers.dev`).
- A way to run one SQL statement against the instance's D1 database
  (wrangler, the Cloudflare dashboard, or the API — whoever administers
  the instance does this part).
- An **actor name** for the new person: a short identifier such as
  `alice` or `bob`. It appears in the history as who did what. It must
  not already exist in `tokens`.
- A private channel to hand that person their token (never a group chat,
  never a committed file).

## 1. Generate the person's token

Tokens are per person: one long random string (64 characters).

```bash
python3 -c "import secrets,string; print(''.join(secrets.choice(string.ascii_letters+string.digits+'-_') for _ in range(64)))"
```

Keep the plaintext in memory / a scratch note only until step 4. It is
never stored on the server.

## 2. Register only the hash

Compute the SHA-256 hash of the token:

```bash
printf %s "$TOKEN" | shasum -a 256
```

Insert **the hash only** into the instance's D1 `tokens` table
(replace `<ACTOR>` and `<SHA256_HEX>`):

```bash
wrangler d1 execute katte --remote \
  --command="INSERT INTO tokens (name, token_hash, created_at) VALUES ('<ACTOR>', '<SHA256_HEX>', datetime('now'));"
```

(Use the database name of the actual instance; `katte` here stands
for whatever it was deployed as.)

## 3. Verify the token works

```bash
export BASE="https://katte.<subdomain>.workers.dev"
curl -s "$BASE/items" -H "Authorization: Bearer $TOKEN"
```

Expected: the current list as JSON (HTTP 200). A `401` means the hash in
the table does not match the token — re-check steps 1–2.

## 4. Hand over to the person

Give the person, through the private channel:

- the **plaintext token** (this is the only copy they need; once their
  agent has stored it, the scratch note can be deleted),
- the **base URL**,
- `SKILL.md` and `shopping.py` from this repository.

## 5. Set up the person's agent

Whoever operates that person's AI agent (often the agent itself, guided
by the person) does the following:

1. **Install the skill.** Place `SKILL.md` where the agent loads skills
   from, so the agent knows how to call the API and how to behave
   (store judgement, memos, recipe handling).
2. **Store the token.** Create the token file the skill expects: a JSON
   file mapping actor names to tokens, containing **only their own**
   entry, e.g.:

   ```json
   { "alice": "<TOKEN_FOR_ALICE>" }
   ```

   Store it in a protected location on that person's side, with
   permissions `chmod 600`, outside any git repository (or covered by
   `.gitignore`). Never paste the token into chat logs, notes, or code.
3. **Configure the helper / skill settings:**
   - `SHOPPING_API_BASE` = the base URL
   - `SHOPPING_TOKEN_FILE` = path to the token file from step 2
   - `SHOPPING_ACTOR` = their actor name
4. **Smoke test** from the agent side:

   ```bash
   python3 shopping.py list
   ```

   Expected: the shared list. Then have the agent add one test item and
   confirm it appears with `added_by` set to their actor name; remove
   the test item afterwards.

Done — the person can now use the list through their agent. Repeat this
document per person.

## Revoking access

If a token leaks or a person leaves, one statement disables just their
token; nobody else is affected and no redeploy is needed:

```sql
UPDATE tokens SET revoked_at = datetime('now') WHERE name = '<ACTOR>';
```

To reissue, run this document again with a fresh token (a new row is not
needed if you update `token_hash` and clear `revoked_at` on the existing
row — either way, only the hash is stored).
