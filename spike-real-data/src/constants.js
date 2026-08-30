// Domain box — IDENTICAL to the proven spike (do not change).
export const BOX_MIN = [-120, -6, -120]
export const BOX_MAX = [120, 0, 120]

// Seafloor-height normalisation range. FLOOR_MAX raised to 0.0 (was -0.35) so
// land columns — encoded as world-Y 0 by the adapter — normalise cleanly to 1.0.
export const FLOOR_MIN = -6.0
export const FLOOR_MAX = 0.0

// Colour-ramp range in °C. Real GLORYS thetao in these tiles spans ~9.7–30 °C;
// 8–31 gives the ramp a little headroom on both ends. (adapter uses the same.)
export const TEMP_MIN = 8.0
export const TEMP_MAX = 31.0
