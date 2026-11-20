import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet.markercluster'
import { useMap } from 'react-leaflet'
import { getMarkerIcon } from './getMarkerIcon'
import { clusterRadiusForZoom } from './viewport'

// React-Leaflet adds each <Marker> separately, bypassing MarkerCluster's bulk
// insertion path. Bound both marker creation and bulk insertion to small tasks.
export const MARKER_BATCH_SIZE = 80
export const MARKER_BATCH_DELAY = 16
export const PLACE_CLUSTER_OPTIONS = {
  chunkedLoading: true,
  chunkInterval: 8,
  chunkDelay: MARKER_BATCH_DELAY,
  removeOutsideVisibleBounds: true,
  animateAddingMarkers: false,
  maxClusterRadius: clusterRadiusForZoom,
  animate: false,
  spiderfyOnMaxZoom: false,
  disableClusteringAtZoom: 15,
  zoomToBoundsOnClick: false,
  showCoverageOnHover: false,
}

export function createPlaceMarkerManager({ map, site, markerRefs, createMarker, iconCreateFunction, onClusterClick }) {
  const clusters = L.markerClusterGroup({ ...PLACE_CLUSTER_OPTIONS, iconCreateFunction })
  const individuals = L.layerGroup()
  const records = new Map()
  let timer = null
  let unclustered = false
  let enabled = false
  let disposed = false
  let currentIcon = iconCreateFunction

  clusters.on('clusterclick', onClusterClick)
  const cancel = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  return {
    clusters,
    update({ places, visible, forceIndividualMarkers, iconCreateFunction: nextIcon }) {
      cancel()
      if (disposed) return
      if (nextIcon !== currentIcon) {
        currentIcon = nextIcon
        clusters.options.iconCreateFunction = nextIcon
        clusters.refreshClusters()
      }
      const modeChanged = unclustered !== forceIndividualMarkers
      unclustered = forceIndividualMarkers
      enabled = visible
      if (modeChanged) {
        // Switching a small search result set between raw pins and clusters is
        // explicit. Ordinary zooming retains the same cluster tree and markers.
        clusters.clearLayers()
        individuals.clearLayers()
        map.removeLayer(clusters)
        map.removeLayer(individuals)
        records.forEach(record => { record.attached = false })
      }
      const activeLayer = unclustered ? individuals : clusters
      const inactiveLayer = unclustered ? clusters : individuals
      if (map.hasLayer(inactiveLayer)) map.removeLayer(inactiveLayer)
      if (enabled && !map.hasLayer(activeLayer)) map.addLayer(activeLayer)
      if (!enabled && map.hasLayer(activeLayer)) map.removeLayer(activeLayer)
      // Do not create thousands of hidden markers in the state overview. Keep
      // existing clusters cached so crossing zoom 7 does not rebuild them.
      if (!enabled) return

      const wanted = new Map()
      places.forEach((place, index) => {
        if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return
        wanted.set(`${site}:${place.id ?? index}`, place)
      })
      const removals = [...records.keys()].filter(key => !wanted.has(key))
      const updates = [...wanted.entries()]
      let removeIndex = 0
      let updateIndex = 0

      const process = () => {
        timer = null
        if (disposed || !enabled) return
        let remaining = MARKER_BATCH_SIZE
        const removed = []
        while (removeIndex < removals.length && remaining-- > 0) {
          const key = removals[removeIndex++]
          const record = records.get(key)
          removed.push(record.marker)
          record.marker.off()
          records.delete(key)
          markerRefs.current.delete(key)
        }
        if (removed.length) {
          if (unclustered) removed.forEach(marker => individuals.removeLayer(marker))
          else clusters.removeLayers(removed)
        }
        const added = []
        const changedStatuses = []
        while (updateIndex < updates.length && remaining-- > 0) {
          const [key, place] = updates[updateIndex++]
          let record = records.get(key)
          const status = place.status || 'unvisited'
          const icon = getMarkerIcon(site, status, place.lifecycleStatus || place.lifecycle_status)
          if (!record) {
            const marker = createMarker(place, key, icon)
            record = { marker, attached: false }
            records.set(key, record)
            markerRefs.current.set(key, marker)
          } else {
            const oldPosition = record.marker.getLatLng()
            // setLatLng emits move even for identical coordinates. MarkerCluster
            // responds by removing/reinserting the marker and rebuilding icons.
            if (oldPosition.lat !== place.lat || oldPosition.lng !== place.lng) {
              record.marker.setLatLng([place.lat, place.lng])
            }
            if (record.marker.options.icon !== icon) record.marker.setIcon(icon)
            if (record.marker.options.status !== status) changedStatuses.push(record.marker)
            const title = place.name || `${site} place`
            if (record.marker.options.title !== title) {
              record.marker.options.title = title
              const element = record.marker.getElement?.()
              if (element) element.title = title
            }
          }
          record.marker.options.place = place
          record.marker.options.status = status
          if (!record.attached) {
            record.attached = true
            added.push(record.marker)
          }
        }
        if (added.length) {
          if (unclustered) added.forEach(marker => individuals.addLayer(marker))
          else clusters.addLayers(added)
        }
        if (!unclustered && changedStatuses.length) clusters.refreshClusters(changedStatuses)
        if (removeIndex < removals.length || updateIndex < updates.length) {
          timer = setTimeout(process, MARKER_BATCH_DELAY)
        }
      }
      timer = setTimeout(process, 0)
    },
    destroy() {
      disposed = true
      cancel()
      map.removeLayer(clusters)
      map.removeLayer(individuals)
      clusters.clearLayers()
      individuals.clearLayers()
      clusters.off()
      records.forEach(({ marker }, key) => {
        marker.off()
        markerRefs.current.delete(key)
      })
      records.clear()
    },
  }
}

export function ManagedPlaceMarkers(props) {
  const map = useMap()
  const managerRef = useRef(null)
  const { site, markerRefs, createMarker, onClusterClick, iconCreateFunction, places, visible, forceIndividualMarkers } = props
  useEffect(() => {
    if (!map?.addLayer || typeof L.markerClusterGroup !== 'function') return undefined
    const manager = createPlaceMarkerManager({ map, site, markerRefs, createMarker, onClusterClick, iconCreateFunction })
    managerRef.current = manager
    return () => {
      manager.destroy()
      managerRef.current = null
    }
    // Icon changes update existing clusters in the following effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, site, markerRefs, createMarker, onClusterClick])
  useEffect(() => {
    managerRef.current?.update({ places, visible, forceIndividualMarkers, iconCreateFunction })
  }, [map, site, markerRefs, createMarker, onClusterClick, places, visible, forceIndividualMarkers, iconCreateFunction])
  return null
}
