import React from 'react'
import L from 'leaflet'
import { Marker, useMap } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import { markerAssetFor } from './markerAssets'

const STATE_ZOOM = 7
const STATE_FIT_MAX_ZOOM = 10

const markerSetFor = site => ({
  base: markerAssetFor(site, 'unvisited'),
  highlight: markerAssetFor(site, 'visited'),
})

export const statePlaceCoordinates = places => (Array.isArray(places) ? places : [])
  .filter(place => Number.isFinite(place?.lat) && Number.isFinite(place?.lng))
  .map(place => [place.lat, place.lng])

const BADGE_COLORS = {
  pizza: '#d9382b',
  taco: '#e67e22',
}

/**
 * Creates a state aggregate marker icon with optional count badge
 * Supports loading spinner and dimmed states
 */
function createStateIcon(site, count, showCounts = true, isLoading = false, isDimmed = false, isHighlighted = false) {
  const iconSet = markerSetFor(site)
  const icon = isHighlighted ? iconSet.highlight : iconSet.base
  const badgeColor = BADGE_COLORS[site] || BADGE_COLORS.pizza
  const opacity = isDimmed ? 0.5 : 0.9
  const badgeOpacity = isDimmed ? 0.6 : 1

  // Format count for display
  const displayCount = count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count

  // Loading spinner overlay
  const spinnerHtml = isLoading ? `
        <div style="
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 18px;
          height: 18px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        "></div>
  ` : ''

  const badgeHtml = showCounts ? `
        <span style="
          position: absolute;
          bottom: -6px;
          right: -6px;
          background: ${badgeColor};
          color: white;
          border-radius: 10px;
          min-width: 28px;
          height: 20px;
          padding: 0 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: bold;
          border: 2px solid white;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          opacity: ${badgeOpacity};
        ">${displayCount}</span>
  ` : ''

  return L.divIcon({
    html: `
      <div role="img" aria-label="${displayCount} ${site} places in ${site === 'taco' ? 'this area' : 'this state'}" title="${displayCount} ${site} places" style="position: relative; width: 44px; height: 44px; cursor: pointer;">
        <img src="${icon}" alt="" aria-hidden="true" style="width: 44px; height: 44px; opacity: ${opacity};" />
        ${badgeHtml}
        ${spinnerHtml}
      </div>
    `,
    className: `${site}-state-marker`,
    iconSize: L.point(44, 44),
    iconAnchor: L.point(22, 44),
  })
}

function createAggregateClusterIcon(site, showCounts) {
  return cluster => {
    const total = cluster.getAllChildMarkers().reduce(
      (sum, marker) => sum + (Number(marker.options?.aggregateCount) || 0),
      0,
    )
    return createStateIcon(site, total, showCounts, false, false, true)
  }
}

/**
 * State aggregate marker - shows a single marker for an entire state
 * Clicking it loads that state's individual places
 * Supports loading and dimmed visual states
 */
export function StateMarker({ aggregate, site, onStateClick, showCounts = true }) {
  const { stateCode, count, lat, lng, isLoading = false, isDimmed = false, isHighlighted = false } = aggregate
  const map = useMap()

  const handleClick = () => {
    // Don't trigger click if already loading
    if (isLoading) return

    // Fly to the state while its places load. The resolved place set then
    // refits the map to the actual distribution instead of leaving the user
    // at a state centroid that may be far from the places they want to see.
    if (map) {
      map.flyTo([lat, lng], STATE_ZOOM, {
        duration: 0.8,
        easeLinearity: 0.25,
      })
    }
    // Load the state's places
    if (onStateClick) {
      Promise.resolve().then(() => onStateClick(stateCode)).then(places => {
        if (!map || !Array.isArray(places) || !places.length || typeof map.fitBounds !== 'function') return
        const coordinates = statePlaceCoordinates(places)
        if (!coordinates.length) return
        const bounds = L.latLngBounds(coordinates)
        if (!bounds.isValid()) return
        map.fitBounds(bounds, {
          padding: [48, 48],
          maxZoom: STATE_FIT_MAX_ZOOM,
          animate: true,
          duration: 0.7,
        })
      }).catch(() => {})
    }
  }

  return (
    <Marker
      position={[lat, lng]}
      title={`${stateCode}: ${count} ${site} places`}
      aggregateCount={count}
      icon={createStateIcon(site, count, showCounts, isLoading, isDimmed, isHighlighted)}
      eventHandlers={{
        click: handleClick,
      }}
    />
  )
}

/**
 * Renders all state aggregate markers
 */
export function StateAggregateLayer({ aggregates, site, onStateClick, showCounts = true }) {
  if (!aggregates || aggregates.length === 0) {
    return null
  }

  return (
      <MarkerClusterGroup
        maxClusterRadius={40}
        animate={false}
        disableClusteringAtZoom={5}
      spiderfyOnMaxZoom={false}
      showCoverageOnHover={false}
      iconCreateFunction={createAggregateClusterIcon(site, showCounts)}
    >
      {aggregates.map(aggregate => (
        <StateMarker
          key={aggregate.id}
          aggregate={aggregate}
          site={site}
          onStateClick={onStateClick}
          showCounts={showCounts}
        />
      ))}
    </MarkerClusterGroup>
  )
}
