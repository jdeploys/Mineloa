import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const [extension, platform, arch] = process.argv.slice(2)
if (!extension || !platform || !arch) {
  throw new Error('Usage: prepare-release-assets.mjs <extension> <platform> <arch>')
}

const manifest = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
const version = manifest.version
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`Invalid package version: ${String(version)}`)
}
const outputName = `Mineloa-${version}-${platform}-${arch}${extension}`

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
