import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const [extension, outputName] = process.argv.slice(2)
if (!extension || !outputName) throw new Error('Usage: prepare-release-assets.mjs <extension> <output-name>')

const dist = resolve('dist')
const candidates = (await readdir(dist, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(extension) && !entry.name.includes('__uninstaller'))
  .map((entry) => entry.name)

if (candidates.length !== 1) {
  throw new Error(`Expected one top-level ${extension} artifact, found: ${candidates.join(', ') || 'none'}`)
}

const destination = resolve('release-assets')
await mkdir(destination, { recursive: true })
await copyFile(join(dist, candidates[0]), join(destination, outputName))
process.stdout.write(`${candidates[0]} -> ${outputName}\n`)
