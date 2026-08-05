import { describe, it, expect, beforeEach } from 'vitest'
import {
  parseRoute,
  parseDestination,
  routeLabel,
  normalizePlace,
  titlePlace,
  isRouteCategory,
  hasRoute,
  swapRoute,
  recentPlaces,
  recordPlaces,
} from './route'

let store
beforeEach(() => {
  store = new Map()
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
})

describe('parseRoute', () => {
  // The sentence that started this: the whole tail used to land in one field.
  it('pulls both ends out of a full spoken sentence', () => {
    expect(
      parseRoute(
        'today i traveled in bus from aeon nogata to nogata train station which costed around 270yen i paid with pasmo'
      )
    ).toEqual({ from: 'Aeon Nogata', to: 'Nogata Train Station' })
  })

  it('handles the short forms', () => {
    expect(parseRoute('from nogata to kokura')).toEqual({ from: 'Nogata', to: 'Kokura' })
    expect(parseRoute('nogata to kokura')).toEqual({ from: 'Nogata', to: 'Kokura' })
    expect(parseRoute('nogata → kokura')).toEqual({ from: 'Nogata', to: 'Kokura' })
    expect(parseRoute('nogata -> kokura')).toEqual({ from: 'Nogata', to: 'Kokura' })
  })

  // An explicit "from" anchors the origin; without this the bare A-to-B reading
  // would swallow the whole preceding sentence as the origin.
  it('prefers an explicit from over the bare reading', () => {
    expect(parseRoute('i took the bus from nogata to kokura')).toEqual({
      from: 'Nogata',
      to: 'Kokura',
    })
  })

  it('strips currency and payment words from the destination', () => {
    expect(parseRoute('from nogata to kokura 270 yen pasmo').to).toBe('Kokura')
    expect(parseRoute('from nogata to kokura paid with cash').to).toBe('Kokura')
  })

  it('is not fooled by a sentence that merely contains "to"', () => {
    expect(parseRoute('paid to kenji')).toEqual({ from: '', to: '' })
    expect(parseRoute('')).toEqual({ from: '', to: '' })
    expect(parseRoute(null)).toEqual({ from: '', to: '' })
  })

  it('needs both ends to survive cleaning', () => {
    // "from pasmo to yen" is all noise — not a journey.
    expect(parseRoute('from pasmo to yen')).toEqual({ from: '', to: '' })
  })
})

describe('parseDestination', () => {
  it('reads a one-way mention with no origin', () => {
    expect(parseDestination('bus to kokura')).toBe('Kokura')
    expect(parseDestination('no direction here')).toBe('')
  })
})

describe('titlePlace', () => {
  it('cases place names like labels', () => {
    expect(titlePlace('aeon nogata')).toBe('Aeon Nogata')
    expect(titlePlace('NOGATA')).toBe('Nogata')
  })

  it('leaves existing capitals alone', () => {
    expect(titlePlace('JR Nogata')).toBe('JR Nogata')
    expect(titlePlace("McDonald's")).toBe("McDonald's")
  })

  it('keeps particles lowercase after the first word', () => {
    expect(titlePlace('nogata to kokura')).toBe('Nogata to Kokura')
  })
})

describe('normalizePlace', () => {
  it('caps the length so one runaway sentence cannot become a place', () => {
    expect(normalizePlace('a'.repeat(200)).length).toBeLessThanOrEqual(60)
  })

  it('trims punctuation and collapses spacing', () => {
    expect(normalizePlace('  nogata   station.  ')).toBe('Nogata Station')
  })
})

describe('routeLabel', () => {
  it('reads as a journey', () => {
    expect(routeLabel('Nogata', 'Kokura')).toBe('Nogata → Kokura')
  })

  it('copes with only one end known', () => {
    expect(routeLabel('', 'Kokura')).toBe('→ Kokura')
    expect(routeLabel('Nogata', '')).toBe('Nogata →')
    expect(routeLabel('', '')).toBe('')
  })
})

describe('record shape', () => {
  it('knows which categories are journeys', () => {
    expect(isRouteCategory('Transport')).toBe(true)
    expect(isRouteCategory('Food')).toBe(false)
  })

  it('detects a route on a record without caring which end is set', () => {
    expect(hasRoute({ fromPlace: 'A', toPlace: 'B' })).toBe(true)
    expect(hasRoute({ toPlace: 'B' })).toBe(true)
    expect(hasRoute({})).toBe(false)
    expect(hasRoute(null)).toBe(false)
  })

  // The return leg is most of a commute log, so it is one tap.
  it('swaps a journey round', () => {
    expect(swapRoute({ fromPlace: 'Nogata', toPlace: 'Kokura' })).toEqual({
      fromPlace: 'Kokura',
      toPlace: 'Nogata',
    })
  })
})

describe('recent places', () => {
  it('learns the stops you actually use, most-used first', () => {
    recordPlaces('Nogata', 'Kokura')
    recordPlaces('Nogata', 'Hakata')
    expect(recentPlaces()[0]).toBe('Nogata')
    expect(recentPlaces()).toContain('Hakata')
  })

  it('normalizes on the way in so one stop is not stored three ways', () => {
    recordPlaces('nogata', 'NOGATA', '  Nogata ')
    expect(recentPlaces()).toEqual(['Nogata'])
  })

  it('ignores empties and survives corrupt storage', () => {
    recordPlaces('', null, undefined)
    expect(recentPlaces()).toEqual([])
    store.set('vs_places', 'not json')
    expect(recentPlaces()).toEqual([])
    expect(() => recordPlaces('Nogata')).not.toThrow()
  })
})
