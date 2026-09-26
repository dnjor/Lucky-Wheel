(() => {
  "use strict";

  const STORAGE_KEY = "premium-wheel-participants-v1";
  const SOUND_KEY = "premium-wheel-sound-v1";
  const TAU = Math.PI * 2;
  const DEFAULT_NAMES = ["سارة", "محمد", "ليان", "خالد", "نورة", "عمر", "ريم", "يوسف"];
  const PALETTE = [
    ["#6d5ce8", "#5142bd"],
    ["#2eb9ad", "#1e8d89"],
    ["#e1a73b", "#b97720"],
    ["#d8547b", "#a93c61"],
    ["#397fc7", "#285b9b"],
    ["#9b58c7", "#713d9f"],
    ["#e46f45", "#b64c2b"],
    ["#39a967", "#267c4d"],
    ["#5665d9", "#3f47a8"],
    ["#c65d9a", "#963e74"],
    ["#23a3c1", "#177993"],
    ["#b98b36", "#8d6424"]
  ];

  const canvas = document.querySelector("#wheelCanvas");
  const ctx = canvas.getContext("2d");
  const wheelStage = document.querySelector("#wheelStage");
  const emptyState = document.querySelector("#emptyState");
  const spinButton = document.querySelector("#spinButton");
  const spinHub = document.querySelector("#spinHub");
  const addForm = document.querySelector("#addForm");
  const nameInput = document.querySelector("#nameInput");
  const formMessage = document.querySelector("#formMessage");
  const participantList = document.querySelector("#participantList");
  const participantCount = document.querySelector("#participantCount");
  const listBadge = document.querySelector("#listBadge");
  const resetButton = document.querySelector("#resetButton");
  const soundToggle = document.querySelector("#soundToggle");
  const winnerModal = document.querySelector("#winnerModal");
  const winnerName = document.querySelector("#winnerName");
  const keepButton = document.querySelector("#keepButton");
  const removeWinnerButton = document.querySelector("#removeWinnerButton");
  const toast = document.querySelector("#toast");
  const celebrationCanvas = document.querySelector("#celebrationCanvas");
  const celebrationCtx = celebrationCanvas.getContext("2d");

  let participants = loadParticipants();
  let rotation = 0;
  let isSpinning = false;
  let selectedIndex = null;
  let lastTickSegment = null;
  let toastTimer = null;
  let messageTimer = null;
  let audioContext = null;
  let confettiFrame = null;
  let soundEnabled = true;
  try {
    soundEnabled = localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    soundEnabled = true;
  }

  function loadParticipants() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === null) return [...DEFAULT_NAMES];
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed)
        ? parsed.filter((name) => typeof name === "string" && name.trim()).map((name) => name.trim()).slice(0, 120)
        : [...DEFAULT_NAMES];
    } catch {
      return [...DEFAULT_NAMES];
    }
  }

  function saveParticipants() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(participants));
    } catch {
      // The wheel remains fully usable when browser storage is unavailable.
    }
  }

  function randomInt(max) {
    if (max <= 1) return 0;
    if (globalThis.crypto?.getRandomValues) {
      const maxUint = 0x100000000;
      const limit = maxUint - (maxUint % max);
      const values = new Uint32Array(1);
      do globalThis.crypto.getRandomValues(values); while (values[0] >= limit);
      return values[0] % max;
    }
    return Math.floor(Math.random() * max);
  }

  function normalizeAngle(angle) {
    return ((angle % TAU) + TAU) % TAU;
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const nextWidth = Math.max(1, Math.round(rect.width * dpr));
    const nextHeight = Math.max(1, Math.round(rect.height * dpr));

    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }
    drawWheel();
  }

  function roundedText(text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let clipped = text;
    while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) {
      clipped = clipped.slice(0, -1);
    }
    return `${clipped}…`;
  }

  function drawWheel() {
    const width = canvas.width;
    const height = canvas.height;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const cssSize = Math.min(width, height) / dpr;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.485;

    ctx.clearRect(0, 0, width, height);
    emptyState.hidden = participants.length > 0;

    if (!participants.length) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, TAU);
      const emptyGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
      emptyGradient.addColorStop(0, "#171d39");
      emptyGradient.addColorStop(1, "#0e1328");
      ctx.fillStyle = emptyGradient;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.08)";
      ctx.lineWidth = 2 * dpr;
      ctx.stroke();
      ctx.restore();
      return;
    }

    const count = participants.length;
    const arc = TAU / count;
    const fontSize = Math.max(10, Math.min(18, cssSize * (count > 30 ? 0.025 : count > 18 ? 0.03 : 0.036))) * dpr;
    const textRadius = radius * (count > 24 ? 0.67 : 0.62);
    const maxTextWidth = count <= 2 ? radius * 0.62 : Math.min(radius * 0.48, Math.max(radius * 0.18, arc * textRadius * 0.82));

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(rotation);

    for (let index = 0; index < count; index += 1) {
      const start = index * arc;
      const end = start + arc;
      const colors = PALETTE[index % PALETTE.length];
      const gradient = ctx.createRadialGradient(0, 0, radius * 0.1, 0, 0, radius);
      gradient.addColorStop(0, colors[1]);
      gradient.addColorStop(1, colors[0]);

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, start, end);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.22)";
      ctx.lineWidth = Math.max(1.2, 1.5 * dpr);
      ctx.stroke();

      const mid = start + arc / 2;
      ctx.save();
      ctx.rotate(mid);
      ctx.translate(textRadius, 0);
      if (Math.cos(mid) < 0) ctx.rotate(Math.PI);
      ctx.fillStyle = "rgba(255,255,255,.96)";
      ctx.shadowColor = "rgba(0,0,0,.35)";
      ctx.shadowBlur = 3 * dpr;
      ctx.font = `700 ${fontSize}px Tahoma, Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.direction = "rtl";
      ctx.fillText(roundedText(participants[index], maxTextWidth), 0, 0, maxTextWidth);
      ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.965, 0, TAU);
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.lineWidth = 3 * dpr;
    ctx.stroke();

    const innerGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 0.24);
    innerGlow.addColorStop(0, "rgba(255,255,255,.15)");
    innerGlow.addColorStop(1, "rgba(0,0,0,.18)");
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.205, 0, TAU);
    ctx.fillStyle = innerGlow;
    ctx.fill();

    ctx.restore();
  }

  function renderParticipants() {
    participantCount.textContent = String(participants.length);
    listBadge.textContent = formatCount(participants.length);
    spinButton.disabled = isSpinning || participants.length === 0;
    spinHub.disabled = isSpinning || participants.length === 0;
    resetButton.disabled = isSpinning || participants.length === 0;
    soundToggle.setAttribute("aria-pressed", String(soundEnabled));
    soundToggle.setAttribute("aria-label", soundEnabled ? "إيقاف الصوت" : "تشغيل الصوت");

    if (!participants.length) {
      participantList.innerHTML = '<div class="list-empty"><strong>القائمة فارغة</strong><span>ابدأ بإضافة الأسماء من الأعلى.</span></div>';
    } else {
      participantList.innerHTML = participants.map((name, index) => {
        const safeName = escapeHTML(name);
        const color = PALETTE[index % PALETTE.length][0];
        return `
          <div class="participant-item" role="listitem" style="--item-color: ${color}">
            <span class="participant-item__number">${String(index + 1).padStart(2, "0")}</span>
            <span class="participant-item__name" title="${safeName}">${safeName}</span>
            <button class="participant-item__delete" type="button" data-index="${index}" aria-label="حذف ${safeName}" ${isSpinning ? "disabled" : ""}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6"/></svg>
            </button>
          </div>`;
      }).join("");
    }

    drawWheel();
  }

  function formatCount(count) {
    if (count === 0) return "لا أسماء";
    if (count === 1) return "اسم واحد";
    if (count === 2) return "اسمان";
    if (count <= 10) return `${count} أسماء`;
    return `${count} اسمًا`;
  }

  function escapeHTML(value) {
    const node = document.createElement("span");
    node.textContent = value;
    return node.innerHTML;
  }

  function showFormMessage(message, success = false) {
    clearTimeout(messageTimer);
    formMessage.textContent = message;
    formMessage.classList.toggle("success", success);
    if (message) {
      messageTimer = setTimeout(() => {
        formMessage.textContent = "";
        formMessage.classList.remove("success");
      }, 2800);
    }
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("show");
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  function addParticipant(rawName) {
    const name = rawName.trim().replace(/\s+/g, " ");
    if (!name) {
      showFormMessage("اكتب اسمًا أولًا.");
      nameInput.focus();
      return;
    }

    const normalized = name.toLocaleLowerCase("ar");
    if (participants.some((person) => person.toLocaleLowerCase("ar") === normalized)) {
      showFormMessage("هذا الاسم موجود بالفعل.");
      nameInput.select();
      return;
    }

    participants.push(name);
    saveParticipants();
    renderParticipants();
    nameInput.value = "";
    showFormMessage(`تمت إضافة ${name}.`, true);
    nameInput.focus();
  }

  function removeParticipant(index, announce = true) {
    if (isSpinning || index < 0 || index >= participants.length) return;
    const [removed] = participants.splice(index, 1);
    saveParticipants();
    renderParticipants();
    if (announce) showToast(`تم حذف ${removed} من العجلة.`);
  }

  function easeOutQuint(t) {
    return 1 - Math.pow(1 - t, 5);
  }

  function spin() {
    if (isSpinning) return;
    if (!participants.length) {
      showToast("أضف اسمًا واحدًا على الأقل قبل التدوير.");
      nameInput.focus();
      return;
    }

    isSpinning = true;
    selectedIndex = randomInt(participants.length);
    lastTickSegment = null;
    renderParticipants();
    wheelStage.classList.add("spinning");
    spinButton.querySelector(".primary-spin__label").textContent = "العجلة تدور...";

    const arc = TAU / participants.length;
    const startRotation = rotation;
    const desiredNormalized = normalizeAngle(-Math.PI / 2 - (selectedIndex + 0.5) * arc);
    const currentNormalized = normalizeAngle(startRotation);
    const alignmentDelta = normalizeAngle(desiredNormalized - currentNormalized);
    const fullTurns = 6 + randomInt(4);
    const targetRotation = startRotation + fullTurns * TAU + alignmentDelta;
    const duration = 5600 + randomInt(1200);
    const startTime = performance.now();

    playStartSound();

    function animate(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutQuint(progress);
      rotation = startRotation + (targetRotation - startRotation) * eased;
      drawWheel();
      playSegmentTick(arc, progress);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        rotation = targetRotation;
        drawWheel();
        finishSpin();
      }
    }

    requestAnimationFrame(animate);
  }

  function finishSpin() {
    isSpinning = false;
    wheelStage.classList.remove("spinning");
    spinButton.querySelector(".primary-spin__label").textContent = "تدوير العجلة";
    renderParticipants();
    playWinSound();
    setTimeout(openWinnerModal, 260);
  }

  function openWinnerModal() {
    if (selectedIndex === null || !participants[selectedIndex]) return;
    winnerName.textContent = participants[selectedIndex];
    winnerModal.hidden = false;
    document.body.style.overflow = "hidden";
    keepButton.focus();
    launchConfetti();
  }

  function closeWinnerModal() {
    winnerModal.hidden = true;
    document.body.style.overflow = "";
    if (confettiFrame) cancelAnimationFrame(confettiFrame);
    confettiFrame = null;
    celebrationCtx.clearRect(0, 0, celebrationCanvas.width, celebrationCanvas.height);
    selectedIndex = null;
    spinButton.focus();
  }

  function getAudioContext() {
    if (!soundEnabled) return null;
    if (!audioContext) {
      const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (AudioContext) audioContext = new AudioContext();
    }
    if (audioContext?.state === "suspended") audioContext.resume();
    return audioContext;
  }

  function tone(frequency, duration, volume = 0.035, type = "sine", delay = 0) {
    const ac = getAudioContext();
    if (!ac) return;
    const oscillator = ac.createOscillator();
    const gain = ac.createGain();
    const start = ac.currentTime + delay;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(ac.destination);
    oscillator.start(start);
    oscillator.stop(start + duration);
  }

  function playStartSound() {
    tone(190, 0.18, 0.045, "triangle");
    tone(285, 0.22, 0.03, "triangle", 0.08);
  }

  function playSegmentTick(arc, progress) {
    if (!soundEnabled || progress > 0.985) return;
    const segment = Math.floor(normalizeAngle(rotation + Math.PI / 2) / arc);
    if (segment !== lastTickSegment) {
      lastTickSegment = segment;
      tone(progress > 0.7 ? 520 : 430, 0.035, progress > 0.85 ? 0.018 : 0.012, "square");
    }
  }

  function playWinSound() {
    tone(523.25, 0.28, 0.045, "sine");
    tone(659.25, 0.3, 0.045, "sine", 0.12);
    tone(783.99, 0.5, 0.05, "sine", 0.24);
  }

  function launchConfetti() {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    celebrationCanvas.width = Math.round(globalThis.innerWidth * dpr);
    celebrationCanvas.height = Math.round(globalThis.innerHeight * dpr);
    celebrationCanvas.style.width = `${globalThis.innerWidth}px`;
    celebrationCanvas.style.height = `${globalThis.innerHeight}px`;

    const colors = ["#f7c75b", "#4ed8c6", "#7768ee", "#ff6b8b", "#ffffff"];
    const pieces = Array.from({ length: 90 }, (_, index) => ({
      x: globalThis.innerWidth * (index % 2 === 0 ? 0.18 : 0.82) * dpr,
      y: globalThis.innerHeight * 0.35 * dpr,
      vx: ((index % 2 === 0 ? 1 : -1) * (2.5 + Math.random() * 5)) * dpr,
      vy: (-7 - Math.random() * 8) * dpr,
      gravity: (0.22 + Math.random() * 0.12) * dpr,
      rotation: Math.random() * TAU,
      rotationSpeed: (Math.random() - 0.5) * 0.22,
      width: (5 + Math.random() * 5) * dpr,
      height: (8 + Math.random() * 7) * dpr,
      color: colors[index % colors.length],
      opacity: 1
    }));

    const start = performance.now();
    function animateConfetti(now) {
      celebrationCtx.clearRect(0, 0, celebrationCanvas.width, celebrationCanvas.height);
      const age = now - start;
      for (const piece of pieces) {
        piece.x += piece.vx;
        piece.y += piece.vy;
        piece.vy += piece.gravity;
        piece.vx *= 0.994;
        piece.rotation += piece.rotationSpeed;
        piece.opacity = Math.max(0, 1 - Math.max(0, age - 1700) / 900);
        celebrationCtx.save();
        celebrationCtx.globalAlpha = piece.opacity;
        celebrationCtx.translate(piece.x, piece.y);
        celebrationCtx.rotate(piece.rotation);
        celebrationCtx.fillStyle = piece.color;
        celebrationCtx.fillRect(-piece.width / 2, -piece.height / 2, piece.width, piece.height);
        celebrationCtx.restore();
      }
      if (age < 2600 && !winnerModal.hidden) confettiFrame = requestAnimationFrame(animateConfetti);
    }
    confettiFrame = requestAnimationFrame(animateConfetti);
  }

  addForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!isSpinning) addParticipant(nameInput.value);
  });

  participantList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-index]");
    if (button) removeParticipant(Number(button.dataset.index));
  });

  spinButton.addEventListener("click", spin);
  spinHub.addEventListener("click", spin);

  resetButton.addEventListener("click", () => {
    if (!participants.length || isSpinning) return;
    if (globalThis.confirm("هل تريد حذف جميع الأسماء وإعادة ضبط العجلة؟")) {
      participants = [];
      rotation = 0;
      saveParticipants();
      renderParticipants();
      showToast("تمت إعادة ضبط العجلة.");
      nameInput.focus();
    }
  });

  soundToggle.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    try {
      localStorage.setItem(SOUND_KEY, soundEnabled ? "on" : "off");
    } catch {
      // Keep the session preference even when browser storage is unavailable.
    }
    renderParticipants();
    if (soundEnabled) tone(660, 0.12, 0.025, "sine");
    showToast(soundEnabled ? "تم تشغيل الصوت." : "تم إيقاف الصوت.");
  });

  keepButton.addEventListener("click", closeWinnerModal);
  removeWinnerButton.addEventListener("click", () => {
    if (selectedIndex === null) return;
    const removedName = participants[selectedIndex];
    participants.splice(selectedIndex, 1);
    saveParticipants();
    closeWinnerModal();
    renderParticipants();
    showToast(`تم حذف ${removedName} من الجولة القادمة.`);
  });

  winnerModal.addEventListener("click", (event) => {
    if (event.target === winnerModal) closeWinnerModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !winnerModal.hidden) {
      closeWinnerModal();
      return;
    }
    if (event.code === "Space" && winnerModal.hidden && document.activeElement !== nameInput) {
      event.preventDefault();
      spin();
    }
  });

  if ("ResizeObserver" in globalThis) {
    new ResizeObserver(resizeCanvas).observe(canvas);
  } else {
    globalThis.addEventListener("resize", resizeCanvas);
  }

  renderParticipants();
  requestAnimationFrame(resizeCanvas);
})();
