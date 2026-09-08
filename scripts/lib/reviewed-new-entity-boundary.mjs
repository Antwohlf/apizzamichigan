export const REVIEWED_NEW_ENTITY_TARGETS = Object.freeze({
  pizza: Object.freeze({ canonicalTable: 'pizza_places' }),
  taco: Object.freeze({ canonicalTable: 'taco_places' }),
})

export function reviewedNewTarget(entity) {
  const target = REVIEWED_NEW_ENTITY_TARGETS[String(entity || '').trim().toLowerCase()]
  if (!target) throw new Error(`Unsupported reviewed-new entity: ${entity}`)
  return target
}

export function guardedPublishArgs(entity, placeIds) {
  const selectedEntity = String(entity || '').trim().toLowerCase()
  reviewedNewTarget(selectedEntity)
  if (!Array.isArray(placeIds) || !placeIds.length || placeIds.some(id => !Number.isInteger(Number(id)) || Number(id) <= 0)) {
    throw new Error('Guarded publish requires positive place IDs')
  }
  const workspace = '$' + '{FOOD_PIPELINE_WORKSPACE:?Set FOOD_PIPELINE_WORKSPACE to the private external runtime workspace}'
  const command = `cd "${workspace}" && node scripts/ops/guarded-supabase-sync.mjs --entity ${selectedEntity} --ids ${placeIds.join(',')} --batch ${placeIds.length} --max-batches 1 --insert-missing-reviewed-new --apply`
  throw new Error(`Guarded publication is externally owned; run on the pipeline host: ${command}`)
}
