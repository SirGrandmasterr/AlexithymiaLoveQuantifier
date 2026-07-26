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
```

## Keeping the manifest in step with Capacitor

`AndroidManifest.xml` here is Capacitor 7's template plus two attributes
(`networkSecurityConfig`, `usesCleartextTraffic`). It is a **whole-file replacement**, not a
patch, which means a Capacitor major upgrade can silently drop whatever the new template
added.

After bumping `@capacitor/android`, diff them:

```bash
rm -rf android && npx cap add android          # regenerate from the new template
diff android/app/src/main/AndroidManifest.xml android-config/app/src/main/AndroidManifest.xml
```

Everything the generated file has and this one does not is a change to carry across.
