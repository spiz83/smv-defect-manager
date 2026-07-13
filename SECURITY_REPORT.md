# Defect Manager — Security Report

_Audit date: 2026-07-13. Threat model: internal tool, ~5 trusted authenticated
users (site supervisors + manager), shared Supabase DB, public PWA URL._

## Summary

No critical or high-severity remotely-exploitable vulnerability was found in
shipped code. Secrets are handled correctly. The main items are (a) a
cost-abuse vector on the AI edge function and (b) inconsistent output escaping
that is only low-severity because input comes from trusted users.

## Findings

### S1 — Edge function has no input-size limit (Medium: cost/DoS-of-wallet)
`supabase/functions/extract-defects/index.ts` accepts `body.text` of any size
and forwards it to Claude. A caller holding the public anon key (it ships in the
client) can send megabytes of text per request and run up the Anthropic bill.
There is also no per-user throttle.

**Recommended fix (ready to apply, behaviour-preserving for normal reports):**
```ts
if (!text.trim()) return json({ error: "Missing 'text'" }, 400);
+ const MAX_CHARS = 100_000;               // ~25k tokens; real reports are far smaller
+ if (text.length > MAX_CHARS) {
+   return json({ error: "Report text too large" }, 413);
+ }
```
Optionally add a coarse per-IP/day counter in a Postgres table. Not deployed in
this pass — edge deploys need the Supabase CLI + go-ahead.

### S2 — Inconsistent HTML escaping of user text (Low, given trusted users)
`index.html` has **30 `innerHTML` assignments**. Escaping is applied ad-hoc via
locally-redefined `esc`/`escC` helpers in a handful of functions
(lines ~4651, 4696, 4748, 7940, 8078) but **many interpolations of
`defect.description`, `location`, `contractor.name`, addresses render raw**.
A supervisor entering `<img src=x onerror=alert(1)>` as a defect description
would store-and-execute script for anyone viewing that job. Severity is Low
today (all inputs come from ~5 trusted staff) but it is a real stored-XSS
surface and should be closed before any external/tenant use (cf. DefectFlow).

**Recommended fix:** promote a single top-level `escHtml()` and route every
user-data interpolation through it. This touches ~30 sites and changes rendered
output for any string currently containing `<`/`&`/`"`; it needs a visual pass
on a device, so it is **documented, not blindly applied** here.

### S3 — `Access-Control-Allow-Origin: *` on the edge function (Low)
Acceptable for a POST-only JSON endpoint that carries no cookies and is
JWT-gated, but tightening to the two known origins
(`smv-defect-manager.vercel.app`, `spiz83.github.io`) removes drive-by browser
callers. Low priority.

### S4 — Supabase anon key in client (Informational — NOT a vulnerability)
The JWT at `index.html:8813` is the **anon** key (`"role":"anon"`). It is public
by design; the security boundary is **RLS**. No action needed beyond ensuring
RLS stays correct. Confirm periodically that no table is `USING (true)` for
writes it shouldn't be (defects/photos were deliberately opened to
`authenticated` after field incidents — that is an accepted trade-off for 5
trusted users, but is exactly what must tighten before multi-tenant use).

### S5 — No provider secret leakage (PASS)
`ANTHROPIC_API_KEY` is only read via `Deno.env` in the edge function. No
service_role key, PAT, or provider key is hardcoded in any shipped file
(`scripts/*` read them from the environment, not source). Good.

## Remaining risks / decisions for the owner
- Opening defects/photos RLS to `authenticated` is safe for the current 5-user
  team but must be re-scoped per-org before DefectFlow / external use.
- XSS hardening (S2) is the one change that materially raises the security
  grade; schedule it with a device visual-check rather than shipping blind.
