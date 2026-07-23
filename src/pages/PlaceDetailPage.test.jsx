import { lifecycleCopy, normalizeLifecycleStatus, replacementCopy } from './PlaceDetailPage'

describe('place detail lifecycle labels', () => {
  test('normalizes lifecycle values from the canonical record', () => {
    expect(normalizeLifecycleStatus('closed')).toBe('closed')
    expect(normalizeLifecycleStatus('replaced by Homeslice')).toBe('replaced')
    expect(normalizeLifecycleStatus('demolished')).toBe('demolished')
    expect(normalizeLifecycleStatus(null)).toBeNull()
  })

  test('explains historical and replacement records in plain language', () => {
    expect(lifecycleCopy('closed')).toEqual(expect.objectContaining({ label: 'Historical place' }))
    expect(lifecycleCopy('replaced').message).toMatch(/current tenant/i)
    expect(lifecycleCopy(null)).toBeNull()
  })

  test('names the successor when replacement data is available', () => {
    expect(replacementCopy('Homeslice Pizzeria')).toBe('Current place: Homeslice Pizzeria')
    expect(replacementCopy(null)).toMatch(/linked below/i)
  })
})
