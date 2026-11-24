---
name: katte
description: Operate a shared, event-sourced shopping list through its API — add, list, check off, edit and remove items for the household, judging store assignment from item names and memos.
---

# Shared Shopping List

Use this skill whenever the user talks about the shared shopping list:
adding things to buy, asking what is needed, reporting a purchase, or
planning shopping at a specific store.

## Configuration (per installation — ask the owner if unset)

- `SHOPPING_API_BASE` — the API base URL of the household's deployment,
  e.g. `https://katte.<subdomain>.workers.dev`
- `SHOPPING_TOKEN_FILE` — path to a protected local JSON file
  (mode 600, never committed) mapping actor names to Bearer tokens.
  This agent uses only its own actor's token. Never print, quote, or copy
  token values into chat, notes, or code.

A helper CLI is provided as `shopping.py` in this package:

```
python3 shopping.py list
python3 shopping.py add NAME [MEMO] [--personal]
python3 shopping.py check ITEM_ID | uncheck ITEM_ID
python3 shopping.py edit ITEM_ID NAME [MEMO]
python3 shopping.py scope ITEM_ID family|personal
python3 shopping.py remove ITEM_ID
python3 shopping.py clear-checked
```

It reads `SHOPPING_API_BASE` and `SHOPPING_TOKEN_FILE` from the environment
(actor selectable with `SHOPPING_ACTOR`, default `alice`-style name set at
install time). Equivalent raw HTTP calls are fine too:
`Authorization: Bearer <token>` on every request; see the API table in
`README.md`.

## Core model

- The list is a set of items with `name`, free-text `memo`, and a
  purchased ("checked") flag. There are **no tags and no categories** —
  never ask the user to classify an item.
- Every change is an event on the server; the list you read is the current
  derived state. Deleting is also an event, so history is preserved —
  you do not need to keep your own copy or backup of the list.
- `added_by` shows who added an item. It comes from the token, not from
  anything you send.
- Every item has a `scope`: `family` (visible to everyone) or `personal`
  (visible only to the person who added it). Default is `family`. When
  the user says an item is for themselves, add it with `--personal`.
  Only the owner can move an item between scopes (`scope` command) —
  e.g. moving a personal item to `family` when asking someone else to
  buy it.

## Behavior

### Adding

- Add exactly what the user decided to buy. Quantities and notes go into
  `memo` as free text ("2 bottles", "the usual one").
- If an item is only sold at a particular store, or has a store-specific
  constraint the user mentions, write that into `memo` (e.g. "only at
  Store X"). This is item knowledge carried in the memo — not a tag.
- Do not add maybes. If the user is still deciding, keep it in the
  conversation, not on the list.

### Listing and store judgement

- When the user is at (or heading to) a store, present the items that
  belong to that store. Decide belonging **from the meaning of each
  item's name and memo**: fresh food to the supermarket, hardware to the
  hardware store, and any item whose memo names that store (or excludes
  others) accordingly. Items that fit anywhere can be shown as
  "anywhere".
- Present unpurchased items; mention recently purchased ones only if
  relevant.

### Buying

- When the user says they bought something, mark it purchased (`check`).
  If they say it was a mistake, undo it (`uncheck`).
- "Clear the bought items" maps to `clear-checked`.

### Recipes and meal planning

- Recipe consultation happens in conversation with you, not in the app.
  Only when ingredients are **decided** do they go on the list, as
  ordinary items (with quantities in the memo).

### Editing and removing

- Fix name/memo with `edit`. Remove with `remove` when the user says an
  item is no longer needed. Both are recorded as events; nothing is lost
  by doing them.
