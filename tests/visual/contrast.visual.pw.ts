import { expect, test, type Locator, type Page } from '@playwright/test'

type Theme = 'light' | 'dark'

async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

async function openRoute(page: Page, state: string, theme: Theme) {
  await page.goto(`/?state=${state}&theme=${theme}`)
  if (state === 'active') await page.getByRole('button', { name: '녹음 시작' }).click()
  if (state === 'settings') await page.getByRole('button', { name: '설정', exact: true }).click()
  await settle(page)
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)
}

async function renderedContrast(locator: Locator) {
  return locator.evaluate((element) => {
    type Color = { r: number; g: number; b: number; a: number }

    const parseColor = (value: string): Color => {
      const rgb = value.match(/^rgba?\(([^)]+)\)$/)
      if (rgb !== null) {
        const parts = rgb[1]!.replaceAll(',', ' ').replace('/', ' ').trim().split(/\s+/).map(Number)
        return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: parts[3] ?? 1 }
      }

      const srgb = value.match(/^color\(srgb\s+([^)]*)\)$/)
      if (srgb !== null) {
        const parts = srgb[1]!.replace('/', ' ').trim().split(/\s+/).map(Number)
        return { r: parts[0]! * 255, g: parts[1]! * 255, b: parts[2]! * 255, a: parts[3] ?? 1 }
      }

      throw new Error(`Unsupported computed color: ${value}`)
    }

    const composite = (foreground: Color, background: Color): Color => {
      const alpha = foreground.a + background.a * (1 - foreground.a)
      if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 }
      return {
        r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
        g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
        b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
        a: alpha,
      }
    }

    const withOpacity = (color: Color, opacity: number): Color => ({ ...color, a: color.a * opacity })
    const ancestors: Element[] = []
    for (let current = element.parentElement; current !== null; current = current.parentElement) ancestors.unshift(current)

    let backdrop: Color = { r: 255, g: 255, b: 255, a: 1 }
    for (const ancestor of ancestors) {
      const styles = getComputedStyle(ancestor)
      backdrop = composite(withOpacity(parseColor(styles.backgroundColor), Number(styles.opacity)), backdrop)
    }

    const styles = getComputedStyle(element)
    const opacity = Number(styles.opacity)
    const localBackground = composite(parseColor(styles.backgroundColor), backdrop)
    const renderedBackground = composite(withOpacity(localBackground, opacity), backdrop)
    const localForeground = composite(parseColor(styles.color), localBackground)
    const renderedForeground = composite(withOpacity(localForeground, opacity), backdrop)

    const luminance = (color: Color) => {
      const linear = [color.r, color.g, color.b].map((channel) => {
        const value = channel / 255
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
    }

    const foregroundLuminance = luminance(renderedForeground)
    const backgroundLuminance = luminance(renderedBackground)
    const ratio = (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
      / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)

    return {
      ratio,
      color: styles.color,
      backgroundColor: styles.backgroundColor,
      opacity: styles.opacity,
      renderedForeground,
      renderedBackground,
    }
  })
}

async function expectWcagAa(locator: Locator, label: string) {
  await expect.soft(locator, `${label} must be visible before measuring contrast`).toBeVisible()
  const measured = await renderedContrast(locator)
  expect.soft(measured.ratio, `${label}: ${JSON.stringify(measured)}`).toBeGreaterThanOrEqual(4.5)
  return { label, ...measured }
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1200, 640]) {
    test(`real ${theme} App keeps primary controls and every semantic badge at WCAG AA contrast at ${width}px`, async ({ page }, testInfo) => {
      const evidence: Awaited<ReturnType<typeof expectWcagAa>>[] = []
      const verify = async (locator: Locator, label: string) => evidence.push(await expectWcagAa(locator, label))
      await page.setViewportSize({ width, height: 800 })

      await openRoute(page, 'idle', theme)
      const primary = page.getByRole('button', { name: '녹음 시작' })
      await expect(primary).toBeEnabled()
      await verify(primary, `${theme} primary`)
      await primary.hover()
      await verify(primary, `${theme} primary hover`)
      await primary.focus()
      await expect(primary).toBeFocused()
      await verify(primary, `${theme} primary focus`)

      await openRoute(page, 'active', theme)
      await verify(page.locator(".status-badge[data-tone='active']"), `${theme} active badge`)
      await verify(page.getByRole('button', { name: '일시정지' }), `${theme} secondary control`)

      await openRoute(page, 'failed', theme)
      await verify(page.locator(".status-badge[data-tone='success']").first(), `${theme} success badge`)
      await verify(page.locator(".status-badge[data-tone='danger']"), `${theme} danger badge`)

      await openRoute(page, 'recoverable', theme)
      await verify(page.locator(".status-badge[data-tone='warning']"), `${theme} warning badge`)

      await openRoute(page, 'settings', theme)
      const disabledPrimary = page.getByRole('button', { name: 'API 키 저장' })
      await expect(disabledPrimary).toBeDisabled()
      await verify(disabledPrimary, `${theme} disabled primary`)
      await verify(page.getByRole('button', { name: 'API 키 삭제' }), `${theme} danger control`)

      await testInfo.attach('computed-contrast.json', {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json',
      })
    })
  }
}
