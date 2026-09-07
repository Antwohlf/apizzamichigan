#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

import { pathViolations, textViolations } from '../lib/public-repo-audit.mjs'

const release = process.argv.includes('--release')
const maxBuffer = 64 * 1024 * 1024

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer })
}

function nulList(value) {
  return value.split('\0').filter(Boolean)
}

const indexed = nulList(git(['ls-files', '--cached', '-z']))
const untracked = nulList(git(['ls-files', '--others', '--exclude-standard', '-z']))
const files = [...new Set([...indexed, ...untracked])]
  .filter(path => existsSync(path))
  .sort()
const errors = []

for (const path of files) {
  for (const violation of pathViolations(path, { release })) errors.push(`${path}: ${violation}`)
  const bytes = readFileSync(path)
  if (!bytes.includes(0)) {
    for (const violation of textViolations(path, bytes.toString('utf8'), { release })) {
      errors.push(`${path}: ${violation}`)
    }
  }
}

const required = [
  '.env.example',
  'CONTRIBUTING.md',
  'DATA-LICENSE.md',
  'NOTICE',
  'SECURITY.md',
  'docs/PIPELINE_BOUNDARY.md',
]
if (release) required.push('LICENSE')
for (const path of required) {
  if (!files.includes(path)) errors.push(`${path}: required public-repository file is missing`)
}

const ignore = readFileSync('.gitignore', 'utf8')
for (const rule of ['.env*', '/.playwright-cli/', '/output/', '/assets/', '*.bak']) {
  if (!ignore.includes(rule)) errors.push(`.gitignore: missing required rule ${rule}`)
}

if (errors.length) {
  for (const error of [...new Set(errors)]) console.error(error)
  process.exitCode = 1
} else {
  const mode = release ? 'release' : 'current-tree'
  console.log(`public repository ${mode} audit passed (${files.length} files)`)
}
