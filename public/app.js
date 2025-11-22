/* ===========================================================
   Time Shop 前端逻辑
   - 账号登录 / 注册
   - 计时 + Collect +1 硬币
   - 抽卡翻转动画
   - 在线用户显示
   - 使用教程（中英双列）
   - 注册成功后规则弹窗（美观版）
   - Inventory 点击卡牌 → 大图 + 评论输入
   - Lottery 稀有度按钮 → 查看该等级的评论
   - 评论发送成功 / 失败 Toast 提示
   =========================================================== */

const BASE_COINS = 2;
const COIN_INTERVAL = 120;
const COIN_LIFETIME = 3000;
const FLIP_DURATION = 600;
const CARD_HOLD_DURATION = 4000;

// 账号 & 状态
let currentUser = null;
let currentPassword = null;
let loggedIn = false;

let state = {
  totalSeconds: 0,
  coinsSpent: 0,
  cards: [],
  coinsClaimed: 0,
  coinEventsTriggered: 0,
};

/* =============================
   DOM 引用
   ============================= */

// 登录
const authOverlay = document.getElementById("authOverlay");
const authUsername = document.getElementById("authUsername");
const authPassword = document.getElementById("authPassword");
const signupBtn = document.getElementById("signupBtn");
const loginBtn = document.getElementById("loginBtn");
const authMessageEl = document.getElementById("authMessage");

// 注册成功规则弹窗
const signupGuideOverlay = document.getElementById("signupGuideOverlay");
const signupGuideClose = document.getElementById("signupGuideClose");
const signupGuideGotIt = document.getElementById("signupGuideGotIt");
const signupGuideBackdrop = signupGuideOverlay
  ? signupGuideOverlay.querySelector(".signup-guide-backdrop")
  : null;

// 使用教程 overlay
const tutorialOverlay = document.getElementById("tutorialOverlay");
const tutorialCloseBtn = document.getElementById("tutorialCloseBtn");
const tutorialDontShow = document.getElementById("tutorialDontShow");

// 顶部时间 / 用户
const usernameLabel = document.getElementById("usernameLabel");
const usernameLabelSide = document.getElementById("usernameLabel-side");
const coinLabel = document.getElementById("coinLabel");
const sessionTimerEl = document.getElementById("sessionTimer");
const globalTimerDisplay = document.getElementById("timerDisplay");

// 抽卡
const drawBtn = document.getElementById("drawBtn");
const resetBtn = document.getElementById("resetBtn");
const flipCard = document.getElementById("flipCard");
const cardFront = document.getElementById("cardFront");
const cardBackImg = document.getElementById("cardBack");
const rarityRow = document.querySelector(".rarity-row");

// Inventory / Log
const invGrid = document.getElementById("inventory");
const logBox = document.getElementById("log");

// Collect +1 & 在线用户
const coinSpawnBtn = document.getElementById("coinSpawnBtn");
const onlineUsersList = document.getElementById("onlineUsersList");
const hideCoinsToggle = document.getElementById("toggleHideCoins");

// 图片查看 + 评论
const imageViewer = document.getElementById("imageViewer");
const imageViewerImg = document.getElementById("imageViewerImg");
const imageViewerLabel = document.getElementById("imageViewerLabel");
const imageViewerClose = document.getElementById("imageViewerClose");
const imageViewerBackdrop = imageViewer
  ? imageViewer.querySelector(".image-viewer-backdrop")
  : null;
const imageViewerReviewInput = document.getElementById("imageViewerReviewInput");
const imageViewerReviewSend = document.getElementById("imageViewerReviewSend");

// 按等级查看评论模态
const reviewModal = document.getElementById("reviewModal");
const reviewModalTitle = document.getElementById("reviewModalTitle");
const reviewModalBody = document.getElementById("reviewModalBody");
const reviewModalClose = document.getElementById("reviewModalClose");
const reviewModalBackdrop = reviewModal
  ? reviewModal.querySelector(".review-modal-backdrop")
  : null;

/* =============================
   活跃判定（决定计时是否累加）
   ============================= */

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

function isActiveForTimer() {
  if (!loggedIn || document.hidden || !hasFocus) return false;
  if (isTouchDevice) return true;
  return pointerInside;
}

/* =============================
   Collect +1 & 在线用户开关
   ============================= */

let coinButtonVisible = false;
let coinButtonTimeoutId = null;
let hideCoinsInSocial = false;

if (hideCoinsToggle) {
  hideCoinsToggle.addEventListener("change", () => {
    hideCoinsInSocial = hideCoinsToggle.checked;
    sendPresence(true);
  });
}

/* =============================
   Socket.io
   ============================= */

let socket = null;
let globalSeconds = 0;

/* =============================
   工具函数
   ============================= */

function getAvailableCoins() {
  return BASE_COINS + (state.coinsClaimed || 0) - (state.coinsSpent || 0);
}

function fmtHMS(s) {
  s = Math.floor(s);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function log(msg) {
  const el = document.createElement("div");
  el.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logBox.prepend(el);
}

function setAuthMessage(msg, isError = true) {
  if (!authMessageEl) return;
  authMessageEl.textContent = msg || "";
  authMessageEl.style.color = isError ? "#ef4444" : "#16a34a";
}

/* ========== Toast 提示 ========== */

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

  if (toastTimeoutId) {
    clearTimeout(toastTimeoutId);
  }
  toastTimeoutId = setTimeout(() => {
    el.classList.remove("show");
  }, 2000);
}

/* ========== 注册成功规则弹窗逻辑 ========== */

function showSignupGuide() {
  if (!signupGuideOverlay) return;
  signupGuideOverlay.classList.add("show");
  document.body.style.overflow = "hidden";
}

function hideSignupGuide() {
  if (!signupGuideOverlay) return;
  signupGuideOverlay.classList.remove("show");
  document.body.style.overflow = "";
  // 关闭注册规则弹窗后，再按设置显示使用教程 overlay
  maybeShowTutorial();
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

/* =============================
   HTTP 请求封装
   ============================= */

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}

async function signup(username, password) {
  return postJSON("/auth/signup", { username, password });
}

async function login(username, password) {
  return postJSON("/auth/login", { username, password });
}

async function syncState() {
  if (!loggedIn || !currentUser || !currentPassword) return;
  try {
    await postJSON("/api/state", {
      username: currentUser,
      password: currentPassword,
      state,
    });
  } catch (err) {
    console.warn("syncState failed:", err.message);
  }
}

/* =============================
   在线用户渲染
   ============================= */

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
          ? "You can still see yours above / 你仍能在 Player 区看到自己的硬币"
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
      label.style.fontSize = "0.75rem";
      label.style.color = "#6b7280";
      label.textContent = "Recent cards / 最近卡牌:";
      cardsRow.appendChild(label);

      const levels = document.createElement("span");
      levels.style.fontSize = "0.75rem";
      levels.style.marginLeft = "4px";
      levels.textContent = cards.join(", ");
      cardsRow.appendChild(levels);
    }

    item.appendChild(cardsRow);
    onlineUsersList.appendChild(item);
  });
}

/* =============================
   使用教程 overlay：显示 / 隐藏
   ============================= */

const TUTORIAL_KEY = "timeShopTutorialHidden";

function showTutorial() {
  if (!tutorialOverlay) return;
  tutorialOverlay.classList.add("show");
  document.body.style.overflow = "hidden";
}

function hideTutorial() {
  if (!tutorialOverlay) return;
  tutorialOverlay.classList.remove("show");
  document.body.style.overflow = "";
}

function maybeShowTutorial() {
  if (!tutorialOverlay) return;
  const hidden = localStorage.getItem(TUTORIAL_KEY);
  if (hidden === "1") return;
  showTutorial();
}

if (tutorialCloseBtn) {
  tutorialCloseBtn.addEventListener("click", () => {
    if (tutorialDontShow && tutorialDontShow.checked) {
      localStorage.setItem(TUTORIAL_KEY, "1");
    }
    hideTutorial();
  });
}

if (tutorialOverlay) {
  const backdrop = tutorialOverlay.querySelector(".tutorial-backdrop");
  if (backdrop) {
    backdrop.addEventListener("click", hideTutorial);
  }
}

/* =============================
   登录 / 注册逻辑
   ============================= */

async function handleAuth(action) {
  const username = authUsername.value.trim();
  const password = authPassword.value.trim();

  if (!username || !password) {
    setAuthMessage("Username and password are required. / 请输入用户名与密码。");
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
        coinEventsTriggered: 0,
      };
    loggedIn = true;

    authOverlay.style.display = "none";
    renderInventory();
    renderStats();
    log(`Welcome, ${currentUser}! / 欢迎，${currentUser}！你的账号数据已载入。`);
    sendPresence(true);
    setAuthMessage(
      action === "signup"
        ? "Sign up successful. You are now logged in. / 注册成功，已自动登录。"
        : "Login successful. / 登录成功。",
      false
    );

    // 注册：先弹规则弹窗；登录：直接按设置弹使用教程
    if (action === "signup") {
      showSignupGuide();
    } else {
      maybeShowTutorial();
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

/* =============================
   Inventory 渲染（卡牌可点击打开大图）
   ============================= */

function renderInventory() {
  invGrid.innerHTML = "";
  if (!state.cards || !state.cards.length) {
    const d = document.createElement("div");
    d.textContent = "— No cards yet / 暂无卡牌 —";
    d.style.opacity = "0.6";
    d.style.gridColumn = "1 / -1";
    invGrid.appendChild(d);
    return;
  }

  state.cards.forEach((c) => {
    const level = c; // 'S'...'F' 或 'NONE'

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

/* =============================
   Inventory 点击 → 打开图片查看 + 评论
   ============================= */

let currentPreviewLevel = null;

function openImageViewer(src, label, level) {
  if (!imageViewer || !imageViewerImg) return;
  currentPreviewLevel = level || null;
  imageViewerImg.src = src;
  if (imageViewerLabel) imageViewerLabel.textContent = label || "";
  if (imageViewerReviewInput) imageViewerReviewInput.value = "";
  imageViewer.classList.add("show");
  document.body.style.overflow = "hidden";
}

function closeImageViewer() {
  if (!imageViewer) return;
  imageViewer.classList.remove("show");
  document.body.style.overflow = "";
  currentPreviewLevel = null;
}

if (imageViewerClose) {
  imageViewerClose.addEventListener("click", closeImageViewer);
}
if (imageViewerBackdrop) {
  imageViewerBackdrop.addEventListener("click", closeImageViewer);
}

if (invGrid) {
  invGrid.addEventListener("click", (event) => {
    const target = event.target;
    if (!target) return;
    const item = target.closest(".inv-item");
    if (!item) return;

    const imgEl = item.querySelector("img");
    const labelEl = item.querySelector(".label");
    const src = item.dataset.src || (imgEl ? imgEl.src : "");
    const label = item.dataset.label || (labelEl ? labelEl.textContent : "");
    const level = item.dataset.level || null;

    if (!src) return;
    openImageViewer(src, label, level);
  });
}

/* =============================
   在大图下面发送评论
   ============================= */

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
        text,
      });
      showToast("Review sent / 发送成功");
      if (imageViewerReviewInput) imageViewerReviewInput.value = "";
    } catch (err) {
      console.error(err);
      showToast("Failed to send review / 发送失败");
    }
  });
}

/* =============================
   按等级查看评论 Modal
   ============================= */

function openReviewModal(level, reviews) {
  if (!reviewModal || !reviewModalBody || !reviewModalTitle) return;

  let titleText;
  if (level === "NONE") {
    titleText = "Reviews for no-prize draws / 未中奖评价";
  } else {
    titleText = `Reviews for ${level} cards / ${level} 卡牌评价`;
  }

  reviewModalTitle.textContent = titleText;
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

/* 点击 Lottery 上的稀有度按钮加载该等级评论 */

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

/* =============================
   Stats 渲染
   ============================= */

function renderStats() {
  const coins = getAvailableCoins();
  const lifetime = state.totalSeconds || 0;

  if (usernameLabel) usernameLabel.textContent = currentUser || "—";
  if (usernameLabelSide) usernameLabelSide.textContent = currentUser || "—";
  if (coinLabel) coinLabel.textContent = coins;
  if (sessionTimerEl) sessionTimerEl.textContent = fmtHMS(lifetime);

  if (drawBtn) {
    drawBtn.disabled = !(loggedIn && coins >= 3);
  }
}

/* =============================
   Collect +1 按钮逻辑
   ============================= */

function showCoinButton() {
  if (!coinSpawnBtn || coinButtonVisible || !loggedIn) return;

  coinButtonVisible = true;
  coinSpawnBtn.style.display = "inline-flex";
  coinSpawnBtn.disabled = false;
  coinSpawnBtn.classList.add("coin-claim-visible");

  log("A coin is ready! Click within 3 seconds to claim. / 有一枚硬币可以领取，请在 3 秒内点击按钮。");

  coinButtonTimeoutId = setTimeout(() => {
    if (coinButtonVisible) {
      log("You missed a coin (button expired). / 这次硬币已经消失，没有被领取。");
      hideCoinButton();
    }
  }, COIN_LIFETIME);
}

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

function maybeSpawnCoinFromTime() {
  const total = state.totalSeconds || 0;
  const thresholdIndex = Math.floor(total / COIN_INTERVAL);
  if (thresholdIndex > (state.coinEventsTriggered || 0) && !coinButtonVisible) {
    state.coinEventsTriggered = thresholdIndex;
    showCoinButton();
    syncState();
    sendPresence(true);
  }
}

/* =============================
   presence 上报
   ============================= */

let presenceTicks = 0;
let secondsSinceLastSync = 0;

function sendPresence(force = false) {
  if (!socket || !loggedIn || !currentUser) return;
  if (!force && presenceTicks < 5) return;

  presenceTicks = 0;
  socket.emit("presence:update", {
    username: currentUser,
    totalSeconds: state.totalSeconds || 0,
    coins: getAvailableCoins(),
    lastCards: (state.cards || []).slice(-3),
    hideCoins: hideCoinsInSocial,
  });
}

/* =============================
   主计时循环
   ============================= */

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

/* =============================
   抽卡逻辑（更新后的概率）
   ============================= */

function drawResult() {
  const r = Math.random();

  // 新概率：
  // NONE: 20%
  // F   : 25%
  // E   : 25%
  // D   : 12.5%
  // C   : 10%
  // B   : 5%
  // A   : 2%
  // S   : 0.5%
  if (r < 0.2) return "NONE";
  else if (r < 0.45) return "F";
  else if (r < 0.7) return "E";
  else if (r < 0.825) return "D";
  else if (r < 0.925) return "C";
  else if (r < 0.975) return "B";
  else if (r < 0.995) return "A";
  return "S";
}

function flipToCard(result) {
  flipCard.classList.remove("flipped");
  cardFront.src = "./assets/cards/back.jpg";

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

/* =============================
   Reset：重置当前账号数据
   ============================= */

resetBtn.addEventListener("click", () => {
  if (!loggedIn) {
    alert("Please log in first. / 请先登录账号。");
    return;
  }
  if (
    !confirm(
      "Reset all data for this account? / 是否重置当前账号的所有数据？（账号本身不会被删除）"
    )
  ) {
    return;
  }

  hideCoinButton();

  state = {
    totalSeconds: 0,
    coinsSpent: 0,
    cards: [],
    coinsClaimed: 0,
    coinEventsTriggered: 0,
  };

  renderInventory();
  renderStats();
  flipCard.classList.remove("flipped");
  cardFront.src = "./assets/cards/back.jpg";
  cardBackImg.src = "./assets/cards/back.jpg";

  syncState();
  sendPresence(true);
  log("Account data has been reset. / 当前账号的数据已清零。");
});

/* =============================
   socket.io：totalTime + 在线用户
   ============================= */

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

  function globalTick() {
    if (globalTimerDisplay && isActiveForTimer()) {
      globalSeconds += 1;
      globalTimerDisplay.textContent = fmtHMS(globalSeconds);
    }
    setTimeout(globalTick, 1000);
  }
  setTimeout(globalTick, 1000);
}

/* =============================
   初始化 / Init
   ============================= */

renderInventory();
renderStats();

if (cardFront) cardFront.src = "./assets/cards/back.jpg";
if (cardBackImg) cardBackImg.src = "./assets/cards/back.jpg";
