# `android-config/` — the native overlay

`android/` is a **generated** directory. `npx cap add android` writes it from the template
inside `node_modules/@capacitor/android`, and the containerised build in
[`Dockerfile.android`](../Dockerfile.android) regenerates it from scratch on every run so that
a build is reproducible from a clean checkout.

Anything hand-edited inside `android/` is therefore at risk. This directory is the answer:
its contents are copied over `android/` immediately after generation, by both
`make android-init` and the Docker build. It mirrors the `android/` layout exactly, so
adding a file here is the same as adding it there.

```
android-config/app/src/main/AndroidManifest.xml            → android/app/src/main/AndroidManifest.xml
android-config/app/src/main/res/xml/network_security_config.xml → android/app/src/main/res/xml/…
android-config/app/src/main/res/xml/shortcuts.xml          → android/app/src/main/res/xml/…
android-config/app/src/main/res/values/shortcuts_strings.xml → android/app/src/main/res/values/…
```

Only the manifest is a **whole-file replacement**. The other three are additions: Android
merges every file under `res/values/`, so the shortcut's two labels live in their own file
rather than in an overlay of the generated `values/strings.xml`, which Capacitor writes from
`capacitor.config.json` and which would then have to be re-derived after every upgrade.

## What is *not* here: the journal plugin

The Emotional Journal's native code — the microphone, the on-device transcriber, the weight
store and the tier report — is **not** an overlay. It is a local Capacitor plugin in
[`plugins/alq-journal/`](../plugins/alq-journal/), referenced from `package.json` as a `file:`
dependency, and `npx cap sync android` registers it the way it registers `@capacitor/haptics`:
by finding the `@CapacitorPlugin` class and writing it into `capacitor.plugins.json`. Its
Gradle module owns its one dependency (ONNX Runtime), so nothing generated has to be edited
for it and a Capacitor bump does not have to re-derive `app/build.gradle`. The only line the
plugin needs in this directory is `RECORD_AUDIO` in the manifest (CHANGE 5), kept here so
every permission the APK asks for is readable in one file. See
[docs/12-android-app.md §6](../docs/12-android-app.md).

## Keeping the manifest in step with Capacitor

`AndroidManifest.xml` here is Capacitor 8's template plus the six annotated changes its
header lists (`allowBackup`, `networkSecurityConfig`, `usesCleartextTraffic`,
`POST_NOTIFICATIONS`, `RECORD_AUDIO`, and the `android.app.shortcuts` meta-data that makes a
launcher read `res/xml/shortcuts.xml`). It is a **whole-file replacement**, not a
patch, which means a Capacitor major upgrade can silently drop whatever the new template
added.

After bumping `@capacitor/android`, diff them:

```bash
rm -rf android && npx cap add android          # regenerate from the new template
diff android/app/src/main/AndroidManifest.xml android-config/app/src/main/AndroidManifest.xml
```

Everything the generated file has and this one does not is a change to carry across.
