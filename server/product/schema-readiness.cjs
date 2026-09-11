// Schema changes belong to operator-run migrations, never an HTTP request.
async function requireReviewHistory(client) {
  try {
    await client.query(`SELECT id, review_queue_id, entity_type, source, source_id,
      previous_review_kind, previous_status, previous_decision, previous_canonical_place_id,
      review_kind, status, decision, canonical_place_id, action, reviewer_notes,
      reviewed_by, canonical_before, canonical_after, created_at
      FROM public.source_review_decision_history LIMIT 0`)
  } catch (cause) {
    const error = new Error('Review history schema is unavailable. Apply source-review-decision-history-schema.sql as the database owner before starting the admin API.')
    error.status = 503
    error.cause = cause
    throw error
  }
}

async function requireLifecycleHistory(client) {
  try {
    await client.query(`SELECT id, entity_type, place_id, previous_lifecycle_status,
      previous_replaced_by_id, lifecycle_status, replaced_by_id, reason, changed_by,
      created_at FROM public.place_lifecycle_history LIMIT 0`)
  } catch (cause) {
    const error = new Error('Lifecycle history schema is unavailable. Apply local-lifecycle-history-migration.sql as the database owner before starting the admin API.')
    error.status = 503
    error.cause = cause
    throw error
  }
}

module.exports = { requireReviewHistory, requireLifecycleHistory }
