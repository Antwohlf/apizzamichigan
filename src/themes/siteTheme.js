// src/themes/siteTheme.js
// Shape definition for site theme objects. Using JSDoc so editors understand the contract.

/**
 * @typedef {Object} SiteTheme
 * @property {string} brandName
 * @property {string[]} titleRotation
 * @property {{
 *   bg: string;
 *   card: string;
 *   text: string;
 *   mutedText: string;
 *   border: string;
 *   accent: string;
 *   accentMuted: string;
 * }} palette
 * @property {{
 *   styleLabel: string;
 *   frozenToggleMap: string;
 *   frozenToggleFrozen: string;
 *   loading: string;
 *   errorPrefix: string;
 * }} copy
 * @property {{
 *   mapMarker: string;
 *   iconSize?: [number, number];
 *   iconAnchor?: [number, number];
 *   popupAnchor?: [number, number];
 * }} icons
 * @property {{
 *   tileUrl?: string;
 *   attribution?: string;
 * }} [map]
 */

export const ThemeKeys = Object.freeze({
  PIZZA: 'pizza',
  TACO: 'taco',
})

export const DEFAULT_THEME_KEY = ThemeKeys.PIZZA
