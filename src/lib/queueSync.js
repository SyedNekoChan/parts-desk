/* ============================================================
   Cross-tab queue synchronisation

   Pure logic, split out from App.jsx so it can be unit tested directly
   (App.jsx is a React component and isn't importable by the plain-node
   test runner) and so the merge algorithm has one place to change.
   ============================================================ */

/* Ids used to be a per-tab sequential counter seeded once from the
   items already on disk at mount. Two tabs open at once each start
   their own counter from the same seed, so both could hand out the
   same id to two different parts in the same session — and the
   cross-tab merge, which matches items by id, would then silently
   treat one part's research as if it belonged to the other. A
   timestamp plus a random suffix makes a same-millisecond collision
   between two tabs astronomically unlikely without needing any
   cross-tab coordination to avoid it. */
export function makeItemId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// A heartbeat older than this is assumed to belong to a tab that
// crashed, was closed, or lost its network mid-run rather than one
// still genuinely working — after this long, the item is treated as
// abandoned instead of being protected as "another tab has it".
export const RUNNING_HEARTBEAT_TIMEOUT_MS = 45000;

export function isHeartbeatFresh(itemId, heartbeats, now = Date.now()) {
  const ts = heartbeats?.[itemId];
  return typeof ts === "number" && now - ts < RUNNING_HEARTBEAT_TIMEOUT_MS;
}

/* Multi-tab merge for the persisted queue. The native `storage` event
   only fires in *other* tabs than the one that wrote — never the tab
   that made the change — so there is no risk of an update loop from
   simply reacting to it, but the merge result itself still needs to be
   stable: two tabs merging each other's *different* local orderings
   into new arrays, and each writing that back, can otherwise volley
   indefinitely (each write looking "different" to the other tab only
   because of order, not content).

   Fixed here two ways: the merged array is always emitted in a single
   deterministic order (sorted by id) regardless of either side's local
   order, so two tabs merging the same underlying items always produce
   byte-identical output; and the caller (the storage-event handler in
   App.jsx) skips the state update entirely when the merge result
   serialises identically to what's already there, so a merge that
   changed nothing never triggers a write, and therefore never triggers
   the other tab's listener either.

   For any id present on both sides, the local copy wins when this tab
   considers it authoritative (actively running with a heartbeat still
   fresh, or already finished with data the incoming copy lacks);
   otherwise the incoming copy wins, since it reflects a change (a run
   finishing, a rerun) that happened in the other tab and this tab
   doesn't know about yet. A remote "running" whose heartbeat has gone
   stale is treated as abandoned and downgraded to "queued" rather than
   adopted or left stuck forever. Items unique to one side are kept. */
export function mergeRemoteItems(local, incoming, heartbeats, now = Date.now()) {
  const localById = new Map(local.map(i => [i.id, i]));
  const incomingById = new Map(incoming.map(i => [i.id, i]));
  const ids = new Set([...localById.keys(), ...incomingById.keys()]);

  const merged = [];
  for (const id of ids) {
    const loc = localById.get(id);
    let inc = incomingById.get(id);

    // Ids are only meant to collide when they refer to the same part;
    // a genuine collision (two tabs independently assigning the same
    // id to different parts) must never merge one part's data onto
    // another's — keep both sides' own copy of the id rather than
    // silently overwriting one part with an unrelated one.
    if (loc && inc && loc.part !== inc.part) {
      merged.push(loc);
      continue;
    }

    if (inc && inc.status === "running" && !isHeartbeatFresh(id, heartbeats, now)) {
      inc = { ...inc, status: "queued" };
    }

    if (loc && !inc) { merged.push(loc); continue; }
    if (inc && !loc) { merged.push({ ...inc, log: [] }); continue; }

    const localAuthoritative =
      (loc.status === "running" && isHeartbeatFresh(id, heartbeats, now)) ||
      (loc.status !== "queued" && !inc.data && loc.data);

    merged.push(localAuthoritative ? loc : { ...inc, log: loc.log || [] });
  }

  // Ids are timestamp-prefixed strings, so lexicographic order is also
  // chronological order for same-length ids (the common case) and a
  // stable, deterministic tiebreak either way.
  merged.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return merged;
}
