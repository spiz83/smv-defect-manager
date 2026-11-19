// Supabase Edge Function: extract-defects
// Reads an inspection report with Claude and returns the defects to rectify.
// The Anthropic API key stays server-side (ANTHROPIC_API_KEY secret) and never
// reaches the browser.
//
// TWO MODES:
//   { text }  — flat mode. Report text only. Cheap. What BPI fallbacks and the
//               paste box use. Returns { description, location }.
//   { pdf }   — DEEP READ (base64 PDF, admin-only in the app). Claude sees the
//               actual pages: headings, tables, columns and the photos printed
//               between them. Returns { description, location, trade, page,
//               anchor } so the client can pair report photos to defects.
//
// Why deep read exists (Spiro 2026-08-02): BPI reports carry their structure in
// the WORDS ("1 Kitchen Painter ..."), so flattened text is enough. Private
// inspection reports carry it in the LAYOUT — a room heading, a defect-type
// heading, a cluster of four photos sitting under a paragraph. Flattening the
// PDF throws that away before the model sees it, then asks the model to work
// out how the report was organised. Sending the pages fixes the input, not the
// prompt.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

// Cap flat-mode input so a caller holding the public anon key can't run up the
// Anthropic bill with a giant payload. Real reports are far under this;
// ~100k chars ≈ 25k tokens.
const MAX_CHARS = 100_000;
// Deep read costs ~2,300 tokens a page (each page is processed as text AND
// image) against ~350 as text, so the PDF gets a hard byte cap too. 15 MB of
// base64 ≈ 11 MB of PDF — larger than any inspection report we've seen, and
// bounded enough that a leaked anon key can't empty the account. The app also
// caps PAGES before it ever calls, which is the cost lever that actually
// matters (a 200-page PDF can be small on disk and enormous in tokens).
const MAX_PDF_B64 = 15 * 1024 * 1024;

// ===========================================================================
//  WHO IS CALLING, AND HOW OFTEN  (2026-09-19)
// ---------------------------------------------------------------------------
//  This function used to read no Authorization header at all. The platform's
//  JWT gate is satisfied by the PUBLIC anon key — which ships in index.html,
//  correctly, because it is the key the browser signs in with — so in practice
//  anyone who opened the site could POST here as often as they liked and every
//  call went to claude-opus-5. The only guards were per-CALL size caps; nothing
//  capped the number of calls. It also meant the 50/user/day figure in the
//  tracker's 05_AI_PROMPTS.md could not be enforced even in principle, because
//  there was no "user" in scope to count against.
//
//  Note this function never touches the database and never did — it only reads
//  what the caller posts. So the exposure was billing, not defect data.
//
//  Two checks now, and they fail in DIFFERENT directions on purpose:
//
//   1. IDENTITY — fails CLOSED. Needs nothing from the database, so it works
//      the moment this function is deployed. A caller holding only the anon key
//      is rejected: /auth/v1/user answers 401 for it, since it carries no user.
//
//   2. DAILY CAP — fails OPEN. It needs 2026-09-19_ai_call_quota.sql, and in
//      this project migrations are run BY HAND, so there is a window where this
//      function is deployed and the table does not exist yet. Failing closed
//      there would break every import for everyone on site until someone ran
//      the SQL. So an unreachable counter logs and lets the call through: the
//      identity check above is doing the load-bearing work, and the cap starts
//      biting the moment the migration lands. Check the logs for
//      [quota unavailable] if you think it should be on and isn't.
// ===========================================================================
const DAILY_LIMIT = 50;
const FN_NAME = "extract-defects";

// The signed-in user's id, or null for anyone we cannot place — no token, a
// token that is only the anon key, or an expired session.
async function callerUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return null;
  try {
    const r = await fetch(`${url}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anon },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return typeof u?.id === "string" && u.id ? u.id : null;
  } catch (_) {
    return null;
  }
}

// Count this call and return the running total for today, or null if the
// counter can't be reached (see the fail-open note above).
async function bumpQuota(userId: string): Promise<number | null> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  try {
    const r = await fetch(`${url}/rest/v1/rpc/ai_quota_bump`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ p_user: userId, p_fn: FN_NAME }),
    });
    if (!r.ok) {
      console.error("[quota unavailable] rpc ai_quota_bump HTTP " + r.status + " — has 2026-09-19_ai_call_quota.sql been run?");
      return null;
    }
    const used = await r.json();
    return typeof used === "number" ? used : null;
  } catch (e) {
    console.error("[quota unavailable]", e);
    return null;
  }
}

// Fallback trade vocabulary. The app posts its own list (single source of
// truth is CALLUP_TRADE_KEYWORDS in index.html) — this only covers a caller
// that doesn't.
const FALLBACK_TRADES = [
  "Painter", "Renderer", "Bricklayer", "Plasterer", "Electrician", "Roof Plumber",
  "Plumber", "Drainer", "Tiler", "Waterproofer", "Flooring", "Carpenter", "Glazier",
  "Concreter", "Caulker", "Cleaner", "Site Cleaner", "Brick Cleaner", "Insulation",
  "Cabinet Maker", "Garage Door", "Landscaper", "Shower Screen", "Paving", "Fencing",
];

// ===========================================================================
//  THE MODEL  (Claude Opus 5.5, 2026-11-19)
// ---------------------------------------------------------------------------
//  Moved from claude-opus-5. Same 1M context and PDF/vision support, 20%
//  cheaper per token, and markedly better at exactly what this function does:
//  reading dense visual layouts (headings, photo clusters, tables) and not
//  stating things the input doesn't support.
//
//  Three things changed with the move and all three are load-bearing:
//
//   1. THINKING CAN'T BE TURNED OFF. The flat path used to send
//      thinking:{type:"disabled"} — that is a 400 on Opus 5.5 and would have
//      broken every import. Thinking is always adaptive now; EFFORT is the dial
//      for how hard it thinks (and so for latency and cost).
//
//   2. THE EFFORT DEFAULT DROPPED to "medium" (Opus 5 defaulted to "high"), so
//      it is set explicitly per mode below. Opus 5.5 at "medium" out-reads
//      Opus 5 at "high" in Anthropic's testing; deep read gets "high" because
//      working out how a never-seen-before report is organised is the hard
//      part. Both can be retuned with a Supabase secret, no redeploy:
//        supabase secrets set EXTRACT_EFFORT_FLAT=low|medium|high
//        supabase secrets set EXTRACT_EFFORT_DEEP=medium|high|xhigh
//
//   3. REFUSALS ARE A REAL STOP REASON. A safety classifier can (rarely, and
//      wrongly for a building report) decline a request. fallbacks:"default"
//      re-runs a declined read on Anthropic's recommended fallback model
//      server-side, on the same stream. If the whole chain still declines we
//      now say so plainly instead of returning an empty list that looks like
//      "no defects found".
// ===========================================================================
const MODEL = "claude-opus-5-5";
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
function effortFor(name: string, fallback: string): string {
  const v = (Deno.env.get(name) || "").trim().toLowerCase();
  return EFFORTS.has(v) ? v : fallback;
}
// Thinking counts against max_tokens even though its text isn't returned, so
// these are sized for the thinking AND the JSON. Only tokens actually produced
// are billed — a generous ceiling costs nothing, a tight one truncates the JSON.
const MAX_TOKENS_FLAT = 32000;
const MAX_TOKENS_DEEP = 64000;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

// The app's own room names — the import screen's Location dropdown
// (BPI_LOCATIONS in index.html) plus 'Throughout'. The old hint said
// "Bed 2/3/4", and the model obliged: every bedroom came back as "Bed 2", which
// is not a dropdown option, so it landed as a custom location and the
// floor-plan code (b2) never matched. A caller may post its own list as
// `locations`; this is the fallback and should track BPI_LOCATIONS.
const APP_LOCATIONS = [
  "Throughout",
  "Entry", "Hallway", "Living", "Lounge", "Family", "Meals", "Dining", "Kitchen", "Pantry",
  "Master Bedroom", "Bedroom 1", "Bedroom 2", "Bedroom 3", "Bedroom 4", "Bedroom 5",
  "Walk In Robe", "Linen Cupboard", "Study", "Rumpus", "Theatre", "Sitting", "Retreat", "Stairs",
  "Ensuite", "Bathroom", "Powder Room", "Toilet", "Laundry",
  "Garage", "Garage Internal PA Door", "Garage External PA Door", "Roof Space", "General Internal",
  "Front Door", "Porch", "Alfresco", "Balcony", "Driveway", "Roof",
  "Front Elevation", "Rear Elevation", "Left Elevation", "Right Elevation", "General External",
];

function locationRule(locations: string[]): string {
  return "• `location` is the room or area, written as EXACTLY one of these names whenever one fits: " + locations.join(", ") + ". " +
    "Map the report's wording onto them ('Bed 2' → 'Bedroom 2', 'WIR' → 'Walk In Robe', 'Laundry room' → 'Laundry'); keep the report's own numbering " +
    "('Bedroom 1' stays 'Bedroom 1', 'Master Bedroom' stays 'Master Bedroom'). " +
    "If the inspector says the item applies across the whole house — 'check throughout', 'general note', 'throughout the home' — use 'Throughout', " +
    "even if the note sits under one room's heading. Use '' only if the report never says where. Do NOT repeat the location inside `description`.\n";
}

// Rules both modes share, so a report imported either way reads the same on the
// review screen.
const commonRules = (locations: string[]) =>
  "• Capture each defect ONCE. Reports routinely list an item in a summary table AND again in a detailed or photo section — that is one defect, not two.\n" +
  "• One row per rectification item. If a paragraph describes three separate things to fix, that is three rows. If it describes one thing three ways, that is one row.\n" +
  "• `description` is the tradesman's instruction: concise, actionable, in the inspector's own technical wording. Strip leading item numbers and 'Observation:' / 'Defect:' / 'Note:' labels.\n" +
  locationRule(locations) +
  "• Exclude headings, scores/ratings, page numbers, the date, the address, names, signatures, disclaimers, methodology and general boilerplate.\n" +
  "• Do NOT invent, infer or summarise defects that are not explicitly stated. A report with 12 defects must return 12 rows, not 20.\n" +
  "• Return the defects in the order they appear in the report — the app numbers them in that order.\n" +
  "• `item_no` is the report's OWN number for that one defect, exactly as printed ('7', '3.27'), when the report numbers its individual " +
  "items. A section or chapter number ('8. Bedrooms') is not an item number. If the report doesn't number its items, return ''. Never invent one.";

// Every private-inspection item is saved as "PI #<item> (p.<page>) — <defect>",
// so the page and the report's own item number come back on BOTH paths now —
// they used to be deep-read only, and a flat import saved bare text.
const ITEM_NO = {
  type: "string",
  description: "The report's own number for this defect as printed ('7', '3.27'), or '' if the report doesn't number its items.",
};
const ANCHOR = {
  type: "string",
  description:
    "4-10 words copied EXACTLY, character for character, from the start of the line where this defect's text begins on that page. " +
    "Used to locate the defect on the page so photos printed beneath it attach to it. Must be verbatim from the page — " +
    "do not tidy, re-order, re-case or paraphrase it, and do not use words from a heading unless the defect text is in the heading itself.",
};

function flatSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      defects: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            description: { type: "string", description: "One concise, actionable defect in the inspector's own wording." },
            location: { type: "string", description: "Room/area of the home, or '' if not stated." },
            item_no: ITEM_NO,
            // No numeric bounds — see the note on the deep schema.
            page: {
              type: "integer",
              description: "The N of the [[page N]] marker above this defect's text, or 0 if the text has no page markers.",
            },
            anchor: ANCHOR,
          },
          required: ["description", "location", "item_no", "page", "anchor"],
        },
      },
    },
    required: ["defects"],
  };
}

// The app marks where each PDF page starts with a line "[[page N]]" (see
// extractReportText in index.html). Pasted text has none.
const FLAT_PAGE_RULE =
  "• The text marks the start of each PDF page with a line `[[page N]]`. `page` is the N of the marker above the defect's text " +
  "(where its text is, not its photo); 0 if the text has no markers. `anchor` is copied from that page's text, never from a marker.\n";

function deepSchema(trades: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      layout: {
        type: "string",
        description:
          "One short sentence naming how THIS report is organised — e.g. 'grouped by room, photos inline', " +
          "'grouped by defect type with a photo appendix', 'continuous prose, photos below each paragraph'. " +
          "Shown to the supervisor so they can sanity-check the read.",
      },
      defects: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            description: { type: "string", description: "One concise, actionable defect in the inspector's own wording." },
            location: { type: "string", description: "Room/area of the home, or '' if not stated." },
            item_no: ITEM_NO,
            trade: {
              type: "string",
              enum: ["", ...trades],
              description: "Best-fit trade from the list, or '' if genuinely unclear. Only used when the app's own allocator can't place the item.",
            },
            // No `minimum` here: structured outputs reject numeric bounds on
            // integers ("property 'minimum' is not supported") and the whole
            // deep read 400'd on it. The handler below drops anything < 1.
            page: {
              type: "integer",
              description: "1-based PDF page where this defect's TEXT appears (not where its photo appears). The first page is 1.",
            },
            anchor: ANCHOR,
          },
          required: ["description", "location", "item_no", "trade", "page", "anchor"],
        },
      },
    },
    required: ["layout", "defects"],
  };
}

const deepSystem = (locations: string[]) =>
  "You are reading a residential building inspection report — usually a private inspector's report on a new home, " +
  "written for a supervisor who has to hand each item to the right trade and get it fixed.\n\n" +
  "These reports have NO standard format. One is a numbered table. The next is grouped room by room. The next is grouped by " +
  "defect type ('Painting', then 'Tiling'), so the same room reappears in several places. Some run as prose with a cluster of " +
  "photos underneath each paragraph, the photos belonging to the text ABOVE them rather than being captioned individually.\n\n" +
  "So: read the whole report first and work out how THIS one is organised. Then re-express it as one flat list of defects, in " +
  "the order they appear. You are reformatting the report into the supervisor's worklist, not summarising it.\n\n" +
  "Rules:\n" + commonRules(locations) + "\n" +
  "• When a defect sits under a room heading and its own line doesn't name the room, inherit the room from the heading. When the " +
  "report is grouped by defect TYPE instead, the heading gives you the trade and the line itself usually gives you the room.\n" +
  "• Photos are evidence, not defects. A photo cluster under a paragraph supports the defect(s) described in that paragraph — never " +
  "create a defect just because a photo exists, and never skip a defect just because it has no photo.\n" +
  "• `page` and `anchor` must point at where the defect's TEXT is, so the app can find it on the page and attach the photos printed " +
  "below it. Getting the anchor verbatim matters as much as getting the description right.\n" +
  "• The trade list is fixed — pick the closest fit or return ''. Never invent a trade name.";

type ReadResult = {
  text: string;          // the concatenated TEXT blocks — the structured JSON
  stopReason: string;    // end_turn | max_tokens | refusal | ...
  model: string;         // the model that produced the final answer
  fellBack: string;      // "" or "claude-opus-5-5 → <model>" if a fallback ran
  inputTokens: number;
  outputTokens: number;  // includes thinking
};

async function streamMessages(apiKey: string, body: Record<string, unknown>, withFallback: boolean): Promise<Response> {
  return await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      ...(withFallback ? { "anthropic-beta": FALLBACK_BETA } : {}),
    },
    body: JSON.stringify({ ...body, ...(withFallback ? { fallbacks: "default" } : {}), stream: true }),
  });
}

async function callAnthropic(apiKey: string, body: Record<string, unknown>): Promise<ReadResult> {
  // Streamed: a deep read of a 40-page report with adaptive thinking can run for
  // minutes, and a non-streaming request that long is refused outright by the
  // API. Streaming also keeps the connection warm so the edge function isn't
  // killed waiting on a silent socket.
  let resp = await streamMessages(apiKey, body, true);
  if (resp.status === 400) {
    // The fallback opt-in is a beta. If this account or region ever rejects
    // it, read the report without the safety net rather than failing the
    // import outright — a refusal is rare, an outage is not acceptable.
    let msg = "";
    try { msg = (await resp.clone().json())?.error?.message || ""; } catch (_) { /* ignore */ }
    if (/fallback/i.test(msg)) {
      console.warn("[extract-defects] fallbacks rejected, retrying without:", msg);
      resp = await streamMessages(apiKey, body, false);
    }
  }
  if (!resp.ok || !resp.body) {
    let msg = "Anthropic API error";
    try { msg = (await resp.json())?.error?.message || msg; } catch (_) { /* keep default */ }
    throw Object.assign(new Error(msg), { status: resp.status });
  }

  // Accumulate the assistant's TEXT blocks only. Thinking blocks (always on
  // with Opus 5.5) and `fallback` marker blocks are skipped; the structured
  // JSON lives in the text blocks. After a MID-stream fallback the partial
  // text stays and the fallback model continues it, so concatenating every
  // text block still yields one document.
  const r: ReadResult = { text: "", stopReason: "", model: "", fellBack: "", inputTokens: 0, outputTokens: 0 };
  let inText = false;
  let buf = "";
  const reader = resp.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let ev: any;
      try { ev = JSON.parse(payload); } catch (_) { continue; }
      if (ev.type === "message_start") {
        r.model = String(ev.message?.model || "");
        r.inputTokens = Number(ev.message?.usage?.input_tokens) || 0;
      } else if (ev.type === "content_block_start") {
        const cb = ev.content_block || {};
        inText = cb.type === "text";
        if (cb.type === "fallback") {
          const to = String(cb.to?.model || "");
          r.fellBack = `${String(cb.from?.model || MODEL)} → ${to}`;
          if (to) r.model = to;
        }
      } else if (ev.type === "content_block_stop") inText = false;
      else if (ev.type === "content_block_delta" && inText && ev.delta?.type === "text_delta") r.text += ev.delta.text || "";
      else if (ev.type === "message_delta") {
        if (ev.delta?.stop_reason) r.stopReason = String(ev.delta.stop_reason);
        if (ev.usage?.output_tokens != null) r.outputTokens = Number(ev.usage.output_tokens) || r.outputTokens;
      } else if (ev.type === "error") throw new Error(ev.error?.message || "Anthropic stream error");
    }
  }
  return r;
}

function str(v: unknown) { return String(v ?? "").trim(); }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  // Before the body is even read — an unidentified caller costs us nothing.
  const userId = await callerUserId(req);
  if (!userId) return json({ error: "Sign in to use AI extraction." }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch (_) {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const text = typeof body?.text === "string" ? body.text : "";
  const pdf = typeof body?.pdf === "string" ? body.pdf : "";
  const deep = !!pdf;
  const trades: string[] = Array.isArray(body?.trades) && body.trades.length
    ? body.trades.map(str).filter(Boolean).slice(0, 60)
    : FALLBACK_TRADES;
  const locations: string[] = Array.isArray(body?.locations) && body.locations.length
    ? body.locations.map(str).filter(Boolean).slice(0, 80)
    : APP_LOCATIONS;

  if (!deep && !text.trim()) return json({ error: "Missing 'text'" }, 400);
  if (!deep && text.length > MAX_CHARS) return json({ error: "Report text too large" }, 413);
  if (deep && pdf.length > MAX_PDF_B64) {
    return json({ error: "That PDF is too large to read page-by-page. Untick Deep read and try again." }, 413);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "Server not configured: ANTHROPIC_API_KEY missing" }, 500);

  // Counted BEFORE the call, not after: a run of failures must not be a free
  // way round the cap. The cost of that is a failed extraction still spending
  // one of the 50, which is the right way to be wrong here.
  const used = await bumpQuota(userId);
  if (used !== null && used > DAILY_LIMIT) {
    return json({
      // Kept short deliberately — this lands in a toast on a phone.
      error: `Daily AI limit reached (${DAILY_LIMIT} reports). Resets midnight UTC.`,
      limit: DAILY_LIMIT,
      used,
    }, 429);
  }

  const effort = deep ? effortFor("EXTRACT_EFFORT_DEEP", "high") : effortFor("EXTRACT_EFFORT_FLAT", "medium");
  const anthropicReq: Record<string, unknown> = deep
    ? {
        model: MODEL,
        max_tokens: MAX_TOKENS_DEEP,
        // Adaptive is the only mode on Opus 5.5; effort sets how hard it thinks.
        // Working out how a report is organised is the hard part and deserves
        // it; a tidy numbered report still finishes quickly.
        thinking: { type: "adaptive" },
        system: deepSystem(locations),
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf } },
            { type: "text", text: "Read this inspection report end to end and return every item to be rectified." },
          ],
        }],
        output_config: { effort, format: { type: "json_schema", schema: deepSchema(trades) } },
      }
    : {
        model: MODEL,
        max_tokens: MAX_TOKENS_FLAT,
        thinking: { type: "adaptive" },
        system:
          "You read a residential building inspection report and extract every distinct defect/item noted for rectification. " +
          "For each, return a concise, actionable one-line description in the inspector's own wording, plus the room/area it is in.\n" +
          "Rules:\n" + FLAT_PAGE_RULE + commonRules(locations),
        messages: [{
          role: "user",
          content: "Extract the defects from this inspection report:\n\n" + text.slice(0, MAX_CHARS),
        }],
        output_config: { effort, format: { type: "json_schema", schema: flatSchema() } },
      };

  let read: ReadResult;
  const t0 = Date.now();
  try {
    read = await callAnthropic(apiKey, anthropicReq);
  } catch (e: any) {
    const status = e?.status;
    if (status && status >= 400 && status < 500) return json({ error: e.message || "Anthropic API error", status }, 502);
    return json({ error: "Could not reach Anthropic: " + (e?.message || String(e)) }, 502);
  }
  // One line per read in the function logs — model, effort, size, time and
  // stop reason — so cost and quality can be checked against real reports.
  console.log("[extract-defects]", JSON.stringify({
    mode: deep ? "deep" : "flat", model: read.model, effort, stop: read.stopReason,
    fellBack: read.fellBack || undefined, in: read.inputTokens, out: read.outputTokens,
    ms: Date.now() - t0,
  }));
  if (read.stopReason === "refusal") {
    // The whole chain declined (fallback included). Never hand back the
    // partial: say so, and the app falls back to its own parser.
    return json({ error: "The AI declined to read this report — falling back to the basic reader." }, 422);
  }
  if (read.stopReason === "max_tokens") {
    // The JSON was cut off mid-list. A truncated list silently drops the
    // defects at the end of the report, which is worse than an error.
    return json({ error: "That report was too long to read in one pass." }, 413);
  }
  const raw = read.text;

  let defects: Record<string, unknown>[] = [];
  let layout = "";
  try {
    const parsed = JSON.parse(raw || "{}");
    layout = str(parsed.layout);
    if (Array.isArray(parsed.defects)) {
      defects = parsed.defects
        .map((d: any) => {
          // Tolerate the old flat-string shape from any cached client.
          if (typeof d === "string") return { description: d.trim(), location: "" };
          const page = Number(d?.page);
          return {
            description: str(d?.description),
            location: str(d?.location),
            // Both paths now: the app builds "PI #<item_no or position> (p.<page>) — ".
            item_no: str(d?.item_no),
            page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : null,
            anchor: str(d?.anchor),
            ...(deep ? { trade: str(d?.trade) } : {}),
          };
        })
        .filter((d: { description: string }) => d.description);
    }
  } catch (_) { /* fall through with empty list */ }

  return json(deep ? { defects, layout, deep: true, model: read.model } : { defects, model: read.model });
});
