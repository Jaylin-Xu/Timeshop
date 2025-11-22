// server.js
import express from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import { JSONFilePreset } from "lowdb/node";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- lowdb 初始化 ----------
const defaultData = { totalTime: 0, users: [], reviews: [] };
const db = await JSONFilePreset(path.join(__dirname, "db.json"), defaultData);

// 兼容旧 db.json 没有 reviews 字段的情况
if (!db.data.reviews) {
  db.data.reviews = [];
  await db.write();
}

function findUser(username) {
  return db.data.users.find((u) => u.username === username);
}

// ---------- Express & Socket.io ----------
const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ==================== Auth ====================

app.post("/auth/signup", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res
      .status(400)
      .json({ error: "Username and password are required." });
  }

  if (findUser(username)) {
    return res.status(400).json({ error: "Username already exists." });
  }

  const newUser = {
    username,
    password,
    state: {
      totalSeconds: 0,
      coinsSpent: 0,
      cards: [],
      coinsClaimed: 0,
      coinEventsTriggered: 0,
    },
  };

  db.data.users.push(newUser);
  await db.write();

  res.json({ username: newUser.username, state: newUser.state });
});

app.post("/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res
      .status(400)
      .json({ error: "Username and password are required." });
  }

  const user = findUser(username);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: "Invalid username or password." });
  }

  res.json({ username: user.username, state: user.state });
});

// ==================== State 同步 ====================

app.post("/api/state", async (req, res) => {
  const { username, password, state: clientState } = req.body || {};
  if (!username || !password || !clientState) {
    return res.status(400).json({ error: "Bad request." });
  }

  const user = findUser(username);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  const prev = user.state?.totalSeconds || 0;
  const next = clientState.totalSeconds || 0;
  const delta = Math.max(0, next - prev);
  db.data.totalTime = (db.data.totalTime || 0) + delta;

  user.state = clientState;
  await db.write();

  io.emit("totalTime", db.data.totalTime || 0);
  res.json({ ok: true });
});

// ==================== 评论接口 ====================

// 提交评论： body { username, password, cardLevel, text }
app.post("/api/reviews", async (req, res) => {
  const { username, password, cardLevel, text } = req.body || {};
  if (!username || !password || !cardLevel || !text?.trim()) {
    return res.status(400).json({ error: "Bad request." });
  }

  const user = findUser(username);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  const level = String(cardLevel).toUpperCase();
  const allowedLevels = ["S", "A", "B", "C", "D", "E", "F", "NONE"];
  if (!allowedLevels.includes(level)) {
    return res.status(400).json({ error: "Invalid card level." });
  }

  const review = {
    level,
    username,
    text: String(text).trim(),
    createdAt: new Date().toISOString(),
  };

  db.data.reviews.push(review);
  await db.write();

  res.json({ ok: true });
});

// 按等级获取评论
app.get("/api/reviews/:level", (req, res) => {
  const level = String(req.params.level || "").toUpperCase();
  const allowedLevels = ["S", "A", "B", "C", "D", "E", "F", "NONE"];
  if (!allowedLevels.includes(level)) {
    return res.status(400).json({ error: "Invalid card level." });
  }

  const allReviews = Array.isArray(db.data.reviews) ? db.data.reviews : [];
  const reviews = allReviews
    .filter((r) => r.level === level)
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

  res.json({ level, reviews });
});

// ==================== 在线用户 / Socket.io ====================

const onlineUsers = new Map(); // socket.id -> { username, totalSeconds, coins, lastCards, hideCoins }

function broadcastOnlineUsers() {
  io.emit("onlineUsers", Array.from(onlineUsers.values()));
}

io.on("connection", (socket) => {
  socket.emit("totalTime", db.data.totalTime || 0);

  socket.on("presence:update", (payload) => {
    if (!payload || !payload.username) return;

    onlineUsers.set(socket.id, {
      username: payload.username,
      totalSeconds: payload.totalSeconds ?? 0,
      coins: payload.coins ?? 0,
      lastCards: payload.lastCards ?? [],
      hideCoins: !!payload.hideCoins,
    });

    broadcastOnlineUsers();
  });

  socket.on("disconnect", () => {
    onlineUsers.delete(socket.id);
    broadcastOnlineUsers();
  });
});

// ==================== 启动服务 ====================

const PORT = process.env.PORT || 6020;
server.listen(PORT, () => {
  console.log(`Server listening at http://localhost:${PORT}`);
});
