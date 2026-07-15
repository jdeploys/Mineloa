import type { RuntimeManifestWriteOptions } from './write-local-runtime-manifest.mjs'
import type { SignOptions } from '@electron/osx-sign'

interface AfterPackContext {
  electronPlatformName: string
  appOutDir: string
  packager: {
    appInfo: { productFilename: string }
    codeSigningInfo?: { value: Promise<{ keychainFile?: string | null }> }
  }
}

interface AfterPackDependencies {
  run?(command: string, args: string[]): { status: number | null, error?: Error }
  writeManifest?(options: RuntimeManifestWriteOptions): Promise<void>
  identity?(): string
  signApplication?(options: SignOptions): Promise<void>
}

export function createAfterPackHook(dependencies?: AfterPackDependencies): (context: AfterPackContext) => Promise<void>
declare const hook: (context: AfterPackContext) => Promise<void>
export default hook
