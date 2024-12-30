// src/App.js
import React from 'react';
import Map from './map'; // Correctly importing the Map component
import pizzaPlaces from './data'; // Correctly importing pizzaPlaces data
import './App.css'; // Optional: if you have custom styles


function App() {
  return (
    <div className="app-container">
      <h1 className="app-heading">A Pizza Michigan</h1>
      <Map pizzaPlaces={pizzaPlaces} />
    </div>
  );
}

export default App;
