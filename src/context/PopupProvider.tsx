import { createContext, useContext, useMemo } from 'react'
import { PopupController } from '../lib/popup/PopupController'

const PopupCtx = createContext<PopupController | null>(null)

export function PopupProvider({ map, children }: { map: any; children: React.ReactNode }) {
  const controller = useMemo(() => new PopupController(map), [map])
  return <PopupCtx.Provider value={controller}>{children}</PopupCtx.Provider>
}

export const usePopup = () => {
  const ctx = useContext(PopupCtx)
  if (!ctx) {
    throw new Error('usePopup must be used within PopupProvider')
  }
  return ctx
}
