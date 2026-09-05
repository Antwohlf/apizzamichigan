// src/themes/pizzaTheme.js
import { ThemeKeys } from './siteTheme'
import { US_STATE_CODES } from '../data/usStateCodes'
import { MAP_TILE_ATTRIBUTION, MAP_TILE_MAX_ZOOM, MAP_TILE_URL } from '../map/tileProvider'

/** @type {import('./siteTheme').SiteTheme} */
export const pizzaTheme = {
  brandName: 'A Pizza Michigan',
  titleRotation: ['#f97316', '#dc2626', '#f59e0b'],
  palette: {
    bg: '#0b0c0e',
    card: '#141619',
    text: '#f4f4f2',
    mutedText: '#aeb2b7',
    border: '#30353b',
    accent: '#f97316',
    accentMuted: '#b45309',
  },
  copy: {
    styleLabel: 'Pizza Style',
    frozenToggleMap: 'Pizza Map',
    frozenToggleFrozen: 'Frozen Pizzas',
    loading: 'Loading pizza map…',
    errorPrefix: 'Error',
  },
  icons: {
    mapMarker: '/assets/icons/pizza-marker.svg',
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    popupAnchor: [0, -32],
  },
  map: {
    tileUrl: MAP_TILE_URL,
    attribution: MAP_TILE_ATTRIBUTION,
    maxZoom: MAP_TILE_MAX_ZOOM,
    primaryView: {
      center: [42.7, -79.8],
      zoom: 5,
    },
  },
  search: {
    preferredStates: ['MI', 'NY'],
    // Keep the home markets prominent in ranking, but show every market on
    // the public map and in the global statistics.
    initialStates: US_STATE_CODES,
    publicStates: [],
  },
}

export const themeKey = ThemeKeys.PIZZA
