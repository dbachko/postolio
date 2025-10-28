**Trusted Web Activity (TWA) Wrapper: DayNight Splash**

Use a TWA to ship the PWA as an Android app with a fully theme-aware splash screen and system UI that follows the device theme (light/dark). This avoids the limitation of the web manifest splash and removes white flashes during startup.

**What You Get**

- OS theme-aware splash/background via Android DayNight themes
- Status and navigation bars that match light/dark
- First-class Android app (Play Store eligible) that opens your PWA fullscreen

**Prerequisites**

- A PWA at `https://postolio.example/` with a service worker and a valid `manifest.json`
- Node 18+, JDK 17, Android SDK + Platform Tools (API 34+)
- Domain control to host `/.well-known/assetlinks.json`

**1) Install Bubblewrap (recommended tooling)**

- `pnpm dlx @bubblewrap/cli@^1.17.0 --version`

Initialize from your live manifest (or a local path while iterating):

- `pnpm dlx @bubblewrap/cli init --manifest=https://postolio.example/manifest.json`

Notes:

- Choose a unique package id (e.g., `io.postolio.app`).
- Accept the defaults where reasonable; you can re-run `bubblewrap update` later to sync changes.

**2) Build and install the debug APK**

- `pnpm dlx @bubblewrap/cli build`
- `pnpm dlx @bubblewrap/cli install` (device must be connected with USB debugging)

Open the app on the device; you should see your PWA. To remove the verification bar and unlock TWA features, set up Digital Asset Links next.

**3) Digital Asset Links (required for “Trusted” state)**

- Get the SHA256 fingerprint of your signing key:
  - `pnpm dlx @bubblewrap/cli fingerprint`
  - or `keytool -list -v -keystore <your_keystore>.jks -alias <alias>`
- Create `/.well-known/assetlinks.json` on your domain with the fingerprint and package id:

```
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "io.postolio.app",
      "sha256_cert_fingerprints": [
        "AB:CD:EF:12:34:56:78:90:...:ZZ"
      ]
    }
  }
]
```

- Place it at `packages/apps/web/public/.well-known/assetlinks.json` and redeploy. Visit `https://postolio.example/.well-known/assetlinks.json` to verify it is publicly accessible.
- Reinstall and launch the app; the verification bar should disappear once Chrome verifies the file.

**4) Enable OS theme-aware splash and system UI**

Bubblewrap creates an Android project with a `twa-manifest.json`. Sync it, then set both light and dark values so it can map to Android’s DayNight theme:

Edit `android/twa-manifest.json` (path is created by Bubblewrap):

```
{
  "themeColor": "#FFFFFF",
  "themeColorDark": "#0B0B0F",
  "navigationColor": "#FFFFFF",
  "navigationColorDark": "#0B0B0F",
  "backgroundColor": "#FFFFFF",
  "backgroundColorDark": "#0B0B0F",
  ...
}
```

Then apply the manifest to the Android project and rebuild:

- `pnpm dlx @bubblewrap/cli update`
- `pnpm dlx @bubblewrap/cli build`

On Android 12+, the splash uses the system SplashScreen API. On older versions, the theme’s window background is shown. For both, configure DayNight themes as below.

**5) Configure DayNight themes in Android project**

Bubblewrap generates `android/app/src/main/res/values/themes.xml`. Update the app theme to Material 3 DayNight and set splash, status, and nav colors. Add a matching `values-night/themes.xml` for dark mode overrides.

Create or edit `android/app/src/main/res/values/themes.xml`:

```
<resources>
  <style name="Theme.Postolio" parent="Theme.Material3.DayNight.NoActionBar">
    <!-- System bars (light) -->
    <item name="android:statusBarColor">@color/system_bar_bg</item>
    <item name="android:navigationBarColor">@color/system_bar_bg</item>

    <!-- Android 12+ Splash API -->
    <item name="android:windowSplashScreenBackground">@color/splash_bg</item>
    <item name="android:windowSplashScreenAnimatedIcon">@mipmap/ic_splash</item>

    <!-- Pre-Android 12 fallback background -->
    <item name="android:windowBackground">@color/splash_bg</item>
  </style>
</resources>
```

Create `android/app/src/main/res/values-night/themes.xml`:

```
<resources>
  <style name="Theme.Postolio" parent="Theme.Material3.DayNight.NoActionBar">
    <!-- System bars (dark) -->
    <item name="android:statusBarColor">@color/system_bar_bg</item>
    <item name="android:navigationBarColor">@color/system_bar_bg</item>

    <!-- Splash (dark) -->
    <item name="android:windowSplashScreenBackground">@color/splash_bg</item>
    <item name="android:windowBackground">@color/splash_bg</item>
  </style>
  <!-- Optional: ensure light icons on dark bars -->
  <style name="ThemeOverlay.Postolio.DarkBars" parent="">
    <item name="android:windowLightStatusBar">false</item>
    <item name="android:windowLightNavigationBar">false</item>
  </style>
  <!-- Apply overlay via activity theme if desired -->
</resources>
```

Define colors in both `values/colors.xml` and `values-night/colors.xml`:

```
<!-- values/colors.xml (light) -->
<resources>
  <color name="system_bar_bg">#FFFFFF</color>
  <color name="splash_bg">#FFFFFF</color>
</resources>
```

```
<!-- values-night/colors.xml (dark) -->
<resources>
  <color name="system_bar_bg">#0B0B0F</color>
  <color name="splash_bg">#0B0B0F</color>
</resources>
```

Add an adaptive splash icon (monochrome or brand) for the splash animation:

```
<!-- res/mipmap-anydpi-v26/ic_splash.xml -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/splash_bg" />
  <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
```

Finally, set the application theme in `AndroidManifest.xml` to `Theme.Postolio`.

**6) Test OS theme behavior**

- Toggle device dark mode and launch the app; splash and bars should follow.
- Test Android 12+ and pre-12 devices/emulators.
- Confirm no white flash between the app splash and web content; the PWA content background should match your chosen dark/light.

**7) Release and maintenance**

- Create a release keystore and configure Bubblewrap signing.
- Upload AAB to Play Console; keep `assetlinks.json` in sync with the release fingerprint.
- Keep TWA `twa-manifest.json` values aligned with your PWA brand colors.

**Good-to-knows**

- TWA loads your PWA URL; make sure your service worker caches core assets for quick paint.
- The Android splash is independent from the web manifest splash; Android uses your app theme, so it can be truly theme-aware.
- If you host staging at a different origin, generate a separate TWA or host staging `assetlinks.json` with its own package id and keystore.

**Next Steps (we can do for you)**

- Scaffold the Bubblewrap project pointing at `https://postolio.example/`.
- Add `packages/apps/web/public/.well-known/assetlinks.json` from the generated fingerprint.
- Wire up DayNight themes and splash icon, then produce a signed AAB for testing.
