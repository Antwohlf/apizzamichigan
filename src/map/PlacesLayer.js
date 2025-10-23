import React, { useEffect, useMemo, useRef } from 'react'
import { Marker, Popup, Tooltip, useMap } from 'react-leaflet'
import { getMarkerIcon } from './getMarkerIcon'
import { useMapPopup } from './useMapPopup'
import { PlacePopup } from '../components/map/PlacePopup'

const popupPadding = [64, 120]

function MapClickCloser({ close }) {
  const map = useMap()

  useEffect(() => {
    const handler = event => {
      const target = event?.originalEvent?.target
      if (target && typeof target.closest === 'function') {
        const shell = target.closest('.place-popup-shell')
        if (shell) return
        const marker = target.closest('.leaflet-marker-icon')
        if (marker) return
      }
      close()
    }
    map.on('click', handler)
    return () => map.off('click', handler)
  }, [map, close])

  return null
}

export function PlacesLayer({ site, places }) {
  const map = useMap()
  const markerRefs = useRef(new Map())
  const lastOpenKeyRef = useRef(null)
  const { openEntry, open, close, registerFocusReturn } = useMapPopup()

  useEffect(() => {
    const marker = openEntry?.id ? markerRefs.current.get(`${openEntry.type}:${openEntry.id}`) : null
    if (!marker) return
    const el = marker.getElement?.()
    if (el) {
      el.setAttribute('tabindex', '0')
      registerFocusReturn(el)
    }
  }, [openEntry, registerFocusReturn])

  useEffect(() => {
    const key = openEntry?.id ? `${openEntry.type}:${openEntry.id}` : null
    if (key) {
      lastOpenKeyRef.current = key
      const marker = markerRefs.current.get(key)
      if (marker && typeof marker.openPopup === 'function') {
        marker.openPopup()
      }
    } else if (lastOpenKeyRef.current) {
      const marker = markerRefs.current.get(lastOpenKeyRef.current)
      if (marker && typeof marker.closePopup === 'function') {
        marker.closePopup()
      }
      lastOpenKeyRef.current = null
    }
  }, [openEntry])

  useEffect(() => {
    if (!openEntry?.id || !map) return
    const activePlace = places.find(place => place.id === openEntry.id)
    if (!activePlace) return
    if (typeof activePlace.lat === 'number' && typeof activePlace.lng === 'number') {
      map.panTo([activePlace.lat, activePlace.lng], { animate: true })
    }
  }, [openEntry, places, map])

  const markers = useMemo(
    () =>
      places.map((place, idx) => {
        const markerKey = `${site}:${place.id || idx}`
        const status = place.status || 'visited'
        const isOpen = openEntry.type === site && openEntry.id === place.id

        return (
          <Marker
            key={markerKey}
            position={[place.lat, place.lng]}
            icon={getMarkerIcon(site, status)}
            eventHandlers={{
              click: event => {
                const markerInstance = markerRefs.current.get(markerKey)
                const node = markerInstance?.getElement?.() || event?.target?.getElement?.()
                if (node) {
                  node.focus?.()
                }
                open(site, place.id, node)
              },
              mouseover: () => {
                const markerInstance = markerRefs.current.get(markerKey)
                if (markerInstance && typeof markerInstance.openTooltip === 'function') {
                  markerInstance.openTooltip()
                }
              },
              mouseout: () => {
                const markerInstance = markerRefs.current.get(markerKey)
                if (markerInstance && typeof markerInstance.closeTooltip === 'function') {
                  markerInstance.closeTooltip()
                }
              },
            }}
            ref={instance => {
              if (instance) {
                markerRefs.current.set(markerKey, instance)
                if (place.id) {
                  markerRefs.current.set(`${site}:${place.id}`, instance)
                }
              } else {
                markerRefs.current.delete(markerKey)
                if (place.id) {
                  markerRefs.current.delete(`${site}:${place.id}`)
                }
              }
            }}
          >
            {isOpen ? (
              <Popup
                closeButton={false}
                autoPan={true}
                autoPanPadding={popupPadding}
                className="place-popup-leaflet"
              >
                <PlacePopup place={place} onClose={close} />
              </Popup>
            ) : null}
            <Tooltip direction="top" offset={[0, -24]} opacity={0.9} permanent={false} sticky>
              <div className="place-tooltip">
                <strong>{place.name}</strong>
                <div className="place-tooltip-meta">
                  Rating: {typeof place.rating === 'number' ? `${place.rating.toFixed(1)}/10` : '—'}
                  {place.price ? ` • ${place.price}` : ''}
                  {place.status ? ` • ${place.status}` : ''}
                </div>
                {place.address ? <div className="place-tooltip-address">{place.address}</div> : null}
              </div>
            </Tooltip>
          </Marker>
        )
      }),
    [places, site, open, openEntry, close]
  )

  useEffect(() => {
    if (!openEntry.id) return
    const exists = places.some(place => place.id === openEntry.id)
    if (!exists) {
      close()
    }
  }, [openEntry, places, close])

  return (
    <>
      <MapClickCloser close={close} />
      {markers}
    </>
  )
}
