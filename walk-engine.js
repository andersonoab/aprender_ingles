/* ═══════════════════════════════════════════════════════════════
   WALK ENGINE — Motor de Caminhada com Tela Desligada
   Lousa da Fluência · Igarapé Digital

   Problema que este módulo resolve:
   O Wake Lock MANTÉM a tela ligada. Ele é o oposto do que você quer.
   Para ouvir com a tela desligada, o navegador precisa ser reconhecido
   pelo sistema operacional como uma SESSÃO DE MÍDIA ATIVA. Isso só
   acontece com um HTMLAudioElement tocando PCM real + MediaSession API.

   Estratégias empilhadas:
   1. Âncora de mídia: <audio> em loop com WAV real (PCM de baixíssima
      amplitude) gerado em memória. Mantém a sessão viva entre as falas.
   2. MediaSession: metadados + controles na tela de bloqueio
      (anterior / repetir / pausar / próxima) e no fone bluetooth.
   3. Voz MP3: busca o áudio como arquivo real. Media element toca com
      a tela bloqueada; speechSynthesis não toca no iOS bloqueado.
   4. Fallback automático para speechSynthesis se o MP3 falhar.
   5. Modo Bolso: overlay preto, botões grandes, evita toque acidental.

   Não altera app.js. Sobrescreve funções globais por composição.
═══════════════════════════════════════════════════════════════ */

window.WalkEngine = (function () {
  "use strict";

  const PREF_KEY = "walkEngine_v1";

  const defaults = {
    screenOff: true,      // true = deixa a tela apagar (não pede Wake Lock)
    voice: "auto",        // auto | mp3 | tts
    repeatEn: 2,          // repetições em inglês antes do português
    includePt: true,      // fala a tradução
    gapMs: 500,           // pausa entre frases
    rate: 0.98            // velocidade da fala
  };

  let prefs = Object.assign({}, defaults);

  const state = {
    running: false,
    paused: false,
    mp3Broken: false,
    unlocked: false,
    seqToken: 0
  };

  let keepEl = null;      // âncora de mídia (loop infinito)
  let voiceEl = null;     // reprodutor das falas em MP3
  let artworkUrl = null;
  let heartbeat = null;

  const originals = {
    requestWakeLock: window.requestWakeLock,
    startNoSleep: window.startNoSleep,
    stopNoSleep: window.stopNoSleep,
    playGuidedReading: window.playGuidedReading
  };

  /* ── Preferências ─────────────────────────────────────────── */

  function loadPrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
      prefs = Object.assign({}, defaults, raw);
    } catch {
      prefs = Object.assign({}, defaults);
    }
  }

  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {}
  }

  function setPref(key, value) {
    prefs[key] = value;
    savePrefs();
    if (key === "screenOff") {
      if (value) {
        try { if (typeof releaseWakeLock === "function") releaseWakeLock(); } catch {}
      } else if (state.running) {
        try { originals.requestWakeLock && originals.requestWakeLock(); } catch {}
      }
    }
    renderStatus();
  }

  /* ── WAV real gerado em memória ───────────────────────────── */
  // Silêncio absoluto é descartado por alguns sistemas. Aqui geramos
  // PCM verdadeiro: seno de 40 Hz com amplitude de 8/32768 (inaudível
  // em fone e alto-falante, mas suficiente para o SO manter a sessão).

  function buildKeepAliveWav(seconds = 2, sampleRate = 8000) {
    const frames = seconds * sampleRate;
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

    const amp = 8;
    for (let i = 0; i < frames; i++) {
      const sample = Math.round(amp * Math.sin((2 * Math.PI * 40 * i) / sampleRate));
      view.setInt16(44 + i * 2, sample, true);
    }

    return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  }

  /* ── Capa para a tela de bloqueio ─────────────────────────── */

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

  /* ── Desbloqueio de áudio (precisa de gesto do usuário) ───── */

  function unlock() {
    if (state.unlocked) return;
    try {
      if (!keepEl) {
        keepEl = document.createElement("audio");
        keepEl.src = buildKeepAliveWav();
        keepEl.loop = true;
        keepEl.volume = 0.03;
        keepEl.setAttribute("playsinline", "");
        keepEl.preload = "auto";
        document.body.appendChild(keepEl);
      }
      if (!voiceEl) {
        voiceEl = document.createElement("audio");
        voiceEl.setAttribute("playsinline", "");
        voiceEl.preload = "auto";
        voiceEl.volume = 1;
        document.body.appendChild(voiceEl);
      }
      keepEl.play().catch(() => {});
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
    set("stop", () => { if (typeof toggleWalkMode === "function" && walkMode) toggleWalkMode(); });
  }

  /* ── Falas ────────────────────────────────────────────────── */

  function ttsUrls(text, lang) {
    const q = encodeURIComponent(text);
    const tl = lang.startsWith("pt") ? "pt-BR" : "en-US";
    return [
      `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=${tl}&q=${q}`,
      `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${tl}&q=${q}`
    ];
  }

  function playMp3(text, lang, rate) {
    return new Promise((resolve) => {
      if (!voiceEl || state.mp3Broken || !text) return resolve(false);

      const urls = ttsUrls(text, lang);
      let attempt = 0;
      let settled = false;
      let guard = null;

      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        voiceEl.onended = null;
        voiceEl.onerror = null;
        resolve(ok);
      };

      const tryUrl = () => {
        if (attempt >= urls.length) return finish(false);
        const url = urls[attempt++];
        voiceEl.onended = () => finish(true);
        voiceEl.onerror = () => tryUrl();
        try {
          voiceEl.src = url;
          voiceEl.playbackRate = Math.min(1.6, Math.max(0.6, rate || 1));
          voiceEl.load();
          const p = voiceEl.play();
          if (p && p.catch) p.catch(() => tryUrl());
        } catch {
          tryUrl();
        }
      };

      // Se em 6 s nada tocou, considera o canal MP3 indisponível.
      guard = setTimeout(() => {
        if (!voiceEl.duration || voiceEl.paused) {
          state.mp3Broken = true;
          renderStatus();
          finish(false);
        }
      }, 6000);

      tryUrl();
    });
  }

  function playTts(text, lang, rate) {
    return new Promise((resolve) => {
      try {
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

  async function say(text, lang, rate) {
    if (!text) return false;
    const wantMp3 = prefs.voice === "mp3" || (prefs.voice === "auto" && !state.mp3Broken);
    if (wantMp3) {
      const ok = await playMp3(text, lang, rate);
      if (ok) return true;
      if (prefs.voice === "mp3") return false;
    }
    return playTts(text, lang, rate);
  }

  function stopSpeaking() {
    try { window.speechSynthesis.cancel(); } catch {}
    try { if (voiceEl) { voiceEl.pause(); voiceEl.removeAttribute("src"); voiceEl.load(); } } catch {}
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ── Ciclo de leitura guiada (substitui o do app.js) ──────── */

  async function guidedReading(card) {
    card = card || currentCard;
    if (!card || !card.en) return;
    if (state.paused) return;

    unlock();
    const token = autoReadToken;
    const mine = ++state.seqToken;

    const pt = await getPtTranslationForCard(card);
    if (token !== autoReadToken || !autoReadMode || mine !== state.seqToken) return;

    updateMetadata(card.en, pt);
    renderPocket(card.en, pt);

    const alive = () => token === autoReadToken && autoReadMode && mine === state.seqToken && !state.paused;

    for (let i = 0; i < Math.max(1, prefs.repeatEn); i++) {
      if (!alive()) return;
      await say(card.en, "en-US", prefs.rate - i * 0.04);
    }

    if (prefs.includePt) {
      if (!alive()) return;
      await say(pt || "Tradução indisponível", "pt-BR", 1.02);
      if (!alive()) return;
      await say(card.en, "en-US", prefs.rate - 0.02);
    }

    if (!alive()) return;
    await wait(prefs.gapMs);
    if (!alive()) return;

    const next = pickSequentialAutoReadCard(1);
    if (!next || next.en === card.en) {
      autoReadToken += 1;
      setTimeout(() => guidedReading(card), 200);
      return;
    }
    loadSentence(next);
  }

  /* ── Controles ────────────────────────────────────────────── */

  function step(dir) {
    const card = pickSequentialAutoReadCard(dir);
    if (!card) return;
    state.paused = false;
    stopSpeaking();
    autoReadToken += 1;
    loadSentence(card);
    if (!autoReadMode) setTimeout(() => guidedReading(card), 150);
  }

  function repeat() {
    if (!currentCard) return;
    state.paused = false;
    stopSpeaking();
    autoReadToken += 1;
    setTimeout(() => guidedReading(currentCard), 120);
  }

  function pause() {
    state.paused = true;
    stopSpeaking();
    try { if (keepEl) keepEl.pause(); } catch {}
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
    setTimeout(() => guidedReading(currentCard), 120);
    renderStatus();
    renderPocketButtons();
  }

  /* ── Start / Stop (substituem startNoSleep / stopNoSleep) ── */

  function start() {
    loadPrefs();
    state.running = true;
    state.paused = false;
    state.mp3Broken = false;

    unlock();
    bindMediaControls();
    try { if (keepEl) keepEl.play().catch(() => {}); } catch {}

    if (prefs.screenOff) {
      try { if (typeof releaseWakeLock === "function") releaseWakeLock(); } catch {}
    }

    if (heartbeat) clearInterval(heartbeat);
    heartbeat = setInterval(() => {
      if (!state.running || state.paused) return;
      // A âncora de mídia às vezes é pausada pelo sistema. Reergue.
      try { if (keepEl && keepEl.paused) keepEl.play().catch(() => {}); } catch {}
      try { if (window.speechSynthesis.paused) window.speechSynthesis.resume(); } catch {}
      // Nada tocando e nada na fila = ciclo morreu. Reinicia.
      const idleTts = !window.speechSynthesis.speaking && !window.speechSynthesis.pending;
      const idleMp3 = !voiceEl || voiceEl.paused;
      if (autoReadMode && idleTts && idleMp3 && currentCard) {
        autoReadToken += 1;
        guidedReading(currentCard);
      }
    }, 4000);

    renderStatus();
  }

  function stop() {
    state.running = false;
    state.paused = false;
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    stopSpeaking();
    try { if (keepEl) { keepEl.pause(); } } catch {}
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

  /* ── Status na tela ───────────────────────────────────────── */

  function renderStatus() {
    const box = document.getElementById("walkEngineStatus");
    if (!box) return;

    const canal = state.mp3Broken
      ? "voz do sistema (MP3 indisponível agora)"
      : prefs.voice === "tts" ? "voz do sistema"
      : prefs.voice === "mp3" ? "voz MP3"
      : "voz MP3 com fallback automático";

    const tela = prefs.screenOff
      ? "a tela pode apagar: o áudio segue pela sessão de mídia"
      : "a tela fica acesa (Wake Lock)";

    box.innerHTML = state.running
      ? `<strong>Caminhada ativa.</strong> Canal: ${canal}. Agora ${tela}. Controles disponíveis na tela de bloqueio e no fone.`
      : `Caminhada pronta. Configuração atual: ${canal}; ${tela}.`;

    const sw = document.getElementById("walkScreenOff");
    if (sw) sw.checked = !!prefs.screenOff;
    const vs = document.getElementById("walkVoiceSelect");
    if (vs) vs.value = prefs.voice;
    const rp = document.getElementById("walkRepeatSelect");
    if (rp) rp.value = String(prefs.repeatEn);
    const pt = document.getElementById("walkIncludePt");
    if (pt) pt.checked = !!prefs.includePt;
  }

  /* ── Ligações com o app.js (composição, sem editar o arquivo) */

  function install() {
    loadPrefs();

    window.requestWakeLock = async function () {
      if (prefs.screenOff) {
        renderStatus();
        return false;
      }
      return originals.requestWakeLock ? originals.requestWakeLock() : false;
    };

    window.startNoSleep = start;
    window.stopNoSleep = stop;
    window.playGuidedReading = guidedReading;

    // Desbloqueio de áudio no primeiro toque, em fase de captura,
    // antes de qualquer await quebrar o gesto do usuário.
    const onFirstTouch = () => unlock();
    document.addEventListener("pointerdown", onFirstTouch, { capture: true, once: true });
    document.addEventListener("click", onFirstTouch, { capture: true, once: true });

    document.addEventListener("DOMContentLoaded", wireUi);
    if (document.readyState !== "loading") wireUi();
  }

  function wireUi() {
    const bind = (id, ev, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(ev, fn);
    };

    bind("walkScreenOff", "change", (e) => setPref("screenOff", e.target.checked));
    bind("walkIncludePt", "change", (e) => setPref("includePt", e.target.checked));
    bind("walkVoiceSelect", "change", (e) => {
      state.mp3Broken = false;
      setPref("voice", e.target.value);
    });
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
