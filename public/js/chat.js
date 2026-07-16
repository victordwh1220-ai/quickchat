// chat.js — QuickChat chat room client logic

(() => {
  const roomCode = window.location.pathname.split("/chat/")[1]?.replace(/[^0-9]/g, "").slice(0, 5);

  const messagesEl = document.getElementById("messages");
  const roomCodeLabel = document.getElementById("roomCodeLabel");
  const onlineCountEl = document.getElementById("onlineCount");
  const exitBtn = document.getElementById("exitBtn");
  const notFoundOverlay = document.getElementById("notFoundOverlay");
  const messageForm = document.getElementById("messageForm");
  const messageInput = document.getElementById("messageInput");
  const sendBtn = document.getElementById("sendBtn");

  const attachBtn = document.getElementById("attachBtn");
  const imageInput = document.getElementById("imageInput");
  const imagePreviewBar = document.getElementById("imagePreviewBar");
  const imagePreviewThumb = document.getElementById("imagePreviewThumb");
  const removeImageBtn = document.getElementById("removeImageBtn");

  const imageViewer = document.getElementById("imageViewer");
  const imageViewerImg = document.getElementById("imageViewerImg");

  const nameModal = document.getElementById("nameModal");
  const modalRoomCode = document.getElementById("modalRoomCode");
  const nameForm = document.getElementById("nameForm");
  const nameInput = document.getElementById("nameInput");

  const callBtn = document.getElementById("callBtn");
  const callBar = document.getElementById("callBar");
  const callCountEl = document.getElementById("callCount");
  const muteBtn = document.getElementById("muteBtn");
  const muteIcon = document.getElementById("muteIcon");
  const leaveCallBtn = document.getElementById("leaveCallBtn");
  const remoteAudios = document.getElementById("remoteAudios");

  const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB raw file size cap
  const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

  let pendingImage = null; // { dataUrl }

  // ---------- Voice call state ----------
  let localStream = null;
  let inCall = false;
  let isMuted = false;
  const peers = {}; // socketId -> { pc: RTCPeerConnection, audioEl: HTMLAudioElement }

  if (!roomCode || roomCode.length !== 5) {
    nameModal.classList.add("hidden");
    notFoundOverlay.classList.remove("hidden");
  } else {
    roomCodeLabel.textContent = roomCode;
    modalRoomCode.textContent = roomCode;
    initSocketAndAwaitName();
  }

  function initSocketAndAwaitName() {
    const socket = io();
    let joined = false;

    // Autofocus the name field so people can just start typing
    setTimeout(() => nameInput.focus(), 100);

    nameForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = nameInput.value.trim().slice(0, 20);
      const submitBtn = nameForm.querySelector("button[type=submit]");
      submitBtn.disabled = true;

      socket.emit("join-room", { roomCode, name });
    });

    socket.on("joined", ({ nickname, onlineCount }) => {
      joined = true;
      nameModal.classList.add("hidden");
      onlineCountEl.textContent = `${onlineCount} online`;
      addSystemMessage(`You joined as ${nickname}`);
      wireChatUI(socket);
    });

    socket.on("join-error", ({ message }) => {
      if (!joined) {
        nameModal.classList.add("hidden");
      }
      notFoundOverlay.classList.remove("hidden");
    });

    socket.on("disconnect", () => {
      if (joined) addSystemMessage("Connection lost, reconnecting...");
    });
  }

  function wireChatUI(socket) {
    socket.on("system-message", ({ text, onlineCount }) => {
      addSystemMessage(text);
      if (typeof onlineCount === "number") {
        onlineCountEl.textContent = `${onlineCount} online`;
      }
    });

    socket.on("chat-message", (msg) => {
      const isMine = msg.senderId === socket.id;
      addChatMessage(msg, isMine);
    });

    socket.on("image-error", ({ message }) => {
      addSystemMessage(message || "Image failed to send");
    });

    messageForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = messageInput.value.trim();

      if (pendingImage) {
        socket.emit("send-message", { text, image: pendingImage.dataUrl });
        clearPendingImage();
      } else if (text) {
        socket.emit("send-message", { text });
      } else {
        return;
      }

      messageInput.value = "";
      messageInput.style.height = "auto";
    });

    // Enter to send, Shift+Enter for newline
    messageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        messageForm.requestSubmit();
      }
    });

    // Auto-grow textarea
    messageInput.addEventListener("input", () => {
      messageInput.style.height = "auto";
      messageInput.style.height = Math.min(messageInput.scrollHeight, 128) + "px";
    });

    exitBtn.addEventListener("click", () => {
      // Name lives only in this page's memory (nameInput/socket state) — leaving
      // the page never persists it anywhere (no localStorage/cookies used).
      if (inCall) leaveVoiceCall(socket);
      window.location.href = "/";
    });

    // ---------- Image attach flow ----------
    attachBtn.addEventListener("click", () => imageInput.click());

    imageInput.addEventListener("change", () => {
      const file = imageInput.files[0];
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        addSystemMessage("Only image files are supported");
        imageInput.value = "";
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        addSystemMessage("Image is too large (max 4MB)");
        imageInput.value = "";
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        pendingImage = { dataUrl: reader.result };
        imagePreviewThumb.src = reader.result;
        imagePreviewBar.classList.remove("hidden");
      };
      reader.readAsDataURL(file);
    });

    removeImageBtn.addEventListener("click", clearPendingImage);

    function clearPendingImage() {
      pendingImage = null;
      imageInput.value = "";
      imagePreviewThumb.src = "";
      imagePreviewBar.classList.add("hidden");
    }

    // ---------- Voice call flow ----------
    socket.on("call-participants", ({ participants }) => {
      // We just joined the call — connect out to everyone already in it
      participants.forEach((p) => createPeerConnection(socket, p.socketId, true));
      updateCallCount();
    });

    socket.on("call-user-joined", ({ socketId }) => {
      // Someone new joined after us — they'll initiate the offer to us,
      // we just need a peer connection ready to receive it
      if (inCall) {
        createPeerConnection(socket, socketId, false);
        updateCallCount();
      }
    });

    socket.on("call-user-left", ({ socketId }) => {
      destroyPeerConnection(socketId);
      updateCallCount();
    });

    socket.on("webrtc-signal", async ({ from, type, payload }) => {
      const peer = peers[from] || createPeerConnection(socket, from, false);
      const pc = peer.pc;

      if (type === "offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(payload));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("webrtc-signal", { to: from, type: "answer", payload: answer });
      } else if (type === "answer") {
        await pc.setRemoteDescription(new RTCSessionDescription(payload));
      } else if (type === "candidate" && payload) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(payload));
        } catch (err) {
          // Ignore benign candidate errors (e.g. arriving after connection closed)
        }
      }
    });

    callBtn.addEventListener("click", async () => {
      if (inCall) return;
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        addSystemMessage("Couldn't access your microphone");
        return;
      }
      inCall = true;
      isMuted = false;
      callBar.classList.remove("hidden");
      callBar.classList.add("flex");
      callBtn.classList.add("bg-accent", "border-accent");
      callBtn.classList.remove("bg-surface2");
      addSystemMessage("You joined the voice call");
      socket.emit("call-join");
      updateCallCount();
    });

    muteBtn.addEventListener("click", () => {
      if (!localStream) return;
      isMuted = !isMuted;
      localStream.getAudioTracks().forEach((track) => (track.enabled = !isMuted));
      muteBtn.classList.toggle("bg-ember", isMuted);
      muteBtn.classList.toggle("border-ember", isMuted);
      muteIcon.innerHTML = isMuted
        ? '<path d="M1 1l22 22"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M19 10v2a7 7 0 0 1-.11 1.23M12 19v4M8 23h8"/>'
        : '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>';
    });

    leaveCallBtn.addEventListener("click", () => leaveVoiceCall(socket));

    function updateCallCount() {
      callCountEl.textContent = Object.keys(peers).length + 1;
    }
  }

  function createPeerConnection(socket, targetId, isInitiator) {
    if (peers[targetId]) return peers[targetId];

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    remoteAudios.appendChild(audioEl);

    peers[targetId] = { pc, audioEl };

    if (localStream) {
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit("webrtc-signal", { to: targetId, type: "candidate", payload: e.candidate });
      }
    };

    pc.ontrack = (e) => {
      audioEl.srcObject = e.streams[0];
    };

    if (isInitiator) {
      pc.onnegotiationneeded = async () => {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("webrtc-signal", { to: targetId, type: "offer", payload: offer });
      };
    }

    return peers[targetId];
  }

  function destroyPeerConnection(targetId) {
    const peer = peers[targetId];
    if (!peer) return;
    peer.pc.close();
    peer.audioEl.remove();
    delete peers[targetId];
  }

  function leaveVoiceCall(socket) {
    if (!inCall) return;
    inCall = false;

    Object.keys(peers).forEach(destroyPeerConnection);

    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      localStream = null;
    }

    socket.emit("call-leave");
    callBar.classList.add("hidden");
    callBar.classList.remove("flex");
    callBtn.classList.remove("bg-accent", "border-accent");
    callBtn.classList.add("bg-surface2");
    addSystemMessage("You left the voice call");
  }

  function addSystemMessage(text) {
    const el = document.createElement("div");
    el.className = "fade-in flex justify-center";
    el.innerHTML = `<span class="text-[11px] text-muted font-mono bg-surface2 border border-line rounded-full px-3 py-1">${escapeHtml(text)}</span>`;
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function addChatMessage(msg, isMine) {
    const wrap = document.createElement("div");
    wrap.className = `fade-in flex flex-col ${isMine ? "items-end" : "items-start"}`;

    const senderLabel = isMine ? "" : `<p class="text-[11px] text-muted font-mono mb-1 px-1">${escapeHtml(msg.sender)}</p>`;

    const textHtml = msg.text
      ? `<p class="text-[15px] leading-relaxed whitespace-pre-wrap break-words ${isMine ? "text-white" : "text-ink"} ${msg.image ? "mt-2" : ""}">${escapeHtml(msg.text)}</p>`
      : "";

    const imageHtml = msg.image
      ? `<img src="${msg.image}" class="chat-image" data-full="${msg.image}" alt="shared image" />`
      : "";

    const bubblePadding = msg.image && !msg.text ? "p-1.5" : "px-4 py-2.5";

    wrap.innerHTML = `
      ${senderLabel}
      <div class="max-w-[78%] sm:max-w-[60%] ${isMine ? "bubble-mine" : "bubble-other"} rounded-2xl ${bubblePadding}">
        ${imageHtml}
        ${textHtml}
      </div>
      <span class="text-[10px] text-muted/70 font-mono mt-1 px-1">${formatTime(msg.time)}</span>
    `;
    messagesEl.appendChild(wrap);

    const img = wrap.querySelector(".chat-image");
    if (img) {
      img.addEventListener("click", () => openImageViewer(img.dataset.full));
    }

    scrollToBottom();
  }

  function openImageViewer(src) {
    imageViewerImg.src = src;
    imageViewer.classList.remove("hidden");
    imageViewer.classList.add("flex");
  }

  imageViewer.addEventListener("click", () => {
    imageViewer.classList.add("hidden");
    imageViewer.classList.remove("flex");
    imageViewerImg.src = "";
  });

  function formatTime(ts) {
    const d = new Date(ts);
    const h = d.getHours().toString().padStart(2, "0");
    const m = d.getMinutes().toString().padStart(2, "0");
    return `${h}:${m}`;
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
})();
