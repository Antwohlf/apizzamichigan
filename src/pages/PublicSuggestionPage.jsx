import React, { useEffect } from 'react'
import { ArrowLeft } from 'lucide-react'
import SuggestionForm from '../SuggestionForm'
import { pizzaTheme } from '../themes/pizzaTheme'
import { tacoTheme } from '../themes/tacoTheme'
import '../Sidebar.css'
import '../styles/public-suggestion.css'

export default function PublicSuggestionPage({ entity = 'pizza' }) {
  const isPizza = entity !== 'taco'
  const theme = isPizza ? pizzaTheme : tacoTheme
  const homeRoute = isPizza ? '/' : '/tacos'
  const brandName = isPizza ? 'A Pizza Michigan' : 'TacoBoutMichigan'

  useEffect(() => {
    document.title = `Suggest a place | ${brandName}`
  }, [brandName])

  return (
    <div className={`public-suggestion public-suggestion--${isPizza ? 'pizza' : 'taco'}`}>
      <header className="public-suggestion__header">
        <a href={homeRoute}>
          <ArrowLeft size={17} aria-hidden="true" />
          Back to the map
        </a>
        <strong>{brandName}</strong>
      </header>

      <main className="public-suggestion__main">
        <div className="public-suggestion__intro">
          <span>{isPizza ? 'Pizza' : 'Taco'} recommendations</span>
          <h1>Suggest a place</h1>
          <p>Share a spot I should add to the map and what I should order there.</p>
        </div>

        <SuggestionForm
          theme={theme}
          isPizza={isPizza}
        />
      </main>
    </div>
  )
}
