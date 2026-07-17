// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppearanceSettings } from '../../src/renderer/src/features/settings/AppearanceSettings'
import {
  resolveTheme,
  useThemePreference,
} from '../../src/renderer/src/hooks/useThemePreference'

describe('theme preference', () => {
  afterEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
    vi.unstubAllGlobals()
  })

  it('resolves system while preserving manual light and dark choices', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('persists manual selection without disabling system mode', () => {
    const media = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    vi.stubGlobal('matchMedia', vi.fn(() => media))
    const { result } = renderHook(() => useThemePreference())
    expect(result.current.preference).toBe('system')
    act(() => result.current.setPreference('dark'))
    expect(localStorage.getItem('nnote.theme')).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('keeps system selected while offering manual theme choices', () => {
    const onChange = vi.fn()
    render(<AppearanceSettings preference="system" onChange={onChange} />)
    expect(screen.getByRole('heading', { name: '화면 테마' }).parentElement?.querySelector('.ui-icon')).toBeVisible()

    expect(screen.getByRole('radio', { name: '시스템 설정' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: '다크' }))

    expect(onChange).toHaveBeenCalledWith('dark')
  })
})
