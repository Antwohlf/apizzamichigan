import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'

export type SelectedPlace = {
  id?: string | number | null
  name?: string | null
  google_place_id?: string | null
  google_maps_url?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  type?: string | null
  style?: string | null
  price_range?: string | null
  status?: string | null
  rating?: number | null
  lat?: number | null
  lng?: number | null
}

type ContextValue = {
  selectedPlace: SelectedPlace | null
  setSelectedPlace: (place: SelectedPlace | null) => void
}

const SelectedPlaceContext = createContext<ContextValue | undefined>(undefined)

export function SelectedPlaceProvider({ children }: { children: React.ReactNode }) {
  const [selectedPlace, setSelectedPlaceState] = useState<SelectedPlace | null>(null)

  const setSelectedPlace = useCallback((place: SelectedPlace | null) => {
    setSelectedPlaceState(place)
  }, [])

  const value = useMemo(
    () => ({
      selectedPlace,
      setSelectedPlace,
    }),
    [selectedPlace, setSelectedPlace]
  )

  return React.createElement(SelectedPlaceContext.Provider, { value }, children)
}

export function useSelectedPlace() {
  const context = useContext(SelectedPlaceContext)
  if (!context) {
    throw new Error('useSelectedPlace must be used within a SelectedPlaceProvider')
  }
  return context
}
