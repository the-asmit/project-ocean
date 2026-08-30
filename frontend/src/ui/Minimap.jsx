import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import Panel from './Panel.jsx'
import { loadBasemap } from '../scene/dataset.js'
import { useVisualizationState } from '../state/useVisualizationState.js'

// Region picker + orientation map.
//
// The basemap is a wide bathymetry-only GLORYS tile (North Indian Ocean), so
// the coastline is REAL — the same `deptho` NaN mask the block's cut faces use.
// Nothing here is a stock basemap or a traced outline; at 1/12° (~9 km) it is
// as coarse as the rest of the data, which is honest.
//
// Drag anywhere to draw a new bounding box. On release the app loads that exact
// bbox through the normal adapter path (cache first, Copernicus if missing).
//
// North is up, east is right — not mirrored, matching dataset.js (lon -> +x,
// lat -> +z).

const LAND_EDGE = 'rgba(206,228,255,.92)'
const LAND_FILL = [0x39, 0x40, 0x4a]

// --- marching squares over a smoothed land field -> coastline segments -----
function coastline(land, W, D) {
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
  const baseRef = useRef(null)
  const selected = useVisualizationState((s) => s.selected)
  const hover = useVisualizationState((s) => s.hover)
  const setRegion = useVisualizationState((s) => s.setRegion)
  const loading = useVisualizationState((s) => s.loading)

  const [base, setBase] = useState(null)      // { meta, bathy, limits }
  const [baseErr, setBaseErr] = useState(null)
  const [box, setBox] = useState(null)        // live drag, in lon/lat
  const boxRef = useRef(null)
  boxRef.current = box


  const [size, setSize] = useState({ w: 240, h: 200 })
  const sizeRef = useRef(size)
  sizeRef.current = size

  useEffect(() => {
    let dead = false
    loadBasemap()
      .then((b) => !dead && setBase(b))
      .catch((e) => !dead && setBaseErr(String(e)))
    return () => { dead = true }
  }, [])

  const bm = base?.meta
  const aspect = bm ? (bm.lonMax - bm.lonMin) / (bm.latMax - bm.latMin) : 1

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect
      const w = Math.max(120, Math.floor(Math.min(width, height * aspect)))
      const h = Math.max(100, Math.round(w / aspect))
      setSize((p) => (Math.abs(p.w - w) > 1 || Math.abs(p.h - h) > 1 ? { w, h } : p))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [aspect])

  // --- static layer: depth raster + coastline ----------------------------
  useEffect(() => {
    if (!base) return
    const { meta, bathy } = base
    const W = meta.bathyW, D = meta.bathyD
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const px = Math.round(size.w * dpr)
    const py = Math.round(size.h * dpr)

    const off = document.createElement('canvas')
    off.width = W; off.height = D
    const g = off.getContext('2d')
    const img = g.createImageData(W, D)
    const land = new Float32Array(W * D)
    // log ramp over the tile's own depth range, or shelf and abyss collapse
    const lo = Math.log1p(meta.bathyMinM / 6)
    const hi = Math.log1p(meta.bathyMaxM / 6)
    for (let ry = 0; ry < D; ry++) {
      const j = D - 1 - ry                       // flip: north at top
      for (let i = 0; i < W; i++) {
        const v = bathy[j * W + i]
        const o = (ry * W + i) * 4
        const isLand = Number.isNaN(v)
        land[ry * W + i] = isLand ? 1 : 0
        if (isLand) {
          img.data[o] = LAND_FILL[0]; img.data[o + 1] = LAND_FILL[1]; img.data[o + 2] = LAND_FILL[2]
        } else {
          const m = meta.bathyMaxM * Math.pow(
            Math.min(1, Math.max(0, -v / meta.boxDepth)), 1 / meta.depthCurve)
          const t = 1 - Math.min(1, Math.max(0, (Math.log1p(m / 6) - lo) / (hi - lo || 1)))
          img.data[o] = 9 + t * 52
          img.data[o + 1] = 24 + t * 88
          img.data[o + 2] = 48 + t * 122
        }
        img.data[o + 3] = 255
      }
    }
    g.putImageData(img, 0, 0)

    const c2 = document.createElement('canvas')
    c2.width = px; c2.height = py
    const c = c2.getContext('2d')
    c.imageSmoothingEnabled = true
    c.imageSmoothingQuality = 'high'
    c.drawImage(off, 0, 0, px, py)

    c.strokeStyle = LAND_EDGE
    c.lineWidth = 1.2 * dpr
    c.lineJoin = 'round'
    c.beginPath()
    for (const [a, b2] of coastline(land, W, D)) {
      c.moveTo((a[0] / (W - 1)) * px, (a[1] / (D - 1)) * py)
      c.lineTo((b2[0] / (W - 1)) * px, (b2[1] / (D - 1)) * py)
    }
    c.stroke()
    baseRef.current = c2
  }, [base, size])

  // --- live layer --------------------------------------------------------
  useEffect(() => {
    if (!base) return
    let raf = 0
    const dir = new THREE.Vector3()
    const { meta } = base
    const map = dataset.map

    const toPx = (lon, lat, px, py) => [
      ((lon - meta.lonMin) / (meta.lonMax - meta.lonMin)) * px,
      (1 - (lat - meta.latMin) / (meta.latMax - meta.latMin)) * py,
    ]

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const cv = canvasRef.current
      const bs = baseRef.current
      if (!cv || !bs) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const px = Math.round(sizeRef.current.w * dpr)
      const py = Math.round(sizeRef.current.h * dpr)
      if (cv.width !== px || cv.height !== py) { cv.width = px; cv.height = py }
      const c = cv.getContext('2d')
      c.clearRect(0, 0, px, py)
      c.drawImage(bs, 0, 0)

      // dim everything outside the loaded tile, so "you are here" is obvious
      const [tx0, ty0] = toPx(map.lonMin, map.latMax, px, py)
      const [tx1, ty1] = toPx(map.lonMax, map.latMin, px, py)
      c.save()
      c.beginPath()
      c.rect(0, 0, px, py)
      c.rect(tx0, ty0, tx1 - tx0, ty1 - ty0)
      c.fillStyle = 'rgba(6,9,14,.58)'
      c.fill('evenodd')
      c.restore()

      c.strokeStyle = loading ? 'rgba(255,196,107,.95)' : 'rgba(79,195,247,.95)'
      c.lineWidth = 1.4 * dpr
      c.setLineDash(loading ? [4 * dpr, 3 * dpr] : [])
      c.strokeRect(tx0, ty0, tx1 - tx0, ty1 - ty0)
      c.setLineDash([])

      if (hover) {
        const [hx, hy] = toPx(map.xToLon(hover.world[0]), map.zToLat(hover.world[2]), px, py)
        c.fillStyle = 'rgba(79,195,247,.85)'
        c.beginPath(); c.arc(hx, hy, 2.2 * dpr, 0, Math.PI * 2); c.fill()
      }
      const cam = cameraRef?.current
      if (cam) {
        cam.getWorldDirection(dir)
        const cx = (tx0 + tx1) / 2
        const cy = (ty0 + ty1) / 2
        const ang = Math.atan2(dir.x, -dir.z)
        c.save()
        c.translate(cx, cy); c.rotate(ang)
        c.strokeStyle = 'rgba(79,195,247,.9)'
        c.lineWidth = 1.3 * dpr
        c.beginPath(); c.moveTo(0, 6 * dpr); c.lineTo(0, -11 * dpr); c.stroke()
        c.beginPath(); c.moveTo(-3.5 * dpr, -6 * dpr); c.lineTo(0, -11 * dpr)
        c.lineTo(3.5 * dpr, -6 * dpr); c.stroke()
        c.restore()
      }
      if (selected) {
        const [sx, sy] = toPx(selected.lon, selected.lat, px, py)
        c.strokeStyle = '#ffc46b'
        c.lineWidth = 1.5 * dpr
        c.beginPath(); c.arc(sx, sy, 4.4 * dpr, 0, Math.PI * 2); c.stroke()
        c.fillStyle = '#ffc46b'
        c.beginPath(); c.arc(sx, sy, 1.7 * dpr, 0, Math.PI * 2); c.fill()
      }


      // the rectangle being drawn
      const b = boxRef.current
      if (b) {
        const [bx0, by0] = toPx(Math.min(b.lon0, b.lon1), Math.max(b.lat0, b.lat1), px, py)
        const [bx1, by1] = toPx(Math.max(b.lon0, b.lon1), Math.min(b.lat0, b.lat1), px, py)
        c.fillStyle = b.valid ? 'rgba(79,195,247,.18)' : 'rgba(255,139,122,.16)'
        c.fillRect(bx0, by0, bx1 - bx0, by1 - by0)
        c.strokeStyle = b.valid ? '#4fc3f7' : '#ff8b7a'
        c.lineWidth = 1.5 * dpr
        c.setLineDash([5 * dpr, 3 * dpr])
        c.strokeRect(bx0, by0, bx1 - bx0, by1 - by0)
        c.setLineDash([])
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [base, dataset, cameraRef, hover, selected, loading])

  // --- drag to select ----------------------------------------------------
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !base) return
    const { meta, limits } = base
    const anchor = { current: null }

    const at = (e) => {
      const r = cv.getBoundingClientRect()
      const u = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
      const v = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
      return {
        lon: meta.lonMin + u * (meta.lonMax - meta.lonMin),
        lat: meta.latMax - v * (meta.latMax - meta.latMin),
      }
    }
    const measure = (a, b) => {
      const dlon = Math.abs(b.lon - a.lon)
      const dlat = Math.abs(b.lat - a.lat)
      return {
        lon0: a.lon, lat0: a.lat, lon1: b.lon, lat1: b.lat, dlon, dlat,
        valid: dlon >= limits.minSpanDeg && dlat >= limits.minSpanDeg
          && dlon <= limits.maxSpanDeg && dlat <= limits.maxSpanDeg,
      }
    }

    const down = (e) => {
      if (e.button !== 0) return
      cv.setPointerCapture(e.pointerId)
      anchor.current = at(e)
      setBox(measure(anchor.current, anchor.current))
    }
    const move = (e) => {
      if (!anchor.current) return
      setBox(measure(anchor.current, at(e)))
    }
    const up = (e) => {
      if (!anchor.current) return
      const b = measure(anchor.current, at(e))
      anchor.current = null
      setBox(null)
      if (!b.valid) return
      const f = (n) => n.toFixed(2)
      setRegion(`bbox:${f(Math.min(b.lon0, b.lon1))},${f(Math.max(b.lon0, b.lon1))},`
        + `${f(Math.min(b.lat0, b.lat1))},${f(Math.max(b.lat0, b.lat1))}`)
    }
    const cancel = () => { anchor.current = null; setBox(null) }

    cv.addEventListener('pointerdown', down)
    cv.addEventListener('pointermove', move)
    cv.addEventListener('pointerup', up)
    cv.addEventListener('pointercancel', cancel)
    return () => {
      cv.removeEventListener('pointerdown', down)
      cv.removeEventListener('pointermove', move)
      cv.removeEventListener('pointerup', up)
      cv.removeEventListener('pointercancel', cancel)
    }
  }, [base, setRegion])

  const m = dataset.map
  const deg = (v, pos, neg) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? pos : neg}`
  const lim = base?.limits

  return (
    <Panel
      className="map-panel"
      title="Map view"
      sub="North Indian Ocean · drag to select"
      bodyClass="map-body"
    >
      <div className="mm-wrap" ref={wrapRef} style={{ aspectRatio: String(aspect) }}>
        {base ? (
          <canvas ref={canvasRef} className="mm-canvas"
            style={{ width: size.w, height: size.h }} />
        ) : (
          <div className="mm-idle">{baseErr ? 'basemap unavailable' : 'loading basemap…'}</div>
        )}
        <span className="mm-n">N ↑</span>
      </div>

      <div className="mm-pick">
        {box ? (
          <span className={box.valid ? 'ok' : 'bad'}>
            {box.dlon.toFixed(1)}° × {box.dlat.toFixed(1)}°
            {box.valid ? ' — release to load' : ` — needs ${lim.minSpanDeg}–${lim.maxSpanDeg}° per side`}
          </span>
        ) : loading ? (
          <span className="ok">loading tile…</span>
        ) : (
          <span>Drag a box to load a region{lim ? ` · ${lim.minSpanDeg}–${lim.maxSpanDeg}° per side` : ''}</span>
        )}
      </div>

      <div className="mm-legend">
        <span><i style={{ background: '#4fc3f7' }} /> loaded tile</span>
        <span><i style={{ background: '#ffc46b' }} /> pinned</span>
        <span style={{ marginLeft: 'auto' }}>
          {deg(m.latMin, 'N', 'S')}–{deg(m.latMax, 'N', 'S')} {deg(m.lonMin, 'E', 'W')}–{deg(m.lonMax, 'E', 'W')}
        </span>
      </div>
    </Panel>
  )
}
