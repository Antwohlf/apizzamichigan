import { isHistoricalLifecycle, lifecycleBadgeLabel, lifecycleCopy, lifecycleLabel, normalizeLifecycleStatus, replacementCopy } from './lifecycle'

describe('lifecycle contract', () => {
  test('normalizes supported historical states', () => {
    expect(normalizeLifecycleStatus('permanently closed')).toBe('closed')
    expect(normalizeLifecycleStatus('Replaced by Homeslice')).toBe('replaced')
    expect(normalizeLifecycleStatus('demolished')).toBe('demolished')
    expect(normalizeLifecycleStatus('open')).toBeNull()
  })

  test('uses consistent public labels and copy', () => {
    expect(lifecycleLabel('closed')).toBe('Historical place')
    expect(lifecycleLabel('replaced')).toBe('Replaced at this location')
    expect(lifecycleBadgeLabel('replaced')).toBe('Replaced')
    expect(lifecycleCopy('replaced')).toEqual(expect.objectContaining({ label: 'Replaced at this location' }))
    expect(lifecycleCopy('demolished')).toEqual(expect.objectContaining({ label: 'Demolished location' }))
    expect(isHistoricalLifecycle('demolished')).toBe(true)
    expect(isHistoricalLifecycle(null)).toBe(false)
    expect(replacementCopy('Homeslice')).toBe('Current place: Homeslice')
  })
})
