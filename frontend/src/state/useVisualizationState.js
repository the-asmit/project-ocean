import { create } from 'zustand'

// Single source of truth for everything the UI and scene share.
export const useVisualizationState = create((set) => ({
  // --- dataset selection -----------------------------------------------
  region: 'coastal',
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
  vertExag: 1,              // extra vertical scale on top of the depth curve
  showDetail: true,         // synthetic sub-grid seafloor texture (P3)
  setDepthClip: (depthClip) => set({ depthClip }),
  setDensity: (density) => set({ density }),
  setVertExag: (vertExag) => set({ vertExag }),
  setShowDetail: (showDetail) => set({ showDetail }),

  // --- camera -----------------------------------------------------------
  // Single definition of the opening framing: low in the water column looking
  // west across the shelf toward Sri Lanka. The Home button, the H key and the
  // initial mount all reset to exactly this.
  homePose: { position: [34, -1.3, -14], target: [-58, -2.7, 8] },
  homeNonce: 0,
  goHome: () => set((s) => ({ homeNonce: s.homeNonce + 1 })),

  navMode: 'fly',           // 'fly' | 'orbit'
  setNavMode: (navMode) => set({ navMode }),
  toggleNavMode: () => set((s) => ({ navMode: s.navMode === 'fly' ? 'orbit' : 'fly' })),
  flySpeed: 18,             // world units / second
  setFlySpeed: (flySpeed) => set({ flySpeed }),

  // --- interaction ------------------------------------------------------
  hover: null,              // { world:[x,y,z], lat, lon, depthM, value, kind }
  selected: null,           // same shape, pinned on click
  setHover: (hover) => set({ hover }),
  setSelected: (selected) => set({ selected }),
  clearSelected: () => set({ selected: null }),
}))
