import L from 'leaflet'

import { isHistoricalLifecycle } from '../lib/lifecycle'
import { markerAssetFor, markerAssetsFor } from './markerAssets'

export function getMarkerIcon(site, status = 'unvisited', lifecycleStatus = null) {
  const safeStatus = status && markerAssetsFor(site)[status] ? status : 'unvisited'
  const iconUrl = markerAssetFor(site, safeStatus)
  const historical = isHistoricalLifecycle(lifecycleStatus)

  const options = {
    iconUrl,
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -28],
    className: `leaflet-marker-icon ${site}-marker${historical ? ' place-marker--historical' : ''}`,
  }

  if (site === 'taco') {
    options.className = `leaflet-marker-icon taco-marker${safeStatus === 'golden' ? ' taco-marker--golden' : ''}${historical ? ' place-marker--historical' : ''}`
  }

  return L.icon(options)
}
