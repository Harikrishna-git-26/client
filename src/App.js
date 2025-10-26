import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import Peer from "simple-peer";
import ReactPlayer from "react-player";

const SIGNALING_SERVER =
  process.env.REACT_APP_SIGNALING_SERVER ||
  "https://webrtc-server-wwai.onrender.com"; // update with your deployed backend

export default function App() {
  const playerRef = useRef(null);
  const myVideoRef = useRef(null);
  const socketRef = useRef(null);

  const [name, setName] = useState("");
  const [nameSet, setNameSet] = useState(false);
  const [socketId, setSocketId] = useState("");
  const [hostId, setHostId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [peers, setPeers] = useState([]); // { id, name, camOn, micOn, streamId }
  const [peerStreams, setPeerStreams] = useState({});
  const [meStatus, setMeStatus] = useState({ camOn: false, micOn: false });
  const [stream, setStream] = useState(null);

  const [videoUrl, setVideoUrl] = useState("");
  const [sharedVideoUrl, setSharedVideoUrl] = useState("");
  const [chat, setChat] = useState([]);
  const [msg, setMsg] = useState("");

  // Responsive, scroll-less
  useEffect(() => {
    document.body.style.margin = "0";
    document.body.style.padding = "0";
    document.body.style.overflow = "hidden";
  }, []);

  // Socket & Peer connections
  useEffect(() => {
  console.log("Connecting to socket once on mount");
  
  const socket = io(SIGNALING_SERVER, { transports: ["websocket"] });
  socketRef.current = socket;

  socket.on("connect-success", ({ id }) => {
    setSocketId(id);
    socket.emit("get-host");
  });

  // All other socket.on handlers go here unchanged

  return () => {
    console.log("Disconnecting socket on unmount");
    socket.disconnect();
    };
    }, []); // <-- empty array ensures single initialization only

    // --- Peer-to-Peer (WebRTC via simple-peer) ---
    socket.on("offer", ({ from, signal, name: peerName }) => {
      const peer = new Peer({ initiator: false, trickle: false, stream });
      peer.on("signal", (signal) => {
        socket.emit("answer", { to: from, signal });
      });
      peer.on("stream", (remoteStream) => {
        setPeerStreams((prev) => ({ ...prev, [from]: remoteStream }));
      });
      peer.signal(signal);
    });

    socket.on("answer", ({ from, signal }) => {
      if (window.peers && window.peers[from]) {
        window.peers[from].signal(signal);
      }
    });

    // --- Chat & YouTube sync ---
    socket.on("receive-message", ({ from, name: fromName, msg }) => {
      setChat((prev) => [
        ...prev,
        { from, fromName: fromName ?? from, msg },
      ]);
    });

    socket.on("receive-video", ({ url, action, time }) => {
      if (url && url !== sharedVideoUrl) setSharedVideoUrl(url);
      const player = playerRef.current;
      if (player) {
        if (action === "PLAY") player.seekTo(time);
        if (action === "PAUSE") player.seekTo(time);
        if (action === "SEEK") player.seekTo(time);
      }
    });

    // Ask for camera/mic on connection if desired
    // comment this out if want manual control only
    // startCamMic();

    return () => socket.disconnect();
  }, [stream, sharedVideoUrl, socketId]);

  // Name handling
  useEffect(() => {
    if (nameSet && name) {
      socketRef.current?.emit("set-name", { name });
    }
  }, [nameSet, name]);

  // Helper: Start cam/mic
  const startCamMic = () => {
    navigator.mediaDevices
      .getUserMedia({
        video: true,
        audio: true,
      })
      .then((mediaStream) => {
        setStream(mediaStream);
        setMeStatus({ camOn: true, micOn: true });
        if (myVideoRef.current) {
          myVideoRef.current.srcObject = mediaStream;
        }
        // initiate signaling to any peers
        (peers || []).forEach((p) => callPeer(p.id, mediaStream));
      });
  };

  const stopCamMic = () => {
    setMeStatus({ camOn: false, micOn: false });
    if (myVideoRef.current && myVideoRef.current.srcObject) {
      myVideoRef.current.srcObject.getTracks().forEach((t) => t.stop());
      myVideoRef.current.srcObject = null;
    }
    setStream(null);
  };

  // Call a peer (WebRTC) as initiator
  const callPeer = (targetId, mediaStream) => {
    if (!mediaStream) return;
    if (!window.peers) window.peers = {};
    const peer = new Peer({
      initiator: true,
      trickle: false,
      stream: mediaStream,
    });
    peer.on("signal", (signal) => {
      socketRef.current.emit("offer", {
        to: targetId,
        signal,
        name,
      });
    });
    peer.on("stream", (remoteStream) => {
      setPeerStreams((prev) => ({ ...prev, [targetId]: remoteStream }));
    });
    window.peers[targetId] = peer;
  };

  const handleNameEnter = (e) => {
    if (e.key === "Enter" && name.trim()) setNameSet(true);
  };

  const connectToFriend = () => {
    if (!targetId.trim()) return;
    socketRef.current.emit("connect-peer", targetId);
    setTargetId("");
  };

  // Chat send
  const sendMessage = () => {
    if (!msg.trim()) return;
    // Send with from, name
    (peers || []).forEach((p) =>
      socketRef.current?.emit("send-message", {
        to: p.id,
        msg,
        name: nameSet ? name : "",
      })
    );
    setChat((prev) => [...prev, { from: socketId, fromName: "You", msg }]);
    setMsg("");
  };

  // YouTube actions
  const shareVideo = () => {
    if (!videoUrl.trim()) return;
    (peers || []).forEach((p) =>
      socketRef.current?.emit("send-video", { to: p.id, url: videoUrl })
    );
    setSharedVideoUrl(videoUrl);
    setVideoUrl("");
  };

  const broadcastAction = (action) => {
    const time = playerRef.current.getCurrentTime();
    (peers || []).forEach((p) =>
      socketRef.current?.emit("send-video", { to: p.id, action, time })
    );
  };

  // Responsive fix: fill all available viewport
  const outerStyle = {
    fontFamily: "Inter, sans-serif",
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    width: "100vw",
    boxSizing: "border-box",
    background: "#090d14",
    color: "#eee",
    overflow: "hidden",
  };

  return (
    <div style={outerStyle}>
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          flexShrink: 0,
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 20px",
          background: "#121826",
          borderBottom: "1px solid #1e2536",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 28 }}>WatchApp</div>
        {nameSet ? (
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontSize: 20 }}>{name}</span>
            <span
              style={{
                background: "#2d364d",
                padding: "4px 12px",
                borderRadius: 12,
                fontWeight: 700,
                letterSpacing: 2,
                fontSize: 18,
              }}
            >
              {socketId}
            </span>
          </div>
        ) : (
          <input
            autoFocus
            value={name}
            placeholder="Enter your name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleNameEnter}
            style={{
              padding: "8px 18px",
              borderRadius: 10,
              border: "1px solid #555",
              background: "#1a1f2c",
              color: "#eee",
              fontSize: 20,
            }}
          />
        )}
      </div>

      {/* Layout: video left, controls/chat right */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
        }}
      >
        {/* Left: YouTube video and webcam local preview */}
        <div
          style={{
            flex: "2 1 0%",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            padding: 12,
            gap: 12,
          }}
        >
          {/* YouTube URL input */}
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={{
                flex: 1,
                padding: "8px 12px",
                fontSize: 16,
                background: "#1a1f2c",
                color: "#eee",
                border: "1px solid #333",
                borderRadius: 8,
              }}
              placeholder="Paste YouTube URL"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
            />
            <button
              onClick={shareVideo}
              style={{
                background: "#2563eb",
                border: "none",
                color: "#fff",
                padding: "8px 18px",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              Share
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0, background: "#000", borderRadius: 8, position: "relative" }}>
            {sharedVideoUrl ? (
              <ReactPlayer
                ref={playerRef}
                url={sharedVideoUrl}
                controls
                width="100%"
                height="100%"
                muted
                playing // auto-play active
                style={{ position: "absolute", width: "100%", height: "100%", top: 0, left: 0 }}
                onPlay={() => broadcastAction("PLAY")}
                onPause={() => broadcastAction("PAUSE")}
                onSeek={t => broadcastAction("SEEK", t)}
              />
            ) : (
              <span style={{ opacity: 0.6, padding: 20 }}>No video shared yet</span>
            )}
          </div>
        </div>
        {/* Right: video tiles, cam/mic controls, chat */}
        <div
          style={{
            flex: "1 1 0%",
            minWidth: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: 12,
            gap: 12,
          }}
        >
          {/* Connect to peer */}
          <div style={{ display: "flex", gap: 8 }}>
            <input
              placeholder="Enter socket ID"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value.toUpperCase())}
              maxLength={5}
              style={{
                padding: "8px 10px",
                background: "#23283c",
                border: "1px solid #2d364d",
                borderRadius: 7,
                color: "#eee",
                width: 170,
              }}
            />
            <button
              onClick={connectToFriend}
              style={{
                background: "#4ade80",
                color: "#23283c",
                padding: "7px 20px",
                border: "none",
                borderRadius: 7,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Connect
            </button>
          </div>
          {/* Video tiles */}
          <div style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            overflowY: "auto",
          }}>
            {/* My webcam preview */}
            <div style={{
              background: "#1a1f2c",
              borderRadius: 8,
              height: 120,
              display: "flex",
              alignItems: "center",
              gap: 20,
              padding: "0 16px",
            }}>
              <span style={{ fontWeight: 700, fontSize: 18 }}>{nameSet ? name : "You"}</span>
              <video
                ref={myVideoRef}
                autoPlay
                muted
                playsInline
                style={{
                  width: 80,
                  height: 80,
                  background: "#000",
                  borderRadius: 8,
                  objectFit: "cover",
                  display: meStatus.camOn ? "" : "none"
                }}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  style={{
                    background: meStatus.camOn ? "#34d399" : "#dc2626",
                    color: "#23283c",
                    border: "none",
                    borderRadius: 5,
                    padding: "4px 10px",
                  }}
                  onClick={() => {
                    if (!meStatus.camOn) startCamMic();
                    else stopCamMic();
                  }}
                >
                  {meStatus.camOn ? "Cam On" : "Cam Off"}
                </button>
                <button
                  style={{
                    background: meStatus.micOn ? "#34d399" : "#dc2626",
                    color: "#23283c",
                    border: "none",
                    borderRadius: 5,
                    padding: "4px 10px",
                  }}
                  onClick={() => setMeStatus(s => {
                    // Toggle local mic (future: manage audio tracks)
                    if (stream) {
                      stream.getAudioTracks().forEach(t => t.enabled = !s.micOn);
                    }
                    return { ...s, micOn: !s.micOn };
                  })}
                >
                  {meStatus.micOn ? "Mic On" : "Mic Off"}
                </button>
              </div>
            </div>
            {/* Peers */}
            {peers
              .filter((p) => p.id !== socketId)
              .map((p) => (
                <div
                  key={p.id}
                  style={{
                    background: "#292f42",
                    borderRadius: 8,
                    minHeight: 120,
                    display: "flex",
                    alignItems: "center",
                    gap: 20,
                    padding: "0 16px",
                  }}
                >
                  <span style={{ fontWeight: 700 }}>{p.name || "Peer"}</span>
                  <video
                    autoPlay
                    playsInline
                    muted={!p.micOn}
                    style={{
                      width: 80,
                      height: 80,
                      background: "#000",
                      borderRadius: 8,
                      objectFit: "cover",
                      display: p.camOn && peerStreams[p.id] ? "" : "none"
                    }}
                    ref={el => {
                      if (el && peerStreams[p.id]) {
                        el.srcObject = peerStreams[p.id];
                      }
                    }}
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    <span style={{
                      background: p.camOn ? "#16a34a" : "#b91c1c",
                      padding: "4px 10px",
                      borderRadius: 6,
                      color: "#fff",
                    }}>{p.camOn ? "Cam On" : "Cam Off"}</span>
                    <span style={{
                      background: p.micOn ? "#16a34a" : "#b91c1c",
                      padding: "4px 10px",
                      borderRadius: 6,
                      color: "#fff"
                    }}>{p.micOn ? "Mic On" : "Mic Off"}</span>
                  </div>
                </div>
              ))}
          </div>
          {/* Chat */}
          <div
            style={{
              background: "#111827",
              borderTop: "1px solid #1e2536",
              padding: 10,
            }}
          >
            <div
              style={{
                height: 140,
                overflowY: "auto",
                background: "#0f1729",
                marginBottom: 8,
                padding: 8,
                borderRadius: 8,
              }}
            >
              {chat.map((c, i) => (
                <div key={i}>
                  <strong>
                    {c.from === socketId ? "You" : c.fromName || c.from}:
                  </strong> {c.msg}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                placeholder="Type message"
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                style={{
                  flex: 1,
                  border: "1px solid #333",
                  padding: "6px 10px",
                  borderRadius: 6,
                  background: "#1a1f2c",
                  color: "#eee",
                }}
              />
              <button
                onClick={sendMessage}
                style={{
                  background: "#2563eb",
                  color: "white",
                  border: "none",
                  padding: "6px 16px",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
