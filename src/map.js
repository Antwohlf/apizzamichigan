// src/Map.js
import React, { useRef, useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import 'leaflet-rotatedmarker';
import L from 'leaflet';

const pizzaIcon = L.icon({
  iconUrl: process.env.PUBLIC_URL + '/pizza-icon.svg',
  iconSize: [35, 35],
  iconAnchor: [17, 35],
  popupAnchor: [0, -35],
});

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
    const currentCenter = map.getCenter();
    const currentZoom = map.getZoom();

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
      setIsDefaultMichiganView(true);
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

const Map = ({ pizzaPlaces }) => {
  const markerRefs = useRef([]);

  return (
    <MapContainer
      center={[44.3148, -85.6024]} // Centered on Michigan
      zoom={6}
      style={{ height: '600px', width: '100%', position: 'relative' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://carto.com/attributions">CARTO</a>'
        url='https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      />
      {pizzaPlaces.map((place, idx) => {
        if (!markerRefs.current[idx]) {
          markerRefs.current[idx] = React.createRef();
        }

        const eventHandlers = {
          mouseover: () => {
            const marker = markerRefs.current[idx].current;
            if (marker) {
              marker.openPopup();
            }
          },
          mouseout: () => {
            const marker = markerRefs.current[idx].current;
            if (marker) {
              marker.closePopup();
            }
          },
        };

        return (
          <Marker
            key={idx}
            position={[place.lat, place.lng]}
            icon={pizzaIcon}
            eventHandlers={eventHandlers}
            ref={markerRefs.current[idx]}
            rotationAngle={180}
            rotationOrigin="center"
          >
            <Popup>
              <strong>{place.name}</strong>
              <br />
              {place.review}
              <br />
              Rating: {place.rating}/10
            </Popup>
          </Marker>
        );
      })}

      {/* Render ZoomButton directly inside MapContainer */}
      <ZoomButton />
    </MapContainer>
  );
};

export default Map;