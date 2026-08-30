import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import Panel from './Panel.jsx'
import { useVisualizationState } from '../state/useVisualizationState.js'

// Top-down orientation map.
//
// The coastline is REAL: it is the same GLORYS `deptho` NaN mask the terrain
// mesh and the shader's floor mask use — land is where there is no sounding.
// Nothing here is a stock basemap or a traced outline; at 1/12° (~9 km) it is
// as coarse as the rest of the data, which is honest.
//
// North is up, east is right — the map is NOT mirrored, matching the world
// mapping in dataset.js (lon -> +x, lat -> +z).

const MIN_SIZE = 110      // css px floor for the map square
const LAND_EDGE = 'rgba(206,228,255,.92)'

// --- marching squares over a smoothed land field -> coastline segments -----
function coastline(land, W, D) {
  // light 3x3 blur so the contour reads as a coastline rather than staircase
  const b = new Float32Array(W * D)
  for (let j = 0; j < D; j++) {
    for (let i = 0; i < W; i++) {
      let s = 0, n = 0
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const jj = j + dj, ii = i + di
          if (jj < 0 || jj >= D || ii < 0 || ii >= W) continue
          s += land[jj * W + ii]; n++
        }
      }
      b[j * W + i] = s / n
    }
  }
  const T = 0.5
  const segs = []
  const lerp = (a, v0, v1) => (a + (T - v0) / (v1 - v0 || 1e-6))
  for (let j = 0; j < D - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
      const tl = b[j * W + i], tr = b[j * W + i + 1]
      const bl = b[(j + 1) * W + i], br = b[(j + 1) * W + i + 1]
      const code = (tl > T ? 8 : 0) | (tr > T ? 4 : 0) | (br > T ? 2 : 0) | (bl > T ? 1 : 0)
      if (code === 0 || code === 15) continue
      const top = [lerp(i, tl, tr), j]
      const bot = [lerp(i, bl, br), j + 1]
      const lft = [i, lerp(j, tl, bl)]
      const rgt = [i + 1, lerp(j, tr, br)]
      const push = (a, c) => segs.push([a, c])
      switch (code) {
        case 1: case 14: push(lft, bot); break
        case 2: case 13: push(bot, rgt); break
        case 3: case 12: push(lft, rgt); break
        case 4: case 11: push(top, rgt); break
        case 6: case 9: push(top, bot); break
        case 7: case 8: push(lft, top); break
        default: push(lft, top); push(bot, rgt); break   // saddles 5 / 10
      }
    }
  }
  return segs
}

export default function Minimap({ dataset, cameraRef }) {
  const canvasRef = useRef()
  const wrapRef = useRef()
  const baseRef = useRef(null)      // cached static layer (coast + depth)
  const selected = useVisualizationState((s) => s.selected)
  const hover = useVisualizationState((s) => s.hover)

  // The map is a panel now, not a fixed 178px overlay: it takes the largest
  // square its panel can give it and redraws the static layer on resize.
  const [size, setSize] = useState(MIN_SIZE)
  const sizeRef = useRef(MIN_SIZE)
  sizeRef.current = size
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect
      const n = Math.max(MIN_SIZE, Math.floor(Math.min(width, height)))
      setSize((prev) => (Math.abs(prev - n) > 1 ? n : prev))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { bathy, meta, map } = dataset
  const W = meta.bathymetry.bathyW
  const D = meta.bathymetry.bathyD
  const LOG_LO = Math.log1p(meta.bathymetry.bathyMinM / 6)
  const LOG_HI = Math.log1p(meta.bathymetry.bathyMaxM / 6)

  // --- build the static layer once ---------------------------------------
  useEffect(() => {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const px = Math.round(size * dpr)

    // depth/land raster at native grid res, north-up (row 0 = latMax)
    const off = document.createElement('canvas')
    off.width = W; off.height = D
    const g = off.getContext('2d')
    const img = g.createImageData(W, D)
    const land = new Float32Array(W * D)
    for (let py = 0; py < D; py++) {
      const j = D - 1 - py                      // flip: north at top
      for (let i = 0; i < W; i++) {
        const v = bathy[j * W + i]
        const o = (py * W + i) * 4
        const isLand = Number.isNaN(v)
        land[py * W + i] = isLand ? 1 : 0
        if (isLand) {
          img.data[o] = 0x39; img.data[o + 1] = 0x40; img.data[o + 2] = 0x4a
        } else {
          // shallow -> lighter. Log in METRES, not linear in the already
          // curve-compressed world-Y, or the whole basin collapses to one value.
          const m = map.yToDepth(v)
          const t = 1 - Math.min(1, Math.max(0, (Math.log1p(m / 6) - LOG_LO) / (LOG_HI - LOG_LO || 1)))
          img.data[o] = 9 + t * 52
          img.data[o + 1] = 24 + t * 88
          img.data[o + 2] = 48 + t * 122
        }
        img.data[o + 3] = 255
      }
    }
    g.putImageData(img, 0, 0)

    const base = document.createElement('canvas')
    base.width = px; base.height = px
    const c = base.getContext('2d')
    c.imageSmoothingEnabled = true
    c.imageSmoothingQuality = 'high'
    c.drawImage(off, 0, 0, px, px)

    // crisp coastline on top of the smoothed raster
    const sx = px / (W - 1)
    const sy = px / (D - 1)
    c.strokeStyle = LAND_EDGE
    c.lineWidth = 1.5 * dpr
    c.lineJoin = 'round'
    c.beginPath()
    for (const [a, b2] of coastline(land, W, D)) {
      c.moveTo(a[0] * sx, a[1] * sy)
      c.lineTo(b2[0] * sx, b2[1] * sy)
    }
    c.stroke()

    baseRef.current = base
  }, [bathy, W, D, meta, map, LOG_LO, LOG_HI, size])

  // --- live layer: camera + markers, redrawn each frame ------------------
  useEffect(() => {
    let raf = 0
    const dir = new THREE.Vector3()

    const toMap = (x, z, px) => {
      const u = x / map.span + 0.5              // 0..1 west->east
      const v = z / map.span + 0.5              // 0..1 south->north
      return [u * px, (1 - v) * px]             // flip v: north at top
    }

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const cv = canvasRef.current
      const base = baseRef.current
      if (!cv || !base) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const px = Math.round(sizeRef.current * dpr)
      if (cv.width !== px) { cv.width = px; cv.height = px }
      const c = cv.getContext('2d')
      c.clearRect(0, 0, px, px)
      c.drawImage(base, 0, 0)

      // hover point (faint)
      if (hover) {
        const [hx, hy] = toMap(hover.world[0], hover.world[2], px)
        c.fillStyle = 'rgba(79,195,247,.55)'
        c.beginPath(); c.arc(hx, hy, 2.2 * dpr, 0, Math.PI * 2); c.fill()
      }

      // camera position + facing wedge
      const cam = cameraRef?.current
      if (cam) {
        const [rawX, rawY] = toMap(cam.position.x, cam.position.z, px)
        cam.getWorldDirection(dir)
        // world +z is north (map -y), world +x is east (map +x)
        const ang = Math.atan2(dir.x, -dir.z)   // 0 = north/up, clockwise
        // If the pilot strays past the tile, pin the marker to the map edge so
        // there is ALWAYS a positional reference rather than a vanished dot.
        const m = 5 * dpr
        const cx = Math.min(px - m, Math.max(m, rawX))
        const cy = Math.min(px - m, Math.max(m, rawY))
        const inside = rawX === cx && rawY === cy

        c.save()
        c.translate(cx, cy)
        c.rotate(ang)
        // field-of-view wedge
        const R = 26 * dpr
        const half = THREE.MathUtils.degToRad((cam.fov || 60) * 0.5) * (16 / 9)
        const gr = c.createLinearGradient(0, 0, 0, -R)
        gr.addColorStop(0, 'rgba(79,195,247,.44)')
        gr.addColorStop(1, 'rgba(79,195,247,0)')
        c.fillStyle = gr
        c.beginPath()
        c.moveTo(0, 0)
        c.arc(0, 0, R, -Math.PI / 2 - half, -Math.PI / 2 + half)
        c.closePath()
        c.fill()
        // heading tick
        c.strokeStyle = 'rgba(79,195,247,.95)'
        c.lineWidth = 1.3 * dpr
        c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -9 * dpr); c.stroke()
        c.restore()

        c.fillStyle = inside ? '#4fc3f7' : '#7b8fa8'
        c.strokeStyle = 'rgba(5,7,13,.9)'
        c.lineWidth = 1.6 * dpr
        c.beginPath(); c.arc(cx, cy, 3.4 * dpr, 0, Math.PI * 2)
        c.fill(); c.stroke()
      }

      // pinned point LAST so it is never hidden under the camera wedge
      if (selected) {
        const [sx2, sy2] = toMap(selected.world[0], selected.world[2], px)
        c.strokeStyle = 'rgba(5,7,13,.85)'
        c.lineWidth = 3.2 * dpr
        c.beginPath(); c.arc(sx2, sy2, 5.4 * dpr, 0, Math.PI * 2); c.stroke()
        c.strokeStyle = '#ffc46b'
        c.lineWidth = 1.5 * dpr
        c.beginPath(); c.arc(sx2, sy2, 5.4 * dpr, 0, Math.PI * 2); c.stroke()
        c.beginPath(); c.moveTo(sx2 - 8 * dpr, sy2); c.lineTo(sx2 - 3 * dpr, sy2)
        c.moveTo(sx2 + 3 * dpr, sy2); c.lineTo(sx2 + 8 * dpr, sy2)
        c.moveTo(sx2, sy2 - 8 * dpr); c.lineTo(sx2, sy2 - 3 * dpr)
        c.moveTo(sx2, sy2 + 3 * dpr); c.lineTo(sx2, sy2 + 8 * dpr); c.stroke()
        c.fillStyle = '#ffc46b'
        c.beginPath(); c.arc(sx2, sy2, 1.9 * dpr, 0, Math.PI * 2); c.fill()
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [cameraRef, hover, selected, map])

  const b = meta.bbox
  // Scale bar: the tile is a fixed span of longitude, so one degree of it is a
  // known number of km at this latitude. Sized to the nearest round distance.
  const kmAcross = (b.lon_max - b.lon_min) * 111.32 *
    Math.cos(((b.lat_min + b.lat_max) / 2) * Math.PI / 180)
  const roundKm = [50, 100, 200, 250].find((k) => k / kmAcross < 0.45) ?? 100
  const barPx = (roundKm / kmAcross) * size

  return (
    <Panel
      className="map-panel"
      title="Map view"
      sub={`${b.lat_min}–${b.lat_max}°N ${b.lon_min}–${b.lon_max}°E`}
      bodyClass="map-body"
    >
      <div className="mm-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} style={{ width: size, height: size }} />
        <span className="mm-n">N ↑</span>
      </div>
      <div className="mm-scale">
        <span className="bar" style={{ width: barPx }} />
        <span>{roundKm} km</span>
        <span style={{ marginLeft: 'auto' }}>1/12° grid</span>
      </div>
      <div className="mm-legend">
        <span><i style={{ background: '#4fc3f7' }} /> camera</span>
        <span><i style={{ background: '#ffc46b' }} /> pinned</span>
        {meta.bathymetry.landCells > 0 && (
          <span><i style={{ background: '#39404a', boxShadow: '0 0 0 1px rgba(160,196,236,.55)' }} /> land</span>
        )}
        <span style={{ marginLeft: 'auto' }}>{meta.bathymetry.bathyMinM.toFixed(0)}–{meta.bathymetry.bathyMaxM.toFixed(0)} m</span>
      </div>
    </Panel>
  )
}
