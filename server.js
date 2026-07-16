// server.js
// QuickChat - minimal ephemeral chat room backend
// Express serves static files & routes, Socket.io handles real-time messages.
// All room & message data lives only in memory and is wiped on restart (that's the point).

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// Bump payload limit so base64-encoded images fit through the socket
const io = new Server(server, {
  maxHttpBufferSize: 6 * 1024 * 1024, // 6MB
});

const PORT = process.env.PORT || 3000;

// ---------- In-memory room data ----------
// rooms = {
//   "78492": {
//     users: { socketId: nickname },
//     createdAt: Date.now()
//   }
// }
const rooms = {};

// Images are base64 data URLs; cap the raw string length (~4MB file -> ~5.4MB base64)
const MAX_IMAGE_DATA_URL_LENGTH = 5.5 * 1024 * 1024;

// Auto-clean rooms that have been empty for more than 6 hours (prevents unbounded memory growth)
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const code of Object.keys(rooms)) {
    if (Object.keys(rooms[code].users).length === 0 && now - rooms[code].createdAt > ROOM_TTL_MS) {
      delete rooms[code];
    }
  }
}, 30 * 60 * 1000);

function generateRoomCode() {
  let code;
  do {
    code = Math.floor(10000 + Math.random() * 90000).toString();
  } while (rooms[code]);
  return code;
}

function generateNickname() {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `User-${num}`;
}

// ---------- Static files ----------
app.use(express.static(path.join(__dirname, "public")));

// Create-room REST endpoint (called by the "Start a new chat" button)
app.get("/api/create-room", (req, res) => {
  const code = generateRoomCode();
  rooms[code] = { users: {}, createdAt: Date.now() };
  res.json({ roomCode: code });
});

// Check whether a room exists
app.get("/api/room/:code", (req, res) => {
  const code = req.params.code;
  res.json({ exists: !!rooms[code] });
});

// Chat room page route: /chat/78492
app.get("/chat/:code", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "chat.html"));
});

// Home page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------- Socket.io real-time communication ----------
io.on("connection", (socket) => {
  let currentRoom = null;
  let nickname = null;

  socket.on("join-room", ({ roomCode, name }) => {
    if (!/^\d{5}$/.test(roomCode)) {
      socket.emit("join-error", { message: "Room not found or has ended" });
      return;
    }

    // Auto-create the room if it doesn't exist yet, so a direct /chat/xxxxx link still works
    if (!rooms[roomCode]) {
      rooms[roomCode] = { users: {}, createdAt: Date.now() };
    }

    // Sanitize the display name the user typed in the join modal. It's kept only
    // in memory for the lifetime of this socket connection — never persisted.
    const cleanName = (name || "").toString().trim().replace(/\s+/g, " ").slice(0, 20);

    currentRoom = roomCode;
    nickname = cleanName || generateNickname();
    rooms[roomCode].users[socket.id] = nickname;

    socket.join(roomCode);

    socket.emit("joined", {
      roomCode,
      nickname,
      onlineCount: Object.keys(rooms[roomCode].users).length,
    });

    // Notify everyone else in the room
    socket.to(roomCode).emit("system-message", {
      text: `${nickname} joined the chat`,
      onlineCount: Object.keys(rooms[roomCode].users).length,
    });
  });

  socket.on("send-message", ({ text, image }) => {
    if (!currentRoom || !nickname) return;

    const trimmedText = (text || "").toString().trim().slice(0, 2000);

    let safeImage = null;
    if (image) {
      if (typeof image !== "string" || !image.startsWith("data:image/")) {
        socket.emit("image-error", { message: "Invalid image format" });
      } else if (image.length > MAX_IMAGE_DATA_URL_LENGTH) {
        socket.emit("image-error", { message: "Image is too large" });
      } else {
        safeImage = image;
      }
    }

    if (!trimmedText && !safeImage) return;

    io.to(currentRoom).emit("chat-message", {
      text: trimmedText,
      image: safeImage,
      sender: nickname,
      senderId: socket.id,
      time: Date.now(),
    });
  });

  socket.on("disconnect", () => {
    if (currentRoom && rooms[currentRoom]) {
      delete rooms[currentRoom].users[socket.id];
      socket.to(currentRoom).emit("system-message", {
        text: `${nickname} left the chat`,
        onlineCount: Object.keys(rooms[currentRoom].users).length,
      });

      // Reset the empty-room timer for TTL cleanup
      if (Object.keys(rooms[currentRoom].users).length === 0) {
        rooms[currentRoom].createdAt = Date.now();
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`QuickChat server running on http://localhost:${PORT}`);
});
