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
[docs/09-deployment.md](09-deployment.md#nginx-configuration) does
**not** proxy `/uploads`. Going through it buys nothing and silently breaks avatars. Port 8081
is the backend directly and serves both `/api` and `/uploads`.

A compile-time default can be baked in, and the in-app setting still overrides it:

```bash
make build-android ANDROID_API_URL=http://192.168.1.10:8081
```

### 2.3 The session, and an ordering constraint you must not break

[`src/auth/session.js`](../src/auth/session.js) reads the token from `localStorage`
**synchronously at module scope**, and its comment explains why: child effects commit before
their parent's, so a token applied from an effect would arrive after `Dashboard`'s first
`GET /api/subjects` had already gone out anonymous — a 401, and before renewal existed the
interceptor signed the user straight back out.

The base URL has the identical constraint, so
[`src/mobile/serverUrl.js`](../src/mobile/serverUrl.js) resolves it the identical way:
synchronously, at import time, from `localStorage`.

> **`@capacitor/preferences` is deliberately not used for either value.** Its API is async and
> would break that ordering. It also buys nothing: WebView storage lives in the app's private
> data directory, sandboxed by the OS from every other app, which is the same protection
> `SharedPreferences` provides — neither is encrypted at rest.

**Renewal is the part that matters most on a phone.** The access token still lives 24 hours,
but a phone app is *resumed* for weeks rather than reloaded, so before there was any way to
renew one, "Invalid or expired token" and an abrupt return to Landing was what the app did
almost every session. Three things changed:

- `POST /api/login` now also returns a **refresh token** (60 days, rotated on every use) and
  `expires_in`. See [API §3.1](04-api-reference.md#31-session-renewal).
- [`useSessionRenewal`](../src/auth/useSessionRenewal.js) renews on **Capacitor's `resume`
  event** as well as `visibilitychange`. Both are wired, deliberately: `visibilitychange`
  usually fires in the WebView, but `resume` is the one that can be relied on after Android
  has killed and restored the activity. `renewIfDue()` is idempotent and returns immediately
  unless the token is inside its five-minute margin, so the overlap costs one comparison.
- A 401 that does slip through is renewed and the request replayed, invisibly. Only a dead
  refresh token produces a prompt, and that prompt is an overlay on the current screen — a
  phone user who has just typed a snapshot into a form does not lose it.

The refresh token is stored the same way and in the same place as the access token, under the
constraint above. The password is never written to disk.

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
[`MobileBottomNav`](../src/components/MobileBottomNav.jsx): **Analysis, Journal, Vault,
Profile**, and **Discretion**.

Discretion is a mode rather than a destination and still earns a slot, because of what it is
for: hiding names and notes when someone glances over. On a desktop that is `Ctrl+.`; on the
device you are actually holding when someone sits down beside you, it has to be one thumb-press
away or it does not work at all. The timeline is *not* a tab — it is a drill-down from a card.

**Journal is the fifth slot, and five is the ceiling.** Material's bottom bar takes three to
five destinations. At 360 dp — the narrowest screen this app targets — five equal slots
measure **72 × 56 dp** each, comfortably above the 48 dp minimum touch target, with no label
truncated (*Analysis* at 11 px is the widest word there). Measured in the browser at that
width on 2026-08-22, not estimated. A sixth would be 60 dp and still legal, but the labels
stop fitting; anything after this is a drill-down, not a tab.

The journal's own microphone button does **not** live in the bar. It floats bottom-right above
it on `/journal` only, inside the thumb's arc — the check-in button, which becomes a microphone
where voice is on (C3) and records through the native plugin on Android (C4, §6).

### 3.2 Screen-by-screen

| Web screen | Android treatment |
| :--------- | :---------------- |
| **Navbar** (5 items, top-right) | Title bar only: logo, server settings, logout. Navigation moves to the bottom bar. Short wordmark — the full one is 27 characters and overruns a 360dp screen. |
| **Landing** | Unchanged; already single-column and centred. |
| **Auth** | Unchanged layout. Fields get `inputMode`/`enterKeyHint`; the 16px rule below stops the zoom-on-focus jump. |
| **Dashboard grid** (`md:grid-cols-2 lg:grid-cols-3`) | Already responsive — collapses to one column unchanged. Header stacks; "New Analysis" takes the full width as the screen's primary action. |
| **Card stack** (wheel to scrub) | **Horizontal swipe**, plus a chevron pager under the stack. Vertical belongs to the page — see §3.3. Height becomes `min(70vh,500px)`; the pager's `3 / 7` replaces the depth cue the fanned cards give on a desktop. |
| **PersonForm modal** (`max-w-2xl`, 7 sliders) | Full-width sheet from the bottom. Each row gains a [vault dial](06-frontend.md#35d-vaultknob--the-thumb-operated-dial) at its left, and the range input keeps `touch-pan-y` so a scroll stays a scroll. |
| **AnalysisTimeline** (Recharts) | Unchanged component; Recharts' `ResponsiveContainer` handles the width. Legends wrap. |
| **Profile** | Two-column grid collapses. Gains the **check-in reminders** toggle, which has no web equivalent. |
| **Vault** | Unchanged; already a single narrow column. |
| **Journal** (`/journal`, `/journal/:day`) | Already a single narrow column and built for the handset first. The month strip wraps to as many rows as it needs; the day's cards are full-width. `pb-nav` on the app shell keeps the last card clear of the bottom bar. The check-in button is a microphone where voice is on, and on Android it records and transcribes through the native plugin (§6). The launcher shortcut into `/journal?record=1` arrives with 6-F. |
| **AppLock** | Unchanged, and works — `androidScheme: https` keeps `crypto.subtle` available. |

### 3.3 Inputs and touch

**The axis contract.** Three controls on the dashboard wanted a drag, and two of them wanted
the same axis the page scrolls with. That is not a threshold-tuning problem, and while it
lasted the app was genuinely unpredictable: a scroll started over a slider moved a score, and
a scroll started over a card sometimes riffled the stack instead. Every gesture now has one
owner, declared to the compositor with `touch-action` rather than argued about in JavaScript:

| Surface | `touch-action` | Vertical drag | Horizontal drag |
| :------ | :------------- | :------------ | :-------------- |
| The vault dial | `none` | Turns the dial | — |
| A ritual card (`/journal/ritual`) | `none` | Up skips the question | Right is yes, left is no |
| A category's range input | `pan-y` | Scrolls the page | Moves the score |
| A card stack | `pan-y` | Scrolls the page | Scrubs versions (≥45px) |
| The day graph (`/journal`) | `pan-y` | Scrolls the page | Turns the drawing (≥45px) |
| Anywhere else | default | Scrolls the page | — |

The reading rule behind the table: **vertical is the page's everywhere except where nothing
else on the screen wants it.** Two surfaces qualify, for two different reasons:

- **The vault dial** is a control small enough to land on deliberately, which is why the
  sliders could give the axis up without losing precise input.

The **day graph** takes the card stack's contract rather than inventing one: 45 px of
horizontal travel to turn, 12 px of vertical travel to hand the gesture back permanently, and
`touch-action: pan-y` on the plot so the compositor knows before JavaScript does. It also has
the card stack's pager equivalent — two rotate buttons — so the gesture is nobody's only way
in, and it gives the gesture back to the page at the last angle rather than swallowing a drag
that can no longer do anything. `DayGraph.test.jsx` dispatches the events and asserts *which*
of the page and the graph called `preventDefault`, which is the only way to test an axis
split. Design notes in
[Frontend §4be](06-frontend.md#4be-daygraphjsx--the-day-drawn).
- **The nightly ritual is the one *whole screen* that qualifies.** It is `fixed inset-0`,
  over the header and the bottom bar, and it does not scroll — so there is nothing under the
  card for a vertical drag to scroll, and the card may take everything. **The claim is
  conditional and the condition is on the line that makes it**: if the ritual ever grows a
  scrollable region, the card drops to `pan-y` and swipe-up-to-skip becomes the skip button
  only. A swipe that fights the page is worse than no swipe. `RitualCards.test.jsx` asserts
  that `touch-action: none` is on the card and on **none** of its ancestors, so a wrapper
  that quietly claimed the axis for the whole route would be caught. Design notes in
  [Frontend §2f](06-frontend.md#2f-ritualcardsjsx--journalritual-the-nightly-questions).

- **The vault dial.** A range input under a thumb is covered *by* the thumb, and what the
  thumb covers on this form is the anchor phrase explaining the number. The dial sits above
  and left of the track so the hand rests clear of both, and it clicks — a synthesised
  metallic detent per unit plus an Android selection haptic — so the value can be heard while
  the finger is on it. Full design notes in
  [Frontend §3.5d](06-frontend.md#35d-vaultknob--the-thumb-operated-dial).
- **A 22px slider thumb on coarse pointers.** The native one is ~14px, half the 24dp minimum,
  which is most of why placing a score by tapping the track was a game of chance. Scoped to
  `@media (pointer: coarse)` in `index.css`, so the desktop control is untouched.
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
| **The journal outbox** — the one exception to that | [`offlineCache.js`](../src/mobile/offlineCache.js) (the store) and [`JournalContext.jsx`](../src/context/JournalContext.jsx) (the queue) | A journal entry saved with no connectivity is kept, marked *not yet synced* in the day view, and posted later. Safe for one reason and only that reason — see below. Same store, own key (`alq:journal-outbox`), cleared on logout. |
| **Check-in reminders** | [`cadenceReminders.js`](../src/mobile/cadenceReminders.js) | Local notifications only — nothing is sent to a server, preserving the claim in `cadence.js` that due dates never leave the machine. Bound by that file's product rule: the body is `nudgeSentence()` verbatim, **no badge count**, one notification per relationship, scheduled for 10:00. |
| **The nightly ritual's reminder** | [`ritualReminder.js`](../src/mobile/ritualReminder.js) | The same module shape and the same rules, for the journal's hour (default 22:30). **One** notification, one fixed id, a fixed body that interpolates nothing. See below. |
| **The launcher shortcut** | [`shortcuts.xml`](../android-config/app/src/main/res/xml/shortcuts.xml) and [`deepLink.js`](../src/mobile/deepLink.js) | A long-press on the home-screen icon offers *Check in*, which opens `/journal?record=1`. Static, so there is no code and no background component behind it. See below. |
| **Hardware back button** | [`useNativeShell.js`](../src/mobile/useNativeShell.js) | Owned explicitly. Capacitor's default pops WebView history, which walks behind the React Router stack and can strand the app on a blank document. |
| **Haptics** | `usePullToRefresh`, [`knobFeedback.js`](../src/mobile/knobFeedback.js), `RitualCards.jsx` | One light tap when the refresh gesture arms; one **selection** haptic per committed ritual card, and none at all in discretion mode; a **selection** haptic per dial detent — the API Android tunes for picker wheels, where an `impact` per unit at thumb speed is a buzz rather than a click. Rate-limited to 32ms. |
| **Silent session renewal** | [`useSessionRenewal`](../src/auth/useSessionRenewal.js) | Renews on `resume`, which is when a token that has sat in the background for a week is most likely to be dead. See §2.3. |

Deliberately **not** built: swipe-to-delete on cards. Deleting a relationship removes its entire
history and the app already routes that through a confirm dialog naming the snapshot count. A
gesture with no confirmation step is the wrong affordance for that action.

#### The nightly reminder, the shortcut, and the two manifest entries behind them

Two ways into the journal that do not begin inside the app. Both are one intent, both open a
screen the app already has, and neither adds a process: **there is no background service in
this app, no widget, no wake word and no push channel.** The complete list of what runs when
the app is closed is one `AlarmManager` alarm owned by the local-notifications plugin.

**The reminder** ([`ritualReminder.js`](../src/mobile/ritualReminder.js), design §3.6 and §9.6):

| | |
| :- | :- |
| **What it says** | `JOURNAL_COPY.ritual.notification` — *"Tonight's questions are ready."* — with the feature's own heading as the title, and **nothing interpolated into either, ever**. Not the day, not a count, not a name, not last night's answers. A lock-screen notification is readable by anyone holding the phone, which is a different audience from the one that unlocked it. A unit test asserts the exact string, asserts that two different hours produce a byte-identical body, and lists the notification's fields so a later one that could carry content fails there first. |
| **When** | The hour in Journal settings, default 22:30, as the plugin's cron-like `schedule: { on: { hour, minute } }`. It re-arms itself, so it survives the app never being opened and follows the phone through a timezone change and the end of summer time. |
| **How many** | Exactly one, at one fixed id (`RITUAL_NOTIFICATION_ID`). Rescheduling **replaces** it — the plugin keys both its storage and its `PendingIntent` on the id — and turning the ritual off cancels it. A fortnight of unopened nights is one pending row, not fourteen. |
| **No badge** | For `cadence.js`'s reason: a number on the launcher icon is a count of missed nights by another name, and §3.6 says a missed night is nothing. |
| **The permission** | `POST_NOTIFICATIONS` is requested when the ritual is switched on in Profile, and never at launch. A refusal costs the reminder and not the feature — the ritual is a screen — and `syncRitualReminder()` at launch only ever *checks*, so nothing prompts on a cold start. |
| **The two channels** | Cadence and the ritual now share one pending list. Neither may cancel the other's work: `cadenceReminders`' `cancelAll` skips the ritual's id and the ritual cancels by id. Without that, every dashboard visit would have quietly unscheduled tonight's reminder, which on a device looks exactly like Android dropping alarms. |
| **On the web** | Nothing. §3.6 gives the dashboard one line in the cadence nudge's slot instead, and the two in-app nudges never show at once (`RitualCards.jsx` owns the slot). |

**The shortcut** ([`shortcuts.xml`](../android-config/app/src/main/res/xml/shortcuts.xml),
design §9.2):

- **Static, not dynamic.** A row in a resource file, resolved by the launcher, right from the
  first launch and correct on a phone that has never been opened. A dynamic shortcut would
  mean code publishing it at runtime and keeping it in step.
- **It opens `/journal?record=1`, which arms and does not start.** The composer comes up with
  the microphone where the device offers one and the keyboard where it does not — the same
  choice the header button and the FAB make — and the recording begins on the confirming tap
  inside the sheet. A long-press on a home screen is too easy to make by accident to be
  allowed to open a microphone by itself. The day view waits for the tier report before
  deciding, because on Android that answer lands a moment after mount, and it then consumes
  the parameter so that closing the sheet does not re-open it.
- **The intent is explicit** — it names this package and this activity — so no
  `<intent-filter>` is added for its URL. A filter would publish the scheme to every other app
  and every browser on the device in exchange for nothing.
- **Two labels that cannot live in `JOURNAL_COPY`.** A launcher reads them before any
  JavaScript exists, so they are the only user-visible strings in the app that the
  forbidden-word walk cannot see. The short one is `JOURNAL_COPY.checkin.open` word for word.

**Where a deep link lands.** Both channels hand one path to
[`deepLink.js`](../src/mobile/deepLink.js), which accepts **only** the two this app itself
declared — `/journal/ritual` and `/journal?record=1` — and refuses everything else.
`MainActivity` is exported because it is the launcher activity, so any installed app can send
it an intent; which screen opens is not a decision to hand to one. The listener is registered
by `useNativeShell`, inside `Shell`, which `AppLock` renders **only when the lock is open** —
so a reminder tapped on a locked phone reaches the lock screen and stops there, and the ritual
opens once the passphrase is accepted (Capacitor retains an event that has no listener and
delivers it to the first one to register). That ordering is §9.6's *"the deep-link lands on the
lock screen first"*, and `deepLink.test.jsx` tests it rather than trusting it.

**The manifest** ([`AndroidManifest.xml`](../android-config/app/src/main/AndroidManifest.xml)):

| Change | Line | Why |
| :----- | :--- | :-- |
| CHANGE 4 | `<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />` | Both notification channels, requested at opt-in and never at launch. Its comment now names the ritual beside the cadence. |
| CHANGE 6 | `<meta-data android:name="android.app.shortcuts" android:resource="@xml/shortcuts" />` on `MainActivity` | What makes a launcher read `shortcuts.xml`. It has to sit on the activity that owns the MAIN/LAUNCHER filter. |

Deliberately absent from the manifest and worth stating: no `<service>`, no `<receiver>` of
this app's own, no `SCHEDULE_EXACT_ALARM`, and no `<intent-filter>` for the shortcut's URL. The
alarm falls back to an inexact one where the platform requires the permission, which for a
bedtime reminder is the right trade.

#### The journal outbox: why the exception exists, and how far it goes

The row above the cache says the app does not queue writes. The row below it says the journal
does. Both are true, and the difference between them is one property of one endpoint.

`POST /api/journal/entries` is **idempotent on a client-minted `client_id`**: the client mints a
UUID before the first attempt, the first post stores the row and answers `201`, and every later
post of that same `client_id` answers **`200` with the row already stored** — not `201` with a
second one, and not `409`. So a retry cannot duplicate, and the queue never has to know whether
the attempt that timed out got through. That is the whole safety argument. Nothing else about
the journal is special; take that property away and this feature is unsafe the same day.

The snapshot path has no such property — `POST /api/subjects` creates a row and resolves its
relationship by name, so a replayed write is a second analysis — which is why the cache above
stays read-through.

The scope, which is narrow *because* narrow is what makes it safe:

| | |
| :- | :- |
| **What is queued** | Journal entries only, and only new ones. An entry carrying `supersedes_id` is an edit of a row the server already holds, and it is not queued: **no offline edit, no offline delete**. A correction of an entry that is still *in* the queue replaces it there, keyed by `client_id`. |
| **What is not** | Snapshots, relationships, ritual settings, anything else. There is no general sync engine and no conflict resolution. |
| **When it posts** | On the next fetch that comes back (which is also what pull-to-refresh calls), and on `resume`. One flush at a time. |
| **When it stops** | A transport failure keeps everything queued for the next signal. A response — a `400` naming a field, a `404` for a person deleted elsewhere — means the server read the body and refused it, so the item stops being retried, keeps the server's message, and stays visible on the day with it. Nothing the user wrote is dropped silently. |
| **Where it lives** | `localStorage`, key `alq:journal-outbox`, native only. Cleared when the provider is disabled, which is both a deliberate sign-out and a session that died. |
| **What it is not** | It is a queue for *writes*. There is no read-through cache for the journal: a day that cannot be fetched says so. |

Under docs/13, the queued body would be the same ciphertext the row is — the outbox stores what
it is handed and never inspects `payload`. That envelope is session E1's and is conditional.

The design is [`06-emotional-journal.md` §9.5](../product_vision/06-emotional-journal.md#95-offline-the-one-deliberate-exception-to-no-offline-writes);
the provider's side of it is in [`docs/06-frontend.md`](06-frontend.md).

---

## 4. Layout and build

```
capacitor.config.json        appId, androidScheme, CapacitorHttp — the native config
Dockerfile.android           containerised APK/AAB build; needs no local Android SDK
android-config/              committed native files, overlaid onto the generated project
  app/src/main/AndroidManifest.xml
  app/src/main/res/xml/network_security_config.xml
  app/src/main/res/xml/shortcuts.xml            the launcher's Check in shortcut (§3.4)
  app/src/main/res/values/shortcuts_strings.xml its two labels
plugins/alq-journal/         the journal's native plugin — a local Capacitor package (§6)
android/                     GENERATED, gitignored — never hand-edit
src/mobile/                  the platform layer
  platform.js                isNative / isAndroid predicates
  knobFeedback.js            the vault dial's click and haptic
  serverUrl.js               base URL, synchronously; asset rebasing
  useNativeShell.js          back button, status bar, keyboard, the tier report
  usePullToRefresh.js        pull-to-refresh over the document scroller
  offlineCache.js            last-known-good subject list; the journal outbox's store
  cadenceReminders.js        local notifications for the check-in rhythm
  ritualReminder.js          the journal's one nightly local notification
  deepLink.js                the two paths an intent may name, and nothing else
  journalPlugin.js           the journal plugin's JS side: capture deps, downloader, tier
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
Native *code* is different: the journal plugin is its own Gradle module under `plugins/`,
registered by `cap sync` rather than overlaid (§6.8).

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

## 6. The journal's native plugin

The Emotional Journal's voice check-in (Phase 6, slice 6-C) is the one feature the WebView
cannot carry on its own: it has no WebGPU for a model, and the design forbids audio crossing
the WebView bridge as a base64 string ([§4.2, §5.5](../product_vision/06-emotional-journal.md)).
So there is one native plugin — [`plugins/alq-journal/`](../plugins/alq-journal/), registered
by `npx cap sync` like any `@capacitor/*` package — and it is **deliberately narrow**. Its whole
surface is five capabilities, and everything above it is the one React app: C2's recorder
state machine, C3's download manager, the settings, the copy, the Vault page and the decision
of which tier a device is on all run unchanged. A wide plugin is how the one React app stops
being one app (§12.2).

### 6.1 The five calls

| Capability | Plugin methods | What crosses the bridge |
| :--------- | :------------- | :---------------------- |
| **Record** | `startCapture({ maxMs })`, `stopCapture()`, `abortCapture()`, `releaseClip({ handle })`; events `level { rms }` every 50 ms and `captureEnded { handle, … }` when the native cap fires | A **handle** (`clip-3`) and a sample count. The floats stay in the plugin's memory. |
| **Transcribe** | `transcribe({ handles, language, model: { id, files: [{ path }] } })` → `{ text, language, tokens, durationMs }` | Handles in, words out. |
| **Propose** | `propose({ handles \| text, system, schema, language, maxTokens, idleUnloadMs, model: { id, bundle }, audio })` → `{ text, durationMs, loadMs }`, plus `loadProposer` and `releaseProposer` | Handles or a transcript in, **the model's own JSON string** out. The prompt and the schema come *down* from `src/journal/inference/`; nothing about what the journal means is decided here. |
| **Report memory and tier** | `tier()` → `{ totalMemoryBytes, availableMemoryBytes, lowRamDevice, apiLevel, model, manufacturer, androidVersion, cores }` | Numbers. The mapping to `full` / `light` / `text-only` is `tierFromMemory` in [`tier.js`](../src/journal/inference/tier.js), beside the web one, so §5.5's boundaries have one home and one test. |
| **Embed** | `embed()` — **still rejects `unavailable`, and G1 did not change that** | — |

*Five capabilities, and `propose` stopped being a stub in D3.*

> **`embed` is the one that is still a stub, and G1 shipped around it rather than through it.**
> The similar-entry index (§5.8) is **web-only for now**: `embeddingsAvailable()` in
> [`availability.js`](../src/journal/embeddings/availability.js) refuses the setting inside the
> Android shell, so the phone shows the toggle disabled with a sentence saying why rather than
> a switch that stores `true` and does nothing. Adding it is a Kotlin change with a Gradle
> build behind it — EmbeddingGemma through ONNX Runtime beside Whisper — and it is written in
> that file as a **missing runtime** rather than as a platform opinion, so the session that
> adds one deletes a condition rather than arguing with a rule.
>
> **G2 raised the cost of that gap**, and the honest way to say it is that the phone is now
> missing more than a suggestion. `/journal/search` is behind the same switch, so a handset has
> no recall at all — and half of that screen, the lexical half, needs no model whatsoever. It
> is not offered separately on any platform (§9.7 gives the feature one control, and a search
> that worked while the toggle said off would make the Vault page untrue), so the phone loses
> it with the rest. Whoever adds `embed` gets the search back for free: nothing in
> `recall.js` or `JournalSearch.jsx` knows what platform it is on.

Beneath `transcribe` sits the **weight store** it cannot work without — `fetchModel({ id,
baseUrl, files: [{ path, bytes, sha256 }] })` with a `fetchProgress` event, `cancelFetch`,
`modelStatus` and `removeModel`. It is plumbing, not a sixth capability: the pins go *in*
from [`models.js`](../src/journal/inference/models.js), which stays the one manifest, and the
plugin hashes what it is told to hash. `embed` still refuses rather than answering nothing,
for the reason `propose` did until D3: a silent stub is how a tier ends up looking available on
a device that has no model for it.

**`propose` is Gemma 4 E2B through LiteRT-LM** (`com.google.ai.edge.litertlm:litertlm-android`
0.16.1, Apache-2.0), in
[`gemma/GemmaProposer.java`](../plugins/alq-journal/android/src/main/java/com/thinkmusic/alexithymia/journal/gemma/GemmaProposer.java).
One `Engine` is held across a check-in and its corrections and a fresh `Conversation` is created
per pass — the system prompt carries this user's own people and trigger labels and those change
between check-ins, and a held conversation would also label the second note in the light of the
first, which is a memory nobody asked this feature to have. Sampling is greedy, so the same
words produce the same proposal twice and *This isn't it* is not a slot machine.

**Constrained decoding is real here and not on the web.** `ResponseFormat.json(schema)` puts
LLGuidance in front of the sampler, so the model cannot emit tokens outside the §5.2 shape —
and the schema handed down is `PROPOSAL_GRAMMAR_SCHEMA`, which differs from the strict one in
exactly one field. D3 measured why: handed the strict schema, generation died on
`"routine period"` — a real context tag — with `token "▁period" doesn't satisfy the grammar`,
because Gemma's tokeniser carries the space inside the token and LLGuidance's forced-bytes path
cannot line the two up. Three of the seven context tags contain a space. `tag` therefore reaches
the grammar as a bounded string and reaches the card as a member of `CONTEXT_TAGS`, because
`validateProposal` runs above regardless — a grammar is a guarantee about tokens, not about
meaning.

**Three API facts the spike paid for, so nobody pays again.** The audio bytes must be a
**RIFF/WAVE container** — raw PCM is not decoded, which is why
[`gemma/Wav.java`](../plugins/alq-journal/android/src/main/java/com/thinkmusic/alexithymia/journal/gemma/Wav.java)
exists to put a 44-byte header on the recorder's samples. `extraContext` on `sendMessage` is
**non-null in Kotlin**, and `null` throws from inside the intrinsics in a way that reads like a
runtime fault. And `Conversation.getBenchmarkInfo()` throws unless the engine was built with
benchmark parameters, which `EngineConfig` cannot set — so the plugin times the call itself.

**The model is let go.** `unloadAfter(idleUnloadMs)` closes the engine two minutes after the
last pass (§12.1's battery row), `handleOnStop` closes it when the app is put away, and
`releaseProposer` closes it on request. The timer lives in Java because the memory does: a
WebView torn down mid-check-in must not leave 2.6 GB resident, and a promise nobody is waiting
on cannot be relied upon to arrive.

On the JavaScript side, [`src/mobile/journalPlugin.js`](../src/mobile/journalPlugin.js) holds
the `registerPlugin` call and three adapters: `nativeCaptureDeps()` (C2's recorder's `deps`,
so `createRecorder` drives the plugin exactly as it drives `MediaRecorder`),
`createNativeDownloader()` (C3's download manager's surface over the store), and
`primeNativeTier()` (one read of the memory report at launch). [`inference/native.js`](../src/journal/inference/native.js)
is the runtime behind the C2 seam. `createVoiceKit()` in `VoiceCheckin.jsx` picks the native
trio on a native platform, and nothing above it knows which trio it holds.

### 6.2 The permission policy

`RECORD_AUDIO` is declared in [the app manifest](../android-config/app/src/main/AndroidManifest.xml)
(CHANGE 5) and **requested at the first tap of the microphone, never at launch** — the same
reasoning the manifest gives for `POST_NOTIFICATIONS`: a prompt before the user has seen what it
is for is the reliable way to get it denied permanently. The request lives in one place, the
recorder's `requestStream`, and asks in the order Capacitor expects — `checkPermissions`, then
`requestPermissions` only if needed, then `startCapture` — and the plugin's `startCapture`
**refuses to open the device without the grant** regardless of who calls it, so no code path
can record without having asked. `journalPlugin.test.js` asserts the call order against a fake,
which is the one thing a device could not be made to prove on demand.

A denial is not an error. It rejects with `NotAllowedError`, which the recorder already reads as
its `permission` state and `VoiceCheckin` already answers with a calm sentence and the typed
path — no dialog, no `alert`, the chip grid untouched.

Two consequences that are easy to undo by accident:

- **There is no foreground service and no `FOREGROUND_SERVICE_MICROPHONE`.** Nothing captures
  in the background: recording stops on a tap, on two seconds of silence, or at thirty seconds
  (the native side ends the capture itself at `maxMs`, so a stalled WebView cannot leave the
  microphone open), and the plugin aborts any capture the moment the activity pauses. A
  foreground service would make the Vault's *"Does it listen?"* answer false.
- **The permission prompt is not the background.** On Android the prompt is an activity of its
  own, so showing it pauses the app and Capacitor fires `appStateChange`. `watchLifecycle` in
  the recorder therefore leaves a recorder in `requesting` alone on a native platform — nothing
  has been captured yet, and a discard there would cancel the very request the user is in the
  middle of granting. In `recording` a background still throws the audio away.

### 6.3 Audio never crosses the bridge

`startCapture` opens `AudioRecord` at 16 kHz mono float (`VOICE_RECOGNITION` source, which
the platform keeps flat — the native form of the web build's "no processing" constraints) and
fills a buffer in the plugin's memory. `stopCapture` hands JavaScript a handle. What the
recorder holds as `clip.audio` on Android is an object that quacks like a `Float32Array` for
exactly the two things the recorder does with one — `length` and `fill(0)` — and `fill(0)`
releases the native buffer, which is zero-filled before it is forgotten (the same rule the
recorder's own discard follows). The native runtime sends the handles to `transcribe`. There is
no base64, no blob, no file: a killed process takes every clip with it, which is what §4.2
promises. The level meter is the RMS of the last 1,024 samples, on the same 0…1 scale as the
web meter, so `SPEECH_LEVEL` and `SILENCE_LEVEL` mean the same thing on both platforms.

### 6.4 Transcription: the same Whisper, natively

The Light tier's transcriber on Android is **the same pinned Whisper tiny ONNX export the web
build loads**, run through ONNX Runtime for Android **1.24.3** — the version C3 pinned for
`onnxruntime-web` after finding the dev build transformers.js ships does not load this model.
There is no transformers.js on Android, so the plugin's Java does what it does: the log-mel
spectrogram ([`LogMel.java`](../plugins/alq-journal/android/src/main/java/com/thinkmusic/alexithymia/journal/whisper/LogMel.java)),
the byte-level BPE decode and the generation settings read from the pinned `vocab.json` and
`generation_config.json` ([`WhisperTokens.java`](../plugins/alq-journal/android/src/main/java/com/thinkmusic/alexithymia/journal/whisper/WhisperTokens.java)),
and one encoder pass, language detection, and greedy decoding with the merged decoder's KV
cache ([`WhisperTranscriber.java`](../plugins/alq-journal/android/src/main/java/com/thinkmusic/alexithymia/journal/whisper/WhisperTranscriber.java)).

None of that is Android-specific, and that is the point: C4 ran the same classes on a desktop
JVM against the pinned files and three synthesised sentences, and they produced **word-for-word
the transcripts transformers.js produces** for the same audio, with the spectrogram matching a
NumPy port of PyTorch's to 1.2 × 10⁻⁵. One protocol detail of this export is worth knowing
before touching the loop: in the cache branch the decoder's encoder-side `present` tensors come
back **empty** (`[0, 6, 1, 64]`) and must be replaced by the ones from the first pass — feeding
the empty ones back breaks cross-attention silently, and the first prototype did exactly that.

One departure from a bare greedy loop, stated so a later session can remove it: a tail that
repeats itself (the same one-to-eight-token span three times running) stops the loop and keeps
one copy. Whisper tiny falls into that loop on poor audio, and on a phone every looped token is
time and heat spent on nothing. It removes only words the model already repeated and never adds
one; the web path has no such guard, and D4's golden suite is where the two get compared.

The ONNX session is opened on the first `transcribe` and closed when the app leaves the screen
(`handleOnStop`), when the files are removed, and with the process — about 100 MB a hidden app
has no use for, and the next take reopens it in well under a second.

### 6.5 The weight store

Weights are **not in the APK** (§5.6; Play asset packs are the option if the app is ever
distributed through Play, and that is not this phase). They are fetched from the configured
server's `/models/` — the same channel C1 built and the same 13 files, pinned by length and
SHA-256 — into `files/models/` in the app's private directory, which `allowBackup="false"` keeps
off Google's backup. [`ModelStore.java`](../plugins/alq-journal/android/src/main/java/com/thinkmusic/alexithymia/journal/ModelStore.java)
follows C3's rules exactly: size and cancel before anything moves, length checked before the
hash (the SPA answering `200` with HTML for a missing weight is caught there), **a wrong sum
deletes what was fetched and reports `checksum` with no way past it**, and cancel keeps the
partial `.part` file so the next attempt resumes with a `Range` request rather than starting
over. On the JVM harness every case ran against a local Range-capable server: a cold fetch, a
warm no-op, cancel-and-resume (a `206` from the byte the cancel stopped at), a tampered file of
the same length, the SPA fall-through, a 404 and a path escape.

Nothing here reads the session token, and the only URL the plugin ever opens is
`<server>/models/<path>`. The network security config is unchanged: this is the one new thing
that talks to the network, over the same cleartext-on-LAN trade-off §2.4 documents.

### 6.6 The tier

`tier()` reads `ActivityManager.getMemoryInfo().totalMem` and `isLowRamDevice()`. It is read
once when the app shell mounts (`useNativeShell`) and again by any screen that got there first;
it asks for no permission. The WebView's own `navigator.deviceMemory` is **not** used on Android:
it rounds down to a power of two, so a 6 GB phone reads as 4 — the exact mistake the plugin
exists to avoid.

`tierFromMemory` rounds the reported bytes **up** to whole gigabytes (a "4 GB" phone reports
about 3.6 GiB; the box is what §5.5's table was written against) and applies the design's
boundaries unchanged: below 4 GB text-only, 4 to under 6 Light, 6 and up Full; `isLowRamDevice`
wins whatever the number says. The floor is 4 GB because D3's text-mode Gemma needs it, not
because Whisper does — Whisper tiny would run on less — and keeping it there means a phone that
has voice today does not lose it the day proposals arrive. The settings screen says which
number it read (*"This phone reports 8 GB of memory."*) and C3's override still only goes down.

**D3 added one condition and moved no boundary: the Full tier needs a 64-bit ABI.**
`litertlm-android` ships `liblitertlm_jni.so` for **arm64-v8a and x86_64 only** — verified
inside this build's own APK, where they are 21.5 MB and 25.6 MB and there is no `armeabi-v7a`
entry, while ONNX Runtime's is there for all four. So a 32-bit phone runs the Light tier however
much memory it has, and it does so for a reason nobody can fix by closing apps. `tier()` now
reports `abi64` from `Build.SUPPORTED_64_BIT_ABIS`, and `tierFromMemory` reads an **absent**
`abi64` — every report written before D3 — as "unknown", not as "no".

**The memory question §5.5 asked is still open, and D3 says so rather than estimating it.** The
absolute peak of a Full-tier pass on the oldest supported phone needs a phone. What D3 could
measure off-device is the audio encoder's *marginal* cost — **169 MB**, 3,291 MB with it against
3,122 MB without, on an x86-64 CPU — which answers the question the boundary actually turns on:
the encoder is not what sets it.

### 6.7 What is deliberately not offered

The platform `SpeechRecognizer` (§5.5 option D) is **not** offered, even behind
`createOnDeviceSpeechRecognizer` on API 31+. The Vault page names one model and one licence —
Whisper tiny, Apache 2.0, downloaded once from this server — and an OEM's recogniser is neither,
would need a third Vault variant to describe honestly, and its on-device guarantee cannot be
checked without a device. Zero download was its only argument, and 45 MB is not the cost that
argument was written for. If it is ever added, it is one more `engine` on `transcribe` and a
named row in Settings, and nothing else moves.

### 6.8 Where things live, and how the build finds them

```
plugins/alq-journal/                     the plugin — a local Capacitor package, `file:` dependency
  package.json                           `capacitor.android.src`, which is how `cap sync` finds it
  android/build.gradle                   the module; owns the one dependency (onnxruntime-android)
  android/src/main/java/…/journal/
    JournalPlugin.java                   @CapacitorPlugin("AlqJournal") — the five calls and the store
    AudioCapture.java                    AudioRecord, 16 kHz mono float, the level, the native cap
    ClipStore.java                       clips by handle; zero-filled on release
    ModelStore.java                      fetch · resume · verify · remove (plain Java)
    TierProbe.java                       ActivityManager → the report
    whisper/LogMel.java                  the spectrogram (plain Java)
    whisper/WhisperTokens.java           vocabulary, byte decoder, generation settings (plain Java)
    whisper/WhisperTranscriber.java      ONNX Runtime: encode, detect, decode (plain Java)
src/mobile/journalPlugin.js              registerPlugin + the three adapters
src/mobile/journalPlugin.fake.js         the fake, tests only
src/journal/inference/native.js          the runtime behind the C2 seam
```

`npx cap sync android` writes the plugin into `capacitor.plugins.json` (Capacitor finds the
`@CapacitorPlugin` class by reading the module's source) and into `capacitor.settings.gradle`,
so nothing generated is overlaid for it beyond `RECORD_AUDIO` in the manifest.
`Dockerfile.android` copies `plugins/` **before** `npm ci` in both stages — a lockfile naming a
`file:` path the build context does not yet hold fails with an unhelpful `ENOENT`. The ONNX
Runtime AAR adds roughly 15 MB of native libraries to the APK; the 27 MB of ONNX Runtime
WebAssembly C3 put in `dist/` is bundled too and never runs on Android, which is recorded as a
follow-up rather than fixed here.

`make android-logs` includes the `AlqJournal` tag: every model fetch the plugin starts and
every capture or transcription that fails is one line under it. The airplane-mode check
(§11 of the design document) reads exactly that: record, transcribe, save, and nothing under
`AlqJournal` mentions a URL.

---

## 7. Not done

Honest list, so none of it reads as an oversight:

- **No release signing config in Gradle.** `bundle-android` signs with `jarsigner` after the
  fact, deliberately: `android/` is regenerated on every build, and keeping the keystore out
  of the Gradle files keeps it out of the build context and therefore out of any image layer.
- **No biometric unlock.** The app lock is a passphrase over `crypto.subtle`; binding it to
  the Android Keystore would need a native plugin and is the one place a rewrite argument
  (§1) has real force.
- **No offline writes.** See the note in §3.4.
- **No CI target.** `.github/workflows/` builds nothing today; `make build-android` is a
  single self-contained command and would drop into a workflow as-is.
- **No app icon or splash.** The Capacitor placeholder ships. `@capacitor/assets` generates a
  full set from one source image.
- **Not tested on a physical device.** The web bundle, the unit suite, the native project
  generation, and the containerised APK build are all verified; behaviour on real hardware is
  not. That includes the whole of §6: the plugin's Java core was run on a desktop JVM against
  the real model files, the JavaScript half against a fake plugin, and the APK was built — but
  no one has tapped the microphone on a phone. It also includes everything in §3.4 that only
  a device has: the journal outbox, the nightly reminder actually arriving at 22:30, and the
  launcher offering the shortcut on a long-press. All three are covered by tests behind a
  mocked platform, and none has been seen. The device checklists are in the C4, F1 and F2
  entries of the Phase 6 ledger (`git show 49e2266:product_vision/06-progress.md`).
- **No platform speech recogniser.** §6.7 says why; it is a decision, not a gap.
