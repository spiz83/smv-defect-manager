# Agent Instructions

## Stack (allowed technologies)
- Language/framework: 
- Hosting (if any): Vercel (Hobby) / Supabase (free) / local-only
- Database: 

## Coding style
- [Conventions, naming, formatting, testing expectations.]

## Constraints
- Stay on free tiers. No paid services.
- Keep dependencies minimal.

## Autonomy permissions
FREE REIN:
- Write/edit code, run tests, refactor, commit to git, install standard packages.
- **Deploy a bug fix or a small feature** — merge to `main` and push — provided
  ALL of the following hold. Changed 2026-11-01: the old rule said ask before
  deploying anything, and in practice Spiro was saying "go" every time, which
  made the rule a delay rather than a check.
  1. All four gates green (`./tests/run.sh`, not `quick`).
  2. The change is covered by a test that would fail without it.
  3. The version stamp is bumped in all four places (gate 4 proves this).
  4. After deploying, the live bytes are hashed against the tested tree and
     reported. A deploy is not "done" until that matches.
  Say what shipped and what it changes. Do not batch an unrelated change into
  a fix deploy without saying so.

STOP AND ASK FIRST:
- **Anything touching the database** — a migration, a schema change, an RLS
  policy. The Supabase project is SHARED WITH CH TRACKER; a change here can
  break an app this repo cannot see or test. The defect-list migrations
  (2026-09-30 / 2026-10-15) cost the best part of a week precisely here.
- Adding a new major dependency or changing the core framework.
- Anything that costs money, deletes data, or is hard to reverse.
- Anything that changes who can see what — auth, sharing, visibility scoping.
- A redesign or a change to a workflow people already use day to day, as
  opposed to a fix to one that is broken.

## Development standards
- Write tests for non-trivial logic.
- Commit after each working unit, clear messages.
- Update NEXT_STEPS.md before ending any session.
