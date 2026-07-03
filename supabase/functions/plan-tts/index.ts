// Edge Function: plan-tts
// Natural text-to-speech relay for the plan chat voice mode. Takes reply text,
// returns MP3 audio (base64) from OpenAI TTS — replaces the robotic on-device
// expo-speech voice. JWT-verified; the OpenAI key never leaves the server.
//
// Deploy: npx supabase functions deploy plan-tts

const TTS_MODEL = 'gpt-4o-mini-tts'
const VOICE = 'nova'
const MAX_CHARS = 2000

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  if (!req.headers.get('Authorization')) return json({ error: 'missing authorization' }, 401)

  let body: { text?: string; voice?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid json' }, 400)
  }
  const text = (body.text ?? '').trim().slice(0, MAX_CHARS)
  if (!text) return json({ error: 'missing text' }, 400)

  const openaiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openaiKey) return json({ error: 'server misconfigured' }, 500)

  let res: Response
  try {
    res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: typeof body.voice === 'string' ? body.voice : VOICE,
        input: text,
        response_format: 'mp3',
        speed: 1.0,
      }),
    })
  } catch (e) {
    return json({ error: `tts request failed: ${e instanceof Error ? e.message : String(e)}` }, 502)
  }

  if (!res.ok) {
    const detail = await res.text()
    return json({ error: `openai tts error ${res.status}`, detail }, 502)
  }

  const bytes = new Uint8Array(await res.arrayBuffer())
  // btoa on chunks to avoid call-stack limits on large buffers.
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return json({ audio_base64: btoa(bin), mime: 'audio/mpeg' })
})
