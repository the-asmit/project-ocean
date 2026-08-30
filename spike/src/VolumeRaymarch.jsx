import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useControls } from 'leva'
import { buildFieldTexture, buildHeightTexture } from './synthetic.js'
import { BOX_MIN, BOX_MAX, FLOOR_MIN, FLOOR_MAX } from './constants.js'

// --- GLSL3 raw shaders -------------------------------------------------------
// RawShaderMaterial: three prepends only `#version 300 es`, nothing else, so we
// declare every built-in we use. This keeps the sampler3D path unambiguous.

const vertexShader = /* glsl */ `
precision highp float;

in vec3 position;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;

out vec3 vWorldPos;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const fragmentShader = /* glsl */ `
precision highp float;
precision highp sampler3D;

in vec3 vWorldPos;
out vec4 outColor;

uniform vec3 cameraPosition;

uniform sampler3D uField;      // R8, 0..1 normalised temperature
uniform sampler2D uHeightMap;  // R8, 0..1 normalised seafloor height
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec2 uFloorRange;      // (FLOOR_MIN, FLOOR_MAX) in world Y
uniform float uSteps;          // raymarch sample count (capped)
uniform float uClipY;          // discard samples above this world Y (cross-section)
uniform float uDensity;        // extinction coefficient for Beer-Lambert alpha
uniform float uMaskFloor;      // 1 = clip below seafloor, 0 = ignore bathymetry
uniform float uJitter;         // 1 = dithered ray start (kills slice banding)

// Cold -> warm transfer function (blue -> cyan -> green -> yellow -> red).
vec3 transfer(float t) {
  vec3 c0 = vec3(0.031, 0.102, 0.420);
  vec3 c1 = vec3(0.102, 0.549, 0.851);
  vec3 c2 = vec3(0.349, 0.820, 0.549);
  vec3 c3 = vec3(0.980, 0.851, 0.302);
  vec3 c4 = vec3(0.922, 0.251, 0.149);
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.50) return mix(c1, c2, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c2, c3, (t - 0.50) / 0.25);
  return mix(c3, c4, (t - 0.75) / 0.25);
}

// Ray / AABB slab intersection. Returns (tNear, tFar).
vec2 intersectBox(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax) {
  vec3 inv = 1.0 / rd;
  vec3 ta = (bmin - ro) * inv;
  vec3 tb = (bmax - ro) * inv;
  vec3 tmin = min(ta, tb);
  vec3 tmax = max(ta, tb);
  float tNear = max(max(tmin.x, tmin.y), tmin.z);
  float tFar = min(min(tmax.x, tmax.y), tmax.z);
  return vec2(tNear, tFar);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorldPos - ro);

  vec2 hit = intersectBox(ro, rd, uBoxMin, uBoxMax);
  float tNear = max(hit.x, 0.0);
  float tFar = hit.y;
  if (tNear >= tFar) discard;

  vec3 span = uBoxMax - uBoxMin;
  float dt = (tFar - tNear) / uSteps;

  float startOffset = uJitter > 0.5 ? hash12(gl_FragCoord.xy) : 0.0;
  float t = tNear + dt * startOffset;

  vec3 acc = vec3(0.0);
  float alpha = 0.0;

  for (int i = 0; i < 1024; i++) {
    if (float(i) >= uSteps || alpha > 0.985) break;

    vec3 p = ro + rd * t;
    t += dt;

    // depth-clip cross-section
    if (p.y > uClipY) continue;

    // bathymetry mask: skip anything at/below the seafloor
    if (uMaskFloor > 0.5) {
      vec2 huv = (p.xz - uBoxMin.xz) / span.xz;
      float fh = texture(uHeightMap, huv).r;
      float floorY = mix(uFloorRange.x, uFloorRange.y, fh);
      if (p.y < floorY) continue;
    }

    vec3 uvw = (p - uBoxMin) / span;
    float temp = texture(uField, uvw).r;      // already 0..1
    vec3 col = transfer(temp);

    // Beer-Lambert: alpha independent of step size, so capping uSteps changes
    // cost but not the look (aside from sampling detail).
    float a = 1.0 - exp(-uDensity * dt);

    acc += (1.0 - alpha) * col * a;   // front-to-back compositing
    alpha += (1.0 - alpha) * a;
  }

  if (alpha < 0.003) discard;
  outColor = vec4(acc, alpha);
}
`

export default function VolumeRaymarch() {
  const { field, height } = useMemo(() => {
    const f = buildFieldTexture()
    return { field: f.texture, height: buildHeightTexture() }
  }, [])

  // URL params (?steps= &density= &clip=) let the headless perf harness drive
  // the shader without poking leva's DOM. Harmless for normal use.
  const qp = new URLSearchParams(window.location.search)
  const qpNum = (k, d) => (qp.has(k) ? parseFloat(qp.get(k)) : d)

  const { clipY, steps, density, maskFloor, jitter } = useControls('raymarch', {
    clipY: { value: qpNum('clip', 0), min: FLOOR_MIN, max: 0, step: 0.02, label: 'depth clip (Y)' },
    steps: { value: qpNum('steps', 192), min: 16, max: 512, step: 8, label: 'march steps' },
    // very low default: the vast box means long ray paths, so tiny per-unit
    // extinction still reads as tinted water. Higher values -> "drowning in fog".
    density: { value: qpNum('density', 0.022), min: 0.004, max: 1.5, step: 0.002, label: 'density' },
    maskFloor: { value: qp.get('mask') !== '0', label: 'mask seafloor' },
    jitter: { value: qp.get('jitter') !== '0', label: 'dither ray start' },
  })

  const uniforms = useMemo(
    () => ({
      uField: { value: field },
      uHeightMap: { value: height },
      uBoxMin: { value: new THREE.Vector3(...BOX_MIN) },
      uBoxMax: { value: new THREE.Vector3(...BOX_MAX) },
      uFloorRange: { value: new THREE.Vector2(FLOOR_MIN, FLOOR_MAX) },
      uSteps: { value: 192 },
      uClipY: { value: 0 },
      uDensity: { value: 0.022 },
      uMaskFloor: { value: 1 },
      uJitter: { value: 1 },
    }),
    [field, height],
  )

  // Push live control values into the material uniforms. Must be an effect (not
  // a render-body poke) so it runs *after* the ref is attached and re-runs on
  // every leva change.
  useEffect(() => {
    const u = uniforms
    u.uSteps.value = steps
    u.uClipY.value = clipY
    u.uDensity.value = density
    u.uMaskFloor.value = maskFloor ? 1 : 0
    u.uJitter.value = jitter ? 1 : 0
  }, [uniforms, steps, clipY, density, maskFloor, jitter])

  const center = [
    (BOX_MIN[0] + BOX_MAX[0]) / 2,
    (BOX_MIN[1] + BOX_MAX[1]) / 2,
    (BOX_MIN[2] + BOX_MAX[2]) / 2,
  ]
  const size = [
    BOX_MAX[0] - BOX_MIN[0],
    BOX_MAX[1] - BOX_MIN[1],
    BOX_MAX[2] - BOX_MIN[2],
  ]

  return (
    <mesh position={center}>
      <boxGeometry args={size} />
      <rawShaderMaterial
        glslVersion={THREE.GLSL3}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        depthTest={false}
        side={THREE.BackSide}
      />
    </mesh>
  )
}
