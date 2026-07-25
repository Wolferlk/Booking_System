'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { readApi } from './read-api'
import type { OpsAction, OpsLookup } from './types'

export type VoiceStatus = 'idle' | 'connecting' | 'live' | 'error'

interface VoiceContext {
  pathname?:   string
  bookingRef?: string | null
}

interface VoiceCallbacks {
  /** Final transcript of something the operator said. */
  onUserSpeech?:      (text: string) => void
  /** Final transcript of something the agent said aloud. */
  onAssistantSpeech?: (text: string) => void
  /** A READ the voice agent ran, to show as evidence in the thread. */
  onLookup?:          (lookup: OpsLookup) => void
  /** A WRITE/NAV the voice agent proposed, to render as a confirmation card. */
  onAction?:          (action: OpsAction) => void
}

const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls'

/**
 * Voice-to-voice for OPS_AI over the OpenAI Realtime API.
 *
 * The browser talks WebRTC directly to OpenAI using a short-lived ephemeral token
 * minted by /api/ops-ai/realtime/session — the real API key never leaves the
 * server. Every function the agent calls is routed back through
 * /api/ops-ai/realtime/tool, so reads run server-side under the operator's RBAC
 * and writes come back as the same signed confirmation cards the typed copilot
 * uses. Nothing spoken can mutate data on its own.
 */
export function useRealtimeVoice(getContext: () => VoiceContext, callbacks: VoiceCallbacks) {
  const [status, setStatus]     = useState<VoiceStatus>('idle')
  const [error, setError]       = useState<string | null>(null)
  const [muted, setMuted]       = useState(false)
  // True while the agent is speaking, for a live indicator in the UI.
  const [agentSpeaking, setAgentSpeaking] = useState(false)

  const pcRef     = useRef<RTCPeerConnection | null>(null)
  const dcRef     = useRef<RTCDataChannel | null>(null)
  const micRef    = useRef<MediaStream | null>(null)
  const audioRef  = useRef<HTMLAudioElement | null>(null)
  const ctxRef    = useRef(getContext)
  const cbRef     = useRef(callbacks)

  ctxRef.current = getContext
  cbRef.current  = callbacks

  const teardown = useCallback(() => {
    dcRef.current?.close()
    pcRef.current?.getSenders().forEach(s => s.track?.stop())
    pcRef.current?.close()
    micRef.current?.getTracks().forEach(t => t.stop())
    if (audioRef.current) {
      audioRef.current.srcObject = null
      audioRef.current.remove()
    }
    dcRef.current = null
    pcRef.current = null
    micRef.current = null
    audioRef.current = null
    setAgentSpeaking(false)
  }, [])

  useEffect(() => teardown, [teardown])

  // ── Bridge a function call the agent emitted back through our server ────────
  const handleFunctionCall = useCallback(async (callId: string, name: string, rawArgs: string) => {
    const dc = dcRef.current
    if (!dc) return

    let args: Record<string, unknown> = {}
    try { args = rawArgs ? JSON.parse(rawArgs) : {} } catch { /* leave empty */ }

    let output = 'The tool could not be reached.'
    try {
      const ctx = ctxRef.current()
      const res = await fetch('/api/ops-ai/realtime/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: name, args, pathname: ctx.pathname, bookingRef: ctx.bookingRef }),
      })
      const json = await readApi<{ kind: string; output: string; lookup?: OpsLookup; action?: OpsAction }>(res)
      if (json?.success) {
        const data = json.data as { kind: string; output: string; lookup?: OpsLookup; action?: OpsAction }
        output = data.output ?? 'Done.'
        if (data.lookup) cbRef.current.onLookup?.(data.lookup)
        if (data.action) cbRef.current.onAction?.(data.action)
      } else {
        output = json?.error ?? output
      }
    } catch (err) {
      output = err instanceof Error ? err.message : output
    }

    // Feed the result back to the model and let it continue speaking.
    dc.send(JSON.stringify({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: callId, output },
    }))
    dc.send(JSON.stringify({ type: 'response.create' }))
  }, [])

  const onServerEvent = useCallback((evt: MessageEvent) => {
    let msg: Record<string, unknown>
    try { msg = JSON.parse(evt.data) } catch { return }
    const type = msg.type as string

    switch (type) {
      case 'conversation.item.input_audio_transcription.completed': {
        const t = (msg.transcript as string ?? '').trim()
        if (t) cbRef.current.onUserSpeech?.(t)
        break
      }
      case 'response.audio_transcript.done': {
        const t = (msg.transcript as string ?? '').trim()
        if (t) cbRef.current.onAssistantSpeech?.(t)
        break
      }
      case 'output_audio_buffer.started':
      case 'response.audio.delta':
        setAgentSpeaking(true)
        break
      case 'output_audio_buffer.stopped':
      case 'response.audio.done':
        setAgentSpeaking(false)
        break
      case 'response.function_call_arguments.done': {
        void handleFunctionCall(msg.call_id as string, msg.name as string, msg.arguments as string)
        break
      }
      case 'error': {
        const e = msg.error as { message?: string } | undefined
        console.error('[OPS_AI] realtime error:', e?.message ?? msg)
        break
      }
    }
  }, [handleFunctionCall])

  const stop = useCallback(() => {
    teardown()
    setStatus('idle')
    setError(null)
  }, [teardown])

  const start = useCallback(async () => {
    if (status === 'connecting' || status === 'live') return
    setError(null)
    setStatus('connecting')

    try {
      const ctx = ctxRef.current()

      // 1. Mint an ephemeral session on the server (instructions + tools fixed there).
      const sres  = await fetch('/api/ops-ai/realtime/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pathname: ctx.pathname, bookingRef: ctx.bookingRef }),
      })
      const sjson = await readApi<{ clientSecret: string; model: string }>(sres)
      if (!sjson?.success || !sjson.data?.clientSecret) {
        throw new Error(sjson?.error ?? 'Could not start a voice session.')
      }
      const { clientSecret } = sjson.data as { clientSecret: string }

      // 2. Peer connection + remote audio sink.
      const pc = new RTCPeerConnection()
      pcRef.current = pc

      const audio = document.createElement('audio')
      audio.autoplay = true
      audio.style.display = 'none'
      document.body.appendChild(audio)
      audioRef.current = audio
      pc.ontrack = e => { audio.srcObject = e.streams[0] }

      // 3. Local microphone.
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true })
      micRef.current = mic
      mic.getTracks().forEach(t => pc.addTrack(t, mic))

      // 4. Data channel for events (transcripts, tool calls).
      const dc = pc.createDataChannel('oai-events')
      dcRef.current = dc
      dc.onmessage = onServerEvent
      dc.onopen = () => setStatus('live')

      pc.onconnectionstatechange = () => {
        if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
          teardown()
          setStatus(s => (s === 'idle' ? s : 'error'))
        }
      }

      // 5. SDP offer → OpenAI → answer.
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      const sdpRes = await fetch(REALTIME_CALLS_URL, {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${clientSecret}`,
          'Content-Type': 'application/sdp',
        },
      })
      if (!sdpRes.ok) throw new Error('Voice handshake was rejected.')

      const answer = { type: 'answer' as const, sdp: await sdpRes.text() }
      await pc.setRemoteDescription(answer)
    } catch (err) {
      teardown()
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Could not start voice mode.')
    }
  }, [status, onServerEvent, teardown])

  const toggle = useCallback(() => {
    if (status === 'live' || status === 'connecting') stop()
    else start()
  }, [status, start, stop])

  const toggleMute = useCallback(() => {
    const tracks = micRef.current?.getAudioTracks() ?? []
    const next = !muted
    tracks.forEach(t => { t.enabled = !next })
    setMuted(next)
  }, [muted])

  return { status, error, agentSpeaking, muted, start, stop, toggle, toggleMute }
}
