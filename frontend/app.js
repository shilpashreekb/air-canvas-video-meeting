// ============================================================
// AIR CANVAS - VIDEO MEETING
// ============================================================

"use strict";

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

const MAX_PARTICIPANTS = 100;
const MAX_GUEST_DRAWERS = 3;

const PREDICTION_INTERVAL_MS = 80;
const DRAW_SEND_INTERVAL_MS = 30;
const CLEAR_COOLDOWN_MS = 700;
const DRAWING_HISTORY_CHUNK_SIZE = 30;

const REACTION_OPTIONS = ["👍", "👏", "😂", "😮", "❤️", "🎉"];
const NOTIFICATION_LIFETIME_MS = 3000;

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
// connectionStatus element was removed from the visible header.
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
let drawingPermissionRequested = false;
const drawingPermissionRequests = new Set();

let isCameraStarted = false;
let isMuted = false;
let isCameraOff = false;

let liveKitIdentity =
    "aircanvas-" + Math.random().toString(36).substring(2, 10);

let currentTheme = localStorage.getItem("airCanvasTheme") || "light";

const raisedHands = new Set();
let isScreenSharing = false;
let screenShareStream = null;
let screenShareTrack = null;

let pinnedIdentity = null;
let currentPage = 1;

let hands = null;
let camera = null;
let mediaPipeStarted = false;

let activeGesture = "no_gesture";
let activeConfidence = 0;
let predictionInProgress = false;
let pendingLandmarks = null;
let lastPredictionTime = 0;
let lastClearTime = 0;

let isDrawing = false;
let lastDrawX = 0;
let lastDrawY = 0;
let smoothDrawX = null;
let smoothDrawY = null;
let lastDrawSendTime = 0;
let lastSentDrawX = null;
let lastSentDrawY = null;
let localDrawingHistory = [];

let drawingToolEnabled = false;
let drawingColor = "#00ff00";
let drawingThickness = 3;
let eraserSize = 20;

const remoteParticipants = new Map();
const userIdToLiveKitIdentity = new Map();
const liveKitIdentityToUserId = new Map();
const participantInfo = new Map();
const pendingRemoteDrawingHistory = new Map();

function generateUserId() {
    return "user-" + Date.now().toString(36) + "-" +
        Math.random().toString(36).substring(2, 8);
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
    if (connectionStatus) connectionStatus.textContent = `Backend: ${text}`;
}

function updateParticipantCount() {
    const count = 1 + remoteParticipants.size;
    if (participantCount) participantCount.textContent = String(count);
    const panelCount = document.getElementById("participantsPanelCount");
    if (panelCount) {
        panelCount.textContent =
            `${count} participant${count === 1 ? "" : "s"}`;
    }
    renderParticipantsList();
    applyPagination();
}

function getInitials(name) {
    const value = String(name || "Participant").trim();
    if (!value) return "P";
    return value.split(/\s+/).slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase()).join("") || "P";
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
    message.className = "chat-message" +
        (senderId && senderId === String(userId) ? " mine" : "");

    const meta = document.createElement("div");
    meta.className = "chat-message-meta";

    const name = document.createElement("span");
    name.className = "chat-message-name";
    name.textContent = senderId && senderId === String(userId)
        ? "You" : senderName;

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
        if (senderId) {
            showMeetingNotification(`${senderName}: ${text}`);
        }
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
        reliable: true, topic: "aircanvas-control"
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

        let isHandRaised;
        if (info.isLocal) {
            isHandRaised = raisedHands.has(String(liveKitIdentity));
        } else {
            isHandRaised = raisedHands.has(
                String(info.livekitIdentity || id)
            );
        }

        const name = document.createElement("div");
        name.className = "participant-list-name";
        name.textContent = info.isLocal
            ? `${info.name || "You"} (You)`
            : info.name || "Participant";
        if (isHandRaised) {
            const hand = document.createElement("span");
            hand.className = "participant-list-hand";
            hand.textContent = " ✋";
            name.appendChild(hand);
        }

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
    if (participantCount) {
        participantCount.textContent = String(
            Math.max(count, 1 + remoteParticipants.size)
        );
    }
    if (participantsPanelCount) {
        const displayCount = Math.max(count, 1 + remoteParticipants.size);
        participantsPanelCount.textContent =
            `${displayCount} participant${displayCount === 1 ? "" : "s"}`;
    }
}

// ============================================================
// UI HELPERS
// ============================================================

function updateLocalUI() {
    if (localParticipantLabel) {
        const raised = raisedHands.has(liveKitIdentity);
        localParticipantLabel.textContent =
            (userName || "You") + (raised ? " ✋" : "");
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
// PAGINATION (max 4 desktop / 2 mobile; 3-in-strip when pinned)
// ============================================================

function getPerPage() {
    return window.innerWidth <= 640 ? 2 : 4;
}

function isMobileView() {
    return window.innerWidth <= 640;
}

function updatePaginationUI(page, totalPages) {
    const bar = document.getElementById("paginationBar");
    if (!bar) return;

    if (totalPages <= 1) {
        bar.classList.add("hidden");
        return;
    }
    bar.classList.remove("hidden");

    const indicator = document.getElementById("pageIndicator");
    if (indicator) indicator.textContent = `${page} / ${totalPages}`;

    const prev = document.getElementById("prevPageBtn");
    const next = document.getElementById("nextPageBtn");
    if (prev) prev.disabled = page <= 1;
    if (next) next.disabled = page >= totalPages;
}

function applyPagination() {
    if (!participantsGrid) return;

    const allCards = [...participantsGrid.querySelectorAll(".participant-card")];

    // ---------- PINNED MODE ----------
    if (pinnedIdentity) {
        const pinnedCard = allCards.find(
            (c) => String(c.dataset.identity || "") === pinnedIdentity
        );

        if (!pinnedCard) {
            // Pinned card gone: fall back to normal layout
            pinnedIdentity = null;
            participantsGrid.classList.remove("has-pinned");
            return applyPagination();
        }

        // Pinned card is never hidden by pagination.
        pinnedCard.classList.remove("page-hidden");
        pinnedCard.classList.remove("grid-span-2");
        allCards.forEach((c) => c.classList.remove("grid-span-2"));

        if (isMobileView()) {
            // Mobile pinned: only the pinned card is fully visible;
            // the local card (if not the pinned one) becomes a
            // floating self-view thumbnail via CSS.
            allCards.forEach((c) => {
                if (c === pinnedCard) {
                    c.classList.remove("page-hidden");
                } else if (c.dataset.identity === "local") {
                    c.classList.remove("page-hidden"); // shown as thumb
                } else {
                    c.classList.add("page-hidden");
                }
            });
            // No pagination while pinned on mobile.
            const bar = document.getElementById("paginationBar");
            if (bar) bar.classList.add("hidden");
        } else {
            // Desktop pinned: paginate the NON-pinned cards in the strip,
            // 3 per page (one page = 1 pinned + 3 strip = 4 visible).
            const others = allCards.filter((c) => c !== pinnedCard);
            const perPage = 3;
            const totalPages = Math.max(1, Math.ceil(others.length / perPage));

            if (currentPage > totalPages) currentPage = totalPages;
            if (currentPage < 1) currentPage = 1;

            const start = (currentPage - 1) * perPage;
            const end = start + perPage;

            others.forEach((card, i) => {
                const visible = i >= start && i < end;
                card.classList.toggle("page-hidden", !visible);
            });

            updatePaginationUI(currentPage, totalPages);
        }

        participantsGrid.setAttribute("data-count", "pinned");

        requestAnimationFrame(() => {
            try { setupCanvasSizes(); } catch (_) {}
        });
        return;
    }

    // ---------- NORMAL MODE (nothing pinned) ----------
    const perPage = getPerPage();
    const totalPages = Math.max(1, Math.ceil(allCards.length / perPage));

    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const start = (currentPage - 1) * perPage;
    const end = start + perPage;

    allCards.forEach((card, i) => {
        const visible = i >= start && i < end;
        card.classList.toggle("page-hidden", !visible);
    });

    const visibleCount = Math.min(perPage, Math.max(0, allCards.length - start));

    allCards.forEach((c) => c.classList.remove("grid-span-2"));

    // Desktop 3-tile case: last visible card spans full width on the bottom row.
    const isDesktop = window.innerWidth > 640;
    if (isDesktop && visibleCount === 3) {
        const visible = allCards.slice(start, end);
        if (visible[2]) visible[2].classList.add("grid-span-2");
    }

    participantsGrid.setAttribute("data-count", String(visibleCount));

    updatePaginationUI(currentPage, totalPages);

    requestAnimationFrame(() => {
        try { setupCanvasSizes(); } catch (_) {}
    });
}

function goToPage(page) {
    const cards = participantsGrid
        ? [...participantsGrid.querySelectorAll(".participant-card")].length
        : 0;

    let perPage;
    if (pinnedIdentity) {
        perPage = 3; // desktop pinned strip size
    } else {
        perPage = getPerPage();
    }

    const totalPages = Math.max(1, Math.ceil(cards / perPage));
    currentPage = clamp(Number(page) || 1, 1, totalPages);
    applyPagination();
}

function initPaginationControls() {
    const prev = document.getElementById("prevPageBtn");
    const next = document.getElementById("nextPageBtn");

    if (prev && !prev.dataset.wired) {
        prev.dataset.wired = "true";
        prev.addEventListener("click", (ev) => {
            ev.stopPropagation();
            goToPage(currentPage - 1);
        });
    }
    if (next && !next.dataset.wired) {
        next.dataset.wired = "true";
        next.addEventListener("click", (ev) => {
            ev.stopPropagation();
            goToPage(currentPage + 1);
        });
    }

    applyPagination();
}


// ============================================================
// THEME
// ============================================================

function applyTheme(theme) {
    const t = (theme === "dark") ? "dark" : "light";
    currentTheme = t;
    document.body.setAttribute("data-theme", t);
    try { localStorage.setItem("airCanvasTheme", t); } catch (_) {}

    document.querySelectorAll(".theme-toggle-btn").forEach((btn) => {
        btn.textContent = t === "dark" ? "☀️" : "🌙";
        btn.title = t === "dark" ? "Switch to light theme"
                                 : "Switch to dark theme";
        btn.setAttribute(
            "aria-label",
            t === "dark" ? "Switch to light theme" : "Switch to dark theme"
        );
    });
}

function toggleTheme() {
    applyTheme(currentTheme === "dark" ? "light" : "dark");
}

function initTheme() {
    applyTheme(currentTheme);
    document.querySelectorAll(".theme-toggle-btn").forEach((btn) => {
        if (btn.dataset.wired) return;
        btn.dataset.wired = "true";
        btn.addEventListener("click", toggleTheme);
    });
}


// ============================================================
// HOST-ONLY CONTROLS
// ============================================================

function updateHostOnlyControls() {
    const endBtn = document.getElementById("endMeetingButton");
    if (endBtn) {
        endBtn.classList.toggle("hidden-control", !isMeetingCreator);
    }
    const permBtn = document.getElementById("drawingPermissionsButton");
    if (permBtn) {
        permBtn.classList.toggle("hidden-control", !isMeetingCreator);
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
// FEATURE STYLES
// ============================================================

function ensureFeatureStyles() {
    if (document.getElementById("airCanvasFeatureStyles")) return;

    const style = document.createElement("style");
    style.id = "airCanvasFeatureStyles";
    style.textContent = `
        .meeting-notifications {
            position: fixed;
            top: 14%;
            left: 50%;
            transform: translateX(-50%);
            z-index: 9999;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
            pointer-events: none;
            max-width: 92vw;
        }
        .meeting-notification {
            background: var(--surface);
            color: var(--text);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 12px 22px;
            font-size: 14px;
            font-weight: 600;
            line-height: 1.4;
            box-shadow: var(--shadow);
            opacity: 0;
            transform: translateY(-10px);
            transition: opacity 0.28s ease, transform 0.28s ease;
            pointer-events: auto;
            max-width: 440px;
            word-break: break-word;
            text-align: center;
        }
        .meeting-notification.visible {
            opacity: 1;
            transform: translateY(0);
        }
        .meeting-notification.leaving {
            opacity: 0;
            transform: translateY(-10px);
        }

        .reactions-menu {
            position: fixed;
            z-index: 9998;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 8px;
            display: grid;
            grid-template-columns: repeat(6, 44px);
            gap: 4px;
            box-shadow: var(--shadow);
        }
        .reactions-menu.hidden { display: none !important; }

        .reaction-option {
            width: 44px;
            height: 44px;
            border: 0;
            border-radius: 10px;
            background: transparent;
            font-size: 22px;
            cursor: pointer;
            transition: background 0.15s ease, transform 0.15s ease;
        }
        .reaction-option:hover {
            background: var(--accent-light);
            transform: scale(1.08);
        }

        .reactions-menu .reaction-sep {
            grid-column: 1 / -1;
            height: 1px;
            background: var(--border);
            margin: 4px 2px;
        }
        .reactions-menu .reaction-hand {
            grid-column: 1 / -1;
            width: 100%;
            height: 40px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            background: var(--surface-2);
            border: 1px solid var(--border);
            font-size: 0.85rem;
            font-weight: 600;
            color: var(--text);
            border-radius: 8px;
            cursor: pointer;
            transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
        }
        .reactions-menu .reaction-hand::before {
            content: "✋";
            font-size: 1.05rem;
        }
        .reactions-menu .reaction-hand:hover {
            background: var(--accent-light);
            color: var(--accent);
        }
        .reactions-menu .reaction-hand.active {
            background: var(--accent-light);
            border-color: var(--accent);
            color: var(--accent);
        }
        .reactions-menu .reaction-hand.active::before {
            content: "🖐️";
        }

        .reaction-bubble {
            position: absolute;
            bottom: 12px;
            right: 12px;
            font-size: 40px;
            z-index: 30;
            pointer-events: none;
            opacity: 0;
            transform: translateY(10px) scale(0.9);
            transition: opacity 0.3s ease, transform 0.3s ease;
            filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.4));
        }
        .reaction-bubble.visible {
            opacity: 1;
            transform: translateY(0) scale(1);
        }
        .reaction-bubble.leaving {
            opacity: 0;
            transform: translateY(-20px) scale(1.15);
        }

        .remote-video-container .remote-screenshare-video {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            object-fit: contain;
            background: #000;
            z-index: 4;
            display: none;
            transform: none !important;
        }

        .participant-list-hand {
            margin-left: 6px;
            font-size: 0.85rem;
            display: inline-block;
        }

        .toolbar-btn.sharing {
            background: var(--accent-light) !important;
            border-color: var(--accent) !important;
            color: var(--accent) !important;
        }

        .participant-card .card-controls {
            position: absolute;
            top: 8px;
            right: 8px;
            display: flex;
            gap: 5px;
            z-index: 25;
            opacity: 0;
            transition: opacity 0.18s ease;
            pointer-events: none;
        }
        .participant-card:hover .card-controls,
        .participant-card:fullscreen .card-controls,
        .participant-card:-webkit-full-screen .card-controls,
        .participant-card.fit-active .card-controls {
            opacity: 1;
            pointer-events: auto;
        }
        .card-control-btn {
            width: 30px;
            height: 30px;
            border: 1px solid rgba(255, 255, 255, 0.18);
            border-radius: 6px;
            background: rgba(15, 20, 25, 0.78);
            color: #f1f2f3;
            font-size: 14px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            line-height: 1;
            transition: background 0.15s ease, border-color 0.15s ease;
        }
        .card-control-btn:hover {
            background: var(--accent);
            border-color: var(--accent);
            color: #fff;
        }

        .participants-grid.has-pinned .pinned-card .card-controls {
            opacity: 1 !important;
            pointer-events: auto !important;
        }

        .participant-card:fullscreen,
        .participant-card:-webkit-full-screen {
            width: 100vw;
            height: 100vh;
            border-radius: 0;
            border: 0;
            background: #000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            margin: 0;
        }
        .participant-card:fullscreen .video-container,
        .participant-card:fullscreen .remote-video-container,
        .participant-card:-webkit-full-screen .video-container,
        .participant-card:-webkit-full-screen .remote-video-container {
            width: 100%;
            height: 100%;
            aspect-ratio: auto;
        }
        .participant-card:fullscreen video,
        .participant-card:-webkit-full-screen video {
            object-fit: contain !important;
        }
        .participant-card:fullscreen .participant-label,
        .participant-card:-webkit-full-screen .participant-label {
            bottom: 20px;
            left: 20px;
            font-size: 0.9rem;
            padding: 7px 12px;
        }
        .participant-card:fullscreen .card-controls,
        .participant-card:-webkit-full-screen .card-controls {
            top: 20px;
            right: 20px;
        }
    `;
    document.head.appendChild(style);
}

function ensureNotificationsContainer() {
    let container = document.getElementById("meetingNotifications");
    if (!container) {
        container = document.createElement("div");
        container.id = "meetingNotifications";
        container.className = "meeting-notifications";
        document.body.appendChild(container);
    }
    return container;
}

function showMeetingNotification(text, opts = {}) {
    if (!text) return;
    const container = ensureNotificationsContainer();
    const toast = document.createElement("div");
    toast.className = "meeting-notification";
    toast.textContent = String(text);

    if (opts.tone === "warning") {
        toast.style.borderColor = "#f0b45a";
    }

    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("visible"));

    const lifetime = typeof opts.duration === "number"
        ? opts.duration : NOTIFICATION_LIFETIME_MS;

    setTimeout(() => {
        toast.classList.remove("visible");
        toast.classList.add("leaving");
        setTimeout(() => {
            try { toast.remove(); } catch (_) {}
        }, 320);
    }, lifetime);
}

// ---------- REACTIONS MENU ----------

function ensureReactionsMenu() {
    let menu = document.getElementById("reactionsMenu");
    if (menu) return menu;

    menu = document.createElement("div");
    menu.id = "reactionsMenu";
    menu.className = "reactions-menu hidden";

    REACTION_OPTIONS.forEach((emoji) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "reaction-option";
        btn.textContent = emoji;
        btn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            sendReaction(emoji);
            toggleReactionsMenu(false);
        });
        menu.appendChild(btn);
    });

    const sep = document.createElement("div");
    sep.className = "reaction-sep";
    menu.appendChild(sep);

    const handBtn = document.createElement("button");
    handBtn.id = "reactionHandButton";
    handBtn.type = "button";
    handBtn.className = "reaction-hand";
    handBtn.textContent = "Raise Hand";
    handBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        toggleRaiseHand();
        toggleReactionsMenu(false);
    });
    menu.appendChild(handBtn);

    document.body.appendChild(menu);
    return menu;
}

function updateReactionsHandButton() {
    const btn = document.getElementById("reactionHandButton");
    if (!btn) return;
    const raised = raisedHands.has(liveKitIdentity);
    btn.classList.toggle("active", raised);
    btn.textContent = raised ? "Lower Hand" : "Raise Hand";
}

function positionReactionsMenu(menu) {
    const btn = document.getElementById("reactionsButton");
    if (!btn || !menu) return;
    const rect = btn.getBoundingClientRect();
    const menuWidth = menu.offsetWidth || (6 * 44 + 20);
    const left = Math.min(
        Math.max(8, rect.left + rect.width / 2 - menuWidth / 2),
        window.innerWidth - menuWidth - 8
    );
    menu.style.left = `${left}px`;
    menu.style.bottom = `${window.innerHeight - rect.top + 8}px`;
    menu.style.top = "";
}

function toggleReactionsMenu(force) {
    const menu = ensureReactionsMenu();
    const shouldShow = typeof force === "boolean"
        ? force : menu.classList.contains("hidden");
    menu.classList.toggle("hidden", !shouldShow);
    if (shouldShow) {
        updateReactionsHandButton();
        positionReactionsMenu(menu);
    }
}

function ensureExtraControls() {
    const group = document.querySelector(".toolbar-center");
    if (!group) return;

    const reactBtn = document.getElementById("reactionsButton");
    if (reactBtn && !reactBtn.dataset.wired) {
        reactBtn.dataset.wired = "true";
        reactBtn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            toggleReactionsMenu();
        });
    }

    const shareBtn = document.getElementById("screenShareButton");
    if (shareBtn && !shareBtn.dataset.wired) {
        shareBtn.dataset.wired = "true";
        shareBtn.addEventListener("click", toggleScreenShare);
    }

    if (!window.__airCanvasOutsideClickBound) {
        window.__airCanvasOutsideClickBound = true;
        document.addEventListener("click", (ev) => {
            const menu = document.getElementById("reactionsMenu");
            if (!menu || menu.classList.contains("hidden")) return;
            if (menu.contains(ev.target)) return;
            if (ev.target.closest && ev.target.closest("#reactionsButton")) return;
            toggleReactionsMenu(false);
        });
    }
}

// ============================================================
// MORE MENU
// ============================================================

function positionMoreMenu() {
    const menu = document.getElementById("moreMenu");
    const btn = document.getElementById("moreButton");
    if (!menu || !btn) return;
    const rect = btn.getBoundingClientRect();
    const menuWidth = menu.offsetWidth || 240;
    const left = Math.min(
        Math.max(8, rect.left + rect.width / 2 - menuWidth / 2),
        window.innerWidth - menuWidth - 8
    );
    menu.style.left = `${left}px`;
    menu.style.bottom = `${window.innerHeight - rect.top + 8}px`;
    menu.style.top = "";
}

function toggleMoreMenu(force) {
    const menu = document.getElementById("moreMenu");
    if (!menu) return;
    const shouldShow = typeof force === "boolean"
        ? force : menu.classList.contains("hidden");
    menu.classList.toggle("hidden", !shouldShow);
    if (shouldShow) positionMoreMenu();
}

function handleMoreMenuAction(action) {
    switch (action) {
        case "clear-canvas":
            clearCanvasButtonAction();
            break;
        case "copy-id":
            copyMeetingIdToClipboard();
            break;
        default:
            break;
    }
}

function initMoreMenu() {
    const btn = document.getElementById("moreButton");
    const menu = document.getElementById("moreMenu");
    if (!btn || !menu) return;
    if (btn.dataset.wired) {
        positionMoreMenu();
        return;
    }
    btn.dataset.wired = "true";

    btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        toggleMoreMenu();
    });

    menu.addEventListener("click", (ev) => {
        const item = ev.target.closest(".more-menu-item");
        if (!item) return;
        handleMoreMenuAction(item.dataset.action);
        toggleMoreMenu(false);
    });

    if (!window.__airCanvasMoreOutsideClickBound) {
        window.__airCanvasMoreOutsideClickBound = true;
        document.addEventListener("click", (ev) => {
            const m = document.getElementById("moreMenu");
            if (!m || m.classList.contains("hidden")) return;
            if (m.contains(ev.target)) return;
            if (ev.target.closest && ev.target.closest("#moreButton")) return;
            toggleMoreMenu(false);
        });
    }
}

// ============================================================
// DRAWING TOOL CONTROLS
// ============================================================

function applyDrawingControlUI() {
    const onOffBtn = document.getElementById("drawOnOff");
    if (onOffBtn) {
        onOffBtn.classList.toggle("on", drawingToolEnabled);
        onOffBtn.setAttribute(
            "aria-pressed", drawingToolEnabled ? "true" : "false"
        );
        const t = onOffBtn.querySelector(".switch-text");
        if (t) t.textContent = drawingToolEnabled ? "ON" : "OFF";
    }

    document.querySelectorAll("#colorSwatches .color-swatch")
        .forEach((swatch) => {
            swatch.classList.toggle(
                "active",
                String(swatch.dataset.color || "").toLowerCase() ===
                    String(drawingColor).toLowerCase()
            );
        });

    document.querySelectorAll("#sizeOptions .size-option")
        .forEach((option) => {
            option.classList.toggle(
                "active",
                Number(option.dataset.size) === Number(drawingThickness)
            );
        });

    const toggleBtn = document.getElementById("drawToggleButton");
    if (toggleBtn) toggleBtn.classList.toggle("active", drawingToolEnabled);
}

function setDrawToolEnabled(enabled) {
    drawingToolEnabled = Boolean(enabled);
    if (!drawingToolEnabled) resetDrawingState();
    applyDrawingControlUI();
}

function setDrawingColor(color) {
    if (typeof color === "string" && color) drawingColor = color;
    applyDrawingControlUI();
}

function setDrawingThickness(size) {
    const value = Number(size);
    if (Number.isFinite(value) && value > 0) drawingThickness = value;
    applyDrawingControlUI();
}

function toggleDrawPanel(force) {
    const panel = document.getElementById("drawPanel");
    if (!panel) return;
    const shouldShow = typeof force === "boolean"
        ? force : panel.classList.contains("hidden");
    panel.classList.toggle("hidden", !shouldShow);
}

function closeDrawPanel() {
    const panel = document.getElementById("drawPanel");
    if (panel) panel.classList.add("hidden");
}

function initDrawingControls() {
    const panel = document.getElementById("drawPanel");
    const toggleBtn = document.getElementById("drawToggleButton");
    if (!panel || !toggleBtn) return;
    if (panel.dataset.wired === "true") {
        applyDrawingControlUI();
        return;
    }
    panel.dataset.wired = "true";

    toggleBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        const canDraw = isMeetingCreator || canvasEnabled;
        if (canDraw) toggleDrawPanel();
        else requestDrawingPermission();
    });

    document.getElementById("drawPanelClose")
        ?.addEventListener("click", closeDrawPanel);

    document.getElementById("drawOnOff")
        ?.addEventListener("click", () => {
            setDrawToolEnabled(!drawingToolEnabled);
        });

    const eraserRange = document.getElementById("eraserSizeRange");
    if (eraserRange) {
        eraserRange.value = String(eraserSize);
        eraserRange.addEventListener("input", () => {
            eraserSize = clamp(Number(eraserRange.value) || 20, 8, 80);
        });
    }

    document.querySelectorAll("#colorSwatches .color-swatch")
        .forEach((swatch) => {
            swatch.addEventListener("click", () => {
                setDrawingColor(swatch.dataset.color || "#00ff00");
            });
        });

    document.querySelectorAll("#sizeOptions .size-option")
        .forEach((option) => {
            option.addEventListener("click", () => {
                setDrawingThickness(Number(option.dataset.size) || 3);
            });
        });

    document.getElementById("drawPanelClear")
        ?.addEventListener("click", () => {
            clearCanvasButtonAction();
        });

    if (!window.__airCanvasDrawOutsideClickBound) {
        window.__airCanvasDrawOutsideClickBound = true;
        document.addEventListener("click", (event) => {
            const p = document.getElementById("drawPanel");
            if (!p || p.classList.contains("hidden")) return;
            if (p.contains(event.target)) return;
            if (event.target.closest &&
                event.target.closest("#drawToggleButton")) return;
            closeDrawPanel();
        });
    }

    applyDrawingControlUI();
}

// ============================================================
// DRAWING PERMISSION REQUEST FLOW
// ============================================================

function requestDrawingPermission() {
    if (isMeetingCreator || canvasEnabled) return;
    if (drawingPermissionRequested) {
        showMeetingNotification("✋ Request already sent to the host");
        return;
    }
    sendWS({
        type: "request_drawing",
        meeting_id: meetingId,
        user_id: userId,
        user_name: userName,
        livekit_identity: liveKitIdentity
    });
    drawingPermissionRequested = true;
    showMeetingNotification("✋ Drawing permission requested");
    updateRequestDrawUI();
}

function updateRequestDrawUI() {
    const fab = document.getElementById("drawToggleButton");
    if (!fab) return;
    const canDraw = isMeetingCreator || canvasEnabled;
    const icon = fab.querySelector(".draw-fab-icon");

    fab.classList.remove("fab-canvas", "fab-request", "fab-pending");

    if (canDraw) {
        fab.classList.add("fab-canvas");
        fab.title = "Air Canvas";
        fab.setAttribute("aria-label", "Open Air Canvas drawing tools");
        if (icon) icon.textContent = "🎨";
    } else if (drawingPermissionRequested) {
        fab.classList.add("fab-pending");
        fab.title = "Waiting for host approval";
        fab.setAttribute("aria-label", "Waiting for host approval");
        if (icon) icon.textContent = "⏳";
    } else {
        fab.classList.add("fab-request");
        fab.title = "Request drawing permission";
        fab.setAttribute("aria-label", "Request to draw");
        if (icon) icon.textContent = "✋";
    }
}

// ============================================================
// DRAWING PERMISSIONS POPOVER (HOST ONLY)
// ============================================================

function positionDrawingPermissionsPopover() {
    const pop = document.getElementById("drawingPermissionsPopover");
    const btn = document.getElementById("drawingPermissionsButton");
    if (!pop || !btn) return;
    const rect = btn.getBoundingClientRect();
    const popW = pop.offsetWidth || 320;
    const left = Math.min(
        Math.max(8, rect.left + rect.width / 2 - popW / 2),
        window.innerWidth - popW - 8
    );
    pop.style.left = `${left}px`;
    pop.style.bottom = `${window.innerHeight - rect.top + 8}px`;
    pop.style.top = "";
}

function toggleDrawingPermissionsPopover(force) {
    const pop = document.getElementById("drawingPermissionsPopover");
    if (!pop) return;
    const shouldShow = typeof force === "boolean"
        ? force : pop.classList.contains("hidden");
    pop.classList.toggle("hidden", !shouldShow);
    if (shouldShow) {
        renderDrawingPermissions();
        positionDrawingPermissionsPopover();
    }
}

function initDrawingPermissionsPopover() {
    const btn = document.getElementById("drawingPermissionsButton");
    const pop = document.getElementById("drawingPermissionsPopover");
    if (!btn || !pop) return;
    if (btn.dataset.wired) return;
    btn.dataset.wired = "true";

    btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        toggleDrawingPermissionsPopover();
    });

    document.getElementById("drawingPermissionsClose")
        ?.addEventListener("click", () => {
            toggleDrawingPermissionsPopover(false);
        });

    if (!window.__airCanvasPermsOutsideClickBound) {
        window.__airCanvasPermsOutsideClickBound = true;
        document.addEventListener("click", (ev) => {
            const p = document.getElementById("drawingPermissionsPopover");
            if (!p || p.classList.contains("hidden")) return;
            if (p.contains(ev.target)) return;
            if (ev.target.closest &&
                ev.target.closest("#drawingPermissionsButton")) return;
            toggleDrawingPermissionsPopover(false);
        });
    }
}

function renderDrawingPermissions() {
    const content = document.getElementById("drawingPermissionsContent");
    if (!content) return;

    const hostBtn = document.getElementById("drawingPermissionsButton");
    if (hostBtn) {
        hostBtn.classList.toggle("hidden-control", !isMeetingCreator);
    }

    if (!isMeetingCreator) {
        content.innerHTML = "";
        return;
    }

    content.innerHTML = "";

    const guests = [...participantInfo.entries()].filter(
        ([, info]) => !info.isCreator
    );

    const approvedGuests = guests.filter(([, info]) =>
        Boolean(info.canvasEnabled)
    );
    const requestGuests = guests.filter(([id]) =>
        drawingPermissionRequests.has(String(id))
    );

    const reqTitle = document.createElement("div");
    reqTitle.className = "perm-section-title";
    reqTitle.textContent = `Requests (${requestGuests.length})`;
    content.appendChild(reqTitle);

    if (!requestGuests.length) {
        const empty = document.createElement("div");
        empty.className = "perm-empty";
        empty.textContent = "No pending requests";
        content.appendChild(empty);
    } else {
        requestGuests.forEach(([id, info]) => {
            const row = document.createElement("div");
            row.className = "perm-row";

            const name = document.createElement("span");
            name.className = "perm-name";
            name.textContent = info.name || "Participant";

            const actions = document.createElement("div");
            actions.className = "perm-actions";

            const approveBtn = document.createElement("button");
            approveBtn.type = "button";
            approveBtn.className = "perm-action perm-action-approve";
            approveBtn.textContent = "Approve";
            approveBtn.disabled = approvedGuests.length >= MAX_GUEST_DRAWERS;
            approveBtn.title = approveBtn.disabled
                ? `Only ${MAX_GUEST_DRAWERS} guest participants can draw at once`
                : "Approve drawing permission";

            const rejectBtn = document.createElement("button");
            rejectBtn.type = "button";
            rejectBtn.className = "perm-action perm-action-reject";
            rejectBtn.textContent = "Reject";
            rejectBtn.title = "Reject this request";

            const targetIdentity = String(
                info.livekitIdentity ||
                    userIdToLiveKitIdentity.get(String(id)) ||
                    id
            );

            approveBtn.addEventListener("click", () => {
                sendWS({
                    type: "grant_drawing",
                    target_user_id: targetIdentity,
                    target_livekit_identity: targetIdentity,
                    target_user_name: info.name || "Participant"
                });
                info.canvasEnabled = true;
                drawingPermissionRequests.delete(String(id));
                participantInfo.set(String(id), info);
                renderDrawingPermissions();
            });

            rejectBtn.addEventListener("click", () => {
                sendWS({
                    type: "drawing_permission_denied",
                    target_user_id: targetIdentity,
                    target_livekit_identity: targetIdentity,
                    target_user_name: info.name || "Participant",
                    message: "Host declined the drawing request."
                });
                drawingPermissionRequests.delete(String(id));
                renderDrawingPermissions();
            });

            actions.append(approveBtn, rejectBtn);
            row.append(name, actions);
            content.appendChild(row);
        });
    }

    const appTitle = document.createElement("div");
    appTitle.className = "perm-section-title";
    appTitle.textContent =
        `Approved (${approvedGuests.length}/${MAX_GUEST_DRAWERS})`;
    content.appendChild(appTitle);

    if (!approvedGuests.length) {
        const empty = document.createElement("div");
        empty.className = "perm-empty";
        empty.textContent = "No guests have drawing permission";
        content.appendChild(empty);
    } else {
        approvedGuests.forEach(([id, info]) => {
            const row = document.createElement("div");
            row.className = "perm-row";

            const name = document.createElement("span");
            name.className = "perm-name";
            name.textContent = info.name || "Participant";

            const actions = document.createElement("div");
            actions.className = "perm-actions";

            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "perm-action perm-action-remove";
            btn.textContent = "Remove";

            const targetIdentity = String(
                info.livekitIdentity ||
                    userIdToLiveKitIdentity.get(String(id)) ||
                    id
            );

            btn.addEventListener("click", () => {
                sendWS({
                    type: "revoke_drawing",
                    target_user_id: targetIdentity,
                    target_livekit_identity: targetIdentity,
                    target_user_name: info.name || "Participant"
                });
                info.canvasEnabled = false;
                drawingPermissionRequests.delete(String(id));
                participantInfo.set(String(id), info);
                renderDrawingPermissions();
            });

            actions.append(btn);
            row.append(name, actions);
            content.appendChild(row);
        });
    }
}

// ============================================================
// PIN / FIT-TO-SCREEN / CARD CONTROLS
// ============================================================

function addCardControls(card, identity) {
    if (!card) return;
    if (card.querySelector(".card-controls")) return;

    const controls = document.createElement("div");
    controls.className = "card-controls";

    const pinBtn = document.createElement("button");
    pinBtn.type = "button";
    pinBtn.className = "card-control-btn pin-btn";
    pinBtn.title = "Pin participant";
    pinBtn.textContent = "📌";
    pinBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        togglePin(identity);
    });

    const fitBtn = document.createElement("button");
    fitBtn.type = "button";
    fitBtn.className = "card-control-btn fit-btn";
    fitBtn.title = "Fit to screen";
    fitBtn.textContent = "⛶";
    fitBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        toggleFullscreen(card);
    });

    const restoreBtn = document.createElement("button");
    restoreBtn.type = "button";
    restoreBtn.className = "card-control-btn restore-btn";
    restoreBtn.title = "Exit fullscreen";
    restoreBtn.textContent = "↙";
    restoreBtn.style.display = "none";
    restoreBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        exitFullscreen();
    });

    controls.append(pinBtn, fitBtn, restoreBtn);
    card.appendChild(controls);
}

function togglePin(identity) {
    const key = String(identity || "");
    if (!key) return;
    if (pinnedIdentity === key) unpinParticipant();
    else pinParticipant(key);
}

function pinParticipant(identity) {
    pinnedIdentity = String(identity || "");
    applyPinState();
}

function unpinParticipant() {
    pinnedIdentity = null;
    applyPinState();
}

function applyPinState() {
    if (!participantsGrid) return;
    const cards = participantsGrid.querySelectorAll(".participant-card");

    // Reset pin chrome on all cards
    cards.forEach((card) => {
        card.classList.remove("pinned-card");
        const pinBtn = card.querySelector(".pin-btn");
        if (pinBtn) {
            pinBtn.textContent = "📌";
            pinBtn.title = "Pin participant";
        }
    });

    if (!pinnedIdentity) {
        participantsGrid.classList.remove("has-pinned");
        applyPagination();
        return;
    }

    let pinnedCard = null;
    cards.forEach((card) => {
        if (String(card.dataset.identity || "") === pinnedIdentity) {
            pinnedCard = card;
        }
    });

    if (pinnedCard) {
        pinnedCard.classList.add("pinned-card");
        pinnedCard.classList.remove("page-hidden");
        pinnedCard.classList.remove("grid-span-2");
        participantsGrid.classList.add("has-pinned");
        const pinBtn = pinnedCard.querySelector(".pin-btn");
        if (pinBtn) {
            pinBtn.textContent = "📍";
            pinBtn.title = "Unpin";
        }
    } else {
        pinnedIdentity = null;
        participantsGrid.classList.remove("has-pinned");
    }

    applyPagination();
    requestAnimationFrame(() => {
        try { setupCanvasSizes(); } catch (_) {}
    });
}

function toggleFullscreen(element) {
    if (!element) return;

    if (element.classList.contains("fit-active")) {
        element.classList.remove("fit-active");
        document.body.classList.remove("has-fit-active");
        updateFitButtonVisibility();
        setTimeout(() => { try { setupCanvasSizes(); } catch (_) {} }, 50);
        return;
    }

    let nativeAttempt = null;
    if (element.requestFullscreen) {
        nativeAttempt = element.requestFullscreen();
    } else if (element.webkitRequestFullscreen) {
        try {
            element.webkitRequestFullscreen();
            setTimeout(updateFitButtonVisibility, 100);
            return;
        } catch (_) { nativeAttempt = Promise.reject(); }
    } else {
        nativeAttempt = Promise.reject();
    }

    Promise.resolve(nativeAttempt)
        .then(() => {
            setTimeout(updateFitButtonVisibility, 100);
        })
        .catch(() => {
            element.classList.add("fit-active");
            document.body.classList.add("has-fit-active");
            updateFitButtonVisibility();
            setTimeout(() => { try { setupCanvasSizes(); } catch (_) {} }, 50);
        });
}

function exitFullscreen() {
    document.querySelectorAll(".participant-card.fit-active").forEach((card) => {
        card.classList.remove("fit-active");
    });
    document.body.classList.remove("has-fit-active");

    const doc = document;
    if (doc.fullscreenElement && doc.exitFullscreen) {
        doc.exitFullscreen().catch(() => {});
    } else if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
    }

    updateFitButtonVisibility();
    setTimeout(() => { try { setupCanvasSizes(); } catch (_) {} }, 50);
}

function updateFitButtonVisibility() {
    const fullEl = document.fullscreenElement || document.webkitFullscreenElement;
    document.querySelectorAll(".participant-card").forEach((card) => {
        const restore = card.querySelector(".restore-btn");
        const fit = card.querySelector(".fit-btn");
        if (!restore || !fit) return;
        const isFit = card.classList.contains("fit-active") || fullEl === card;
        restore.style.display = isFit ? "flex" : "none";
        fit.style.display = isFit ? "none" : "flex";
    });
}

function handleFullscreenChange() {
    updateFitButtonVisibility();
}

function setupLocalCardControls() {
    if (!participantsGrid) return;
    const localCard = participantsGrid
        .querySelector(".participant-card .video-container")
        ?.closest(".participant-card");
    if (!localCard) return;
    if (!localCard.dataset.identity) {
        localCard.dataset.identity = "local";
    }
    addCardControls(localCard, "local");
}

// ============================================================
// HAND RAISE
// ============================================================

function toggleRaiseHand() {
    const currentlyRaised = raisedHands.has(liveKitIdentity);
    const nextRaised = !currentlyRaised;

    if (nextRaised) raisedHands.add(liveKitIdentity);
    else raisedHands.delete(liveKitIdentity);

    updateHandRaiseButton();
    updateReactionsHandButton();
    updateLocalUI();
    renderParticipantsList();

    broadcastRaiseHand(nextRaised);

    showMeetingNotification(
        nextRaised ? "✋ You raised your hand" : "You lowered your hand"
    );
}

function updateHandRaiseButton() {
    const btn = document.getElementById("handRaiseButton");
    if (!btn) return;
    const raised = raisedHands.has(liveKitIdentity);
    btn.classList.toggle("hand-raised", raised);
    const textEl = btn.querySelector(".toolbar-label");
    if (textEl) textEl.textContent = raised ? "Lower" : "Hand";
    const iconEl = btn.querySelector(".toolbar-icon");
    if (iconEl) iconEl.textContent = raised ? "🖐️" : "✋";
}

function broadcastRaiseHand(raised) {
    sendWS({
        type: "raise_hand",
        raised: Boolean(raised),
        user_name: userName,
        livekit_identity: liveKitIdentity
    });
}

// ============================================================
// REACTIONS
// ============================================================

function findTileContainer(identity) {
    const key = String(identity || "");
    if (!key) return null;
    if (key === String(liveKitIdentity)) return video?.parentElement || null;
    const tile = remoteParticipants.get(key);
    return tile?.container || null;
}

function showReactionBubble(identity, emoji) {
    const container = findTileContainer(identity);
    if (!container || !emoji) return;

    const bubble = document.createElement("div");
    bubble.className = "reaction-bubble";
    bubble.textContent = emoji;
    container.appendChild(bubble);

    requestAnimationFrame(() => bubble.classList.add("visible"));

    setTimeout(() => {
        bubble.classList.remove("visible");
        bubble.classList.add("leaving");
        setTimeout(() => {
            try { bubble.remove(); } catch (_) {}
        }, 400);
    }, 2200);
}

function sendReaction(emoji) {
    if (!emoji) return;
    if (!liveKitConnected) return;

    showReactionBubble(liveKitIdentity, emoji);
    showMeetingNotification(`You reacted ${emoji}`);

    sendWS({
        type: "reaction",
        emoji: String(emoji),
        user_name: userName,
        livekit_identity: liveKitIdentity
    });
}

// ============================================================
// SCREEN SHARING (UNCHANGED)
// ============================================================

function isScreenShareTrack(track, publication) {
    if (!track) return false;
    try {
        const pubSource = publication?.source;
        if (pubSource) {
            const s = String(pubSource).toLowerCase();
            return s === "screen_share" || s === "screenshare";
        }
    } catch (_) {}
    try {
        const LK = window.LivekitClient;
        if (LK?.Track?.Source?.ScreenShare &&
            track.source === LK.Track.Source.ScreenShare) {
            return true;
        }
    } catch (_) {}
    try {
        const s = String(track.source || "").toLowerCase();
        return s === "screen_share" || s === "screenshare";
    } catch (_) { return false; }
}

function updateScreenShareUI() {
    const btn = document.getElementById("screenShareButton");
    if (!btn) return;
    btn.classList.toggle("sharing", isScreenSharing);
    const textEl = btn.querySelector(".toolbar-label");
    if (textEl) textEl.textContent = isScreenSharing ? "Stop" : "Share";
}

function cleanupScreenShareLocal() {
    isScreenSharing = false;
    screenShareStream = null;
    screenShareTrack = null;
}

async function startScreenShare() {
    if (isScreenSharing) return;
    if (!liveKitConnected || !liveKitRoom?.localParticipant) {
        alert("Not connected to the meeting yet.");
        return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
        alert("Screen sharing is not supported in this browser.");
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: 15, max: 30 } },
            audio: false
        });
        const track = stream.getVideoTracks()[0];
        if (!track) {
            try { stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
            return;
        }

        screenShareStream = stream;
        screenShareTrack = track;

        const LK = window.LivekitClient;
        const sourceValue = (LK?.Track?.Source?.ScreenShare) || "screen_share";

        await liveKitRoom.localParticipant.publishTrack(track, {
            name: "air-canvas-screen-share",
            source: sourceValue
        });

        isScreenSharing = true;
        updateScreenShareUI();
        showMeetingNotification("🖥️ You started screen sharing");
        broadcastScreenShare(true);

        track.addEventListener("ended", () => { stopScreenShare(); });
    } catch (error) {
        console.warn("Screen share cancelled or failed:", error);
        cleanupScreenShareLocal();
        updateScreenShareUI();
    }
}

async function stopScreenShare() {
    const wasSharing = isScreenSharing;

    try {
        if (screenShareTrack && liveKitRoom?.localParticipant) {
            try {
                await liveKitRoom.localParticipant.unpublishTrack(
                    screenShareTrack, true
                );
            } catch (error) {
                console.warn("unpublishTrack error:", error);
            }
        }
    } catch (_) {}

    try { if (screenShareTrack) screenShareTrack.stop(); } catch (_) {}
    try {
        if (screenShareStream) {
            screenShareStream.getTracks().forEach((t) => {
                try { t.stop(); } catch (_) {}
            });
        }
    } catch (_) {}

    cleanupScreenShareLocal();
    updateScreenShareUI();

    if (wasSharing) {
        showMeetingNotification("🖥️ You stopped screen sharing");
        broadcastScreenShare(false);
    }
}

async function toggleScreenShare() {
    if (isScreenSharing) await stopScreenShare();
    else await startScreenShare();
}

function broadcastScreenShare(active) {
    sendWS({
        type: "screen_share",
        active: Boolean(active),
        user_name: userName,
        livekit_identity: liveKitIdentity
    });
}

// ============================================================
// CANVAS AVAILABILITY
// ============================================================

function updateCanvasAvailability() {
    const canDraw = isMeetingCreator || canvasEnabled;
    const canClear = canDraw || localDrawingHistory.length > 0;

    if (clearCanvasBtn) {
        clearCanvasBtn.disabled = !canClear;
        clearCanvasBtn.style.opacity = canClear ? "1" : "0.45";
    }

    if (gestureDisplay && !canDraw) gestureDisplay.textContent = "VIEW ONLY";
    if (confidenceDisplay && !canDraw) confidenceDisplay.textContent = "--";

    if (!canDraw) {
        if (drawingToolEnabled) setDrawToolEnabled(false);
        closeDrawPanel();
    }

    updateRequestDrawUI();
    updateHostOnlyControls();
    renderDrawingPermissions();
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
// CANVAS HELPERS (UNCHANGED)
// ============================================================

function resizeCanvasPreserve(canvas, cssWidth, cssHeight) {
    if (!canvas || cssWidth <= 0 || cssHeight <= 0) return;
    const width = Math.max(1, Math.round(cssWidth));
    const height = Math.max(1, Math.round(cssHeight));
    if (canvas.width === width && canvas.height === height) return;

    let oldImage = null;
    try {
        if (canvas.width > 0 && canvas.height > 0) {
            oldImage = canvas.getContext("2d")
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

let videoContainerResizeObserver = null;

function observeVideoContainerSize() {
    if (typeof ResizeObserver === "undefined") return;
    if (videoContainerResizeObserver) return;
    const container = video?.parentElement;
    if (!container) return;
    videoContainerResizeObserver = new ResizeObserver(() => {
        setupCanvasSizes();
    });
    videoContainerResizeObserver.observe(container);
}

function resizeRemoteCanvas(tile) {
    if (!tile?.canvas || !tile.container) return;
    const rect = tile.container.getBoundingClientRect();
    resizeCanvasPreserve(tile.canvas, rect.width, rect.height);
}

// ============================================================
// LANDMARK -> CANVAS PIXEL
// ============================================================

function getVideoCoverTransform() {
    const container = video?.parentElement;
    if (!container) return null;

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!cw || !ch || !vw || !vh) return null;

    // Matches the CSS object-fit: contain applied to the video element.
    const scale = Math.min(cw / vw, ch / vh);
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
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function clearLocalCanvas() {
    clearCanvasElement(airCanvas);
    smoothDrawX = null;
    smoothDrawY = null;
    isDrawing = false;
    lastDrawX = 0;
    lastDrawY = 0;
    lastSentDrawX = null;
    lastSentDrawY = null;
    localDrawingHistory = [];
}

// ============================================================
// REMOTE PARTICIPANT TILES (UNCHANGED)
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
        existing.participant = participant;
        const raised = raisedHands.has(identity);
        existing.label.textContent =
            (participant.name || "Participant") + (raised ? " ✋" : "");
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
    remoteVid.style.objectFit = "contain";
    remoteVid.style.background = "#000";
    remoteVid.style.transform = "scaleX(-1)";
    remoteVid.style.display = "block";
    remoteVid.style.visibility = "visible";
    remoteVid.style.opacity = "1";

    const screenVid = document.createElement("video");
    screenVid.autoplay = true;
    screenVid.playsInline = true;
    screenVid.setAttribute("playsinline", "");
    screenVid.className = "remote-screenshare-video";
    screenVid.style.display = "none";
    screenVid.style.transform = "none";

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

    container.append(waiting, remoteVid, screenVid, canvas, audio);
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
        screenVideo: screenVid,
        screenTrack: null,
        canvas,
        ctx: canvas.getContext("2d"),
        audio
    };

    remoteParticipants.set(identity, tile);
    addCardControls(card, identity);

    requestAnimationFrame(() => {
        resizeRemoteCanvas(tile);
        flushPendingRemoteDrawingHistory(identity);
        applyPagination();
    });
    requestAnimationFrame(() => resizeRemoteCanvas(tile));

    if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(() => resizeRemoteCanvas(tile));
        ro.observe(container);
    }

    updateParticipantCount();
    applyPagination();
    return tile;
}

function flushPendingRemoteDrawingHistory(identity) {
    const key = String(identity || "");
    if (!key || !remoteParticipants.has(key)) return;
    const events = pendingRemoteDrawingHistory.get(key);
    if (!Array.isArray(events) || !events.length) return;
    pendingRemoteDrawingHistory.delete(key);
    events.forEach((event) => {
        try { handleRemoteDraw(event); }
        catch (error) {
            console.warn("⚠️ Could not replay drawing history:", error);
        }
    });
}

function removeRemoteTile(identity) {
    const key = String(identity);
    const tile = remoteParticipants.get(key);
    if (!tile) return;

    try { tile.video.srcObject = null; } catch (_) {}
    try { tile.screenVideo.srcObject = null; } catch (_) {}
    try { tile.audio.srcObject = null; } catch (_) {}

    if (tile.card) tile.card.remove();

    remoteParticipants.delete(key);
    pendingRemoteDrawingHistory.delete(key);
    updateParticipantCount();

    if (pinnedIdentity === key) unpinParticipant();
    applyPagination();
}

function clearRemoteTiles() {
    [...remoteParticipants.keys()].forEach(removeRemoteTile);
    updateParticipantCount();
    applyPagination();
}

function attachRemoteVideo(participant, track) {
    const tile = createRemoteTile(participant);
    if (!tile || !track) return;
    try {
        track.attach(tile.video);
        tile.video.style.display = "block";
        tile.video.style.visibility = "visible";
        tile.video.style.opacity = "1";
        tile.video.style.transform = "scaleX(-1)";
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

function attachRemoteScreenShare(participant, track) {
    const tile = createRemoteTile(participant);
    if (!tile || !track) return;
    try {
        track.attach(tile.screenVideo);
        tile.screenVideo.style.display = "block";
        tile.screenVideo.style.transform = "none";
        tile.screenTrack = track;
        tile.waiting.style.display = "none";
        tile.canvas.style.opacity = "0";
        tile.screenVideo.play().catch(() => {});
    } catch (error) {
        console.error("❌ Remote screen share attach failed:", error);
    }
}

function detachRemoteScreenShare(participant, track) {
    if (!participant) return;
    const identity = String(participant.identity);
    const tile = remoteParticipants.get(identity);
    if (!tile) return;
    try { track.detach(tile.screenVideo); } catch (_) {}
    tile.screenVideo.style.display = "none";
    tile.screenVideo.srcObject = null;
    tile.screenTrack = null;
    tile.canvas.style.opacity = "";
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

function detachRemoteTrack(participant, track) {
    detachParticipantTrack(participant, track);
}

// ============================================================
// CAMERA (UNCHANGED)
// ============================================================

async function startLocalMedia() {
    if (localStream) return localStream;
    if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera access is not available in this browser/context.");
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
        cameraStatus.style.color = "#16a34a";
    }
    if (homeStartCamera) {
        homeStartCamera.textContent = "✅ Camera Started";
        homeStartCamera.disabled = true;
    }
    if (startCameraBtn) {
        startCameraBtn.textContent = "✅ Camera On";
        startCameraBtn.disabled = true;
    }

    if (isMeetingCreator || canvasEnabled) initMediaPipe();

    setTimeout(setupCanvasSizes, 300);
    console.log("✅ Camera and microphone started.");
    return localStream;
}

async function startCameraFromHome() {
    if (isCameraStarted) return;
    userName = (userNameInput?.value || "").trim().slice(0, 30) || "Participant";
    localStorage.setItem("airCanvasUserName", userName);
    updateLocalUI();

    try { await startLocalMedia(); }
    catch (error) {
        console.error("❌ Camera/Microphone error:", error);
        if (cameraStatus) {
            cameraStatus.textContent = "❌ Camera/Microphone access denied";
            cameraStatus.style.color = "#dc2626";
        }
        if (homeStartCamera) {
            homeStartCamera.disabled = false;
            homeStartCamera.textContent = "🎥 Start Camera";
        }
    }
}

async function startCameraFromMeeting() {
    if (isCameraStarted) return;
    try { await startLocalMedia(); }
    catch (error) {
        console.error("❌ Camera error:", error);
        alert("Could not access camera and microphone.");
    }
}

function stopLocalMedia() {
    if (camera) { try { camera.stop(); } catch (_) {} camera = null; }
    if (localStream) {
        localStream.getTracks().forEach((track) => {
            try { track.stop(); } catch (_) {}
        });
    }
    localStream = null;
    isCameraStarted = false;
    mediaPipeStarted = false;
    hands = null;
    if (video) video.srcObject = null;
}

// ============================================================
// MEDIAPIPE (UNCHANGED)
// ============================================================

function initMediaPipe() {
    if (mediaPipeStarted || !window.Hands || !window.Camera) return;

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
                try { await hands.send({ image: video }); }
                catch (error) {
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
    if (camera) { try { camera.stop(); } catch (_) {} }
    camera = null;
    hands = null;
    mediaPipeStarted = false;

    if (landmarkCanvas) clearCanvasElement(landmarkCanvas);
    resetDrawingState();

    const restoreLocalPreview = () => {
        if (video && video.srcObject && video.paused) {
            video.play().catch(() => {});
        }
    };
    restoreLocalPreview();
    setTimeout(restoreLocalPreview, 0);
    setTimeout(restoreLocalPreview, 120);
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

        if (typeof HAND_CONNECTIONS !== "undefined" &&
            Array.isArray(HAND_CONNECTIONS)) {
            ctx.strokeStyle = "#2563eb";
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (const [i, j] of HAND_CONNECTIONS) {
                const p1 = landmarkToCanvasPixel(landmarks[i].x, landmarks[i].y);
                const p2 = landmarkToCanvasPixel(landmarks[j].x, landmarks[j].y);
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
            }
            ctx.stroke();
        }

        ctx.fillStyle = "#dc2626";
        for (const lm of landmarks) {
            const p = landmarkToCanvasPixel(lm.x, lm.y);
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    const values = [];
    for (const point of landmarks) values.push(point.x, point.y);

    if (!drawingToolEnabled) {
        resetDrawingState();
    } else if (activeGesture === "draw") {
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
        if (!response.ok) throw new Error(`Prediction HTTP ${response.status}`);
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
        if (pendingLandmarks) requestGesturePrediction();
    }
}

function updateGestureDisplay(gesture, confidence) {
    activeGesture = gesture || "no_gesture";
    activeConfidence = Number(confidence) || 0;

    if (gestureDisplay) {
        gestureDisplay.textContent = activeGesture === "no_gesture"
            ? "NO GESTURE" : activeGesture.toUpperCase();
    }
    if (confidenceDisplay) {
        confidenceDisplay.textContent = activeGesture === "no_gesture"
            ? "--" : `${Math.round(activeConfidence * 100)}%`;
    }
}

function resetDrawingState() {
    isDrawing = false;
    lastDrawX = 0;
    lastDrawY = 0;
    smoothDrawX = null;
    smoothDrawY = null;
    lastSentDrawX = null;
    lastSentDrawY = null;
}

// ============================================================
// LOCAL DRAWING
// ============================================================

function drawGesture(values) {
    if (!airCanvas) return;
    const lmX = Number(values[16]);
    const lmY = Number(values[17]);
    if (!Number.isFinite(lmX) || !Number.isFinite(lmY)) return;

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
            "draw",
            drawingColor,
            drawingThickness / 2 + 1
        );
        return;
    }

    const distance = Math.hypot(x - lastDrawX, y - lastDrawY);
    if (distance < 0.5) return;

    const maxJump = Math.max(airCanvas.width, airCanvas.height) * 0.12;
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
        "draw",
        drawingColor,
        drawingThickness
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
    if (!Number.isFinite(lmX) || !Number.isFinite(lmY)) return;

    const pixel = landmarkToCanvasPixel(lmX, lmY);
    const px = clamp(pixel.x, 0, airCanvas.width);
    const py = clamp(pixel.y, 0, airCanvas.height);
    const radius = clamp(Number(eraserSize) || 20, 4, 120);

    const ctx = airCanvas.getContext("2d");
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
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

function drawLine(canvas, x1, y1, x2, y2, action = "draw",
                  color = "#00ff00", width = null) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const px1 = clamp(x1, 0, 1) * canvas.width;
    const py1 = clamp(y1, 0, 1) * canvas.height;
    const px2 = clamp(x2, 0, 1) * canvas.width;
    const py2 = clamp(y2, 0, 1) * canvas.height;

    const lineWidth = (width !== null && Number.isFinite(Number(width)))
        ? Number(width)
        : (action === "erase" ? 20 : 3);

    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation =
        action === "erase" ? "destination-out" : "source-over";
    ctx.strokeStyle = color || "#00ff00";

    ctx.beginPath();
    ctx.moveTo(px1, py1);
    ctx.lineTo(px2, py2);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
}

function drawDot(canvas, x, y, action = "draw",
                 color = "#00ff00", radius = null) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const r = (radius !== null && Number.isFinite(Number(radius)))
        ? Number(radius)
        : (action === "erase" ? 20 : 2.5);

    ctx.globalCompositeOperation =
        action === "erase" ? "destination-out" : "source-over";
    ctx.fillStyle = color || "#00ff00";

    ctx.beginPath();
    ctx.arc(
        clamp(x, 0, 1) * canvas.width,
        clamp(y, 0, 1) * canvas.height,
        r, 0, Math.PI * 2
    );
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
}

function sendDrawData(x, y, prevX, prevY, action) {
    if (!isMeetingCreator && !canvasEnabled) return;
    if (!meetingActive || !liveKitConnected) return;

    const now = performance.now();
    if (action === "draw" &&
        now - lastDrawSendTime < DRAW_SEND_INTERVAL_MS) return;
    lastDrawSendTime = now;

    const localX = clamp(Number(x), 0, 1);
    const localY = Number(y);
    let prevLocalX = clamp(Number(prevX), 0, 1);
    let prevLocalY = Number(prevY);

    if (action !== "erase" &&
        lastSentDrawX !== null && lastSentDrawY !== null) {
        prevLocalX = lastSentDrawX;
        prevLocalY = lastSentDrawY;
    }

    lastSentDrawX = localX;
    lastSentDrawY = localY;

    const remoteX = 1 - localX;
    const remotePrevX = 1 - prevLocalX;
    const isErase = action === "erase";

    const message = {
        type: "draw_data",
        meeting_id: meetingId,
        user_id: liveKitIdentity,
        user_name: userName,
        livekit_identity: liveKitIdentity,
        x: remoteX,
        y: localY,
        prev_x: remotePrevX,
        prev_y: prevLocalY,
        lastX: remotePrevX,
        lastY: prevLocalY,
        action: action || "draw",
        color: isErase ? null : drawingColor,
        lineWidth: isErase
            ? clamp(Number(eraserSize) || 20, 4, 120)
            : drawingThickness
    };

    sendWS(message);
    localDrawingHistory.push(message);
}

function clearMyCanvasAndBroadcast() {
    const canClear = isMeetingCreator || canvasEnabled ||
        localDrawingHistory.length > 0;
    if (!canClear) return;

    clearLocalCanvas();
    if (!meetingActive || !liveKitConnected) return;

    sendWS({
        type: "clear_canvas",
        meeting_id: meetingId,
        user_id: liveKitIdentity,
        user_name: userName,
        livekit_identity: liveKitIdentity
    });
}

function sendDrawingHistoryTo(targetIdentity) {
    const target = String(targetIdentity || "");
    if (!target) return;
    if (!localDrawingHistory.length) return;
    if (!liveKitConnected || !liveKitRoom?.localParticipant) return;

    for (let i = 0; i < localDrawingHistory.length;
         i += DRAWING_HISTORY_CHUNK_SIZE) {
        const chunk = localDrawingHistory.slice(i, i + DRAWING_HISTORY_CHUNK_SIZE);
        sendLiveKitData(
            {
                type: "drawing_history",
                user_name: userName,
                livekit_identity: liveKitIdentity,
                events: chunk
            },
            {
                reliable: true,
                destinationIdentities: [target],
                topic: "aircanvas-draw"
            }
        );
    }
    console.log(
        `📤 Sent drawing history (${localDrawingHistory.length} events) → ${target}`
    );
}

// ============================================================
// REMOTE DRAWING
// ============================================================

function resolveRemoteIdentity(data) {
    const direct = data.livekit_identity ||
        data.sender_identity || data.participant_identity;
    if (direct && remoteParticipants.has(String(direct))) {
        return String(direct);
    }
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

    const remoteWidth = (data.lineWidth !== undefined &&
                         data.lineWidth !== null &&
                         Number.isFinite(Number(data.lineWidth)))
        ? Number(data.lineWidth)
        : null;

    if (data.action === "erase") {
        const radius = remoteWidth !== null ? remoteWidth : 20;
        const ctx = tile.canvas.getContext("2d");
        ctx.globalCompositeOperation = "destination-out";
        ctx.beginPath();
        ctx.arc(
            clamp(x, 0, 1) * tile.canvas.width,
            clamp(y, 0, 1) * tile.canvas.height,
            radius, 0, Math.PI * 2
        );
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        return;
    }

    const prevX = Number(data.prev_x ?? data.lastX);
    const prevY = Number(data.prev_y ?? data.lastY);
    const remoteColor = (typeof data.color === "string" && data.color)
        ? data.color : "#00ff00";
    const drawWidth = remoteWidth !== null ? remoteWidth : 3;

    if (Number.isFinite(prevX) && Number.isFinite(prevY)) {
        drawLine(tile.canvas, prevX, prevY, x, y, "draw",
                 remoteColor, drawWidth);
    } else {
        drawDot(tile.canvas, x, y, "draw",
                remoteColor, drawWidth / 2 + 1);
    }
}

function handleRemoteClear(data) {
    const identity = resolveRemoteIdentity(data);
    if (!identity || identity === liveKitIdentity) return;
    const tile = remoteParticipants.get(identity);
    if (tile) clearCanvasElement(tile.canvas);
}

// ============================================================
// LIVEKIT DATA (UNCHANGED)
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

    const existing = participantInfo.get(identity) || {
        userId: identity,
        name: participant.name || "Participant",
        isCreator: false,
        livekitIdentity: identity,
        canvasEnabled: false
    };

    existing.userId = identity;
    existing.name = participant.name || existing.name || "Participant";
    existing.livekitIdentity = identity;
    if (isCreator) existing.isCreator = true;

    participantInfo.set(identity, existing);
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
            ? String(participant.identity) : "";

        if (data.type === "participant_hello") {
            if (!senderIdentity) return;

            const info = participantInfo.get(senderIdentity) || {
                userId: senderIdentity,
                name: data.user_name || participant?.name || "Participant",
                isCreator: Boolean(data.is_creator),
                livekitIdentity: senderIdentity,
                canvasEnabled: Boolean(data.canvas_enabled)
            };

            info.userId = senderIdentity;
            info.name = data.user_name || info.name ||
                participant?.name || "Participant";
            info.isCreator = Boolean(data.is_creator);
            info.livekitIdentity = senderIdentity;
            info.canvasEnabled = Boolean(data.canvas_enabled);
            participantInfo.set(senderIdentity, info);
            userIdToLiveKitIdentity.set(senderIdentity, senderIdentity);
            liveKitIdentityToUserId.set(senderIdentity, senderIdentity);

            if (data.raised_hand) {
                raisedHands.add(senderIdentity);
                const tile = remoteParticipants.get(senderIdentity);
                if (tile) {
                    const base = tile.participant?.name || info.name || "Participant";
                    tile.label.textContent = base + " ✋";
                }
            }

            updateParticipantCount();
            renderDrawingPermissions();
            renderParticipantsList();
            return;
        }

        if (senderIdentity) {
            data.user_id = data.user_id || data.target_user_id || senderIdentity;
            data.livekit_identity = data.livekit_identity ||
                data.target_livekit_identity ||
                (data.target_user_id ? data.target_user_id : senderIdentity);
            data.user_name = data.user_name || data.target_user_name ||
                participant?.name || "Participant";
        }

        handleWebSocketMessage(data);
    } catch (error) {
        console.error("❌ LiveKit data receive failed:", error);
    }
}

// ============================================================
// WEBSOCKET COMPATIBILITY (UNCHANGED)
// ============================================================

function sendWS(message) {
    if (!message) return false;
    const type = message.type;
    if (type === "create_meeting" || type === "join_meeting") return true;

    let destinationIdentities = [];
    if (type === "grant_drawing" || type === "revoke_drawing" ||
        type === "drawing_permission_denied") {
        const targetId = String(message.target_user_id || "");
        const targetIdentity = String(
            message.target_livekit_identity ||
                userIdToLiveKitIdentity.get(targetId) ||
                (remoteParticipants.has(targetId) ? targetId : "") ||
                targetId
        );
        if (targetIdentity) destinationIdentities = [targetIdentity];
        message.target_user_id = targetId || targetIdentity;
        message.target_livekit_identity = targetIdentity;
        message.user_id = targetIdentity;
        message.livekit_identity = targetIdentity;
    }

    sendLiveKitData(message, {
        reliable: true,
        destinationIdentities,
        topic: type === "draw_data" ? "aircanvas-draw" : "aircanvas-control"
    });

    if (type !== "draw_data") console.log("📤 LiveKit Data:", message);
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
                isMeetingCreator = isMeetingCreator
                    ? true : Boolean(data.is_creator);
            }
            if (data.livekit_identity) {
                liveKitIdentity = String(data.livekit_identity);
            }

            canvasEnabled = Boolean(isMeetingCreator) ||
                Boolean(data.canvas_enabled) || Boolean(data.is_creator);

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
                participantInfo.set(String(data.creator_id), {
                    userId: String(data.creator_id),
                    name: data.creator_name || "Host",
                    isCreator: true,
                    livekitIdentity: data.creator_livekit_identity
                        ? String(data.creator_livekit_identity) : null,
                    canvasEnabled: true
                });
            }
            break;

        case "participant_joined": {
            const id = data.user_id ? String(data.user_id) : null;
            if (id) {
                participantInfo.set(id, {
                    userId: id,
                    name: data.user_name || "Participant",
                    isCreator: Boolean(data.is_creator),
                    livekitIdentity: data.livekit_identity
                        ? String(data.livekit_identity) : null,
                    canvasEnabled: Boolean(data.canvas_enabled)
                });
                if (data.livekit_identity) {
                    const identity = String(data.livekit_identity);
                    userIdToLiveKitIdentity.set(id, identity);
                    liveKitIdentityToUserId.set(identity, id);
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
                drawingPermissionRequests.delete(id);
                raisedHands.delete(id);
            }
            if (data.livekit_identity) {
                const identity = String(data.livekit_identity);
                removeRemoteTile(identity);
                participantInfo.delete(identity);
                drawingPermissionRequests.delete(identity);
                raisedHands.delete(identity);
            }
            updateParticipantCount();
            renderDrawingPermissions();
            renderParticipantsList();
            break;
        }

        case "request_drawing":
        case "drawing_permission_request": {
            if (!isMeetingCreator) break;
            const requesterId = String(
                data.livekit_identity || data.user_id || ""
            );
            if (!requesterId || requesterId === String(liveKitIdentity)) break;

            drawingPermissionRequests.add(requesterId);

            const name =
                data.user_name ||
                participantInfo.get(requesterId)?.name ||
                "A participant";

            showMeetingNotification(`✋ ${name} requested to draw`);
            renderDrawingPermissions();
            break;
        }

        case "drawing_permission_denied": {
            const targetId = String(
                data.target_livekit_identity ||
                    data.target_user_id ||
                    data.livekit_identity ||
                    data.user_id ||
                    ""
            );
            if (targetId &&
                targetId !== String(liveKitIdentity) &&
                targetId !== String(userId)) break;

            drawingPermissionRequested = false;
            updateRequestDrawUI();
            showMeetingNotification("🚫 Drawing request declined");
            console.log("🚫 Drawing permission unavailable:",
                data.message || "");
            break;
        }

        case "grant_drawing":
        case "drawing_permission": {
            const id = data.target_livekit_identity
                ? String(data.target_livekit_identity)
                : data.target_user_id
                ? String(data.target_user_id)
                : data.user_id ? String(data.user_id) : null;
            const permissionEnabled = data.type === "grant_drawing"
                ? true : Boolean(data.canvas_enabled);
            if (!id) break;

            const existing = participantInfo.get(id) || {
                userId: id,
                name: data.user_name || "Participant",
                isCreator: false
            };
            existing.canvasEnabled = permissionEnabled;

            if (data.livekit_identity) {
                existing.livekitIdentity = String(data.livekit_identity);
                userIdToLiveKitIdentity.set(id, String(data.livekit_identity));
                liveKitIdentityToUserId.set(String(data.livekit_identity), id);
            }
            participantInfo.set(id, existing);
            if (isMeetingCreator) drawingPermissionRequests.delete(id);

            if (id === String(userId) || id === String(liveKitIdentity)) {
                canvasEnabled = permissionEnabled;
                drawingPermissionRequested = false;
                if (canvasEnabled) {
                    if (!mediaPipeStarted) initMediaPipe();
                } else {
                    if (landmarkCanvas) clearCanvasElement(landmarkCanvas);
                    resetDrawingState();
                }
                updateCanvasAvailability();
            } else {
                renderDrawingPermissions();
            }
            break;
        }

        case "revoke_drawing": {
            const id = data.target_livekit_identity
                ? String(data.target_livekit_identity)
                : data.target_user_id
                ? String(data.target_user_id)
                : data.user_id ? String(data.user_id) : null;
            if (!id) break;

            const existing = participantInfo.get(id) || {
                userId: id,
                name: data.user_name || "Participant",
                isCreator: false
            };
            existing.canvasEnabled = false;

            if (data.livekit_identity) {
                existing.livekitIdentity = String(data.livekit_identity);
                userIdToLiveKitIdentity.set(id, String(data.livekit_identity));
                liveKitIdentityToUserId.set(String(data.livekit_identity), id);
            }
            participantInfo.set(id, existing);
            if (isMeetingCreator) drawingPermissionRequests.delete(id);

            if (id === String(userId) || id === String(liveKitIdentity)) {
                canvasEnabled = false;
                drawingPermissionRequested = false;
                if (landmarkCanvas) clearCanvasElement(landmarkCanvas);
                resetDrawingState();
                updateCanvasAvailability();
                showMeetingNotification("🚫 Drawing permission removed");
            } else {
                renderDrawingPermissions();
            }
            break;
        }

        case "room_participants": {
            const incoming = Array.isArray(data.participants)
                ? data.participants : [];
            incoming.forEach((participant) => {
                const id = participant.user_id
                    ? String(participant.user_id) : null;
                if (!id) return;
                const identity = participant.livekit_identity
                    ? String(participant.livekit_identity) : null;
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
                    canvasEnabled = Boolean(participant.canvas_enabled) ||
                        Boolean(participant.is_creator);
                }
            });
            if (isMeetingCreator || canvasEnabled) {
                if (!mediaPipeStarted) initMediaPipe();
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

        case "reaction": {
            const emoji = String(data.emoji || "");
            const senderId = String(data.livekit_identity || "");
            if (!emoji) break;
            if (!senderId || senderId === String(liveKitIdentity)) break;

            const name =
                data.user_name ||
                participantInfo.get(senderId)?.name ||
                remoteParticipants.get(senderId)?.participant?.name ||
                "Someone";

            showReactionBubble(senderId, emoji);
            showMeetingNotification(`${name} reacted ${emoji}`);
            break;
        }

        case "raise_hand": {
            const senderId = String(data.livekit_identity || "");
            if (!senderId || senderId === String(liveKitIdentity)) break;

            const raised = Boolean(data.raised);
            const name =
                data.user_name ||
                participantInfo.get(senderId)?.name ||
                remoteParticipants.get(senderId)?.participant?.name ||
                "Someone";

            if (raised) {
                raisedHands.add(senderId);
                showMeetingNotification(`✋ ${name} raised their hand`);
            } else {
                raisedHands.delete(senderId);
                showMeetingNotification(`${name} lowered their hand`);
            }

            const tile = remoteParticipants.get(senderId);
            if (tile) {
                const base = tile.participant?.name || name || "Participant";
                tile.label.textContent = base + (raised ? " ✋" : "");
            }
            renderParticipantsList();
            break;
        }

        case "screen_share": {
            const senderId = String(data.livekit_identity || "");
            if (!senderId || senderId === String(liveKitIdentity)) break;

            const active = Boolean(data.active);
            const name =
                data.user_name ||
                participantInfo.get(senderId)?.name ||
                remoteParticipants.get(senderId)?.participant?.name ||
                "Someone";

            showMeetingNotification(
                active
                    ? `🖥️ ${name} started screen sharing`
                    : `🖥️ ${name} stopped screen sharing`
            );
            break;
        }

        case "end_meeting": {
            const senderId = String(
                data.livekit_identity || data.user_id || ""
            );
            if (!senderId || senderId === String(liveKitIdentity)) break;

            showMeetingNotification("Meeting ended by host");
            setTimeout(async () => {
                await cleanupMeeting(true);
                showHome();
                if (homeStartCamera) {
                    homeStartCamera.textContent = "🎥 Start Camera";
                    homeStartCamera.disabled = false;
                }
                if (startCameraBtn) {
                    startCameraBtn.textContent = "Start";
                    startCameraBtn.disabled = false;
                }
                if (cameraStatus) {
                    cameraStatus.textContent = "Camera is off";
                    cameraStatus.style.color = "";
                }
            }, 900);
            break;
        }

        case "room_full":
            alert(`This meeting is full. Maximum ${MAX_PARTICIPANTS} participants.`);
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
    if (ws) { try { ws.close(); } catch (_) {} }
    ws = null;
}

// ============================================================
// LIVEKIT SDK LOADING (UNCHANGED)
// ============================================================

function loadLiveKitSDK() {
    if (window.LivekitClient) return Promise.resolve(window.LivekitClient);
    if (liveKitSDKPromise) return liveKitSDKPromise;

    liveKitSDKPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-livekit-sdk="true"]');
        if (existing) {
            existing.addEventListener("load", () => resolve(window.LivekitClient));
            existing.addEventListener("error", () =>
                reject(new Error("LiveKit SDK failed to load.")));
            return;
        }

        const script = document.createElement("script");
        script.src =
            "https://cdn.jsdelivr.net/npm/livekit-client/dist/livekit-client.umd.min.js";
        script.async = true;
        script.dataset.livekitSdk = "true";
        script.onload = () => {
            if (window.LivekitClient) resolve(window.LivekitClient);
            else reject(new Error("LiveKit SDK loaded but global was not found."));
        };
        script.onerror = () => reject(new Error("Could not load LiveKit SDK."));
        document.head.appendChild(script);
    });

    return liveKitSDKPromise;
}

// ============================================================
// LIVEKIT (UNCHANGED)
// ============================================================

async function connectLiveKit() {
    if (liveKitConnected) return;
    if (!meetingId || !localStream) throw new Error("Meeting or local media missing.");

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

    liveKitRoom = new LK.Room({ adaptiveStream: true, dynacast: true });

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
                if (isScreenShareTrack(track, publication)) {
                    attachRemoteScreenShare(participant, track);
                } else {
                    attachRemoteVideo(participant, track);
                }
            } else if (track.kind === LK.Track.Kind.Audio) {
                attachRemoteAudio(participant, track);
            }
        }
    );

    liveKitRoom.on(
        LK.RoomEvent.TrackUnsubscribed,
        (track, publication, participant) => {
            if (track.kind === LK.Track.Kind.Video &&
                isScreenShareTrack(track, publication)) {
                detachRemoteScreenShare(participant, track);
            } else {
                detachParticipantTrack(participant, track);
            }
        }
    );

    liveKitRoom.on(LK.RoomEvent.ParticipantConnected, (participant) => {
        const identity = String(participant.identity);
        if (identity === liveKitIdentity) return;

        createRemoteTile(participant);
        upsertLiveKitParticipant(participant, false);

        const name = participant.name || "Someone";
        showMeetingNotification(`👤 ${name} joined the meeting`);

        sendLiveKitData(
            {
                type: "participant_hello",
                user_name: userName,
                is_creator: isMeetingCreator,
                canvas_enabled: Boolean(isMeetingCreator || canvasEnabled),
                raised_hand: raisedHands.has(liveKitIdentity)
            },
            { reliable: true, topic: "aircanvas-control" }
        );

        sendDrawingHistoryTo(identity);

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
        const info = participantInfo.get(identity);
        const name = participant.name || info?.name || "Someone";
        showMeetingNotification(`👤 ${name} left the meeting`);

        removeRemoteTile(identity);
        participantInfo.delete(identity);
        drawingPermissionRequests.delete(identity);
        raisedHands.delete(identity);

        const id = liveKitIdentityToUserId.get(identity);
        if (id) {
            liveKitIdentityToUserId.delete(identity);
            userIdToLiveKitIdentity.delete(id);
            participantInfo.delete(id);
            drawingPermissionRequests.delete(id);
            raisedHands.delete(id);
        }

        updateParticipantCount();
        renderDrawingPermissions();
        renderParticipantsList();
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
            canvas_enabled: Boolean(isMeetingCreator || canvasEnabled),
            raised_hand: raisedHands.has(liveKitIdentity)
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
                    if (isScreenShareTrack(publication.track, publication)) {
                        attachRemoteScreenShare(participant, publication.track);
                    } else {
                        attachRemoteVideo(participant, publication.track);
                    }
                } else if (publication.kind === LK.Track.Kind.Audio) {
                    attachRemoteAudio(participant, publication.track);
                }
            } else if (!publication.isSubscribed) {
                try { publication.setSubscribed(true); } catch (_) {}
            }
        }
    });

    updateParticipantCount();
}

function disconnectLiveKit() {
    if (liveKitRoom) {
        try { liveKitRoom.disconnect(); } catch (_) {}
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
    updateHostOnlyControls();
    renderDrawingPermissions();

    setupLocalCardControls();
    initTheme();
    initPaginationControls();

    if (leaveMeetingBtn) leaveMeetingBtn.disabled = false;

    applyPagination();
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

        isMeetingCreator = true;
        canvasEnabled = true;
        updateCanvasAvailability();
        updateHostOnlyControls();

        if (!mediaPipeStarted) initMediaPipe();
        console.log("🎉 Meeting created:", meetingId);
    } catch (error) {
        console.error("❌ Could not create meeting:", error);
        meetingActive = false;
        await cleanupMeeting(false);
        showHome();
        alert("Could not create the meeting. Check the browser console.");
    }
}

async function joinMeeting() {
    if (meetingActive) return;

    userName = (userNameInput?.value || "").trim().slice(0, 30) || "Participant";
    localStorage.setItem("airCanvasUserName", userName);

    meetingId = normalizeMeetingId(meetingIdInput?.value);
    if (!meetingId) { alert("Please enter the Meeting ID."); return; }

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
        alert("Could not join the meeting. Check the Meeting ID and browser console.");
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
        try { await liveKitRoom.localParticipant.setMicrophoneEnabled(!isMuted); }
        catch (error) { console.warn("⚠️ LiveKit microphone toggle:", error); }
    }
    if (muteButton) {
        muteButton.classList.toggle("muted", isMuted);
        const label = muteButton.querySelector(".toolbar-label");
        if (label) label.textContent = isMuted ? "Unmute" : "Audio";
        const icon = muteButton.querySelector(".toolbar-icon");
        if (icon) icon.textContent = isMuted ? "🔇" : "🎤";
    }
}

async function toggleCamera() {
    if (!localStream) return;
    isCameraOff = !isCameraOff;
    localStream.getVideoTracks().forEach((track) => (track.enabled = !isCameraOff));

    if (liveKitRoom?.localParticipant) {
        try { await liveKitRoom.localParticipant.setCameraEnabled(!isCameraOff); }
        catch (error) { console.warn("⚠️ LiveKit camera toggle:", error); }
    }
    if (cameraButton) {
        cameraButton.classList.toggle("camera-off", isCameraOff);
        const label = cameraButton.querySelector(".toolbar-label");
        if (label) label.textContent = isCameraOff ? "Start Video" : "Video";
        const icon = cameraButton.querySelector(".toolbar-icon");
        if (icon) icon.textContent = isCameraOff ? "🚫" : "📹";
    }
}

async function copyMeetingIdToClipboard() {
    if (!meetingId) return;
    try {
        await navigator.clipboard.writeText(meetingId);
        showMeetingNotification("📋 Meeting ID copied");
        if (copyMeetingId) {
            const old = copyMeetingId.textContent;
            copyMeetingId.textContent = "✅";
            setTimeout(() => (copyMeetingId.textContent = old), 1200);
        }
    } catch (error) {
        console.error("❌ Clipboard error:", error);
    }
}

function clearCanvasButtonAction() { clearMyCanvasAndBroadcast(); }

async function cleanupMeeting(stopCameraToo = true) {
    meetingActive = false;

    try { if (screenShareTrack) screenShareTrack.stop(); } catch (_) {}
    try {
        if (screenShareStream) {
            screenShareStream.getTracks().forEach((t) => {
                try { t.stop(); } catch (_) {}
            });
        }
    } catch (_) {}
    screenShareTrack = null;
    screenShareStream = null;
    isScreenSharing = false;
    updateScreenShareUI();

    try { exitFullscreen(); } catch (_) {}

    pinnedIdentity = null;
    currentPage = 1;
    try { applyPinState(); } catch (_) {}

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
    drawingPermissionRequested = false;

    participantInfo.clear();
    userIdToLiveKitIdentity.clear();
    liveKitIdentityToUserId.clear();
    raisedHands.clear();
    drawingPermissionRequests.clear();

    closeDrawPanel();
    toggleMoreMenu(false);
    toggleDrawingPermissionsPopover(false);
    if (drawingToolEnabled) setDrawToolEnabled(false);

    activeGesture = "no_gesture";
    activeConfidence = 0;
    resetDrawingState();

    updateGestureDisplay("no_gesture", 0);
    updateParticipantCount();
    updateHandRaiseButton();
    updateRequestDrawUI();
    updateLocalUI();
    updateHostOnlyControls();
    toggleReactionsMenu(false);

    if (meetingIdInput) meetingIdInput.value = "";
    if (meetingIdLarge) meetingIdLarge.textContent = "------";
    if (meetingIdDisplay) meetingIdDisplay.textContent = "Meeting ID: ------";

    if (muteButton) {
        muteButton.classList.remove("muted");
        const label = muteButton.querySelector(".toolbar-label");
        if (label) label.textContent = "Audio";
        const icon = muteButton.querySelector(".toolbar-icon");
        if (icon) icon.textContent = "🎤";
    }
    if (cameraButton) {
        cameraButton.classList.remove("camera-off");
        const label = cameraButton.querySelector(".toolbar-label");
        if (label) label.textContent = "Video";
        const icon = cameraButton.querySelector(".toolbar-icon");
        if (icon) icon.textContent = "📹";
    }
    if (leaveMeetingBtn) leaveMeetingBtn.disabled = false;
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
        startCameraBtn.textContent = "Start";
        startCameraBtn.disabled = false;
    }
    if (cameraStatus) {
        cameraStatus.textContent = "Camera is off";
        cameraStatus.style.color = "";
    }
}

async function endMeetingForAll() {
    if (!isMeetingCreator) return;
    if (!meetingActive) return;

    const confirmed = window.confirm(
        "End the meeting for everyone?\n\nAll participants will be disconnected."
    );
    if (!confirmed) return;

    sendWS({
        type: "end_meeting",
        meeting_id: meetingId,
        user_id: userId,
        user_name: userName,
        livekit_identity: liveKitIdentity
    });

    await new Promise((r) => setTimeout(r, 150));

    await cleanupMeeting(true);
    showHome();

    if (homeStartCamera) {
        homeStartCamera.textContent = "🎥 Start Camera";
        homeStartCamera.disabled = false;
    }
    if (startCameraBtn) {
        startCameraBtn.textContent = "Start";
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

function wireButton(id, handler) {
    const el = document.getElementById(id);
    if (!el) { console.warn("⚠️ Missing button:", id); return; }
    el.addEventListener("click", handler);
}

wireButton("homeStartCamera",      startCameraFromHome);
wireButton("createMeetingButton",  createMeeting);
wireButton("joinMeetingButton",    joinMeeting);
wireButton("startCamera",          startCameraFromMeeting);
wireButton("muteButton",           toggleMute);
wireButton("cameraButton",         toggleCamera);
wireButton("leaveMeeting",         leaveMeeting);
wireButton("endMeetingButton",     endMeetingForAll);
wireButton("copyMeetingId",        copyMeetingIdToClipboard);

meetingIdInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") joinMeeting();
});

// Re-apply pagination on resize (debounced) & recompute canvas sizes.
let __resizeTimer = null;
window.addEventListener("resize", () => {
    setupCanvasSizes();

    const moreMenu = document.getElementById("moreMenu");
    if (moreMenu && !moreMenu.classList.contains("hidden")) positionMoreMenu();

    const perms = document.getElementById("drawingPermissionsPopover");
    if (perms && !perms.classList.contains("hidden")) {
        positionDrawingPermissionsPopover();
    }

    const reactions = document.getElementById("reactionsMenu");
    if (reactions && !reactions.classList.contains("hidden")) {
        positionReactionsMenu(reactions);
    }

    if (__resizeTimer) clearTimeout(__resizeTimer);
    __resizeTimer = setTimeout(() => {
        applyPagination();
    }, 120);
});

document.addEventListener("fullscreenchange", handleFullscreenChange);
document.addEventListener("webkitfullscreenchange", handleFullscreenChange);

window.addEventListener("beforeunload", () => {
    try { ws?.close(); } catch (_) {}
    try { liveKitRoom?.disconnect(); } catch (_) {}
    try { localStream?.getTracks().forEach((track) => track.stop()); } catch (_) {}
    try { screenShareTrack?.stop(); } catch (_) {}
});

// ============================================================
// INITIALIZE
// ============================================================

function initializeApplication() {
    initTheme();
    ensureFeatureStyles();
    initializeMeetingPanels();
    ensureExtraControls();
    initMoreMenu();
    initDrawingControls();
    initDrawingPermissionsPopover();
    initPaginationControls();
    ensureNotificationsContainer();
    updateLocalUI();
    setupCanvasSizes();
    observeVideoContainerSize();
    hideLegacyRemoteCard();
    updateParticipantCount();
    updateCanvasAvailability();
    updateHandRaiseButton();
    updateRequestDrawUI();
    updateScreenShareUI();
    updateHostOnlyControls();
    setConnectionStatus("Disconnected");

    setupLocalCardControls();
    applyPagination();

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