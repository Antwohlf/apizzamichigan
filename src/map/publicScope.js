export function filterPublicAggregates(aggregates = [], { showAll = false, primaryStates = [] } = {}) {
  if (showAll || !Array.isArray(primaryStates) || primaryStates.length === 0) {
    return aggregates
  }

  const allowedStates = new Set(primaryStates)
  return aggregates.filter(aggregate => allowedStates.has(aggregate?.stateCode))
}
