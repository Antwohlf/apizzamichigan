import React, { createRef } from 'react'
import { Marker, Popup } from 'react-leaflet'
import { getMarkerIcon } from './getMarkerIcon'

export function PlacesLayer({ site, places }) {
  return (
    <>
      {places.map((place, idx) => {
        const markerRef = createRef()
        const status = place.status || 'visited'

        const eventHandlers = {
          mouseover: () => {
            const marker = markerRef.current
            if (marker) marker.openPopup()
          },
          mouseout: () => {
            const marker = markerRef.current
            if (marker) marker.closePopup()
          },
        }

        return (
          <Marker
            key={place.id || `${site}-${idx}`}
            position={[place.lat, place.lng]}
            icon={getMarkerIcon(site, status)}
            ref={markerRef}
            eventHandlers={eventHandlers}
          >
            <Popup>
              <strong>{place.name}</strong>
              <br />
              {place.review}
              <br />
              Rating: {place.rating ?? '—'}/10
              <br />
              {place.notes ? `Notes: ${place.notes}` : null}
            </Popup>
          </Marker>
        )
      })}
    </>
  )
}
