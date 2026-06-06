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

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "Server not configured: ANTHROPIC_API_KEY missing" }, 500);

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      defects: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["defects"],
  };

  const anthropicReq = {
    model: "claude-opus-4-8",
    max_tokens: 8000,
    thinking: { type: "disabled" },
    system:
      "You extract building/construction defect items from an inspection report. " +
      "Return each distinct defect as its own concise description string. " +
      "Join lines that are clearly one wrapped item. " +
      "Exclude headings, section titles, page numbers, dates, addresses, names, " +
      "signatures, and boilerplate. Do not invent or infer defects that are not stated.",
    messages: [
      {
        role: "user",
        content: "Extract every defect item from this inspection report:\n\n" + text.slice(0, 100000),
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
  let defects: string[] = [];
  try {
    const parsed = JSON.parse(block?.text || "{}");
    if (Array.isArray(parsed.defects)) {
      defects = parsed.defects.map((d: unknown) => String(d).trim()).filter(Boolean);
    }
  } catch (_) { /* fall through with empty list */ }

  return json({ defects });
});
