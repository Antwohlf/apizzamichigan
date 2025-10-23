import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { Marker, useMap } from 'react-leaflet'
import { getMarkerIcon } from './getMarkerIcon'
import { useMapPopup } from './useMapPopup'
import { usePopup } from '../context/PopupProvider'
import { renderExpanded, renderPreview } from '../components/map/renderPopup'
import '../styles/marker-popup.css'

function MapClickCloser({ close }) {
  const map = useMap()
  const popup = usePopup()

  useEffect(() => {
    const handler = event => {
      const target = event?.originalEvent?.target
      if (target && typeof target.closest === 'function') {
        const shell = target.closest('.marker-popup')
        if (shell) return
        const marker = target.closest('.leaflet-marker-icon')
        if (marker) return
      }
      popup.hide()
      close()
    }
    map.on('click', handler)
    return () => {
      map.off('click', handler)
    }
  }, [map, close, popup])

  return null
}

export function PlacesLayer({ site, places }) {
  const markerRefs = useRef(new Map())
  const lastOpenKeyRef = useRef(null)
  const popup = usePopup()
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
    } else if (lastOpenKeyRef.current) {
      lastOpenKeyRef.current = null
    }
  }, [openEntry])

  useEffect(() => {
    if (!popup) return
    if (!openEntry?.id || openEntry.type !== site) {
      popup.hide()
      return
    }
    const activePlace = places.find(place => String(place.id) === String(openEntry.id))
    if (!activePlace || typeof activePlace.lat !== 'number' || typeof activePlace.lng !== 'number') {
      popup.hide()
      return
    }
    const placeId = String(activePlace.id)
    const target = { id: placeId, lat: activePlace.lat, lng: activePlace.lng, type: site }
    const hrefParam = `${site}:${placeId}`
    const href = site === 'taco' ? `/tacos?poi=${hrefParam}` : `/?poi=${hrefParam}`
    popup.expand(target, node =>
      renderExpanded(node, { ...activePlace, id: placeId, type: site, href }, () => {
        popup.hide()
        close()
      })
    )
  }, [close, openEntry, places, popup, site])

  useEffect(() => () => popup.hide(), [popup])

  const getMarkerKey = useCallback(
    (place, idx) => `${site}:${place.id ? place.id : idx}`,
    [site]
  )

  const buildHref = useCallback(
    placeId => {
      const hrefParam = `${site}:${placeId}`
      return site === 'taco' ? `/tacos?poi=${hrefParam}` : `/?poi=${hrefParam}`
    },
    [site]
  )

  const markers = useMemo(
    () =>
      places.map((place, idx) => {
        const placeId = place.id ? String(place.id) : null
        const lat = typeof place.lat === 'number' ? place.lat : null
        const lng = typeof place.lng === 'number' ? place.lng : null
        if (lat === null || lng === null) return null
        const markerKey = getMarkerKey(place, idx)
        const status = place.status || 'visited'

        return (
          <Marker
            key={markerKey}
            position={[lat, lng]}
            icon={getMarkerIcon(site, status)}
            eventHandlers={{
              click: event => {
                if (!placeId) return
                const markerInstance = markerRefs.current.get(markerKey)
                const node = markerInstance?.getElement?.() || event?.target?.getElement?.()
                if (node) {
                  node.focus?.()
                }
                open(site, placeId, node)
              },
              mouseover: event => {
                if (!placeId || lat === null || lng === null) return
                const target = { id: placeId, lat, lng, type: site }
                const href = buildHref(placeId)
                popup.openPreview(target, node =>
                  renderPreview(node, { ...place, id: placeId, type: site, href })
                )
              },
              mouseout: event => {
                if (!placeId) return
                const markerInstance = markerRefs.current.get(markerKey)
                const markerNode = markerInstance?.getElement?.()
                if (markerNode && markerNode.matches(':hover')) {
                  return
                }
                const related = event?.originalEvent?.relatedTarget
                if (related && typeof related.closest === 'function') {
                  const stillOnMarker = related.closest('.leaflet-marker-icon')
                  const overPopup = related.closest('.marker-popup')
                  if (stillOnMarker || overPopup) {
                    return
                  }
                }
                if (popup.isExpanded(placeId)) return
                popup.hide(200)
              },
              focus: () => {
                if (!placeId || lat === null || lng === null) return
                const target = { id: placeId, lat, lng, type: site }
                const href = buildHref(placeId)
                popup.openPreview(target, node =>
                  renderPreview(node, { ...place, id: placeId, type: site, href })
                )
              },
              blur: () => {
                if (!placeId) return
                if (popup.isExpanded(placeId)) return
                popup.hide(120)
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
          />
        )
      }),
    [places, site, popup, open, buildHref, getMarkerKey]
  )

  useEffect(() => {
    if (!openEntry.id) return
    const exists = places.some(place => String(place.id) === String(openEntry.id))
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
