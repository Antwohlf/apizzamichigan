const React = require('react')

module.exports = ({ children }) => React.createElement(
  'div',
  { 'data-testid': 'marker-cluster-group' },
  children,
)
