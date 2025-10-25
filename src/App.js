import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import Peer from "simple-peer";
import ReactPlayer from "react-player";

const SIGNALING_SERVER =
  process.env.REACT_APP_SIGNALING_SERVER || "http://localhost:5000";

export default function App() {
  const [name, setName] = useState("");
  const [myId, setMyId] = useState("");
  const [peers, setPeers] = useState({});
  const [isHost, setIsHost] = useState(false);
  const [stream, setStream] = useState(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [sharedVideoUrl, setSharedVideoUrl] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");

  const socketRef = useRef();
  const peersRef = useRef({});
  const myVideo = useRef();

  // 🔹 1. Initialize socket and media
  useEffect(() => {
    socketRef.current = io(SIGNALING_SERVER, { transports: ["websocket"] });

    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((mediaStream) => {
        setStream(mediaStream);
        if (myVideo.current) myVideo.current.srcObject = mediaStream;
      })
      .catch((err) => console.error("Media access error:", err));

    socketRef.current.on("connect", () => {
      setMyId(socketRef.current.id);
      console.log("Connected:", socketRef.current.id);
    });

    socketRef.current.on("host-assigned", () => setIsHost(true));

    socketRef.current.on("user-joined", (payload) => {
      const peer = createPeer(payload.userId, socketRef.current.id, stream);
      peersRef.current[payload.userId] = peer;
      setPeers((prev) => ({ ...prev, [payload.userId]: { peer } }));
    });

    socketRef.current.on("receiving-returned-signal", (payload) => {
      const peerObj = peersRef.current[payload.id];
      if (peerObj) peerObj.signal(payload.signal);
    });

    socketRef.current.on("receive-message", ({ name, message }) => {
      setChatMessages((prev) => [...prev, { name, message }]);
    });

    socketRef.current.on("receive-video", (url) => {
      setSharedVideoUrl(url);
    });

    socketRef.current.on("user-disconnected", (id) => {
      if (peersRef.current[id]) {
        peersRef.current[id].destroy();
        delete peersRef.current[id];
        setPeers((prev) => {
          const updated = { ...prev };
          delete updated[id];
          return updated;
        });
      }
    });

    return () => {
      socketRef.current.disconnect();
      Object.values(peersRef.current).forEach((p) => p.destroy());
    };
  }, [stream]);

  // 🔹 2. Create Peer connection
  function createPeer(userToSignal, callerId, stream) {
    const peer = new Peer({
      initiator: true,
      trickle: false,
      stream,
    });

    peer.on("signal", (signal) => {
      socketRef.current.emit("sending-signal", { userToSignal, callerId, signal });
    });

    peer.on("stream", (remoteStream) => {
      setPeers((prev) => ({
        ...prev,
        [userToSignal]: { ...prev[userToSignal], stream: remoteStream },
      }));
    });

    return peer;
  }

  // 🔹 3. Handle return signal
  function addPeer(incomingSignal, callerId, stream) {
    const peer = new Peer({
      initiator: false,
      trickle: false,
      stream,
    });

    peer.on("signal", (signal) => {
      socketRef.current.emit("returning-signal", { signal, callerId });
    });

    peer.on("stream", (remoteStream) => {
      setPeers((prev) => ({
        ...prev,
        [callerId]: { ...prev[callerId], stream: remoteStream },
      }));
    });

    peer.signal(incomingSignal);
    return peer;
  }

  // 🔹 4. Chat system
  const sendMessage = () => {
    if (chatInput.trim()) {
      socketRef.current.emit("send-message", { name, message: chatInput });
      setChatMessages((prev) => [...prev, { name: "You", message: chatInput }]);
      setChatInput("");
    }
  };

  // 🔹 5. Share video
  const shareVideo = () => {
    if (isHost && videoUrl.trim()) {
      socketRef.current.emit("share-video", videoUrl);
      setSharedVideoUrl(videoUrl);
      setVideoUrl("");
    }
  };

  return (
    <div className="p-4 flex flex-col gap-4 bg-gray-900 text-white min-h-screen">
      {!name ? (
        <div className="flex flex-col items-center justify-center h-screen">
          <input
            placeholder="Enter your name"
            className="p-3 text-black rounded-lg mb-4"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            onClick={() => {
              if (name.trim()) socketRef.current.emit("set-name", name);
            }}
            className="px-6 py-3 bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            Join Room
          </button>
        </div>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">
            Welcome, {name} {isHost && "(Host)"}
          </h1>

          <div className="flex gap-4">
            {/* My video */}
            <video
              ref={myVideo}
              muted
              autoPlay
              playsInline
              className="rounded-lg w-1/3 border border-gray-700"
            />

            {/* Remote videos */}
            {Object.entries(peers).map(([id, { stream }]) =>
              stream ? (
                <video
                  key={id}
                  autoPlay
                  playsInline
                  ref={(video) => {
                    if (video) video.srcObject = stream;
                  }}
                  className="rounded-lg w-1/3 border border-gray-700"
                />
              ) : null
            )}
          </div>

          {/* Shared Video */}
          {sharedVideoUrl && (
            <div className="mt-6">
              <ReactPlayer url={sharedVideoUrl} controls playing width="100%" />
            </div>
          )}

          {/* Share video (Host only) */}
          {isHost && (
            <div className="flex mt-4 gap-2">
              <input
                type="text"
                placeholder="Enter video link (mp4 or YouTube)"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                className="p-3 text-black rounded-lg w-full"
              />
              <button
                onClick={shareVideo}
                className="bg-green-600 px-4 py-2 rounded-lg hover:bg-green-700"
              >
                Share
              </button>
            </div>
          )}

          {/* Chat */}
          <div className="mt-4 bg-gray-800 p-4 rounded-lg w-1/2">
            <div className="h-48 overflow-y-auto border-b border-gray-700 mb-3">
              {chatMessages.map((m, i) => (
                <div key={i}>
                  <strong>{m.name}:</strong> {m.message}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Type message..."
                className="p-2 text-black rounded-lg flex-1"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
              />
              <button
                onClick={sendMessage}
                className="bg-blue-600 px-4 py-2 rounded-lg hover:bg-blue-700"
              >
                Send
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}