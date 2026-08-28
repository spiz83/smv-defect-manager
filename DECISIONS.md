# Decisions Log

Newest at top. Format: date — decision — why — trade-off accepted.## 2026-08-15 (h) — the chips fix, third attempt: the keyboard opens AFTER the focus

- **Reported for the third time**, with a screenshot showing the same sliver of
  chip-tops cut off by the Skip/Save row. Builds `e` and `g` both claimed to
  fix this and both shipped with it still broken.
- **The real cause, finally: an ordering assumption in the FIX, mirrored by
  the same wrong assumption in the TEST.** `bulkComboFilter` called
  `scrollIntoView` at focus time. But on a device the keyboard has not opened
  yet at that moment — the overlay is still full height, everything already
  fits, and the scroll therefore does nothing at all. Only afterwards does
  the keyboard slide in, `_bulkVvSync` shrink the overlay to the visible
  area, and the already-open chip list drop below the fold — with nothing
  scrolling it back.
- **`_bulkVvSync` now re-reveals whatever list is open**, via a shared
  `_bulkRevealOpenList()`. That function is the load-bearing one: it runs on
  every viewport resize, which is exactly when the keyboard appears. The
  focus-time call is kept only for the cases where room is ALREADY tight (a
  short screen, an external keyboard, re-opening the list while the keyboard
  is up), and two timed retries (180ms/420ms) cover browsers that don't fire
  `visualViewport` resize during the animation.
- **Why the test passed twice against a broken app — worth remembering.** It
  shrank the viewport and THEN focused the field. Under that order the
  focus-time scroll has a cramped viewport to work against and behaves
  perfectly; on the device the order is reversed and it never fires usefully.
  A test that gets the sequence backwards is not a weak test, it is a test of
  a different program. The section now forces the real order — full height,
  focus, then shrink — and additionally asserts the reveal is reachable FROM
  `_bulkVvSync`, which is the wiring neither earlier version ever checked.
  Verified by deleting that one call and watching the new check go red.
- **Trade-off accepted:** the two timed retries fire on every list open, even
  when nothing needs moving. `scrollIntoView({block:'nearest'})` on an
  already-visible element is a no-op, so the cost is two cheap calls against
  a fix that has now failed twice for want of them.

## 2026-08-15 (g) — Bulk Import's typed search gets the same trade-first ranking

- **The ask, immediately after (f) shipped for the regular screen:** "Do the
  supplier thing with the bulk add photos mode as well… speed up entries,
  minimal finger clicks strokes." Bulk Import already had the quick-pick
  chips for the EMPTY field, but the moment you typed even one character, the
  chips vanished and the results fell back to a plain `.includes()` substring
  filter with NO ranking and NO trade-tiering at all — a real, pre-existing
  gap this surfaced rather than something newly introduced.
- **Swapped `bulkComboFilter`'s Supplier branch onto the exact same
  `matchesSearch` + `searchRank` + trade-tier logic (f) just gave the regular
  Add Defects screen** — not a re-implementation, the same functions, same
  order of operations. Location's branch (`field === 'loc'`) is untouched;
  the ask was specifically "the supplier thing."
- **Word-prefix matching (`matchesSearch`) replaces plain substring
  (`.includes()`) as a side effect, and that's a real, if minor, behaviour
  change:** typing a MID-WORD fragment (e.g. "osta" for COSTAS) no longer
  matches, where the old substring filter would have found it. Accepted
  because it's not a new risk — it's exactly the standard the regular Add
  Defects screen already operates under, unchanged, today. Bringing Bulk
  Import to the same standard is consistency, not a fresh trade-off.
- **Verified the new check can fail**, not just pass: reverted to the old
  plain-substring filter, re-ran the suite, watched the trade-first order
  assertion go red (`C & E Corp Vic Pty Ltd` sorted ahead of `Carpenter`),
  then restored the fix and confirmed it goes green again.
- **Trade-off accepted:** same open question as (d)/(f) — this only reorders
  `isTradePlaceholder` rows that already exist; it can't create Carpenter/
  Caulker/etc. if they aren't already set up as active contractors.

## 2026-08-15 (f) — trade placeholders sort first in the regular Add Defects screen too

- **The ask, from a screenshot of the 5-block Add Defects screen:** typing "C"
  in a Supplier field listed real company names ("C & E Corp Vic Pty Ltd",
  "G&C Caulking Pty Ltd") with no trades in sight. Wanted: "Carpenter Caulker
  Cleaner to begin with and then as you scroll down the list... supplier
  names" — a trade you already know beats reading company names to find the
  right one, same reasoning as the Bulk Import chips from two builds earlier.
- **This is a DIFFERENT screen and a DIFFERENT mechanism from the Bulk Import
  chips** — no new buttons, no shortcut-that-might-not-match. This screen's
  dropdown items are already real `db.getContractors()` rows the user taps to
  set a real `contractorId` (`state.selectedAddDefectsContractors[i]`); the
  fix only changes the SORT — trade-placeholder rows (`isTradePlaceholder`)
  now sort ahead of ordinary company rows that match the same query, before
  the existing rank-then-alphabetical order decides within each tier.
  Nothing synthetic, nothing that can fail to resolve to something real.
- **Scoped to exactly the function behind this screen**
  (`handleAddDefectsContractorAutocomplete`), not the two other,
  structurally-identical contractor-search functions found alongside it
  (`handleQuickContractorAutocomplete`, `handleContractorAutocomplete` —
  different screens, not what was shown or asked about). Consistency across
  all three is a reasonable future ask; not this one, unasked.
- **The 5-result cap had to go too, or the fix would have made things worse
  in the other direction.** With trades sorting first, a job with several
  matching placeholders could push every real company out of a 5-item list
  entirely — invisible, not just lower — the opposite of "scroll down to
  supplier names," which is what was explicitly described as the expected
  interaction. Raised to 60 (matching Bulk Import's own dropdown cap). The
  CSS (`.autocomplete-dropdown`, `max-height:200px;overflow-y:auto`) already
  scrolled; the code just wasn't giving it enough rows to need to.
- **Depends on the same open data question as the Bulk Import chips:**
  whether Carpenter/Caulker/Cleaner/etc. currently exist as active
  `isTradePlaceholder` contractor rows. This sort change reorders whatever
  already matches — it does not create rows. If none exist yet for a given
  letter, this screen behaves exactly as before for that letter, same
  caveat already sitting in NEXT_STEPS.md.
- **Trade-off accepted:** none beyond what raising the cap costs — a longer
  scrollable list before you're done typing, versus the search narrowing it
  the moment you type past one letter. Matches how this same trade-off was
  already made for Bulk Import's own dropdown.

## 2026-08-15 (e) — the trade chips were only ever a sliver visible

- **The report, same day the chips shipped, with a screenshot:** tap Supplier
  and the chips DID appear — as a thin strip of rounded tops right above
  Skip/Save & Next, immediately cut off. "Make sure they're all visible so
  just as I click on it I can pretty much select from list."
- **Cause: the dropdown opens BELOW the field, inside the same scrollable area
  as the photo and the other field above it.** With a keyboard up, the visible
  room left above Skip/Save & Next is often only a couple hundred px — less
  than collapsed-photo + Location + Supplier's own label/input + the chip
  grid combined. The chips existed and were positioned correctly; there just
  wasn't room left to show them without scrolling, and nothing was scrolling.
- **Fixed with `scrollIntoView`, not hand-computed pixel offsets.** The
  dropdown's containing scroller has real scroll range (confirmed by
  measuring `scrollHeight` directly) — `#bulk-sup-quick.scrollIntoView({block:
  'nearest'})` right after the chips render walks the actual scroll chain and
  scrolls exactly as far as needed, correctly handling however tall the
  keyboard turns out to be on whatever device, rather than a guess baked in
  at build time that would be wrong on some phones and right on others.
- **First attempt at testing this reported a false negative** — not a fix
  that didn't work, a test that didn't run it. `#bulk-sup` was still focused
  from an earlier section; clicking an already-focused element doesn't
  re-fire `onfocus` in a real browser, so `bulkComboFilter` (and the new
  `scrollIntoView` inside it) silently never ran, and the test measured
  leftover state from before the fix existed. Explicit blur, then refocus,
  before measuring — the second time round the same check passed cleanly.
  Two `bulkphoto.mjs` sections have now been bitten by this exact assumption;
  worth remembering as a category, not just fixing case by case.
- **Reproduced the cramped-keyboard geometry deterministically** by setting
  the overlay's own `style.height` to a couple hundred px directly, rather
  than trying to simulate a real iOS keyboard (headless Chromium can't).
  Screenshotted the result at that exact size: all nine chips fully visible,
  photo and Location scrolled out of the way to make room.
- **Trade-off accepted:** none really — this is strictly a fix to the chips
  feature shipped hours earlier, not a new design decision.

## 2026-08-15 (d) — one-tap generic trade chips on Bulk Import's Supplier/Trade field

- **The ask:** "Painter Carpenter Cleaner Caulker Supervisor Plumber electrician
  Brick Cleaner site Cleaner" as one-tap buttons on the Supplier/Trade field,
  for photos that need a trade logged fast, not a specific company searched —
  "not using too much energy on my fingers" — with the explicit expectation
  that these are generic and "can be edited at a later point."
- **A chip is a shortcut for TYPING the word, not a new assignment mechanism.**
  It fills the field with the exact trade name and lets `saveBulkPhoto()`'s
  existing exact-name match against `db.getContractors()` do exactly what it
  already does for hand-typed text: resolve to a real contractor if one
  exists by that name, or save unassigned if not. No new resolution path, no
  new field on the defect — reusing what the app already trusts.
- **Deliberately NOT wired to create new `isTradePlaceholder` contractor
  rows.** Grep found that concept is READ-ONLY from this codebase — Settings'
  "Assignable Trades" only toggles `isActive` on placeholders that already
  exist; nothing here has ever created one. They're seeded from elsewhere
  (CH Tracker / directly in Supabase). Writing a new, never-before-exercised
  path that inserts contractor rows into the shared production database,
  under "deploy now," with no way to verify against the live data from this
  environment, was the wrong kind of risk for this request. If a chip's exact
  name doesn't currently match a live contractor, it saves unassigned —
  same as typing that word and not picking a suggestion does today. Worth
  fixing if any of the nine aren't already set up as trades, but that is a
  data question for Spiro, not a guess to make from here.
- **Exclusive to these nine, in this order — not the full Settings trade
  list.** Asked for explicitly ("keep it exclusive to the following... for
  the moment"). A hardcoded `BULK_QUICK_TRADES` array, not filtered from
  `isTradePlaceholder`, so what's shown matches exactly what was asked for
  regardless of which placeholders happen to be active in the live DB.
- **Chips only show on the EMPTY field**, before typing starts. The instant
  someone types, they're after a specific company and the chips would just
  crowd the results they're now searching for — two modes, cleanly split by
  one condition (`field === 'sup' && !q`) rather than a toggle to tap.
- **Found and fixed a real latent bug on the way, not scope creep:**
  `bulkComboBlur`'s 180ms hide-timer was unconditional and unguarded — every
  blur scheduled an independent one, so a field blurred and refocused faster
  than 180ms apart (a fast real tap between fields is entirely plausible, and
  the test suite hit it immediately) could reopen its dropdown only to have
  a STALE timer from an earlier blur hide it again moments later. Intermittent
  by nature — never fails the same way twice, which is exactly why it hadn't
  been caught. `bulkComboFilter`/`bulkComboBlur` now debounce through one
  shared per-field timer instead of stacking. Confirmed by reverting the fix
  and watching the same test hang the same way, then restoring it.
- **Trade-off accepted:** unmatched trades still silently discard the typed
  word on save (the pre-existing gap this exposed, not introduced by this
  change) — a defect saved via an unmatched chip is indistinguishable from
  a defect saved with the Supplier/Trade field left blank. Preserving that
  text through an unassigned save would need a new field flowing through
  `db.addDefect`, cloud sync's diff/push logic, and a matching Supabase
  column — the exact shape of change this codebase's own history (the
  `order_status` incident) says needs a migration first, not something to
  improvise under a same-turn deploy. Flagged in NEXT_STEPS, not fixed here.

## 2026-08-15 (c) — Bulk Import stops jumping around while typing

- **The report, from four screenshots of the real screen:** tagging photos
  in Bulk Import (Location / Supplier / Trade / Defect description, one photo
  at a time) was "jumpy every time I press a field" — the header vanished,
  the photo cropped to a sliver, described as wanting "everything stays in
  the same spot and I'm just punching text."
- **Three separate mechanisms, not one bug.** An unsolicited auto-focus on
  every photo (removed), content too tall to fit above an open keyboard so
  the browser had to scroll different amounts for different fields (fixed by
  shrinking the photo to a thumbnail while typing), and `position:fixed`
  clipping under iOS's keyboard-open viewport mismatch (fixed by tracking
  `visualViewport`). Full mechanism-by-mechanism writeup in NEXT_STEPS.md.
- **The auto-focus is gone, not delayed or made smarter.** It bought nothing:
  the supervisor still has to tap Location and Supplier regardless (both
  need picking from a list), so auto-focusing Description only guaranteed one
  unwanted jump per photo before anyone had looked at the image. Removing it
  outright was the whole fix for that mechanism — no replacement heuristic.
- **The photo shrinks to a thumbnail on focus, not full removal.** Confirms
  which photo you're tagging without needing full size while a keyboard is up
  — an outright hide-on-focus would have meant re-checking the photo requires
  closing the keyboard first, worse than a small persistent thumbnail.
- **72px, not 0.** Small enough that photo + all three fields fit above a
  keyboard on the phones in the screenshots; large enough to still read as
  "here's the photo," not just a coloured strip.
- **The 120ms blur grace period exists because tapping between two of the
  three fields fires blur-then-focus in the same tick.** Without it, moving
  from Location straight to Supplier would flash the photo back to full size
  for one frame between the two — trading one kind of jump for another.
- **This cannot be confirmed fixed from this environment.** Headless Chromium
  never opens a real software keyboard or shrinks the visual viewport, so
  nothing here can observe the actual on-device jumpiness the report
  describes — only the mechanisms installed to prevent it. Say so plainly
  rather than claiming victory on the strength of automated checks alone;
  `tests/bulkphoto.mjs` proves the mechanisms, not the feel. Needs a supervisor
  on an actual phone before this is genuinely closed.
- **Trade-off accepted:** on a screen tall enough that everything already fit
  above the keyboard without scrolling, this changes nothing visible except
  the photo now shrinking briefly while a field is focused — a cosmetic
  change for those users in exchange for fixing it on the phones that were
  actually jumping.

## 2026-08-15 (b) — change it from the sign-in screen too

- **Decision:** "Change password · Forgot it?" under Sign in. The first opens the
  same card in a third mode: email + current + new + confirm, with no session
  needed. Asked for directly ("ability to change password inside the log in").
- **Why it is worth a third entrance:** the other two both assume you got in.
  A supervisor who thinks their password has been seen — shoulder-surfed on
  site, typed into a shared phone — wants it changed *before* it is used again,
  not after signing in with it. And with SMTP unconfigured (see NEXT_STEPS) the
  reset email is best-effort, so this is the only self-service route that works
  today for someone who knows their password and simply wants a different one.
- **The current password is still mandatory here, and that is the whole
  security argument.** This screen sits in front of the app with no session
  behind it, so if it took only an email and a new password it would be a
  complete authentication bypass — a way in, not a way to change something.
  It signs in with the old password first and only then updates; that sign-in
  IS the proof. `tests/pass.mjs` fires a real email with a wrong password at it
  and asserts nothing changed and the app did not open.
- **One error message for a wrong email and a wrong password.** Supabase returns
  the same error for both, and so do we: "That email and current password do not
  match an account." Splitting them would turn this screen into an account
  checker for anyone with the URL — the same reasoning as the reset reply.
- **It opens the app afterwards instead of bouncing back to Sign in.** They
  authenticated on the way through; sending them back to type the password they
  set ten seconds ago is a step with no purpose. `enterApp()` does the login
  screen's own housekeeping (honour "Keep me signed in", clear the overlay) and
  hands off to `onAuthed()` — the same helper the reset link now uses.
- **The `qwqw` shortcut works on this card too.** Not supporting it would make
  the one account reachable *only* by the shortcut the one account whose
  password can never be changed. It is not a new exposure — anyone who knows
  `qwqw/qwqw` can already sign in and use Settings. Expanding the alias here
  also means "same as your current password" compares against the real one.
  The amber warning now watches the email field and appears as you type it.
- **Trade-off accepted:** three entrances to one screen is more surface than a
  settings page alone. They collapse to one function with three modes and one
  test suite, and each covers a state the others cannot reach — signed in, at
  the door, and locked out.

## 2026-08-15 — you can change your password

- **The finding first: there was no way to change a password.** Not a broken
  one — none. `cloud-sync.js` had `signInWithPassword`, `signUp` and `signOut`,
  and nothing else. Three places in the file already carried comments reasoning
  about what happens "e.g. password changed", so the consequences of a change
  had been thought about; the change itself was never built. A supervisor whose
  password leaked, or who forgot it, had exactly one option: ask Spiro to run
  `scripts/setup-manager.mjs` against the Management API.
- **Decision:** two entrances, one screen. 🔑 in the status bar next to Sign
  out, and a "Your login" card in Settings. Both open the same card.
  Current / new / confirm, one "Show passwords" checkbox for all three.

- **It asks for the current password, and Supabase does not.**
  `auth.updateUser({ password })` needs only a live session. Left at that, an
  unlocked phone on a site table is enough for anyone to change a supervisor's
  password and lock them out of their own jobs. So the card re-authenticates
  with `signInWithPassword` first and only then calls `updateUser`. A failed
  re-auth leaves the existing session alone — `tests/pass.mjs` checks you are
  still in the app after getting it wrong, because a "verify" step that signs
  you out on a typo is worse than none.
- **Eight characters, checked here, not six from the server.** Supabase's
  default floor is 6. These logins reach every job on every site; 8 is the
  floor this app enforces and says out loud under the field.
- **Nothing that will be rejected is sent.** All five refusals — no current
  password, wrong current password, under 8, mismatched confirmation, same as
  the one you have — resolve before the network. Auth endpoints rate-limit, and
  the way to get locked out for an hour is to spend the allowance on requests
  that were never going to succeed. The suite asserts `updateUser` was called
  zero times across all five.
- **Offline is refused with a sentence, not a fetch error.** A password change
  is a server round-trip and nothing else — there is no outbox for it and there
  should not be. "You are offline… Nothing was changed" is the whole story.
- **The success message says the other devices will ask again.** Supabase keeps
  the session that made the change and revokes the rest. The iPad in the ute
  asking for a login an hour later is correct behaviour, and unexplained it
  reads as a broken app. `boot()` already handled the receiving end of this
  (`SESSION_EXPIRED` → clear → login) — that path was written for exactly this
  event and had never had an event to receive.

- **Forgot password reads the URL before supabase-js eats it.** This is the one
  that would have silently done nothing. `detectSessionInUrl` is on by default:
  by the time our code looks, the recovery token in the fragment has been
  exchanged for a real session and the address bar rewritten. A `boot()` that
  only asks "is there a session?" therefore drops the user straight into the
  app with the password they came to reset unchanged — no error, no clue. So
  the fragment is read **synchronously, immediately after `createClient`**, and
  `boot()` branches on that before it looks at the session at all. The
  `PASSWORD_RECOVERY` listener is a second belt, not the mechanism.
- **The reset reply is the same whether the account exists or not.** "If
  <address> has an account, a reset link is on its way." An "unknown email"
  reply tells a stranger which company logins are real. A *send failure* is
  still reported, though — "check your email" for an email that was never sent
  is the worst of both.
- **The username shorthand had to be shared, not re-typed.** Sign-in expands
  `ischroeder` to `ischroeder@creationhomes.com.au`. That rule now lives in
  `normaliseEmail()` and the reset path calls it, because a reset addressed to
  a bare username goes nowhere and reports success.
- **Tokens are wiped from the address bar** with `history.replaceState` once
  used — they otherwise sit in history and in any screenshot of the phone.

- **`installSaveHook()` gained an idempotency guard.** Finishing a reset opens
  the app through `onAuthed()`, which is now reachable twice in one page life.
  It wraps `db.save`, and a second wrapper repeats the push half of every later
  edit. `installDirectWriteHooks` already had this guard; `installSaveHook`
  did not.
- **Changing the manager's password kills the `qwqw` shortcut, and the card
  says so.** `qwqw/qwqw` is a literal pair in `cloud-sync.js` pointing at
  `svladimiroski@hotmail.com`. Change that account's password and the shortcut
  breaks with no explanation. The three copies of those literals were collapsed
  into `ALIAS_USER` / `ALIAS_EMAIL` / `ALIAS_PASS` so they cannot drift, and the
  card warns when that account is the one signed in. **The alias itself is left
  alone**: it is a deliberate feature, Spiro uses it, and removing it uninvited
  would take away a login. It does mean a working manager password ships in
  client-side source — flagged in NEXT_STEPS as a decision for Spiro, not one
  to make on his behalf.
- **Trade-off accepted:** the re-authentication doubles the round trips of a
  password change, and a supervisor on bad signal feels it. Worth it — the
  alternative is a change that needs no proof of who is holding the phone.
- **Trade-off accepted:** the reset-email half depends on two Supabase dashboard
  settings this repo cannot set (redirect allow-list, SMTP). The in-app change,
  which is what was asked for, depends on neither and works today.

## 2026-08-12 (d) — the location label, second pass: quiet and lower case

- **Decision:** `BPI #3 (p.3) - kit: Seal gaps to flooring at dishwasher
  opening`. Lower-case code, normal weight, a plain hyphen after the reference
  and a COLON after the location. Spiro on seeing (c) live: *"the way the
  location is shown bothers me, needs to be less obtrusive, more natural — lower
  case, not bold, the — not wide, maybe do one - instead, and look like this
  kit:"*
- **What was wrong with bold upper case:** it read as a warning label, not as a
  note about which room, and on a screen of twenty defects every row shouted.
  Colour alone already does the finding — weight and case on top of it were
  three signals for one job.
- **Why a colon and not a third dash:** an em dash is wide, and three of them
  broke a defect into a list of fragments rather than a sentence. A colon makes
  the code read as what it is, a label on the sentence that follows.
- **Master Bedroom is `b1`, not its own code.** Asked for by name ("master bed
  is to be B1"), and right: on an Australian project-home plan the master
  bedroom IS bedroom 1. It had its own `MBR`, which put two names for one room
  on one job's list. **This is the only deliberate collision in the table** and
  it is declared in `LOCATION_ABBR_SHARED`, which `tests/loc.mjs` reads — so
  widening it is an act with a reason attached, not a quiet test edit. Bedrooms
  2–5 are unaffected, and Living/Lounge still keep separate codes.
- **Lower case is in the DATA, not a CSS `text-transform`.** What is in the DOM
  is what is on the glass, so a copy, a test and a screenshot all agree.
- **Unchanged: every text output.** The email, clipboard, export and PDF still
  write the location out in FULL and still use the em dash. Those go to trades,
  who have not learnt these codes and have no width limit.
- **Trade-off accepted:** lower case is fractionally less findable than upper.
  That is the point — it was too findable, at the cost of every row looking
  urgent.

## 2026-08-12 (c) — 📋 copy the address off the job header too

- **Decision:** the frozen View Defects header carries the same 📋, at the end
  of the address line. Same `copyAddressToClipboard()`, same string.
- **Why NOT in the toolbar:** the toolbar already has a 📋 and it copies the
  DEFECT LIST. Two clipboards on one screen only works if each sits on the
  thing it copies — this one rides on the address, and the list one keeps its
  place among the list controls (its tooltip now says which is which). The
  toolbar is also full: eight icons pinned to one row by the 2026-08-02 rework,
  and a ninth is how that row wraps and eats the frozen header again.
- **Why it can't shrink:** `.lot-copy` is `flex: 0 0 auto` with its own
  font-size, so `fitLotTitle()`'s font stepping shrinks the address TEXT and
  never the tap target, and the address gives up width to it the same way it
  already does to the job number. The job number still never yields.
- **`stopPropagation` is load-bearing:** the whole `.lot-title` is a tap target
  for Add Defects, so without it, copying the address opens the entry screen.
  Pinned in `tests/addrcopy.mjs`.

## 2026-08-12 (b) — 📋 copy the whole address off a search row

- **Decision:** an address row in the top search gets a 📋 before 👁️ ✚. It
  copies `formatAddress()` — `Lot 1023, Coollegrean Road, Wollert - 306725`.
  Asked for with the spot circled on a screenshot.
- **Why the string is `formatAddress()` and not a new one:** that is already the
  address on every screen heading, every report and every supplier email. A
  second format would mean the thing pasted into a text message didn't match the
  thing on screen, which is how a job number ends up one digit out. The search
  row shows the address split over two lines because that reads fastest when
  picking a job; the joined-up form is what gets sent to people.
- **Address rows only.** A contractor or trade row has no address to copy, so it
  keeps two icons and one respectively — pinned in `tests/addrcopy.mjs`.
- **Trade-off accepted:** three 40px icons on a 390px row push the street line
  into its ellipsis sooner — `Lot 1023, Coollegrea…`. The lot number leads and
  the suburb and job number sit on the second line, so everything that
  identifies a job is still fully visible; it is the tail of the street name
  that goes. `tests/addrcopy.mjs` measures the geometry (nothing off the right
  edge, no wrap, ≥150px left for the text) because this app has twice shipped a
  row that pushed its leftmost control out of reach.

## 2026-08-12 — the location leads the defect line

- **Decision:** every defect row now reads **`BPI #18 (p.7) — GAR INT PA —
  Seal gap between garage boundary wall flashing and brick`**: report
  reference, then location, then the item. Spiro's words, 2026-08-12: *"when
  I'm viewing items it doesn't actually tell me where that location of it is,
  so I have to go back into the BPI reports to find out."*
- **The location was never missing — it was one tap deep.** The BPI import has
  captured a location per item since 2026-06-09 and it sat behind the 📍
  button. Going through a job meant tapping every row, or re-opening the report
  PDF. The data was right there; the row just didn't say it.
- **Order is ref → location → item**, matching `formatDefectEmailLine`, which
  already read that way for the supplier email. That was the tie-breaker for
  where the location goes: what the supervisor reads on the phone is now
  literally the line the trade receives.
- **On screen the location is a CODE; in text it is written out in full.**
  `Garage Internal PA Door — ` in front of a three-line description costs a
  whole line of a phone row on every item, which is the same problem as making
  them tap. `LOCATION_ABBR` (in `index.html`, beside `DEFECT_LOCATIONS`) is the
  floor-plan shorthand a supervisor has been reading all day: `BTH`, `B4`,
  `ENS`, `LDRY`, `KIT`, `LIV`, `WIR`, `MBR`, `GAR INT PA`. Spiro's words,
  2026-08-12: *"bathroom would read BTH, bedroom four would read B4, ensuite
  would read ENS, laundry LDRY, kitchen KIT, living room or lounge LIV, and so
  on."* Emails, the clipboard and the PDF have no width limit and keep the full
  wording.
- **Shortened words were the first attempt and were wrong.** `Master Bed`,
  `Garage Int PA`, `Bath` — readable, but they still ate most of the width the
  location was supposed to save, and half a word reads as a typo rather than as
  a label. A code is a different kind of thing from the sentence beside it,
  which is exactly what makes it scannable.
- **Every one of the 48 picker locations has a code, and no two share one.**
  A location with no entry would fall through to the generic fallback and
  render sentence-case in a screen full of codes. A shared code is worse: Spiro
  named `LIV` for both Living and Lounge, but they are separate rooms in
  `DEFECT_LOCATIONS`, so Lounge got `LNG` — a plan with both would otherwise
  send a trade to whichever room it found first. `tests/loc.mjs` asserts both
  properties, so adding a location to the picker without a code fails the gate.
- **Free-typed locations become codes too.** The review screen accepts a custom
  location, so the table can't be the whole answer: `LOCATION_WORD_ABBR` is a
  word-level fallback (`Bedroom 6 → B6`, `Store Cupboard → STORE CPD`) and the
  result is upper-cased so it matches the table's style. Lookup is case- and
  whitespace-insensitive, so `walk in robe` lands on `WIR`.
- **The code carries the full room name as a `title`.** Press and hold the row,
  or hover on a desktop, and `GAR INT PA` says `Garage Internal PA Door` — so a
  code nobody has learnt yet is never a dead end, without opening the picker.
- **This is a DISPLAY change. The saved description is untouched.** It still
  starts with the bare `BPI #N (p.P) — ` reference and nothing else. Everything
  load-bearing keys off that stored text — the duplicate guard on re-import,
  `matchCompleted`, trade learning, `REPORT_REF_RE`. Baking the location into
  the description would have doubled every item the next time its report was
  imported. `defectLineHtml()` composes the line at render time from
  `description` + `location`; `tests/loc.mjs` asserts the stored text is
  unchanged so nobody "simplifies" it into the database later.
- **Class named `.defect-line-loc`, not `.defect-loc`.** `.defect-loc` already
  exists further down the stylesheet as a location-dropdown pill with its own
  background, `max-width: 104px` and an ellipsis. The first version of this
  reused the name and the pill silently ate the span — it rendered grey and
  clipped instead of blue and whole. In one 11,000-line file, check the name
  before you take it.
- **Trade-off accepted:** a code is not the report's wording. A supervisor
  cross-checking a row against the BPI page sees `GAR INT PA` where the PDF says
  `Garage Internal PA Door`, and a code has to be learnt once. Judged worth it —
  these are the abbreviations already on the plans, the long-press title, the 📍
  button, the preview card and every text output all still carry the full name,
  and the alternative was a location nobody reads because it costs a line.

## 2026-08-07 — every PDF is named after what is in it

- **Decision:** one filename shape for every generated report, from every
  screen: **`<Who>_<dd.mm>_Items.pdf`** — `Bayhill_12.06_Items.pdf`. `<Who>` is
  resolved in the order a supervisor would say it out loud: the single supplier
  the report is for, else the trade, else the job (`1933Lahar` — lot + street,
  street type dropped), else what it spans (`3Jobs`, `2Suppliers`, `All`).
  Spiro's words, 2026-08-07: *"abbreviated name of contractor or trade followed
  by the date (only dd/mm) + items"*.
- **The actual bug was not in the namer.** `buildReportFilename` already
  produced something readable and `CloudShare.uploadTempPdf` **threw it away**,
  uploading to a flat 12-character random key. Every report that is *opened*
  rather than downloaded goes through that upload — the 📑 on a supplier inside
  a job, every report on iOS, both email links — so what a trade actually tapped
  and what their phone saved was `k3j9x2m1abcd.pdf`. The last segment of a URL
  path is what names a download; that segment was the gibberish.
- **Fix:** the object path is now `<random>/<report name>.pdf`. The random
  folder keeps the link unguessable; the last segment carries the real name.
  **Do not flatten it back, and do not drop the random folder either** — a clean
  name alone is guessable AND collides, and `upsert: true` would hand one
  supervisor's trade another supervisor's defect list. `go.html` accepts the
  foldered form (and still accepts flat keys, so links already sitting in a
  trade's inbox keep working) and refuses any segment that could climb out.
- **Why dd.mm and no year:** asked for. A defect list is a this-week document —
  a supplier reading `12.06` knows exactly which visit it was. The year was
  noise in a name that has to be recognisable at a glance on a phone.
- **Why the trade name is threaded down as `opts.tradeName`:** a trade report is
  scoped by the trade's SET of contractors (see 2026-08-02 — trade links are
  blank on many subs), so by the time the file is named there is no trade in the
  opts at all and it would have come out `5Suppliers`. An explicitly TICKED
  trade still wins over the screen it was opened from — the file has to say
  what is in it, not where it started.
- **Abbreviation rule:** take words from the front until there are at least two
  characters. `BAYHILL PLUMBING PTY LTD` → `Bayhill`; `Downeys Group Aust (VIC)
  P/L T/A DGA Roofing` → `Downeys`; `H & K Painting` → `HK`, not `H`. Accents
  are folded first (NFD) or `Bäyhill` fragments into `BYhill`.
- **Trade-off accepted:** a supplier report scoped to ONE job is named after the
  supplier only, so a supervisor generating the same supplier's list for three
  jobs on one day gets three files with the same name (`(1)`, `(2)` in
  Downloads). That is the format as asked for, and the common case — the
  supplier email — is one job at a time. Adding the job would read
  `Bayhill_1933Lahar_12.06_Items.pdf` if that turns out to matter on site.
- **Covered by** `tests/pdfname.mjs`: the name out of every screen, the name
  surviving the real `cloud-sync.js` upload, the sanitiser against hostile
  input, and `go.html` accepting the new form while refusing traversal.

## 2026-08-04 (b) — a trade report says what it is leaving out
- **Decision:** `runContextReport` now compares the trade-filtered list against
  the same scope with the trade filter removed. Any defect the filter could say
  **nothing** about — no supplier at all, or a supplier carrying no trade links —
  is named in a confirm, by supplier, with the option to include it. A sub linked
  to a DIFFERENT trade is still excluded, silently and on purpose.
- **Why:** reported as "I exported a Plumber report and a waterhammer item
  against COSTAS PLUMBING wasn't in it". A trade filter resolves a defect's trade
  through `dm_contractor_trades`, and plenty of real subs have no row there — the
  sync hands them `tradeIds: []` / `trades: 'No Trade Assigned'`. Their defects
  were dropped with nothing said. Worse, when they were the ONLY defects in
  scope, the dialog claimed **"No defects match those filters"** about defects
  that plainly did match — the most misleading message in the app.
- **Why not include them automatically:** a report asked for Plumber must not
  quietly fill with the painter's work. `tests/tradefilter.mjs` pins that
  direction too: answering yes adds the two unlinked COSTAS items and still
  leaves AUZ PAINTING's item out.
- **Why not infer the trade from the supplier's name:** "COSTAS PLUMBING"
  obviously reads as a plumber to a human, and that is exactly the kind of guess
  that puts the wrong sub's work in a report sent to a builder. The missing trade
  link is a data condition; the app's job is to make it visible, not to guess
  around it.
- **Trade-off accepted:** a job carrying unlinked suppliers now prompts on every
  trade report until those links are set. That is the point — it is one tap, and
  it is the only signal the supervisor gets that the report is incomplete.
- **Blast radius:** the block only runs when a PARTIAL trade selection is ticked
  (`o.tradeIds` non-null). All trades ticked, or Contractor mode, is unchanged —
  covered by cases D and E in the suite.
## 2026-08-04 (c) — ✏️ Reassign all on the TRADE view's supplier groups
- **Decision:** each supplier group in the trade view gets the same ✏️ button the
  job view has, calling the existing `openReassignGroup(contractorId, addressId)`.
  No new machinery — that function already works off (address, contractor) and was
  simply unreachable from this screen.
- **Why:** a BPI import files items against the TRADE PLACEHOLDER ("PLUMBER") when
  it can't name the sub, so the Plumber trade view shows two groups on one job —
  COSTAS PLUMBING and PLUMBER — and the items under the placeholder never appear
  in a report scoped to Costas. The supervisor could see exactly what needed
  moving and had no way to move it: the group header on this screen was a bare
  name with no actions.
- **Also:** the toast now says "— no longer on the <trade> list" when the new
  supplier doesn't carry the trade being viewed. Reassigning from a trade screen
  can move items off the very list you are looking at, and they vanish on the
  re-render; unexplained, that reads as the move having failed.
- **Trade-off accepted:** reassign-all moves ACTIVE defects only (`db.getDefects`
  excludes completed) — unchanged from the job view, where the same button has
  behaved this way since 2026-07-11. Completed items stay with the old supplier.
- **Blast radius:** one group header gained a button; the shared reassign dialog
  is untouched apart from the extra toast clause. `tests/tradereassign.mjs` drives
  the real screen: the button renders on every group, the move is scoped to ONE
  job (a second job's placeholder items are untouched), the waterhammer item
  reaches a COSTAS PLUMBING report afterwards, and the off-trade move is flagged.

## 2026-08-04 — a re-raised defect RE-OPENS its completed row instead of vanishing
- **Decision:** when `commitDefect` hits the unique index on
  `(job_id, description, contractor_id)` (23505) and the row it collides with is
  `completed` while the local defect is not, the adopt-on-conflict branch now
  **re-opens that row** before claiming it. If the re-open write fails the defect
  is queued in the outbox rather than adopted.
- **Why:** reported as "I add 5 items and only 2 show in the report", and it is
  real — `tests/recur.mjs` reproduces it exactly (5 raised, 2 left after one
  background pull). Two rules that are each correct disagree: `db.addDefect()`
  deliberately does NOT match completed defects, because a closed item genuinely
  can recur and must be re-raisable; the database index has no status column, so
  the re-raise collides with the old completed row. Adopting alone threw the
  raise away — the pull rebuilds `db.data` keyed by the CLOUD row's legacy_id, so
  the newly raised defect had no row of its own and disappeared, while the old
  completed row came back in its place. The supervisor saw
  "✓ 5 defect(s) added successfully" and then two items.
- **Why re-open rather than loosen the local guard:** the index permits exactly
  one row per (job, description, supplier), so the colliding row IS the defect —
  there is nowhere else for the raise to go. Re-opening is also what the
  report-import path already does when it re-reads a line that had been completed,
  so this is one resolution rule, not two. Making the local guard match completed
  rows would break re-raising by design and still miss every collision the phone
  can't see (another supervisor's row, a hidden job, a CH Tracker row).
- **Trade-off accepted:** a recurrence re-uses the original row, so it keeps that
  row's id and creation date rather than getting a fresh one — the item's history
  is one row with two lives, not two rows. Worth it: the alternative is silent
  data loss, and the index makes a second row impossible anyway.
- **Blast radius:** one branch that previously only ran on a 23505, which cannot
  fire at all on a database without the index (control case in `tests/recur.mjs`
  covers that). All 12 suites green.

## 2026-08-02 — 📑 on the trade view, scoped by CONTRACTOR not by trade links
- **Decision:** the trade view (and the multiple-contractors view, which had the
  same gap) get a Generate PDF Report button. `generateContextReport` now takes
  `{ contractorIds, label }` — the exact contractor list the screen behind it is
  rendering.
- **Why scoped that way:** the obvious implementation is `tradeIds: [thisTrade]`,
  and it would be wrong. `reportFilteredDefects` resolves a trade filter through
  each contractor's trade LINKS, and plenty of real subs have none — they show on
  the trade screen (which is scoped by a resolved contractor list) but a trade
  filter drops them silently. Passing the contractor list straight through is the
  only version where the PDF contains exactly what the supervisor is looking at.
  The test fixture pins this: BALCA PLUMBING has no `tradeIds` and must still
  appear.
- **The dialog opens on those subs** — Contractor mode, the trade's subs
  pre-ticked, plus the per-job picker that until now only appeared for a single
  contractor. So "generate" straight away gives you the screen you came from, and
  everything is still narrowable by job, sub and status.
- **Two bugs found while building it, both worth remembering:**
  - `_crMode = 'contractor'` set the variable but not the screen — the markup
    hard-codes Trade as the selected tab. `crSetFilterMode()` now runs after the
    overlay is built. State that only exists in a variable isn't state.
  - `JSON.stringify(tradeName)` inside a double-quoted `onclick` emitted its own
    double quotes and terminated the attribute early, so the button did nothing
    at all. Added `jsAttr()` — **use it for any value interpolated into an on\*
    handler.** The trade name is user data; this is the same class of bug as an
    unescaped `"` in a supplier name.

## 2026-08-02 — "Save changes does nothing" — a ReferenceError I shipped
- **Report:** Edit defect → Save changes did nothing. Modal stayed open.
- **Cause, and it was mine.** The report-reference refactor earlier the same day
  (`REPORT_REF_RE` / `stripReportRef`) replaced a local `const clean = …` in
  `openDefectEdit` and **deleted the declaration while three later calls to it
  survived**. `clean` resolves to nothing in that scope, so the click threw
  `ReferenceError: clean is not defined`.
- **Why it looked like "nothing happens" rather than an error:** the throw
  landed AFTER `db.updateDefect()` but BEFORE `impClose()` / `render()`. The
  edit was written to the database; the screen just never moved. Worse than a
  clean failure — it looked broken while quietly half-working.
- **Why nothing caught it:** the throw is inside `if (newC && isRealSub(newC))`,
  so it only fires when a REAL subcontractor is attached — which is the normal
  case on site and the rare case in a test fixture. Nine browser suites, all
  green, none of them clicked that button.
- **The general lesson:** a syntax check (`new Function(body)`) proves the file
  PARSES. It says nothing about whether an identifier resolves at runtime. A
  single-file app with one 8,000-line script and no module boundaries has no
  other backstop — deleting a helper is invisible until someone taps the button.
- **What now catches it:** `undef.mjs` in the scratchpad runs ESLint's `no-undef`
  across the inline script and `cloud-sync.js`, forgiving cross-block
  declarations and the known browser/CDN globals. Verified it reports exactly
  these three lines when the bug is reintroduced. **This belongs in the repo**
  — see NEXT_STEPS.

## 2026-08-02 — The supplier combo: rank the matches, and show more than two
- **Report:** typing "Har" in Reassign all still meant scrolling past a heap of
  contractors to reach HAR Painters, and only two or three were visible at once.
- **Bug 1 — the ordering, not the filter.** `.rv-combo-list` pickers (Reassign
  all, Edit defect, BPI review) used a bare `label.includes(query)` and then
  sorted the survivors **A-Z**. "Har" therefore matched every name or trade
  containing those three letters anywhere — Bharat, Charlie, Ace Hardware,
  Maharaj — and alphabetical order dropped HAR Painters into the middle of its
  own result list. Note this is a DIFFERENT code path from the autocompletes
  fixed earlier the same day; that fix never reached these.
- **Decision:** `comboItems()` ranks. Word-prefix hits first (rank 0-2, via the
  shared `matchesSearch`/`searchRank`), then plain substring hits (rank 4), A-Z
  within each band. Substring matches are KEPT rather than dropped — anything
  findable before stays findable, it just sorts below the thing you meant.
- **Bug 2 — the modal was clipping the list.** `.rv-combo-list` is absolutely
  positioned inside `#imp-body`, and `#imp-card` is `overflow:hidden` sized to
  its content. On a short dialog the list had nowhere to go, so raising its
  `max-height` alone would have changed nothing.
- **Decision:** `#imp-body.combo-open` reserves `min(440px, 56vh)` underneath
  while any list is open, toggled by `syncComboRoom()`; the list itself goes
  240px → `min(420px, 52vh)`. Nine rows visible instead of two.
- **Trade-off:** the modal grows while the list is open and the body scrolls.
  Better than a two-row window into a list of forty — choosing between similar
  supplier names is exactly what you can't do two at a time.

## 2026-08-02 — Preview cards page through every photo, and can take a new one
- **Decision:** a preview card now shows **all** of a defect's photos, not just
  the first: a `1/3` counter in the photo's top-right corner, `‹` / `›` arrows
  down each side, and a `📷` in the action row that opens the camera or the
  gallery (`accept="image/*"` is what gives iOS the Camera / Photo Library /
  Files sheet, so one control covers both).
- **Why:** an item routinely needs three or four shots — the defect, the
  context, the fix — and preview mode showed one with no way to add another
  without leaving the screen. Preview is where you're standing in front of the
  thing, so it's the natural place to photograph it.
- **How it stays cheap:** `CloudPhotos.thumbsAll()` returns every photo for many
  defects in the same **two** round trips `thumbs()` used for one each — one
  select, one batch signing call. Paging swaps the `<img>` src and the counter
  and touches nothing else, so it never re-renders the list or moves your place
  in a long job.
- **Arrows wrap at both ends.** With three or four photos, hunting for the arrow
  that isn't greyed out is worse than just looping.
- **A photo taken with no signal appears immediately** — pending (not yet
  uploaded) blobs are appended to the card's set from
  `CloudPhotos.pendingPhotos`, so it can never look like it didn't save. The
  object URLs are revoked on the next fill.
- **Trade-off — the action row now wraps on a phone.** Four icons plus MARK DONE
  don't fit one line at 390px, so MARK DONE takes the full width and the icons
  sit beneath it. That's the better layout anyway: the primary action gets the
  whole width and every target grows. The `.pv-minis` wrapper keeps the four
  together, or they break mid-set.
- **Trade-off — a card with no photo still shows no photo box.** Adding the
  first one inserts the box in place rather than re-rendering, so an empty card
  stays clean and you keep your scroll position either way.

## 2026-08-02 — Preview shows the WHOLE photo, never a crop
- **Decision:** `.pv-photo` drops its fixed `aspect-ratio: 4/3`, and the image
  goes from `object-fit: cover` to `width:100%; height:auto; max-height:60vh;
  object-fit:contain`. The photo keeps its own shape at full card width;
  anything taller than the bound is letterboxed, not cut.
- **Why:** site photos are taken on a phone held upright, so nearly all of them
  are PORTRAIT — and `cover` in a landscape box slices off the top and bottom,
  which is where the defect usually is. Spiro's example: "Seal top of door" had
  the top of the door cropped out of the card. Preview mode exists so you can
  identify the item from the photo while walking the house; a crop defeats the
  single thing it's for.
- **Trade-off:** cards are no longer a uniform height, and a portrait photo
  makes a taller card. That's the right way round — a consistent grid is worth
  nothing if the picture doesn't show the defect. `max-height: 60vh` stops one
  card eating a screen and a half, and the `loading photo…` placeholder keeps
  ~140px so the list doesn't jump under your thumb when a batch lands.
- **Test note worth keeping:** the first version of the pixel check redrew the
  `<img>` into a canvas and sampled that. It passed against the BROKEN build —
  `drawImage` redraws the source and ignores the CSS crop entirely. The check
  only means something when it samples an actual screenshot of the rendered
  element. Verified both ways: with the old CSS the top and bottom bands sample
  as background grey.

## 2026-08-02 — Preview's MARK DONE confirms, like the status tab does
- **Decision:** `pvToggleDone` asks "Mark this item as completed? It will be
  removed from the active list." before completing — the same wording the list
  view's status tab has always used. Un-completing stays instant; that's the
  undo.
- **Why:** Spiro, from site. It was the only route to `completed` in the app
  with no confirmation, and the easiest one to hit by accident: preview is
  walked one-handed at arm's length and MARK DONE is the biggest target on the
  card. The item then drops off the list on the next render, so a mis-tap reads
  as "it vanished" with nothing to undo from.
- **Trade-off:** a tap more per item when working through a job in preview. Both
  modes now cost the same, and the list mode has carried that prompt for months
  without complaint.

## 2026-08-02 — Search: every word you type, not the whole phrase
- **Decision:** one matcher (`matchesSearch` / `searchRank`) behind every search
  box. **Each word you type must prefix-match some word in the target, in any
  order**, across a haystack that includes the supplier's TRADE as well as the
  name. Splitting on non-alphanumerics, so `&`, hyphens and double spaces stop
  hiding names.
- **Why:** every box used `word.startsWith(query)` — the WHOLE query had to
  prefix a SINGLE word, so **any two-word search returned an empty dropdown**.
  Verified before fixing: "vic plaster", "victoria fencing", "auz painting",
  "har painter", "roof plumb", "shower screen" — all nothing. That is the whole
  of "the search function sucks in general"; it wasn't ranking, it was a filter
  that couldn't match a phrase.
- **Trade-off:** still a prefix match per word, NOT a substring one. Typing
  "ain" won't surface every painter. Prefixes are what people expect of a name
  field and they keep the list short on a phone — a substring match turns three
  letters into forty rows.

## 2026-08-02 — Re-importing a report accounts for itself, and re-opens
- **Report:** the whole BPI report was uploaded a second time and "only the
  items outstanding last time" appeared.
- **What was happening:** the duplicate guard was doing its job (`matchCompleted`
  stops a re-import doubling the list — the Band Street fix, 2026-07-30) but
  said nothing. Nothing was added, so the import looked broken.
- **Decision 1 — re-open.** A completed defect that the report raises AGAIN is
  re-opened. The inspector has listed it a second time; that means it isn't
  fixed. Leaving it closed silently loses a live defect, which is the worse
  failure by a distance: a duplicate is visible and deletable, a missing defect
  is neither. The duplicate guard still holds, so no second row is created.
- **Decision 2 — always report.** An import that skipped or re-opened anything
  ends with a summary: N added, N re-opened, N already present, and plainly
  "Nothing new was added" when that's the case. A report imported twice by
  mistake is now one glance to spot.
- **Trade-off:** re-importing an OLD report by mistake will re-open items that
  were genuinely finished. Accepted — it's visible in the summary and one tap
  each to re-complete, against the alternative of silently dropping items a
  re-inspection has failed.

## 2026-08-02 — Every exit from Add Defects is guarded
- **Decision:** `leaveAddDefects(go)` wraps every route off the screen; the Back
  link and the job-title heading both go through it.
- **Why:** Spiro reported the unsaved-changes prompt had "stopped working". It
  hadn't — it had only ever covered the Back link. The job title above the form
  (`viewDefectsForAddress`) is a full-width tappable heading directly under the
  header, and tapping it discarded everything typed with no warning at all.
- **Trade-off:** none. An empty form still leaves without nagging.

## 2026-08-02 — "Shared contractor keeps coming back" — two bugs, not one
- **Report:** approving a supervisor-added contractor under the admin login
  didn't stick; the review list refreshed and they reappeared.
- **Bug 1 — a NULL legacy_id can't conflict.** `diffEntity` pushed every update
  as `upsert(row, { onConflict: 'legacy_id' })`. A contractor row created in CH
  Tracker has `legacy_id = NULL`, and NULL never conflicts with anything in
  Postgres — so ON CONFLICT matched nothing, **INSERTED A DUPLICATE**, and left
  the original row untouched. The next pull returned the untouched original and
  the contractor was back in the list, with a second copy quietly accumulating
  behind it on every tap of Share. `commitDefect` fixed exactly this for
  `dm_defects` back in June; it was never carried across to the entities still
  going through the diff engine.
- **Decision:** `diffEntity` now UPDATEs by uuid when the id map has one, and
  only falls back to upsert-by-legacy_id for a genuinely new row. It also keys
  the map off the LOCAL id when the cloud row's `legacy_id` is NULL — otherwise
  the mapping is lost on the next pass and it duplicates all over again. This is
  generic, so trades get the fix too.
- **Bug 2 — the diff engine swallows a refused write, by design.** A permanent
  error (RLS, constraint) is caught and logged so one bad row can't abort the
  batch or freeze the device. Correct for a background push; wrong for a button
  a manager just tapped. "Contractor shared with the team" followed by it
  reappearing is worse than an honest failure.
- **Decision:** Share goes through a new `CloudSync.commitContractor()` that
  writes and WAITS for the answer. On failure the local change is rolled back so
  the screen matches the database, and the real error is shown.
- **Trade-off:** Share is now as slow as the network. Worth it — the whole
  complaint was that it appeared instant and wasn't real. The background diff
  engine keeps swallowing errors; only this one user-initiated action doesn't.
- **The general rule:** if a button tells the user something is done, something
  has to have confirmed it. A fire-and-forget write behind a success toast is a
  lie whenever the write can be refused.

## 2026-08-02 — Sign out was under the notch
- **Decision:** `#cs-statusbar` takes `env(safe-area-inset-top)`, and its button
  goes from an 11px chip to a 12px/600 one with real padding.
- **Why:** Spiro asked how to log off. It was there — behind the iPhone's own
  clock and battery. The page declares `viewport-fit=cover` +
  `black-translucent`, so content runs under the system status bar, and nothing
  applied the inset. `body.cs-authed` picks up the same inset so the app header
  isn't pushed under it, and `syncStickyHeader()` already measures the bar's
  real height, so the frozen headers re-offset themselves.

## 2026-08-02 — The pull must PRESERVE a field the cloud can't carry yet
- **Bug:** flagging a defect with 🛒 put it on the shopping list, then it
  vanished seconds later. Reported from site the day the feature shipped.
- **Cause:** the write guard was only half the problem. `ensureOrderColumn()`
  correctly stopped the app sending a column that doesn't exist — but the PULL
  read `orderStatus: d.order_status || ''` unconditionally, and `select('*')`
  can't error on a missing column, it just doesn't return one. So every flag
  resolved to `''`, and since `db.data = newData` replaces every defect
  wholesale, the next pull (realtime nudge, tab focus, or the periodic one)
  wiped it. Hence "shows up, then vanishes".
- **Decision:** capture the device's existing flags before the rebuild and keep
  them for any row the cloud returns **without** an `order_status` key. The test
  is per ROW (`'order_status' in d`), not the session-wide capability flag, so
  the cloud wins the instant it can carry the value — including clearing a flag
  someone removed on another device.
- **Also fixed:** `commitDefect` claimed its outbox slot AFTER `await
  ensureOrderColumn()`. `pullAll()` bails while the outbox is non-empty, so a
  pull landing during that probe — a real round-trip on the first write of a
  session — would have rebuilt `db.data` with the edit unguarded. The slot is
  now claimed before the first await.
- **The general rule:** a write guard is not enough for a field the schema
  doesn't have yet. Guard BOTH directions — the write must not send it, and the
  read must not erase it. `select('*')` failing silent is what makes the read
  side easy to miss.
- **Trade-off:** while the column is missing, a flag cleared on another device
  can't propagate (there's nowhere for it to travel). Both devices keep their
  own view until the migration runs. Accepted: that state is temporary and one
  SQL statement from over.

## 2026-08-02 — Preview toggle is `📺`, not `🖼️`
- **Decision:** `ICON_CARDS` = `📺`. Preview mode is now a small television.
- **Why:** Spiro, on site — the picture frame "looks weird". It reads as a
  framed picture hanging on a wall, which is a THING, not a way of looking at
  the list. `📺` reads as a screen/display, so it says "show me this differently"
  the way the paired `☰` says "show me the compact rows".
- **Trade-off:** none worth the name. `📺` isn't used anywhere else in the set,
  it carries its own colour like every other glyph, and it's the same width, so
  the one-line toolbar is unaffected (re-verified at 320px).

## 2026-08-02 — Shopping list: what the SUPERVISOR has to order
- **Decision:** A fourth control (`🛒`) on an expanded defect row flags that the
  item is blocked on the supervisor sourcing a part or materials. Flagged items
  appear on a **shopping list** — per job (🛒 in the job toolbar, beside the
  list/preview toggle) and **across every job the supervisor holds** (a
  Shopping List row on the home screen, directly under the job list). Three
  states on the list: **To order → Ordered → Got it**, advanced by tapping the
  state chip. "Got it" takes it off the list.
- **Why:** a defect can be assigned to a trade and still be waiting on the
  supervisor. Those parts lived in emails, texts and phone notes and got lost.
  The global list is the load-bearing half: a hardware run is planned across
  jobs, not one job at a time, so "everything I need to pick up today" has to be
  one screen.
- **The flag lives ON the defect, not in a separate list.** A parallel
  shopping-list table would need its own lifecycle, its own sync, and its own
  bugs — and would drift the first time a defect was completed or deleted
  somewhere else. On the defect, completing the work removes the item for free,
  and re-opening it brings the item back.
- **"Got it" does NOT complete the defect.** The part being in hand and the work
  being done are different facts: the trade still has to fit it. Conflating them
  would have marked work complete that nobody had done. `done` is remembered
  rather than cleared, so a defect that has already been sourced still says so.
- **Trade-off — an eighth icon on the job toolbar.** It's a VIEW control, so it
  joins the left group with the list/preview toggle rather than the actions on
  the right; the `margin-left: auto` selector had to learn about `.cart-btn` or
  the cart itself would have taken the auto margin and floated into the middle.
  Verified one line, nothing clipped, at 320px.
- **Trade-off — a fourth icon on the open row strip.** The strip is full width
  and doesn't compete with the description, so this costs nothing the row
  actions didn't already cost. Four at 22px gap still fit a 320px phone.
- **Needs a manual migration** — `supabase/migrations/2026-08-02_defect_order_status.sql`
  (one nullable column). See the capability probe below for why the app is safe
  to ship before it runs.

## 2026-08-02 — A new sync column is probed for, never assumed
- **Decision:** `cloud-sync.js` probes `dm_defects.order_status` once per
  session (`ensureOrderColumn`) and includes the column in a write **only** when
  it is genuinely there.
- **Why:** the browser half of a feature ships on a push; a database column
  doesn't. PostgREST rejects a write naming an unknown column with a 400 — and
  `defectRow()` builds **every** defect write. Shipping the client first without
  a guard wouldn't have lost the order flag, it would have broken saving a
  description, a supplier, a status, a photo — everything — for every user until
  someone ran the SQL. That is a whole-app outage caused by a shopping-list
  feature.
- **Trade-off:** one extra round-trip per session, and until the migration runs
  the flag is device-local (it still works; it just doesn't reach the
  supervisor's other phone). Both are cheap next to the alternative. Apply the
  same pattern to any future column: probe, degrade, never assume.

## 2026-08-02 — Deep read: private inspection reports are read as PAGES, not text
- **Decision:** A third report path, **Deep read**, sends the actual PDF to
  Claude as a base64 `document` block instead of flattened text. It is
  **manager-only** (`CloudAI.deepAvailable()` → `role === 'manager'`) and only
  offered for a **Private Inspection PDF** — BPI and pasted text never see it.
  The model returns `{description, location, trade, page, anchor}` plus a
  one-line `layout` summary of how that report was organised.
- **Why:** BPI reports carry their structure in the WORDS (`1 Kitchen Painter
  ...`), so flattened text is enough. Private inspection reports carry it in the
  LAYOUT — a room heading, a defect-type heading, a cluster of four photos
  sitting under a paragraph. `extract-defects` received `{ text }` and nothing
  else, so every one of those cues was destroyed before the model saw it, and
  we were asking it to work out how the report was organised from the one
  representation that no longer said. Spiro's own framing — "analyse it start to
  finish and almost reformat that report to work with this app" — is exactly the
  job; it just needed the right input, not a better prompt.
- **The photo problem this actually fixes.** `extractBpiPhotos` opened with
  `if (!wantByPage.size) return out;`, which needs `page` and `itemNo` on every
  item. The AI path returned neither, so that line returned empty **every single
  time** — zero photos on every private report ever imported. The cropping
  machinery was fine; it had nothing to hang photos off. `anchor` is the hook:
  a verbatim snippet located in the page's text layer yields the same
  `{itemNo, y}` the BPI Tag finder produces, so **one** pairing routine now
  serves both (`bpiPairPhotosToTags` is unchanged).
- **Learnings carry over for free — nothing was ported.** `resolveTrade()` runs
  on the review screen, downstream of extraction, for every item whatever
  produced it. Learned history, curated overrides, the admin-editable DB rules
  and the keyword classifier were already shared. The model's `trade` is used
  **only** when all of those return nothing, and is labelled `(AI)` when it is —
  a cold read must never outrank what this team's own assignments have taught.
- **Trade-off — cost, which is why it's gated.** A page costs ~2,300 tokens as
  an image+text pair against ~350 as text: roughly **15c → 40c on a 25-page
  report**. Three guards: manager-only, ≤60 pages, ≤11 MB, each falling back to
  the flat read with a toast rather than quietly spending the money. Deep read
  is also SLOWER (adaptive thinking on a 40-page PDF is a real wait), so it is a
  checkbox, not the default for everyone.
- **Trade-off — precision over recall on photos.** An anchor that can't be found
  on its page gets NO photos, rather than a guess. A photo attached to the wrong
  defect is worse than one not attached, because it goes to a supplier. The one
  exception is a page holding exactly one defect, where a top-of-page fallback
  can't mis-attach. Cross-page carry is capped at `ANCHOR_CARRY_PAGES = 2` so a
  photo appendix 15 pages later can't pile onto the last item.
- **Also:** both paths moved to `claude-opus-5` (the function was on
  `claude-opus-4-8`, same price) and both now **stream** — a non-streaming
  request long enough to read 40 pages is refused by the API outright.
- **Needs a manual deploy:** `supabase functions deploy extract-defects`. Until
  that runs, `extractDeep` gets an error back and the app falls back to the flat
  AI read — degraded, not broken.

## 2026-08-02 — View Defects header: one line of icons, and frozen
- **Decision:** The View Defects toolbar is now a **single row that never
  wraps**, on every screen that has one (address/job, supplier, trade, multiple
  suppliers, All Defects). Two controls were collapsed to make it fit: the
  `Filter ●●● ▾` pill became one **funnel icon**, and the `LIST | PREVIEW`
  segmented control became **one toggle icon** showing the view you'll get when
  you tap it. The whole `.defects-header` (job title + toolbar) is now
  `position: sticky`, frozen under the blue app header, which is itself frozen
  under the cloud-sync status bar.
- **Why:** Spiro, from site: the header was taking two lines and the controls
  scrolled away, so filtering or refreshing meant scrolling back to the top of a
  long job. The wrap was added on 2026-08-01 because a no-wrap row pushed the
  Filter button off the left edge — but the real problem was that the two
  labelled controls cost more width than all six action icons combined. Removing
  the labels fixes the width properly instead of spending a second line on it.
- **Trade-off:** The three status dots no longer show the filter at a glance.
  Mitigated: the funnel carries a **red dot whenever Open or Pending is hidden**
  — i.e. whenever the filter could make a job look finished when it isn't — and
  the button's tooltip/aria-label names exactly which statuses are showing. A
  dot for "Completed hidden" was deliberately NOT used: that is the default, so
  the warning would be on permanently and mean nothing. Toolbar icons also
  shrink with the viewport (`clamp(18px, 5.8vw, 26px)`), so on a 320px phone the
  seven-control supplier toolbar is smaller than it was — still a comfortable
  tap target, and verified fully inside the screen edge.

## 2026-08-02 — Spiro's emoji picks
- **Decision:** Ten glyph changes chosen from a five-option-per-icon comparison:
  filter `🚦`, list view `☰`, preview view `🖼️`, email `📧`, add `✚`,
  photo dump `🎞️`, send `📨`, photos `📸`, import contact `📱`, call `☎️`.
- **Why:** worth recording two of them. **`🚦` for the filter** is the best idea
  in the set — the three statuses it selects ARE red, amber and green, so the
  glyph states what the control does rather than gesturing at "filtering". And
  the filter, list and preview toggles were the last drawn SVGs in the app; with
  these they're gone, so the whole set is now one medium.
- **Trade-off / watch item:** `📨` (send) and `📧` (email) are both envelopes and
  sit **adjacent** once a supplier's send group is expanded. The chooser only
  ever showed the group collapsed, so that pairing wasn't visible when it was
  picked. On Apple's set they differ by an arrow vs an @; on Google's they're
  closer. If it reads badly on site, `📤` for send separates them cleanly and is
  a one-line change.
- Also note `🖼️` moved from photo dump to the preview toggle, and photo dump
  took `🎞️` — deliberate, avoiding a collision.

## 2026-08-02 — Emoji icons stay. The drawn set was built, shipped, rejected.
- **Decision:** Reverted `2026-08-02h`, which replaced all 32 emoji controls with
  a one-family line-SVG set. The app is back on emoji, with four consistency
  fixes applied on top:
  1. **One plus.** The toolbar's `➕` (a dark, heavy glyph) became `＋`, which is
     plain text and so inherits `.icon-btn`'s blue — matching the home job rows
     and the blue funnel sitting beside it. Two buttons doing the same thing no
     longer look different.
  2. **One envelope.** `📧` in toolbars and `✉️` on supplier headings both meant
     "email this". Now `✉️` everywhere — the simpler shape, better at 19px.
  3. **Add Report is `📥`, not `📄`.** It sat directly above `📑 Generate PDF
     Report` in the reports list as a second pale page; on iOS they were near
     indistinguishable. A tray says "bring one in", which is the action.
  4. **`🙈` is gone.** The see-no-evil monkey was the "hide completed" state. One
     `👁️` for both states — the button already goes solid blue when completed
     are showing, which was always the clearer signal.
- **Why:** Spiro, on seeing it live: *"These icons suck."* The drawn set was
  technically the better system — one grid, one weight, theme-aware, no vendor
  drift — and it was still wrong. Emoji carry **colour**, and on a list of four
  near-identical actions colour is doing more work than stroke consistency ever
  could: a yellow card index, a red-arrow tray, a blue-tabbed document and a
  grey bin are told apart in peripheral vision. A monochrome set threw that away
  and asked shape alone to carry it at 19px.
- **Trade-off accepted:** emoji render as a different typeface on every platform
  and can't take the app's accent. That inconsistency is real and is being
  **kept on purpose**, because it buys colour.
- **Don't redo this.** The full five-way comparison was built, rendered at true
  phone size, chosen from, implemented across ~142 call sites and shipped. It
  lost on the phone. If someone proposes drawn icons again, the answer is that
  it was tried on 2026-08-02 and reverted the same day — and the reason was
  colour, not craft.

## 2026-08-02 — Job heading: own line, one line, auto-fitted
- **Decision:** On the job and supplier screens the heading keeps its **own
  row**, with the toolbar on the row below, at **17px**. The title renders in
  parts — street (ellipsises), job number (never shrinks) — the **suburb is left
  out**, and `fitLotTitle()` steps the size down 17px → 14px if a very long
  address would otherwise wrap or clip. The duplicate `＋` came off the title;
  the toolbar's ➕ does the same thing.
- **Why:** the heading and the toolbar were tried on ONE shared line first
  (115px → 44px), and on paper it won. On a real job it didn't: it squeezed the
  address to 13px and *still* clipped it — "Lot 1207, (28) Mimo… - 303719".
  Spiro called it, and he was right. The address is the one thing on this screen
  you cannot reconstruct from context; the toolbar is six icons you already know.
  So the address gets the full width and a readable size, and the toolbar pays
  the second row.
- **Trade-off:** the header is **78px, not 44px** — 37px per screen given back to
  keep the address whole and legible. Still 37px better than the 115px it
  started at, because dropping the suburb and pinning the job number mean the
  address no longer wraps to two lines. Measured un-clipped at 17px from 320px
  to 430px.
- **The general lesson:** the shared line optimised the measurable thing (pixels)
  at the cost of the thing that mattered (reading the address). Check a layout
  win against the worst real record, not the tidy one.

## 2026-08-02 — Job + supplier screen headings drop the italic caps
- **Decision:** On the View Defects and View Supplier screens, the screen title
  and the `.lot-title` now use **Titillium Web 700, upright, as-typed** — the
  same three properties an index job row uses — instead of 900 italic uppercase.
  The home hero keeps its italic caps.
- **Why:** Spiro: the defects screen "seemed like a different font" to the index.
  It wasn't — computed styles confirm the index job rows, the defect rows and
  these headings were all already Titillium Web. The difference was weight,
  slant and case, so that's what changed. (Same finding as 2026-07-30 on the
  supplier headings, one level up: check the computed style before swapping a
  family.) The hero is the app's masthead, not a page heading, and isn't part of
  what changes underfoot.
- **Trade-off:** The screens read quieter — the italic caps were doing the work
  of signalling "you are inside a job". The frozen header carries that now, and
  it's a better signal because it stays on screen. Sentence case is narrower
  than caps, so the lot title fell from **56px to 28px** — one line instead of
  two — and on a frozen block every one of those pixels goes back to the list.

## 2026-08-02 — Supplier heading on one line
- **Decision:** The supplier heading inside a job is now a single non-wrapping
  line. Three changes bought the width: the name takes every pixel the actions
  don't and **ellipsises** instead of wrapping; the booking date shows **DD/MM**,
  no year; and the three send icons (✉️ 🔗 📑) collapsed into **one 📤 that
  expands into all three when tapped**, one heading at a time.
- **Why:** Spiro, with a screenshot: "AUZ PAINTING & DECORATING PTY LTD" was
  taking three lines, because the name couldn't shrink (no `min-width: 0`) and
  the five actions wouldn't. Three lines of heading per supplier on a job with
  eight suppliers is most of a screen spent on names you already know.
- **Trade-off:** A long trading name is now truncated — "AUZ PAINTING &
  DECORA… ›". The full name is in the element's `title` and one tap away on the
  supplier's own screen, and the `›` is a separate element so it survives the
  truncation and the heading still reads as tappable. The year leaving the
  booking button is display-only: `fmtDateNice` and its year still drive every
  report and email, `fmtDateShort` is used for the button alone, and that
  button's tooltip reads "Attending 07/08/2026 — tap to change".
- **Follow-up the same day:** once a date is set the 📅 goes too — the date
  itself is the button. The icon was only ever saying "this is a date", which
  the date says on its own; with no date there's nothing to show, so the icon
  stays as the thing you tap to add one. Tapping the date opens the same picker,
  so it stays editable. 11px of blue text is a small target on site, so
  `.date-only` pads it to 42×29 and cancels that padding with an equal negative
  margin — the tap area grows, the heading stays 22px.

## 2026-08-02 (later) — Make it a SINGLE tap
- **Decision:** One tap on a defect row opens its pencil / pin / camera. Tap
  again, or open another row, to close. The double-tap detector and its 450ms
  window are deleted.
- **Why:** Spiro used it on site. Double tap is a gesture you have to be *told*
  about; a single tap is the one every thumb tries first. The timing window also
  had a quiet failure mode — a second tap that arrived at 500ms did nothing at
  all, which reads as the app ignoring you.
- **Trade-off:** a mis-tap now opens a row rather than doing nothing, so the
  list shifts under your thumb more often. Cheap to undo (tap again) and worth
  it against a gesture nobody discovers. `user-select: none` stays on rows —
  without it a stray double tap selects a word and raises the iOS callout menu
  over the strip you just opened.

## 2026-08-02 — Row actions on demand: double-tap to open a defect row
- **Decision:** The pencil / pin / camera no longer sit on every list row. A
  **double-tap** on a row opens them as a full-width strip underneath it, at
  19px instead of 13px; a **single tap** on an open row closes it again. Only
  one row is open at a time. A faint `⋯` at the right edge is the affordance,
  becoming `✕` when open. Applies to every screen that renders `.defect-item`,
  since it is one delegated listener plus CSS on the shared row.
- **Why:** Spiro, with a screenshot: any description longer than about four
  words pushed the icons onto a second line, so a three-word defect and a full
  sentence cost the same two lines — the wording was what got squeezed. Measured
  on his own ten Htee Kleeh items at 390×700: list height **528px → 436px**, and
  **8/10 rows visible on one screen → 10/10**. "Replace hinges to external door"
  went from two lines to one.
- **Trade-off:** The location text and the photo count are no longer visible at
  a glance — you have to open the row to see them. Accepted as asked for; if the
  photo count turns out to be worth its width, a 6px dot on the row is the
  cheap version. Text selection is also off on rows (`user-select: none`), which
  is what stops iOS answering a double-tap by selecting a word and raising the
  callout menu instead of opening the row; copying a single description is lost,
  and Copy to Clipboard still exports the whole list.

## 2026-08-02 — Preview mode reaches the supplier screen
- **Decision:** `renderViewDefectsContractor` now honours preview mode and
  carries the toggle icon, rendering walk-the-house cards grouped by address
  with a per-address "N of M outstanding" count. Trade, multiple-suppliers and
  All Defects stay list-only and carry no toggle.
- **Why:** `dm_preview` is one global flag but only the address screen read it,
  so a supervisor who turned Preview on and then opened a supplier silently got
  compact rows back — the setting looked broken. The supplier screen is a
  walk-the-house screen too: one trade's outstanding items across their jobs.
- **Trade-off:** The supplier toolbar is now eight controls on one line. At
  320px they shrink to ~18px, the floor of the `clamp()`. Verified as still one
  row inside both screen edges; anything further would need the row to scroll.
  Completed items stay as compact rows underneath the cards on both screens —
  they're a record, not something you tick off on site.

## 2026-08-02 — `overflow-x: clip` on body, never `hidden`
- **Decision:** The three `html, body { overflow-x: hidden }` rules now set
  `hidden` on `html` only; `body` gets `overflow-x: clip`.
- **Why:** `overflow: hidden` makes body a **scroll container**, and every
  `position: sticky` descendant then anchors to a box that never scrolls. The
  app header has been declared `position: sticky` for a long time and has never
  actually stuck because of this — it scrolled away with the list. `clip` clips
  identically without creating a scroll container.
- **Trade-off:** `overflow: clip` needs Safari 16+ / Chrome 90+. Older browsers
  drop the declaration, leaving body at `visible` — but `html` keeps `hidden`,
  which propagates to the viewport, so sideways drag is still impossible. The
  degradation is "sticky doesn't stick", i.e. exactly today's behaviour.

## 2026-07-27 (b) — ROOT CAUSE of "says it saves but it's not there"
- **Decision:** Defect ids are no longer recycled (persisted high-water mark in
  `dm_defect_id_hw`, raised on every load/save), and `isTombstoned()` only trusts
  a **legacy-id** tombstone match for a defect that actually came from the cloud
  (has a uuid, or a snapshot baseline entry).
- **Why:** `addDefect()` allocated `max(existing id) + 1`, so deleting the
  highest defect handed its id to the next brand-new one. That id is the
  `legacy_id` the cloud upserts on, and CH Tracker's delete-archive keeps
  tombstones for 60 days. So a new defect could inherit a deleted defect's id,
  match its tombstone in `commitDefect()`, and be `purgeLocalDefect()`d
  milliseconds after the "✓ saved successfully" toast — the defect saved, then
  vanished. Because it never reached the cloud, any attached photo stayed in the
  IndexedDB outbox forever, which is the "📸 1 photo saved on this phone ·
  uploading when you have signal" banner in the original bug report. One root
  cause, both symptoms.
- **Trade-off:** If a previously-synced defect loses BOTH its uuid and its
  snapshot baseline (e.g. `healStaleBaseline()` clears a poisoned baseline), a
  genuinely deleted defect could be re-created instead of purged. Accepted
  deliberately: resurrecting a deleted defect is visible and recoverable,
  silently deleting a just-logged one is neither. The uuid match still covers the
  normal case.

## 2026-07-27
- **Decision:** A supplier name **typed in full** is now accepted on the Add
  Defects screens, not only one tapped from the suggestion list. If the name
  can't be resolved (unknown, or ambiguous across two suppliers) the save is
  **refused with a message naming the block**, and nothing is written.
- **Why:** `saveAddDefectsAddress()` only ever read the id set by tapping a
  suggestion. Typing the name in full and going straight to the defect rows —
  normal on a phone, where the keyboard covers the dropdown — left that id
  unset, so the whole block was skipped. If another block *did* save, the
  supervisor got "✓ 1 defect(s) added successfully" while the other supplier's
  defects were silently discarded. This is the "can't save defects" report.
- **Trade-off:** Saving is now all-or-nothing per tap: one unresolvable block
  blocks the whole save rather than partially writing. Chosen deliberately —
  the typed text stays on screen to correct, and a partial save that looks
  complete is what caused the lost work in the first place.

- **Decision:** The duplicate guard in `db.addDefect()` now matches on
  **address + description + supplier**, instead of address + description.
- **Why:** The same wording legitimately applies to two trades on one job
  ("Touch up paint to hallway" for the painter and the plasterer). The old
  guard swallowed the second one and handed back the first supplier's defect,
  so that work never reached the trade it was raised against.
- **Trade-off:** Two suppliers can now hold identically-worded defects on one
  job. The double-tap protection still holds because the supervisor fallback
  now resolves *before* the comparison, so both sides carry the same supplier.

- **Decision:** `initializeAddressDefectForm()` / `initializeContractorDefectForm()`
  now return early when their container is absent; `db.save()` catches a failed
  `localStorage` write and warns instead of throwing silently.
- **Why:** Both containers were deleted when the five-block form landed, so
  every "＋ Add defects" tap threw a TypeError. A full/blocked localStorage
  (private browsing, iOS evicting the origin) discarded the write with no
  indication — indistinguishable from "I saved it and it disappeared".
- **Trade-off:** The two legacy functions are left in place behind the guard
  rather than deleted, to keep this change small; they are dead code and can go
  in a separate tidy-up.

## 2026-07-23
- **Decision:** Added a multi-select **status filter** (Open / Pending / Completed)
  to the View Defects toolbar on both the address and contractor screens. A pill
  at the left of the toolbar shows coloured dots for the active statuses and opens
  a small modal where each status toggles independently.
- **Why:** Supervisors asked to filter the list by status and show/hide any
  combination — e.g. just outstanding (pending), or reveal completed inline.
- **Trade-off:** The old per-job "Show N completed" expand button was removed;
  Completed visibility is now driven by the filter (default hides it, so the
  everyday list is unchanged). Filter state is session-only (not persisted).
