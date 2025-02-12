// src/App.js
import Map from './map'; // Correctly importing the Map component
import Sidebar from './Sidebar';
import SuggestionForm from './SuggestionForm';
import AdminForm from './AdminForm'; // Import the Admin Form
import React, { useState } from 'react';
import { useCallback } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import pizzaPlaces from './data'; // Correctly importing pizzaPlaces data
import './App.css'; // Optional: if you have custom styles

function App() {
  const [filters, setFilters] = useState({ styles: [], prices: [] });

  // Called whenever filters change in Sidebar

  const handleFilterChange = useCallback((newFilters) => {
    setFilters(newFilters);
  }, []);

  // Filter pizza places based on selected styles & prices
  const filteredPizzaPlaces = pizzaPlaces.filter((place) => {
    const matchesStyle = filters.styles.length === 0 || filters.styles.includes(place.style);
    const matchesPrice = filters.prices.length === 0 || filters.prices.includes(place.price);
    return matchesStyle && matchesPrice;
  });

  return (
    <Router>
      <Routes>
        {/* Main Home Page */}
        <Route
          path="/"
          element={
            <div style={{ display: 'flex' }}>
              {/* Left Sidebar (Filters) */}
              <div style={{ width: '250px' }}>
                <Sidebar onFilterChange={handleFilterChange} />
              </div>

              {/* Main Content (Centered Map) */}
              <div style={{ flex: 1, textAlign: 'center' }}>
                <h1 className="app-heading">A Pizza Michigan</h1>
                <Map pizzaPlaces={filteredPizzaPlaces} />
              </div>

              {/* Right Sidebar (Suggestion Form) */}
              <div style={{ width: '250px' }}>
                <SuggestionForm />
              </div>
            </div>
          }
        />

        {/* Private Admin Page (No links to it) */}
        <Route
          path="/admin"
          element={
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", backgroundColor: "#222", color: "white" }}>
              <AdminForm />
            </div>
          }
        />
      </Routes>
    </Router>
  );
}

export default App;