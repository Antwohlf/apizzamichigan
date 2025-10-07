import React, { createRef } from 'react'
import { Marker, Popup } from 'react-leaflet'
import { getMarkerIcon } from './getMarkerIcon'
import ReviewGallery from '../components/ReviewGallery'

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
              <div style={{ maxWidth: 240 }}>
                <strong>{place.name}</strong>
                {place.review ? (
                  <p style={{ margin: '0.35rem 0' }}>{place.review}</p>
                ) : null}
                <p style={{ margin: '0.35rem 0' }}>Rating: {place.rating ?? '—'}/10</p>
                {place.notes ? (
                  <p style={{ margin: '0.35rem 0' }}>Notes: {place.notes}</p>
                ) : null}
                <ReviewGallery photos={Array.isArray(place.photos) ? place.photos : []} />
              </div>
            </Popup>
          </Marker>
        )
      })}
    </>
  )
}
