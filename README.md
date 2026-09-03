# Parts Desk

**Turn a bare manufacturer part number into a ready-to-publish marketplace listing.**

Parts Desk is a single-file, static web app for anyone reselling IT hardware — laptops, motherboards, docks, panels, bezels, cables, spares — who has to build listings from nothing but a part number. Give it `YF8P5`, `0X8DXD`, `5CX56AA`, and it searches the web, works out what the part actually is, and returns an SEO title, five bullet points, and a product description, alongside the sources it used so you can verify anything before it goes live.

No backend, no database, no build step. It's one HTML file that runs entirely in the browser and calls the [Groq API](https://groq.com) directly, using a free key you or your teammates provide.

---

## Features

- **Part number → listing, end to end.** Paste a part number, get a title (≤200 characters), five bullets, and a description (≤2,000 characters), all editable in place before you copy them.
- **Sourced, not invented.** Every listing shows the search queries it ran and the pages it drew from, plus a confidence badge and an explicit "check before publishing" flag whenever the result is ambiguous, thinly sourced, or unverified.
- **Batch queue.** Paste dozens of part numbers, one per line, and let them run in order while you do something else.
- **CSV export.** Pull a finished batch out as a spreadsheet — title, five bullets, and description in separate columns — ready for a bulk upload template.
- **Configurable house style.** Set your own title/description length limits, whether the part number belongs in the title, and free-text rules (wording to avoid, a warranty line, how to phrase compatibility) that get applied to every listing.
- **Runs on a genuinely free API tier.** No credit card, no billing account, no usage charges — see [Cost](#cost) below.
- **Zero infrastructure.** Deploys to GitHub Pages (or any static host, or just a file on your desktop) in minutes.

## Quick start

1. **Deploy it.** Fork or download this repo, drop `index.html` in a public GitHub repository, and turn on **Settings → Pages** (deploy from branch `main`, folder `/root`). Or just open `index.html` locally — it works the same either way.
2. **Get a free API key** at [console.groq.com/keys](https://console.groq.com/keys) — an email address is all that's required, no card.
3. **Paste the key** into the app's Settings panel.
4. **Paste part numbers**, one per line, and press **Build listings**.

## How it works

Each part number costs two API calls to [Groq](https://groq.com), both on its free tier:

1. **Research** — `groq/compound`, a model with a built-in web search tool, searches the web from a few angles (bare part number, part number + brand, spec-sheet phrasing, etc.) and produces a plain-text research brief.
2. **Formatting** — a plain instruction-following model (`openai/gpt-oss-20b` by default) turns that brief into structured JSON: title, bullets, description, specs, compatibility, and any warnings — without touching the web itself.

The split matters for two reasons: the search step is the one with a daily allowance to manage, so keeping the formatting step separate means rewriting or shortening a field never costs search quota; and asking a plain model for structured JSON is far more reliable than asking a search-and-reason model to do both at once.

Sources shown in the app are extracted from the actual search tool output the model retrieved — never invented, never guessed.

## Cost

**$0. No credit card is ever requested, on any path through this app.**

Groq's Free tier requires no payment method at all, which means there's nothing on file that could ever be charged — hitting a rate limit just means waiting, not billing. This is a hard requirement of the project, not an incidental default: don't add a card under Groq's Billing settings, since that's the only action that would introduce cost.

Each person who uses the tool should create their own free Groq account (a fresh email is a fresh organization, and Groq's daily allowance is per-organization). Roughly:

| Allowance | Amount | Applies to |
|---|---|---|
| Search-backed research calls | ~250/day, per account | The `groq/compound` step — one per listing |
| Plain formatting calls | 14,400/day, per account | The JSON-writing step — effectively unlimited for this use case |
| Requests per minute | 30/min, per account | Both steps; the app paces batches automatically |

See [Troubleshooting](#troubleshooting) and the in-app Settings panel for how the app handles rate limits and model availability changes without any action from you.

## Configuration

All settings live in the app itself (gear icon → Settings) and are stored in the browser, not in this repository:

| Setting | What it does |
|---|---|
| API key | Your personal Groq key. Never committed to source control — stored client-side only. |
| Search model | `groq/compound` (default, searches from several angles) or `groq/compound-mini` (faster, one search per listing). |
| Writing model | `openai/gpt-oss-20b` (default) or `llama-3.3-70b-versatile`. |
| Seconds between listings | Paces batch runs against Groq's per-minute limit. |
| Title / description limits | Defaults to 200 / 2,000 characters; adjust to match your marketplace. |
| Include part number in title | On by default, since buyers in this market search by part number. |
| House style | Free-text rules applied to every listing (tone, required disclaimers, phrasing conventions). |

## Accuracy and review

The model is instructed to state a specification only if it appeared in a page it actually retrieved, never to infer specs from similar-looking part numbers, and to leave a detail out rather than guess at it. That materially reduces — but does not eliminate — the risk of a wrong listing.

Every result carries:

- A **confidence badge** (Confident / Reasonably sure / Needs checking).
- The **search queries** the model ran, for transparency.
- A **sources list**, extracted from what the model actually searched.
- An amber **"check before publishing"** panel whenever the part number was ambiguous, sources disagreed, fewer than two sources came back, or no search happened at all.

Treat the flagged listings as your review queue. Compatibility claims and part numbers that differ from a known one by a single character are worth a second look regardless of confidence score.

## Limitations

- Groq's compound models return search results as unstructured text rather than a clean list of URLs; this app extracts links with a regular expression. It's reliable but not perfect — occasionally a result won't yield a clean URL, so a listing may show fewer sources than searches performed.
- Groq doesn't publish an exact daily-reset time for its free tier the way some providers do. The in-app usage counter is this app's own estimate, not a live mirror of Groq's internal limit.
- Free-tier model availability can shift over time on any provider. The app automatically falls back to an alternate model if its first choice becomes unavailable, and a **Check available models** button in Settings shows live status for your key.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| "That API key isn't valid" | Key was mistyped or revoked, or isn't a Groq key (should start with `gsk_`). Generate a new one. |
| "That model name wasn't found" | The app already retries with an alternate model automatically. If it still fails, use **Check available models** in Settings. |
| Frequent rate-limit waits | Expected during a fast batch — Groq allows 30 requests/minute on the search models. Increase the pacing delay in Settings. |
| Usage counter looks wrong | It's a local estimate, not Groq's authoritative counter (see [Limitations](#limitations)). |

## Development

The entire app is `index.html` — no dependencies, no build step. `test.mjs` is a jsdom-based test suite that mocks the Groq API and exercises the parts of the app most likely to break silently: part-number parsing, the two-call research/format split, rate-limit retry, model fallback, source extraction, JSON recovery, and CSV export.

```bash
npm install jsdom
node test.mjs
```

Run it after any change to the prompts or the API integration code.

## License

No license is included, which under default copyright means all rights are reserved. If you'd like to reuse or fork this project, reach out to the repository owner.
