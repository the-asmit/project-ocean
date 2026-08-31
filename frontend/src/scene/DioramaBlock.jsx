import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { blockLayout } from './blockLayout.js'
import { westStops, westCutForIndex } from './sliceStops.js'
import { ruggedChunk, cutOutline, chunkGhostOutline, chunkSeed } from './chunkGeometry.js'

// ===========================================================================
// Bounded diorama chunk — a finite display object, not an infinite fog volume.
//
// A rugged, torn chunk of seafloor sliced clean through by two knife planes,
// the way a cut tennis ball shows a smooth face against a fuzzy exterior. The
// fragment shader branches on a per-face KIND attribute rather than the normal,
// because the torn shell's normals point everywhere:
//   * cut faces   -> vertical cross-section through the REAL field
//   * top face    -> stylized sea surface / terrain, OR the horizontal section
//                    once the depth-clip has sliced the chunk down
//   * torn shell  -> broken rock; carries no data and reports none
//   * base        -> abyss rock
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
in float aKind;                   // 0 shell, 1 cut face, 2 top, 3 base
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;

out vec3 vWorldPos;
out vec3 vNormal;
flat out float vKind;             // flat: a face is one kind, never a blend

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  vNormal = normal;                 // chunk is axis-aligned and unrotated
  vKind = aKind;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const fragmentShader = /* glsl */ `
precision highp float;
precision highp sampler3D;

#define LUT_N ${LUT_N}

in vec3 vWorldPos;
in vec3 vNormal;
flat in float vKind;
out vec4 outColor;

uniform vec3 cameraPosition;

uniform sampler3D uField;      // RG8 — .r value, .g validity
uniform float uLUT[LUT_N];     // box depth fraction -> field row texcoord
uniform sampler2D uHeightMap;  // R8, 0..1 normalised seafloor height
uniform vec3 uBoxMin;          // ALWAYS the full block, even when clipped
uniform vec3 uBoxMax;
uniform vec2 uFloorRange;
uniform float uSliced;
uniform float uClipNorm;
uniform float uWallTop;
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
vec3 sectionColor(vec2 hxz, float depthFrac, float effY, float floorY) {
  // below the real seafloor: block body, not water. Mottled so the rock reads
  // as material rather than as a flat fill — decorative, and off the ramp.
  if (effY < floorY) {
    float t = clamp((floorY - effY) / max(0.001, floorY - uBoxMin.y), 0.0, 1.0);
    vec3 rock = mix(vec3(0.341, 0.357, 0.400), vec3(0.153, 0.165, 0.196), t);
    vec2 rq = vec2((hxz.x + hxz.y) * 3.4, 1.0 - depthFrac);
    float strata = fbm(rq * vec2(2.4, 30.0));            // bedding planes
    float mottle = fbm(rq * vec2(9.0, 7.0));             // broad relief
    float fine = fbm(rq * vec2(26.0, 60.0));             // grain
    rock *= 0.62 + 0.46 * mottle + 0.30 * strata + 0.12 * fine;
    return rock;
  }

  vec2 s = texture(uField, vec3(hxz.x, fieldRow(depthFrac), hxz.y)).rg;

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

// --- the torn outer shell: broken rock, never data -----------------------
// Deliberately drab and desaturated so it can never be confused with the
// temperature ramp two faces away — the cut is what carries meaning here.
vec3 shellRock(vec3 p, vec3 n, out vec3 outNormal) {
  // triplanar-ish: drive the strata off world height, the mottle off the face
  vec2 q = abs(n.x) > abs(n.z) ? p.zy : p.xy;
  float strata = fbm(vec2(q.x * 0.05, q.y * 0.62));
  float mottle = fbm(q * 0.085);
  float grain  = fbm(q * 0.34);

  vec3 warmRock = vec3(0.404, 0.353, 0.302);
  vec3 coolRock = vec3(0.239, 0.255, 0.290);
  vec3 c = mix(coolRock, warmRock, smoothstep(0.26, 0.76, mottle));
  c *= 0.62 + 0.52 * mottle + 0.34 * strata + 0.18 * grain;

  // fractured relief: perturb the normal off the same field so the shell
  // catches light unevenly instead of reading as one tilted plane
  float e = 1.4;
  float h0 = mottle * 0.7 + grain * 0.3;
  float hu = fbm((q + vec2(e, 0.0)) * 0.085) * 0.7 + fbm((q + vec2(e, 0.0)) * 0.34) * 0.3 - h0;
  float hv = fbm((q + vec2(0.0, e)) * 0.085) * 0.7 + fbm((q + vec2(0.0, e)) * 0.34) * 0.3 - h0;
  vec3 t1 = normalize(abs(n.y) > 0.9 ? vec3(1, 0, 0) : cross(vec3(0, 1, 0), n));
  vec3 t2 = cross(n, t1);
  outNormal = normalize(n - t1 * hu * 5.5 - t2 * hv * 5.5);
  return c;
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 p = vWorldPos;


  vec3 span = uBoxMax - uBoxMin;
  vec3 uvw01 = clamp((p - uBoxMin) / span, 0.0, 1.0);

  vec2 huv = clamp((p.xz - uBoxMin.xz) / span.xz, 0.002, 0.998);
  float floorY = mix(uFloorRange.x, uFloorRange.y, texture(uHeightMap, huv).r);

  int kind = int(vKind + 0.5);
  bool isTop = kind == 2;
  bool isCut = kind == 1;
  bool isBottom = kind == 3;
  bool isShell = kind == 0;

  vec3 base;
  vec3 shadeN = n;          // normal used for lighting; textures perturb it
  float specAmount = 0.0;

  if (isShell) {
    base = shellRock(p, n, shadeN);
  } else if (isTop) {
    if (uSliced > 0.5) {
      // exact section at the clip depth — the bevel must not shift it
      base = sectionColor(uvw01.xz, uClipNorm, uWallTop, floorY);
    } else if (uStylizedTop > 0.5) {
      base = topSurface(p, uvw01, shadeN);
      specAmount = 1.0;
    } else {
      base = vec3(0.106, 0.129, 0.169);
    }
  } else if (isBottom) {
    base = vec3(0.075, 0.086, 0.106) * (0.85 + 0.3 * fbm(p.xz * 0.09));
  } else {
    base = sectionColor(uvw01.xz, clamp(1.0 - uvw01.y, 0.0, 1.0), p.y, floorY);
  }

  // --- face-local coordinates, for gradient + edge occlusion --------------
  vec2 fuv = (isTop || isBottom || isShell)
    ? uvw01.xz
    : (abs(n.x) > 0.5 ? vec2(uvw01.z, uvw01.y) : vec2(uvw01.x, uvw01.y));

  // Ambient occlusion creases along the knife-cut edges. The torn shell opts
  // out: its own relief already shades it, and a rectangle-shaped crease would
  // reintroduce exactly the box read this geometry exists to break.
  vec2 ed = min(fuv, 1.0 - fuv);
  float ao = isShell ? 1.0 : smoothstep(0.0, 0.030, min(ed.x, ed.y));

  // a gentle gradient across each face so no face is one flat tone
  float grad = isShell
    ? 1.0
    : (isTop || isBottom
      ? mix(0.94, 1.06, fuv.x * 0.5 + fuv.y * 0.5)
      : mix(0.80, 1.08, fuv.y) * mix(0.96, 1.05, fuv.x));

  vec3 L = normalize(LIGHT);
  float diff = max(dot(shadeN, L), 0.0);
  float fill = max(dot(shadeN, normalize(vec3(-0.62, 0.28, -0.55))), 0.0);
  float shade = (0.52 + 0.38 * diff + 0.22 * fill) * grad * mix(0.55, 1.0, ao);

  vec3 col = base * shade;
  // cool sky bounce on upward-facing surfaces, warm bounce low on the walls
  col += base * vec3(0.06, 0.09, 0.14) * max(shadeN.y, 0.0) * 0.6;

  // broken rock catches a broad, low glint on its facets — enough to read the
  // relief, nowhere near enough to look polished
  if (isShell) {
    vec3 V = normalize(cameraPosition - p);
    vec3 H = normalize(normalize(LIGHT) + V);
    col += vec3(0.34, 0.36, 0.42) * pow(max(dot(shadeN, H), 0.0), 12.0) * 0.30;
  }

  // specular + sky fresnel, water only
  if (specAmount > 0.0) {
    vec3 V = normalize(cameraPosition - p);
    vec3 H = normalize(L + V);
    col += vec3(0.85, 0.92, 1.0) * pow(max(dot(shadeN, H), 0.0), 46.0) * 0.55;
    float fres = pow(1.0 - max(dot(shadeN, V), 0.0), 4.0);
    col += vec3(0.10, 0.16, 0.26) * fres * 0.7;
  }

  // thin bright lip along the very edge, so the block has a defined silhouette
  float lip = isShell ? 0.0 : 1.0 - smoothstep(0.0, 0.004, min(ed.x, ed.y));
  col = mix(col, col + vec3(0.09, 0.11, 0.14), lip * 0.55);

  outColor = vec4(col, 1.0);
}
`

export default function DioramaBlock({ dataset, meshRef }) {
  const depthClip = useVisualizationState((s) => s.depthClip)
  const vertExag = useVisualizationState((s) => s.vertExag)
  const showContours = useVisualizationState((s) => s.showContours)
  const showDetail = useVisualizationState((s) => s.showDetail)
  const westIndex = useVisualizationState((s) => s.westIndex)

  // The two cuts are independent: depthClip takes the top off, westCut takes
  // the west side off, and each removes its own part of what the other left.
  const westCut = westCutForIndex(dataset, westStops(dataset), westIndex)
  const L = blockLayout(dataset, vertExag, depthClip, westCut)
  const { spanX, spanZ, halfX, halfZ } = L
  const tileKey = `${dataset.meta.region}|${dataset.meta.date}|${dataset.meta.volume.variable}`
  // Every region gets its own tear pattern, and the same region always gets the
  // same one — a chunk that reshuffled on every re-render would read as noise.
  const seed = useMemo(() => chunkSeed(tileKey), [tileKey])
  const v = dataset.meta.volume

  // Contour interval in the variable's own units, from the manifest: 2 °C for
  // temperature on every tile, and a per-tile round number for salinity, whose
  // range is the tile's own.
  const contourStep = v.contourStep / (v.valueMax - v.valueMin)
  // The contrast expansion below centres on the SURFACE, which is what the
  // shader comment has always said it wanted. It used dataMax as a stand-in,
  // which holds only while the extreme value sits at the surface — true for
  // temperature (warmest on top), false for salinity, whose surface is the
  // FRESHEST water: 1.8 PSU from dataMax on the Bay tile, 48% of its span.
  const surfMid = (v.surfaceMedian - v.valueMin) / (v.valueMax - v.valueMin)

  const uniforms = useMemo(
    () => ({
      uField: { value: dataset.field },
      uLUT: { value: dataset.lut },
      uHeightMap: { value: dataset.height },
      uBoxMin: { value: new THREE.Vector3(-halfX, L.boxMinY, -halfZ) },
      uBoxMax: { value: new THREE.Vector3(halfX, L.boxMaxY, halfZ) },
      uFloorRange: { value: new THREE.Vector2(L.boxMinY, L.boxMaxY) },
      uSliced: { value: 0 },
      uClipNorm: { value: 0 },
      uWallTop: { value: L.wallTop },
      uSat: { value: 1.34 },
      uContour: { value: 1 },
      uContourStep: { value: contourStep },
      uSurfMid: { value: surfMid },
      uSurfGain: { value: 26 },
      uStylizedTop: { value: 1 },
      uSpan: { value: spanX },
    }),
    [dataset, halfX, halfZ, spanX, contourStep, surfMid],   // eslint-disable-line
  )

  // Vertical exaggeration scales the box and the floor range TOGETHER, exactly
  // as the raymarch did — the water must never de-register from the seafloor.
  useEffect(() => {
    uniforms.uBoxMin.value.set(-halfX, L.boxMinY, -halfZ)
    uniforms.uBoxMax.value.set(halfX, L.boxMaxY, halfZ)
    uniforms.uFloorRange.value.set(L.boxMinY, L.boxMaxY)
    uniforms.uSliced.value = L.clipNorm > 0.001 ? 1 : 0
    uniforms.uClipNorm.value = L.clipNorm
    uniforms.uWallTop.value = L.wallTop
    uniforms.uContour.value = showContours ? 1 : 0
    uniforms.uStylizedTop.value = showDetail ? 1 : 0
    uniforms.uContourStep.value = contourStep
    if (import.meta.env.DEV) window.__oceanBlock = { ...L, uniforms }
  }, [uniforms, L, halfX, halfZ, showContours, showDetail, contourStep])

  // The chunk is built in world Y around the layout's own top/bottom, then the
  // group re-centres it — so the cut planes land exactly on the data box and
  // the depth ruler's ticks line up with the section they label.
  const geom = useMemo(
    () => ruggedChunk(spanX, spanZ, L.wallTop - L.centerY, L.geomBot - L.centerY, seed, L.westCut),
    [spanX, spanZ, L.wallTop, L.geomBot, L.centerY, seed, L.westCut],
  )
  const edges = useMemo(
    () => cutOutline(spanX, spanZ, L.wallTop - L.centerY, L.geomBot - L.centerY, L.westCut),
    [spanX, spanZ, L.wallTop, L.geomBot, L.centerY, L.westCut],
  )
  // Ghost of what either slice removed: the silhouette of the UNCUT chunk —
  // closed top ring, closed base ring, sparse uprights. Purely decorative
  // lines laid over the working geometry-rebuild slice; it clips nothing and
  // renders nothing of its own. Depth testing is left ON, so the solid block
  // hides the part of the outline that still exists and only the missing part
  // shows — which is exactly the reference the cut needs.
  const sliceActive = L.westCut > 1e-6 || L.clipNorm > 1e-6
  const ghost = useMemo(() => {
    if (!sliceActive) return null
    const full = ruggedChunk(
      spanX, spanZ, L.boxMaxY - L.centerY, L.boxMinY - L.centerY, seed, 0,
    )
    const outline = chunkGhostOutline(full)
    full.dispose()          // only its rings were wanted, not its triangles
    return outline
  }, [sliceActive, spanX, spanZ, L.boxMaxY, L.boxMinY, L.centerY, seed])

  useEffect(() => () => { geom.dispose(); edges.dispose() }, [geom, edges])
  useEffect(() => () => ghost?.dispose(), [ghost])

  return (
    <group position={[0, L.centerY, 0]}>
      <mesh ref={meshRef} geometry={geom} userData={{ pickTarget: true }}>
        <rawShaderMaterial
          key={tileKey}
          glslVersion={THREE.GLSL3}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
          side={THREE.FrontSide}
        />
      </mesh>
      {ghost && (
        <lineSegments geometry={ghost} raycast={() => null}>
          <lineBasicMaterial
            color="#7d93ad" transparent opacity={0.22} depthWrite={false}
          />
        </lineSegments>
      )}
      <lineSegments geometry={edges} raycast={() => null}>
        <lineBasicMaterial color="#9db4d0" transparent opacity={0.55} />
      </lineSegments>
    </group>
  )
}
