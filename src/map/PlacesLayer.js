import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { Marker, useMap } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import { getMarkerIcon } from './getMarkerIcon'
import { useMapPopup } from './useMapPopup'
import { usePopup } from '../context/PopupProvider'
import { renderExpanded, renderPreview } from '../components/map/renderPopup'
import '../styles/marker-popup.css'
import { useSelectedPlace } from '../store/selectedPlace'
import { StateAggregateLayer } from './StateMarker'
import pizzaIconColored from '../icons/pizza/marker-pizza-colored.svg'
import pizzaIconGrey from '../icons/pizza/marker-pizza-grey.svg'
import pizzaIconGold from '../icons/pizza/marker-pizza-gold.svg'
import tacoIconColored from '../icons/taco/marker-taco-colored.svg'
import tacoIconGrey from '../icons/taco/marker-taco-grey.svg'
import tacoIconGold from '../icons/taco/marker-taco-gold.svg'

const CLUSTER_ICONS = {
  pizza: { visited: pizzaIconColored, unvisited: pizzaIconGrey, golden: pizzaIconGold },
  taco: { visited: tacoIconColored, unvisited: tacoIconGrey, golden: tacoIconGold },
}

const DEFAULT_CENTER = [44.3148, -85.6024]
const DEFAULT_ZOOM = 6
const MIN_MARKERS_ZOOM = 7 // Only show individual markers at this zoom or higher (changed from 6 to avoid boundary condition)

const createClusterIcon = (site, showCounts) => (cluster) => {
  const count = cluster.getChildCount()
  const childMarkers = cluster.getAllChildMarkers()

  // Check if all markers have the same status
  const statuses = childMarkers.map(m => m.options?.status || 'visited')
  const uniqueStatuses = [...new Set(statuses)]
  const clusterStatus = uniqueStatuses.length === 1 ? uniqueStatuses[0] : 'visited'

  const icons = CLUSTER_ICONS[site] || CLUSTER_ICONS.pizza
  const icon = icons[clusterStatus] || icons.visited
  // Always use primary color for badge (red for pizza, orange for taco)
  const badgeColor = site === 'taco' ? '#e67e22' : '#d9382b'

  const badgeHtml = showCounts ? `
        <span style="
          position: absolute;
          bottom: -4px;
          right: -4px;
          background: ${badgeColor};
          color: white;
          border-radius: 50%;
          min-width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: bold;
          border: 2px solid white;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        ">${count}</span>
  ` : ''

  return L.divIcon({
    html: `
      <div style="position: relative; width: 44px; height: 44px;">
        <img src="${icon}" style="width: 44px; height: 44px;" />
        ${badgeHtml}
      </div>
    `,
    className: `${site}-cluster-icon`,
    iconSize: L.point(44, 44),
    iconAnchor: L.point(22, 44),
  })
}

function MapClickCloser({ close }) {
  const map = useMap()
  const popup = usePopup()

  useEffect(() => {
    if (!map || typeof map.on !== 'function') return

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
      if (map && typeof map.off === 'function') {
        map.off('click', handler)
      }
    }
  }, [map, close, popup])

  return null
}

const FOCUSED_ZOOM = 12

const NEAR_ME_ZOOM = 10 // City-level view for Near Me

export function PlacesLayer({ site, places, showClusterCounts = true, stateAggregates = [], onStateClick, flyToLocation, resetKey }) {
  const markerRefs = useRef(new Map())
  const lastOpenKeyRef = useRef(null)
  const lastFocusedPlaceRef = useRef(null)
  const popup = usePopup()
  const { openEntry, open, close, registerFocusReturn } = useMapPopup()
  const { setSelectedPlace } = useSelectedPlace()
  const map = useMap()
  const [isMapStable, setIsMapStable] = useState(false)
  const [currentZoom, setCurrentZoom] = useState(DEFAULT_ZOOM)
  const isMountedRef = useRef(true)

  // Track mount state and map stability for safe cleanup
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // Delay rendering MarkerClusterGroup until map is confirmed stable
  useEffect(() => {
    if (!map || typeof map.getZoom !== 'function') {
      setIsMapStable(false)
      return
    }

    // Use requestAnimationFrame to ensure map is fully initialized
    const rafId = requestAnimationFrame(() => {
      if (isMountedRef.current && map && typeof map.getZoom === 'function') {
        setIsMapStable(true)
        setCurrentZoom(map.getZoom())
      }
    })

    return () => {
      cancelAnimationFrame(rafId)
      setIsMapStable(false)
    }
  }, [map])

  // Use refs to track state without triggering effect re-runs
  const loadedRegionsRef = useRef(new Set())
  const stateAggregatesRef = useRef(stateAggregates)
  const onStateClickRef = useRef(onStateClick)

  // Clear loaded regions cache when resetKey changes (filters, theme switch)
  useEffect(() => {
    loadedRegionsRef.current.clear()
  }, [resetKey])

  // Keep refs updated
  useEffect(() => {
    stateAggregatesRef.current = stateAggregates
  }, [stateAggregates])

  useEffect(() => {
    onStateClickRef.current = onStateClick
  }, [onStateClick])

  // Track zoom level changes and trigger region loading when zoomed in
  useEffect(() => {
    if (!map || typeof map.on !== 'function') return

    let debounceTimer = null

    const handleZoomOrMove = () => {
      // Debounce to avoid rapid-fire loading
      if (debounceTimer) clearTimeout(debounceTimer)

      debounceTimer = setTimeout(() => {
        if (!isMountedRef.current || typeof map.getZoom !== 'function') return

        const newZoom = map.getZoom()
        setCurrentZoom(newZoom)

        // When zoomed in past threshold, load visible regions
        if (newZoom >= MIN_MARKERS_ZOOM && onStateClickRef.current) {
          const bounds = map.getBounds()
          if (!bounds) return

          // Add buffer to bounds for small regions near edges
          const expandedBounds = bounds.pad(0.1)

          // Find visible region aggregates and trigger loading
          const aggregates = stateAggregatesRef.current || []
          let loadedThisPass = false
          aggregates.forEach(agg => {
            // Skip if already loading or if we've already triggered this region
            if (agg.isLoading || agg.regionStatus !== 'unloaded' || loadedRegionsRef.current.has(agg.stateCode)) return

            if (expandedBounds.contains([agg.lat, agg.lng])) {
              loadedRegionsRef.current.add(agg.stateCode)
              onStateClickRef.current(agg.stateCode)
              loadedThisPass = true
            }
          })

          // City-level zoom often excludes state centroids (e.g., Ann Arbor vs MI centroid).
          // If nothing matched bounds, load the nearest unloaded region to map center.
          if (!loadedThisPass && typeof map.getCenter === 'function') {
            const center = map.getCenter()
            if (!center) return

            let nearest = null
            let nearestDistance = Number.POSITIVE_INFINITY
            aggregates.forEach(agg => {
              if (agg.isLoading || agg.regionStatus !== 'unloaded' || loadedRegionsRef.current.has(agg.stateCode)) return
              const dLat = agg.lat - center.lat
              const dLng = agg.lng - center.lng
              const distanceSquared = (dLat * dLat) + (dLng * dLng)
              if (distanceSquared < nearestDistance) {
                nearestDistance = distanceSquared
                nearest = agg
              }
            })

            if (nearest && nearestDistance <= 16) {
              loadedRegionsRef.current.add(nearest.stateCode)
              onStateClickRef.current(nearest.stateCode)
            }
          }
        }
      }, 150) // 150ms debounce
    }

    map.on('zoomend', handleZoomOrMove)
    map.on('moveend', handleZoomOrMove)

    // Wait for data before first check (longer delay for initial stability)
    const timeoutId = setTimeout(handleZoomOrMove, 500)

    return () => {
      clearTimeout(debounceTimer)
      clearTimeout(timeoutId)
      if (map && typeof map.off === 'function') {
        map.off('zoomend', handleZoomOrMove)
        map.off('moveend', handleZoomOrMove)
      }
    }
  }, [map])

  const flyToPlace = useCallback(
    (lat, lng, options = {}) => {
      if (!map || typeof map.getMaxZoom !== 'function') return
      if (typeof lat !== 'number' || typeof lng !== 'number') return

      try {
        const maxZoom = map.getMaxZoom() ?? FOCUSED_ZOOM
        const targetZoom = Math.min(FOCUSED_ZOOM, maxZoom || FOCUSED_ZOOM)
        const currentZoom = typeof map.getZoom === 'function' ? map.getZoom() : DEFAULT_ZOOM
        const zoomDelta = Math.abs((currentZoom ?? DEFAULT_ZOOM) - targetZoom)
        const mapBounds = typeof map.getBounds === 'function' ? map.getBounds() : null
        const latLng = [lat, lng]
        const isOutsideView = mapBounds ? !mapBounds.contains(latLng) : false

        const snapFirst = options.snapFirst ?? (zoomDelta > 3 || isOutsideView)
        if (snapFirst) {
          map.setView([lat, lng], targetZoom, { animate: false })
        }
        if (options.animate === false) {
          return
        }
        const animateOptions = {
          duration: options.duration ?? 0.8,
          easeLinearity: 0.25,
          animate: true,
        }
        map.flyTo([lat, lng], targetZoom, animateOptions)
      } catch (err) {
        console.warn('[PlacesLayer] flyToPlace error:', err)
      }
    },
    [map]
  )

  useEffect(() => {
    if (!map) return
    if (map.doubleClickZoom?.disable) {
      map.doubleClickZoom.disable()
    }
    return () => {
      if (map.doubleClickZoom?.enable) {
        map.doubleClickZoom.enable()
      }
    }
  }, [map])

  // Fly to user location when Near Me is activated
  useEffect(() => {
    if (!map || !flyToLocation) return
    if (typeof flyToLocation.lat !== 'number' || typeof flyToLocation.lng !== 'number') return

    try {
      map.flyTo([flyToLocation.lat, flyToLocation.lng], NEAR_ME_ZOOM, {
        duration: 1.0,
        easeLinearity: 0.25,
        animate: true,
      })
    } catch (err) {
      console.warn('[PlacesLayer] flyToLocation error:', err)
    }
  }, [map, flyToLocation])

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
    if (!map) return

    if (openEntry?.id) {
      const targetPlace = places.find(place => String(place.id) === String(openEntry.id))
      if (targetPlace && typeof targetPlace.lat === 'number' && typeof targetPlace.lng === 'number') {
        const coords = [targetPlace.lat, targetPlace.lng]
        const alreadyFocused =
          lastFocusedPlaceRef.current &&
          lastFocusedPlaceRef.current.id === targetPlace.id &&
          lastFocusedPlaceRef.current.lat === targetPlace.lat &&
          lastFocusedPlaceRef.current.lng === targetPlace.lng

        if (!alreadyFocused) {
          flyToPlace(coords[0], coords[1], { duration: 0.85 })
          lastFocusedPlaceRef.current = { id: targetPlace.id, lat: targetPlace.lat, lng: targetPlace.lng }
        }
        return
      }
    }

    if (lastFocusedPlaceRef.current) {
      map.flyTo(DEFAULT_CENTER, DEFAULT_ZOOM, { duration: 0.75 })
      lastFocusedPlaceRef.current = null
    }
  }, [map, openEntry, places, flyToPlace])

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
      setSelectedPlace(null)
      return
    }
    const activePlace = places.find(place => String(place.id) === String(openEntry.id))
    if (!activePlace || typeof activePlace.lat !== 'number' || typeof activePlace.lng !== 'number') {
      popup.hide()
      setSelectedPlace(null)
      return
    }
    const placeId = String(activePlace.id)
    const target = { id: placeId, lat: activePlace.lat, lng: activePlace.lng, type: site }
    const hrefParam = `${site}:${placeId}`
    const href = site === 'taco' ? `/tacos?poi=${hrefParam}` : `/?poi=${hrefParam}`
    setSelectedPlace({
      id: activePlace.id ?? activePlace.place_id ?? null,
      name: activePlace.name ?? null,
      google_place_id: activePlace.google_place_id ?? activePlace.place_id ?? null,
      google_maps_url: activePlace.google_maps_url ?? null,
      address: activePlace.address ?? null,
      city: activePlace.city ?? null,
      state: activePlace.state ?? null,
    })
    popup.expand(target, node =>
      renderExpanded(node, { ...activePlace, id: placeId, type: site, href }, () => {
        popup.hide()
        close()
      })
    )
  }, [close, openEntry, places, popup, site, setSelectedPlace])

  useEffect(
    () => () => {
      popup.hide()
      setSelectedPlace(null)
    },
    [popup, setSelectedPlace]
  )

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
                if (lat !== null && lng !== null) {
                  flyToPlace(lat, lng, { duration: 0.85 })
                }
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
                instance.options.status = status
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
    [places, site, popup, open, buildHref, getMarkerKey, flyToPlace]
  )

  useEffect(() => {
    if (!openEntry.id) return
    const exists = places.some(place => String(place.id) === String(openEntry.id))
    if (!exists) {
      close()
    }
  }, [openEntry, places, close])

  // Wait for map to be stable before rendering MarkerClusterGroup
  if (!isMapStable || !map) {
    return null
  }

  // Only render individual markers when zoomed in enough AND there are places to show
  const showIndividualMarkers = currentZoom >= MIN_MARKERS_ZOOM && places.length > 0
  const showStateAggregates = currentZoom < MIN_MARKERS_ZOOM

  return (
    <>
      <MapClickCloser close={close} />
      {showIndividualMarkers && (
        <MarkerClusterGroup
          key={`cluster-${site}-${showClusterCounts}`}
          chunkedLoading
          maxClusterRadius={80}
          spiderfyOnMaxZoom
          showCoverageOnHover={false}
          iconCreateFunction={createClusterIcon(site, showClusterCounts)}
        >
          {markers}
        </MarkerClusterGroup>
      )}
      {showStateAggregates && (
        <StateAggregateLayer
          aggregates={stateAggregates}
          site={site}
          onStateClick={onStateClick}
          showCounts={showClusterCounts}
        />
      )}
    </>
  )
}
