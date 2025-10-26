import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import ReactPlayer from "react-player";

const SIGNALING_SERVER =
  process.env.REACT_APP_SIGNALING_SERVER ||
  "https://webrtc-server-wwai.onrender.com";

export default function App() {
  const socketRef = useRef();
  const playerRef = useRef();
  const [socketId, setSocketId] = useState("");
  const [name, setName] = useState("");
  const [targetId, setTargetId] = useState("");
  const [connectedIds, setConnectedIds] = useState([]);
  const [videoUrl, setVideoUrl] = useState("");
  const [sharedVideoUrl, setSharedVideoUrl] = useState("");
  const [chat, setChat] = useState([]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const socket = io(SIGNALING_SERVER, { transports: ["websocket"] });
    socketRef.current = socket;
    socket.on("connect-success", ({ id }) => {
      setSocketId(id);
        });

    socket.on("new-connection", (id) => {
      setConnectedIds((prev) => [...new Set([...prev, id])]);
    });

    socket.on("receive-message", ({ from, msg }) => {
      setChat((prev) => [...prev, { from, msg }]);
    });

    socket.on("receive-video", ({ url, action, time }) => {
      if (url && url !== sharedVideoUrl) setSharedVideoUrl(url);
      const player = playerRef.current;
      if (!player) return;
      if (action === "PLAY") player.seekTo(time); 
      if (action === "PAUSE") player.seekTo(time);
      if (action === "SEEK") player.seekTo(time);
    });

    return () => socket.disconnect();
  }, [sharedVideoUrl]);

  const connectFriend = () => {
    if (!targetId.trim()) return;
    socketRef.current.emit("connect-peer", targetId);
    setConnectedIds((p) => [...new Set([...p, targetId])]);
  };

  const shareVideo = () => {
    if (!videoUrl.trim()) return;
    connectedIds.forEach((id) =>
      socketRef.current.emit("send-video", { to: id, url: videoUrl })
    );
    setSharedVideoUrl(videoUrl);
    setVideoUrl("");
  };

  const sendMessage = () => {
    if (!msg.trim()) return;
    connectedIds.forEach((id) =>
      socketRef.current.emit("send-message", { to: id, msg })
    );
    setChat((prev) => [...prev, { from: "You", msg }]);
    setMsg("");
  };

  const broadcastAction = (action) => {
    const time = playerRef.current.getCurrentTime();
    connectedIds.forEach((id) =>
      socketRef.current.emit("send-video", { to: id, action, time })
    );
  };

  return (
    <div
      style={{
        fontFamily: "Inter, sans-serif",
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "#090d14",
        color: "#eee",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 20px",
          background: "#121826",
          borderBottom: "1px solid #1e2536",
        }}
      >
        <div>
          <strong>WatchApp</strong>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <input
            value={name}
            placeholder="Enter your name"
            onChange={(e) => setName(e.target.value)}
            style={{
              padding: "5px 10px",
              borderRadius: 6,
              border: "1px solid #555",
              background: "#1a1f2c",
              color: "#eee",
            }}
          />
          <span style={{ fontSize: 14 }}>Socket ID: {socketId}</span>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: "flex" }}>
        {/* Left: video + URL bar */}
        <div
          style={{
            flex: "2 1 0%",
            padding: 16,
            display: "flex",
            flexDirection: "column",
            borderRight: "1px solid #1e2536",
          }}
        >
          <div
            style={{
              display: "flex",
              marginBottom: 10,
              gap: 8,
            }}
          >
            <input
              placeholder="Paste YouTube URL"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              style={{
                flex: 1,
                padding: "8px 12px",
                background: "#1a1f2c",
                border: "1px solid #333",
                borderRadius: 8,
                color: "#eee",
              }}
            />
            <button
              onClick={shareVideo}
              style={{
                background: "#2563eb",
                border: "none",
                color: "#fff",
                padding: "8px 16px",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              Share
            </button>
          </div>

          <div
            style={{
              background: "#000",
              flex: 1,
              borderRadius: 8,
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {sharedVideoUrl ? (
              <ReactPlayer
                ref={playerRef}
                url={sharedVideoUrl}
                controls
                width="100%"
                height="100%"
                onPlay={() => broadcastAction("PLAY")}
                onPause={() => broadcastAction("PAUSE")}
                onSeek={(t) => broadcastAction("SEEK", t)}
              />
            ) : (
              <span style={{ opacity: 0.6 }}>No video shared yet</span>
            )}
          </div>
        </div>

        {/* Right side */}
        <div
          style={{
            flex: "1 1 0%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            height: "100%",
          }}
        >
          {/* Video calls stacked */}
          <div
            style={{
              flex: 1,
              padding: 16,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                style={{
                  background: "#1a1f2c",
                  borderRadius: 8,
                  height: 100,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid #2f3649",
                  color: "#888",
                }}
              >
                Video Call {i + 1}
              </div>
            ))}
          </div>

          {/* Chat */}
          <div
            style={{
              background: "#111827",
              borderTop: "1px solid #1e2536",
              padding: 12,
              borderRadius: "8px 0 0 0",
            }}
          >
            <div
              style={{
                height: 150,
                overflowY: "auto",
                background: "#0f1729",
                marginBottom: 8,
                padding: 8,
                borderRadius: 8,
              }}
            >
              {chat.map((c, i) => (
                <div key={i}>
                  <strong>{c.from}: </strong>{c.msg}
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
