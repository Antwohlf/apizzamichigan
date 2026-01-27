// src/map.js
import React, { useEffect, useState } from 'react'
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet-rotatedmarker'

import { PlacesLayer } from './map/PlacesLayer'
import { PopupProvider } from './context/PopupProvider'

const ZoomButton = () => {
  const map = useMapEvents({
    moveend: () => {
      checkView();
    },
  });

  const [isDefaultMichiganView, setIsDefaultMichiganView] = useState(true);

  const michiganCenter = [44.3148, -85.6024];
  const michiganZoom = 6;

  const handleToggleView = () => {
    if (!isDefaultMichiganView) {
      map.setView(michiganCenter, michiganZoom); // Zoom back to default Michigan view
    } else {
      map.setView([20, 0], 2); // Zoom out to show the world
    }
  };

  const checkView = () => {
    if (!map || typeof map.getCenter !== 'function' || typeof map.getZoom !== 'function') {
      return
    }

    const currentCenter = map.getCenter()
    const currentZoom = map.getZoom()

    // Check if the map is within Michigan boundaries
    const isInMichigan =
      currentCenter.lat > 41 && currentCenter.lat < 49 &&
      currentCenter.lng > -90 && currentCenter.lng < -82;

    // Check if at default Michigan view
    const isAtDefaultMichiganView =
      Math.abs(currentCenter.lat - michiganCenter[0]) < 0.1 &&
      Math.abs(currentCenter.lng - michiganCenter[1]) < 0.1 &&
      currentZoom === michiganZoom;

    // Update state based on current view
    if (isAtDefaultMichiganView) {
      setIsDefaultMichiganView(true)
    } else if (isInMichigan) {
      setIsDefaultMichiganView(false);
    } else {
      setIsDefaultMichiganView(false);
    }
  };

  // Initialize the state when the component mounts
  useEffect(() => {
    checkView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="zoom-button">
      <button onClick={handleToggleView}>
        {!isDefaultMichiganView ? 'Back to Michigan' : 'And Beyond'}
      </button>
    </div>
  );
};

const Map = ({ places, theme, site = 'pizza', showClusterCounts = true }) => {
  const tileUrl = theme?.map?.tileUrl || 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
  const attribution = theme?.map?.attribution || '&copy; <a href="https://carto.com/attributions">CARTO</a>'

  return (
    <MapContainer
      center={[44.3148, -85.6024]} // Centered on Michigan
      zoom={6}
      style={{ height: '100%', width: '100%', position: 'relative' }}
    >
      <TileLayer attribution={attribution} url={tileUrl} />
      <PopupProviderBridge>
        <PlacesLayer site={site} places={places} showClusterCounts={showClusterCounts} />
        {/* Render ZoomButton directly inside MapContainer */}
        <ZoomButton />
      </PopupProviderBridge>
    </MapContainer>
  )
}

export default Map

function PopupProviderBridge({ children }) {
  const map = useMap()
  return <PopupProvider map={map}>{children}</PopupProvider>
}
