// Edge Function: install-page
// Serves the OTA install page for ad-hoc builds. Supabase Storage deliberately
// serves .html objects as text/plain (nosniff), so the page lives here where
// the content-type can be real. The manifest + IPA stay on public storage.
//
// Deploy: npx supabase functions deploy install-page --no-verify-jwt

const BUNDLE_TITLE = 'LifeOS'

Deno.serve((_req) => {
  const base = Deno.env.get('SUPABASE_URL') ?? ''
  // Point at the ota-manifest Edge Function (serves application/xml), NOT the
  // Storage .plist — Storage force-serves .plist as text/plain + nosniff, which
  // iOS rejects during itms-services (Safari shows the raw XML instead of the
  // install sheet). The IPA itself stays on Storage.
  const manifestUrl = `${base}/functions/v1/ota-manifest`
  const itms = `itms-services://?action=download-manifest&url=${encodeURIComponent(manifestUrl)}`
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Install ${BUNDLE_TITLE}</title>
<style>
  body{margin:0;background:#111;color:#eee;font-family:-apple-system,system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}
  .card{text-align:center;padding:32px}
  h1{font-weight:600;letter-spacing:-0.5px}
  .sub{color:#8a8a8a;font-size:13px;letter-spacing:1.5px;text-transform:uppercase}
  a.btn{display:inline-block;margin-top:22px;padding:16px 38px;border-radius:999px;background:#f3ede2;color:#111;text-decoration:none;font-size:17px;font-weight:600}
  p{color:#999;font-size:13px;line-height:1.6;margin-top:24px}
</style></head>
<body><div class="card">
  <div class="sub">preview build</div>
  <h1>${BUNDLE_TITLE}</h1>
  <a class="btn" href="${itms}">Install</a>
  <p>Tap Install and confirm the prompt.<br>The icon lands on the Home Screen in a few seconds.</p>
</div></body></html>`
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
  })
})
