# Defect wording list — DRAFT for Spiro's final edit

Rewritten from the inspection checklist into the way a supervisor writes a
defect they have just seen. **62 items across 12 trades**
(your 33 questions, with the compound ones split - a supervisor logs one
thing per line).

**This file is not live.** Nothing here reaches the app until the edited
version goes into `CURATED_DEFECT_WORDINGS` in `index.html`.

## How to edit

- Edit any line freely, delete what you don't want, add new ones.
- Keep the `## Trade` headings — everything under a heading is logged to that
  trade. Move an item by moving the line under a different heading.
- **No location in the wording.** The app has a separate Location field; a
  wording like "Laundry adjust door rattle" would double it up. That is why
  the first attempt at this feature was withdrawn.
- **Trade headings must match a contractor / trade placeholder name exactly**
  ("Carpenter", not "Carpentry"), or items under it will never appear.
- Send it back however suits — edited file, screenshot, or just the changes.

---

## Painter

Seal external window architraves to comply with NCC energy efficiency requirements.
Complete outstanding internal paint items.
Complete outstanding external paint items.
Paint raw timber inside striker plate.
Seal tops and bottoms of doors, including wet areas.
Apply gloss to robe threshold.
Apply gloss where missed.
Clean overpaint from hinges and striker plates.
Clean overpaint from splashback tiles.
Clean overpaint from window frames.
Clean overpaint from entry door glass.
Remove paint from garage floor.
Refit weather strips and seals to doors.

## Carpenter

Adjust striker plate to remove latch binding.
Adjust door margins to 3mm-4mm.
Align door with jamb.
Fit door handle and check for operation.
Fit weather seal to door.
Install cushion stop to door.
Adjust and align cabinet doors.
Replace tarnished hinges.
Replace incorrect screws - sizes to be consistent throughout.
Refit manhole cover.
Knock down hinge pins.

## Caulker

Caulk junction between brickwork and plaster to sides of garage door.
Caulk gaps between cladding and flashing.
Seal service penetrations.
Caulk inside of sink.
Caulk gaps to window, top and bottom.
Caulk top of tile to wall where tiling does not reach ceiling.
Complete outstanding caulking.

## Cleaner

Clean carpet.
Clean flooring.
Sweep out garage and remove building materials.
Remove paint, plaster and mortar residue from garage.

## Brick Cleaner

Clean brick smears.
Clean out weepholes.

## Bricklayer

Repair brickwork blow outs.

## Plumber

Install downpipe level and seat in saddle.
Install downpipe brackets correctly.
Punch in downpipe pins.
Connect downpipe hookup.
Install plumbing fixture correctly.
Tighten shower rail - no gaps to wall.
Install mixer and cover plate level.
Rectify water hammer.
Clear tile and debris from shower waste.
Install toilet level with wall.
Seal plumbing penetrations in cabinetry.

## Electrician

Seal electrical penetrations in cabinetry.
Check run time switch is functional.

## Tiler

Grout tiles to wall above shower.

## Renderer

Rule a horizontal line through render where it breaches the DPC.
Clear bottom weep holes to comply with VBA Standards and Tolerances.

## Landscaper

Regrade landscaping to fall away from the property.
Compact landscaping correctly.
Repair damaged stormwater riser.
Clear debris and excess materials from nature strip.

## Supervisor

Seal hole in oven space to make vermin proof.
Repair dented window frame.
Repair scratched window frame.
Touch up window frame with correct paint colour.

---

# Open questions

Answer inline or ignore - I'll ask again if it matters.

**1. Trade names.** I mapped your headings to what the app expects:
`Caulking` -> `Caulker`, `Cleaning` -> `Cleaner`, and split
`Plumbing & Electrical` into `Plumber` + `Electrician`. Confirm.

**2. Trades I invented headings for**, because those items sat under no
heading in your list: `Bricklayer`, `Tiler`, `Renderer`, `Landscaper`.
Do these exist in your system? If not, say where the items should go.

**3. Your brickwork question spanned two trades** - smears and weepholes read
as Brick Cleaner, blow outs as Bricklayer. Split accordingly. Correct?

**4. Two of your own notes I did NOT guess at:**
- "Has the inside of the sink been caulked? *Is this just for undermounts?*"
  Written plainly for now. If it is undermount-only, the wording should say so.
- "...as per the VBA's Standards and Tolerances. *What clauses? Should we
  specify what we are asking?*" Left generic. Give me clause numbers and I
  will put them in.

**5. One overlap, both from your list:** "Remove paint from garage floor"
(Painter) and "Remove paint, plaster and mortar residue from garage"
(Cleaner). Keep both, or drop one?

**6. RESOLVED - the four unassigned items go to Supervisor.** Spiro's rule:
anything not owned by a specific trade is Supervisor. Worth noting an existing
BPI classifier rule in index.html already routes window-frame touch-up and
scratch defects to Supervisor, so this matches what the app already does.

**7. Ranking.** Items currently have no priority - they will list
alphabetically within a trade. If some are far more common than others, mark
them and I will float those to the top of the list.
