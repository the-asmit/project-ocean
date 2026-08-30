// Shared domain definition for the spike.
// World-space axis-aligned box that bounds the water column.
//   x: horizontal  (-120 .. 120)  -- deliberately vast so the domain edge never
//                                    enters the frustum from a first-person view
//   y: vertical, 0 = sea surface, -6 = deepest point of the domain
//   z: horizontal  (-120 .. 120)
export const BOX_MIN = [-120, -6, -120]
export const BOX_MAX = [120, 0, 120]

// Y range used to normalise seafloor height for the depth-tint and the mask.
export const FLOOR_MIN = -6.0
export const FLOOR_MAX = -0.35

// Temperature range (deg C) used to normalise the synthetic field into 0..1.
export const TEMP_MIN = 2.0
export const TEMP_MAX = 30.0
