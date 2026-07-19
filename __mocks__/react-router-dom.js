const React = require('react')

const getPathname = () => {
  if (typeof globalThis !== 'undefined' && globalThis.location && globalThis.location.pathname) {
    return globalThis.location.pathname
  }
  return '/'
}

const getSearch = () => {
  if (typeof globalThis !== 'undefined' && globalThis.location && globalThis.location.search) {
    return globalThis.location.search
  }
  return ''
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
  NavLink: ({ to, children, className, end, ...rest }) => {
    const targetPath = String(to).split('?')[0]
    const pathname = getPathname()
    const isActive = end ? pathname === targetPath : pathname === targetPath || pathname.startsWith(`${targetPath}/`)
    const resolvedClassName = typeof className === 'function' ? className({ isActive }) : className
    return React.createElement('a', { href: to, className: resolvedClassName, ...rest }, children)
  },
  useLocation: () => ({ pathname: getPathname(), search: getSearch() }),
  useNavigate: () => to => {
    if (typeof window !== 'undefined' && window.history) {
      window.history.pushState({}, '', to)
    }
  },
  useSearchParams: () => {
    const [params, setParamsState] = React.useState(() => new URLSearchParams(getSearch()))
    const setParams = next => {
      const resolved = typeof next === 'function' ? next(params) : next
      const normalized = resolved instanceof URLSearchParams ? resolved : new URLSearchParams(resolved)
      setParamsState(new URLSearchParams(normalized))
      if (typeof window !== 'undefined' && window.history) {
        const search = normalized.toString()
        window.history.replaceState({}, '', `${getPathname()}${search ? `?${search}` : ''}`)
      }
    }
    return [params, setParams]
  },
}
