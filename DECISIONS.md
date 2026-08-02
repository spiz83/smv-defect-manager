# Decisions Log

Newest at top. Format: date — decision — why — trade-off accepted.

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
