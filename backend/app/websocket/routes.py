from fastapi import APIRouter, WebSocket, WebSocketDisconnect


router = APIRouter(
    prefix="/ws",
    tags=["websocket"],
)


# ============================================================
# MEETING ROOMS
# ============================================================

rooms = {}


# ============================================================
# WEBRTC SIGNALING
# ============================================================

@router.websocket("/meeting/{meeting_id}")
async def meeting_websocket(
    websocket: WebSocket,
    meeting_id: str,
):
    """
    WebRTC signaling channel.

    The server does not carry the actual video.
    It only passes WebRTC signaling messages between
    the two participants in a meeting.
    """

    await websocket.accept()


    # Create meeting room if necessary

    if meeting_id not in rooms:
        rooms[meeting_id] = []


    room = rooms[meeting_id]


    # --------------------------------------------------------
    # MAXIMUM TWO PARTICIPANTS
    # --------------------------------------------------------

    if len(room) >= 2:

        await websocket.send_json({
            "type": "room_full",
            "message": "This meeting already has two participants.",
        })

        await websocket.close()

        return


    # --------------------------------------------------------
    # ADD PARTICIPANT
    # --------------------------------------------------------

    room.append(websocket)


    print(
        f"Participant joined meeting: {meeting_id}"
    )

    print(
        f"Participants in room: {len(room)}"
    )


    # --------------------------------------------------------
    # TELL PARTICIPANT THEIR ROLE
    # --------------------------------------------------------

    if len(room) == 1:

        await websocket.send_json({
            "type": "joined",
            "role": "host",
            "participants": 1,
        })


    else:

        await websocket.send_json({
            "type": "joined",
            "role": "guest",
            "participants": 2,
        })


        # Tell host that guest joined

        try:

            await room[0].send_json({
                "type": "participant_joined",
                "participants": 2,
            })

        except Exception:
            pass


    # --------------------------------------------------------
    # RECEIVE AND FORWARD SIGNALING
    # --------------------------------------------------------

    try:

        while True:

            message = await websocket.receive_json()


            # Send message to the other participant

            for connection in room:

                if connection is not websocket:

                    try:

                        await connection.send_json(
                            message
                        )

                    except Exception:
                        pass


    except WebSocketDisconnect:

        print(
            f"Participant left meeting: {meeting_id}"
        )


    finally:

        # ----------------------------------------------------
        # REMOVE PARTICIPANT
        # ----------------------------------------------------

        if websocket in room:

            room.remove(websocket)


        # ----------------------------------------------------
        # INFORM REMAINING PARTICIPANT
        # ----------------------------------------------------

        for connection in room:

            try:

                await connection.send_json({
                    "type": "participant_left",
                    "participants": len(room),
                })

            except Exception:
                pass


        # ----------------------------------------------------
        # DELETE EMPTY ROOM
        # ----------------------------------------------------

        if len(room) == 0:

            del rooms[meeting_id]


        print(
            f"Participants remaining: {len(room)}"
        )