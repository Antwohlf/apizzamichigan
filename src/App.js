// src/App.js
import React, { useState, useCallback, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'

import Map from './map'
import Sidebar from './Sidebar'
import SuggestionForm from './SuggestionForm'
import AdminForm from './AdminForm'
import FrozenPizzaDirectory from './FrozenPizzaDirectory'

import { supabase } from './supabaseClient'
import './App.css'

export default function App() {
  const [filters, setFilters] = useState({ styles: [], prices: [] })
  const [view, setView] = useState('map')

  const [pizzaPlaces, setPizzaPlaces] = useState([])
  const [mapLoading, setMapLoading] = useState(true)
  const [mapError, setMapError] = useState(null)

  const handleFilterChange = useCallback(f => setFilters(f), [])

  useEffect(() => {
    async function fetchPlaces() {
      setMapLoading(true)
      const { data, error } = await supabase
        .from('pizza_places')
        .select('*')
        .order('name', { ascending: true })

      if (error) setMapError(error)
      else setPizzaPlaces(data)

      setMapLoading(false)
    }
    fetchPlaces()
  }, [])

  const filteredPlaces = pizzaPlaces.filter(p =>
    (filters.styles.length === 0 || filters.styles.includes(p.style)) &&
    (filters.prices.length === 0 || filters.prices.includes(p.price))
  )

  return (
    <Router>
      <Routes>
        <Route
          path="/"
          element={
            <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
              {/* Left sidebar */}
              <div style={{ width: 250, overflowY: 'auto' }}>
                <Sidebar
                  filters={filters}
                  onFilterChange={handleFilterChange}
                  view={view}
                  setView={setView}
                />
              </div>

              {/* Main content */}
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  overflow: 'hidden',
                }}
              >
                <h1 className="app-heading" style={{ margin: 0, padding: '1rem 0' }}>
                  A Pizza Michigan
                </h1>

                <div
                  style={{
                    display: 'inline-flex',
                    margin: '1rem 0',
                    background: '#222',
                    borderRadius: 4,
                    overflow: 'hidden',
                  }}
                >
                  {['map', 'frozen'].map(mode => (
                    <button
                      key={mode}
                      onClick={() => setView(mode)}
                      style={{
                        padding: '0.5rem 1rem',
                        border: 'none',
                        cursor: 'pointer',
                        background: view === mode ? '#FFA500' : 'transparent',
                        color: view === mode ? '#FFF' : '#888',
                        fontWeight: view === mode ? 700 : 400,
                      }}
                    >
                      {mode === 'map' ? 'Pizza Map' : 'Frozen Pizzas'}
                    </button>
                  ))}
                </div>

                <div style={{ width: '100%', height: '600px', position: 'relative' }}>
                  {view === 'map' ? (
                    mapLoading ? (
                      <div
                        style={{
                          position: 'absolute',
                          top: '50%',
                          left: '50%',
                          transform: 'translate(-50%, -50%)',
                          color: '#FFA500',
                        }}
                      >
                        Loading map…
                      </div>
                    ) : mapError ? (
                      <div
                        style={{
                          position: 'absolute',
                          top: '50%',
                          left: '50%',
                          transform: 'translate(-50%, -50%)',
                          color: 'red',
                        }}
                      >
                        Error: {mapError.message}
                      </div>
                    ) : (
                      <Map pizzaPlaces={filteredPlaces} />
                    )
                  ) : (
                    <FrozenPizzaDirectory filters={filters} />
                  )}
                </div>
              </div>

              {/* Right sidebar */}
              <div style={{ width: 250, overflowY: 'auto' }}>
                <SuggestionForm />
              </div>
            </div>
          }
        />

        <Route
          path="/admin"
          element={
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100vh',
                backgroundColor: '#222',
                color: 'white',
              }}
            >
              <AdminForm />
            </div>
          }
        />
      </Routes>
    </Router>
  )
}