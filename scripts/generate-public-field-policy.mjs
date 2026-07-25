#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'

const contract = JSON.parse(readFileSync('config/canonical-contract.json', 'utf8'))
const policy = {
  version: contract.version,
  base: contract.public_fields.base,
  pizza: contract.public_fields.pizza,
  taco: contract.public_fields.taco,
}

const output = `// Generated from config/canonical-contract.json. Do not edit directly.\nconst policy = ${JSON.stringify(policy, null, 2)}\n\nexport default policy\n`
writeFileSync('src/config/public-fields.generated.js', output)
console.log('Generated src/config/public-fields.generated.js')
