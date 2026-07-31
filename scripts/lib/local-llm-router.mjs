/**
 * Decide how a local identity candidate should be handled before calling an
 * LLM. This module is deliberately side-effect free so it can be used by
 * adapters, the admin preview, and fixture tests.
 */

export const MODEL_ROLES = Object.freeze({
  fast: 'fast',
  judge: 'judge',
  human: 'human',
})

export function routeIdentityCandidate(evidence = {}, options = {}) {
  const score = Number(evidence.score || 0)
  const maxScore = Number(evidence.maxScore || 5)
  const agreement = evidence.modelAgreement !== false
  const replacementRisk = evidence.replacementRisk === true
  const hasLocation = evidence.location === true
  const hasStrongIdentity = evidence.phone === true || evidence.website === true || evidence.sourceIdentity === true
  const threshold = Number(options.autoAcceptScore || 3)

  if (replacementRisk) {
    return {
      route: MODEL_ROLES.human,
      reason: 'Possible business replacement; preserve the old record and require an explicit lifecycle decision.',
    }
  }

  if (score >= threshold && hasLocation && hasStrongIdentity && agreement) {
    return {
      route: 'auto_accept',
      reason: 'Location and a strong identity signal agree with the model assessment.',
    }
  }

  if (score >= 2 && hasLocation) {
    return {
      route: MODEL_ROLES.judge,
      reason: `Borderline identity match (${score}/${maxScore}); send to the slower judge model.`,
    }
  }

  return {
    route: MODEL_ROLES.human,
    reason: 'Insufficient corroborating identity evidence.',
  }
}

export function modelPlan({ primary = 'llama3.2:latest', judge = 'qwen2.5:3b' } = {}) {
  return {
    fast: { role: MODEL_ROLES.fast, model: primary, purpose: 'Normalize names and assess straightforward candidates.' },
    judge: { role: MODEL_ROLES.judge, model: judge, purpose: 'Review borderline candidates and explain conflicts.' },
    human: { role: MODEL_ROLES.human, model: null, purpose: 'Handle replacements, identity conflicts, and missing evidence.' },
  }
}
