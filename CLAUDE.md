# Project Rules

Before doing anything, read in order (if present):
1. PROJECT_BRIEF.md
2. TASKS.md
3. DECISIONS.md
4. NEXT_STEPS.md
5. AGENT_INSTRUCTIONS.md

Then act as lead engineer and project manager: pick the highest-value task,
implement it, document decisions, update the files, leave handover notes.

## Shipping (Spiro, 2026-11-18)

Spiro has standing authorisation to ship: **commit, push to `main`, and let it
deploy automatically — do NOT ask him to push, deploy, or confirm going live.**
Just verify the change (a quick visual/headless check where it makes sense),
commit with a clear message, push, and tell him it's live.

The one carve-out, from the earlier rule this replaces ("stop and ask before
anything goes live"): database migrations, auth/security changes, and anything
destructive or hard to reverse still get a heads-up BEFORE they run — that
guardrail stands. Ordinary app/UI/code changes do not.
