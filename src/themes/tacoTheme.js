// src/themes/tacoTheme.js
import { ThemeKeys } from './siteTheme'

/** @type {import('./siteTheme').SiteTheme} */
export const tacoTheme = {
  brandName: 'Taco Bout Michigan',
  titleRotation: ['#E52420', '#FFFFFF', '#007A33'],
  palette: {
    bg: '#f7f2e7',
    card: '#efe5d6',
    text: '#2a241b',
    mutedText: '#6b5e4b',
    border: '#dacbb4',
    accent: '#b57c3b',
    accentMuted: '#8f642f',
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
    tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
}

export const themeKey = ThemeKeys.TACO
