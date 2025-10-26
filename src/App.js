import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import Peer from "simple-peer";
import ReactPlayer from "react-player";

const SIGNALING_SERVER =
  process.env.REACT_APP_SIGNALING_SERVER ||
  "https://webrtc-server-wwai.onrender.com";

export default function App() {
  const playerRef = useRef(null);
  const myVideoRef = useRef(null);
  const chatEndRef = useRef(null);
  const socketRef = useRef(null);
  const peersRef = useRef({});

  const [name, setName] = useState("");
  const [nameSet, setNameSet] = useState(false);
  const [socketId, setSocketId] = useState("");
  const [hostId, setHostId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [peers, setPeers] = useState([]);
  const [peerStreams, setPeerStreams] = useState({});
  const [meStatus, setMeStatus] = useState({ camOn: false, micOn: false });
  const [mediaStream, setMediaStream] = useState(null);

  const [videoUrl, setVideoUrl] = useState("");
  const [sharedVideoUrl, setSharedVideoUrl] = useState("");
  const [chat, setChat] = useState([]);
  const [msg, setMsg] = useState("");

  // --- SOCKET SETUP ---
  useEffect(() => {
    const socket = io(SIGNALING_SERVER, { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect-success", ({ id }) => {
      setSocketId(id);
      socket.emit("get-host");
    });

    socket.on("host", ({ id }) => setHostId(id));

    socket.on("update-peers", (peerList) => {
      setPeers(peerList);
    });

    socket.on("peer-updated", (peer) =>
      setPeers((prev) =>
        prev.map((p) => (p.id === peer.id ? { ...p, ...peer } : p))
      )
    );

    socket.on("peer-left", ({ id }) => {
      setPeers((prev) => prev.filter((p) => p.id !== id));
      cleanupPeer(id);
    });

    socket.on("offer", ({ from, signal }) => {
      if (peersRef.current[from]) return;
      const peer = createPeer(false, from);
      peersRef.current[from] = peer;
      peer.signal(signal);
    });

    socket.on("answer", ({ from, signal }) => {
      if (peersRef.current[from]) {
        peersRef.current[from].signal(signal);
      }
    });

    socket.on("receive-message", ({ from, name: fromName, msg }) => {
      if (from !== socketId)
        setChat((prev) => [...prev, { from, fromName: fromName ?? from, msg }]);
    });

    socket.on("receive-video", ({ url, action, time }) => {
      if (url && url !== sharedVideoUrl) setSharedVideoUrl(url);
      const player = playerRef.current;
      if (!player) return;

      if (action === "PLAY") {
        player.seekTo(time);
        player.getInternalPlayer()?.playVideo?.();
      } else if (action === "PAUSE") {
        player.seekTo(time);
        player.getInternalPlayer()?.pauseVideo?.();
      } else if (action === "SEEK") {
        player.seekTo(time);
      }
    });

    socket.on("remove-peer", ({ id }) => {
      if (id === socketId) window.location.reload();
    });

    return () => {
      socket.disconnect();
      Object.values(peersRef.current).forEach((p) => p.destroy());
      peersRef.current = {};
    };
  }, [sharedVideoUrl]);

  // --- HELPER: CREATE PEER ---
  const createPeer = (initiator, remoteId) => {
    const peer = new Peer({ initiator, trickle: false });
    peer.on("signal", (signal) => {
      socketRef.current.emit(initiator ? "offer" : "answer", {
        to: remoteId,
        signal,
        name,
      });
    });
    peer.on("stream", (remoteStream) => {
      setPeerStreams((prev) => ({ ...prev, [remoteId]: remoteStream }));
    });
    peer.on("close", () => cleanupPeer(remoteId));
    peer.on("error", () => cleanupPeer(remoteId));

    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => {
        try {
          peer.addTrack(track, mediaStream);
        } catch {}
      });
    }

    return peer;
  };

  const cleanupPeer = (id) => {
    if (peersRef.current[id]) {
      peersRef.current[id].destroy();
      delete peersRef.current[id];
    }
    setPeerStreams((prev) => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
  };

  // --- NAME SYNC ---
  useEffect(() => {
    if (nameSet && name) socketRef.current?.emit("set-name", { name });
  }, [nameSet, name]);

  // --- DYNAMIC PEER CREATION ---
  useEffect(() => {
    if (!socketId) return;
    peers
      .filter((p) => p.id !== socketId)
      .forEach((p) => {
        if (!peersRef.current[p.id]) {
          peersRef.current[p.id] = createPeer(true, p.id);
        }
      });
  }, [peers, socketId]);

  // --- MEDIA MANAGEMENT ---
  const setupMedia = async (enableVideo, enableAudio) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: enableVideo,
        audio: enableAudio,
      });
      if (myVideoRef.current) myVideoRef.current.srcObject = stream;
      setMediaStream(stream);
      return stream;
    } catch (err) {
      console.error("Error accessing media:", err);
      return null;
    }
  };

  const toggleCam = async () => {
    if (!meStatus.camOn) {
      const stream = mediaStream || (await setupMedia(true, meStatus.micOn));
      if (!stream) return;
      stream.getVideoTracks().forEach((track) => (track.enabled = true));
      setMeStatus((s) => ({ ...s, camOn: true }));
    } else {
      if (mediaStream) {
        mediaStream.getVideoTracks().forEach((track) => (track.enabled = false));
      }
      setMeStatus((s) => ({ ...s, camOn: false }));
    }
    socketRef.current.emit("update-status", meStatus);
  };

  const toggleMic = async () => {
    if (!meStatus.micOn) {
      const stream = mediaStream || (await setupMedia(meStatus.camOn, true));
      if (!stream) return;
      stream.getAudioTracks().forEach((track) => (track.enabled = true));
      setMeStatus((s) => ({ ...s, micOn: true }));
    } else {
      if (mediaStream) {
        mediaStream.getAudioTracks().forEach((track) => (track.enabled = false));
      }
      setMeStatus((s) => ({ ...s, micOn: false }));
    }
    socketRef.current.emit("update-status", meStatus);
  };

  const leave = () => {
    socketRef.current.emit("leave");
    window.location.reload();
  };

  // --- CHAT ---
  const sendMessage = () => {
    if (!msg.trim()) return;
    (peers || []).forEach((p) =>
      socketRef.current.emit("send-message", {
        to: p.id,
        msg,
        name: nameSet ? name : "",
      })
    );
    setChat((prev) => [...prev, { from: socketId, fromName: "You", msg }]);
    setMsg("");
  };

  // --- VIDEO SYNC ---
  const shareVideo = () => {
    if (!videoUrl.trim()) return;
    (peers || []).forEach((p) =>
      socketRef.current.emit("send-video", { to: p.id, url: videoUrl })
    );
    setSharedVideoUrl(videoUrl);
    setVideoUrl("");
  };

  const broadcastAction = (action) => {
    const time = playerRef.current?.getCurrentTime?.() ?? 0;
    (peers || []).forEach((p) =>
      socketRef.current.emit("send-video", { to: p.id, action, time })
    );
  };

  // --- CONNECT TO PEER ---
  const connectToFriend = () => {
    if (!targetId.trim() || targetId.length !== 5) {
      alert("Please enter a valid 5-character Socket ID.");
      return;
    }
    socketRef.current.emit("connect-peer", targetId);
    setTargetId("");
  };

  const handleNameEnter = (e) => {
    if (e.key === "Enter" && name.trim()) setNameSet(true);
  };

  const removePeer = (id) => {
    socketRef.current.emit("remove-peer", { id });
  };

  // --- CHAT AUTOSCROLL ---
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  return (
    <div
      style={{
        fontFamily: "Inter, sans-serif",
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100vw",
        background: "#090d14",
        color: "#eee",
        overflow: "hidden",
      }}
    >
      {/* HEADER */}
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

      {/* MAIN LAYOUT */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* LEFT: VIDEO PLAYER */}
        <div style={{ flex: 2, display: "flex", flexDirection: "column", padding: 12, gap: 12 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              placeholder="Paste YouTube URL"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              style={{
                flex: 1,
                padding: "8px 12px",
                fontSize: 16,
                background: "#1a1f2c",
                color: "#eee",
                border: "1px solid #333",
                borderRadius: 8,
              }}
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

          <div style={{ flex: 1, background: "#000", borderRadius: 8, position: "relative" }}>
            {sharedVideoUrl ? (
              <ReactPlayer
                url={sharedVideoUrl}
                ref={playerRef}
                controls
                width="100%"
                height="100%"
                muted
                playing
                onPlay={() => broadcastAction("PLAY")}
                onPause={() => broadcastAction("PAUSE")}
                onSeek={(t) => broadcastAction("SEEK", t)}
                style={{ position: "absolute", width: "100%", height: "100%" }}
              />
            ) : (
              <span style={{ opacity: 0.6, padding: 20 }}>No video shared yet</span>
            )}
          </div>
        </div>

        {/* RIGHT: PEERS + CHAT */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 12, gap: 12 }}>
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

          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
            <div
              style={{
                background: "#1a1f2c",
                borderRadius: 8,
                height: 120,
                display: "flex",
                alignItems: "center",
                gap: 20,
                padding: "0 16px",
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 18 }}>
                {nameSet ? name : "You"}
              </span>
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
                  display: meStatus.camOn && mediaStream ? "" : "none",
                }}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={toggleCam}
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
                  onClick={toggleMic}
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
                      display: p.camOn && peerStreams[p.id] ? "" : "none",
                    }}
                    ref={(el) => {
                      if (el && peerStreams[p.id]) el.srcObject = peerStreams[p.id];
                    }}
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    <span
                      style={{
                        background: p.camOn ? "#16a34a" : "#b91c1c",
                        padding: "4px 10px",
                        borderRadius: 6,
                        color: "#fff",
                      }}
                    >
                      {p.camOn ? "Cam On" : "Cam Off"}
                    </span>
                    <span
                      style={{
                        background: p.micOn ? "#16a34a" : "#b91c1c",
                        padding: "4px 10px",
                        borderRadius: 6,
                        color: "#fff",
                      }}
                    >
                      {p.micOn ? "Mic On" : "Mic Off"}
                    </span>
                    {hostId === socketId && (
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
                    )}
                  </div>
                </div>
              ))}
          </div>

          <div style={{ background: "#111827", borderTop: "1px solid #1e2536", padding: 10 }}>
           <div style={{ height: 140, overflowY: "auto", background: "#0f1729", marginBottom: 8, padding: 8, borderRadius: 8 }}>
              {chat.map((c, i) => (
                <div key={i}>
                  <strong>{c.from === socketId ? "You" : c.fromName || c.from}:</strong> {c.msg}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input placeholder="Type message" value={msg} onChange={e => setMsg(e.target.value)} style={{ flex: 1, border: "1px solid #333", padding: "6px 10px", borderRadius: 6, background: "#1a1f2c", color: "#eee" }} />
              <button onClick={sendMessage} style={{ background: "#2563eb", color: "white", border: "none", padding: "6px 16px", borderRadius: 6, cursor: "pointer" }}>Send</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
