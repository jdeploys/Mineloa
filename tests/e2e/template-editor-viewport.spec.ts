import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const electronPath = require('electron') as string
const root = resolve(__dirname, '../..')
const evidenceDirectory = resolve(root, '.superpowers', 'sdd')

test('shows the primary template save action in the initial 1200x800 viewport', async ({}, testInfo) => {
  await mkdir(evidenceDirectory, { recursive: true })
  const app = await electron.launch({
    executablePath: electronPath,
    cwd: root,
    args: [`--user-data-dir=${testInfo.outputPath('user-data')}`, '.'],
  })

  try {
    const page = await app.firstWindow()
    await expect(page).toHaveTitle('Mineloa')
    await page.getByRole('button', { name: '요약 템플릿' }).click()
    await page.getByRole('button', { name: '새 템플릿' }).click()
    await expect(page.getByLabel('템플릿 이름')).toHaveValue('새 템플릿')
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }))

    const save = page.getByRole('button', { name: '템플릿 저장' })
    const desktop = await save.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const geometry = (selector: string) => {
        const target = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect()
        return { top: target.top, bottom: target.bottom, height: target.height }
      }
      return {
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        rendererWidth: window.innerWidth,
        rendererHeight: window.innerHeight,
        scrollY: window.scrollY,
        documentHeight: document.documentElement.scrollHeight,
        saveTop: bounds.top,
        saveBottom: bounds.bottom,
        saveLeft: bounds.left,
        saveRight: bounds.right,
        pageHeader: geometry('.page-header'),
        layout: geometry('.template-layout'),
        editor: geometry('.template-editor'),
        editorHeading: geometry('.template-editor-heading'),
        nameField: geometry('.template-name-field'),
        sectionsHeading: geometry('.template-sections-heading'),
        sectionCard: geometry('.template-section-card'),
        actionBar: geometry('.template-editor > .action-bar'),
      }
    })
    console.log('TEMPLATE_DESKTOP_GEOMETRY', JSON.stringify(desktop))
    expect(desktop.outerWidth).toBe(1200)
    expect(desktop.outerHeight).toBe(800)
    expect(desktop.scrollY).toBe(0)
    expect(desktop.saveTop).toBeGreaterThanOrEqual(0)
    expect(desktop.saveBottom).toBeLessThanOrEqual(desktop.rendererHeight)
    expect(desktop.saveLeft).toBeGreaterThanOrEqual(0)
    expect(desktop.saveRight).toBeLessThanOrEqual(desktop.rendererWidth)
    await page.screenshot({
      path: resolve(evidenceDirectory, 'task-6-correction-1200x800.png'),
      animations: 'disabled',
    })

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(640, 800))
    await page.waitForFunction(() => window.outerWidth === 640 && window.outerHeight === 800)
    const compact = await page.evaluate(() => {
      const master = document.querySelector<HTMLElement>('.template-master')!.getBoundingClientRect()
      const detail = document.querySelector<HTMLElement>('.template-detail')!.getBoundingClientRect()
      const root = document.documentElement
      return {
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        rendererWidth: window.innerWidth,
        rendererHeight: window.innerHeight,
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
        masterBottom: master.bottom,
        detailTop: detail.top,
      }
    })
    console.log('TEMPLATE_COMPACT_GEOMETRY', JSON.stringify(compact))
    expect(compact.masterBottom).toBeLessThanOrEqual(compact.detailTop)
    expect(compact.scrollWidth).toBeLessThanOrEqual(compact.clientWidth)
    await save.scrollIntoViewIfNeeded()
    await expect(save).toBeVisible()
    await page.screenshot({
      path: resolve(evidenceDirectory, 'task-6-correction-640x800.png'),
      animations: 'disabled',
    })
  } finally {
    await app.close()
  }
})
