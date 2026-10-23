"use strict";
/* =====================================================================
   Camera App — Colorful Pose & Speech Recorder
   Photo / Video / AI Session camera with live filters, timer, burst,
   grid, zoom, gallery (IndexedDB), pose detection and live transcript.
   ===================================================================== */

const $ = (id) => document.getElementById(id);

const video = $("camera");
const overlay = $("overlay");
const ctx = overlay.getContext("2d");
const statusEl = $("status");
const transcriptEl = $("transcript");
const downloadsEl = $("downloads");
const bodyInfoEl = $("bodyInfo");
const expressionEl = $("expressionInfo");
const startSessionBtn = $("startSessionBtn");
const stopSessionBtn = $("stopSessionBtn");
const frameEl = $("frame");
const zoomLayer = $("zoomLayer");
const shutterBtn = $("shutter");
const zoomSlider = $("zoomSlider");

const APK_URL = "https://github.com/jaineil32624/camera_app/releases/latest/download/CameraApp.apk";
const RELEASES_URL = "https://github.com/jaineil32624/camera_app/releases/latest";
const CDN_TF = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.12.0/dist/tf.min.js";
const CDN_POSE = "https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js";

/* ---------------------------------------------------------------------
   Filters
   --------------------------------------------------------------------- */
const FILTERS = [
    { id: "none", name: "Original", css: "none" },
    { id: "vivid", name: "Vivid", css: "saturate(1.6) contrast(1.1)" },
    { id: "mono", name: "Mono", css: "grayscale(1)" },
    { id: "noir", name: "Noir", css: "grayscale(1) contrast(1.55) brightness(0.9)" },
    { id: "sepia", name: "Sepia", css: "sepia(0.85) contrast(1.05)" },
    { id: "warm", name: "Warm", css: "sepia(0.3) saturate(1.4) hue-rotate(-12deg)" },
    { id: "cool", name: "Cool", css: "saturate(1.15) hue-rotate(18deg) brightness(1.05)" },
    { id: "dream", name: "Dream", css: "saturate(1.5) hue-rotate(250deg) brightness(1.08)" },
    { id: "neon", name: "Neon", css: "saturate(2.4) contrast(1.35) hue-rotate(300deg)" },
    { id: "retro", name: "Retro", css: "sepia(0.5) saturate(1.8) contrast(0.9) brightness(1.1)" },
    { id: "fade", name: "Fade", css: "contrast(0.8) brightness(1.15) saturate(0.7)" },
    { id: "invert", name: "Invert", css: "invert(1)" }
];
const filterById = (id) => FILTERS.find((f) => f.id === id) || FILTERS[0];

/* ---------------------------------------------------------------------
   Settings (localStorage, always wrapped in try/catch)
   --------------------------------------------------------------------- */
const SETTINGS_KEY = "cameraapp.settings.v1";
const DEFAULTS = {
    mode: "photo", filter: "none", timer: 0, burst: 1, grid: false, mirror: true,
    facing: "user", audio: true, sound: true, stamp: true, pose: false, onboarded: false
};
const S = Object.assign({}, DEFAULTS);
try { Object.assign(S, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")); } catch (e) { /* storage blocked */ }
function persist() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S)); } catch (e) { /* storage blocked */ }
}

// Share links: ?filter=noir&timer=3&burst=3&grid=1&mode=video
(function applyUrlParams() {
    const q = new URLSearchParams(location.search);
    if (q.has("filter") && FILTERS.some((f) => f.id === q.get("filter"))) S.filter = q.get("filter");
    if (q.has("timer") && ["0", "3", "10"].includes(q.get("timer"))) S.timer = +q.get("timer");
    if (q.has("burst") && ["1", "3", "5"].includes(q.get("burst"))) S.burst = +q.get("burst");
    if (q.has("grid")) S.grid = q.get("grid") === "1";
    if (q.has("mode") && ["photo", "video", "session"].includes(q.get("mode"))) S.mode = q.get("mode");
})();

/* ---------------------------------------------------------------------
   State
   --------------------------------------------------------------------- */
let stream = null;            // active MediaStream (preview or session)
let detector = null;
let recognition = null;
let videoRecorder = null;     // AI session recorder (raw stream, as before)
let clipRecorder = null;      // Video-mode recorder (filtered canvas)
let speechActive = false;
let videoChunks = [];
let transcriptLines = [];
let lastShakeTime = 0;
let sessionActive = false;
let cameraStarting = false;
let busyCapturing = false;
let digitalZoom = 1;
let hwZoom = null;            // {min,max,step} when the camera supports real zoom
let torchOn = false;
let poseLoopId = 0;
let lastPoses = [];
let poseCost = 0;
const shakeCooldown = 2000;
const wristHistory = { left: [], right: [] };

/* ---------------------------------------------------------------------
   Small helpers
   --------------------------------------------------------------------- */
function setStatus(message) {
    if (statusEl) statusEl.textContent = message;
}

function toast(icon, text, ms = 2600) {
    const wrap = $("toasts");
    const t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = `<span class="t-ico"></span><span class="t-txt"></span>`;
    t.querySelector(".t-ico").textContent = icon;
    t.querySelector(".t-txt").textContent = text;
    wrap.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, ms);
}

function formatFilename(prefix, extension) {
    const now = new Date();
    return `${prefix}-${now.toISOString().replace(/[:.]/g, "-")}.${extension}`;
}

function fmtBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(0) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
}

function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    return String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(sec % 60).padStart(2, "0");
}

function extFor(type) {
    if (/mp4/.test(type)) return "mp4";
    if (/png/.test(type)) return "png";
    if (/jpe?g/.test(type)) return "jpg";
    return "webm";
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error("Could not load " + src));
        document.head.appendChild(s);
    });
}

/* ---- sounds (Web Audio, no files) ---- */
let audioCtx = null;
function beep(freq = 880, dur = 0.08, type = "sine", vol = 0.15) {
    if (!S.sound) return;
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === "suspended") audioCtx.resume();
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = type;
        o.frequency.value = freq;
        g.gain.setValueAtTime(vol, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
        o.connect(g).connect(audioCtx.destination);
        o.start();
        o.stop(audioCtx.currentTime + dur + 0.02);
    } catch (e) { /* audio unavailable */ }
}
function shutterSound() {
    if (!S.sound) return;
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        const len = Math.floor(audioCtx.sampleRate * 0.09);
        const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
        const src = audioCtx.createBufferSource();
        const g = audioCtx.createGain();
        g.gain.value = 0.35;
        src.buffer = buf;
        src.connect(g).connect(audioCtx.destination);
        src.start();
    } catch (e) { /* audio unavailable */ }
}
function haptic(ms = 15) {
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ }
}

/* ---------------------------------------------------------------------
   Gallery storage — IndexedDB with an in-memory fallback
   --------------------------------------------------------------------- */
const Store = {
    db: null,
    mem: [],
    ready: null,
    open() {
        if (this.ready) return this.ready;
        this.ready = new Promise((resolve) => {
            try {
                if (!window.indexedDB) return resolve(null);
                const req = indexedDB.open("camera-app", 1);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains("captures")) db.createObjectStore("captures", { keyPath: "id" });
                };
                req.onsuccess = () => { this.db = req.result; resolve(this.db); };
                req.onerror = () => resolve(null);
                req.onblocked = () => resolve(null);
            } catch (e) { resolve(null); }
        });
        return this.ready;
    },
    async tx(mode, fn) {
        await this.open();
        if (!this.db) return fn(null);
        return new Promise((resolve, reject) => {
            try {
                const t = this.db.transaction("captures", mode);
                const store = t.objectStore("captures");
                let result;
                Promise.resolve(fn(store)).then((r) => { result = r; });
                t.oncomplete = () => resolve(result);
                t.onerror = () => reject(t.error);
                t.onabort = () => reject(t.error);
            } catch (e) { reject(e); }
        });
    },
    async all() {
        try {
            await this.open();
            if (!this.db) return this.mem.slice().sort((a, b) => b.created - a.created);
            const items = await new Promise((resolve, reject) => {
                const r = this.db.transaction("captures").objectStore("captures").getAll();
                r.onsuccess = () => resolve(r.result || []);
                r.onerror = () => reject(r.error);
            });
            return items.sort((a, b) => b.created - a.created);
        } catch (e) {
            return this.mem.slice().sort((a, b) => b.created - a.created);
        }
    },
    async put(item) {
        try {
            await this.open();
            if (!this.db) { this.mem.push(item); return; }
            await this.tx("readwrite", (s) => { s.put(item); });
        } catch (e) {
            this.mem.push(item);
            toast("⚠️", "Storage is full or blocked — capture kept for this visit only");
        }
    },
    async del(id) {
        this.mem = this.mem.filter((i) => i.id !== id);
        try { if (this.db) await this.tx("readwrite", (s) => { s.delete(id); }); } catch (e) { /* ignore */ }
    },
    async clear() {
        this.mem = [];
        try { if (this.db) await this.tx("readwrite", (s) => { s.clear(); }); } catch (e) { /* ignore */ }
    }
};

/* ---------------------------------------------------------------------
   Camera lifecycle + friendly error states
   --------------------------------------------------------------------- */
function showState(kind, extra) {
    const box = $("camState");
    const icon = $("stateIcon"), title = $("stateTitle"), text = $("stateText"), btn = $("stateBtn");
    frameEl.dataset.state = kind;
    if (kind === "live") { box.hidden = true; return; }
    box.hidden = false;
    btn.hidden = false;
    btn.disabled = false;
    const states = {
        idle: ["📷", "Ready when you are", "Turn on your camera to start snapping photos, recording video or running an AI session.", "Turn on camera"],
        loading: ["⏳", "Starting camera…", "If your browser asks, choose Allow so the app can see your camera.", null],
        denied: ["🚫", "Camera access is blocked", "Click the camera icon in your address bar (or open your browser / app settings), allow Camera, then try again.", "Try again"],
        nocam: ["🔌", "No camera found", "Plug in or enable a webcam, close other apps that might be using it, then try again.", "Try again"],
        busy: ["🔒", "Camera is busy", "Another app or tab is using your camera. Close it and try again.", "Try again"],
        insecure: ["🔐", "Camera needs a secure page", "Browsers only allow the camera on https:// or localhost. Open the live site or run a local server.", null],
        unsupported: ["🧭", "Camera not supported here", "This browser can't access cameras. Try a recent Chrome, Edge, Firefox or Safari.", null],
        error: ["⚠️", "Something went wrong", "", "Try again"]
    };
    const s = states[kind] || states.error;
    icon.textContent = s[0];
    title.textContent = s[1];
    text.textContent = extra || s[2];
    if (s[3]) btn.textContent = s[3]; else btn.hidden = true;
}

function cameraConstraints(withAudio) {
    return {
        video: { facingMode: S.facing, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: withAudio
    };
}

async function getStream(withAudio) {
    try {
        return await navigator.mediaDevices.getUserMedia(cameraConstraints(withAudio));
    } catch (err) {
        if (err && (err.name === "OverconstrainedError" || err.name === "NotFoundError") ) {
            // fall back to any camera
            return await navigator.mediaDevices.getUserMedia({ video: true, audio: withAudio });
        }
        if (withAudio && err && err.name === "NotAllowedError") {
            // mic refused — still give them the camera
            const s = await navigator.mediaDevices.getUserMedia(cameraConstraints(false));
            toast("🎙️", "Microphone blocked — continuing without sound");
            return s;
        }
        throw err;
    }
}

function explainError(err) {
    const name = err && err.name;
    if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
    if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") return "nocam";
    if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "busy";
    return "error";
}

async function attachStream(s) {
    stream = s;
    video.srcObject = s;
    try { await video.play(); } catch (e) { /* autoplay with muted should work */ }
    await waitForVideoMetadata();
    resizeCanvas();
    if (video.videoWidth && video.videoHeight) {
        frameEl.style.setProperty("--ar", `${video.videoWidth} / ${video.videoHeight}`);
    }
    readCapabilities();
    applyMirror();
    applyFilter();
    showState("live");
    updateShutter();
    if (S.pose || sessionActive) startPoseLoop();
}

async function startCamera() {
    if (cameraStarting) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showState(window.isSecureContext === false ? "insecure" : "unsupported");
        setStatus("Camera unavailable in this browser.");
        return;
    }
    cameraStarting = true;
    showState("loading");
    setStatus("Requesting camera…");
    try {
        stopTracks();
        const s = await getStream(false);
        await attachStream(s);
        setStatus(modeStatus());
        countCameras();
    } catch (err) {
        console.warn("Camera error:", err && err.name, err && err.message);
        const kind = explainError(err);
        showState(kind, kind === "error" ? `Camera error: ${(err && err.message) || err}` : undefined);
        setStatus(`Media error: ${(err && (err.message || err.name)) || err}`);
    } finally {
        cameraStarting = false;
    }
}

function stopTracks() {
    if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
    }
    torchOn = false;
}

async function countCameras() {
    try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        const cams = devs.filter((d) => d.kind === "videoinput").length;
        $("flipBtn").classList.toggle("dim", cams < 2);
        $("flipBtn").title = cams < 2 ? "Switch camera (only one camera found)" : "Switch camera (F)";
    } catch (e) { /* ignore */ }
}

async function flipCamera() {
    if (sessionActive) { toast("🤖", "Stop the AI session to switch cameras"); return; }
    if (clipRecorder) { toast("🎬", "Stop recording to switch cameras"); return; }
    S.facing = S.facing === "user" ? "environment" : "user";
    S.mirror = S.facing === "user";
    persist();
    frameEl.classList.add("flipping");
    setTimeout(() => frameEl.classList.remove("flipping"), 450);
    resetZoom();
    await startCamera();
    toast("🔄", S.facing === "user" ? "Front camera" : "Back camera");
}

function readCapabilities() {
    hwZoom = null;
    const track = stream && stream.getVideoTracks()[0];
    let caps = {};
    try { caps = (track && track.getCapabilities && track.getCapabilities()) || {}; } catch (e) { caps = {}; }
    if (caps.zoom && caps.zoom.max > caps.zoom.min) {
        hwZoom = { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 };
        zoomSlider.min = hwZoom.min;
        zoomSlider.max = hwZoom.max;
        zoomSlider.step = hwZoom.step;
        let cur = hwZoom.min;
        try { cur = track.getSettings().zoom || hwZoom.min; } catch (e) { /* ignore */ }
        zoomSlider.value = cur;
    } else {
        zoomSlider.min = 1; zoomSlider.max = 4; zoomSlider.step = 0.1;
        zoomSlider.value = digitalZoom;
    }
    $("torchBtn").hidden = !caps.torch;
    updateZoomPill();
}

/* ---------------------------------------------------------------------
   Zoom (hardware when supported, otherwise digital crop)
   --------------------------------------------------------------------- */
let zoomApplyTimer = null;
function setZoom(value) {
    const min = +zoomSlider.min, max = +zoomSlider.max;
    value = Math.min(max, Math.max(min, value));
    zoomSlider.value = value;
    if (hwZoom && stream) {
        clearTimeout(zoomApplyTimer);
        zoomApplyTimer = setTimeout(() => {
            const track = stream && stream.getVideoTracks()[0];
            if (track) track.applyConstraints({ advanced: [{ zoom: value }] }).catch(() => {});
        }, 40);
    } else {
        digitalZoom = value;
        zoomLayer.style.transform = `scale(${digitalZoom})`;
    }
    updateZoomPill();
}
function resetZoom() {
    digitalZoom = 1;
    zoomLayer.style.transform = "";
    setZoom(+zoomSlider.min || 1);
}
function updateZoomPill() {
    const v = +zoomSlider.value;
    const rel = hwZoom ? v / (hwZoom.min || 1) : v;
    $("zoomPill").textContent = rel.toFixed(1) + "×";
    $("zoomPill").classList.toggle("active", rel > 1.01);
}

/* ---------------------------------------------------------------------
   Preview look: filter, mirror, grid
   --------------------------------------------------------------------- */
function applyFilter() {
    const f = filterById(S.filter);
    video.style.filter = f.css === "none" ? "" : f.css;
    $("filterPill").textContent = f.name;
    document.querySelectorAll(".filter-chip").forEach((c) => {
        const on = c.dataset.id === f.id;
        c.classList.toggle("on", on);
        c.setAttribute("aria-selected", on ? "true" : "false");
    });
}
function stepFilter(dir) {
    const i = FILTERS.findIndex((f) => f.id === S.filter);
    S.filter = FILTERS[(i + dir + FILTERS.length) % FILTERS.length].id;
    persist();
    applyFilter();
    const chip = document.querySelector(`.filter-chip[data-id="${S.filter}"]`);
    if (chip) chip.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    pulse($("filterPill"));
}
function applyMirror() {
    video.classList.toggle("mirrored", !!S.mirror);
    $("mirrorBtn").setAttribute("aria-pressed", S.mirror ? "true" : "false");
    $("mirrorBtn").classList.toggle("on", !!S.mirror);
}
function applyGrid() {
    $("gridOverlay").classList.toggle("show", !!S.grid);
    $("gridBtn").setAttribute("aria-pressed", S.grid ? "true" : "false");
    $("gridBtn").classList.toggle("on", !!S.grid);
}
function pulse(el) {
    if (!el) return;
    el.classList.remove("pulse");
    void el.offsetWidth;
    el.classList.add("pulse");
}

function buildFilterStrip() {
    const strip = $("filterStrip");
    strip.innerHTML = "";
    FILTERS.forEach((f, i) => {
        const b = document.createElement("button");
        b.className = "filter-chip";
        b.dataset.id = f.id;
        b.setAttribute("role", "option");
        b.title = f.name;
        b.innerHTML = `<span class="swatch"></span><span class="fname"></span>`;
        b.querySelector(".swatch").style.filter = f.css === "none" ? "" : f.css;
        b.querySelector(".fname").textContent = f.name;
        b.style.animationDelay = i * 25 + "ms";
        b.addEventListener("click", () => {
            S.filter = f.id; persist(); applyFilter(); pulse($("filterPill"));
        });
        strip.appendChild(b);
    });
}

// Live thumbnails for the filter chips — one tiny frame per second.
const thumbCanvas = document.createElement("canvas");
thumbCanvas.width = 96; thumbCanvas.height = 72;
function refreshFilterThumbs() {
    if (!stream || video.readyState < 2 || document.hidden) return;
    try {
        const t = thumbCanvas.getContext("2d");
        const vw = video.videoWidth, vh = video.videoHeight;
        const scale = Math.max(96 / vw, 72 / vh);
        const w = vw * scale, h = vh * scale;
        t.save();
        if (S.mirror) { t.translate(96, 0); t.scale(-1, 1); }
        t.drawImage(video, (96 - w) / 2, (72 - h) / 2, w, h);
        t.restore();
        const url = thumbCanvas.toDataURL("image/jpeg", 0.6);
        document.querySelectorAll(".filter-chip .swatch").forEach((s) => { s.style.backgroundImage = `url(${url})`; });
    } catch (e) { /* ignore */ }
}
setInterval(refreshFilterThumbs, 1000);

/* ---------------------------------------------------------------------
   Rendering a frame (used by photos and filtered video)
   --------------------------------------------------------------------- */
const supportsCtxFilter = (() => {
    try { const c = document.createElement("canvas").getContext("2d"); return typeof c.filter === "string"; } catch (e) { return false; }
})();

function cropRect() {
    const vw = video.videoWidth, vh = video.videoHeight;
    const z = hwZoom ? 1 : digitalZoom;
    const sw = vw / z, sh = vh / z;
    return { sx: (vw - sw) / 2, sy: (vh - sh) / 2, sw, sh, vw, vh };
}

function renderFrame(target, maxW) {
    const r = cropRect();
    let w = Math.round(r.sw), h = Math.round(r.sh);
    if (maxW && w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
    if (target.width !== w) target.width = w;
    if (target.height !== h) target.height = h;
    const c = target.getContext("2d");
    c.save();
    const f = filterById(S.filter);
    if (supportsCtxFilter) c.filter = f.css === "none" ? "none" : f.css;
    if (S.mirror) { c.translate(w, 0); c.scale(-1, 1); }
    c.drawImage(video, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h);
    c.restore();
    if (supportsCtxFilter) c.filter = "none";
    // Burn the AI overlay in (already drawn in mirrored space, so no flip needed)
    if (S.stamp && (S.pose || sessionActive) && overlay.width) {
        const ox = r.sx * overlay.width / r.vw, oy = r.sy * overlay.height / r.vh;
        const ow = r.sw * overlay.width / r.vw, oh = r.sh * overlay.height / r.vh;
        try { c.drawImage(overlay, ox, oy, ow, oh, 0, 0, w, h); } catch (e) { /* ignore */ }
    }
    return { w, h };
}

/* ---------------------------------------------------------------------
   Photo capture: timer, burst, flash, fly-to-gallery
   --------------------------------------------------------------------- */
function flash() {
    const f = $("flash");
    f.classList.remove("go");
    void f.offsetWidth;
    f.classList.add("go");
}

let countdownCancel = null;
function cancelCountdown() {
    if (countdownCancel) { countdownCancel(); countdownCancel = null; toast("⏹️", "Timer cancelled"); return true; }
    return false;
}
function countdown(seconds) {
    return new Promise((resolve) => {
        if (!seconds) return resolve(true);
        const el = $("countdown");
        let n = seconds;
        let timer = null;
        frameEl.classList.add("counting");
        const finish = (ok) => {
            clearTimeout(timer);
            el.classList.remove("show");
            el.textContent = "";
            frameEl.classList.remove("counting");
            countdownCancel = null;
            updateShutter();
            resolve(ok);
        };
        countdownCancel = () => finish(false);
        updateShutter();
        const tick = () => {
            if (n <= 0) return finish(true);
            el.textContent = n;
            el.classList.remove("show");
            void el.offsetWidth;
            el.classList.add("show");
            beep(n <= 3 ? 1046 : 784, 0.09);
            n -= 1;
            timer = setTimeout(tick, 1000);
        };
        tick();
    });
}

function canvasToBlob(canvas, type, q) {
    return new Promise((resolve) => {
        if (canvas.toBlob) canvas.toBlob((b) => resolve(b), type, q);
        else {
            const data = canvas.toDataURL(type, q);
            const bin = atob(data.split(",")[1]);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            resolve(new Blob([arr], { type }));
        }
    });
}

function flyToGallery(canvas) {
    try {
        const thumb = document.createElement("img");
        thumb.className = "fly-thumb";
        thumb.src = canvas.toDataURL("image/jpeg", 0.5);
        const a = frameEl.getBoundingClientRect();
        const b = $("lastShot").getBoundingClientRect();
        Object.assign(thumb.style, { left: a.left + "px", top: a.top + "px", width: a.width + "px", height: a.height + "px" });
        document.body.appendChild(thumb);
        requestAnimationFrame(() => {
            Object.assign(thumb.style, {
                left: b.left + "px", top: b.top + "px", width: b.width + "px", height: b.height + "px",
                opacity: "0.2", borderRadius: "50%"
            });
        });
        setTimeout(() => thumb.remove(), 650);
    } catch (e) { /* ignore */ }
}

async function snapOne() {
    const canvas = document.createElement("canvas");
    const { w, h } = renderFrame(canvas);
    flash();
    shutterSound();
    haptic();
    flyToGallery(canvas);
    const blob = await canvasToBlob(canvas, "image/jpeg", 0.92);
    if (!blob) throw new Error("Could not encode photo");
    const item = {
        id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
        type: "photo", blob, mime: blob.type || "image/jpeg", created: Date.now(),
        filter: S.filter, w, h, size: blob.size
    };
    await Store.put(item);
    return item;
}

async function takePhoto() {
    if (busyCapturing) return;
    if (!stream || video.readyState < 2) { toast("📷", "Turn on the camera first"); return; }
    busyCapturing = true;
    try {
        const ok = await countdown(+S.timer);
        if (!ok) return;
        const n = +S.burst || 1;
        for (let i = 0; i < n; i++) {
            if (!stream) break;
            await snapOne();
            if (i < n - 1) await new Promise((r) => setTimeout(r, 280));
        }
        await renderGallery();
        setStatus(n > 1 ? `Burst saved: ${n} photos added to your gallery.` : "Photo saved to your gallery.");
        toast("📸", n > 1 ? `Saved ${n} photos` : "Photo saved");
    } catch (err) {
        console.warn(err);
        toast("⚠️", "Couldn't save that photo");
    } finally {
        busyCapturing = false;
    }
}

/* ---------------------------------------------------------------------
   Video mode: record the filtered preview via a canvas stream
   --------------------------------------------------------------------- */
let clipChunks = [];
let clipStart = 0;
let clipPausedAt = 0;
let clipPausedTotal = 0;
let clipTick = null;
let clipCanvas = null;
let clipDrawId = 0;
let micStream = null;

function pickMime() {
    if (!window.MediaRecorder) return "";
    const list = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4;codecs=avc1", "video/mp4"];
    for (const t of list) { try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (e) { /* ignore */ } }
    return "";
}

async function startClip() {
    if (!window.MediaRecorder) { toast("🎬", "Video recording isn't supported in this browser"); return; }
    if (!stream || video.readyState < 2) { toast("🎬", "Turn on the camera first"); return; }
    const ok = await countdown(+S.timer);
    if (!ok || !stream) return;

    let recStream = null;
    clipCanvas = document.createElement("canvas");
    if (clipCanvas.captureStream) {
        renderFrame(clipCanvas, 1280);
        recStream = clipCanvas.captureStream(30);
        const id = ++clipDrawId;
        const draw = () => {
            if (id !== clipDrawId) return;
            if (video.readyState >= 2) renderFrame(clipCanvas, 1280);
            if (document.hidden) setTimeout(draw, 33); else requestAnimationFrame(draw);
        };
        draw();
    } else {
        recStream = new MediaStream(stream.getVideoTracks());
    }
    if (S.audio) {
        try {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            micStream.getAudioTracks().forEach((t) => recStream.addTrack(t));
        } catch (e) {
            micStream = null;
            toast("🎙️", "Microphone unavailable — recording without sound");
        }
    }
    const mime = pickMime();
    try {
        clipRecorder = mime ? new MediaRecorder(recStream, { mimeType: mime }) : new MediaRecorder(recStream);
    } catch (e) {
        clipRecorder = new MediaRecorder(recStream);
    }
    clipChunks = [];
    clipRecorder.ondataavailable = (e) => { if (e.data && e.data.size) clipChunks.push(e.data); };
    clipRecorder.onstop = saveClip;
    clipRecorder.start(500);
    clipStart = performance.now();
    clipPausedTotal = 0;
    clipPausedAt = 0;
    $("recPill").hidden = false;
    $("pauseBtn").hidden = false;
    $("pauseBtn").textContent = "❚❚";
    frameEl.classList.add("recording");
    clipTick = setInterval(updateRecTime, 250);
    updateRecTime();
    beep(660, 0.12, "triangle");
    haptic(25);
    updateShutter();
    setStatus("Recording video… press the shutter or Space to stop.");
}

function updateRecTime() {
    const now = clipPausedAt || performance.now();
    $("recTime").textContent = fmtTime((now - clipStart - clipPausedTotal) / 1000);
}

function togglePauseClip() {
    if (!clipRecorder) return;
    try {
        if (clipRecorder.state === "recording") {
            clipRecorder.pause();
            clipPausedAt = performance.now();
            $("pauseBtn").textContent = "▶";
            $("recPill").classList.add("paused");
            setStatus("Recording paused.");
        } else if (clipRecorder.state === "paused") {
            clipRecorder.resume();
            clipPausedTotal += performance.now() - clipPausedAt;
            clipPausedAt = 0;
            $("pauseBtn").textContent = "❚❚";
            $("recPill").classList.remove("paused");
            setStatus("Recording video… press the shutter or Space to stop.");
        }
    } catch (e) { toast("⚠️", "Pause isn't supported here"); }
}

function stopClip() {
    if (!clipRecorder) return;
    const duration = ((clipPausedAt || performance.now()) - clipStart - clipPausedTotal) / 1000;
    clipRecorder._duration = duration;
    try { if (clipRecorder.state !== "inactive") clipRecorder.stop(); } catch (e) { saveClip(); }
    clearInterval(clipTick);
    clipDrawId++;
    if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
    $("recPill").hidden = true;
    $("recPill").classList.remove("paused");
    $("pauseBtn").hidden = true;
    frameEl.classList.remove("recording");
    beep(440, 0.12, "triangle");
}

async function saveClip() {
    const rec = clipRecorder;
    clipRecorder = null;
    updateShutter();
    if (!clipChunks.length) { toast("🎬", "Recording was empty"); return; }
    const type = (clipChunks[0] && clipChunks[0].type) || (rec && rec.mimeType) || "video/webm";
    const blob = new Blob(clipChunks, { type });
    clipChunks = [];
    const item = {
        id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
        type: "video", blob, mime: type, created: Date.now(), filter: S.filter,
        w: clipCanvas ? clipCanvas.width : video.videoWidth, h: clipCanvas ? clipCanvas.height : video.videoHeight,
        duration: rec && rec._duration, size: blob.size
    };
    await Store.put(item);
    await renderGallery();
    toast("🎬", `Video saved (${fmtTime(item.duration || 0)})`);
    setStatus("Video saved to your gallery.");
}

/* ---------------------------------------------------------------------
   Modes + shutter
   --------------------------------------------------------------------- */
const MODE_INFO = {
    photo: ["Tap the shutter or press Space to take a photo.", "Use the timer for hands-free shots and burst for action."],
    video: ["Tap the red shutter or press Space to start and stop recording.", "Filters, mirror and zoom are recorded too. Toggle sound below."],
    session: ["Start the session to record camera + voice together.", "Speech is transcribed live into the transcript panel."]
};
function modeStatus() {
    if (sessionActive) return "Session active. Recording video + audio and transcribing speech.";
    return { photo: "Camera ready — press Space or tap the shutter to take a photo.", video: "Camera ready — press Space or tap the shutter to record.", session: "Press Start Session to begin." }[S.mode];
}
function setMode(mode, quiet) {
    if (clipRecorder) { toast("🎬", "Stop recording first"); return; }
    if (sessionActive && mode !== "session") { toast("🤖", "Stop the AI session first"); return; }
    S.mode = mode;
    persist();
    document.querySelectorAll(".mode-tab").forEach((t) => {
        const on = t.dataset.mode === mode;
        t.classList.toggle("on", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
    });
    const info = MODE_INFO[mode];
    $("modeInfo").innerHTML = "";
    info.forEach((line) => { const p = document.createElement("p"); p.textContent = line; $("modeInfo").appendChild(p); });
    $("sessionGroup").classList.toggle("highlight", mode === "session");
    updateShutter();
    if (!quiet && stream) setStatus(modeStatus());
}
function updateShutter() {
    shutterBtn.dataset.mode = S.mode;
    shutterBtn.classList.toggle("recording", !!clipRecorder || sessionActive);
    shutterBtn.classList.toggle("counting", !!countdownCancel);
    const label = countdownCancel ? "Cancel timer"
        : S.mode === "photo" ? "Take photo"
        : S.mode === "video" ? (clipRecorder ? "Stop recording" : "Start recording")
        : (sessionActive ? "Stop session" : "Start session");
    shutterBtn.setAttribute("aria-label", label);
    shutterBtn.title = label + " (Space)";
}
function pressShutter() {
    if (countdownCancel) { cancelCountdown(); return; }
    shutterBtn.classList.remove("press");
    void shutterBtn.offsetWidth;
    shutterBtn.classList.add("press");
    if (S.mode === "session") { sessionActive ? stopSession() : startSession(); return; }
    if (!stream) { startCamera(); return; }
    if (S.mode === "photo") takePhoto();
    else if (clipRecorder) stopClip();
    else startClip();
}

/* ---------------------------------------------------------------------
   Gallery UI + viewer
   --------------------------------------------------------------------- */
let galleryItems = [];
let galleryUrls = [];
let galleryFilter = "all";
let viewerIndex = -1;

async function renderGallery() {
    galleryItems = await Store.all();
    galleryUrls.forEach((u) => URL.revokeObjectURL(u));
    galleryUrls = [];
    const g = $("gallery");
    g.innerHTML = "";
    const shown = galleryItems.filter((i) => galleryFilter === "all" || i.type === galleryFilter);
    const photos = galleryItems.filter((i) => i.type === "photo").length;
    const vids = galleryItems.length - photos;
    const bytes = galleryItems.reduce((a, i) => a + (i.size || (i.blob && i.blob.size) || 0), 0);
    $("galleryStats").textContent = galleryItems.length
        ? `${photos} photo${photos === 1 ? "" : "s"} · ${vids} video${vids === 1 ? "" : "s"} · ${fmtBytes(bytes)}`
        : "No captures yet";
    $("clearGalleryBtn").disabled = !galleryItems.length;

    if (!shown.length) {
        const empty = document.createElement("div");
        empty.className = "gallery-empty";
        empty.innerHTML = `<div class="ge-icon">🖼️</div><p></p>`;
        empty.querySelector("p").textContent = galleryItems.length
            ? "Nothing in this filter yet."
            : "Your photos and videos will show up here. They're saved on this device only.";
        g.appendChild(empty);
    }
    shown.forEach((item, idx) => {
        const url = URL.createObjectURL(item.blob);
        galleryUrls.push(url);
        const tile = document.createElement("button");
        tile.className = "g-tile " + item.type;
        tile.style.animationDelay = Math.min(idx, 12) * 30 + "ms";
        tile.setAttribute("aria-label", `${item.type === "photo" ? "Photo" : "Video"} from ${new Date(item.created).toLocaleString()}`);
        if (item.type === "photo") {
            const img = document.createElement("img");
            img.src = url; img.alt = ""; img.loading = "lazy";
            tile.appendChild(img);
        } else {
            const v = document.createElement("video");
            v.src = url + "#t=0.1"; v.muted = true; v.preload = "metadata"; v.playsInline = true;
            tile.appendChild(v);
            const badge = document.createElement("span");
            badge.className = "g-badge";
            badge.textContent = "▶ " + fmtTime(item.duration || 0);
            tile.appendChild(badge);
        }
        if (item.filter && item.filter !== "none") {
            const fb = document.createElement("span");
            fb.className = "g-filter";
            fb.textContent = filterById(item.filter).name;
            tile.appendChild(fb);
        }
        tile.addEventListener("click", () => openViewer(galleryItems.indexOf(item)));
        g.appendChild(tile);
    });

    // last-shot thumbnail
    const last = galleryItems[0];
    const ls = $("lastShot");
    ls.innerHTML = "";
    if (last) {
        const url = URL.createObjectURL(last.blob);
        galleryUrls.push(url);
        const el = document.createElement(last.type === "photo" ? "img" : "video");
        el.src = last.type === "photo" ? url : url + "#t=0.1";
        if (last.type === "video") { el.muted = true; el.preload = "metadata"; el.playsInline = true; }
        el.alt = "";
        ls.appendChild(el);
        pulse(ls);
    } else {
        ls.innerHTML = "<span>🖼️</span>";
    }
}

function itemName(item) {
    const d = new Date(item.created);
    const stamp = d.toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return `camera-app-${item.type}-${stamp}.${extFor(item.mime || item.blob.type)}`;
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1]);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
    });
}

async function downloadBlob(blob, name) {
    // Inside the Android app, blob downloads don't work — hand it to the native saver.
    if (window.AndroidSaver && typeof window.AndroidSaver.save === "function") {
        try {
            const b64 = await blobToBase64(blob);
            const where = window.AndroidSaver.save(b64, name, blob.type || "application/octet-stream");
            toast("💾", where ? `Saved to ${where}` : "Saved");
            return;
        } catch (e) { toast("⚠️", "Couldn't save the file"); return; }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast("⬇️", "Downloading " + name);
}

async function shareItem(item) {
    const name = itemName(item);
    try {
        const file = new File([item.blob], name, { type: item.mime || item.blob.type });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: "Camera App", text: "Captured with Camera App" });
            return;
        }
    } catch (e) {
        if (e && e.name === "AbortError") return;
    }
    toast("📤", "Sharing files isn't supported here — downloading instead");
    downloadBlob(item.blob, name);
}

function openViewer(index) {
    if (index < 0 || index >= galleryItems.length) return;
    viewerIndex = index;
    const item = galleryItems[index];
    let ov = $("viewerOv");
    if (!ov) {
        ov = modal("viewerOv", `
            <div class="viewer">
                <div class="viewer-media" id="viewerMedia"></div>
                <div class="viewer-side">
                    <h3 id="viewerTitle">Capture</h3>
                    <div class="viewer-meta" id="viewerMeta"></div>
                    <div class="viewer-actions">
                        <button id="vDownload">⬇ Download</button>
                        <button id="vShare" class="ghost-btn">📤 Share</button>
                        <button id="vDelete" class="ghost-btn danger">🗑 Delete</button>
                    </div>
                    <div class="viewer-nav">
                        <button id="vPrev" class="ghost-btn" aria-label="Previous">‹</button>
                        <span id="vCount"></span>
                        <button id="vNext" class="ghost-btn" aria-label="Next">›</button>
                    </div>
                </div>
            </div>`, "wide");
        $("vDownload").addEventListener("click", () => { const it = galleryItems[viewerIndex]; if (it) downloadBlob(it.blob, itemName(it)); });
        $("vShare").addEventListener("click", () => { const it = galleryItems[viewerIndex]; if (it) shareItem(it); });
        $("vDelete").addEventListener("click", () => deleteCurrent());
        $("vPrev").addEventListener("click", () => openViewer(viewerIndex - 1));
        $("vNext").addEventListener("click", () => openViewer(viewerIndex + 1));
    } else {
        showModal(ov);
    }
    const media = $("viewerMedia");
    media.querySelectorAll("img,video").forEach((m) => { if (m.dataset.url) URL.revokeObjectURL(m.dataset.url); });
    media.innerHTML = "";
    const url = URL.createObjectURL(item.blob);
    let el;
    if (item.type === "photo") { el = document.createElement("img"); el.alt = "Captured photo"; }
    else { el = document.createElement("video"); el.controls = true; el.playsInline = true; el.autoplay = true; el.loop = true; }
    el.src = url;
    el.dataset.url = url;
    media.appendChild(el);
    $("viewerTitle").textContent = item.type === "photo" ? "📸 Photo" : "🎬 Video";
    const meta = [
        ["When", new Date(item.created).toLocaleString()],
        ["Size", `${item.w || "?"}×${item.h || "?"} · ${fmtBytes(item.size || item.blob.size)}`],
        ["Filter", filterById(item.filter).name]
    ];
    if (item.type === "video") meta.push(["Length", fmtTime(item.duration || 0)]);
    $("viewerMeta").innerHTML = "";
    meta.forEach(([k, v]) => {
        const row = document.createElement("div");
        row.innerHTML = "<span></span><b></b>";
        row.firstChild.textContent = k;
        row.lastChild.textContent = v;
        $("viewerMeta").appendChild(row);
    });
    $("vCount").textContent = `${index + 1} / ${galleryItems.length}`;
    $("vPrev").disabled = index === 0;
    $("vNext").disabled = index === galleryItems.length - 1;
}

async function deleteCurrent() {
    const item = galleryItems[viewerIndex];
    if (!item) return;
    await Store.del(item.id);
    toast("🗑", "Deleted");
    await renderGallery();
    if (!galleryItems.length) { closeModal($("viewerOv")); return; }
    openViewer(Math.min(viewerIndex, galleryItems.length - 1));
}

/* ---------------------------------------------------------------------
   Modals: help, get the app, viewer
   --------------------------------------------------------------------- */
let lastFocus = null;
function modal(id, html, size) {
    let ov = $(id);
    if (ov) ov.remove();
    ov = document.createElement("div");
    ov.className = "modal-ov";
    ov.id = id;
    ov.innerHTML = `<div class="modal ${size || ""}" role="dialog" aria-modal="true">${html}<button class="modal-x" data-close aria-label="Close">✕</button></div>`;
    ov.addEventListener("click", (e) => {
        if (e.target === ov || e.target.closest("[data-close]")) closeModal(ov);
    });
    document.body.appendChild(ov);
    showModal(ov);
    return ov;
}
function showModal(ov) {
    lastFocus = document.activeElement;
    void ov.offsetWidth; // commit initial styles so the fade-in transition runs
    ov.classList.add("show");
    const x = ov.querySelector(".modal-x");
    if (x) x.focus({ preventScroll: true });
}
function closeModal(ov) {
    if (!ov) return;
    ov.classList.remove("show");
    if (ov.id === "viewerOv") {
        const v = ov.querySelector("video");
        if (v) v.pause();
    }
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
}
function openModalEl() { return document.querySelector(".modal-ov.show"); }

function openHelp() {
    modal("helpOv", `<h3>⌨️ Shortcuts & tips</h3>
        <div class="keys">
            <div><kbd>Space</kbd><span>Shutter — photo, start/stop video, start/stop session</span></div>
            <div><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><span>Photo · Video · AI Session mode</span></div>
            <div><kbd>[</kbd><kbd>]</kbd><span>Previous / next filter</span></div>
            <div><kbd>T</kbd><span>Cycle timer (off · 3s · 10s)</span></div>
            <div><kbd>B</kbd><span>Cycle burst (1 · 3 · 5)</span></div>
            <div><kbd>G</kbd><span>Rule-of-thirds grid</span></div>
            <div><kbd>F</kbd><span>Switch front / back camera</span></div>
            <div><kbd>M</kbd><span>Mirror preview</span></div>
            <div><kbd>A</kbd><span>AI pose overlay</span></div>
            <div><kbd>+</kbd><kbd>−</kbd><kbd>0</kbd><span>Zoom in / out / reset</span></div>
            <div><kbd>L</kbd><span>Open latest capture</span></div>
            <div><kbd>P</kbd><span>Pause / resume video</span></div>
            <div><kbd>Esc</kbd><span>Cancel timer · close dialogs</span></div>
            <div><kbd>?</kbd><span>This help</span></div>
        </div>
        <p class="muted">On phones: pinch the preview to zoom, double-tap to switch cameras. Trackpad pinch (Ctrl + scroll) zooms too.</p>`);
}

let deferredInstall = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; });
function openInstall() {
    const ov = modal("installOv", `<h3>📲 Get Camera App</h3>
        <div class="dl-grid">
            <a class="dl" href="${APK_URL}"><span>🤖</span><b>Android</b><small>Download the APK</small></a>
            <button class="dl" id="pwaBtn" type="button"><span>💻</span><b>Install app</b><small>Chrome / Edge</small></button>
            <div class="dl"><span>🍎</span><b>iPhone / iPad</b><small>Safari → Share → Add to Home Screen</small></div>
            <a class="dl" href="${RELEASES_URL}"><span>📦</span><b>All downloads</b><small>APK + offline zip</small></a>
        </div>
        <p class="muted">Works offline once installed. Photos and videos never leave your device.</p>`);
    ov.querySelector("#pwaBtn").addEventListener("click", async () => {
        if (deferredInstall) {
            deferredInstall.prompt();
            try { await deferredInstall.userChoice; } catch (e) { /* ignore */ }
            deferredInstall = null;
            closeModal(ov);
        } else {
            toast("💡", "Use your browser menu → Install app / Add to Home screen");
        }
    });
}

/* ---------------------------------------------------------------------
   Original pose + speech session (kept, with fixes)
   --------------------------------------------------------------------- */
function createDownloadLink(blob, filename, label) {
    const empty = downloadsEl.querySelector(".empty-note");
    if (empty) empty.remove();
    const oldRecent = downloadsEl.querySelectorAll(".download-link.recent-download");
    oldRecent.forEach((oldLink) => {
        oldLink.classList.remove("recent-download");
        const badge = oldLink.querySelector(".download-badge");
        if (badge) badge.remove();
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.className = "download-link recent-download";
    link.innerHTML = `<span></span><span class="download-badge">NEW</span>`;
    link.firstChild.textContent = label;
    if (window.AndroidSaver) {
        link.addEventListener("click", (e) => { e.preventDefault(); downloadBlob(blob, filename); });
    }
    downloadsEl.prepend(link);
}

function enableControls(active) {
    startSessionBtn.disabled = active;
    stopSessionBtn.disabled = !active;
}

function resizeCanvas() {
    const w = video.videoWidth || overlay.clientWidth;
    const h = video.videoHeight || overlay.clientHeight;
    if (overlay.width !== w) overlay.width = w;
    if (overlay.height !== h) overlay.height = h;
}

function waitForVideoMetadata() {
    return new Promise((resolve) => {
        if (video.videoWidth && video.videoHeight) {
            resolve();
        } else {
            video.addEventListener("loadedmetadata", () => resolve(), { once: true });
            setTimeout(resolve, 4000);
        }
    });
}

function getKeypoint(pose, name) {
    const normalized = name.toLowerCase();
    return pose.keypoints.find((point) => {
        if (point.score < 0.25) return false;
        const partName = String(point.name || point.part || "").toLowerCase();
        return partName === normalized;
    });
}

function drawPoints(pose) {
    for (const keypoint of pose.keypoints) {
        if (keypoint.score < 0.25) continue;
        const isWrist = String(keypoint.name || keypoint.part || "").toLowerCase().includes("wrist");
        ctx.fillStyle = isWrist ? "#ffcc33" : "#38d7ff";
        ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(keypoint.x, keypoint.y, isWrist ? 8 : 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.font = "13px Inter, Arial, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        const rawLabel = keypoint.name || keypoint.part || "";
        const label = rawLabel.replace(/_/g, " ");
        ctx.fillText(label, keypoint.x + 10, keypoint.y - 10);
    }
}

function drawSkeleton(pose) {
    const pairs = [
        ["left_shoulder", "right_shoulder"],
        ["left_shoulder", "left_elbow"],
        ["left_elbow", "left_wrist"],
        ["right_shoulder", "right_elbow"],
        ["right_elbow", "right_wrist"],
        ["left_hip", "right_hip"],
        ["left_shoulder", "left_hip"],
        ["right_shoulder", "right_hip"],
        ["left_hip", "left_knee"],
        ["left_knee", "left_ankle"],
        ["right_hip", "right_knee"],
        ["right_knee", "right_ankle"],
        ["nose", "left_eye"],
        ["nose", "right_eye"],
        ["left_eye", "left_ear"],
        ["right_eye", "right_ear"]
    ];
    const hue = Math.floor((performance.now() / 15) % 360);

    for (const [startName, endName] of pairs) {
        const start = getKeypoint(pose, startName);
        const end = getKeypoint(pose, endName);
        if (!start || !end) continue;
        ctx.strokeStyle = `hsla(${hue}, 95%, 64%, 0.9)`;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
    }
}

function drawHeadBox(pose) {
    const headPoints = [
        getKeypoint(pose, "nose"),
        getKeypoint(pose, "left_eye"),
        getKeypoint(pose, "right_eye"),
        getKeypoint(pose, "left_ear"),
        getKeypoint(pose, "right_ear")
    ].filter(Boolean);

    if (headPoints.length < 2) return;

    const xs = headPoints.map((point) => point.x);
    const ys = headPoints.map((point) => point.y);
    const minX = Math.min(...xs) - 24;
    const maxX = Math.max(...xs) + 24;
    const minY = Math.min(...ys) - 24;
    const maxY = Math.max(...ys) + 24;
    const width = maxX - minX;
    const height = maxY - minY;
    const hue = Math.floor((performance.now() / 8) % 360);

    ctx.strokeStyle = `hsla(${hue}, 100%, 60%, 0.95)`;
    ctx.lineWidth = 6;
    ctx.strokeRect(minX, minY, width, height);
    ctx.fillStyle = `hsla(${hue}, 100%, 67%, 0.95)`;
    ctx.font = "20px Inter, Arial, sans-serif";
    ctx.fillText("HEAD", minX + 10, minY + 28);
}

function updateShakeHistory(side, wrist, shoulder) {
    if (!wrist || !shoulder) {
        wristHistory[side] = [];
        return false;
    }

    const now = performance.now();
    const normalizedX = (wrist.x - shoulder.x) / overlay.width;
    wristHistory[side].push({ x: normalizedX, time: now });
    wristHistory[side] = wristHistory[side].filter((entry) => now - entry.time <= 1000);

    if (wristHistory[side].length < 6) return false;

    let directionChanges = 0;
    let lastSign = 0;
    for (let i = 1; i < wristHistory[side].length; i++) {
        const delta = wristHistory[side][i].x - wristHistory[side][i - 1].x;
        const sign = Math.sign(delta);
        if (sign === 0) continue;
        if (lastSign !== 0 && sign !== lastSign) directionChanges += 1;
        lastSign = sign;
    }

    const values = wristHistory[side].map((entry) => entry.x);
    const amplitude = Math.max(...values) - Math.min(...values);
    return directionChanges >= 2 && amplitude > 0.12;
}

function maybeSpeakShake(pose) {
    const leftWrist = getKeypoint(pose, "left_wrist");
    const rightWrist = getKeypoint(pose, "right_wrist");
    const leftShoulder = getKeypoint(pose, "left_shoulder");
    const rightShoulder = getKeypoint(pose, "right_shoulder");

    const leftShake = updateShakeHistory("left", leftWrist, leftShoulder);
    const rightShake = updateShakeHistory("right", rightWrist, rightShoulder);
    const now = Date.now();

    if ((leftShake || rightShake) && now - lastShakeTime > shakeCooldown) {
        lastShakeTime = now;
        speak("user is shaking the hand");
        toast("👋", "Hand shake detected");
    }
}

function speak(message) {
    if (!window.speechSynthesis) return;
    if (window.speechSynthesis.speaking) return;
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
}

function appendTranscript(text) {
    if (!text.trim()) return;
    transcriptLines.push(text.trim());
    transcriptEl.textContent = transcriptLines.join("\n");
}

function resetSession() {
    videoChunks = [];
    transcriptLines = [];
    transcriptEl.textContent = "";
    if (bodyInfoEl) bodyInfoEl.textContent = "No people detected yet.";
    if (expressionEl) expressionEl.textContent = "No expression data yet.";
}

function updateBodyInfo(poses) {
    if (!bodyInfoEl) return;
    if (!poses || poses.length === 0) {
        bodyInfoEl.textContent = "No people detected yet.";
        return;
    }

    const lines = poses.map((pose, index) => {
        const descriptor = pose.id != null ? `User ${index + 1} (ID ${pose.id})` : `User ${index + 1}`;
        const points = pose.keypoints
            .filter((point) => point.score > 0.4)
            .map((point, idx) => {
                const rawLabel = point.name || point.part || `part-${idx + 1}`;
                const label = rawLabel
                    .replace(/_/g, " ")
                    .replace(/\b\w/g, (c) => c.toUpperCase());
                const confidence = point.score >= 0.75 ? "high" : point.score >= 0.5 ? "medium" : "low";
                return `  • ${label}: (${Math.round(point.x)}, ${Math.round(point.y)}) [${confidence}]`;
            });

        return `${descriptor}:\n${points.join("\n")}`;
    });

    bodyInfoEl.textContent = lines.join("\n\n");
}

function inferExpression(pose) {
    if (!pose || !pose.keypoints) return "unknown";
    const nose = getKeypoint(pose, "nose");
    const leftEye = getKeypoint(pose, "left_eye");
    const rightEye = getKeypoint(pose, "right_eye");
    const leftShoulder = getKeypoint(pose, "left_shoulder");
    const rightShoulder = getKeypoint(pose, "right_shoulder");
    const leftWrist = getKeypoint(pose, "left_wrist");
    const rightWrist = getKeypoint(pose, "right_wrist");

    if (!nose || !leftShoulder || !rightShoulder) return "neutral";

    const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
    const shoulderSpan = Math.abs(leftShoulder.x - rightShoulder.x);
    const shoulderDiff = Math.abs(leftShoulder.y - rightShoulder.y);
    const headTilt = leftEye && rightEye ? Math.abs(leftEye.y - rightEye.y) / Math.max(Math.abs(leftEye.x - rightEye.x), 1) : 0;
    const lookingDown = nose.y > shoulderY + 35;
    const lookingUp = nose.y < shoulderY - 20;
    const shouldersClose = shoulderSpan < 140;
    const wristsUp =
        (leftWrist && leftWrist.y < leftShoulder.y - 25) ||
        (rightWrist && rightWrist.y < rightShoulder.y - 25);
    const wristNearFace = [leftWrist, rightWrist].some((wrist) => {
        if (!wrist) return false;
        const dx = wrist.x - nose.x;
        const dy = wrist.y - nose.y;
        return Math.hypot(dx, dy) < 130;
    });
    const aggressiveMotion = wristNearFace && wristsUp;
    const tensePosture = shoulderSpan > 220 && lookingDown;

    if (aggressiveMotion || tensePosture || (wristNearFace && shoulderSpan > 200)) return "mad";
    if (lookingDown && shoulderDiff < 24 && shouldersClose) return "sad";
    if (lookingUp && headTilt < 0.14 && !shouldersClose) return "happy";
    if (headTilt > 0.25) return "curious";
    if (shouldersClose && !lookingDown) return "dull";
    if (wristNearFace) return "focused";
    return "neutral";
}

const EXPRESSION_EMOJI = { mad: "😠", sad: "😢", happy: "😄", curious: "🤔", dull: "😐", focused: "🧐", neutral: "🙂", unknown: "❔" };
function updateExpressionInfo(poses) {
    if (!expressionEl) return;
    if (!poses || poses.length === 0) {
        expressionEl.textContent = "No expression data yet.";
        return;
    }

    const lines = poses.map((pose, index) => {
        const e = inferExpression(pose);
        return `User ${index + 1}: ${EXPRESSION_EMOJI[e] || ""} ${e}`;
    });

    expressionEl.textContent = lines.join("\n");
}

function handleMediaError(error) {
    console.warn(error);
    setStatus(`Media error: ${(error && error.message) || error}`);
}

let poseLibsPromise = null;
function ensurePoseLibs() {
    if (!poseLibsPromise) {
        poseLibsPromise = (async () => {
            if (!window.tf) await loadScript("vendor/tf.min.js").catch(() => loadScript(CDN_TF));
            if (!window.poseDetection) await loadScript("vendor/pose-detection.min.js").catch(() => loadScript(CDN_POSE));
        })().catch((e) => { poseLibsPromise = null; throw e; });
    }
    return poseLibsPromise;
}

async function setupPoseDetector() {
    if (detector) return;
    await ensurePoseLibs();
    if (typeof poseDetection === "undefined") {
        throw new Error("Pose Detection library failed to load.");
    }

    const types = (poseDetection.movenet && poseDetection.movenet.modelType) || {};
    const modelType = types.MULTIPOSE_LIGHTNING || types.MULTIPOSE_THUNDER || types.SINGLEPOSE_LIGHTNING || types.SINGLEPOSE_THUNDER;

    // Prefer the bundled offline model, fall back to the hosted one.
    if (modelType === types.MULTIPOSE_LIGHTNING) {
        try {
            detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet,
                { modelType, modelUrl: "vendor/movenet/model.json" });
            return;
        } catch (e) { console.warn("Offline MoveNet model unavailable, using hosted model.", e && e.message); }
    }
    detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, { modelType });
}

function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        setStatus("Speech recognition is not available in this browser.");
        transcriptEl.textContent = "Live transcription isn't available in this browser — the video and audio are still being recorded.";
        return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    let fatal = false;

    recognition.onstart = () => {
        setStatus("Speech recognition listening...");
    };

    recognition.onspeechstart = () => {
        speechActive = true;
        setStatus("Speech detected — transcribing live.");
    };

    recognition.onspeechend = () => {
        speechActive = false;
        setStatus("Speech paused. Continue talking to add to transcript.");
    };

    recognition.onresult = (event) => {
        let interim = "";
        let finalTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal) {
                finalTranscript += result[0].transcript;
            } else {
                interim += result[0].transcript;
            }
        }

        if (finalTranscript) {
            appendTranscript(finalTranscript);
        }

        transcriptEl.textContent = transcriptLines.join("\n") + (interim ? `\n\n${interim}` : "");
        transcriptEl.scrollTop = transcriptEl.scrollHeight;
    };

    recognition.onerror = (event) => {
        setStatus(`Speech recognition error: ${event.error}`);
        if (event.error === "no-speech") {
            setStatus("No speech detected yet. Try speaking clearly.");
        }
        // Don't hammer the service if it will never work (fix: endless restart loop)
        if (["not-allowed", "service-not-allowed", "audio-capture", "language-not-supported"].includes(event.error)) fatal = true;
    };

    recognition.onend = () => {
        if (sessionActive && recognition && !fatal) {
            try { recognition.start(); } catch (e) { /* already started */ }
        }
    };
    try { recognition.start(); } catch (e) { setStatus("Speech recognition could not start."); }
}

function startFullRecorder() {
    if (!stream || !window.MediaRecorder) return;
    videoChunks = [];

    try {
        videoRecorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8,opus" });
    } catch (error) {
        try { videoRecorder = new MediaRecorder(stream); } catch (e) { videoRecorder = null; return; }
    }
    const started = performance.now();

    videoRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
            videoChunks.push(event.data);
        }
    };

    videoRecorder.onstop = async () => {
        videoRecorder = null;
        if (!videoChunks.length) return;
        const type = (videoChunks[0] && videoChunks[0].type) || "video/webm";
        const blob = new Blob(videoChunks, { type });
        createDownloadLink(blob, formatFilename("session-recording", extFor(type)), "Download merged session video");
        await Store.put({
            id: Date.now() + "-s", type: "video", blob, mime: type, created: Date.now(), filter: "none",
            w: video.videoWidth, h: video.videoHeight, duration: (performance.now() - started) / 1000, size: blob.size, session: true
        });
        renderGallery();
        setStatus("Session recording saved. Download ready.");
    };

    videoRecorder.start(500);
}

function stopFullRecorder() {
    if (videoRecorder && videoRecorder.state !== "inactive") {
        videoRecorder.stop();
    }
}

async function startSession() {
    if (sessionActive) return;
    if (clipRecorder) stopClip();
    if (S.mode !== "session") setMode("session", true);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showState(window.isSecureContext === false ? "insecure" : "unsupported");
        return;
    }
    resetSession();
    startSessionBtn.disabled = true;

    try {
        setStatus("Starting session... requesting camera and microphone.");
        stopTracks();
        showState("loading");
        const s = await getStream(true);
        sessionActive = true;
        await attachStream(s);
        setStatus("Loading pose detector...");
        try {
            await setupPoseDetector();
        } catch (e) {
            toast("🤖", "Pose detector couldn't load — recording and transcript still work");
        }
        setupSpeechRecognition();
        startFullRecorder();
        startPoseLoop();
        setStatus("Session active. Recording video + audio and transcribing speech.");
        enableControls(true);
        frameEl.classList.add("recording");
        $("recPill").hidden = false;
        clipStart = performance.now(); clipPausedTotal = 0; clipPausedAt = 0;
        clearInterval(clipTick);
        clipTick = setInterval(updateRecTime, 250);
        updateShutter();
        beep(660, 0.12, "triangle");
    } catch (error) {
        sessionActive = false;
        enableControls(false);
        const kind = explainError(error);
        showState(kind);
        handleMediaError(error);
        updateShutter();
    }
}

function stopSession() {
    if (!sessionActive && !stream) return;
    sessionActive = false;
    if (!S.pose) poseLoopId++; // end the pose loop right away so the UI frees up
    stopFullRecorder();
    if (recognition) {
        try { recognition.stop(); } catch (e) { /* ignore */ }
        recognition = null;
    }
    if (transcriptLines.length) {
        createDownloadLink(new Blob([transcriptLines.join("\n")], { type: "text/plain" }), formatFilename("transcript", "txt"), "Download speech transcript");
    }
    clearInterval(clipTick);
    $("recPill").hidden = true;
    frameEl.classList.remove("recording");
    stopTracks();
    video.srcObject = null;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    enableControls(false);
    updateShutter();
    beep(440, 0.12, "triangle");
    setStatus("Session stopped. Use downloads to save captured files.");
    // bring the preview back (camera only) so you can keep shooting
    setTimeout(() => { if (!sessionActive && !stream) startCamera().then(() => setStatus("Session stopped. Use downloads to save captured files.")); }, 400);
}

/* Single pose loop (fix: the old loop kept spawning a new copy on every start) */
function startPoseLoop() {
    const id = ++poseLoopId;
    const loop = async () => {
        if (id !== poseLoopId) return;
        const wanted = (S.pose || sessionActive) && stream;
        if (!wanted) {
            ctx.clearRect(0, 0, overlay.width, overlay.height);
            return;
        }
        if (!detector) {
            try { await setupPoseDetector(); } catch (e) {
                toast("🤖", "Pose detector couldn't load");
                S.pose = false; persist(); updatePoseBtn();
                return;
            }
        }
        if (video.readyState >= 2 && !document.hidden) {
            try {
                resizeCanvas();
                const t0 = performance.now();
                const poses = await detector.estimatePoses(video, { maxPoses: 4, flipHorizontal: !!S.mirror });
                poseCost = performance.now() - t0;
                if (id !== poseLoopId) return;
                ctx.clearRect(0, 0, overlay.width, overlay.height);
                lastPoses = poses || [];
                if (lastPoses.length > 0) {
                    lastPoses.forEach((pose) => {
                        drawSkeleton(pose);
                        drawHeadBox(pose);
                        drawPoints(pose);
                        if (sessionActive) maybeSpeakShake(pose);
                    });
                    updateBodyInfo(lastPoses);
                    updateExpressionInfo(lastPoses);
                } else {
                    updateBodyInfo(null);
                    updateExpressionInfo(null);
                }
            } catch (e) {
                // transient frame errors shouldn't kill the loop
            }
        }
        // Adaptive throttle: on slow devices, give the UI breathing room between frames
        if (poseCost > 60) setTimeout(() => requestAnimationFrame(loop), Math.min(4000, poseCost * 1.5));
        else requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
}

function updatePoseBtn() {
    $("poseBtn").setAttribute("aria-pressed", S.pose ? "true" : "false");
    $("poseBtn").classList.toggle("on", !!S.pose);
}
async function togglePose() {
    S.pose = !S.pose;
    persist();
    updatePoseBtn();
    if (S.pose) {
        toast("🤖", "AI pose overlay on — loading model…");
        if (stream) startPoseLoop();
    } else if (!sessionActive) {
        poseLoopId++;
        ctx.clearRect(0, 0, overlay.width, overlay.height);
        toast("🤖", "AI pose overlay off");
    }
}

/* ---------------------------------------------------------------------
   Segmented controls + toggles
   --------------------------------------------------------------------- */
function bindSeg(id, key, label) {
    const seg = $(id);
    const sync = () => seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", +b.dataset.v === +S[key]));
    seg.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        S[key] = +b.dataset.v; persist(); sync();
    });
    sync();
    return () => {
        const vals = [...seg.querySelectorAll("button")].map((b) => +b.dataset.v);
        S[key] = vals[(vals.indexOf(+S[key]) + 1) % vals.length];
        persist(); sync();
        toast(label[0], label[1](S[key]));
    };
}
const cycleTimer = bindSeg("timerSeg", "timer", ["⏱️", (v) => v ? `Timer: ${v}s` : "Timer off"]);
const cycleBurst = bindSeg("burstSeg", "burst", ["📸", (v) => v > 1 ? `Burst: ${v} shots` : "Burst off"]);

function bindToggle(id, key) {
    const el = $(id);
    el.checked = !!S[key];
    el.addEventListener("change", () => { S[key] = el.checked; persist(); });
}
bindToggle("audioToggle", "audio");
bindToggle("soundToggle", "sound");
bindToggle("stampToggle", "stamp");

function shareSetup() {
    const q = new URLSearchParams();
    if (S.filter !== "none") q.set("filter", S.filter);
    if (+S.timer) q.set("timer", S.timer);
    if (+S.burst > 1) q.set("burst", S.burst);
    if (S.grid) q.set("grid", "1");
    if (S.mode !== "photo") q.set("mode", S.mode);
    const url = location.origin + location.pathname + (q.toString() ? "?" + q : "");
    const done = () => toast("🔗", "Setup link copied");
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done).catch(() => prompt("Copy this link:", url));
    } else {
        prompt("Copy this link:", url);
    }
}

/* ---------------------------------------------------------------------
   Events
   --------------------------------------------------------------------- */
startSessionBtn.addEventListener("click", startSession);
stopSessionBtn.addEventListener("click", stopSession);
shutterBtn.addEventListener("click", pressShutter);
$("pauseBtn").addEventListener("click", togglePauseClip);
$("stateBtn").addEventListener("click", () => (S.mode === "session" ? startSession() : startCamera()));
$("stateGalleryBtn").addEventListener("click", () => {
    if (galleryItems.length) openViewer(0);
    else $("gallery").scrollIntoView({ behavior: "smooth", block: "center" });
});
$("flipBtn").addEventListener("click", flipCamera);
$("gridBtn").addEventListener("click", () => { S.grid = !S.grid; persist(); applyGrid(); });
$("mirrorBtn").addEventListener("click", () => { S.mirror = !S.mirror; persist(); applyMirror(); toast("⇋", S.mirror ? "Mirror on" : "Mirror off"); });
$("poseBtn").addEventListener("click", togglePose);
$("torchBtn").addEventListener("click", async () => {
    const track = stream && stream.getVideoTracks()[0];
    if (!track) return;
    try {
        torchOn = !torchOn;
        await track.applyConstraints({ advanced: [{ torch: torchOn }] });
        $("torchBtn").classList.toggle("on", torchOn);
    } catch (e) { torchOn = false; toast("🔦", "Torch not available"); }
});
$("lastShot").addEventListener("click", () => {
    if (galleryItems.length) openViewer(0);
    else toast("🖼️", "No captures yet — take a photo!");
});
$("helpBtn").addEventListener("click", openHelp);
$("installBtn").addEventListener("click", openInstall);
$("shareSetupBtn").addEventListener("click", shareSetup);
$("clearGalleryBtn").addEventListener("click", async () => {
    if (!galleryItems.length) return;
    if (!confirm(`Delete all ${galleryItems.length} captures from this device?`)) return;
    await Store.clear();
    await renderGallery();
    toast("🗑", "Gallery cleared");
});
$("galleryFilter").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    galleryFilter = b.dataset.v;
    $("galleryFilter").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    renderGallery();
});
document.querySelectorAll(".mode-tab").forEach((t) => t.addEventListener("click", () => setMode(t.dataset.mode)));
zoomSlider.addEventListener("input", () => setZoom(+zoomSlider.value));
$("zoomPill").addEventListener("click", resetZoom);
$("zoomPill").addEventListener("keydown", (e) => { if (e.key === "Enter") resetZoom(); });

// Ctrl/⌘ + wheel (trackpad pinch) zoom
frameEl.addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const step = (+zoomSlider.max - +zoomSlider.min) / 30;
    setZoom(+zoomSlider.value - Math.sign(e.deltaY) * step);
}, { passive: false });

// Touch: pinch to zoom, double-tap to flip
let pinch = null;
let lastTap = 0;
frameEl.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
        const [a, b] = e.touches;
        pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: +zoomSlider.value };
    } else if (e.touches.length === 1 && !e.target.closest("button")) {
        const now = Date.now();
        if (now - lastTap < 300 && stream) { flipCamera(); lastTap = 0; } else lastTap = now;
    }
}, { passive: true });
frameEl.addEventListener("touchmove", (e) => {
    if (!pinch || e.touches.length !== 2) return;
    const [a, b] = e.touches;
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    setZoom(pinch.z * d / pinch.d);
}, { passive: true });
frameEl.addEventListener("touchend", () => { pinch = null; }, { passive: true });
frameEl.addEventListener("dblclick", (e) => { if (!e.target.closest("button") && stream && !("ontouchstart" in window)) flipCamera(); });

document.addEventListener("keydown", (e) => {
    const open = openModalEl();
    if (e.key === "Escape") {
        if (open) { closeModal(open); return; }
        cancelCountdown();
        return;
    }
    if (open) {
        if (open.id === "viewerOv") {
            if (e.key === "ArrowLeft") openViewer(viewerIndex - 1);
            else if (e.key === "ArrowRight") openViewer(viewerIndex + 1);
            else if (e.key === "Delete") deleteCurrent();
        }
        return;
    }
    const t = e.target;
    const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && t.type !== "checkbox" && t.type !== "range";
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        if (e.repeat) return;
        if (document.activeElement && document.activeElement.blur && document.activeElement !== document.body) document.activeElement.blur();
        pressShutter();
        return;
    }
    if (t && t.type === "range" && /^Arrow/.test(e.key)) return;
    const k = e.key.toLowerCase();
    if (k === "?") return openHelp();
    if (k === "1") return setMode("photo");
    if (k === "2") return setMode("video");
    if (k === "3") return setMode("session");
    if (k === "[") return stepFilter(-1);
    if (k === "]") return stepFilter(1);
    if (k === "t") return cycleTimer();
    if (k === "b") return cycleBurst();
    if (k === "g") return $("gridBtn").click();
    if (k === "f") return flipCamera();
    if (k === "m") return $("mirrorBtn").click();
    if (k === "a") return togglePose();
    if (k === "l") return $("lastShot").click();
    if (k === "p") return togglePauseClip();
    if (k === "+" || k === "=") return setZoom(+zoomSlider.value + 0.5);
    if (k === "-" || k === "_") return setZoom(+zoomSlider.value - 0.5);
    if (k === "0") return resetZoom();
});

window.addEventListener("resize", resizeCanvas);
document.addEventListener("visibilitychange", () => {
    // Stop the camera light when the app is backgrounded (unless recording)
    if (document.hidden && stream && !sessionActive && !clipRecorder && !busyCapturing) {
        stopTracks();
        video.srcObject = null;
        frameEl.dataset.paused = "1";
    } else if (!document.hidden && frameEl.dataset.paused === "1") {
        delete frameEl.dataset.paused;
        startCamera();
    }
});

/* ---------------------------------------------------------------------
   Init
   --------------------------------------------------------------------- */
buildFilterStrip();
applyFilter();
applyMirror();
applyGrid();
updatePoseBtn();
setMode(S.mode, true);
enableControls(false);
showState("idle");
renderGallery();

(async function autoStart() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showState(window.isSecureContext === false ? "insecure" : "unsupported");
        return;
    }
    // Only auto-start when permission was already granted — no surprise prompts.
    try {
        if (navigator.permissions && navigator.permissions.query) {
            const p = await navigator.permissions.query({ name: "camera" });
            if (p.state === "granted") { startCamera(); return; }
            if (p.state === "denied") { showState("denied"); return; }
        }
    } catch (e) { /* camera permission query unsupported (Firefox/Safari) */ }
    if (window.Capacitor) startCamera(); // inside the Android app, just start
})();
// The Android app fires this after the runtime CAMERA permission dialog
window.addEventListener("androidpermissions", () => { if (!stream && !sessionActive) startCamera(); });

if (!S.onboarded) {
    S.onboarded = true;
    persist();
    setTimeout(() => toast("💡", "Tip: press Space for the shutter, ? for all shortcuts", 4200), 1500);
}

if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
}
