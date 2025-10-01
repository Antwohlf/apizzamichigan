// src/themes/ThemeProvider.js
import React, { createContext, useContext, useMemo } from 'react'
import { DEFAULT_THEME_KEY, ThemeKeys } from './siteTheme'
import { pizzaTheme } from './pizzaTheme'
import { tacoTheme } from './tacoTheme'

export const themesByKey = {
  [ThemeKeys.PIZZA]: pizzaTheme,
  [ThemeKeys.TACO]: tacoTheme,
}

const ThemeContext = createContext({
  themeKey: DEFAULT_THEME_KEY,
  theme: pizzaTheme,
})

export function ThemeProvider({ themeKey = DEFAULT_THEME_KEY, children }) {
  const resolvedKey = themesByKey[themeKey] ? themeKey : DEFAULT_THEME_KEY
  const theme = themesByKey[resolvedKey]

  const value = useMemo(() => ({ themeKey: resolvedKey, theme }), [resolvedKey, theme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}
