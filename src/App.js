import React, { useEffect, useRef, useState, useCallback } from "react";
import io from "socket.io-client";
import Peer from "simple-peer";
import ReactPlayer from "react-player";

const SIGNALING_SERVER =
  process.env.REACT_APP_SIGNALING_SERVER ||
  "https://webrtc-server-wwai.onrender.com";

export default function App() {
  const playerRef = useRef(null);
  const myVideoRef = useRef(null);
  const socketRef = useRef(null);
  // Store Peers instances keyed by peer ID
  const peersRef = useRef({});

  const [name, setName] = useState("");
  const [nameSet, setNameSet] = useState(false);
  const [socketId, setSocketId] = useState("");
  const [hostId, setHostId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [peers, setPeers] = useState([]);
  const [peerStreams, setPeerStreams] = useState({});
  const [meStatus, setMeStatus] = useState({ camOn: false, micOn: false });
  const [stream, setStream] = useState(null);

  const [videoUrl, setVideoUrl] = useState("");
  const [sharedVideoUrl, setSharedVideoUrl] = useState("");
  const [chat, setChat] = useState([]);
  const [msg, setMsg] = useState("");

  // Connect socket once
  useEffect(() => {
    const socket = io(SIGNALING_SERVER, { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect-success", ({ id }) => {
      setSocketId(id);
      socket.emit("get-host");
    });

    socket.on("host", ({ id }) => setHostId(id));

    socket.on("update-peers", (peerList) => setPeers(peerList));

    socket.on("peer-updated", (peer) =>
      setPeers((prev) =>
        prev.map((p) => (p.id === peer.id ? { ...p, ...peer } : p))
      )
    );

    socket.on("peer-left", ({ id }) => {
      setPeers((prev) => prev.filter((p) => p.id !== id));
      setPeerStreams((prev) => {
        const { [id]: removed, ...rest } = prev;
        // Remove peer connection on disconnect
        if (peersRef.current[id]) {
          peersRef.current[id].destroy();
          delete peersRef.current[id];
        }
        return rest;
      });
    });

    // Receive offer: create Peer as responder
    socket.on("offer", ({ from, signal, name: peerName }) => {
      if (peersRef.current[from]) return; // Already connected
      const peer = new Peer({ initiator: false, trickle: false, stream });
      peer.on("signal", (signal) => {
        socket.emit("answer", { to: from, signal });
      });
      peer.on("stream", (remoteStream) => {
        setPeerStreams((prev) => ({ ...prev, [from]: remoteStream }));
      });
      peer.signal(signal);
      peersRef.current[from] = peer;
    });

    // Receive answer: signal initiator peer
    socket.on("answer", ({ from, signal }) => {
      if (peersRef.current[from]) {
        peersRef.current[from].signal(signal);
      }
    });

    // Chat receive with deduplication of own messages
    socket.on("receive-message", ({ from, name: fromName, msg }) => {
      if (from !== socketId) {
        setChat((prev) => [...prev, { from, fromName: fromName ?? from, msg }]);
      }
    });

    // YouTube video sync
    socket.on("receive-video", ({ url, action, time }) => {
      if (url && url !== sharedVideoUrl) setSharedVideoUrl(url);
      const player = playerRef.current;
      if (player) {
        if (action === "PLAY") player.seekTo(time);
        if (action === "PAUSE") player.seekTo(time);
        if (action === "SEEK") player.seekTo(time);
      }
    });

    // Remove / Kick peer
    socket.on("remove-peer", ({ id }) => {
      if (id === socketId) window.location.reload();
    });

    return () => {
      socket.disconnect();
      Object.values(peersRef.current).forEach((p) => p.destroy());
      peersRef.current = {};
    };
  }, []);

  // Send name on set
  useEffect(() => {
    if (nameSet && name) {
      socketRef.current?.emit("set-name", { name });
    }
  }, [nameSet, name]);

  // When peers or stream changes, create peers for unconnected neighbors
  useEffect(() => {
    if (!socketId) return;
    if (!window.peersRef) window.peersRef = peersRef.current;
    peers
      .filter((p) => p.id !== socketId)
      .forEach((p) => {
        if (!peersRef.current[p.id]) {
          callPeer(p.id, stream);
        }
      });
  }, [peers, stream, socketId]);

  // Call peer initiator
  const callPeer = (targetId, mediaStream) => {
    if (!window.peersRef) window.peersRef = {};
    if (window.peersRef[targetId]) return; // Already connected

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

    peer.on("close", () => {
      peer.destroy();
      delete peersRef.current[targetId];
      setPeerStreams((prev) => {
        const { [targetId]: ignored, ...rest } = prev;
        return rest;
      });
    });

    peer.on("error", (err) => {
      console.error("Peer error:", err);
    });

    window.peersRef[targetId] = peer;
  };

  // Toggle Camera
  const toggleCam = () => {
    if (meStatus.camOn) {
      stopCamMic();
    } else {
      navigator.mediaDevices
        .getUserMedia({ video: true, audio: false })
        .then((mediaStream) => {
          setStream(mediaStream);
          setMeStatus((s) => ({ ...s, camOn: true }));
          if (myVideoRef.current) myVideoRef.current.srcObject = mediaStream;
          // Add video track to existing peers
          Object.values(peersRef.current).forEach((peer) => {
            const videoTrack = mediaStream.getVideoTracks()[0];
            if (videoTrack) peer.addTrack(videoTrack, mediaStream);
          });
          socketRef.current.emit("update-status", {
            camOn: true,
            micOn: meStatus.micOn,
          });
        });
    }
  };

  // Toggle Mic
  const toggleMic = () => {
    if (meStatus.micOn) {
      setMeStatus((s) => {
        if (stream) stream.getAudioTracks().forEach((t) => (t.enabled = false));
        socketRef.current.emit("update-status", { camOn: meStatus.camOn, micOn: false });
        return { ...s, micOn: false };
      });
    } else {
      navigator.mediaDevices
        .getUserMedia({ audio: true, video: false })
        .then((mediaStream) => {
          setMeStatus((s) => ({ ...s, micOn: true }));
          if (stream && mediaStream.getAudioTracks().length > 0) {
            // Add audio track to existing peers
            Object.values(peersRef.current).forEach((peer) => {
              const audioTrack = mediaStream.getAudioTracks()[0];
              if (audioTrack) peer.addTrack(audioTrack, mediaStream);
            });
          }
          socketRef.current.emit("update-status", { camOn: meStatus.camOn, micOn: true });
        });
    }
  };

  const stopCamMic = () => {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
    setStream(null);
    setMeStatus({ camOn: false, micOn: false });
    if (myVideoRef.current) myVideoRef.current.srcObject = null;
    socketRef.current.emit("update-status", { camOn: false, micOn: false });
  };

  const handleNameEnter = (e) => {
    if (e.key === "Enter" && name.trim()) setNameSet(true);
  };

  const connectToFriend = () => {
    if (!targetId.trim() || targetId.length !== 5) {
      alert("Please enter a valid 5-character Socket ID.");
      return;
    }
    socketRef.current.emit("connect-peer", targetId);
    setTargetId("");
  };

  const sendMessage = () => {
    if (!msg.trim()) return;
    (peers || []).forEach((p) =>
      socketRef.current?.emit("send-message", { to: p.id, msg, name: nameSet ? name : "" })
    );
    setChat((prev) => [...prev, { from: socketId, fromName: "You", msg }]);
    setMsg("");
  };

  const shareVideo = () => {
    if (!videoUrl.trim()) return;
    (peers || []).forEach((p) => socketRef.current?.emit("send-video", { to: p.id, url: videoUrl }));
    setSharedVideoUrl(videoUrl);
    setVideoUrl("");
  };

  const broadcastAction = (action) => {
    const time = playerRef.current.getCurrentTime();
    (peers || []).forEach((p) =>
      socketRef.current?.emit("send-video", { to: p.id, action, time })
    );
  };

  const leave = () => {
    socketRef.current.emit("leave");
    window.location.reload();
  };

  const removePeer = (id) => {
    socketRef.current.emit("remove-peer", { id });
  };

  return (
    <div style={{ fontFamily: "Inter, sans-serif", display: "flex", flexDirection: "column", height: "100vh", width: "100vw", boxSizing: "border-box", background: "#090d14", color: "#eee", overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 20px", background: "#121826", borderBottom: "1px solid #1e2536" }}>
        <div style={{ fontWeight: 700, fontSize: 28 }}>WatchApp</div>
        {nameSet ? (
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontSize: 20 }}>{name}</span>
            <span style={{ background: "#2d364d", padding: "4px 12px", borderRadius: 12, fontWeight: 700, letterSpacing: 2, fontSize: 18 }}>{socketId}</span>
          </div>
        ) : (
          <input autoFocus value={name} placeholder="Enter your name" onChange={(e) => setName(e.target.value)} onKeyDown={handleNameEnter} style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid #555", background: "#1a1f2c", color: "#eee", fontSize: 20 }} />
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: "2 1 0%", minWidth: 0, display: "flex", flexDirection: "column", padding: 12, gap: 12 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input placeholder="Paste YouTube URL" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} style={{ flex: 1, padding: "8px 12px", fontSize: 16, background: "#1a1f2c", color: "#eee", border: "1px solid #333", borderRadius: 8 }} />
            <button onClick={shareVideo} style={{ background: "#2563eb", border: "none", color: "#fff", padding: "8px 18px", borderRadius: 8, cursor: "pointer" }}>Share</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, background: "#000", borderRadius: 8, position: "relative" }}>
            {sharedVideoUrl ? (
              <ReactPlayer url={sharedVideoUrl} ref={playerRef} controls width="100%" height="100%" muted playing onPlay={() => broadcastAction("PLAY")} onPause={() => broadcastAction("PAUSE")} onSeek={(t) => broadcastAction("SEEK", t)} style={{ position: "absolute", width: "100%", height: "100%", top: 0, left: 0 }} />
            ) : <span style={{ opacity: 0.6, padding: 20 }}>No video shared yet</span>}
          </div>
        </div>
        <div style={{ flex: "1 1 0%", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 12, gap: 12 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input placeholder="Enter socket ID" value={targetId} onChange={(e) => setTargetId(e.target.value.toUpperCase())} maxLength={5} style={{ padding: "8px 10px", background: "#23283c", border: "1px solid #2d364d", borderRadius: 7, color: "#eee", width: 170 }} />
            <button onClick={connectToFriend} style={{ background: "#4ade80", color: "#23283c", padding: "7px 20px", border: "none", borderRadius: 7, fontWeight: 700, cursor: "pointer" }}>Connect</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
            <div style={{ background: "#1a1f2c", borderRadius: 8, height: 120, display: "flex", alignItems: "center", gap: 20, padding: "0 16px" }}>
              <span style={{ fontWeight: 700, fontSize: 18 }}>{nameSet ? name : "You"}</span>
              <video ref={myVideoRef} autoPlay muted playsInline style={{ width: 80, height: 80, background: "#000", borderRadius: 8, objectFit: "cover", display: meStatus.camOn ? "" : "none" }} />
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={toggleCam} style={{ background: meStatus.camOn ? "#34d399" : "#dc2626", color: "#23283c", border: "none", borderRadius: 5, padding: "4px 10px" }}>{meStatus.camOn ? "Cam On" : "Cam Off"}</button>
                <button onClick={toggleMic} style={{ background: meStatus.micOn ? "#34d399" : "#dc2626", color: "#23283c", border: "none", borderRadius: 5, padding: "4px 10px" }}>{meStatus.micOn ? "Mic On" : "Mic Off"}</button>
                <button onClick={leave} style={{ color: "#dc2626", background: "#1f2937", border: "1px solid #a8a8a8", borderRadius: 8, padding: "4px 8px" }}>Leave</button>
              </div>
            </div>
            {peers.filter(p => p.id !== socketId).map(p => (
              <div key={p.id} style={{ background: "#292f42", borderRadius: 8, minHeight: 120, display: "flex", alignItems: "center", gap: 20, padding: "0 16px" }}>
                <span style={{ fontWeight: 700 }}>{p.name || "Peer"}</span>
                <video autoPlay playsInline muted={!p.micOn} style={{ width: 80, height: 80, background: "#000", borderRadius: 8, objectFit: "cover", display: p.camOn && peerStreams[p.id] ? "" : "none" }} ref={el => { if (el && peerStreams[p.id]) el.srcObject = peerStreams[p.id]; }} />
                <div style={{ display: "flex", gap: 6 }}>
                  <span style={{ background: p.camOn ? "#16a34a" : "#b91c1c", padding: "4px 10px", borderRadius: 6, color: "#fff" }}>{p.camOn ? "Cam On" : "Cam Off"}</span>
                  <span style={{ background: p.micOn ? "#16a34a" : "#b91c1c", padding: "4px 10px", borderRadius: 6, color: "#fff" }}>{p.micOn ? "Mic On" : "Mic Off"}</span>
                  {hostId === socketId ? (<button onClick={() => removePeer(p.id)} style={{ color: "#dc2626", background: "#fff", border: "1px solid #dc2626", borderRadius: 8, padding: "4px 12px", cursor: "pointer" }}>Remove</button>) : null}
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
