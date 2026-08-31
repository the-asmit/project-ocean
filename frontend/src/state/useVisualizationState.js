import { create } from 'zustand'

// Single source of truth for everything the UI and scene share.
export const useVisualizationState = create((set) => ({
  // --- dataset selection -----------------------------------------------
  region: 'bengal',         // Bay of Bengal, India east coast (has real coastline)
  date: '2026-06-11',   // near the end of the GLORYS12V1 archive (to 2026-06-23)
  variable: 'thetao',
  setVariable: (variable) => set({ variable }),
  // A region is either a named tile or `bbox:lonMin,lonMax,latMin,latMax`.
  // World coordinates mean something different in every tile, so any pin or
  // hover from the old one has to go.
  // The slice resets too: level counts and seafloor depth differ per tile, so
  // an index from the old one would point at a different depth in the new one.
  setRegion: (region) =>
    set({ region, selected: null, hover: null, depthClip: 0, clipIndex: 0,
         westIndex: 0, selectedFloatId: null, isoStats: null }),

  // True while a tile is being fetched/derived. The previously loaded dataset
  // stays on screen underneath — a frozen block with no feedback is worse than
  // an old block with a spinner over it.
  loading: false,
  setLoading: (loading) => set({ loading }),

  // --- loaded data ------------------------------------------------------
  dataset: null,            // { meta, field, lut, height, bathy, sampler }
  loadError: null,
  setDataset: (dataset) => set({ dataset, loadError: null }),
  setLoadError: (loadError) => set({ loadError }),

  // --- render controls (defaults carried over from the tuned spike) -----
  depthClip: 0,             // world Y; 0 = no clip
  // The slice snaps to real model levels, so the INDEX is what the UI drives
  // and depthClip is derived from it. Keeping both avoids round-tripping a
  // float back through the depth curve to work out which level we are on.
  clipIndex: 0,             // 0 = no slice, else 1-based index into sliceStops
  sliceExtended: false,     // allow slicing below the variable's depth extent
  // The west-east cut, independent of the depth cut: each removes its own part
  // of whatever geometry the other has left.
  westIndex: 0,             // 0 = no cut, else 1-based index into westStops
  // Shared because the expanded 3D view covers the right rail and has to mount
  // its own copy of the section controls; both need to know which is on screen.
  sceneExpanded: false,
  // Which field the Profile/Transect panels describe.
  //
  // Location and subject are separate questions: hover/pin choose WHERE, this
  // chooses WHAT. Pinning deliberately does NOT set it — otherwise choosing a
  // location to inspect currents at would itself snap the panel back to the
  // scalar field, and the two gestures would fight.
  //
  // Set automatically by explicit layer gestures (turning currents on/off,
  // touching the timeline, moving a slice slider) and overridable by hand from
  // the switcher in the panel header. A float selection outranks it entirely.
  //
  // 'field' is whichever SCALAR variable is loaded, not temperature
  // specifically — it was named 'temperature' when thetao was the only one.
  panelLayer: 'field',         // 'field' | 'currents'
  setPanelLayer: (panelLayer) => set({ panelLayer }),
  // in-situ observations (mock source for now — see ObservationSource.js)
  showArgo: true,
  selectedFloatId: null,
  // --- isosurface (marching cubes over the same volume) -----------------
  // Off by default: it is a derived layer, and nothing about an existing
  // view should change until the user asks for it. The value is set to the
  // tile's own range on load — 20 deg C where the tile contains it (the D20
  // thermocline proxy the spec names), else the middle of what it has.
  showIso: false,
  isoValue: 20,
  isoStats: null,          // { triangles, vertices, ms, empty } from the mesher
  density: 0.022,           // Beer-Lambert extinction per world unit
  // The diorama needs real vertical presence (at 1x a 600 km x 3.5 km tile is a
  // pancake) without becoming a cube. 8x reads as a wide slab and still leaves
  // the 0-454 m data band about 40% of the block's height.
  vertExag: 8,              // extra vertical scale on top of the depth curve
  showContours: true,       // isotherm contour lines on the cut faces
  showDetail: true,         // synthetic sub-grid seafloor texture (P3)
  setDepthClip: (depthClip) => set({ depthClip }),
  setSlice: (clipIndex, depthClip) => set({ clipIndex, depthClip }),
  setSliceExtended: (sliceExtended) => set({ sliceExtended }),
  setWestIndex: (westIndex) => set({ westIndex }),
  setSceneExpanded: (sceneExpanded) => set({ sceneExpanded }),
  setShowArgo: (showArgo) => set({ showArgo }),
  setShowIso: (showIso) => set({ showIso }),
  setIsoValue: (isoValue) => set({ isoValue }),
  setIsoStats: (isoStats) => set({ isoStats }),
  // selecting a float clears the field pin: the profile panel shows one
  // subject at a time, and two highlighted things would be ambiguous
  setSelectedFloat: (selectedFloatId) => set({ selectedFloatId, selected: null }),
  setDensity: (density) => set({ density }),
  setVertExag: (vertExag) => set({ vertExag }),
  setShowDetail: (showDetail) => set({ showDetail }),
  setShowContours: (showContours) => set({ showContours }),

  // --- camera -----------------------------------------------------------
  // Single definition of the opening framing. The Home button, the H key and
  // the initial mount all reset to exactly this.
  //
  // Orbit framing for the bounded block: a 3/4 view that shows the top surface
  // and two cut faces at once. Stored as orbit parameters, not a fixed point,
  // so it re-frames correctly when vertical exaggeration changes the height.
  homeOrbit: { az: 118, el: 25, dist: 430 },
  homeNonce: 0,
  goHome: () => set((s) => ({ homeNonce: s.homeNonce + 1 })),

  // The dashboard 3D panel is orbit-only — you walk around a display object.
  // FreeFlyCamera.jsx is kept for the future fullscreen deep-dive.
  flySpeed: 18,             // world units / second (deep-dive mode)
  setFlySpeed: (flySpeed) => set({ flySpeed }),

  // --- interaction ------------------------------------------------------
  hover: null,              // { world:[x,y,z], lat, lon, depthM, value, kind }
  selected: null,           // same shape, pinned on click
  setHover: (hover) => set({ hover }),
  // The depth cursor travels down the pinned column. It starts at the level
  // nearest the click, so pinning a point never moves the readout off the
  // depth the user actually aimed at.
  probeIndex: 0,            // index into the real model levels
  setProbeIndex: (probeIndex) => set({ probeIndex }),
  // Pinning a point clears any selected float, the mirror of setSelectedFloat
  // clearing the pin. The profile panel shows ONE subject; without this, a pin
  // set after a float selection left the InfoPanel reading the new point while
  // the chart still showed the old float comparison.
  setSelected: (selected, probeIndex = 0) =>
    set({ selected, probeIndex, selectedFloatId: null }),
  clearSelected: () => set({ selected: null, probeIndex: 0, selectedFloatId: null }),
}))

// The live store, for tests and the console. A dynamic import() of this module
// from a test can resolve to a SECOND instance with pristine defaults, which
// reads as "nothing changed" no matter what the app is actually doing.
if (import.meta.env.DEV) window.__store = useVisualizationState
