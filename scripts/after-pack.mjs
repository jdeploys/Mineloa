import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { writeRuntimeManifest } from './write-local-runtime-manifest.mjs'

function runCodesign(run, identity, helper, keychainFile) {
  const signingOptions = identity === '-' ? [] : ['--options', 'runtime', '--timestamp']
  const keychainOptions = keychainFile ? ['--keychain', keychainFile] : []
  const result = run('codesign', [
    '--force', ...signingOptions, ...keychainOptions, '--sign', identity, helper,
  ])
  if (result.error || result.status !== 0) throw new Error('Nested helper signing failed: codesign')
}

function defaultRun(command, args) {
  return spawnSync(command, args, { encoding: 'utf8', windowsHide: true })
}

async function resolveKeychainFile(context, identity) {
  if (identity === '-') return undefined
  const signingInfo = await context.packager.codeSigningInfo?.value
  if (!signingInfo || typeof signingInfo !== 'object') {
    throw new Error('Nested helper signing failed: signing info')
  }
  const { keychainFile } = signingInfo
  if (keychainFile != null && (typeof keychainFile !== 'string' || keychainFile.trim() === '')) {
    throw new Error('Nested helper signing failed: keychain')
  }
  if (process.env.CSC_LINK && !keychainFile) {
    throw new Error('Nested helper signing failed: keychain')
  }
  return keychainFile ?? undefined
}

export function createAfterPackHook(dependencies = {}) {
  const run = dependencies.run ?? defaultRun
  const refreshManifest = dependencies.writeManifest ?? writeRuntimeManifest
  const resolveIdentity = dependencies.identity ?? (() => process.env.CSC_NAME?.trim() || '-')
  return async function signLocalRuntimeHelpers(context) {
    if (context.electronPlatformName !== 'darwin') return
    const root = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources', 'local-runtime')
    const targets = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    if (targets.length !== 1 || !/^darwin-(?:x64|arm64)$/.test(targets[0].name)) {
      throw new Error('Nested helper signing failed: target')
    }
    const targetRoot = join(root, targets[0].name)
    const identity = resolveIdentity()
    if (typeof identity !== 'string' || identity.trim() === '') {
      throw new Error('Nested helper signing failed: identity')
    }
    const keychainFile = await resolveKeychainFile(context, identity)
    runCodesign(run, identity, join(targetRoot, 'whisper-cli'), keychainFile)
    runCodesign(run, identity, join(targetRoot, 'ffmpeg'), keychainFile)
    await refreshManifest({
      directory: targetRoot,
      platform: 'darwin',
      arch: targets[0].name.slice('darwin-'.length),
      replaceExisting: true,
    })
  }
}

export default createAfterPackHook()
