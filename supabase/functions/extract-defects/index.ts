// Supabase Edge Function: extract-defects
// Receives inspection-report text, asks Claude to extract distinct defect
// items, returns { defects: string[] }. The Anthropic API key stays server-side
// (set as the ANTHROPIC_API_KEY secret) and never reaches the browser.

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  let text = "";
  try {
    const body = await req.json();
    text = (body && typeof body.text === "string") ? body.text : "";
  } catch (_) {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!text.trim()) return json({ error: "Missing 'text'" }, 400);
  // Cap input so a caller holding the public anon key can't run up the
  // Anthropic bill (or DoS the wallet) with a giant payload. Real inspection
  // reports are far under this; ~100k chars ≈ 25k tokens.
  const MAX_CHARS = 100_000;
  if (text.length > MAX_CHARS) return json({ error: "Report text too large" }, 413);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "Server not configured: ANTHROPIC_API_KEY missing" }, 500);

  // Structured output: each defect carries its own description + the room/area
  // it's in. Location pre-fills the review and sharpens the trade allocator
  // (which runs on location + description).
  const schema = {
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
            location: { type: "string", description: "Room/area of the home (e.g. Kitchen, Master Bedroom, Ensuite, Garage, Alfresco, Facade / External, Roof), or '' if not stated." },
          },
          required: ["description", "location"],
        },
      },
    },
    required: ["defects"],
  };

  const anthropicReq = {
    model: "claude-opus-4-8",
    max_tokens: 8000,
    thinking: { type: "disabled" },
    system:
      "You read a residential building inspection report and extract every distinct defect/item noted for rectification. " +
      "For each, return a concise, actionable one-line description in the inspector's own wording, plus the room/area it is in.\n" +
      "Rules:\n" +
      "• Capture each defect ONCE. Reports often list an item in a summary table AND again in a detailed/photos section — do not duplicate.\n" +
      "• Put the room or area in `location` (Kitchen, Master Bedroom, Bed 2/3/4, Ensuite, Bathroom, Laundry, WIR/Robe, Hallway, Entry, Garage, Alfresco, Porch, Facade / External, Roof, Driveway, etc.); use '' if not stated. Do NOT repeat the location inside `description`.\n" +
      "• Exclude headings, scores/ratings, page numbers, the date, the address, names, signatures, photo captions, disclaimers and general boilerplate.\n" +
      "• Do NOT invent, infer, or summarise defects that are not explicitly stated.\n" +
      "• Strip leading item numbers and 'Observation:' / 'Defect:' / 'Note:' labels; keep the technical wording.",
    messages: [
      {
        role: "user",
        content: "Extract the defects from this inspection report:\n\n" + text.slice(0, 120000),
      },
    ],
    output_config: { format: { type: "json_schema", schema } },
  };

  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(anthropicReq),
    });
  } catch (e) {
    return json({ error: "Could not reach Anthropic: " + String(e) }, 502);
  }

  const data = await resp.json();
  if (!resp.ok) {
    return json({ error: data?.error?.message || "Anthropic API error", status: resp.status }, 502);
  }

  const block = (data.content || []).find((b: any) => b.type === "text");
  let defects: { description: string; location: string }[] = [];
  try {
    const parsed = JSON.parse(block?.text || "{}");
    if (Array.isArray(parsed.defects)) {
      defects = parsed.defects
        .map((d: any) => (typeof d === "string"
          ? { description: d.trim(), location: "" }
          : { description: String(d?.description ?? "").trim(), location: String(d?.location ?? "").trim() }))
        .filter((d: { description: string }) => d.description);
    }
  } catch (_) { /* fall through with empty list */ }

  return json({ defects });
});
