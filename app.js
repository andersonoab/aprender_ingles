// =========================
// DADOS PRINCIPAIS
// =========================
let sentences = [];
let translationCache = {};
let history = [];

let currentCard = null;
let currentWords = [];
let dragged = null;

let textEn = "";
let textPt = "";

let madeCount = 0;

// Erros por card
let cardHadError = false;
let attemptErrorEvents = [];

// Repetição rápida
let repeatSoon = [];
const REPEAT_AFTER_N = 3;

// =========================
// MODO TREINO: PIORES FRASES
// =========================
const TRAIN_MODE_KEY = "trainMode_v1";
const WORST_PTR_KEY  = "worstPointer_v1";
const WORST_LIST_KEY = "worstListCache_v1";

let trainMode = "normal";
let worstList = [];
let worstPointer = 0;

function loadTrainMode() {
  const m = localStorage.getItem(TRAIN_MODE_KEY);
  trainMode = (m === "worst") ? "worst" : "normal";
  const p = localStorage.getItem(WORST_PTR_KEY);
  worstPointer = p ? parseInt(p, 10) : 0;
  if (Number.isNaN(worstPointer)) worstPointer = 0;
}

function saveTrainMode() {
  localStorage.setItem(TRAIN_MODE_KEY, trainMode);
  localStorage.setItem(WORST_PTR_KEY, String(worstPointer));
}

function setTrainMode(mode) {
  trainMode = (mode === "worst") ? "worst" : "normal";
  worstPointer = 0;
  saveTrainMode();
  updateTrainButtonUI();
  renderStatusLine(textEn);
}

function updateTrainButtonUI() {
  const btn = document.getElementById("trainWorstBtn");
  if (!btn) return;
  if (trainMode === "worst") {
    btn.innerHTML = '<i class="fa fa-times-circle"></i> Voltar ao normal';
    btn.classList.add('btn-active-mode');
  } else {
    btn.innerHTML = '<i class="fa fa-fire"></i> Piores frases';
    btn.classList.remove('btn-active-mode');
  }
}

// =========================
// MODO NOVAS FRASES (IGNORAR DÍVIDA) + AUTO-PULO
// =========================
const NEW_ONLY_KEY = "newOnlyMode_v1";
const SEQ_PTR_KEY  = "seqPointer_v1";

const SKIP_FORWARD_N = 25;
const AUTO_SKIP_AFTER_ERRORS = 8;
const AUTO_ADVANCE_DELAY_MS = 2500;

let newOnlyMode = false;
let seqPointer = 0;

let currentCardIndex = -1;
let lastAttemptWasIncorrect = false;
let revealClickedThisCard = false;

let isAutoSkipping = false;
let autoAdvanceToken = 0;

function loadNewOnlyMode() {
  const v = localStorage.getItem(NEW_ONLY_KEY);
  newOnlyMode = (v === "1");
  const p = localStorage.getItem(SEQ_PTR_KEY);
  seqPointer = p ? parseInt(p, 10) : 0;
  if (Number.isNaN(seqPointer) || seqPointer < 0) seqPointer = 0;
}

function saveNewOnlyMode() {
  localStorage.setItem(NEW_ONLY_KEY, newOnlyMode ? "1" : "0");
  localStorage.setItem(SEQ_PTR_KEY, String(seqPointer));
}

function applyNewOnlyToggleUI() {
  const wrap = document.getElementById("newOnlyToggleWrap");
  const cb = document.getElementById("newOnlyToggle");
  if (!wrap || !cb) return;

  if (sentences && sentences.length) {
    wrap.style.display = "flex";
    cb.checked = !!newOnlyMode;
  } else {
    wrap.style.display = "none";
  }
}

function setNewOnlyMode(enabled) {
  newOnlyMode = !!enabled;
  saveNewOnlyMode();
  applyNewOnlyToggleUI();
  renderSrsStats();
  renderStatusLine(textEn);
}

function pickNewOnlyCard(step = 1) {
  if (!sentences.length) return null;
  const len = sentences.length;
  const start = (currentCardIndex >= 0) ? currentCardIndex : (seqPointer || 0);
  let idx = ((start + step) % len + len) % len;

  for (let k = 0; k < len; k++) {
    const j = (idx + k) % len;
    const en = sentences[j].en;
    const seen = (srs[en]?.seen || 0);
    if (seen === 0) {
      seqPointer = j;
      saveNewOnlyMode();
      return sentences[j];
    }
  }
  return null;
}

function pickCardForNavigation(forceReviewOnly = false, step = 1) {
  if (favoriteMode) {
    const pool = sentences.filter(s => favorites.includes(s.en));
    if (pool.length) return pickBestCard(pool);
  }

  if (trainMode === "worst") {
    return pickWorstCard(!!forceReviewOnly);
  }

  if (forceReviewOnly) {
    return pickNextCard(true);
  }

  if (newOnlyMode) {
    const c = pickNewOnlyCard(step);
    if (c) return c;
  }

  return pickNextCard(false);
}

function advanceToNext(step = 1, forceReviewOnly = false) {
  if (!sentences.length) return;
  const card = pickCardForNavigation(forceReviewOnly, step);
  lastAttemptWasIncorrect = false;
  window.speechSynthesis.cancel();
  loadSentence(card);
}

function triggerAutoSkip() {
  if (isAutoSkipping) return;
  isAutoSkipping = true;

  lastAttemptWasIncorrect = true;
  applyResult(textEn, false);
  saveAttemptRecord(false);

  document.getElementById("sentenceEn").innerHTML = `
    <span id="copyEnText" style="color: var(--blue-1); font-weight: bold;">EN: ${textEn}</span>
    <button class="copy-btn" onclick="copyText('copyEnText')" title="Copiar">Copiar</button>
    <span class="pill">Pulado</span>
  `;
  document.getElementById("sentencePt").textContent = "";
  document.getElementById("feedback").style.display = "block";

  renderStatusLine(textEn);
  refreshErrorAnalysis();
}

function maybeAutoSkipOnStuck() {
  if (trainMode === "worst") return;
  if (!newOnlyMode) return;
  if (isAutoSkipping) return;
  if (attemptErrorEvents.length >= AUTO_SKIP_AFTER_ERRORS) {
    triggerAutoSkip();
  }
}

// =========================
// LOGS DE ERRO / ESTATÍSTICA
// =========================
const ATTEMPT_LOG_KEY = "attemptLog_v1";
const ERROR_EVENT_LOG_KEY = "errorEventLog_v1";

function loadAttemptLog() {
  try {
    const raw = localStorage.getItem(ATTEMPT_LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveAttemptLog(log) {
  localStorage.setItem(ATTEMPT_LOG_KEY, JSON.stringify(log));
}

function loadErrorEventLog() {
  try {
    const raw = localStorage.getItem(ERROR_EVENT_LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveErrorEventLog(log) {
  localStorage.setItem(ERROR_EVENT_LOG_KEY, JSON.stringify(log));
}

function normalizeWord(w) {
  return String(w || "").trim();
}

function classifyError(expected, received, index, words) {
  const exp = normalizeWord(expected).toLowerCase();
  const rec = normalizeWord(received).toLowerCase();

  const preps = new Set(["in","on","at","before","after","of","to","for","with","from","by","into","over","under","between","during","without","within","about","against","around","through"]);
  const auxiliaries = new Set(["do","does","did","am","is","are","was","were","be","been","being","have","has","had","will","would","can","could","should","may","might","must"]);

  const wordsLower = words.map(x => normalizeWord(x).toLowerCase());
  if (wordsLower.includes(rec) && rec !== exp) return "ordem_das_palavras";
  if (preps.has(exp)) return "preposicao";
  if (exp === "to" || exp.endsWith("ing") || auxiliaries.has(exp)) return "forma_verbal";

  if (exp.endsWith("s") && index > 0) return "concordancia";

  const det = new Set(["a","an","the","this","that","these","those"]);
  if (det.has(exp)) return "artigo_determinante";

  return "outros";
}

function logErrorEvent(expected, received, position) {
  const type = classifyError(expected, received, position, currentWords);
  const ev = {
    en: textEn,
    expected: normalizeWord(expected),
    received: normalizeWord(received),
    position: position,
    type: type,
    ts: Date.now()
  };

  attemptErrorEvents.push(ev);

  const global = loadErrorEventLog();
  global.push(ev);
  saveErrorEventLog(global);
}

function saveAttemptRecord(isCorrectByRule) {
  const record = {
    en: textEn,
    pt: textPt || "",
    ts: Date.now(),
    hadAnyError: attemptErrorEvents.length > 0,
    ruleCorrect: !!isCorrectByRule,
    errorTypes: Array.from(new Set(attemptErrorEvents.map(e => e.type))),
    errorCount: attemptErrorEvents.length,
    events: attemptErrorEvents.slice()
  };

  const log = loadAttemptLog();
  log.push(record);
  saveAttemptLog(log);

  attemptErrorEvents = [];
}

// =========================
// PIORES FRASES: CÁLCULO E SELEÇÃO
// =========================
function computeWorstList(maxItems = 30) {
  const attemptLog = loadAttemptLog();

  const map = {};
  for (const a of attemptLog) {
    if (!a || !a.en) continue;
    if (!map[a.en]) {
      map[a.en] = { errors: 0, attempts: 0, attemptsWithError: 0, lastTs: 0 };
    }
    map[a.en].attempts += 1;
    map[a.en].errors += (a.errorCount || 0);
    if (a.hadAnyError) map[a.en].attemptsWithError += 1;
    if (a.ts && a.ts > map[a.en].lastTs) map[a.en].lastTs = a.ts;
  }

  const rows = Object.entries(map).map(([en, v]) => {
    const recencyBoost = v.lastTs ? Math.min(3, (Date.now() - v.lastTs) < 24*3600*1000 ? 1 : 0) : 0;
    const score = (v.errors * 2) + (v.attemptsWithError * 3) + recencyBoost;
    return { en, score, ...v };
  });

  rows.sort((a,b) => b.score - a.score);

  const filtered = rows.filter(r => r.errors > 0 || r.attemptsWithError > 0);
  const list = filtered.slice(0, maxItems).map(r => r.en);

  localStorage.setItem(WORST_LIST_KEY, JSON.stringify(list));
  return list;
}

function refreshWorstListIfNeeded() {
  worstList = computeWorstList(30);
  worstPointer = 0;
  saveTrainMode();
}

function pickWorstCard(forceDueOnly = false) {
  if (!sentences.length) return null;

  if (!worstList || worstList.length === 0) {
    worstList = computeWorstList(30);
  }

  if (!worstList.length) {
    return pickNextCard(forceDueOnly);
  }

  let candidates = worstList.slice();

  if (forceDueOnly) {
    const now = Date.now();
    candidates = candidates.filter(en => (srs[en]?.due || 0) <= now && (srs[en]?.seen || 0) > 0);
    if (!candidates.length) {
      candidates = worstList.slice();
    }
  }

  if (worstPointer >= candidates.length) worstPointer = 0;

  const en = candidates[worstPointer];
  worstPointer += 1;
  saveTrainMode();

  const card = getCardByEn(en);
  if (card) return card;

  for (let i = 0; i < candidates.length; i++) {
    const c = getCardByEn(candidates[i]);
    if (c) return c;
  }

  return pickNextCard(forceDueOnly);
}

// =========================
// SRS (Leitner simplificado)
// =========================
const SRS_KEY = "srsData_v1";
const SENTENCES_KEY = "sentences_v2";
const CURRENT_KEY = "currentKey_v1";
const TRANSLATION_KEY = "translationCache_v1";

const BOX_INTERVALS_MS = {
  1: 1  * 24 * 60 * 60 * 1000,
  2: 3  * 24 * 60 * 60 * 1000,
  3: 24 * 24 * 60 * 60 * 1000,
  4: 36 * 24 * 60 * 60 * 1000,
  5: 72 * 24 * 60 * 60 * 1000
};

let srs = {};

function loadSRS() {
  try {
    const raw = localStorage.getItem(SRS_KEY);
    srs = raw ? JSON.parse(raw) : {};
  } catch {
    srs = {};
  }
}

function saveSRS() {
  localStorage.setItem(SRS_KEY, JSON.stringify(srs));
}

function ensureSrsEntry(en) {
  if (!srs[en]) {
    srs[en] = {
      box: 1,
      due: 0,
      seen: 0,
      correct: 0,
      wrong: 0,
      lastSeen: 0,
      lastResult: ""
    };
  }
  return srs[en];
}

function formatDue(ts) {
  if (!ts) return "agora";
  const d = new Date(ts);
  return d.toLocaleString("pt-BR");
}

function setDueForBox(entry) {
  const now = Date.now();
  const interval = BOX_INTERVALS_MS[entry.box] || BOX_INTERVALS_MS[1];
  entry.due = now + interval;
}

function applyResult(en, isCorrect) {
  const entry = ensureSrsEntry(en);
  const now = Date.now();

  entry.lastSeen = now;
  entry.lastResult = isCorrect ? "acerto" : "erro";

  if (isCorrect) {
    entry.correct += 1;
    entry.box = Math.min(5, entry.box + 1);
    setDueForBox(entry);
  } else {
    entry.wrong += 1;
    entry.box = 1;
    entry.due = now;
    scheduleRepeatSoon(en);
  }

  saveSRS();
  renderSrsStats();
}

function scheduleRepeatSoon(en) {
  const found = repeatSoon.find(x => x.key === en);
  if (found) {
    found.remaining = Math.min(found.remaining, REPEAT_AFTER_N);
    return;
  }
  repeatSoon.push({ key: en, remaining: REPEAT_AFTER_N });
  saveRepeatSoon();
}

function tickRepeatSoonCounters() {
  repeatSoon.forEach(x => x.remaining = Math.max(0, x.remaining - 1));
  saveRepeatSoon();
}

function popRepeatIfReady() {
  const idx = repeatSoon.findIndex(x => x.remaining === 0);
  if (idx >= 0) {
    const item = repeatSoon.splice(idx, 1)[0];
    saveRepeatSoon();
    return item.key;
  }
  return null;
}

function loadRepeatSoon() {
  try {
    const raw = localStorage.getItem("repeatSoon_v1");
    repeatSoon = raw ? JSON.parse(raw) : [];
  } catch {
    repeatSoon = [];
  }
}

function saveRepeatSoon() {
  localStorage.setItem("repeatSoon_v1", JSON.stringify(repeatSoon));
}

function getCardByEn(en) {
  return sentences.find(s => s.en === en) || null;
}

function pickNextCard(forceReviewOnly = false) {
  tickRepeatSoonCounters();

  const repeatKey = popRepeatIfReady();
  if (repeatKey) {
    const c = getCardByEn(repeatKey);
    if (c) return c;
  }

  const now = Date.now();
  sentences.forEach(s => ensureSrsEntry(s.en));

  const dueCards = sentences
    .filter(s => (srs[s.en]?.due || 0) <= now && (srs[s.en]?.seen || 0) > 0)
    .sort((a,b) => {
      const ea = srs[a.en], eb = srs[b.en];
      if (ea.box !== eb.box) return ea.box - eb.box;
      return (ea.lastSeen || 0) - (eb.lastSeen || 0);
    });

  if (dueCards.length > 0) return dueCards[0];

  if (!forceReviewOnly) {
    const newCards = sentences
      .filter(s => (srs[s.en]?.seen || 0) === 0)
      .sort(() => 0.5 - Math.random());

    if (newCards.length > 0) return newCards[0];
  }

  const any = sentences
    .slice()
    .sort((a,b) => (srs[a.en]?.due || 0) - (srs[b.en]?.due || 0));

  return any.length ? any[0] : null;
}

function markCardShown(en) {
  const entry = ensureSrsEntry(en);
  entry.seen += 1;
  entry.lastSeen = Date.now();
  saveSRS();
  renderSrsStats();
}

// =========================
// HISTÓRICO / CONTADORES
// =========================
function loadMadeCount() {
  const stored = localStorage.getItem('madeCount');
  madeCount = stored ? parseInt(stored) : 0;
  document.getElementById('madeCountLabel').textContent = madeCount;
}

function saveMadeCount() {
  localStorage.setItem('madeCount', madeCount);
}

function incrementMadeCount() {
  madeCount++;
  saveMadeCount();
  const el = document.getElementById('madeCountLabel');
  el.textContent = madeCount;
  el.classList.remove('counter-pop');
  void el.offsetWidth;
  el.classList.add('counter-pop');
}

function renderSidebarHistory() {
  document.getElementById("score").textContent = "Frases vistas: " + history.length;
  const ul = document.getElementById("history");
  ul.innerHTML = "";
  history.slice().reverse().forEach(item => {
    const li = document.createElement("li");
    li.textContent = `${item.en} | ${item.pt || ""}`;
    ul.appendChild(li);
  });
}

function saveHistory(en, pt) {
  history.push({ en, pt });
  localStorage.setItem('history', JSON.stringify(history));
  renderSidebarHistory();
}

function speak(txt, lang = 'en-US', rate = 1) {
  const utter = new SpeechSynthesisUtterance(txt);
  utter.lang = lang;
  utter.rate = rate;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

function speakQueued(txt, lang = 'en-US', rate = 1) {
  return new Promise((resolve) => {
    try {
      const utter = new SpeechSynthesisUtterance(txt);
      utter.lang = lang;
      utter.rate = rate;
      utter.onend = () => resolve(true);
      utter.onerror = () => resolve(false);
      window.speechSynthesis.speak(utter);
    } catch {
      resolve(false);
    }
  });
}

function loadAutoReadMode() {
  autoReadMode = localStorage.getItem(AUTO_READ_KEY) === '1';
}

function saveAutoReadMode() {
  localStorage.setItem(AUTO_READ_KEY, autoReadMode ? '1' : '0');
}


function loadWalkMode() {
  walkMode = localStorage.getItem(WALK_MODE_KEY) === '1';
}

function saveWalkMode() {
  localStorage.setItem(WALK_MODE_KEY, walkMode ? '1' : '0');
}

function updateWalkStatus(message = '') {
  const box = document.getElementById('walkStatus');
  if (!box) return;
  box.style.display = sentences.length ? 'block' : 'none';
  if (message) {
    box.innerHTML = message;
    return;
  }
  if (walkMode) {
    box.innerHTML = wakeLockSentinel
      ? '<strong>Modo Caminhada ativo.</strong> Leitura contínua ligada, tela mantida acordada e áudio de fundo ativo para funcionar com tela desligada.'
      : '<strong>Modo Caminhada ativo.</strong> Leitura contínua ligada com áudio de fundo para manter ativo mesmo com outras telas sobrepostas.';
  } else {
    box.innerHTML = 'Modo Caminhada pronto. Tela escura, leitura contínua e tentativa de manter a tela ativa.';
  }
}

function updateWalkModeButton() {
  const btn = document.getElementById('walkModeBtn');
  if (!btn) return;
  btn.innerHTML = walkMode
    ? '<i class="fa fa-stop-circle"></i> Parar caminhada'
    : '<i class="fa fa-walking"></i> Modo Caminhada';
  btn.classList.toggle('walk-active', walkMode);
  btn.classList.toggle('btn-active-mode', false);
  document.body.classList.toggle('walk-mode', walkMode);
  updateWalkStatus();
}

async function requestWakeLock() {
  if (!('wakeLock' in navigator) || !navigator.wakeLock?.request) {
    wakeLockSentinel = null;
    updateWalkStatus('<strong>Modo Caminhada ativo.</strong> Leitura contínua ligada com áudio de fundo. Wake Lock não disponível neste navegador.');
    return false;
  }
  try {
    wakeLockSentinel = await navigator.wakeLock.request('screen');
    wakeLockSentinel.addEventListener('release', () => {
      wakeLockSentinel = null;
      if (walkMode) {
        // Tenta re-adquirir automaticamente
        setTimeout(() => {
          if (walkMode && document.visibilityState === 'visible') {
            requestWakeLock();
          }
        }, 1000);
      }
    });
    updateWalkStatus();
    return true;
  } catch (err) {
    wakeLockSentinel = null;
    updateWalkStatus('<strong>Modo Caminhada ativo.</strong> Áudio de fundo ativo. O navegador não concedeu Wake Lock agora.');
    return false;
  }
}

async function releaseWakeLock() {
  try {
    if (wakeLockSentinel) {
      await wakeLockSentinel.release();
    }
  } catch {}
  wakeLockSentinel = null;
}

// ═══════════════════════════════════════════════
// NOSLEEP — Áudio silencioso para manter o browser ativo
// com tela desligada ou telas sobrepostas
// ═══════════════════════════════════════════════
let noSleepAudio = null;
let noSleepInterval = null;

function createNoSleepAudio() {
  if (noSleepAudio) return;

  // Cria um AudioContext e gera um tom silencioso (volume quase zero)
  // Isso mantém a sessão de áudio do browser ativa
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    // Volume praticamente inaudível
    gainNode.gain.value = 0.001;
    oscillator.frequency.value = 1; // 1 Hz — abaixo do limiar de audição
    oscillator.type = 'sine';

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.start();

    noSleepAudio = { ctx, oscillator, gainNode };
  } catch (e) {
    // Fallback: cria um elemento <audio> com loop
    try {
      const audio = document.createElement('audio');
      audio.setAttribute('loop', '');
      audio.setAttribute('playsinline', '');
      // Cria um WAV silencioso mínimo em base64 (44 bytes)
      const silentWav = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
      audio.src = silentWav;
      audio.volume = 0.01;
      audio.play().catch(() => {});
      noSleepAudio = { element: audio };
    } catch {}
  }
}

function startNoSleep() {
  createNoSleepAudio();

  // Também usa um intervalo para fazer "heartbeats" que mantêm o JS ativo
  if (noSleepInterval) clearInterval(noSleepInterval);
  noSleepInterval = setInterval(() => {
    // Heartbeat: checa se o speechSynthesis travou e reinicia se necessário
    if (walkMode && autoReadMode) {
      // Em alguns browsers, speechSynthesis pausa em background
      // Fazemos resume para reativar
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    }
  }, 5000);
}

function stopNoSleep() {
  if (noSleepAudio) {
    if (noSleepAudio.ctx) {
      try {
        noSleepAudio.oscillator.stop();
        noSleepAudio.ctx.close();
      } catch {}
    }
    if (noSleepAudio.element) {
      try {
        noSleepAudio.element.pause();
        noSleepAudio.element.src = '';
      } catch {}
    }
    noSleepAudio = null;
  }
  if (noSleepInterval) {
    clearInterval(noSleepInterval);
    noSleepInterval = null;
  }
}

// ═══════════════════════════════════════════════
// speechSynthesis bug fix: Chrome pausa em background
// ═══════════════════════════════════════════════
let speechResumeInterval = null;

function startSpeechResumer() {
  if (speechResumeInterval) return;
  // Chrome tem um bug: speechSynthesis pausa automaticamente após ~15s em background
  // O workaround é chamar resume() periodicamente
  speechResumeInterval = setInterval(() => {
    if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
      // Tudo OK
    } else if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
  }, 3000);
}

function stopSpeechResumer() {
  if (speechResumeInterval) {
    clearInterval(speechResumeInterval);
    speechResumeInterval = null;
  }
}

async function toggleWalkMode() {
  walkMode = !walkMode;
  saveWalkMode();
  if (walkMode) {
    if (!autoReadMode) {
      autoReadMode = true;
      saveAutoReadMode();
      autoReadToken += 1;
      updateAutoReadButton();
    }
    updateWalkModeButton();
    await requestWakeLock();
    startNoSleep();
    startSpeechResumer();
    const statusEl = document.getElementById('speechStatus');
    if (statusEl) statusEl.textContent = 'Modo Caminhada ativo: leitura contínua com tela escura. Funciona em background.';
    if (currentCard) playGuidedReading(currentCard);
  } else {
    await releaseWakeLock();
    stopNoSleep();
    stopSpeechResumer();
    autoReadMode = false;
    saveAutoReadMode();
    autoReadToken += 1;
    updateAutoReadButton();
    window.speechSynthesis.cancel();
    const statusEl = document.getElementById('speechStatus');
    if (statusEl) statusEl.textContent = 'Modo Caminhada desligado.';
    updateWalkModeButton();
  }
}

function updateAutoReadButton() {
  const btn = document.getElementById('autoReadBtn');
  if (!btn) return;
  btn.innerHTML = autoReadMode
    ? '<i class="fa fa-stop"></i> Parar leitura'
    : '<i class="fa fa-book-open"></i> Leitura guiada';
  btn.classList.toggle('btn-active-mode', autoReadMode);
}

async function getPtTranslationForCard(card) {
  const en = card?.en || textEn || '';
  if (!en) return 'Tradução indisponível';

  if (card?.pt && card.pt.trim()) return card.pt.trim();
  if (textPt && en === textEn && textPt.trim()) return textPt.trim();

  const cached = translationCache[en];
  if (cached && cached.trim()) return cached.trim();

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=pt&dt=t&q=${encodeURIComponent(en)}`;
    const res = await fetch(url);
    const data = await res.json();
    const pt = data?.[0]?.[0]?.[0] || 'Tradução indisponível';
    translationCache[en] = pt;
    localStorage.setItem(TRANSLATION_KEY, JSON.stringify(translationCache));
    return pt;
  } catch {
    return 'Tradução indisponível';
  }
}

async function getPtTranslationForCurrentCard() {
  const pt = await getPtTranslationForCard(currentCard || { en: textEn, pt: textPt });
  textPt = pt;
  return pt;
}

function pickSequentialAutoReadCard(step = 1) {
  if (!sentences.length) return null;

  if (favoriteMode && favorites.length) {
    const pool = sentences.filter(s => favorites.includes(s.en));
    if (!pool.length) return null;
    const pos = Math.max(0, pool.findIndex(s => s.en === (currentCard?.en || textEn)));
    return pool[(pos + step + pool.length) % pool.length];
  }

  if (trainMode === "worst") {
    return pickWorstCard(false);
  }

  if (newOnlyMode) {
    const c = pickNewOnlyCard(step);
    if (c) return c;
  }

  const len = sentences.length;
  const start = currentCardIndex >= 0 ? currentCardIndex : 0;
  const nextIndex = ((start + step) % len + len) % len;
  return sentences[nextIndex];
}

async function playGuidedReading(card = currentCard) {
  if (!card || !card.en) return;
  const token = autoReadToken;
  const pt = await getPtTranslationForCard(card);
  if (token !== autoReadToken || !autoReadMode) return;

  window.speechSynthesis.cancel();
  await speakQueued(card.en, 'en-US', 0.98);
  if (token !== autoReadToken || !autoReadMode) return;
  await speakQueued(card.en, 'en-US', 0.94);
  if (token !== autoReadToken || !autoReadMode) return;
  await speakQueued(pt || 'Tradução indisponível', 'pt-BR', 1.02);
  if (token !== autoReadToken || !autoReadMode) return;
  await speakQueued(card.en, 'en-US', 0.96);
  if (token !== autoReadToken || !autoReadMode) return;
  await new Promise(resolve => setTimeout(resolve, 450));
  if (token !== autoReadToken || !autoReadMode) return;

  const nextCard = pickSequentialAutoReadCard(1);
  if (!nextCard || nextCard.en === card.en) {
    autoReadToken += 1;
    setTimeout(() => playGuidedReading(card), 200);
    return;
  }

  loadSentence(nextCard);
}

async function toggleAutoReadMode() {
  autoReadMode = !autoReadMode;
  saveAutoReadMode();
  autoReadToken += 1;
  if (!autoReadMode && walkMode) {
    walkMode = false;
    saveWalkMode();
    await releaseWakeLock();
    stopNoSleep();
    stopSpeechResumer();
    updateWalkModeButton();
  }
  updateAutoReadButton();
  const el = document.getElementById('speechStatus');
  if (el) {
    el.textContent = autoReadMode
      ? 'Leitura guiada contínua ativa: 2x em inglês, 1x em português e 1x em inglês até você parar.'
      : 'Leitura guiada desligada.';
  }
  if (autoReadMode && currentCard) {
    if (walkMode) {
      await requestWakeLock();
      startNoSleep();
      startSpeechResumer();
    }
    playGuidedReading(currentCard);
  } else {
    window.speechSynthesis.cancel();
  }
}


document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && walkMode) {
    await requestWakeLock();
    // Re-resume speechSynthesis caso tenha pausado
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
  }
});

window.addEventListener('beforeunload', () => {
  try {
    window.speechSynthesis.cancel();
    stopNoSleep();
    stopSpeechResumer();
  } catch {}
});

// =========================
// TRADUÇÃO: SEM BUG
// =========================

function setPlayAudioHandlers() {
  document.getElementById("playAudioEn").onclick = () => speak(textEn, "en-US", 1);
  document.getElementById("playAudioPt").onclick = async () => {
    const pt = await getPtTranslationForCurrentCard();
    speak(pt, "pt-BR", 1.1);
  };
}

// =========================
// PARSER TXT
// =========================
function parseTxtToSentences(txt) {
  txt = txt.replace(/^\uFEFF/, '');
  const lines = txt.split(/\r?\n/).map(x => x.trim()).filter(Boolean);

  const parsed = [];
  for (const line of lines) {
    const partsPipe = line.split(" | ");
    if (partsPipe.length >= 2) {
      const en = partsPipe[0].trim();
      const pt = partsPipe.slice(1).join(" | ").trim();
      if (en) parsed.push({ en, pt });
      continue;
    }

    const partsTab = line.split("\t");
    if (partsTab.length >= 2) {
      const en = partsTab[0].trim();
      const pt = partsTab.slice(1).join("\t").trim();
      if (en) parsed.push({ en, pt });
      continue;
    }

    parsed.push({ en: line, pt: "" });
  }

  const seen = new Set();
  const unique = [];
  for (const s of parsed) {
    if (!s.en) continue;
    if (seen.has(s.en)) continue;
    seen.add(s.en);
    unique.push(s);
  }

  return unique;
}

function persistSentences() {
  localStorage.setItem(SENTENCES_KEY, JSON.stringify(sentences));
}

function loadPersistedSentences() {
  const raw = localStorage.getItem(SENTENCES_KEY);
  if (!raw) return null;

  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length && typeof arr[0] === "string") {
      return arr.map(x => ({ en: x, pt: "" }));
    }
    if (Array.isArray(arr)) return arr;
  } catch {}

  return null;
}

// =========================
// UI: STATUS / STATS
// =========================
function renderStatusLine(en) {
  const entry = srs[en];
  const line = document.getElementById("statusLine");
  if (!entry) { line.style.display = "none"; return; }

  line.style.display = "inline-block";

  const boxEl = document.getElementById("statusBox");
  const dueEl = document.getElementById("statusDue");
  const repEl = document.getElementById("statusRepeat");
  const modeEl = document.getElementById("statusMode");

  boxEl.innerHTML = `Caixa <span class="pill">${entry.box}</span>`;
  dueEl.innerHTML = ` <span class="muted">Próxima revisão:</span> ${formatDue(entry.due)}`;

  const inRepeat = repeatSoon.find(x => x.key === en);
  if (inRepeat) {
    repEl.innerHTML = ` <span class="pill">Repetição rápida em ${inRepeat.remaining} frase(s)</span>`;
  } else {
    repEl.innerHTML = "";
  }

  const pills = [];
  if (trainMode === "worst") {
    pills.push(`<span class="pill">Modo piores frases</span>`);
  }
  if (newOnlyMode && trainMode !== "worst") {
    pills.push(`<span class="pill">Modo novas (ignora dívida)</span>`);
  }
  modeEl.innerHTML = pills.length ? (" " + pills.join(" ")) : "";
}

function renderSrsStats() {
  if (!sentences.length) {
    document.getElementById("srsStats").textContent = "Carregue um TXT para começar.";
    return;
  }
  const now = Date.now();

  let newCount = 0, dueCount = 0, learningCount = 0;
  for (const s of sentences) {
    const e = ensureSrsEntry(s.en);
    if ((e.seen || 0) === 0) newCount++;
    else {
      learningCount++;
      if ((e.due || 0) <= now) dueCount++;
    }
  }

  const repeatReady = repeatSoon.filter(x => x.remaining === 0).length;
  const repeatPending = repeatSoon.length;

  document.getElementById("srsStats").innerHTML =
    `Novas: <b>${newCount}</b><br>` +
    `Em estudo: <b>${learningCount}</b><br>` +
    `Devidas agora: <b>${dueCount}</b><br>` +
    `Repetição rápida: <b>${repeatPending}</b>` +
    (repeatReady ? ` (prontas: <b>${repeatReady}</b>)` : "");

  if (newOnlyMode && trainMode !== "worst") {
    document.getElementById("srsStats").innerHTML +=
      "<br><span style='color: var(--grey-txt); font-weight: 600;'>Modo novas ativo: o botão Próxima Frase ignora revisões devidas (dívida do dia/acumulada).</span>";
  }
}

// =========================
// ANÁLISE DE ERROS (PAINEL)
// =========================
function buildTable(rows, headers) {
  if (!rows.length) return "<div class='small'>Sem dados ainda. Faça algumas tentativas e erre de propósito para capturar.</div>";

  let html = "<table><thead><tr>";
  for (const h of headers) html += `<th>${h}</th>`;
  html += "</tr></thead><tbody>";

  for (const r of rows) {
    html += "<tr>";
    for (const cell of r) html += `<td>${cell}</td>`;
    html += "</tr>";
  }
  html += "</tbody></table>";
  return html;
}

function refreshErrorAnalysis() {
  const attemptLog = loadAttemptLog();
  const eventLog = loadErrorEventLog();

  const typeCounts = {};
  for (const ev of eventLog) {
    typeCounts[ev.type] = (typeCounts[ev.type] || 0) + 1;
  }
  const typeRows = Object.entries(typeCounts)
    .sort((a,b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t,c]) => [t, String(c)]);
  document.getElementById("errorTypeTable").innerHTML = buildTable(typeRows, ["Tipo", "Qtd"]);

  const phraseCounts = {};
  for (const a of attemptLog) {
    if (!a || !a.en) continue;
    if (!a.hadAnyError) continue;
    phraseCounts[a.en] = (phraseCounts[a.en] || 0) + (a.errorCount || 1);
  }
  const phraseRows = Object.entries(phraseCounts)
    .sort((a,b) => b[1] - a[1])
    .slice(0, 6)
    .map(([en,c]) => [en, String(c)]);
  document.getElementById("errorPhraseTable").innerHTML = buildTable(phraseRows, ["Frase (EN)", "Erros"]);

  const wordCounts = {};
  for (const ev of eventLog) {
    const w = (ev.expected || "").toLowerCase();
    if (!w) continue;
    wordCounts[w] = (wordCounts[w] || 0) + 1;
  }
  const wordRows = Object.entries(wordCounts)
    .sort((a,b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w,c]) => [w, String(c)]);
  document.getElementById("errorWordTable").innerHTML = buildTable(wordRows, ["Palavra esperada", "Qtd"]);

  const totalAttempts = attemptLog.length;
  const attemptsWithError = attemptLog.filter(x => x && x.hadAnyError).length;
  const totalEvents = eventLog.length;

  const summary = document.getElementById("errorSummaryPanel");
  const info = document.createElement("div");
  info.style.marginTop = "10px";
  info.className = "small dynamic";
  info.textContent = `Tentativas: ${totalAttempts} | Tentativas com erro: ${attemptsWithError} | Eventos de erro: ${totalEvents}`;

  const old = summary.querySelector(".small.dynamic");
  if (old) old.remove();
  summary.appendChild(info);
}

function resetErrorStats() {
  localStorage.removeItem(ATTEMPT_LOG_KEY);
  localStorage.removeItem(ERROR_EVENT_LOG_KEY);
  localStorage.removeItem(WORST_LIST_KEY);
  worstList = [];
  worstPointer = 0;
  saveTrainMode();
  refreshErrorAnalysis();
}

// =========================
// CARREGAR E MOSTRAR FRASE
// =========================
function loadSentence(card) {
  if (!card) return;

  window.speechSynthesis.cancel();

  currentCard = card;
  textEn = card.en;

  currentCardIndex = sentences.findIndex(s => s.en === card.en);
  if (currentCardIndex < 0) currentCardIndex = 0;
  seqPointer = currentCardIndex;
  saveNewOnlyMode();

  revealClickedThisCard = false;
  isAutoSkipping = false;
  autoAdvanceToken += 1;

  textPt = (card.pt || "");
  currentWords = textEn.split(" ").filter(Boolean);

  cardHadError = false;
  attemptErrorEvents = [];

  document.getElementById("sentenceEn").textContent = "";
  document.getElementById("sentencePt").textContent = "";
  document.getElementById("feedback").style.display = "none";

  setupBoard();
  setPlayAudioHandlers();
  renderSpeechPanel();
  renderPatternPanel(textEn);
  renderPrediction();
  renderMission();
  renderBrCoach();
  updateFavoriteButton();
  updateAutoReadButton();
  updateWalkModeButton();

  if (autoReadMode) {
    autoReadToken += 1;
    setTimeout(() => playGuidedReading(card), 200);
  } else {
    setTimeout(() => speak(textEn, "en-US", 1), 200);
  }

  markCardShown(textEn);
  localStorage.setItem(CURRENT_KEY, textEn);

  renderStatusLine(textEn);
}

function setupBoard() {
  const slots = document.getElementById("slots"), bank = document.getElementById("word-bank");
  slots.innerHTML = "";
  bank.innerHTML = "";

  currentWords.forEach((_, i) => {
    const slot = document.createElement("div");
    slot.className = "slot";
    slot.dataset.index = i;

    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "i";
    hint.title = "Dica";
    hint.onclick = () => {
      const w = currentWords[i] || "";
      if (!w) return;
      hint.title = `Dica: começa com "${w.substring(0,1)}"`;
    };
    slot.appendChild(hint);

    slot.ondragover = e => e.preventDefault();
    slot.ondrop = () => {
      if (!dragged) return;

      const idx = parseInt(slot.dataset.index, 10);
      const correctWord = currentWords[idx];

      if (dragged.textContent === correctWord) {
        if (slot.querySelector(".word")) bank.appendChild(slot.querySelector(".word"));
        slot.appendChild(dragged);
        checkComplete();
      } else {
        cardHadError = true;
        logErrorEvent(correctWord, dragged.textContent, idx);

        dragged.classList.add("incorrect");
        setTimeout(() => dragged.classList.remove("incorrect"), 500);

        maybeAutoSkipOnStuck();
      }
    };

    slots.appendChild(slot);
  });

  [...currentWords]
    .sort(() => 0.5 - Math.random())
    .forEach(w => {
      const el = document.createElement("div");
      el.className = "word";
      el.textContent = w;
      el.draggable = true;
      el.ondragstart = () => dragged = el;
      bank.appendChild(el);
    });
}

function checkComplete() {
  const slots = [...document.querySelectorAll(".slot")];
  if (!slots.every(s => s.querySelector(".word"))) return;

  incrementMadeCount();

  const isCorrect = !cardHadError;
  lastAttemptWasIncorrect = !isCorrect;
  applyResult(textEn, isCorrect);

  saveAttemptRecord(isCorrect);

  document.getElementById("sentenceEn").innerHTML = `
    <span id="copyEnText" style="color: var(--blue-1); font-weight: bold;">EN: ${textEn}</span>
    <button class="copy-btn" onclick="copyText('copyEnText')" title="Copiar">Copiar</button>
    <span class="pill">${isCorrect ? "Acerto" : "Erro"}</span>
  `;

  document.getElementById("feedback").style.display = "block";

  document.getElementById("revealBtn").onclick = async () => {
    revealClickedThisCard = true;
    autoAdvanceToken += 1;

    document.getElementById("revealBtn").disabled = true;

    const pt = await getPtTranslationForCurrentCard();

    document.getElementById("sentencePt").innerHTML = `
      <span id="copyPtText" style="color: var(--blue-1); font-weight: bold;">PT: ${pt}</span>
      <button class="copy-btn" onclick="copyText('copyPtText')" title="Copiar">Copiar</button>
    `;

    saveHistory(textEn, pt);

    document.getElementById("revealBtn").disabled = false;
  };

  renderStatusLine(textEn);
  refreshErrorAnalysis();

  if (trainMode === "worst") {
    refreshWorstListIfNeeded();
  }
}

// =========================
// MODO FALA + MODO BLOCOS + MOTOR PREDITIVO
// =========================
const APP_PREF_KEY = "appPrefs_v2";
const FAVORITES_KEY = "favoritePhrases_v1";
const MIC_PREF_KEY = "micPermission_v1";
const AUTO_READ_KEY = "autoReadMode_v1";
const WALK_MODE_KEY = "walkMode_v1";
let appPrefs = { speakMode: false, patternMode: true };
let speechRecognition = null;
let speechSupported = false;
let favorites = [];
let favoriteMode = false;
let micPermissionGranted = false;
let micStream = null;
let autoReadMode = false;
let autoReadToken = 0;
let walkMode = false;
let wakeLockSentinel = null;

function loadAppPrefs() {
  try {
    const raw = localStorage.getItem(APP_PREF_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      appPrefs = { ...appPrefs, ...parsed };
    }
  } catch {}
}

function saveAppPrefs() {
  localStorage.setItem(APP_PREF_KEY, JSON.stringify(appPrefs));
}


function loadFavorites() {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    favorites = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(favorites)) favorites = [];
  } catch {
    favorites = [];
  }
}

function saveFavorites() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
}

function isFavoritePhrase(en) {
  return favorites.includes(en);
}

function toggleFavoriteCurrent() {
  if (!textEn) return;
  if (isFavoritePhrase(textEn)) favorites = favorites.filter(x => x !== textEn);
  else favorites.push(textEn);
  saveFavorites();
  updateFavoriteButton();
  renderFavoritesPanel();
}

function updateFavoriteButton() {
  const btn = document.getElementById('favoriteBtn');
  if (!btn) return;
  const active = !!textEn && isFavoritePhrase(textEn);
  btn.innerHTML = active
    ? '<i class="fa fa-star"></i> Marcada!'
    : '<i class="fa fa-star"></i> Marcar frase';
  btn.classList.toggle('favorite-btn-active', active);
}

function renderFavoritesPanel() {
  const box = document.getElementById('favoritesBox');
  if (!box) return;
  if (!favorites.length) {
    box.innerHTML = 'Nenhuma frase marcada ainda.';
    return;
  }
  const rows = favorites.slice(0, 8).map((f, i) => `${i+1}. ${f}`);
  const rest = favorites.length > 8 ? `<br>... e mais ${favorites.length - 8}.` : '';
  box.innerHTML = `Marcadas: <b>${favorites.length}</b><br>${rows.join('<br>')}${rest}`;
}

async function ensureMicPermission(forceAsk = false) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const el = document.getElementById('speechStatus');
    if (el) el.textContent = 'Seu navegador não expõe getUserMedia para autorizar microfone.';
    return false;
  }

  if (micPermissionGranted && !forceAsk) return true;

  try {
    if (!forceAsk && navigator.permissions && navigator.permissions.query) {
      const result = await navigator.permissions.query({ name: 'microphone' });
      if (result.state === 'granted') {
        micPermissionGranted = true;
        localStorage.setItem(MIC_PREF_KEY, '1');
        const el = document.getElementById('speechStatus');
        if (el) el.textContent = 'Microfone já autorizado para este site.';
        return true;
      }
    }
  } catch {}

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micPermissionGranted = true;
    localStorage.setItem(MIC_PREF_KEY, '1');
    const el = document.getElementById('speechStatus');
    if (el) el.textContent = 'Microfone autorizado para este site.';
    if (micStream) {
      micStream.getTracks().forEach(t => t.stop());
      micStream = null;
    }
    return true;
  } catch (err) {
    const el = document.getElementById('speechStatus');
    if (el) el.textContent = 'Microfone não autorizado: ' + (err?.message || 'permita o acesso no navegador');
    return false;
  }
}

function initSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  speechSupported = !!SR;
  if (!SR) return;
  speechRecognition = new SR();
  speechRecognition.lang = 'en-US';
  speechRecognition.interimResults = false;
  speechRecognition.maxAlternatives = 1;

  speechRecognition.onstart = () => {
    const el = document.getElementById('speechStatus');
    if (el) el.textContent = 'Ouvindo... fale a frase em inglês.';
  };

  speechRecognition.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript || '';
    renderSpeechResult(transcript);
  };

  speechRecognition.onerror = (event) => {
    const el = document.getElementById('speechStatus');
    if (el) el.textContent = 'Falha no microfone: ' + (event.error || 'erro desconhecido');
  };

  speechRecognition.onend = () => {
    const el = document.getElementById('speechStatus');
    if (el && !el.textContent.includes('Pontuação')) {
      el.textContent = 'Microfone parado.';
    }
  };
}

function normalizeToken(t) {
  return String(t || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9' ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(t) {
  return normalizeToken(t).split(' ').filter(Boolean);
}

function buildPatternData(en) {
  const words = en.split(' ').filter(Boolean);
  const subjectHints = ['i','you','we','they','he','she','it'];
  const beHints = ['am','is','are','was','were'];
  const auxHints = ['do','does','did','will','can','should','would','could','have','has','had'];
  const lower = words.map(w => w.toLowerCase());
  let subject = words[0] || '';
  let verb = words[1] || '';
  let complement = words.slice(2).join(' ');

  if (lower.length >= 3 && subjectHints.includes(lower[0]) && (beHints.includes(lower[1]) || auxHints.includes(lower[1]) || lower[1].endsWith('ing'))) {
    subject = words[0];
    verb = words[1] + (words[2] ? ' ' + words[2] : '');
    complement = words.slice(3).join(' ');
  }

  const tips = [];
  if (subjectHints.includes((words[0] || '').toLowerCase())) {
    tips.push('Comece com sujeito curto: I, you, we.');
  } else {
    tips.push('Ache primeiro quem faz a ação.');
  }
  if (/to/.test(' ' + lower.join(' ') + ' ')) tips.push('Quando aparecer to, pense em direção, objetivo ou infinitivo.');
  if (lower.some(w => w.endsWith('ing'))) tips.push('Verbo com ing costuma indicar ação em andamento ou função de atividade.');
  if (lower.some(w => ['do','does','did'].includes(w))) tips.push('Do/does/did ajudam pergunta, negação e ênfase.');

  return {
    subject,
    verb,
    complement,
    frame: [subject || 'Sujeito', verb || 'Verbo', complement || 'Complemento'],
    tips
  };
}

function renderPatternPanel(en) {
  const panel = document.getElementById('patternPanel');
  if (!panel) return;
  panel.style.display = appPrefs.patternMode ? 'block' : 'none';
  if (!appPrefs.patternMode || !en) return;

  const data = buildPatternData(en);
  document.getElementById('patternFrame').innerHTML =
    '<b>Estrutura prevista:</b><br>' +
    '1. ' + (data.frame[0] || '-') + '<br>' +
    '2. ' + (data.frame[1] || '-') + '<br>' +
    '3. ' + (data.frame[2] || '-');
  document.getElementById('patternTips').innerHTML = data.tips.map(t => '• ' + t).join('<br>');
  renderVariation(en);
}

function renderVariation(en) {
  const box = document.getElementById('variationBox');
  if (!box) return;
  const data = buildPatternData(en);
  const subject = data.subject || 'I';
  const verb = data.verb || 'need';
  const complement = data.complement || 'more practice';
  const variation = `${subject} really ${verb} ${complement}`.replace(/\s+/g, ' ').trim();
  const pt = 'Variação de treino para sair do engessado.';
  box.innerHTML = `<b>Variação:</b> ${variation}<br><span class="small">${pt}</span>`;
}

function evaluateSpeech(target, spoken) {
  const targetTokens = tokenize(target);
  const spokenTokens = tokenize(spoken);
  if (!targetTokens.length) return {score: 0, matched: [], missing: [], extra: spokenTokens};

  const targetSet = new Set(targetTokens);
  const spokenSet = new Set(spokenTokens);
  const matched = targetTokens.filter(t => spokenSet.has(t));
  const missing = targetTokens.filter(t => !spokenSet.has(t));
  const extra = spokenTokens.filter(t => !targetSet.has(t));
  const score = Math.round((matched.length / targetTokens.length) * 100);
  return { score, matched, missing, extra };
}

function renderSpeechResult(transcript) {
  const heard = document.getElementById('speechHeard');
  const evalBox = document.getElementById('speechEval');
  const status = document.getElementById('speechStatus');

  const result = evaluateSpeech(textEn, transcript);
  const spokenTokens = tokenize(transcript);
  const expectedTokens = tokenize(textEn);
  const expectedSet = new Set(expectedTokens);
  const spokenHtml = spokenTokens.length
    ? spokenTokens.map(t => expectedSet.has(t)
        ? `<span class="mark-green">${t}</span>`
        : `<span class="mark-red">${t}</span>`).join(' ')
    : '(vazio)';

  if (heard) heard.innerHTML = `<b>Você disse:</b> ${spokenHtml}`;
  if (status) status.textContent = `Pontuação de aproximação: ${result.score}%`;
  if (evalBox) {
    evalBox.innerHTML =
      `<b>Acertos:</b> ${result.matched.join(', ') || '-'}<br>` +
      `<b>Faltaram:</b> <span class="mark-red">${result.missing.join(', ') || '-'}</span><br>` +
      `<b>Sobraram:</b> <span class="mark-red">${result.extra.join(', ') || '-'}</span>`;
  }

  const entry = ensureSrsEntry(textEn);
  entry.lastSpeechScore = result.score;
  saveSRS();
  renderPrediction();
  renderMission();
}

function toggleSpeakMode() {
  appPrefs.speakMode = !appPrefs.speakMode;
  saveAppPrefs();
  updateModeButtons();
  renderSpeechPanel();
  renderPrediction();
}

function togglePatternMode() {
  appPrefs.patternMode = !appPrefs.patternMode;
  saveAppPrefs();
  updateModeButtons();
  renderPatternPanel(textEn);
  renderPrediction();
}

function updateModeButtons() {
  const speakBtn = document.getElementById('speakModeBtn');
  const patternBtn = document.getElementById('patternModeBtn');
  if (speakBtn) {
    speakBtn.innerHTML = appPrefs.speakMode
      ? '<i class="fa fa-microphone-slash"></i> Falar ativo'
      : '<i class="fa fa-microphone"></i> Modo falar';
    speakBtn.classList.toggle('btn-active-mode', !!appPrefs.speakMode);
  }
  if (patternBtn) {
    patternBtn.innerHTML = appPrefs.patternMode
      ? '<i class="fa fa-cubes"></i> Blocos ativo'
      : '<i class="fa fa-cubes"></i> Modo blocos';
    patternBtn.classList.toggle('btn-active-mode', !!appPrefs.patternMode);
  }
  updateAutoReadButton();
}

function renderSpeechPanel() {
  const panel = document.getElementById('speakLabPanel');
  if (!panel) return;
  panel.style.display = appPrefs.speakMode ? 'block' : 'none';
  const status = document.getElementById('speechStatus');
  if (status && appPrefs.speakMode && !speechSupported) {
    status.textContent = 'Seu navegador pode não suportar reconhecimento de fala nativo. Mesmo assim, o restante do app continua funcionando.';
  }
}

async function startSpeechCapture() {
  if (!speechSupported || !speechRecognition) {
    const el = document.getElementById('speechStatus');
    if (el) el.textContent = 'Reconhecimento de fala não disponível neste navegador.';
    return;
  }
  const ok = await ensureMicPermission(false);
  if (!ok) return;
  document.getElementById('speechHeard').innerHTML = '';
  document.getElementById('speechEval').innerHTML = '';
  speechRecognition.start();
}


function pickBestCard(pool) {
  if (!pool || !pool.length) return null;
  let best = pool[0];
  let bestScore = -1;
  pool.forEach(card => {
    const pred = getPredictionForCard(card.en);
    const score = pred ? pred.total : 0;
    if (score > bestScore) {
      best = card;
      bestScore = score;
    }
  });
  return best;
}

function getPredictionForCard(en) {
  if (!en) return null;
  const entry = ensureSrsEntry(en);
  const now = Date.now();
  const dueRisk = (entry.due || 0) <= now ? 30 : 0;
  const errorRisk = Math.min(30, (entry.wrong || 0) * 6);
  const noveltyRisk = (entry.seen || 0) === 0 ? 20 : 0;
  const speechRisk = appPrefs.speakMode ? Math.max(0, 20 - Math.floor((entry.lastSpeechScore || 0) / 5)) : 0;
  const total = Math.min(100, dueRisk + errorRisk + noveltyRisk + speechRisk);

  let action = 'Consolidar';
  if (speechRisk >= 12) action = 'Falar em voz alta';
  else if (errorRisk >= 18) action = 'Reconstruir por blocos';
  else if (dueRisk >= 30) action = 'Revisar agora';
  else if (noveltyRisk >= 20) action = 'Apresentar nova frase com apoio';

  return {
    total,
    action,
    dueRisk,
    errorRisk,
    noveltyRisk,
    speechRisk
  };
}

function renderPrediction() {
  const box = document.getElementById('predictionBox');
  if (!box || !textEn) return;
  const p = getPredictionForCard(textEn);
  if (!p) return;
  box.innerHTML =
    `<b>Próxima melhor ação:</b> ${p.action}<br>` +
    `Dificuldade prevista: <b>${p.total}%</b><br>` +
    `Revisão: ${p.dueRisk} | Erros: ${p.errorRisk} | Novidade: ${p.noveltyRisk} | Fala: ${p.speechRisk}`;
}

function renderMission() {
  const box = document.getElementById('missionBox');
  if (!box) return;
  if (!sentences.length) {
    box.textContent = 'Carregue frases para começar.';
    return;
  }
  const due = sentences.filter(s => (ensureSrsEntry(s.en).due || 0) <= Date.now() && (ensureSrsEntry(s.en).seen || 0) > 0).length;
  const newCount = sentences.filter(s => (ensureSrsEntry(s.en).seen || 0) === 0).length;
  const attempts = loadAttemptLog();
  const today = new Date().toDateString();
  const todayAttempts = attempts.filter(a => new Date(a.ts).toDateString() === today).length;
  box.innerHTML =
    `Hoje: <b>${todayAttempts}</b> tentativas<br>` +
    `Revisões vencidas: <b>${due}</b><br>` +
    `Frases novas: <b>${newCount}</b><br>` +
    `Meta sugerida: <b>${Math.min(12, Math.max(5, due + 3))}</b> frases.`;
}

function renderBrCoach() {
  const box = document.getElementById('brCoachBox');
  if (!box || !textEn) return;
  const lower = textEn.toLowerCase();
  const notes = [];
  if (/i/.test(lower)) notes.push('Quando começar com I, tente falar a frase inteira sem traduzir palavra por palavra.');
  if (/do|does|did/.test(lower)) notes.push('Se aparecer do, does ou did, pense em pergunta, negação ou reforço.');
  if (/the/.test(lower)) notes.push('The não precisa travar sua fala. Primeiro comunique, depois refine a pronúncia.');
  if (/ing/.test(lower)) notes.push('Verbo com ing costuma ser bom para treino oral porque cria ritmo.');
  if (!notes.length) notes.push('Estratégia prática: leia, monte, fale e só depois revele a tradução.');
  box.innerHTML = notes.join('<br>');
}

// =========================
// BOOT / RESTORE
// =========================
document.addEventListener('DOMContentLoaded', () => {
  // Histórico
  const savedHistory = localStorage.getItem('history');
  history = savedHistory ? JSON.parse(savedHistory) : [];
  renderSidebarHistory();

  // Contador
  loadMadeCount();

  // Cache tradução
  try {
    const tc = localStorage.getItem(TRANSLATION_KEY);
    translationCache = tc ? JSON.parse(tc) : {};
  } catch {
    translationCache = {};
  }

  loadSRS();
  loadRepeatSoon();

  loadTrainMode();
  updateTrainButtonUI();
  loadAppPrefs();
  loadFavorites();
  loadAutoReadMode();
  micPermissionGranted = localStorage.getItem(MIC_PREF_KEY) === "1";
  updateModeButtons();
  renderFavoritesPanel();
  initSpeechRecognition();

  loadNewOnlyMode();
  applyNewOnlyToggleUI();
  const newOnlyCb = document.getElementById("newOnlyToggle");
  if (newOnlyCb) {
    newOnlyCb.onchange = (e) => setNewOnlyMode(e.target.checked);
  }

  const persisted = loadPersistedSentences();
  if (persisted && persisted.length) {
    sentences = persisted;
    window._sentences = sentences;
    sentences.forEach(s => ensureSrsEntry(s.en));
    saveSRS();
    renderSrsStats();

    if (trainMode === "worst") {
      worstList = computeWorstList(30);
      worstPointer = 0;
      saveTrainMode();
    }

    const lastKey = localStorage.getItem(CURRENT_KEY);
    const lastCard = lastKey ? getCardByEn(lastKey) : null;

    let startCard = lastCard || null;
    if (!startCard) {
      startCard = pickCardForNavigation(false, 1);
    }

    loadWalkMode();
    loadSentence(startCard);

    document.getElementById("nextBtn").style.display = 'inline-block';
    document.getElementById("reviewNowBtn").style.display = 'inline-block';
    document.getElementById("trainWorstBtn").style.display = 'inline-block';
    document.getElementById("speakModeBtn").style.display = 'inline-block';
    document.getElementById("patternModeBtn").style.display = 'inline-block';
    document.getElementById("autoReadBtn").style.display = 'inline-block';
    document.getElementById("walkModeBtn").style.display = 'inline-block';
    document.getElementById("favoriteBtn").style.display = 'inline-block';
    document.getElementById("trainFavoritesBtn").style.display = 'inline-block';
    document.getElementById("clearBtn").style.display = 'inline-block';
    applyNewOnlyToggleUI();
  } else {
    renderSrsStats();
  }

  document.getElementById("refreshAnalysisBtn").onclick = refreshErrorAnalysis;
  document.getElementById("resetErrorsBtn").onclick = () => {
    if (confirm("Deseja zerar a estatística de erros?")) resetErrorStats();
  };

  document.getElementById("trainWorstBtn").onclick = () => {
    if (!sentences.length) return;

    if (trainMode === "normal") {
      refreshWorstListIfNeeded();

      if (!worstList.length) {
        alert("Ainda não há erros registrados. Faça algumas tentativas e erre algumas palavras para capturar estatística.");
        return;
      }

      setTrainMode("worst");
      const card = pickWorstCard(false);
      loadSentence(card);
    } else {
      setTrainMode("normal");
      const card = pickCardForNavigation(false, 1);
      loadSentence(card);
    }
  };

  document.getElementById("speakModeBtn").onclick = toggleSpeakMode;
  document.getElementById("patternModeBtn").onclick = togglePatternMode;
  document.getElementById("walkModeBtn").onclick = toggleWalkMode;
  document.getElementById("favoriteBtn").onclick = toggleFavoriteCurrent;
  document.getElementById("trainFavoritesBtn").onclick = () => {
    if (!favorites.length) {
      alert('Marque pelo menos uma frase para treinar depois.');
      return;
    }
    favoriteMode = !favoriteMode;
    const btn = document.getElementById('trainFavoritesBtn');
    if (btn) {
      btn.innerHTML = favoriteMode
        ? '<i class="fa fa-heart"></i> Treinando favoritas'
        : '<i class="fa fa-heart"></i> Treinar favoritas';
      btn.classList.toggle('btn-active-mode', favoriteMode);
    }
    const pool = sentences.filter(s => favorites.includes(s.en));
    const next = favoriteMode ? pickBestCard(pool) : pickCardForNavigation(false, 1);
    if (next) loadSentence(next);
  };
  document.getElementById("startRecBtn").onclick = startSpeechCapture;
  document.getElementById("retryRecBtn").onclick = startSpeechCapture;
  document.getElementById("micPermissionBtn").onclick = () => ensureMicPermission(true);
  document.getElementById("autoReadBtn").onclick = toggleAutoReadMode;
  document.getElementById("generateVariationBtn").onclick = () => renderVariation(textEn);

  refreshErrorAnalysis();
  renderMission();
  renderPrediction();
  renderBrCoach();
  renderSpeechPanel();
});

// =========================
// AÇÕES: ONLINE / TXT / PRÓXIMA / REVISAR
// =========================
document.getElementById("loadOnlineBtn").onclick = () => {
  fetch("https://raw.githubusercontent.com/andersonoab/aprenderIngles/refs/heads/main/frases_unicas_1000.txt")
    .then(res => res.text())
    .then(txt => {
      sentences = parseTxtToSentences(txt);
      window._sentences = sentences;

      sentences.forEach(s => ensureSrsEntry(s.en));
      saveSRS();

      persistSentences();
      renderSrsStats();

      if (trainMode === "worst") {
        refreshWorstListIfNeeded();
      }

      const next = pickCardForNavigation(false, 1);
      loadSentence(next);

      document.getElementById("nextBtn").style.display = "inline-block";
      document.getElementById("reviewNowBtn").style.display = "inline-block";
      document.getElementById("trainWorstBtn").style.display = "inline-block";
      document.getElementById("speakModeBtn").style.display = "inline-block";
      document.getElementById("patternModeBtn").style.display = "inline-block";
      document.getElementById("autoReadBtn").style.display = "inline-block";
      document.getElementById("walkModeBtn").style.display = "inline-block";
      document.getElementById("favoriteBtn").style.display = "inline-block";
      document.getElementById("trainFavoritesBtn").style.display = "inline-block";
      document.getElementById("clearBtn").style.display = "inline-block";
      applyNewOnlyToggleUI();
    });
};

document.getElementById("fileInput").onchange = function () {
  const file = this.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    const txt = e.target.result;
    sentences = parseTxtToSentences(txt);
    window._sentences = sentences;

    sentences.forEach(s => ensureSrsEntry(s.en));
    saveSRS();

    persistSentences();
    renderSrsStats();

    if (trainMode === "worst") {
      refreshWorstListIfNeeded();
    }

    const next = pickCardForNavigation(false, 1);
    loadSentence(next);

    document.getElementById("nextBtn").style.display = 'inline-block';
    document.getElementById("reviewNowBtn").style.display = 'inline-block';
    document.getElementById("trainWorstBtn").style.display = 'inline-block';
    document.getElementById("speakModeBtn").style.display = 'inline-block';
    document.getElementById("patternModeBtn").style.display = 'inline-block';
    document.getElementById("autoReadBtn").style.display = 'inline-block';
    document.getElementById("walkModeBtn").style.display = 'inline-block';
    document.getElementById("favoriteBtn").style.display = 'inline-block';
    document.getElementById("trainFavoritesBtn").style.display = 'inline-block';
    document.getElementById("clearBtn").style.display = 'inline-block';
    applyNewOnlyToggleUI();

    document.getElementById("fileInput").value = "";
  };

  reader.readAsText(file, "UTF-8");
};

function setSecondaryMenu(open) {
  const panel = document.getElementById('secondaryActions');
  const btn = document.getElementById('menuToggleBtn');
  panel.style.display = open ? 'grid' : 'none';
  btn.classList.toggle('menu-open', open);
  btn.innerHTML = open
    ? '<i class="fa fa-chevron-up"></i> Ocultar'
    : '<i class="fa fa-sliders-h"></i> Mais ações';
}

document.getElementById('menuToggleBtn').onclick = () => {
  const panel = document.getElementById('secondaryActions');
  setSecondaryMenu(panel.style.display === 'none');
};

document.getElementById("nextBtn").onclick = () => {
  if (!sentences.length) return;

  autoAdvanceToken += 1;
  const step = (lastAttemptWasIncorrect && newOnlyMode && trainMode !== "worst") ? SKIP_FORWARD_N : 1;
  advanceToNext(step, false);
};

document.getElementById("reviewNowBtn").onclick = () => {
  if (!sentences.length) return;

  autoAdvanceToken += 1;
  advanceToNext(1, true);
};

document.getElementById("clearBtn").onclick = () => {
  history = [];
  localStorage.removeItem('history');
  renderSidebarHistory();
};

// =========================
// UTIL
// =========================
function copyText(elementId) {
  const text = document.getElementById(elementId).textContent.replace(/^EN: |^PT: /, '');
  navigator.clipboard.writeText(text).then(() => {});
}

document.getElementById("savePdfBtn").onclick = () => {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  let y = 40;

  doc.setFontSize(16);
  doc.text("Histórico de Frases", 40, y);
  y += 30;

  history.forEach((h, i) => {
    doc.setFontSize(12);
    doc.text(`${i + 1}. ${h.en} | ${h.pt || ""}`, 40, y);
    y += 20;
    if (y > 780) { doc.addPage(); y = 40; }
  });

  doc.save("historico_frases.pdf");
};
setSecondaryMenu(false);


// ═══════════════════════════════════════════════════════
// SISTEMA DE GRUPOS — lógica completamente isolada
// Não altera nenhuma variável ou função existente.
// Usa: sentences (leitura), loadSentence(), pickBestCard()
// ═══════════════════════════════════════════════════════

const GROUPS_KEY = 'sentenceGroups_v1';
const ACTIVE_GROUP_KEY = 'activeGroupKey_v1';

let sentenceGroups = [];
let activeGroupId  = null;
let groupMode      = false;
let editingGroupId = null;
let groupSelectedEns = new Set();

function getSentences() {
  return window._sentences || [];
}
function loadGroups() {
  try { sentenceGroups = JSON.parse(localStorage.getItem(GROUPS_KEY)) || []; }
  catch { sentenceGroups = []; }
  activeGroupId = localStorage.getItem(ACTIVE_GROUP_KEY) || null;
}

function saveGroups() {
  localStorage.setItem(GROUPS_KEY, JSON.stringify(sentenceGroups));
}

function saveActiveGroup() {
  if (activeGroupId) localStorage.setItem(ACTIVE_GROUP_KEY, activeGroupId);
  else localStorage.removeItem(ACTIVE_GROUP_KEY);
}

/* ── Selecionar próxima frase do grupo ── */
function pickGroupCard() {
  const grp = sentenceGroups.find(g => g.id === activeGroupId);
  if (!grp || !grp.sentences.length) return null;
  const pool = getSentences().filter(s => grp.sentences.includes(s.en));
  if (!pool.length) return null;
  if (typeof pickBestCard === 'function') return pickBestCard(pool);
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ── Ativar / desativar modo grupo ── */
function setGroupMode(active, groupId) {
  groupMode     = !!active;
  activeGroupId = active ? groupId : null;
  saveActiveGroup();
  renderGroupsSidebar();
  updateGroupModeBtn();
  updateGroupBadge();

  if (groupMode) {
    const card = pickGroupCard();
    if (card && typeof loadSentence === 'function') loadSentence(card);
  } else {
    if (typeof pickCardForNavigation === 'function' && typeof loadSentence === 'function') {
      const card = pickCardForNavigation(false, 1);
      if (card) loadSentence(card);
    }
  }
}

/* ── Badge de modo grupo ─ */
function updateGroupBadge() {
  const badge = document.getElementById('groupModeBadge');
  if (!badge) return;
  if (groupMode && activeGroupId) {
    const grp = sentenceGroups.find(g => g.id === activeGroupId);
    badge.style.display = 'block';
    badge.innerHTML = `<i class="fa fa-layer-group"></i> Treinando grupo: <strong>${grp ? grp.name : ''}</strong>`;
  } else {
    badge.style.display = 'none';
  }
}

/* ── Botão "Treinar grupo" no action-stack ── */
function updateGroupModeBtn() {
  const btn = document.getElementById('groupModeBtn');
  if (!btn) return;
  if (groupMode) {
    btn.innerHTML = '<i class="fa fa-stop-circle"></i> Parar grupo';
    btn.classList.add('btn-active-mode');
  } else {
    btn.innerHTML = '<i class="fa fa-layer-group"></i> Treinar grupo';
    btn.classList.remove('btn-active-mode');
  }
}

/* ── Render lista de grupos no sidebar ── */
function renderGroupsSidebar() {
  const box = document.getElementById('groupsList');
  if (!box) return;
  if (!sentenceGroups.length) {
    box.innerHTML = '<div class="small" style="color:#94a3b8; padding:4px 0;">Nenhum grupo criado ainda.</div>';
    return;
  }
  box.innerHTML = sentenceGroups.map(g => {
    const isActive = groupMode && activeGroupId === g.id;
    return `
      <div class="group-item ${isActive ? 'group-active' : ''}" data-gid="${g.id}">
        <div class="group-item-info">
          <div class="group-item-name">${escHtml(g.name)}</div>
          <div class="group-item-count">${g.sentences.length} frase${g.sentences.length !== 1 ? 's' : ''}</div>
        </div>
        <button class="btn btn-soft" style="height:30px;padding:0 10px;font-size:0.76rem;border-radius:6px;" onclick="event.stopPropagation(); openGroupModal('${g.id}')">
          <i class="fa fa-edit"></i>
        </button>
        <button class="group-item-del" onclick="event.stopPropagation(); deleteGroup('${g.id}')" title="Excluir grupo">
          <i class="fa fa-times"></i>
        </button>
      </div>`;
  }).join('');

  box.querySelectorAll('.group-item').forEach(el => {
    el.addEventListener('click', () => {
      const gid = el.dataset.gid;
      if (groupMode && activeGroupId === gid) setGroupMode(false, null);
      else setGroupMode(true, gid);
    });
  });
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Deletar grupo ── */
function deleteGroup(id) {
  if (!confirm('Excluir este grupo?')) return;
  sentenceGroups = sentenceGroups.filter(g => g.id !== id);
  saveGroups();
  if (activeGroupId === id) setGroupMode(false, null);
  else renderGroupsSidebar();
}

/* ── Modal: abrir para criar ou editar ── */
function openGroupModal(editId) {
  if (!getSentences().length) {
    alert('Carregue as frases primeiro (Online ou TXT) antes de criar um grupo.');
    return;
  }
  editingGroupId = editId || null;
  groupSelectedEns = new Set();

  const modal = document.getElementById('groupModal');
  const title = document.getElementById('groupModalTitle');
  const nameInput = document.getElementById('groupNameInput');

  if (editingGroupId) {
    const grp = sentenceGroups.find(g => g.id === editingGroupId);
    title.textContent = '✏️ Editar grupo';
    nameInput.value = grp ? grp.name : '';
    if (grp) grp.sentences.forEach(en => groupSelectedEns.add(en));
  } else {
    title.textContent = '📂 Novo Grupo';
    nameInput.value = '';
  }

  document.getElementById('groupSearchInput').value = '';
  modal.classList.add('open');
  renderModalSentenceList('');
  nameInput.focus();
}

function closeGroupModal() {
  document.getElementById('groupModal').classList.remove('open');
  editingGroupId = null;
  groupSelectedEns = new Set();
}

/* ── Modal: renderizar lista de frases com seleção massiva ── */
function renderModalSentenceList(filter) {
  const list = document.getElementById('groupSentenceList');
  const counter = document.getElementById('groupCounter');
  if (!list) return;

  const src = getSentences();
  const q = filter.toLowerCase().trim();
  const filtered = q
    ? src.filter(s => s.en.toLowerCase().includes(q) || (s.pt || '').toLowerCase().includes(q))
    : src;

  if (!filtered.length) {
    list.innerHTML = '<div style="padding:16px;text-align:center;color:#94a3b8;font-size:0.84rem;">Nenhuma frase encontrada.</div>';
  } else {
    list.innerHTML = filtered.map((s, idx) => {
      const checked = groupSelectedEns.has(s.en);
      // Mostra o número real da frase no banco (1-based)
      const realIdx = src.indexOf(s) + 1;
      return `
        <label class="group-sentence-item ${checked ? 'selected' : ''}" data-real-idx="${realIdx}">
          <input type="checkbox" ${checked ? 'checked' : ''} data-en="${escHtml(s.en)}" />
          <div>
            <div class="group-sentence-en"><span style="color:#94a3b8;font-size:0.72rem;font-weight:800;margin-right:4px;">#${realIdx}</span>${escHtml(s.en)}</div>
            ${s.pt ? `<div class="group-sentence-pt">${escHtml(s.pt)}</div>` : ''}
          </div>
        </label>`;
    }).join('');

    list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const en = cb.dataset.en;
        if (cb.checked) groupSelectedEns.add(en);
        else groupSelectedEns.delete(en);
        cb.closest('.group-sentence-item').classList.toggle('selected', cb.checked);
        counter.textContent = `${groupSelectedEns.size} selecionada${groupSelectedEns.size !== 1 ? 's' : ''}`;
      });
    });
  }

  counter.textContent = `${groupSelectedEns.size} selecionada${groupSelectedEns.size !== 1 ? 's' : ''}`;
}

/* ══ SELEÇÃO MASSIVA: funções de range ══ */
function selectRange(start, end) {
  const src = getSentences();
  const from = Math.max(0, start - 1);
  const to = Math.min(src.length, end);
  for (let i = from; i < to; i++) {
    groupSelectedEns.add(src[i].en);
  }
  // Atualiza checkboxes visíveis
  const list = document.getElementById('groupSentenceList');
  if (list) {
    list.querySelectorAll('.group-sentence-item').forEach(item => {
      const cb = item.querySelector('input[type="checkbox"]');
      if (cb && groupSelectedEns.has(cb.dataset.en)) {
        cb.checked = true;
        item.classList.add('selected');
      }
    });
  }
  const counter = document.getElementById('groupCounter');
  if (counter) counter.textContent = `${groupSelectedEns.size} selecionada${groupSelectedEns.size !== 1 ? 's' : ''}`;
}

function deselectAll() {
  groupSelectedEns.clear();
  const list = document.getElementById('groupSentenceList');
  if (list) {
    list.querySelectorAll('.group-sentence-item').forEach(item => {
      const cb = item.querySelector('input[type="checkbox"]');
      if (cb) {
        cb.checked = false;
        item.classList.remove('selected');
      }
    });
  }
  const counter = document.getElementById('groupCounter');
  if (counter) counter.textContent = '0 selecionadas';
}

function selectAllVisible() {
  const list = document.getElementById('groupSentenceList');
  if (!list) return;
  list.querySelectorAll('.group-sentence-item').forEach(item => {
    const cb = item.querySelector('input[type="checkbox"]');
    if (cb) {
      cb.checked = true;
      item.classList.add('selected');
      groupSelectedEns.add(cb.dataset.en);
    }
  });
  const counter = document.getElementById('groupCounter');
  if (counter) counter.textContent = `${groupSelectedEns.size} selecionada${groupSelectedEns.size !== 1 ? 's' : ''}`;
}

function applyCustomRange() {
  const fromInput = document.getElementById('rangeFrom');
  const toInput = document.getElementById('rangeTo');
  if (!fromInput || !toInput) return;
  const from = parseInt(fromInput.value, 10);
  const to = parseInt(toInput.value, 10);
  if (isNaN(from) || isNaN(to) || from < 1 || to < from) {
    alert('Informe um intervalo válido (ex: De 1 Até 50).');
    return;
  }
  selectRange(from, to);
}

/* ── Salvar grupo ── */
function saveGroup() {
  const name = (document.getElementById('groupNameInput').value || '').trim();
  if (!name) { document.getElementById('groupNameInput').focus(); return; }
  if (!groupSelectedEns.size) { alert('Selecione ao menos uma frase.'); return; }

  if (editingGroupId) {
    const grp = sentenceGroups.find(g => g.id === editingGroupId);
    if (grp) { grp.name = name; grp.sentences = [...groupSelectedEns]; }
  } else {
    sentenceGroups.push({
      id: 'grp_' + Date.now(),
      name,
      sentences: [...groupSelectedEns]
    });
  }

  saveGroups();
  closeGroupModal();
  renderGroupsSidebar();
}

/* ── "Treinar grupo" button no action-stack ── */
function handleGroupModeBtn() {
  if (groupMode) { setGroupMode(false, null); return; }
  if (!sentenceGroups.length) { openGroupModal(null); return; }
  if (sentenceGroups.length === 1) { setGroupMode(true, sentenceGroups[0].id); return; }
  document.getElementById('groupsPanel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ── Hook no pickCardForNavigation para interceptar grupo ── */
(function patchNextBtn() {
  const origNextBtn = document.getElementById('nextBtn');
  if (!origNextBtn) return;
  origNextBtn.addEventListener('click', function patchedNext(e) {
    if (!groupMode) return;
    e.stopImmediatePropagation();
    if (typeof autoAdvanceToken !== 'undefined') window.autoAdvanceToken = (window.autoAdvanceToken || 0) + 1;
    const card = pickGroupCard();
    if (card && typeof loadSentence === 'function') loadSentence(card);
  }, true);
})();

/* ── Mostrar botão de grupo quando sentences carregam ── */
function showGroupBtn() {
  const btn = document.getElementById('groupModeBtn');
  if (btn) btn.style.display = 'inline-flex';
}

(function watchSentencesLoad() {
  const nextBtn = document.getElementById('nextBtn');
  if (!nextBtn) return;
  const obs = new MutationObserver(() => {
    if (nextBtn.style.display !== 'none') {
      showGroupBtn();
      renderGroupsSidebar();
      updateGroupBadge();
      updateGroupModeBtn();
    }
  });
  obs.observe(nextBtn, { attributes: true, attributeFilter: ['style'] });
})();

/* ── Event listeners ── */
document.getElementById('newGroupBtn').addEventListener('click', () => openGroupModal(null));
document.getElementById('groupModeBtn').addEventListener('click', handleGroupModeBtn);
document.getElementById('groupModalClose').addEventListener('click', closeGroupModal);
document.getElementById('groupCancelBtn').addEventListener('click', closeGroupModal);
document.getElementById('groupSaveBtn').addEventListener('click', saveGroup);
document.getElementById('groupModal').addEventListener('click', e => {
  if (e.target === document.getElementById('groupModal')) closeGroupModal();
});
document.getElementById('groupSearchInput').addEventListener('input', e => {
  renderModalSentenceList(e.target.value);
});

// Seleção massiva — event listeners
document.getElementById('rangeSelectAll')?.addEventListener('click', selectAllVisible);
document.getElementById('rangeDeselectAll')?.addEventListener('click', deselectAll);
document.getElementById('range1to25')?.addEventListener('click', () => selectRange(1, 25));
document.getElementById('range26to50')?.addEventListener('click', () => selectRange(26, 50));
document.getElementById('range51to75')?.addEventListener('click', () => selectRange(51, 75));
document.getElementById('range76to100')?.addEventListener('click', () => selectRange(76, 100));
document.getElementById('rangeApplyCustom')?.addEventListener('click', applyCustomRange);

/* ── Init ── */
loadGroups();
renderGroupsSidebar();
updateGroupModeBtn();
