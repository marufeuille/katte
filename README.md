# katte

A shared shopping list API designed to be used **through AI agents**, not through a UI.

One list lives on Cloudflare (Workers + D1). Each person talks to their own AI
agent in chat ("add milk", "what do we need at the supermarket?"), and the agent
reads and writes the list through this API. There is no app to open and no tags
to maintain: judging which items belong to which store is the agent's job,
done from the meaning of each item's name and memo.

## Design ideas

- **One source of truth.** The list exists exactly once, server-side. Every
  agent reads and writes the same list.
- **The intelligence is replaceable.** What you distribute is the API plus a
  skill (see `SKILL.md`) that teaches an agent how to call it and how to
  behave. The agent itself can be anything that can make HTTPS requests.
- **Event-sourced (append-only).** State is never updated in place. Every
  change is appended to an `events` table; the current list is *derived* by
  folding the events in order. The full history — who added, bought, or
  removed what, and when — is always preserved and auditable.
- **Thin server, smart edge.** The server only stores events and derives
  state. All judgement (store assignment, recipe-to-ingredient expansion)
  happens in the agent.
- **No manual classification.** There are no tags or categories. Store-specific
  notes ("only sold at Store X") go into the item's free-text memo, and the
  agent interprets them.

## Architecture

```
person A ── their AI agent ──(skill)──┐
                                      ├─→ API (Cloudflare Workers) ── D1 (events + tokens)
person B ── their AI agent ──(skill)──┘
```

- **Cloudflare Workers** — the API. Stateless; all state is in D1.
- **Cloudflare D1** — two tables:
  - `events` — append-only log (`item_id`, `type`, `name`, `memo`, `scope`, `actor`, `created_at`)
  - `tokens` — per-person API tokens, stored only as SHA-256 hashes

## Event types

| type | meaning |
| --- | --- |
| `item_added` | an item was added (carries `name` / `memo`) |
| `item_purchased` | the item was bought ("checked") |
| `purchase_reverted` | the purchase was undone |
| `item_edited` | `name` and/or `memo` was changed |
| `item_removed` | the item was removed; later events for that item are ignored |

"Clear all purchased items" is not a special event: the API appends one
`item_removed` per purchased item, so each item's history stays self-contained.

## API

Base URL: your own deployment, e.g. `https://katte.<your-subdomain>.workers.dev`

All endpoints require `Authorization: Bearer <token>` (see below).

| Method & path | Description |
| --- | --- |
| `GET /items` | List items. Unpurchased first (in added order), then purchased (most recently purchased first). |
| `POST /items` | Add an item. Body: `{ "name": "milk", "memo": "2 bottles" }` (`memo` optional). Returns the created item, `201`. |
| `PATCH /items/:id` | Update. Body may contain `checked` (boolean), `name`, `memo`, and/or `scope` (`family`/`personal`; scope changes are owner-only). Appends the corresponding event(s). |
| `DELETE /items/:id` | Remove an item (appends `item_removed`). |
| `POST /items/clear-checked` | Remove all purchased items. Returns `{ "removed": <count> }`. |

Each item in responses looks like:

```json
{
  "id": "3f8c…(uuid)",
  "name": "milk",
  "memo": "2 bottles",
  "checked": false,
  "checked_at": null,
  "added_by": "alice",
  "created_at": "2026-01-01T00:00:00.000Z"
}
```

Errors: `401` for missing/invalid/revoked tokens, `400` for malformed
requests, `404` for unknown routes or item ids. Error bodies are
`{ "error": "..." }` and reveal nothing about the internals.

## Authentication & security model

- One **Bearer token per person**. The token is a long random string; who did
  what (`actor` / `added_by`) is determined from the token, never from the
  request body, so it cannot be spoofed by the client.
- The server stores only the **SHA-256 hash** of each token. A database leak
  does not leak usable tokens.
- Revoking a person is a single update (`revoked_at` timestamp); reissue
  means registering a new hash. Other people are unaffected.
- Plaintext tokens live only on each person's own side, in a protected local
  file that is never committed (see `.gitignore`).
- The data itself is deliberately low-sensitivity (item names and memos),
  which keeps the impact of any leak small.

## Getting started

- **Deploy your own instance:** follow [DEPLOY.md](DEPLOY.md) — the
  one-time infrastructure build (D1 + Worker). It is written so that an
  AI agent can execute the whole setup on your Cloudflare account.
- **Add a person:** follow [SETUP.md](SETUP.md) — token issuance and
  agent setup only; no infrastructure changes.
- **Teach your agent to use it:** give it [SKILL.md](SKILL.md) plus your API
  base URL and your token. A small CLI helper is included as
  [shopping.py](shopping.py).

## Repository layout

| Path | Role |
| --- | --- |
| `src/worker.js` | The entire Worker (API, auth, event folding) |
| `migrations/0001_init.sql` | D1 schema (`events`, `tokens`) |
| `wrangler.jsonc` | Wrangler config template (fill in your D1 database id) |
| `shopping.py` | Example CLI helper for agents/humans |
| `SKILL.md` | Agent skill: how to call the API and how to behave |
| `DEPLOY.md` | One-time deployment guide: build the infrastructure (agent-executable) |
| `SETUP.md` | Add-a-person guide: token issuance + agent setup on a running instance |
