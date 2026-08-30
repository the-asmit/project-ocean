// Single definition of the block's geometry in world space.
//
// The shader, the depth ruler, the point picker and the camera all read this,
// so a depth means the same world Y everywhere. Previously each computed its
// own and the chamfer silently desynced them.
//
// KEY PROPERTY: the data box IS the pair of knife-cut faces. Depth 0 is the
// top face and the deepest sounding is the base of the cut, with nothing
// decorative in between — the torn outer shell displaces away from these
// planes, never into them.
//
//        y = boxMaxY = 0  ┌───────────────┐ depth 0   <- cross-section starts
//                         │   cut face    │
//        y = boxMinY      └───────────────┘ deepest sounding
//                          ~~~ torn base hangs below ~~~
//
// `westCut` is world units removed from the block's west (-X) side, the exact
// counterpart of depthClip removing units from the top. Callers that do not
// care about the horizontal cut can omit it and get the full footprint.
export function blockLayout(dataset, vertExag, depthClip, westCut = 0) {
  const { boxDepth } = dataset.meta.bathymetry
  const { spanX, spanZ, depthToY, yToDepth } = {
    ...dataset.map,
    depthToY: dataset.map.depthToY,
    yToDepth: dataset.map.yToDepth,
  }

  const d = boxDepth * vertExag                    // full depth range, world units
  const clipNorm = Math.min(0.985, Math.max(0, -depthClip / boxDepth))

  // No bevel: the chunk's edges are torn, not machined. Kept as a named zero
  // so the "depth 0 == boxMaxY" relationship below stays explicit.
  const chamfer = 0

  const boxMaxY = -chamfer                         // depth 0 lives here
  const boxMinY = -chamfer - d
  const yOfNorm = (t) => boxMaxY - t * d

  const wallTop = yOfNorm(clipNorm)                // where the wall starts
  const geomTop = wallTop + chamfer                // top face, above the bevel
  const geomBot = boxMinY
  const height = geomTop - geomBot

  return {
    spanX, spanZ, halfX: spanX / 2, halfZ: spanZ / 2,
    // west face after the cut; equals -halfX when nothing is sliced away
    westCut,
    xWest: -spanX / 2 + westCut,
    d, chamfer, clipNorm,
    boxMinY, boxMaxY, wallTop, geomTop, geomBot, height,
    centerY: (geomTop + geomBot) / 2,
    yOfNorm,
    yOfDepthM: (m) => boxMaxY + depthToY(m) * vertExag,
    depthMOfY: (y) => yToDepth((y - boxMaxY) / vertExag),
    clipDepthM: yToDepth(-clipNorm * boxDepth),
  }
}
