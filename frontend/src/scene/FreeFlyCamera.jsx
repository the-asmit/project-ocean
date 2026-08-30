import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useVisualizationState } from '../state/useVisualizationState.js'

// Free-fly navigation through the water column.
//
// Deliberately NOT pointer-lock: look is left-drag. Pointer lock would pin the
// cursor to screen centre, which kills the mouse-position hover readout that the
// whole interaction milestone depends on. Drag-look keeps hover working in both
// nav modes and stays testable headlessly.
//
//   W/S  forward / back along view      A/D  strafe
//   Q/E  down / up (world Y)            Shift  3x boost
//   drag  look                          scroll  speed
//
// Runs alongside OrbitControls; only one is enabled at a time (see OceanScene).

const KEYMAP = {
  KeyW: 'fwd', ArrowUp: 'fwd',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  KeyQ: 'down', KeyE: 'up',
  Space: 'up', ShiftLeft: 'boost', ShiftRight: 'boost',
}

export default function FreeFlyCamera({ enabled, bounds }) {
  const { camera, gl } = useThree()
  const flySpeed = useVisualizationState((s) => s.flySpeed)
  const setFlySpeed = useVisualizationState((s) => s.setFlySpeed)

  const keys = useRef({})
  const drag = useRef({ active: false, x: 0, y: 0 })
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'))
  const speedRef = useRef(flySpeed)
  speedRef.current = flySpeed

  // Seed yaw/pitch from wherever the camera currently is, so toggling modes
  // never snaps the view. Also re-seeds after a Home reset — CameraBridge
  // renders before this component, so its new quaternion is already applied.
  const homeNonce = useVisualizationState((s) => s.homeNonce)
  useEffect(() => {
    if (enabled) euler.current.setFromQuaternion(camera.quaternion, 'YXZ')
  }, [enabled, camera, homeNonce])

  useEffect(() => {
    if (!enabled) { keys.current = {}; return }
    const el = gl.domElement

    const down = (e) => {
      const a = KEYMAP[e.code]
      if (a) { keys.current[a] = true; e.preventDefault() }
    }
    const up = (e) => {
      const a = KEYMAP[e.code]
      if (a) keys.current[a] = false
    }
    const pdown = (e) => {
      if (e.button !== 0) return
      drag.current = { active: true, x: e.clientX, y: e.clientY }
      el.setPointerCapture?.(e.pointerId)
    }
    const pmove = (e) => {
      if (!drag.current.active) return
      const dx = e.clientX - drag.current.x
      const dy = e.clientY - drag.current.y
      drag.current.x = e.clientX
      drag.current.y = e.clientY
      euler.current.y -= dx * 0.0026
      euler.current.x = THREE.MathUtils.clamp(
        euler.current.x - dy * 0.0026, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02,
      )
      camera.quaternion.setFromEuler(euler.current)
    }
    const pup = (e) => {
      drag.current.active = false
      el.releasePointerCapture?.(e.pointerId)
    }
    const wheel = (e) => {
      e.preventDefault()
      setFlySpeed(THREE.MathUtils.clamp(speedRef.current * (e.deltaY > 0 ? 0.86 : 1.16), 1.5, 160))
    }

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    el.addEventListener('pointerdown', pdown)
    window.addEventListener('pointermove', pmove)
    window.addEventListener('pointerup', pup)
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      el.removeEventListener('pointerdown', pdown)
      window.removeEventListener('pointermove', pmove)
      window.removeEventListener('pointerup', pup)
      el.removeEventListener('wheel', wheel)
    }
  }, [enabled, camera, gl, setFlySpeed])

  const fwd = useRef(new THREE.Vector3())
  const right = useRef(new THREE.Vector3())

  // Soft containment: past the limit the camera is eased back rather than
  // stopped dead, so pushing outward feels like resistance instead of a wall.
  // Runs EVERY frame, not just while a key is held — otherwise a camera left
  // outside the envelope would simply stay there.
  const soft = (v, min, max, k) => {
    if (v < min) return v + (min - v) * k
    if (v > max) return v + (max - v) * k
    return v
  }

  useFrame((_, dt) => {
    if (!enabled) return
    const k = keys.current
    const step = speedRef.current * Math.min(dt, 0.05) * (k.boost ? 3 : 1)

    if (k.fwd || k.back || k.left || k.right || k.up || k.down) {
      camera.getWorldDirection(fwd.current)
      right.current.crossVectors(fwd.current, camera.up).normalize()
      if (k.fwd) camera.position.addScaledVector(fwd.current, step)
      if (k.back) camera.position.addScaledVector(fwd.current, -step)
      if (k.right) camera.position.addScaledVector(right.current, step)
      if (k.left) camera.position.addScaledVector(right.current, -step)
      if (k.up) camera.position.y += step
      if (k.down) camera.position.y -= step
    }

    if (!bounds) return
    const { half, ceil, floorAt, floorClearance, vertExag } = bounds
    const ease = 1 - Math.pow(0.0001, Math.min(dt, 0.05))   // ~frame-rate independent
    const p = camera.position

    p.x = soft(p.x, -half, half, ease)
    p.z = soft(p.z, -half, half, ease)

    // vertical floor tracks the real seafloor beneath the camera, so a long
    // shallow descent can never park you underneath the terrain in the black
    const seabed = floorAt(p.x, p.z) * vertExag + floorClearance
    p.y = soft(p.y, Math.min(seabed, ceil - 0.5), ceil, ease)

    // hard backstop, in case something teleports the camera far outside
    const hard = half * 1.35
    p.x = THREE.MathUtils.clamp(p.x, -hard, hard)
    p.z = THREE.MathUtils.clamp(p.z, -hard, hard)
    p.y = THREE.MathUtils.clamp(p.y, seabed - 1.5, ceil + 4)
  })

  return null
}
