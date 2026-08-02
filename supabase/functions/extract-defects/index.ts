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

// Fallback trade vocabulary. The app posts its own list (single source of
// truth is CALLUP_TRADE_KEYWORDS in index.html) — this only covers a caller
// that doesn't.
const FALLBACK_TRADES = [
  "Painter", "Renderer", "Bricklayer", "Plasterer", "Electrician", "Roof Plumber",
  "Plumber", "Drainer", "Tiler", "Waterproofer", "Flooring", "Carpenter", "Glazier",
  "Concreter", "Caulker", "Cleaner", "Site Cleaner", "Brick Cleaner", "Insulation",
  "Cabinet Maker", "Garage Door", "Landscaper", "Shower Screen", "Paving", "Fencing",
];

const LOCATION_HINT =
  "Kitchen, Master Bedroom, Bed 2/3/4, Ensuite, Bathroom, Laundry, WIR/Robe, " +
  "Hallway, Entry, Living, Dining, Garage, Alfresco, Porch, Facade / External, " +
  "Roof, Driveway";

// Rules both modes share, so a report imported either way reads the same on the
// review screen.
const COMMON_RULES =
  "• Capture each defect ONCE. Reports routinely list an item in a summary table AND again in a detailed or photo section — that is one defect, not two.\n" +
  "• One row per rectification item. If a paragraph describes three separate things to fix, that is three rows. If it describes one thing three ways, that is one row.\n" +
  "• `description` is the tradesman's instruction: concise, actionable, in the inspector's own technical wording. Strip leading item numbers and 'Observation:' / 'Defect:' / 'Note:' labels.\n" +
  "• `location` is the room or area (" + LOCATION_HINT + "), or '' if the report never says. Do NOT repeat the location inside `description`.\n" +
  "• Exclude headings, scores/ratings, page numbers, the date, the address, names, signatures, disclaimers, methodology and general boilerplate.\n" +
  "• Do NOT invent, infer or summarise defects that are not explicitly stated. A report with 12 defects must return 12 rows, not 20.";

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
          },
          required: ["description", "location"],
        },
      },
    },
    required: ["defects"],
  };
}

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
            trade: {
              type: "string",
              enum: ["", ...trades],
              description: "Best-fit trade from the list, or '' if genuinely unclear. Only used when the app's own allocator can't place the item.",
            },
            page: {
              type: "integer",
              minimum: 1,
              description: "1-based PDF page where this defect's TEXT appears (not where its photo appears).",
            },
            anchor: {
              type: "string",
              description:
                "4-10 words copied EXACTLY, character for character, from the start of the line where this defect's text begins on that page. " +
                "Used to locate the defect on the page so photos printed beneath it attach to it. Must be verbatim from the page — " +
                "do not tidy, re-order, re-case or paraphrase it, and do not use words from a heading unless the defect text is in the heading itself.",
            },
          },
          required: ["description", "location", "trade", "page", "anchor"],
        },
      },
    },
    required: ["layout", "defects"],
  };
}

const DEEP_SYSTEM =
  "You are reading a residential building inspection report — usually a private inspector's report on a new home, " +
  "written for a supervisor who has to hand each item to the right trade and get it fixed.\n\n" +
  "These reports have NO standard format. One is a numbered table. The next is grouped room by room. The next is grouped by " +
  "defect type ('Painting', then 'Tiling'), so the same room reappears in several places. Some run as prose with a cluster of " +
  "photos underneath each paragraph, the photos belonging to the text ABOVE them rather than being captioned individually.\n\n" +
  "So: read the whole report first and work out how THIS one is organised. Then re-express it as one flat list of defects, in " +
  "the order they appear. You are reformatting the report into the supervisor's worklist, not summarising it.\n\n" +
  "Rules:\n" + COMMON_RULES + "\n" +
  "• When a defect sits under a room heading and its own line doesn't name the room, inherit the room from the heading. When the " +
  "report is grouped by defect TYPE instead, the heading gives you the trade and the line itself usually gives you the room.\n" +
  "• Photos are evidence, not defects. A photo cluster under a paragraph supports the defect(s) described in that paragraph — never " +
  "create a defect just because a photo exists, and never skip a defect just because it has no photo.\n" +
  "• `page` and `anchor` must point at where the defect's TEXT is, so the app can find it on the page and attach the photos printed " +
  "below it. Getting the anchor verbatim matters as much as getting the description right.\n" +
  "• The trade list is fixed — pick the closest fit or return ''. Never invent a trade name.";

async function callAnthropic(apiKey: string, body: unknown) {
  // Streamed: a deep read of a 40-page report with adaptive thinking can run for
  // minutes, and a non-streaming request that long is refused outright by the
  // API. Streaming also keeps the connection warm so the edge function isn't
  // killed waiting on a silent socket.
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ ...(body as Record<string, unknown>), stream: true }),
  });
  if (!resp.ok || !resp.body) {
    let msg = "Anthropic API error";
    try { msg = (await resp.json())?.error?.message || msg; } catch (_) { /* keep default */ }
    throw Object.assign(new Error(msg), { status: resp.status });
  }

  // Accumulate the assistant's TEXT blocks only. With adaptive thinking the
  // stream also carries thinking_delta events; the structured JSON lives in the
  // text block (grammars don't constrain thinking), so those are dropped.
  let out = "";
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
      if (ev.type === "content_block_start") inText = ev.content_block?.type === "text";
      else if (ev.type === "content_block_stop") inText = false;
      else if (ev.type === "content_block_delta" && inText && ev.delta?.type === "text_delta") out += ev.delta.text || "";
      else if (ev.type === "error") throw new Error(ev.error?.message || "Anthropic stream error");
    }
  }
  return out;
}

function str(v: unknown) { return String(v ?? "").trim(); }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

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

  if (!deep && !text.trim()) return json({ error: "Missing 'text'" }, 400);
  if (!deep && text.length > MAX_CHARS) return json({ error: "Report text too large" }, 413);
  if (deep && pdf.length > MAX_PDF_B64) {
    return json({ error: "That PDF is too large to read page-by-page. Untick Deep read and try again." }, 413);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "Server not configured: ANTHROPIC_API_KEY missing" }, 500);

  const anthropicReq = deep
    ? {
        model: "claude-opus-5",
        max_tokens: 16000,
        // Adaptive: working out how a report is organised is the hard part and
        // deserves thinking; a tidy numbered report shouldn't pay for it. The
        // model decides per report.
        thinking: { type: "adaptive" },
        system: DEEP_SYSTEM,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf } },
            { type: "text", text: "Read this inspection report end to end and return every item to be rectified." },
          ],
        }],
        output_config: { format: { type: "json_schema", schema: deepSchema(trades) } },
      }
    : {
        model: "claude-opus-5",
        max_tokens: 8000,
        thinking: { type: "disabled" },
        system:
          "You read a residential building inspection report and extract every distinct defect/item noted for rectification. " +
          "For each, return a concise, actionable one-line description in the inspector's own wording, plus the room/area it is in.\n" +
          "Rules:\n" + COMMON_RULES,
        messages: [{
          role: "user",
          content: "Extract the defects from this inspection report:\n\n" + text.slice(0, MAX_CHARS),
        }],
        output_config: { format: { type: "json_schema", schema: flatSchema() } },
      };

  let raw = "";
  try {
    raw = await callAnthropic(apiKey, anthropicReq);
  } catch (e: any) {
    const status = e?.status;
    if (status && status >= 400 && status < 500) return json({ error: e.message || "Anthropic API error", status }, 502);
    return json({ error: "Could not reach Anthropic: " + (e?.message || String(e)) }, 502);
  }

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
            ...(deep ? {
              trade: str(d?.trade),
              page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : null,
              anchor: str(d?.anchor),
            } : {}),
          };
        })
        .filter((d: { description: string }) => d.description);
    }
  } catch (_) { /* fall through with empty list */ }

  return json(deep ? { defects, layout, deep: true } : { defects });
});
