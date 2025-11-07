import React, { useEffect, useMemo, useState } from 'react'
import InlineSpinner from '../components/ui/InlineSpinner'
import { supabase } from '../supabaseClient'

const CATEGORY_SECTIONS = [
  { key: 'tacos', label: 'Tacos', tokens: ['taco', 'birria', 'pastor', 'carnitas', 'barbacoa'] },
  { key: 'enchiladas', label: 'Enchiladas', tokens: ['enchilada'] },
  { key: 'tamales', label: 'Tamales', tokens: ['tamale', 'tamales'] },
  { key: 'nachos', label: 'Nachos', tokens: ['nacho'] },
  { key: 'salsas', label: 'Salsas & Sauces', tokens: ['salsa', 'sauce', 'mole', 'marinade'] },
  { key: 'sides', label: 'Snacks & Sides', tokens: ['dip', 'queso', 'side', 'beans', 'rice', 'elote'] },
  { key: 'drinks', label: 'Drinks & Treats', tokens: ['horchata', 'agua fresca', 'margarita', 'drink', 'dessert', 'churro'] },
]

const normalizeArray = value => {
  if (Array.isArray(value)) {
    return value.filter(Boolean).map(entry => String(entry).trim())
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean)
  }
  return []
}

const buildSlug = (slug, title) => {
  if (slug) return slug
  if (!title) return null
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const getRecipeOfDay = recipes => {
  if (!recipes.length) return null
  const today = new Date()
  const dateSeed = Number(
    `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
  )
  const index = dateSeed % recipes.length
  return recipes[index]
}

const formatDate = iso => {
  if (!iso) return ''
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const RecipeCard = ({ recipe, highlight = false }) => {
  if (!recipe) return null
  const maxIngredients = highlight ? 6 : 4
  const shownIngredients = recipe.ingredients.slice(0, maxIngredients)
  const remaining = recipe.ingredients.length - shownIngredients.length

  return (
    <article className={`taco-recipe-card${highlight ? ' taco-recipe-card--highlight golden-glow' : ''}`}>
      <div className="taco-recipe-card__media">
        {recipe.image_url ? (
          <img src={recipe.image_url} alt="" loading="lazy" decoding="async" />
        ) : (
          <div className="taco-recipe-card__placeholder">Photo drop coming soon</div>
        )}
        {highlight && <span className="taco-recipe-card__badge">Recipe of the Day</span>}
      </div>

      <div className="taco-recipe-card__body">
        <div className="taco-recipe-card__meta">
          <span>{formatDate(recipe.created_at)}</span>
          {recipe.type ? <span>{recipe.type}</span> : null}
        </div>
        <h3>{recipe.title}</h3>
        {recipe.summary ? <p className="taco-recipe-card__summary">{recipe.summary}</p> : null}
        {recipe.tags.length > 0 && (
          <div className="taco-recipe-card__tags">
            {recipe.tags.map(tag => (
              <span key={`${recipe.id}-tag-${tag}`}>{tag}</span>
            ))}
          </div>
        )}
        {shownIngredients.length > 0 && (
          <div className="taco-recipe-card__ingredients">
            <h4>Pantry</h4>
            <ul>
              {shownIngredients.map((ingredient, idx) => (
                <li key={`${recipe.id}-ing-${idx}`}>{ingredient}</li>
              ))}
            </ul>
            {remaining > 0 ? <p className="taco-recipe-card__more">+{remaining} more ingredients</p> : null}
          </div>
        )}
        {recipe.instructions ? (
          <p className="taco-recipe-card__instructions">
            {recipe.instructions.length > 200 ? `${recipe.instructions.slice(0, 200)}…` : recipe.instructions}
          </p>
        ) : null}
      </div>
    </article>
  )
}

export default function TacoRecipesPanel() {
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState([])
  const [selectedType, setSelectedType] = useState('all')

  useEffect(() => {
    let isMounted = true

    async function fetchRecipes() {
      setLoading(true)
      const { data, error } = await supabase
        .from('recipes')
        .select('*')
        .eq('published', true)
        .order('created_at', { ascending: false })

      if (!isMounted) return

      if (error) {
        console.error('[recipes] failed to load', error)
        setRecipes([])
        setError(error)
      } else {
        const normalized = (data || []).map(entry => {
          const tags = normalizeArray(entry.tags)
          const tagsLower = tags.map(tag => tag.toLowerCase())
          const ingredients = normalizeArray(entry.ingredients)
          const type =
            (typeof entry.type === 'string' && entry.type.trim()) ||
            (typeof entry.recipe_type === 'string' && entry.recipe_type.trim()) ||
            null
          const typeLower = type ? type.toLowerCase() : ''
          const titleLower = (entry.title || '').toLowerCase()

          const primaryCategory =
            CATEGORY_SECTIONS.find(section =>
              section.tokens.some(token => tagsLower.includes(token) || typeLower === token || titleLower.includes(token))
            )?.key || 'other'
          return {
            ...entry,
            tags,
            tagsLower,
            ingredients,
            summary: entry.summary || '',
            instructions: entry.instructions || '',
            slug: buildSlug(entry.slug, entry.title),
            type,
            categoryKey: primaryCategory,
          }
        })
        setRecipes(normalized)
        setError(null)
      }
      setLoading(false)
    }

    fetchRecipes()
    return () => {
      isMounted = false
    }
  }, [])

  const recipeOfTheDay = useMemo(() => getRecipeOfDay(recipes), [recipes])

  const tagOptions = useMemo(() => {
    const tagSet = new Set()
    recipes.forEach(recipe => recipe.tags.forEach(tag => tagSet.add(tag)))
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b))
  }, [recipes])

  const typeOptions = useMemo(() => {
    const typeSet = new Set(recipes.map(recipe => (recipe.type || '').trim()).filter(Boolean))
    return Array.from(typeSet).sort((a, b) => a.localeCompare(b))
  }, [recipes])

  const filteredRecipes = useMemo(() => {
    if (!recipes.length) return []
    const query = searchQuery.trim().toLowerCase()

    return recipes.filter(recipe => {
      const matchesSearch =
        !query ||
        recipe.title?.toLowerCase().includes(query) ||
        recipe.summary?.toLowerCase().includes(query) ||
        recipe.instructions?.toLowerCase().includes(query) ||
        recipe.tagsLower?.some(tag => tag.includes(query))

      const matchesTags =
        selectedTags.length === 0 ||
        selectedTags.every(tag => recipe.tagsLower?.includes(tag.toLowerCase()))

      const matchesType =
        selectedType === 'all' ||
        (recipe.type && recipe.type.toLowerCase() === selectedType.toLowerCase())

      return matchesSearch && matchesTags && matchesType
    })
  }, [recipes, searchQuery, selectedTags, selectedType])

  const sectionedRecipes = useMemo(() => {
    if (!filteredRecipes.length) return { sections: [], remaining: [] }

    const sections = CATEGORY_SECTIONS.map(section => ({
      ...section,
      recipes: filteredRecipes.filter(recipe => recipe.categoryKey === section.key),
    })).filter(section => section.recipes.length > 0)

    const categorizedKeys = new Set(sections.map(section => section.key))
    const remaining = filteredRecipes.filter(recipe => {
      if (!recipe.categoryKey) return true
      return !categorizedKeys.has(recipe.categoryKey) && recipe.categoryKey !== 'other'
    })

    const otherRecipes = filteredRecipes.filter(recipe => recipe.categoryKey === 'other')
    return {
      sections,
      remaining: [...remaining, ...otherRecipes],
    }
  }, [filteredRecipes])

  const handleTagToggle = tag => {
    setSelectedTags(prev => (prev.includes(tag) ? prev.filter(item => item !== tag) : [...prev, tag]))
  }

  return (
    <div className="taco-recipes">
      <header className="taco-recipes__hero">
        <p className="eyebrow">Kitchen Drop</p>
        <h2>Recipes</h2>
        <p>Michigan taco lovers’ kitchen—authentic, fast, and seasonal.</p>
      </header>

      {recipeOfTheDay && !loading && !error ? (
        <section>
          <RecipeCard recipe={recipeOfTheDay} highlight />
        </section>
      ) : null}

      <section className="taco-recipes__controls" aria-label="Recipe filters">
        <label className="taco-recipes__field">
          <span>Search</span>
          <input
            type="search"
            placeholder="Try queso, birria, tamales…"
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
          />
        </label>

        {typeOptions.length > 0 && (
          <label className="taco-recipes__field">
            <span>Type</span>
            <select value={selectedType} onChange={event => setSelectedType(event.target.value)}>
              <option value="all">All</option>
              {typeOptions.map(type => (
                <option value={type.toLowerCase()} key={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      {tagOptions.length > 0 && (
        <div className="taco-recipes__tags">
          {tagOptions.map(tag => {
            const isActive = selectedTags.includes(tag)
            return (
              <button
                key={tag}
                type="button"
                className={`taco-recipes__tag${isActive ? ' is-active' : ''}`}
                onClick={() => handleTagToggle(tag)}
                aria-pressed={isActive}
              >
                {tag}
              </button>
            )
          })}
        </div>
      )}

      {loading && (
        <div className="taco-recipes__empty">
          <InlineSpinner variant="taco" label="Loading recipes" />
          <p>Loading the recipe board…</p>
        </div>
      )}

      {!loading && error && (
        <div className="taco-recipes__empty">
          <p>Couldn’t fetch recipes right now. Please try again later.</p>
        </div>
      )}

      {!loading && !error && filteredRecipes.length === 0 && (
        <div className="taco-recipes__empty">
          <p>No recipes match those filters yet.</p>
        </div>
      )}

      {!loading && !error && filteredRecipes.length > 0 && (
        <>
          {sectionedRecipes.sections.length > 1 && (
            <nav className="taco-recipes__section-nav" aria-label="Recipe subsections">
              {sectionedRecipes.sections.map(section => (
                <a key={section.key} href={`#recipes-${section.key}`}>
                  {section.label}
                </a>
              ))}
              {sectionedRecipes.remaining.length > 0 && <a href="#recipes-more">More ideas</a>}
            </nav>
          )}

          <div className="taco-recipes__sections">
            {sectionedRecipes.sections.map(section => (
              <section key={section.key} id={`recipes-${section.key}`} className="taco-recipes__section">
                <div className="taco-recipes__section-header">
                  <h3>{section.label}</h3>
                  <span>{section.recipes.length} recipes</span>
                </div>
                <div className="taco-recipes__section-grid">
                  {section.recipes.map(recipe => (
                    <RecipeCard
                      key={recipe.id || recipe.slug || recipe.title}
                      recipe={recipe}
                      highlight={Boolean(recipeOfTheDay && recipe.id === recipeOfTheDay.id)}
                    />
                  ))}
                </div>
              </section>
            ))}

            {sectionedRecipes.remaining.length > 0 && (
              <section id="recipes-more" className="taco-recipes__section taco-recipes__section--secondary">
                <div className="taco-recipes__section-header">
                  <h3>More Kitchen Experiments</h3>
                  <span>{sectionedRecipes.remaining.length} recipes</span>
                </div>
                <div className="taco-recipes__section-grid">
                  {sectionedRecipes.remaining.map(recipe => (
                    <RecipeCard
                      key={recipe.id || recipe.slug || recipe.title}
                      recipe={recipe}
                      highlight={Boolean(recipeOfTheDay && recipe.id === recipeOfTheDay.id)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  )
}
