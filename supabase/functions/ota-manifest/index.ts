// Edge Function: ota-manifest
// Serves the OTA install manifest with a real XML content-type (Storage
// force-serves .plist as text/plain with nosniff, which some iOS versions
// reject during itms-services installs). The IPA itself stays on Storage.
//
// Deploy: npx supabase functions deploy ota-manifest --no-verify-jwt

const BUNDLE_ID = 'com.pedapatiamarsh.lifeos'
const VERSION = '1.0.0'
const TITLE = 'LifeOS'

Deno.serve((_req) => {
  const base = Deno.env.get('SUPABASE_URL') ?? ''
  const ipaUrl = `${base}/storage/v1/object/public/builds/LifeOS.ipa`
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key><string>software-package</string>
          <key>url</key><string>${ipaUrl}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key><string>${BUNDLE_ID}</string>
        <key>bundle-version</key><string>${VERSION}</string>
        <key>kind</key><string>software</string>
        <key>title</key><string>${TITLE}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>`
  return new Response(manifest, {
    headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'no-cache' },
  })
})
