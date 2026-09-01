import Panel, { IconButton } from '../Panel.jsx'
import SectionControls from '../SectionControls.jsx'
import Colorbar from '../Colorbar.jsx'
import OperationalPanel from './OperationalPanel.jsx'
import {
  VariablesBody, BathymetryBody, ObservationsBody, CirculationBody, ToolsBody,
} from '../DataLayersPanel.jsx'
import { useVisualizationState } from '../../state/useVisualizationState.js'
import {
  IconLayers, IconSlice, IconCyclone, IconRamp, IconRuler, IconCollapse,
} from '../icons.jsx'

// The control rail, inside the 3D canvas.
//
// Every interactive control that used to live in the left and right rails is
// behind one of these six icons. The canvas is the primary object, so it gets
// the whole viewport and the controls come to it — rather than the controls
// permanently occupying 560 px of width whether or not anyone is using them.
//
// ONE OPEN PANEL. `railPanel` in the store is the only open-state mechanism in
// the app; clicking the active icon closes it. Collapsed is the load state, so
// the canvas opens full-bleed.
//
// WHEN CLOSED THE PANEL IS UNMOUNTED, not hidden — so nothing but the 44 px
// icon strip sits over the canvas and an orbit drag starts anywhere else. This
// is the same discipline .scene-foot already uses: pointer-events only on the
// things that are actually controls.
//
// NO GLASS. styles.css opens by stating it: "No glass: translucency is overlay
// language, and nothing here floats." These panels are opaque surfaces with the
// same hairline the rails had, because they are the same controls.
//
// THE MAP IS NOT IN HERE. It is a permanent thumbnail in the corner of the view
// instead: it answers "where am I", which is a question you have continuously
// rather than one you go and ask, and drag-select works on it directly.

const GROUPS = [
  {
    id: 'field',
    label: 'Field',
    icon: IconLayers,
    title: 'Variables, bathymetry, observations and circulation',
    sub: 'what is being shown',
    render: ({ dataset }) => (
      <>
        <VariablesBody dataset={dataset} />
        <BathymetryBody />
        <ObservationsBody dataset={dataset} />
        <CirculationBody />
      </>
    ),
  },
  {
    id: 'section',
    label: 'Section',
    icon: IconSlice,
    title: 'Slice the block open, and set the vertical exaggeration',
    bare: true,          // SectionControls brings its own <Panel>
    render: ({ dataset }) => <SectionControls dataset={dataset} compact />,
  },
  {
    id: 'operational',
    label: 'Operational',
    icon: IconCyclone,
    title: 'Derived decision quantities — heat potential, thermocline, drift, isosurface',
    sub: 'derived from the loaded volume',
    render: ({ dataset }) => <OperationalPanel dataset={dataset} compact />,
  },
  {
    id: 'scale',
    label: 'Scale',
    icon: IconRamp,
    title: 'Palette, range and mapping for the colour scale',
    bare: true,          // Colorbar brings its own <Panel>
    render: ({ dataset }) => <Colorbar dataset={dataset} />,
  },
  {
    id: 'tools',
    label: 'Tools',
    icon: IconRuler,
    title: 'Region select, transect and measurement tools',
    sub: 'pointer tools',
    render: () => <ToolsBody />,
  },
]

export default function SceneRail({ dataset, cameraRef }) {
  const open = useVisualizationState((s) => s.railPanel)
  const toggle = useVisualizationState((s) => s.toggleRailPanel)
  const close = useVisualizationState((s) => s.closeRailPanel)
  const group = GROUPS.find((g) => g.id === open)

  return (
    <>
      <div className="scene-rail" role="toolbar" aria-label="Scene controls">
        {GROUPS.map((g) => {
          const Icon = g.icon
          const on = open === g.id
          return (
            <button
              key={g.id}
              type="button"
              className={`rail-btn${on ? ' on' : ''}`}
              aria-pressed={on}
              aria-label={g.label}
              title={`${g.label} — ${g.title}`}
              onClick={() => toggle(g.id)}
            >
              <Icon size={16} />
              <span className="rail-label">{g.label}</span>
            </button>
          )
        })}
      </div>

      {group && (
        <div className="rail-panel">
          {/* ONE close affordance for all six, positioned where a Panel's own
              tools sit. Three of these groups bring their own <Panel> and none
              of them uses `tools`, so this lands in the same place either way
              rather than existing twice in two different forms. */}
          <IconButton label="Close panel" onClick={close}>
            <IconCollapse size={13} />
          </IconButton>
          {group.bare
            ? group.render({ dataset, cameraRef })
            : (
              <Panel title={group.label} sub={group.sub}>
                {group.render({ dataset, cameraRef })}
              </Panel>
            )}
        </div>
      )}
    </>
  )
}
