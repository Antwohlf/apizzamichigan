// src/themes/pizzaTheme.js
import { ThemeKeys } from './siteTheme'

/** @type {import('./siteTheme').SiteTheme} */
export const pizzaTheme = {
  brandName: 'A Pizza Michigan',
  titleRotation: ['#f97316', '#dc2626', '#f59e0b'],
  palette: {
    bg: '#181a1b',
    card: '#202224',
    text: '#ffffff',
    mutedText: '#c9c9c9',
    border: '#2b2f31',
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
    tileUrl: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>',
    primaryView: {
      center: [42.7, -79.8],
      zoom: 5,
    },
  },
  search: {
    preferredStates: ['MI', 'NY'],
    initialStates: ['MI', 'NY'],
    publicStates: ['MI', 'NY'],
  },
}

export const themeKey = ThemeKeys.PIZZA
