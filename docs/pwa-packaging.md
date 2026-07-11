# Packaging FIRE FIGHT as a Meta Quest PWA

The game ships to the Horizon Store as a **PWA wrapper APK**: a thin
store-installable shell that loads the hosted site, so gameplay updates keep
shipping by deploying to Firebase — no store resubmission per patch.

The web side is already in the repo: `public/manifest.webmanifest` + the
`public/icons/` set, linked from `index.html` and `pub.html`. Deploy first —
the packager reads the LIVE manifest:

```sh
npm run build && npx firebase deploy --only hosting
# manifest must now be reachable at:
#   https://arfi-b68f9.web.app/manifest.webmanifest
```

## One-time setup (on your PC)

1. Meta developer account: https://developers.meta.com — create an org, verify.
2. Download **ovr-platform-util** (Developer Center → Resources → Platform
   Util) and put it on your PATH. macOS/Linux: `chmod +x ovr-platform-util`.

## Build the APK

```sh
ovr-platform-util create-pwa \
  -o firefight.apk \
  --web-manifest-url https://arfi-b68f9.web.app/manifest.webmanifest \
  --android-sdk "$ANDROID_SDK_ROOT" \
  --package-name com.yellkell.firefight
```

Notes:
- `--android-sdk` needs any recent Android SDK (Android Studio's install works;
  only build-tools are used, no project needed).
- The tool generates a debug-signed APK by default — fine for sideloading.
  Store uploads are re-signed by Meta, so don't sweat keystores yet.
- Keep `--package-name` stable forever once the app is created in the
  dashboard — it's the app's identity.

## Test on the headset

1. Install **Meta Quest Developer Hub** (MQDH), enable developer mode on the
   headset.
2. Drag `firefight.apk` onto MQDH (or `adb install firefight.apk`).
3. It appears under Library → Unknown Sources. Check: launches straight into
   the landing page, ENTER VR works, exiting returns cleanly.

## Submit

Dashboard → Create App → Meta Horizon Store → platform "Quest", type "PWA".
Upload the APK to the **Alpha** channel first (invite testers by email), then
work through: store listing assets, IARC age rating, privacy policy URL +
Data Use Checkup (leaderboards, callsigns and voice chat must be declared),
and the social-app safety requirements (block/report — the pub currently has
mute + admin ban; user-facing report is on the todo list).
