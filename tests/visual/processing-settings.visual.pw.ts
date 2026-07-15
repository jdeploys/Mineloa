import { expect, test, type Page } from '@playwright/test'
import { hasTask10VisualBaseline } from './platformSupport'

test.skip(
  !hasTask10VisualBaseline(process.platform),
  `Processing settings visual comparisons support Windows and macOS, not ${process.platform}.`,
)

async function open(page: Page, state: string, expanded: boolean) {
  await page.goto(`/?state=${state}`)
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible()
  await page.getByLabel('전사 방식').waitFor({ state: 'attached' })
  if (expanded) await page.getByText('고급 처리 옵션', { exact: true }).click()
  const markers: Record<string, string> = {
    'provider-defaults': 'OpenAI API · OpenAI API',
    'provider-advanced': 'OpenAI API 키를 사용하며 화자 분리를 지원합니다.',
    'whisper-downloading': '다운로드 중',
    'whisper-installed': 'base 모델 삭제',
    'codex-available': 'Codex CLI가 설치되고 인증되어 사용할 수 있습니다.',
    'codex-unavailable': 'Codex CLI 설정이 올바르지 않습니다. 터미널에서 설정을 확인한 뒤 다시 시도하세요.',
  }
  await expect(page.getByText(markers[state], { exact: true }).first()).toBeVisible()
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
  await page.waitForTimeout(150)
}

for (const [state, snapshot, expanded] of [
  ['provider-defaults', 'processing-providers-defaults.png', false],
  ['provider-advanced', 'processing-providers-advanced.png', true],
  ['whisper-downloading', 'processing-whisper-downloading.png', true],
  ['whisper-installed', 'processing-whisper-installed.png', true],
  ['codex-available', 'processing-codex-available.png', true],
  ['codex-unavailable', 'processing-codex-unavailable.png', true],
] as const) {
  test(`settings visibly show ${state}`, async ({ page }) => {
    await open(page, state, expanded)
    await expect(page).toHaveScreenshot(snapshot, { animations: 'disabled', fullPage: true, omitBackground: false })
  })
}

test('expanded processing settings fit 640px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 })
  await open(page, 'whisper-installed', true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(640)
  await expect(page.getByLabel('로컬 모델')).toBeVisible()
})
