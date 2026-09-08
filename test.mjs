import { JSDOM } from "jsdom";
import fs from "fs";

const html = fs.readFileSync("index.html", "utf8");

let pass = 0, fail = 0;
const ok = (name, cond, extra="") => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  -> " + extra : "")); }
};

const LISTING = {
  part_number:"YF8P5", brand:"Dell", model:"Inspiron 15 5567",
  product_type:"laptop motherboard", identified:true, confidence:"high",
  title:"Dell Inspiron 15 5567 Laptop Motherboard YF8P5 Intel Core i5-7200U DDR4 System Board",
  bullets:["Bullet one","Bullet two","Bullet three","Bullet four","Bullet five"],
  description:"Dell Inspiron 15 5567 motherboard, part number YF8P5. ".repeat(4),
  specs:[{label:"Processor",value:"Intel Core i5-7200U"},{label:"Memory",value:"DDR4"}],
  compatibility:["Inspiron 15 5567"], alternate_part_numbers:["0YF8P5"], warnings:[]
};

function tavilyReply(results = [
  { title:"Dell Support", url:"https://www.dell.com/support/parts/yf8p5", content:"YF8P5 is a system board for Inspiron 15 5567." },
  { title:"Parts People", url:"https://parts-people.com/yf8p5", content:"Replacement motherboard, Intel i5-7200U, DDR4." }
]){
  return { results, answer:"" };
}

function formatReply(obj = LISTING, model = "mistral-small-latest"){
  return {
    model,
    choices:[{ index:0, finish_reason:"stop", message:{ role:"assistant", content: JSON.stringify(obj) } }],
    usage:{ prompt_tokens:300, completion_tokens:400, total_tokens:700 }
  };
}

function jsonRes(body, status = 200, headers = {}){
  const h = new Map(Object.entries(headers).map(([k,v]) => [k.toLowerCase(), String(v)]));
  return {
    ok: status < 400,
    status,
    headers:{ get:(k) => h.get(k.toLowerCase()) ?? null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body))
  };
}

const calls = [];
let plan = [];
let failNext = null; // set to a function to make the next fetch throw, simulating CORS/network failure

const dom = new JSDOM(html, {
  runScripts:"dangerously",
  url:"https://example.github.io/partsdesk/",
  pretendToBeVisual:true,
  beforeParse(win){
    win.HTMLDialogElement.prototype.showModal = function(){ this.open = true; };
    win.HTMLDialogElement.prototype.close = function(v){
      this.open = false;
      if (v !== undefined) this.returnValue = v;
      this.dispatchEvent(new win.Event("close"));
    };
    win.confirm = () => true;
    Object.defineProperty(win.navigator, "clipboard", {
      value:{ writeText:(t) => { win.__copied = t; return Promise.resolve(); } }, configurable:true
    });
    win.fetch = async (url, init) => {
      if (failNext){ const fn = failNext; failNext = null; return fn(); }
      calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
      const next = plan.shift();
      if (typeof next === "function") return next();
      if (next && typeof next.json === "function") return next;
      return jsonRes(next ?? formatReply());
    };
  }
});

const win = dom.window, doc = win.document;
const $ = (id) => doc.getElementById(id);
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const idle = async (max = 400) => { for (let i=0;i<max && win.eval("state.running");i++) await wait(25); };

await wait(500);

console.log("\n— boot —");
ok("empty state renders", /Give it a part number/.test($("stage").textContent));
ok("settings open with no keys", $("settings").open === true);
ok("format model options are Mistral Small and Nemo",
   [...$("s-format-model").options].map(o => o.value).join(",") === "mistral-small-latest,open-mistral-nemo");
ok("no leftover Groq-search-model dropdown from any earlier version", !$("s-model"));
ok("default pacing gap suits Mistral's low RPM, not Groq's higher one",
   +$("s-gap").value >= 20);

$("s-key").value = "mistralTESTKEY";
$("s-tavily-key").value = "tvly-TESTKEY";
$("s-gap").value = "0";
$("settings").close("save");
await wait(20);

console.log("\n— requires both a Mistral key and a Tavily key —");
{
  win.eval("settings.tavilyKey = ''; settings.apiKeys = ['mistralTESTKEY'];");
  $("parts").value = "YF8P5";
  $("run").click();
  await wait(50);
  ok("opens settings and prompts for the missing Tavily key", $("settings").open === true);
  $("settings").close("cancel");
  win.eval("settings.tavilyKey = 'tvly-TESTKEY';");
}

console.log("\n— part number parsing —");
$("parts").value = "YF8P5\n0X8DXD\n- 5CX56AA\n2) 8FTGP\nYF8P5\n\n  RTX A2000  ";
const parsed = win.eval("parsePartNumbers(document.getElementById('parts').value)");
ok("leading zero survives (0X8DXD)", parsed.includes("0X8DXD"), JSON.stringify(parsed));
ok("dash marker stripped", parsed.includes("5CX56AA"));
ok("numbered marker stripped", parsed.includes("8FTGP"));
ok("duplicate dropped", parsed.filter(p => p === "YF8P5").length === 1);

console.log("\n— happy path: one Tavily search, one Mistral synthesis call —");
plan = [jsonRes(tavilyReply()), jsonRes(formatReply())];
calls.length = 0;
$("parts").value = "YF8P5";
$("run").click();
await idle();

ok("exactly two API calls", calls.length === 2, "calls=" + calls.length);
ok("call 1 hits Tavily's search endpoint", calls[0].url === "https://api.tavily.com/search");
ok("call 1 authenticates with the Tavily key", calls[0].init.headers.authorization === "Bearer tvly-TESTKEY");
ok("call 1 sends the query and a result-count limit",
   typeof calls[0].body.query === "string" && calls[0].body.query.includes("YF8P5") && calls[0].body.max_results > 0);
ok("call 2 hits Mistral's chat completions endpoint",
   calls[1].url === "https://api.mistral.ai/v1/chat/completions");
ok("call 2 authenticates with the Mistral key", calls[1].init.headers.authorization === "Bearer mistralTESTKEY");
ok("no leftover Groq-specific header on the request", !calls[1].init.headers["Groq-Model-Version"]);
ok("call 2 uses the writing model", calls[1].body.model === "mistral-small-latest");
ok("call 2 requests json_object mode", calls[1].body.response_format?.type === "json_object");
ok("call 2 has no search tools attached", !calls[1].body.tools);
ok("Tavily's actual search results are embedded in the Mistral prompt",
   /Dell Support/.test(calls[1].body.messages[0].content) && /parts-people\.com\/yf8p5/.test(calls[1].body.messages[0].content));
ok("call 2 uses Mistral's actual field name max_tokens, not max_completion_tokens",
   calls[1].body.max_tokens > 0 && !calls[1].body.max_completion_tokens);

console.log("\n— result rendering —");
ok("title in the editor", $("f-title").value.startsWith("Dell Inspiron 15 5567"));
ok("five bullets", doc.querySelectorAll(".b-edit").length === 5);
ok("description present", $("f-desc").value.includes("YF8P5"));
ok("sources come directly from Tavily's structured response",
   win.eval("state.items[0].data.sources.map(s=>s.url)").includes("https://www.dell.com/support/parts/yf8p5") &&
   win.eval("state.items[0].data.sources.length") === 2);
ok("listing tally incremented", $("tally-n").textContent === "1");
ok("Tavily quota gauge incremented by exactly one search", $("quota-n").textContent === "1");

console.log("\n— no Tavily results found —");
plan = [jsonRes(tavilyReply([])), jsonRes(formatReply())];
calls.length = 0;
$("parts").value = "YF8P5-noresults";
$("run").click();
await idle();
const nsItem = JSON.parse(win.eval("JSON.stringify(state.items[state.items.length-1])"));
ok("still completes rather than erroring outright", nsItem.status === "review" || nsItem.status === "done", nsItem.status);
ok("gets flagged for review since nothing was verified", nsItem.status === "review", nsItem.status);
ok("warning explains no results were found",
   nsItem.data.warnings.some(w => /No search results were found/.test(w)), JSON.stringify(nsItem.data.warnings));

console.log("\n— a CORS/network failure on Tavily gets a specific, actionable message —");
{
  failNext = () => { throw new TypeError("Failed to fetch"); };
  calls.length = 0;
  $("parts").value = "YF8P5-cors";
  $("run").click();
  await idle();
  const corsItem = JSON.parse(win.eval("JSON.stringify(state.items[state.items.length-1])"));
  ok("surfaces as an error rather than hanging", corsItem.status === "error");
  ok("message specifically names CORS as the likely cause", /CORS/.test(corsItem.error), corsItem.error);
  ok("points to the README for the proxy workaround", /README/.test(corsItem.error));
}

console.log("\n— Tavily's own error response is surfaced clearly —");
{
  calls.length = 0;
  plan = [ jsonRes({ detail:{ error:"Invalid API key" } }, 401) ];
  $("parts").value = "YF8P5-badtavily";
  $("run").click();
  await idle();
  const badTavilyItem = JSON.parse(win.eval("JSON.stringify(state.items[state.items.length-1])"));
  ok("surfaces Tavily's real error text", /Invalid API key/.test(badTavilyItem.error), badTavilyItem.error);
}

console.log("\n— Tavily quota is tracked monthly —");
{
  ok("quota object is keyed by month", /^\d{4}-\d{2}$/.test(win.eval("tavilyQuota.month")), win.eval("tavilyQuota.month"));
  win.eval(`tavilyQuota = { month: "2020-01", count: 999 }; drawGauges();`);
  plan = [ jsonRes(tavilyReply()), jsonRes(formatReply()) ];
  calls.length = 0;
  $("parts").value = "YF8P5-monthreset";
  $("run").click();
  await idle();
  ok("a stale prior-month count resets once a new search runs", win.eval("tavilyQuota.count") === 1, String(win.eval("tavilyQuota.count")));
}

console.log("\n— Mistral's own error messages, not Groq's —");
const err = (s,b) => win.eval(`readableError(${s}, ${JSON.stringify(b)})`);
ok("401 points at Mistral's console, not Groq's", /console\.mistral\.ai/.test(err(401, { message:"Invalid API Key" })));
ok("429 mentions no payment method rather than promising a specific wait", /no payment method/.test(err(429, { message:"rate limited" })));
ok("500/503 names Mistral, not Groq", /Mistral's servers/.test(err(503, { message:"busy" })));

console.log("\n— multi-key rotation on a persistent 429 —");
{
  win.eval(`
    settings.apiKeys = ['mistral_KEY_ONE', 'mistral_KEY_TWO'];
    activeKeyIndex = 0;
    lastWorkingFormatModel = null;
    settings.formatModel = 'mistral-small-latest';
    settings.retries = 1;
  `);
  const rateLimited = { message:"Requests rate limit exceeded" };
  calls.length = 0;
  // Both models get 2 attempts each (retries=1) on key one before the app
  // moves to key two — it tries the sibling model on the same key first,
  // a cheaper recovery path than rotating keys, and only rotates once
  // every model on that key has failed.
  plan = [
    jsonRes(tavilyReply()),
    jsonRes(rateLimited, 429), jsonRes(rateLimited, 429), // mistral-small-latest, both attempts, key one
    jsonRes(rateLimited, 429), jsonRes(rateLimited, 429), // open-mistral-nemo, both attempts, key one
    jsonRes(formatReply())                                // key two succeeds
  ];
  $("parts").value = "ROTATE-ON-429";
  $("run").click();
  await idle();
  win.eval("settings.retries = 4;");
  const rotItem = JSON.parse(win.eval("JSON.stringify(state.items[state.items.length-1])"));
  ok("recovers by switching keys instead of failing outright",
     rotItem.status === "done" || rotItem.status === "review", rotItem.status);
  ok("tries both models on key one before ever touching key two",
     calls.slice(1, 5).every(c => c.init.headers.authorization === "Bearer mistral_KEY_ONE"),
     JSON.stringify(calls.map(c => c.init.headers.authorization)));
  ok("the working key ends up being key two",
     calls[calls.length-1].init.headers.authorization === "Bearer mistral_KEY_TWO",
     JSON.stringify(calls.map(c => c.init.headers.authorization)));
}

console.log("\n— rotation is remembered across the next listing —");
{
  const beforeNext = calls.length;
  plan = [ jsonRes(tavilyReply()), jsonRes(formatReply()) ];
  $("parts").value = "ROTATE-REMEMBERED";
  $("run").click();
  await idle();
  ok("next listing goes straight to key two, no wasted 429 on the exhausted key",
     calls[beforeNext + 1].init.headers.authorization === "Bearer mistral_KEY_TWO");
}

console.log("\n— a non-retryable error does not trigger pointless key rotation —");
{
  win.eval(`
    settings.apiKeys = ['mistral_BAD_ONE', 'mistral_BAD_TWO'];
    activeKeyIndex = 0;
    lastWorkingFormatModel = null;
  `);
  calls.length = 0;
  plan = [ jsonRes(tavilyReply()), jsonRes({ message:"Invalid API Key" }, 401) ];
  $("parts").value = "BADKEY-NO-ROTATE";
  $("run").click();
  await idle();
  ok("only tried the format step once — an invalid key isn't a rotation-worthy problem",
     calls.length === 2, String(calls.length));
  const badKeyItem = JSON.parse(win.eval("JSON.stringify(state.items[state.items.length-1])"));
  ok("surfaces the real cause immediately", /isn't valid/.test(badKeyItem.error));
}

console.log("\n— model fallback on 404 —");
{
  win.eval(`
    settings.apiKeys = ['mistralTESTKEY'];
    activeKeyIndex = 0;
    lastWorkingFormatModel = null;
    settings.formatModel = 'mistral-small-latest';
  `);
  calls.length = 0;
  plan = [
    jsonRes(tavilyReply()),
    jsonRes({ message:"Model `mistral-small-latest` not found" }, 404),
    jsonRes(formatReply(LISTING, "open-mistral-nemo"))
  ];
  $("parts").value = "MODEL-404-FALLBACK";
  $("run").click();
  await idle();
  const fbItem = JSON.parse(win.eval("JSON.stringify(state.items[state.items.length-1])"));
  ok("recovers via the sibling model", fbItem.status === "done" || fbItem.status === "review", fbItem.status);
  ok("moved on to open-mistral-nemo", calls.some(c => c.body?.model === "open-mistral-nemo"));
}

console.log("\n— legacy settings migrate cleanly —");
{
  const calls2 = [];
  let plan2 = [];
  const dom2 = new JSDOM(html, {
    runScripts:"dangerously",
    url:"https://example.github.io/partsdesk/",
    pretendToBeVisual:true,
    beforeParse(w){
      w.HTMLDialogElement.prototype.showModal = function(){ this.open = true; };
      w.HTMLDialogElement.prototype.close = function(v){
        this.open = false;
        if (v !== undefined) this.returnValue = v;
        this.dispatchEvent(new w.Event("close"));
      };
      w.confirm = () => true;
      Object.defineProperty(w.navigator, "clipboard", { value:{ writeText:() => Promise.resolve() }, configurable:true });
      // Seeded exactly as a browser that used the earlier Groq-writing
      // version would have it: an old Groq model name and a legacy
      // singular apiKey field, no apiKeys array.
      w.localStorage.setItem("pd.settings", JSON.stringify({
        apiKey:"gsk_LEGACY", formatModel:"openai/gpt-oss-20b", tavilyKey:"tvly-LEGACY"
      }));
      w.fetch = async (url, init) => {
        calls2.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
        const next = plan2.shift();
        if (next && typeof next.json === "function") return next;
        return jsonRes(next ?? formatReply());
      };
    }
  });
  const win2 = dom2.window, doc2 = win2.document;
  const $2 = (id) => doc2.getElementById(id);
  await wait(500);
  ok("legacy Groq writing model migrated to Mistral's default",
     win2.eval("settings.formatModel") === "mistral-small-latest", win2.eval("settings.formatModel"));
  ok("legacy single key migrated into the apiKeys array",
     JSON.stringify(win2.eval("settings.apiKeys")) === JSON.stringify(["gsk_LEGACY"]));

  plan2 = [jsonRes(tavilyReply()), jsonRes(formatReply())];
  $2("parts").value = "LEGACY-WORKS";
  $2("run").click();
  for (let i=0;i<200 && win2.eval("state.running");i++) await wait(25);
  ok("the migrated model is actually what gets sent, not the stale Groq one",
     calls2[1]?.body?.model === "mistral-small-latest", calls2[1]?.body?.model);
}

console.log("\n— copy and edit —");
win.eval("state.activeId = state.items[0].id; draw();");
await wait(20);
doc.querySelector('[data-copy="all"]').click();
await wait(20);
ok("copy-all bundles title, bullets, description",
   win.__copied.includes("Dell Inspiron") && win.__copied.includes("• Bullet one"));
const b0 = doc.querySelector('.b-edit[data-i="0"]');
b0.value = "Edited bullet";
b0.dispatchEvent(new win.Event("input"));
ok("edits persist to state", win.eval("state.items[0].data.bullets[0]") === "Edited bullet");

console.log("\n— csv —");
const cell = (v) => win.eval("csvCell(" + JSON.stringify(v) + ")");
ok("comma quoted", cell("a,b") === '"a,b"');
ok("inner quotes doubled", cell('say "hi"') === '"say ""hi"""');

console.log("\n— truncated JSON recovery —");
const ex = (s) => win.eval("extractJson(" + JSON.stringify(s) + ")");
ok("plain JSON parses", ex('{"title":"T","bullets":[]}')?.title === "T");
ok("fenced JSON parses", ex('```json\n{"title":"T","bullets":[]}\n```')?.title === "T");
ok("junk returns null", ex("nothing here") === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
