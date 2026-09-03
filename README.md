# Parts Desk

A one-page listing builder for IT hardware. You give it a manufacturer part number; it searches Google, works out what the part is, and writes an SEO title, five bullets and a description — with the sources it used, so you can spot-check anything that matters.

Runs on the Google Gemini free tier. **No billing account, no card, no charges.**

---

## Put it on GitHub Pages

1. Create a repository and drop `index.html` in the root.
2. **Settings → Pages → Build and deployment**. Source: *Deploy from a branch*. Branch: `main`, folder: `/ (root)`. Save.
3. Wait a minute, then open `https://<your-username>.github.io/<repo-name>/` and share that link with your team.

It's one file with no build step. Editing `index.html` and pushing is the whole update process.

## Each person gets their own free key

Send your co-workers these three steps. It takes about a minute.

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and sign in with a Google account.
2. Click **Create API key**. Accept the terms. Copy the key.
3. Open the Parts Desk link, click **Settings**, paste the key, **Save**.

**Do not set up billing on the project.** That's the whole trick, and it's what makes the zero-cost promise real rather than a hope. A Gemini key with no billing account attached is physically unable to charge anything — when you hit the daily limit the API returns "quota exceeded" and the app waits. There is no overflow to bill, because there is nothing to bill it to.

**Everyone needs a separate key.** Google counts usage per project, not per key, so if the whole team shares one key you all share one daily allowance. One key each and you each get your own.

Nobody should paste a key into the repository. It lives in each person's browser, and the published site never contains it.

## What "free" actually covers

Two limits matter, and neither costs money when you reach them.

**500 searched listings per day, per person.** Google's free tier includes 500 search-grounded requests a day on Gemini 2.5 Flash and 2.5 Flash-Lite. The app spends exactly one per part number, no matter how many individual searches the model runs inside it, so 500 a day is 500 listings a day. The counter in the header tracks it. It resets at midnight US Pacific, not local midnight, which is why the app tracks it on that clock.

**A few requests per minute.** This is the one you'll actually notice. The free tier allows only a handful of requests a minute, and a long batch will trip it. The app handles this: **Seconds between listings** in Settings paces the batch (5 is a good default), and when Google says slow down, the app waits exactly as long as Google asks and then picks up where it left off. A rate limit costs nothing — it just costs time.

The app only offers Gemini 2.5 Flash and 2.5 Flash-Lite, because those are the two models with free search on the free tier. The Gemini 3 models charge for search from the very first query, so they're deliberately not in the list.

**One thing to know before you commit.** Google's free tier says content sent through it may be used to improve their products. Paid tiers don't. Part numbers and public spec sheets aren't commercially sensitive, so this is usually fine for this job — but it's your call to make deliberately, not to discover later. Read the terms at [ai.google.dev/gemini-api/terms](https://ai.google.dev/gemini-api/terms). If it isn't acceptable, this design isn't the right one for you, and the honest answer is that a genuinely private version needs a paid tier.

## Using it

Paste part numbers into the box, one per line, and press **Build listings** (or Ctrl+Enter). They run in order, so you can queue a batch and go do something else.

Every field is editable before you copy it. **Export CSV** pulls the whole batch out with the title, five bullets and description in separate columns, ready for a bulk upload sheet.

The header shows two counters: listings you've finished today against your target, and free searches used against the daily 500.

### Settings worth changing

- **Seconds between listings** — 5 by default. Raise it if you see a lot of rate-limit waits, lower it if you never do.
- **House style** — anything your listings always need: wording to avoid, a warranty line, how you phrase compatibility. Applied to every listing, and it overrides the built-in guidance where they conflict.
- **Title and description limits** — 200 and 2000. Change them if a marketplace wants something different.

## How it works, and why it's two steps

Each part number takes two API calls.

The first is the research call. It has Google Search switched on and produces a plain research brief. The second turns that brief into listing copy, and it runs with search switched **off** and a strict output schema. That split does two useful things: it keeps your 500-a-day allowance spent only on research, and it means the copy comes back as valid structured data rather than as prose the app has to guess its way through.

The sources shown under each listing come from Google's own grounding data, not from the model writing down where it thinks it looked. They can't be invented.

## About accuracy

The prompt tells the model to state a specification only if it appeared in a search result it actually retrieved, to leave details out rather than guess, and to claim compatibility only where a source lists it. That helps. It does not make it infallible.

So the app shows its work. Every listing carries a confidence badge, the search queries used, the sources, and an amber **Check before publishing** box when the part number was ambiguous, when sources disagreed, or when only one source came back. Treat those flags as your review queue — they're where your own judgement is worth more than another search.

Two things to watch specifically:

- Part numbers reused across product families, or differing from a similar number by one character. The model flags this when it notices, but it can't always tell.
- Compatibility lists. These are the most-copied and least-checked data on parts sites, so one error propagates across every source that copied it. If fitment is what the buyer is really paying for, verify it yourself.

Gemini 2.5 Flash is a small, fast model. On common parts it does this job well. On obscure ones it will more often come back unsure — which is the correct behaviour, and the confidence badge is there to tell you so.

## Troubleshooting

**"That API key isn't valid."** Copied wrong, or the key was deleted. Make a new one.

**"The key is restricted and this site isn't on its allowed list."** The key has an HTTP-referrer restriction in Google Cloud Console that doesn't include your GitHub Pages address. Add `https://<your-username>.github.io/*` to the allowed referrers, or remove the restriction.

**Lots of rate-limit waiting.** Normal on the free tier during a long batch. Raise **Seconds between listings**.

**"Free tier limit reached" and it won't clear.** You've used the day's 500. It resets at midnight US Pacific. Nothing has been charged.

## Tests

`test.mjs` loads the real page in jsdom against a mocked API and checks the parts most likely to break quietly — part number parsing, the two-call split, 429 retry and backoff, quota counting, JSON recovery, CSV escaping.

```
npm install jsdom
node test.mjs
```

Worth running if you edit the prompt or the API code.
