# Google Sign-In — Setup Checklist

Code is done & committed (`feat: add Google sign-in`). To make it work you must do external config + **one rebuild** (Google sign-in uses a new native module `expo-web-browser`, so the *current* installed dev build can't run it yet).

_Last updated: 2026-06-14_

## ⚠️ Gate 0 — resume Supabase first
The project is paused. Resume it or auth is dead:
- Supabase dashboard → project `iwkiflvwrzfvtpsmhpgd` → Resume.

---

## A) Google Cloud Console — https://console.cloud.google.com
1. Create or select a project (top-left picker).
2. **APIs & Services → OAuth consent screen**: User type **External** → fill App name, your support email, developer email → Save. (If it stays in "Testing", add your Google account under **Test users**.)
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application** (NOT iOS — this is the web-OAuth flow).
   - **Authorized redirect URIs** → Add exactly:
     ```
     https://iwkiflvwrzfvtpsmhpgd.supabase.co/auth/v1/callback
     ```
   - Create → **copy the Client ID and Client secret**.

> ❗ Common mistake: do NOT put `lifeos://...` here. Google only gets the Supabase callback URL above.

## B) Supabase Dashboard
1. **Authentication → Providers → Google** → toggle **Enable**.
2. Paste the **Client ID** and **Client secret** from step A → Save.
3. **Authentication → URL Configuration → Redirect URLs → Add URL**:
   ```
   lifeos://auth-callback
   ```

> ❗ This app deep-link goes in Supabase, not Google. Two different URLs, two different places.

## C) Rebuild the dev build (PowerShell, needs Apple — creds cached)
```powershell
cd "C:\Users\Amarsh\OneDrive\Documents\Personal\Projects\LifeOS\app"
npx eas-cli build --profile development --platform ios
```
Scan the QR → install the **new** build over the old one.

## D) Test
1. Start Metro: `npx expo start` (same Wi-Fi as phone).
2. Open LifeOS → **Continue with Google** → pick account → bounces back signed in.

---

## How it works (for reference)
- `flowType: 'pkce'` in `src/lib/supabase.ts`.
- `signInWithGoogle()` in `src/contexts/AuthContext.tsx`: `signInWithOAuth({provider:'google', redirectTo})` → `WebBrowser.openAuthSessionAsync` → extract `?code=` → `exchangeCodeForSession(code)`.
- Redirect URI is deterministic: `lifeos://auth-callback` (from `makeRedirectUri({ path: 'auth-callback' })`; scheme `lifeos` is set in `app.json`).
- Buttons on both `app/(auth)/sign-in.tsx` and `sign-up.tsx`.

## Troubleshooting
- **"redirect_uri_mismatch"** → step A redirect URI doesn't exactly match the Supabase callback. Re-check.
- **Browser opens, returns, still on login screen** → `lifeos://auth-callback` missing from Supabase Redirect URLs (step B3).
- **"provider is not enabled"** → Google not enabled in Supabase (step B1).
- **Nothing happens on tap in the *old* build** → you didn't rebuild (step C). The native module isn't in the old binary.
