import { lengthIssues, describeIssue } from "./lengths.js";
import { localDay } from "./settings.js";

function cell(v) {
  let s = String(v ?? "").replace(/\r?\n/g, " ");

  /* A cell opening with = + - or @ is executed as a formula by Excel and
     Sheets. Listing text legitimately starts with "-" now and then, so
     prefix rather than strip: the value stays readable and stops being
     a formula. */
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;

  return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* Character counts sit next to every length-controlled field, and one
   summary column says whether the row is publishable as-is. Sorting on
   length_ok is the fastest way to find what still needs a human. */
const HEAD = [
  "part_number", "brand", "model", "product_type", "condition", "confidence",
  "length_ok", "length_notes",
  "title", "title_chars",
  "bullet_1", "bullet_1_chars", "bullet_2", "bullet_2_chars", "bullet_3", "bullet_3_chars",
  "bullet_4", "bullet_4_chars", "bullet_5", "bullet_5_chars",
  "description", "description_chars",
  "specs", "compatibility", "alternate_part_numbers", "warnings", "sources"
];

export function buildCsv(items, settings) {
  const rows = items.map(item => {
    const d = item.data;
    const issues = lengthIssues(d, settings);

    return [
      d.part_number, d.brand, d.model, d.product_type,
      item.opts?.condition || "", d.confidence,
      issues.length ? "NO" : "yes",
      issues.map(describeIssue).join(" "),
      d.title, d.title.length,
      ...[0, 1, 2, 3, 4].flatMap(n => [d.bullets[n] || "", (d.bullets[n] || "").length]),
      d.description, d.description.length,
      d.specs.map(s => `${s.label}: ${s.value}`).join(" | "),
      d.compatibility.join(" | "),
      d.alternate_part_numbers.join(" | "),
      d.warnings.join(" | "),
      d.sources.map(s => s.url).join(" | ")
    ].map(cell).join(",");
  });

  // BOM so Excel opens UTF-8 correctly on Windows.
  return "\uFEFF" + [HEAD.join(","), ...rows].join("\r\n");
}

export function downloadCsv(items, settings) {
  const blob = new Blob([buildCsv(items, settings)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `listings-${localDay()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
