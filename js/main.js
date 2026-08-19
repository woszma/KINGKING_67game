import { Game } from "./game.js";

const dom = {
  screenStart: document.getElementById("screen-start"),
  screenError: document.getElementById("screen-error"),
  screenPlay: document.getElementById("screen-play"),
  screenResults: document.getElementById("screen-results"),

  statusRow: document.getElementById("statusRow"),
  statusText: document.getElementById("statusText"),
  btnStart: document.getElementById("btnStart"),
  btnRetry: document.getElementById("btnRetry"),
  btnErrorClose: document.getElementById("btnErrorClose"),

  camVideo: document.getElementById("camVideo"),
  avatarStage: document.getElementById("avatarStage"),
  partBody: document.getElementById("partBody"),
  partLeftWing: document.getElementById("partLeftWing"),
  partRightWing: document.getElementById("partRightWing"),
  headGroup: document.getElementById("headGroup"),
  partHead: document.getElementById("partHead"),
  leftEyeCanvas: document.getElementById("leftEyeCanvas"),
  rightEyeCanvas: document.getElementById("rightEyeCanvas"),

  hudTimer: document.getElementById("hudTimer"),
  hudTotal: document.getElementById("hudTotal"),
  lrLeft: document.getElementById("lrLeft"),
  lrRight: document.getElementById("lrRight"),
  countdown: document.getElementById("countdown"),
  btnQuit: document.getElementById("btnQuit"),

  debugPanel: document.getElementById("debugPanel"),
  debugCanvas: document.getElementById("debugCanvas"),
  debugText: document.getElementById("debugText"),
  btnDebugToggle: document.getElementById("btnDebugToggle"),
  btnMute: document.getElementById("btnMute"),

  resultTotal: document.getElementById("resultTotal"),
  statPeak: document.getElementById("statPeak"),
  statAvg: document.getElementById("statAvg"),
  statBest: document.getElementById("statBest"),
  resultMessage: document.getElementById("resultMessage"),
  btnPlayAgain: document.getElementById("btnPlayAgain"),
  btnShare: document.getElementById("btnShare"),
};

const screens = [dom.screenStart, dom.screenError, dom.screenPlay, dom.screenResults];
function showScreen(el) {
  screens.forEach((s) => s.classList.toggle("active", s === el));
}

function setStatus(mode, text) {
  dom.statusRow.classList.remove("status-pending", "status-ok", "status-error");
  dom.statusRow.classList.add(`status-${mode}`);
  dom.statusText.textContent = text;
}

const game = new Game(dom);
game.onRoundComplete = () => showScreen(dom.screenResults);

async function launchRound() {
  game.audio.unlock(); // must happen synchronously inside the click handler (autoplay policy)
  setStatus("pending", "準備緊鏡頭同追蹤模型…");
  try {
    await game.ensureCamera();
    await game.ensureTracker();
    setStatus("ok", "All set.");
    showScreen(dom.screenPlay);
    await game.startRound();
  } catch (err) {
    console.error(err);
    showScreen(dom.screenError);
  }
}

dom.btnStart.addEventListener("click", launchRound);
dom.btnRetry.addEventListener("click", launchRound);
dom.btnErrorClose.addEventListener("click", () => showScreen(dom.screenStart));

dom.btnQuit.addEventListener("click", () => {
  game.quit();
  showScreen(dom.screenStart);
  setStatus("pending", "按「開始遊戲」授權鏡頭");
});

dom.btnPlayAgain.addEventListener("click", async () => {
  showScreen(dom.screenPlay);
  await game.startRound();
});

dom.btnShare.addEventListener("click", async () => {
  const text = `我喺 67 企鵝挑戰攞咗 ${dom.resultTotal.textContent} 分！你嚟試吓？`;
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (_) {
      /* user cancelled share sheet */
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    dom.btnShare.textContent = "已複製到剪貼簿！";
    setTimeout(() => (dom.btnShare.textContent = "分享分數"), 1800);
  } catch (_) {
    /* clipboard unavailable */
  }
});

dom.btnDebugToggle.addEventListener("click", () => game.toggleDebug());

dom.btnMute.addEventListener("click", () => {
  const muted = game.toggleMute();
  dom.btnMute.textContent = muted ? "🔇" : "🔊";
});
