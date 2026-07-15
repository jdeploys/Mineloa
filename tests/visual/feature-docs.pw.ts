import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

test.skip(process.platform !== 'win32', 'Documentation screenshots use the reviewed Windows rendering.')

const output = (name: string) => resolve('docs', 'screenshots', 'after-linear', name)

test.beforeAll(async () => mkdir(resolve('docs', 'screenshots', 'after-linear'), { recursive: true }))

async function capture(page: Page, state: string, name: string, heading: string) {
  await page.goto(`/?state=${state}`)
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
  await page.waitForTimeout(150)
  await page.screenshot({ path: output(name), animations: 'disabled', fullPage: true, omitBackground: false })
}

async function waitForStableSettings(page: Page, marker: string, expanded: boolean) {
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible()
  const apiCard = page.getByRole('region', { name: 'API 키 설정' })
  await expect(apiCard).toContainText('저장된 API 키 삭제')
  await expect(apiCard.getByText('설정됨', { exact: true })).toBeVisible()
  await expect(apiCard.getByLabel('OpenAI API 키')).toBeVisible()
  await page.getByLabel('전사 방식').waitFor({ state: 'attached' })
  if (expanded) await page.getByText('고급 처리 옵션', { exact: true }).click()
  await expect(page.getByText(marker, { exact: true }).first()).toBeVisible()
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

test('documents the empty dashboard', async ({ page }) => capture(page, 'idle', '01-dashboard.png', '새 회의'))
test('documents active local recording', async ({ page }) => {
  await page.goto('/?state=active')
  await page.getByRole('button', { name: '녹음 시작' }).click()
  await expect(page.getByRole('button', { name: '종료', exact: true })).toBeVisible()
  await page.screenshot({ path: output('02-recording.png'), animations: 'disabled', fullPage: true, omitBackground: false })
})
test('documents crash recovery', async ({ page }) => capture(page, 'recoverable', '03-recovery.png', '최근 기록'))
test('documents a failed processing state', async ({ page }) => capture(page, 'failed', '04-processing-failed.png', '최근 기록'))
test('documents the completed meeting workspace', async ({ page }) => capture(page, 'completed', '05-meeting-detail.png', '제품 방향성 회의'))
test('documents summary template editing', async ({ page }) => capture(page, 'templates', '06-template-editor.png', '요약 템플릿'))
test('documents local API key settings', async ({ page }) => capture(page, 'settings', '07-api-key-settings.png', '설정'))
test('documents default processing providers', async ({ page }) => {
  await page.goto('/?state=provider-defaults')
  await waitForStableSettings(page, 'OpenAI API · OpenAI API', false)
  await page.screenshot({ path: output('08-processing-provider-defaults.png'), animations: 'disabled', fullPage: true, omitBackground: false })
})
test('documents expanded processing providers', async ({ page }) => {
  await page.goto('/?state=provider-advanced')
  await waitForStableSettings(page, 'OpenAI API 키를 사용하며 화자 분리를 지원합니다.', true)
  await page.screenshot({ path: output('09-processing-provider-advanced.png'), animations: 'disabled', fullPage: true, omitBackground: false })
})
for (const [state, name, marker] of [
  ['whisper-downloading', '10-whisper-model-downloading.png', '다운로드 중'],
  ['whisper-installed', '11-whisper-model-installed.png', 'base 모델 삭제'],
  ['codex-available', '12-codex-cli-available.png', 'Codex CLI가 설치되고 인증되어 사용할 수 있습니다.'],
  ['codex-unavailable', '13-codex-cli-unavailable.png', 'Codex CLI 설정이 올바르지 않습니다. 터미널에서 설정을 확인한 뒤 다시 시도하세요.'],
] as const) {
  test(`documents ${state}`, async ({ page }) => {
    await page.goto(`/?state=${state}`)
    await waitForStableSettings(page, marker, true)
    await page.screenshot({ path: output(name), animations: 'disabled', fullPage: true, omitBackground: false })
  })
}
