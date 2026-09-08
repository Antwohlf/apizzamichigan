#!/usr/bin/env node
/** Fail-closed compatibility entrypoint after coordinator extraction. */

console.error([
  'This obsolete coordinator has been retired. Active food workers run from packages/food-runtime in',
  'https://github.com/Antwohlf/map-data-aggregation-enhancement-pipeline.',
  'This application checkout cannot start or restart food workers.',
].join(' '))
process.exitCode = 1
