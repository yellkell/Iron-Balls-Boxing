# Packaging FIRE FIGHT as a Meta Quest PWA

The game ships to the Horizon Store as a **PWA wrapper APK**: a thin
store-installable shell that loads the hosted site, so gameplay updates keep
shipping by deploying to Firebase — no store resubmission per patch.

The web side is already in the repo: `public/manifest.webmanifest` + the
`public/icons/` set, linked from `index.html` and `pub.html`.

> **Tooling note:** Meta's old `ovr-platform-util create-pwa` flow is retired.
> The current official path is **Bubblewrap** (Google's PWA→APK packer) with
> Meta Quest support — Meta maintains a fork (github.com/meta-quest/bubblewrap)
> and upstream `@bubblewrap/cli` carries the `--metaquest` flag. It runs via
> `npx`, no separate download hunt.

## 1 · Deploy first (the packager reads the LIVE manifest)

```sh
npm run build && npx firebase deploy --only hosting
# check it in a browser:
#   https://arfi-b68f9.web.app/manifest.webmanifest
```

## 2 · Build the APK (on a machine with Node)

```sh
mkdir firefight-quest && cd firefight-quest
npx @bubblewrap/cli init \
  --manifest https://arfi-b68f9.web.app/manifest.webmanifest \
  --metaquest
npx @bubblewrap/cli build
```

Notes:
- First run offers to download its own JDK + Android SDK — say YES to both
  (no Android Studio needed).
- `init` asks a series of questions; the defaults come from our manifest.
  Application ID: use `com.yellkell.firefight` and never change it — it's the
  app's identity in the store.
- `build` creates a signing keystore and asks for two passwords — SAVE THEM
  (they sign every future update). Output: `app-release-signed.apk`.

## 3 · Trust the wrapper (assetlinks)

So the shell opens the site full-screen as YOUR app (no browser chrome), the
site must vouch for the APK's signing key:

```sh
npx @bubblewrap/cli fingerprint generateAssetLinks
```

Put the JSON it prints at `public/.well-known/assetlinks.json` in this repo,
rebuild, redeploy.

## 4 · Test on the headset

Meta Quest Developer Hub → Device manager (headset on USB, developer mode on)
→ drag `app-release-signed.apk` onto the device. It appears under
Library → Unknown Sources as FIRE FIGHT with the flame icon.

## 5 · Submit

MQDH → App distribution (or the web Developer Dashboard) → Create a new app →
Meta Horizon Store, Quest. Upload the APK to the **Alpha** channel first
(invite testers by email), then work through: store listing assets, IARC age
rating, privacy policy URL + Data Use Checkup (leaderboards, callsigns and
voice chat must be declared), and the social-app safety requirements
(block/report — the pub currently has mute + admin ban; user-facing report is
on the todo list).
