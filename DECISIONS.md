# Decisions Log

Newest at top. Format: date — decision — why — trade-off accepted.

## 2026-08-16 (t) — a missing email is an offer, never a wall

- **Spiro, blocked by a `prompt()` on a Carpenter: "never make it mandatory to
  add email for a TRADE type ie painter carpenter roof plumber… you can only do
  this with contractors / supplier, even still don't make it mandatory."**
- **A TRADE is never asked at all.** Carpenter, Painter, Roof Plumber are
  placeholders, not companies — they have no inbox and never will. Asking was
  pure obstruction on the most common case of the lot.
- **A real supplier is OFFERED one, with Skip for now beside it.** Skip always
  goes through: the email still sends, you fill the To line in Mail yourself,
  which is where supervisors keep their contacts anyway. ✕ cancels the send
  outright, which is a different answer from Skip and is tested as such.
- **This removed the app's ONE `prompt()`.** A native browser dialog cannot be
  styled, cannot offer a third option, and on iOS it is modal over everything.
  `askSupplierEmail()` is a promise-returning overlay in the app's own furniture.
- **Two downstream landmines went with it.** The server-send branch and the
  mailto were both written assuming `c.email` exists — the mailto would have
  produced `mailto:undefined?subject=…` the first time anyone skipped. Guarded.
- **Swept the rest of the app: there is nothing else.** The add-contractor form,
  the edit-contact modal and the bulk paste all already treated email as
  optional. `emailDefectList` collects addresses where they exist and opens Mail
  with an empty To line where they don't. The count of `prompt(` in index.html
  is now zero.
- **`emailattach.mjs` section E** covers trade-never-asked, offered-with-skip,
  skip-saves-nothing, a bad address refused without closing the sheet, a good
  one saved, and ✕ stopping the send. It also registers a Playwright `dialog`
  handler and asserts NOTHING opens one — the wall coming back would be a
  native dialog, so that is the thing to watch for.

## 2026-08-16 (s) — one fixed photo frame per defect

- **Spiro, on (r): "photo one of five was the first photo and then when I press
  next it automatically shifts up… it needs to stay in focus."** (r)'s
  grow-to-the-tallest-seen held on the way DOWN and still shoved the page on the
  way UP, so paging 1→2→3→4→5 jittered its way through the set — once per photo
  taller than anything before it. Monotonic is not the same as still.
- **The slot's height is now LOCKED on the first photo that paints and never
  changes.** `.pv-photo img` went `height:auto` → `height:100%`, so once the box
  is locked every later photo is contained INSIDE it rather than resizing it.
  Before the lock the parent height is indefinite, so `100%` resolves to auto
  and the first photo still sets its own natural shape — the existing behaviour
  for a single-photo card is untouched.
- **The 240px floor applies only to multi-photo defects.** It stops a very wide
  first photo leaving a letterbox slit that every portrait after it squeezes
  into. `tests/pvphoto.mjs` caught it being applied to single-photo cards too —
  a landscape shot rendered at 1.256 against its natural 1.5, which is grey
  bands around the only picture there is.
- **Trade-off: within one defect, the first photo picks the frame.** A portrait
  after a landscape is shown smaller than it could be. Accepted — every photo is
  `contain`, so nothing is ever cropped, and the whole point of the change is
  that the page does not move.
- **`pvstable.mjs` section C now pages the WHOLE set** — tall → wide → square →
  back — and asserts the box size, the slot's position and the card BELOW are
  all identical at every step. Stepping once passed under (r); it was the second
  and third steps that exposed it.

## 2026-08-16 (r) — preview mode holds still

- **Spiro, scrolling a job on site: "the photos tend to kind of flicker a fair
  bit and refresh themselves… it kind of scrolls up and you have to continue
  scrolling down", and "when I click left or right in the photos it actually
  goes up or down".** Three separate causes, none of them the photos.
- **1. `render()` threw the scroll position away.** It replaces `#app` wholesale,
  and redraws fire on their own — a photo count landing, another phone's edit
  arriving over realtime. So the list reset itself under your thumb with nothing
  touched. It now keeps the offset when the view AND its filters are unchanged,
  and still starts at the top on real navigation.
- **2. `fillPreviewPhotos()` rebuilt every photo on every render** — it revoked
  every object URL on the page and rewrote every slot. That is the flicker
  literally: all images dropped and reloaded. Each slot now carries a signature
  (its cloud URLs plus its pending COUNT — pending photos get a fresh object URL
  every call, so comparing URLs would never match) and an unchanged slot is left
  alone. Object URLs are revoked per defect, not globally.
- **3. Paging rewrote the slot's innerHTML**, dropping the `<img>` out of layout
  for a frame. The slot collapsed, everything below leapt up, and it sprang back
  when the next photo decoded. `pvRenderPhoto` now mutates the existing element:
  swap `src`, update the counter, add or remove the arrows in place.
- **The slot only ever GROWS.** Fixing (3) alone still left a 347px jump in the
  test, because one defect's photos are genuinely different shapes — portrait to
  landscape really is 300px less box. It now keeps the tallest height it has
  seen and letterboxes the rest (`object-fit: contain` was already there, so
  nothing is cropped). Nothing below a card ever moves upward; the worst case is
  one downward nudge the first time a taller photo appears.
- **Heights survive a redraw.** `previewCard` seeds each slot with the height it
  last painted at, so after `render()` the page is already the right length and
  the restored scroll lands on the row you were on instead of clamping short.
- **Trade-off: a wide photo in a card whose tallest is a portrait gets bands
  down the sides.** Accepted — it is the price of nothing moving, and the whole
  point of preview mode is walking a house thumb-first.
- **`tests/pvstable.mjs` is a new suite (29 now)** and asserts POSITION and
  IDENTITY: the scroll offset across a redraw, that a repeat fill rewrites zero
  slots, that paging re-uses the same `<img>`, and that the card BELOW does not
  move. "The photo is on screen" passed happily through all three bugs.

## 2026-08-16 (q) — the defect list goes in the message body

- **Spiro: "the PDF is attached but there's nothing in the body."** Right — (p)
  shared `{ files: [pdf] }` and nothing else, so the message arrived empty.
- **The body now rides with the file: `navigator.share({ files, text })`.** Two
  comments in this file disagreed about whether that is safe on iOS — one said
  pairing text with a file "leaks a blob: link", the other (older, and written
  from an actual device) said Apple Mail puts the text in the body and Outlook
  lifts its first line into the Subject. Only the second describes passing
  `text`; the blob complaint is about passing `url`. So `text` yes, `url` never.
- **The first line of the body IS the subject**, which costs an Apple Mail user
  one duplicated line and gets an Outlook user a filled-in Subject for free.
- **`canShare({ files, text })` guards it.** If a browser won't take the pair,
  the file goes alone rather than the whole share failing — the attachment
  matters more than the body.
- **The "copy the email address" row is gone.** Spiro: "you don't have to create
  a copy for the email. The copy can just be for the subject." Supplier
  addresses live in each supervisor's own mail client, so Mail's autocomplete
  beats anything the app can offer.
- **If a `blob:` line ever does appear in a real message, the fix is to drop
  `text` from the payload** — one line in `sharePdfOnTap`. Recorded because the
  only device that can settle it is a supervisor's phone, not this harness.
- **`emailattach.mjs` grew a section D**: canShare refusing the pair must still
  attach the PDF. That is the degraded path nobody would notice was broken.

## 2026-08-16 (p) — 📧 attaches for real, and the subject goes on the clipboard

- **Spiro circled the 📧 and said it was "practically the same as the share a
  link function". It was, literally.** `emailDefectList(withPhotos, asLink)`
  carried `asLink` in its signature and NEVER READ IT, so 📧 and 🔗 ran the same
  code and produced the same email. `asLink` is now honoured: 📧 attaches the
  PDF through the share sheet, 🔗 keeps the mailto + hosted link.
- **The iOS wall, stated once so it stops being re-litigated:** `mailto:` can
  set recipient, subject and body but can never carry a file — the URL scheme
  has nowhere to put one. The share sheet can carry files but cannot set a
  subject or a recipient, and passing `text` alongside `files` makes iOS inject
  the `blob:` URL into the body. You get one or the other, never both.
- **So the subject rides the clipboard.** `sharePdfOnTap` copies it in the SAME
  tap that opens the sheet — copy first, share second: `share()` consumes the
  transient activation and a clipboard write does not, so the reverse order is
  a coin toss. Both the subject and the supplier's address are also offered as
  tap-to-copy rows, because the clipboard holds one thing and which one you
  want next depends on the mail app.
- **The recipient is left to Mail's autocomplete.** Spiro: "most of the email
  addresses are saved in the email client for each supervisor" — typing two
  letters beats anything the app can do from a web page.
- **Rejected: the server-side send** (`CloudMail.sendSupplierDefects` → the
  `email-supplier-defects` Edge Function). It does all four properly and needs
  no clipboard, but it is blocked on a verified Resend domain AND on a real
  bug — the function validates `pdfKey` with a regex that forbids the `/` that
  `CloudShare.uploadTempPdf` now puts in every key, so it has been returning
  400 and falling through silently since the foldered path landed.
  `NEXT_STEPS.md` predicted that exact failure. Fix lives in the CH Tracker
  repo, which this session cannot reach.
- **`tests/emailattach.mjs` is a new suite (28 now).** It asserts the two
  buttons DIVERGE, that the share carries the file with no `text` beside it,
  and that the subject reaches the clipboard without eating the tap that opens
  the sheet. Two harness traps worth remembering: `page.evaluate` awaits the
  promise it is handed, and `sharePdfOnTap`'s only settles on a tap — so
  returning it deadlocks the run; and `navigator.clipboard` is a read-only
  accessor, so a plain assignment stubs nothing and the test reads null while
  the app is copying perfectly well.

## 2026-08-16 (o) — two whole supplier blocks on one screen

- **Spiro: "reduce the height of the input fields so that I can see all five
  defects of two contractors."** In `m` the fifth row of Contractor 2 sat about
  20px below the fold on his phone. Two blocks now need 490px instead of 562,
  and 12px also came off above block 1 — 84px in total, so it clears by ~60px.
- **Where the 72px came from:** defect row 34→32, supplier field 46→36, row gap
  5→4, block padding 12/15→9/12, gap between blocks 12→8. No single change was
  enough; the field heights alone were 60 of it.
- **16px is the floor on any focusable input and the supplier field is now on
  it** (17→16). Below 16px, iOS Safari zooms the page whenever a field takes
  focus and the supervisor has to pinch back out. `adddefects.mjs` asserts it,
  because it is the kind of limit that gets shaved off by accident later.
- **The fit is asserted as "two blocks need ≤500px", not against the harness's
  viewport.** A real phone carries ~120px more chrome above them — the Synced
  bar and the notch inset — which the headless page has no way to render, so a
  viewport-relative check would pass here and fail on site.
- **Trade-off: a 32px row is well under the 44px iOS touch guideline.** The pin
  and camera keep their own 34px targets through padding, so only the text
  field is tight, and a text field is more forgiving than a button. One number
  in `.defect-input-row input` puts it back.

## 2026-08-16 (n) — the supplier reads bold, the defects do not

- **Spiro: "the text of the contractor and the defects to be Titillium Web…
  contractor name to be bold but the defects not to be."** The family was
  already right — `body.design-f1 input` sets Titillium Web with `!important`,
  and a computed-style probe confirmed both fields at 400 weight. Only the
  weight needed changing, so this is two CSS lines, not a font change.
- **Worth recording because the screenshots lie here:** the sandbox stubs out
  Google Fonts, so every render in this repo's tooling falls back to system-ui.
  A screenshot cannot tell you which family shipped — read the computed
  `fontFamily`, which is what `adddefects.mjs` now does.
- **The supplier is the heading of its block**, so 700 matches how a job row on
  the index is set; the five defect lines under it stay 400 so the eye lands on
  the supplier first.
- **The placeholder drops back to 400.** "Contractor 1 — start typing name…" is
  a prompt, not a name, and bold placeholder text reads as filled-in.

## 2026-08-16 (m) — the defect rows lose their padding

- **Spiro, from a phone with the keyboard up: "too much space above and below
  the text… reduce the heights of the text boxes so that those 5 defects are
  more condensed."** Only three of the five rows fitted above the keyboard.
- **Vertical padding 10px → 6px, row gap 8px → 5px.** Row pitch goes 48px → 39px:
  the row itself is 40px → 34px, and five of them now cost 195px instead of 240.
  Horizontal padding is untouched — that is reading room, not dead space.
- **The padding moved OUT of the inline styles and into
  `.defect-input-row input`.** It was written on each input, so the stylesheet
  could never win without `!important`; one declaration now governs Add
  Defects, the contractor screen and the Quick Add modal alike. The quick rows
  had no padding of their own at all and were the odd ones out.
- **`line-height: 1.25` is set explicitly**, so the row height doesn't drift
  with whatever the browser's default for a text input happens to be.
- **Trade-off: a 34px row is under the 44px iOS touch guideline.** Accepted —
  it is a text field in a dense form, the pin and camera beside it keep their
  own 34px targets through padding, and fitting all five rows on screen while
  typing is worth more than the extra 10px.
- **`adddefects.mjs` now asserts `rowH <= 36`**, not `<= 46`. The looser bound
  was there to catch the wrap; this one also catches the padding creeping back.

## 2026-08-16 (l) — Add Defects: three suppliers, five defects, one line each

- **Spiro: "three contractors and five defects per contractor"**, down from
  five blocks of three. Same fifteen rows either way, but a supervisor walking
  a job almost always has several items for ONE trade and rarely five different
  trades in a single visit, so the rows belong under the supplier.
- **The fifteen blocks are now GENERATED** (`addDefectBlocksHtml`), not fifteen
  copies of the same markup. `ADD_DEFECT_BLOCKS` / `ADD_DEFECT_ROWS` are the
  only place the numbers live, and `saveAddDefectsAddress` reads the same
  constant instead of a hard-coded `i <= 5`.
- **The row is one line again: pin — description — camera.** It was already one
  `.defect-input-row` in the markup, but the CSS said `flex-wrap: wrap` with
  the input at `flex: 1 1 100%`, so the description always dropped to a line of
  its own below the icons. `nowrap` plus `flex: 1 1 0%` puts it back on the
  line, and the description now takes 83% of the row on an iPhone.
- **The pin carries NO text at all — the colour is the whole signal.** Faded
  means no location, full red means one is set, which is exactly how the camera
  already worked (faded 📸 → full 📷 with a count). Spelling the location out
  beside the pin was the first attempt and Spiro rejected it: it cost the row
  60-80px and left the rows ragged, since only some of them had one. The value
  is still on the button's `title`, and tapping the pin reopens the picker with
  it ticked, so nothing is lost but the width.
- **Both icons sit in the card's own padding.** Each has 8px of vertical
  padding for a finger-sized target and negative margins that stop that padding
  from taking width off the description or height off the row, with a bigger
  negative on the outer edge to slide the icon left/right into the card
  padding. The description went from 232-275px to a flat 297px on an iPhone —
  90% of the row, and now identical on every row whether a location is set or
  not.
- **`.defect-input-row span` became `.defect-input-row > span`.** At 0,0,1,1 it
  out-specified the label class (0,0,1,0) and was rendering the chosen location
  at 17px — half the reason the row had no room. The `>` scopes it back to the
  legacy form's `*` marker, which is all it was ever for.
- **Trade-off: the location is no longer readable at a glance.** A supervisor
  reviewing five rows before saving can see WHICH rows have a location but not
  WHAT it is without tapping the pin. Accepted deliberately — the width matters
  more, and the picker opens with the current value ticked.
- **`tests/adddefects.mjs` section E now checks GEOMETRY** — row height, which
  side each icon is on, that all three are vertically centred on one line, that
  the description keeps ≥85% of the row, and that setting a long location costs
  the row no width. "The pin button exists" passed happily for weeks while the
  row was wrapping. `locmodal.mjs` checks the pin lights up WITHOUT naming the
  location, and that an empty pin is measurably fainter than a set one — the
  colour is the only signal now, so it has to be a real difference.

## 2026-08-16 (k) — crop, in the one editor the whole app shares

- **Spiro: "in the mark up mode add the ability to crop photo aswell… across
  entire app."** It IS across the entire app, for free: the camera, the per-row
  📸, Bulk Import and plan markups all resolve through
  `CloudPhotos.editPhoto` → `openPhotoEditor`. One implementation, every photo.
- **A box you drag by the middle and size by the corners**, everything outside
  it dimmed by a single 9999px box-shadow rather than four shade panels — the
  hole always matches, with nothing to keep in sync. 30px hit areas around 16px
  dots, because a 16px target is not a finger target.
- **Applying BAKES the composite down.** The crop takes the current canvas —
  drawing and all — into a new base, then clears the annotation list, since
  those pixels are now in the image and their old coordinates would scatter.
  So you can crop then draw, or draw then crop, and both work.
- **Stroke width and text size are recomputed after a crop.** They derive from
  the image width; without that, drawing on a tight crop comes out with the fat
  lines of the whole sheet.
- **Crop mode hides the colours and the drawing hint** and swaps the top row
  for its own Cancel / Crop ✓, so there is no doubt what Cancel cancels — and
  the picture gets the room back.
- **`tests/photoedit.mjs` is a new suite, because this editor had NONE.** It
  lives in cloud-sync.js, so nothing was driving it. The image is four coloured
  quadrants: a crop is proved by WHICH COLOURS SURVIVE, not by size — a size
  check passes just as happily on a crop of entirely the wrong region.

## 2026-08-16 (h) — Add Defects gets the same one-line address as View Defects

- **Spiro, with the two screens side by side:** "The address on one goes across
  two lines, whereas the other stays on one. I prefer it on the one just so
  it's more compact."
- **Add Defects was printing `formatAddress()` at 20px** — street + SUBURB +
  job number — which wrapped. View Defects has used `hdr-inline` since
  2026-08-02: it drops the suburb, keeps the job number un-ellipsised, and
  `fitLotTitle()` steps 17px→14px rather than taking a second line.
- **Add Defects now uses the same thing.** No new CSS and no new helper; it was
  a one-line markup change to the class and the title builder. The suburb is
  the part that goes, and it is the part you never need — you are standing at
  the house.
- **Measured on the real address that prompted it** ("Lot 218, (14) Red Fruit
  Street, Clyde North - 305942"): two lines to one, both screens now identical
  at 17px. A 47-character address steps to 14px and still holds one line.
- **The `›` needed a margin, not a space.** Leading whitespace collapses at the
  start of a flex item — the CSS already said so about the job number — so the
  space in the trailer was doing nothing and the arrow sat against `305942`.
- **A header that never scrolls away pays for its height on every screen.**
  That was the argument for hdr-inline in the first place; it applies at least
  as much to the screen where you are typing.

## 2026-08-16 (g) — replace and remove a plan, from a ⋯ menu

- **Spiro: "Ability to remove plan or re-upload/edit."** Three actions on the
  same file, so one menu rather than three more buttons in a footer that is
  already full — and the `↻` reload folds in with them, since it belongs to the
  same group.
- **Drawn INSIDE the plan overlay, not through `impOverlay`.** The shared modal
  is `z-index:100001` and this viewer is `100004`. That has now bitten three
  times in this feature (the defect picker, the photo editor, toasts), so the
  menu is a CHILD of the overlay: it cannot be behind something it is inside.
- **Replace goes through the same `_planDoUpload` as a first attach**, so the
  two cannot drift apart — one path, one set of rules (PDF only, 50MB, upsert),
  one cache invalidation.
- **Remove asks first**, in the job's own words, and says the plan comes off for
  everyone. Afterwards the viewer closes and the job is back to the attach
  screen, not an error.
- **Manager-only, both.** A supervisor's menu has the reload and nothing else —
  the same split the bucket's RLS enforces anyway.
- **The suite had no `dialog` handler**, so Playwright was silently DISMISSING
  the confirm and the remove never ran. The check failed for the right reason by
  accident; it now accepts the dialog and asserts the storage path.

## 2026-08-16 (f) — the ✕ stops floating and sits on its field

- **Spiro: "the red little cross… needs to be on the top corner of the input
  field, at the moment it seems to be above it."** On his phone it was drawn
  about 200px high, up in the address header.
- **It was `position:fixed`, re-placed on scroll.** iOS shifts fixed elements
  while the keyboard is up, so the coordinates it had been given were measured
  against a viewport that had since moved. Scroll and visualViewport listeners
  chased it and still lost.
- **It is now `position:absolute` inside the FIELD'S OWN PARENT**, which is made
  a positioning context if it is not one already (and put back on hide). The
  browser keeps it on the field because it is part of the field's box — nothing
  to re-place, nothing to go stale. Measured: the offset is byte-identical
  across six scroll positions and under a simulated keyboard shift, where before
  it was recomputed each time.
- **All the scroll / resize / visualViewport listeners are DELETED**, as with
  the defect suggestion list.
- **Third time this exact lesson has landed** — Bulk Import's chips, the
  suggestion list, now this. **`position:fixed` that has to track a moving
  element is a bug waiting for a phone to find it.** Anchor it in the DOM and
  let the browser do the work.
- **It no longer has to out-rank every overlay** either. Sitting inside the
  field's parent, it stacks with the field wherever the field lives, so the
  z-index went from 100003 to 6.

## 2026-08-16 (e) — pinch to zoom; and Mark up was opening behind the plan

- **"When I press on markup, it doesn't allow me to do anything."** Two silent
  failures stacked. The photo editor is `z-index:100000`, the plan viewer is
  `100004` — so Mark up opened the editor BEHIND the plan. And the toast that
  would have explained anything was `z-index:2000`, behind everything, so even
  "Add a defect on this job first" was invisible.
- **The plan viewer now steps aside for the editor** and comes back if you
  cancel — the same fix the defect picker needed. **THIRD time this z-order trap
  has bitten in this feature.** The rule: anything opened from a screen at
  100004 has to be checked against it, and a full-screen overlay hides more
  than it looks like it does.
- **Toasts moved to 100010.** A toast that cannot be seen is not a message; it
  is silence with extra steps.
- **Pinch to zoom** (Spiro: "similar to how you would in native iPhone"). The
  buttons stay — better with gloves and one hand full — but nobody should have
  to reach for them.
- **CSS-scale during the gesture, re-render once at the end.** Re-rendering a
  12-megapixel canvas on every `touchmove` turns a smooth pinch into a
  slideshow; scaling the existing bitmap is instant and the single redraw
  afterwards makes it sharp.
- **The point under the fingers stays put.** Anchored on the sheet, not the
  screen, so pinching the ensuite does not walk off to the garage.
- **Clamped to Fit at the bottom and the 12MP canvas ceiling at the top**, and
  a two-finger gesture must not also register as a page swipe — all three
  pinned by tests.

## 2026-08-16 (d) — all the plan controls moved to the BOTTOM

- **Spiro, after (c) shipped: "Needs to be at the bottom as the time on the
  smartphone is obstructing."** Padding for `env(safe-area-inset-top)` is the
  textbook fix and it STILL had Back under the clock on his phone.
- **Stopped arguing with the notch.** Back, the job number, the page counter,
  `↻`, Mark up and the zoom controls all sit at the bottom now, in two rows. The
  bottom of a phone has no clock, no island and no inset to negotiate — and it
  is where the thumb already is. The plan itself gets the whole screen.
- **Applies to every plan screen**: the viewer, the sheet index, and the message
  states.
- **The test asserts POSITION, not padding.** Every control must sit below 66%
  of the viewport height; a structural check on a CSS declaration could not have
  caught this, because the declaration was there and correct and it still did
  not work on the device.
- **Why the earlier fix failed is still unconfirmed** — his phone was also
  showing the pre-(c) build (no Attach button), so it may simply never have run.
  Moving the controls makes the question moot, which is the better outcome than
  a fix that depends on `env()` behaving.

## 2026-08-16 (c) — attach a plan from the app, and clear the notch

- **Spiro, standing on a job with the PDF on his phone: "Create ability to drop
  file in".** Being told to find a desktop to attach a file already in your hand
  is the wrong answer, twice over when the whole point of the feature is speed.
- **This REVERSES part of build (u)'s decision.** That said this app would never
  write to `job-plans` — CH Tracker owns plans, one owner beats two. CH Tracker
  still owns them and it is still the same bucket, so there is still exactly one
  copy per job in one place. What changed is that a manager can put it there
  from either end. Recording the reversal rather than quietly overwriting it.
- **Manager-only, mirroring the bucket's RLS** (`CloudPlans.canEdit`). A
  supervisor sees "no plan" and is told where it gets attached; a manager gets
  the picker, and drag-and-drop on a desktop.
- **Same rules as CH Tracker's `uploadPlan`** — PDF only, 50MB, `upsert`, and
  the cached copy on this phone is dropped after a successful attach.
- **"Attach it in CH Tracker" is stripped when the Attach button is shown.**
  Telling someone to go elsewhere directly above the button that does it here is
  a contradiction; the supervisor, who cannot, still gets the sentence.
- **The overlay now pads for `env(safe-area-inset-top)`.** `inset:0` put the
  header UNDER the status bar, with Back overlapping the clock and the Dynamic
  Island. Bulk Import already did this; the plan viewer did not. The page sets
  `viewport-fit=cover`, without which iOS reports no inset at all — the two go
  together, and the test asserts both.
- **This can only be checked STRUCTURALLY.** Headless Chromium has no notch, so
  the computed padding is legitimately 0; the test asserts the declaration and
  the meta tag, not a number.
- **`_planState` now exists from the moment an open starts**, before the PDF has
  arrived, so every control that reaches into `st.pdf` had to learn to do
  nothing rather than throw. Found by a test calling the sheet index on a "no
  plan" screen.

## 2026-08-16 (b) — the plan messages were a dead end

- **Spiro, on a real phone: "Any issue you can see here LOL fix please."** The
  screen said "No plan has been uploaded for this job yet" — full screen, no
  header, no Back, nothing. The only way off it was to force-quit the app.
- **`_planOverlay` rendered the message and NOTHING else.** The header with Back
  is built by `_planRenderShell`, which only runs on the success path. So every
  state that means something went wrong — no plan, no bucket, unreadable PDF,
  no PDF reader — and the loading state too, were all inescapable.
- **The header is now part of `_planOverlay`**, so it exists on every state the
  screen can be in. It also names the job, because "no plan" is more useful when
  you can see WHICH job you are being told about.
- **Leaving mid-load now actually leaves.** The open path awaits a font, a
  download and a parse; a Back during that used to be undone when the fetch
  finished and re-opened the viewer over wherever the supervisor had gone.
  `_planOpenSeq` abandons an open that is no longer wanted.
- **And the message moved up under the header.** Centring it in a full-height
  overlay put it halfway down an empty screen — measured at y=470 of 844,
  now 159.
- **The lesson, again: an error path is a screen too.** Twenty-six suites and
  six of my own screenshots went past this, because I only ever photographed
  the state where everything worked.

## 2026-08-16 (a) — ↻ reload, for a plan replaced in CH Tracker

- **The cache that makes plans work with no signal is exactly what makes a
  REPLACEMENT invisible.** A manager re-uploads in CH Tracker; the phone that
  already opened that job keeps serving yesterday's sheets from the Cache API,
  with nothing to say so. Nothing in this app can know the bucket changed.
- **So the viewer header has `↻`**: drop the cached copy for this job
  (`CloudPlans.forget`), then fetch and reopen. One tap, no settings screen.
- **Found by thinking about the first real use** — attach a set, look at it,
  fix the set, attach again — not by a test failing. It would have bitten
  during exactly the testing this was built for.

## 2026-08-15 (z) — the sheet names were being clipped off the cards

- **Screenshotting the real 23-sheet set showed the index with NO names on it**
  — thumbnails only. The names were correct, extracted, and set on the right
  elements. They were being CLIPPED.
- **The row track was sizing to a fraction of the container**, so with 23 sheets
  each card box came out 55px tall while its contents were 156px. The card is
  `overflow:hidden` for its rounded corners, so the caption below the thumbnail
  was silently cut off. The thumbnails looked perfect, which is why nothing
  looked wrong. Fixed with `grid-auto-rows:max-content`, `align-items:start`
  and `height:max-content` on the card.
- **The 15-sheet fixture did not catch it** because at 8 rows the tracks were
  big enough. It only appeared at 12 rows — i.e. only on a real-sized set.
- **The test now measures the caption's box against its card's box**, not just
  its text. Third time this project has been caught by "in the DOM" not meaning
  "on screen" — Bulk Import's chips, the defect picker behind the plan viewer,
  and now this.

## 2026-08-15 (y) — sheet names come off the title block, learned not guessed

Spiro sent a real 23-sheet Creation Homes set (job 306363) "to help you with
formatting". It rewrote the labelling, twice.

- **The keyword scan was useless on real plans.** Every sheet opens with the
  same boilerplate — the copyright block, the revision table, the house type,
  "CONSTRUCTION DRAWINGS". Scanning the page text matches that on every sheet
  and tells you nothing about which one you are looking at.
- **The real name is IN THE TITLE BLOCK**, drawn in the same spot on every
  sheet: "GROUND FLOOR PLAN", "ELEVATIONS 01", "WINDOW & DOOR SCHEDULE". That
  is the name to show, verbatim — better than any keyword could be.
- **Guessing WHERE the title block is scored 21 of 23.** "Largest text in the
  bottom-right corner" called sheet 6 "HIGH LEVEL ROOF VENT PITCHED ROOF" (a
  callout drawn into the corner) and sheet 21 "1:50" (a scale note).
- **So the field is LEARNED from the document**: the one position that appears
  on nearly every sheet and says something DIFFERENT on each. Constants — job
  number, client name, house type — repeat one value and are rejected. The
  sheet number varies too, but is short and numeric, which the score discounts.
  **23 of 23, exactly as drawn.** It also needs no per-office tuning: a
  different drafting office's title block is learned the same way.
- **Names are extracted before thumbnails.** Text needs no rendering, so all 23
  labels land in well under a second while the pictures are still arriving.
- **The keyword scan survives as the fallback** for a set with no usable field —
  a scan with no text layer, or a single sheet.
- **The real set is NOT in the repo** (`.gitignore`d). It carries a client's
  name and address in the title block, and everything here deploys to the live
  site. `tests/jobplans.mjs` section H runs against it only when it happens to
  be present locally; what the gates run instead is a synthetic fixture built to
  reproduce the TRAPS it exposed — constant fields, a numeric sheet-number
  field, a corner callout larger than the title, a bare scale note. Encode the
  lesson, not the customer's data.

## 2026-08-15 (x) — a plan set is ~15 sheets, not a floor plan

- **Spiro:** "plans are typically about 15 pages and it has everything from
  floor plan to elevations to details to a whole bunch of things… you focused
  on plans. How does that even work?" Correct — the viewer handled the easy
  case. Finding the elevations in a set of fifteen, on a phone, is the job.
- **A SHEET INDEX, reached from the page counter.** Thumbnails of every sheet in
  a two-column grid, tap to jump. The counter in the header became the button
  (`5 / 15 ▾`), which is where you already look to know where you are.
- **Each sheet is LABELLED from its own text**, not just numbered. Fifteen grey
  rectangles all look alike on a phone; "5 ELEVATIONS" does not. pdf.js already
  gives the text layer, so one `getTextContent()` pass per sheet matched against
  a keyword list (ELEVATION, SECTION, BRACING, WINDOW SCHEDULE, …) names them.
  On the 15-sheet fixture it labels 15 of 15 correctly.
- **Thumbnails render one at a time**, so a 15-sheet set paints progressively
  instead of freezing the phone while it does all of them.
- **SWIPE left/right between sheets**, the gesture already used for photos —
  but ONLY when not zoomed in. Zoomed, a sideways drag is a pan across the
  sheet, and stealing that would make a big plan unusable. Pinned by a test.
- **Deliberately NOT a continuously-scrolling PDF.** Fifteen A3 sheets rendered
  into one scroller is a lot of canvas on a phone, and scrolling is the slow way
  to reach sheet 12 anyway. One sheet at a time, with an index to jump and a
  swipe to step, is faster on both counts — and it keeps markup unambiguous
  about which sheet it came off.
- **A markup records the sheet** (`plan-306648-p5.jpg`), so an elevation markup
  is not mistaken for a floor-plan one later.

## 2026-08-15 (w) — three things only a screenshot showed

Taking pictures of the finished plan viewer to show the site found three
things twenty-six green suites had not. All were about what is ON SCREEN,
which is exactly what an assertion against the DOM cannot see.

- **The picker opened BEHIND the plan viewer.** `#plan-ov` is z-index 100004,
  the shared modal is 100001 — so after drawing, the "Attach to which defect?"
  question was underneath and the screen looked frozen. The viewer now steps
  aside while the question is asked, and comes back if you back out. The test
  asked `querySelector` and was satisfied; it now uses `elementFromPoint`.
- **A landscape sheet used a third of the screen.** Plans are landscape and
  phones are portrait, so fitting the width left the sheet as a strip across
  the top with a grey field under it. `⟳` turns it 90° — 37% of the view to
  74%, measured — and a page shorter than the view is now centred in it rather
  than pinned to the top.
- **The toolbar overflowed at 390px and cut the `+` off.** Six controls plus a
  labelled button do not fit. Page navigation moved up beside the page count,
  where it belongs anyway, and only appears on a multi-page sheet.

The lesson is the one this project keeps relearning (Bulk Import, three
builds): a check that queries the DOM proves the element EXISTS. Only geometry
— or a picture — proves it can be seen.

## 2026-08-15 (u) — 📐 the job's plan, one tap from the job

- **Spiro:** "I would use CH tracker to upload the floor plan… and then… I can
  just click of a button bring up the plan using the defects app relative
  because the jobs are the same."
- **THE GATEWAY ALREADY EXISTED. Nothing was built for it.** CH Tracker
  (creation-homes-tracker, migration 101 + `src/lib/jobPlans.ts`) puts ONE plan
  PDF per job in the private `job-plans` bucket, named `{job_number}.pdf`. This
  app already carries that same `job_number` on every address as
  `propertyNumber`, in the same Supabase project under the same auth. So the
  feature is a read against a key that already lines up — no new table, no new
  column, no sync, no correlation to invent.
- **Its RLS is already the right split**: SELECT for any authenticated user,
  writes for managers only. Supervisors read plans here; the manager uploads
  them in CH Tracker. This app never writes to that bucket, deliberately —
  CH Tracker owns plans, and one owner beats two.
- **Rendered with pdf.js**, which this app already loads for report import and
  the service worker already precaches — so no new dependency and it works in a
  dead spot once the app has been online once.
- **The PDF is cached in the Cache API after the first open.** A plan is 2-10MB
  and the supervisor wanting it is in a driveway with one bar; a second open,
  including with no signal at all, is instant and offline.
- **Renders are serialised with a cancel + token.** Two quick taps on + or ›
  otherwise start a second `page.render()` on the same canvas, which pdf.js
  refuses outright — found by the suite, not on a phone.
- **The canvas is capped at 12M pixels, rounded DOWN.** iOS silently gives a
  blank canvas above roughly 16M, and `sqrt()` lands exactly on the limit so
  rounding the dimensions up put it back over.
- **The 📐 went in the top bar, not the toolbar.** Adding it to the View Defects
  toolbar made an eighth control and wrapped to two lines at 320px —
  `tests/shop.mjs` caught it. The plan is a job-level action anyway, which is
  where Add Defects already had it.
- **Markup attaches to a DEFECT** (Spiro's choice when asked). That is the only
  route this app has to the person who has to act on it: a photo on a defect
  travels to the trade in the contractor PDF, next to the wording.
- **It captures what is ON SCREEN, not the whole page.** Zoomed in on a bedroom,
  the useful image is that bedroom; the full sheet would make the circle a
  speck. The crop is the visible intersection of the canvas and the scroller.
- **Straight into the EXISTING photo markup editor** (`CloudPhotos.editPhoto`,
  the one the camera and Bulk Import already use) and out through
  `CloudPhotos.savePhoto`. No second way to draw in this app.
- **The defect is chosen AFTER the drawing**, because you circle the spot and
  then say what it is for. A job with no defects yet says to add one first
  rather than offering an empty picker.

## 2026-08-15 (t) — the suggestion list stops chasing the field

- **Spiro, after testing (s):** "As I scroll up and down the screen, it just
  moves around and it's really cra[p]." Fair.
- **The list was `position:fixed`, so it had to be RE-PLACED on every scroll
  event.** On a phone those arrive late and in bursts during momentum
  scrolling: the list lags the field, snaps to catch up, and mid-flick is
  somewhere else entirely. Builds (r) and (s) each fixed a symptom of chasing —
  first the flip-above, then the height cap — without stopping the chase.
- **It is now IN NORMAL FLOW**, inserted as the element immediately after the
  row being typed in. There are no coordinates: the browser keeps it under the
  field because it IS under the field. Scroll, keyboard, rotation and momentum
  are all free. Measured: the gap stays exactly 6px at every scroll position,
  where before it was recomputed each time.
- **The original justification for `position:fixed` was wrong.** The comment
  said fifteen absolutely-positioned lists inside a scrolling form would be
  clipped, as in Bulk Import. `.defects-container` is `min-height:100vh` with no
  overflow — the PAGE scrolls, there is no clipping ancestor. It bought nothing
  and cost the stability.
- **All the scroll / resize / visualViewport listeners are DELETED.** That is
  the fix, not a tidy-up: nothing to re-place means nothing to get wrong.
- **Found while testing: the list wiped itself out when moving between rows.**
  `focusout` scheduled an unconditional hide 180ms later, so tabbing from one
  defect row to the next showed the new list and then killed it. It now checks
  whether focus actually left the defect rows. Part of "it just moves around".
- **Capped at 236px (~5 rows) and 8 suggestions**, so it reads as attached to
  the field instead of taking the screen — the previous build's cap could grow
  to the whole visible viewport, which is the second screenshot.

## 2026-08-15 (s) — the defect suggestion list is always BELOW the field

- **Spiro:** "the options from dropdown menu seem to hover around. Can you make
  it consistent so that it actually goes below the text so that it's a lot more
  stable and the user can always see what they are typing?"
- **It used to flip above the field** when it judged the room below too tight.
  Two things wrong with that. It measured `window.innerHeight` — the LAYOUT
  viewport, which iOS does not shrink for the keyboard — so the judgement was
  made on space that was not really there. And when it flipped, the list landed
  ON the field being typed in, which is the screenshot.
- **The flip was also the "hovering" itself.** Fifteen defect rows at different
  heights, each choosing its own side: the list moves depending on which row you
  are in. One side always is what "consistent" means here.
- **Room is made by CAPPING THE HEIGHT, not by moving.** `max-height` is now the
  space actually free below the field inside the VISIBLE viewport
  (`visualViewport.offsetTop + height`), floored at 72px, and the list scrolls
  inside that. The old `max-height:40vh` in the popup's own CSS is gone — a vh
  cap measures the layout viewport, the wrong number the moment a keyboard is up.
- **Re-placed on a settle frame.** Focusing an input makes the browser scroll it
  into view AFTER the placement runs, so the first paint was measured against
  where the field was, not where it landed — one frame of visible drift, and
  part of what "hover around" describes. A `requestAnimationFrame` re-place
  fixes it without a timer.
- **Also re-places on visualViewport resize/scroll**, not just document scroll:
  the keyboard opening changes the room below a field without firing either.
- **Trade-off accepted:** a field low on the screen with the keyboard up now
  gets a short list rather than a tall one over the text. That is the trade Spiro
  asked for, in his words — seeing what you are typing beats seeing more options.

## 2026-08-15 (r) — modals sit at the top, and stop at the keyboard

- **Spiro, on the Location picker:** "it needs to bring it up top (like the
  first photo) so that all of the predictive options can be seen."
- **The overlay centred its card**, measured against the LAYOUT viewport — which
  iOS does not shrink for the keyboard. A card centred on an 844px screen sat
  half behind a 336px keyboard, and the matches under the search box ("ent" →
  "Entry") were hidden by it. The same failure as Bulk Import, in a different
  place.
- **Two parts, and the second is what makes it hold.** Top-aligned, so the field
  and everything under it are above the fold whatever the keyboard does; AND the
  card capped to `visualViewport.height`, which DOES shrink, so it can never
  extend behind the keyboard. Top alignment alone would still let a tall card
  run on underneath.
- **Static, not adaptive.** A card that repositions itself when the keyboard
  opens is exactly the jumpiness Spiro objected to on Bulk Import ("it kind of
  jumps up or down the screen"). Pinned means pinned; only the height changes.
- **Applied to the shared overlay, not just Location.** Every modal that uses it
  has a text field, and three of them have a list under that field, so they all
  had the same latent bug. One position for every modal also beats Location
  behaving differently from the rest.
- **`#imp-body.combo-open{padding-bottom:min(440px,56vh)}` stays.** It solves a
  different problem — the CARD clipping its own dropdown — and this change does
  not replace it.
- **The test stands in a keyboard** by shrinking `visualViewport` and firing the
  resize, because headless Chromium has none. Without that the bug is invisible:
  everything fits on a full-height screen, which is how the Bulk Import version
  of this got shipped broken twice.

## 2026-08-15 (q) — one ✕ clears any text field, app-wide

- **Spiro, marking up a screenshot:** "a little cross… to delete the text that
  has been written this is to be a feature across the board no matter what is
  being selected by it. Location supplier or defect description in All defect
  modes… batch defect mode or other."
- **ONE `position:fixed` element for the whole app**, shown against whichever
  field is focused — not a ✕ in the markup of every input. Add Defects alone has
  60 text fields across 15 blocks; a permanent ✕ on each is noise, and an
  absolutely-positioned one inside a scrolling form is the clipping problem that
  took three builds to fix in Bulk Import. Same reasoning, and same shape, as
  the BPI suggestion popup.
- **Tying it to FOCUS is what makes "across the board" true without touching
  any markup.** Bulk Import builds its rows in JS, the modals build theirs on
  open, and neither needed a line changed. Any field added later is covered for
  free.
- **It listens on `touchstart`/`mousedown`, not `click`, with the default
  prevented.** A click would blur the field first, which fires the dropdown-hide
  timers and bounces the keyboard shut — the user would have to tap back in to
  keep typing. The synthesised click is then swallowed too, because iOS
  suppresses it after a prevented touchstart and a desktop browser does not;
  without that, the app's "close dropdowns on any outside click" handler behaves
  differently on the two.
- **Clearing dispatches a real `input` event** rather than just blanking
  `.value`, so each field's own `oninput=` runs and the autocomplete, the BPI
  suggestions and the bulk row state update exactly as if the text had been
  deleted by hand.
- **The field gets 34px of right padding while the ✕ is up**, restored on the
  way out, so the caret never runs under it.
- **Off for read-only, disabled, checkbox and date fields, on for textareas**,
  and any field can opt out with `data-no-clear`.

## 2026-08-15 (p) — contractor ids collided across phones, destroying rows

- **Spiro:** "when I've actually shared in the past they may have shared but
  that this still remains for some reason." It was not the Share button.
- **`db.addContractor` allocated `Math.max(...ids) + 1`.** Every phone pulls the
  SAME contractor list, so max+1 is not racy — it is DETERMINISTIC. Two
  supervisors adding a contractor between syncs get the same id with certainty.
- **That id is the cloud's `legacy_id`, and the diff engine inserts with
  `upsert(onConflict: 'legacy_id')`.** So the second phone's push OVERWROTE the
  first contractor's row wholesale. Reproduced in `tests/contractorid.mjs`
  section B before the fix: two contractors in, one row out, the other silently
  destroyed. Where the overwritten row was one a manager had already shared,
  `is_shared` went back to false and it reappeared in Contractors to review —
  the reported symptom.
- **The fix is NOT a timestamp: `legacy_id` is an int4.** `Date.now()` overflows
  it. Ids are drawn from a high random band (1.1e9–2.1e9), clear of the small
  seeded ids and of `hashId()`'s 1e6–1.001e9 range, and under 2^31. Trades got
  the same treatment — same allocator, same conflict key, same latent bug.
- **A new allocator does nothing for the collisions already in the data**, which
  are the ones biting now: every pre-fix contractor carries a low id on every
  phone. So `healContractorIdCollisions` runs before the contractors push — any
  row about to be INSERTED whose legacy_id is held in the cloud by a
  DIFFERENT-NAMED contractor is renumbered locally, with this device's defects
  repointed, so neither contractor is lost.
- **Same id AND same name is left alone.** That is a genuine re-push after an
  id-map loss, which is exactly what the upsert exists for; renumbering it would
  duplicate the contractor. Pinned by a check in section D.
- **This is the same bug class defects were hardened against on 2026-08-02**
  (`deletesOnly: true` + direct-write `commitDefect`, "so a stale local copy can
  no longer push an insert/update that reverts a change made elsewhere").
  Contractors never got that treatment, because they still need the diff engine
  for inserts. This is the contractor-shaped version of that fix.
- **Not fixed here: rows already destroyed in the live database.** An overwrite
  that has already happened is not recoverable from the app — flagged in TASKS.

## 2026-08-15 (o) — Contractors to review collapses to a header

- **Spiro, with six waiting:** "they don't need to be brought up as a list. It
  can just be a header and when I click into it you can show a complete list."
  Six rows at ~62px each pushed every other Settings card off a phone screen —
  Assignable Trades now sits at y=277 in an 844px viewport instead of below the
  fold, and it is measured in `tests/pendingcontractors.mjs`, not assumed.
- **The count stays in the header.** "(6)" is the only thing a manager needs
  from the card without opening it — is there anything waiting. Collapsing it
  to a bare title would have traded one problem for a worse one.
- **No chevron and no count when the queue is empty**, just "Nothing to review
  right now." An expander that opens onto nothing is a wasted tap.
- **Same pattern as Assignable Trades directly below it**, deliberately — a
  second collapse idiom on one screen would be the actual design mistake.
- **Nothing about sharing changed.** Worth writing down since it prompted the
  question: this card is a QUEUE, not a record. A supervisor-added contractor
  sits in it (`isShared === false`) until a manager taps ✓ Share, which writes
  to the cloud, WAITS for confirmation, and only then drops the row for good. A
  refused write is rolled back so the card keeps telling the truth. Rows still
  showing have NOT been shared.
- **The card had no test at all before this.** It has one now, including the
  rollback path, which was previously covered only by the comment above
  `shareContractor`.

## 2026-08-15 (n) — the wordings screen is manager-only, card and all

- **Spiro, on seeing (m): "Manager only."** Build (m) let supervisors open the
  screen read-only, on the reasoning that they should know what they will be
  offered. Overruled: the card is now hidden from them and the screen refuses
  them if reached another way.
- **Gated on `CloudJobs.isManager()`, not `CloudWordings.canEdit()`.** The
  first is the role check every other admin card in Settings already uses and
  it falls back to `cachedIdentity.role`, so a manager opening the app before
  the first sync lands still sees their own card. The second additionally
  requires the shared table, which is the right gate for WRITING and the wrong
  one for LOOKING.
- **The screen re-checks rather than trusting the card.** `showWordingsEditor()`
  is a plain function on a page a supervisor has loaded; hiding the button is
  not access control. Server-side, RLS was already the real boundary — this is
  the UI catching up to it.
- **`CloudWordings.canEdit()` picked up the same `cachedIdentity` fallback**
  the app's other role checks have. Bare `userRole` is null until the profile
  fetch returns, so a manager could land on "read-only" for the first second
  of a cold start and think the migration hadn't run.
- **Supervisors lose nothing they use.** The wordings still reach them as
  suggestions while typing, which is the whole point of the list; only the
  screen that edits it is gone.

## 2026-08-15 (m) — the wording list moves out of the code and into Settings

- **Spiro's ask, in his words:** "create a feature in the settings that allows
  you to edit these so under the certain trade categorise the respective items
  and then as part of that future I can add a defect or remove a defect Edit a
  comment". A screen, not a code edit, and grouped by trade.
- **Shared through Supabase, not per-phone** (Spiro picked B over device-local).
  New table `dm_defect_wordings`, migration
  `supabase/migrations/2026-08-15_defect_wordings.sql`, seeded with the same 62
  items. A supervisor's phone gets the manager's edit on its next sync; a list
  that drifted per device would defeat the point of standardising wordings.
- **Managers write, everyone reads.** RLS gates writes on
  `profiles.role = 'manager'`, matching every other admin surface in the app.
  Supervisors still open the screen and see exactly what they will be offered —
  hiding it would leave them guessing why a suggestion never appears.
- **The 62 stay compiled into index.html as a fallback.** `defectWordingList()`
  reads the cloud when it is ready and the built-in list otherwise, so the app
  works before the migration is run, offline, and in local-only mode. The screen
  says "Read-only — the shared list isn't set up yet" and names the .sql file
  rather than silently pretending edits saved.
- **Unassigned items go to Supervisor** (Spiro: "defects that are not assigned
  under a trade to be go as Supervisor"). The column defaults to it, so a row
  can never be trade-less and invisible.
- **A trade no contractor answers to is FLAGGED, not hidden.** Spiro: "with the
  trades they need to match exactly how they are written in the database". A
  wording under "Landscaper" when nothing is a Landscaper can never be reached
  by picking a supplier — it just quietly does nothing. The section goes amber
  and says why. Four of the shipped trades (Bricklayer, Tiler, Renderer,
  Landscaper) are exactly this case until they are confirmed to exist.
- **Delete is a soft delete** (`active=false`), like the rest of the app. A
  wording removed by mistake is one SQL update away from coming back.
- **Trade-off accepted:** two sources of truth for the list. It is deliberate —
  the fallback is what keeps the feature alive before the migration and offline
  — but a divergence is possible, so the seed is guarded
  (`where not exists`) and re-running the migration cannot duplicate rows.## 2026-08-15 (j) — the BPI suggestion list is withdrawn (the source had locations baked in)

- **What real data showed, within the hour of (i) shipping:** the suggestions
  worked mechanically and were useless in practice. Every observation in
  `bpi_training_examples` carries its location inside the text — "Laundry
  Adjust door rattle", "Bedroom 4 Margin", "Laundry Fully knock down bottom
  hinge pin." This app has a SEPARATE Location field, so accepting any
  suggestion duplicated the room into the description. Site's verdict:
  "no point having location in the description… remove the list for now."
- **Removed the SOURCE, kept the ENGINE.** `CURATED_DEFECT_WORDINGS` in
  index.html is now the corpus and ships EMPTY, so the feature is completely
  invisible — no popup, no dropdown, typing exactly as before. The ranking,
  trade-narrowing, both screens' UI and all their tests stay. A curated list
  is a one-place data drop, not a rebuild.
- **Did NOT try to strip the location prefix off the BPI text.** It was
  tempting and would have been wrong: room names are not a fixed prefix
  ("Left Elevation", "Garage External PA door"), stripping them heuristically
  would mangle real wordings, and the site had already decided. Guessing at a
  cleanup nobody asked for, on data I cannot see, to rescue a source that was
  rejected on other grounds too, is how a fix becomes a second problem.
- **The `bpi_training_examples` PULL is gone as well**, not just unused. It
  was 4000 rows on every sync for a feature that now shows nothing — dead
  download on a phone on site. The pre-existing WRITE path
  (`CloudLearning.record`) is untouched; corrections still train CH Tracker.
- **A test now pins the empty state** (`bpidesc.mjs` section G reads the
  shipped source). If someone later fills the list, that check fails and
  makes them confirm it was deliberate — the list going live is a decision,
  not something to happen by accident.
- **Trade-off accepted:** two builds' work now sits dormant behind an empty
  array. Cheaper than the alternative — supervisors were being offered
  suggestions that would have put "Laundry" in a description field sitting
  directly under a Location box already reading "Laundry".

## 2026-08-15 (i) — BPI defect-wording suggestions on both entry screens

- **The ask:** as a supervisor types a defect, suggest real BPI wordings from
  CH Tracker's history, narrowed to the trade of whichever contractor is
  selected, narrowing further with each word typed. Free typing must still
  work. Both the regular Add Defects screen and Bulk Import photo tagging.
- **The corpus is `bpi_training_examples`, NOT `dm_trade_learning`** — and
  this was the one finding that decided whether the feature was buildable at
  all. `dm_trade_learning` is what the app already pulled, but it stores only
  `phrase_key`, which `normalizePhrase()` has already stripped of
  punctuation, room words and stopwords: "Left Elevation Caulk the gap to
  barge eave and fascia." survives as "caulk gap barge eave fascia" and can
  never be reconstituted into something to put in front of a human.
  `bpi_training_examples.observation` keeps the original text and is exactly
  what the Training tab in the screenshot lists. The app already WROTE to
  that table (`CloudLearning.record`) and had never read it back.
- **Capped at the newest 4000 examples, deliberately not `selectAllRows`.**
  That table is append-only and grows with every correction anyone ever
  makes. Paging all of it onto a phone on site, on every sync, would be an
  unbounded and steadily worsening download for a convenience feature. The
  cap degrades safely: fewer suggestions, never a stalled sync.
- **Deduped by text, counted, most-used first.** The same wording logged
  fifty times becomes one suggestion with n=50. That count is what makes
  "the regular BPI items" float to the top, which is the point of sourcing
  this from real history rather than a hand-written list.
- **Trade resolution handles both shapes the picker can produce:** a trade
  placeholder (name IS the trade) and a real company categorised under one
  (first entry of its `trades` string). "No Trade Assigned" resolves to no
  trade rather than to that literal string.
- **Narrowing reuses `matchesSearch`**, the app's existing word-prefix
  matcher, so every extra word can only ever shrink the list — the behaviour
  that makes this faster than typing the sentence out — and partial words
  work ("skirt" finds "skirting").
- **Suggests nothing when there is no signal.** No trade AND nothing typed
  returns nothing rather than "most common overall", which would be noise.
- **One shared `position:fixed` popup for the regular screen's 15 rows**, not
  a dropdown each. Fifteen absolutely-positioned lists inside a scrolling
  form is precisely the clipping problem that took three builds to fix in
  Bulk Import; a fixed popup is measured against the viewport and cannot be
  cut off by an ancestor's overflow. It flips above the field when the
  keyboard leaves no room below.
- **Trade-off accepted:** suggestions are only as good as the training data.
  A trade with no history in the newest 4000 examples suggests nothing and
  the supervisor types as they always did — the feature is strictly
  additive, and typing is never blocked or replaced.

## 2026-08-15 (h2) — fields above the photo in Bulk Import

- **The site's own suggestion, taken:** "move the description to the top…
  the photo you have to scroll up to see… leave the selection and the
  predictive buttons in visible area." The photo now sits AFTER the three
  fields in the scroll area instead of above them.
- **Why this on top of the (h) scroll fix rather than instead of it.** They
  do different things and the honest measurement says both are needed at the
  viewport from the actual screenshot (~275px of scroll area, tighter than
  the ~348px an iPhone 14 leaves on paper). The reorder frees the photo's
  height from above the chips; the scroll makes up what is still short. Alone,
  neither is enough there.
- **Resisted the overclaim.** The first version of this test asserted the
  chips fit "with ZERO scrolling — the reorder, not the scroll, is doing
  this." Measuring properly killed that: with the photo collapsed to a 72px
  thumbnail the OLD order also fits on a roomy screen, so the reorder is a
  contribution, not a cure. The check now measures the space actually freed
  and says so, and the real guarantee is asserted at the real viewport.
- **The test's photo understates the real gain**, and the threshold says so:
  the suite's fake File renders as a broken-image placeholder a few px tall,
  freeing ~36px, where a device frees the full 72px thumbnail plus margins.
  Better a modest threshold that is true than a big one this environment
  cannot produce.
- **Trade-off accepted, and it is a real one:** the photo is no longer the
  first thing on screen — at rest you see the fields and scroll down for the
  photo. Asked for explicitly, and the header still says which photo you are
  on ("Photo 1 of 3"), but it IS a downgrade for anyone who wants to eyeball
  the photo while typing the description. Watch for that.

## 2026-08-15 (h) — the chips fix, third attempt: the keyboard opens AFTER the focus

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
