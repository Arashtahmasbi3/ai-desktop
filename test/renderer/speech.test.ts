import { describe, it, expect } from 'vitest'
import { firstTranscript, isSpeechSupported, pickSpeechLang } from '../../src/renderer/src/lib/speech'

describe('speech helpers', () => {
  it('picks a locale for the app language', () => {
    expect(pickSpeechLang('fa')).toBe('fa-IR')
    expect(pickSpeechLang('en')).toBe('en-US')
  })

  it('detects the Web Speech API', () => {
    expect(isSpeechSupported({ SpeechRecognition: () => {} })).toBe(true)
    expect(isSpeechSupported({ webkitSpeechRecognition: () => {} })).toBe(true)
    expect(isSpeechSupported({})).toBe(false)
    expect(isSpeechSupported(undefined)).toBe(false)
  })

  it('extracts the trimmed transcript', () => {
    expect(firstTranscript({ results: [[{ transcript: '  hello world ' }]] })).toBe('hello world')
    expect(firstTranscript({ results: [] })).toBe('')
  })
})
