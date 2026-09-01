// Real Argo floats, through the ObservationSource interface the mock defined.
//
// Same listFloats() / getProfile(id) contract, so the scene markers, the picking
// and the comparison chart are unchanged — that was the point of the seam.
//
// What is different from the mock, and why the UI has to care:
//
//   * A float may not exist. The mock always produced six; a real tile may hold
//     none, and "none" is an answer to render, not an empty array to ignore.
//   * A float's profile is NOT on the model's date. Argo cycles roughly every
//     10 days, so the demo tile has five floats within +/-10 days of its date
//     and zero on the date itself. Every float carries its real profile date and
//     the comparison discloses it against the model date.
//   * Pressure is reported in decibars and compared against the model's depth in
//     metres. Over 0-2000 m the two differ by under 1%, and saying so is better
//     than a false precision conversion that needs latitude and density.
//   * `synthetic` is false. Nothing here is fabricated.

const API = '/api'

async function json(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} -> ${r.status} ${(await r.text()).slice(0, 160)}`)
  return r.json()
}

export function argoSource(dataset) {
  const { region, date } = dataset.meta
  const variable = dataset.meta.volume.variable
  const units = dataset.meta.volume.units
  const q = `region=${encodeURIComponent(region)}&date=${date}`

  let listed = null

  return {
    name: 'Argo GDAC',
    synthetic: false,

    async listFloats() {
      listed ||= await json(`${API}/argo/floats?${q}`)
      return listed.floats.map((f) => ({
        id: f.id,
        label: `WMO ${f.wmo}`,
        lat: f.lat,
        lon: f.lon,
        date: f.date,
        platform: 'argo',
        synthetic: false,
        // provenance, surfaced by the comparison panel
        wmo: f.wmo,
        cycle: f.cycle,
        dac: f.dac,
        dacLabel: f.dacLabel,
        dataMode: f.dataMode,          // R = real-time, D = delayed-mode (adjusted)
        profileCount: f.profileCount,
        dates: f.dates,
      }))
    },

    // The window and source, for the layer's own disclosure line.
    async meta() {
      listed ||= await json(`${API}/argo/floats?${q}`)
      return {
        count: listed.count,
        windowFrom: listed.windowFrom,
        windowTo: listed.windowTo,
        windowDays: listed.windowDays,
        source: listed.source,
        sourceUrl: listed.sourceUrl,
        modelDate: date,
      }
    },

    async getProfile(floatId) {
      const [wmo, cycle] = String(floatId).split('-')
      const p = await json(`${API}/argo/profile?wmo=${encodeURIComponent(wmo)}&cycle=${cycle}`)
      // The profile carries both thetao and psal; take whichever variable the
      // block is currently showing, and drop levels where that one is missing
      // rather than interpolating across a gap the instrument did not measure.
      const levels = p.levels
        .filter((l) => l[variable] != null)
        .map((l) => ({ depthM: l.depthM, value: l[variable] }))
      return {
        id: floatId,
        levels,
        units,
        synthetic: false,
        wmo: p.wmo,
        cycle: p.cycle,
        date: p.date,
        dataMode: p.dataMode,
        levelsDropped: p.levelsDropped,
        source: p.source,
        sourceUrl: p.sourceUrl,
        variable,
      }
    },
  }
}
