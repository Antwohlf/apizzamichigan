import React, { useEffect, useRef, useState } from 'react'
import { useTheme } from './themes/ThemeProvider'
import { entityConfigForTheme } from './config/entityConfig'
import { StatusFilter } from './sidebar/StatusFilter'
import './Sidebar.css'

const ALL_STATUS_VALUES = ['visited', 'unvisited', 'golden']

const arraysEqual = (a = [], b = []) =>
  a.length === b.length && a.every((value, index) => value === b[index])

const Sidebar = ({
  onFilterChange,
  themeKey,
  filters = {},
  showClusterCounts = true,
  onClusterCountsToggle,
  showAnthonysVisits = false,
  onAnthonysVisitsToggle,
  showAnthonysPicks = false,
  onAnthonysPicksToggle,
  anthonysPicksLabel = "Anthony's Picks",
  anthonysPicksMinimumRating = 8,
  showHistorical = false,
  onHistoricalToggle,
}) => {
  const { theme } = useTheme()

  const [selectedStyles, setSelectedStyles] = useState(() => (
    Array.isArray(filters?.styles) ? filters.styles : []
  ))
  const [selectedPrices, setSelectedPrices] = useState(() => (
    Array.isArray(filters?.prices) ? filters.prices : []
  ))
  const [selectedStatuses, setSelectedStatuses] = useState(() => new Set(
    Array.isArray(filters?.statuses) ? filters.statuses : ALL_STATUS_VALUES
  ))
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const hasMountedRef = useRef(false)

  const stylesForTheme = entityConfigForTheme(themeKey).styleOptions

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
    if (!hasMountedRef.current) {
      hasMountedRef.current = true
      return
    }
    setSelectedStyles([])
    setSelectedPrices([])
    setSelectedStatuses(new Set())
  }, [themeKey])

  const selectedFilterCount = selectedStyles.length + selectedPrices.length + (
    selectedStatuses.size < ALL_STATUS_VALUES.length ? 1 : 0
  ) + (showHistorical ? 1 : 0)

  return (
    <div className="sidebar-container">
      <button
        type="button"
        className="mobile-filter-toggle"
        aria-expanded={mobileFiltersOpen}
        aria-controls="map-filters"
        onClick={() => setMobileFiltersOpen(open => !open)}
      >
        <span>Filters</span>
        {selectedFilterCount > 0 && <span className="mobile-filter-toggle__count">{selectedFilterCount}</span>}
        <span aria-hidden="true">{mobileFiltersOpen ? '\u2212' : '+'}</span>
      </button>
      <div
        id="map-filters"
        className={`sidebar-filters${mobileFiltersOpen ? ' is-open' : ''}`}
        role="region"
        aria-label="Map filters"
      >
      <section className="filter-section" aria-label={theme.copy.styleLabel}>
        <h2 className="filter-section__title">{theme.copy.styleLabel}</h2>
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
        <h2 className="filter-section__title">Price</h2>
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

      <section className="filter-section filter-section--picks" aria-label={anthonysPicksLabel}>
        <h2 className="filter-section__title">{anthonysPicksLabel}</h2>
        <label className={`filter-checkbox${showAnthonysPicks ? ' is-selected' : ''}`}>
          <input
            type="checkbox"
            checked={showAnthonysPicks}
            onChange={e => onAnthonysPicksToggle?.(e.target.checked)}
            aria-label={anthonysPicksLabel}
          />
          <span>
            <strong>Rated {anthonysPicksMinimumRating} or higher</strong>
            <small>Anthony&apos;s top-rated places</small>
          </span>
        </label>
      </section>

      <section className="filter-section" aria-label="Historical places">
        <h2 className="filter-section__title">Historical places</h2>
        <label className={`filter-checkbox${showHistorical ? ' is-selected' : ''}`}>
          <input
            type="checkbox"
            checked={showHistorical}
            onChange={event => onHistoricalToggle?.(event.target.checked)}
            aria-label="Include historical places"
          />
          <span>
            <strong>Include closed and replaced</strong>
            <small>Show places with map history</small>
          </span>
        </label>
      </section>

      <section className="filter-section" aria-label="Map Settings">
        <h2 className="filter-section__title">Map Settings</h2>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.5rem 0',
            cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: '0.9rem', color: 'var(--app-text)' }}>Show cluster counts</span>
          <input
            type="checkbox"
            checked={showClusterCounts}
            onChange={e => onClusterCountsToggle?.(e.target.checked)}
            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
          />
        </label>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.5rem 0',
            cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: '0.9rem', color: 'var(--app-text)' }}>Anthony&apos;s Visits</span>
          <input
            type="checkbox"
            checked={showAnthonysVisits}
            onChange={e => onAnthonysVisitsToggle?.(e.target.checked)}
            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
          />
        </label>
      </section>
      </div>
    </div>
  )
}

export default Sidebar
