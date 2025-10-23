import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import LoadingOverlay from '../components/ui/LoadingOverlay'

const GlobalLoadingContext = createContext(null)

export function GlobalLoadingProvider({ children }) {
  const [state, setState] = useState({ isOpen: false, variant: 'pizza', label: null })

  const open = useCallback((label = null) => {
    setState(prev => ({ ...prev, isOpen: true, label }))
  }, [])

  const close = useCallback(() => {
    setState(prev => ({ ...prev, isOpen: false, label: null }))
  }, [])

  const setVariant = useCallback(variant => {
    setState(prev => ({ ...prev, variant: variant || prev.variant }))
  }, [])

  const value = useMemo(
    () => ({
      isOpen: state.isOpen,
      label: state.label,
      variant: state.variant,
      open,
      close,
      setVariant,
    }),
    [state, open, close, setVariant]
  )

  return (
    <GlobalLoadingContext.Provider value={value}>
      {children}
      <LoadingOverlay isOpen={state.isOpen} variant={state.variant} label={state.label} />
    </GlobalLoadingContext.Provider>
  )
}

export function useGlobalLoading() {
  const context = useContext(GlobalLoadingContext)
  if (!context) {
    throw new Error('useGlobalLoading must be used within a GlobalLoadingProvider')
  }
  return context
}
