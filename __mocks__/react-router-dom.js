const React = require('react')

const getPathname = () => {
  if (typeof globalThis !== 'undefined' && globalThis.location && globalThis.location.pathname) {
    return globalThis.location.pathname
  }
  return '/'
}

module.exports = {
  BrowserRouter: ({ children }) => React.createElement('div', { 'data-testid': 'router' }, children),
  Routes: ({ children }) => {
    const pathname = getPathname()
    let match = null
    React.Children.forEach(children, (child) => {
      if (match || !child) return
      if (child.props && child.props.path === pathname) {
        match = child.props.element
      }
    })
    return match || null
  },
  Route: ({ element }) => element,
  Link: ({ to, children, ...rest }) => React.createElement('a', { href: to, ...rest }, children),
  useLocation: () => ({ pathname: getPathname() }),
}
