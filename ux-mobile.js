/* ═══════════════════════════════════════════════════════════════
   UX MOBILE — Menu agrupado e tabuleiro de toque
   Lousa da Fluência · Igarapé Digital

   Dois problemas atacados, ambos verificados no código atual:

   A) "Mais ações" abre uma parede de treze controles sem hierarquia,
      num grid único. No celular isso vira rolagem cega. Aqui os
      botões são REALOCADOS em grupos nomeados — os nós de DOM são
      movidos, não recriados, então todos os listeners do app.js
      continuam valendo. Em tela pequena o painel vira folha inferior.

   B) O tabuleiro depende de arrastar, que o HTML5 não entrega em
      toque. O Modo Ponte já tinha toque, mas só dentro dele e só se
      a preferência estivesse ligada. Aqui o toque passa a ser o
      caminho padrão em qualquer modo, com alvo seguinte destacado,
      contador de progresso, botão desfazer e resposta tátil.

   Não altera app.js. Deve ser carregado DEPOIS de bridge-mode.js.
═══════════════════════════════════════════════════════════════ */

window.UxMobile = (function () {
  "use strict";

  const originals = {
    setupBoard: window.setupBoard,
    checkComplete: window.checkComplete,
    setSecondaryMenu: window.setSecondaryMenu
  };

  /* ── Grupos do menu ───────────────────────────────────────── */

  const GROUPS = [
    {
      key: "treino",
      label: "Treino",
      icon: "fa-dumbbell",
      ids: ["reviewNowBtn", "trainWorstBtn", "trainFavoritesBtn", "groupModeBtn", "favoriteBtn", "newOnlyToggleWrap"]
    },
    {
      key: "audio",
      label: "Áudio e caminhada",
      icon: "fa-headphones",
      ids: ["autoReadBtn", "walkModeBtn", "pocketModeBtn"]
    },
    {
      key: "modos",
      label: "Modos de estudo",
      icon: "fa-shapes",
      ids: ["speakModeBtn", "patternModeBtn", "bridgeModeBtn"]
    },
    {
      key: "dados",
      label: "Dados",
      icon: "fa-database",
      ids: ["clearBtn", "storageManagerBtn"]
    }
  ];

  function buildMenu() {
    const panel = document.getElementById("secondaryActions");
    if (!panel || panel.dataset.grouped === "1") return;

    const head = document.createElement("div");
    head.className = "sheet-head";
    head.innerHTML = `
      <span class="sheet-grip" aria-hidden="true"></span>
      <span class="sheet-title">Mais ações</span>
      <button type="button" class="sheet-close" id="sheetCloseBtn" aria-label="Fechar">
        <i class="fa fa-times"></i>
      </button>
    `;
    panel.appendChild(head);

    GROUPS.forEach((g) => {
      const items = g.ids
        .map((id) => document.getElementById(id))
        .filter(Boolean);
      if (!items.length) return;

      const sec = document.createElement("section");
      sec.className = "sheet-group";
      sec.dataset.group = g.key;

      const title = document.createElement("h4");
      title.className = "sheet-group-title";
      title.innerHTML = `<i class="fa ${g.icon}"></i> ${g.label}`;
      sec.appendChild(title);

      const grid = document.createElement("div");
      grid.className = "sheet-grid";
      // Move o nó original: preserva onclick e addEventListener do app.js.
      items.forEach((el) => grid.appendChild(el));
      sec.appendChild(grid);

      panel.appendChild(sec);
    });

    // Opções de caminhada e de ponte vão para dentro do grupo de áudio
    // e do grupo de modos, e não ficam mais soltas na tela principal.
    const audioSec = panel.querySelector('[data-group="audio"]');
    const walkOpts = document.getElementById("walkOptions");
    const walkStatus = document.getElementById("walkEngineStatus");
    const walkLegacy = document.getElementById("walkStatus");
    if (audioSec) {
      if (walkOpts) audioSec.appendChild(walkOpts);
      if (walkStatus) audioSec.appendChild(walkStatus);
      if (walkLegacy) walkLegacy.style.display = "none";
    }

    const modeSec = panel.querySelector('[data-group="modos"]');
    const bridgeOpts = document.getElementById("bridgeOptions");
    if (modeSec && bridgeOpts) modeSec.appendChild(bridgeOpts);

    panel.dataset.grouped = "1";
    panel.classList.add("action-sheet");

    const close = document.getElementById("sheetCloseBtn");
    if (close) close.addEventListener("click", () => setMenu(false));

    let backdrop = document.getElementById("sheetBackdrop");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = "sheetBackdrop";
      backdrop.className = "sheet-backdrop";
      document.body.appendChild(backdrop);
      backdrop.addEventListener("click", () => setMenu(false));
    }
  }

  function setMenu(open) {
    const panel = document.getElementById("secondaryActions");
    const btn = document.getElementById("menuToggleBtn");
    const backdrop = document.getElementById("sheetBackdrop");
    if (!panel) return;

    panel.style.display = open ? "block" : "none";
    panel.classList.toggle("open", !!open);
    if (backdrop) backdrop.classList.toggle("open", !!open);
    document.body.classList.toggle("sheet-open", !!open);

    if (btn) {
      btn.classList.toggle("menu-open", !!open);
      btn.innerHTML = open
        ? '<i class="fa fa-chevron-down"></i> Ocultar'
        : '<i class="fa fa-sliders-h"></i> Mais ações';
    }
  }

  /* ── Tabuleiro ────────────────────────────────────────────── */

  function buzz(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch {}
  }

  function slots() {
    return [...document.querySelectorAll(".slot")];
  }

  function firstEmptySlot() {
    return slots().find((s) => !s.querySelector(".word")) || null;
  }

  function bridgeHandlesTap() {
    return !!(window.BridgeMode &&
              window.BridgeMode.prefs &&
              window.BridgeMode.prefs.tapToPlace);
  }

  function returnToBank(el) {
    const bank = document.getElementById("word-bank");
    if (!bank || !el) return;
    bank.appendChild(el);
    el.onclick = () => placeByTap(el);
    refreshBoard();
  }

  function placeByTap(el) {
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
      buzz(12);
      checkComplete();
      refreshBoard();
    } else {
      cardHadError = true;
      logErrorEvent(correct, el.textContent, idx);
      el.classList.add("incorrect");
      setTimeout(() => el.classList.remove("incorrect"), 500);
      buzz([25, 40, 25]);
      maybeAutoSkipOnStuck();
    }
  }

  function wireTapFallback() {
    // Se o Modo Ponte já cuidou do toque, não duplica handler.
    if (bridgeHandlesTap()) return;

    const bank = document.getElementById("word-bank");
    if (!bank) return;

    bank.querySelectorAll(".word").forEach((el) => {
      el.classList.add("tappable");
      el.onclick = () => placeByTap(el);
    });
    document.querySelectorAll(".slot .word").forEach((el) => {
      el.classList.add("tappable");
      el.onclick = () => returnToBank(el);
    });
  }

  function undoLast() {
    const filled = slots().filter((s) => s.querySelector(".word"));
    if (!filled.length) return;
    const last = filled[filled.length - 1];
    const word = last.querySelector(".word");
    buzz(10);
    returnToBank(word);
  }

  function ensureBoardBar() {
    const board = document.querySelector(".board");
    if (!board || document.getElementById("boardBar")) return;

    const bar = document.createElement("div");
    bar.id = "boardBar";
    bar.className = "board-bar";
    bar.innerHTML = `
      <span class="board-progress" id="boardProgress">0 de 0</span>
      <span class="board-bar-actions">
        <button type="button" class="board-replay" id="boardReplayBtn">
          <i class="fa fa-volume-up"></i> Ouvir de novo
        </button>
        <button type="button" class="board-undo" id="boardUndoBtn">
          <i class="fa fa-delete-left"></i> Desfazer
        </button>
      </span>
    `;
    board.appendChild(bar);
    document.getElementById("boardUndoBtn").addEventListener("click", undoLast);
    document.getElementById("boardReplayBtn").addEventListener("click", () => sayEnglish(0.9));
  }

  /* ── Seta lateral de avanço ───────────────────────────────────
     O botão "Próxima Frase" mora no topo. Depois de montar a frase
     ele está fora do campo de visão, e o gesto mais repetido do app
     custa uma rolagem inteira só para ser alcançado.

     A seta abaixo fica presa à borda direita do tabuleiro: o olho já
     está ali quando a frase fecha, então o atalho nasce onde a
     atenção termina. Não reimplementa navegação — dispara o botão
     original, que carrega toda a lógica de SRS, histórico e grupo.
  ─────────────────────────────────────────────────────────────── */

  function ensureNextArrow() {
    const board = document.querySelector(".board");
    if (!board) return null;

    let arrow = document.getElementById("nextArrow");
    if (arrow) {
      // O tabuleiro pode ser remontado: garante que a seta continue dentro.
      if (arrow.parentElement !== board) board.appendChild(arrow);
      return arrow;
    }

    arrow = document.createElement("button");
    arrow.type = "button";
    arrow.id = "nextArrow";
    arrow.className = "next-arrow";
    arrow.setAttribute("aria-label", "Próxima frase");
    arrow.setAttribute("title", "Próxima frase");
    arrow.innerHTML = '<i class="fa fa-chevron-right"></i>';
    arrow.addEventListener("click", () => {
      const top = document.getElementById("nextBtn");
      if (!top) return;
      buzz(12);
      setMenu(false);
      top.click();
    });
    board.appendChild(arrow);
    return arrow;
  }

  // O tabuleiro reserva a faixa da seta. Sem isto o último quadrado
  // encosta nela e o botão parece um defeito de sobreposição.
  function reserveArrowSpace(on) {
    const board = document.querySelector(".board");
    if (board) board.classList.toggle("has-next-arrow", !!on);
  }

  // Só faz sentido enquanto houver frases carregadas: o app.js mantém
  // o botão do topo oculto até a carga terminar.
  function syncNextArrow() {
    const arrow = document.getElementById("nextArrow");
    const top = document.getElementById("nextBtn");
    if (!arrow || !top) return;
    const usavel = top.style.display !== "none";
    arrow.classList.toggle("is-on", usavel);
    reserveArrowSpace(usavel);
  }

  function arrowReady(on) {
    const arrow = document.getElementById("nextArrow");
    if (arrow) arrow.classList.toggle("is-ready", !!on);
  }

  /* ── Fala ao concluir ─────────────────────────────────────── */

  let solvedFor = null;   // frase que já teve o áudio de conclusão

  // O Modo Ponte já fala o inglês ao concluir. Não duplica.
  function bridgeSpeaksOnSolve() {
    return !!(window.BridgeMode &&
              window.BridgeMode.prefs &&
              window.BridgeMode.prefs.active);
  }

  function sayEnglish(rate) {
    if (!textEn) return;
    try { speak(textEn, "en-US", rate || 0.95); } catch {}
  }

  function onSolved() {
    const board = document.querySelector(".board");
    if (board) board.classList.add("solved");
    slots().forEach((s) => s.classList.add("slot-done"));
    buzz([14, 50, 14, 50, 20]);
    arrowReady(true);

    if (solvedFor === textEn) return;
    solvedFor = textEn;

    // Na leitura guiada e na caminhada o motor de áudio já comanda a fala.
    if (typeof autoReadMode !== "undefined" && autoReadMode) return;
    if (bridgeSpeaksOnSolve()) return;

    setTimeout(() => sayEnglish(0.95), 160);
  }

  // Destaca o próximo quadrado a receber palavra e atualiza o contador.
  function refreshBoard() {
    const all = slots();
    const filled = all.filter((s) => s.querySelector(".word")).length;
    const done = all.length > 0 && filled === all.length;

    all.forEach((s) => s.classList.remove("slot-next"));
    if (!done) {
      all.forEach((s) => s.classList.remove("slot-done"));
      const board = document.querySelector(".board");
      if (board) board.classList.remove("solved");
      const next = firstEmptySlot();
      if (next) next.classList.add("slot-next");
    }

    const prog = document.getElementById("boardProgress");
    if (prog) {
      prog.textContent = done ? `${filled} de ${all.length} · concluída` : `${filled} de ${all.length}`;
      prog.classList.toggle("is-done", done);
    }

    const undo = document.getElementById("boardUndoBtn");
    if (undo) undo.disabled = filled === 0;

    const replay = document.getElementById("boardReplayBtn");
    if (replay) replay.style.display = done ? "inline-flex" : "none";
  }

  // O contador ficava defasado porque nem todo caminho que move uma
  // palavra passa pelo checkComplete: o returnToBank do Modo Ponte,
  // por exemplo, não passa. Observar o tabuleiro elimina a classe
  // inteira do problema em vez de remendar cada caminho.
  let boardObserver = null;

  function watchBoard() {
    const zone = document.getElementById("slots");
    if (!zone) return;
    if (boardObserver) boardObserver.disconnect();
    // Só childList: mudança de classe é atributo, então não há laço.
    boardObserver = new MutationObserver(() => {
      try { refreshBoard(); } catch {}
    });
    boardObserver.observe(zone, { childList: true, subtree: true });
  }

  function decorateBoard() {
    solvedFor = null;
    ensureBoardBar();
    ensureNextArrow();
    arrowReady(false);
    syncNextArrow();
    wireTapFallback();
    watchBoard();
    refreshBoard();
  }

  /* ── Instalação por composição ────────────────────────────── */

  function install() {
    window.setupBoard = function () {
      originals.setupBoard.apply(this, arguments);
      try { decorateBoard(); } catch (e) { console.warn("UxMobile:", e); }
    };

    window.checkComplete = function () {
      const fb = document.getElementById("feedback");
      const before = fb ? fb.style.display : "";
      const r = originals.checkComplete.apply(this, arguments);
      const after = fb ? fb.style.display : "";
      try { refreshBoard(); } catch {}
      // O painel de feedback só aparece quando a frase fecha inteira:
      // é o sinal confiável de conclusão, melhor que contar quadrados.
      if (after === "block" && before !== "block") {
        try { onSolved(); } catch (e) { console.warn("UxMobile:", e); }
      }
      return r;
    };

    window.setSecondaryMenu = setMenu;

    const boot = () => {
      buildMenu();
      setMenu(false);

      const toggle = document.getElementById("menuToggleBtn");
      if (toggle) {
        // Substitui o handler do app.js, que usava display grid.
        toggle.onclick = null;
        toggle.addEventListener("click", () => {
          const panel = document.getElementById("secondaryActions");
          setMenu(!panel.classList.contains("open"));
        });
      }

      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") setMenu(false);
        if (e.key === "Backspace" && !/INPUT|TEXTAREA/.test(e.target.tagName)) {
          e.preventDefault();
          undoLast();
        }
      });

      decorateBoard();

      // A carga das frases revela o botão do topo depois do boot:
      // observar o atributo mantém a seta em sincronia sem sondagem.
      const top = document.getElementById("nextBtn");
      if (top) {
        new MutationObserver(syncNextArrow)
          .observe(top, { attributes: true, attributeFilter: ["style"] });
      }
    };

    document.addEventListener("DOMContentLoaded", boot);
    if (document.readyState !== "loading") boot();
  }

  install();

  return { setMenu, undoLast, refreshBoard, buildMenu, syncNextArrow };
})();
