import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

function run(program, args) {
  const result = spawnSync(program, args, { encoding: 'utf8', windowsHide: true })
  if (result.error || result.status !== 0) throw new Error(`Nested helper signing failed: ${program}`)
}

export default async function signLocalRuntimeHelpers(context) {
  if (context.electronPlatformName !== 'darwin') return
  const root = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources', 'local-runtime')
  const targets = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  if (targets.length !== 1 || !targets[0].name.startsWith('darwin-')) {
    throw new Error('Nested helper signing failed: target')
  }
  const identity = process.env.CSC_NAME?.trim() || '-'
  const signingOptions = identity === '-' ? [] : ['--options', 'runtime', '--timestamp']
  for (const helper of ['whisper-cli', 'ffmpeg']) {
    run('codesign', ['--force', ...signingOptions, '--sign', identity, join(root, targets[0].name, helper)])
  }
}
