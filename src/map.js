// src/map.js
import React, { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet-rotatedmarker'

import { PlacesLayer } from './map/PlacesLayer'
import { PopupProvider } from './context/PopupProvider'
import { filterPublicAggregates } from './map/publicScope'
import { consumeMapReturnState } from './map/mapReturnState'
import { MAP_TILE_ATTRIBUTION, MAP_TILE_MAX_ZOOM, MAP_TILE_URL } from './map/tileProvider'

const GLOBAL_VIEW = { center: [20, 0], zoom: 2 }

function ScopeViewController({ showAllMarkets = false, primaryView }) {
  const map = useMap()
  const firstRender = useRef(true)

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    const nextView = showAllMarkets ? GLOBAL_VIEW : primaryView
    map.setView(nextView.center, nextView.zoom, { animate: true, duration: 0.6 })
  }, [map, primaryView, showAllMarkets])

  return null
}

function ViewportReporter({ onViewportChange }) {
  const initialReportRef = useRef(true)
  const map = useMapEvents({
    dragend: () => onViewportChange?.(map.getBounds(), false),
    zoomend: event => {
      if (!initialReportRef.current) onViewportChange?.(map.getBounds(), false)
    },
  })

  useEffect(() => {
    onViewportChange?.(map.getBounds(), true)
    initialReportRef.current = false
  }, [map, onViewportChange])

  return null
}

const Map = ({
  places,
  theme,
  site = 'pizza',
  showClusterCounts = true,
  stateAggregates = [],
  onStateClick,
  flyToLocation,
  forceIndividualMarkers = false,
  resetKey,
  showAllMarkets = false,
  searchFocusKey = '',
  onViewportChange,
}) => {
  const tileUrl = theme?.map?.tileUrl || MAP_TILE_URL
  const attribution = theme?.map?.attribution || MAP_TILE_ATTRIBUTION
  const tileMaxZoom = theme?.map?.maxZoom || MAP_TILE_MAX_ZOOM
  const primaryView = theme?.map?.primaryView || { center: [44.3148, -85.6024], zoom: 6 }
  const returnState = React.useMemo(
    () => consumeMapReturnState(undefined, typeof window === 'undefined' ? null : window.location.pathname),
    []
  )
  const initialView = showAllMarkets
    ? GLOBAL_VIEW
    : returnState
      ? { center: [returnState.center.lat, returnState.center.lng], zoom: returnState.zoom }
      : primaryView
  const primaryStates = theme?.search?.publicStates || theme?.search?.preferredStates || []
  const visibleStateAggregates = filterPublicAggregates(stateAggregates, {
    showAll: showAllMarkets,
    primaryStates,
  })

  return (
    <MapContainer
      center={initialView.center}
      zoom={initialView.zoom}
      style={{ height: '100%', width: '100%', position: 'relative' }}
    >
      <TileLayer attribution={attribution} maxZoom={tileMaxZoom} url={tileUrl} />
      <ViewportReporter onViewportChange={onViewportChange} />
      <PopupProviderBridge>
        <PlacesLayer
          site={site}
          places={places}
          showClusterCounts={showClusterCounts}
          stateAggregates={visibleStateAggregates}
          onStateClick={onStateClick}
          flyToLocation={flyToLocation}
          resetKey={resetKey}
          forceIndividualMarkers={forceIndividualMarkers}
          searchFocusKey={searchFocusKey}
        />
        <ScopeViewController showAllMarkets={showAllMarkets} primaryView={primaryView} />
      </PopupProviderBridge>
    </MapContainer>
  )
}

export default Map

function PopupProviderBridge({ children }) {
  const map = useMap()
  return <PopupProvider map={map}>{children}</PopupProvider>
}
