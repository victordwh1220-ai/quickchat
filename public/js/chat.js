// chat.js — QuickChat 聊天室前端逻辑

(() => {
  const roomCode = window.location.pathname.split("/chat/")[1]?.replace(/[^0-9]/g, "").slice(0, 5);

  const messagesEl = document.getElementById("messages");
  const roomCodeLabel = document.getElementById("roomCodeLabel");
  const onlineCountEl = document.getElementById("onlineCount");
  const exitBtn = document.getElementById("exitBtn");
  const notFoundOverlay = document.getElementById("notFoundOverlay");
  const messageForm = document.getElementById("messageForm");
  const messageInput = document.getElementById("messageInput");

  if (!roomCode || roomCode.length !== 5) {
    notFoundOverlay.classList.remove("hidden");
  } else {
    roomCodeLabel.textContent = roomCode;
    init();
  }

  function init() {
    const socket = io();
    let myId = null;

    socket.on("connect", () => {
      socket.emit("join-room", { roomCode });
    });

    socket.on("joined", ({ nickname, onlineCount }) => {
      myId = socket.id;
      onlineCountEl.textContent = `${onlineCount} 人在线`;
      addSystemMessage(`你以 ${nickname} 的身份加入了聊天`);
    });

    socket.on("join-error", () => {
      notFoundOverlay.classList.remove("hidden");
    });

    socket.on("system-message", ({ text, onlineCount }) => {
      addSystemMessage(text);
      if (typeof onlineCount === "number") {
        onlineCountEl.textContent = `${onlineCount} 人在线`;
      }
    });

    socket.on("chat-message", (msg) => {
      const isMine = msg.senderId === socket.id;
      addChatMessage(msg, isMine);
    });

    socket.on("disconnect", () => {
      addSystemMessage("连接已断开，正在尝试重连...");
    });

    messageForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = messageInput.value.trim();
      if (!text) return;
      socket.emit("send-message", { text });
      messageInput.value = "";
      messageInput.style.height = "auto";
    });

    // Enter 发送，Shift+Enter 换行
    messageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        messageForm.requestSubmit();
      }
    });

    // 自适应输入框高度
    messageInput.addEventListener("input", () => {
      messageInput.style.height = "auto";
      messageInput.style.height = Math.min(messageInput.scrollHeight, 128) + "px";
    });

    exitBtn.addEventListener("click", () => {
      window.location.href = "/";
    });
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

    wrap.innerHTML = `
      ${senderLabel}
      <div class="max-w-[78%] sm:max-w-[60%] ${isMine ? "bubble-mine" : "bubble-other"} rounded-2xl px-4 py-2.5">
        <p class="text-[15px] leading-relaxed whitespace-pre-wrap break-words ${isMine ? "text-white" : "text-ink"}">${escapeHtml(msg.text)}</p>
      </div>
      <span class="text-[10px] text-muted/70 font-mono mt-1 px-1">${formatTime(msg.time)}</span>
    `;
    messagesEl.appendChild(wrap);
    scrollToBottom();
  }

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
