import { displayEditorialStatus, displayPlaceRating, displayPlaceStyle, formatHours, formatPlaceLocation, isMissingPublicColumnError, lifecycleCopy, normalizeLifecycleStatus, replacementCopy, PUBLIC_PLACE_DETAIL_SELECT } from './PlaceDetailPage'
import { publicPlaceDetailSelectForTable, publicPlaceLegacyDetailSelectForTable } from '../lib/publicPlaceFields'
import { ThemeKeys } from '../themes/siteTheme'

test('uses an explicit public detail field set', () => {
  expect(PUBLIC_PLACE_DETAIL_SELECT).toContain('lifecycle_replaced_by_id')
  expect(PUBLIC_PLACE_DETAIL_SELECT).toContain('website_url')
  expect(PUBLIC_PLACE_DETAIL_SELECT).toContain('menu_url')
  expect(PUBLIC_PLACE_DETAIL_SELECT).toContain('hours')
  expect(PUBLIC_PLACE_DETAIL_SELECT).not.toContain('osm_tags')
  expect(PUBLIC_PLACE_DETAIL_SELECT).not.toContain('menu_data')
  expect(publicPlaceDetailSelectForTable('taco_places')).not.toContain('price_range')
  expect(publicPlaceDetailSelectForTable('taco_places')).toContain('lifecycle_status')
  expect(publicPlaceDetailSelectForTable('taco_places')).toContain('lifecycle_replaced_by_id')
  expect(publicPlaceLegacyDetailSelectForTable('taco_places')).not.toContain('lifecycle_status')
  expect(publicPlaceLegacyDetailSelectForTable('pizza_places')).toContain('website_url')
  expect(publicPlaceLegacyDetailSelectForTable('pizza_places')).toContain('brand')
  expect(publicPlaceLegacyDetailSelectForTable('pizza_places')).not.toContain('city')
  expect(publicPlaceLegacyDetailSelectForTable('pizza_places')).not.toContain('lifecycle_status')
})

describe('place detail hours formatting', () => {
  test('keeps common source hour shapes readable', () => {
    expect(formatHours('Mo 11:00-22:00; Tu 11:00-22:00')).toMatch(/Mo 11:00/)
    expect(formatHours({ Monday: '11:00-22:00', Tuesday: '11:00-22:00' })).toBe('Monday: 11:00-22:00 · Tuesday: 11:00-22:00')
    expect(formatHours(null)).toBe('')
  })
})

test('recognizes only missing-column errors as migration compatibility failures', () => {
  expect(isMissingPublicColumnError({ message: 'column pizza_places.lifecycle_status does not exist' })).toBe(true)
  expect(isMissingPublicColumnError({ message: 'Could not find the column lifecycle_status in the schema cache' })).toBe(true)
  expect(isMissingPublicColumnError({ message: 'permission denied for table pizza_places' })).toBe(false)
})

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
    expect(replacementCopy(null, 42)).toMatch(/linked below/i)
    expect(replacementCopy(null)).toMatch(/is linked yet/i)
  })
})

describe('place detail location formatting', () => {
  test('does not repeat city or state already present in a full address', () => {
    expect(formatPlaceLocation({
      address: '1924 Packard St, Ann Arbor, MI 48104',
      city: 'Ann Arbor',
      state: 'MI',
    })).toBe('1924 Packard St, Ann Arbor, MI 48104')
  })

  test('adds missing city and state to a street-only address', () => {
    expect(formatPlaceLocation({
      address: '123 Main St',
      city: 'Detroit',
      state: 'MI',
    })).toBe('123 Main St, Detroit, MI')
  })
})

describe('place detail public labels', () => {
  test('displays ratings returned as numeric strings', () => {
    expect(displayPlaceRating('8.5')).toBe(8.5)
    expect(displayPlaceRating('0')).toBeNull()
  })

  test('uses the primary pizza style taxonomy instead of raw multi-label values', () => {
    expect(displayPlaceStyle('Chicago, Sicilian, New York', ThemeKeys.PIZZA)).toBe('Sicilian')
    expect(displayPlaceStyle('Unknown', ThemeKeys.PIZZA)).toBe('')
  })

  test('uses human editorial labels', () => {
    expect(displayEditorialStatus('golden')).toBe("Anthony's Pick")
    expect(displayEditorialStatus('visited')).toBe('Anthony reviewed')
    expect(displayEditorialStatus('unvisited')).toBe('')
  })
})
