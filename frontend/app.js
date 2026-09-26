// ============================================================
// AIR CANVAS - VIDEO MEETING
// COMPLETE CLEAN APP.JS
// ============================================================

"use strict";

// ============================================================
// CONFIG
// ============================================================

const BACKEND_URL =
    (location.hostname === "localhost" || location.hostname === "127.0.0.1")
        ? "http://localhost:8000"
        : "https://air-canvas-video-meeting.onrender.com";

const WS_URL =
    (location.hostname === "localhost" || location.hostname === "127.0.0.1")
        ? "ws://localhost:8000"
        : "wss://air-canvas-video-meeting.onrender.com";

const LIVEKIT_SERVER_URL = "wss://air-canvas-3zfbpfwj.livekit.cloud";
const LIVEKIT_TOKEN_SERVER_ID = "aircanvas-sixxay";

const MAX_PARTICIPANTS = 5;
const MAX_GUEST_DRAWERS = 2;

const PREDICTION_INTERVAL_MS = 80;
const DRAW_SEND_INTERVAL_MS = 20;
const CLEAR_COOLDOWN_MS = 700;

const MEDIAPIPE_PROCESS_WIDTH = 640;
const MEDIAPIPE_PROCESS_HEIGHT = 360;

// ============================================================
// DOM
// ============================================================

const homeScreen = document.getElementById("homeScreen");
const meetingScreen = document.getElementById("meetingScreen");
const userNameInput = document.getElementById("userNameInput");
const homeStartCamera = document.getElementById("homeStartCamera");
const cameraStatus = document.getElementById("cameraStatus");
const createMeetingButton = document.getElementById("createMeetingButton");
const meetingIdInput = document.getElementById("meetingIdInput");
const joinMeetingButton = document.getElementById("joinMeetingButton");
const meetingIdDisplay = document.getElementById("meetingIdDisplay");
const meetingIdLarge = document.getElementById("meetingIdLarge");
const copyMeetingId = document.getElementById("copyMeetingId");
const connectionStatus = document.getElementById("connectionStatus");
const localParticipantLabel = document.getElementById("localParticipantLabel");
const remoteParticipantLabel = document.getElementById("remoteParticipantLabel");
const waitingParticipant = document.getElementById("waitingParticipant");
const video = document.getElementById("video");
const remoteVideo = document.getElementById("remoteVideo");
const remoteAudio = document.getElementById("remoteAudio");
const airCanvas = document.getElementById("airCanvas");
const landmarkCanvas = document.getElementById("landmarkCanvas");
const gestureDisplay = document.getElementById("gesture");
const confidenceDisplay = document.getElementById("confidence");
const startCameraBtn = document.getElementById("startCamera");
const clearCanvasBtn = document.getElementById("clearCanvas");
const muteButton = document.getElementById("muteButton");
const cameraButton = document.getElementById("cameraButton");
const leaveMeetingBtn = document.getElementById("leaveMeeting");
const participantsGrid = document.querySelector(".participants-grid");
const meetingMain = document.querySelector(".meeting-main");

const chatButton = document.getElementById("chatButton");
const chatPanel = document.getElementById("chatPanel");
const closeChatButton = document.getElementById("closeChatButton");
const chatMessages = document.getElementById("chatMessages");
const chatEmptyState = document.getElementById("chatEmptyState");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatUnreadBadge = document.getElementById("chatUnreadBadge");

const participantsButton = document.getElementById("participantsButton");
const participantsPanel = document.getElementById("participantsPanel");
const closeParticipantsButton = document.getElementById("closeParticipantsButton");
const participantsList = document.getElementById("participantsList");
const participantsPanelCount = document.getElementById("participantsPanelCount");
const participantCount = document.getElementById("participantCount");

let chatUnreadCount = 0;

// ============================================================
// STATE
// ============================================================

let localStream = null;
let ws = null;
let wsConnected = false;
let wsReconnectTimer = null;

let liveKitRoom = null;
let liveKitConnected = false;
let liveKitSDKPromise = null;

let meetingId = null;
let userId = null;
let userName = "Participant";

let isMeetingCreator = false;
let meetingActive = false;
let canvasEnabled = false;
let drawingPermissionsPanel = null;
let drawingPermissionRequested = false;
let drawingPermissionStatus = "";
const drawingPermissionRequests = new Set();

let isCameraStarted = false;
let isMuted = false;
let isCameraOff = false;

let liveKitIdentity =
    "aircanvas-" + Math.random().toString(36).substring(2, 10);

// ============================================================
// MEDIAPIPE STATE
// ============================================================

let hands = null;
let camera = null;
let mediaPipeStarted = false;
let mediaPipeFrameCanvas = null;
let mediaPipeFrameCtx = null;

// ============================================================
// GESTURE STATE
// ============================================================

let activeGesture = "no_gesture";
let activeConfidence = 0;
let predictionInProgress = false;
let pendingLandmarks = null;
let lastPredictionTime = 0;
let lastClearTime = 0;

// ============================================================
// DRAWING STATE
// ============================================================

let isDrawing = false;
let lastDrawX = 0;
let lastDrawY = 0;
let smoothDrawX = null;
let smoothDrawY = null;
let lastDrawSendTime = 0;

// ============================================================
// REMOTE PARTICIPANTS
// ============================================================

const remoteParticipants = new Map();
const userIdToLiveKitIdentity = new Map();
const liveKitIdentityToUserId = new Map();
const participantInfo = new Map();
const pendingRemoteDrawingHistory = new Map();
const remoteLastDrawPoint = new Map();

// ============================================================
// HELPERS
// ============================================================

function generateUserId() {
    return "user-" + Date.now().toString(36) + "-" + Math.random().toString(36).substring(2, 8);
}

function generateMeetingId() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < 6; i++) result += chars[Math.floor(Math.random() * chars.length)];
    return result;
}

function normalizeMeetingId(value) {
    return String(value || "").trim().toUpperCase();
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function setConnectionStatus(text) {
    if (connectionStatus) connectionStatus.textContent = `Backend: ${text}`;
}

function updateParticipantCount() {
    const count = 1 + remoteParticipants.size;
    if (participantCount) participantCount.textContent = String(count);
    if (participantsPanelCount) {
        participantsPanelCount.textContent = `${count} participant${count === 1 ? "" : "s"}`;
    }
    renderParticipantsList();
}

function getInitials(name) {
    const value = String(name || "Participant").trim();
    if (!value) return "P";
    return value.split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join("") || "P";
}

function formatChatTime(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function setChatUnreadCount(count) {
    chatUnreadCount = Math.max(0, Number(count) || 0);
    if (!chatUnreadBadge) return;
    chatUnreadBadge.textContent = String(chatUnreadCount);
    chatUnreadBadge.classList.toggle("hidden", chatUnreadCount === 0);
}

// ============================================================
// CHAT
// ============================================================

function openChatPanel() {
    if (!chatPanel) return;
    if (participantsPanel) participantsPanel.classList.add("hidden");
    if (meetingScreen) meetingScreen.classList.add("side-panel-open");
    chatPanel.classList.remove("hidden");
    setChatUnreadCount(0);
    if (chatInput) setTimeout(() => chatInput.focus(), 0);
}

function closeChatPanel() {
    if (chatPanel) chatPanel.classList.add("hidden");
    if (participantsPanel?.classList.contains("hidden")) {
        meetingScreen?.classList.remove("side-panel-open");
    }
}

function openParticipantsPanel() {
    if (!participantsPanel) return;
    if (chatPanel) chatPanel.classList.add("hidden");
    if (meetingScreen) meetingScreen.classList.add("side-panel-open");
    participantsPanel.classList.remove("hidden");
    renderParticipantsList();
}

function closeParticipantsPanel() {
    if (participantsPanel) participantsPanel.classList.add("hidden");
    if (chatPanel?.classList.contains("hidden")) {
        meetingScreen?.classList.remove("side-panel-open");
    }
}

function appendChatMessage(data) {
    if (!chatMessages) return;
    if (chatEmptyState) chatEmptyState.remove();

    const senderId = String(data?.user_id || data?.sender_user_id || "");
    const senderName = data?.user_name || data?.sender_name || "Participant";
    const text = String(data?.message ?? data?.text ?? "").trim();
    if (!text) return;

    const message = document.createElement("div");
    message.className = "chat-message" + (senderId && senderId === String(userId) ? " mine" : "");

    const meta = document.createElement("div");
    meta.className = "chat-message-meta";

    const name = document.createElement("span");
    name.className = "chat-message-name";
    name.textContent = senderId && senderId === String(userId) ? "You" : senderName;

    const time = document.createElement("span");
    time.className = "chat-message-time";
    time.textContent = formatChatTime(data?.timestamp);

    const bubble = document.createElement("div");
    bubble.className = "chat-message-bubble";
    bubble.textContent = text;

    meta.append(name, time);
    message.append(meta, bubble);
    chatMessages.appendChild(message);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    const chatIsOpen = chatPanel && !chatPanel.classList.contains("hidden");
    if (!chatIsOpen && senderId !== String(userId)) {
        setChatUnreadCount(chatUnreadCount + 1);
    }
}

function sendChatMessage() {
    const text = String(chatInput?.value || "").trim();
    if (!text) return;

    if (!wsConnected || !ws || ws.readyState !== WebSocket.OPEN) {
        console.warn("⚠️ Cannot send chat: WebSocket not connected.");
        return;
    }

    const message = {
        type: "chat_message",
        user_id: String(userId || liveKitIdentity),
        user_name: userName || "Participant",
        livekit_identity: liveKitIdentity,
        message: text,
        timestamp: new Date().toISOString()
    };

    try {
        ws.send(JSON.stringify(message));
        appendChatMessage(message);
        if (chatInput) {
            chatInput.value = "";
            chatInput.focus();
        }
    } catch (error) {
        console.error("❌ Chat send error:", error);
    }
}

// ============================================================
// PARTICIPANTS LIST
// ============================================================

function renderParticipantsList() {
    if (!participantsList) return;

    const entries = [];
    entries.push([
        String(userId || "local"),
        {
            userId: String(userId || "local"),
            name: userName || "You",
            isCreator: Boolean(isMeetingCreator),
            canvasEnabled: Boolean(isMeetingCreator || canvasEnabled),
            isLocal: true
        }
    ]);

    participantInfo.forEach((info, id) => {
        if (String(id) === String(userId)) return;
        entries.push([String(id), info]);
    });

    remoteParticipants.forEach((tile) => {
        const identity = String(tile.identity);
        const existingIndex = entries.findIndex(
            ([, info]) => String(info.livekitIdentity || "") === identity
        );
        if (existingIndex >= 0) {
            const existingInfo = entries[existingIndex][1];
            existingInfo.livekitIdentity = identity;
            if (!existingInfo.name || existingInfo.name === "Participant") {
                existingInfo.name = tile.participant?.name || "Participant";
            }
            return;
        }
        entries.push([identity, {
            userId: identity,
            name: tile.participant?.name || "Participant",
            isCreator: false,
            canvasEnabled: false,
            livekitIdentity: identity
        }]);
    });

    participantsList.innerHTML = "";

    entries.forEach(([id, info]) => {
        const row = document.createElement("div");
        row.className = "participant-list-row";

        const avatar = document.createElement("div");
        avatar.className = "participant-list-avatar";
        avatar.textContent = getInitials(info.name);

        const infoBox = document.createElement("div");
        infoBox.className = "participant-list-info";

        const name = document.createElement("div");
        name.className = "participant-list-name";
        name.textContent = info.isLocal ? `${info.name || "You"} (You)` : info.name || "Participant";

        const role = document.createElement("div");
        role.className = "participant-list-role";
        role.textContent = info.isCreator ? "Host" : "Participant";

        infoBox.append(name, role);

        const drawStatus = document.createElement("div");
        drawStatus.className = "participant-draw-status";
        drawStatus.textContent = info.canvasEnabled ? "🎨 Drawing" : "View only";

        row.append(avatar, infoBox, drawStatus);
        participantsList.appendChild(row);
    });

    const count = entries.length;
    if (participantCount) participantCount.textContent = String(Math.max(count, 1 + remoteParticipants.size));
    if (participantsPanelCount) {
        const displayCount = Math.max(count, 1 + remoteParticipants.size);
        participantsPanelCount.textContent = `${displayCount} participant${displayCount === 1 ? "" : "s"}`;
    }
}

function initializeMeetingPanels() {
    if (chatButton) chatButton.addEventListener("click", openChatPanel);
    if (closeChatButton) closeChatButton.addEventListener("click", closeChatPanel);
    if (participantsButton) participantsButton.addEventListener("click", openParticipantsPanel);
    if (closeParticipantsButton) closeParticipantsButton.addEventListener("click", closeParticipantsPanel);
    if (chatForm) {
        chatForm.addEventListener("submit", (event) => {
            event.preventDefault();
            sendChatMessage();
        });
    }
    updateParticipantCount();
}

// ============================================================
// CANVAS AVAILABILITY
// ============================================================

function updateCanvasAvailability() {
    const canDraw = isMeetingCreator || canvasEnabled;

    if (clearCanvasBtn) {
        clearCanvasBtn.disabled = !canDraw;
        clearCanvasBtn.style.opacity = canDraw ? "1" : "0.45";
    }
    if (gestureDisplay && !canDraw) gestureDisplay.textContent = "VIEW ONLY";
    if (confidenceDisplay && !canDraw) confidenceDisplay.textContent = "--";

    renderDrawingPermissions();
    renderDrawingPermissionRequest();
}

// ============================================================
// PARTICIPANT PERMISSION REQUEST PANEL
// ============================================================

function renderDrawingPermissionRequest() {
    if (!meetingMain) return;

    let panel = document.getElementById("drawingPermissionRequestPanel");

    if (isMeetingCreator || canvasEnabled) {
        if (panel) panel.remove();
        return;
    }

    if (!panel) {
        panel = document.createElement("div");
        panel.id = "drawingPermissionRequestPanel";
        panel.style.margin = "12px 0";
        panel.style.padding = "12px 14px";
        panel.style.borderRadius = "8px";
        panel.style.background = "#181a1d";
        panel.style.border = "1px solid #34383e";
        meetingMain.appendChild(panel);
    }

    panel.innerHTML = "";

    const text = document.createElement("div");
    if (drawingPermissionRequested) {
        text.textContent = "⏳ Your drawing permission request is waiting for the host.";
    } else if (drawingPermissionStatus) {
        text.textContent = drawingPermissionStatus;
    } else {
        text.textContent = "You are view-only. Ask the host for permission to draw.";
    }
    text.style.marginBottom = "9px";

    const button = document.createElement("button");
    button.type = "button";

    const sendPermissionRequest = () => {
        drawingPermissionRequested = true;
        drawingPermissionStatus = "";
        renderDrawingPermissionRequest();

        const sent = sendWS({
            type: "request_drawing",
            user_id: String(userId || liveKitIdentity),
            user_name: userName || "Participant",
            livekit_identity: liveKitIdentity,
            sender_identity: liveKitIdentity,
            requester_user_id: String(userId || liveKitIdentity),
            requester_livekit_identity: liveKitIdentity
        });

        if (!sent) {
            drawingPermissionRequested = false;
            drawingPermissionStatus = "Could not contact the host. Please try again.";
            renderDrawingPermissionRequest();
        }
    };

    if (drawingPermissionRequested) {
        button.textContent = "⏳ Request Pending";
        button.disabled = true;
    } else if (drawingPermissionStatus) {
        button.textContent = "Try Again";
        button.disabled = false;
        button.onclick = sendPermissionRequest;
    } else {
        button.textContent = "🎨 Ask Permission to Draw";
        button.disabled = false;
        button.onclick = sendPermissionRequest;
    }

    button.style.padding = "7px 11px";
    button.style.border = "1px solid #41464d";
    button.style.borderRadius = "6px";
    button.style.background = "#2c3035";
    button.style.color = "#f2f3f4";
    button.style.cursor = button.disabled ? "default" : "pointer";

    panel.append(text, button);
}

// ============================================================
// HOST PERMISSION PANEL
// ============================================================

function renderDrawingPermissions() {
    if (!meetingMain) return;

    if (!isMeetingCreator) {
        if (drawingPermissionsPanel) {
            drawingPermissionsPanel.remove();
            drawingPermissionsPanel = null;
        }
        return;
    }

    if (!drawingPermissionsPanel) {
        drawingPermissionsPanel = document.createElement("div");
        drawingPermissionsPanel.id = "drawingPermissionsPanel";
        drawingPermissionsPanel.style.margin = "16px 0";
        drawingPermissionsPanel.style.padding = "16px";
        drawingPermissionsPanel.style.borderRadius = "12px";
        drawingPermissionsPanel.style.background = "rgba(255,255,255,0.06)";
        drawingPermissionsPanel.style.border = "1px solid rgba(255,255,255,0.12)";
        meetingMain.appendChild(drawingPermissionsPanel);
    }

    const guests = [...participantInfo.entries()].filter(([, info]) => !info.isCreator);
    const activeGuestDrawers = guests.filter(([, info]) => Boolean(info.canvasEnabled)).length;

    drawingPermissionsPanel.innerHTML = "";

    const title = document.createElement("div");
    title.style.fontWeight = "700";
    title.style.marginBottom = "4px";
    title.textContent = "🎨 Drawing Permissions";

    const subtitle = document.createElement("div");
    subtitle.style.fontSize = "13px";
    subtitle.style.opacity = "0.75";
    subtitle.style.marginBottom = "12px";
    subtitle.textContent = `You can draw. Choose up to ${MAX_GUEST_DRAWERS} participants. ${activeGuestDrawers}/${MAX_GUEST_DRAWERS} slots used.`;

    drawingPermissionsPanel.append(title, subtitle);

    if (!guests.length) {
        const empty = document.createElement("div");
        empty.style.opacity = "0.7";
        empty.textContent = "No other participants have joined yet.";
        drawingPermissionsPanel.appendChild(empty);
        return;
    }

    const list = document.createElement("div");
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.gap = "8px";
    list.style.maxHeight = "260px";
    list.style.overflowY = "auto";

    guests.forEach(([id, info]) => {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.justifyContent = "space-between";
        row.style.gap = "10px";
        row.style.padding = "8px 10px";
        row.style.borderRadius = "8px";
        row.style.background = "rgba(255,255,255,0.04)";

        const name = document.createElement("span");
        name.textContent = info.name || "Participant";

        const button = document.createElement("button");
        button.type = "button";
        button.style.cursor = "pointer";
        button.style.padding = "7px 10px";
        button.style.border = "0";
        button.style.borderRadius = "7px";

        const hasRequest = drawingPermissionRequests.has(id) ||
            drawingPermissionRequests.has(info.livekitIdentity);

        if (info.canvasEnabled) {
            button.textContent = "Remove Drawing";
            button.onclick = () => {
                sendWS({
                    type: "revoke_drawing",
                    target_user_id: id,
                    target_livekit_identity: info.livekitIdentity || id
                });
                info.canvasEnabled = false;
                participantInfo.set(id, info);
                renderDrawingPermissions();
            };
        } else if (hasRequest) {
            button.textContent = "Approve Drawing";
            button.disabled = activeGuestDrawers >= MAX_GUEST_DRAWERS;
            button.onclick = () => {
                const targetIdentity = info.livekitIdentity || id;
                sendWS({
                    type: "grant_drawing",
                    target_user_id: id,
                    target_livekit_identity: targetIdentity,
                    target_user_name: info.name || "Participant"
                });
                info.canvasEnabled = true;
                drawingPermissionRequests.delete(id);
                drawingPermissionRequests.delete(targetIdentity);
                participantInfo.set(id, info);
                renderDrawingPermissions();
                console.log(`✅ APPROVED DRAWING FOR ${info.name}`);
            };
        } else {
            button.textContent = "Give Drawing";
            button.disabled = activeGuestDrawers >= MAX_GUEST_DRAWERS;
            button.onclick = () => {
                const targetIdentity = info.livekitIdentity || id;
                sendWS({
                    type: "grant_drawing",
                    target_user_id: id,
                    target_livekit_identity: targetIdentity,
                    target_user_name: info.name || "Participant"
                });
                info.canvasEnabled = true;
                participantInfo.set(id, info);
                renderDrawingPermissions();
                console.log(`✅ APPROVED DRAWING FOR ${info.name}`);
            };
        }

        row.append(name, button);
        list.appendChild(row);
    });

    drawingPermissionsPanel.appendChild(list);
}

// ============================================================
// UI HELPERS
// ============================================================

function updateLocalUI() {
    if (localParticipantLabel) localParticipantLabel.textContent = userName || "You";
}

function showHome() {
    if (homeScreen) homeScreen.classList.remove("hidden");
    if (meetingScreen) meetingScreen.classList.add("hidden");
}

function showMeeting() {
    if (homeScreen) homeScreen.classList.add("hidden");
    if (meetingScreen) meetingScreen.classList.remove("hidden");
}

// ============================================================
// USER ID / NAME
// ============================================================

userId = localStorage.getItem("airCanvasUserId") || generateUserId();
localStorage.setItem("airCanvasUserId", userId);

const savedName = localStorage.getItem("airCanvasUserName");
const currentTypedName = (userNameInput?.value || "").trim();

if (currentTypedName) {
    userName = currentTypedName.slice(0, 30);
} else if (savedName) {
    userName = String(savedName).trim().slice(0, 30) || "Participant";
    if (userNameInput) userNameInput.value = userName;
}

// ============================================================
// CANVAS HELPERS
// ============================================================

function resizeCanvasPreserve(canvas, cssWidth, cssHeight) {
    if (!canvas || cssWidth <= 0 || cssHeight <= 0) return;
    const width = Math.max(1, Math.round(cssWidth));
    const height = Math.max(1, Math.round(cssHeight));
    if (canvas.width === width && canvas.height === height) return;

    let oldImage = null;
    try {
        if (canvas.width > 0 && canvas.height > 0) {
            oldImage = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height);
        }
    } catch (_) {}

    canvas.width = width;
    canvas.height = height;

    if (oldImage) {
        try {
            const ctx = canvas.getContext("2d");
            const temp = document.createElement("canvas");
            temp.width = oldImage.width;
            temp.height = oldImage.height;
            temp.getContext("2d").putImageData(oldImage, 0, 0);
            ctx.drawImage(temp, 0, 0, width, height);
        } catch (_) {}
    }
}

function setupCanvasSizes() {
    if (video && airCanvas && landmarkCanvas) {
        const rect = video.parentElement?.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
            resizeCanvasPreserve(airCanvas, rect.width, rect.height);
            resizeCanvasPreserve(landmarkCanvas, rect.width, rect.height);
        }
    }
    remoteParticipants.forEach((tile) => resizeRemoteCanvas(tile));
}

function resizeRemoteCanvas(tile) {
    if (!tile?.canvas || !tile.container) return;
    const rect = tile.container.getBoundingClientRect();
    resizeCanvasPreserve(tile.canvas, rect.width, rect.height);
}

function clearCanvasElement(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function clearLocalCanvas() {
    clearCanvasElement(airCanvas);
    smoothDrawX = null;
    smoothDrawY = null;
    isDrawing = false;
    lastDrawX = 0;
    lastDrawY = 0;
}

// ============================================================
// REMOTE TILES
// ============================================================

function hideLegacyRemoteCard() {
    const card = remoteVideo?.closest(".participant-card");
    if (card) card.style.display = "none";
    if (remoteAudio) remoteAudio.style.display = "none";
}

function createRemoteTile(participant) {
    if (!participant) return null;
    const identity = String(participant.identity);
    if (!identity || identity === liveKitIdentity) return null;

    if (remoteParticipants.has(identity)) {
        const existing = remoteParticipants.get(identity);
        existing.label.textContent = participant.name || "Participant";
        existing.participant = participant;
        return existing;
    }

    if (!participantsGrid) return null;

    const card = document.createElement("div");
    card.className = "participant-card remote-participant-card";
    card.dataset.identity = identity;

    const label = document.createElement("div");
    label.className = "participant-label";
    label.textContent = participant.name || "Participant";

    const container = document.createElement("div");
    container.className = "remote-video-container";
    container.style.position = "relative";
    container.style.overflow = "hidden";

    const waiting = document.createElement("div");
    waiting.className = "waiting-participant";
    waiting.innerHTML = '<div class="participant-avatar">👤</div><span>Waiting for camera...</span>';

    const remoteVid = document.createElement("video");
    remoteVid.autoplay = true;
    remoteVid.playsInline = true;
    remoteVid.setAttribute("playsinline", "");
    remoteVid.style.width = "100%";
    remoteVid.style.height = "100%";
    remoteVid.style.objectFit = "cover";
    remoteVid.style.transform = "none";

    const canvas = document.createElement("canvas");
    canvas.className = "remote-drawing-canvas";
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "5";
    canvas.style.transform = "none";

    const audio = document.createElement("audio");
    audio.autoplay = true;

    container.append(waiting, remoteVid, canvas, audio);
    card.append(label, container);
    participantsGrid.appendChild(card);

    const tile = {
        identity, participant, card, label, container, waiting,
        video: remoteVid, canvas, ctx: canvas.getContext("2d"), audio
    };

    remoteParticipants.set(identity, tile);
    requestAnimationFrame(() => {
        resizeRemoteCanvas(tile);
        flushPendingRemoteDrawingHistory(identity);
    });

    updateParticipantCount();
    return tile;
}

function flushPendingRemoteDrawingHistory(identity) {
    const key = String(identity || "");
    if (!key || !remoteParticipants.has(key)) return;
    const events = pendingRemoteDrawingHistory.get(key);
    if (!Array.isArray(events) || !events.length) return;
    pendingRemoteDrawingHistory.delete(key);
    events.forEach((event) => {
        try { handleRemoteDraw(event); } catch (error) { console.warn("⚠️ Replay error:", error); }
    });
}

function removeRemoteTile(identity) {
    const key = String(identity);
    const tile = remoteParticipants.get(key);
    if (!tile) return;
    try { tile.video.srcObject = null; } catch (_) {}
    try { tile.audio.srcObject = null; } catch (_) {}
    if (tile.card) tile.card.remove();
    remoteParticipants.delete(key);
    remoteLastDrawPoint.delete(key);
    pendingRemoteDrawingHistory.delete(key);
    updateParticipantCount();
}

function clearRemoteTiles() {
    [...remoteParticipants.keys()].forEach(removeRemoteTile);
    updateParticipantCount();
}

function attachRemoteVideo(participant, track) {
    const tile = createRemoteTile(participant);
    if (!tile || !track) return;
    try {
        track.attach(tile.video);
        tile.video.style.transform = "none";
        tile.waiting.style.display = "none";
        tile.video.play().catch(() => {});
    } catch (error) {
        console.error("❌ Video attach failed:", error);
    }
    requestAnimationFrame(() => resizeRemoteCanvas(tile));
}

function attachRemoteAudio(participant, track) {
    const tile = createRemoteTile(participant);
    if (!tile || !track) return;
    try {
        track.attach(tile.audio);
        tile.audio.play().catch(() => {});
    } catch (error) {
        console.error("❌ Audio attach failed:", error);
    }
}

function detachParticipantTrack(participant, track) {
    if (!participant || !track) return;
    const identity = String(participant.identity);
    const tile = remoteParticipants.get(identity);
    if (!tile) return;
    try { track.detach(tile.video); } catch (_) {}
    try { track.detach(tile.audio); } catch (_) {}
    try {
        if (track.kind === window.LivekitClient.Track.Kind.Video) {
            tile.video.style.display = "none";
            tile.waiting.style.display = "block";
        }
    } catch (_) {}
}

// ============================================================
// CAMERA
// ============================================================

async function startLocalMedia() {
    if (localStream) return localStream;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera not available.");

    localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
        audio: true
    });

    video.srcObject = localStream;
    video.muted = true;
    video.playsInline = true;
    await video.play();

    isCameraStarted = true;

    if (cameraStatus) { cameraStatus.textContent = "✅ Camera & Mic On"; cameraStatus.style.color = "#4caf50"; }
    if (homeStartCamera) { homeStartCamera.textContent = "✅ Camera Started"; homeStartCamera.disabled = true; }
    if (startCameraBtn) { startCameraBtn.textContent = "✅ Camera On"; startCameraBtn.disabled = true; }

    if (isMeetingCreator || canvasEnabled) initMediaPipe();

    setTimeout(setupCanvasSizes, 300);
    return localStream;
}

async function startCameraFromHome() {
    if (isCameraStarted) return;
    userName = (userNameInput?.value || "").trim().slice(0, 30) || "Participant";
    localStorage.setItem("airCanvasUserName", userName);
    updateLocalUI();
    try { await startLocalMedia(); } catch (error) {
        console.error("❌ Camera error:", error);
        if (cameraStatus) { cameraStatus.textContent = "❌ Camera denied"; cameraStatus.style.color = "#f44336"; }
        if (homeStartCamera) { homeStartCamera.disabled = false; homeStartCamera.textContent = "🎥 Start Camera"; }
    }
}

async function startCameraFromMeeting() {
    if (isCameraStarted) return;
    try { await startLocalMedia(); } catch (error) { alert("Could not access camera."); }
}

function stopLocalMedia() {
    if (camera) { try { camera.stop(); } catch (_) {} camera = null; }
    if (localStream) localStream.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
    localStream = null;
    isCameraStarted = false;
    mediaPipeStarted = false;
    hands = null;
    mediaPipeFrameCanvas = null;
    mediaPipeFrameCtx = null;
    if (video) video.srcObject = null;
}

// ============================================================
// MEDIAPIPE
// ============================================================

function initMediaPipe() {
    if (mediaPipeStarted || !window.Hands || !window.Camera) return;
    try {
        hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
        hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.5 });
        hands.onResults(onResults);

        mediaPipeFrameCanvas = document.createElement("canvas");
        mediaPipeFrameCanvas.width = MEDIAPIPE_PROCESS_WIDTH;
        mediaPipeFrameCanvas.height = MEDIAPIPE_PROCESS_HEIGHT;
        mediaPipeFrameCtx = mediaPipeFrameCanvas.getContext("2d", { alpha: false, desynchronized: true });

        camera = new Camera(video, {
            onFrame: async () => {
                if (!mediaPipeFrameCtx || !video.videoWidth) return;
                mediaPipeFrameCtx.drawImage(video, 0, 0, MEDIAPIPE_PROCESS_WIDTH, MEDIAPIPE_PROCESS_HEIGHT);
                try { await hands.send({ image: mediaPipeFrameCanvas }); } catch (_) {}
            },
            width: 1280, height: 720
        });

        camera.start();
        mediaPipeStarted = true;
    } catch (error) {
        console.error("❌ MediaPipe init failed:", error);
    }
}

function stopMediaPipeOnly() {
    if (camera) { try { camera.stop(); } catch (_) {} }
    camera = null;
    hands = null;
    mediaPipeStarted = false;
    if (landmarkCanvas) clearCanvasElement(landmarkCanvas);
    resetDrawingState();
}

function onResults(results) {
    if (!isMeetingCreator && !canvasEnabled) {
        resetDrawingState();
        updateGestureDisplay("view_only", 0);
        return;
    }

    if (landmarkCanvas) {
        const ctx = landmarkCanvas.getContext("2d");
        ctx.clearRect(0, 0, landmarkCanvas.width, landmarkCanvas.height);
    }

    if (!results?.multiHandLandmarks?.length) {
        updateGestureDisplay("no_gesture", 0);
        resetDrawingState();
        return;
    }

    const landmarks = results.multiHandLandmarks[0];

    if (landmarkCanvas && typeof drawConnectors === "function" && typeof drawLandmarks === "function") {
        const ctx = landmarkCanvas.getContext("2d");
        drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: "#00FF00", lineWidth: 2 });
        drawLandmarks(ctx, landmarks, { color: "#FF0000", lineWidth: 1, radius: 3 });
    }

    const values = [];
    for (const point of landmarks) values.push(point.x, point.y);

    if (activeGesture === "draw") drawGesture(values);
    else if (activeGesture === "erase") eraseGesture(values);
    else resetDrawingState();

    const now = performance.now();
    if (now - lastPredictionTime >= PREDICTION_INTERVAL_MS) {
        lastPredictionTime = now;
        pendingLandmarks = values;
        requestGesturePrediction();
    }
}

async function requestGesturePrediction() {
    if (predictionInProgress || !pendingLandmarks) return;
    predictionInProgress = true;
    const landmarks = pendingLandmarks;
    pendingLandmarks = null;

    try {
        const response = await fetch(`${BACKEND_URL}/predict`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ landmarks })
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        const gesture = String(result.confirmed_gesture || result.gesture || "no_gesture").toLowerCase();
        const confidence = Number(result.confidence) || 0;
        updateGestureDisplay(gesture, confidence);

        if (gesture === "clear") {
            const now = Date.now();
            if (now - lastClearTime >= CLEAR_COOLDOWN_MS) {
                lastClearTime = now;
                clearMyCanvasAndBroadcast();
            }
            resetDrawingState();
        } else if (gesture !== "draw" && gesture !== "erase") {
            resetDrawingState();
        }
    } catch (error) {
        console.error("❌ Prediction error:", error);
        activeGesture = "no_gesture";
        resetDrawingState();
    } finally {
        predictionInProgress = false;
        if (pendingLandmarks) requestGesturePrediction();
    }
}

function updateGestureDisplay(gesture, confidence) {
    activeGesture = gesture || "no_gesture";
    activeConfidence = Number(confidence) || 0;
    if (gestureDisplay) gestureDisplay.textContent = activeGesture === "no_gesture" ? "NO GESTURE" : activeGesture.toUpperCase();
    if (confidenceDisplay) confidenceDisplay.textContent = activeGesture === "no_gesture" ? "--" : `${Math.round(activeConfidence * 100)}%`;
}

function resetDrawingState() {
    isDrawing = false;
    lastDrawX = 0;
    lastDrawY = 0;
    smoothDrawX = null;
    smoothDrawY = null;
}

// ============================================================
// LOCAL DRAWING
// ============================================================

function drawGesture(values) {
    if (!airCanvas) return;
    const rawX = Number(values[16]);
    const rawY = Number(values[17]);
    if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return;

    const targetX = clamp(rawX, 0, 1) * airCanvas.width;
    const targetY = clamp(rawY, 0, 1) * airCanvas.height;
    const smoothing = 0.45;

    if (smoothDrawX === null) {
        smoothDrawX = targetX;
        smoothDrawY = targetY;
    } else {
        smoothDrawX += (targetX - smoothDrawX) * smoothing;
        smoothDrawY += (targetY - smoothDrawY) * smoothing;
    }

    const x = smoothDrawX;
    const y = smoothDrawY;

    if (!isDrawing) {
        isDrawing = true;
        lastDrawX = x;
        lastDrawY = y;
        drawDot(airCanvas, x / airCanvas.width, y / airCanvas.height, "draw");
        return;
    }

    const distance = Math.hypot(x - lastDrawX, y - lastDrawY);
    if (distance < 0.5) return;

    const maxJump = Math.max(airCanvas.width, airCanvas.height) * 0.12;
    if (distance > maxJump) { lastDrawX = x; lastDrawY = y; return; }

    drawLine(airCanvas, lastDrawX / airCanvas.width, lastDrawY / airCanvas.height, x / airCanvas.width, y / airCanvas.height, "draw");
    sendDrawData(x / airCanvas.width, y / airCanvas.height, lastDrawX / airCanvas.width, lastDrawY / airCanvas.height, "draw");
    lastDrawX = x;
    lastDrawY = y;
}

function eraseGesture(values) {
    if (!airCanvas) return;
    const x = clamp(Number(values[16]), 0, 1);
    const y = clamp(Number(values[17]), 0, 1);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const ctx = airCanvas.getContext("2d");
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(x * airCanvas.width, y * airCanvas.height, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";

    sendDrawData(x, y, x, y, "erase");
    resetDrawingState();
}

function drawLine(canvas, x1, y1, x2, y2, action = "draw") {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const px1 = clamp(x1, 0, 1) * canvas.width;
    const py1 = clamp(y1, 0, 1) * canvas.height;
    const px2 = clamp(x2, 0, 1) * canvas.width;
    const py2 = clamp(y2, 0, 1) * canvas.height;
    ctx.lineWidth = action === "erase" ? 20 : 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = action === "erase" ? "destination-out" : "source-over";
    ctx.strokeStyle = "#00ff00";
    ctx.beginPath();
    ctx.moveTo(px1, py1);
    ctx.lineTo(px2, py2);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
}

function drawDot(canvas, x, y, action = "draw") {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.globalCompositeOperation = action === "erase" ? "destination-out" : "source-over";
    ctx.fillStyle = "#00ff00";
    ctx.beginPath();
    ctx.arc(clamp(x, 0, 1) * canvas.width, clamp(y, 0, 1) * canvas.height, action === "erase" ? 20 : 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
}

function sendDrawData(x, y, prevX, prevY, action) {
    if (!isMeetingCreator && !canvasEnabled) return;
    const remoteX = 1 - clamp(Number(x), 0, 1);
    const remotePrevX = 1 - clamp(Number(prevX), 0, 1);
    if (!meetingActive || !wsConnected) return;

    const now = performance.now();
    if (action === "draw" && now - lastDrawSendTime < DRAW_SEND_INTERVAL_MS) return;
    lastDrawSendTime = now;

    sendWS({
        type: "draw_data",
        meeting_id: meetingId,
        user_id: liveKitIdentity,
        user_name: userName,
        livekit_identity: liveKitIdentity,
        x: remoteX, y: Number(y),
        prev_x: remotePrevX, prev_y: Number(prevY),
        lastX: remotePrevX, lastY: Number(prevY),
        action: action || "draw"
    });
}

function clearMyCanvasAndBroadcast() {
    if (!isMeetingCreator && !canvasEnabled) return;
    clearLocalCanvas();
    if (!meetingActive || !wsConnected) return;
    sendWS({
        type: "clear_canvas",
        meeting_id: meetingId,
        user_id: liveKitIdentity,
        user_name: userName,
        livekit_identity: liveKitIdentity
    });
}

// ============================================================
// REMOTE DRAWING
// ============================================================

function resolveRemoteIdentity(data) {
    const direct = data.livekit_identity || data.sender_identity || data.participant_identity;
    if (direct && remoteParticipants.has(String(direct))) return String(direct);
    if (data.user_id && userIdToLiveKitIdentity.has(String(data.user_id))) {
        return userIdToLiveKitIdentity.get(String(data.user_id));
    }
    return direct ? String(direct) : null;
}

function handleRemoteDraw(data) {
    const identity = resolveRemoteIdentity(data);
    if (!identity || identity === liveKitIdentity) return;
    const tile = remoteParticipants.get(identity);
    if (!tile?.canvas) return;

    resizeRemoteCanvas(tile);
    const x = Number(data.x);
    const y = Number(data.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    if (data.action === "erase") {
        const ctx = tile.canvas.getContext("2d");
        ctx.globalCompositeOperation = "destination-out";
        ctx.beginPath();
        ctx.arc(clamp(x, 0, 1) * tile.canvas.width, clamp(y, 0, 1) * tile.canvas.height, 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        remoteLastDrawPoint.delete(identity);
        return;
    }

    const previousPoint = remoteLastDrawPoint.get(identity);
    const prevX = Number(data.prev_x ?? data.lastX);
    const prevY = Number(data.prev_y ?? data.lastY);
    const startX = previousPoint && Number.isFinite(previousPoint.x) ? previousPoint.x : prevX;
    const startY = previousPoint && Number.isFinite(previousPoint.y) ? previousPoint.y : prevY;

    if (Number.isFinite(startX) && Number.isFinite(startY)) {
        drawLine(tile.canvas, startX, startY, x, y, "draw");
    } else {
        drawDot(tile.canvas, x, y, "draw");
    }
    remoteLastDrawPoint.set(identity, { x, y });
}

function handleRemoteClear(data) {
    const identity = resolveRemoteIdentity(data);
    if (!identity || identity === liveKitIdentity) return;
    const tile = remoteParticipants.get(identity);
    if (tile) clearCanvasElement(tile.canvas);
    remoteLastDrawPoint.delete(identity);
}

// ============================================================
// FASTAPI WEBSOCKET (permissions, chat, drawing sync)
// ============================================================

function sendWS(message) {
    if (!message) return false;
    const type = message.type;
    if (type === "create_meeting" || type === "join_meeting") return true;

    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn(`⚠️ Cannot send ${type}: WebSocket not connected.`);
        return false;
    }

    try {
        ws.send(JSON.stringify(message));
        if (type !== "draw_data") console.log(`📤 WebSocket send:`, message);
        return true;
    } catch (error) {
        console.error(`❌ WebSocket send error (${type}):`, error);
        return false;
    }
}

function connectWebSocket() {
    return new Promise((resolve, reject) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            resolve();
            return;
        }

        const url = `${WS_URL}/ws/${encodeURIComponent(meetingId)}`;
        console.log("🔌 Connecting WebSocket:", url);

        try {
            ws = new WebSocket(url);
        } catch (error) {
            reject(error);
            return;
        }

        const timeout = setTimeout(() => {
            console.error("❌ WebSocket registration timed out.");
            try { ws.close(); } catch (_) {}
            reject(new Error("WebSocket registration timed out"));
        }, 15000);

        ws.onopen = () => {
            console.log("✅ WebSocket connected. Sending registration...");

            const registration = {
                type: isMeetingCreator ? "create_meeting" : "join_meeting",
                user_id: String(userId),
                user_name: String(userName),
                livekit_identity: String(liveKitIdentity)
            };

            try {
                ws.send(JSON.stringify(registration));
            } catch (error) {
                clearTimeout(timeout);
                console.error("❌ Registration send error:", error);
                reject(error);
                return;
            }
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log("📨 WebSocket received:", data.type);

                if (data.type === "self_info" && !wsConnected) {
                    wsConnected = true;
                    clearTimeout(timeout);
                    setConnectionStatus("Connected");
                    resolve();
                }

                handleWebSocketMessage(data);
            } catch (error) {
                console.error("❌ WebSocket message error:", error);
            }
        };

        ws.onerror = (error) => {
            clearTimeout(timeout);
            console.error("❌ WebSocket error:", error);
            setConnectionStatus("Error");
            reject(error);
        };

        ws.onclose = () => {
            wsConnected = false;
            console.log("🔌 WebSocket closed.");
            setConnectionStatus("Disconnected");
        };
    });
}

function disconnectWebSocket() {
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    if (ws) { try { ws.close(); } catch (_) {} }
    ws = null;
    wsConnected = false;
}

// ============================================================
// WEBSOCKET MESSAGE HANDLER
// ============================================================

function handleWebSocketMessage(data) {
    if (!data?.type) return;

    switch (data.type) {
        case "self_info":
            if (data.user_id) userId = data.user_id;
            if (data.user_name) userName = data.user_name;
            if (data.livekit_identity) liveKitIdentity = String(data.livekit_identity);
            if (data.is_creator !== undefined) {
                isMeetingCreator = Boolean(data.is_creator) || isMeetingCreator;
            }

            canvasEnabled = Boolean(isMeetingCreator) || Boolean(data.canvas_enabled) || Boolean(data.is_creator);

            if (isMeetingCreator || canvasEnabled) {
                if (!mediaPipeStarted && video?.srcObject) initMediaPipe();
            } else {
                stopMediaPipeOnly();
            }

            updateCanvasAvailability();
            localStorage.setItem("airCanvasUserId", userId);
            localStorage.setItem("airCanvasUserName", userName);
            updateLocalUI();
            break;

        case "creator_info":
            if (data.creator_id) {
                const creatorIdentity = data.creator_livekit_identity ? String(data.creator_livekit_identity) : null;
                participantInfo.set(String(data.creator_id), {
                    userId: String(data.creator_id),
                    name: data.creator_name || "Host",
                    isCreator: true,
                    livekitIdentity: creatorIdentity,
                    canvasEnabled: true
                });
                if (creatorIdentity) {
                    userIdToLiveKitIdentity.set(String(data.creator_id), creatorIdentity);
                    liveKitIdentityToUserId.set(creatorIdentity, String(data.creator_id));
                }
            }
            break;

        case "participant_joined": {
            const id = data.user_id ? String(data.user_id) : null;
            if (id) {
                participantInfo.set(id, {
                    userId: id,
                    name: data.user_name || "Participant",
                    isCreator: Boolean(data.is_creator),
                    livekitIdentity: data.livekit_identity ? String(data.livekit_identity) : null,
                    canvasEnabled: Boolean(data.canvas_enabled)
                });
                if (data.livekit_identity) {
                    userIdToLiveKitIdentity.set(id, String(data.livekit_identity));
                    liveKitIdentityToUserId.set(String(data.livekit_identity), id);
                }
            }
            updateParticipantCount();
            renderDrawingPermissions();
            break;
        }

        case "participant_left": {
            if (data.user_id) {
                const id = String(data.user_id);
                const identity = userIdToLiveKitIdentity.get(id);
                if (identity) removeRemoteTile(identity);
                userIdToLiveKitIdentity.delete(id);
                participantInfo.delete(id);
            }
            if (data.livekit_identity) removeRemoteTile(String(data.livekit_identity));
            updateParticipantCount();
            renderDrawingPermissions();
            break;
        }

        case "request_drawing":
        case "drawing_permission_request": {
            const requesterIdentity = String(
                data.sender_identity || data.requester_livekit_identity ||
                data.livekit_identity || data.user_id || ""
            );

            if (!isMeetingCreator || !requesterIdentity || requesterIdentity === String(liveKitIdentity)) break;

            const requesterUserId = String(data.requester_user_id || data.user_id || requesterIdentity);

            drawingPermissionRequests.add(requesterIdentity);
            drawingPermissionRequests.add(requesterUserId);

            const existing = participantInfo.get(requesterIdentity) || {
                userId: requesterIdentity,
                name: data.user_name || "Participant",
                isCreator: false,
                livekitIdentity: requesterIdentity,
                canvasEnabled: false
            };

            existing.userId = requesterIdentity;
            existing.name = data.user_name || existing.name || "Participant";
            existing.livekitIdentity = requesterIdentity;
            existing.backendUserId = requesterUserId;
            existing.isCreator = false;

            participantInfo.set(requesterIdentity, existing);
            userIdToLiveKitIdentity.set(requesterUserId, requesterIdentity);
            userIdToLiveKitIdentity.set(requesterIdentity, requesterIdentity);
            liveKitIdentityToUserId.set(requesterIdentity, requesterUserId);

            renderDrawingPermissions();
            console.log(`🙋 DRAW REQUEST RECEIVED | ${existing.name} | ${requesterIdentity}`);
            break;
        }

        case "drawing_permission_denied":
            drawingPermissionRequested = false;
            drawingPermissionStatus = String(data.message || "Drawing permission unavailable.");
            renderDrawingPermissionRequest();
            break;

        case "drawing_permission":
        case "grant_drawing": {
            const targetIdentity = String(
                data.target_livekit_identity || data.target_user_id ||
                data.livekit_identity || data.user_id || ""
            );
            if (!targetIdentity) break;

            const isForMe =
                targetIdentity === String(liveKitIdentity) ||
                targetIdentity === String(userId);

            const permissionEnabled = data.type === "grant_drawing" ? true : Boolean(data.canvas_enabled);

            if (isForMe) {
                drawingPermissionRequested = false;
                drawingPermissionStatus = "";
                canvasEnabled = permissionEnabled;

                if (canvasEnabled) {
                    if (!mediaPipeStarted && video?.srcObject) initMediaPipe();
                } else {
                    stopMediaPipeOnly();
                }

                resetDrawingState();
                updateCanvasAvailability();
                console.log(`🎨 DRAWING PERMISSION ${permissionEnabled ? "APPROVED" : "REMOVED"} FOR ME`);
                break;
            }

            const existing = participantInfo.get(targetIdentity) || {
                userId: targetIdentity,
                name: data.target_user_name || data.user_name || "Participant",
                isCreator: false,
                livekitIdentity: targetIdentity,
                canvasEnabled: false
            };
            existing.canvasEnabled = permissionEnabled;
            existing.livekitIdentity = targetIdentity;
            existing.name = data.target_user_name || data.user_name || existing.name;
            participantInfo.set(targetIdentity, existing);

            if (isMeetingCreator) {
                drawingPermissionRequests.delete(targetIdentity);
                renderDrawingPermissions();
            }
            console.log(`🎨 Permission for ${existing.name}: ${permissionEnabled ? "ENABLED" : "DISABLED"}`);
            break;
        }

        case "room_participants": {
            const incoming = Array.isArray(data.participants) ? data.participants : [];
            incoming.forEach((participant) => {
                const id = participant.user_id ? String(participant.user_id) : null;
                if (!id) return;
                const identity = participant.livekit_identity ? String(participant.livekit_identity) : null;
                participantInfo.set(id, {
                    userId: id,
                    name: participant.user_name || "Participant",
                    isCreator: Boolean(participant.is_creator),
                    livekitIdentity: identity,
                    canvasEnabled: Boolean(participant.canvas_enabled)
                });
                if (identity) {
                    userIdToLiveKitIdentity.set(id, identity);
                    liveKitIdentityToUserId.set(identity, id);
                }
                if (id === String(userId)) {
                    canvasEnabled = Boolean(participant.canvas_enabled) || Boolean(participant.is_creator);
                }
            });

            if (isMeetingCreator || canvasEnabled) {
                if (!mediaPipeStarted) initMediaPipe();
            } else {
                stopMediaPipeOnly();
            }
            updateCanvasAvailability();
            renderDrawingPermissions();
            break;
        }

        case "drawing_history": {
            const events = Array.isArray(data.events) ? data.events : [];
            events.forEach((event) => {
                const identity = resolveRemoteIdentity(event);
                if (!identity || identity === liveKitIdentity) return;
                if (remoteParticipants.has(identity)) {
                    handleRemoteDraw(event);
                } else {
                    if (!pendingRemoteDrawingHistory.has(identity)) {
                        pendingRemoteDrawingHistory.set(identity, []);
                    }
                    pendingRemoteDrawingHistory.get(identity).push(event);
                }
            });
            console.log(`🖼️ Drawing history: ${events.length} events`);
            break;
        }

        case "chat_message":
            appendChatMessage(data);
            break;

        case "draw_data":
            handleRemoteDraw(data);
            break;

        case "clear_canvas":
            handleRemoteClear(data);
            break;

        case "room_full":
            alert(`Meeting full. Max ${MAX_PARTICIPANTS} participants.`);
            break;

        case "error":
            console.error("❌ Server error:", data.message);
            break;

        default:
            break;
    }
}

// ============================================================
// LIVEKIT
// ============================================================

function loadLiveKitSDK() {
    if (window.LivekitClient) return Promise.resolve(window.LivekitClient);
    if (liveKitSDKPromise) return liveKitSDKPromise;

    liveKitSDKPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/livekit-client/dist/livekit-client.umd.min.js";
        script.async = true;
        script.onload = () => window.LivekitClient ? resolve(window.LivekitClient) : reject(new Error("LiveKit global missing."));
        script.onerror = () => reject(new Error("LiveKit SDK load failed."));
        document.head.appendChild(script);
    });

    return liveKitSDKPromise;
}

async function connectLiveKit() {
    if (liveKitConnected) return;
    if (!meetingId || !localStream) throw new Error("Meeting or local media missing.");

    const LK = await loadLiveKitSDK();
    console.log("🔵 Connecting to LiveKit...");

    const tokenSource = LK.TokenSource.developmentTokenServer(LIVEKIT_TOKEN_SERVER_ID);
    const credentials = await tokenSource.fetch({
        roomName: meetingId,
        participantIdentity: liveKitIdentity,
        participantName: userName
    });

    if (!credentials?.participantToken) throw new Error("No LiveKit token.");

    liveKitRoom = new LK.Room({ adaptiveStream: true, dynacast: true });

    liveKitRoom.on(LK.RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (String(participant.identity) === liveKitIdentity) return;
        const tile = createRemoteTile(participant);
        if (!tile) return;
        if (track.kind === LK.Track.Kind.Video) attachRemoteVideo(participant, track);
        else if (track.kind === LK.Track.Kind.Audio) attachRemoteAudio(participant, track);
    });

    liveKitRoom.on(LK.RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
        detachParticipantTrack(participant, track);
    });

    liveKitRoom.on(LK.RoomEvent.ParticipantConnected, (participant) => {
        if (String(participant.identity) === liveKitIdentity) return;
        createRemoteTile(participant);
    });

    liveKitRoom.on(LK.RoomEvent.ParticipantDisconnected, (participant) => {
        const identity = String(participant.identity);
        removeRemoteTile(identity);
        const id = liveKitIdentityToUserId.get(identity);
        if (id) {
            liveKitIdentityToUserId.delete(identity);
            userIdToLiveKitIdentity.delete(id);
        }
    });

    await liveKitRoom.connect(credentials.serverUrl || LIVEKIT_SERVER_URL, credentials.participantToken);
    liveKitConnected = true;
    console.log("✅ LiveKit connected:", liveKitIdentity);

    liveKitRoom.remoteParticipants.forEach((participant) => {
        createRemoteTile(participant);
        for (const publication of participant.trackPublications.values()) {
            if (publication.isSubscribed && publication.track) {
                if (publication.kind === LK.Track.Kind.Video) attachRemoteVideo(participant, publication.track);
                else if (publication.kind === LK.Track.Kind.Audio) attachRemoteAudio(participant, publication.track);
            } else if (!publication.isSubscribed) {
                try { publication.setSubscribed(true); } catch (_) {}
            }
        }
    });

    const cameraTrack = localStream.getVideoTracks()[0];
    if (cameraTrack) {
        await liveKitRoom.localParticipant.publishTrack(cameraTrack, {
            name: "air-canvas-camera",
            source: LK.Track.Source.Camera
        });
    }

    const micTrack = localStream.getAudioTracks()[0];
    if (micTrack) {
        await liveKitRoom.localParticipant.publishTrack(micTrack, {
            name: "air-canvas-microphone",
            source: LK.Track.Source.Microphone
        });
    }

    updateParticipantCount();
}

function disconnectLiveKit() {
    if (liveKitRoom) { try { liveKitRoom.disconnect(); } catch (_) {} }
    liveKitRoom = null;
    liveKitConnected = false;
    clearRemoteTiles();
}

// ============================================================
// MEETING FLOW
// ============================================================

function setupMeetingUI() {
    showMeeting();
    if (meetingIdDisplay) meetingIdDisplay.textContent = `Meeting ID: ${meetingId}`;
    if (meetingIdLarge) meetingIdLarge.textContent = meetingId;
    updateLocalUI();
    if (remoteParticipantLabel) remoteParticipantLabel.textContent = "Participant";
    if (waitingParticipant) waitingParticipant.style.display = "block";
    hideLegacyRemoteCard();
    clearRemoteTiles();
    clearLocalCanvas();
    updateParticipantCount();
    updateCanvasAvailability();
    renderDrawingPermissions();
}

async function createMeeting() {
    if (meetingActive) return;
    userName = (userNameInput?.value || "").trim().slice(0, 30) || "Participant";
    localStorage.setItem("airCanvasUserName", userName);
    updateLocalUI();

    try {
        isMeetingCreator = true;
        canvasEnabled = true;
        if (!isCameraStarted) await startLocalMedia();
        meetingId = generateMeetingId();
        meetingActive = true;
        setupMeetingUI();
        await connectWebSocket();
        await connectLiveKit();
        updateCanvasAvailability();
        if (!mediaPipeStarted) initMediaPipe();
        console.log("🎉 Meeting created:", meetingId);
    } catch (error) {
        console.error("❌ Could not create meeting:", error);
        meetingActive = false;
        await cleanupMeeting(false);
        showHome();
        alert("Could not create the meeting.");
    }
}

async function joinMeeting() {
    if (meetingActive) return;
    userName = (userNameInput?.value || "").trim().slice(0, 30) || "Participant";
    localStorage.setItem("airCanvasUserName", userName);
    meetingId = normalizeMeetingId(meetingIdInput?.value);
    if (!meetingId) { alert("Please enter Meeting ID."); return; }

    isMeetingCreator = false;

    try {
        if (!isCameraStarted) await startLocalMedia();
        meetingActive = true;
        setupMeetingUI();
        await connectWebSocket();
        await connectLiveKit();
        console.log("🎉 Joined meeting:", meetingId);
    } catch (error) {
        console.error("❌ Could not join meeting:", error);
        meetingActive = false;
        await cleanupMeeting(false);
        showHome();
        alert("Could not join the meeting.");
    }
}

// ============================================================
// CONTROLS
// ============================================================

async function toggleMute() {
    if (!localStream) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach((track) => (track.enabled = !isMuted));
    if (liveKitRoom?.localParticipant) {
        try { await liveKitRoom.localParticipant.setMicrophoneEnabled(!isMuted); } catch (_) {}
    }
    if (muteButton) {
        muteButton.textContent = isMuted ? "🔇 Muted" : "🎤 Mic";
        muteButton.classList.toggle("muted", isMuted);
    }
}

async function toggleCamera() {
    if (!localStream) return;
    isCameraOff = !isCameraOff;
    localStream.getVideoTracks().forEach((track) => (track.enabled = !isCameraOff));
    if (liveKitRoom?.localParticipant) {
        try { await liveKitRoom.localParticipant.setCameraEnabled(!isCameraOff); } catch (_) {}
    }
    if (cameraButton) {
        cameraButton.textContent = isCameraOff ? "🚫 Camera Off" : "📹 Camera";
        cameraButton.classList.toggle("camera-off", isCameraOff);
    }
}

async function copyMeetingIdToClipboard() {
    if (!meetingId) return;
    try {
        await navigator.clipboard.writeText(meetingId);
        if (copyMeetingId) {
            const old = copyMeetingId.textContent;
            copyMeetingId.textContent = "✅ Copied!";
            setTimeout(() => (copyMeetingId.textContent = old), 1200);
        }
    } catch (error) { console.error("❌ Copy error:", error); }
}

function clearCanvasButtonAction() { clearMyCanvasAndBroadcast(); }

async function cleanupMeeting(stopCameraToo = true) {
    meetingActive = false;
    disconnectLiveKit();
    disconnectWebSocket();
    clearRemoteTiles();
    clearLocalCanvas();
    clearCanvasElement(landmarkCanvas);
    if (stopCameraToo) stopLocalMedia();

    meetingId = null;
    isMeetingCreator = false;
    canvasEnabled = false;

    if (drawingPermissionsPanel) { drawingPermissionsPanel.remove(); drawingPermissionsPanel = null; }

    participantInfo.clear();
    userIdToLiveKitIdentity.clear();
    liveKitIdentityToUserId.clear();
    drawingPermissionRequested = false;
    drawingPermissionStatus = "";
    drawingPermissionRequests.clear();

    activeGesture = "no_gesture";
    activeConfidence = 0;
    resetDrawingState();
    updateGestureDisplay("no_gesture", 0);
    updateParticipantCount();

    if (meetingIdInput) meetingIdInput.value = "";
    if (meetingIdLarge) meetingIdLarge.textContent = "------";
    if (meetingIdDisplay) meetingIdDisplay.textContent = "Meeting ID: ------";
    if (muteButton) { muteButton.textContent = "🎤 Mic"; muteButton.classList.remove("muted"); }
    if (cameraButton) { cameraButton.textContent = "📹 Camera"; cameraButton.classList.remove("camera-off"); }
    if (leaveMeetingBtn) leaveMeetingBtn.disabled = true;
}

async function leaveMeeting() {
    if (!meetingActive) return;
    sendWS({ type: "leave_meeting", meeting_id: meetingId, user_id: userId, user_name: userName, livekit_identity: liveKitIdentity });
    await cleanupMeeting(true);
    showHome();
    if (homeStartCamera) { homeStartCamera.textContent = "🎥 Start Camera"; homeStartCamera.disabled = false; }
    if (startCameraBtn) { startCameraBtn.textContent = "Start Camera"; startCameraBtn.disabled = false; }
    if (cameraStatus) { cameraStatus.textContent = "Camera is off"; cameraStatus.style.color = ""; }
}

// ============================================================
// EVENT LISTENERS
// ============================================================

homeStartCamera?.addEventListener("click", startCameraFromHome);
createMeetingButton?.addEventListener("click", createMeeting);
joinMeetingButton?.addEventListener("click", joinMeeting);
startCameraBtn?.addEventListener("click", startCameraFromMeeting);
clearCanvasBtn?.addEventListener("click", clearCanvasButtonAction);
muteButton?.addEventListener("click", toggleMute);
cameraButton?.addEventListener("click", toggleCamera);
leaveMeetingBtn?.addEventListener("click", leaveMeeting);
copyMeetingId?.addEventListener("click", copyMeetingIdToClipboard);

meetingIdInput?.addEventListener("keydown", (event) => { if (event.key === "Enter") joinMeeting(); });

window.addEventListener("resize", setupCanvasSizes);

window.addEventListener("beforeunload", () => {
    try { ws?.close(); } catch (_) {}
    try { liveKitRoom?.disconnect(); } catch (_) {}
    try { localStream?.getTracks().forEach((t) => t.stop()); } catch (_) {}
});

// ============================================================
// INITIALIZE
// ============================================================

function initializeApplication() {
    initializeMeetingPanels();
    updateLocalUI();
    setupCanvasSizes();
    hideLegacyRemoteCard();
    updateParticipantCount();
    updateCanvasAvailability();
    setConnectionStatus("Disconnected");
    if (meetingScreen) meetingScreen.classList.add("hidden");
    if (homeScreen) homeScreen.classList.remove("hidden");
    console.log("🚀 Air Canvas initialized.");
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeApplication, { once: true });
} else {
    initializeApplication();
}

console.log("🚀 Air Canvas app.js loaded.");