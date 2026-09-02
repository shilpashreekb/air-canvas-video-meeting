// ============================================================
// AIR CANVAS MEETING - APP.JS
// ============================================================
// IMPORTANT:
// - Uses trained backend KNN model
// - DRAW / ERASE / CLEAR / NO_GESTURE come from backend
// - No draw permission system
// - Host and participant can both draw
// - Remote drawing is synchronized through WebSocket
// - Remote canvas is automatically created if missing
// - Camera orientation is NOT modified here
// ============================================================


// ============================================================
// GLOBAL STATE
// ============================================================

let ws = null;

let localStream = null;
let remoteStream = null;

let peerConnection = null;

// ============================================================
// LIVEKIT
// ============================================================
let liveKitRoom = null;
let liveKitConnected = false;

const LIVEKIT_TOKEN_SERVER_ID = "aircanvas-sixxay";

let meetingId = null;
let userName = "";

let isMeetingCreator = false;
let creatorName = "";

let participants = [];

let isCameraStarted = false;

let hands = null;
let camera = null;
let mediaPipeStarted = false;

let isDrawing = false;
let lastX = 0;
let lastY = 0;

let lastDrawTime = 0;

const DRAW_THROTTLE_MS = 30;

let pendingIceCandidates = [];
// ============================================================
// DRAWING STABILITY STATE
// ============================================================

let activeGesture = "no_gesture";

let backendRequestInFlight = false;
let pendingLandmarks = null;

let lastNetworkDrawTime = 0;

const NETWORK_DRAW_INTERVAL = 30;


// ============================================================
// DOM ELEMENTS
// ============================================================

const homeScreen =
    document.getElementById("homeScreen");

const meetingScreen =
    document.getElementById("meetingScreen");

const userNameInput =
    document.getElementById("userNameInput");

const homeStartCamera =
    document.getElementById("homeStartCamera");

const cameraStatus =
    document.getElementById("cameraStatus");

const createMeetingButton =
    document.getElementById("createMeetingButton");

const meetingIdInput =
    document.getElementById("meetingIdInput");

const joinMeetingButton =
    document.getElementById("joinMeetingButton");

const meetingIdDisplay =
    document.getElementById("meetingIdDisplay");

const meetingIdLarge =
    document.getElementById("meetingIdLarge");

const copyMeetingId =
    document.getElementById("copyMeetingId");

const connectionStatus =
    document.getElementById("connectionStatus");

const localParticipantLabel =
    document.getElementById("localParticipantLabel");

const remoteParticipantLabel =
    document.getElementById("remoteParticipantLabel");

const waitingParticipant =
    document.getElementById("waitingParticipant");

const video =
    document.getElementById("video");

const remoteVideo =
    document.getElementById("remoteVideo");

const airCanvas =
    document.getElementById("airCanvas");

const landmarkCanvas =
    document.getElementById("landmarkCanvas");

const gestureDisplay =
    document.getElementById("gesture");

const confidenceDisplay =
    document.getElementById("confidence");

const startCameraBtn =
    document.getElementById("startCamera");

const clearCanvasBtn =
    document.getElementById("clearCanvas");

const muteButton =
    document.getElementById("muteButton");

const cameraButton =
    document.getElementById("cameraButton");

const leaveMeetingBtn =
    document.getElementById("leaveMeeting");

const remoteAudio =
    document.getElementById("remoteAudio");


// ============================================================
// REMOTE CANVAS
// ============================================================
// Your HTML currently does NOT contain remoteCanvas.
// Therefore we create it automatically.
// ============================================================

let remoteCanvas = null;
let remoteCtx = null;


function createRemoteCanvas() {

    if (remoteCanvas) {
        return;
    }

    const remoteContainer =
        remoteVideo.parentElement;

    if (!remoteContainer) {
        console.error(
            "❌ Remote video container not found."
        );
        return;
    }

    remoteCanvas =
        document.createElement("canvas");

    remoteCanvas.id = "remoteCanvas";

    remoteCanvas.style.position = "absolute";
    remoteCanvas.style.top = "0";
    remoteCanvas.style.left = "0";
    remoteCanvas.style.width = "100%";
    remoteCanvas.style.height = "100%";
    remoteCanvas.style.pointerEvents = "none";
    remoteCanvas.style.zIndex = "5";

    remoteContainer.appendChild(remoteCanvas);

    remoteCtx =
        remoteCanvas.getContext("2d");

    console.log(
        "✅ Remote drawing canvas created."
    );
}


// ============================================================
// CANVAS CONTEXTS
// ============================================================

const airCtx =
    airCanvas.getContext("2d");

const landmarkCtx =
    landmarkCanvas.getContext("2d");


// ============================================================
// INITIALIZATION
// ============================================================

document.addEventListener(
    "DOMContentLoaded",
    () => {

        createRemoteCanvas();

        setupCanvasSizes();

        window.addEventListener(
            "resize",
            setupCanvasSizes
        );

        homeStartCamera.addEventListener(
            "click",
            startCameraFromHome
        );

        createMeetingButton.addEventListener(
            "click",
            createMeeting
        );

        joinMeetingButton.addEventListener(
            "click",
            joinMeeting
        );

        startCameraBtn.addEventListener(
            "click",
            startCameraFromMeeting
        );

        clearCanvasBtn.addEventListener(
            "click",
            clearCanvas
        );

        muteButton.addEventListener(
            "click",
            toggleMute
        );

        cameraButton.addEventListener(
            "click",
            toggleCamera
        );

        leaveMeetingBtn.addEventListener(
            "click",
            leaveMeeting
        );

        copyMeetingId.addEventListener(
            "click",
            copyMeetingIdToClipboard
        );

        console.log(
            "✅ Air Canvas application initialized."
        );
    }
);


// ============================================================
// CANVAS SIZE SETUP
// ============================================================

function setupCanvasSizes() {

    // --------------------------------------------------------
    // LOCAL CANVAS
    // --------------------------------------------------------

    const localContainer =
        video.parentElement;

    if (localContainer) {

        const width =
            localContainer.clientWidth;

        const height =
            localContainer.clientHeight;

        if (width > 0 && height > 0) {

            airCanvas.width = width;
            airCanvas.height = height;

            landmarkCanvas.width = width;
            landmarkCanvas.height = height;
        }
    }


    // --------------------------------------------------------
    // REMOTE CANVAS
    // --------------------------------------------------------

    if (!remoteCanvas) {
        createRemoteCanvas();
    }

    if (remoteCanvas) {

        const remoteContainer =
            remoteVideo.parentElement;

        if (remoteContainer) {

            const width =
                remoteContainer.clientWidth;

            const height =
                remoteContainer.clientHeight;

            if (width > 0 && height > 0) {

                remoteCanvas.width = width;
                remoteCanvas.height = height;
            }
        }
    }
}


// ============================================================
// HOME CAMERA
// ============================================================

async function startCameraFromHome() {

    userName =
        userNameInput.value.trim() ||
        "User";

    localParticipantLabel.textContent =
        userName;

    try {

        localStream =
            await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });

        video.srcObject =
            localStream;

        await video.play();

        isCameraStarted = true;

        cameraStatus.textContent =
            "✅ Camera & Mic On";

        cameraStatus.style.color =
            "#4caf50";

        homeStartCamera.textContent =
            "✅ Camera Started";

        homeStartCamera.disabled =
            true;

        startCameraBtn.textContent =
            "✅ Camera On";

        startCameraBtn.disabled =
            true;

        initMediaPipe();

        setTimeout(
            setupCanvasSizes,
            500
        );

        console.log(
            "🎥 Camera and microphone started."
        );

    } catch (error) {

        console.error(
            "❌ Camera/Microphone error:",
            error
        );

        cameraStatus.textContent =
            "❌ Camera/Microphone access denied";

        cameraStatus.style.color =
            "#f44336";
    }
}


// ============================================================
// CAMERA FROM MEETING
// ============================================================

async function startCameraFromMeeting() {

    if (isCameraStarted) {
        return;
    }

    try {

        localStream =
            await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });

        video.srcObject =
            localStream;

        await video.play();

        isCameraStarted = true;

        startCameraBtn.textContent =
            "✅ Camera On";

        startCameraBtn.disabled =
            true;

        initMediaPipe();

        setTimeout(
            setupCanvasSizes,
            500
        );

    } catch (error) {

        console.error(
            "❌ Camera error:",
            error
        );

        alert(
            "Could not access camera and microphone."
        );
    }
}


// ============================================================
// CREATE MEETING
// ============================================================

async function createMeeting() {

    userName =
        userNameInput.value.trim() ||
        "User";

    if (!isCameraStarted) {

        await startCameraFromHome();

        if (!isCameraStarted) {
            return;
        }
    }

    meetingId =
        generateMeetingId();

    isMeetingCreator = true;

    creatorName =
        userName;

    participants = [
        {
            id: "local",
            name: userName,
            isCreator: true
        }
    ];

    setupMeetingUI();

    connectWebSocket();
}


// ============================================================
// JOIN MEETING
// ============================================================

async function joinMeeting() {

    userName =
        userNameInput.value.trim() ||
        "User";

    meetingId =
        meetingIdInput.value
            .trim()
            .toUpperCase();

    if (!meetingId) {

        alert(
            "Please enter the Meeting ID."
        );

        return;
    }

    if (!isCameraStarted) {

        await startCameraFromHome();

        if (!isCameraStarted) {
            return;
        }
    }

    isMeetingCreator = false;

    creatorName = "";

    participants = [
        {
            id: "local",
            name: userName,
            isCreator: false
        }
    ];

    setupMeetingUI();

    connectWebSocket();
}


// ============================================================
// MEETING UI
// ============================================================

function setupMeetingUI() {

    homeScreen.classList.add(
        "hidden"
    );

    meetingScreen.classList.remove(
        "hidden"
    );

    meetingIdDisplay.textContent =
        `Meeting ID: ${meetingId}`;

    meetingIdLarge.textContent =
        meetingId;

    localParticipantLabel.textContent =
        userName;

    remoteParticipantLabel.textContent =
        "Waiting...";

    waitingParticipant.classList.remove(
        "hidden"
    );

    remoteVideo.style.display =
        "none";

    clearLocalCanvasOnly();

    clearRemoteCanvas();

    setTimeout(
        setupCanvasSizes,
        200
    );
}


// ============================================================
// CONNECTION STATUS
// ============================================================

function updateConnectionStatus(status) {

    connectionStatus.textContent =
        `Backend: ${status}`;

    connectionStatus.className =
        "connection-status";

    if (status === "Connected") {

        connectionStatus.style.color =
            "#4caf50";

    } else if (status === "Error") {

        connectionStatus.style.color =
            "#f44336";

    } else {

        connectionStatus.style.color =
            "#ff9800";
    }
}


// ============================================================
// WEBSOCKET CONNECTION
// ============================================================

function connectWebSocket() {

    const wsUrl =
        `ws://localhost:8000/ws/${encodeURIComponent(meetingId)}`;

    console.log(
        "🔌 Connecting:",
        wsUrl
    );

    ws =
        new WebSocket(wsUrl);


    // --------------------------------------------------------
    // OPEN
    // --------------------------------------------------------

    ws.onopen = () => {

        console.log(
            "✅ WebSocket connected."
        );

        updateConnectionStatus(
            "Connected"
        );

        ws.send(
            JSON.stringify({
                type:
                    isMeetingCreator
                        ? "create_meeting"
                        : "join_meeting",

                meeting_id:
                    meetingId,

                user_name:
                    userName
            })
        );

        setTimeout(() => {
            connectLiveKit();
        }, 300);
    };


    // --------------------------------------------------------
    // MESSAGE
    // --------------------------------------------------------

    ws.onmessage = async event => {

        try {

            const data =
                JSON.parse(event.data);

            console.log(
                "📩 WebSocket:",
                data.type,
                data
            );


            switch (data.type) {


                // ============================================
                // SELF INFO
                // ============================================

                case "self_info":

                    isMeetingCreator =
                        Boolean(
                            data.is_creator
                        );

                    if (
                        data.user_name
                    ) {

                        userName =
                            data.user_name;

                        localParticipantLabel.textContent =
                            userName;
                    }

                    if (
                        data.is_creator
                    ) {

                        creatorName =
                            data.user_name;
                    }

                    updateParticipantUI();

                    break;


                // ============================================
                // CREATOR INFO
                // ============================================

                case "creator_info":

                    creatorName =
                        data.creator_name ||
                        "Host";

                    addOrUpdateParticipant(
                        data.creator_id,
                        data.creator_name,
                        true
                    );

                    updateParticipantUI();

                    break;


                // ============================================
                // PARTICIPANT JOINED
                // ============================================

                case "participant_joined":

                    await handleParticipantJoined(
                        data
                    );

                    break;


                // ============================================
                // PARTICIPANT LEFT
                // ============================================

                case "participant_left":

                    handleParticipantLeft(
                        data
                    );

                    break;



                // ============================================
                // REMOTE DRAWING
                // ============================================

                case "draw_data":

                    drawRemoteLine(
                        data
                    );

                    break;


                // ============================================
                // REMOTE CLEAR
                // ============================================

                case "clear_canvas":

                    clearRemoteCanvas();

                    console.log(
                        "🧹  Remote participant drawing cleared."
                    );

                    break;


                // ============================================
                // ROOM FULL
                // ============================================

                case "room_full":

                    alert(
                        "This meeting already has two participants."
                    );

                    break;


                // ============================================
                // ERROR
                // ============================================

                case "error":

                    console.error(
                        "❌ Server error:",
                        data.message
                    );

                    alert(
                        data.message ||
                        "Server error."
                    );

                    break;


                default:

                    console.log(
                        "ℹ️ Unknown message:",
                        data.type
                    );
            }

        } catch (error) {

            console.error(
                "❌ WebSocket message error:",
                error
            );
        }

    };


    // --------------------------------------------------------
    // ERROR
    // --------------------------------------------------------

    ws.onerror = error => {

        console.error(
            "❌ WebSocket error:",
            error
        );

        updateConnectionStatus(
            "Error"
        );
    };


    // --------------------------------------------------------
    // CLOSE
    // --------------------------------------------------------

    ws.onclose = () => {

        console.log(
            "🔌 WebSocket disconnected."
        );

        if (
            !meetingScreen.classList.contains(
                "hidden"
            )
        ) {

            updateConnectionStatus(
                "Disconnected"
            );
        }
    };
}


// ============================================================
// PARTICIPANT MANAGEMENT
// ============================================================

function addOrUpdateParticipant(
    id,
    name,
    isCreator
) {

    if (!id) {
        return;
    }

    const existing =
        participants.find(
            p => p.id === id
        );

    if (existing) {

        existing.name =
            name || existing.name;

        existing.isCreator =
            Boolean(isCreator);

    } else {

        participants.push({
            id: id,
            name: name || "User",
            isCreator:
                Boolean(isCreator)
        });
    }
}


async function handleParticipantJoined(
    data
) {

    const participantId =
        data.user_id;

    const participantName =
        data.user_name ||
        "User";

    if (!participantId) {
        return;
    }

    // --------------------------------------------------------
    // UPDATE EXISTING
    // --------------------------------------------------------

    addOrUpdateParticipant(
        participantId,
        participantName,
        Boolean(data.is_creator)
    );

    updateParticipantUI();

    console.log(
        `👤 Participant: ${participantName}`
    );


    // --------------------------------------------------------
    // HOST CREATES OFFER
    // --------------------------------------------------------

    if (
        isMeetingCreator &&
        !data.is_creator
    ) {

        await createHostOffer();
    }
}


// ============================================================
// UPDATE PARTICIPANT UI
// ============================================================

function updateParticipantUI() {

    const remote =
        participants.find(
            p => p.id !== "local"
        );

    if (!remote) {

        remoteParticipantLabel.textContent =
            "Waiting...";

        waitingParticipant.classList.remove(
            "hidden"
        );

        return;
    }

    remoteParticipantLabel.textContent =
        remote.name ||
        "User";

    waitingParticipant.classList.add(
        "hidden"
    );

    console.log(
        `👥 Remote participant: ${remote.name}`
    );
}


// ============================================================
// PARTICIPANT LEFT
// ============================================================

function handleParticipantLeft(
    data
) {

    console.log(
        "👋 Participant left:",
        data.user_name
    );

    participants =
        participants.filter(
            p => p.id !== data.user_id
        );

    if (participants.length <= 1) {

        remoteVideo.srcObject =
            null;

        remoteVideo.style.display =
            "none";

        remoteAudio.srcObject =
            null;

        waitingParticipant.classList.remove(
            "hidden"
        );

        remoteParticipantLabel.textContent =
            "Waiting...";

        clearRemoteCanvas();

        closePeerConnection();
    }

    updateParticipantUI();
}

// ============================================================
// LIVEKIT VIDEO + AUDIO
// ============================================================

async function connectLiveKit() {

    if (liveKitConnected) {
        console.log("ℹ️ LiveKit already connected.");
        return;
    }

    if (!window.LivekitClient) {
        console.error("❌ LiveKit SDK not loaded.");
        alert("LiveKit SDK is not loaded. Check index.html.");
        return;
    }

    if (!meetingId) {
        console.error("❌ Meeting ID missing.");
        return;
    }

    if (!localStream) {
        console.error("❌ Local camera/microphone not available.");
        return;
    }

    try {

        const LK = window.LivekitClient;

        console.log("🔵 Connecting to LiveKit...");

        const tokenSource =
            LK.TokenSource.developmentTokenServer(
                LIVEKIT_TOKEN_SERVER_ID
            );

        const credentials =
            await tokenSource.fetch({
                roomName: meetingId,
                participantIdentity:
                    "aircanvas-" +
                    Math.random()
                        .toString(36)
                        .substring(2, 10),
                participantName:
                    userName 
            });

        liveKitRoom =
            new LK.Room({
                adaptiveStream: true,
                dynacast: true
            });


        // ========================================================
        // REMOTE TRACK SUBSCRIBED
        // ========================================================

        liveKitRoom.on(
            LK.RoomEvent.TrackSubscribed,
            (track, publication, participant) => {

                console.log(
                    "📥 LiveKit remote track:",
                    track.kind,
                    participant.name
                );


                const remoteName =
                    participant.name || "User";


                // ------------------------------------------------
                // NAME
                // ------------------------------------------------

                remoteParticipantLabel.textContent =
                    remoteName;


                // ------------------------------------------------
                // PARTICIPANT UI
                // ------------------------------------------------

                addOrUpdateParticipant(
                    "livekit-" + participant.identity,
                    remoteName,
                    false
                );

                updateParticipantUI();


                // ------------------------------------------------
                // VIDEO
                // ------------------------------------------------

                if (
                    track.kind ===
                    LK.Track.Kind.Video
                ) {

                    track.attach(
                        remoteVideo
                    );

                    remoteVideo.autoplay =
                        true;

                    remoteVideo.playsInline =
                        true;

                    remoteVideo.muted =
                        false;

                    remoteVideo.style.display =
                        "block";


                    if (waitingParticipant) {

                        waitingParticipant.classList.add(
                            "hidden"
                        );
                    }


                    remoteVideo.play()
                        .catch(error => {

                            console.warn(
                                "⚠️ Remote video autoplay:",
                                error
                            );
                        });


                    createRemoteCanvas();

                    setTimeout(
                        setupCanvasSizes,
                        300
                    );


                    console.log(
                        "✅ Remote video attached."
                    );
                }


                // ------------------------------------------------
                // AUDIO
                // ------------------------------------------------

                if (
                    track.kind ===
                    LK.Track.Kind.Audio
                ) {

                    track.attach(
                        remoteAudio
                    );

                    remoteAudio.autoplay =
                        true;

                    remoteAudio.muted =
                        false;

                    remoteAudio.volume =
                        1;


                    remoteAudio.play()
                        .catch(error => {

                            console.warn(
                                "⚠️ Remote audio autoplay:",
                                error
                            );
                        });


                    console.log(
                        "🔊 Remote microphone attached."
                    );
                }
            }
        );


        // ========================================================
        // REMOTE PARTICIPANT CONNECTED
        // ========================================================

        liveKitRoom.on(
            LK.RoomEvent.ParticipantConnected,
            participant => {

                console.log(
                    "👤 LiveKit participant joined:",
                    participant.name
                );


                const remoteName =
                    participant.name || "User";


                remoteParticipantLabel.textContent =
                    remoteName;


                addOrUpdateParticipant(
                    "livekit-" + participant.identity,
                    remoteName,
                    false
                );


                updateParticipantUI();


                // Subscribe to tracks that were already published.
                participant.trackPublications
                    .forEach(publication => {

                        if (
                            publication.isSubscribed &&
                            publication.track
                        ) {

                            console.log(
                                "ℹ️ Existing track already subscribed."
                            );
                        }
                    });
            }
        );


        // ========================================================
        // REMOTE PARTICIPANT DISCONNECTED
        // ========================================================

        liveKitRoom.on(
            LK.RoomEvent.ParticipantDisconnected,
            participant => {

                console.log(
                    "👋 LiveKit participant left:",
                    participant.name
                );


                remoteVideo.srcObject =
                    null;

                remoteAudio.srcObject =
                    null;


                remoteVideo.style.display =
                    "none";


                if (waitingParticipant) {

                    waitingParticipant.classList.remove(
                        "hidden"
                    );
                }


                remoteParticipantLabel.textContent =
                    "Waiting...";


                participants =
                    participants.filter(
                        p =>
                            p.id !==
                            "livekit-" +
                            participant.identity
                    );


                clearRemoteCanvas();

                updateParticipantUI();
            }
        );


        // ========================================================
        // CONNECT
        // ========================================================

        await liveKitRoom.connect(
            credentials.serverUrl,
            credentials.participantToken
        );


        liveKitConnected =
            true;


        console.log(
            "✅✅ LIVEKIT CONNECTED"
        );


        // ========================================================
        // PUBLISH CAMERA
        // ========================================================

        const cameraTrack =
            localStream.getVideoTracks()[0];


        if (cameraTrack) {

            await liveKitRoom.localParticipant
                .publishTrack(
                    cameraTrack,
                    {
                        name:
                            "air-canvas-camera",

                        source:
                            LK.Track.Source.Camera
                    }
                );


            console.log(
                "📤 Camera published to LiveKit."
            );
        }


        // ========================================================
        // PUBLISH MICROPHONE
        // ========================================================

        const microphoneTrack =
            localStream.getAudioTracks()[0];


        if (microphoneTrack) {

            await liveKitRoom.localParticipant
                .publishTrack(
                    microphoneTrack,
                    {
                        name:
                            "air-canvas-microphone",

                        source:
                            LK.Track.Source.Microphone
                    }
                );


            console.log(
                "📤 Microphone published to LiveKit."
            );
        }


        // ========================================================
        // EXISTING REMOTE PARTICIPANTS
        // ========================================================

        liveKitRoom.remoteParticipants
            .forEach(participant => {

                const remoteName =
                    participant.name || "User";


                remoteParticipantLabel.textContent =
                    remoteName;


                addOrUpdateParticipant(
                    "livekit-" +
                    participant.identity,

                    remoteName,

                    false
                );
            });


        updateParticipantUI();


    } catch (error) {

        console.error(
            "❌ LiveKit connection failed:",
            error
        );

        liveKitRoom = null;
        liveKitConnected = false;

        alert(
            "Could not connect video/audio through LiveKit. Check the browser console."
        );
    }
}


// ============================================================
// DISCONNECT LIVEKIT
// ============================================================

function disconnectLiveKit() {

    if (liveKitRoom) {

        try {

            liveKitRoom.disconnect();

        } catch (error) {

            console.error(
                "❌ LiveKit disconnect error:",
                error
            );
        }
    }


    liveKitRoom =
        null;

    liveKitConnected =
        false;


    if (remoteVideo) {

        remoteVideo.srcObject =
            null;

        remoteVideo.style.display =
            "none";
    }


    if (remoteAudio) {

        remoteAudio.srcObject =
            null;
    }
}

// ============================================================
// REMOTE CANVAS POSITION
// ============================================================

function createRemoteCanvas() {

    if (remoteCanvas) {
        return;
    }


    const remoteContainer =
        remoteVideo.parentElement;


    if (!remoteContainer) {

        console.error(
            "❌ Remote video container not found."
        );

        return;
    }


    remoteContainer.style.position =
        "relative";


    remoteCanvas =
        document.createElement(
            "canvas"
        );


    remoteCanvas.id =
        "remoteCanvas";


    remoteCanvas.style.position =
        "absolute";

    remoteCanvas.style.top =
        "0";

    remoteCanvas.style.left =
        "0";

    remoteCanvas.style.width =
        "100%";

    remoteCanvas.style.height =
        "100%";

    remoteCanvas.style.pointerEvents =
        "none";

    remoteCanvas.style.zIndex =
        "10";


    remoteContainer.appendChild(
        remoteCanvas
    );


    remoteCtx =
        remoteCanvas.getContext(
            "2d"
        );


    console.log(
        "✅ Remote drawing canvas created."
    );
}

// ============================================================
// MEDIAPIPE
// ============================================================

function initMediaPipe() {

    if (mediaPipeStarted) {
        return;
    }

    try {

        hands =
            new Hands({

                locateFile:
                    file =>
                        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
            });


        hands.setOptions({

            maxNumHands: 1,

            modelComplexity: 1,

            minDetectionConfidence:
                0.7,

            minTrackingConfidence:
                0.5
        });


        hands.onResults(
            onResults
        );


        camera =
            new Camera(
                video,
                {

                    onFrame:
                        async () => {

                            await hands.send({
                                image: video
                            });
                        },

                    width: 1280,

                    height: 720
                }
            );


        camera.start();

        mediaPipeStarted =
            true;

        console.log(
            "🖐️ MediaPipe started."
        );

    } catch (error) {

        console.error(
            "❌ MediaPipe initialization failed:",
            error
        );
    }
}


// ============================================================
// MEDIAPIPE RESULTS
// ============================================================
// ============================================================
// MEDIAPIPE RESULTS
// ============================================================

function onResults(results) {

    // --------------------------------------------------------
    // CLEAR LANDMARK OVERLAY
    // --------------------------------------------------------

    landmarkCtx.clearRect(
        0,
        0,
        landmarkCanvas.width,
        landmarkCanvas.height
    );


    // --------------------------------------------------------
    // NO HAND
    // --------------------------------------------------------

    if (
        !results.multiHandLandmarks ||
        results.multiHandLandmarks.length === 0
    ) {

        gestureDisplay.textContent =
            "NO GESTURE";

        confidenceDisplay.textContent =
            "--";

        activeGesture =
            "no_gesture";

        resetDrawingState();

        return;
    }


    // --------------------------------------------------------
    // GET HAND
    // --------------------------------------------------------

    const landmarks =
        results.multiHandLandmarks[0];


    // --------------------------------------------------------
    // DRAW HAND SKELETON
    // --------------------------------------------------------

    drawConnectors(
        landmarkCtx,
        landmarks,
        HAND_CONNECTIONS,
        {
            color: "#00FF00",
            lineWidth: 2
        }
    );


    drawLandmarks(
        landmarkCtx,
        landmarks,
        {
            color: "#FF0000",
            lineWidth: 1,
            radius: 3
        }
    );


    // --------------------------------------------------------
    // LANDMARK VALUES
    // --------------------------------------------------------

    const values = [];

    landmarks.forEach(
        point => {

            values.push(
                point.x,
                point.y
            );
        }
    );


    // ========================================================
    // IMPORTANT:
    // DRAW USING THE LATEST CONFIRMED GESTURE
    //
    // DO NOT WAIT FOR PYTHON HERE.
    // ========================================================

    if (activeGesture === "draw") {

        drawOnCanvas(
            values
        );

    }

    else if (activeGesture === "erase") {

        eraseFromCanvas(
            values
        );

    }

    else if (
        activeGesture === "no_gesture"
    ) {

        resetDrawingState();

    }


    // ========================================================
    // SEND LANDMARKS TO BACKEND
    //
    // Backend is ONLY responsible for deciding gesture.
    // Drawing itself happens continuously above.
    // ========================================================

    const now =
        Date.now();


    if (
        now - lastDrawTime >
        DRAW_THROTTLE_MS
    ) {

        lastDrawTime =
            now;

        pendingLandmarks =
            values;

        requestGesturePrediction();
    }
}

// ============================================================
// INDEX FINGER STRAIGHT CHECK
// ============================================================

function isIndexFingerStraight(landmarks) {

    // MediaPipe index finger landmarks:
    //
    // 5  = index MCP
    // 6  = index PIP
    // 7  = index DIP
    // 8  = index TIP

    const mcp = landmarks[5];
    const pip = landmarks[6];
    const dip = landmarks[7];
    const tip = landmarks[8];

    if (!mcp || !pip || !dip || !tip) {
        return false;
    }


    // Calculate the angle at PIP.
    // A straight finger is close to 180 degrees.
    const angle = calculateAngle(
        mcp,
        pip,
        dip
    );


    // Also check that the fingertip is
    // sufficiently far from the MCP.
    const fingerLength =
        Math.hypot(
            tip.x - mcp.x,
            tip.y - mcp.y
        );


    // Straightness threshold.
    //
    // 180° = perfectly straight.
    // We allow some natural bending.
    const MIN_INDEX_ANGLE = 155;

    const MIN_FINGER_LENGTH = 0.10;


    return (
        angle >= MIN_INDEX_ANGLE &&
        fingerLength >= MIN_FINGER_LENGTH
    );
}


// ============================================================
// LANDMARK ANGLE
// ============================================================

function calculateAngle(
    a,
    b,
    c
) {

    const BAx =
        a.x - b.x;

    const BAy =
        a.y - b.y;

    const BCx =
        c.x - b.x;

    const BCy =
        c.y - b.y;


    const dot =
        BAx * BCx +
        BAy * BCy;


    const magnitudeBA =
        Math.hypot(
            BAx,
            BAy
        );

    const magnitudeBC =
        Math.hypot(
            BCx,
            BCy
        );


    if (
        magnitudeBA === 0 ||
        magnitudeBC === 0
    ) {
        return 0;
    }


    let cosine =
        dot /
        (magnitudeBA *
         magnitudeBC);


    // Protect against floating-point
    // values slightly outside [-1, 1].
    cosine =
        Math.max(
            -1,
            Math.min(
                1,
                cosine
            )
        );


    return (
        Math.acos(cosine) *
        180 /
        Math.PI
    );
}
// ============================================================
// SEND LANDMARKS TO TRAINED MODEL
// ============================================================
// ============================================================
// SEND LANDMARKS TO TRAINED MODEL
// ============================================================

async function requestGesturePrediction() {

    // --------------------------------------------------------
    // Don't create multiple simultaneous requests
    // --------------------------------------------------------

    if (
        backendRequestInFlight ||
        !pendingLandmarks
    ) {

        return;
    }


    backendRequestInFlight =
        true;


    const values =
        pendingLandmarks;

    pendingLandmarks =
        null;


    try {

        const response =
            await fetch(
                "http://localhost:8000/predict",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            landmarks:
                                values
                        })
                }
            );


        if (!response.ok) {

            throw new Error(
                `HTTP ${response.status}`
            );
        }


        const result =
            await response.json();


        const gesture =
            (
                result.confirmed_gesture ||
                "no_gesture"
            )
                .toString()
                .toLowerCase();


        // ----------------------------------------------------
        // UPDATE CURRENT GESTURE
        // ----------------------------------------------------

        activeGesture =
            gesture;


        // ----------------------------------------------------
        // DISPLAY GESTURE
        // ----------------------------------------------------

        gestureDisplay.textContent =
            gesture === "no_gesture"
                ? "NO GESTURE"
                : gesture.toUpperCase();


        // ----------------------------------------------------
        // DISPLAY CONFIDENCE
        // ----------------------------------------------------

        if (
            result.confidence !==
            undefined
        ) {

            confidenceDisplay.textContent =
                `${Math.round(
                    result.confidence * 100
                )}%`;

        }

        else {

            confidenceDisplay.textContent =
                "--";
        }


        // ====================================================
        // GESTURE STATE CHANGES
        // ====================================================

        switch (gesture) {


            // ------------------------------------------------
            // DRAW
            // ------------------------------------------------

            case "draw":

                // Don't draw here.
                //
                // onResults() is already drawing continuously.
                //
                // This response ONLY changes the state.

                break;


            // ------------------------------------------------
            // ERASE
            // ------------------------------------------------

            case "erase":

                // Erasing is handled continuously
                // from onResults().

                break;


            // ------------------------------------------------
            // CLEAR
            // ------------------------------------------------

            case "clear":

                clearCanvas();

                resetDrawingState();

                console.log(
                    "🧹 My drawing cleared."
                );

                break;


            // ------------------------------------------------
            // NO GESTURE
            // ------------------------------------------------

            case "no_gesture":

            default:

                resetDrawingState();

                break;
        }


    }

    catch (error) {

        console.error(
            "❌ Backend prediction error:",
            error
        );

        activeGesture =
            "no_gesture";

        resetDrawingState();

    }

    finally {

        backendRequestInFlight =
            false;


        // ----------------------------------------------------
        // If a newer frame arrived while Python was busy,
        // immediately process the newest one.
        // ----------------------------------------------------

        if (pendingLandmarks) {

            requestGesturePrediction();
        }
    }
}


// ============================================================
// LOCAL DRAWING
// ============================================================
// ============================================================
// LOCAL DRAWING - SMOOTH + CONTINUOUS
// ============================================================

function drawOnCanvas(
    values
) {

    const rawX =
        values[16];

    const rawY =
        values[17];


    // --------------------------------------------------------
    // CONVERT NORMALIZED COORDINATES
    // --------------------------------------------------------

    const targetX =
        rawX *
        airCanvas.width;

    const targetY =
        rawY *
        airCanvas.height;


    // ========================================================
    // SMOOTHING
    // ========================================================

    const SMOOTHING_FACTOR =
        0.45;


    if (
        window.smoothDrawX === null ||
        window.smoothDrawX === undefined
    ) {

        window.smoothDrawX =
            targetX;

        window.smoothDrawY =
            targetY;

    }

    else {

        window.smoothDrawX +=
            (
                targetX -
                window.smoothDrawX
            ) *
            SMOOTHING_FACTOR;


        window.smoothDrawY +=
            (
                targetY -
                window.smoothDrawY
            ) *
            SMOOTHING_FACTOR;
    }


    const displayedX =
        window.smoothDrawX;

    const displayedY =
        window.smoothDrawY;


    // ========================================================
    // START NEW STROKE
    // ========================================================

    if (!isDrawing) {

        isDrawing =
            true;

        lastX =
            displayedX;

        lastY =
            displayedY;

        return;
    }


    // ========================================================
    // MOVEMENT
    // ========================================================

    const dx =
        displayedX -
        lastX;

    const dy =
        displayedY -
        lastY;


    const distance =
        Math.hypot(
            dx,
            dy
        );


    // Ignore only extremely tiny camera jitter.
    if (distance < 0.5) {

        return;
    }


    // ========================================================
    // PROTECT AGAINST SUDDEN LANDMARK JUMPS
    // ========================================================

    const MAX_JUMP =
        Math.max(
            airCanvas.width,
            airCanvas.height
        ) * 0.12;


    if (
        distance >
        MAX_JUMP
    ) {

        lastX =
            displayedX;

        lastY =
            displayedY;

        return;
    }


    // ========================================================
    // DRAW
    // ========================================================

    airCtx.beginPath();

    airCtx.moveTo(
        lastX,
        lastY
    );

    airCtx.lineTo(
        displayedX,
        displayedY
    );


    airCtx.strokeStyle =
        "#00ff00";


    airCtx.lineWidth =
        3;


    airCtx.lineCap =
        "round";


    airCtx.lineJoin =
        "round";


    airCtx.stroke();


    // ========================================================
    // SEND TO PARTICIPANT
    // ========================================================

    const now =
        Date.now();


    if (
        ws &&
        ws.readyState ===
            WebSocket.OPEN &&
        now - lastNetworkDrawTime >=
            NETWORK_DRAW_INTERVAL
    ) {

        lastNetworkDrawTime =
            now;


        ws.send(
            JSON.stringify({

                type:
                    "draw_data",

                action:
                    "draw",

                x:
                    displayedX /
                    airCanvas.width,

                y:
                    displayedY /
                    airCanvas.height,

                lastX:
                    lastX /
                    airCanvas.width,

                lastY:
                    lastY /
                    airCanvas.height,

                color:
                    "#00ff00",

                lineWidth:
                    3
            })
        );
    }


    // ========================================================
    // UPDATE LAST POSITION
    // ========================================================

    lastX =
        displayedX;

    lastY =
        displayedY;
}
// ============================================================
// LOCAL ERASE
// ============================================================

function eraseFromCanvas(values) {

    // --------------------------------------------------------
    // INDEX FINGER TIP
    // --------------------------------------------------------

    const rawX =
        values[16];

    const rawY =
        values[17];


    // --------------------------------------------------------
    // CONVERT TO CANVAS COORDINATES
    // --------------------------------------------------------

    const x =
        rawX *
        airCanvas.width;

    const y =
        rawY *
        airCanvas.height;


    // --------------------------------------------------------
    // ERASE LOCALLY
    // --------------------------------------------------------

    airCtx.globalCompositeOperation =
        "destination-out";


    airCtx.beginPath();

    airCtx.arc(
        x,
        y,
        20,
        0,
        2 * Math.PI
    );

    airCtx.fill();


    // --------------------------------------------------------
    // RESTORE NORMAL DRAWING
    // --------------------------------------------------------

    airCtx.globalCompositeOperation =
        "source-over";


    // --------------------------------------------------------
    // SEND ERASE TO OTHER PARTICIPANT
    // --------------------------------------------------------

    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {

        ws.send(
            JSON.stringify({

                type:
                    "draw_data",

                action:
                    "erase",

                x:
                    rawX,

                y:
                    rawY
            })
        );
    }


    // --------------------------------------------------------
    // RESET DRAWING STATE
    // --------------------------------------------------------

    isDrawing =
        false;

    lastX =
        0;

    lastY =
        0;
}

// ============================================================
// RESET DRAWING STATE
// ============================================================

function resetDrawingState() {

    isDrawing =
        false;

    lastX =
        0;

    lastY =
        0;

    window.smoothDrawX =
        null;

    window.smoothDrawY =
        null;
}

// ============================================================
// CLEAR CANVAS
// ============================================================
// ============================================================
// CLEAR MY DRAWING
// ============================================================

function clearCanvas() {

    // --------------------------------------------------------
    // CLEAR ONLY MY LOCAL DRAWING
    // --------------------------------------------------------

    clearLocalCanvasOnly();


    // --------------------------------------------------------
    // TELL THE OTHER BROWSER TO CLEAR
    // THEIR REMOTE COPY OF MY DRAWING
    // --------------------------------------------------------

    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {

        ws.send(
            JSON.stringify({

                type:
                    "clear_canvas"

            })
        );

        console.log(
            "📤 Clear command sent to participant."
        );
    }


    // --------------------------------------------------------
    // RESET DRAWING STATE
    // --------------------------------------------------------

    isDrawing =
        false;

    lastX =
        0;

    lastY =
        0;

    window.smoothDrawX =
        null;

    window.smoothDrawY =
        null;
}
// ============================================================
// CLEAR LOCAL CANVAS
// ============================================================

function clearLocalCanvasOnly() {

    airCtx.clearRect(
        0,
        0,
        airCanvas.width,
        airCanvas.height
    );

    isDrawing =
        false;

    lastX =
        0;

    lastY =
        0;
}


// ============================================================
// CLEAR REMOTE CANVAS
// ============================================================

function clearRemoteCanvas() {

    if (
        !remoteCtx ||
        !remoteCanvas
    ) {

        return;
    }

    remoteCtx.clearRect(
        0,
        0,
        remoteCanvas.width,
        remoteCanvas.height
    );
}


// ============================================================
// DRAW REMOTE LINE
// ============================================================

function drawRemoteLine(
    data
) {

    if (!remoteCanvas) {

        createRemoteCanvas();
    }

    if (!remoteCtx) {

        console.error(
            "❌ Remote drawing context unavailable."
        );

        return;
    }


    // --------------------------------------------------------
    // REMOTE ERASE
    // --------------------------------------------------------

    if (
        data.action ===
        "erase"
    ) {

        eraseRemotePoint(
            data
        );

        return;
    }


    // --------------------------------------------------------
    // REMOTE DRAW
    // --------------------------------------------------------

    const x =
        Number(data.x) *
        remoteCanvas.width;

    const y =
        Number(data.y) *
        remoteCanvas.height;

    const lX =
        Number(data.lastX) *
        remoteCanvas.width;

    const lY =
        Number(data.lastY) *
        remoteCanvas.height;


    remoteCtx.beginPath();

    remoteCtx.moveTo(
        lX,
        lY
    );

    remoteCtx.lineTo(
        x,
        y
    );

    remoteCtx.strokeStyle =
        data.color ||
        "#00ff00";

    remoteCtx.lineWidth =
        data.lineWidth ||
        3;

    remoteCtx.lineCap =
        "round";

    remoteCtx.lineJoin =
        "round";

    remoteCtx.stroke();


    console.log(
        "🎨 Remote drawing rendered."
    );
}


// ============================================================
// REMOTE ERASE
// ============================================================

function eraseRemotePoint(
    data
) {

    if (!remoteCtx) {
        return;
    }


    const x =
        Number(data.x) *
        remoteCanvas.width;

    const y =
        Number(data.y) *
        remoteCanvas.height;


    remoteCtx.globalCompositeOperation =
        "destination-out";


    remoteCtx.beginPath();

    remoteCtx.arc(
        x,
        y,
        20,
        0,
        2 * Math.PI
    );


    remoteCtx.fill();


    remoteCtx.globalCompositeOperation =
        "source-over";
}


// ============================================================
// MUTE
// ============================================================

function toggleMute() {

    if (!localStream) {
        return;
    }

    const tracks =
        localStream.getAudioTracks();

    if (
        tracks.length === 0
    ) {

        return;
    }


    const currentlyEnabled =
        tracks[0].enabled;


    tracks.forEach(
        track => {

            track.enabled =
                !currentlyEnabled;
        }
    );


    if (
        currentlyEnabled
    ) {

        muteButton.textContent =
            "🔇 Muted";

        muteButton.classList.add(
            "muted"
        );

    } else {

        muteButton.textContent =
            "🎤 Mic";

        muteButton.classList.remove(
            "muted"
        );
    }
}


// ============================================================
// CAMERA TOGGLE
// ============================================================

function toggleCamera() {

    if (!localStream) {
        return;
    }

    const tracks =
        localStream.getVideoTracks();

    if (
        tracks.length === 0
    ) {

        return;
    }


    const currentlyEnabled =
        tracks[0].enabled;


    tracks.forEach(
        track => {

            track.enabled =
                !currentlyEnabled;
        }
    );


    if (
        currentlyEnabled
    ) {

        cameraButton.textContent =
            "🚫 Camera Off";

        cameraButton.classList.add(
            "camera-off"
        );

    } else {

        cameraButton.textContent =
            "📹 Camera";

        cameraButton.classList.remove(
            "camera-off"
        );
    }
}


// ============================================================
// COPY MEETING ID
// ============================================================

async function copyMeetingIdToClipboard() {

    if (!meetingId) {
        return;
    }

    try {

        await navigator.clipboard.writeText(
            meetingId
        );

        copyMeetingId.textContent =
            "✅ Copied!";

        setTimeout(
            () => {

                copyMeetingId.textContent =
                    "Copy ID";

            },
            1500
        );

    } catch (error) {

        console.error(
            "❌ Copy failed:",
            error
        );
    }
}


// ============================================================
// CLOSE PEER CONNECTION
// ============================================================

function closePeerConnection() {

    if (peerConnection) {

        try {

            peerConnection.close();

        } catch (error) {

            console.error(
                "Peer close error:",
                error
            );
        }

        peerConnection =
            null;
    }

    pendingIceCandidates = [];
}


// ============================================================
// LEAVE MEETING
// ============================================================

function leaveMeeting() {

    if (
        ws &&
        ws.readyState ===
            WebSocket.OPEN
    ) {

        ws.send(
            JSON.stringify({
                type:
                    "leave_meeting"
            })
        );
    }


    closePeerConnection();


    if (ws) {

        try {
            ws.close();
        } catch (error) {}

        ws = null;
    }


    if (localStream) {

        localStream
            .getTracks()
            .forEach(
                track =>
                    track.stop()
            );

        localStream =
            null;
    }


    if (camera) {

        try {
            camera.stop();
        } catch (error) {}

        camera =
            null;
    }


    mediaPipeStarted =
        false;

    isCameraStarted =
        false;


    meetingScreen.classList.add(
        "hidden"
    );

    homeScreen.classList.remove(
        "hidden"
    );


    homeStartCamera.textContent =
        "🎥 Start Camera";

    homeStartCamera.disabled =
        false;


    startCameraBtn.textContent =
        "Start Camera";

    startCameraBtn.disabled =
        false;


    cameraStatus.textContent =
        "Camera is off";


    remoteVideo.srcObject =
        null;

    remoteVideo.style.display =
        "none";


    remoteAudio.srcObject =
        null;


    clearLocalCanvasOnly();

    clearRemoteCanvas();


    landmarkCtx.clearRect(
        0,
        0,
        landmarkCanvas.width,
        landmarkCanvas.height
    );


    participants = [];

    creatorName = "";

    meetingId = null;

    userName = "";

    isMeetingCreator =
        false;


    console.log(
        "👋 Left meeting."
    );
}


// ============================================================
// GENERATE MEETING ID
// ============================================================

function generateMeetingId() {

    const chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    let id = "";


    for (
        let i = 0;
        i < 6;
        i++
    ) {

        id +=
            chars.charAt(
                Math.floor(
                    Math.random() *
                    chars.length
                )
            );
    }


    return id;
}


// ============================================================
// END
// ============================================================

console.log(
    "🚀 Air Canvas app.js loaded."
);