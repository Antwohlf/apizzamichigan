import React, { useEffect, useMemo, useState } from 'react'
import { ArrowRight, RefreshCw } from 'lucide-react'
import { SOURCE_REVIEW_QUEUES } from './sourceReviewQueues'

const numberFormat = new Intl.NumberFormat()
const formatCount = value => value == null ? '—' : numberFormat.format(Number(value) || 0)
const formatUpdatedAt = value => {
  if (!value) return 'No source update recorded yet.'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Source update time unavailable.'
  return `Last refreshed ${new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)}.`
}

export default function AdminHomePanel({ entity, navigate }) {
  const [summary, setSummary] = useState(null)
  const [suggestionCount, setSuggestionCount] = useState(null)
  const [syncReadiness, setSyncReadiness] = useState(null)
  const [pipelineStatus, setPipelineStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError('')
      const [summaryResult, suggestionsResult, syncResult, pipelineResult] = await Promise.allSettled([
        fetch(`/api/admin/source-review-summary?entity=${entity}`, { credentials: 'include' }).then(async response => {
          if (!response.ok) throw new Error('Data review status is unavailable.')
          return response.json()
        }),
        fetch(`/api/admin/suggestions?entity=${entity}&status=pending&count=only`, { credentials: 'include' }).then(async response => {
          if (!response.ok) throw new Error('Suggestion status is unavailable.')
          return response.json()
        }),
        fetch(`/api/admin/supabase-sync-readiness?entity=${entity}`, { credentials: 'include' }).then(async response => {
          if (!response.ok) throw new Error('Publishing status is unavailable.')
          return response.json()
        }),
        fetch(`/api/admin/pipeline-status?entity=${entity}`, { credentials: 'include' }).then(async response => {
          if (!response.ok) throw new Error('Pipeline status is unavailable.')
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

      if (suggestionsResult.status === 'fulfilled') {
        setSuggestionCount(Number(suggestionsResult.value?.count) || 0)
      } else {
        setSuggestionCount(null)
      }
      if (syncResult.status === 'fulfilled') {
        setSyncReadiness(syncResult.value?.data || null)
      } else {
        setSyncReadiness(null)
      }
      if (pipelineResult.status === 'fulfilled') {
        setPipelineStatus(pipelineResult.value?.data || null)
      } else {
        setPipelineStatus(null)
      }
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [entity, refreshKey])

  const tasks = useMemo(() => {
    const lifecycleCount = summary?.lifecycle
      ? Number(summary.lifecycle.replacements || 0) + Number(summary.lifecycle.closedSignals || 0)
      : summary?.queues?.lifecycle
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
        detail: 'See which places in the configured operating regions still need an address, contact detail, style, or price.',
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
        detail: 'Check possible replacements and closure signals before they affect the map.',
        count: lifecycleCount,
        path: `/admin/reviews/system?entity=${entity}#lifecycle-quality`,
      },
      {
        id: 'source-freshness',
        title: 'Review outdated source data',
        detail: 'See which places rely on evidence that needs a fresh source check.',
        count: summary?.lifecycle?.stalePlaces,
        path: `/admin/reviews/system?entity=${entity}#lifecycle-quality`,
      },
      {
        id: 'source-conflicts',
        title: 'Resolve source conflicts',
        detail: 'Inspect accepted source records that overlap another record from the same source.',
        count: summary?.sourceQuality?.acceptedCoordinateConflicts,
        path: `/admin/reviews/system?entity=${entity}#approved-import`,
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
        detail: 'Find reviewed places that still need photos.',
        count: null,
        path: `/admin/reviews/photos?entity=${entity}`,
      },
    ]
  }, [entity, suggestionCount, summary])

  const visibleTasks = useMemo(() => tasks.filter(task => (
    task.count == null || Number(task.count) > 0
  )), [tasks])

  const pendingPublishCount = Math.max(
    Number(syncReadiness?.pendingAfterCheckpoint) || 0,
    Number(syncReadiness?.wouldUpdate) || 0,
  )
  const protectedFieldConflicts = Number(syncReadiness?.protectedFieldConflicts) || 0
  const hasPendingPublishCounts = Boolean(syncReadiness && [
    'pendingAfterCheckpoint',
    'wouldUpdate',
    'protectedFieldConflicts',
  ].some(field => Object.prototype.hasOwnProperty.call(syncReadiness, field)))

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

        {visibleTasks.length ? (
          <ul className="admin-task-list">
            {visibleTasks.map(task => (
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
        ) : (
          <div className="admin-empty-state" role="status">
            <strong>Nothing needs attention right now.</strong>
            <p>Refresh later or open System to inspect source and publishing status.</p>
          </div>
        )}
      </section>

      <section className="admin-section">
        <div className="admin-section-heading">
          <div>
            <h2>Data status</h2>
            <p>
              {summary?.available
                ? `${formatCount(summary.linkedPlaces)} places have source evidence attached across ${formatCount(summary.sourceRows)} source records.`
                : 'Local source data is not currently available.'}
            </p>
            {summary?.available ? <p className="admin-system-status__meta">{formatUpdatedAt(summary.latestSourceUpdate)}</p> : null}
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

      <section className="admin-system-status admin-home-publishing" aria-labelledby="home-publishing-heading">
          <div>
            <p className="admin-eyebrow">Public map</p>
            <h2 id="home-publishing-heading">Publishing status</h2>
            <p>{syncReadiness?.detail || 'Checking whether local changes are ready to reach the public map.'}</p>
            {hasPendingPublishCounts ? (
              <p className="admin-system-status__meta">
                {pendingPublishCount
                  ? `${formatCount(pendingPublishCount)} local update${pendingPublishCount === 1 ? '' : 's'} waiting to publish.`
                  : 'No local updates are waiting to publish.'}
                {protectedFieldConflicts
                  ? ` ${formatCount(protectedFieldConflicts)} protected-field conflict${protectedFieldConflicts === 1 ? '' : 's'} need review.`
                  : ''}
              </p>
            ) : null}
          </div>
        <div className="admin-home-publishing__actions">
          <strong className={`admin-system-status__state admin-system-status__state--${syncReadiness?.state || 'unknown'}`}>
            {syncReadiness?.label || 'Checking…'}
          </strong>
          <button
            className="admin-button admin-button--quiet"
            type="button"
            onClick={() => navigate(`/admin/reviews/system?entity=${entity}`)}
          >
            View details
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </section>

      <section className="admin-system-status admin-home-publishing" aria-labelledby="home-pipeline-heading">
        <div>
          <p className="admin-eyebrow">Operations</p>
          <h2 id="home-pipeline-heading">Pipeline status</h2>
          <p>{pipelineStatus?.detail || 'Waiting for the latest read-only pipeline check.'}</p>
        </div>
        <div className="admin-home-publishing__actions">
          <strong className={`admin-system-status__state admin-system-status__state--${pipelineStatus?.state || 'unknown'}`}>
            {pipelineStatus?.label || 'Not checked'}
          </strong>
          <button
            className="admin-button admin-button--quiet"
            type="button"
            onClick={() => navigate(`/admin/reviews/system?entity=${entity}#pipeline-status`)}
          >
            View details
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>
  )
}
