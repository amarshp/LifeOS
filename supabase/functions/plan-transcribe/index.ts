// Edge Function: plan-transcribe
// Speech-to-text for the planning assistant's voice mode. The authed app records
// a short clip, base64-encodes it, and posts it here; we relay to OpenAI Whisper
// and return the transcript. JWT-verified (verify_jwt ON) so only signed-in users
// can spend the OpenAI quota. The key stays server-side.
//
// Deploy: npx supabase functions deploy plan-transcribe

// gpt-4o-mini-transcribe: same quality on short voice notes, meaningfully
// lower latency than whisper-1 (the "Transcribing…" wait the user flagged).
const MODEL = 'gpt-4o-mini-transcribe'

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface Body {
  audio_base64?: string
  mime?: string // e.g. "audio/m4a"
  filename?: string // e.g. "speech.m4a"
}

// CORS for the Expo WEB build (browser preflight); native apps ignore these.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
} as const

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  if (!req.headers.get('Authorization')) return json({ error: 'missing authorization' }, 401)

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid json' }, 400)
  }
  if (!body.audio_base64) return json({ error: 'missing audio_base64' }, 400)

  const openaiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openaiKey) return json({ error: 'server misconfigured' }, 500)

  let bytes: Uint8Array
  try {
    bytes = base64ToBytes(body.audio_base64)
  } catch {
    return json({ error: 'bad base64' }, 400)
  }

  // Vocabulary bias: the user's own names (people/places/projects) + their
  // category and tag vocabulary steer the model toward the right spellings.
  let vocabPrompt = ''
  try {
    const url = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const authHeader = req.headers.get('Authorization')
    if (url && anonKey && authHeader) {
      const supabase = createClient(url, anonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      })
      const [{ data: settings }, { data: cats }, { data: tags }] = await Promise.all([
        supabase.from('user_settings').select('stt_vocabulary').maybeSingle(),
        supabase.from('categories').select('name').is('deleted_at', null),
        supabase.from('tags').select('name').is('deleted_at', null).limit(40),
      ])
      const words = [
        ...((settings?.stt_vocabulary as string[] | null) ?? []),
        ...((cats ?? []).map((c) => c.name as string)),
        ...((tags ?? []).map((t) => t.name as string)),
      ].filter(Boolean)
      if (words.length > 0) {
        vocabPrompt = `Vocabulary that may appear: ${[...new Set(words)].join(', ')}.`
      }
    }
  } catch {
    // vocabulary is a nice-to-have — transcribe without it
  }

  const mime = body.mime || 'audio/m4a'
  const filename = body.filename || 'speech.m4a'
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: mime }), filename)
  form.append('model', MODEL)
  if (vocabPrompt) form.append('prompt', vocabPrompt)

  let res: Response
  try {
    res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: form,
    })
  } catch (e) {
    return json({ error: `openai request failed: ${e instanceof Error ? e.message : String(e)}` }, 502)
  }

  if (!res.ok) {
    const detail = await res.text()
    return json({ error: `openai error ${res.status}`, detail }, 502)
  }

  const data = await res.json()
  return json({ text: (data.text ?? '').trim() })
})
