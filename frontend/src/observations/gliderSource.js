// Real glider tracks, through a parallel of the ObservationSource interface.
//
// A glider is not a station and deliberately does NOT go through listFloats():
// it flies a sawtooth, diving and climbing while it drifts, so its data is a
// PATH through the volume rather than a column at a point. Folding it into the
// float list would force it into a marker-and-profile shape that throws away
// the only thing that makes it a glider.
//
//   listTracks()      -> [{ id, deployment, dateFrom, dateTo, start/end pos }]
//   getTrack(id)      -> { points: [{lat, lon, pres, thetao, so, time}], meta }
//
// The points arrive already decimated server-side, with every dive apex kept
// exactly as measured — a plain stride would clip the turning points and
// flatten the sawtooth into a smear.

const API = '/api'

async function json(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} -> ${r.status} ${(await r.text()).slice(0, 160)}`)
  return r.json()
}

export function gliderSource(dataset) {
  const { region, date } = dataset.meta
  const q = `region=${encodeURIComponent(region)}&date=${date}`
  let listed = null

  return {
    name: 'OceanGliders GDAC',
    synthetic: false,

    async listTracks() {
      listed ||= await json(`${API}/gliders/tracks?${q}`)
      return listed
    },

    async getTrack(deployment) {
      return json(`${API}/gliders/track?deployment=${encodeURIComponent(deployment)}&${q}`)
    },
  }
}
