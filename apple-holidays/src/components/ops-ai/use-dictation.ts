'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type DictationStatus = 'idle' | 'recording' | 'transcribing' | 'error'

/**
 * Push-to-talk dictation for the composer.
 *
 * Records a short clip with MediaRecorder, sends it to /api/ops-ai/transcribe and
 * hands back the text. It deliberately knows nothing about planning or execution —
 * the transcript is dropped into the composer exactly as typed text would be, so
 * the approval flow is unchanged.
 */
export function useDictation(onText: (text: string) => void) {
  const [status, setStatus] = useState<DictationStatus>('idle')
  const [error, setError]   = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef   = useRef<BlobPart[]>([])
  const streamRef   = useRef<MediaStream | null>(null)

  const cleanup = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    recorderRef.current = null
    chunksRef.current = []
  }, [])

  useEffect(() => cleanup, [cleanup])

  const stop = useCallback(() => {
    // The 'stop' handler below finishes the upload; here we just end capture.
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
  }, [])

  const start = useCallback(async () => {
    if (status === 'recording' || status === 'transcribing') return
    setError(null)

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('error')
      setError('Microphone is not available in this browser.')
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setStatus('error')
      setError('Microphone permission was denied.')
      return
    }

    streamRef.current = stream
    chunksRef.current = []

    // Let the browser pick a container it can actually produce; Whisper accepts
    // webm/ogg/mp4 alike, so we don't force a mimeType that Safari would reject.
    const recorder = new MediaRecorder(stream)
    recorderRef.current = recorder

    recorder.ondataavailable = e => { if (e.data.size) chunksRef.current.push(e.data) }

    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
      cleanup()

      if (!blob.size) { setStatus('idle'); return }

      setStatus('transcribing')
      try {
        const form = new FormData()
        const ext = (recorder.mimeType.split('/')[1] || 'webm').split(';')[0]
        form.append('audio', blob, `dictation.${ext}`)

        const res  = await fetch('/api/ops-ai/transcribe', { method: 'POST', body: form })
        const json = await res.json()

        if (!json?.success) {
          setStatus('error')
          setError(json?.error ?? 'Could not transcribe that.')
          return
        }
        const text = (json.data?.text ?? '').trim()
        if (text) onText(text)
        setStatus('idle')
      } catch (err) {
        setStatus('error')
        setError(err instanceof Error ? err.message : 'Transcription failed.')
      }
    }

    recorder.start()
    setStatus('recording')
  }, [status, cleanup, onText])

  const toggle = useCallback(() => {
    if (status === 'recording') stop()
    else start()
  }, [status, start, stop])

  return { status, error, start, stop, toggle }
}
