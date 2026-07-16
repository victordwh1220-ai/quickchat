// server.js
// QuickChat - 极简一次性聊天室后端
// Express 负责静态文件与路由，Socket.io 负责实时消息
// 所有房间与消息数据只存在于内存中，服务器重启即清空（符合"一次性"特性）

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// ---------- 内存中的房间数据 ----------
// rooms = {
//   "78492": {
//     users: { socketId: nickname },
//     createdAt: Date.now()
//   }
// }
const rooms = {};

// 房间不活跃超过 6 小时自动清理（防止内存无限增长）
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

// ---------- 静态文件 ----------
app.use(express.static(path.join(__dirname, "public")));

// 创建房间的 REST 接口（首页"创建新聊天"调用）
app.get("/api/create-room", (req, res) => {
  const code = generateRoomCode();
  rooms[code] = { users: {}, createdAt: Date.now() };
  res.json({ roomCode: code });
});

// 检查房间是否存在
app.get("/api/room/:code", (req, res) => {
  const code = req.params.code;
  res.json({ exists: !!rooms[code] });
});

// 聊天室页面路由：/chat/78492
app.get("/chat/:code", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "chat.html"));
});

// 首页
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------- Socket.io 实时通信 ----------
io.on("connection", (socket) => {
  let currentRoom = null;
  let nickname = null;

  socket.on("join-room", ({ roomCode }) => {
    if (!/^\d{5}$/.test(roomCode)) {
      socket.emit("join-error", { message: "房间不存在或已结束" });
      return;
    }

    // 允许"加入"时房间不存在则自动创建（保证直接访问 /chat/xxxxx 链接也能用）
    if (!rooms[roomCode]) {
      rooms[roomCode] = { users: {}, createdAt: Date.now() };
    }

    currentRoom = roomCode;
    nickname = generateNickname();
    rooms[roomCode].users[socket.id] = nickname;

    socket.join(roomCode);

    socket.emit("joined", {
      roomCode,
      nickname,
      onlineCount: Object.keys(rooms[roomCode].users).length,
    });

    // 通知房间内其他人
    socket.to(roomCode).emit("system-message", {
      text: `${nickname} 加入了聊天`,
      onlineCount: Object.keys(rooms[roomCode].users).length,
    });
  });

  socket.on("send-message", ({ text }) => {
    if (!currentRoom || !nickname) return;
    const trimmed = (text || "").toString().trim().slice(0, 2000);
    if (!trimmed) return;

    io.to(currentRoom).emit("chat-message", {
      text: trimmed,
      sender: nickname,
      senderId: socket.id,
      time: Date.now(),
    });
  });

  socket.on("disconnect", () => {
    if (currentRoom && rooms[currentRoom]) {
      delete rooms[currentRoom].users[socket.id];
      socket.to(currentRoom).emit("system-message", {
        text: `${nickname} 离开了聊天`,
        onlineCount: Object.keys(rooms[currentRoom].users).length,
      });

      // 房间空了就清理
      if (Object.keys(rooms[currentRoom].users).length === 0) {
        rooms[currentRoom].createdAt = Date.now();
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`QuickChat server running on http://localhost:${PORT}`);
});
