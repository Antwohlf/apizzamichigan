const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434/api/generate'

export function normalizeUnicodeName(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizationPrompt(sourceName, candidateName) {
  return `You normalize restaurant names for identity matching. Translate or transliterate non-Latin names when you can do so reliably. Preserve the original names and do not invent a business identity.

Return JSON only:
{"source_normalized":"...","candidate_normalized":"...","relationship":"equivalent|different|uncertain","confidence":0.0,"evidence":["short explanation"]}

Rules:
- Keep brand and business words, removing only punctuation, legal suffixes, and meaningless location noise.
- For a translated or transliterated name, use the common English rendering.
- If there is not enough context to translate, keep the original and return uncertain.
- A normalized name is supporting evidence only; location, phone, website, and source identity are still required for a final match.

SOURCE NAME: ${normalizeUnicodeName(sourceName) || 'unknown'}
CANDIDATE NAME: ${normalizeUnicodeName(candidateName) || 'unknown'}`
}

function validate(result, sourceName, candidateName) {
  const relationship = ['equivalent', 'different', 'uncertain'].includes(result?.relationship)
    ? result.relationship
    : 'uncertain'
  return {
    source_normalized: normalizeUnicodeName(result?.source_normalized) || normalizeUnicodeName(sourceName),
    candidate_normalized: normalizeUnicodeName(result?.candidate_normalized) || normalizeUnicodeName(candidateName),
    relationship,
    confidence: Math.max(0, Math.min(1, Number(result?.confidence) || 0)),
    evidence: Array.isArray(result?.evidence) ? result.evidence.map(String).slice(0, 5) : [],
    decision_origin: 'ollama_name_normalizer',
  }
}

export async function normalizeNamesWithOllama(sourceName, candidateName, options = {}) {
  const model = options.model || process.env.NORMALIZER_MODEL || 'llama3.2:latest'
  const url = options.url || process.env.OLLAMA_URL || DEFAULT_OLLAMA_URL
  const timeoutMs = Number(options.timeoutMs || process.env.OLLAMA_TIMEOUT_MS || 120000)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: normalizationPrompt(sourceName, candidateName),
        format: 'json',
        stream: false,
        options: { temperature: 0, num_predict: 120 },
      }),
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}: ${text.slice(0, 200)}`)
    const payload = JSON.parse(text)
    return {
      model,
      elapsedMs: Number(payload.total_duration) ? Math.round(payload.total_duration / 1e6) : null,
      ...validate(JSON.parse(payload.response), sourceName, candidateName),
    }
  } finally {
    clearTimeout(timer)
  }
}
