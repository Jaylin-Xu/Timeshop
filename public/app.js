/*
  Time Shop front-end logic
  Features:
  - Sign up / log in and load per-account state
  - Session timer + “Collect +1” coin every 20 seconds (3s claim window)
  - Card lottery with flip animation
  - Online users presence via Socket.io
  - Rule modal (after sign up + “View rules” button in header)
  - Inventory: click card → full view + review + save image
  - Rarity buttons: fetch and display reviews by level
*/

/* Game constants */

// Base coins granted to every account when they begin.
const BASE_COINS = 2;

// Seconds of active time between two coin events.
const COIN_INTERVAL = 20;

// Milliseconds the “Collect +1” button stays clickable.
const COIN_LIFETIME = 3000;

// Duration of a single flip animation (ms).
const FLIP_DURATION = 600;

// How long the front of the card stays visible (ms).
const CARD_HOLD_DURATION = 4000;

// Identity for the currently logged-in account.
let currentUser = null;
let currentPassword = null;
let loggedIn = false;

// In-memory game state for this tab; the server is treated as source of truth.
let state = {
  totalSeconds: 0,
  coinsSpent: 0,
  cards: [],
  coinsClaimed: 0,
  coinEventsTriggered: 0
};


// Auth overlay
const authOverlay = document.getElementById("authOverlay");
const authUsername = document.getElementById("authUsername");
const authPassword = document.getElementById("authPassword");
const signupBtn = document.getElementById("signupBtn");
const loginBtn = document.getElementById("loginBtn");
const authMessageEl = document.getElementById("authMessage");

// Sign-up guide modal
const signupGuideOverlay = document.getElementById("signupGuideOverlay");
const signupGuideClose = document.getElementById("signupGuideClose");
const signupGuideGotIt = document.getElementById("signupGuideGotIt");
const signupGuideBackdrop = signupGuideOverlay
  ? signupGuideOverlay.querySelector(".signup-guide-backdrop")
  : null;

// Header time + rules button
const sessionTimerEl = document.getElementById("sessionTimer");
const globalTimerDisplay = document.getElementById("timerDisplay");
const openGuideBtn = document.getElementById("openGuideBtn");

// Player section
const usernameLabelSide = document.getElementById("usernameLabel-side");
const coinLabel = document.getElementById("coinLabel");
const coinSpawnBtn = document.getElementById("coinSpawnBtn");

// Online users
const onlineUsersList = document.getElementById("onlineUsersList");
const hideCoinsToggle = document.getElementById("toggleHideCoins");

// Lottery
const drawBtn = document.getElementById("drawBtn");
const flipCard = document.getElementById("flipCard");
const cardFront = document.getElementById("cardFront");
const cardBackImg = document.getElementById("cardBack");
const rarityRow = document.querySelector(".rarity-row");

// Inventory + Activity log
const invGrid = document.getElementById("inventory");
const logBox = document.getElementById("log");

// Full image viewer
const imageViewer = document.getElementById("imageViewer");
const imageViewerImg = document.getElementById("imageViewerImg");
const imageViewerLabel = document.getElementById("imageViewerLabel");
const imageViewerClose = document.getElementById("imageViewerClose");
const imageViewerBackdrop = imageViewer
  ? imageViewer.querySelector(".image-viewer-backdrop")
  : null;
const imageViewerReviewInput = document.getElementById("imageViewerReviewInput");
const imageViewerReviewSend = document.getElementById("imageViewerReviewSend");
const imageViewerSaveBtn = document.getElementById("imageViewerSaveBtn");

// Rarity review modal
const reviewModal = document.getElementById("reviewModal");
const reviewModalTitle = document.getElementById("reviewModalTitle");
const reviewModalBody = document.getElementById("reviewModalBody");
const reviewModalClose = document.getElementById("reviewModalClose");
const reviewModalBackdrop = reviewModal
  ? reviewModal.querySelector(".review-modal-backdrop")
  : null;

/* Page activity (whether timer should tick) */

// We only count time when the page feels “actively watched” by the user.
let hasFocus = document.hasFocus();
let pointerInside = true;
const isTouchDevice =
  "ontouchstart" in window || navigator.maxTouchPoints > 0;

window.addEventListener("focus", () => {
  hasFocus = true;
});

window.addEventListener("blur", () => {
  hasFocus = false;
});

document.addEventListener("visibilitychange", () => {
  hasFocus = !document.hidden;
});

document.addEventListener("mouseenter", () => {
  pointerInside = true;
});

document.addEventListener("mouseleave", () => {
  pointerInside = false;
});

// Decide if we should increment the per-account timer on this tick.
function isActiveForTimer() {
  if (!loggedIn || document.hidden || !hasFocus) return false;
  // On touch devices, we cannot easily track pointer enter/leave, so we
  // rely on focus/visibility only.
  return isTouchDevice ? true : pointerInside;
}

// Compute currently spendable coins derived from base + claimed − spent.
function getAvailableCoins() {
  return BASE_COINS + (state.coinsClaimed || 0) - (state.coinsSpent || 0);
}

// Format seconds as HH:MM:SS.
function fmtHMS(s) {
  s = Math.floor(s);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

// Append a message to the Activity box, with a local time prefix.
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toLocaleTimeString
function log(message) {
  if (!logBox) return;
  const el = document.createElement("div");
  el.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logBox.prepend(el);
}

// Set feedback text in the auth overlay; colorised for success / error.
function setAuthMessage(msg, isError = true) {
  if (!authMessageEl) return;
  authMessageEl.textContent = msg || "";
  authMessageEl.style.color = isError ? "#b91c1c" : "#15803d";
}

/* Toast: small temporary message at the bottom of the screen */

let toastTimeoutId = null;

function showToast(message) {
  if (!message) return;

  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }

  el.textContent = message;
  el.classList.add("show");

  // MDN (setTimeout / clearTimeout):
  // https://developer.mozilla.org/en-US/docs/Web/API/setTimeout
  if (toastTimeoutId) clearTimeout(toastTimeoutId);
  toastTimeoutId = setTimeout(() => {
    el.classList.remove("show");
  }, 2000);
}

/* Rule modal (sign up + header button) */

function showSignupGuide() {
  if (!signupGuideOverlay) return;
  signupGuideOverlay.classList.add("show");
  document.body.style.overflow = "hidden";
}

function hideSignupGuide() {
  if (!signupGuideOverlay) return;
  signupGuideOverlay.classList.remove("show");
  document.body.style.overflow = "";
}

if (signupGuideClose) {
  signupGuideClose.addEventListener("click", hideSignupGuide);
}
if (signupGuideGotIt) {
  signupGuideGotIt.addEventListener("click", hideSignupGuide);
}
if (signupGuideBackdrop) {
  signupGuideBackdrop.addEventListener("click", hideSignupGuide);
}
if (openGuideBtn) {
  openGuideBtn.addEventListener("click", () => {
    showSignupGuide();
  });
}


// Minimal JSON POST helper using the Fetch API.
// https://developer.mozilla.org/en-US/docs/Web/API/fetch
async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}

function signup(username, password) {
  return postJSON("/auth/signup", { username, password });
}

function login(username, password) {
  return postJSON("/auth/login", { username, password });
}

// Push the latest local state to the server so that:
// - global total time can be updated,
// - account state is durable across devices.
async function syncState() {
  if (!loggedIn || !currentUser || !currentPassword) return;
  try {
    await postJSON("/api/state", {
      username: currentUser,
      password: currentPassword,
      state
    });
  } catch (err) {
    console.warn("syncState failed:", err.message);
  }
}

/* Online user list rendering */
// Render a list of online accounts into the “Online User” card.
function renderOnlineUsers(users) {
  if (!onlineUsersList) return;
  onlineUsersList.innerHTML = "";

  if (!users || !users.length) {
    const empty = document.createElement("div");
    empty.className = "online-user-empty";
    empty.textContent = "No one is online yet. / 当前暂无在线用户。";
    onlineUsersList.appendChild(empty);
    return;
  }

  users.forEach((u) => {
    const item = document.createElement("div");
    item.className = "online-user";
    if (u.username === currentUser) item.classList.add("self");

    const mainRow = document.createElement("div");
    mainRow.className = "online-user-main";

    const nameEl = document.createElement("div");
    nameEl.className = "online-user-name";
    nameEl.textContent = u.username;

    const coinsEl = document.createElement("div");
    coinsEl.className = "online-user-coins";
    if (u.hideCoins) {
      coinsEl.textContent =
        u.username === currentUser
          ? "See coins in Player / 硬币在 Player 区查看"
          : "Coins: hidden / 硬币已隐藏";
    } else {
      coinsEl.textContent = `Coins: ${u.coins ?? 0}`;
    }

    mainRow.appendChild(nameEl);
    mainRow.appendChild(coinsEl);
    item.appendChild(mainRow);

    const cardsRow = document.createElement("div");
    cardsRow.className = "online-user-cards";

    const cards = Array.isArray(u.lastCards) ? u.lastCards : [];
    if (!cards.length) {
      const none = document.createElement("span");
      none.className = "online-card-pill";
      none.textContent = "No cards yet / 暂无卡牌";
      cardsRow.appendChild(none);
    } else {
      const label = document.createElement("span");
      label.textContent = "Recent cards / 最近卡牌:";
      cardsRow.appendChild(label);

      const levels = document.createElement("span");
      levels.style.marginLeft = "4px";
      levels.textContent = cards.join(", ");
      cardsRow.appendChild(levels);
    }

    item.appendChild(cardsRow);
    onlineUsersList.appendChild(item);
  });
}

/* Sign up / login flow */
async function handleAuth(action) {
  const username = authUsername.value.trim();
  const password = authPassword.value.trim();

  if (!username || !password) {
    setAuthMessage(
      "Username and password are required. / 请输入用户名和密码。"
    );
    return;
  }

  signupBtn.disabled = true;
  loginBtn.disabled = true;
  setAuthMessage(
    action === "signup"
      ? "Signing up… / 正在注册…"
      : "Logging in… / 正在登录…",
    false
  );

  try {
    const data =
      action === "signup"
        ? await signup(username, password)
        : await login(username, password);

    currentUser = data.username;
    currentPassword = password;
    state =
      data.state || {
        totalSeconds: 0,
        coinsSpent: 0,
        cards: [],
        coinsClaimed: 0,
        coinEventsTriggered: 0
      };
    loggedIn = true;

    if (authOverlay) authOverlay.style.display = "none";

    renderInventory();
    renderStats();
    log(
      `Welcome, ${currentUser}! / 欢迎，${currentUser}！账号数据已载入。`
    );
    sendPresence(true);

    setAuthMessage(
      action === "signup"
        ? "Sign up successful. You are now logged in. / 注册成功，已自动登录。"
        : "Login successful. / 登录成功。",
      false
    );

    if (action === "signup") {
      showSignupGuide();
    }
  } catch (err) {
    setAuthMessage(
      (err.message || "Auth failed.") + " / 登录或注册失败。",
      true
    );
  } finally {
    signupBtn.disabled = false;
    loginBtn.disabled = false;
  }
}

signupBtn.addEventListener("click", () => handleAuth("signup"));
loginBtn.addEventListener("click", () => handleAuth("login"));

/* Inventory rendering + full image viewer */

function renderInventory() {
  if (!invGrid) return;
  invGrid.innerHTML = "";

  if (!state.cards || !state.cards.length) {
    const d = document.createElement("div");
    d.textContent = "— No cards yet / 暂无卡牌 —";
    d.style.opacity = "0.6";
    d.style.gridColumn = "1 / -1";
    invGrid.appendChild(d);
    return;
  }

  state.cards.forEach((level) => {
    const box = document.createElement("div");
    box.className = "inv-item";
    box.dataset.level = level;

    const img = document.createElement("img");
    img.src =
      level === "NONE"
        ? "./assets/cards/NONE.jpg"
        : `./assets/cards/${level}.jpg`;
    box.dataset.src = img.src;

    const label = document.createElement("div");
    label.className = "label";
    label.textContent =
      level === "NONE" ? "No Prize / 未中奖" : `Card ${level}`;
    box.dataset.label = label.textContent;

    box.appendChild(img);
    box.appendChild(label);
    invGrid.appendChild(box);
  });
}

let currentPreviewLevel = null;
let currentPreviewSrc = "";

// Open the full-size image viewer for a selected card.
function openImageViewer(src, label, level) {
  if (!imageViewer || !imageViewerImg) return;

  currentPreviewLevel = level || null;
  currentPreviewSrc = src || "";

  imageViewerImg.src = src;
  if (imageViewerLabel) {
    imageViewerLabel.textContent = label || "";
  }
  if (imageViewerReviewInput) {
    imageViewerReviewInput.value = "";
  }

  imageViewer.classList.add("show");
  document.body.style.overflow = "hidden";
}

// Close the image viewer and reset selection.
function closeImageViewer() {
  if (!imageViewer) return;
  imageViewer.classList.remove("show");
  document.body.style.overflow = "";
  currentPreviewLevel = null;
  currentPreviewSrc = "";
}

if (imageViewerClose) {
  imageViewerClose.addEventListener("click", closeImageViewer);
}
if (imageViewerBackdrop) {
  imageViewerBackdrop.addEventListener("click", closeImageViewer);
}

// Delegate clicks from the inventory grid to the appropriate card.
// https://developer.mozilla.org/en-US/docs/Web/API/Element/closest
if (invGrid) {
  invGrid.addEventListener("click", (event) => {
    const target = event.target;
    if (!target) return;
    const item = target.closest(".inv-item");
    if (!item) return;

    const src = item.dataset.src;
    const label = item.dataset.label;
    const level = item.dataset.level || null;
    if (!src) return;

    openImageViewer(src, label, level);
  });
}

/* Card review submission for the card currently in the viewer */

if (imageViewerReviewSend) {
  imageViewerReviewSend.addEventListener("click", async () => {
    if (!loggedIn || !currentUser || !currentPassword) {
      alert("Please log in first. / 请先登录后再发表评论。");
      return;
    }
    if (!currentPreviewLevel) {
      alert("No card selected. / 未选中卡牌。");
      return;
    }

    const text = (imageViewerReviewInput?.value || "").trim();
    if (!text) {
      alert("Review cannot be empty. / 评价内容不能为空。");
      return;
    }

    try {
      await postJSON("/api/reviews", {
        username: currentUser,
        password: currentPassword,
        cardLevel: currentPreviewLevel,
        text
      });
      showToast("Review sent / 发送成功");
      if (imageViewerReviewInput) imageViewerReviewInput.value = "";
    } catch (err) {
      console.error(err);
      showToast("Failed to send review / 发送失败");
    }
  });
}

/* Save the current card image as a file via a synthetic <a download> click.
   https://developer.mozilla.org/en-US/docs/Web/HTML/Element/a#attr-download */
if (imageViewerSaveBtn) {
  imageViewerSaveBtn.addEventListener("click", () => {
    if (!currentPreviewSrc) {
      alert("No image to save. / 当前没有可保存的图片。");
      return;
    }
    const link = document.createElement("a");
    link.href = currentPreviewSrc;
    const parts = currentPreviewSrc.split("/");
    const filename = parts[parts.length - 1] || "card.jpg";
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
}

/* Rarity review modal */
function openReviewModal(level, reviews) {
  if (!reviewModal || !reviewModalBody || !reviewModalTitle) return;

  const title =
    level === "NONE"
      ? "Reviews for no-prize draws / 未中奖评价"
      : `Reviews for ${level} cards / ${level} 卡牌评价`;
  reviewModalTitle.textContent = title;

  reviewModalBody.innerHTML = "";
  if (!reviews || !reviews.length) {
    const empty = document.createElement("div");
    empty.className = "review-empty";
    empty.textContent = "No reviews yet / 暂无评价";
    reviewModalBody.appendChild(empty);
  } else {
    reviews.forEach((r) => {
      const row = document.createElement("div");
      row.className = "review-item";

      const header = document.createElement("div");
      header.className = "review-header";
      header.textContent = r.username || "Unknown";

      const textEl = document.createElement("div");
      textEl.className = "review-text";
      textEl.textContent = r.text;

      row.appendChild(header);
      row.appendChild(textEl);
      reviewModalBody.appendChild(row);
    });
  }

  reviewModal.classList.add("show");
  document.body.style.overflow = "hidden";
}

function closeReviewModal() {
  if (!reviewModal) return;
  reviewModal.classList.remove("show");
  document.body.style.overflow = "";
}

if (reviewModalClose) {
  reviewModalClose.addEventListener("click", closeReviewModal);
}
if (reviewModalBackdrop) {
  reviewModalBackdrop.addEventListener("click", closeReviewModal);
}

// Handle click on rarity badges to load corresponding reviews from the server.
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent
if (rarityRow) {
  rarityRow.addEventListener("click", async (event) => {
    const target = event.target;
    if (!target) return;
    const item = target.closest(".rarity-item");
    if (!item) return;

    const level = item.dataset.level;
    if (!level) return;

    try {
      const res = await fetch(`/api/reviews/${encodeURIComponent(level)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load reviews");
      }
      openReviewModal(level, data.reviews || []);
    } catch (err) {
      console.error(err);
      alert("Failed to load reviews / 加载评价失败");
    }
  });
}

/* Stats panel */
function renderStats() {
  const coins = getAvailableCoins();
  const lifetime = state.totalSeconds || 0;

  if (usernameLabelSide) {
    usernameLabelSide.textContent = currentUser || "—";
  }
  if (coinLabel) {
    coinLabel.textContent = coins;
  }
  if (sessionTimerEl) {
    sessionTimerEl.textContent = fmtHMS(lifetime);
  }

  if (drawBtn) {
    drawBtn.disabled = !(loggedIn && coins >= 3);
  }
}

/* Collect +1 coin button */
let coinButtonVisible = false;
let coinButtonTimeoutId = null;
let hideCoinsInSocial = false;

if (hideCoinsToggle) {
  hideCoinsToggle.addEventListener("change", () => {
    hideCoinsInSocial = hideCoinsToggle.checked;
    sendPresence(true);
  });
}

// Show the “Collect +1” button and set up its 3-second lifetime.
function showCoinButton() {
  if (!coinSpawnBtn || coinButtonVisible || !loggedIn) return;

  coinButtonVisible = true;
  coinSpawnBtn.style.display = "inline-flex";
  coinSpawnBtn.disabled = false;
  coinSpawnBtn.classList.add("coin-claim-visible");

  log(
    "A coin is ready! Click within 3 seconds to claim. / 有一枚硬币可以领取，请在 3 秒内点击按钮。"
  );

  coinButtonTimeoutId = setTimeout(() => {
    if (coinButtonVisible) {
      log(
        "You missed a coin (button expired). / 这次硬币已经消失，没有被领取。"
      );
      hideCoinButton();
    }
  }, COIN_LIFETIME);
}

// Hide the coin button and clear its timeout if needed.
function hideCoinButton() {
  if (!coinSpawnBtn) return;
  coinButtonVisible = false;
  coinSpawnBtn.disabled = true;
  coinSpawnBtn.classList.remove("coin-claim-visible", "coin-claim-clicked");
  coinSpawnBtn.style.display = "none";

  if (coinButtonTimeoutId) {
    clearTimeout(coinButtonTimeoutId);
    coinButtonTimeoutId = null;
  }
}

// When the player clicks “Collect +1”, grant one coin and sync.
if (coinSpawnBtn) {
  coinSpawnBtn.addEventListener("click", () => {
    if (!coinButtonVisible || !loggedIn) return;

    coinSpawnBtn.classList.add("coin-claim-clicked");
    state.coinsClaimed = (state.coinsClaimed || 0) + 1;

    renderStats();
    log("You claimed +1 coin! / 你成功领取了 1 枚硬币。");
    syncState();
    sendPresence(true);

    if (coinButtonTimeoutId) {
      clearTimeout(coinButtonTimeoutId);
      coinButtonTimeoutId = null;
    }
    setTimeout(hideCoinButton, 180);
  });
}

// Check whether totalSeconds has crossed any new 20s threshold,
// and if so, trigger one coin event. This timing logic was checked with
// help from GPT-5.1 so that edge cases across multiple sessions are handled.
function maybeSpawnCoinFromTime() {
  const total = state.totalSeconds || 0;
  const thresholdIndex = Math.floor(total / COIN_INTERVAL);

  if (
    thresholdIndex > (state.coinEventsTriggered || 0) &&
    !coinButtonVisible
  ) {
    state.coinEventsTriggered = thresholdIndex;
    showCoinButton();
    syncState();
    sendPresence(true);
  }
}

/* Socket.io presence & global time */

let socket = null;
let globalSeconds = 0;
let presenceTicks = 0;
let secondsSinceLastSync = 0;

// Emit a presence update to the server with lightweight state.
// Nullish coalescing (??) is used for safe defaults.
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Nullish_coalescing_operator
function sendPresence(force = false) {
  if (!socket || !loggedIn || !currentUser) return;
  if (!force && presenceTicks < 5) return;

  presenceTicks = 0;
  socket.emit("presence:update", {
    username: currentUser,
    totalSeconds: state.totalSeconds || 0,
    coins: getAvailableCoins(),
    lastCards: (state.cards || []).slice(-3),
    hideCoins: hideCoinsInSocial
  });
}

/* Main timer loop (per-account time) */

// Main “tick” loop, scheduled every 1000ms via setTimeout rather than setInterval
// for more explicit control. The structure of this loop was drafted with support
// from GPT-5.1 to keep sync and presence intervals readable.
function tick() {
  if (isActiveForTimer()) {
    state.totalSeconds = (state.totalSeconds || 0) + 1;
    secondsSinceLastSync += 1;
    presenceTicks += 1;

    if (secondsSinceLastSync >= 10) {
      syncState();
      secondsSinceLastSync = 0;
    }

    sendPresence(false);
  }

  renderStats();
  maybeSpawnCoinFromTime();
  setTimeout(tick, 1000);
}

tick();

/* Lottery logic */

// Weighted random selection for card outcomes.
// The thresholds were tuned with GPT-5.1's help to feel roughly “gacha-like”
// while still remaining easy to reason about in code.
function drawResult() {
  const r = Math.random();
  if (r < 0.2) return "NONE";
  else if (r < 0.45) return "F";
  else if (r < 0.7) return "E";
  else if (r < 0.825) return "D";
  else if (r < 0.925) return "C";
  else if (r < 0.975) return "B";
  else if (r < 0.995) return "A";
  return "S";
}

// Drive the flip animation from card back → result → back again.
function flipToCard(result) {
  if (!flipCard || !cardFront || !cardBackImg) return;

  flipCard.classList.remove("flipped");
  cardFront.src = "./assets/cards/back.jpg";

  // Small delay ensures the “reset to back” state is applied before we flip.
  setTimeout(() => {
    const imgPath =
      result === "NONE"
        ? "./assets/cards/NONE.jpg"
        : `./assets/cards/${result}.jpg`;

    cardBackImg.src = imgPath;
    flipCard.classList.add("flipped");

    setTimeout(() => {
      flipCard.classList.remove("flipped");
      cardFront.src = "./assets/cards/back.jpg";
      cardBackImg.src = "./assets/cards/back.jpg";
    }, FLIP_DURATION + CARD_HOLD_DURATION);
  }, 20);
}

if (drawBtn) {
  drawBtn.addEventListener("click", () => {
    if (!loggedIn) {
      alert("Please log in first. / 请先登录账号。");
      return;
    }

    const coins = getAvailableCoins();
    if (coins < 3) {
      alert("Not enough coins! / 当前硬币不足 3 枚。");
      return;
    }

    state.coinsSpent = (state.coinsSpent || 0) + 3;
    if (!state.cards) state.cards = [];

    const result = drawResult();
    state.cards.push(result);

    renderInventory();
    renderStats();
    flipToCard(result);
    syncState();
    sendPresence(true);

    log(
      `You drew: ${
        result === "NONE" ? "No Prize" : "Card " + result
      } / 抽到结果：${result === "NONE" ? "未中奖" : "卡牌 " + result}。`
    );
  });
}

/* Socket.io initialisation */
if (typeof io !== "undefined") {
  socket = io();

  socket.on("totalTime", (t) => {
    globalSeconds = Number(t) || 0;
    if (globalTimerDisplay) {
      globalTimerDisplay.textContent = fmtHMS(globalSeconds);
    }
  });

  socket.on("onlineUsers", (users) => {
    renderOnlineUsers(users || []);
  });

  // Local visual ticker so the global time label moves smoothly
  // between server updates.
  function globalTick() {
    if (globalTimerDisplay && !document.hidden) {
      globalSeconds += 1;
      globalTimerDisplay.textContent = fmtHMS(globalSeconds);
    }
    setTimeout(globalTick, 1000);
  }

  setTimeout(globalTick, 1000);
}

/* Initial render */
renderInventory();
renderStats();
if (cardFront) cardFront.src = "./assets/cards/back.jpg";
if (cardBackImg) cardBackImg.src = "./assets/cards/back.jpg";
