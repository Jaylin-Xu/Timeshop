import express from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import { JSONFilePreset } from "lowdb/node";
import path from "path";
import { fileURLToPath } from "url";

// Resolve __filename / __dirname equivalents when using ES modules.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// lowdb initialization

// Default document structure persisted in db.json.
const defaultData = { totalTime: 0, users: [], reviews: [] };
const db = await JSONFilePreset(path.join(__dirname, "db.json"), defaultData);

// Backwards compatibility: older db.json files might not have a `reviews` field yet.
// If it is missing, initialise it and persist the change.
if (!db.data.reviews) {
  db.data.reviews = [];
  await db.write();
}

// Helper for locating a user object by username within the in-memory db snapshot.
function findUser(username) {
  return db.data.users.find((u) => u.username === username);
}

// Express & Socket.io setup

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server);

// Parse JSON request bodies and serve static assets from /public.
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Auth routes

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

  // Initial per-account state; all counters start from zero and cards from empty.
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

// State sync endpoint

app.post("/api/state", async (req, res) => {
  const { username, password, state: clientState } = req.body || {};
  if (!username || !password || !clientState) {
    return res.status(400).json({ error: "Bad request." });
  }

  const user = findUser(username);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  // Compute the delta of totalSeconds so we can increment global totalTime
  // without double-counting earlier sessions.
  const prev = user.state?.totalSeconds || 0;
  const next = clientState.totalSeconds || 0;
  const delta = Math.max(0, next - prev);
  db.data.totalTime = (db.data.totalTime || 0) + delta;

  // Persist the client’s latest state snapshot.
  user.state = clientState;
  await db.write();

  // Push the updated global total time to all connected clients.
  io.emit("totalTime", db.data.totalTime || 0);
  res.json({ ok: true });
});

// Review endpoints

// Submit a review: body { username, password, cardLevel, text }
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

  // Store reviews with an ISO timestamp so they are easy to sort by recency.
  // MDN (Date.prototype.toISOString): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toISOString
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

// Fetch reviews by card level.
app.get("/api/reviews/:level", (req, res) => {
  const level = String(req.params.level || "").toUpperCase();
  const allowedLevels = ["S", "A", "B", "C", "D", "E", "F", "NONE"];
  if (!allowedLevels.includes(level)) {
    return res.status(400).json({ error: "Invalid card level." });
  }

  const allReviews = Array.isArray(db.data.reviews) ? db.data.reviews : [];

  // Filter by level and sort newest-first by createdAt timestamp.
  // MDN (Array.prototype.sort with compare function):
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort
  const reviews = allReviews
    .filter((r) => r.level === level)
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

  res.json({ level, reviews });
});

// Online users via Socket.io

// In-memory presence map keyed by socket.id; each value is a lightweight
// snapshot of what is safe to broadcast to other clients.
// MDN (Map): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map
const onlineUsers = new Map(); // socket.id -> { username, totalSeconds, coins, lastCards, hideCoins }

// Helper to broadcast the current online user list to all connected sockets.
function broadcastOnlineUsers() {
  io.emit("onlineUsers", Array.from(onlineUsers.values()));
}

io.on("connection", (socket) => {
  // On initial connection, send the current global total time.
  socket.emit("totalTime", db.data.totalTime || 0);

  // Presence updates come from the client on every relevant state change.
  socket.on("presence:update", (payload) => {
    if (!payload || !payload.username) return;

    // Use nullish coalescing to fall back cleanly when fields are missing.
    // MDN (nullish coalescing operator ??):
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Nullish_coalescing_operator
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

// Start server

const PORT = process.env.PORT || 6020;
server.listen(PORT, () => {
  console.log(`Server listening at http://localhost:${PORT}`);
});
