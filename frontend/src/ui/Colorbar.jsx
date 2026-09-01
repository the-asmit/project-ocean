import Panel from './Panel.jsx'
import { useVisualizationState } from '../state/useVisualizationState.js'
import { useColorScale } from '../state/useColorScale.js'
import { PALETTES, paletteCSS } from '../scene/colorScale.js'
import { spanDecimals } from './variableTerms.js'

// The scale, and the controls that edit it.
//
// Everything here writes to ONE scale object (useColorScale), which the block
// shader, the isosurface, the glider ribbon, the section isolines and the
// profile knots all read. There is no way to change the colour of this bar
// without changing the colour of the volume by the same amount.
//
// The range policy underneath is untouched: the backend still bakes a fixed
// 8-33 degC clamp for temperature and a per-tile clamp for salinity, and the
// editor can only narrow what that produced — see colorScale.js on why it
// cannot widen it.

function fmt(x, dp) {
  return Number.isFinite(x) ? x.toFixed(dp) : '—'
}

export default function Colorbar({ dataset }) {
  const variable = useVisualizationState((s) => s.variable)
  const paletteId = useVisualizationState((s) => s.palette)
  const setPalette = useVisualizationState((s) => s.setPalette)
  const logScale = useVisualizationState((s) => s.logScale)
  const setLogScale = useVisualizationState((s) => s.setLogScale)
  const setCustomRange = useVisualizationState((s) => s.setCustomRange)
  const resetCustomRange = useVisualizationState((s) => s.resetCustomRange)

  const v = dataset.meta.volume
  const info = dataset.meta.variables[variable]
  const scale = useColorScale(dataset)
  const { lo, hi, step } = scale
  const ticks = [1, 0.75, 0.5, 0.25, 0]
  // A 25 degC range reads fine as whole degrees; a 4 PSU range quantised to a
  // quarter would print 31.3 / 32.3 and hide the steps it actually sits on.
  // Taken off the DISPLAYED span, so narrowing the range gains the digits it needs.
  const dp = spanDecimals(hi - lo)
  const fitted = v.rangeMode === 'tile'
  const badge = scale.custom ? 'CUSTOM RANGE' : fitted ? 'FITTED TO TILE' : 'FIXED SCALE'
  const badgeClass = scale.custom ? 'custom' : fitted ? 'fitted' : ''

  // Where a log scale would put the middle of this range. Reported as a real
  // number rather than as advice, because the answer differs by variable: it
  // moves the midpoint a sixth of the bar for temperature and by nothing you
  // can see for salinity, whose two ends differ by a factor of 1.13.
  const midLogPos = lo > 0
    ? (Math.log((lo + hi) / 2) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))
    : null

  const defaultLabel = fitted
    ? "the tile's own range"
    : `the fixed ${fmt(v.valueMin, 0)}-${fmt(v.valueMax, 0)} ${info.units} scale`

  return (
    <Panel title="Scale" sub={`${info.label} · ${info.units}`}>
      <div className="cbar">
        <div className="bar" style={{ background: scale.gradient, height: 132 }} />
        <div className="ticks" style={{ height: 132 }}>
          {/* labels sit at POSITIONS on the bar, so a log scale moves the
              numbers rather than the gradient */}
          {ticks.map((t) => (
            <span key={t} style={{ top: `${(1 - t) * 100}%` }}>
              {fmt(scale.valueAt(t), dp)}
            </span>
          ))}
        </div>
      </div>
      <div className="cbar-foot">
        <span>in tile</span>
        <span>{fmt(v.dataMin, dp)}–{fmt(v.dataMax, dp)} {info.units}</span>
      </div>

      {/* The two variables use different range policies, and that changes what
          a colour MEANS. Stating it here rather than in a tooltip, because a
          reader comparing two tiles by eye has to know which case they are in. */}
      <div className={`scale-mode ${badgeClass}`}>
        <div className="badges">
          <span className="badge">{badge}</span>
          {scale.log && <span className="badge log">LOG</span>}
        </div>
        <span>
          {scale.custom
            ? `Range set by hand to ${fmt(lo, dp)}–${fmt(hi, dp)} ${info.units}, inside this tile's ${fmt(v.valueMin, dp)}–${fmt(v.valueMax, dp)} data window. Default is ${defaultLabel}.`
            : fitted
              ? `Scale is this tile's own ${v.dataMin.toFixed(1)}–${v.dataMax.toFixed(1)} range — salinity is set by geography, so colours are NOT comparable with another tile.`
              : `Same ${fmt(v.valueMin, 0)}–${fmt(v.valueMax, 0)} ${info.units} scale on every tile — colours are comparable between tiles.`}
        </span>
      </div>

      <div className="cedit">
        <div className="crow">
          <span className="clbl">Palette</span>
          <div className="pals">
            {PALETTES.map((p) => (
              <button
                key={p.id} type="button" title={p.label}
                aria-label={p.label} aria-pressed={p.id === paletteId}
                className={`pal${p.id === paletteId ? ' on' : ''}`}
                style={{ background: paletteCSS(p.id, 'to right') }}
                onClick={() => setPalette(p.id)}
              />
            ))}
          </div>
        </div>
        <div className="hint">{scale.palette.label} — {scale.palette.note}</div>

        <div className="field">
          <div className="srow">
            <label className="lbl" htmlFor="cs-lo">Range min</label>
            <span className="num">{fmt(lo, dp)} {info.units}</span>
          </div>
          <input
            id="cs-lo" type="range" min={v.valueMin} max={v.valueMax} step={step}
            value={lo}
            onChange={(e) => setCustomRange([Math.min(parseFloat(e.target.value), hi - step), hi])}
          />
        </div>
        <div className="field">
          <div className="srow">
            <label className="lbl" htmlFor="cs-hi">Range max</label>
            <span className="num">{fmt(hi, dp)} {info.units}</span>
          </div>
          <input
            id="cs-hi" type="range" min={v.valueMin} max={v.valueMax} step={step}
            value={hi}
            onChange={(e) => setCustomRange([lo, Math.max(parseFloat(e.target.value), lo + step)])}
          />
        </div>
        {/* The stops ARE the hard limit: the volume arrives already clipped to
            the baked window, so there is nothing outside it left to show. Said
            here rather than left to be discovered by dragging. */}
        <div className="hint">
          Limits are this tile's baked {fmt(v.valueMin, dp)}–{fmt(v.valueMax, dp)} {info.units} window —
          the volume was clipped to it before download, so the scale narrows but cannot widen.
        </div>

        <div className="crow">
          <span className="clbl">Mapping</span>
          <div className="seg">
            <button
              type="button" className={logScale ? '' : 'on'}
              aria-pressed={!logScale} onClick={() => setLogScale(false)}
            >
              Linear
            </button>
            <button
              type="button" className={scale.log ? 'on' : ''}
              aria-pressed={scale.log} disabled={lo <= 0}
              onClick={() => setLogScale(true)}
            >
              Log
            </button>
          </div>
          <span className="spacer" />
          {scale.custom && (
            <button type="button" className="btn creset" onClick={resetCustomRange}>
              Reset
            </button>
          )}
        </div>
        <div className="hint">
          {lo <= 0
            ? `Log needs a positive minimum; this range starts at ${fmt(lo, dp)} ${info.units}.`
            : `Log puts this range's midpoint at ${(midLogPos * 100).toFixed(0)}% of the bar instead of 50%${
              Math.abs(midLogPos - 0.5) < 0.05
                ? ' — no visible difference over a span this narrow.'
                : '. Neither temperature nor salinity is a log quantity, so this is a display choice, not a physical one.'
            }`}
        </div>
      </div>
    </Panel>
  )
}
