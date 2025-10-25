import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import Peer from "simple-peer";
import process from "process";
window.process = process;

const SIGNALING_SERVER = "https://192.168.0.126:5000"; // replace with your LAN/public server URL
const socket = io(SIGNALING_SERVER);

function App() {
  const [myId, setMyId] = useState("");
  const [myName, setMyName] = useState("");
  const [targetId, setTargetId] = useState("");
  const [chat, setChat] = useState([]);
  const [msg, setMsg] = useState("");
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [videoFile, setVideoFile] = useState("myvideo.mp4"); // default video
  const [currentVideo, setCurrentVideo] = useState(videoFile);
  const [isHost, setIsHost] = useState(false);

  const myVideoRef = useRef();
  const localStreamRef = useRef();
  const peersRef = useRef({});

  // -----------------------------
  // Socket Setup
  // -----------------------------
  useEffect(() => {
    socket.on("yourShortId", setMyId);

    socket.on("signal", async ({ from, type, payload }) => {
      if (type === "offer") {
        await ensureLocalStream();
        const peer = new Peer({
          initiator: false,
          trickle: false,
          stream: localStreamRef.current,
          config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }
        });

        peer.on("signal", (responseSignal) => {
          socket.emit("signal", { toShortId: from, type: "answer", payload: responseSignal });
        });

        peer.on("stream", (stream) => addRemoteStream(from, stream));

        peer.signal(payload);
        peersRef.current[from] = peer;

      } else if (type === "answer") {
        peersRef.current[from] && peersRef.current[from].signal(payload);
      }
    });

    socket.on("chat", (d) => setChat((prev) => [...prev, d]));

    socket.on("changeVideo", (newVideo) => setCurrentVideo(newVideo));

    socket.on("hostAssigned", (hostId) => {
      if (hostId === myId) {
        setIsHost(true);
      }
    },[myId]);

    return () => {
      socket.off("yourShortId");
      socket.off("signal");
      socket.off("chat");
      socket.off("changeVideo");
      socket.off("hostAssigned");
    };
  }, []);

  // -----------------------------
  // Video stream
  // -----------------------------
  async function ensureLocalStream() {
    if (localStreamRef.current) return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = s;
      myVideoRef.current.srcObject = s;
      myVideoRef.current.muted = true;
    } catch {
      console.warn("Camera/mic not available");
      localStreamRef.current = new MediaStream(); // fallback
    }
  }

  function addRemoteStream(peerId, stream) {
    setRemoteStreams(prev => {
      if (prev.find(r => r.id === peerId)) return prev;
      return [...prev, { id: peerId, stream }];
    });
  }

  function callPeer() {
    if (!targetId) return;
    ensureLocalStream().then(() => {
      const peer = new Peer({
        initiator: true,
        trickle: false,
        stream: localStreamRef.current,
        config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }
      });

      peer.on("signal", (signalData) => {
        socket.emit("signal", { toShortId: targetId, type: "offer", payload: signalData });
      });

      peer.on("stream", (stream) => addRemoteStream(targetId, stream));

      peersRef.current[targetId] = peer;
    });
  }

  // -----------------------------
  // Chat
  // -----------------------------
  function sendMessage() {
    if (!msg) return;
    socket.emit("chat", { text: msg, name: myName || "You" });
    setMsg("");
  }

  // -----------------------------
  // Host sets video
  // -----------------------------
  function setHostVideo() {
    if (!videoFile) return;
    setCurrentVideo(videoFile);
    socket.emit("changeVideo", videoFile); // broadcast to all peers
  }

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <div style={{ fontFamily: "Arial, sans-serif", padding: 20 }}>
      <h1>🎥 Multi-Peer LAN Video + Chat + Shared Video</h1>

      <div style={{ marginBottom: 10 }}>
        <strong>Your ID:</strong> <code>{myId}</code>
      </div>

      <div style={{ marginBottom: 10 }}>
        <input
          value={myName}
          onChange={(e) => setMyName(e.target.value)}
          placeholder="Enter your name"
          style={{ padding: 6, width: 200 }}
        />
        <button onClick={() => socket.emit("setName", myName)} style={{ marginLeft: 8, padding: "6px 12px" }}>
          Set Name
        </button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
        <div>
          <video ref={myVideoRef} autoPlay playsInline style={{ width: 240, border: "2px solid #ccc", borderRadius: 8 }} />
          <div style={{ textAlign: "center" }}>{myName || "You"}</div>
        </div>

        {remoteStreams.map(r => (
          <div key={r.id}>
            <video ref={el => { if(el) el.srcObject = r.stream }} autoPlay playsInline style={{ width: 240, border: "2px solid #ccc", borderRadius: 8 }} />
            <div style={{ textAlign: "center" }}>{r.id}</div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 10 }}>
        <input
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          placeholder="Enter 5-char target ID"
          style={{ padding: 6, width: 200 }}
        />
        <button onClick={callPeer} style={{ marginLeft: 8, padding: "6px 12px" }}>Call</button>
        <button onClick={ensureLocalStream} style={{ marginLeft: 8, padding: "6px 12px" }}>Enable Camera</button>
      </div>

      <div style={{ marginTop: 20 }}>
        <h3>💬 Chat</h3>
        <div style={{ height: 180, overflowY: "auto", border: "1px solid #ddd", padding: 8, borderRadius: 6, background: "#fafafa" }}>
          {chat.map((c, i) => <div key={i}><b>{c.name}:</b> {c.text}</div>)}
        </div>
        <div style={{ marginTop: 6 }}>
          <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Type a message" style={{ padding: 6, width: 240 }} />
          <button onClick={sendMessage} style={{ marginLeft: 8, padding: "6px 12px" }}>Send</button>
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <h3>📺 Shared Video</h3>

        {isHost && (
          <div style={{ marginBottom: 6 }}>
            <input
              value={videoFile}
              onChange={(e) => setVideoFile(e.target.value)}
              placeholder="Enter video filename (e.g., myvideo.mp4)"
              style={{ padding: 6, width: 300 }}
            />
            <button onClick={setHostVideo} style={{ marginLeft: 8, padding: "6px 12px" }}>Play Video</button>
          </div>
        )}

        <video
          key={currentVideo}
          width="560"
          height="315"
          controls
          autoPlay
        >
          <source src={`/videos/${currentVideo}`} type="video/mp4" />
          Your browser does not support the video tag.
        </video>
      </div>
    </div>
  );
}

export default App;
