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
 */
function createStateIcon(site, count, showCounts = true) {
  const icon = ICONS[site] || ICONS.pizza
  const badgeColor = BADGE_COLORS[site] || BADGE_COLORS.pizza

  // Format count for display
  const displayCount = count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count

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
        ">${displayCount}</span>
  ` : ''

  return L.divIcon({
    html: `
      <div style="position: relative; width: 44px; height: 44px; cursor: pointer;">
        <img src="${icon}" style="width: 44px; height: 44px; opacity: 0.9;" />
        ${badgeHtml}
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
 */
export function StateMarker({ aggregate, site, onStateClick, showCounts = true }) {
  const { stateCode, count, lat, lng } = aggregate
  const map = useMap()

  const handleClick = () => {
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
      icon={createStateIcon(site, count, showCounts)}
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
