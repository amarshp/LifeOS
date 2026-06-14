# LifeOS — iOS Deployment Guide & Progress

> **Goal:** Get LifeOS from Expo/web onto a physical iPhone → TestFlight.
> **Primary motivation:** Live Activities (Dynamic Island + Lock Screen) + notifications.
> **Constraint:** Developer is on **Windows (no Mac)** → all iOS binaries are built in the cloud via **EAS Build**.

_Last updated: 2026-06-14_

---

## ⏱️ TL;DR — Where we are right now

Everything on our side is done. **We are blocked only on Apple.**

| Step | Status |
|------|--------|
| Git repo + secrets protected | ✅ Done |
| EAS config (`eas.json`, dev-client, worklets, SDK 54 pins) | ✅ Done |
| `eas login` | ✅ Done |
| `eas init` → project `@amarshp/lifeos` | ✅ Done & committed |
| `eas device:create` (register iPhone) | ⏳ **Blocked** — Apple Developer Program enrollment **PENDING** |
| `eas build` (dev build to phone) | ⏳ Waiting on the above |

**Blocker:** Apple Developer Program enrollment for `pedapatiamarsh@gmail.com` is *pending* (Apple returns "no team associated"). Typically clears in **24–48h**. Watch for the "Welcome to the Apple Developer Program" email, or check https://developer.apple.com/account (should show a **Membership** section with an expiry date instead of "pending").

---

## ▶️ How to resume (once Apple enrollment is ACTIVE)

> ⚠️ **Use a real terminal (PowerShell), NOT the Claude `! command` prefix.** These commands prompt for Apple login + 2FA and need an interactive keyboard. The chat prefix fails with `stdin is not readable`.

Open **PowerShell** and run:

```powershell
cd "C:\Users\Amarsh\OneDrive\Documents\Personal\Projects\LifeOS\app"

# Step A — register the iPhone (re-run; it previously failed at the "team" step)
npx eas-cli device:create
#   1. "Use the amarshp account?"            -> yes
#   2. Apple ID / password / 2FA code        -> pedapatiamarsh@gmail.com (already cached in Keychain)
#   3. Registration method                   -> Website
#   4. Open the printed URL / scan the QR ON THE IPHONE
#      -> downloads a provisioning profile
#      -> install it: Settings > General > VPN & Device Management
#   5. Confirm the device shows as registered

# Step B — build the standalone dev app in the cloud (~10-20 min)
npx eas-cli build --profile development --platform ios
#   - Log into Apple if prompted; say YES to let EAS auto-manage signing
#     (it generates the distribution cert + ad-hoc provisioning profile)
#   - When the build finishes it prints a QR code
#   - Scan the QR ON THE IPHONE -> "LifeOS" installs as its own app icon
```

### ✅ Phase 2 is DONE when the **LifeOS icon opens on the iPhone** (not merely "build succeeded"). **Stop there** — notifications + Live Activities come after.

---

## 📦 What's already configured (don't redo)

- **Bundle ID / Android package:** `com.pedapatiamarsh.lifeos` (changed from the squatted `com.lifeos.app`).
- **Expo project:** `@amarshp/lifeos`, projectId `8ffed5ea-3f24-4990-95a4-a5c26c4705ec` (in `app/app.json`).
- **`app/eas.json`** build profiles:
  - `development` — `developmentClient: true`, `distribution: internal` → standalone dev build with dev menu (this is what installs on your phone, NOT Expo Go).
  - `preview` — standalone internal test build, no dev menu.
  - `production` — for TestFlight via `eas submit`.
- **Installed:** `expo-dev-client`, `react-native-worklets` (required by Reanimated 4 — without it the app crashes outside Expo Go). SDK 54 patch pins aligned. `expo-doctor` 18/18 green.
- **Stack:** Expo SDK 54.0.34 / React Native 0.81.5 / React 19.1 / expo-router 6.

### Key facts / gotchas
- The Expo app lives in **`app/`** subdir; git root is the parent `LifeOS/`. **Always run `eas` commands from `app/`.**
- **No `.easignore`** on purpose — it would override `.gitignore` and risk re-exposing `.env` / `node_modules` in the upload. The first build is the real test of the subdir setup; fallback if EAS can't find the project = re-init git inside `app/`.
- **`.env`** (LifeOS root) holds Supabase service-role secret + personal access token — **never commit**. It is gitignored and verified out of version control.

---

## 🟡 Parallel side-task (independent of Apple)

- **Supabase project `iwkiflvwrzfvtpsmhpgd`** (region ap-southeast-2) was auto-paused (free tier). Resume it from the Supabase dashboard so the app has data. *Not required to test the build / Live Activity pipeline.*

---

## 🗺️ Roadmap (after Phase 2)

| Phase | What | Notes |
|-------|------|-------|
| **3** | Push/local notifications | `expo-notifications`; needs the dev build (can't work in Expo Go) |
| **4** | **Live Activities** (Dynamic Island + Lock Screen) | **Local-only MVP** — `Text(timerInterval:)` counts on-device, no APNs. Plan: `software-mansion-labs/expo-live-activity` config plugin + a native Swift Widget Extension |
| **5** | **TestFlight** | `eas build --profile production` then `eas submit -p ios` |

> **Decision on record:** Live Activity MVP = **local-only** (no push server). Phase gating = **stop after Phase 2**, confirm app launches before investing in 3–5.

---

## 🧰 Useful links

- Expo project dashboard: https://expo.dev/accounts/amarshp/projects/lifeos
- Apple Developer account: https://developer.apple.com/account
- EAS Build docs: https://docs.expo.dev/build/introduction/
- Live Activities w/ Expo: https://docs.expo.dev/versions/v54.0.0/ (+ expo-live-activity plugin)
