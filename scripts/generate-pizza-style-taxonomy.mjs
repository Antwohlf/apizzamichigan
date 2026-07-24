#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const root = resolve(process.cwd())
const sourcePath = resolve(root, 'config/pizza-style-taxonomy.json')
const targetPath = resolve(root, 'src/data/pizza-style-taxonomy.generated.js')
const taxonomy = JSON.parse(readFileSync(sourcePath, 'utf8'))

const output = `// Generated from config/pizza-style-taxonomy.json. Do not edit directly.\nconst taxonomy = ${JSON.stringify(taxonomy, null, 2)}\n\nexport default taxonomy\n`
writeFileSync(targetPath, output)
console.log(`Generated ${targetPath}`)
