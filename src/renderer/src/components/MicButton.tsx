import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mic, MicOff } from 'lucide-react'
import { firstTranscript, isSpeechSupported, pickSpeechLang, type SpeechResultLike } from '../lib/speech'

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  onresult: ((event: SpeechResultLike) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
}

interface MicButtonProps {
  appLanguage: string
  onTranscript: (text: string) => void
}

/** Mic button that dictates into the composer via the Web Speech API (D.4). */
export default function MicButton({ appLanguage, onTranscript }: MicButtonProps): JSX.Element | null {
  const { t } = useTranslation()
  const [supported, setSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const recognition = useRef<SpeechRecognitionLike | null>(null)

  useEffect(() => {
    setSupported(isSpeechSupported(window))
    return () => recognition.current?.stop()
  }, [])

  if (!supported) return null

  const toggle = (): void => {
    if (listening) {
      recognition.current?.stop()
      setListening(false)
      return
    }
    const scope = window as unknown as Record<string, unknown>
    const Ctor = (scope.SpeechRecognition ?? scope.webkitSpeechRecognition) as
      | (new () => SpeechRecognitionLike)
      | undefined
    if (!Ctor) return
    const instance = new Ctor()
    instance.lang = pickSpeechLang(appLanguage)
    instance.continuous = false
    instance.interimResults = false
    instance.onresult = (event) => {
      const text = firstTranscript(event)
      if (text) onTranscript(text)
    }
    instance.onerror = () => setListening(false)
    instance.onend = () => setListening(false)
    recognition.current = instance
    instance.start()
    setListening(true)
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={listening ? t('chat.listening') : t('chat.voiceInput')}
      aria-label={t('chat.voiceInput')}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition ${
        listening
          ? 'bg-danger/20 text-danger'
          : 'text-fg-muted hover:bg-bg-tertiary hover:text-fg'
      }`}
    >
      {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
    </button>
  )
}
