# 12 — The Android App

The Android client is the **same React application**, packaged. There is no second UI
codebase, no second copy of the seven categories, and no second implementation of the cadence
arithmetic. What is added is a thin native layer under [`src/mobile/`](../src/mobile/) plus a
generated Gradle project, and every file in that layer is written so the web build behaves
exactly as it did before.

---

## 1. Why Capacitor

The candidates were native Kotlin/Compose, Flutter, React Native, a PWA, and a Trusted Web
Activity. The decision turns on one number: **6,658 lines of React across seven screens**,
carrying domain logic this repository documents as canonical.

| Option | What it costs here |
| :----- | :----------------- |
| **Capacitor** ✅ | Ships the existing SPA in a WebView. Reuses 100% of the UI and all of the domain logic. Adds ~500 lines of platform glue. |
| Native Kotlin / Flutter | Full rewrite. `CATEGORIES` is re-implemented in a second language — and the docs already warn that changing a category id orphans stored `stats` keys. There would then be **three** places holding the seven ids: `categories.js`, `domain/categories.go`, and the new client. |
| React Native | Reuses the *language*, not the *code*. No DOM, so no Tailwind classes, no Recharts, no `react-router-dom`. Realistically an 85% rewrite for a 15% saving. |
| PWA / TWA | **Ruled out by the deployment model, not by preference.** Both require a secure context. This app is self-hosted at `http://192.168.1.x:8080`, which is not one — no install prompt, no service worker, and a TWA additionally needs a Digital Asset Links file served from a public HTTPS origin that a LAN box does not have. |

The decisive argument is not effort, it is **drift**. `src/constants/categories.js` is named in
[docs/README.md](README.md#source-of-truth-map) as the source of truth for the seven ids,
labels, colours, detection metrics and slider anchors; `src/constants/cadence.js` is the source
of truth for check-in arithmetic *and* for a product rule about tone. A native rewrite forks
all of it. Every subsequent category change becomes a two-language migration with the server's
allowlist as a third participant, and the failure mode — a stale id silently rendering as 0 —
is invisible until someone's history disappears.

**What this costs, stated plainly.** The card-stack transforms and Recharts run in a WebView,
so animation on a low-end device is worse than native would be. There is no widget, no
background sync, and no true native feel. For a self-hosted personal tool those are acceptable;
for a consumer product with a design team they might not be.

### When to revisit

Reach for native if any of these become real requirements: home-screen widgets, background
sync while the app is closed, biometric-gated storage backed by the Android Keystore, or
sub-16ms interaction on hardware older than about 2019.

---

## 2. How the app talks to the backend

This is the part with the traps. Four of them are load-bearing.

### 2.1 CORS — solved by not being a browser

[docs/02-architecture.md §6](02-architecture.md) says it outright:

> Because both environments make the SPA and the API **same-origin**, the Go service ships
> **no CORS middleware at all**.

A Capacitor WebView is served from `https://localhost` and the API is on another host, so
every request is cross-origin. On the face of it that means adding CORS middleware to Go.

**It does not.** `capacitor.config.json` enables `CapacitorHttp`, which patches `window.fetch`
and `XMLHttpRequest` to route through the native OkHttp stack. Those requests are not made by
the browser engine, so there is no `Origin` header, no preflight, and no CORS check. axios uses
XHR, so it is intercepted transparently — **no axios code changed, and no Go code changed.**

That is the reason to prefer it over adding a CORS layer: the alternative widens the server's
attack surface permanently, for every deployment, to serve one client that does not need it.

### 2.2 `10.0.2.2`, and why the address is a setting

Inside an emulator, `localhost` is the *emulated device*. The host is reachable at the
alias **`10.0.2.2`**. A physical phone needs the machine's LAN address instead, and a real
self-hosted user needs their own domain — so there is no address to hardcode, and the server
URL is runtime configuration, stored in `localStorage` and editable from the Server settings
screen.

| Running the backend as… | Address from an emulator | From a phone on the same Wi-Fi |
| :---------------------- | :----------------------- | :----------------------------- |
| `go run ./cmd/server` | `http://10.0.2.2:8080` | `http://<your-lan-ip>:8080` |
| `make up` (Compose) | `http://10.0.2.2:8081` | `http://<your-lan-ip>:8081` |

**Use 8081 under Compose, not 8080.** Port 8080 there is Nginx, which exists to serve the SPA
— which this app already has bundled — and which per
[docs/09-deployment.md](09-deployment.md#uploads-is-not-proxied-in-the-container-setup) does
**not** proxy `/uploads`. Going through it buys nothing and silently breaks avatars. Port 8081
is the backend directly and serves both `/api` and `/uploads`.

A compile-time default can be baked in, and the in-app setting still overrides it:

```bash
make build-android ANDROID_API_URL=http://192.168.1.10:8081
```

### 2.3 The token, and an ordering constraint you must not break

[`App.jsx`](../src/App.jsx) reads the token from `localStorage` **synchronously at module
scope**, and its comment explains why: child effects commit before their parent's, so a token
applied from an effect would arrive after `Dashboard`'s first `GET /api/subjects` had already
gone out anonymous — a 401, and the interceptor signs the user straight back out.

The base URL has the identical constraint, so
[`src/mobile/serverUrl.js`](../src/mobile/serverUrl.js) resolves it the identical way:
synchronously, at import time, from `localStorage`.

> **`@capacitor/preferences` is deliberately not used for either value.** Its API is async and
> would break that ordering. It also buys nothing: WebView storage lives in the app's private
> data directory, sandboxed by the OS from every other app, which is the same protection
> `SharedPreferences` provides — neither is encrypted at rest.

Token lifetime is unchanged: HS256, `exp = now + 24h`, no refresh endpoint, no revocation. That
is a sharper edge on mobile than on the web, because a phone app is *resumed* for weeks rather
than reloaded. The 401 interceptor handles it correctly, but the user experience is an abrupt
return to Landing. A refresh-token flow is the fix; it is a backend change and is out of scope
here.

### 2.4 Cleartext HTTP

Android 9+ blocks cleartext by default.
[`android-config/.../network_security_config.xml`](../android-config/app/src/main/res/xml/network_security_config.xml)
re-permits it, because a server on `192.168.1.10` has no certificate and cannot get one —
blocking cleartext would not make those deployments secure, it would make them impossible.

**The cost:** on a LAN the JWT and every snapshot travel unencrypted, readable by anyone on
that network. Defensible for a home network; not defensible over the internet. If you expose
your server publicly, put TLS in front of it and set `cleartextTrafficPermitted="false"` — a
one-line change that costs nothing once HTTPS is in place.

### 2.5 Two smaller traps, already handled

- **`androidScheme` must stay `https`.** [`AppLock`](../src/components/AppLock.jsx) hashes its
  passphrase with `crypto.subtle`, which exists only in a secure context. `https://localhost`
  is one; `http://localhost` is not. Flipping this makes `isLockAvailable()` return false and
  the lock **silently disappears** — no error, just a missing feature.
- **Avatars are server-relative.** `profile_picture` is stored as `/uploads/profile_<nanos>.jpg`,
  which in the WebView would resolve against `https://localhost` and 404. `resolveAssetUrl()`
  rebases it; because the WebView fetches images itself rather than through `CapacitorHttp`,
  `allowMixedContent` is also required for a cleartext server.

---

## 3. UI/UX changes

### 3.1 Navigation

The desktop header puts five controls in the top-right corner — the hardest point to reach on
a phone held in one hand. Below `md` they move to
[`MobileBottomNav`](../src/components/MobileBottomNav.jsx): **Analysis, Vault, Profile**, and
**Discretion**.

Discretion is a mode rather than a destination and still earns a slot, because of what it is
for: hiding names and notes when someone glances over. On a desktop that is `Ctrl+.`; on the
device you are actually holding when someone sits down beside you, it has to be one thumb-press
away or it does not work at all. The timeline is *not* a tab — it is a drill-down from a card.

### 3.2 Screen-by-screen

| Web screen | Android treatment |
| :--------- | :---------------- |
| **Navbar** (5 items, top-right) | Title bar only: logo, server settings, logout. Navigation moves to the bottom bar. Short wordmark — the full one is 27 characters and overruns a 360dp screen. |
| **Landing** | Unchanged; already single-column and centred. |
| **Auth** | Unchanged layout. Fields get `inputMode`/`enterKeyHint`; the 16px rule below stops the zoom-on-focus jump. |
| **Dashboard grid** (`md:grid-cols-2 lg:grid-cols-3`) | Already responsive — collapses to one column unchanged. Header stacks; "New Analysis" takes the full width as the screen's primary action. |
| **Card stack** (wheel to scrub) | **Vertical swipe added.** Wheel-only meant a stack was a static picture of its newest snapshot with the rest unreachable. Height becomes `min(70vh,500px)`; a `3 / 7` position indicator replaces the depth cue the fanned cards give on a desktop. |
| **PersonForm modal** (`max-w-2xl`, 7 sliders) | Full-width sheet from the bottom. Sliders keep native `range` inputs — the OS already gives them a large touch slop. |
| **AnalysisTimeline** (Recharts) | Unchanged component; Recharts' `ResponsiveContainer` handles the width. Legends wrap. |
| **Profile** | Two-column grid collapses. Gains the **check-in reminders** toggle, which has no web equivalent. |
| **Vault** | Unchanged; already a single narrow column. |
| **AppLock** | Unchanged, and works — `androidScheme: https` keeps `crypto.subtle` available. |

### 3.3 Inputs and touch

- **48dp minimum targets.** Icon buttons were `p-1.5`/`p-2` (~28–36px). Interactive controls
  now carry `min-h-[48px]`, and the bottom bar's are 56px.
- **16px font on inputs below `md`.** Android's WebView zooms the page when a focused field is
  under 16px; the app's fields are `text-sm` (14px), so without this every tap into a field
  jerked the layout. Set once in `index.css`, not per-field.
- **Keyboard.** `useNativeShell` publishes the keyboard height as `--alq-keyboard` and sets
  `alq-keyboard-open` on `<html>`; the bottom bar translates itself out of the way, because a
  row of tab targets under an open keyboard is a row of mis-taps.
- **Safe areas.** `viewport-fit=cover` in `index.html` plus `pt-safe`/`pb-safe` utilities.
- **Pinch-zoom is left enabled** — `maximum-scale` is deliberately not set. Locking it is the
  most common accidental accessibility regression in a WebView app.

### 3.4 Mobile-first additions

| Feature | Where | Note |
| :------ | :---- | :--- |
| **Pull-to-refresh** | [`usePullToRefresh`](../src/mobile/usePullToRefresh.js) | The list is fetched once on mount and mutated locally after. Free to correct on a desktop with a reload; a phone is resumed, not reloaded. |
| **Offline read-through cache** | [`offlineCache.js`](../src/mobile/offlineCache.js) | Last-known-good list, shown with its age when the server is unreachable. **Read-only by design** — queueing writes against a find-or-create path with server-assigned ids is a synchronisation feature needing conflict rules this app has never defined. Cleared on logout. |
| **Check-in reminders** | [`cadenceReminders.js`](../src/mobile/cadenceReminders.js) | Local notifications only — nothing is sent to a server, preserving the claim in `cadence.js` that due dates never leave the machine. Bound by that file's product rule: the body is `nudgeSentence()` verbatim, **no badge count**, one notification per relationship, scheduled for 10:00. |
| **Hardware back button** | [`useNativeShell.js`](../src/mobile/useNativeShell.js) | Owned explicitly. Capacitor's default pops WebView history, which walks behind the React Router stack and can strand the app on a blank document. |
| **Haptics** | `usePullToRefresh` | One light tap when the refresh gesture arms. |

Deliberately **not** built: swipe-to-delete on cards. Deleting a relationship removes its entire
history and the app already routes that through a confirm dialog naming the snapshot count. A
gesture with no confirmation step is the wrong affordance for that action.

---

## 4. Layout and build

```
capacitor.config.json        appId, androidScheme, CapacitorHttp — the native config
Dockerfile.android           containerised APK/AAB build; needs no local Android SDK
android-config/              committed native files, overlaid onto the generated project
  app/src/main/AndroidManifest.xml
  app/src/main/res/xml/network_security_config.xml
android/                     GENERATED, gitignored — never hand-edit
src/mobile/                  the platform layer
  platform.js                isNative / isAndroid predicates
  serverUrl.js               base URL, synchronously; asset rebasing
  useNativeShell.js          back button, status bar, keyboard
  usePullToRefresh.js        pull-to-refresh over the document scroller
  offlineCache.js            last-known-good subject list
  cadenceReminders.js        local notifications for the check-in rhythm
src/components/
  MobileBottomNav.jsx        bottom navigation
  ServerSettingsModal.jsx    where is your server?
```

### Why `android/` is generated and gitignored

`npx cap add android` writes it from the Capacitor template. Committing it would mean reviewing
a few thousand lines of template on every Capacitor bump, and would make the container build
depend on whatever state a developer's local copy had drifted into. Native changes that must
persist go in `android-config/`, which both build paths copy over the generated project — see
[`android-config/README.md`](../android-config/README.md) for how to re-sync after an upgrade.

### Makefile targets

| Target | Does |
| :----- | :--- |
| `make build-android` | Builds the debug APK **entirely in Docker** → `dist-android/`. No JDK, SDK, or Android Studio on the host. |
| `make android-init` | One-time local setup for the live-reload path: `npm install`, `cap add android`, overlay, `cap sync`. |
| `make dev-android` | Live reload against the Vite dev server. Needs local `adb` and a device/emulator. |
| `make run-android` | `build-android` then install and launch on a connected device. |
| `make android-install` | Installs the built APK via `adb`. |
| `make android-logs` | `adb logcat` filtered to Capacitor, the WebView console, and crashes. |
| `make bundle-android KEYSTORE=… KEYSTORE_PASS=… KEY_ALIAS=…` | Release AAB, signed with `jarsigner` after the Gradle build. |
| `make clean-android` | Removes `android/`, `dist-android/`, `.gradle/`, and the Docker cache mount. |

Override the baked-in default server on any build target with `ANDROID_API_URL=…`.

### Toolchain versions

Pinned in `Dockerfile.android` and taken from what `@capacitor/android@8.4.2` actually
declares — JDK 21, AGP 8.13.0, Gradle 8.14.3, compileSdk/targetSdk 36, minSdk 24
(Android 7.0). After bumping Capacitor, re-derive them:

```bash
tar -xzf node_modules/@capacitor/cli/assets/android-template.tar.gz -C /tmp/t
cat /tmp/t/variables.gradle                            # compile/target/min SDK
grep 'gradle:' /tmp/t/build.gradle                     # AGP
cat /tmp/t/gradle/wrapper/gradle-wrapper.properties    # Gradle
```

### The two build paths

`build-android` regenerates `android/` inside the image every run, so the APK depends on
`package-lock.json` and `Dockerfile.android` rather than on local state. That is the
reproducible path and the one CI should use. `dev-android` needs local tooling because it
drives hardware, which a container cannot do for you.

> **`npm ci` requires `package.json` and `package-lock.json` to agree.** Adding a Capacitor
> dependency by hand without regenerating the lockfile fails the container build in the
> `web` stage with an unhelpful npm usage dump. `npm install --package-lock-only` fixes it.

---

## 5. Development loop

```bash
# One-time
make android-init

# Terminal 1 — backend (JWT_SECRET is required; the server refuses to start without it)
cd backend && JWT_SECRET=dev-only-change-me go run ./cmd/server

# Terminal 2 — the app, with live reload onto a device or emulator
make dev-android
```

On first launch the app opens on **Server settings**, which is not dismissible until a server
is chosen — there is nothing behind it that would work. Enter `http://10.0.2.2:8080` for an
emulator, or your LAN address for a phone, and press **Test**: a `4xx` there is a *success*,
because any structured HTTP reply proves the address resolves and a Gin router is answering.

### When something works on the web and not on the device

```bash
make android-logs
```

`console.error` from the WebView appears under `Capacitor/Console`. The three usual causes:

1. **Requests fail with no response** — wrong server address, or the phone is not on the same
   network as the host. Re-run Test in Server settings.
2. **Avatars are broken but the app works** — pointing at Nginx (8080 under Compose) rather
   than the backend (8081). See §2.2.
3. **The lock screen vanished** — `androidScheme` is not `https`, so `crypto.subtle` is
   unavailable. See §2.5.

---

## 6. Not done

Honest list, so none of it reads as an oversight:

- **No release signing config in Gradle.** `bundle-android` signs with `jarsigner` after the
  fact, deliberately: `android/` is regenerated on every build, and keeping the keystore out
  of the Gradle files keeps it out of the build context and therefore out of any image layer.
- **No refresh-token flow.** 24-hour expiry with no refresh is a worse fit for an app that is
  resumed than for a page that is reloaded (§2.3). The fix is server-side.
- **No offline writes.** See the note in §3.4.
- **No CI target.** `.github/workflows/` builds nothing today; `make build-android` is a
  single self-contained command and would drop into a workflow as-is.
- **No app icon or splash.** The Capacitor placeholder ships. `@capacitor/assets` generates a
  full set from one source image.
- **Not tested on a physical device.** The web bundle, the unit suite, the native project
  generation, and the containerised APK build are all verified; behaviour on real hardware is
  not.
