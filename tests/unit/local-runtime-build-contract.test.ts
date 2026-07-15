import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const REQUIRED_FLAGS = [
  '--disable-gpl', '--disable-nonfree', '--disable-doc', '--disable-network',
  '--disable-ffplay', '--disable-ffprobe', '--disable-everything', '--enable-ffmpeg',
  '--enable-protocol=file', '--enable-demuxer=matroska', '--enable-decoder=opus',
  '--enable-filter=aresample', '--enable-encoder=pcm_s16le', '--enable-muxer=wav',
  '--enable-avformat', '--enable-avcodec', '--enable-avfilter', '--enable-swresample',
] as const

describe('local runtime build contract', () => {
  it.each(['scripts/build-local-runtime.ps1', 'scripts/build-local-runtime.sh'])(
    '%s pins sources and the exact LGPL-compatible FFmpeg feature set',
    (path) => {
      const script = readFileSync(resolve(path), 'utf8')
      expect(script).toContain('v1.9.1')
      expect(script).toContain('n8.1.2')
      expect(script).toContain('f049fff95a089aa9969deb009cdd4892b3e74916')
      expect(script).toContain('38b88335f99e76ed89ff3c93f877fdefce736c13')
      expect(script).toContain('HEAD^{commit}')
      expect(script).toContain('GGML_NATIVE=OFF')
      for (const flag of REQUIRED_FLAGS) expect(script).toContain(flag)
      expect(script).not.toMatch(/--enable-(?:gpl|nonfree|network)/)
    },
  )

  it('ships notices without model files in the source payload', () => {
    const notices = readFileSync(resolve('build/local-runtime/THIRD_PARTY_NOTICES.md'), 'utf8')
    expect(notices).toContain('whisper.cpp')
    expect(notices).toContain('FFmpeg')
    expect(notices).toContain('LGPL')
    expect(notices).not.toMatch(/ggml-(?:base|small)\.bin/)
  })

  it('keeps Windows native build tools separate from the explicit MSYS2 FFmpeg bridge', () => {
    const script = readFileSync(resolve('scripts/build-local-runtime.ps1'), 'utf8')
    expect(script).toContain("[ValidateSet('bash', 'msys2')]")
    expect(script).toContain("$FfmpegShellArguments = if ($FfmpegShell -eq 'msys2')")
    expect(script).toContain("@('-c', $ConfigureCommand)")
    expect(script).toContain("@('-lc', $ConfigureCommand)")
  })
})
