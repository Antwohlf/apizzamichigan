// src/map.js
import React, { createRef, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet'
import 'leaflet-rotatedmarker'
import L from 'leaflet'

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

const Map = ({ places, theme }) => {
  const markerRefs = useRef([])

  const mapMarkerIcon = useMemo(() => {
    const baseUrl = process.env.PUBLIC_URL || ''
    const iconUrl = theme?.icons?.mapMarker ? `${baseUrl}${theme.icons.mapMarker}` : `${baseUrl}/assets/icons/pizza-marker.svg`
    const iconSize = theme?.icons?.iconSize || [35, 35]
    const iconAnchor = theme?.icons?.iconAnchor || [iconSize[0] / 2, iconSize[1]]
    const popupAnchor = theme?.icons?.popupAnchor || [0, -Math.max(iconSize[1] - 4, 24)]

    return L.icon({
      iconUrl,
      iconSize,
      iconAnchor,
      popupAnchor,
    })
  }, [theme])

  const tileUrl = theme?.map?.tileUrl || 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
  const attribution = theme?.map?.attribution || '&copy; <a href="https://carto.com/attributions">CARTO</a>'

  return (
    <MapContainer
      center={[44.3148, -85.6024]} // Centered on Michigan
      zoom={6}
      style={{ height: '100%', width: '100%', position: 'relative' }}
    >
      <TileLayer attribution={attribution} url={tileUrl} />
      {places.map((place, idx) => {
        if (!markerRefs.current[idx]) {
          markerRefs.current[idx] = createRef()
        }

        const eventHandlers = {
          mouseover: () => {
            const marker = markerRefs.current[idx].current
            if (marker) {
              marker.openPopup()
            }
          },
          mouseout: () => {
            const marker = markerRefs.current[idx].current
            if (marker) {
              marker.closePopup()
            }
          },
        }

        return (
          <Marker
            key={idx}
            position={[place.lat, place.lng]}
            icon={mapMarkerIcon}
            eventHandlers={eventHandlers}
            ref={markerRefs.current[idx]}
          >
            <Popup>
              <strong>{place.name}</strong>
              <br />
              {place.review}
              <br />
              Rating: {place.rating}/10
              <br />
              Notes: {place.notes}
            </Popup>
          </Marker>
        )
      })}

      {/* Render ZoomButton directly inside MapContainer */}
      <ZoomButton />
    </MapContainer>
  )
}

export default Map
