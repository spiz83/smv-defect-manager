// Offline regression test for the extract-defects edge function.
// No network, no API key: stubs Supabase auth/quota and the Anthropic stream,
// boots the real handler on :8000 and drives it over HTTP.
//
//   cd supabase/functions/extract-defects
//   deno run --allow-env --allow-net --allow-read index.test.ts
//
// Covers the Opus 5.5 move (2026-11-19): request shape (model, adaptive
// thinking, explicit effort, fallbacks opt-in), refusal / truncation handling,
// mid-stream fallback stitching, the beta-rejected retry, the effort secrets,
// and two bugs a live read of a real report caught: the schema `minimum` that
// 400'd every deep read, and the "Bed 2" location vocabulary.
Deno.env.set("SUPABASE_URL", "https://sb.test");
Deno.env.set("SUPABASE_ANON_KEY", "anon");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "svc");
Deno.env.set("ANTHROPIC_API_KEY", "sk-test");

const realFetch = globalThis.fetch;
const calls: { headers: Record<string, string>; body: any }[] = [];

function sse(events: unknown[]): Response {
  const text = events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}
const start = (model = "claude-opus-5-5") => ({ type: "message_start", message: { model, usage: { input_tokens: 1234 } } });
const think = [
  { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "" } },
  { type: "content_block_stop", index: 0 },
];
const textBlock = (i: number, s: string) => [
  { type: "content_block_start", index: i, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: i, delta: { type: "text_delta", text: s } },
  { type: "content_block_stop", index: i },
];
const end = (reason: string) => ({ type: "message_delta", delta: { stop_reason: reason }, usage: { output_tokens: 777 } });

let rejectFallbackOnce = false;

globalThis.fetch = async (input: any, init?: any): Promise<Response> => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("https://sb.test/auth/v1/user")) {
    const auth = (init?.headers?.Authorization || "") as string;
    return auth === "Bearer user-jwt" ? new Response(JSON.stringify({ id: "u1" })) : new Response("{}", { status: 401 });
  }
  if (url.startsWith("https://sb.test/rest/v1/rpc/ai_quota_bump")) return new Response("3");
  if (url.startsWith("https://api.anthropic.com/")) {
    const headers = init.headers as Record<string, string>;
    const body = JSON.parse(init.body);
    calls.push({ headers, body });
    if (rejectFallbackOnce && body.fallbacks) {
      rejectFallbackOnce = false;
      return new Response(JSON.stringify({ error: { message: "fallbacks: unexpected parameter" } }), { status: 400 });
    }
    const content = JSON.stringify(body.messages[0].content);
    if (content.includes("SCENARIO_REFUSAL")) return sse([start(), end("refusal")]);
    if (content.includes("SCENARIO_TRUNC")) return sse([start(), ...think, ...textBlock(1, '{"defects":[{"description":"A"'), end("max_tokens")]);
    if (content.includes("SCENARIO_MIDFALLBACK")) {
      return sse([
        start(), ...think,
        ...textBlock(1, '{"defects":[{"description":"Robe shelving incomplete",'),
        { type: "content_block_start", index: 2, content_block: { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-5" } } },
        { type: "content_block_stop", index: 2 },
        ...textBlock(3, '"location":"Bedroom 2"}]}'),
        end("end_turn"),
      ]);
    }
    const deep = !!body.messages[0].content?.[0]?.source;
    const json = deep
      ? '{"layout":"grouped by room","defects":[{"description":"Door margin exceeds 5mm","location":"Bedroom 4","trade":"Carpenter","page":21,"anchor":"It has been observed, that door"}]}'
      : '{"defects":[{"description":"Paint touch-ups throughout","location":""},{"description":"Bathtub scratched","location":"Bathroom"}]}';
    return sse([start(), ...think, ...textBlock(1, json), end("end_turn")]);
  }
  return realFetch(input, init);
};

await import("./index.ts");
await new Promise((r) => setTimeout(r, 300));

async function post(body: unknown, jwt = "user-jwt") {
  const r = await realFetch("http://localhost:8000/", {
    method: "POST",
    headers: { "content-type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
}

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log("  PASS", name); } else { fail++; console.log("  FAIL", name, detail ?? ""); }
}

console.log("1. unauthenticated caller");
{ const r = await post({ text: "x" }, ""); check("401 without a user token", r.status === 401, r); }

console.log("2. flat read — request shape + result");
{
  calls.length = 0;
  const r = await post({ text: "Kitchen: bathtub scratched" });
  const c = calls[0];
  check("200", r.status === 200, r);
  check("2 defects returned", r.json.defects?.length === 2, r.json);
  check("model reported", r.json.model === "claude-opus-5-5", r.json);
  check("model claude-opus-5-5", c.body.model === "claude-opus-5-5");
  check("thinking adaptive (never disabled)", c.body.thinking?.type === "adaptive");
  check("flat effort medium", c.body.output_config?.effort === "medium", c.body.output_config);
  check("structured output kept", c.body.output_config?.format?.type === "json_schema");
  check("max_tokens 32000", c.body.max_tokens === 32000);
  check("fallbacks default", c.body.fallbacks === "default");
  check("fallback beta header", c.headers["anthropic-beta"] === "server-side-fallback-2026-07-01", c.headers);
  check("streams", c.body.stream === true);
}

console.log("3. deep read — request shape + result");
{
  calls.length = 0;
  const r = await post({ pdf: "JVBERi0xLjQK", trades: ["Carpenter", "Painter"] });
  const c = calls[0];
  check("200", r.status === 200, r);
  check("layout + deep flag", r.json.layout === "grouped by room" && r.json.deep === true, r.json);
  check("page/anchor/trade kept", r.json.defects?.[0]?.page === 21 && r.json.defects[0].trade === "Carpenter", r.json);
  check("deep effort high", c.body.output_config?.effort === "high");
  check("max_tokens 64000", c.body.max_tokens === 64000);
  check("trade enum from caller", JSON.stringify(c.body.output_config.format.schema).includes("Painter"));
}

console.log("4. refusal across the whole chain");
{ const r = await post({ text: "SCENARIO_REFUSAL" }); check("422 with a plain message", r.status === 422 && /declined/.test(r.json.error), r); }

console.log("5. truncated JSON (max_tokens)");
{ const r = await post({ text: "SCENARIO_TRUNC" }); check("413, never a silent partial list", r.status === 413, r); }

console.log("6. mid-stream fallback continues the same JSON");
{
  const r = await post({ text: "SCENARIO_MIDFALLBACK" });
  check("200", r.status === 200, r);
  check("one stitched defect", r.json.defects?.length === 1 && r.json.defects[0].location === "Bedroom 2", r.json);
  check("served-by model is the fallback", r.json.model === "claude-opus-5", r.json);
}

console.log("7. fallback beta rejected → retried without it");
{
  calls.length = 0; rejectFallbackOnce = true;
  const r = await post({ text: "anything" });
  check("200 after retry", r.status === 200, r);
  check("two upstream calls", calls.length === 2, calls.length);
  check("retry has no fallbacks/beta", !calls[1]?.body.fallbacks && !calls[1]?.headers["anthropic-beta"], calls[1]);
}

console.log("8. effort override via secret");
{
  Deno.env.set("EXTRACT_EFFORT_FLAT", "low"); Deno.env.set("EXTRACT_EFFORT_DEEP", "bogus");
  calls.length = 0; await post({ text: "x" }); const flat = calls[0].body.output_config.effort;
  calls.length = 0; await post({ pdf: "JVBERi0xLjQK" }); const deep = calls[0].body.output_config.effort;
  check("flat override honoured", flat === "low", flat);
  check("invalid deep override ignored → high", deep === "high", deep);
}

console.log("9. prompt + schema hygiene");
{
  calls.length = 0; await post({ text: "x" }); const flatSys = calls[0].body.system as string;
  calls.length = 0; await post({ pdf: "JVBERi0xLjQK" });
  const deepSys = calls[0].body.system as string;
  const schema = JSON.stringify(calls[0].body.output_config.format.schema);
  check("no numeric bounds in the schema (400s the read)", !/"(minimum|maximum|exclusiveMinimum|exclusiveMaximum)"/.test(schema), schema);
  for (const [name, s] of [["flat", flatSys], ["deep", deepSys]] as const) {
    check(`${name}: app room names offered`, s.includes("Bedroom 2") && s.includes("Walk In Robe"));
    check(`${name}: whole-house rule → Throughout`, s.includes("'Throughout'"));
    check(`${name}: no 'Bed 2/3/4' shorthand`, !s.includes("Bed 2/3/4"));
  }
  calls.length = 0; await post({ text: "x", locations: ["Kitchen", "Cubby House"] });
  check("caller-posted locations honoured", (calls[0].body.system as string).includes("Cubby House"));
}

console.log(`\n${pass} passed, ${fail} failed`);
Deno.exit(fail ? 1 : 0);
