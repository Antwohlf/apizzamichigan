const OPENSTREETMAP_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const OPENSTREETMAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
const OPENSTREETMAP_MAX_ZOOM = 19

const configuredMaxZoom = Number.parseInt(process.env.REACT_APP_MAP_TILE_MAX_ZOOM || '', 10)

// Keep the provider build-configurable so an outage or terms change does not
// require touching every product theme again.
export const MAP_TILE_URL = process.env.REACT_APP_MAP_TILE_URL || OPENSTREETMAP_TILE_URL
export const MAP_TILE_ATTRIBUTION =
  process.env.REACT_APP_MAP_TILE_ATTRIBUTION || OPENSTREETMAP_ATTRIBUTION
export const MAP_TILE_MAX_ZOOM = Number.isFinite(configuredMaxZoom)
  ? configuredMaxZoom
  : OPENSTREETMAP_MAX_ZOOM
