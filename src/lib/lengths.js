/* ============================================================
   Length enforcement

   The prompt asks for the right lengths; this measures whether it got
   them. Nothing here trusts the model to have counted anything.
   ============================================================ */

export const len = v => (typeof v === "string" ? v.trim().length : 0);

/* Models aim at the number you give them and land short of it, so the
   prompt asks for a point comfortably inside the range rather than the
   ceiling. Landing a little under a target leaves you inside the range;
   landing a little under a hard cap leaves you outside it about half
   the time. */
export function lengthTarget(min, max) {
  return Math.round(min + (max - min) * 0.7);
}

export function distanceOutside(n, min, max) {
  return n > max ? n - max : n < min ? min - n : 0;
}

/** One entry per field outside its range, with enough detail to both
 *  explain it to the operator and instruct a rewrite. */
export function lengthIssues(d, settings) {
  const out = [];
  const check = (field, label, value, min, max) => {
    const n = len(value);
    if (!n && !min) return;
    if (n > max) out.push({ field, label, n, min, max, over: true, delta: n - max });
    else if (n < min) out.push({ field, label, n, min, max, over: false, delta: min - n });
  };

  check("title", "Title", d.title, settings.titleMin, settings.titleMax);
  (d.bullets || []).forEach((b, i) =>
    check(`bullet${i}`, `Bullet ${i + 1}`, b, settings.bulletMin, settings.bulletMax));
  check("description", "Description", d.description, settings.descMin, settings.descMax);

  return out;
}

export function describeIssue(i) {
  return i.over
    ? `${i.label} is ${i.n} characters, ${i.delta} over the ${i.max} hard cap.`
    : `${i.label} is ${i.n} characters, ${i.delta} short of the ${i.min} minimum.`;
}

/* research.js's own repair pass can push a describeIssue()-formatted
   string into d.warnings when it gives up on a field. That string
   describes a specific field's length problem at the moment generation
   finished — if the operator has since fixed that field (a manual
   edit, or the editor's "Fit to range"), the field no longer has that
   issue, but the stale string would otherwise sit in d.warnings
   forever with nothing to ever clear it, keeping the item stuck in
   review and showing a false warning on export.

   Used by needsReview() and the CSV export (previously only the editor
   filtered this for display, so an item could look clean in the editor
   but still count as "review" and still show the stale text in the
   CSV). Recomputes "current" length-shaped warning text against the
   listing's actual current fields and drops any stored warning that
   matches a since-resolved issue; a warning describing something real
   (thin sourcing, ambiguous identification) is left untouched. */
export function liveWarnings(d, settings) {
  const currentIssueTexts = new Set(lengthIssues(d, settings).map(describeIssue));
  const isStaleLengthWarning = w =>
    /^(Title|Bullet \d+|Description) is \d+ characters,/.test(w) && !currentIssueTexts.has(w);
  return (d.warnings || []).filter(w => !isStaleLengthWarning(w));
}

export function fieldValue(d, field) {
  if (field === "title") return d.title || "";
  if (field === "description") return d.description || "";
  const m = /^bullet(\d+)$/.exec(field);
  return m ? ((d.bullets || [])[+m[1]] || "") : "";
}

export function setFieldValue(d, field, value) {
  if (field === "title") { d.title = value; return; }
  if (field === "description") { d.description = value; return; }
  const m = /^bullet(\d+)$/.exec(field);
  if (m) d.bullets[+m[1]] = value;
}

/* Models like to wrap a single-field answer in quotes or a code fence
   even when told not to. Strip that rather than let it eat characters
   out of the budget or show up in a published title. */
export function stripWrapping(s) {
  let t = String(s).trim();
  t = t.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "").trim();
  if (t.length > 1 && /^["'"]/.test(t) && /["'"]$/.test(t)) t = t.slice(1, -1).trim();
  return t;
}

/** Range state for a single field, used by the editor counters. */
export function rangeState(value, min, max) {
  const n = len(value);
  if (n > max) return { n, state: "over", off: n - max, label: `${n} / ${max} — ${n - max} over` };
  if (n < min) return { n, state: "under", off: min - n, label: `${n} / ${min} min — ${min - n} short` };
  return { n, state: "ok", off: 0, label: `${n} · ${min}–${max}` };
}
