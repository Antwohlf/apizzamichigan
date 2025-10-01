import React, { useEffect, useState } from 'react'
import { useTheme } from './themes/ThemeProvider'
import { ThemeKeys } from './themes/siteTheme'
import { pizzaStyles } from './data/pizzaStyles'
import { TACO_TYPES } from './data/tacoTypes'
import './Sidebar.css'

const Sidebar = ({ onFilterChange, themeKey }) => {
  const { theme } = useTheme()

  // Allow multiple selections
  const [selectedStyles, setSelectedStyles] = useState([])
  const [selectedPrices, setSelectedPrices] = useState([])

  const stylesForTheme = themeKey === ThemeKeys.TACO ? TACO_TYPES : pizzaStyles

  // Toggle selection for styles
  const handleStyleSelect = (style) => {
    setSelectedStyles((prevStyles) =>
      prevStyles.includes(style)
        ? prevStyles.filter((s) => s !== style) // Deselect if clicked again
        : [...prevStyles, style] // Select multiple
    )
  }

  // Toggle selection for prices
  const handlePriceSelect = (price) => {
    setSelectedPrices((prevPrices) =>
      prevPrices.includes(price)
        ? prevPrices.filter((p) => p !== price)
        : [...prevPrices, price]
    )
  }

  // Combine both style and price filters into a single object, then send to parent
  useEffect(() => {
    const filter = {
      styles: selectedStyles,
      prices: selectedPrices,
    }
    onFilterChange(filter)
  }, [selectedStyles, selectedPrices, onFilterChange])

  useEffect(() => {
    setSelectedStyles([])
    setSelectedPrices([])
  }, [themeKey])

  return (
    <div className="sidebar-container">
      <h2>{theme.copy.styleLabel}</h2>
      <div className="sidebar-options">
        {stylesForTheme.map((style) => (
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
        {['$', '$$', '$$$'].map((price) => (
          <button
            key={price}
            className={`sidebar-btn ${selectedPrices.includes(price) ? 'active' : ''}`}
            onClick={() => handlePriceSelect(price)}
          >
            {price}
          </button>
        ))}
      </div>
    </div>
  )
}

export default Sidebar
