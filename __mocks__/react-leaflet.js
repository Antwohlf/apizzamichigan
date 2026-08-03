const React = require('react')

const mockMap = {
  getBounds: () => ({ contains: () => true }),
  getZoom: () => 6,
  setView: () => {},
  flyTo: () => {},
  on: () => {},
  off: () => {},
}

module.exports = {
  MapContainer: ({ children, ...rest }) => React.createElement('div', { 'data-testid': 'map-container', ...rest }, children),
  TileLayer: () => null,
  Marker: ({ children, ...rest }) => React.createElement('div', { 'data-testid': 'marker', ...rest }, children),
  Popup: ({ children }) => React.createElement('div', { 'data-testid': 'popup' }, children),
  useMap: () => mockMap,
  useMapEvents: () => mockMap,
}
