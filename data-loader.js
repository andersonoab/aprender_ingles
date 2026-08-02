/* ═══════════════════════════════════════════════════════════════
   DATA LOADER — carga de frases com diagnóstico
   Lousa da Fluência · Igarapé Digital

   Três defeitos verificados no carregamento atual:

   1) SILÊNCIO TOTAL EM CASO DE FALHA
      A cadeia do app.js é fetch().then().then() sem nenhum .catch()
      e sem checar res.ok. Se a resposta for 404, 403 ou se a rede
      cair, o texto de erro é tratado como se fosse o arquivo de
      frases e nada acontece na tela. Você não descobre o motivo
      porque não existe caminho para o motivo aparecer.

   2) CACHE DO GITHUB
      raw.githubusercontent.com serve por CDN com cache de alguns
      minutos. Depois de atualizar o arquivo no repositório, o
      navegador continua recebendo a versão antiga — inclusive
      guardada no cache dele próprio, que pode durar bem mais.
      Aqui a busca vai com carimbo de tempo e cache: "no-store".

   3) PARSER EXIGE ESPAÇO DOS DOIS LADOS DA BARRA
      parseTxtToSentences separa por " | " literal. Linhas do seu
      arquivo escritas como "Ask |perguntar" ou "Be |ser - estar."
      não têm espaço antes da barra, então não são reconhecidas como
      par: viram uma frase única em inglês com a barra dentro e sem
      tradução nenhuma. Aqui a separação aceita qualquer espaçamento.

   Também relata quantas linhas entraram, quantas foram descartadas
   por repetição e quantas ficaram sem tradução — o arquivo tem
   repetições reais, e é por isso que o total fica abaixo de mil.

   Não altera app.js. Deve ser o último script carregado.
═══════════════════════════════════════════════════════════════ */

window.DataLoader = (function () {
  "use strict";

  const URL_FRASES =
    "https://raw.githubusercontent.com/andersonoab/aprenderIngles/refs/heads/main/frases_unicas_1000.txt";

  // Cópia embutida, servida da própria origem. O service worker guarda
  // este arquivo, então ele funciona SEM internet. É o alicerce offline:
  // se a busca online falhar, caímos aqui e o drag-drop segue de pé.
  const URL_LOCAL = "./frases_unicas_1000.txt";

  const originals = {
    parse: window.parseTxtToSentences
  };

  /* ── Parser tolerante ─────────────────────────────────────── */

  // Aceita "en | pt", "en| pt", "en |pt" e "en|pt", além de tabulação.
  const PIPE = /\s*\|\s*/;

  function parse(txt) {
    const report = {
      linhas: 0,
      pares: 0,
      semTraducao: 0,
      duplicadas: 0,
      total: 0,
      exemplosSemTraducao: []
    };

    const clean = String(txt || "").replace(/^\uFEFF/, "");
    const lines = clean.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    report.linhas = lines.length;

    const parsed = [];
    for (const line of lines) {
      let en = "";
      let pt = "";

      if (line.indexOf("|") >= 0) {
        const parts = line.split(PIPE);
        en = (parts[0] || "").trim();
        pt = parts.slice(1).join(" | ").trim();
      } else if (line.indexOf("\t") >= 0) {
        const parts = line.split("\t");
        en = (parts[0] || "").trim();
        pt = parts.slice(1).join("\t").trim();
      } else {
        en = line;
      }

      if (!en) continue;
      if (pt) report.pares++;
      else {
        report.semTraducao++;
        if (report.exemplosSemTraducao.length < 5) {
          report.exemplosSemTraducao.push(en);
        }
      }
      parsed.push({ en, pt });
    }

    const seen = new Set();
    const unique = [];
    for (const s of parsed) {
      const key = s.en.toLowerCase();
      if (seen.has(key)) { report.duplicadas++; continue; }
      seen.add(key);
      unique.push(s);
    }

    report.total = unique.length;
    lastReport = report;
    return unique;
  }

  let lastReport = null;

  /* ── Painel de diagnóstico ────────────────────────────────── */

  function panel() {
    let el = document.getElementById("loaderReport");
    if (el) return el;
    const shell = document.querySelector(".control-shell");
    if (!shell) return null;
    el = document.createElement("div");
    el.id = "loaderReport";
    el.className = "loader-report";
    shell.appendChild(el);
    return el;
  }

  function say(html, kind) {
    const el = panel();
    if (!el) return;
    el.className = "loader-report loader-" + (kind || "info");
    el.innerHTML = html;
    el.style.display = "block";
  }

  function reportHtml(r) {
    const perdidas = r.linhas - r.total;
    let html =
      `<strong>${r.total} frases carregadas.</strong> ` +
      `${r.linhas} linhas no arquivo, ${r.duplicadas} repetidas descartadas`;
    if (r.semTraducao) html += `, ${r.semTraducao} sem tradução`;
    html += ".";
    if (perdidas > 0) {
      html += ` A diferença de ${perdidas} está nas repetições do próprio arquivo, não no carregamento.`;
    }
    if (r.exemplosSemTraducao.length) {
      html += `<br><span class="loader-sample">Sem tradução, por exemplo: ` +
              r.exemplosSemTraducao.map(esc).join(" · ") + `</span>`;
    }
    return html;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  /* ── Carga ────────────────────────────────────────────────── */

  function revealButtons() {
    [
      "nextBtn", "reviewNowBtn", "trainWorstBtn", "speakModeBtn",
      "patternModeBtn", "autoReadBtn", "walkModeBtn", "favoriteBtn",
      "trainFavoritesBtn", "clearBtn", "groupModeBtn"
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = "inline-flex";
    });
    const wrap = document.getElementById("newOnlyToggleWrap");
    if (wrap) wrap.style.display = "inline-flex";
    try { applyNewOnlyToggleUI(); } catch {}
  }

  function install(list) {
    sentences = list;
    window._sentences = sentences;

    sentences.forEach((s) => ensureSrsEntry(s.en));
    saveSRS();
    persistSentences();
    renderSrsStats();

    if (trainMode === "worst") refreshWorstListIfNeeded();

    const next = pickCardForNavigation(false, 1);
    if (next) loadSentence(next);

    revealButtons();
  }

  async function loadOnline() {
    say('<i class="fa fa-spinner fa-spin"></i> Buscando o arquivo de frases…', "info");

    // O carimbo de tempo e o no-store contornam o cache do CDN do
    // GitHub e o cache do navegador. Sem isso, uma atualização no
    // repositório pode levar minutos para aparecer aqui.
    const url = URL_FRASES + (URL_FRASES.indexOf("?") >= 0 ? "&" : "?") + "t=" + Date.now();

    let res;
    try {
      res = await fetch(url, { cache: "no-store" });
    } catch (e) {
      say('<i class="fa fa-wifi"></i> Sem conexão com o GitHub. ' +
          'Carregando a cópia embutida (funciona offline)…', "info");
      return loadLocal();
    }

    if (!res.ok) {
      say(`<i class="fa fa-exclamation-triangle"></i> O servidor respondeu ${res.status}. ` +
          `Carregando a cópia embutida (funciona offline)…`, "info");
      return loadLocal();
    }

    const txt = await res.text();

    if (!txt || txt.length < 40) {
      say("<strong>O arquivo veio vazio.</strong> A resposta chegou, mas sem conteúdo utilizável.", "erro");
      return;
    }

    let list;
    try {
      list = parse(txt);
    } catch (e) {
      say("<strong>Falha ao interpretar o arquivo.</strong> " + esc(e.message), "erro");
      return;
    }

    if (!list.length) {
      say("<strong>Nenhuma frase reconhecida.</strong> O arquivo chegou, mas nenhuma linha virou par inglês e português.", "erro");
      return;
    }

    try {
      install(list);
    } catch (e) {
      // O app.js original não tinha catch aqui: um erro nesta etapa
      // abortava tudo em silêncio e parecia que nada carregou.
      say("<strong>As frases foram lidas, mas a montagem falhou.</strong> " + esc(e.message), "erro");
      console.error("DataLoader:", e);
      return;
    }

    say(reportHtml(lastReport), "ok");
  }

  function loadFile(file) {
    const reader = new FileReader();
    reader.onerror = () => say("<strong>Não consegui ler o arquivo local.</strong>", "erro");
    reader.onload = (e) => {
      try {
        const list = parse(e.target.result);
        if (!list.length) {
          say("<strong>Nenhuma frase reconhecida no arquivo.</strong>", "erro");
          return;
        }
        install(list);
        say(reportHtml(lastReport), "ok");
      } catch (err) {
        say("<strong>Falha ao processar o arquivo.</strong> " + esc(err.message), "erro");
      }
      const input = document.getElementById("fileInput");
      if (input) input.value = "";
    };
    reader.readAsText(file, "UTF-8");
  }

  // Carrega a cópia embutida, servida da própria origem. Como o
  // service worker guarda esse arquivo, esta rota funciona offline.
  async function loadLocal() {
    let res;
    try {
      res = await fetch(URL_LOCAL);
    } catch (e) {
      say("<strong>Não achei a cópia embutida das frases.</strong> " +
          "Verifique se <code>frases_unicas_1000.txt</code> está na mesma pasta do app.", "erro");
      return;
    }
    if (!res || !res.ok) {
      say("<strong>A cópia embutida não pôde ser lida.</strong> " +
          "Abra o app uma vez com internet para o cache offline se formar.", "erro");
      return;
    }
    const txt = await res.text();
    let list;
    try {
      list = parse(txt);
    } catch (e) {
      say("<strong>Falha ao interpretar a cópia embutida.</strong> " + esc(e.message), "erro");
      return;
    }
    if (!list.length) {
      say("<strong>Nenhuma frase reconhecida na cópia embutida.</strong>", "erro");
      return;
    }
    try {
      install(list);
    } catch (e) {
      say("<strong>As frases foram lidas, mas a montagem falhou.</strong> " + esc(e.message), "erro");
      console.error("DataLoader:", e);
      return;
    }
    say(reportHtml(lastReport) + ' <span class="loader-sample">(cópia offline)</span>', "ok");
  }

  /* ── Instalação ───────────────────────────────────────────── */

  function boot() {
    window.parseTxtToSentences = parse;

    const online = document.getElementById("loadOnlineBtn");
    if (online) online.onclick = loadOnline;

    const input = document.getElementById("fileInput");
    if (input) {
      input.onchange = function () {
        const f = this.files && this.files[0];
        if (f) loadFile(f);
      };
    }

    // Primeiro boot sem frases guardadas: carrega a cópia embutida
    // sozinho, para o drag-drop já estar pronto — inclusive offline.
    // Roda depois de um tique, dando tempo ao app.js de restaurar o
    // que estiver salvo; só age se ainda não houver frase alguma.
    setTimeout(function () {
      const has = window._sentences && window._sentences.length;
      if (!has) loadLocal();
    }, 60);
  }

  document.addEventListener("DOMContentLoaded", boot);
  if (document.readyState !== "loading") boot();

  return {
    loadOnline, loadLocal, loadFile, parse,
    get report() { return lastReport; },
    get url() { return URL_FRASES; }
  };
})();
