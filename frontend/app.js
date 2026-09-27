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
const DRAW_SEND_INTERVAL_MS = 30;
const CLEAR_COOLDOWN_MS = 700;

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
const remoteCanvas = document.getElementById("remoteCanvas");
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
let liveKitDataReady = false;

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

// ============================================================
// BASIC HELPERS
// ============================================================

function generateUserId() {
    return (
        "user-" +
        Date.now().toString(36) +
        "-" +
        Math.random().toString(36).substring(2, 8)
    );
}

function generateMeetingId() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < 6; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}

function normalizeMeetingId(value) {
    return String(value || "").trim().toUpperCase();
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function setConnectionStatus(text) {
    if (connectionStatus) {
        connectionStatus.textContent = `Backend: ${text}`;
    }
}

function updateParticipantCount() {
    const count = 1 + remoteParticipants.size;

    if (participantCount) {
        participantCount.textContent = String(count);
    }

    const panelCount = document.getElementById("participantsPanelCount");

    if (panelCount) {
        panelCount.textContent =
            `${count} participant${count === 1 ? "" : "s"}`;
    }

    renderParticipantsList();
}

function getInitials(name) {
    const value = String(name || "Participant").trim();
    if (!value) return "P";

    return (
        value
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => part.charAt(0).toUpperCase())
            .join("") || "P"
    );
}

function formatChatTime(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });
}

function setChatUnreadCount(count) {
    chatUnreadCount = Math.max(0, Number(count) || 0);
    if (!chatUnreadBadge) return;
    chatUnreadBadge.textContent = String(chatUnreadCount);
    chatUnreadBadge.classList.toggle("hidden", chatUnreadCount === 0);
}

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
    message.className =
        "chat-message" +
        (senderId && senderId === String(userId) ? " mine" : "");

    const meta = document.createElement("div");
    meta.className = "chat-message-meta";

    const name = document.createElement("span");
    name.className = "chat-message-name";
    name.textContent =
        senderId && senderId === String(userId) ? "You" : senderName;

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

    const chatIsOpen =
        chatPanel && !chatPanel.classList.contains("hidden");
    if (!chatIsOpen && senderId !== String(userId)) {
        setChatUnreadCount(chatUnreadCount + 1);
    }
}

async function sendChatMessage() {
    const text = String(chatInput?.value || "").trim();
    if (!text) return;

    if (!liveKitConnected || !liveKitRoom?.localParticipant) {
        console.warn("⚠️ Cannot send chat: LiveKit is not connected.");
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

    const sent = await sendLiveKitData(message, {
        reliable: true,
        topic: "aircanvas-control"
    });

    if (!sent) return;

    appendChatMessage(message);

    if (chatInput) {
        chatInput.value = "";
        chatInput.focus();
    }
}

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
            ([, info]) =>
                String(info.livekitIdentity || "") === identity
        );

        if (existingIndex >= 0) {
            const existingInfo = entries[existingIndex][1];
            existingInfo.livekitIdentity = identity;
            if (
                !existingInfo.name ||
                existingInfo.name === "Participant"
            ) {
                existingInfo.name =
                    tile.participant?.name || "Participant";
            }
            return;
        }

        entries.push([
            identity,
            {
                userId: identity,
                name: tile.participant?.name || "Participant",
                isCreator: false,
                canvasEnabled: false,
                livekitIdentity: identity
            }
        ]);
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
        name.textContent = info.isLocal
            ? `${info.name || "You"} (You)`
            : info.name || "Participant";

        const role = document.createElement("div");
        role.className = "participant-list-role";
        role.textContent = info.isCreator ? "Host" : "Participant";

        infoBox.append(name, role);

        const drawStatus = document.createElement("div");
        drawStatus.className = "participant-draw-status";
        drawStatus.textContent = info.canvasEnabled
            ? "🎨 Drawing"
            : "View only";

        row.append(avatar, infoBox, drawStatus);
        participantsList.appendChild(row);
    });

    const count = entries.length;

    if (participantCount) {
        participantCount.textContent = String(
            Math.max(count, 1 + remoteParticipants.size)
        );
    }

    if (participantsPanelCount) {
        const displayCount = Math.max(
            count,
            1 + remoteParticipants.size
        );
        participantsPanelCount.textContent =
            `${displayCount} participant${displayCount === 1 ? "" : "s"}`;
    }
}

function initializeMeetingPanels() {
    if (chatButton) {
        chatButton.addEventListener("click", openChatPanel);
    }
    if (closeChatButton) {
        closeChatButton.addEventListener("click", closeChatPanel);
    }
    if (participantsButton) {
        participantsButton.addEventListener("click", openParticipantsPanel);
    }
    if (closeParticipantsButton) {
        closeParticipantsButton.addEventListener("click", closeParticipantsPanel);
    }

    if (chatForm) {
        chatForm.addEventListener("submit", (event) => {
            event.preventDefault();
            sendChatMessage();
        });
    }

    updateParticipantCount();
}

function updateCanvasAvailability() {
    const canDraw = isMeetingCreator || canvasEnabled;

    if (clearCanvasBtn) {
        clearCanvasBtn.disabled = !canDraw;
        clearCanvasBtn.style.opacity = canDraw ? "1" : "0.45";
        clearCanvasBtn.title = canDraw
            ? "Clear your canvas"
            : "The host has not given you drawing permission.";
    }

    if (gestureDisplay && !canDraw) {
        gestureDisplay.textContent = "VIEW ONLY";
    }
    if (confidenceDisplay && !canDraw) {
        confidenceDisplay.textContent = "--";
    }

    renderDrawingPermissions();
    renderDrawingPermissionRequest();
}

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
        text.textContent =
            "⏳ Your drawing permission request is waiting for the host.";
    } else if (drawingPermissionStatus) {
        text.textContent = drawingPermissionStatus;
    } else {
        text.textContent =
            "You are view-only. Ask the host for permission to draw.";
    }

    text.style.marginBottom = "9px";

    const button = document.createElement("button");
    button.type = "button";

    if (drawingPermissionRequested) {
        button.textContent = "⏳ Request Pending";
        button.disabled = true;
        button.style.cursor = "default";
    } else if (drawingPermissionStatus) {
        button.textContent = "Try Again";
        button.disabled = false;
        button.style.cursor = "pointer";
        button.onclick = () => {
            drawingPermissionStatus = "";
            drawingPermissionRequested = true;

            const sent = sendWS({
                type: "request_drawing",
                user_id: String(userId || liveKitIdentity),
                user_name: userName || "Participant",
                livekit_identity: liveKitIdentity
            });

            if (!sent) {
                drawingPermissionRequested = false;
                drawingPermissionStatus =
                    "Could not contact the host. Please try again.";
            }

            renderDrawingPermissionRequest();
        };
    } else {
        button.textContent = "🎨 Ask Permission to Draw";
        button.disabled = false;
        button.style.cursor = "pointer";
        button.onclick = () => {
            const sent = sendWS({
                type: "request_drawing",
                user_id: String(userId || liveKitIdentity),
                user_name: userName || "Participant",
                livekit_identity: liveKitIdentity
            });

            if (!sent) {
                drawingPermissionStatus =
                    "Could not contact the host. Please try again.";
                renderDrawingPermissionRequest();
                return;
            }

            drawingPermissionRequested = true;
            drawingPermissionStatus = "";
            renderDrawingPermissionRequest();
        };
    }

    button.style.padding = "7px 11px";
    button.style.border = "1px solid #41464d";
    button.style.borderRadius = "6px";
    button.style.background = "#2c3035";
    button.style.color = "#f2f3f4";

    panel.append(text, button);
}

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

    // Build a de-duplicated list of guests. If two records share the
    // same livekitIdentity, keep only one (prefer the one that has
    // canvasEnabled === true).
    const seenIdentities = new Set();
    const guests = [];

    [...participantInfo.entries()]
        .filter(([, info]) => !info.isCreator)
        .forEach(([id, info]) => {
            const identityKey = info.livekitIdentity
                ? String(info.livekitIdentity)
                : String(id);

            if (seenIdentities.has(identityKey)) {
                const existing = guests.find(
                    ([, g]) =>
                        (g.livekitIdentity
                            ? String(g.livekitIdentity)
                            : "") === identityKey
                );
                if (existing && info.canvasEnabled) {
                    existing[1].canvasEnabled = true;
                }
                return;
            }

            seenIdentities.add(identityKey);
            guests.push([id, info]);
        });

    // Only show guests that need attention:
    //   - already have drawing permission, OR
    //   - have a pending permission request.
    // Participants who merely joined are hidden.
    const visibleGuests = guests.filter(([id, info]) => {
        const hasPermission = Boolean(info.canvasEnabled);
        const hasRequest =
            drawingPermissionRequests.has(String(id)) ||
            (info.livekitIdentity &&
                drawingPermissionRequests.has(String(info.livekitIdentity)));
        return hasPermission || hasRequest;
    });

    const activeGuestDrawers = guests.filter(([, info]) =>
        Boolean(info.canvasEnabled)
    ).length;

    drawingPermissionsPanel.innerHTML = "";

    const title = document.createElement("div");
    title.style.fontWeight = "700";
    title.style.marginBottom = "4px";
    title.textContent = "🎨 Drawing Permissions";

    const subtitle = document.createElement("div");
    subtitle.style.fontSize = "13px";
    subtitle.style.opacity = "0.75";
    subtitle.style.marginBottom = "12px";
    subtitle.textContent =
        `You can draw. Choose up to ${MAX_GUEST_DRAWERS} participants who can also draw. ` +
        `${activeGuestDrawers}/${MAX_GUEST_DRAWERS} guest slots used.`;

    drawingPermissionsPanel.append(title, subtitle);

    if (!visibleGuests.length) {
        const empty = document.createElement("div");
        empty.style.opacity = "0.7";
        empty.textContent =
            "No pending drawing requests. Participants can ask for permission to draw.";
        drawingPermissionsPanel.appendChild(empty);
        return;
    }

    const list = document.createElement("div");
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.gap = "8px";
    list.style.maxHeight = "260px";
    list.style.overflowY = "auto";

    visibleGuests.forEach(([id, info]) => {
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

        if (info.canvasEnabled) {
            button.textContent = "Remove Drawing";
            button.onclick = () =>
                sendWS({
                    type: "revoke_drawing",
                    target_user_id: id
                });
        } else {
            button.textContent = "Approve Drawing";
            button.disabled = activeGuestDrawers >= MAX_GUEST_DRAWERS;
            button.title = button.disabled
                ? `Only ${MAX_GUEST_DRAWERS} guest participants can draw at once.`
                : "Approve this participant's drawing request";

            button.onclick = () => {
                const targetIdentity = String(
                    info.livekitIdentity ||
                        userIdToLiveKitIdentity.get(String(id)) ||
                        id
                );

                sendWS({
                    type: "grant_drawing",
                    target_user_id: targetIdentity,
                    target_livekit_identity: targetIdentity,
                    target_user_name: info.name || "Participant"
                });

                info.canvasEnabled = true;
                drawingPermissionRequests.delete(String(id));
                if (info.livekitIdentity) {
                    drawingPermissionRequests.delete(
                        String(info.livekitIdentity)
                    );
                }
                participantInfo.set(String(id), info);
                renderDrawingPermissions();
            };
        }

        row.append(name, button);
        list.appendChild(row);
    });

    drawingPermissionsPanel.appendChild(list);
}

function updateLocalUI() {
    if (localParticipantLabel) {
        localParticipantLabel.textContent = userName || "You";
    }
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

userId =
    localStorage.getItem("airCanvasUserId") ||
    generateUserId();

localStorage.setItem("airCanvasUserId", userId);

const savedName = localStorage.getItem("airCanvasUserName");
const currentTypedName = (userNameInput?.value || "").trim();

if (currentTypedName) {
    userName = currentTypedName.slice(0, 30);
} else if (savedName) {
    userName = String(savedName).trim().slice(0, 30) || "Participant";

    if (userNameInput) {
        userNameInput.value = userName;
    }
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
            oldImage = canvas
                .getContext("2d")
                ?.getImageData(0, 0, canvas.width, canvas.height);
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

// ============================================================
// LANDMARK -> CANVAS PIXEL (object-fit: cover transform)
// ============================================================

function getVideoCoverTransform() {
    const container = video?.parentElement;
    if (!container) return null;

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    if (!cw || !ch || !vw || !vh) return null;

    const scale = Math.max(cw / vw, ch / vh);
    const dispW = vw * scale;
    const dispH = vh * scale;

    return {
        scale,
        offsetX: (cw - dispW) / 2,
        offsetY: (ch - dispH) / 2
    };
}

function landmarkToCanvasPixel(nx, ny) {
    const vw = video?.videoWidth || 0;
    const vh = video?.videoHeight || 0;

    const t = getVideoCoverTransform();

    if (!t || !vw || !vh) {
        const cw = landmarkCanvas?.width || airCanvas?.width || 1;
        const ch = landmarkCanvas?.height || airCanvas?.height || 1;
        return { x: nx * cw, y: ny * ch };
    }

    return {
        x: nx * vw * t.scale + t.offsetX,
        y: ny * vh * t.scale + t.offsetY
    };
}

function clearCanvasElement(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
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
// PARTICIPANT IDENTITY HELPERS
// ============================================================

// Find the canonical participantInfo key for a given backend user_id
// or LiveKit identity. Returns null if no matching record exists.
function findCanonicalParticipantKey(idOrIdentity) {
    const key = String(idOrIdentity || "");
    if (!key) return null;

    // Direct hit
    if (participantInfo.has(key)) return key;

    // Match by livekitIdentity field
    for (const [id, info] of participantInfo.entries()) {
        if (info.livekitIdentity && String(info.livekitIdentity) === key) {
            return id;
        }
    }

    // Match by userId field
    for (const [id, info] of participantInfo.entries()) {
        if (String(info.userId) === key) return id;
    }

    return null;
}

// ============================================================
// REMOTE PARTICIPANT TILES
// ============================================================

function hideLegacyRemoteCard() {
    const card = remoteVideo?.closest(".participant-card");
    if (card) card.style.display = "none";
    if (remoteAudio) remoteAudio.style.display = "none";
}

function createRemoteTile(participant) {
    if (!participant) return null;

    const identity = String(participant.identity);

    if (!identity || identity === liveKitIdentity) {
        return null;
    }

    if (remoteParticipants.has(identity)) {
        const existing = remoteParticipants.get(identity);
        existing.label.textContent = participant.name || "Participant";
        existing.participant = participant;
        return existing;
    }

    if (!participantsGrid) {
        console.error("❌ Participant grid not found.");
        return null;
    }

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
    waiting.innerHTML =
        '<div class="participant-avatar">👤</div><span>Waiting for camera...</span>';

    const remoteVid = document.createElement("video");
    remoteVid.autoplay = true;
    remoteVid.playsInline = true;
    remoteVid.setAttribute("playsinline", "");
    remoteVid.style.width = "100%";
    remoteVid.style.height = "100%";
    remoteVid.style.objectFit = "cover";
    remoteVid.style.transform = "none";
    remoteVid.style.display = "block";
    remoteVid.style.visibility = "visible";
    remoteVid.style.opacity = "1";

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
        identity,
        participant,
        card,
        label,
        container,
        waiting,
        video: remoteVid,
        canvas,
        ctx: canvas.getContext("2d"),
        audio
    };

    remoteParticipants.set(identity, tile);

    requestAnimationFrame(() => {
        resizeRemoteCanvas(tile);
        flushPendingRemoteDrawingHistory(identity);
    });

    requestAnimationFrame(() => resizeRemoteCanvas(tile));

    updateParticipantCount();

    return tile;
}

function flushPendingRemoteDrawingHistory(identity) {
    const key = String(identity || "");
    if (!key || !remoteParticipants.has(key)) {
        return;
    }

    const events = pendingRemoteDrawingHistory.get(key);
    if (!Array.isArray(events) || !events.length) {
        return;
    }

    pendingRemoteDrawingHistory.delete(key);

    events.forEach((event) => {
        try {
            handleRemoteDraw(event);
        } catch (error) {
            console.warn("⚠️ Could not replay drawing history:", error);
        }
    });
}

// ------------------------------------------------------------
// FIXED: removeRemoteTile now ALWAYS cleans participantInfo
// entries that match this identity — even when no video tile
// exists. Prevents stale "phantom" duplicate rows when a
// participant reconnects with a fresh LiveKit identity.
// ------------------------------------------------------------
function removeRemoteTile(identity) {
    const key = String(identity);
    if (!key) return;

    // 1. Always clean participantInfo (by key or by identity field).
    for (const [infoId, info] of [...participantInfo.entries()]) {
        const matchesKey = String(infoId) === key;
        const matchesIdentity =
            info.livekitIdentity &&
            String(info.livekitIdentity) === key;

        if (matchesKey || matchesIdentity) {
            participantInfo.delete(infoId);
        }
    }

    // 2. Remove the remote video tile if it exists.
    const tile = remoteParticipants.get(key);

    if (tile) {
        try {
            tile.video.srcObject = null;
        } catch (_) {}
        try {
            tile.audio.srcObject = null;
        } catch (_) {}

        if (tile.card) tile.card.remove();

        remoteParticipants.delete(key);
        pendingRemoteDrawingHistory.delete(key);
    }

    // 3. Refresh UI counts and permission panel.
    updateParticipantCount();
    renderDrawingPermissions();
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
        tile.video.style.display = "block";
        tile.video.style.visibility = "visible";
        tile.video.style.opacity = "1";
        tile.canvas.style.transform = "none";
        tile.waiting.style.display = "none";
        tile.video.play().catch(() => {});
    } catch (error) {
        console.error("❌ Remote video attach failed:", error);
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
        console.error("❌ Remote audio attach failed:", error);
    }
}

function detachParticipantTrack(participant, track) {
    if (!participant || !track) return;

    const identity = String(participant.identity);
    const tile = remoteParticipants.get(identity);
    if (!tile) return;

    try {
        track.detach(tile.video);
    } catch (_) {}
    try {
        track.detach(tile.audio);
    } catch (_) {}

    try {
        if (track.kind === window.LivekitClient.Track.Kind.Video) {
            tile.video.style.display = "none";
            tile.waiting.style.display = "block";
        }
    } catch (_) {}
}

function detachRemoteTrack(participant, track) {
    detachParticipantTrack(participant, track);
}

// ============================================================
// CAMERA
// ============================================================

async function startLocalMedia() {
    if (localStream) return localStream;

    if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
            "Camera access is not available in this browser/context."
        );
    }

    console.log("🎥 Requesting camera and microphone...");

    localStream = await navigator.mediaDevices.getUserMedia({
        video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 }
        },
        audio: true
    });

    video.srcObject = localStream;
    video.muted = true;
    video.playsInline = true;
    await video.play();

    isCameraStarted = true;

    if (cameraStatus) {
        cameraStatus.textContent = "✅ Camera & Mic On";
        cameraStatus.style.color = "#4caf50";
    }

    if (homeStartCamera) {
        homeStartCamera.textContent = "✅ Camera Started";
        homeStartCamera.disabled = true;
    }

    if (startCameraBtn) {
        startCameraBtn.textContent = "✅ Camera On";
        startCameraBtn.disabled = true;
    }

    if (isMeetingCreator || canvasEnabled) {
        initMediaPipe();
    }

    setTimeout(setupCanvasSizes, 300);

    console.log("✅ Camera and microphone started.");

    return localStream;
}

async function startCameraFromHome() {
    if (isCameraStarted) return;

    userName =
        (userNameInput?.value || "").trim().slice(0, 30) || "Participant";

    localStorage.setItem("airCanvasUserName", userName);
    updateLocalUI();

    try {
        await startLocalMedia();
    } catch (error) {
        console.error("❌ Camera/Microphone error:", error);

        if (cameraStatus) {
            cameraStatus.textContent =
                "❌ Camera/Microphone access denied";
            cameraStatus.style.color = "#f44336";
        }

        if (homeStartCamera) {
            homeStartCamera.disabled = false;
            homeStartCamera.textContent = "🎥 Start Camera";
        }
    }
}

async function startCameraFromMeeting() {
    if (isCameraStarted) return;

    try {
        await startLocalMedia();
    } catch (error) {
        console.error("❌ Camera error:", error);
        alert("Could not access camera and microphone.");
    }
}

function stopLocalMedia() {
    if (camera) {
        try {
            camera.stop();
        } catch (_) {}
        camera = null;
    }

    if (localStream) {
        localStream.getTracks().forEach((track) => {
            try {
                track.stop();
            } catch (_) {}
        });
    }

    localStream = null;
    isCameraStarted = false;
    mediaPipeStarted = false;
    hands = null;

    if (video) video.srcObject = null;
}

// ============================================================
// MEDIAPIPE + GESTURE PREDICTION
// ============================================================

function initMediaPipe() {
    if (mediaPipeStarted || !window.Hands || !window.Camera) {
        return;
    }

    try {
        hands = new Hands({
            locateFile: (file) =>
                `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });

        hands.setOptions({
            maxNumHands: 1,
            modelComplexity: 1,
            minDetectionConfidence: 0.7,
            minTrackingConfidence: 0.5
        });

        hands.onResults(onResults);

        camera = new Camera(video, {
            onFrame: async () => {
                if (!video.videoWidth) return;

                try {
                    await hands.send({ image: video });
                } catch (error) {
                    console.warn("⚠️ MediaPipe frame error:", error);
                }
            },
            width: 1280,
            height: 720
        });

        camera.start();
        mediaPipeStarted = true;

        console.log("🖐️ MediaPipe started.");
    } catch (error) {
        console.error("❌ MediaPipe initialization failed:", error);
    }
}

function stopMediaPipeOnly() {
    if (camera) {
        try {
            camera.stop();
        } catch (_) {}
    }

    camera = null;
    hands = null;
    mediaPipeStarted = false;

    if (landmarkCanvas) {
        clearCanvasElement(landmarkCanvas);
    }

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

    if (landmarkCanvas) {
        const ctx = landmarkCanvas.getContext("2d");

        if (
            typeof HAND_CONNECTIONS !== "undefined" &&
            Array.isArray(HAND_CONNECTIONS)
        ) {
            ctx.strokeStyle = "#00FF00";
            ctx.lineWidth = 2;
            ctx.beginPath();

            for (const [i, j] of HAND_CONNECTIONS) {
                const p1 = landmarkToCanvasPixel(
                    landmarks[i].x,
                    landmarks[i].y
                );
                const p2 = landmarkToCanvasPixel(
                    landmarks[j].x,
                    landmarks[j].y
                );
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
            }

            ctx.stroke();
        }

        ctx.fillStyle = "#FF0000";

        for (const lm of landmarks) {
            const p = landmarkToCanvasPixel(lm.x, lm.y);
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    const values = [];

    for (const point of landmarks) {
        values.push(point.x, point.y);
    }

    if (activeGesture === "draw") {
        drawGesture(values);
    } else if (activeGesture === "erase") {
        eraseGesture(values);
    } else {
        resetDrawingState();
    }

    const now = performance.now();

    if (now - lastPredictionTime >= PREDICTION_INTERVAL_MS) {
        lastPredictionTime = now;
        pendingLandmarks = values;
        requestGesturePrediction();
    }
}

async function requestGesturePrediction() {
    if (predictionInProgress || !pendingLandmarks) {
        return;
    }

    predictionInProgress = true;

    const landmarks = pendingLandmarks;
    pendingLandmarks = null;

    try {
        const response = await fetch(`${BACKEND_URL}/predict`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ landmarks })
        });

        if (!response.ok) {
            throw new Error(`Prediction HTTP ${response.status}`);
        }

        const result = await response.json();

        const gesture = String(
            result.confirmed_gesture ||
                result.gesture ||
                result.prediction ||
                "no_gesture"
        ).toLowerCase();

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
        console.error("❌ Backend prediction error:", error);

        activeGesture = "no_gesture";
        activeConfidence = 0;
        resetDrawingState();
    } finally {
        predictionInProgress = false;

        if (pendingLandmarks) {
            requestGesturePrediction();
        }
    }
}

function updateGestureDisplay(gesture, confidence) {
    activeGesture = gesture || "no_gesture";
    activeConfidence = Number(confidence) || 0;

    if (gestureDisplay) {
        gestureDisplay.textContent =
            activeGesture === "no_gesture"
                ? "NO GESTURE"
                : activeGesture.toUpperCase();
    }

    if (confidenceDisplay) {
        confidenceDisplay.textContent =
            activeGesture === "no_gesture"
                ? "--"
                : `${Math.round(activeConfidence * 100)}%`;
    }
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

    const lmX = Number(values[16]);
    const lmY = Number(values[17]);

    if (!Number.isFinite(lmX) || !Number.isFinite(lmY)) {
        return;
    }

    const pixel = landmarkToCanvasPixel(lmX, lmY);

    const targetX = clamp(pixel.x, 0, airCanvas.width);
    const targetY = clamp(pixel.y, 0, airCanvas.height);

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
        drawDot(
            airCanvas,
            x / airCanvas.width,
            y / airCanvas.height,
            "draw"
        );
        return;
    }

    const distance = Math.hypot(x - lastDrawX, y - lastDrawY);
    if (distance < 0.5) return;

    const maxJump =
        Math.max(airCanvas.width, airCanvas.height) * 0.12;
    if (distance > maxJump) {
        lastDrawX = x;
        lastDrawY = y;
        return;
    }

    drawLine(
        airCanvas,
        lastDrawX / airCanvas.width,
        lastDrawY / airCanvas.height,
        x / airCanvas.width,
        y / airCanvas.height,
        "draw"
    );

    sendDrawData(
        x / airCanvas.width,
        y / airCanvas.height,
        lastDrawX / airCanvas.width,
        lastDrawY / airCanvas.height,
        "draw"
    );

    lastDrawX = x;
    lastDrawY = y;
}

function eraseGesture(values) {
    if (!airCanvas) return;

    const lmX = Number(values[16]);
    const lmY = Number(values[17]);

    if (!Number.isFinite(lmX) || !Number.isFinite(lmY)) {
        return;
    }

    const pixel = landmarkToCanvasPixel(lmX, lmY);

    const px = clamp(pixel.x, 0, airCanvas.width);
    const py = clamp(pixel.y, 0, airCanvas.height);

    const ctx = airCanvas.getContext("2d");

    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(px, py, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";

    sendDrawData(
        px / airCanvas.width,
        py / airCanvas.height,
        px / airCanvas.width,
        py / airCanvas.height,
        "erase"
    );

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
    ctx.globalCompositeOperation =
        action === "erase" ? "destination-out" : "source-over";
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

    ctx.globalCompositeOperation =
        action === "erase" ? "destination-out" : "source-over";

    ctx.fillStyle = "#00ff00";

    ctx.beginPath();
    ctx.arc(
        clamp(x, 0, 1) * canvas.width,
        clamp(y, 0, 1) * canvas.height,
        action === "erase" ? 20 : 2.5,
        0,
        Math.PI * 2
    );
    ctx.fill();

    ctx.globalCompositeOperation = "source-over";
}

function sendDrawData(x, y, prevX, prevY, action) {
    if (!isMeetingCreator && !canvasEnabled) {
        return;
    }

    const remoteX = 1 - clamp(Number(x), 0, 1);
    const remotePrevX = 1 - clamp(Number(prevX), 0, 1);

    if (!meetingActive || !liveKitConnected) {
        return;
    }

    const now = performance.now();

    if (
        action === "draw" &&
        now - lastDrawSendTime < DRAW_SEND_INTERVAL_MS
    ) {
        return;
    }

    lastDrawSendTime = now;

    sendWS({
        type: "draw_data",
        meeting_id: meetingId,
        user_id: liveKitIdentity,
        user_name: userName,
        livekit_identity: liveKitIdentity,
        x: remoteX,
        y: Number(y),
        prev_x: remotePrevX,
        prev_y: Number(prevY),
        lastX: remotePrevX,
        lastY: Number(prevY),
        action: action || "draw"
    });
}

function clearMyCanvasAndBroadcast() {
    if (!isMeetingCreator && !canvasEnabled) {
        return;
    }

    clearLocalCanvas();

    if (!meetingActive || !liveKitConnected) {
        return;
    }

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
    const direct =
        data.livekit_identity ||
        data.sender_identity ||
        data.participant_identity;

    if (direct && remoteParticipants.has(String(direct))) {
        return String(direct);
    }

    if (
        data.user_id &&
        userIdToLiveKitIdentity.has(String(data.user_id))
    ) {
        return userIdToLiveKitIdentity.get(String(data.user_id));
    }

    return direct ? String(direct) : null;
}

function handleRemoteDraw(data) {
    const identity = resolveRemoteIdentity(data);

    if (!identity || identity === liveKitIdentity) {
        return;
    }

    const tile = remoteParticipants.get(identity);

    if (!tile?.canvas) {
        return;
    }

    resizeRemoteCanvas(tile);

    const x = Number(data.x);
    const y = Number(data.y);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return;
    }

    if (data.action === "erase") {
        const ctx = tile.canvas.getContext("2d");

        ctx.globalCompositeOperation = "destination-out";
        ctx.beginPath();
        ctx.arc(
            clamp(x, 0, 1) * tile.canvas.width,
            clamp(y, 0, 1) * tile.canvas.height,
            20,
            0,
            Math.PI * 2
        );
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        return;
    }

    const prevX = Number(data.prev_x ?? data.lastX);
    const prevY = Number(data.prev_y ?? data.lastY);

    if (Number.isFinite(prevX) && Number.isFinite(prevY)) {
        drawLine(tile.canvas, prevX, prevY, x, y, "draw");
    } else {
        drawDot(tile.canvas, x, y, "draw");
    }
}

function handleRemoteClear(data) {
    const identity = resolveRemoteIdentity(data);

    if (!identity || identity === liveKitIdentity) {
        return;
    }

    const tile = remoteParticipants.get(identity);

    if (tile) {
        clearCanvasElement(tile.canvas);
    }
}

// ============================================================
// LIVEKIT DATA MESSAGING
// ============================================================

async function sendLiveKitData(message, options = {}) {
    if (!liveKitRoom?.localParticipant || !liveKitConnected) {
        console.warn("⚠️ LiveKit data channel is not ready.");
        return false;
    }

    try {
        const payload = new TextEncoder().encode(JSON.stringify(message));
        await liveKitRoom.localParticipant.publishData(payload, {
            reliable: options.reliable !== false,
            destinationIdentities: options.destinationIdentities || [],
            topic: options.topic || "aircanvas-control"
        });
        return true;
    } catch (error) {
        console.error("❌ LiveKit data send failed:", error);
        return false;
    }
}

function upsertLiveKitParticipant(participant, isCreator = false) {
    if (!participant) return;

    const identity = String(participant.identity || "");
    if (!identity || identity === String(liveKitIdentity)) return;

    // Look for any existing record — under any key — that
    // represents this participant.
    const existingKey = findCanonicalParticipantKey(identity);

    if (existingKey) {
        const info = participantInfo.get(existingKey);

        info.userId = info.userId || identity;
        info.name = participant.name || info.name || "Participant";
        info.livekitIdentity = identity;
        if (isCreator) info.isCreator = true;

        participantInfo.set(existingKey, info);

        userIdToLiveKitIdentity.set(identity, identity);
        liveKitIdentityToUserId.set(identity, existingKey);

        updateParticipantCount();
        renderDrawingPermissions();
        return;
    }

    // No record yet — create a new one keyed by identity.
    const newInfo = {
        userId: identity,
        name: participant.name || "Participant",
        isCreator: false,
        livekitIdentity: identity,
        canvasEnabled: false
    };
    if (isCreator) newInfo.isCreator = true;

    participantInfo.set(identity, newInfo);
    userIdToLiveKitIdentity.set(identity, identity);
    liveKitIdentityToUserId.set(identity, identity);

    updateParticipantCount();
    renderDrawingPermissions();
}

function handleLiveKitData(payload, participant) {
    try {
        const decoded = new TextDecoder().decode(payload);
        const data = JSON.parse(decoded);
        const senderIdentity = participant?.identity
            ? String(participant.identity)
            : "";

        if (data.type === "participant_hello") {
            if (!senderIdentity) return;

            // Merge into any existing record for this identity.
            const existingKey = findCanonicalParticipantKey(senderIdentity);

            if (existingKey) {
                const info = participantInfo.get(existingKey);

                info.userId = info.userId || senderIdentity;
                info.name =
                    data.user_name ||
                    info.name ||
                    participant?.name ||
                    "Participant";
                info.isCreator = Boolean(data.is_creator);
                info.livekitIdentity = senderIdentity;
                info.canvasEnabled = Boolean(data.canvas_enabled);

                participantInfo.set(existingKey, info);

                userIdToLiveKitIdentity.set(senderIdentity, senderIdentity);
                liveKitIdentityToUserId.set(senderIdentity, existingKey);
            } else {
                participantInfo.set(senderIdentity, {
                    userId: senderIdentity,
                    name:
                        data.user_name ||
                        participant?.name ||
                        "Participant",
                    isCreator: Boolean(data.is_creator),
                    livekitIdentity: senderIdentity,
                    canvasEnabled: Boolean(data.canvas_enabled)
                });

                userIdToLiveKitIdentity.set(senderIdentity, senderIdentity);
                liveKitIdentityToUserId.set(senderIdentity, senderIdentity);
            }

            updateParticipantCount();
            renderDrawingPermissions();
            return;
        }

        if (senderIdentity) {
            data.user_id =
                data.user_id || data.target_user_id || senderIdentity;
            data.livekit_identity =
                data.livekit_identity ||
                data.target_livekit_identity ||
                (data.target_user_id ? data.target_user_id : senderIdentity);
            data.user_name =
                data.user_name ||
                data.target_user_name ||
                participant?.name ||
                "Participant";
        }

        handleWebSocketMessage(data);
    } catch (error) {
        console.error("❌ LiveKit data receive failed:", error);
    }
}

// ============================================================
// WEBSOCKET COMPATIBILITY LAYER
// ============================================================

function sendWS(message) {
    if (!message) return false;

    const type = message.type;
    if (type === "create_meeting" || type === "join_meeting") {
        return true;
    }

    let destinationIdentities = [];
    if (type === "grant_drawing" || type === "revoke_drawing") {
        const targetId = String(message.target_user_id || "");
        const targetIdentity = String(
            message.target_livekit_identity ||
                userIdToLiveKitIdentity.get(targetId) ||
                (remoteParticipants.has(targetId) ? targetId : "") ||
                targetId
        );

        if (targetIdentity) {
            destinationIdentities = [targetIdentity];
        }

        message.target_user_id = targetId || targetIdentity;
        message.target_livekit_identity = targetIdentity;
        message.user_id = targetIdentity;
        message.livekit_identity = targetIdentity;
    }

    const reliable = true;
    sendLiveKitData(message, {
        reliable,
        destinationIdentities,
        topic:
            type === "draw_data"
                ? "aircanvas-draw"
                : "aircanvas-control"
    });

    if (type !== "draw_data") {
        console.log("📤 LiveKit Data:", message);
    }
    return true;
}

function connectWebSocket() {
    setConnectionStatus("LiveKit");
    return Promise.resolve(true);
}

function handleWebSocketMessage(data) {
    if (!data?.type) return;

    switch (data.type) {
        case "self_info":
            if (data.user_id) userId = data.user_id;
            if (data.user_name) userName = data.user_name;

            if (data.is_creator !== undefined) {
                if (isMeetingCreator) {
                    isMeetingCreator = true;
                } else {
                    isMeetingCreator = Boolean(data.is_creator);
                }
            }

            if (data.livekit_identity) {
                liveKitIdentity = String(data.livekit_identity);
            }

            canvasEnabled =
                Boolean(isMeetingCreator) ||
                Boolean(data.canvas_enabled) ||
                Boolean(data.is_creator);

            if (isMeetingCreator || canvasEnabled) {
                if (!mediaPipeStarted && video?.srcObject) {
                    initMediaPipe();
                }
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
                const creatorIdentity = data.creator_livekit_identity
                    ? String(data.creator_livekit_identity)
                    : null;

                const existingKey =
                    findCanonicalParticipantKey(creatorIdentity) ||
                    String(data.creator_id);

                participantInfo.set(existingKey, {
                    userId: String(data.creator_id),
                    name: data.creator_name || "Host",
                    isCreator: true,
                    livekitIdentity: creatorIdentity,
                    canvasEnabled: true
                });

                if (creatorIdentity) {
                    userIdToLiveKitIdentity.set(
                        String(data.creator_id),
                        creatorIdentity
                    );
                    liveKitIdentityToUserId.set(
                        creatorIdentity,
                        existingKey
                    );
                }
            }
            break;

        case "participant_joined": {
            const backendId = data.user_id ? String(data.user_id) : null;
            const livekitId = data.livekit_identity
                ? String(data.livekit_identity)
                : null;

            if (backendId || livekitId) {
                const canonicalKey = livekitId || backendId;
                const existingKey =
                    findCanonicalParticipantKey(canonicalKey) || canonicalKey;

                const existing = participantInfo.get(existingKey) || {
                    userId: backendId || canonicalKey,
                    name: data.user_name || "Participant",
                    isCreator: Boolean(data.is_creator),
                    livekitIdentity: livekitId,
                    canvasEnabled: Boolean(data.canvas_enabled)
                };

                if (backendId) existing.userId = backendId;
                existing.name = data.user_name || existing.name || "Participant";
                existing.isCreator = Boolean(data.is_creator);
                if (livekitId) existing.livekitIdentity = livekitId;
                existing.canvasEnabled = Boolean(data.canvas_enabled);

                participantInfo.set(existingKey, existing);

                if (backendId && livekitId) {
                    userIdToLiveKitIdentity.set(backendId, livekitId);
                }
                if (livekitId) {
                    liveKitIdentityToUserId.set(livekitId, existingKey);
                }
            }

            updateParticipantCount();
            renderDrawingPermissions();
            break;
        }

        case "participant_left": {
            const backendId = data.user_id ? String(data.user_id) : null;
            const livekitId = data.livekit_identity
                ? String(data.livekit_identity)
                : null;

            if (backendId) {
                const identity = userIdToLiveKitIdentity.get(backendId);
                removeRemoteTile(identity || backendId);
                userIdToLiveKitIdentity.delete(backendId);
            }
            if (livekitId) {
                removeRemoteTile(livekitId);
            }

            updateParticipantCount();
            renderDrawingPermissions();
            break;
        }

        case "request_drawing":
        case "drawing_permission_request": {
            const requesterId = data.user_id || data.livekit_identity || data.sender_identity
                ? String(data.user_id || data.livekit_identity || data.sender_identity)
                : null;

            if (isMeetingCreator && requesterId) {
                drawingPermissionRequests.add(requesterId);

                // Find existing participant record; do not create a new one.
                const existingKey = findCanonicalParticipantKey(requesterId);

                if (existingKey) {
                    const existing = participantInfo.get(existingKey);
                    existing.name = data.user_name || existing.name;
                    existing.livekitIdentity =
                        data.livekit_identity || existing.livekitIdentity;
                    participantInfo.set(existingKey, existing);
                } else {
                    // No record yet — create one, keyed by whichever
                    // identity we have.
                    participantInfo.set(requesterId, {
                        userId: requesterId,
                        name: data.user_name || "Participant",
                        isCreator: false,
                        livekitIdentity: data.livekit_identity || null,
                        canvasEnabled: false
                    });
                }

                renderDrawingPermissions();
                console.log(`🙋 Drawing permission requested by ${data.user_name || "Participant"}`);
            }
            break;
        }

        case "drawing_permission_denied": {
            drawingPermissionRequested = false;

            drawingPermissionStatus = String(
                data.message ||
                    "Drawing permission is currently unavailable."
            );

            renderDrawingPermissionRequest();

            console.log(
                "🚫 Drawing permission unavailable:",
                drawingPermissionStatus
            );

            break;
        }

        case "grant_drawing":
        case "drawing_permission": {
            const id =
                data.target_livekit_identity
                    ? String(data.target_livekit_identity)
                    : data.target_user_id
                    ? String(data.target_user_id)
                    : data.user_id
                    ? String(data.user_id)
                    : null;

            const permissionEnabled =
                data.type === "grant_drawing"
                    ? true
                    : Boolean(data.canvas_enabled);

            if (!id) break;

            // Find existing record — do not create duplicates.
            const existingKey =
                findCanonicalParticipantKey(id) || id;

            const existing = participantInfo.get(existingKey) || {
                userId: id,
                name: data.user_name || "Participant",
                isCreator: false
            };

            existing.canvasEnabled = permissionEnabled;

            if (data.livekit_identity) {
                existing.livekitIdentity = String(data.livekit_identity);
                userIdToLiveKitIdentity.set(
                    existingKey,
                    String(data.livekit_identity)
                );
                liveKitIdentityToUserId.set(
                    String(data.livekit_identity),
                    existingKey
                );
            }

            participantInfo.set(existingKey, existing);

            if (isMeetingCreator) {
                drawingPermissionRequests.delete(id);
                if (existing.livekitIdentity) {
                    drawingPermissionRequests.delete(
                        existing.livekitIdentity
                    );
                }
            }

            if (
                id === String(userId) ||
                id === String(liveKitIdentity)
            ) {
                drawingPermissionRequested = false;
                drawingPermissionStatus = "";
                canvasEnabled = permissionEnabled;

                if (canvasEnabled) {
                    if (!mediaPipeStarted) {
                        initMediaPipe();
                    }
                } else {
                    stopMediaPipeOnly();
                }

                resetDrawingState();
                updateCanvasAvailability();
            } else {
                renderDrawingPermissions();
            }

            console.log(
                `🎨 Drawing permission for ${existing.name}: ${
                    existing.canvasEnabled ? "ENABLED" : "DISABLED"
                }`
            );

            break;
        }

        case "room_participants": {
            const incoming = Array.isArray(data.participants)
                ? data.participants
                : [];

            // Track which identities are in the fresh snapshot so
            // we can prune anything stale.
            const freshKeys = new Set();

            incoming.forEach((participant) => {
                const backendId = participant.user_id
                    ? String(participant.user_id)
                    : null;

                if (!backendId) return;

                const identity = participant.livekit_identity
                    ? String(participant.livekit_identity)
                    : null;

                // Skip ourselves.
                if (
                    backendId === String(userId) ||
                    (identity && identity === String(liveKitIdentity))
                ) {
                    canvasEnabled =
                        Boolean(participant.canvas_enabled) ||
                        Boolean(participant.is_creator);
                    return;
                }

                // Find any existing record for this person and reuse it.
                const existingKey =
                    findCanonicalParticipantKey(identity) ||
                    findCanonicalParticipantKey(backendId) ||
                    backendId;

                freshKeys.add(existingKey);

                participantInfo.set(existingKey, {
                    userId: backendId,
                    name: participant.user_name || "Participant",
                    isCreator: Boolean(participant.is_creator),
                    livekitIdentity: identity,
                    canvasEnabled: Boolean(participant.canvas_enabled)
                });

                if (identity) {
                    userIdToLiveKitIdentity.set(backendId, identity);
                    liveKitIdentityToUserId.set(identity, existingKey);
                }
            });

            // Prune any participantInfo entries that are not in the
            // fresh snapshot. Prevents stale duplicates.
            for (const [infoId] of [...participantInfo.entries()]) {
                if (!freshKeys.has(String(infoId))) {
                    participantInfo.delete(infoId);
                }
            }

            if (isMeetingCreator || canvasEnabled) {
                if (!mediaPipeStarted) {
                    initMediaPipe();
                }
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

                if (!identity || identity === liveKitIdentity) {
                    return;
                }

                if (remoteParticipants.has(identity)) {
                    handleRemoteDraw(event);
                } else {
                    if (!pendingRemoteDrawingHistory.has(identity)) {
                        pendingRemoteDrawingHistory.set(identity, []);
                    }
                    pendingRemoteDrawingHistory.get(identity).push(event);
                }
            });
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
            alert(
                `This meeting is full. Maximum ${MAX_PARTICIPANTS} participants.`
            );
            break;

        case "error":
            console.error("❌ Server error:", data.message);
            alert(data.message || "Server error.");
            break;

        default:
            break;
    }
}

function disconnectWebSocket() {
    if (ws) {
        try {
            ws.close();
        } catch (_) {}
    }
    ws = null;
}

// ============================================================
// LIVEKIT SDK LOADING
// ============================================================

function loadLiveKitSDK() {
    if (window.LivekitClient) {
        return Promise.resolve(window.LivekitClient);
    }

    if (liveKitSDKPromise) return liveKitSDKPromise;

    liveKitSDKPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector(
            'script[data-livekit-sdk="true"]'
        );

        if (existing) {
            existing.addEventListener("load", () =>
                resolve(window.LivekitClient)
            );
            existing.addEventListener("error", () =>
                reject(new Error("LiveKit SDK failed to load."))
            );
            return;
        }

        const script = document.createElement("script");
        script.src =
            "https://cdn.jsdelivr.net/npm/livekit-client/dist/livekit-client.umd.min.js";
        script.async = true;
        script.dataset.livekitSdk = "true";

        script.onload = () => {
            if (window.LivekitClient) {
                resolve(window.LivekitClient);
            } else {
                reject(
                    new Error(
                        "LiveKit SDK loaded but global was not found."
                    )
                );
            }
        };
        script.onerror = () =>
            reject(new Error("Could not load LiveKit SDK."));

        document.head.appendChild(script);
    });

    return liveKitSDKPromise;
}

// ============================================================
// LIVEKIT
// ============================================================

async function connectLiveKit() {
    if (liveKitConnected) return;

    if (!meetingId || !localStream) {
        throw new Error("Meeting or local media missing.");
    }

    const LK = await loadLiveKitSDK();

    console.log("🔵 Connecting to LiveKit...");

    const tokenSource = LK.TokenSource.developmentTokenServer(
        LIVEKIT_TOKEN_SERVER_ID
    );

    const credentials = await tokenSource.fetch({
        roomName: meetingId,
        participantIdentity: liveKitIdentity,
        participantName: userName
    });

    if (!credentials?.participantToken) {
        throw new Error("LiveKit token was not returned.");
    }

    liveKitRoom = new LK.Room({
        adaptiveStream: true,
        dynacast: true
    });

    liveKitRoom.on(LK.RoomEvent.DataReceived, (payload, participant) => {
        handleLiveKitData(payload, participant);
    });

    liveKitRoom.on(
        LK.RoomEvent.TrackSubscribed,
        (track, publication, participant) => {
            const identity = String(participant.identity);

            if (identity === liveKitIdentity) return;

            const tile = createRemoteTile(participant);
            if (!tile) return;

            if (track.kind === LK.Track.Kind.Video) {
                attachRemoteVideo(participant, track);
            } else if (track.kind === LK.Track.Kind.Audio) {
                attachRemoteAudio(participant, track);
            }
        }
    );

    liveKitRoom.on(
        LK.RoomEvent.TrackUnsubscribed,
        (track, publication, participant) => {
            detachParticipantTrack(participant, track);
        }
    );

    liveKitRoom.on(LK.RoomEvent.ParticipantConnected, (participant) => {
        const identity = String(participant.identity);

        if (identity === liveKitIdentity) return;

        createRemoteTile(participant);
        upsertLiveKitParticipant(participant, false);

        sendLiveKitData(
            {
                type: "participant_hello",
                user_name: userName,
                is_creator: isMeetingCreator,
                canvas_enabled: Boolean(isMeetingCreator || canvasEnabled)
            },
            { reliable: true, topic: "aircanvas-control" }
        );

        for (const [id, info] of participantInfo) {
            if (info.livekitIdentity === identity) {
                userIdToLiveKitIdentity.set(id, identity);
                liveKitIdentityToUserId.set(identity, id);
                break;
            }
        }
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

    await liveKitRoom.connect(
        credentials.serverUrl || LIVEKIT_SERVER_URL,
        credentials.participantToken
    );

    liveKitConnected = true;

    console.log("✅ LIVEKIT CONNECTED:", liveKitIdentity);

    liveKitDataReady = true;

    participantInfo.clear();
    liveKitRoom.remoteParticipants.forEach((participant) => {
        createRemoteTile(participant);
        upsertLiveKitParticipant(participant, false);
    });

    await sendLiveKitData(
        {
            type: "participant_hello",
            user_name: userName,
            is_creator: isMeetingCreator,
            canvas_enabled: Boolean(isMeetingCreator || canvasEnabled)
        },
        { reliable: true, topic: "aircanvas-control" }
    );

    const cameraTrack = localStream.getVideoTracks()[0];

    if (cameraTrack) {
        await liveKitRoom.localParticipant.publishTrack(cameraTrack, {
            name: "air-canvas-camera",
            source: LK.Track.Source.Camera
        });
    }

    const microphoneTrack = localStream.getAudioTracks()[0];

    if (microphoneTrack) {
        await liveKitRoom.localParticipant.publishTrack(microphoneTrack, {
            name: "air-canvas-microphone",
            source: LK.Track.Source.Microphone
        });
    }

    liveKitRoom.remoteParticipants.forEach((participant) => {
        createRemoteTile(participant);

        for (const publication of participant.trackPublications.values()) {
            if (publication.isSubscribed && publication.track) {
                if (publication.kind === LK.Track.Kind.Video) {
                    attachRemoteVideo(participant, publication.track);
                } else if (publication.kind === LK.Track.Kind.Audio) {
                    attachRemoteAudio(participant, publication.track);
                }
            } else if (!publication.isSubscribed) {
                try {
                    publication.setSubscribed(true);
                } catch (_) {}
            }
        }
    });

    updateParticipantCount();
}

function disconnectLiveKit() {
    if (liveKitRoom) {
        try {
            liveKitRoom.disconnect();
        } catch (_) {}
    }

    liveKitRoom = null;
    liveKitConnected = false;

    clearRemoteTiles();
}

// ============================================================
// MEETING FLOW
// ============================================================

function setupMeetingUI() {
    showMeeting();

    if (meetingIdDisplay) {
        meetingIdDisplay.textContent = `Meeting ID: ${meetingId}`;
    }

    if (meetingIdLarge) meetingIdLarge.textContent = meetingId;

    updateLocalUI();

    if (remoteParticipantLabel) {
        remoteParticipantLabel.textContent = "Participant";
    }

    if (waitingParticipant) {
        waitingParticipant.style.display = "block";
    }

    hideLegacyRemoteCard();
    clearRemoteTiles();
    clearLocalCanvas();

    updateParticipantCount();
    updateCanvasAvailability();
    renderDrawingPermissions();
}

async function createMeeting() {
    if (meetingActive) return;

    userName =
        (userNameInput?.value || "").trim().slice(0, 30) || "Participant";

    localStorage.setItem("airCanvasUserName", userName);
    updateLocalUI();

    try {
        isMeetingCreator = true;
        canvasEnabled = true;

        if (!isCameraStarted) {
            await startLocalMedia();
        }

        meetingId = generateMeetingId();
        meetingActive = true;

        setupMeetingUI();

        await connectWebSocket();
        await connectLiveKit();

        isMeetingCreator = true;
        canvasEnabled = true;
        updateCanvasAvailability();

        if (!mediaPipeStarted) initMediaPipe();

        console.log("🎉 Meeting created:", meetingId);
    } catch (error) {
        console.error("❌ Could not create meeting:", error);

        meetingActive = false;
        await cleanupMeeting(false);
        showHome();

        alert(
            "Could not create the meeting. Check the browser console."
        );
    }
}

async function joinMeeting() {
    if (meetingActive) return;

    userName =
        (userNameInput?.value || "").trim().slice(0, 30) || "Participant";

    localStorage.setItem("airCanvasUserName", userName);

    meetingId = normalizeMeetingId(meetingIdInput?.value);

    if (!meetingId) {
        alert("Please enter the Meeting ID.");
        return;
    }

    isMeetingCreator = false;

    try {
        if (!isCameraStarted) {
            await startLocalMedia();
        }

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

        alert(
            "Could not join the meeting. Check the Meeting ID and browser console."
        );
    }
}

// ============================================================
// CONTROLS
// ============================================================

async function toggleMute() {
    if (!localStream) return;

    isMuted = !isMuted;

    localStream
        .getAudioTracks()
        .forEach((track) => (track.enabled = !isMuted));

    if (liveKitRoom?.localParticipant) {
        try {
            await liveKitRoom.localParticipant.setMicrophoneEnabled(!isMuted);
        } catch (error) {
            console.warn("⚠️ LiveKit microphone toggle:", error);
        }
    }

    if (muteButton) {
        muteButton.textContent = isMuted ? "🔇 Muted" : "🎤 Mic";
        muteButton.classList.toggle("muted", isMuted);
    }
}

async function toggleCamera() {
    if (!localStream) return;

    isCameraOff = !isCameraOff;

    localStream
        .getVideoTracks()
        .forEach((track) => (track.enabled = !isCameraOff));

    if (liveKitRoom?.localParticipant) {
        try {
            await liveKitRoom.localParticipant.setCameraEnabled(!isCameraOff);
        } catch (error) {
            console.warn("⚠️ LiveKit camera toggle:", error);
        }
    }

    if (cameraButton) {
        cameraButton.textContent = isCameraOff
            ? "🚫 Camera Off"
            : "📹 Camera";
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
    } catch (error) {
        console.error("❌ Clipboard error:", error);
    }
}

function clearCanvasButtonAction() {
    clearMyCanvasAndBroadcast();
}

async function cleanupMeeting(stopCameraToo = true) {
    meetingActive = false;

    disconnectLiveKit();
    liveKitDataReady = false;

    disconnectWebSocket();

    clearRemoteTiles();
    clearLocalCanvas();
    clearCanvasElement(landmarkCanvas);

    if (stopCameraToo) stopLocalMedia();

    meetingId = null;
    isMeetingCreator = false;
    canvasEnabled = false;

    if (drawingPermissionsPanel) {
        drawingPermissionsPanel.remove();
        drawingPermissionsPanel = null;
    }

    participantInfo.clear();
    userIdToLiveKitIdentity.clear();
    liveKitIdentityToUserId.clear();

    activeGesture = "no_gesture";
    activeConfidence = 0;

    resetDrawingState();

    updateGestureDisplay("no_gesture", 0);
    updateParticipantCount();

    if (meetingIdInput) meetingIdInput.value = "";
    if (meetingIdLarge) meetingIdLarge.textContent = "------";
    if (meetingIdDisplay) {
        meetingIdDisplay.textContent = "Meeting ID: ------";
    }

    if (muteButton) {
        muteButton.textContent = "🎤 Mic";
        muteButton.classList.remove("muted");
    }

    if (cameraButton) {
        cameraButton.textContent = "📹 Camera";
        cameraButton.classList.remove("camera-off");
    }

    if (leaveMeetingBtn) leaveMeetingBtn.disabled = true;
}

async function leaveMeeting() {
    if (!meetingActive) return;

    sendWS({
        type: "leave_meeting",
        meeting_id: meetingId,
        user_id: userId,
        user_name: userName,
        livekit_identity: liveKitIdentity
    });

    await cleanupMeeting(true);
    showHome();

    if (homeStartCamera) {
        homeStartCamera.textContent = "🎥 Start Camera";
        homeStartCamera.disabled = false;
    }

    if (startCameraBtn) {
        startCameraBtn.textContent = "Start Camera";
        startCameraBtn.disabled = false;
    }

    if (cameraStatus) {
        cameraStatus.textContent = "Camera is off";
        cameraStatus.style.color = "";
    }
}

// ============================================================
// BUTTONS
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

meetingIdInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") joinMeeting();
});

window.addEventListener("resize", setupCanvasSizes);

window.addEventListener("beforeunload", () => {
    try {
        ws?.close();
    } catch (_) {}
    try {
        liveKitRoom?.disconnect();
    } catch (_) {}
    try {
        localStream?.getTracks().forEach((track) => track.stop());
    } catch (_) {}
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

    if (meetingScreen) {
        meetingScreen.classList.add("hidden");
    }
    if (homeScreen) {
        homeScreen.classList.remove("hidden");
    }

    // ----------------------------------------------------------
    // FIXED: Re-run canvas sizing whenever the local video
    // container is resized. This handles:
    //   - window resize
    //   - grid re-layout when a participant joins or leaves
    //   - any other layout shift
    // Without this, landmarkCanvas/airCanvas buffers keep their
    // pre-join dimensions and drawing positions become wrong.
    // ----------------------------------------------------------
    if (
        typeof ResizeObserver !== "undefined" &&
        video &&
        video.parentElement
    ) {
        const localCanvasResizeObserver = new ResizeObserver(() => {
            setupCanvasSizes();
        });

        localCanvasResizeObserver.observe(video.parentElement);
    }

    console.log("🚀 Air Canvas initialized.");
}

if (document.readyState === "loading") {
    document.addEventListener(
        "DOMContentLoaded",
        initializeApplication,
        { once: true }
    );
} else {
    initializeApplication();
}

console.log("🚀 Air Canvas app.js loaded.");