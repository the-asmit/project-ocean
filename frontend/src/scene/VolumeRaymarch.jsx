import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useVisualizationState } from '../state/useVisualizationState.js'

// ===========================================================================
// Volumetric raymarch — the proven shader, logic UNCHANGED.
//
// Validated in spike/ then spike-real-data/. Every piece below is load-bearing;
// none of it is decoration:
//   * ray/AABB slab intersection, front-to-back compositing, early termination
//   * Beer-Lambert alpha  a = 1 - exp(-density * dt)  -> step-count independent
//   * blue-noise dithered ray start (kills slice banding at low step counts)
//   * trilinear-filtered Data3DTexture (this is what makes it continuous)
//   * DEPTH LUT for non-uniform GLORYS levels  [DELTA 2/3]
//   * RG8 validity channel, land/NaN never trilinear-bleeds  [DELTA 1/4]
//   * THICKNESS-AWARE density — fixes the neon-cyan shelf ribbon  [DELTA 5]
//
// Only addition for production: uVertExag, which scales the box and the floor
// range together so the vertical-exaggeration control cannot de-register the
// water from the seafloor.
// ===========================================================================

const LUT_N = 128

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

#define LUT_N ${LUT_N}

in vec3 vWorldPos;
out vec4 outColor;

uniform vec3 cameraPosition;

uniform sampler3D uField;      // RG8 — .r value, .g validity
uniform float uLUT[LUT_N];     // box depth fraction -> field row texcoord
uniform sampler2D uHeightMap;  // R8, 0..1 normalised seafloor height
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec2 uFloorRange;      // (floorMin, floorMax) in world Y
uniform float uSteps;
uniform float uClipY;
uniform float uDensity;
uniform float uMaskFloor;
uniform float uJitter;
uniform float uMaskInvalid;
uniform float uThinScale;      // density multiplier for a zero-thickness column
uniform float uThickRef;       // normalised thickness reaching full density

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
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
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

    if (p.y > uClipY) continue;

    vec2 huv = (p.xz - uBoxMin.xz) / span.xz;
    float floorY = mix(uFloorRange.x, uFloorRange.y, texture(uHeightMap, huv).r);
    if (uMaskFloor > 0.5 && p.y < floorY) continue;

    vec3 uvwLin = (p - uBoxMin) / span;

    // non-uniform GLORYS depth levels -> true field row, via the LUT
    float depthFrac = clamp(1.0 - uvwLin.y, 0.0, 1.0);
    float fi = depthFrac * float(LUT_N - 1);
    int i0 = int(fi);
    int i1 = min(i0 + 1, LUT_N - 1);
    float rowCoord = mix(uLUT[i0], uLUT[i1], fi - float(i0));
    vec3 uvw = vec3(uvwLin.x, rowCoord, uvwLin.z);

    // validity: land / below-seafloor / below the data's depth extent
    vec2 s = texture(uField, uvw).rg;
    if (uMaskInvalid > 0.5 && s.g < 0.5) continue;

    vec3 col = transfer(s.r);

    // thickness-aware density: a thin shelf column stays translucent instead of
    // saturating over a long near-horizontal traverse
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

export default function VolumeRaymarch({ dataset }) {
  const depthClip = useVisualizationState((s) => s.depthClip)
  const density = useVisualizationState((s) => s.density)
  const vertExag = useVisualizationState((s) => s.vertExag)

  const { boxDepth, boxSpan } = dataset.meta.bathymetry
  const half = boxSpan / 2

  const uniforms = useMemo(
    () => ({
      uField: { value: dataset.field },
      uLUT: { value: dataset.lut },
      uHeightMap: { value: dataset.height },
      uBoxMin: { value: new THREE.Vector3(-half, -boxDepth, -half) },
      uBoxMax: { value: new THREE.Vector3(half, 0, half) },
      uFloorRange: { value: new THREE.Vector2(-boxDepth, 0) },
      uSteps: { value: 192 },
      uClipY: { value: 0 },
      uDensity: { value: 0.022 },
      uMaskFloor: { value: 1 },
      uMaskInvalid: { value: 1 },
      uJitter: { value: 1 },
      uThinScale: { value: 0.12 },
      uThickRef: { value: 0.42 },
    }),
    [dataset, half, boxDepth],
  )

  // vertical exaggeration scales the box and the floor range TOGETHER
  useEffect(() => {
    const d = boxDepth * vertExag
    uniforms.uBoxMin.value.set(-half, -d, -half)
    uniforms.uFloorRange.value.set(-d, 0)
    uniforms.uClipY.value = depthClip * vertExag
    uniforms.uDensity.value = density
  }, [uniforms, depthClip, density, vertExag, half, boxDepth])

  const d = boxDepth * vertExag
  return (
    <mesh position={[0, -d / 2, 0]}>
      <boxGeometry args={[boxSpan, d, boxSpan]} />
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
