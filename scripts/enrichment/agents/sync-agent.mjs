#!/usr/bin/env node
/** Fail-closed compatibility entrypoint after publisher extraction. */

console.error([
  'The scheduled food publisher is owned by packages/food-runtime in',
  'https://github.com/Antwohlf/map-data-aggregation-enhancement-pipeline.',
  'This retired app sync-agent cannot start publication; use the external runtime on the pipeline host.',
].join(' '))
process.exitCode = 1
