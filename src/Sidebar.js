import React, { useEffect, useState } from 'react'
import { useTheme } from './themes/ThemeProvider'
import { ThemeKeys } from './themes/siteTheme'
import { pizzaStyles } from './data/pizzaStyles'
import { TACO_TYPES } from './data/tacoTypes'
import { StatusFilter } from './sidebar/StatusFilter'
import './Sidebar.css'

const ALL_STATUS_VALUES = ['visited', 'unvisited', 'golden']

const arraysEqual = (a = [], b = []) =>
  a.length === b.length && a.every((value, index) => value === b[index])

const Sidebar = ({ onFilterChange, themeKey, filters = {} }) => {
  const { theme } = useTheme()

  const [selectedStyles, setSelectedStyles] = useState([])
  const [selectedPrices, setSelectedPrices] = useState([])
  const [selectedStatuses, setSelectedStatuses] = useState(new Set())

  const stylesForTheme = themeKey === ThemeKeys.TACO ? TACO_TYPES : pizzaStyles

  useEffect(() => {
    if (!filters) return

    const nextStyles = Array.isArray(filters.styles) ? filters.styles : []
    const nextPrices = Array.isArray(filters.prices) ? filters.prices : []
    const nextStatuses = Array.isArray(filters.statuses)
      ? filters.statuses
      : ALL_STATUS_VALUES

    setSelectedStyles(prev => (arraysEqual(prev, nextStyles) ? prev : [...nextStyles]))
    setSelectedPrices(prev => (arraysEqual(prev, nextPrices) ? prev : [...nextPrices]))
    setSelectedStatuses(prev => {
      const matches = prev.size === nextStatuses.length && nextStatuses.every(status => prev.has(status))
      return matches ? prev : new Set(nextStatuses)
    })
  }, [filters])

  const handleStyleSelect = style => {
    setSelectedStyles(prevStyles =>
      prevStyles.includes(style)
        ? prevStyles.filter(s => s !== style)
        : [...prevStyles, style]
    )
  }

  const handlePriceSelect = price => {
    setSelectedPrices(prevPrices =>
      prevPrices.includes(price)
        ? prevPrices.filter(p => p !== price)
        : [...prevPrices, price]
    )
  }

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
    setSelectedStatuses(new Set())
  }, [themeKey])

  return (
    <div className="sidebar-container" role="complementary">
      <section className="filter-section" aria-label={theme.copy.styleLabel}>
        <h3 className="filter-section__title">{theme.copy.styleLabel}</h3>
        <div className="filter-section__options">
          {stylesForTheme.map(style => {
            const isSelected = selectedStyles.includes(style)
            return (
              <button
                key={style}
                type="button"
                className={`filter-option${isSelected ? ' is-selected' : ''}`}
                onClick={() => handleStyleSelect(style)}
                aria-pressed={isSelected}
              >
                <span className="filter-option__label">{style}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="filter-section" aria-label="Price">
        <h3 className="filter-section__title">Price</h3>
        <div className="filter-section__options">
          {['$', '$$', '$$$', '$$$$'].map(price => {
            const isSelected = selectedPrices.includes(price)
            return (
              <button
                key={price}
                type="button"
                className={`filter-option${isSelected ? ' is-selected' : ''}`}
                onClick={() => handlePriceSelect(price)}
                aria-pressed={isSelected}
              >
                <span className="filter-option__label">{price}</span>
              </button>
            )
          })}
        </div>
      </section>

      <StatusFilter value={selectedStatuses} onChange={setSelectedStatuses} />
    </div>
  )
}

export default Sidebar
