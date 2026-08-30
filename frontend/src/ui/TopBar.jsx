export default function TopBar({ dataset }) {
  const m = dataset.meta
  const b = m.bbox
  const fmt = (v, pos, neg) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? pos : neg}`

  return (
    <div className="card overlay topbar">
      <div className="cell">
        <div className="h-label">Date</div>
        <div className="v">{m.date}</div>
      </div>
      <div className="cell">
        <div className="h-label">Source</div>
        <div className="v accent">{m.volume.source}</div>
      </div>
      <div className="cell">
        <div className="h-label">Region</div>
        <div className="v">
          {fmt(b.lat_min, 'N', 'S')}–{fmt(b.lat_max, 'N', 'S')}{'  '}
          {fmt(b.lon_min, 'E', 'W')}–{fmt(b.lon_max, 'E', 'W')}
        </div>
      </div>
      <div className="cell">
        <div className="h-label">Variable</div>
        <div className="v">{m.volume.variableLabel} <span style={{ opacity: .55 }}>{m.volume.units}</span></div>
      </div>
    </div>
  )
}
