# Ocean-Viz — Handoff State (continuing in new chat)

## Project
SIH 26067 (INCOIS/MoES) — browser-based 3D ocean data explorer. React/Three.js
frontend + FastAPI backend, real Copernicus GLORYS12V1 data throughout, real
Argo/Glider instrument data, mock data eliminated except where explicitly
labeled otherwise.

## What's DONE and verified this session (don't re-litigate)
- **§5.1** Horizontal slice (SLICE FROM TOP) — real GLORYS levels, geometry-rebuild
- **§5.2** Depth-column probe — full water-column read at any pinned point
- **§5.3** Vertical section — reverted after repeated visual bugs; replaced by
  **SLICE FROM WEST**, same safe geometry-rebuild mechanism as §5.1, plus a
  lightweight ghost-outline showing removed geometry
- **§5.4** Argo floats — real data via Ifremer ERDDAP GDAC (was mock), model-vs-
  float comparison chart, full disclosure (WMO/DAC/data-mode/date-window)
- **§5.5** Isosurface — marching cubes over the real volume, verified to
  sub-quantization accuracy, flat-color-by-isovalue, ghost pass for buried portion
- **Salinity** — second real scalar field (`so`), same machinery as temperature,
  per-tile fitted colorbar (not fixed — measured to be the correct policy),
  isohaline naming, surfaceMedian contrast fix for the top-face lid
- **Real currents** (`uo`/`vo`) — replaced synthetic spike, streamlines with
  traveling arrowheads, demo date shifted to 2026-06-11–06-18 (12 weeks old,
  not the original 6-year-old date)
- **Real gliders** — OceanGliders GDAC via Ifremer ERDDAP. No real deployment
  near the demo tile/date, so: honest empty state + labeled preset jumping to
  the real July 2016 ASIRI campaign (5 deployments, ~8°N). Ribbon rendered as
  TubeGeometry along a CatmullRomCurve3, colored by the loaded variable
- **Chart panel layer-awareness** — Profile/Transect panels now show Temp/
  Currents/Float depending on what's active, with a manual switcher (not pure
  auto), plus frame-date disclosure when currents timeline diverges from the
  model date
- **Fullscreen/deep-dive** — free-fly was tried and reverted (felt broken on
  mouse-drag), fullscreen is orbit-only with SECTION controls mounted there
- **Colorbar editor** — 4 palettes (Ocean/Viridis/RdBu/Mono) via single shared
  DataTexture-based color function (no second color path), custom range
  (clamped to baked range, not refetched), log/linear toggle (disabled below
  zero, honestly caveated as a display choice not physical), full footer
  disclosure for all three when non-default

## Known issues, NOT yet fixed (low priority, queued)
1. **Footer line-wrap glitch** — bottom disclosure footer wraps 2–3 lines when
   certain layers are active (Argo/gliders/currents), pushing Profile/Transect
   panels up, causes a visible jump. Root cause identified (not a browser bug —
   was chased through camera-motion and Brave-vs-Chrome theories before finding
   the real trigger). Fix: reserved min-height on the footer. Queued for item 14.
2. **Scale/colorbar panel missing from fullscreen** — just found via the
   PROJECT_DOCUMENTATION.md audit. SECTION controls got moved into fullscreen
   earlier, but Scale/colorbar was never added — so the new colorbar editor is
   currently unreachable in fullscreen. Needs fixing as part of item 14.
3. **Stale README** — audit found 8 concrete contradictions between README.md
   and the actual implementation (claims salinity/currents are disabled when
   they're live; claims free-fly/raymarching that doesn't exist; wrong endpoint
   count 7 vs actual 14; etc.). Not fixed yet — deliberately deferred.
4. **Dead code** — `VolumeRaymarch.jsx`, `FreeFlyCamera.jsx`, `BathymetryTerrain.jsx`,
   `seafloorDetail.js` are unimported but still in tree. `FreeFlyCamera.jsx` is
   intentionally kept (comment says so); the other three have no such comment.
   Not cleaned up yet — deliberately deferred.

## Sequenced plan (from teammate's 4-item list), current position
1. ✅ Chart panel layer-awareness — done
2. ✅ Salinity — done
3. ✅ Real Argo/Glider data — done
4. ✅ Colorbar editor — done
5. ⏸️ **Item 13 — "Temperature can't be unselected."** Paused. Needs
   clarification from teammate on actual intent before writing any prompt —
   likely means an opacity/visibility toggle on the temperature *coloring*,
   not literally removing the base scalar field (which is structurally
   load-bearing — the block's cut faces, isotherms, and colormap all render
   FROM whichever field is active; there's no "block with nothing on it").
6. ⏸️ **Item 14 — Layout redesign.** Paused, deliberately held until 13
   lands, since new panel needs shouldn't be designed against a soon-to-be-
   redesigned layout. Rough direction already discussed and mocked:
   - Left rail: unchanged (layer/variable toggles only — the "what am I
     looking at" switch)
   - Docked right rail: remove duplicate SECTION controls (they already live
     in fullscreen), replace with a compact live summary dashboard (stat
     cards, mini sparkline profile) instead of leaving the space empty
   - Fullscreen: keeps the full control set, PLUS gains the missing Scale
     panel (see known issue #2 above)
   - Not yet built — was intentionally deferred until 13 clarified and other
     features stopped landing

## Documentation generated
`PROJECT_DOCUMENTATION.md` — full 27-section technical + beginner doc,
generated by Claude Code actually reading the whole repo (both frontend and
backend) plus live API responses, not guessing. Includes a full audit
(§27) listing dead code, README contradictions, unverified assumptions,
and unreachable code branches. This is a solid, honest reference document.

## What's next (as of this handoff)
User is about to share an "operational.md" file for further modification/
review, then plans to design the UI based on that before resuming
implementation — i.e., item 13/14 planning resumes after that document is
reviewed.

## Working style reminders for this project (established over the session)
- Always verify claims with real measurements/screenshots, not assertions
  (this project got burned once — §5.3 — by verifying captions instead of
  pixels, and that lesson visibly carried forward afterward)
- One color/data function per concern — never a second parallel path
- Honest disclosure everywhere — real vs. synthetic vs. derived vs. stylized,
  always labeled, never silently implied
- Prefer proven/reused mechanisms over new ones when extending features
  (e.g. SLICE FROM WEST reused SLICE FROM TOP's exact safe mechanism instead
  of reinventing vertical slicing after §5.3's repeated failures)
- Small, scoped prompts with explicit "explain your plan first, wait for
  go-ahead" for anything nontrivial — has caught several bad approaches
  before code was written
