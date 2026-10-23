<div align="center">

<img src="icons/icon-192.png" width="104" alt="Camera App icon">

# 📷 Camera App — *Colorful Pose & Speech Recorder*

**A colorful camera that lives in your browser.** Snap photos with 12 live filters, use a self-timer and burst mode, record video, zoom, keep everything in an offline gallery, and run AI sessions that track your body and transcribe what you say. 🤖🎙️

[![Open the app](https://img.shields.io/badge/▶_Open_the_app-jaineil32624.github.io/camera__app-7731FF?style=for-the-badge&labelColor=0C0F1B)](https://jaineil32624.github.io/camera_app/)
[![Download APK](https://img.shields.io/badge/🤖_Android-Download_APK-246BFF?style=for-the-badge&labelColor=0C0F1B)](https://github.com/jaineil32624/camera_app/releases/latest/download/CameraApp.apk)
[![All downloads](https://img.shields.io/badge/📦_Releases-All_downloads-FF4A77?style=for-the-badge&labelColor=0C0F1B)](https://github.com/jaineil32624/camera_app/releases/latest)

![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)
![TensorFlow.js](https://img.shields.io/badge/TensorFlow.js-MoveNet-FF6F00?logo=tensorflow&logoColor=white)
![MediaRecorder](https://img.shields.io/badge/MediaRecorder-video-FF4A77)
![IndexedDB](https://img.shields.io/badge/IndexedDB-gallery-38D7FF)
![PWA](https://img.shields.io/badge/PWA-installable-5A0FC8?logo=pwa&logoColor=white)
![Capacitor](https://img.shields.io/badge/Android-Capacitor-119EFF?logo=capacitor&logoColor=white)
![Offline](https://img.shields.io/badge/works-offline-2ECC71)

<img src="docs/screenshots/social.png" alt="Camera App preview" width="100%">

</div>

---

## ✨ Features

| | Feature | What it does |
|---|---|---|
| 📸 | **Three modes** | **Photo**, **Video** and **AI Session**, one big shutter for all of them |
| 🎨 | **12 live filters** | Vivid, Mono, Noir, Sepia, Warm, Cool, Dream, Neon, Retro, Fade, Invert. Chips show a *live* preview of your camera, and the filter is baked into photos and videos |
| ⏱️ | **Self-timer** | Off · 3 s · 10 s with a big animated countdown and beeps. Press `Esc` or the shutter to cancel |
| 💥 | **Burst mode** | Fire 3 or 5 shots in a row |
| 🎬 | **Video recording** | Records the *filtered* preview with `MediaRecorder`, with optional sound, pause/resume and a live REC timer |
| 🔍 | **Zoom** | Real hardware zoom when the camera supports it, smooth digital zoom otherwise. Pinch, slider, `Ctrl`+scroll or `+`/`-` |
| 🔄 | **Front / back switch** | One tap (or double-tap the preview) |
| #️⃣ | **Grid & mirror** | Rule-of-thirds overlay; mirror the selfie view |
| 🔦 | **Torch** | Appears automatically on phones whose camera has a flashlight |
| ⚡ | **Flash & feel** | White flash, shutter sound, haptics, and the shot flies into the gallery button |
| 🖼️ | **Offline gallery** | Every capture is stored on your device in IndexedDB. Filter by photos/videos, view full size, **download, share or delete**, browse with ← → |
| 🤖 | **AI pose overlay** | MoveNet (TensorFlow.js) draws a rainbow skeleton, keypoints and a dynamic **HEAD** box. You can burn it into your photos |
| 🎙️ | **AI Session** | The original feature: records camera + mic together, transcribes speech live, lists body keypoints, guesses expression 😄🤔😢, says out loud when you shake your hand 👋, and saves the transcript as a .txt |
| 🚫 | **Friendly error states** | Clear screens for *permission blocked*, *no camera*, *camera busy*, *insecure page* and *unsupported browser*, each with a retry button |
| ⌨️ | **Keyboard shortcuts** | `Space` shutter · `1` `2` `3` modes · `[` `]` filters · `T` timer · `B` burst · `G` grid · `F` flip · `M` mirror · `A` pose · `L` last shot · `P` pause · `?` help |
| 🔗 | **Share your setup** | Copies a link such as `?filter=noir&timer=3&burst=3&grid=1` that opens the camera with the same settings |
| 💾 | **Remembers you** | Mode, filter, timer, burst, grid and toggles are saved between visits |

## 📸 Screenshots

<table>
<tr>
<td><img src="docs/screenshots/home.png" alt="Home"><p align="center">📷 <b>Photo mode</b>: live preview, modes, shutter</p></td>
<td><img src="docs/screenshots/filters.png" alt="Filters"><p align="center">🎨 <b>Live filters</b> + rule-of-thirds grid</p></td>
</tr>
<tr>
<td><img src="docs/screenshots/timer-burst.png" alt="Timer"><p align="center">⏱️ <b>10-second timer</b> with 3-shot burst</p></td>
<td><img src="docs/screenshots/video.png" alt="Video"><p align="center">🎬 <b>Recording video</b> with the Retro filter</p></td>
</tr>
<tr>
<td><img src="docs/screenshots/gallery.png" alt="Gallery"><p align="center">🖼️ <b>Offline gallery</b> stored in IndexedDB</p></td>
<td><img src="docs/screenshots/viewer.png" alt="Viewer"><p align="center">🔎 <b>Viewer</b>: download, share, delete</p></td>
</tr>
<tr>
<td><img src="docs/screenshots/permission.png" alt="Permission blocked"><p align="center">🚫 <b>Helpful states</b> when the camera is blocked</p></td>
<td><img src="docs/screenshots/shortcuts.png" alt="Shortcuts"><p align="center">⌨️ <b>Shortcuts</b> overlay (<code>?</code>)</p></td>
</tr>
</table>

<p align="center">
<img src="docs/screenshots/mobile.png" width="30%" alt="Mobile">
<img src="docs/screenshots/mobile-video.png" width="30%" alt="Mobile video">
<img src="docs/screenshots/mobile-gallery.png" width="30%" alt="Mobile gallery">
<br><em>📱 Made for phones: pinch to zoom, double-tap to flip, big thumb-friendly shutter</em>
</p>

## 📥 Get Camera App

| Platform | How |
|---|---|
| 🌐 **Web** | Open **[jaineil32624.github.io/camera_app](https://jaineil32624.github.io/camera_app/)**, nothing to install |
| 🤖 **Android** | Download **[CameraApp.apk](https://github.com/jaineil32624/camera_app/releases/latest/download/CameraApp.apk)** → open it → allow *Install unknown apps* if asked → allow **Camera** and **Microphone** |
| 💻 **Windows / Mac / Chromebook** | Open the website in Chrome or Edge → **⬇ Get the app** → **Install** |
| 🍎 **iPhone / iPad** | Open the website in Safari → **Share** → **Add to Home Screen** |
| 📦 **Offline zip** | Grab **CameraApp-web.zip** from [Releases](https://github.com/jaineil32624/camera_app/releases/latest), unzip, and serve the folder locally (browsers only allow cameras on `https://` or `localhost`) |

> 💡 Your photos and videos **never leave your device**. No account, no ads, no tracking. Once installed, the app works offline, including the bundled AI pose model.

<p align="center"><img src="docs/screenshots/get-the-app.png" width="80%" alt="Get the app"></p>

## 🛠️ Run it locally

```bash
git clone https://github.com/jaineil32624/camera_app.git
cd camera_app
python3 -m http.server 8000      # then open http://localhost:8000
```

There's no build step. Use `localhost` (not `file://`) so the browser lets the page use the camera.

## 🗂️ Project structure

```
camera_app/
├── index.html              🧱 layout + meta tags
├── style.css               🎨 the colorful dark glass theme
├── script.js               🧠 camera, filters, timer, burst, video, gallery, pose + speech
├── sw.js                   📴 offline service worker
├── manifest.webmanifest    📲 installable-app manifest
├── icons/                  🖼️ app icons (SVG + PNG + maskable)
├── vendor/                 🤖 TensorFlow.js, pose-detection and the MoveNet model, bundled for offline use
├── docs/screenshots/       📸 images for this README
├── VERSION                 🏷️ bump to publish a new release
└── .github/workflows/
    ├── release.yml         🤖 builds the Android APK + publishes a Release
    └── vendor.yml          ⬇️ refreshes the offline AI libraries
```

## 🚀 Releasing a new version

Bump the number in `VERSION` and push. GitHub Actions builds the APK (with camera and microphone permissions) and publishes the release automatically:

```bash
echo "1.1.0" > VERSION
git commit -am "Release 1.1.0" && git push
```

---

<div align="center">

Made with 💜, 📸 and a lot of 🤖 by **[Jaineil Rana](https://github.com/jaineil32624)**

⭐ *If Camera App made you smile for the camera, give it a star!* ⭐

</div>
