/* ═══════════════════════════════════════════════════════════════
   BOARD UX — Correções de uso no tabuleiro
   Lousa da Fluência · Igarapé Digital

   Três problemas atacados aqui:

   1. A dica do quadrado só escrevia no atributo `title`, que no
      celular nunca aparece. Virou dica progressiva de verdade:
      primeira letra, metade da palavra, palavra inteira — e a
      revelação total marca o cartão como não-limpo.

   2. Oito modos podem estar ligados ao mesmo tempo e a precedência
      entre eles é implícita. O painel de modos ativos torna esse
      estado visível sem refatorar a lógica de seleção.

   3. As palavras não eram alcançáveis por teclado. Agora são,
      com Enter e Espaço, e com foco visível.

   Não altera app.js.
═══════════════════════════════════════════════════════════════ */

window.BoardUX = (function () {
  "use strict";

  const HINT_STAGES = 3;
  const hintLevel = new Map(); // índice do quadrado -> nível já revelado

  const originals = {
    setupBoard: window.setupBoard
  };

  /* ── Dica progressiva ─────────────────────────────────────── */

  function tipElement() {
    let el = document.getElementById("hintTip");
    if (!el) {
      el = document.createElement("div");
      el.id = "hintTip";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    return el;
  }

  function showTip(anchor, text, tone) {
    const el = tipElement();
    el.textContent = text;
    el.className = tone === "full" ? "show tone-full" : "show";

    const r = anchor.getBoundingClientRect();
    el.style.visibility = "hidden";
    el.style.display = "block";
    const w = el.offsetWidth;
    const h = el.offsetHeight;

    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(10, Math.min(left, window.innerWidth - w - 10));
    let top = r.top - h - 10;
    if (top < 8) top = r.bottom + 10;

    el.style.left = left + "px";
    el.style.top = top + "px";
    el.style.visibility = "visible";

    clearTimeout(showTip._t);
    showTip._t = setTimeout(() => el.classList.remove("show"), 3200);
  }

  function hintText(word, level) {
    if (level <= 1) return `Começa com "${word.slice(0, 1)}"`;
    if (level === 2) {
      const half = Math.max(2, Math.ceil(word.length / 2));
      return `${word.slice(0, half)}…  (${word.length} letras)`;
    }
    return word;
  }

  function wireHints() {
    document.querySelectorAll(".slot").forEach((slot) => {
      const hint = slot.querySelector(".hint");
      if (!hint) return;

      const idx = parseInt(slot.dataset.index, 10);
      hint.setAttribute("role", "button");
      hint.setAttribute("tabindex", "0");
      hint.setAttribute("aria-label", `Dica para a palavra ${idx + 1}`);

      const fire = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const word = currentWords[idx];
        if (!word) return;

        const level = Math.min(HINT_STAGES, (hintLevel.get(idx) || 0) + 1);
        hintLevel.set(idx, level);

        if (level >= HINT_STAGES) {
          // Palavra inteira revelada: deixa de ser acerto limpo.
          try { cardHadError = true; } catch {}
          hint.classList.add("hint-spent");
        }

        showTip(slot, hintText(word, level), level >= HINT_STAGES ? "full" : "");
      };

      hint.onclick = fire;
      hint.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") fire(e);
      };
    });
  }

  /* ── Teclado nas palavras ─────────────────────────────────── */

  function wireKeyboard() {
    document.querySelectorAll("#word-bank .word, .slot .word").forEach((el, i) => {
      el.setAttribute("tabindex", "0");
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", `Palavra ${el.textContent}`);
      el.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          el.click();
        }
      };
    });
  }

  /* ── Painel de modos ativos ───────────────────────────────── */

  const MODES = [
    { label: "Ponte PT→EN", read: () => !!(window.BridgeMode && BridgeMode.prefs.active), tone: "cyan" },
    { label: "Caminhada", read: () => !!walkMode, tone: "blue" },
    { label: "Leitura guiada", read: () => !!autoReadMode, tone: "blue" },
    { label: "Piores frases", read: () => trainMode === "worst", tone: "amber" },
    { label: "Só frases novas", read: () => !!newOnlyMode, tone: "green" },
    { label: "Favoritas", read: () => !!favoriteMode, tone: "amber" },
    { label: "Grupo focado", read: () => !!(typeof activeGroupId !== "undefined" && activeGroupId), tone: "green" },
    { label: "Modo falar", read: () => !!(appPrefs && appPrefs.speakMode), tone: "orange" }
  ];

  let lastSignature = "";

  function renderModes() {
    const box = document.getElementById("modeBadges");
    if (!box) return;

    const active = [];
    for (const m of MODES) {
      let on = false;
      try { on = !!m.read(); } catch {}
      if (on) active.push(m);
    }

    const signature = active.map((m) => m.label).join("|");
    if (signature === lastSignature) return;
    lastSignature = signature;

    if (!active.length) {
      box.innerHTML = "";
      box.classList.remove("show");
      return;
    }

    box.classList.add("show");
    box.innerHTML = active
      .map((m) => `<span class="mode-chip mode-${m.tone}">${m.label}</span>`)
      .join("");
  }

  /* ── Instalação ───────────────────────────────────────────── */

  function decorate() {
    hintLevel.clear();
    try { wireHints(); } catch (e) { console.warn("BoardUX hints:", e); }
    try { wireKeyboard(); } catch (e) { console.warn("BoardUX teclado:", e); }
    renderModes();
  }

  function install() {
    window.setupBoard = function () {
      originals.setupBoard.apply(this, arguments);
      decorate();
    };

    // Modos mudam por botões espalhados pelo app.js. Em vez de
    // interceptar cada um, o painel reconcilia o estado real.
    setInterval(renderModes, 1200);

    document.addEventListener("DOMContentLoaded", renderModes);
    if (document.readyState !== "loading") renderModes();
  }

  install();

  return { decorate, renderModes };
})();
