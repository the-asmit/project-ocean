import { create } from 'zustand'

// Single source of truth for everything the UI and scene share.
export const useVisualizationState = create((set) => ({
  // --- dataset selection -----------------------------------------------
  region: 'bengal',         // Bay of Bengal, India east coast (has real coastline)
  date: '2020-01-01',
  variable: 'thetao',
  setVariable: (variable) => set({ variable }),
  setRegion: (region) => set({ region }),

  // --- loaded data ------------------------------------------------------
  dataset: null,            // { meta, field, lut, height, bathy, sampler }
  loadError: null,
  setDataset: (dataset) => set({ dataset, loadError: null }),
  setLoadError: (loadError) => set({ loadError }),

  // --- render controls (defaults carried over from the tuned spike) -----
  depthClip: 0,             // world Y; 0 = no clip
  density: 0.022,           // Beer-Lambert extinction per world unit
  // The diorama needs real vertical presence: the tile is 550 km across and
  // 3.5 km deep, so at 1x it is a pancake. 12x makes it a block you can read.
  vertExag: 12,             // extra vertical scale on top of the depth curve
  showContours: true,       // isotherm contour lines on the cut faces
  showDetail: true,         // synthetic sub-grid seafloor texture (P3)
  setDepthClip: (depthClip) => set({ depthClip }),
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
  homeOrbit: { az: 40, el: 25, dist: 430 },
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
  setSelected: (selected) => set({ selected }),
  clearSelected: () => set({ selected: null }),
}))
