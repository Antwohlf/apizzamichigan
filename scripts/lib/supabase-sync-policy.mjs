export const OVERWRITE_COLS = [
  'created_at',
  'updated_at',
  'enrichment_status',
  'last_enriched_at',
  'enrichment_agent',
  'enrichment_run_id',
  'address_source',
  'website_url',
  'menu_url',
  'phone',
  'email',
  'instagram_url',
  'facebook_url',
  'twitter_url',
  'whatsapp',
  'hours',
  'scrape_method',
  'scrape_notes',
  'delivery',
  'takeaway',
  'drive_through',
  'outdoor_seating',
  'indoor_seating',
  'wheelchair',
  'brand',
  'brand_wikidata',
  'operator',
  'operator_wikidata',
  'osm_tags',
  'osm_last_fetched_at',
  'osm_fetch_status',
  'osm_fetch_error',
  'menu_data',
  'menu_parse_confidence',
  'menu_parse_notes',
  'menu_last_parsed_at',
];

export const FILL_IF_NULL_COLS = [
  'style',
  'price',
  'price_range',
  'style_confidence',
];

export const QA_DEFAULT_COLS = [
  'qa_status',
  'qa_schema_version',
];

export const LOCAL_CONTEXT_COLS = [
  'id',
  'name',
  'state',
  'google_place_id',
];

export const LOCAL_SYNC_COLS = [
  ...LOCAL_CONTEXT_COLS,
  ...FILL_IF_NULL_COLS,
  ...OVERWRITE_COLS,
];

export const SUPABASE_SYNC_SELECT_COLS = [
  'id',
  ...FILL_IF_NULL_COLS,
  ...QA_DEFAULT_COLS,
];

export const LOCAL_SYNC_VALUE_COLS = [
  ...FILL_IF_NULL_COLS,
  ...OVERWRITE_COLS,
];

export function normalizeSyncSelectorOptions(options = {}) {
  const checkpointAfter = options.checkpointAfter || null;
  const checkpointMode = Boolean(options.checkpointMode || checkpointAfter);
  return {
    startAfter: Number.isFinite(options.startAfter) ? options.startAfter : 0,
    batch: Number.isFinite(options.batch) && options.batch > 0 ? options.batch : 500,
    changedSinceHours: options.changedSinceHours ?? null,
    onlyClassified: Boolean(options.onlyClassified),
    checkpointMode,
    checkpointAfter,
  };
}

export function localSyncSelect(options = {}) {
  const selector = normalizeSyncSelectorOptions(options);
  const params = [];
  const filters = [
    `(
            ${LOCAL_SYNC_VALUE_COLS.map(col => `${col} is not null`).join('\n            or ')}
          )`,
  ];

  if (selector.checkpointMode) {
    filters.push('last_enriched_at is not null');
  } else {
    params.push(selector.startAfter);
    filters.unshift(`id > $${params.length}`);
  }

  if (selector.changedSinceHours !== null) {
    params.push(String(selector.changedSinceHours));
    filters.push(`last_enriched_at >= now() - ($${params.length}::text || ' hours')::interval`);
  }

  if (selector.checkpointAfter) {
    params.push(selector.checkpointAfter.lastEnrichedAt);
    const tsParam = params.length;
    params.push(selector.checkpointAfter.id);
    const idParam = params.length;
    filters.push(`(last_enriched_at, id) > ($${tsParam}::timestamptz, $${idParam}::int)`);
  }

  if (selector.onlyClassified) {
    filters.push('(style is not null or price is not null or price_range is not null or style_confidence is not null)');
  }

  params.push(selector.batch);
  const limitParam = params.length;
  const orderBy = selector.checkpointMode ? 'last_enriched_at asc, id asc' : 'id asc';

  const sql = `
        select
          ${LOCAL_SYNC_COLS.join(',\n          ')}
        from pizza_places
        where ${filters.join('\n          and ')}
        order by ${orderBy}
        limit $${limitParam}
      `;
  return { sql, params };
}

export function localSyncSelectQuery(options = {}) {
  return localSyncSelect(options).sql;
}

export function localSyncSelectSql(options = {}) {
  return localSyncSelectQuery(options);
}

export function localSyncSelectParams(options = {}) {
  return localSyncSelect(options).params;
}

export function localSyncSelectQueryParams(options = {}) {
  return localSyncSelect(options).params;
}

export function buildSupabasePayload(local, current, { nowIso = new Date().toISOString() } = {}) {
  if (!current) return null;

  const payload = { id: local.id };

  for (const col of OVERWRITE_COLS) {
    const value = local[col];
    if (value !== null && value !== undefined) payload[col] = value;
  }

  for (const col of FILL_IF_NULL_COLS) {
    const localValue = local[col];
    const supabaseValue = current[col];
    if ((supabaseValue === null || supabaseValue === undefined) && localValue !== null && localValue !== undefined) {
      payload[col] = localValue;
    }
  }

  if (current.qa_status == null) payload.qa_status = 'unreviewed';
  if (current.qa_schema_version == null) payload.qa_schema_version = 1;

  if (Object.keys(payload).length <= 1) return null;
  if (!('updated_at' in payload)) payload.updated_at = nowIso;
  return payload;
}

export function protectedFieldSkips(local, current) {
  if (!current) return [];

  return FILL_IF_NULL_COLS
    .filter(col => local[col] !== null && local[col] !== undefined && current[col] !== null && current[col] !== undefined)
    .map(col => ({
      column: col,
      local: local[col],
      supabase: current[col],
      differs: local[col] !== current[col],
    }));
}
