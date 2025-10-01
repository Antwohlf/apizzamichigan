const React = require('react')

module.exports = {
  MapContainer: ({ children, ...rest }) => React.createElement('div', { 'data-testid': 'map-container', ...rest }, children),
  TileLayer: () => null,
  Marker: ({ children, ...rest }) => React.createElement('div', { 'data-testid': 'marker', ...rest }, children),
  Popup: ({ children }) => React.createElement('div', { 'data-testid': 'popup' }, children),
  useMapEvents: () => ({
    on: () => {},
  }),
}
