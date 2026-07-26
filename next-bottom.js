/* ═══════════════════════════════════════════════════════════════
   NEXT BOTTOM — segundo botão de Próxima Frase
   Lousa da Fluência · Igarapé Digital

   O botão de avançar mora no topo, dentro da action-hero. Depois de
   montar a frase o polegar está na base da tela e o botão está fora
   do campo de visão: é preciso rolar para cima só para passar de
   frase. O gesto mais repetido do app é o mais caro.

   Este arquivo cria um SEGUNDO botão, dentro da barra do tabuleiro,
   à esquerda de "Ouvir de novo". O do topo permanece exatamente como
   está. O de baixo não reimplementa nada: dispara o clique do
   original, então toda a lógica do app.js (SRS, histórico, navegação,
   modo grupo, favoritas) continua valendo sem duplicação.

   Detalhe de ordem: a barra do tabuleiro não existe no index.html —
   é criada pelo ux-mobile.js dentro do setupBoard, ou seja, só depois
   que a primeira frase carrega. Por isso a inserção espera a barra
   aparecer em vez de assumir que ela já está no DOM.

   Visibilidade espelhada: enquanto o app.js mantém o nextBtn oculto
   (antes de carregar as frases), este também fica oculto. Um
   observador de atributos acompanha o original em vez de adivinhar.

   Não altera app.js, bridge-mode.js nem ux-mobile.js.
   Deve ser o último script carregado, depois de data-loader.js.
═══════════════════════════════════════════════════════════════ */

window.NextBottom = (function () {
  "use strict";

  /* ── AJUSTE AQUI O LUGAR DO BOTÃO ─────────────────────────────
     Troque apenas o valor de ANCORA por uma das quatro opções:

     "tabuleiro" → na barra do tabuleiro, à esquerda de
                   "Ouvir de novo".  ← padrão, o ponto marcado
     "audio"     → dentro da fileira Ouvir em Inglês / Revelar /
                   Ouvir em Português, como quarto botão.
     "pos-audio" → logo abaixo daquela fileira, em bloco próprio
                   e largura inteira.
     "feedback"  → abaixo do painel de frase concluída.
  ─────────────────────────────────────────────────────────────── */
  const ANCORA = "tabuleiro";

  const ID = "nextBtnBottom";

  /* ── Estilo ───────────────────────────────────────────────── */

  const CSS = `
    .next-bottom-wrap { display: none; margin-top: 14px; }
    .next-bottom-wrap.is-on { display: block; }

    .next-bottom-wrap #${ID} {
      width: 100%;
      min-height: 52px;
      justify-content: center;
      font-size: 0.95rem;
    }

    /* Dentro da fileira de áudio o botão divide a linha com os demais */
    #audio-controls > #${ID} {
      min-height: 46px;
      flex: 1 1 180px;
      justify-content: center;
    }

    /* Pílula da barra do tabuleiro: mesma altura e mesmo raio dos
       vizinhos, para não quebrar o alinhamento da linha. */
    .board-bar #${ID}.next-pill {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-height: 40px;
      padding: 8px 16px;
      font-family: var(--font-body);
      font-size: 0.78rem;
      font-weight: 700;
      color: #fff;
      background: var(--blue);
      border: 0;
      border-radius: var(--r-pill);
      cursor: pointer;
      box-shadow: var(--sh-blue, 0 4px 14px rgba(59, 130, 246, 0.32));
      transition: all var(--t, 0.16s) var(--ease, ease);
    }
    .board-bar #${ID}.next-pill:active { transform: scale(0.95); }

    /* Em tela estreita a barra passa a duas linhas em vez de espremer
       os três botões até o texto sumir. */
    @media (max-width: 720px) {
      .board-bar { flex-wrap: wrap; row-gap: 10px; }
      .board-bar-actions { flex: 1 1 100%; justify-content: flex-end; }
    }

    @media (prefers-reduced-motion: reduce) {
      .board-bar #${ID}.next-pill { transition: none; }
    }
  `;

  function injectCss() {
    if (document.getElementById("nextBottomCss")) return;
    const tag = document.createElement("style");
    tag.id = "nextBottomCss";
    tag.textContent = CSS;
    document.head.appendChild(tag);
  }

  /* ── Montagem ─────────────────────────────────────────────── */

  function origem() {
    return document.getElementById("nextBtn");
  }

  function alvo() {
    switch (ANCORA) {
      case "audio":
        return { no: document.getElementById("audio-controls"), modo: "dentro" };
      case "feedback":
        return { no: document.getElementById("feedback"), modo: "depois" };
      case "pos-audio":
        return { no: document.getElementById("audio-controls"), modo: "depois" };
      case "tabuleiro":
      default:
        return {
          no: document.querySelector(".board-bar .board-bar-actions"),
          modo: "inicio"
        };
    }
  }

  function criar() {
    const existente = document.getElementById(ID);
    if (existente) return existente;

    const destino = alvo();
    if (!destino.no) return null;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = ID;
    btn.className = ANCORA === "tabuleiro" ? "next-pill" : "btn btn-primary";
    btn.innerHTML = '<i class="fa fa-forward"></i> Próxima';
    btn.setAttribute("aria-label", "Próxima frase");
    btn.addEventListener("click", avancar);

    if (destino.modo === "inicio") {
      // Antes de "Ouvir de novo": é o ponto vazio da barra.
      destino.no.insertBefore(btn, destino.no.firstChild);
      return btn;
    }

    if (destino.modo === "dentro") {
      destino.no.appendChild(btn);
      return btn;
    }

    // Fora de um contêiner existente o botão ganha invólucro próprio,
    // que é quem controla a visibilidade e a margem.
    const wrap = document.createElement("div");
    wrap.className = "next-bottom-wrap";
    wrap.id = "nextBottomWrap";
    wrap.appendChild(btn);
    destino.no.insertAdjacentElement("afterend", wrap);
    return btn;
  }

  /* ── Ação ─────────────────────────────────────────────────── */

  function avancar() {
    const top = origem();
    if (!top) return;

    // Fecha a folha de ações se estiver aberta: avançar de frase com
    // o menu por cima do tabuleiro esconde justamente o que interessa.
    try {
      const painel = document.getElementById("secondaryActions");
      if (painel && painel.classList.contains("open") && window.UxMobile) {
        window.UxMobile.setMenu(false);
      }
    } catch {}

    try { if (navigator.vibrate) navigator.vibrate(12); } catch {}

    top.click();

    // Na barra do tabuleiro o botão já está na altura do quadro:
    // rolar seria movimento gratuito. Nas outras âncoras, não.
    if (ANCORA !== "tabuleiro") {
      try {
        const board = document.querySelector(".board");
        if (board && window.innerWidth <= 720) {
          board.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      } catch {}
    }
  }

  /* ── Visibilidade espelhada ───────────────────────────────── */

  function sincronizar() {
    const top = origem();
    const btn = document.getElementById(ID);
    if (!top || !btn) return;

    const visivel = top.style.display !== "none";
    const wrap = document.getElementById("nextBottomWrap");

    if (wrap) wrap.classList.toggle("is-on", visivel);
    else btn.style.display = visivel ? "inline-flex" : "none";
  }

  let observador = null;

  function observar() {
    const top = origem();
    if (!top || observador) return;
    observador = new MutationObserver(sincronizar);
    observador.observe(top, { attributes: true, attributeFilter: ["style", "class"] });
  }

  /* ── Início ───────────────────────────────────────────────── */

  function fixar() {
    const btn = criar();
    if (!btn) return false;
    observar();
    sincronizar();
    return true;
  }

  function boot() {
    injectCss();
    if (fixar()) return;

    // A barra do tabuleiro só nasce quando a primeira frase carrega.
    // Em vez de intervalo cego, observamos o corpo até ela existir.
    const espera = new MutationObserver(() => {
      if (fixar()) espera.disconnect();
    });
    espera.observe(document.body, { childList: true, subtree: true });

    // Rede de segurança: se em dois minutos nada aparecer, para de olhar.
    setTimeout(() => espera.disconnect(), 120000);
  }

  document.addEventListener("DOMContentLoaded", boot);
  if (document.readyState !== "loading") boot();

  return { avancar, sincronizar, criar, get ancora() { return ANCORA; } };
})();
