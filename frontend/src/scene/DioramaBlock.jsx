import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useVisualizationState } from '../state/useVisualizationState.js'

// ===========================================================================
// Bounded diorama block — a finite display object, not an infinite fog volume.
//
// One opaque box. The fragment shader branches on the face normal:
//   * side walls  -> vertical cross-section through the REAL field
//   * top face    -> stylized sea surface / terrain, OR the horizontal section
//                    once the depth-clip has sliced the block down
//   * bottom face -> abyss rock
//
// The data path is the proven one, carried over from VolumeRaymarch verbatim:
// the 128-entry DEPTH LUT for non-uniform GLORYS levels, the RG8 VALIDITY
// channel (never trilinear-bleed land or below-seafloor into water), the
// seafloor heightmap, and the same transfer() stops the colorbar and the charts
// use. WHICH COLOUR A VALUE MAPS TO IS UNCHANGED.
//
// Everything else here is presentation, and it is all lighting or texture laid
// ON TOP of that mapping: FBM water with real derived normals and a specular
// response, bright isotherm contours, per-face gradients, and edge ambient
// occlusion so the block reads as a solid object rather than three flat tones.
// The top face is DECORATIVE and disclosed in the footer (P3).
// ===========================================================================

const LUT_N = 128

const vertexShader = /* glsl */ `
precision highp float;

in vec3 position;
in vec3 normal;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;

out vec3 vWorldPos;
out vec3 vNormal;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  vNormal = normal;                 // box is axis-aligned and unrotated
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const fragmentShader = /* glsl */ `
precision highp float;
precision highp sampler3D;

#define LUT_N ${LUT_N}

in vec3 vWorldPos;
in vec3 vNormal;
out vec4 outColor;

uniform vec3 cameraPosition;

uniform sampler3D uField;      // RG8 — .r value, .g validity
uniform float uLUT[LUT_N];     // box depth fraction -> field row texcoord
uniform sampler2D uHeightMap;  // R8, 0..1 normalised seafloor height
uniform vec3 uBoxMin;          // ALWAYS the full block, even when clipped
uniform vec3 uBoxMax;
uniform vec2 uFloorRange;
uniform float uClipY;
uniform float uSat;
uniform float uContour;
uniform float uContourStep;
uniform float uSurfMid;
uniform float uSurfGain;
uniform float uStylizedTop;
uniform float uSpan;           // world units across the tile, for noise scaling

const vec3 LIGHT = vec3(0.42, 0.78, 0.46);

// --- value noise / FBM ---------------------------------------------------
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), u.x),
             mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = m * p; a *= 0.5; }
  return v;
}

// Cold -> warm. Identical stops to VolumeRaymarch's transfer(), the Colorbar
// and charts/sampling.js — one value means one colour everywhere.
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

// Presentation grade only — never changes which colour a value maps to.
vec3 grade(vec3 c) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, uSat);
  return pow(clamp(c, 0.0, 1.0), vec3(0.88));
}

float fieldRow(float depthFrac) {
  float fi = clamp(depthFrac, 0.0, 1.0) * float(LUT_N - 1);
  int i0 = int(fi);
  int i1 = min(i0 + 1, LUT_N - 1);
  return mix(uLUT[i0], uLUT[i1], fi - float(i0));
}

// --- the cross-section: what a cut through the block actually shows -------
vec3 sectionColor(vec3 p, vec3 uvw01, float floorY) {
  // below the real seafloor: block body, not water. Mottled so the rock reads
  // as material rather than as a flat fill — decorative, and off the ramp.
  if (p.y < floorY) {
    float t = clamp((floorY - p.y) / max(0.001, floorY - uBoxMin.y), 0.0, 1.0);
    vec3 rock = mix(vec3(0.341, 0.357, 0.400), vec3(0.153, 0.165, 0.196), t);
    vec2 rq = vec2((uvw01.x + uvw01.z) * 3.4, uvw01.y);
    float strata = fbm(rq * vec2(2.4, 30.0));            // bedding planes
    float mottle = fbm(rq * vec2(9.0, 7.0));             // broad relief
    float fine = fbm(rq * vec2(26.0, 60.0));             // grain
    rock *= 0.62 + 0.46 * mottle + 0.30 * strata + 0.12 * fine;
    return rock;
  }

  float depthFrac = clamp(1.0 - uvw01.y, 0.0, 1.0);
  vec2 s = texture(uField, vec3(uvw01.x, fieldRow(depthFrac), uvw01.z)).rg;

  // water the model carries no value for (below the field's depth extent).
  // Deliberately OFF the temperature ramp so it can never read as a value, and
  // deliberately untextured so nothing there implies structure.
  if (s.g < 0.5) {
    float t = clamp((depthFrac - 0.32) / 0.68, 0.0, 1.0);
    return mix(vec3(0.063, 0.098, 0.176), vec3(0.024, 0.039, 0.078), t);
  }

  vec3 c = grade(transfer(s.r));

  // isotherm contours: thin BRIGHT lines on every uContourStep of the range,
  // with a soft dark halo so they hold against the warm end of the ramp.
  if (uContour > 0.5) {
    float vv = s.r / max(uContourStep, 1e-5);
    float dist = abs(fract(vv - 0.5) - 0.5) / max(fwidth(vv), 1e-5);
    float line = 1.0 - smoothstep(0.0, 1.5, dist);
    float halo = (1.0 - smoothstep(1.3, 3.4, dist)) * (1.0 - line);
    c *= 1.0 - 0.30 * halo;
    c = mix(c, mix(c, vec3(1.0), 0.86), line);
  }
  return c;
}

// --- stylized sea surface / terrain (DECORATIVE — disclosed in the footer) --
vec3 topSurface(vec3 p, vec3 uvw01, out vec3 outNormal) {
  outNormal = vec3(0.0, 1.0, 0.0);
  float row = fieldRow(0.0);
  vec2 s = texture(uField, vec3(uvw01.x, row, uvw01.z)).rg;

  // soft coastline: how much of the neighbourhood is water
  float o = 1.6 / uSpan;
  float wet = s.g
    + texture(uField, vec3(uvw01.x + o, row, uvw01.z)).g
    + texture(uField, vec3(uvw01.x - o, row, uvw01.z)).g
    + texture(uField, vec3(uvw01.x, row, uvw01.z + o)).g
    + texture(uField, vec3(uvw01.x, row, uvw01.z - o)).g;
  wet *= 0.2;

  if (s.g < 0.5) {                        // ---- land ----
    float relief = fbm(p.xz * 0.038) * 0.82 + fbm(p.xz * 0.115) * 0.18;
    vec3 low  = vec3(0.180, 0.251, 0.161);
    vec3 high = vec3(0.353, 0.333, 0.220);
    vec3 c = mix(low, high, smoothstep(0.32, 0.78, relief));
    c = mix(vec3(0.475, 0.443, 0.337), c, smoothstep(0.05, 0.45, 1.0 - wet)); // beach
    // relief shading from the noise gradient
    float e = 2.2;
    float h0 = fbm(p.xz * 0.038);
    float hx = fbm((p.xz + vec2(e, 0.0)) * 0.038) - h0;
    float hz = fbm((p.xz + vec2(0.0, e)) * 0.038) - h0;
    outNormal = normalize(vec3(-hx * 7.5, 1.0, -hz * 7.5));
    return c * (0.86 + 0.30 * relief);
  }

  // ---- water ----
  // Local contrast: surface temperature varies by well under a degree across
  // an open-ocean tile, so the full 8-31 degC ramp renders it as one flat
  // colour. Expand around the tile's own surface mean instead.
  float t = clamp(0.5 + (s.r - uSurfMid) * uSurfGain, 0.0, 1.0);
  vec3 cold = vec3(0.016, 0.075, 0.216);
  vec3 warm = vec3(0.106, 0.427, 0.573);
  vec3 c = mix(cold, warm, t);

  // wave field: two directional swells plus two octaves of FBM chop
  vec2 q = p.xz;
  float h =
      sin(dot(q, vec2(0.86, 0.51)) * 0.115) * 0.42
    + sin(dot(q, vec2(-0.42, 0.91)) * 0.192) * 0.26
    + fbm(q * 0.052) * 1.30
    + fbm(q * 0.235) * 0.34;
  float e = 1.1;
  float hx =
      sin(dot(q + vec2(e, 0.0), vec2(0.86, 0.51)) * 0.115) * 0.42
    + sin(dot(q + vec2(e, 0.0), vec2(-0.42, 0.91)) * 0.192) * 0.26
    + fbm((q + vec2(e, 0.0)) * 0.052) * 1.30
    + fbm((q + vec2(e, 0.0)) * 0.235) * 0.34;
  float hz =
      sin(dot(q + vec2(0.0, e), vec2(0.86, 0.51)) * 0.115) * 0.42
    + sin(dot(q + vec2(0.0, e), vec2(-0.42, 0.91)) * 0.192) * 0.26
    + fbm((q + vec2(0.0, e)) * 0.052) * 1.30
    + fbm((q + vec2(0.0, e)) * 0.235) * 0.34;

  outNormal = normalize(vec3(-(hx - h) * 3.4, 1.0, -(hz - h) * 3.4));

  // crests catch light, troughs go deeper
  c *= 0.80 + 0.46 * smoothstep(-0.4, 1.4, h);
  // shallow water over the shelf reads lighter, as it does from the air
  float shelf = 1.0 - texture(uHeightMap, uvw01.xz).r;
  c = mix(c, c * 1.5 + vec3(0.02, 0.06, 0.06), smoothstep(0.55, 0.98, shelf) * 0.75);
  // surf line where the water meets the coast
  c += vec3(0.30, 0.34, 0.36) * smoothstep(0.42, 0.98, 1.0 - abs(wet - 0.55) * 2.4) * 0.55;
  return c;
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 p = vWorldPos;
  vec3 span = uBoxMax - uBoxMin;
  vec3 uvw01 = clamp((p - uBoxMin) / span, 0.0, 1.0);

  vec2 huv = clamp((p.xz - uBoxMin.xz) / span.xz, 0.002, 0.998);
  float floorY = mix(uFloorRange.x, uFloorRange.y, texture(uHeightMap, huv).r);

  bool sliced = uClipY < -0.01;
  bool isTop = n.y > 0.5;
  bool isBottom = n.y < -0.5;

  vec3 base;
  vec3 shadeN = n;          // normal used for lighting; the top face perturbs it
  float specAmount = 0.0;

  if (isTop && !sliced && uStylizedTop > 0.5) {
    base = topSurface(p, uvw01, shadeN);
    specAmount = 1.0;
  } else if (isTop && !sliced) {
    base = vec3(0.106, 0.129, 0.169);
  } else if (isBottom) {
    base = vec3(0.075, 0.086, 0.106) * (0.85 + 0.3 * fbm(p.xz * 0.09));
  } else {
    base = sectionColor(p, uvw01, floorY);
  }

  // --- face-local coordinates, for gradient + edge occlusion --------------
  vec2 fuv = isTop || isBottom
    ? uvw01.xz
    : (abs(n.x) > 0.5 ? vec2(uvw01.z, uvw01.y) : vec2(uvw01.x, uvw01.y));

  // ambient occlusion creases along every edge of the block
  vec2 ed = min(fuv, 1.0 - fuv);
  float ao = smoothstep(0.0, 0.030, min(ed.x, ed.y));

  // a gentle gradient across each face so no face is one flat tone
  float grad = isTop || isBottom
    ? mix(0.94, 1.06, fuv.x * 0.5 + fuv.y * 0.5)
    : mix(0.80, 1.08, fuv.y) * mix(0.96, 1.05, fuv.x);

  vec3 L = normalize(LIGHT);
  float diff = max(dot(shadeN, L), 0.0);
  float fill = max(dot(shadeN, normalize(vec3(-0.62, 0.28, -0.55))), 0.0);
  float shade = (0.52 + 0.38 * diff + 0.22 * fill) * grad * mix(0.55, 1.0, ao);

  vec3 col = base * shade;
  // cool sky bounce on upward-facing surfaces, warm bounce low on the walls
  col += base * vec3(0.06, 0.09, 0.14) * max(shadeN.y, 0.0) * 0.6;

  // specular + sky fresnel, water only
  if (specAmount > 0.0) {
    vec3 V = normalize(cameraPosition - p);
    vec3 H = normalize(L + V);
    col += vec3(0.85, 0.92, 1.0) * pow(max(dot(shadeN, H), 0.0), 46.0) * 0.55;
    float fres = pow(1.0 - max(dot(shadeN, V), 0.0), 4.0);
    col += vec3(0.10, 0.16, 0.26) * fres * 0.7;
  }

  // thin bright lip along the very edge, so the block has a defined silhouette
  float lip = 1.0 - smoothstep(0.0, 0.004, min(ed.x, ed.y));
  col = mix(col, col + vec3(0.09, 0.11, 0.14), lip * 0.55);

  outColor = vec4(col, 1.0);
}
`

export default function DioramaBlock({ dataset, meshRef }) {
  const depthClip = useVisualizationState((s) => s.depthClip)
  const vertExag = useVisualizationState((s) => s.vertExag)
  const showContours = useVisualizationState((s) => s.showContours)
  const showDetail = useVisualizationState((s) => s.showDetail)

  const { boxDepth, boxSpan } = dataset.meta.bathymetry
  const half = boxSpan / 2
  const v = dataset.meta.volume

  // one contour per 2 °C, expressed in normalised units
  const contourStep = 2 / (v.valueMax - v.valueMin)
  // the warmest water in the tile is at the surface, so its normalised value is
  // the right centre for the surface-shading contrast expansion
  const surfMid = (v.dataMax - v.valueMin) / (v.valueMax - v.valueMin) - 0.02

  const uniforms = useMemo(
    () => ({
      uField: { value: dataset.field },
      uLUT: { value: dataset.lut },
      uHeightMap: { value: dataset.height },
      uBoxMin: { value: new THREE.Vector3(-half, -boxDepth, -half) },
      uBoxMax: { value: new THREE.Vector3(half, 0, half) },
      uFloorRange: { value: new THREE.Vector2(-boxDepth, 0) },
      uClipY: { value: 0 },
      uSat: { value: 1.34 },
      uContour: { value: 1 },
      uContourStep: { value: contourStep },
      uSurfMid: { value: surfMid },
      uSurfGain: { value: 26 },
      uStylizedTop: { value: 1 },
      uSpan: { value: boxSpan },
    }),
    [dataset, half, boxDepth, boxSpan, contourStep, surfMid],
  )

  // Vertical exaggeration scales the box and the floor range TOGETHER, exactly
  // as the raymarch did — the water must never de-register from the seafloor.
  const d = boxDepth * vertExag
  const clipY = Math.max(depthClip * vertExag, -d + 0.4)   // never a zero-height block
  const height = d + clipY

  useEffect(() => {
    uniforms.uBoxMin.value.set(-half, -d, -half)
    uniforms.uFloorRange.value.set(-d, 0)
    uniforms.uClipY.value = clipY
    uniforms.uContour.value = showContours ? 1 : 0
    uniforms.uStylizedTop.value = showDetail ? 1 : 0
    uniforms.uContourStep.value = contourStep
  }, [uniforms, d, clipY, half, showContours, showDetail, contourStep])

  const geom = useMemo(() => new THREE.BoxGeometry(boxSpan, 1, boxSpan), [boxSpan])
  const edges = useMemo(() => new THREE.EdgesGeometry(geom), [geom])

  // scale the unit-height box rather than rebuilding geometry every frame
  const centerY = (clipY - d) / 2

  return (
    <group position={[0, centerY, 0]} scale={[1, height, 1]}>
      <mesh ref={meshRef} geometry={geom} userData={{ pickTarget: true }}>
        <rawShaderMaterial
          glslVersion={THREE.GLSL3}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
          side={THREE.FrontSide}
        />
      </mesh>
      <lineSegments geometry={edges} raycast={() => null}>
        <lineBasicMaterial color="#9db4d0" transparent opacity={0.55} />
      </lineSegments>
    </group>
  )
}
