import { describe, it, expect } from 'vitest'
import { TONE_TEXT, TONE_BG } from './tones'
import type { Tone } from './types'

const TONES: Tone[] = ['success', 'warning', 'destructive', 'info', 'dim', 'primary']

describe('tone maps', () => {
  it('TONE_TEXT covers every tone with a text-* class', () => {
    for (const tone of TONES) {
      expect(TONE_TEXT[tone]).toMatch(/^text-/)
    }
    expect(Object.keys(TONE_TEXT).sort()).toEqual([...TONES].sort())
  })

  it('TONE_BG covers every tone with a bg-* class', () => {
    for (const tone of TONES) {
      expect(TONE_BG[tone]).toMatch(/^bg-/)
    }
    expect(Object.keys(TONE_BG).sort()).toEqual([...TONES].sort())
  })
})
