/* ============================================================
   Pure render-branch logic for the active listing view.

   Split out as a plain function (not inline JSX) for two reasons:
   it's unit-testable without a DOM/React renderer, and it gives the
   three possible outcomes names, which is what was missing before —
   the previous render guard only checked whether an active item
   existed at all, not whether it was safe to hand to ListingEditor
   (which assumes item.data is populated and crashes on null).
   ============================================================ */

/** Which view App.jsx should render for the currently active item.
 *  Returns one of "error" | "listing" | "waiting" | "none". */
export function activeViewKind(active) {
  if (!active) return "none";
  if (active.status === "error") return "error";
  if (active.data) return "listing";
  return "waiting";
}
