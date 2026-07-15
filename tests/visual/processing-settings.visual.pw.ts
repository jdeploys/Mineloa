import { expect, test, type Page } from '@playwright/test'
test.skip(
  process.platform !== 'win32',
  `Processing settings snapshots have reviewed Windows baselines only; ${process.platform} is skipped until native baselines are reviewed.`,
)

async function open(page: Page, state: string, expanded: boolean) {
  await page.goto(`/?state=${state}`)
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible()
  const apiCard = page.getByRole('region', { name: 'API 키 설정' })
  await expect(apiCard).toContainText('저장된 API 키 삭제')
  await expect(apiCard.getByText('설정됨', { exact: true })).toBeVisible()
  await expect(apiCard.getByLabel('OpenAI API 키')).toBeVisible()
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
  if (expanded) {
    await expect(page.getByLabel('전사 방식')).toBeVisible()
    await expect(page.getByLabel('요약 방식')).toBeVisible()
  }
  await expect.poll(() => page.evaluate(({ expanded }) => {
    const api = document.querySelector<HTMLElement>('.settings-panel')
    const processing = document.querySelector<HTMLElement>('.processing-settings')
    const selectors = [...document.querySelectorAll<HTMLElement>('.provider-grid select')]
    const hasPaintableBox = (element: HTMLElement | null) => element !== null
      && element.getBoundingClientRect().width > 100
      && element.getBoundingClientRect().height > 30
    return hasPaintableBox(api)
      && hasPaintableBox(processing)
      && (api?.innerText.includes('API 키 설정') ?? false)
      && (api?.innerText.includes('저장된 API 키 삭제') ?? false)
      && (!expanded || (selectors.length >= 2 && selectors.every(hasPaintableBox)))
  }, { expanded })).toBe(true)
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
