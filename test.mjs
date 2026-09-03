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

/* Groq's compound response shape: OpenAI-style choices[], with an
   executed_tools array on the message carrying search queries and a
   text blob of results (URLs embedded in prose, not a structured field). */
function searchReply({ model = "groq/compound", withSearch = true } = {}){
  return {
    model,
    choices:[{
      index:0,
      finish_reason:"stop",
      message:{
        role:"assistant",
        content:"Research brief: the YF8P5 is a Dell Inspiron 15 5567 motherboard, Intel Core i5-7200U, DDR4 memory. High confidence.",
        executed_tools: withSearch ? [
          { index:0, type:"search", arguments:'{"query":"YF8P5 Dell motherboard"}',
            output:"Title: Dell Support\nSee https://www.dell.com/support/parts/yf8p5 for details." },
          { index:1, type:"search", arguments:'{"query":"YF8P5 specifications"}',
            output:"Title: Parts People\nListed at https://parts-people.com/yf8p5 and also https://www.dell.com/support/parts/yf8p5 again." }
        ] : []
      }
    }],
    usage:{ prompt_tokens:50, completion_tokens:200, total_tokens:250 }
  };
}

function formatReply(obj = LISTING, model = "openai/gpt-oss-20b"){
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
      calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
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
ok("search model options are groq/compound and compound-mini",
   [...$("s-model").options].map(o => o.value).join(",") === "groq/compound,groq/compound-mini");
ok("format model options are the two writing models",
   [...$("s-format-model").options].map(o => o.value).join(",") === "openai/gpt-oss-20b,llama-3.3-70b-versatile");
ok("daily search cap shown is 250", /250/.test($("quota-n").parentElement.textContent));

$("s-key").value = "gsk_TESTKEY";
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
plan = [jsonRes(searchReply()), jsonRes(formatReply())];
calls.length = 0;
$("parts").value = "YF8P5";
$("run").click();
await idle();

ok("exactly two API calls", calls.length === 2, "calls=" + calls.length);
ok("both calls hit the Groq chat completions endpoint",
   calls.every(c => c.url === "https://api.groq.com/openai/v1/chat/completions"));
ok("auth uses a Bearer token, not x-goog-api-key",
   calls[0].init.headers.authorization === "Bearer gsk_TESTKEY");
ok("call 1 uses the search model", calls[0].body.model === "groq/compound");
ok("call 1 has no response_format (plain text research)", !calls[0].body.response_format);
ok("call 2 uses the writing model", calls[1].body.model === "openai/gpt-oss-20b");
ok("call 2 requests json_object mode", calls[1].body.response_format?.type === "json_object");
ok("research brief is passed into call 2",
   /RESEARCH BRIEF/.test(calls[1].body.messages[0].content) &&
   /Inspiron 15 5567 motherboard/.test(calls[1].body.messages[0].content));
ok("prompt tells the model not to answer from memory alone",
   /not answer from memory alone/.test(calls[0].body.messages[0].content));
ok("title limit stated in the format prompt",
   /at most 200 characters/.test(calls[1].body.messages[0].content));

console.log("\n— result rendering —");
ok("title in the editor", $("f-title").value.startsWith("Dell Inspiron 15 5567"));
ok("counter shows the limit", /\/ 200/.test($("c-title").textContent));
ok("five bullets", doc.querySelectorAll(".b-edit").length === 5);
ok("description present", $("f-desc").value.includes("YF8P5"));
ok("search queries shown", /YF8P5 specifications/.test($("stage").textContent));
ok("URLs extracted from executed_tools output text",
   win.eval("state.items[0].data.sources.map(s=>s.url)").includes("https://www.dell.com/support/parts/yf8p5"));
ok("duplicate URL across two tool calls is deduped",
   win.eval("state.items[0].data.sources.length") === 2,
   String(win.eval("state.items[0].data.sources.length")));
ok("source title falls back to hostname", /dell\.com/.test($("stage").textContent));
ok("listing tally incremented", $("tally-n").textContent === "1");
ok("free-search quota incremented once, not twice (only the search call counts)",
   $("quota-n").textContent === "1");

console.log("\n— no search performed —");
plan = [jsonRes(searchReply({ withSearch:false })), jsonRes(formatReply())];
calls.length = 0;
$("parts").value = "YF8P5-nosearch";
$("run").click();
await idle();
const nsItem = JSON.parse(win.eval("JSON.stringify(state.items[state.items.length-1])"));
ok("still completes rather than erroring", nsItem.status === "review" || nsItem.status === "done", nsItem.status);
ok("gets flagged for review since nothing was verified", nsItem.status === "review", nsItem.status);
ok("warning explains no search happened",
   nsItem.data.warnings.some(w => /No web search was performed/.test(w)), JSON.stringify(nsItem.data.warnings));

console.log("\n— rate limiting (header-based, not body-based) —");
const before = calls.length;
plan = [
  jsonRes({ error:{ message:"Rate limit reached" } }, 429, { "retry-after": "0.05" }),
  jsonRes(searchReply()),
  jsonRes(formatReply())
];
$("parts").value = "0X8DXD";
$("run").click();
await idle();

const item2 = JSON.parse(win.eval("JSON.stringify(state.items[state.items.length-1])"));
ok("429 is retried, not surfaced as failure", item2.status === "done" || item2.status === "review", item2.status);
ok("retry made the extra call", calls.length - before === 3, String(calls.length - before));
ok("Retry-After header is honoured (parsed correctly)",
   win.eval(`retryDelayMs({headers:{get:(k)=>k.toLowerCase()==='retry-after'?'2.5':null}})`) === 2500);

console.log("\n— model fallback on 404 —");
function notFound404(){
  return jsonRes({ error:{ message:"The model `groq/compound` does not exist or you do not have access to it." } }, 404);
}
calls.length = 0;
win.eval("lastWorkingSearchModel = null; settings.model = 'groq/compound';");
plan = [
  notFound404(),                  // preferred search model fails
  jsonRes(searchReply({ model:"groq/compound-mini" })), // fallback succeeds
  jsonRes(formatReply())
];
$("parts").value = "YF8P5-fb";
$("run").click();
await idle();

const fbItem = JSON.parse(win.eval("JSON.stringify(state.items[state.items.length-1])"));
ok("run recovers instead of failing outright", fbItem.status === "done" || fbItem.status === "review", fbItem.status);
ok("three calls: dead model, fallback search, format", calls.length === 3, String(calls.length));
ok("first call tried the preferred (dead) model", calls[0].body.model === "groq/compound");
ok("second call moved to compound-mini", calls[1].body.model === "groq/compound-mini");
ok("app remembers the working search model for next time",
   win.eval("lastWorkingSearchModel") === "groq/compound-mini");

console.log("\n— fallback is remembered across the next listing —");
const before2 = calls.length;
plan = [ jsonRes(searchReply({ model:"groq/compound-mini" })), jsonRes(formatReply()) ];
$("parts").value = "YF8P5-fb2";
$("run").click();
await idle();
ok("next listing goes straight to the known-good model, no wasted 404",
   calls.length - before2 === 2, String(calls.length - before2));
ok("that call used the fallback model directly, ahead of the operator's stale preference",
   calls[before2].body.model === "groq/compound-mini");

console.log("\n— both search models dead —");
win.eval("lastWorkingSearchModel = null;");
plan = [ notFound404(), notFound404() ];
calls.length = 0;
$("parts").value = "YF8P5-dead";
$("run").click();
await idle();
const deadItem = JSON.parse(win.eval("JSON.stringify(state.items[state.items.length-1])"));
ok("surfaces as an error, not a silent hang", deadItem.status === "error");
ok("error names both models and points at diagnostics",
   /groq\/compound.*groq\/compound-mini|Check available models/.test(deadItem.error), deadItem.error);

console.log("\n— non-404 errors fail fast, no pointless fallback churn —");
win.eval("lastWorkingSearchModel = null;");
plan = [ jsonRes({ error:{ message:"Invalid API Key" } }, 401) ];
calls.length = 0;
$("parts").value = "YF8P5-badkey";
$("run").click();
await idle();
ok("only one call made — a bad key isn't a model problem", calls.length === 1, String(calls.length));
const badKeyItem = JSON.parse(win.eval("JSON.stringify(state.items[state.items.length-1])"));
ok("surfaces the real cause", /isn't valid/.test(badKeyItem.error));

console.log("\n— diagnostics: list available models —");
const originalFetch = win.fetch;
win.fetch = async (url, init) => {
  calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
  if (url === "https://api.groq.com/openai/v1/models"){
    return jsonRes({ data:[
      { id:"groq/compound" }, { id:"groq/compound-mini" },
      { id:"openai/gpt-oss-20b" }, { id:"llama-3.3-70b-versatile" },
      { id:"whisper-large-v3" }
    ]});
  }
  return jsonRes(formatReply());
};
$("s-key").value = "gsk_TESTKEY";
$("btn-check-models").click();
await wait(50);
win.fetch = originalFetch; // hand control back to the plan queue for the rest of the run

ok("list call hits Groq's /models endpoint with a Bearer token",
   calls.some(c => c.url === "https://api.groq.com/openai/v1/models" && c.init.headers.authorization === "Bearer gsk_TESTKEY"));
const checkText = $("model-check-result").textContent;
ok("both search models confirmed", /✓ groq\/compound\b/.test(checkText) && /✓ groq\/compound-mini/.test(checkText));
ok("both writing models confirmed", /✓ openai\/gpt-oss-20b/.test(checkText) && /✓ llama-3\.3-70b-versatile/.test(checkText));
ok("unrelated models (whisper) listed separately, not miscategorised",
   /whisper-large-v3/.test(checkText) && checkText.indexOf("whisper-large-v3") > checkText.indexOf("Also on this account"));

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

console.log("\n— shorten() uses the writing model, not the search model —");
win.eval("lastWorkingFormatModel = null; settings.formatModel = 'openai/gpt-oss-20b';");
plan = [ jsonRes({ model:"openai/gpt-oss-20b", choices:[{ finish_reason:"stop", message:{ content:"Shortened title text" } }] }) ];
calls.length = 0;
$("btn-trim-title").click();
await wait(50);
ok("shorten call used the writing model", calls[0]?.body?.model === "openai/gpt-oss-20b", JSON.stringify(calls[0]?.body));
ok("shorten call has no search tool involvement", !calls[0]?.body?.tools);

console.log("\n— csv —");
const cell = (v) => win.eval("csvCell(" + JSON.stringify(v) + ")");
ok("comma quoted", cell("a,b") === '"a,b"');
ok("inner quotes doubled", cell('say "hi"') === '"say ""hi"""');
ok("newlines flattened", cell("a\nb") === "a b");

console.log("\n— error messages —");
const err = (s,b) => win.eval(`readableError(${s}, ${JSON.stringify(b)})`);
ok("401 explains the key", /isn't valid/.test(err(401, { error:{ message:"Invalid API Key" } })));
ok("429 reassures that nothing is charged",
   /costs nothing/.test(err(429, { error:{ message:"rate limit" } })));
ok("404 points at Settings", /Pick another one in Settings/.test(err(404, { error:{ message:"model not found" } })));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
