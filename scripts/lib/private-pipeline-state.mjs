import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PRIVATE_PIPELINE_STATE_DIR = 'PRIVATE_PIPELINE_STATE_DIR'
const checkoutRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'))

export function privatePipelineStatePath(fileName) {
  if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName === '.' || fileName === '..') {
    throw new Error('Checkpoint file name must be a single file name')
  }
  const configuredDir = process.env[PRIVATE_PIPELINE_STATE_DIR]?.trim()
  if (!configuredDir) throw new Error(`Set ${PRIVATE_PIPELINE_STATE_DIR} to the migrated private checkpoint directory`)
  if (!isAbsolute(configuredDir)) throw new Error(`${PRIVATE_PIPELINE_STATE_DIR} must be an absolute path outside the checkout`)
  const stateDir = resolve(configuredDir)
  if (!existsSync(stateDir) || !statSync(stateDir).isDirectory()) {
    throw new Error(`${PRIVATE_PIPELINE_STATE_DIR} must point to an existing private directory`)
  }
  const realStateDir = realpathSync(stateDir)
  const fromCheckout = relative(checkoutRoot, realStateDir)
  const outsideCheckout = fromCheckout === '..' || fromCheckout.startsWith(`..${configuredSeparator()}`)
  if (!outsideCheckout) {
    throw new Error(`${PRIVATE_PIPELINE_STATE_DIR} must point outside the repository checkout`)
  }
  const filePath = join(realStateDir, fileName)
  if (existsSync(filePath) && lstatSync(filePath).isSymbolicLink()) {
    throw new Error(`Private checkpoint ${fileName} must not be a symlink`)
  }
  if (!existsSync(filePath)) return filePath
  const realFilePath = realpathSync(filePath)
  const fromState = relative(realStateDir, realFilePath)
  if (!fromState || fromState === '..' || fromState.startsWith(`..${configuredSeparator()}`) || isAbsolute(fromState)) {
    throw new Error(`Private checkpoint ${fileName} must remain inside the private state directory`)
  }
  return filePath
}

function configuredSeparator() {
  return process.platform === 'win32' ? '\\' : '/'
}

export function readPrivateJson(fileName, validate) {
  const filePath = privatePipelineStatePath(fileName)
  let value
  try {
    value = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`Private checkpoint ${fileName} is missing or invalid JSON`, { cause: error })
  }
  if (validate && !validate(value)) throw new Error(`Private checkpoint ${fileName} has an invalid schema`)
  return { filePath, value }
}
