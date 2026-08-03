import { clusterStatusForMarkers } from './clusterStatus'

const marker = status => ({ options: status ? { status } : {} })

describe('clusterStatusForMarkers', () => {
  test('uses an unvisited marker when a cluster contains mixed review states', () => {
    expect(clusterStatusForMarkers([marker('visited'), marker('unvisited')])).toBe('unvisited')
  })

  test('treats a missing status as unvisited', () => {
    expect(clusterStatusForMarkers([marker('visited'), marker()])).toBe('unvisited')
  })

  test('keeps an all-favorite cluster gold and reviewed combinations visited', () => {
    expect(clusterStatusForMarkers([marker('golden'), marker('golden')])).toBe('golden')
    expect(clusterStatusForMarkers([marker('visited'), marker('golden')])).toBe('visited')
  })
})
