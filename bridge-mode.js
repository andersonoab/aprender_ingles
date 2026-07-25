/* ═══════════════════════════════════════════════════════════════
   BRIDGE MODE — Modo Ponte PT → EN
   Lousa da Fluência · Igarapé Digital

   O tabuleiro original entrega as palavras em inglês embaralhadas:
   você reconhece a frase e reordena. É reconhecimento, não produção.

   O Modo Ponte inverte o vetor. A frase em português aparece em tela
   como enunciado, o inglês fica oculto, e você monta a tradução
   arrastando ou tocando as palavras. Isso força recuperação ativa,
   que é o mecanismo que efetivamente move frase para fala espontânea.

   Também adiciona:
   - Toque para posicionar (drag-and-drop HTML5 não funciona em toque).
   - Distratores: palavras extras que não pertencem à frase.
   - Áudio invertido: ao carregar, fala o português, não o inglês.

   Não altera app.js. Sobrescreve funções globais por composição.
═══════════════════════════════════════════════════════════════ */

window.BridgeMode = (function () {
  "use strict";

  const PREF_KEY = "bridgeMode_v1";

  const defaults = {
    active: false,
    distractors: 2,   // 0 | 2 | 4
    tapToPlace: true  // toque para posicionar (essencial no celular)
  };

  let prefs = Object.assign({}, defaults);
  let revealedThisCard = false;
  let suppressEnUntil = 0;

  const originals = {
    setupBoard: window.setupBoard,
    setPlayAudioHandlers: window.setPlayAudioHandlers,
    checkComplete: window.checkComplete,
    speak: window.speak
  };

  /* ── Preferências ─────────────────────────────────────────── */

  function loadPrefs() {
    try {
      prefs = Object.assign({}, defaults, JSON.parse(localStorage.getItem(PREF_KEY) || "{}"));
    } catch {
      prefs = Object.assign({}, defaults);
    }
  }

  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {}
  }

  /* ── Distratores ──────────────────────────────────────────── */

  let vocabCache = null;
  let vocabSourceLen = -1;

  function buildVocab() {
    if (vocabCache && vocabSourceLen === sentences.length) return vocabCache;
    const set = new Set();
    for (const s of sentences) {
      for (const w of String(s.en || "").split(/\s+/)) {
        const clean = w.trim();
        if (clean && clean.length > 1) set.add(clean);
      }
    }
    vocabCache = [...set];
    vocabSourceLen = sentences.length;
    return vocabCache;
  }

  function pickDistractors(count) {
    if (!count || !sentences.length) return [];
    const vocab = buildVocab();
    if (vocab.length < 20) return [];

    const banned = new Set(currentWords.map((w) => w.toLowerCase()));
    const avgLen = Math.round(
      currentWords.reduce((a, w) => a + w.length, 0) / Math.max(1, currentWords.length)
    );

    const out = [];
    let guard = 0;
    while (out.length < count && guard < 400) {
      guard++;
      const w = vocab[Math.floor(Math.random() * vocab.length)];
      const low = w.toLowerCase();
      if (banned.has(low)) continue;
      if (Math.abs(w.length - avgLen) > 4) continue;
      banned.add(low);
      out.push(w);
    }
    return out;
  }

  /* ── Enunciado em português ───────────────────────────────── */

  async function renderPrompt() {
    const box = document.getElementById("bridgePrompt");
    if (!box) return;

    if (!prefs.active || !currentCard) {
      box.style.display = "none";
      box.innerHTML = "";
      return;
    }

    box.style.display = "block";
    box.innerHTML = `
      <div class="bridge-eyebrow">Traduza para o inglês</div>
      <div class="bridge-pt" id="bridgePtText">Carregando enunciado…</div>
      <div class="bridge-actions">
        <button class="bridge-btn" id="bridgeHearPt"><i class="fa fa-headphones"></i> Ouvir em português</button>
        <button class="bridge-btn bridge-btn-ghost" id="bridgeReveal"><i class="fa fa-eye"></i> Ver a resposta</button>
      </div>
      <div class="bridge-answer" id="bridgeAnswer"></div>
    `;

    const pt = await getPtTranslationForCard(currentCard);
    const target = document.getElementById("bridgePtText");
    if (target) target.textContent = pt || "Tradução indisponível";

    const hear = document.getElementById("bridgeHearPt");
    if (hear) hear.onclick = () => originals.speak(pt, "pt-BR", 1.05);

    const reveal = document.getElementById("bridgeReveal");
    if (reveal) reveal.onclick = () => revealAnswer();
  }

  function revealAnswer() {
    revealedThisCard = true;
    cardHadError = true; // resposta vista não conta como acerto limpo
    const box = document.getElementById("bridgeAnswer");
    if (box) {
      box.style.display = "block";
      box.innerHTML = `<span class="bridge-answer-label">EN</span> ${textEn}`;
    }
    originals.speak(textEn, "en-US", 0.95);
  }

  /* ── Toque para posicionar ────────────────────────────────── */

  function firstEmptySlot() {
    return [...document.querySelectorAll(".slot")].find((s) => !s.querySelector(".word")) || null;
  }

  function flashWrong(el) {
    el.classList.add("incorrect");
    setTimeout(() => el.classList.remove("incorrect"), 500);
  }

  function placeByTap(el) {
    // Palavra que já está num quadrado (inclusive posicionada por
    // arrasto nativo) volta para o banco em vez de duplicar posição.
    if (el.parentElement && el.parentElement.classList.contains("slot")) {
      returnToBank(el);
      return;
    }

    const slot = firstEmptySlot();
    if (!slot) return;

    const idx = parseInt(slot.dataset.index, 10);
    const correct = currentWords[idx];

    if (el.textContent === correct) {
      slot.appendChild(el);
      el.onclick = () => returnToBank(el);
      checkComplete();
    } else {
      cardHadError = true;
      logErrorEvent(correct, el.textContent, idx);
      flashWrong(el);
      maybeAutoSkipOnStuck();
    }
  }

  function returnToBank(el) {
    const bank = document.getElementById("word-bank");
    if (!bank) return;
    bank.appendChild(el);
    el.onclick = () => placeByTap(el);
  }

  function wireTap() {
    if (!prefs.tapToPlace) return;
    const bank = document.getElementById("word-bank");
    if (!bank) return;

    bank.querySelectorAll(".word").forEach((el) => {
      el.classList.add("tappable");
      el.onclick = () => placeByTap(el);
    });

    document.querySelectorAll(".slot .word").forEach((el) => {
      el.onclick = () => returnToBank(el);
    });
  }

  /* ── Decoração do tabuleiro ───────────────────────────────── */

  function decorate() {
    const bank = document.getElementById("word-bank");
    const label = document.querySelector(".board p");

    document.body.classList.toggle("bridge-on", !!prefs.active);
    revealedThisCard = false;

    if (label) {
      label.textContent = prefs.active
        ? "Monte a frase em inglês: toque ou arraste as palavras."
        : "Arraste as palavras para os quadrados:";
    }

    if (prefs.active && bank && prefs.distractors > 0) {
      pickDistractors(prefs.distractors).forEach((w) => {
        const el = document.createElement("div");
        el.className = "word";
        el.textContent = w;
        el.draggable = true;
        el.dataset.distractor = "1";
        el.ondragstart = () => { dragged = el; };
        bank.appendChild(el);
      });
      // Reembaralha para o distrator não ficar sempre no fim.
      [...bank.children]
        .sort(() => 0.5 - Math.random())
        .forEach((n) => bank.appendChild(n));
    }

    wireTap();

    if (prefs.active) {
      suppressEnUntil = Date.now() + 1200; // bloqueia o áudio automático em inglês
      renderPrompt();
    } else {
      const box = document.getElementById("bridgePrompt");
      if (box) { box.style.display = "none"; box.innerHTML = ""; }
    }
  }

  /* ── Botão e preferências na interface ────────────────────── */

  function updateButton() {
    const btn = document.getElementById("bridgeModeBtn");
    if (btn) {
      btn.innerHTML = prefs.active
        ? '<i class="fa fa-language"></i> Sair do Modo Ponte'
        : '<i class="fa fa-language"></i> Modo Ponte PT→EN';
      btn.classList.toggle("btn-active-mode", prefs.active);
    }
    const opts = document.getElementById("bridgeOptions");
    if (opts) opts.style.display = prefs.active ? "flex" : "none";
    const sel = document.getElementById("bridgeDistractors");
    if (sel) sel.value = String(prefs.distractors);
    const tap = document.getElementById("bridgeTapToggle");
    if (tap) tap.checked = !!prefs.tapToPlace;
  }

  function toggle() {
    prefs.active = !prefs.active;
    savePrefs();
    updateButton();
    if (currentCard) {
      setupBoard();
      setPlayAudioHandlers();
    }
  }

  function setPref(key, value) {
    prefs[key] = value;
    savePrefs();
    updateButton();
    if (currentCard) setupBoard();
  }

  /* ── Instalação por composição ────────────────────────────── */

  function install() {
    loadPrefs();

    window.setupBoard = function () {
      originals.setupBoard.apply(this, arguments);
      try { decorate(); } catch (e) { console.warn("BridgeMode:", e); }
    };

    window.setPlayAudioHandlers = function () {
      originals.setPlayAudioHandlers.apply(this, arguments);
      const en = document.getElementById("playAudioEn");
      if (en) {
        const inner = en.onclick;
        en.onclick = () => {
          suppressEnUntil = 0;      // pedido explícito do usuário sempre passa
          revealedThisCard = true;
          if (prefs.active) cardHadError = true;
          inner && inner();
        };
      }
    };

    window.checkComplete = function () {
      const before = document.getElementById("feedback").style.display;
      originals.checkComplete.apply(this, arguments);
      const after = document.getElementById("feedback").style.display;
      if (prefs.active && after === "block" && before !== "block") {
        suppressEnUntil = 0;
        setTimeout(() => originals.speak(textEn, "en-US", 0.98), 150);
      }
    };

    // Ao carregar uma frase no Modo Ponte, o app fala o inglês por
    // padrão — isso entregaria a resposta. Trocamos pelo português.
    window.speak = function (txt, lang = "en-US", rate = 1) {
      if (prefs.active && Date.now() < suppressEnUntil && String(lang).startsWith("en")) {
        const pt = (currentCard && currentCard.pt) || textPt;
        if (pt) return originals.speak(pt, "pt-BR", 1.05);
        return;
      }
      return originals.speak(txt, lang, rate);
    };

    document.addEventListener("DOMContentLoaded", wireUi);
    if (document.readyState !== "loading") wireUi();
  }

  function wireUi() {
    const btn = document.getElementById("bridgeModeBtn");
    if (btn) btn.addEventListener("click", toggle);

    const sel = document.getElementById("bridgeDistractors");
    if (sel) sel.addEventListener("change", (e) => setPref("distractors", parseInt(e.target.value, 10) || 0));

    const tap = document.getElementById("bridgeTapToggle");
    if (tap) tap.addEventListener("change", (e) => setPref("tapToPlace", e.target.checked));

    updateButton();
  }

  install();

  return {
    get prefs() { return prefs; },
    toggle, setPref, decorate, revealAnswer, updateButton
  };
})();
