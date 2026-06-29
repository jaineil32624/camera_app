const video = document.getElementById("camera");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");
const statusEl = document.getElementById("status");
const transcriptEl = document.getElementById("transcript");
const downloadsEl = document.getElementById("downloads");
const bodyInfoEl = document.getElementById("bodyInfo");
const expressionEl = document.getElementById("expressionInfo");
const startSessionBtn = document.getElementById("startSessionBtn");
const stopSessionBtn = document.getElementById("stopSessionBtn");

let stream = null;
let detector = null;
let recognition = null;
let videoRecorder = null;
let speechActive = false;
let videoChunks = [];
let transcriptLines = [];
let lastShakeTime = 0;
const shakeCooldown = 2000;
const wristHistory = {
    left: [],
    right: []
};

function setStatus(message) {
    if (statusEl) {
        statusEl.textContent = message;
    }
}

function createDownloadLink(blob, filename, label) {
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
    link.innerHTML = `<span>${label}</span><span class="download-badge">NEW</span>`;
    downloadsEl.prepend(link);
}

function formatFilename(prefix, extension) {
    const now = new Date();
    return `${prefix}-${now.toISOString().replace(/[:.]/g, "-")}.${extension}`;
}

function enableControls(sessionActive) {
    startSessionBtn.disabled = sessionActive;
    stopSessionBtn.disabled = !sessionActive;
}

function resizeCanvas() {
    overlay.width = video.videoWidth || overlay.clientWidth;
    overlay.height = video.videoHeight || overlay.clientHeight;
}

function waitForVideoMetadata() {
    return new Promise((resolve) => {
        if (video.videoWidth && video.videoHeight) {
            resolve();
        } else {
            video.addEventListener("loadedmetadata", () => resolve(), { once: true });
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
    if (bodyInfoEl) {
        bodyInfoEl.textContent = "No people detected yet.";
    }
    if (expressionEl) {
        expressionEl.textContent = "No expression data yet.";
    }
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

function updateExpressionInfo(poses) {
    if (!expressionEl) return;
    if (!poses || poses.length === 0) {
        expressionEl.textContent = "No expression data yet.";
        return;
    }

    const lines = poses.map((pose, index) => {
        return `User ${index + 1}: ${inferExpression(pose)}`;
    });

    expressionEl.textContent = lines.join("\n");
}

function handleMediaError(error) {
    console.error(error);
    setStatus(`Media error: ${error?.message || error}`);
}

async function setupPoseDetector() {
    if (detector) return;
    if (typeof poseDetection === "undefined") {
        throw new Error("Pose Detection library failed to load.");
    }

    const modelType =
        poseDetection.movenet?.modelType?.MULTIPOSE_LIGHTNING ||
        poseDetection.movenet?.modelType?.MULTIPOSE_THUNDER ||
        poseDetection.movenet?.modelType?.SINGLEPOSE_LIGHTNING ||
        poseDetection.movenet?.modelType?.SINGLEPOSE_THUNDER;

    detector = await poseDetection.createDetector(
        poseDetection.SupportedModels.MoveNet,
        { modelType }
    );
}

function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        setStatus("Speech recognition is not available in this browser.");
        return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

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
    };

    recognition.onerror = (event) => {
        setStatus(`Speech recognition error: ${event.error}`);
        if (event.error === "no-speech") {
            statusEl.textContent = "No speech detected yet. Try speaking clearly.";
        }
    };

    recognition.onend = () => {
        if (stream) {
            recognition.start();
        }
    };
    recognition.start();
}


function startFullRecorder() {
    if (!stream) return;
    videoChunks = [];

    try {
        videoRecorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8,opus" });
    } catch (error) {
        videoRecorder = new MediaRecorder(stream);
    }

    videoRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
            videoChunks.push(event.data);
        }
    };

    videoRecorder.onstop = () => {
        if (!videoChunks.length) return;
        const blob = new Blob(videoChunks, { type: videoChunks[0]?.type || "video/webm" });
        createDownloadLink(blob, formatFilename("session-recording", "webm"), "Download merged session video");
        setStatus("Session recording saved. Download ready.");
        videoRecorder = null;
    };

    videoRecorder.start(500);
}

function stopFullRecorder() {
    if (videoRecorder && videoRecorder.state !== "inactive") {
        videoRecorder.stop();
    }
}

async function startSession() {
    if (stream) return;
    resetSession();

    try {
        setStatus("Starting session... requesting camera and microphone.");
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, facingMode: "user" }, audio: true });
        video.srcObject = stream;
        await video.play();
        await waitForVideoMetadata();
        resizeCanvas();
        setStatus("Loading pose detector...");
        await setupPoseDetector();
        setupSpeechRecognition();
        startFullRecorder();
        requestAnimationFrame(runPoseDetection);
        setStatus("Session active. Recording video + audio and transcribing speech.");
        startSessionBtn.disabled = true;
        stopSessionBtn.disabled = false;
    } catch (error) {
        handleMediaError(error);
    }
}

function stopSession() {
    stopFullRecorder();
    if (recognition) {
        recognition.stop();
        recognition = null;
    }
    if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
    }
    video.srcObject = null;
    setStatus("Session stopped. Use downloads to save captured files.");
    startSessionBtn.disabled = false;
    stopSessionBtn.disabled = true;
}

async function runPoseDetection() {
    if (!stream || !detector) {
        requestAnimationFrame(runPoseDetection);
        return;
    }

    if (video.readyState >= 2) {
        resizeCanvas();
        ctx.clearRect(0, 0, overlay.width, overlay.height);
        const poses = await detector.estimatePoses(video, { maxPoses: 4, flipHorizontal: true });
        if (poses.length > 0) {
            poses.forEach((pose) => {
                drawSkeleton(pose);
                drawHeadBox(pose);
                drawPoints(pose);
                maybeSpeakShake(pose);
            });
            updateBodyInfo(poses);
            updateExpressionInfo(poses);
        } else {
            updateBodyInfo(null);
            updateExpressionInfo(null);
        }
    }
    requestAnimationFrame(runPoseDetection);
}

startSessionBtn.addEventListener("click", startSession);
stopSessionBtn.addEventListener("click", stopSession);
window.addEventListener("resize", resizeCanvas);
enableControls(false);
