// family-shopping-list Worker
// Event-sourced shopping list API.
// - All state changes are appended to the `events` table only.
// - Current state is derived by folding events per item_id in order.
// - Auth: Authorization: Bearer <token>; SHA-256 hash matched against `tokens`.

const EVENT = {
  ADDED: "item_added",
  PURCHASED: "item_purchased",
  REVERTED: "purchase_reverted",
  EDITED: "item_edited",
  REMOVED: "item_removed",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function error(status, message) {
  return json({ error: message }, status);
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Returns the token's name (actor) or null when unauthenticated.
async function authenticate(request, env) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const hash = await sha256Hex(match[1].trim());
  const row = await env.DB.prepare(
    "SELECT name FROM tokens WHERE token_hash = ? AND revoked_at IS NULL"
  )
    .bind(hash)
    .first();
  return row ? row.name : null;
}

async function appendEvent(env, { itemId, type, name = null, memo = null, scope = null, actor }) {
  await env.DB.prepare(
    "INSERT INTO events (item_id, type, name, memo, scope, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(itemId, type, name, memo, scope, actor, new Date().toISOString())
    .run();
}

// Fold all events into the current item states.
// Events after item_removed for an item are ignored.
async function deriveItems(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, item_id, type, name, memo, scope, actor, created_at FROM events ORDER BY id ASC"
  ).all();
  const items = new Map();
  for (const ev of results) {
    const item = items.get(ev.item_id);
    if (item && item.removed) continue;
    switch (ev.type) {
      case EVENT.ADDED:
        items.set(ev.item_id, {
          id: ev.item_id,
          name: ev.name,
          memo: ev.memo,
          scope: ev.scope === "personal" ? "personal" : "family",
          checked: false,
          checked_at: null,
          added_by: ev.actor,
          created_at: ev.created_at,
          removed: false,
          last_event_id: ev.id,
        });
        break;
      case EVENT.EDITED:
        if (item) {
          if (ev.name !== null) item.name = ev.name;
          if (ev.memo !== null) item.memo = ev.memo;
          if (ev.scope !== null && ev.scope !== undefined) {
            item.scope = ev.scope === "personal" ? "personal" : "family";
          }
          item.last_event_id = ev.id;
        }
        break;
      case EVENT.PURCHASED:
        if (item) {
          item.checked = true;
          item.checked_at = ev.created_at;
          item.last_event_id = ev.id;
        }
        break;
      case EVENT.REVERTED:
        if (item) {
          item.checked = false;
          item.checked_at = null;
          item.last_event_id = ev.id;
        }
        break;
      case EVENT.REMOVED:
        if (item) {
          item.removed = true;
          item.last_event_id = ev.id;
        }
        break;
    }
  }
  return [...items.values()].filter((i) => !i.removed);
}

function publicItem(item) {
  return {
    id: item.id,
    name: item.name,
    memo: item.memo,
    scope: item.scope,
    checked: item.checked,
    checked_at: item.checked_at,
    added_by: item.added_by,
    created_at: item.created_at,
  };
}

// Family items are visible to everyone; personal items only to their owner.
function visibleTo(item, actor) {
  return item.scope !== "personal" || item.added_by === actor;
}

// Unchecked first (in added order), then checked (most recently checked first).
function sortItems(items) {
  const unchecked = items.filter((i) => !i.checked);
  const checked = items
    .filter((i) => i.checked)
    .sort((a, b) => (b.checked_at || "").localeCompare(a.checked_at || ""));
  return [...unchecked, ...checked];
}

async function parseBody(request) {
  try {
    const body = await request.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
    return body;
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method;

    const isClearChecked = method === "POST" && path === "/items/clear-checked";
    const itemMatch = path.match(/^\/items\/([^/]+)$/);
    const isCollection = path === "/items" && (method === "GET" || method === "POST");
    const isItemRoute = itemMatch && (method === "PATCH" || method === "DELETE");

    if (!isClearChecked && !isCollection && !isItemRoute) {
      return error(404, "not found");
    }

    const actor = await authenticate(request, env);
    if (!actor) return error(401, "unauthorized");

    // POST /items/clear-checked — append item_removed for each checked item.
    if (isClearChecked) {
      const items = await deriveItems(env);
      const targets = items.filter((i) => i.checked && visibleTo(i, actor));
      for (const item of targets) {
        await appendEvent(env, { itemId: item.id, type: EVENT.REMOVED, actor });
      }
      return json({ removed: targets.length });
    }

    // GET /items
    if (method === "GET" && path === "/items") {
      const items = sortItems((await deriveItems(env)).filter((i) => visibleTo(i, actor)));
      return json({ items: items.map(publicItem) });
    }

    // POST /items
    if (method === "POST" && path === "/items") {
      const body = await parseBody(request);
      if (!body) return error(400, "invalid request");
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return error(400, "name is required");
      const memo = body.memo === undefined || body.memo === null ? null : String(body.memo);
      const scope = body.scope === "personal" ? "personal" : "family";
      const itemId = crypto.randomUUID();
      await appendEvent(env, { itemId, type: EVENT.ADDED, name, memo, scope, actor });
      const items = await deriveItems(env);
      const created = items.find((i) => i.id === itemId);
      return json(publicItem(created), 201);
    }

    // PATCH / DELETE /items/:id
    const itemId = decodeURIComponent(itemMatch[1]);
    const items = await deriveItems(env);
    const item = items.find((i) => i.id === itemId);
    if (!item || !visibleTo(item, actor)) return error(404, "not found");

    if (method === "DELETE") {
      await appendEvent(env, { itemId, type: EVENT.REMOVED, actor });
      return json({ ok: true });
    }

    // PATCH
    const body = await parseBody(request);
    if (!body) return error(400, "invalid request");
    const hasName = typeof body.name === "string" && body.name.trim() !== "";
    const hasMemo = body.memo !== undefined;
    const hasChecked = typeof body.checked === "boolean";
    const hasScope = body.scope === "family" || body.scope === "personal";
    if (!hasName && !hasMemo && !hasChecked && !hasScope) return error(400, "nothing to update");
    if (hasScope && body.scope !== item.scope && actor !== item.added_by) {
      return error(403, "only the owner can change scope");
    }

    if (hasName || hasMemo || (hasScope && body.scope !== item.scope)) {
      await appendEvent(env, {
        itemId,
        type: EVENT.EDITED,
        name: hasName ? body.name.trim() : null,
        memo: hasMemo ? (body.memo === null ? null : String(body.memo)) : null,
        scope: hasScope && body.scope !== item.scope ? body.scope : null,
        actor,
      });
    }
    if (hasChecked && body.checked !== item.checked) {
      await appendEvent(env, {
        itemId,
        type: body.checked ? EVENT.PURCHASED : EVENT.REVERTED,
        actor,
      });
    }
    const updated = (await deriveItems(env)).find((i) => i.id === itemId);
    return json(publicItem(updated));
  },
};
