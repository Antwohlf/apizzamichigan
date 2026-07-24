// src/map.js
import React from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import 'leaflet-rotatedmarker'

import { PlacesLayer } from './map/PlacesLayer'
import { PopupProvider } from './context/PopupProvider'
import { filterPublicAggregates } from './map/publicScope'
import { consumeMapReturnState } from './map/mapReturnState'

const ZoomButton = ({ showAllMarkets = false, onScopeChange, primaryView }) => {
  const map = useMap()
  const fallbackPrimaryView = { center: [44.3148, -85.6024], zoom: 6 }
  const activePrimaryView = primaryView || fallbackPrimaryView

  const handleToggleView = () => {
    const nextShowAllMarkets = !showAllMarkets
    onScopeChange?.(nextShowAllMarkets)
    if (nextShowAllMarkets) {
      map.setView([20, 0], 2)
    } else {
      map.setView(activePrimaryView.center, activePrimaryView.zoom)
    }
  };

  return (
    <div className="zoom-button">
      <button
        onClick={handleToggleView}
        aria-label={showAllMarkets ? 'Return to Michigan and New York' : 'Explore all markets'}
      >
        {showAllMarkets ? 'Back to primary markets' : 'And Beyond'}
      </button>
    </div>
  );
};

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
  onScopeChange,
  searchFocusKey = '',
}) => {
  const tileUrl = theme?.map?.tileUrl || 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
  const attribution = theme?.map?.attribution || '&copy; <a href="https://carto.com/attributions">CARTO</a>'
  const primaryView = theme?.map?.primaryView || { center: [44.3148, -85.6024], zoom: 6 }
  const returnState = React.useMemo(
    () => consumeMapReturnState(undefined, typeof window === 'undefined' ? null : window.location.pathname),
    []
  )
  const initialView = returnState
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
      <TileLayer attribution={attribution} url={tileUrl} />
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
        {/* Render ZoomButton directly inside MapContainer */}
        <ZoomButton showAllMarkets={showAllMarkets} onScopeChange={onScopeChange} primaryView={primaryView} />
      </PopupProviderBridge>
    </MapContainer>
  )
}

export default Map

function PopupProviderBridge({ children }) {
  const map = useMap()
  return <PopupProvider map={map}>{children}</PopupProvider>
}
