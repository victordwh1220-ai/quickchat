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

  const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB raw file size cap

  let pendingImage = null; // { dataUrl }

  if (!roomCode || roomCode.length !== 5) {
    notFoundOverlay.classList.remove("hidden");
  } else {
    roomCodeLabel.textContent = roomCode;
    init();
  }

  function init() {
    const socket = io();

    socket.on("connect", () => {
      socket.emit("join-room", { roomCode });
    });

    socket.on("joined", ({ nickname, onlineCount }) => {
      onlineCountEl.textContent = `${onlineCount} online`;
      addSystemMessage(`You joined as ${nickname}`);
    });

    socket.on("join-error", () => {
      notFoundOverlay.classList.remove("hidden");
    });

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

    socket.on("disconnect", () => {
      addSystemMessage("Connection lost, reconnecting...");
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
