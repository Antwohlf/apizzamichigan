import React, { useEffect, useMemo, useState } from 'react'
import { ArrowRight, RefreshCw } from 'lucide-react'
import { SOURCE_REVIEW_QUEUES } from './sourceReviewQueues'

const numberFormat = new Intl.NumberFormat()
const formatCount = value => value == null ? '—' : numberFormat.format(Number(value) || 0)

export default function AdminHomePanel({ entity, navigate }) {
  const [summary, setSummary] = useState(null)
  const [reviewStats, setReviewStats] = useState(null)
  const [suggestionCount, setSuggestionCount] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError('')
      const [summaryResult, reviewsResult, suggestionsResult] = await Promise.allSettled([
        fetch(`/api/admin/source-review-summary?entity=${entity}`, { credentials: 'include' }).then(async response => {
          if (!response.ok) throw new Error('Data review status is unavailable.')
          return response.json()
        }),
        fetch(`/api/admin/reviews?entity=${entity}`, { credentials: 'include' }).then(async response => {
          if (!response.ok) throw new Error('Review photo status is unavailable.')
          return response.json()
        }),
        fetch(`/api/admin/suggestions?entity=${entity}&status=pending`, { credentials: 'include' }).then(async response => {
          if (!response.ok) throw new Error('Suggestion status is unavailable.')
          return response.json()
        }),
      ])

      if (cancelled) return
      if (summaryResult.status === 'fulfilled') {
        setSummary(summaryResult.value?.data || null)
      } else {
        setSummary(null)
        setError(summaryResult.reason?.message || 'Some admin status could not be loaded.')
      }

      if (reviewsResult.status === 'fulfilled') {
        const rows = Array.isArray(reviewsResult.value?.data) ? reviewsResult.value.data : []
        setReviewStats({
          total: rows.length,
          needsPhotos: rows.filter(row => !Array.isArray(row.photos) || row.photos.length === 0).length,
        })
      } else {
        setReviewStats(null)
      }

      if (suggestionsResult.status === 'fulfilled') {
        setSuggestionCount(Array.isArray(suggestionsResult.value?.data) ? suggestionsResult.value.data.length : 0)
      } else {
        setSuggestionCount(null)
      }
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [entity, refreshKey])

  const tasks = useMemo(() => {
    const queueTasks = SOURCE_REVIEW_QUEUES.slice(0, 3).map(queue => ({
      id: queue.id,
      title: queue.homeTitle,
      detail: queue.detail,
      count: summary?.queues?.[queue.countKey],
      path: `/admin/reviews/data?entity=${entity}&queue=${queue.id}`,
    }))

    return [
      ...queueTasks,
      {
        id: 'basic-fields',
        title: 'Fill missing basic information',
        detail: 'See which Michigan and New York places still need an address, contact detail, style, or price.',
        count: summary?.basicFieldCoverage?.overall?.needsAttention,
        path: `/admin/reviews/system?entity=${entity}#basic-coverage`,
      },
      {
        id: 'import',
        title: 'Import approved places',
        detail: 'Run the final duplicate check before adding approved places to the local map.',
        count: summary?.queues?.approvedForImport,
        path: `/admin/reviews/system?entity=${entity}#approved-import`,
      },
      {
        id: 'lifecycle',
        title: 'Review business changes',
        detail: 'Check replacements and stale listings before they affect the map.',
        count: summary?.queues?.lifecycle,
        path: `/admin/reviews/system?entity=${entity}#lifecycle-quality`,
      },
      {
        id: 'suggestions',
        title: 'Review community suggestions',
        detail: 'Approve or reject places submitted by visitors.',
        count: suggestionCount,
        path: `/admin/reviews/suggestions?entity=${entity}`,
      },
      {
        id: 'photos',
        title: 'Add missing review photos',
        detail: reviewStats ? `${reviewStats.total} reviewed places in this dataset.` : 'Find reviewed places that still need photos.',
        count: reviewStats?.needsPhotos,
        path: `/admin/reviews/photos?entity=${entity}`,
      },
    ]
  }, [entity, reviewStats, suggestionCount, summary])

  return (
    <div className="admin-content">
      <section className="admin-section">
        <div className="admin-section-heading">
          <div>
            <h2>Work to do</h2>
            <p>Start with matching and duplicates before approving new places.</p>
          </div>
          <button
            className="admin-button admin-button--quiet admin-button--icon"
            type="button"
            onClick={() => setRefreshKey(value => value + 1)}
            disabled={loading}
            aria-label="Refresh admin status"
            title="Refresh admin status"
          >
            <RefreshCw size={17} aria-hidden="true" />
          </button>
        </div>

        {error ? <div className="admin-alert admin-alert--warning" role="status">{error}</div> : null}

        <ul className="admin-task-list">
          {tasks.map(task => (
            <li className="admin-task" key={task.id}>
              <div>
                <p className="admin-task__title">{task.title}</p>
                <p className="admin-task__detail">{task.detail}</p>
              </div>
              <div className="admin-task__count" aria-label={`${formatCount(task.count)} remaining`}>
                {formatCount(task.count)}
              </div>
              <button className="admin-button" type="button" onClick={() => navigate(task.path)}>
                Open
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="admin-section">
        <div className="admin-section-heading">
          <div>
            <h2>Data status</h2>
            <p>
              {summary?.available
                ? `${formatCount(summary.linkedPlaces)} places have source evidence attached.`
                : 'Local source data is not currently available.'}
            </p>
          </div>
          <button
            className="admin-button admin-button--quiet"
            type="button"
            onClick={() => navigate(`/admin/reviews/system?entity=${entity}`)}
          >
            View system
          </button>
        </div>
      </section>
    </div>
  )
}
