import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useControls } from 'leva'
import { BOX_MIN, BOX_MAX, FLOOR_MIN, FLOOR_MAX } from './constants.js'

// ===========================================================================
// COPY of spike/src/VolumeRaymarch.jsx. The raymarch ALGORITHM is identical —
// ray/box, step loop, Beer-Lambert front-to-back compositing, early-out,
// transfer(), gl_FragCoord dither, GLSL3 RawShaderMaterial, BackSide box.
//
// The ONLY changes for real data, all in the field-sampling preamble:
//   [1] uField is RG8 now: .r = normalised temperature, .g = validity
//   [2] + uniform float uLUT[128]  (non-uniform GLORYS depth-level remap table)
//   [3] the linear world-Y -> field-row mapping goes through the LUT
//   [4] samples with .g < 0.5 (land / below-seafloor) are skipped
// Search "REAL-DATA DELTA" below — 4 spots, ~9 added lines. Nothing in the
// marching / compositing core is touched.
// ===========================================================================

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

const LUT_N = 128

const fragmentShader = /* glsl */ `
precision highp float;
precision highp sampler3D;

#define LUT_N ${LUT_N}

in vec3 vWorldPos;
out vec4 outColor;

uniform vec3 cameraPosition;

uniform sampler3D uField;      // REAL-DATA DELTA [1]: RG8 — .r temp, .g validity
uniform float uLUT[LUT_N];     // REAL-DATA DELTA [2]: depthFrac -> field row coord
uniform sampler2D uHeightMap;  // R8, 0..1 normalised seafloor height
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec2 uFloorRange;      // (FLOOR_MIN, FLOOR_MAX) in world Y
uniform float uSteps;
uniform float uClipY;
uniform float uDensity;
uniform float uMaskFloor;
uniform float uJitter;
uniform float uMaskInvalid;    // REAL-DATA DELTA [4]: 1 = honour the validity mask
uniform float uThinScale;      // REAL-DATA DELTA [5]: density mult. for a 0-thickness column
uniform float uThickRef;       // REAL-DATA DELTA [5]: normalised thickness reaching full density

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

    // bathymetry mask: skip anything at/below the seafloor.
    // (floorY is now read unconditionally — REAL-DATA DELTA [5] needs it too.)
    vec2 huv = (p.xz - uBoxMin.xz) / span.xz;
    float floorY = mix(uFloorRange.x, uFloorRange.y, texture(uHeightMap, huv).r);
    if (uMaskFloor > 0.5 && p.y < floorY) continue;

    vec3 uvwLin = (p - uBoxMin) / span;

    // REAL-DATA DELTA [3]: GLORYS depth levels are non-uniform. Convert the
    // linear world-Y coord (0 = surface, 1 = box bottom) to the true field row
    // via the LUT the adapter built from the level table (linear-interpolated).
    float depthFrac = clamp(1.0 - uvwLin.y, 0.0, 1.0);
    float fi = depthFrac * float(LUT_N - 1);
    int i0 = int(fi);
    int i1 = min(i0 + 1, LUT_N - 1);
    float rowCoord = mix(uLUT[i0], uLUT[i1], fi - float(i0));
    vec3 uvw = vec3(uvwLin.x, rowCoord, uvwLin.z);

    // REAL-DATA DELTA [1]+[4]: RG sample; skip land / below-seafloor cells so
    // trilinear filtering can't bleed them into valid water.
    vec2 s = texture(uField, uvw).rg;
    if (uMaskInvalid > 0.5 && s.g < 0.5) continue;

    vec3 col = transfer(s.r);

    // REAL-DATA DELTA [5]: THICKNESS-AWARE density.
    // A shelf column is only tens of metres thick but a near-horizontal ray can
    // travel a long way through it, and shelf water is near-isothermal, so the
    // old fixed density accumulated one saturated colour over that whole path —
    // the neon-cyan coastal ribbon. Scale density by how much water actually
    // stands at this x/z: thin columns render lighter and stay translucent,
    // deep columns are unaffected.
    float thickness = clamp((0.0 - floorY) / (uBoxMax.y - uBoxMin.y), 0.0, 1.0);
    float dScale = mix(uThinScale, 1.0, smoothstep(0.0, uThickRef, thickness));

    float a = 1.0 - exp(-uDensity * dScale * dt);
    acc += (1.0 - alpha) * col * a;
    alpha += (1.0 - alpha) * a;
  }

  if (alpha < 0.003) discard;
  outColor = vec4(acc, alpha);
}
`

export default function VolumeRaymarch({ field, lut, height }) {
  const qp = new URLSearchParams(window.location.search)
  const qpNum = (k, d) => (qp.has(k) ? parseFloat(qp.get(k)) : d)

  const { clipY, steps, density, maskFloor, maskInvalid, jitter, thinScale, thickRef } = useControls('raymarch', {
    clipY: { value: qpNum('clip', 0), min: FLOOR_MIN, max: 0, step: 0.02, label: 'depth clip (Y)' },
    steps: { value: qpNum('steps', 192), min: 16, max: 512, step: 8, label: 'march steps' },
    density: { value: qpNum('density', 0.022), min: 0.004, max: 1.5, step: 0.002, label: 'density' },
    maskFloor: { value: qp.get('mask') !== '0', label: 'mask seafloor' },
    maskInvalid: { value: qp.get('nanmask') !== '0', label: 'mask land / NaN' },
    jitter: { value: qp.get('jitter') !== '0', label: 'dither ray start' },
    // Fix 2 — thickness-aware compositing. thinScale = 1 restores the old
    // fixed-density behaviour (the neon shelf ribbon) for comparison.
    thinScale: { value: qpNum('thin', 0.12), min: 0.02, max: 1, step: 0.01, label: 'shelf density ×' },
    thickRef: { value: qpNum('thickref', 0.42), min: 0.05, max: 1, step: 0.01, label: 'full-density depth' },
  })

  const uniforms = useMemo(
    () => ({
      uField: { value: field },
      uLUT: { value: lut },
      uHeightMap: { value: height },
      uBoxMin: { value: new THREE.Vector3(...BOX_MIN) },
      uBoxMax: { value: new THREE.Vector3(...BOX_MAX) },
      uFloorRange: { value: new THREE.Vector2(FLOOR_MIN, FLOOR_MAX) },
      uSteps: { value: 192 },
      uClipY: { value: 0 },
      uDensity: { value: 0.022 },
      uMaskFloor: { value: 1 },
      uMaskInvalid: { value: 1 },
      uJitter: { value: 1 },
      uThinScale: { value: 0.12 },
      uThickRef: { value: 0.42 },
    }),
    [field, lut, height],
  )

  useEffect(() => {
    const u = uniforms
    u.uSteps.value = steps
    u.uClipY.value = clipY
    u.uDensity.value = density
    u.uMaskFloor.value = maskFloor ? 1 : 0
    u.uMaskInvalid.value = maskInvalid ? 1 : 0
    u.uJitter.value = jitter ? 1 : 0
    u.uThinScale.value = thinScale
    u.uThickRef.value = thickRef
  }, [uniforms, steps, clipY, density, maskFloor, maskInvalid, jitter, thinScale, thickRef])

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
