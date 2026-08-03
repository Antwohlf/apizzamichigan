import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { Marker, useMap } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import { getMarkerIcon } from './getMarkerIcon'
import { clusterStatusForMarkers } from './clusterStatus'
import { useMapPopup } from './useMapPopup'
import { usePopup } from '../context/PopupProvider'
import { renderExpanded, renderPreview } from '../components/map/renderPopup'
import { REVIEW_LIGHTBOX_CLOSE_EVENT, REVIEW_LIGHTBOX_OPEN_EVENT } from '../components/ReviewGallery'
import '../styles/marker-popup.css'
import { useSelectedPlace } from '../store/selectedPlace'
import { supabase } from '../supabaseClient'
import { readSupabase } from '../lib/supabaseRead'
import { StateAggregateLayer } from './StateMarker'
import pizzaIconColored from '../icons/pizza/marker-pizza-colored.svg'
import pizzaIconGrey from '../icons/pizza/marker-pizza-grey.svg'
import pizzaIconGold from '../icons/pizza/marker-pizza-gold.svg'
import tacoIconColored from '../icons/taco/marker-taco-colored.svg'
import tacoIconGrey from '../icons/taco/marker-taco-grey.svg'
import tacoIconGold from '../icons/taco/marker-taco-gold.svg'
import {
  DEFAULT_MAP_ZOOM,
  FOCUSED_PLACE_ZOOM,
  MIN_INDIVIDUAL_MARKERS_ZOOM,
  CLUSTER_FIT_MAX_ZOOM,
  clusterFitOptions,
  clusterNavigation,
  clusterRadiusForZoom,
  focusedPlaceZoom,
  isPlaceViewportFocused,
  captureLightboxViewport,
  lightboxRestoreViewport,
  searchFitOptions,
  searchNavigation,
} from './viewport'
import { saveMapReturnState } from './mapReturnState'
import { entityConfig } from '../config/entityConfig'

const CLUSTER_ICONS = {
  pizza: { visited: pizzaIconColored, unvisited: pizzaIconGrey, golden: pizzaIconGold },
  taco: { visited: tacoIconColored, unvisited: tacoIconGrey, golden: tacoIconGold },
}

const DEFAULT_ZOOM = DEFAULT_MAP_ZOOM
const MIN_MARKERS_ZOOM = MIN_INDIVIDUAL_MARKERS_ZOOM // Only show individual markers at this zoom or higher (changed from 6 to avoid boundary condition)

const createClusterIcon = (site, showCounts) => (cluster) => {
  const count = cluster.getChildCount()
  const childMarkers = cluster.getAllChildMarkers()

  const clusterStatus = clusterStatusForMarkers(childMarkers)

  const icons = CLUSTER_ICONS[site] || CLUSTER_ICONS.pizza
  const icon = icons[clusterStatus] || icons.unvisited
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
      <div role="img" aria-label="${count} ${site} places" title="${count} ${site} places" style="position: relative; width: 44px; height: 44px;">
        <img src="${icon}" alt="" aria-hidden="true" style="width: 44px; height: 44px;" />
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
        const lightbox = target.closest('.review-lightbox')
        if (lightbox) return
        const gallery = target.closest('.review-gallery')
        if (gallery) return
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

const FOCUSED_ZOOM = FOCUSED_PLACE_ZOOM

const NEAR_ME_ZOOM = 10 // City-level view for Near Me
const replacementPlaceCache = new Map()
const reviewPhotoCache = new Map()
let reviewPhotoTableAvailable = true

async function loadReviewPhotos(placeId) {
  const key = String(placeId || '')
  if (!key || !reviewPhotoTableAvailable) return []
  if (reviewPhotoCache.has(key)) return reviewPhotoCache.get(key)

  try {
    const { data, error } = await readSupabase(() => supabase
      .from('review-photos')
      .select('id, storage_path, sort_order')
      .eq('place_id', placeId)
      .order('sort_order', { ascending: true }))
    if (error) {
      if (error.code === 'PGRST205') reviewPhotoTableAvailable = false
      return []
    }

    const storage = supabase.storage?.from?.('review-photos')
    const photos = (data || []).map(photo => {
      const { data: publicData } = storage?.getPublicUrl?.(photo.storage_path) || {}
      return {
        id: photo.id,
        path: photo.storage_path,
        sortOrder: photo.sort_order,
        publicUrl: publicData?.publicUrl || null,
      }
    }).filter(photo => photo.publicUrl)
    reviewPhotoCache.set(key, photos)
    return photos
  } catch (error) {
    return []
  }
}

const captureMapViewport = map => {
  if (!map || typeof map.getCenter !== 'function' || typeof map.getZoom !== 'function') return null
  const center = map.getCenter()
  const zoom = map.getZoom()
  if (!center || typeof center.lat !== 'number' || typeof center.lng !== 'number' || typeof zoom !== 'number') {
    return null
  }
  return { lat: center.lat, lng: center.lng, zoom }
}

const restoreMapViewport = (map, viewport) => {
  if (!map || !viewport || typeof map.setView !== 'function') return
  map.setView([viewport.lat, viewport.lng], viewport.zoom, { animate: false })
}

export function PlacesLayer({
  site,
  places,
  showClusterCounts = true,
  stateAggregates = [],
  onStateClick,
  flyToLocation,
  resetKey,
  forceIndividualMarkers = false,
  searchFocusKey = '',
}) {
  const entity = entityConfig(site)
  const markerRefs = useRef(new Map())
  const lastOpenKeyRef = useRef(null)
  const lastFocusedPlaceRef = useRef(null)
  const popup = usePopup()
  const { openEntry, open, close, registerFocusReturn } = useMapPopup()
  const { setSelectedPlace } = useSelectedPlace()
  const map = useMap()
  const [isMapStable, setIsMapStable] = useState(false)
  const [currentZoom, setCurrentZoom] = useState(DEFAULT_ZOOM)
  const [replacementPlaces, setReplacementPlaces] = useState({})
  const [popupPhotos, setPopupPhotos] = useState({})
  const isMountedRef = useRef(true)
  const lightboxViewportRef = useRef(null)
  const activePlaceRef = useRef(null)
  const lastSearchFocusKeyRef = useRef('')
  const searchViewportRef = useRef(null)

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

  useEffect(() => {
    if (!map || typeof window === 'undefined') return undefined

    let restoreTimer = null
    let lateRestoreTimer = null

    const handleLightboxOpen = () => {
      lightboxViewportRef.current = captureLightboxViewport({
        capturedViewport: captureMapViewport(map),
        activePlace: activePlaceRef.current,
      })
    }

    const handleLightboxClose = () => {
      const viewport = lightboxViewportRef.current
      if (!viewport) return
      if (restoreTimer) {
        clearTimeout(restoreTimer)
      }
      if (lateRestoreTimer) {
        clearTimeout(lateRestoreTimer)
      }
      const restore = () => {
        restoreMapViewport(map, lightboxRestoreViewport({
          capturedViewport: viewport,
          activePlace: activePlaceRef.current,
        }))
      }
      restoreTimer = setTimeout(() => {
        restore()
        restoreTimer = null
      }, 0)
      // Popup state and region loading can trigger a later Leaflet view reset.
      // Re-apply the captured place viewport after those updates settle.
      lateRestoreTimer = setTimeout(() => {
        restore()
        lightboxViewportRef.current = null
        lateRestoreTimer = null
      }, 180)
    }

    window.addEventListener(REVIEW_LIGHTBOX_OPEN_EVENT, handleLightboxOpen)
    window.addEventListener(REVIEW_LIGHTBOX_CLOSE_EVENT, handleLightboxClose)

    return () => {
      if (restoreTimer) {
        clearTimeout(restoreTimer)
      }
      if (lateRestoreTimer) {
        clearTimeout(lateRestoreTimer)
      }
      window.removeEventListener(REVIEW_LIGHTBOX_OPEN_EVENT, handleLightboxOpen)
      window.removeEventListener(REVIEW_LIGHTBOX_CLOSE_EVENT, handleLightboxClose)
    }
  }, [map])

  const flyToPlace = useCallback(
    (lat, lng, options = {}) => {
      if (!map || typeof map.getMaxZoom !== 'function') return
      if (typeof lat !== 'number' || typeof lng !== 'number') return

      try {
        const maxZoom = map.getMaxZoom() ?? FOCUSED_ZOOM
        const currentZoom = typeof map.getZoom === 'function' ? map.getZoom() : DEFAULT_ZOOM
        const mapBounds = typeof map.getBounds === 'function' ? map.getBounds() : null
        const latLng = [lat, lng]
        const isOutsideView = mapBounds ? !mapBounds.contains(latLng) : false
        const targetZoom = focusedPlaceZoom({
          currentZoom,
          maxZoom,
          isOutsideView,
          preserveZoomIfVisible: Boolean(options.preserveZoomIfVisible),
        })
        const zoomDelta = Math.abs((currentZoom ?? DEFAULT_ZOOM) - targetZoom)

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

  const handleClusterClick = useCallback((event) => {
    const cluster = event?.layer
    if (!map || !cluster || typeof cluster.getBounds !== 'function' || typeof map.fitBounds !== 'function') return
    const bounds = cluster.getBounds()
    if (!bounds || (typeof bounds.isValid === 'function' && !bounds.isValid())) return

    const southwest = typeof bounds.getSouthWest === 'function' ? bounds.getSouthWest() : null
    const northeast = typeof bounds.getNorthEast === 'function' ? bounds.getNorthEast() : null
    const navigation = clusterNavigation({
      latitudeSpan: southwest && northeast ? northeast.lat - southwest.lat : 0,
      longitudeSpan: southwest && northeast ? northeast.lng - southwest.lng : 0,
      currentZoom: typeof map.getZoom === 'function' ? map.getZoom() : DEFAULT_ZOOM,
      // Keep wide-cluster expansion at neighborhood context. Leaflet's global
      // max zoom is a rendering limit, not the product's navigation target.
      maxZoom: CLUSTER_FIT_MAX_ZOOM,
    })

    if (navigation.mode === 'step' && typeof bounds.getCenter === 'function') {
      const center = bounds.getCenter()
      if (center && typeof map.flyTo === 'function') {
        map.flyTo([center.lat, center.lng], navigation.zoom, {
          duration: 0.6,
          easeLinearity: 0.25,
          animate: true,
        })
        return
      }
    }

    map.fitBounds(bounds, clusterFitOptions())
  }, [map])

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

  // Search results arrive independently from the regional map data. Bring the
  // map to the committed result set once so the result list and map tell the
  // same story without refocusing on every render.
  useEffect(() => {
    if (!searchFocusKey) {
      // Search navigation is temporary. Return to the context the user was
      // browsing before the result moved the map to another city or market.
      const previousViewport = searchViewportRef.current
      const shouldRestore = Boolean(map && lastSearchFocusKeyRef.current && previousViewport)
      searchViewportRef.current = null
      // Allow the same query to focus the map again after the user clears it.
      lastSearchFocusKeyRef.current = ''

      if (shouldRestore) {
        // Let the result-driven region update settle before restoring the
        // viewport; otherwise the map can immediately snap back to the
        // result bounds on the same render.
        const restoreTimer = setTimeout(() => {
          restoreMapViewport(map, previousViewport)
        }, 0)
        return () => clearTimeout(restoreTimer)
      }
      return
    }
    if (!map || !searchFocusKey || !places.length || lastSearchFocusKeyRef.current === searchFocusKey) return
    const validPlaces = places.filter(place => (
      typeof place.lat === 'number' && Number.isFinite(place.lat) &&
      typeof place.lng === 'number' && Number.isFinite(place.lng)
    ))
    if (!validPlaces.length) return

    if (!lastSearchFocusKeyRef.current && !searchViewportRef.current) {
      searchViewportRef.current = captureMapViewport(map)
    }
    lastSearchFocusKeyRef.current = searchFocusKey
    const navigation = searchNavigation(validPlaces)
    if (navigation.mode === 'place' && navigation.place) {
      if (navigation.zoom && typeof map.flyTo === 'function') {
        map.flyTo([navigation.place.lat, navigation.place.lng], navigation.zoom, {
          duration: 0.7,
          easeLinearity: 0.25,
          animate: true,
        })
      } else {
        flyToPlace(navigation.place.lat, navigation.place.lng, { duration: 0.7 })
      }
      return
    }

    const bounds = L.latLngBounds(navigation.places.map(place => [place.lat, place.lng]))
    if (!bounds.isValid() || typeof map.fitBounds !== 'function') return
    map.fitBounds(bounds, searchFitOptions())
  }, [map, places, searchFocusKey, flyToPlace])

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
          lastFocusedPlaceRef.current.lng === targetPlace.lng &&
          isPlaceViewportFocused({
            center: typeof map.getCenter === 'function' ? map.getCenter() : null,
            zoom: typeof map.getZoom === 'function' ? map.getZoom() : DEFAULT_ZOOM,
            place: targetPlace,
          })

        if (!alreadyFocused) {
          flyToPlace(coords[0], coords[1], { duration: 0.85, preserveZoomIfVisible: true })
          lastFocusedPlaceRef.current = { id: targetPlace.id, lat: targetPlace.lat, lng: targetPlace.lng }
        }
        return
      }
    }

    lastFocusedPlaceRef.current = null
  }, [map, openEntry, places, flyToPlace])

  useEffect(() => {
    const key = openEntry?.id ? `${openEntry.type}:${openEntry.id}` : null
    if (key) {
      lastOpenKeyRef.current = key
    } else if (lastOpenKeyRef.current) {
      lastOpenKeyRef.current = null
    }
  }, [openEntry])

  // A replaced place and its successor may live in different loaded regions.
  // Fetch only the small successor identity payload when the map cannot already
  // resolve it locally, and reuse it for later openings in this session.
  useEffect(() => {
    if (!openEntry?.id || openEntry.type !== site) return undefined
    const activePlace = places.find(place => String(place.id) === String(openEntry.id))
    const replacementId = activePlace?.lifecycle_replaced_by_id ?? activePlace?.lifecycleReplacedById ?? null
    if (!replacementId || places.some(place => String(place.id) === String(replacementId))) return undefined

    const cacheKey = `${site}:${replacementId}`
    const cached = replacementPlaceCache.get(cacheKey)
    if (cached) {
      setReplacementPlaces(previous => previous[cacheKey] === cached ? previous : { ...previous, [cacheKey]: cached })
      return undefined
    }

    let cancelled = false
    const table = entity.table
    readSupabase(() => supabase
      .from(table)
      .select('id, name, address, state')
      .eq('id', replacementId)
      .maybeSingle())
      .then(({ data, error }) => {
        if (cancelled || error || !data) return
        replacementPlaceCache.set(cacheKey, data)
        setReplacementPlaces(previous => ({ ...previous, [cacheKey]: data }))
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [entity.table, openEntry, places, site])

  useEffect(() => {
    if (!openEntry?.id || openEntry.type !== site) return undefined
    const activePlace = places.find(place => String(place.id) === String(openEntry.id))
    if (!activePlace) return undefined
    const placeId = String(activePlace.id)
    if (Array.isArray(activePlace.photos) && activePlace.photos.length) return undefined
    if (popupPhotos[placeId] || reviewPhotoCache.has(placeId)) return undefined

    let cancelled = false
    loadReviewPhotos(placeId).then(photos => {
      if (!cancelled) setPopupPhotos(previous => ({ ...previous, [placeId]: photos }))
    })
    return () => {
      cancelled = true
    }
  }, [openEntry, places, popupPhotos, site])

  useEffect(() => {
    if (!popup) return
    if (!openEntry?.id || openEntry.type !== site) {
      activePlaceRef.current = null
      popup.hide()
      setSelectedPlace(null)
      return
    }
    const activePlace = places.find(place => String(place.id) === String(openEntry.id))
    if (!activePlace || typeof activePlace.lat !== 'number' || typeof activePlace.lng !== 'number') {
      activePlaceRef.current = null
      popup.hide()
      setSelectedPlace(null)
      return
    }
    activePlaceRef.current = activePlace
    const placeId = String(activePlace.id)
    const target = { id: placeId, lat: activePlace.lat, lng: activePlace.lng, type: site }
    const replacementId = activePlace.lifecycle_replaced_by_id ?? activePlace.lifecycleReplacedById ?? null
    const replacementPlace = replacementId
      ? places.find(place => String(place.id) === String(replacementId))
      : null
    const replacementCacheKey = replacementId ? `${site}:${replacementId}` : null
    const replacementIdentity = replacementPlace || (replacementCacheKey ? replacementPlaces[replacementCacheKey] : null)
    const href = `${entity.placeRoute}/${encodeURIComponent(placeId)}`
    setSelectedPlace({
      id: activePlace.id ?? activePlace.place_id ?? null,
      name: activePlace.name ?? null,
      google_place_id: activePlace.google_place_id ?? activePlace.place_id ?? null,
      google_maps_url: activePlace.google_maps_url ?? null,
      address: activePlace.address ?? null,
      city: activePlace.city ?? null,
      state: activePlace.state ?? null,
      type: site,
      style: activePlace.style ?? null,
      price_range: activePlace.price_range ?? activePlace.priceRange ?? activePlace.price ?? null,
      status: activePlace.statusRaw ?? activePlace.status ?? null,
      rating: typeof activePlace.rating === 'number' && Number.isFinite(activePlace.rating) ? activePlace.rating : null,
      lifecycle_status: activePlace.lifecycle_status ?? activePlace.lifecycleStatus ?? null,
      lifecycle_replaced_by_id: activePlace.lifecycle_replaced_by_id ?? activePlace.lifecycleReplacedById ?? null,
      lat: activePlace.lat,
      lng: activePlace.lng,
    })
    popup.expand(target, node =>
      renderExpanded(
        node,
        {
          ...activePlace,
          id: placeId,
          type: site,
          href,
          photos: popupPhotos[placeId] ?? activePlace.photos,
          lifecycle_replaced_by_name: replacementIdentity?.name || null,
        },
        () => {
          popup.hide()
          close()
        },
        () => {
          const viewport = captureMapViewport(map)
          if (!viewport || typeof window === 'undefined') return
          saveMapReturnState({
            pathname: window.location.pathname,
            search: window.location.search,
            center: { lat: viewport.lat, lng: viewport.lng },
            zoom: viewport.zoom,
          })
        },
      )
    )
  }, [close, entity.placeRoute, map, openEntry, places, popup, popupPhotos, replacementPlaces, site, setSelectedPlace])

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
      const encodedId = encodeURIComponent(placeId)
      return `${entity.placeRoute}/${encodedId}`
    },
    [entity.placeRoute]
  )

  const markers = useMemo(
    () =>
      places.map((place, idx) => {
        const placeId = place.id ? String(place.id) : null
        const lat = typeof place.lat === 'number' ? place.lat : null
        const lng = typeof place.lng === 'number' ? place.lng : null
        if (lat === null || lng === null) return null
        const markerKey = getMarkerKey(place, idx)

        const status = place.status || 'unvisited'

        return (
          <Marker
            key={markerKey}
            position={[lat, lng]}
            title={place.name || `${site} place`}
            icon={getMarkerIcon(site, status, place.lifecycleStatus || place.lifecycle_status)}
            eventHandlers={{
              click: event => {
                if (!placeId) return
                const markerInstance = markerRefs.current.get(markerKey)
                const node = markerInstance?.getElement?.() || event?.target?.getElement?.()
                if (node) {
                  node.focus?.()
                }
                lastFocusedPlaceRef.current = { id: place.id, lat, lng }
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
    [places, site, popup, open, buildHref, getMarkerKey]
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
  const showIndividualMarkers = (forceIndividualMarkers || currentZoom >= MIN_MARKERS_ZOOM) && places.length > 0
  const showStateAggregates = !forceIndividualMarkers && currentZoom < MIN_MARKERS_ZOOM

  return (
    <>
      <MapClickCloser close={close} />
      {showIndividualMarkers && (
        forceIndividualMarkers ? markers : (
          <MarkerClusterGroup
            key={`cluster-${site}-${showClusterCounts}`}
            // Keep the visible marker set stable while the map moves. Chunked
            // insertion makes places appear in waves, which is especially
            // distracting on dense city views.
            chunkedLoading={false}
            removeOutsideVisibleBounds={false}
            animateAddingMarkers={false}
            maxClusterRadius={clusterRadiusForZoom}
            // Keep clusters spatially stable while zooming. The default
            // animation makes dense pizza areas appear to jump apart.
            animate={false}
            // Keep dense locations in normal map space. Spiderfying makes a
            // place cluster jump away from its real geography at max zoom.
            spiderfyOnMaxZoom={false}
            disableClusteringAtZoom={15}
            zoomToBoundsOnClick={false}
            onClick={handleClusterClick}
            showCoverageOnHover={false}
            iconCreateFunction={createClusterIcon(site, showClusterCounts)}
          >
            {markers}
          </MarkerClusterGroup>
        )
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
