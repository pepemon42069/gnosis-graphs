import { describe, expect, it } from 'vitest'
import { parseHash, parseNavState } from './history'

describe('parseHash', () => {
  it('parses graph and doc routes', () => {
    expect(parseHash('#/g/abc')).toEqual({ graphId: 'abc', trail: ['abc'] })
    expect(parseHash('#/d/n-1')).toEqual({ docNodeId: 'n-1' })
  })

  it('rejects everything else', () => {
    expect(parseHash('')).toBeNull()
    expect(parseHash('#/g/')).toBeNull()
    expect(parseHash('#/d/')).toBeNull()
    expect(parseHash('#/x/abc')).toBeNull()
  })
})

describe('parseNavState', () => {
  it('accepts legacy {graphId, trail} states without docNodeId', () => {
    expect(parseNavState({ graphId: 'g1', trail: ['g1'] })).toEqual({
      graphId: 'g1',
      trail: ['g1'],
    })
  })

  it('round-trips docNodeId and rejects malformed values', () => {
    expect(parseNavState({ graphId: 'g1', trail: ['g1'], docNodeId: 'n1' })).toEqual({
      graphId: 'g1',
      trail: ['g1'],
      docNodeId: 'n1',
    })
    expect(parseNavState({ graphId: 'g1', trail: ['g1'], docNodeId: 42 })).toBeNull()
    expect(parseNavState({ graphId: 'g1', trail: [3] })).toBeNull()
    expect(parseNavState({ trail: ['g1'] })).toBeNull()
    expect(parseNavState(null)).toBeNull()
  })
})
