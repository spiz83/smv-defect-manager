# Reusable prompt — make "change your password" actually work

Paste everything below the line into a fresh session on any project. It is
stack-agnostic: it tells the agent to work out the stack from the repo rather
than assuming one.

The traps in section 2 are the reason this prompt exists. Each one is a way the
feature ships, demos fine, and is still broken for a real user. They were found
the hard way on this project (2026-08-15, `tests/pass.mjs`).

---

## Task: changing a password, working end to end

Make it possible for a signed-in user to change their own password, and for a
user who has forgotten it to get back in. It is done when a real person can go
through the whole process and sign in afterwards with the new password — not
when the button exists.

Fill in what you know; work out the rest from the repo and don't ask me things
the code answers:

- **Stack / auth provider:** <e.g. Next.js + Supabase, Django, Rails + Devise,
  Express + custom JWT, Firebase — or "work it out">
- **How people sign in today:** <email + password, username, SSO, magic link>
- **Who deploys, and may you:** <default: no, propose and stop>

### 0. Establish what exists before you write anything

Do not assume the feature is present and merely broken — "brush up on X" often
turns out to mean X was never built. Search for the password-update call, the
reset/forgot path, the route a reset link returns to, and any UI reaching them.

Report in your first reply which of these exist today:

- change password while signed in
- forgot password / reset (by email or whatever channel this project uses)
- the landing route the reset link comes back to
- an admin or operator path to reset someone else's password

**"There is no such feature" is a finding, not a blocker.** Say it plainly, then
build it. If it all exists and works, the job becomes verification, the traps in
section 2, and the tests in section 3 — say that too, rather than inventing work.

### 1. What it has to do

1. **Ask for the current password, even if the provider doesn't.** Most auth
   SDKs' password-update call needs only a valid session — so without this step,
   an unlocked device is enough for anyone to change the password and lock the
   real user out. Re-authenticate, then update.
2. **A failed re-auth must leave the user exactly where they were.** Getting
   your own password wrong must not sign you out of the app you are already in.
3. **State the password policy on screen**, next to the field, before it is
   typed. Discovering the rule by rejection is not a rule, it is a guessing game.
4. **Confirm the new password twice**, and offer a way to unmask what was typed.
   Someone on a phone, outdoors, in gloves, typing an invisible string twice is
   how lockouts start.
5. **Say what happens to their other devices.** Most providers revoke other
   sessions on a password change. An unexplained login prompt on the tablet an
   hour later reads as a broken app. Then check the *receiving* side: does this
   app handle its own session being revoked gracefully, or does it throw?
6. **Never report success on a failure.** Offline, server error, rate limit —
   each gets a sentence naming what happened and stating that nothing changed. A
   raw network error surfaced to a user reads like it worked.

### 2. The traps

These are the ways this feature ships broken. Handle each, and tell me which
ones applied here.

- **The reset link races the SDK.** If reset links land back in this app, the
  auth SDK may detect the token in the URL, exchange it for a real session, and
  clean the address bar *before your code looks*. Any boot that then asks "is
  there a session?" gets `true` and drops the user into the app with the
  password they came to reset unchanged — no error, no clue, nothing in the
  logs. **Read the URL synchronously at the earliest possible point, and branch
  on it before the session check.** This is the single most likely silent
  failure in the whole job.
- **Requests that were always going to be rejected.** Every refusal the user can
  fix themselves — empty, too short, mismatched confirmation, same as the
  current one — resolves locally, before the network. Auth endpoints rate-limit,
  and spending that allowance on doomed requests is how someone gets locked out
  for an hour.
- **Account enumeration.** The reset reply must be identical whether or not the
  account exists ("if that address has an account…"). But a genuine *send
  failure* must still be reported — "check your email" for an email that was
  never sent is the worst of both.
- **Two identifier rules that disagree.** If sign-in accepts a shorthand
  (bare username expanded to a domain, case folding, trimming), the reset path
  must apply the *same* function. A reset addressed to a bare username goes
  nowhere and cheerfully reports success. Extract the rule; don't retype it.
- **Re-entrancy.** If finishing a reset drops the user into the app, your
  post-login init may now run twice in one page life for the first time ever.
  Audit what it does once — event listeners, wrappers, monkey-patches, timers,
  polling — and make each idempotent. Check the modal can't open twice either.
- **Tokens left in the address bar.** Strip them once used; they persist in
  history and in any screenshot.
- **An expired or already-used link** arrives with an error and no session. Say
  so on arrival rather than presenting a form that fails on submit.
- **Hardcoded credentials you find on the way.** Report them; do not quietly
  delete them. A backdoor login is often load-bearing for someone. If changing a
  password breaks such a shortcut, warn in the UI at the moment of the change.

### 3. What "tested" means here

The test that matters is the round trip: **change the password, sign out, sign
back in with the new one, and prove the old one now fails.** A test double that
only records "the update call was made" proves the button fires. It does not
prove the user can sign in tomorrow — so the double must *store* the password
and let the code under test change it.

Also cover: each refusal in section 1/2 (asserting the server was **not**
called); a server error not reading as success; offline; the reset send and its
failure; the recovery landing; an expired link.

Two rules about the tests themselves:

- **Break the code each check protects and watch it go red before you keep it.**
  A check that passes both with and against the bug is worse than none — it is a
  green light with nothing behind it. Say in your report which checks you
  verified this way.
- **Watch for state your harness silently resets.** Browser-test init scripts
  re-run on every navigation, and signing out usually reloads. Anything the app
  is meant to change must survive that, or "the new password works" passes
  against a build that never changed it.

Use whatever this project already uses for tests, wire the new suite into the
same command CI or the repo runs, and leave it green. If there is no test setup
at all, say so and propose the smallest one that can express the round trip.

### 4. Scope

- Do **not** deploy, publish, or change live configuration. Propose it and stop.
- Do **not** swap the auth provider or add a dependency without asking.
- Anything that must be configured outside the repo — redirect allow-lists,
  SMTP, rate limits, provider dashboard settings — you cannot verify. **List it
  explicitly as unverified**, and say which parts of the feature work without it.
- Commit in working units with real messages.

### 5. Hand back

1. What existed before you started.
2. What you built, and the two or three decisions a reviewer would question.
3. How to run the tests, and which checks you proved can fail.
4. What you did **not** do and why — config outside the repo, anything blocked,
   anything you judged out of scope.
5. Anything you found that is a decision for a human rather than a fix for you.
