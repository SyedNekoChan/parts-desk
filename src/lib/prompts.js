import { RULES_MAX_CHARS } from "./settings.js";
import { lengthTarget, fieldValue } from "./lengths.js";

export const ACCURACY_RULES = `Accuracy matters more than completeness. This copy gets published as written, so a wrong specification is worse than a missing one.
- State a specification only if it appears in the search results below. Do not infer specs from part numbers that look similar, and do not fall back on general knowledge about the product line.
- Never invent capacities, speeds, socket or chipset names, port counts, panel sizes, resolutions, colours, dimensions or weights.
- Claim compatibility with a system only where a source lists that system.
- Trust manufacturer pages and official spec sheets first, then large distributors and parts specialists, then general marketplaces. Marketplace listings are weak evidence because sellers get part numbers wrong.
- If the results are ambiguous, contradictory, or don't clearly identify the part, say so plainly in "warnings" rather than picking the most likely guess.`;

const SHAPE = `{
  "part_number": string,
  "brand": string,
  "model": string,
  "product_type": string,
  "identified": boolean,
  "confidence": "high" | "medium" | "low",
  "title": string,
  "bullets": [string, string, string, string, string],
  "description": string,
  "specs": [{"label": string, "value": string}],
  "compatibility": [string],
  "alternate_part_numbers": [string],
  "warnings": [string]
}`;

export function formatPrompt(part, opts, sources, settings) {
  const t = settings.titleMax;
  const d = settings.descMax;
  const tTarget = lengthTarget(settings.titleMin, settings.titleMax);
  const bTarget = lengthTarget(settings.bulletMin, settings.bulletMax);
  const dTarget = lengthTarget(settings.descMin, settings.descMax);

  const lines = [];

  lines.push(`You write marketplace listing copy for computer hardware part numbers, for an IT hardware reseller (Dell, HP, Lenovo, Jabra, Poly, NVIDIA, AMD, Seagate and similar makers; also panels, bezels, cables, docks, spares).`);
  lines.push("");
  lines.push(`Below are real web search results for this part number. Use only what they actually say — do not add specifications, compatibility or model names that aren't in them, and do not fall back on general knowledge about the product line. If the results don't clearly identify the part, say so in "warnings" rather than guessing.`);
  lines.push("");
  lines.push(ACCURACY_RULES);
  lines.push("");
  lines.push(`Write for a buyer who searches by part number and then skims for whether it fits. Plain, concrete, specific. No marketing adjectives, no exclamation marks, no invented benefits, no first person. Never write a placeholder like "N/A" or "Unknown" into the title, bullets or description — leave the detail out instead.`);
  lines.push("");
  lines.push(`Return exactly this JSON shape and nothing else — no prose before or after, no markdown fences:`);
  lines.push(SHAPE);
  lines.push("");
  lines.push(`Field rules:`);
  lines.push(`- title: between ${settings.titleMin} and ${t} characters. Aim for about ${tTarget}. ${t} is a hard cap that is never exceeded. Brand first, then model or series, then the product type, then the specifications a buyer filters on — keep adding real, sourced qualifiers until the length is reached.${settings.pnInTitle ? " Include the part number, since buyers search for it." : " Do not include the part number."} No pipes, no ALL CAPS words, no repeated words, no filler such as "High Quality" or "Fast Shipping".`);
  lines.push(`- bullets: exactly five. Each one between ${settings.bulletMin} and ${settings.bulletMax} characters, aiming for about ${bTarget} — that range applies to each bullet on its own, not to the five added together, and ${settings.bulletMax} is a hard cap. Each is a complete statement opening with the concrete detail rather than a label. Cover different ground in each: what it is and where it goes; the headline specification; a second specification or physical detail; compatibility or what it replaces, only where the results support it; and condition or what is in the box. Do not restate the title.`);
  lines.push(`- description: between ${settings.descMin} and ${d} characters. Aim for about ${dTarget}. ${d} is a hard cap that is never exceeded. Three to five short paragraphs of plain prose, no headings and no bullet characters. Open with the brand, model and part number so the first line works as a search snippet. Then what it does and where it fits, then the specifications in full sentences, then compatibility, then condition and anything worth checking before ordering. Let the main search terms recur naturally two or three times across the whole text, no more.`);
  lines.push(`- specs: up to twelve rows taken from the search results.`);
  lines.push(`- warnings: what the operator must check before publishing — ambiguity about which product this is, disagreement between sources, thin sourcing. Empty array if the results were solid.`);
  lines.push(`- confidence: how well the search results pin this part down.`);
  lines.push("");
  lines.push(`Part number: ${part}`);
  if (opts.brand) lines.push(`Brand suggested by the operator (verify against the results, don't assume it): ${opts.brand}`);
  if (opts.condition) lines.push(`Condition to state: ${opts.condition}`);

  if (settings.rules && settings.rules.trim()) {
    lines.push("");
    lines.push(`House rules from the operator. These override the guidance above where they conflict:`);
    lines.push(settings.rules.trim().slice(0, RULES_MAX_CHARS));
  }

  lines.push("");
  lines.push(`On length: the ranges above are checked by machine after you answer, and anything outside them is sent back to be rewritten, so writing to length the first time saves a round trip. Reach the minimums with more real, sourced detail — further specifications, dimensions, what it replaces, what is in the box, what to verify before ordering — expressed in fuller sentences.`);
  lines.push(`Never reach a minimum by padding. Do not repeat yourself, do not restate the title inside the description, do not add marketing filler, and above all do not invent a specification that is not in the search results below. If the results are too thin to reach a minimum honestly, write the most complete accurate version you can, leave it short, and add a warning saying the sourced material was too thin to reach the required length. A short listing is a fixable problem; a wrong one is not.`);
  lines.push("");
  lines.push(`--- SEARCH RESULTS ---`);

  if (!sources.length) {
    lines.push(`(No search results came back for this part number.)`);
  } else {
    sources.forEach((s, i) => {
      lines.push(`[${i + 1}] ${s.title}`);
      lines.push(s.url);
      lines.push(s.content);
      lines.push("");
    });
  }

  return lines.join("\n");
}

/* Rewrites every out-of-range field in a single call. Batching matters:
   Mistral's free tier is rate-limited to a couple of requests a minute,
   so one repair call for six offending fields is the difference between
   a listing finishing and a batch stalling. The source material is
   re-supplied so lengthening has real facts to draw on rather than
   pressure to invent them. */
export function refitPrompt(d, issues, sources) {
  const lines = [];

  lines.push(`You are fixing the length of listing copy that is otherwise correct. Rewrite only the fields listed below. Every factual claim must survive: do not drop a specification, and do not add one that is not in the search results at the end of this message.`);
  lines.push("");
  lines.push(`Fields to fix:`);

  issues.forEach(i => {
    lines.push("");
    lines.push(`${i.label} — currently ${i.n} characters. Required: between ${i.min} and ${i.max}. Target: about ${lengthTarget(i.min, i.max)}.`);
    if (!i.n) {
      lines.push(`This field came back empty. Write it from scratch, to length, using only the search results below.`);
    } else {
      lines.push(i.over
        ? `Cut ${i.delta} or more characters. Remove repetition, filler and the least useful detail first. Keep the opening terms.`
        : `Add at least ${i.delta} characters of real, sourced detail — further specifications, dimensions, what it replaces, what is in the box, what to check before ordering. Do not pad, do not repeat, do not invent. If there is genuinely nothing more in the sources, return it as close to the minimum as the facts honestly allow.`);
      lines.push(`Current text:`);
      lines.push(fieldValue(d, i.field));
    }
  });

  lines.push("");
  lines.push(`Return only JSON, with a key for each field you were asked to fix and nothing else:`);
  lines.push(`{ ${issues.map(i => `"${i.field}": string`).join(", ")} }`);
  lines.push("");
  lines.push(`--- SEARCH RESULTS ---`);
  (sources || []).forEach((s, i) => {
    lines.push(`[${i + 1}] ${s.title}`);
    lines.push(s.content || "");
    lines.push("");
  });

  return lines.join("\n");
}

/** Single-field rewrite, used by the editor's "Fit to range" button. */
export function refitOnePrompt(field, value, min, max, sources) {
  const n = value.trim().length;
  const over = n > max;
  const target = lengthTarget(min, max);

  const instruction = over
    ? `Rewrite this product listing ${field} so it is between ${min} and ${max} characters — currently ${n}, so cut at least ${n - max}. Aim for about ${target}. Cut filler, repetition and the least useful detail first. Keep every factual claim and the same opening terms. Add nothing new.`
    : `Rewrite this product listing ${field} so it is between ${min} and ${max} characters — currently ${n}, so add at least ${min - n}. Aim for about ${target}. Lengthen only with real detail drawn from the search results below: further specifications, dimensions, what it replaces, what is in the box, what to check before ordering. Do not pad, do not repeat yourself, and do not invent a specification that is not in those results.`;

  const parts = [
    instruction,
    "",
    `Return only the rewritten ${field}, with no preamble and no quotation marks around it.`,
    "",
    "---",
    value
  ];

  if (!over && sources?.length) {
    parts.push("", "--- SEARCH RESULTS ---");
    sources.forEach((s, i) => parts.push(`[${i + 1}] ${s.title}`, s.content || "", ""));
  }

  return parts.join("\n");
}
