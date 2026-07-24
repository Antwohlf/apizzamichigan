import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import Sidebar from './Sidebar'
import { ThemeProvider } from './themes/ThemeProvider'
import { ThemeKeys } from './themes/siteTheme'

function renderSidebar(props = {}) {
  return render(
    <ThemeProvider themeKey={ThemeKeys.PIZZA}>
      <Sidebar onFilterChange={() => {}} themeKey={ThemeKeys.PIZZA} {...props} />
    </ThemeProvider>
  )
}

describe('Sidebar mobile filter disclosure', () => {
  test('keeps filter controls collapsed until requested', () => {
    renderSidebar()

    const toggle = screen.getByRole('button', { name: /filters/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('region', { name: /map filters/i })).toBeInTheDocument()
  })

  test('opens the filter controls and reports selected filters', async () => {
    renderSidebar({ filters: { styles: ['Detroit'], prices: [], statuses: ['visited', 'unvisited', 'golden'] } })

    const toggle = screen.getByRole('button', { name: /filters/i })
    expect(toggle).toHaveTextContent('1')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Detroit' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('exposes Anthony\'s picks as a first-class filter', () => {
    const onToggle = jest.fn()
    renderSidebar({ onAnthonysPicksToggle: onToggle })

    const picks = screen.getByRole('checkbox', { name: /Anthony's picks/i })
    expect(picks).not.toBeChecked()

    fireEvent.click(picks)
    expect(onToggle).toHaveBeenCalledWith(true)
  })

  test('exposes historical places as an explicit filter', () => {
    const onToggle = jest.fn()
    renderSidebar({ onHistoricalToggle: onToggle })

    const historical = screen.getByRole('checkbox', { name: /include historical places/i })
    expect(historical).not.toBeChecked()

    fireEvent.click(historical)
    expect(onToggle).toHaveBeenCalledWith(true)
  })
})
