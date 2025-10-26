import React, { useEffect, useRef, useState, useCallback } from "react";
import io from "socket.io-client";
import Peer from "simple-peer";
import ReactPlayer from "react-player";

// Config: env first, fallback to your Render server
const SIGNALING_SERVER =
  process.env.REACT_APP_SIGNALING_SERVER ||
  "https://webrtc-server-wwai.onrender.com";

export default function App() {
  // Identity / room
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("default-room"); // set via UI for prod
  const [myId, setMyId] = useState("");

  // Roles and media
  const [isHost, setIsHost] = useState(false);
  const [stream, setStream] = useState(null);

  // WebRTC peers map: { [peerId]: { peer, stream } }
  const [peers, setPeers] = useState({});

  // Shared media
  const [videoUrl, setVideoUrl] = useState("");
  const [sharedVideoUrl, setSharedVideoUrl] = useState("");

  // Chat
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");

  // Refs
  const socketRef = useRef(null);
  const peersRef = useRef({}); // { [peerId]: { peer } }
  const myVideoRef = useRef(null);
  const playerRef = useRef(null);

  // Init media (one-time)
  useEffect(() => {
    let isMounted = true;
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((mediaStream) => {
        if (!isMounted) return;
        setStream(mediaStream);
        if (myVideoRef.current) {
          myVideoRef.current.srcObject = mediaStream;
        }
      })
      .catch((err) => {
        console.error("Media access error:", err);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // Helper: add peer to state and refs consistently
  const registerPeer = useCallback((peerId, peer) => {
    peersRef.current[peerId] = { peer };
    setPeers((prev) => ({
      ...prev,
      [peerId]: { peer },
    }));
  }, []);

  // Helper: update remote stream in state
  const setRemoteStream = useCallback((peerId, remoteStream) => {
    setPeers((prev) => ({
      ...prev,
      [peerId]: { ...(prev[peerId] || {}), stream: remoteStream },
    }));
  }, []);

  // Create peer (initiator)
  const createPeer = useCallback((userToSignal, callerId, mediaStream) => {
    const peer = new Peer({
      initiator: true,
      trickle: false,
      stream: mediaStream || undefined,
    });

    peer.on("signal", (signal) => {
      socketRef.current?.emit("sending-signal", {
        roomId,
        userToSignal,
        callerId,
        signal,
      });
    });

    peer.on("stream", (remoteStream) => {
      setRemoteStream(userToSignal, remoteStream);
    });

    peer.on("error", (e) => console.warn("Peer error (initiator):", e));
    return peer;
  }, [roomId, setRemoteStream]);

  // Add peer (receiver)
  const addPeer = useCallback((incomingSignal, callerId, mediaStream) => {
    const peer = new Peer({
      initiator: false,
      trickle: false,
      stream: mediaStream || undefined,
    });

    peer.on("signal", (signal) => {
      socketRef.current?.emit("returning-signal", {
        roomId,
        signal,
        callerId,
      });
    });

    peer.on("stream", (remoteStream) => {
      setRemoteStream(callerId, remoteStream);
    });

    peer.on("error", (e) => console.warn("Peer error (receiver):", e));
    peer.signal(incomingSignal);
    return peer;
  }, [roomId, setRemoteStream]);

  // Init socket and all listeners (one-time)
  useEffect(() => {
    if (!SIGNALING_SERVER) {
      console.error("SIGNALING_SERVER missing");
      return;
    }
    const socket = io(SIGNALING_SERVER, { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      setMyId(socket.id);
      // Join a room with a name; server should assign host to first socket in room
      socket.emit("join-room", { roomId, name: name || `User-${socket.id.slice(0, 5)}` });
    });

    socket.on("host-assigned", () => {
      setIsHost(true);
    });

    // Server sends current peers when joining
    socket.on("room-peers", ({ peers: existingPeers }) => {
      if (!stream) return; // wait for media, server may re-emit or client can request again
      existingPeers.forEach((peerId) => {
        const peer = createPeer(peerId, socket.id, stream);
        registerPeer(peerId, peer);
      });
    });

    // New user joined -> existing users should initiate to them
    socket.on("user-joined", ({ userId }) => {
      if (!stream) return;
      // Initiate connection towards newcomer
      const peer = createPeer(userId, socket.id, stream);
      registerPeer(userId, peer);
    });

    // Newcomer receives initiator’s signal
    socket.on("receiving-signal", ({ callerId, signal }) => {
      if (!stream) return;
      const peer = addPeer(signal, callerId, stream);
      registerPeer(callerId, peer);
    });

    // Initiator receives callee’s answer
    socket.on("receiving-returned-signal", ({ id, signal }) => {
      const entry = peersRef.current[id];
      entry?.peer?.signal(signal);
    });

    // Chat
    socket.on("receive-message", ({ name: from, message }) => {
      setChatMessages((prev) => [...prev, { name: from, message }]);
    });

    // Shared video URL (host-originated)
    socket.on("receive-video", ({ url }) => {
      setSharedVideoUrl(url);
    });

    // Player control sync (optional extension)
    socket.on("player-control", ({ action, time }) => {
      const player = playerRef.current;
      if (!player) return;
      if (action === "PLAY") player.getInternalPlayer && player.seekTo(time, "seconds");
      if (action === "PLAY") player.getInternalPlayer && player.getInternalPlayer().play?.();
      if (action === "PAUSE") {
        player.getInternalPlayer && player.seekTo(time, "seconds");
        player.getInternalPlayer && player.getInternalPlayer().pause?.();
      }
      if (action === "SEEK") player.getInternalPlayer && player.seekTo(time, "seconds");
    });

    // Peer cleanup
    socket.on("user-left", ({ userId }) => {
      const entry = peersRef.current[userId];
      if (entry) {
        entry.peer.destroy();
        delete peersRef.current[userId];
      }
      setPeers((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    });

    return () => {
      socket.disconnect();
      Object.values(peersRef.current).forEach(({ peer }) => peer.destroy());
      peersRef.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createPeer, addPeer, registerPeer, roomId, name, stream]);

  // Attach local stream to <video> when available
  useEffect(() => {
    if (myVideoRef.current && stream) {
      myVideoRef.current.srcObject = stream;
    }
  }, [stream]);

  // Chat send
  const sendMessage = () => {
    const msg = chatInput.trim();
    if (!msg) return;
    socketRef.current?.emit("send-message", { roomId, name: name || myId, message: msg });
    setChatMessages((prev) => [...prev, { name: "You", message: msg }]);
    setChatInput("");
  };

  // Share video (host only)
  const shareVideo = () => {
    const url = videoUrl.trim();
    if (!isHost || !url) return;
    socketRef.current?.emit("share-video", { roomId, url });
    setSharedVideoUrl(url);
    setVideoUrl("");
  };

  // Player control helpers (host origin only; guard to avoid echo)
  const emitPlayerControl = (action, time) => {
    if (!isHost) return;
    socketRef.current?.emit("player-control", { roomId, action, time });
  };

  const onPlay = () => {
    if (!playerRef.current) return;
    const t = playerRef.current.getCurrentTime
      ? playerRef.current.getCurrentTime()
      : 0;
    emitPlayerControl("PLAY", t);
  };

  const onPause = () => {
    if (!playerRef.current) return;
    const t = playerRef.current.getCurrentTime
      ? playerRef.current.getCurrentTime()
      : 0;
    emitPlayerControl("PAUSE", t);
  };

  const onSeek = (t) => {
    emitPlayerControl("SEEK", t.playedSeconds ?? t);
  };

  // UI
  return (
    <div style={{ display: "flex", gap: 16, padding: 16 }}>
      <div style={{ flex: 2, minWidth: 0 }}>
        <div style={{ marginBottom: 8 }}>
          <input
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ marginRight: 8 }}
          />
          <input
            placeholder="Room ID"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            style={{ marginRight: 8 }}
          />
          <span>{isHost ? "Host" : "Participant"}</span>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <video
            ref={myVideoRef}
            autoPlay
            playsInline
            muted
            style={{ width: 240, background: "#000", borderRadius: 8 }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {Object.entries(peers).map(([pid, p]) => (
              <video
                key={pid}
                autoPlay
                playsInline
                ref={(el) => {
                  if (el && p.stream && el.srcObject !== p.stream) {
                    el.srcObject = p.stream;
                  }
                }}
                style={{ width: 240, background: "#000", borderRadius: 8 }}
              />
            ))}
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <input
            placeholder="Paste YouTube/URL to share (host only)"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            style={{ width: "70%", marginRight: 8 }}
          />
          <button onClick={shareVideo} disabled={!isHost}>
            Share
          </button>
        </div>

        {sharedVideoUrl && (
          <div style={{ marginTop: 12 }}>
            <ReactPlayer
              ref={playerRef}
              url={sharedVideoUrl}
              controls
              playing={false}
              width="100%"
              onPlay={onPlay}
              onPause={onPause}
              onSeek={onSeek}
            />
          </div>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 280 }}>
        <div
          style={{
            height: 420,
            border: "1px solid #ddd",
            borderRadius: 8,
            padding: 8,
            overflowY: "auto",
            marginBottom: 8,
          }}
        >
          {chatMessages.map((m, idx) => (
            <div key={idx} style={{ marginBottom: 6 }}>
              <strong>{m.name}:</strong> {m.message}
            </div>
          ))}
        </div>
        <div>
          <input
            placeholder="Type a message"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            style={{ width: "70%", marginRight: 8 }}
          />
          <button onClick={sendMessage}>Send</button>
        </div>
      </div>
    </div>
  );
}
