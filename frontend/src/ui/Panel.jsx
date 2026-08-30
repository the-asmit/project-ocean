// The one container in the dashboard. Everything is a Panel with a hairline
// header — no nested cards, no floating glass.

export default function Panel({ title, sub, tools, className = '', bodyClass = '', children, footer }) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-head">
        <h2>{title}</h2>
        {sub && <span className="sub">{sub}</span>}
        <span className="spacer" />
        {tools && <div className="tools">{tools}</div>}
      </header>
      <div className={`panel-body ${bodyClass}`}>{children}</div>
      {footer}
    </section>
  )
}

export function IconButton({ label, active, onClick, disabled, children }) {
  return (
    <button
      type="button"
      className={`ibtn${active ? ' on' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : !!active}
    >
      {children}
    </button>
  )
}
