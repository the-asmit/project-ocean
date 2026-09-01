// Authored icon set — one consistent grid (16), one stroke weight (1.5),
// round caps/joins, currentColor. Deliberately not emoji or unicode glyphs:
// those inherit a font's metrics and never match each other.

const base = {
  width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.5,
  strokeLinecap: 'round', strokeLinejoin: 'round',
  'aria-hidden': true, focusable: false,
}

const Svg = ({ size, children, ...rest }) => (
  <svg {...base} {...rest} width={size || 16} height={size || 16}>{children}</svg>
)

export const IconWave = (p) => (
  <Svg {...p}>
    <path d="M1.5 5.5c1.4 0 1.4 1.6 2.8 1.6S5.7 5.5 7.1 5.5s1.4 1.6 2.8 1.6 1.4-1.6 2.8-1.6 1.4 1.6 2.8 1.6" />
    <path d="M1.5 10.2c1.4 0 1.4 1.6 2.8 1.6s1.4-1.6 2.8-1.6 1.4 1.6 2.8 1.6 1.4-1.6 2.8-1.6 1.4 1.6 2.8 1.6" opacity=".55" />
  </Svg>
)

export const IconHome = (p) => (
  <Svg {...p}><path d="M2.5 7 8 2.5 13.5 7v6a.9.9 0 0 1-.9.9H3.4a.9.9 0 0 1-.9-.9z" /><path d="M6.3 13.9V9.2h3.4v4.7" /></Svg>
)

export const IconExpand = (p) => (
  <Svg {...p}><path d="M9.6 2.5h3.9v3.9M6.4 13.5H2.5V9.6M13.5 2.5 9.7 6.3M2.5 13.5l3.8-3.8" /></Svg>
)

export const IconCollapse = (p) => (
  <Svg {...p}><path d="M13.4 6.4H9.5V2.5M2.6 9.6h3.9v3.9M9.5 6.5l4-4M6.5 9.5l-4 4" /></Svg>
)

export const IconOrbit = (p) => (
  <Svg {...p}><circle cx="8" cy="8" r="2.4" /><ellipse cx="8" cy="8" rx="6.2" ry="2.7" transform="rotate(-28 8 8)" /></Svg>
)

export const IconFly = (p) => (
  <Svg {...p}><path d="M8 1.9 14 14 8 11.1 2 14z" /></Svg>
)

export const IconCheck = (p) => (
  <Svg {...p} strokeWidth={2}><path d="M3.2 8.4 6.3 11.5l6.5-7" /></Svg>
)

export const IconPin = (p) => (
  <Svg {...p}><path d="M8 14.2V9.4" /><path d="M4.8 6.1a3.2 3.2 0 1 1 6.4 0c0 1.6-1.2 2.6-1.2 3.3H6c0-.7-1.2-1.7-1.2-3.3Z" /></Svg>
)

export const IconTarget = (p) => (
  <Svg {...p}><circle cx="8" cy="8" r="4.6" /><path d="M8 .9v2.5M8 12.6v2.5M.9 8h2.5M12.6 8h2.5" /><circle cx="8" cy="8" r=".9" fill="currentColor" stroke="none" /></Svg>
)

export const IconTransect = (p) => (
  <Svg {...p}><path d="M1.6 4.2h12.8" opacity=".5" /><path d="M1.6 12.6c1.8 0 2.2-3.1 3.6-3.1s1.6 2.1 3 2.1 1.9-3.4 3.3-3.4c.9 0 1.4 1 2.9 1" /><path d="M1.6 8.4c1.8 0 2.2-2.6 3.6-2.6" opacity=".5" /></Svg>
)

export const IconProfile = (p) => (
  <Svg {...p}><path d="M3 1.8v12.4h11" opacity=".5" /><path d="M12.4 2.6c-3.4.6-5.6 3-6.4 6.2-.3 1.2-.4 2.6-.4 4" /></Svg>
)

export const IconLayers = (p) => (
  <Svg {...p}><path d="M8 1.8 14.4 5 8 8.2 1.6 5z" /><path d="m1.6 8.6 6.4 3.2 6.4-3.2" /><path d="m1.6 11.9 6.4 3.2 6.4-3.2" opacity=".5" /></Svg>
)

export const IconRuler = (p) => (
  <Svg {...p}><rect x="1.3" y="5.6" width="13.4" height="4.8" rx=".8" transform="rotate(-45 8 8)" /><path d="M6.2 4.6 7.4 5.8M8.4 6.8 9.6 8M4 6.8l1.2 1.2" /></Svg>
)

export const IconSelect = (p) => (
  <Svg {...p}><path d="M2.4 2.4h2.8M10.8 2.4h2.8M2.4 13.6h2.8M10.8 13.6h2.8M2.4 5.2v2.8M2.4 10.8v-.8M13.6 5.2v2.8M13.6 10.8v-.8" /></Svg>
)

export const IconSlice = (p) => (
  <Svg {...p}><path d="M1.8 5.4 8 2.2l6.2 3.2L8 8.6z" /><path d="M1.8 10.2 8 13.4l6.2-3.2" opacity=".55" /></Svg>
)

// Operational layer — a cyclone spiral. The group is named for the hazard
// quantities it will hold (TCHP, D26), so the mark is the hazard, not a gauge.
export const IconCyclone = (p) => (
  <Svg {...p}>
    <path d="M8 8c0-1.75 1.5-3.05 3.4-3.05 1.95 0 3.1 1.35 3.1 2.9 0 2.6-2.6 4.65-6.5 4.65" />
    <path d="M8 8c0 1.75-1.5 3.05-3.4 3.05-1.95 0-3.1-1.35-3.1-2.9C1.5 5.55 4.1 3.5 8 3.5" />
    <circle cx="8" cy="8" r=".95" fill="currentColor" stroke="none" />
  </Svg>
)

// Scale — the colour ramp as a stepped bar beside its tick labels.
export const IconRamp = (p) => (
  <Svg {...p}>
    <rect x="2.6" y="1.9" width="4.8" height="12.2" rx="1" />
    <path d="M2.6 6h4.8M2.6 10h4.8" />
    <path d="M9.8 3.3h3.6M9.8 8h3.6M9.8 12.7h3.6" opacity=".5" />
  </Svg>
)

export const IconHelp = (p) => (
  <Svg {...p}><circle cx="8" cy="8" r="6.2" /><path d="M6.3 6.2a1.75 1.75 0 1 1 2.4 1.6c-.5.2-.7.6-.7 1.1v.4" /><circle cx="8" cy="11.5" r=".75" fill="currentColor" stroke="none" /></Svg>
)

export const IconAlert = (p) => (
  <Svg {...p}><path d="M8 2.4 14.6 13.6H1.4z" /><path d="M8 6.6v3.1" /><circle cx="8" cy="11.7" r=".75" fill="currentColor" stroke="none" /></Svg>
)

// Transport controls for the synthetic time scrubber. Same grid and weight as
// the rest; play/pause are filled because a transport button reads faster as a
// solid than as an outline at this size.
export const IconPlay = (p) => (
  <Svg {...p}><path d="M5 3.2 12.4 8 5 12.8Z" fill="currentColor" strokeWidth="1.2" /></Svg>
)
export const IconPause = (p) => (
  <Svg {...p}>
    <path d="M5.6 3.4v9.2M10.4 3.4v9.2" strokeWidth="1.9" />
  </Svg>
)
export const IconPrev = (p) => (
  <Svg {...p}>
    <path d="M11.6 3.4 5.6 8l6 4.6Z" fill="currentColor" strokeWidth="1.2" />
    <path d="M4 3.6v8.8" />
  </Svg>
)
export const IconNext = (p) => (
  <Svg {...p}>
    <path d="M4.4 3.4 10.4 8l-6 4.6Z" fill="currentColor" strokeWidth="1.2" />
    <path d="M12 3.6v8.8" />
  </Svg>
)
