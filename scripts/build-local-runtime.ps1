[CmdletBinding()]
param(
  [ValidateSet('x64')][string]$Arch = 'x64',
  [ValidateSet('bash', 'msys2')][string]$FfmpegShell = 'bash'
)

$ErrorActionPreference = 'Stop'
$WhisperTag = 'v1.9.1'
$FfmpegTag = 'n8.1.2'
$WhisperCommit = 'f049fff95a089aa9969deb009cdd4892b3e74916'
$FfmpegCommit = '38b88335f99e76ed89ff3c93f877fdefce736c13'
$FfmpegFlags = @(
  '--disable-gpl', '--disable-nonfree', '--disable-doc', '--disable-network',
  '--disable-ffplay', '--disable-ffprobe', '--disable-everything', '--enable-ffmpeg',
  '--enable-protocol=file', '--enable-demuxer=matroska', '--enable-decoder=opus',
  '--enable-filter=aresample', '--enable-encoder=pcm_s16le', '--enable-muxer=wav',
  '--enable-avformat', '--enable-avcodec', '--enable-avfilter', '--enable-swresample'
)

function Invoke-Checked([string]$Program, [string[]]$Arguments, [string]$WorkingDirectory) {
  Push-Location -LiteralPath $WorkingDirectory
  try {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program exited with code $LASTEXITCODE" }
  } finally { Pop-Location }
}

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$BuildRoot = Join-Path $RepoRoot "build\local-runtime\.work\win32-$Arch"
$Output = Join-Path $RepoRoot "build\local-runtime\win32-$Arch"
$AllowedRoot = (Resolve-Path -LiteralPath (Join-Path $RepoRoot 'build\local-runtime')).Path
foreach ($Path in @($BuildRoot, $Output)) {
  $Full = [System.IO.Path]::GetFullPath($Path)
  if (-not $Full.StartsWith($AllowedRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to modify a path outside build/local-runtime'
  }
  if (Test-Path -LiteralPath $Full) { Remove-Item -LiteralPath $Full -Recurse -Force }
}
New-Item -ItemType Directory -Path $BuildRoot, $Output | Out-Null

try {
  Invoke-Checked 'git' @('clone', '--depth', '1', '--branch', $WhisperTag, '--single-branch', 'https://github.com/ggml-org/whisper.cpp.git', 'whisper.cpp') $BuildRoot
  Invoke-Checked 'git' @('describe', '--exact-match', '--tags', 'HEAD') (Join-Path $BuildRoot 'whisper.cpp')
  $ResolvedWhisperCommit = (& git -C (Join-Path $BuildRoot 'whisper.cpp') rev-parse 'HEAD^{commit}').Trim()
  if ($LASTEXITCODE -ne 0 -or $ResolvedWhisperCommit -ne $WhisperCommit) { throw 'whisper.cpp source commit mismatch' }
  Invoke-Checked 'cmake' @('-S', '.', '-B', 'build', '-DGGML_NATIVE=OFF', '-DWHISPER_BUILD_TESTS=OFF', '-DWHISPER_BUILD_EXAMPLES=ON', '-DBUILD_SHARED_LIBS=OFF') (Join-Path $BuildRoot 'whisper.cpp')
  Invoke-Checked 'cmake' @('--build', 'build', '--config', 'Release', '--target', 'whisper-cli', '--parallel') (Join-Path $BuildRoot 'whisper.cpp')

  Invoke-Checked 'git' @('clone', '--depth', '1', '--branch', $FfmpegTag, '--single-branch', 'https://github.com/FFmpeg/FFmpeg.git', 'ffmpeg') $BuildRoot
  Invoke-Checked 'git' @('describe', '--exact-match', '--tags', 'HEAD') (Join-Path $BuildRoot 'ffmpeg')
  $ResolvedFfmpegCommit = (& git -C (Join-Path $BuildRoot 'ffmpeg') rev-parse 'HEAD^{commit}').Trim()
  if ($LASTEXITCODE -ne 0 -or $ResolvedFfmpegCommit -ne $FfmpegCommit) { throw 'FFmpeg source commit mismatch' }
  $FfmpegShellProgram = if ($FfmpegShell -eq 'msys2') {
    (Get-Command msys2 -ErrorAction Stop).Source
  } elseif ($env:FFMPEG_BASH) {
    $env:FFMPEG_BASH
  } else {
    (Get-Command bash -ErrorAction Stop).Source
  }
  $env:CHERE_INVOKING = '1'
  $ConfigureCommand = './configure ' + ($FfmpegFlags -join ' ')
  $FfmpegShellArguments = if ($FfmpegShell -eq 'msys2') { @('-c', $ConfigureCommand) } else { @('-lc', $ConfigureCommand) }
  $MakeShellArguments = if ($FfmpegShell -eq 'msys2') { @('-c', 'make -j2 ffmpeg') } else { @('-lc', 'make -j2 ffmpeg') }
  Invoke-Checked $FfmpegShellProgram $FfmpegShellArguments (Join-Path $BuildRoot 'ffmpeg')
  Invoke-Checked $FfmpegShellProgram $MakeShellArguments (Join-Path $BuildRoot 'ffmpeg')

  $WhisperBinary = @(
    (Join-Path $BuildRoot 'whisper.cpp\build\bin\Release\whisper-cli.exe'),
    (Join-Path $BuildRoot 'whisper.cpp\build\bin\whisper-cli.exe')
  ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $WhisperBinary) { throw 'whisper-cli.exe was not produced' }
  Copy-Item -LiteralPath $WhisperBinary -Destination (Join-Path $Output 'whisper-cli.exe')
  Copy-Item -LiteralPath (Join-Path $BuildRoot 'ffmpeg\ffmpeg.exe') -Destination (Join-Path $Output 'ffmpeg.exe')
  Copy-Item -LiteralPath (Join-Path $BuildRoot 'whisper.cpp\LICENSE') -Destination (Join-Path $Output 'LICENSE.whisper.cpp')
  Copy-Item -LiteralPath (Join-Path $BuildRoot 'ffmpeg\COPYING.LGPLv2.1') -Destination (Join-Path $Output 'LICENSE.FFmpeg')
  Copy-Item -LiteralPath (Join-Path $AllowedRoot 'THIRD_PARTY_NOTICES.md') -Destination $Output
  Invoke-Checked 'node' @((Join-Path $PSScriptRoot 'write-local-runtime-manifest.mjs'), $Output, 'win32', $Arch) $RepoRoot
} catch {
  if (Test-Path -LiteralPath $Output) { Remove-Item -LiteralPath $Output -Recurse -Force }
  throw
} finally {
  if (Test-Path -LiteralPath $BuildRoot) { Remove-Item -LiteralPath $BuildRoot -Recurse -Force }
}
