import React, { useEffect, useRef, useState, useCallback } from "react";
import io from "socket.io-client";
import ReactPlayer from "react-player";

const SIGNALING_SERVER =
  process.env.REACT_APP_SIGNALING_SERVER ||
  "https://webrtc-server-wwai.onrender.com"; // use your actual deployed backend

export default function App() {
  const playerRef = useRef();
  const socketRef = useRef();

  const [name, setName] = useState("");
  const [nameSet, setNameSet] = useState(false);
  const [socketId, setSocketId] = useState("");
  const [hostId, setHostId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [peers, setPeers] = useState([]);
  const [meStatus, setMeStatus] = useState({ camOn: true, micOn: true });
  const [videoUrl, setVideoUrl] = useState("");
  const [sharedVideoUrl, setSharedVideoUrl] = useState("");
  const [chat, setChat] = useState([]);
  const [msg, setMsg] = useState("");

  // Initialize socket only once
  useEffect(() => {
    const socket = io(SIGNALING_SERVER, { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect-success", ({ id }) => {
      setSocketId(id);
      socket.emit("get-host");
    });

    socket.on("host", ({ id }) => setHostId(id));
    socket.on("update-peers", (peerList) => setPeers(peerList));
    socket.on("peer-joined", (peer) =>
      setPeers((prev) => [...prev.filter((p) => p.id !== peer.id), peer])
    );
    socket.on("peer-left", ({ id }) =>
      setPeers((prev) => prev.filter((p) => p.id !== id))
    );
    socket.on("peer-updated", (peer) =>
      setPeers((prev) =>
        prev.map((p) => (p.id === peer.id ? { ...p, ...peer } : p))
      )
    );

    socket.on("new-connection", () => {
      socket.emit("request-peers");
    });

    socket.on("receive-message", ({ from, msg }) => {
      setChat((prev) => [...prev, { from, msg }]);
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

    socket.on("remove-peer", ({ id }) => {
      if (id === socketId) window.location.reload();
    });

    return () => socket.disconnect();
  }, []); // ← keeps it constant

  // Set name once entered
  useEffect(() => {
    if (nameSet && name) {
      socketRef.current?.emit("set-name", { name });
    }
  }, [nameSet, name]);

  const handleNameEnter = (e) => {
    if (e.key === "Enter" && name.trim()) setNameSet(true);
  };

  const connectToFriend = () => {
    if (!targetId.trim()) return;
    socketRef.current.emit("connect-peer", targetId);
    setTargetId("");
  };

  const shareVideo = () => {
    if (!videoUrl.trim()) return;
    peers.forEach((p) =>
      socketRef.current?.emit("send-video", { to: p.id, url: videoUrl })
    );
    setSharedVideoUrl(videoUrl);
    setVideoUrl("");
  };

  const sendMessage = () => {
    if (!msg.trim()) return;
    peers.forEach((p) =>
      socketRef.current?.emit("send-message", { to: p.id, msg })
    );
    setChat((prev) => [...prev, { from: "You", msg }]);
    setMsg("");
  };

  const broadcastAction = (action) => {
    const time = playerRef.current.getCurrentTime();
    peers.forEach((p) =>
      socketRef.current?.emit("send-video", { to: p.id, action, time })
    );
  };

  const toggleMe = useCallback(
    (what) => {
      setMeStatus((prev) => {
        const next = { ...prev, [what]: !prev[what] };
        socketRef.current.emit("update-status", next);
        return next;
      });
    },
    [setMeStatus]
  );

  const leave = () => {
    socketRef.current.emit("leave");
    window.location.reload();
  };

  const removePeer = (id) => {
    socketRef.current.emit("remove-peer", { id });
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
      {/* Header */}
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

      {/* Main Content */}
      <div style={{ flex: 1, display: "flex" }}>
        {/* Left: Video */}
        <div
          style={{
            flex: "2 1 0%",
            padding: 16,
            display: "flex",
            flexDirection: "column",
            borderRight: "1px solid #1e2536",
          }}
        >
          <div style={{ display: "flex", marginBottom: 10, gap: 8 }}>
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
          }}
        >
          {/* Connect field */}
          <div style={{ margin: "14px 0 0 14px", display: "flex", gap: 8 }}>
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

          {/* Peers section */}
          <div
            style={{
              flex: 1,
              padding: 16,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {/* Me */}
            <div
              style={{
                background: "#1a1f2c",
                borderRadius: 8,
                height: 100,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                border: "1px solid #2f3649",
                padding: "0 22px",
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 18 }}>
                {nameSet ? name : "Me"}
              </span>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={() => toggleMe("camOn")}
                  style={{
                    background: meStatus.camOn ? "#34d399" : "#dc2626",
                    color: "#23283c",
                    border: "none",
                    borderRadius: 5,
                    padding: "4px 10px",
                  }}
                >
                  {meStatus.camOn ? "Cam On" : "Cam Off"}
                </button>
                <button
                  onClick={() => toggleMe("micOn")}
                  style={{
                    background: meStatus.micOn ? "#34d399" : "#dc2626",
                    color: "#23283c",
                    border: "none",
                    borderRadius: 5,
                    padding: "4px 10px",
                  }}
                >
                  {meStatus.micOn ? "Mic On" : "Mic Off"}
                </button>
                <button
                  onClick={leave}
                  style={{
                    color: "#dc2626",
                    background: "#1f2937",
                    border: "1px solid #a8a8a8",
                    borderRadius: 8,
                    padding: "4px 8px",
                  }}
                >
                  Leave
                </button>
              </div>
            </div>
            {/* Peer list */}
            {peers
              .filter((p) => p.id !== socketId)
              .map((p) => (
                <div
                  key={p.id}
                  style={{
                    background: "#292f42",
                    borderRadius: 8,
                    height: 100,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    border: "1px solid #2f3649",
                    padding: "0 22px",
                  }}
                >
                  <span style={{ fontWeight: 700 }}>{p.name || "Peer"}</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <span
                      style={{
                        padding: "4px 11px",
                        borderRadius: 9,
                        background: p.camOn ? "#16a34a" : "#b91c1c",
                      }}
                    >
                      {p.camOn ? "Cam On" : "Cam Off"}
                    </span>
                    <span
                      style={{
                        padding: "4px 11px",
                        borderRadius: 9,
                        background: p.micOn ? "#16a34a" : "#b91c1c",
                      }}
                    >
                      {p.micOn ? "Mic On" : "Mic Off"}
                    </span>
                    {hostId === socketId ? (
                      <button
                        onClick={() => removePeer(p.id)}
                        style={{
                          color: "#dc2626",
                          background: "#fff",
                          border: "1px solid #dc2626",
                          borderRadius: 8,
                          padding: "4px 12px",
                          cursor: "pointer",
                        }}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
          </div>

          {/* Chat */}
          <div
            style={{
              background: "#111827",
              borderTop: "1px solid #1e2536",
              padding: 12,
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
