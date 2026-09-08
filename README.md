# Parts Desk

Turns IT hardware part numbers into marketplace listing copy. Searches with
Tavily, writes with Mistral, and shows you the sources it used.

Everything runs in the browser. Each person uses their own free API keys, so
nobody's usage lands on anyone else's account.

---

## What it enforces

Listing copy is measured in code after the model answers, not just asked for in
the prompt — language models cannot count characters, so a prompt alone never
holds a limit.

| Field | Minimum | Maximum |
| --- | --- | --- |
| Title | 150 | 200 |
| Each bullet (five of them) | 120 | 150 |
| Description | 1,500 | 2,000 |

Anything outside its range is sent back for a targeted rewrite with the exact
deficit stated, up to two passes. A pass is only accepted if the field moved
closer to its range. Whatever is still out of range afterwards is flagged on the
listing and marked `NO` in the `length_ok` column of the CSV, rather than being
published quietly.

All six numbers are editable in Settings.

---

## Repository layout

```
index.html               Vite entry. Holds the inline no-flash theme script.
vite.config.js           Build config, including the GitHub Pages base path.
tailwind.config.js       Dark mode strategy, fonts, glow keyframes.
postcss.config.js

src/
  main.jsx               React root.
  App.jsx                Application container: queue, run loop, layout.
  components/
    ThemeToggle.jsx      Dark/light switch.
    QueueManager.jsx     Queue list, clear-queue action, confirmation modal.
    ProgressBar.jsx      Glowing progress indicator.
    ListingEditor.jsx    Editable listing with live range counters.
    SettingsDialog.jsx   Keys, length ranges, cache controls.
    Footer.jsx           Quota summary and signature.
  hooks/
    useTheme.js          Theme state, persistence, system-preference following.
  lib/
    api.js               Endpoint resolution: direct calls or via the proxy.
    mistral.js           Chat client: retries, model fallback, key rotation.
    tavily.js            Search client.
    research.js          The pipeline: search → write → measure → repair.
    prompts.js           Prompt construction.
    lengths.js           Length measurement.
    searchCache.js       Saved searches, so a re-run costs no credit.
    settings.js          Defaults, migrations, clamping.
    storage.js           localStorage that degrades to memory.
    csv.js               Export.
  styles/
    globals.css          Tailwind entry, component classes, glow utilities.

server/
  app.js                 Optional proxy. Holds no keys. Not needed for Pages.

test/
  logic.test.mjs         43 tests over the length, cache, parsing and CSV logic.

.github/workflows/
  deploy.yml             Builds and publishes to Pages on push to main.
```

---

## Running it locally

```bash
npm install
npm run dev          # http://localhost:5173
```

Open Settings and paste a free [Tavily](https://app.tavily.com) key and a free
[Mistral](https://console.mistral.ai/api-keys) key. Neither free tier asks for a
payment method.

```bash
npm test             # length, cache, parsing and CSV logic
npm run build        # production build into dist/
npm run preview      # serve the built output
```

---

## Deploying to GitHub Pages

Two routes. The Actions one is better if more than one person will push.

### Route A — GitHub Actions (recommended)

1. Push this repository to GitHub.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Push to `main`.

`.github/workflows/deploy.yml` runs the tests, builds with the correct base path
derived from your repository name, and publishes. Your site appears at
`https://<username>.github.io/<repository>/`.

Nothing else to configure — the base path comes from the repository name at build
time, so forking or renaming needs no edit.

### Route B — manual, from your machine

1. Set the repository name in `vite.config.js`:

   ```js
   const REPO = "parts-desk";   // must match your repository name exactly
   ```

2. Deploy:

   ```bash
   npm run deploy
   ```

   This builds and pushes `dist/` to a `gh-pages` branch.

3. **Settings → Pages → Source: Deploy from a branch → `gh-pages` / `(root)`.**

### If the deployed page is blank

Almost always the base path. Open the browser console: 404s on
`/assets/index-*.js` mean the prefix is wrong. On a project site every asset must
be requested from `/<repository>/assets/...`.

- Using a **project site** (`username.github.io/repo`) → `base` must be `/repo/`.
- Using a **user or organisation site** (`username.github.io`) → build with
  `VITE_BASE=/ npm run build`.

---

## The optional backend

**You do not need this to run on GitHub Pages.** The frontend calls Mistral and
Tavily directly from the browser, and that is the intended setup.

Run `server/app.js` only if you hit one of these:

- **CORS.** A browser refuses the direct call to a provider. A server-to-server
  request isn't subject to the browser's origin rules, so a proxy fixes it.
- **Network policy.** Your office blocks the provider domains but allows your own
  host.
- **UI development without spending credits.** Mock mode returns realistic
  listing shapes — including copy that lands inside all three length ranges — with
  no upstream call and no key.

```bash
npm run server                 # live proxy on :8787
MOCK=1 npm run server          # mock mode, no upstream calls, no credits spent
```

Point the frontend at it by setting `VITE_API_BASE` at build time:

```bash
VITE_API_BASE=http://localhost:8787 npm run dev
VITE_API_BASE=https://your-proxy.example.com npm run build
```

Add your Pages origin to the proxy's allowlist when deploying:

```bash
ALLOWED_ORIGINS="https://yourname.github.io" npm run server
```

### The proxy holds no keys, on purpose

Every request carries the caller's own key in an `x-provider-key` header. It is
used for one upstream call and then forgotten. Nothing is stored, and the request
body and headers are deliberately never logged.

A shared server-side key would mean one account absorbing everyone's usage, one
free tier exhausted by the whole team at once, and one person's name on the
upgrade prompt when it runs out. Per-user keys keep each person inside their own
free allowance, which is the only arrangement that stays free. If you change one
thing in this file, don't change that.

Note that the proxy cannot run on GitHub Pages, which serves static files only.
It needs its own host — a small VPS, Render, Fly, Railway, or a serverless
function.

---

## Free tier limits

| | Allowance | What uses it |
| --- | --- | --- |
| Tavily | 1,000 searches/month | One per **new** part number |
| Mistral | Large monthly token allowance | 1–3 calls per listing |

Tavily is the binding constraint. Search results are saved per part number, so
your 1,000 credits buy 1,000 *distinct* part numbers rather than 1,000 runs —
retries, edits and re-pastes are free. "Search again (1 credit)" is the explicit
escape hatch for when the search results themselves were the problem.

Add a second Mistral key in Settings to keep a batch moving when the first is
rate-limited. Allowances are per account, so a second key gets its own.

---

Built by SyedNekoChan.
