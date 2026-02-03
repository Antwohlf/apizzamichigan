import React from 'react'
import L from 'leaflet'
import { Marker, useMap } from 'react-leaflet'
import pizzaIconGrey from '../icons/pizza/marker-pizza-grey.svg'
import tacoIconGrey from '../icons/taco/marker-taco-grey.svg'

const STATE_ZOOM = 7

const ICONS = {
  pizza: pizzaIconGrey,
  taco: tacoIconGrey,
}

const BADGE_COLORS = {
  pizza: '#d9382b',
  taco: '#e67e22',
}

/**
 * Creates a state aggregate marker icon with optional count badge
 * Supports loading spinner and dimmed states
 */
function createStateIcon(site, count, showCounts = true, isLoading = false, isDimmed = false) {
  const icon = ICONS[site] || ICONS.pizza
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
      <div style="position: relative; width: 44px; height: 44px; cursor: pointer;">
        <img src="${icon}" style="width: 44px; height: 44px; opacity: ${opacity};" />
        ${badgeHtml}
        ${spinnerHtml}
      </div>
    `,
    className: `${site}-state-marker`,
    iconSize: L.point(44, 44),
    iconAnchor: L.point(22, 44),
  })
}

/**
 * State aggregate marker - shows a single marker for an entire state
 * Clicking it loads that state's individual places
 * Supports loading and dimmed visual states
 */
export function StateMarker({ aggregate, site, onStateClick, showCounts = true }) {
  const { stateCode, count, lat, lng, isLoading = false, isDimmed = false } = aggregate
  const map = useMap()

  const handleClick = () => {
    // Don't trigger click if already loading
    if (isLoading) return

    // Fly to the state with animation
    if (map) {
      map.flyTo([lat, lng], STATE_ZOOM, {
        duration: 0.8,
        easeLinearity: 0.25,
      })
    }
    // Load the state's places
    if (onStateClick) {
      onStateClick(stateCode)
    }
  }

  return (
    <Marker
      position={[lat, lng]}
      icon={createStateIcon(site, count, showCounts, isLoading, isDimmed)}
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
    <>
      {aggregates.map(aggregate => (
        <StateMarker
          key={aggregate.id}
          aggregate={aggregate}
          site={site}
          onStateClick={onStateClick}
          showCounts={showCounts}
        />
      ))}
    </>
  )
}
