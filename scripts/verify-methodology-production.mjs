import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const forbiddenName = 'methodology-data.json'
const frontendCopy = join(process.cwd(), 'public', 'methodology', forbiddenName)
const distRoot = join(process.cwd(), 'dist')

if (existsSync(frontendCopy)) {
  throw new Error(`${forbiddenName} must not be published from the frontend public directory`)
}

function findForbiddenFile(directory) {
  if (!existsSync(directory)) return undefined
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) {
      const nested = findForbiddenFile(path)
      if (nested) return nested
    } else if (name === forbiddenName) {
      return path
    }
  }
  return undefined
}

const copiedFile = findForbiddenFile(distRoot)
if (copiedFile) {
  throw new Error(`${forbiddenName} unexpectedly exists in the production bundle: ${copiedFile}`)
}

const methodologyService = readFileSync(
  join(process.cwd(), 'src', 'services', 'methodology.ts'),
  'utf8',
)
if (methodologyService.includes(forbiddenName)) {
  throw new Error(`frontend service still references ${forbiddenName}`)
}

console.log('Methodology production data-source check passed: backend APIs only, no static JSON.')
