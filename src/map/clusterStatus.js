const markerStatus = marker => marker?.options?.status || 'unvisited'

// A cluster must never imply that every place has been reviewed when it contains
// an unvisited place. Favorites remain gold only when the entire cluster is gold.
export const clusterStatusForMarkers = (markers = []) => {
  const statuses = markers.map(markerStatus)

  if (statuses.includes('unvisited')) return 'unvisited'
  if (statuses.length > 0 && statuses.every(status => status === 'golden')) return 'golden'
  return 'visited'
}
