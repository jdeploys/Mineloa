import { spawnSync } from 'node:child_process'

export default async function signAdHocFallback(context) {
  if (context.electronPlatformName !== 'darwin') return
  const configuredIdentity = process.env.CSC_NAME?.trim()
  if (process.env.CSC_LINK || (configuredIdentity && configuredIdentity !== '-')) return
  const result = spawnSync('codesign', [
    '--force', '--deep', '--sign', '-', context.appOutDir.endsWith('.app')
      ? context.appOutDir
      : `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`,
  ], { encoding: 'utf8', windowsHide: true })
  if (result.error || result.status !== 0) throw new Error('Ad-hoc application signing failed')
}
