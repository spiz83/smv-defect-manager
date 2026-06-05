# DefFixer — Central Database Setup (Supabase)

This gets your phone + desktop sharing **one** central database, with logins.
Follow the steps in order. It takes ~10 minutes. Nothing here deletes your
existing phone data.

---

## STEP 0 — Rescue your phone data FIRST (do not skip)

Your current records live only inside your phone's browser. Get them out now:

1. On your **phone**, open the app at your usual link.
2. Menu → **Export / Backup** → it downloads `DefectTracker_Backup_<date>.json`.
3. Send that file to yourself (email/AirDrop) and save it on this computer.
4. Do **not** tap "Reset" or clear your phone browser until migration is done.

> I (Claude) cannot read your phone directly — this file is the only way your
> real records reach the new database. Once I have it, your data is safe forever.

---

## STEP 1 — Create a free Supabase project

1. Go to https://supabase.com → **Sign in** (GitHub login is easiest).
2. **New project**.
   - Name: `smv-platform` (it will host DefFixer *and* CH Tracker later).
   - Database password: pick one and **save it somewhere safe**.
   - Region: choose the one closest to you (e.g. Sydney for Australia).
3. Wait ~2 minutes for it to finish provisioning.

## STEP 1b — Turn off email confirmation (smoother first login)

By default Supabase emails a confirmation link before a new account can log in.
For this app it's simpler to skip that:

1. Left sidebar → **Authentication** → **Sign In / Providers** (or **Providers**).
2. Open the **Email** provider.
3. Turn **OFF** "Confirm email" (sometimes labelled "Enable email confirmations").
4. **Save**.

Now sign-up logs you straight in — no email step.

> You can re-enable this later if you ever open the app to outside users.

## STEP 2 — Create the database tables

1. In your project: left sidebar → **SQL Editor** → **New query**.
2. Open `supabase/schema.sql` from this repo, copy **everything**, paste it in.
3. Click **Run**. You should see "Success". (Safe to re-run if needed.)

## STEP 3 — Create the photo storage bucket (for Feature #4)

1. Left sidebar → **Storage** → **New bucket**.
2. Name: `defect-photos`. Keep it **Private**. Create.

## STEP 4 — Send me two things

From left sidebar → **Project Settings** → **API**, copy:

1. **Project URL**  (looks like `https://abcdxyz.supabase.co`)
2. **anon / public** API key (the long one labelled `anon` `public`)

> The `anon` key is **safe to put in the website** — it only allows what the
> Row Level Security rules permit. Do **not** send the `service_role` key.

Paste those two values back to me here, and attach (or tell me where you saved)
the `DefectTracker_Backup_<date>.json` from Step 0.

---

## What happens next (once you send those)

1. I wire the app to Supabase: **Sign up / Log in** screen, then live sync —
   the same data on phone and desktop, automatically.
2. I build a **one-click migration**: your phone backup → central database
   (nothing overwritten, nothing deleted).
3. I add the **Open → Pending → Completed** status workflow (Phase 1).
4. Then we move through the rest in phases: themes, photos, AI import,
   reports, comms tracking.

## Why this is "scalable" for CH Tracker

The shared layer (logins + workspaces/teams) is app-agnostic. CH Tracker will
reuse the **same** Supabase project, the **same** logins, and add its own
`ch_*` tables alongside DefFixer's `dm_*` tables — so you can later merge or
cross-reference data between the two apps without rebuilding accounts.
