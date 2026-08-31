import { useVisualizationState } from '../state/useVisualizationState.js'
import { useCurrentsState } from '../currents/useCurrentsState.js'

// Which field the Profile/Transect panels describe.
//
// The automatic rule sets a sensible default from the last layer gesture, but
// it stays visible and overridable rather than being a guess the user has to
// reverse-engineer — with currents on, no gesture would otherwise get you back
// to the scalar field's profile short of turning the layer off.
//
// Only subjects that actually have data are offered. A float selection outranks
// this entirely and replaces the panel, so it is not a choice here.
export default function SubjectSwitch() {
  const panelLayer = useVisualizationState((s) => s.panelLayer)
  const setPanelLayer = useVisualizationState((s) => s.setPanelLayer)
  const dataset = useVisualizationState((s) => s.dataset)
  const showCurrents = useCurrentsState((s) => s.showCurrents)
  if (!showCurrents) return null

  // The scalar button is named after whichever variable is loaded — it read
  // "Temp" while showing a salinity profile before salinity existed.
  const fieldLabel = dataset?.meta.volume.variableShort ?? 'Field'

  return (
    <div className="subject-switch" role="group" aria-label="Panel subject">
      {[['field', fieldLabel], ['currents', 'Flow']].map(([key, label]) => (
        <button
          key={key} type="button"
          className={panelLayer === key ? 'on' : undefined}
          aria-pressed={panelLayer === key}
          onClick={() => setPanelLayer(key)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// The subject the panels should render, resolved once so Profile and Transect
// can never disagree.
export function usePanelSubject() {
  const panelLayer = useVisualizationState((s) => s.panelLayer)
  const showCurrents = useCurrentsState((s) => s.showCurrents)
  return showCurrents && panelLayer === 'currents' ? 'currents' : 'field'
}
