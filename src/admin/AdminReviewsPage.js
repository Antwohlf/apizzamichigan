import React, { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Camera,
  Database,
  Home,
  Lightbulb,
  Menu,
  PlusCircle,
  Settings,
  X,
} from 'lucide-react'
import AdminDataReviewPanel from './AdminDataReviewPanel'
import AdminHomePanel from './AdminHomePanel'
import AdminPhotosPanel from './AdminPhotosPanel'
import AdminSuggestionsPanel from './AdminSuggestionsPanel'
import AdminSystemPanel from './AdminSystemPanel'
import './AdminPortal.css'

const ENTITY_OPTIONS = [
  { label: 'Pizza', value: 'pizza' },
  { label: 'Taco', value: 'taco' },
]

const NAV_ITEMS = [
  { end: true, icon: Home, label: 'Home', path: '/admin/reviews' },
  { icon: Camera, label: 'Photos', path: '/admin/reviews/photos' },
  { icon: Lightbulb, label: 'Suggestions', path: '/admin/reviews/suggestions' },
  { icon: Database, label: 'Data review', path: '/admin/reviews/data' },
  { icon: Settings, label: 'System', path: '/admin/reviews/system' },
]

const VIEW_COPY = {
  home: ['Admin', 'Choose the next task and keep the map moving.'],
  photos: ['Review photos', 'Find a reviewed place and manage its photos.'],
  suggestions: ['Suggestions', 'Review places submitted by visitors.'],
  data: ['Data review', 'Compare one source record at a time.'],
  system: ['System', 'Imports, source status, and technical details.'],
}

const currentView = pathname => {
  if (pathname.endsWith('/photos')) return 'photos'
  if (pathname.endsWith('/suggestions')) return 'suggestions'
  if (pathname.endsWith('/data')) return 'data'
  if (pathname.endsWith('/system')) return 'system'
  return 'home'
}

function LoginScreen({ onLogin }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async event => {
    event.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError('')
    try {
      await onLogin(password)
      setPassword('')
    } catch (err) {
      setError('Access denied. Double-check the password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="admin-auth">
      <form className="admin-auth__panel" onSubmit={submit}>
        <div className="admin-brand-mark" aria-hidden="true">A</div>
        <h1>Admin access</h1>
        <p>Sign in to manage reviews and source data.</p>
        <label className="admin-field">
          <span>Password</span>
          <input
            autoFocus
            type="password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error ? <div className="admin-alert admin-alert--error" role="alert">{error}</div> : null}
        <button className="admin-button admin-button--primary admin-button--wide" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}

export default function AdminReviewsPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [authChecked, setAuthChecked] = useState(false)
  const [isAuthed, setIsAuthed] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const view = currentView(location.pathname)
  const entity = searchParams.get('entity') === 'taco' ? 'taco' : 'pizza'
  const [title, subtitle] = VIEW_COPY[view]

  useEffect(() => {
    let cancelled = false
    const checkAuth = async () => {
      try {
        const response = await fetch('/api/admin/check', { credentials: 'include' })
        if (!response.ok) throw new Error('Unauthorized')
        const payload = await response.json()
        if (!cancelled) setIsAuthed(Boolean(payload?.authorized))
      } catch (err) {
        if (!cancelled) setIsAuthed(false)
      } finally {
        if (!cancelled) setAuthChecked(true)
      }
    }
    checkAuth()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setNavOpen(false)
  }, [location.pathname])

  const login = async password => {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ password }),
    })
    if (!response.ok) throw new Error('Invalid password')
    setIsAuthed(true)
  }

  const updateEntity = nextEntity => {
    const next = new URLSearchParams(searchParams)
    next.set('entity', nextEntity)
    next.delete('id')
    setSearchParams(next)
  }

  const linkFor = path => `${path}?entity=${entity}`

  if (!authChecked) {
    return <main className="admin-auth"><p>Checking admin access…</p></main>
  }

  if (!isAuthed) {
    return <LoginScreen onLogin={login} />
  }

  return (
    <div className="admin-portal">
      <button
        className="admin-mobile-nav-button"
        type="button"
        onClick={() => setNavOpen(value => !value)}
        aria-label={navOpen ? 'Close admin navigation' : 'Open admin navigation'}
        aria-expanded={navOpen}
      >
        {navOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      <aside className={`admin-sidebar${navOpen ? ' is-open' : ''}`}>
        <NavLink className="admin-sidebar__brand" to={linkFor('/admin/reviews')}>
          <span className="admin-brand-mark" aria-hidden="true">A</span>
          <span>
            <strong>APizzaMichigan</strong>
            <small>Admin</small>
          </span>
        </NavLink>
        <nav aria-label="Admin sections">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.path}
                end={item.end}
                to={linkFor(item.path)}
                className={({ isActive }) => `admin-nav-link${isActive ? ' is-active' : ''}`}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            )
          })}
        </nav>
        <NavLink className="admin-nav-link admin-sidebar__add" to="/admin/submit">
          <PlusCircle size={18} aria-hidden="true" />
          <span>Add a place</span>
        </NavLink>
      </aside>

      {navOpen ? <button className="admin-nav-scrim" type="button" onClick={() => setNavOpen(false)} aria-label="Close navigation" /> : null}

      <main className="admin-main">
        <header className="admin-page-header">
          <div>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <label className="admin-dataset">
            <span>Dataset</span>
            <select value={entity} onChange={event => updateEntity(event.target.value)}>
              {ENTITY_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </header>

        {view === 'home' ? <AdminHomePanel entity={entity} navigate={navigate} /> : null}
        {view === 'photos' ? <AdminPhotosPanel entity={entity} /> : null}
        {view === 'suggestions' ? <AdminSuggestionsPanel entity={entity} /> : null}
        {view === 'data' ? <AdminDataReviewPanel entity={entity} /> : null}
        {view === 'system' ? <AdminSystemPanel entity={entity} /> : null}
      </main>
    </div>
  )
}
