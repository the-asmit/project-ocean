import { useEffect, useState } from 'react'

// Destinations where a particular instrument actually operated, served by the
// backend so the coordinates and the date live in ONE place — the same list
// the server would use to explain why a layer is empty here.
//
// Fetched once per session: the list is static configuration, not tile data.
let cache = null

export function usePresets() {
  const [presets, setPresets] = useState(cache ?? [])
  useEffect(() => {
    if (cache) return undefined
    let dead = false
    fetch('/api/regions')
      .then((r) => r.json())
      .then((d) => {
        cache = d.presets ?? []
        if (!dead) setPresets(cache)
      })
      .catch(() => {})
    return () => { dead = true }
  }, [])
  return presets
}
