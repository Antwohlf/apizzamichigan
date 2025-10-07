import React, { useEffect, useState } from 'react'
import { useTheme } from './themes/ThemeProvider'
import { ThemeKeys } from './themes/siteTheme'
import { pizzaStyles } from './data/pizzaStyles'
import { TACO_TYPES } from './data/tacoTypes'
import { StatusFilter } from './sidebar/StatusFilter'
import './Sidebar.css'

const DEFAULT_STATUS_VALUES = ['visited', 'unvisited', 'golden']

const arraysEqual = (a = [], b = []) =>
  a.length === b.length && a.every((value, index) => value === b[index])

const Sidebar = ({ onFilterChange, themeKey, filters = {} }) => {
  const { theme } = useTheme()

  // Allow multiple selections
  const [selectedStyles, setSelectedStyles] = useState([])
  const [selectedPrices, setSelectedPrices] = useState([])
  const [selectedStatuses, setSelectedStatuses] = useState(new Set(DEFAULT_STATUS_VALUES))

  const stylesForTheme = themeKey === ThemeKeys.TACO ? TACO_TYPES : pizzaStyles

  useEffect(() => {
    if (!filters) return

    const nextStyles = Array.isArray(filters.styles) ? filters.styles : []
    const nextPrices = Array.isArray(filters.prices) ? filters.prices : []
    const nextStatuses = Array.isArray(filters.statuses) && filters.statuses.length
      ? filters.statuses
      : DEFAULT_STATUS_VALUES

    setSelectedStyles(prev => (arraysEqual(prev, nextStyles) ? prev : [...nextStyles]))
    setSelectedPrices(prev => (arraysEqual(prev, nextPrices) ? prev : [...nextPrices]))
    setSelectedStatuses(prev => {
      const matches = prev.size === nextStatuses.length && nextStatuses.every(status => prev.has(status))
      return matches ? prev : new Set(nextStatuses)
    })
  }, [filters])

  // Toggle selection for styles
  const handleStyleSelect = style => {
    setSelectedStyles(prevStyles =>
      prevStyles.includes(style)
        ? prevStyles.filter(s => s !== style) // Deselect if clicked again
        : [...prevStyles, style] // Select multiple
    )
  }

  // Toggle selection for prices
  const handlePriceSelect = price => {
    setSelectedPrices(prevPrices =>
      prevPrices.includes(price)
        ? prevPrices.filter(p => p !== price)
        : [...prevPrices, price]
    )
  }

  // Combine both style and price filters into a single object, then send to parent
  useEffect(() => {
    const filter = {
      styles: selectedStyles,
      prices: selectedPrices,
      statuses: Array.from(selectedStatuses),
    }
    onFilterChange(filter)
  }, [selectedStyles, selectedPrices, selectedStatuses, onFilterChange])

  useEffect(() => {
    setSelectedStyles([])
    setSelectedPrices([])
    setSelectedStatuses(new Set(DEFAULT_STATUS_VALUES))
  }, [themeKey])

  return (
    <div className="sidebar-container">
      <h2>{theme.copy.styleLabel}</h2>
      <div className="sidebar-options">
        {stylesForTheme.map(style => (
          <button
            key={style}
            className={`sidebar-btn ${selectedStyles.includes(style) ? 'active' : ''}`}
            onClick={() => handleStyleSelect(style)}
          >
            {style}
          </button>
        ))}
      </div>

      <h2>Price</h2>
      <div className="sidebar-options">
        {['$', '$$', '$$$'].map(price => (
          <button
            key={price}
            className={`sidebar-btn ${selectedPrices.includes(price) ? 'active' : ''}`}
            onClick={() => handlePriceSelect(price)}
          >
            {price}
          </button>
        ))}
      </div>

      <StatusFilter value={selectedStatuses} onChange={setSelectedStatuses} />
    </div>
  )
}

export default Sidebar
