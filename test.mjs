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

function groundedReply(){
  return {
    candidates:[{
      content:{ parts:[{ text:"Research brief: the YF8P5 is a Dell Inspiron 15 5567 motherboard..." }] },
      finishReason:"STOP",
      groundingMetadata:{
        webSearchQueries:["YF8P5 Dell motherboard","YF8P5 specifications"],
        groundingChunks:[
          { web:{ uri:"https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title:"dell.com", domain:"dell.com" } },
          { web:{ uri:"https://vertexaisearch.cloud.google.com/grounding-api-redirect/def", title:"parts-people.com", domain:"parts-people.com" } },
          { web:{ uri:"https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title:"dell.com", domain:"dell.com" } }
        ],
        searchEntryPoint:{ renderedContent:"<div id='google-suggestions'>Search suggestions</div>" }
      }
    }]
  };
}
function formatReply(obj = LISTING){
  return { candidates:[{ content:{ parts:[{ text: JSON.stringify(obj) }] }, finishReason:"STOP" }] };
}
function jsonRes(body, status = 200){
  return { ok: status < 400, status, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) };
}

const calls = [];
let plan = [];

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
      calls.push({ url, init, body: JSON.parse(init.body) });
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
ok("settings open with no key", $("settings").open === true);
ok("only free-grounding models offered",
   [...$("s-model").options].every(o => /^gemini-2\.5-flash/.test(o.value)),
   [...$("s-model").options].map(o=>o.value).join(","));

$("s-key").value = "AIzaTESTKEY";
$("s-gap").value = "0";
$("settings").close("save");
await wait(20);

console.log("\n— part number parsing —");
$("parts").value = "YF8P5\n0X8DXD\n- 5CX56AA\n2) 8FTGP\nYF8P5\n\n  RTX A2000  ";
const parsed = win.eval("parsePartNumbers(document.getElementById('parts').value)");
ok("leading zero survives (0X8DXD)", parsed.includes("0X8DXD"), JSON.stringify(parsed));
ok("dash marker stripped", parsed.includes("5CX56AA"));
ok("numbered marker stripped", parsed.includes("8FTGP"));
ok("duplicate dropped", parsed.filter(p => p === "YF8P5").length === 1);
ok("internal spaces kept", parsed.includes("RTX A2000"));

console.log("\n— happy path —");
plan = [jsonRes(groundedReply()), jsonRes(formatReply())];
calls.length = 0;
$("parts").value = "YF8P5";
$("run").click();
await idle();

ok("exactly two API calls", calls.length === 2, "calls=" + calls.length);
ok("call 1 hits the 2.5-flash generateContent endpoint",
   calls[0].url.includes("models/gemini-2.5-flash:generateContent"), calls[0].url);
ok("call 1 sends the key as x-goog-api-key",
   calls[0].init.headers["x-goog-api-key"] === "AIzaTESTKEY");
ok("call 1 only sends CORS-safe headers",
   Object.keys(calls[0].init.headers).every(h => ["content-type","x-goog-api-key"].includes(h.toLowerCase())),
   Object.keys(calls[0].init.headers).join(","));
ok("call 1 enables google_search", !!calls[0].body.tools?.[0]?.google_search);
ok("call 2 does NOT search (saves free quota)", !calls[1].body.tools);
ok("call 2 asks for JSON", calls[1].body.generationConfig.responseMimeType === "application/json");
ok("call 2 sends a response schema", !!calls[1].body.generationConfig.responseSchema?.properties?.title);
ok("call 2 disables thinking tokens", calls[1].body.generationConfig.thinkingConfig.thinkingBudget === 0);
ok("research brief is passed into call 2",
   /RESEARCH BRIEF/.test(calls[1].body.contents[0].parts[0].text) &&
   /Inspiron 15 5567 motherboard/.test(calls[1].body.contents[0].parts[0].text));
ok("title limit stated in the format prompt",
   /at most 200 characters/.test(calls[1].body.contents[0].parts[0].text));

console.log("\n— result rendering —");
ok("title in the editor", $("f-title").value.startsWith("Dell Inspiron 15 5567"));
ok("counter shows the limit", /\/ 200/.test($("c-title").textContent));
ok("five bullets", doc.querySelectorAll(".b-edit").length === 5);
ok("description present", $("f-desc").value.includes("YF8P5"));
ok("duplicate grounding source removed", doc.querySelectorAll("ul.sources li").length === 2,
   String(doc.querySelectorAll("ul.sources li").length));
ok("search queries shown", /YF8P5 specifications/.test($("stage").textContent));
ok("google search suggestions rendered (ToS requirement)",
   !!doc.getElementById("google-suggestions"));
ok("sources come from grounding metadata, not the model",
   win.eval("state.items[0].data.sources[0].url").includes("grounding-api-redirect"));
ok("listing tally incremented", $("tally-n").textContent === "1");
ok("free-search quota incremented once, not twice", $("quota-n").textContent === "1");

console.log("\n— rate limiting —");
const before = calls.length;
plan = [
  jsonRes({ error:{ message:"Quota exceeded", details:[{ retryDelay:"0.05s" }] } }, 429),
  jsonRes(groundedReply()),
  jsonRes(formatReply())
];
$("parts").value = "0X8DXD";
$("run").click();
await idle();

const item2 = JSON.parse(win.eval("JSON.stringify(state.items[1])"));
ok("429 is retried, not surfaced as failure", item2.status === "done" || item2.status === "review", item2.status);
ok("retry made the extra call", calls.length - before === 3, String(calls.length - before));
ok("quota counted once despite the retry", $("quota-n").textContent === "2", $("quota-n").textContent);

console.log("\n— error messages —");
const err = (s,b) => win.eval(`readableError(${s}, ${JSON.stringify(b)})`);
ok("invalid key explained",
   /isn't valid/.test(err(400, { error:{ message:"API key not valid. Please pass a valid API key." } })));
ok("referrer restriction explained",
   /allowed referrers/.test(err(403, { error:{ message:"Requests from referer are blocked." } })));
ok("429 reassures that nothing is charged",
   /costs nothing/.test(err(429, { error:{ message:"Quota exceeded" } })));
const delay = win.eval(`retryDelayMs(${JSON.stringify({ error:{ details:[{ retryDelay:"27s" }] } })})`);
ok("retryDelay parsed from Google's response", delay === 27000, String(delay));

console.log("\n— quota guard —");
win.eval("quota.n = 499; drawGauges();");
ok("quota gauge turns red near the limit",
   $("quota-fill").className.includes("bad"), $("quota-fill").className);

console.log("\n— truncated JSON recovery —");
const ex = (s) => win.eval("extractJson(" + JSON.stringify(s) + ")");
ok("plain JSON parses", ex('{"title":"T","bullets":[]}')?.title === "T");
ok("fenced JSON parses", ex('```json\n{"title":"T","bullets":[]}\n```')?.title === "T");
ok("braces inside strings handled", ex('{"title":"a } b","bullets":[]}')?.title === "a } b");
ok("junk returns null", ex("nothing here") === null);

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

$("f-title").value = "x".repeat(240);
$("f-title").dispatchEvent(new win.Event("input"));
ok("over-limit title flagged", $("c-title").className.includes("over"));
ok("shorten button appears", $("btn-trim-title").hidden === false);

console.log("\n— csv —");
const cell = (v) => win.eval("csvCell(" + JSON.stringify(v) + ")");
ok("comma quoted", cell("a,b") === '"a,b"');
ok("inner quotes doubled", cell('say "hi"') === '"say ""hi"""');
ok("newlines flattened", cell("a\nb") === "a b");

console.log("\n— model fallback on 404 —");
function notFound404(){
  return jsonRes({ error:{ code:404, message:"models/gemini-2.5-flash is not found for API version v1beta, or is not supported for generateContent." } }, 404);
}
calls.length = 0;
plan = [
  notFound404(),                 // research call on preferred model fails
  jsonRes(groundingReplyFor("YF8P5-fb")), // research succeeds on fallback model
  jsonRes(formatReplyFor("YF8P5-fb"))     // format step
];
win.eval("lastWorkingModel = null; settings.model = 'gemini-2.5-flash';");
$("parts").value = "YF8P5-fb";
$("run").click();
await idle();

function groundingReplyFor(){ return groundedReply(); }
function formatReplyFor(part){ return formatReply({ ...LISTING, part_number: part }); }

const fbItem = JSON.parse(win.eval("JSON.stringify(state.items[state.items.length-1])"));
ok("run recovers instead of failing outright", fbItem.status === "done" || fbItem.status === "review", fbItem.status);
ok("three calls: dead model, fallback research, fallback format", calls.length === 3, String(calls.length));
ok("first call tried the preferred (dead) model",
   calls[0].url.includes("gemini-2.5-flash:generateContent") && !calls[0].url.includes("lite"));
ok("second call moved to the other free-grounding model",
   calls[1].url.includes("gemini-2.5-flash-lite:generateContent"), calls[1].url);
ok("app remembers the working model for next time",
   win.eval("lastWorkingModel") === "gemini-2.5-flash-lite");

console.log("\n— fallback is remembered across the next listing —");
const before2 = calls.length;
plan = [ jsonRes(groundedReply()), jsonRes(formatReply()) ];
$("parts").value = "YF8P5-fb2";
$("run").click();
await idle();
ok("next listing goes straight to the known-good model, no wasted 404",
   calls.length - before2 === 2, String(calls.length - before2));
ok("that call used the fallback model directly",
   calls[before2].url.includes("gemini-2.5-flash-lite:generateContent"));

console.log("\n— both models dead —");
win.eval("lastWorkingModel = null;");
plan = [ notFound404(), notFound404() ];
calls.length = 0;
$("parts").value = "YF8P5-dead";
$("run").click();
await idle();
const deadItem = JSON.parse(win.eval("JSON.stringify(state.items[state.items.length-1])"));
ok("surfaces as an error, not a silent hang", deadItem.status === "error");
ok("error explains both models were tried and points at diagnostics",
   /gemini-2\.5-flash.*gemini-2\.5-flash-lite|Check available models/.test(deadItem.error), deadItem.error);
ok("mentions the October 16 2026 retirement date for context",
   /October 16, 2026/.test(deadItem.error));

console.log("\n— non-404 errors still fail fast, no pointless fallback churn —");
win.eval("lastWorkingModel = null;");
plan = [ jsonRes({ error:{ message:"API key not valid. Please pass a valid API key." } }, 400) ];
calls.length = 0;
$("parts").value = "YF8P5-badkey";
$("run").click();
await idle();
ok("only one call made — a bad key isn't a model problem", calls.length === 1, String(calls.length));
const badKeyItem = JSON.parse(win.eval("JSON.stringify(state.items[state.items.length-1])"));
ok("surfaces the real cause", /isn't valid/.test(badKeyItem.error));

console.log("\n— diagnostics: list available models —");
win.fetch = async (url, init) => {
  calls.push({ url, init });
  if (url.includes("/v1beta/models?")){
    return jsonRes({ models:[
      { name:"models/gemini-2.5-flash", supportedGenerationMethods:["generateContent"] },
      { name:"models/gemini-2.5-flash-lite", supportedGenerationMethods:["generateContent"] },
      { name:"models/gemini-3.5-flash", supportedGenerationMethods:["generateContent"] },
      { name:"models/embedding-001", supportedGenerationMethods:["embedContent"] }
    ]});
  }
  return jsonRes(formatReply());
};
$("s-key").value = "AIzaTESTKEY";
$("btn-check-models").click();
await wait(50);

ok("list call hits the ListModels endpoint with the key header",
   calls.some(c => c.url.includes("/v1beta/models?") && c.init.headers["x-goog-api-key"] === "AIzaTESTKEY"));
ok("embedding-only model excluded (no generateContent support)",
   !$("model-check-result").textContent.includes("embedding-001"));
ok("known free-grounding models marked as confirmed",
   /✓ gemini-2\.5-flash\b/.test($("model-check-result").textContent) &&
   /✓ gemini-2\.5-flash-lite/.test($("model-check-result").textContent));
ok("other reachable models listed separately with a caveat",
   /gemini-3\.5-flash/.test($("model-check-result").textContent) &&
   /not guaranteed/.test($("model-check-result").textContent));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
