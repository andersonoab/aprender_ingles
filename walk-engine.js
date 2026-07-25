/* ═══════════════════════════════════════════════════════════════
   WALK ENGINE v2 — Motor de Caminhada
   Lousa da Fluência · Igarapé Digital
   Alvo primário: Android / Chrome

   O QUE MUDOU EM RELAÇÃO À v1 E POR QUÊ

   1. A cadeia de áudio não depende mais de setTimeout.
      Chrome estrangula timer de página oculta para 1x/s e, depois de
      5 minutos, para 1x/min. A v1 avançava de frase com
      setTimeout(200ms) e se socorria com setInterval(4000ms): os dois
      caem no mesmo estrangulamento. Agora o que move a corrente é o
      evento "ended" de um elemento de mídia, que dispara normalmente
      em página oculta enquanto houver áudio tocando.

   2. As pausas entre frases também são mídia, não timer.
      Um WAV de silêncio real é tocado com playbackRate ajustado.
      Assim nenhum elo da corrente é um timer.

   3. Ping-pong de dois elementos de voz (A/B).
      Enquanto A toca, B pré-carrega a próxima fala. Latência de rede
      na rua deixa de abrir buraco na leitura.

   4. mp3Broken virou falha com recuperação, não sentença perpétua.
      Na v1, uma única falha de rede desligava o canal MP3 pelo resto
      da sessão e jogava tudo no speechSynthesis — que no Android é
      justamente o canal que não toca em segundo plano. Agora há
      contagem de falhas consecutivas e reabilitação automática.

   5. stopSpeaking() zera onended/onerror ANTES de mexer no src.
      Na v1 o load() com src vazio disparava um erro sintético que caía
      no onerror ainda ligado e reiniciava a fala. Era o áudio fantasma
      depois de pausar ou pular.

   6. pause() não pausa mais a âncora de mídia.
      Manter a âncora tocando é o que impede o Chrome de congelar a
      aba, e é o que garante que o botão play da tela de bloqueio ainda
      consiga ressuscitar a leitura.

   7. Com a tela apagada, o avanço de frase não reconstrói a interface.
      loadSentence() refaz tabuleiro, painéis, predição, missão e
      análise de erros. Isso não serve para nada quando ninguém está
      olhando. Agora a interface é sincronizada quando a página volta
      a ficar visível.

   8. Política de tela explícita e escolhível: "manter acesa" (Wake
      Lock, re-adquirido ao voltar da tela de bloqueio) ou "deixar
      apagar" (sessão de mídia sustenta o áudio).

   INCERTEZA DECLARADA
   O Chrome decide se uma aba está "audível" por limiar de potência.
   A âncora de silêncio quase absoluto pode ficar abaixo desse limiar.
   Aqui ela é gerada em -50 dBFS a 40 Hz: inaudível na prática, mas com
   energia suficiente para registrar. Não tenho como garantir o limiar
   exato, que varia por versão do Chrome. Na prática isso importa pouco,
   porque durante a caminhada a própria voz mantém a aba audível; a
   âncora só cobre os intervalos curtos.

   Não altera app.js. Sobrescreve funções globais por composição.
═══════════════════════════════════════════════════════════════ */

window.WalkEngine = (function () {
  "use strict";

  const PREF_KEY = "walkEngine_v2";
  const LEGACY_KEY = "walkEngine_v1";

  const defaults = {
    screenAwake: false,   // true = Wake Lock (tela acesa) | false = deixa apagar
    voice: "auto",        // auto | mp3 | tts
    repeatEn: 2,          // repetições em inglês antes do português
    includePt: true,      // fala a tradução
    pace: "normal",       // rapido | normal | pausado
    gapMs: 250,           // pausa entre frases
    rate: 1.0             // velocidade da fala
  };

  // Ritmo controla pausa e velocidade juntas: para quem escuta, é a
  // mesma percepção. Um seletor em vez de dois.
  const PACE = {
    rapido:  { gapMs: 110, rate: 1.12 },
    normal:  { gapMs: 250, rate: 1.0 },
    pausado: { gapMs: 700, rate: 0.9 }
  };

  const MAX_TTS_CHARS = 190;   // acima disso o endpoint MP3 trunca
  const MP3_FAIL_LIMIT = 3;    // falhas seguidas antes de degradar
  const MP3_RETRY_MS = 60000;  // tempo até tentar reabilitar o MP3

  let prefs = Object.assign({}, defaults);

  const state = {
    running: false,
    paused: false,
    mp3Fails: 0,
    mp3DownSince: 0,
    unlocked: false,
    seqToken: 0,
    wakeLock: null,
    suppressAutoStart: false,
    pendingCard: null
  };

  let keepEl = null;            // âncora de mídia, nunca pausada em uso
  let voiceA = null;
  let voiceB = null;
  let active = null;            // elemento tocando agora
  let idle = null;              // elemento pré-carregando
  let keepUrl = null;
  let silenceUrl = null;
  let artworkUrl = null;
  let watchdog = null;          // rede de segurança, fora do caminho crítico

  const originals = {
    requestWakeLock: window.requestWakeLock,
    releaseWakeLock: window.releaseWakeLock,
    startNoSleep: window.startNoSleep,
    stopNoSleep: window.stopNoSleep,
    playGuidedReading: window.playGuidedReading
  };

  /* ── Preferências ─────────────────────────────────────────── */

  function loadPrefs() {
    let raw = {};
    try {
      raw = JSON.parse(localStorage.getItem(PREF_KEY) || "null");
      if (!raw) {
        // Migra a chave antiga: screenOff era o inverso de screenAwake.
        const old = JSON.parse(localStorage.getItem(LEGACY_KEY) || "{}");
        raw = {
          screenAwake: old.screenOff === false,
          voice: old.voice,
          repeatEn: old.repeatEn,
          includePt: old.includePt,
          gapMs: old.gapMs,
          rate: old.rate
        };
      }
    } catch {
      raw = {};
    }
    prefs = Object.assign({}, defaults);
    for (const k of Object.keys(defaults)) {
      if (raw && raw[k] !== undefined && raw[k] !== null) prefs[k] = raw[k];
    }
    applyPace();
  }

  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {}
  }

  function applyPace() {
    const p = PACE[prefs.pace] || PACE.normal;
    prefs.gapMs = p.gapMs;
    prefs.rate = p.rate;
  }

  function setPref(key, value) {
    prefs[key] = value;
    if (key === "pace") applyPace();
    savePrefs();
    if (key === "screenAwake") applyScreenPolicy();
    if (key === "voice") { state.mp3Fails = 0; state.mp3DownSince = 0; }
    renderStatus();
  }

  /* ── Geração de PCM real em memória ───────────────────────── */

  function makeWav(seconds, sampleRate, sampleAt) {
    const frames = Math.round(seconds * sampleRate);
    const bytes = 44 + frames * 2;
    const buf = new ArrayBuffer(bytes);
    const view = new DataView(buf);

    const ascii = (offset, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    ascii(0, "RIFF");
    view.setUint32(4, bytes - 8, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);            // PCM
    view.setUint16(22, 1, true);            // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, "data");
    view.setUint32(40, frames * 2, true);

    for (let i = 0; i < frames; i++) {
      view.setInt16(44 + i * 2, sampleAt(i, sampleRate), true);
    }

    return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  }

  // Âncora: seno de 40 Hz a cerca de -50 dBFS. Inaudível na prática,
  // com energia suficiente para o Chrome tratar a aba como audível.
  function buildKeepAliveWav() {
    if (keepUrl) return keepUrl;
    const amp = 96;
    keepUrl = makeWav(2, 8000, (i, sr) =>
      Math.round(amp * Math.sin((2 * Math.PI * 40 * i) / sr))
    );
    return keepUrl;
  }

  // Silêncio de 1 s. Pausas menores saem por playbackRate.
  function buildSilenceWav() {
    if (silenceUrl) return silenceUrl;
    silenceUrl = makeWav(1, 8000, () => 0);
    return silenceUrl;
  }

  /* ── Capa para a notificação de mídia ─────────────────────── */

  function buildArtwork() {
    if (artworkUrl) return artworkUrl;
    try {
      const c = document.createElement("canvas");
      c.width = 512; c.height = 512;
      const g = c.getContext("2d");

      const grad = g.createLinearGradient(0, 0, 512, 512);
      grad.addColorStop(0, "#1e3a8a");
      grad.addColorStop(1, "#06b6d4");
      g.fillStyle = grad;
      g.fillRect(0, 0, 512, 512);

      g.strokeStyle = "rgba(255,255,255,0.85)";
      g.lineWidth = 14;
      g.lineCap = "round";
      for (let i = 0; i < 7; i++) {
        const x = 116 + i * 47;
        const h = 40 + Math.abs(Math.sin(i * 1.1)) * 150;
        g.beginPath();
        g.moveTo(x, 256 - h / 2);
        g.lineTo(x, 256 + h / 2);
        g.stroke();
      }

      g.fillStyle = "rgba(255,255,255,0.92)";
      g.font = "700 44px sans-serif";
      g.textAlign = "center";
      g.fillText("Lousa da Fluência", 256, 440);

      artworkUrl = c.toDataURL("image/png");
      return artworkUrl;
    } catch {
      return null;
    }
  }

  /* ── Desbloqueio de áudio (exige gesto do usuário) ────────── */

  function mkAudio() {
    const el = document.createElement("audio");
    el.setAttribute("playsinline", "");
    el.preload = "auto";
    el.crossOrigin = null;
    document.body.appendChild(el);
    return el;
  }

  function unlock() {
    if (state.unlocked) return;
    try {
      if (!keepEl) {
        keepEl = mkAudio();
        keepEl.src = buildKeepAliveWav();
        keepEl.loop = true;
        keepEl.volume = 1;
      }
      if (!voiceA) { voiceA = mkAudio(); voiceA.volume = 1; }
      if (!voiceB) { voiceB = mkAudio(); voiceB.volume = 1; }
      active = voiceA;
      idle = voiceB;

      keepEl.play().catch(() => {});
      // Toca e para os dois elementos de voz dentro do gesto do usuário.
      // Sem isso o Android bloqueia a primeira reprodução programática.
      [voiceA, voiceB].forEach((el) => {
        try {
          el.src = buildSilenceWav();
          el.play().then(() => el.pause()).catch(() => {});
        } catch {}
      });

      state.unlocked = true;
    } catch {}
  }

  /* ── MediaSession ─────────────────────────────────────────── */

  function updateMetadata(en, pt) {
    if (!("mediaSession" in navigator)) return;
    try {
      const art = buildArtwork();
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: en || "Lousa da Fluência",
        artist: pt || "Modo Caminhada",
        album: "Treino de inglês · Igarapé Digital",
        artwork: art ? [{ src: art, sizes: "512x512", type: "image/png" }] : []
      });
      navigator.mediaSession.playbackState = state.paused ? "paused" : "playing";
    } catch {}
  }

  function bindMediaControls() {
    if (!("mediaSession" in navigator)) return;
    const set = (action, fn) => {
      try { navigator.mediaSession.setActionHandler(action, fn); } catch {}
    };
    set("play", () => resume());
    set("pause", () => pause());
    set("nexttrack", () => step(1));
    set("previoustrack", () => step(-1));
    set("seekforward", () => step(1));
    set("seekbackward", () => repeat());
    set("stop", () => {
      if (typeof toggleWalkMode === "function" && walkMode) toggleWalkMode();
    });
  }

  /* ── Canal de voz ─────────────────────────────────────────── */

  function mp3Available() {
    if (prefs.voice === "tts") return false;
    if (prefs.voice === "mp3") return true;
    if (state.mp3Fails < MP3_FAIL_LIMIT) return true;
    // Degradado: tenta reabilitar depois de um tempo de descanso.
    if (Date.now() - state.mp3DownSince > MP3_RETRY_MS) {
      state.mp3Fails = 0;
      state.mp3DownSince = 0;
      renderStatus();
      return true;
    }
    return false;
  }

  function ttsUrl(text, lang) {
    const q = encodeURIComponent(text);
    const tl = String(lang).startsWith("pt") ? "pt-BR" : "en-US";
    return `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=${tl}&q=${q}`;
  }

  function detachMedia(el) {
    if (!el) return;
    el.onended = null;
    el.onerror = null;
    el.onstalled = null;
    el.oncanplay = null;
  }

  // Solta o elemento sem disparar erro sintético no onerror.
  function hardStop(el) {
    if (!el) return;
    detachMedia(el);
    try {
      el.pause();
      el.removeAttribute("src");
      el.load();
    } catch {}
  }

  function swapVoiceEls() {
    const tmp = active;
    active = idle;
    idle = tmp;
  }

  // Pré-carrega no elemento ocioso enquanto o outro toca.
  // Não define playbackRate aqui: load() reseta, e o playOn já define.
  function preload(url) {
    if (!idle || !url) return;
    try {
      detachMedia(idle);
      idle.pause();
      if (idle.src !== url) {
        idle.src = url;
        idle.load();
      }
    } catch {}
  }

  function clampRate(r) {
    return Math.min(2.5, Math.max(0.5, r || 1));
  }

  // Reproduz uma URL no elemento ativo. Resolve pelo evento "ended",
  // que é o único elo da corrente. Nenhum timer no caminho crítico.
  function playOn(el, url, rate) {
    return new Promise((resolve) => {
      if (!el || !url) return resolve(false);

      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        detachMedia(el);
        resolve(ok);
      };

      el.onended = () => finish(true);
      el.onerror = () => finish(false);

      try {
        if (el.src !== url) {
          el.src = url;
          el.load();
        } else if (el.currentTime > 0.01) {
          // Só rebobina quando de fato já tocou. Mexer em currentTime
          // com o buffer ainda vazio derrubava a reprodução e jogava
          // a fala inteira no fallback, com atraso visível.
          try { el.currentTime = 0; } catch {}
        }
        el.playbackRate = clampRate(rate);
        const p = el.play();
        if (p && p.catch) p.catch(() => finish(false));
      } catch {
        finish(false);
      }
    });
  }

  function playTts(text, lang, rate) {
    return new Promise((resolve) => {
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
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

  function preloadFor(nextItem) {
    if (!nextItem) return;
    if (nextItem.text && nextItem.text.length <= MAX_TTS_CHARS) {
      preload(ttsUrl(nextItem.text, nextItem.lang));
    } else if (nextItem.silence) {
      preload(buildSilenceWav());
    }
  }

  async function say(item, nextItem) {
    // A pausa é mídia, não timer: playbackRate encurta o silêncio de 1 s.
    // É durante ela que o elemento ocioso baixa a primeira fala da
    // frase seguinte. Era aqui que estava o buraco entre uma e outra.
    if (item.silence) {
      const secs = Math.max(0.1, Math.min(3, item.silence / 1000));
      swapVoiceEls();
      const done = playOn(active, buildSilenceWav(), 1 / secs);
      preloadFor(nextItem);
      return done;
    }

    if (!item.text) return false;

    const usable = mp3Available() && item.text.length <= MAX_TTS_CHARS;

    if (usable) {
      const url = ttsUrl(item.text, item.lang);
      swapVoiceEls();
      // Enquanto este toca, o outro elemento já busca o próximo.
      const ok = playOn(active, url, item.rate);
      preloadFor(nextItem);
      const result = await ok;
      if (result) {
        state.mp3Fails = 0;
        return true;
      }
      state.mp3Fails += 1;
      if (state.mp3Fails >= MP3_FAIL_LIMIT && !state.mp3DownSince) {
        state.mp3DownSince = Date.now();
        renderStatus();
      }
      if (prefs.voice === "mp3") return false;
    }

    // Fallback honesto: no Android o speechSynthesis é suspenso em
    // segundo plano. Só serve com a tela acesa e o app em primeiro plano.
    return playTts(item.text, item.lang, item.rate);
  }

  function stopSpeaking() {
    try { window.speechSynthesis.cancel(); } catch {}
    hardStop(voiceA);
    hardStop(voiceB);
  }

  /* ── Fila de leitura de uma frase ─────────────────────────── */

  function buildQueue(card, pt, nextCard) {
    const q = [];
    const reps = Math.max(1, prefs.repeatEn);
    for (let i = 0; i < reps; i++) {
      q.push({ text: card.en, lang: "en-US", rate: prefs.rate - i * 0.04 });
    }
    if (prefs.includePt) {
      q.push({ text: pt || "Tradução indisponível", lang: "pt-BR", rate: 1.02 });
      q.push({ text: card.en, lang: "en-US", rate: prefs.rate - 0.02 });
    }
    q.push({ silence: prefs.gapMs });
    // Item fantasma: nunca é tocado, serve só para que a pausa saiba
    // o que pré-carregar. É o que elimina a espera entre as frases.
    if (nextCard && nextCard.en) {
      q.push({ ghost: true, text: nextCard.en, lang: "en-US", rate: prefs.rate });
    }
    return q;
  }

  /* ── Ciclo principal ──────────────────────────────────────── */

  async function guidedReading(card) {
    card = card || currentCard;
    if (!card || !card.en) return;

    // Chamada de cortesia vinda do loadSentence que nós mesmos
    // disparamos: o ciclo já está correndo, não duplica.
    if (state.suppressAutoStart) {
      state.suppressAutoStart = false;
      return;
    }
    if (state.paused) return;

    unlock();
    const token = autoReadToken;
    const mine = ++state.seqToken;

    const pt = await getPtTranslationForCard(card);
    const alive = () =>
      token === autoReadToken &&
      autoReadMode &&
      mine === state.seqToken &&
      !state.paused;

    if (!alive()) return;

    updateMetadata(card.en, pt);
    renderPocket(card.en, pt);
    armWatchdog();

    // Aquece a tradução da próxima frase agora, enquanto esta toca.
    // Sem isto, o fetch acontecia depois da pausa, em série com a
    // reconstrução da interface, e o silêncio ficava longo.
    const nextCard = pickSequentialAutoReadCard(1);
    if (nextCard && nextCard.en !== card.en) {
      try { getPtTranslationForCard(nextCard); } catch {}
    }

    const queue = buildQueue(card, pt, nextCard);
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].ghost) break;          // fantasma nunca é tocado
      if (!alive()) return;
      await say(queue[i], queue[i + 1]);
    }
    if (!alive()) return;

    advance();
  }

  // Avança sem reconstruir a interface quando ninguém está olhando.
  function advance() {
    const next = pickSequentialAutoReadCard(1);
    if (!next || next.en === (currentCard && currentCard.en)) {
      autoReadToken += 1;
      guidedReading(currentCard);
      return;
    }

    if (document.visibilityState === "visible") {
      state.suppressAutoStart = true;   // loadSentence chamaria de novo
      loadSentence(next);
      autoReadToken += 1;
      guidedReading(next);
    } else {
      // Estado mínimo, sem tocar no DOM pesado.
      currentCard = next;
      textEn = next.en;
      textPt = next.pt || "";
      currentWords = String(next.en).split(" ").filter(Boolean);
      const idx = sentences.findIndex((s) => s.en === next.en);
      currentCardIndex = idx >= 0 ? idx : 0;
      state.pendingCard = next;
      autoReadToken += 1;
      guidedReading(next);
    }
  }

  // Ao voltar para a tela, coloca a interface no card certo.
  function syncUiIfPending() {
    const card = state.pendingCard;
    if (!card) return;
    state.pendingCard = null;
    try {
      state.suppressAutoStart = true;
      loadSentence(card);
    } catch {}
  }

  /* ── Rede de segurança (fora do caminho crítico) ──────────── */

  function armWatchdog() {
    if (watchdog) clearTimeout(watchdog);
    // Se em 45 s nada tiver avançado, reergue o ciclo. Este timer pode
    // ser estrangulado; ele é seguro adicional, não o mecanismo.
    watchdog = setTimeout(() => {
      if (!state.running || state.paused || !autoReadMode) return;
      const quietMp3 = (!voiceA || voiceA.paused) && (!voiceB || voiceB.paused);
      const quietTts = !window.speechSynthesis.speaking && !window.speechSynthesis.pending;
      try { if (keepEl && keepEl.paused) keepEl.play().catch(() => {}); } catch {}
      if (quietMp3 && quietTts && currentCard) {
        autoReadToken += 1;
        guidedReading(currentCard);
      }
    }, 45000);
  }

  /* ── Controles ────────────────────────────────────────────── */

  function step(dir) {
    const card = pickSequentialAutoReadCard(dir);
    if (!card) return;
    state.paused = false;
    stopSpeaking();
    autoReadToken += 1;
    if (document.visibilityState === "visible") {
      state.suppressAutoStart = true;
      loadSentence(card);
    } else {
      currentCard = card;
      textEn = card.en;
      state.pendingCard = card;
    }
    guidedReading(card);
    renderPocketButtons();
  }

  function repeat() {
    if (!currentCard) return;
    state.paused = false;
    stopSpeaking();
    autoReadToken += 1;
    guidedReading(currentCard);
    renderPocketButtons();
  }

  function pause() {
    state.paused = true;
    autoReadToken += 1;
    stopSpeaking();
    // A âncora NÃO é pausada: é ela que impede o Chrome de congelar a
    // aba e é o que permite o play da tela de bloqueio voltar a valer.
    try { if (keepEl && keepEl.paused) keepEl.play().catch(() => {}); } catch {}
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
    renderStatus();
    renderPocketButtons();
  }

  function resume() {
    state.paused = false;
    unlock();
    try { if (keepEl) keepEl.play().catch(() => {}); } catch {}
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
    autoReadToken += 1;
    guidedReading(currentCard);
    renderStatus();
    renderPocketButtons();
  }

  /* ── Política de tela ─────────────────────────────────────── */

  async function acquireWakeLock() {
    if (!("wakeLock" in navigator) || !navigator.wakeLock || !navigator.wakeLock.request) return false;
    if (document.visibilityState !== "visible") return false;
    try {
      state.wakeLock = await navigator.wakeLock.request("screen");
      state.wakeLock.addEventListener("release", () => { state.wakeLock = null; });
      return true;
    } catch {
      state.wakeLock = null;
      return false;
    }
  }

  async function dropWakeLock() {
    try { if (state.wakeLock) await state.wakeLock.release(); } catch {}
    state.wakeLock = null;
  }

  async function applyScreenPolicy() {
    if (prefs.screenAwake && state.running) {
      await acquireWakeLock();
    } else {
      await dropWakeLock();
    }
    renderStatus();
  }

  /* ── Start / Stop ─────────────────────────────────────────── */

  function start() {
    loadPrefs();
    state.running = true;
    state.paused = false;
    state.mp3Fails = 0;
    state.mp3DownSince = 0;

    unlock();
    bindMediaControls();
    try { if (keepEl) keepEl.play().catch(() => {}); } catch {}

    applyScreenPolicy();
    armWatchdog();
    renderStatus();
  }

  function stop() {
    state.running = false;
    state.paused = false;
    state.pendingCard = null;
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }

    stopSpeaking();
    try { if (keepEl) keepEl.pause(); } catch {}
    dropWakeLock();

    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.playbackState = "none";
        navigator.mediaSession.metadata = null;
      } catch {}
    }
    closePocket();
    renderStatus();
  }

  /* ── Modo Bolso ───────────────────────────────────────────── */

  let pocketTimer = null;

  function openPocket() {
    const el = document.getElementById("pocketOverlay");
    if (!el) return;
    unlock();
    el.classList.add("open");
    el.classList.remove("dim");
    renderPocketButtons();
    if (currentCard) renderPocket(currentCard.en, textPt);
    scheduleDim();
  }

  function closePocket() {
    const el = document.getElementById("pocketOverlay");
    if (!el) return;
    el.classList.remove("open", "dim");
    if (pocketTimer) clearTimeout(pocketTimer);
  }

  function scheduleDim() {
    if (pocketTimer) clearTimeout(pocketTimer);
    pocketTimer = setTimeout(() => {
      const el = document.getElementById("pocketOverlay");
      if (el && el.classList.contains("open")) el.classList.add("dim");
    }, 9000);
  }

  function wakePocket() {
    const el = document.getElementById("pocketOverlay");
    if (el) el.classList.remove("dim");
    scheduleDim();
  }

  function renderPocket(en, pt) {
    const elEn = document.getElementById("pocketEn");
    const elPt = document.getElementById("pocketPt");
    if (elEn) elEn.textContent = en || "";
    if (elPt) elPt.textContent = pt || "";
  }

  function renderPocketButtons() {
    const btn = document.getElementById("pocketPlay");
    if (!btn) return;
    btn.innerHTML = state.paused
      ? '<i class="fa fa-play"></i>'
      : '<i class="fa fa-pause"></i>';
  }

  /* ── Status e sincronização de controles ──────────────────── */

  function canvasWakeLock() {
    return "wakeLock" in navigator && !!navigator.wakeLock;
  }

  function renderStatus() {
    const degraded = state.mp3Fails >= MP3_FAIL_LIMIT;

    const canal = degraded
      ? "voz do sistema (canal MP3 em descanso, volta sozinho)"
      : prefs.voice === "tts" ? "voz do sistema"
      : prefs.voice === "mp3" ? "só MP3"
      : "MP3 com retorno automático";

    let tela;
    if (prefs.screenAwake) {
      tela = canvasWakeLock()
        ? (state.wakeLock ? "tela travada acesa" : "tela acesa solicitada")
        : "este navegador não permite travar a tela acesa";
    } else {
      tela = "a tela pode apagar: o áudio segue pela sessão de mídia";
    }

    const alerta = (prefs.voice === "tts" && !prefs.screenAwake)
      ? " Atenção: a voz do sistema não toca com a tela apagada no Android. Use MP3 ou deixe a tela acesa."
      : "";

    const box = document.getElementById("walkEngineStatus");
    if (box) {
      box.innerHTML = state.running
        ? `<strong>Caminhada ativa.</strong> Voz: ${canal}. Tela: ${tela}. Os controles aparecem na notificação e no fone.${alerta}`
        : `Caminhada pronta. Voz: ${canal}; ${tela}.${alerta}`;
    }

    document.querySelectorAll("[data-screen-policy]").forEach((b) => {
      const on = b.getAttribute("data-screen-policy") === "awake";
      b.classList.toggle("seg-on", on === !!prefs.screenAwake);
      b.setAttribute("aria-pressed", String(on === !!prefs.screenAwake));
    });

    const vs = document.getElementById("walkVoiceSelect");
    if (vs) vs.value = prefs.voice;
    const pc = document.getElementById("walkPaceSelect");
    if (pc) pc.value = prefs.pace;
    const rp = document.getElementById("walkRepeatSelect");
    if (rp) rp.value = String(prefs.repeatEn);
    const pt = document.getElementById("walkIncludePt");
    if (pt) pt.checked = !!prefs.includePt;

    const opts = document.getElementById("walkOptions");
    if (opts) opts.style.display = state.running ? "flex" : "none";
    if (box) box.style.display = state.running ? "block" : "none";
  }

  /* ── Instalação por composição ────────────────────────────── */

  function install() {
    loadPrefs();

    // O app.js pede Wake Lock direto; aqui a decisão passa pela política.
    window.requestWakeLock = async function () {
      if (!prefs.screenAwake) { renderStatus(); return false; }
      const ok = await acquireWakeLock();
      renderStatus();
      return ok;
    };

    window.releaseWakeLock = async function () { await dropWakeLock(); };
    window.startNoSleep = start;
    window.stopNoSleep = stop;
    window.playGuidedReading = guidedReading;

    // Desbloqueio no primeiro gesto, em fase de captura, antes que
    // qualquer await quebre a associação com o gesto do usuário.
    const onFirstTouch = () => unlock();
    document.addEventListener("pointerdown", onFirstTouch, { capture: true, once: true });
    document.addEventListener("click", onFirstTouch, { capture: true, once: true });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      if (!state.running) return;
      if (prefs.screenAwake) acquireWakeLock();
      syncUiIfPending();
      try { if (keepEl && keepEl.paused && !state.paused) keepEl.play().catch(() => {}); } catch {}
      renderStatus();
    });

    window.addEventListener("pagehide", () => {
      try { if (!state.running) { if (keepUrl) URL.revokeObjectURL(keepUrl); if (silenceUrl) URL.revokeObjectURL(silenceUrl); } } catch {}
    });

    document.addEventListener("DOMContentLoaded", wireUi);
    if (document.readyState !== "loading") wireUi();
  }

  function wireUi() {
    const bind = (id, ev, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(ev, fn);
    };

    document.querySelectorAll("[data-screen-policy]").forEach((b) => {
      b.addEventListener("click", () => {
        setPref("screenAwake", b.getAttribute("data-screen-policy") === "awake");
      });
    });

    bind("walkIncludePt", "change", (e) => setPref("includePt", e.target.checked));
    bind("walkVoiceSelect", "change", (e) => setPref("voice", e.target.value));
    bind("walkPaceSelect", "change", (e) => setPref("pace", e.target.value));
    bind("walkRepeatSelect", "change", (e) => setPref("repeatEn", parseInt(e.target.value, 10) || 2));

    bind("pocketModeBtn", "click", openPocket);
    bind("pocketClose", "click", closePocket);
    bind("pocketPrev", "click", (e) => { e.stopPropagation(); wakePocket(); step(-1); });
    bind("pocketNext", "click", (e) => { e.stopPropagation(); wakePocket(); step(1); });
    bind("pocketRepeat", "click", (e) => { e.stopPropagation(); wakePocket(); repeat(); });
    bind("pocketPlay", "click", (e) => {
      e.stopPropagation();
      wakePocket();
      state.paused ? resume() : pause();
    });

    const overlay = document.getElementById("pocketOverlay");
    if (overlay) overlay.addEventListener("click", wakePocket);

    renderStatus();
  }

  install();

  return {
    get prefs() { return prefs; },
    get state() { return state; },
    setPref, start, stop, pause, resume, step, repeat,
    unlock, openPocket, closePocket, renderStatus,
    guidedReading
  };
})();
