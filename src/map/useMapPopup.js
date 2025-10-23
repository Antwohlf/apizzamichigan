import { createContext, useCallback, useContext, useMemo, useRef, useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const MapPopupContext = createContext(null)

export function MapPopupProvider({ children }) {
  const [openEntry, setOpenEntry] = useState({ type: null, id: null })
  const focusReturnRef = useRef(null)
  const location = useLocation()

  const close = useCallback(() => {
    setOpenEntry({ type: null, id: null })
    if (focusReturnRef.current && typeof focusReturnRef.current.focus === 'function') {
      focusReturnRef.current.focus()
    }
    focusReturnRef.current = null
  }, [])

  const open = useCallback((type, id, focusTarget) => {
    setOpenEntry({ type, id })
    if (focusTarget && typeof focusTarget.focus === 'function') {
      focusReturnRef.current = focusTarget
    }
  }, [])

  const registerFocusReturn = useCallback(ref => {
    focusReturnRef.current = ref
  }, [])

  useEffect(() => {
    close()
  }, [location.pathname, location.search, close])

  useEffect(() => {
    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        close()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [close])

  const value = useMemo(
    () => ({
      openEntry,
      open,
      close,
      registerFocusReturn,
    }),
    [openEntry, open, close, registerFocusReturn]
  )

  return <MapPopupContext.Provider value={value}>{children}</MapPopupContext.Provider>
}

export function useMapPopup() {
  const context = useContext(MapPopupContext)
  if (!context) {
    throw new Error('useMapPopup must be used within a MapPopupProvider')
  }
  return context
}
