import React, { useState } from 'react';
import './Sidebar.css';

const Sidebar = ({ onFilterChange }) => {
  // Allow multiple selections
  const [selectedStyles, setSelectedStyles] = useState([]);
  const [selectedPrices, setSelectedPrices] = useState([]);

  // Toggle selection for styles
  const handleStyleSelect = (style) => {
    setSelectedStyles((prevStyles) =>
      prevStyles.includes(style)
        ? prevStyles.filter((s) => s !== style) // Deselect if clicked again
        : [...prevStyles, style] // Select multiple
    );
  };

  // Toggle selection for prices
  const handlePriceSelect = (price) => {
    setSelectedPrices((prevPrices) =>
      prevPrices.includes(price)
        ? prevPrices.filter((p) => p !== price)
        : [...prevPrices, price]
    );
  };

  // Send updated filters to parent component (App.js)
  React.useEffect(() => {
    onFilterChange(filter);
  }, [filter, onFilterChange]);

  return (
    <div className="sidebar-container">
      <h2>Pizza Style</h2>
      <div className="sidebar-options">
        {['Traditional', 'New York', 'Chicago', 'Detroit', 'Neopolitan', 'Sicilian', 'Roman', 'California'].map((style) => (
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
  );
};

export default Sidebar;