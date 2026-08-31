// ============================================================
// AIR CANVAS MEETING - APP.JS
// ============================================================

// ============================================================
// BACKEND / WEBSOCKET

// ============================================================
// SERVER CONNECTION
// ============================================================

// CHANGE ONLY THIS LINE when Cloudflare gives a new URL.
const SERVER_URL =
    "https://yang-adopted-board-bureau.trycloudflare.com";

// Everything else automatically uses SERVER_URL.
const BACKEND_BASE =
    SERVER_URL;

const WS_BASE =
    SERVER_URL
        .replace(/^https:\/\//, "wss://")
        .replace(/^http:\/\//, "ws://");


// ============================================================
// ELEMENTS
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

const joinMeetingButton =
    document.getElementById("joinMeetingButton");

const meetingIdInput =
    document.getElementById("meetingIdInput");

const meetingIdDisplay =
    document.getElementById("meetingIdDisplay");

const meetingIdLarge =
    document.getElementById("meetingIdLarge");

const copyMeetingId =
    document.getElementById("copyMeetingId");

const video =
    document.getElementById("video");

const remoteVideo =
    document.getElementById("remoteVideo");

const waitingParticipant =
    document.getElementById("waitingParticipant");

const airCanvas =
    document.getElementById("airCanvas");

const landmarkCanvas =
    document.getElementById("landmarkCanvas");

const airCtx =
    airCanvas.getContext("2d");

const landmarkCtx =
    landmarkCanvas.getContext("2d");

const gestureElement =
    document.getElementById("gesture");

const confidenceElement =
    document.getElementById("confidence");

const connectionStatus =
    document.getElementById("connectionStatus");

const startCameraButton =
    document.getElementById("startCamera");

const clearCanvasButton =
    document.getElementById("clearCanvas");

const muteButton =
    document.getElementById("muteButton");

const cameraButton =
    document.getElementById("cameraButton");

const leaveMeetingButton =
    document.getElementById("leaveMeeting");

const localParticipantLabel =
    document.getElementById("localParticipantLabel");

const remoteParticipantLabel =
    document.getElementById("remoteParticipantLabel");

const requestDrawPermissionButton =
    document.getElementById("requestDrawPermission");


// ============================================================
// STATE
// ============================================================
let gestureHistory = [];

let lastConfirmedGesture = "no_gesture";

let stream = null;

let hands = null;

let mediaPipeReady = false;

let processing = false;

let processingFrame = false;

let currentGesture = "no_gesture";

let lastPredictionTime = 0;

const PREDICTION_INTERVAL = 180;

let predictionRunning = false;


// ============================================================
// DRAWING
// ============================================================

let lastDrawPoint = null;

let smoothX = null;

let smoothY = null;

const SMOOTHING = 0.65;


// ============================================================
// MEETING
// ============================================================

let currentMeetingId = null;

let myName = "";

let remoteName = "Participant";

let isHost = false;

// Drawing permission
let participantDrawPermission = false;
let permissionRequestPending = false;

// ============================================================
// AUDIO / VIDEO
// ============================================================

let isMuted = false;

let isCameraOff = false;


// ============================================================
// WEBSOCKET
// ============================================================

let socket = null;


// ============================================================
// WEBRTC
// ============================================================

let peerConnection = null;

let dataChannel = null;


// ============================================================
// WEBRTC CONFIG
// ============================================================

const rtcConfiguration = {

    iceServers: [

        {
            urls:
                "stun:stun.l.google.com:19302"
        }

    ]

};
// ============================================================
// WEBRTC
// ============================================================

function createPeerConnection() {

    if (peerConnection) {

        return peerConnection;
    }


    peerConnection =
        new RTCPeerConnection(
            rtcConfiguration
        );


    // ========================================================
    // LOCAL AUDIO + VIDEO
    // ========================================================

    if (stream) {

        console.log("Adding tracks to peer connection:");
        stream
            .getTracks()
            .forEach(
                track => {
                    console.log("  -", track.kind, "enabled:", track.enabled);
                    peerConnection.addTrack(
                        track,
                        stream
                    );

                }
            );
    } else {
        console.warn("No stream available to add tracks!");
    }


    // ========================================================
    // REMOTE AUDIO + VIDEO
    // ========================================================

    peerConnection.ontrack =
        function(event) {

            console.log(
                "Remote track received:",
                event.track.kind
            );

            if (event.track.kind === "video") {
                if (
                    event.streams &&
                    event.streams[0]
                ) {

                    remoteVideo.srcObject =
                        event.streams[0];


                    remoteVideo.style.display =
                        "block";


                    if (
                        waitingParticipant
                    ) {

                        waitingParticipant.style.display =
                            "none";
                    }
                }
            } else if (event.track.kind === "audio") {
                if (
                    event.streams &&
                    event.streams[0]
                ) {
                    // Try to get remote audio element
                    const remoteAudio = document.getElementById("remoteAudio");
                    if (remoteAudio) {
                        remoteAudio.srcObject = event.streams[0];
                        remoteAudio.play().catch(e => {
                            console.log("Audio play error:", e);
                        });
                        console.log("Remote audio attached to audio element.");
                    } else {
                        // Fallback: attach to video element
                        remoteVideo.srcObject = event.streams[0];
                        console.log("Remote audio attached to video element (fallback).");
                    }
                }
            }
        };


    // ========================================================
    // ICE CANDIDATES
    // ========================================================

    peerConnection.onicecandidate =
        function(event) {

            if (
                event.candidate &&
                socket &&
                socket.readyState ===
                    WebSocket.OPEN
            ) {

                socket.send(
                    JSON.stringify({

                        type:
                            "ice_candidate",

                        candidate:
                            event.candidate

                    })
                );
            }
        };


    // ========================================================
    // REMOTE DATA CHANNEL
    // ========================================================

    peerConnection.ondatachannel =
        function(event) {

            console.log(
                "Remote data channel received."
            );


            setupDataChannel(
                event.channel
            );
        };


    // ========================================================
    // CONNECTION STATE
    // ========================================================

    peerConnection.onconnectionstatechange =
        function() {

            if (
                !peerConnection
            ) {

                return;
            }


            const state =
                peerConnection.connectionState;


            console.log(
                "WebRTC:",
                state
            );


            if (
                state ===
                "connected"
            ) {

                connectionStatus.textContent =
                    "Meeting: Connected";


            } else if (
                state ===
                "connecting"
            ) {

                connectionStatus.textContent =
                    "Meeting: Connecting...";


            } else if (
                state ===
                "disconnected"
            ) {

                connectionStatus.textContent =
                    "Meeting: Disconnected";


            } else if (
                state ===
                "failed"
            ) {

                connectionStatus.textContent =
                    "Meeting: Connection Failed";
            }
        };


    return peerConnection;
}


// ============================================================
// CANVAS
// ============================================================

function setupCanvasSize() {

    if (
        !video.videoWidth ||
        !video.videoHeight
    ) {
        return;
    }

    airCanvas.width =
        video.videoWidth;

    airCanvas.height =
        video.videoHeight;

    landmarkCanvas.width =
        video.videoWidth;

    landmarkCanvas.height =
        video.videoHeight;

    resetCanvasContext();
}


function resetCanvasContext() {

    airCtx.globalCompositeOperation =
        "source-over";

    airCtx.strokeStyle =
        "#2563eb";

    airCtx.lineWidth =
        5;

    airCtx.lineCap =
        "round";

    airCtx.lineJoin =
        "round";
}


// ============================================================
// STOP DRAWING
// ============================================================

function stopDrawing() {

    lastDrawPoint =
        null;

    smoothX =
        null;

    smoothY =
        null;
}


// ============================================================
// USERNAME
// ============================================================

function getNameFromUI() {

    const name =
        userNameInput.value
            .trim()
            .slice(0, 30);

    if (!name) {

        userNameInput.focus();

        alert(
            "Please enter your name first."
        );

        return null;
    }

    localStorage.setItem(
        "airCanvasUserName",
        name
    );

    return name;
}


// Load previously used name

const savedName =
    localStorage.getItem(
        "airCanvasUserName"
    );

if (savedName) {

    userNameInput.value =
        savedName;

}


// ============================================================
// PARTICIPANT NAMES
// ============================================================

function updateParticipantNames() {

    if (localParticipantLabel) {

        localParticipantLabel.textContent =
            myName
                ? `${myName} (${isHost ? "Host" : "Participant"})`
                : "You";
    }

    if (remoteParticipantLabel) {

        remoteParticipantLabel.textContent =
            remoteName
                ? `${remoteName} (${isHost ? "Participant" : "Host"})`
                : "Participant";
    }
}


// ============================================================
// CAMERA STATUS
// ============================================================

function updateCameraStatus() {

    if (!stream) {

        cameraStatus.textContent =
            "Camera is off";

        return;
    }

    const videoTracks =
        stream.getVideoTracks();

    const audioTracks =
        stream.getAudioTracks();

    const cameraOn =
        videoTracks.some(
            track => track.enabled
        );

    const micOn =
        audioTracks.some(
            track => track.enabled
        );

    if (cameraOn && micOn) {

        cameraStatus.textContent =
            "Camera and microphone are on";

    } else if (cameraOn) {

        cameraStatus.textContent =
            "Camera is on • Microphone is muted";

    } else {

        cameraStatus.textContent =
            "Camera is off";
    }
}


// ============================================================
// START CAMERA
// ============================================================

async function startCamera() {

    if (stream) {

        updateCameraStatus();

        return true;
    }

    try {

        if (
            !navigator.mediaDevices ||
            !navigator.mediaDevices.getUserMedia
        ) {

            alert(
                "Camera and microphone are not supported in this browser."
            );

            return false;
        }

        if (homeStartCamera) {

            homeStartCamera.disabled =
                true;
        }

        if (startCameraButton) {

            startCameraButton.disabled =
                true;
        }

        cameraStatus.textContent =
            "Starting camera...";

        stream =
            await navigator.mediaDevices
                .getUserMedia({

                    video: {

                        width: {
                            ideal: 1280
                        },

                        height: {
                            ideal: 720
                        }

                    },

                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }

                });

        console.log("Stream tracks:", stream.getTracks().map(t => t.kind));

        video.srcObject =
            stream;

        await video.play();

        setupCanvasSize();

        setupMediaPipe();

        processing =
            true;

        processingFrame =
            false;

        processVideo();

        if (homeStartCamera) {

            homeStartCamera.textContent =
                "✓ Camera Started";

            homeStartCamera.disabled =
                false;
        }

        if (startCameraButton) {

            startCameraButton.textContent =
                "Camera Running";

            startCameraButton.disabled =
                false;
        }

        updateCameraStatus();

        console.log(
            "Camera and microphone started."
        );

        return true;

    } catch (error) {

        console.error(
            "Camera error:",
            error
        );

        stream = null;

        processing =
            false;

        if (homeStartCamera) {

            homeStartCamera.disabled =
                false;

            homeStartCamera.textContent =
                "🎥 Start Camera";
        }

        if (startCameraButton) {

            startCameraButton.disabled =
                false;

            startCameraButton.textContent =
                "Start Camera";
        }

        cameraStatus.textContent =
            "Camera is off";

        alert(
            "Could not access camera/microphone.\n\nPlease allow camera and microphone permission."
        );

        return false;
    }
}


// ============================================================
// STOP CAMERA
// ============================================================

function stopCamera() {

    processing =
        false;

    if (stream) {

        stream
            .getTracks()
            .forEach(
                track => track.stop()
            );
    }

    stream = null;

    video.srcObject =
        null;

    stopDrawing();

    if (homeStartCamera) {

        homeStartCamera.disabled =
            false;

        homeStartCamera.textContent =
            "🎥 Start Camera";
    }

    if (startCameraButton) {

        startCameraButton.disabled =
            false;

        startCameraButton.textContent =
            "Start Camera";
    }

    updateCameraStatus();
}


// ============================================================
// MEDIAPIPE
// ============================================================

function setupMediaPipe() {

    if (mediaPipeReady) {
        return;
    }

    hands =
        new Hands({

            locateFile:
                function(file) {

                    return (
                        "https://cdn.jsdelivr.net/npm/" +
                        "@mediapipe/hands/" +
                        file
                    );

                }

        });

    hands.setOptions({

        maxNumHands: 1,

        modelComplexity: 1,

        minDetectionConfidence: 0.5,

        minTrackingConfidence: 0.5

    });

    hands.onResults(
        handleHandResults
    );

    mediaPipeReady =
        true;
}


// ============================================================
// PROCESS VIDEO
// ============================================================

async function processVideo() {

    if (!processing) {
        return;
    }

    if (processingFrame) {

        requestAnimationFrame(
            processVideo
        );

        return;
    }

    if (
        mediaPipeReady &&
        hands &&
        video.readyState >= 2
    ) {

        processingFrame =
            true;

        try {

            await hands.send({

                image: video

            });

        } catch (error) {

            console.error(
                "MediaPipe error:",
                error
            );

        } finally {

            processingFrame =
                false;
        }
    }

    requestAnimationFrame(
        processVideo
    );
}


// ============================================================
// HAND RESULTS
// ============================================================

function handleHandResults(
    results
) {

    // ========================================================
    // CHECK LANDMARK CANVAS
    // ========================================================

    if (
        !landmarkCanvas.width ||
        !landmarkCanvas.height
    ) {

        return;
    }


    // ========================================================
    // CLEAR PREVIOUS LANDMARKS
    // ========================================================

    landmarkCtx.clearRect(
        0,
        0,
        landmarkCanvas.width,
        landmarkCanvas.height
    );


    // ========================================================
    // NO HAND DETECTED
    // ========================================================

    if (
        !results.multiHandLandmarks ||
        results.multiHandLandmarks.length === 0
    ) {

        if (gestureElement) {

            gestureElement.textContent =
                "NO GESTURE";
        }


        if (confidenceElement) {

            confidenceElement.textContent =
                "--";
        }


        currentGesture =
            "no_gesture";


        gestureHistory =
            [];


        lastConfirmedGesture =
            "no_gesture";


        stopDrawing();


        return;
    }


    // ========================================================
    // GET FIRST HAND
    // ========================================================

    const landmarks =
        results.multiHandLandmarks[0];


    // ========================================================
    // DRAW HAND LANDMARKS
    // ========================================================

    if (
        typeof drawConnectors ===
        "function"
    ) {

        drawConnectors(

            landmarkCtx,

            landmarks,

            HAND_CONNECTIONS,

            {

                color:
                    "#00ff00",

                lineWidth:
                    2

            }
        );
    }


    if (
        typeof drawLandmarks ===
        "function"
    ) {

        drawLandmarks(

            landmarkCtx,

            landmarks,

            {

                color:
                    "#ff0000",

                lineWidth:
                    1,

                radius:
                    3

            }
        );
    }


    // ========================================================
    // CREATE 42 LANDMARK VALUES
    // ========================================================

    const values = [];


    landmarks.forEach(
        point => {

            values.push(
                point.x
            );

            values.push(
                point.y
            );
        }
    );


    // ========================================================
    // PREDICTION
    // ========================================================

    const now =
        Date.now();


    if (
        now -
        lastPredictionTime >=
        PREDICTION_INTERVAL
    ) {

        lastPredictionTime =
            now;


        predictGesture(
            values
        );
    }


    // ========================================================
    // INDEX FINGER
    // ========================================================

    const indexTip =
        landmarks[8];


    if (!indexTip) {

        stopDrawing();

        return;
    }


    // ========================================================
    // DRAW
    // ========================================================

    if (
        currentGesture ===
        "draw"
    ) {

        drawOnCanvas(
            indexTip
        );

        return;
    }


    // ========================================================
    // ERASE
    // ========================================================

    if (
        currentGesture ===
        "erase"
    ) {

        eraseOnCanvas(
            indexTip
        );

        return;
    }


    // ========================================================
    // CLEAR / NO GESTURE
    // ========================================================

    stopDrawing();
}


// ============================================================
// ============================================================
// GESTURE PREDICTION
// ============================================================
async function predictGesture(values) {

    // ========================================================
    // PREVENT MULTIPLE REQUESTS
    // ========================================================

    if (predictionRunning) {
        return;
    }


    // ========================================================
    // VALIDATE LANDMARKS
    // ========================================================

    if (
        !values ||
        values.length !== 42
    ) {

        console.error(
            "Invalid hand landmarks:",
            values
        );

        return;
    }


    predictionRunning =
        true;


    try {

        // ====================================================
        // SEND TO BACKEND
        // ====================================================

        const response =
            await fetch(
                `${BACKEND_BASE}/api/gesture/predict`,
                {
                    method:
                        "POST",

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
                `Gesture server returned ${response.status}`
            );
        }


        const result =
            await response.json();


        console.log(
            "GESTURE RESULT:",
            result
        );


        // ====================================================
        // USE CONFIRMED GESTURE FIRST
        // ====================================================

        let gesture =
            result.confirmed_gesture ||
            "no_gesture";


        gesture =
            String(gesture)
                .trim()
                .toLowerCase()
                .replace(
                    /[\s-]+/g,
                    "_"
                );


        // ====================================================
        // CONFIDENCE
        // ====================================================

        let confidence =
            Number(
                result.confidence
            );


        if (
            Number.isNaN(
                confidence
            )
        ) {

            confidence =
                0;
        }


        // Backend may return 0–1
        // or 0–100

        if (
            confidence > 0 &&
            confidence <= 1
        ) {

            confidence *=
                100;
        }


        if (
            confidenceElement
        ) {

            confidenceElement.textContent =
                `${confidence.toFixed(1)}%`;
        }


        // ====================================================
        // LOW CONFIDENCE = IGNORE
        // ====================================================

        if (
            confidence < 70
        ) {

            return;
        }


        // ====================================================
        // GESTURE HISTORY
        // ====================================================

        if (
            !Array.isArray(
                gestureHistory
            )
        ) {

            gestureHistory =
                [];
        }


        gestureHistory.push(
            gesture
        );


        // Keep only last 5
        // predictions

        if (
            gestureHistory.length > 5
        ) {

            gestureHistory.shift();
        }


        // ====================================================
        // CHECK STABILITY
        // ====================================================

        const counts =
            {};


        for (
            const item
            of gestureHistory
        ) {

            counts[item] =
                (
                    counts[item] ||
                    0
                ) + 1;
        }


        let stableGesture =
            "no_gesture";

        let highestCount =
            0;


        for (
            const item
            of Object.keys(counts)
        ) {

            if (
                counts[item] >
                highestCount
            ) {

                highestCount =
                    counts[item];

                stableGesture =
                    item;
            }
        }


        // Need at least 3
        // matching predictions

        if (
            highestCount < 3
        ) {

            return;
        }


        // ====================================================
        // CLEAR OLD HISTORY WHEN GESTURE CHANGES
        // ====================================================

        if (
            stableGesture !==
            lastConfirmedGesture
        ) {

            gestureHistory =
                [stableGesture];
        }


        // ====================================================
        // UPDATE CURRENT GESTURE
        // ====================================================

        currentGesture =
            stableGesture;


        // ====================================================
        // DISPLAY GESTURE
        // ====================================================

        if (
            gestureElement
        ) {

            gestureElement.textContent =
                stableGesture
                    .replace(
                        /_/g,
                        " "
                    )
                    .toUpperCase();
        }


        // ====================================================
        // CLEAR
        // ====================================================

        if (
            stableGesture ===
            "clear"
        ) {

            // Trigger clear only once

            if (
                lastConfirmedGesture !==
                "clear"
            ) {

                clearAirCanvas(
                    true
                );

                console.log(
                    "CLEAR CONFIRMED"
                );
            }


            stopDrawing();


            lastConfirmedGesture =
                "clear";


            return;
        }


        // ====================================================
        // DRAW
        // ====================================================

        if (
            stableGesture ===
            "draw"
        ) {

            lastConfirmedGesture =
                "draw";

            return;
        }


        // ====================================================
        // ERASE
        // ====================================================

        if (
            stableGesture ===
            "erase"
        ) {

            lastConfirmedGesture =
                "erase";

            return;
        }


        // ====================================================
        // NO GESTURE
        // ====================================================

        if (
            stableGesture ===
            "no_gesture"
        ) {

            stopDrawing();

            lastConfirmedGesture =
                "no_gesture";
        }


    } catch (error) {

        console.error(
            "GESTURE PREDICTION ERROR:",
            error
        );


        if (
            gestureElement
        ) {

            gestureElement.textContent =
                "NO GESTURE";
        }


        if (
            confidenceElement
        ) {

            confidenceElement.textContent =
                "--";
        }


        currentGesture =
            "no_gesture";


        stopDrawing();


    } finally {

        predictionRunning =
            false;
    }
}
// ============================================================
// FINGER POSITION
// ============================================================

function getFingerPosition(
    landmark
) {

    const targetX =
        (1 - landmark.x) *
        airCanvas.width;

    const targetY =
        landmark.y *
        airCanvas.height;

    if (
        smoothX === null
    ) {

        smoothX =
            targetX;

        smoothY =
            targetY;

    } else {

        smoothX +=
            (
                targetX -
                smoothX
            ) *
            SMOOTHING;

        smoothY +=
            (
                targetY -
                smoothY
            ) *
            SMOOTHING;
    }

    return {

        x:
            smoothX,

        y:
            smoothY

    };
}


// ============================================================
// DRAW ON CANVAS
// ============================================================

function drawOnCanvas(landmark) {

    // --------------------------------------------------------
    // PARTICIPANT MUST HAVE HOST PERMISSION
    // --------------------------------------------------------

    if (
        !isHost &&
        !participantDrawPermission
    ) {

        stopDrawing();

        return;
    }


    // --------------------------------------------------------
    // ONLY DRAW WHEN DRAW GESTURE IS ACTIVE
    // --------------------------------------------------------

    if (
        currentGesture !==
        "draw"
    ) {

        stopDrawing();

        return;
    }


    // --------------------------------------------------------
    // GET FINGER POSITION
    // --------------------------------------------------------

    const position =
        getFingerPosition(
            landmark
        );


    const x =
        position.x;

    const y =
        position.y;


    // --------------------------------------------------------
    // FIRST POINT
    // --------------------------------------------------------

    if (
        lastDrawPoint === null
    ) {

        lastDrawPoint = {

            x,
            y

        };

        smoothX =
            x;

        smoothY =
            y;

        return;
    }


    const x1 =
        lastDrawPoint.x;

    const y1 =
        lastDrawPoint.y;


    // --------------------------------------------------------
    // PREVENT HUGE JUMPS
    // --------------------------------------------------------

    const distance =
        Math.hypot(
            x - x1,
            y - y1
        );


    if (
        distance > 100
    ) {

        lastDrawPoint = {

            x,
            y

        };

        smoothX =
            x;

        smoothY =
            y;

        return;
    }


    // --------------------------------------------------------
    // SMOOTH MOVEMENT
    // --------------------------------------------------------

    if (
        smoothX === null
    ) {

        smoothX =
            x;

        smoothY =
            y;

    } else {

        smoothX =
            smoothX * SMOOTHING +
            x * (1 - SMOOTHING);

        smoothY =
            smoothY * SMOOTHING +
            y * (1 - SMOOTHING);
    }


    const finalX =
        smoothX;

    const finalY =
        smoothY;


    // --------------------------------------------------------
    // DRAW ON LOCAL CANVAS
    // --------------------------------------------------------

    resetCanvasContext();

    airCtx.beginPath();

    airCtx.moveTo(
        x1,
        y1
    );

    airCtx.lineTo(
        finalX,
        finalY
    );

    airCtx.stroke();


    // --------------------------------------------------------
    // SEND DRAW MESSAGE
    // --------------------------------------------------------

    sendCanvasMessage({

        type:
            "canvas",

        action:
            "draw",

        x1:
            x1,

        y1:
            y1,

        x2:
            finalX,

        y2:
            finalY,

        color:
            "#2563eb",

        size:
            5

    });


    // --------------------------------------------------------
    // UPDATE LAST POINT
    // --------------------------------------------------------

    lastDrawPoint = {

        x:
            finalX,

        y:
            finalY

    };
}

// ============================================================
// ERASE ON CANVAS
// ============================================================

function eraseOnCanvas(landmark) {

    if (
        !isHost &&
        !participantDrawPermission
    ) {

        stopDrawing();

        return;
    }

    if (
        currentGesture !==
        "erase"
    ) {

        stopDrawing();

        return;
    }

    if (
        !landmark ||
        !airCtx
    ) {

        return;
    }


    const position =
        getFingerPosition(
            landmark
        );


    const x =
        position.x;

    const y =
        position.y;


    const size =
        25;


    // --------------------------------------------------------
    // ERASE LOCALLY
    // --------------------------------------------------------

    airCtx.save();

    airCtx.globalCompositeOperation =
        "destination-out";

    airCtx.beginPath();

    airCtx.arc(
        x,
        y,
        size,
        0,
        Math.PI * 2
    );

    airCtx.fill();

    airCtx.restore();


    resetCanvasContext();


    // --------------------------------------------------------
    // SEND ERASE TO OTHER USER
    // --------------------------------------------------------

    sendCanvasMessage({

        type:
            "canvas",

        action:
            "erase",

        x:
            x,

        y:
            y,

        size:
            size

    });


    // --------------------------------------------------------
    // RESET POINT
    // --------------------------------------------------------

    lastDrawPoint =
        null;

    smoothX =
        null;

    smoothY =
        null;
}

// ============================================================
// ERASE REMOTE POINT
// ============================================================

function eraseRemotePoint(message) {

    if (!airCtx) {
        return;
    }


    const x =
        Number(
            message.x
        );

    const y =
        Number(
            message.y
        );


    if (
        Number.isNaN(x) ||
        Number.isNaN(y)
    ) {

        return;
    }


    airCtx.save();

    airCtx.globalCompositeOperation =
        "destination-out";


    airCtx.beginPath();

    airCtx.arc(
        x,
        y,
        Number(
            message.size
        ) || 25,
        0,
        Math.PI * 2
    );

    airCtx.fill();

    airCtx.restore();


    resetCanvasContext();
}

// ============================================================
// DRAW REMOTE LINE
// ============================================================

function drawRemoteLine(message) {

    if (!airCtx) {
        return;
    }


    const x1 =
        Number(message.x1);

    const y1 =
        Number(message.y1);

    const x2 =
        Number(message.x2);

    const y2 =
        Number(message.y2);


    if (
        Number.isNaN(x1) ||
        Number.isNaN(y1) ||
        Number.isNaN(x2) ||
        Number.isNaN(y2)
    ) {

        return;
    }


    airCtx.save();

    airCtx.globalCompositeOperation =
        "source-over";

    airCtx.strokeStyle =
        message.color ||
        "#2563eb";

    airCtx.lineWidth =
        message.size ||
        5;

    airCtx.lineCap =
        "round";

    airCtx.lineJoin =
        "round";


    airCtx.beginPath();

    airCtx.moveTo(
        x1,
        y1
    );

    airCtx.lineTo(
        x2,
        y2
    );

    airCtx.stroke();

    airCtx.restore();

    resetCanvasContext();
}


// ============================================================
// CANVAS SNAPSHOT
// ============================================================

function sendCanvasSnapshot() {

    if (
        !dataChannel ||
        dataChannel.readyState !==
            "open"
    ) {
        return;
    }

    try {

        sendCanvasMessage({

            type:
                "canvas",

            action:
                "snapshot",

            image:
                airCanvas.toDataURL(
                    "image/png"
                )

        });

    } catch (error) {

        console.error(
            "Snapshot error:",
            error
        );
    }
}


function receiveCanvasSnapshot(
    imageData
) {

    const image =
        new Image();

    image.onload =
        function() {

            airCtx.clearRect(

                0,

                0,

                airCanvas.width,

                airCanvas.height

            );

            airCtx.drawImage(

                image,

                0,

                0,

                airCanvas.width,

                airCanvas.height

            );

            resetCanvasContext();

        };

    image.src =
        imageData;
}


// ============================================================
// CLEAR AIR CANVAS
// ============================================================

function clearAirCanvas(
    broadcast = true
) {

    if (
        !airCanvas ||
        !airCtx
    ) {

        return;
    }


    // --------------------------------------------------------
    // CLEAR ENTIRE CANVAS
    // --------------------------------------------------------

    airCtx.clearRect(
        0,
        0,
        airCanvas.width,
        airCanvas.height
    );


    // --------------------------------------------------------
    // RESTORE NORMAL DRAWING SETTINGS
    // --------------------------------------------------------

    resetCanvasContext();


    // --------------------------------------------------------
    // RESET DRAWING POSITION
    // --------------------------------------------------------

    stopDrawing();


    // --------------------------------------------------------
    // RESET GESTURE STATE
    // --------------------------------------------------------

    currentGesture =
        "no_gesture";

    lastConfirmedGesture =
        "no_gesture";


    gestureHistory =
        [];


    // --------------------------------------------------------
    // UPDATE DISPLAY
    // --------------------------------------------------------

    if (
        gestureElement
    ) {

        gestureElement.textContent =
            "CLEAR";
    }


    // --------------------------------------------------------
    // SEND CLEAR TO OTHER USER
    // --------------------------------------------------------

    if (
        broadcast &&
        dataChannel &&
        dataChannel.readyState === "open"
    ) {

        sendCanvasMessage({

            type:
                "canvas",

            action:
                "clear"
        });
    }


    console.log(
        "CANVAS CLEARED"
    );
}


// ============================================================
// SEND CANVAS MESSAGE
// ============================================================

function sendCanvasMessage(message) {

    if (
        !dataChannel ||
        dataChannel.readyState !==
            "open"
    ) {

        return;
    }


    try {

        dataChannel.send(

            JSON.stringify(
                message
            )

        );

    } catch (error) {

        console.error(
            "Canvas message send error:",
            error
        );
    }
}


// ============================================================
// SEND CONTROL MESSAGE
// ============================================================

function sendControlMessage(message) {

    if (
        !dataChannel ||
        dataChannel.readyState !==
            "open"
    ) {

        console.log("Cannot send control message: data channel not open");
        return;
    }


    try {

        dataChannel.send(

            JSON.stringify(
                message
            )

        );

    } catch (error) {

        console.error(
            "Control message send error:",
            error
        );
    }
}


// ============================================================
// UPDATE PERMISSION BUTTON
// ============================================================

function updatePermissionButton() {

    if (requestDrawPermissionButton) {
        if (isHost) {
            requestDrawPermissionButton.textContent = "👑 Host (has permission)";
            requestDrawPermissionButton.disabled = true;
            requestDrawPermissionButton.style.opacity = "0.5";
        } else if (participantDrawPermission) {
            requestDrawPermissionButton.textContent = "✅ Drawing Allowed";
            requestDrawPermissionButton.disabled = true;
            requestDrawPermissionButton.style.opacity = "0.7";
        } else if (permissionRequestPending) {
            requestDrawPermissionButton.textContent = "⏳ Request Pending...";
            requestDrawPermissionButton.disabled = true;
        } else {
            requestDrawPermissionButton.textContent = "✏️ Request Draw Permission";
            requestDrawPermissionButton.disabled = false;
            requestDrawPermissionButton.style.opacity = "1";
        }
    }
}


// ============================================================
// CREATE DATA CHANNEL FOR HOST
// ============================================================

function createHostDataChannel() {

    if (!peerConnection) {

        createPeerConnection();
    }

    if (!dataChannel) {

        const channel =
            peerConnection.createDataChannel(

                "shared-canvas",

                {
                    ordered:
                        true
                }

            );

        setupDataChannel(
            channel
        );
    }
}


// ============================================================
// DATA CHANNEL SETUP
// ============================================================

function setupDataChannel(channel) {

    dataChannel =
        channel;


    // ========================================================
    // OPEN
    // ========================================================

    dataChannel.onopen =
        function() {

            console.log(
                "Meeting control + canvas channel connected."
            );


            // ------------------------------------------------
            // SEND USER INFORMATION
            // ------------------------------------------------

            sendControlMessage({

                type:
                    "user_info",

                name:
                    myName,

                role:
                    isHost
                        ? "host"
                        : "participant"

            });


            updatePermissionButton();


            // ------------------------------------------------
            // HOST SENDS CURRENT CANVAS
            // ------------------------------------------------

            if (
                isHost
            ) {

                setTimeout(
                    sendCanvasSnapshot,
                    500
                );
            }
        };


    // ========================================================
    // CLOSE
    // ========================================================

    dataChannel.onclose =
        function() {

            console.log(
                "Meeting control + canvas channel disconnected."
            );


            dataChannel =
                null;


            permissionRequestPending =
                false;


            updatePermissionButton();
        };


    // ========================================================
    // ERROR
    // ========================================================

    dataChannel.onerror =
        function(error) {

            console.error(
                "Data channel error:",
                error
            );
        };


    // ========================================================
    // MESSAGE
    // ========================================================

    dataChannel.onmessage =
        function(event) {

            try {

                const message =
                    JSON.parse(
                        event.data
                    );


                // ==================================================
                // USER INFORMATION
                // ==================================================

                if (
                    message.type ===
                    "user_info"
                ) {

                    remoteName =
                        message.name ||
                        "Participant";


                    updateParticipantNames();
                    
                    // ==================================================
                    // GUEST REQUESTS DRAWING PERMISSION AUTOMATICALLY
                    // ==================================================
                    if (!isHost && !participantDrawPermission && !permissionRequestPending) {
                        permissionRequestPending = true;
                        sendControlMessage({
                            type: "draw_permission_request",
                            name: myName
                        });
                        console.log("📝 Guest automatically requested drawing permission from host.");
                        updatePermissionButton();
                    }


                    return;
                }


                // ==================================================
                // DRAW PERMISSION REQUEST
                // ==================================================

                if (
                    message.type ===
                    "draw_permission_request"
                ) {

                    // Only host handles permission requests
                    if (
                        !isHost
                    ) {

                        return;
                    }


                    const requester =
                        message.name ||
                        remoteName ||
                        "Participant";


                    const allow =
                        window.confirm(

                            requester +
                            " wants permission to draw.\n\n" +

                            "OK = Allow drawing\n" +

                            "Cancel = Deny drawing"

                        );


                    sendControlMessage({

                        type:
                            "draw_permission_response",

                        allowed:
                            allow

                    });


                    return;
                }


                // ==================================================
                // DRAW PERMISSION RESPONSE
                // ==================================================

                if (
                    message.type ===
                    "draw_permission_response"
                ) {

                    // Only participant handles response
                    if (
                        isHost
                    ) {

                        return;
                    }


                    participantDrawPermission =
                        message.allowed === true;


                    permissionRequestPending =
                        false;


                    updatePermissionButton();


                    if (
                        participantDrawPermission
                    ) {

                        alert(
                            "✅ Host allowed you to draw."
                        );

                    } else {

                        alert(
                            "❌ Host denied drawing permission."
                        );
                    }


                    return;
                }


                // ==================================================
                // DRAW PERMISSION REVOKED
                // ==================================================

                if (
                    message.type ===
                    "draw_permission_revoke"
                ) {

                    // Only participant needs to process this
                    if (
                        !isHost
                    ) {

                        participantDrawPermission =
                            false;


                        permissionRequestPending =
                            false;


                        stopDrawing();


                        updatePermissionButton();


                        alert(
                            "⚠️ The host has disabled your drawing permission."
                        );
                    }


                    return;
                }


                // ==================================================
                // IGNORE NON-CANVAS MESSAGES
                // ==================================================

                if (
                    message.type !==
                    "canvas"
                ) {

                    return;
                }


                // ==================================================
                // REMOTE DRAW
                // ==================================================

                if (
                    message.action ===
                    "draw"
                ) {

                    drawRemoteLine(
                        message
                    );


                    return;
                }


                // ==================================================
                // REMOTE ERASE
                // ==================================================

                if (
                    message.action ===
                    "erase"
                ) {

                    eraseRemotePoint(
                        message
                    );


                    return;
                }


                // ==================================================
                // REMOTE CLEAR
                // ==================================================

                if (
                    message.action ===
                    "clear"
                ) {

                    clearAirCanvas(
                        false
                    );


                    return;
                }


                // ==================================================
                // CANVAS SNAPSHOT
                // ==================================================

                if (
                    message.action ===
                    "snapshot"
                ) {

                    if (
                        message.image
                    ) {

                        receiveCanvasSnapshot(
                            message.image
                        );
                    }


                    return;
                }


            } catch (error) {

                console.error(
                    "Data channel message error:",
                    error
                );
            }
        };
}


// ============================================================
// OFFER
// ============================================================

async function createOffer() {

    createPeerConnection();

    createHostDataChannel();

    const offer =
        await peerConnection.createOffer();

    await peerConnection.setLocalDescription(
        offer
    );

    socket.send(

        JSON.stringify({

            type:
                "offer",

            offer:
                offer

        })
    );
}


// ============================================================
// HANDLE OFFER
// ============================================================

async function handleOffer(
    offer
) {

    createPeerConnection();

    await peerConnection.setRemoteDescription(

        new RTCSessionDescription(
            offer
        )
    );

    const answer =
        await peerConnection.createAnswer();

    await peerConnection.setLocalDescription(
        answer
    );

    socket.send(

        JSON.stringify({

            type:
                "answer",

            answer:
                answer

        })
    );
}


// ============================================================
// HANDLE ANSWER
// ============================================================

async function handleAnswer(
    answer
) {

    if (!peerConnection) {
        return;
    }

    await peerConnection.setRemoteDescription(

        new RTCSessionDescription(
            answer
        )
    );
}


// ============================================================
// ICE
// ============================================================

async function handleIceCandidate(
    candidate
) {

    if (!peerConnection) {
        return;
    }

    try {

        await peerConnection.addIceCandidate(

            new RTCIceCandidate(
                candidate
            )

        );

    } catch (error) {

        console.error(
            "ICE error:",
            error
        );
    }
}


// ============================================================
// WEBSOCKET
// ============================================================

function connectSignaling(
    meetingId
) {

    return new Promise(

        (resolve, reject) => {

            const url =
                `${WS_BASE}/ws/meeting/${encodeURIComponent(meetingId)}`;

            console.log(
                "Connecting:",
                url
            );

            socket =
                new WebSocket(
                    url
                );

            socket.onopen =
                function() {

                    console.log(
                        "WebSocket connected."
                    );

                    resolve();
                };

            socket.onerror =
                function(error) {

                    console.error(
                        "WebSocket error:",
                        error
                    );

                    reject(error);
                };

            socket.onclose =
                function() {

                    console.log(
                        "WebSocket closed."
                    );
                };

            socket.onmessage =
                async function(event) {

                    try {

                        const message =
                            JSON.parse(
                                event.data
                            );

                        await handleSignalingMessage(
                            message
                        );

                    } catch (error) {

                        console.error(
                            "Signaling error:",
                            error
                        );
                    }
                };

        }

    );
}


// ============================================================
// SIGNALING HANDLER
// ============================================================

async function handleSignalingMessage(
    message
) {

    console.log(
        "Signaling:",
        message
    );

    if (
        message.type ===
        "joined"
    ) {

        isHost =
            message.role ===
            "host";

        updateParticipantNames();

        connectionStatus.textContent =
            isHost
                ? "Meeting: Waiting for participant"
                : "Meeting: Connecting...";

        updatePermissionButton();

        return;
    }

    if (
        message.type ===
        "participant_joined"
    ) {

        if (isHost) {

            connectionStatus.textContent =
                "Participant: Connecting...";

            createPeerConnection();

            createHostDataChannel();

            await createOffer();
        }

        return;
    }

    if (
        message.type ===
        "offer"
    ) {

        await handleOffer(
            message.offer
        );

        return;
    }

    if (
        message.type ===
        "answer"
    ) {

        await handleAnswer(
            message.answer
        );

        return;
    }

    if (
        message.type ===
        "ice_candidate"
    ) {

        await handleIceCandidate(
            message.candidate
        );

        return;
    }

    if (
        message.type ===
        "participant_left"
    ) {

        connectionStatus.textContent =
            "Meeting: Waiting for participant";

        remoteVideo.srcObject =
            null;

        remoteVideo.style.display =
            "none";

        if (waitingParticipant) {

            waitingParticipant.style.display =
                "flex";
        }

        remoteName =
            "Participant";

        updateParticipantNames();

        if (peerConnection) {

            peerConnection.close();

            peerConnection =
                null;
        }

        dataChannel =
            null;
            
        participantDrawPermission = false;
        permissionRequestPending = false;
        updatePermissionButton();

        return;
    }

    if (
        message.type ===
        "room_full"
    ) {

        alert(
            "This meeting already has two participants."
        );

        if (socket) {

            socket.close();
        }

        return;
    }
}


// ============================================================
// OPEN MEETING
// ============================================================

async function openMeeting(
    meetingId
) {

    currentMeetingId =
        meetingId;

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

    updateParticipantNames();
    updatePermissionButton();

    connectionStatus.textContent =
        "Connecting to meeting...";

    try {

        await connectSignaling(
            meetingId
        );

    } catch (error) {

        console.error(
            "Meeting connection failed:",
            error
        );

        connectionStatus.textContent =
            "Meeting connection failed";

        alert(
            "Could not connect to the meeting server."
        );
    }
}


// ============================================================
// START CAMERA - HOME
// ============================================================

if (homeStartCamera) {

    homeStartCamera.addEventListener(
        "click",
        async function() {

            await startCamera();

        }
    );
}


// ============================================================
// START CAMERA - MEETING
// ============================================================

if (startCameraButton) {

    startCameraButton.addEventListener(
        "click",
        async function() {

            await startCamera();

        }
    );
}


// ============================================================
// REQUEST DRAW PERMISSION
// ============================================================

if (requestDrawPermissionButton) {

    requestDrawPermissionButton.addEventListener(
        "click",
        function() {

            if (isHost) {
                alert("👑 You are the host. You already have drawing permission.");
                return;
            }

            if (permissionRequestPending) {
                alert("⏳ Permission request already sent. Waiting for host...");
                return;
            }

            if (participantDrawPermission) {
                alert("✅ You already have drawing permission.");
                return;
            }

            permissionRequestPending = true;
            sendControlMessage({
                type: "draw_permission_request",
                name: myName
            });
            updatePermissionButton();
            alert("📝 Permission request sent to host.");
        }
    );
}


// ============================================================
// CREATE MEETING
// ============================================================

createMeetingButton.addEventListener(
    "click",
    async function() {

        const name =
            getNameFromUI();

        if (!name) {
            return;
        }

        if (!stream) {

            const started =
                await startCamera();

            if (!started) {
                return;
            }
        }

        myName =
            name;

        isHost =
            true;

        const meetingId =
            Math.random()
                .toString(36)
                .substring(2, 8)
                .toUpperCase();

        await openMeeting(
            meetingId
        );

    }
);


// ============================================================
// JOIN MEETING
// ============================================================

joinMeetingButton.addEventListener(
    "click",
    async function() {

        const name =
            getNameFromUI();

        if (!name) {
            return;
        }

        const meetingId =
            meetingIdInput.value
                .trim()
                .toUpperCase();

        if (!meetingId) {

            meetingIdInput.focus();

            alert(
                "Please enter the Meeting ID."
            );

            return;
        }

        if (!stream) {

            const started =
                await startCamera();

            if (!started) {
                return;
            }
        }

        myName =
            name;

        isHost =
            false;

        await openMeeting(
            meetingId
        );

    }
);


// ============================================================
// CLEAR
// ============================================================

clearCanvasButton.addEventListener(
    "click",
    function() {

        clearAirCanvas(
            true
        );

    }
);


// ============================================================
// MIC
// ============================================================

muteButton.addEventListener(
    "click",
    function() {

        if (!stream) {

            alert(
                "Start the camera first."
            );

            return;
        }

        const audioTracks =
            stream.getAudioTracks();

        if (
            audioTracks.length ===
            0
        ) {

            alert(
                "Microphone not available."
            );

            return;
        }

        isMuted =
            !isMuted;

        audioTracks.forEach(
            track => {

                track.enabled =
                    !isMuted;

            }
        );

        muteButton.textContent =
            isMuted
                ? "🔇 Unmute"
                : "🎤 Mic";

        updateCameraStatus();

    }
);


// ============================================================
// CAMERA ON / OFF
// ============================================================

cameraButton.addEventListener(
    "click",
    function() {

        if (!stream) {

            alert(
                "Start the camera first."
            );

            return;
        }

        const videoTracks =
            stream.getVideoTracks();

        if (
            videoTracks.length ===
            0
        ) {
            return;
        }

        isCameraOff =
            !isCameraOff;

        videoTracks.forEach(
            track => {

                track.enabled =
                    !isCameraOff;

            }
        );

        cameraButton.textContent =
            isCameraOff
                ? "📹 Turn Camera On"
                : "📹 Camera";

        updateCameraStatus();

    }
);


// ============================================================
// COPY MEETING ID
// ============================================================

copyMeetingId.addEventListener(
    "click",
    async function() {

        if (!currentMeetingId) {
            return;
        }

        try {

            await navigator.clipboard.writeText(
                currentMeetingId
            );

            copyMeetingId.textContent =
                "Copied!";

            setTimeout(
                function() {

                    copyMeetingId.textContent =
                        "Copy ID";

                },
                1500
            );

        } catch (error) {

            console.error(
                "Copy failed:",
                error
            );
        }

    }
);


// ============================================================
// LEAVE
// ============================================================

leaveMeetingButton.addEventListener(
    "click",
    function() {

        if (socket) {

            socket.close();

            socket =
                null;
        }

        if (peerConnection) {

            peerConnection.close();

            peerConnection =
                null;
        }

        dataChannel =
            null;

        remoteVideo.srcObject =
            null;

        remoteVideo.style.display =
            "none";

        if (waitingParticipant) {

            waitingParticipant.style.display =
                "flex";
        }

        clearAirCanvas(
            false
        );

        meetingScreen.classList.add(
            "hidden"
        );

        homeScreen.classList.remove(
            "hidden"
        );

        currentMeetingId =
            null;

        isHost =
            false;

        remoteName =
            "Participant";
            
        participantDrawPermission = false;
        permissionRequestPending = false;

        updateParticipantNames();
        updatePermissionButton();

        connectionStatus.textContent =
            "Backend: Checking...";

        if (stream) {

            homeStartCamera.textContent =
                "✓ Camera Started";
        }

    }
);


// ============================================================
// INITIAL UI
// ============================================================

updateParticipantNames();
updateCameraStatus();
updatePermissionButton();


// Camera stays OFF initially.
// User can start it manually or create/join a meeting.

console.log(
    "Air Canvas application loaded."
);