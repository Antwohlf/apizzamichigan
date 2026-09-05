// src/themes/tacoTheme.js
import { ThemeKeys } from './siteTheme'
import { US_STATE_CODES } from '../data/usStateCodes'
import { MAP_TILE_ATTRIBUTION, MAP_TILE_MAX_ZOOM, MAP_TILE_URL } from '../map/tileProvider'

/** @type {import('./siteTheme').SiteTheme} */
export const tacoTheme = {
  brandName: 'Taco Bout Michigan',
  // Keep the Mexican flag movement, with a warm sand middle stop that remains
  // readable against the light interface.
  titleRotation: ['#b92d27', '#8c6848', '#176a45'],
  palette: {
    bg: '#f3e8d7',
    card: '#fbf6ed',
    text: '#2a241b',
    mutedText: '#70604e',
    border: '#d5c2a7',
    accent: '#c96f2d',
    accentMuted: '#a56f2b',
  },
  copy: {
    styleLabel: 'Taco Type',
    frozenToggleMap: 'Taco Map',
    frozenToggleFrozen: 'Recipes',
    loading: 'Loading taco map…',
    errorPrefix: 'Oops',
  },
  icons: {
    mapMarker: '/assets/icons/taco-marker.svg',
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -24],
  },
  map: {
    tileUrl: MAP_TILE_URL,
    attribution: MAP_TILE_ATTRIBUTION,
    maxZoom: MAP_TILE_MAX_ZOOM,
    primaryView: {
      center: [44.3148, -85.6024],
      zoom: 6,
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

export const themeKey = ThemeKeys.TACO
