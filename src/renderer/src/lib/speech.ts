/** Speech-to-text helpers for the voice input button (D.4). */

export interface SpeechResultLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>
}

/** Web Speech API locale for the app language. */
export function pickSpeechLang(appLanguage: string): string {
  return appLanguage.startsWith('fa') ? 'fa-IR' : 'en-US'
}

/** Whether the current runtime exposes the Web Speech API. */
export function isSpeechSupported(scope: unknown): boolean {
  if (!scope || typeof scope !== 'object') return false
  const candidate = scope as Record<string, unknown>
  return typeof candidate.SpeechRecognition === 'function' ||
    typeof candidate.webkitSpeechRecognition === 'function'
}

/** Extract the top transcript from a SpeechRecognition event. */
export function firstTranscript(result: SpeechResultLike): string {
  return result.results[0]?.[0]?.transcript?.trim() ?? ''
}
