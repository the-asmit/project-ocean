import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useVisualizationState } from '../state/useVisualizationState.js'

// Screen-space HUD: a thin leader line from the 3D-projected hit point out to
// an offset card. Drawn in a DOM overlay (crisp text, no texture atlas) and fed
// by a projection loop that reads the live camera.
//
// Note it does NOT dim or fog anything else — the highlight is additive on the
// point itself only. The "drowning in fog" problem is fixed; don't reintroduce
// it by darkening the scene to make a label pop.

const OFF_X = 74
const OFF_Y = -58

function project(world, camera, w, h, v) {
  v.set(world[0], world[1], world[2]).project(camera)
  return {
    x: (v.x * 0.5 + 0.5) * w,
    y: (-v.y * 0.5 + 0.5) * h,
    behind: v.z > 1,
  }
}

function Card({ pt, screen, pinned, box }) {
  const ax = screen.x
  const ay = screen.y
  // flip the leader to the other side when close to the right/top edge of the
  // PANEL (not the window — the scene is bounded now)
  const flipX = ax + OFF_X + 175 > box.w
  const flipY = ay + OFF_Y < 8
  const cx = ax + (flipX ? -OFF_X - 165 : OFF_X)
  const cy = ay + (flipY ? -OFF_Y : OFF_Y)

  const val = pt.value == null
    ? null
    : `${pt.value.toFixed(2)}`

  return (
    <>
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}
      >
        <line
          x1={ax} y1={ay}
          x2={cx + (flipX ? 165 : 0)} y2={cy + 14}
          stroke={pinned ? 'rgba(255,207,122,.75)' : 'rgba(88,212,255,.7)'}
          strokeWidth="1"
        />
        <circle cx={ax} cy={ay} r="3.5" fill="none"
          stroke={pinned ? 'rgba(255,207,122,.95)' : 'rgba(88,212,255,.95)'} strokeWidth="1.25" />
        <circle cx={ax} cy={ay} r="1.4"
          fill={pinned ? 'rgba(255,207,122,1)' : 'rgba(88,212,255,1)'} />
      </svg>
      <div className={`hud-card${pinned ? ' pinned' : ''}`} style={{ left: cx, top: cy }}>
        {val === null ? (
          <div className="k">no data — land</div>
        ) : (
          <div>
            <span className="big">{val}</span> <span className="k">°C</span>
            {pt.clamped && (
              <span className="k"> @ {pt.sampleDepthM.toFixed(0)} m (deepest data)</span>
            )}
          </div>
        )}
        <div><span className="k">lat </span>{pt.lat.toFixed(3)}°　<span className="k">lon </span>{pt.lon.toFixed(3)}°</div>
        <div><span className="k">{pt.kind === 'seafloor' ? 'seafloor' : 'depth'} </span>{pt.depthM.toFixed(0)} m</div>
        {/* which surface the number came from. The movable section plane draws
            over the block, so without this a reading off the plane and a
            reading off a cut face behind it are indistinguishable. */}
        <div className="k src">{pt.kind}</div>
      </div>
    </>
  )
}

export default function HUDLabel({ cameraRef, hostRef }) {
  const hover = useVisualizationState((s) => s.hover)
  const selected = useVisualizationState((s) => s.selected)
  const [, force] = useState(0)
  const vec = useRef(new THREE.Vector3())
  const raf = useRef(0)

  // re-project every frame so labels track while flying
  useEffect(() => {
    const tick = () => {
      force((n) => (n + 1) % 1000000)
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [])

  const camera = cameraRef?.current
  const host = hostRef?.current
  if (!camera || !host) return null
  // Project into the PANEL's box. The layer is absolutely positioned inside the
  // same host, so these coordinates are already local — no window offsets.
  const w = host.clientWidth
  const h = host.clientHeight
  const box = { w, h }

  const items = []
  if (selected) {
    const s = project(selected.world, camera, w, h, vec.current)
    if (!s.behind) items.push(<Card key="sel" pt={selected} screen={s} box={box} pinned />)
  }
  if (hover && (!selected || hover.world[0] !== selected.world[0])) {
    const s = project(hover.world, camera, w, h, vec.current)
    if (!s.behind) items.push(<Card key="hov" pt={hover} screen={s} box={box} />)
  }

  return <div className="hud-layer">{items}</div>
}
