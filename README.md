# QuickChat（瞬聊）

极简、一次性的浏览器聊天室。无需注册，创建房间即可开始聊天，关闭页面即销毁，消息只存在于内存中。

## 项目结构

```
quickchat/
├── package.json
├── server.js              # Express + Socket.io 后端（房间与消息全部存在内存中）
├── public/
│   ├── index.html          # 首页：创建 / 加入房间
│   ├── chat.html            # 聊天室页面
│   └── js/
│       └── chat.js          # 聊天室前端逻辑（Socket.io 客户端）
└── README.md
```

## 技术栈

- 前端：HTML + Tailwind CSS（CDN）+ Vanilla JavaScript
- 实时通信：Socket.io
- 后端：Node.js + Express

## 本地运行

```bash
npm install
npm start
```

然后打开 http://localhost:3000

## 工作原理

- **创建房间**：首页点击"Start a new chat"会调用 `GET /api/create-room`，服务器生成一个不重复的 5 位数字 Room Code 并跳转到 `/chat/:roomCode`。
- **加入房间**：在首页输入已有的 5 位 Room Code，直接跳转到对应聊天室；聊天室页面通过 Socket.io 的 `join-room` 事件加入房间。
- **实时消息**：所有消息通过 Socket.io 广播给同一房间内的所有 socket 连接，不做任何持久化存储。
- **图片上传**：点击输入框左侧的图片图标选择图片（仅限图片类型，单张最大 4MB），会以 base64 data URL 的形式通过 Socket.io 发送，服务器只做转发和大小校验，不落盘存储；点击消息里的图片可全屏查看。
- **一次性特性**：房间与消息数据只保存在 Node 进程内存的 `rooms` 对象中；刷新或关闭页面即丢失当前会话；空房间超过 6 小时会被自动清理，服务器重启则所有房间清空。

## 界面语言

界面文案目前为英文（首页、聊天室、系统提示等）。

## 部署建议

QuickChat 依赖 WebSocket 长连接，请部署到支持长连接的平台（**不要用纯 Serverless / Vercel Functions**，因为它们不支持持久 WebSocket 连接）：

### Railway / Render（推荐）

1. 新建项目，连接你的 Git 仓库
2. Build Command：`npm install`
3. Start Command：`npm start`
4. 无需额外环境变量（`PORT` 会由平台自动注入）

### Vercel

Vercel 的 Serverless Functions 不支持长连接 WebSocket，如果一定要用 Vercel，需要：
- 改用 Vercel 支持的 Edge/WebSocket 方案，或
- 将 Socket.io 换成基于 HTTP 轮询的第三方服务（如 Pusher / Ably）

否则建议使用 Railway、Render、Fly.io 或任意自己的 VPS。

## 注意事项

- 多实例部署（多个 Node 进程）时，Socket.io 需要配合 Redis Adapter 做房间广播同步，本项目为单实例内存版本，适合个人/小规模使用。
- 消息内容仅做了基础的 HTML 转义防 XSS，未做敏感词过滤等增强安全措施。
