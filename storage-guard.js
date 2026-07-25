/* ═══════════════════════════════════════════════════════════════
   STORAGE GUARD v2 — gerenciador de localStorage
   Lousa da Fluência · Igarapé Digital

   O DIAGNÓSTICO CORRIGIDO

   Na primeira versão eu apontei os logs sem teto do app.js como
   causa do estouro de cota. O defeito é real — attemptLog_v1 e
   errorEventLog_v1 crescem para sempre — mas o relatório de uso
   mostrou que eles nem estão entre os dez maiores. O que enche o
   armazenamento são as OUTRAS ferramentas servidas da mesma origem:
   bandas de remuneração, mapa RH, control tower, dashboard VTO,
   entrevistas de desligamento. Todas dividem uma única cota.

   Por isso poda automática não resolve sozinha: o espaço não é da
   Lousa para podar. O que resolve é você poder ver tudo e decidir
   o que sai, item por item, com backup antes.

   O QUE ESTE MÓDULO FAZ

   1. Rede de segurança em toda gravação (Storage.prototype.setItem):
      se estourar a cota, poda o histórico da Lousa e repete a
      gravação. Cobre chaves que eu não conheço.

   2. Teto nos dois logs da Lousa, para que ela pare de contribuir
      para o problema.

   3. Gerenciador visual: lista TODAS as chaves por tamanho, marca
      a qual ferramenta cada uma pertence, permite excluir uma a
      uma ou em lote, e baixa backup em JSON antes de apagar.

   4. Limpar Histórico com escopo declarado: o botão original só
      esvaziava a lista lateral. Agora ele diz o que vai apagar.

   Não altera app.js. Deve ser o PRIMEIRO script carregado.
═══════════════════════════════════════════════════════════════ */

window.StorageGuard = (function () {
  "use strict";

  const ATTEMPT_LOG = "attemptLog_v1";
  const ERROR_LOG = "errorEventLog_v1";
  const TRANSLATION = "translationCache_v1";
  const WORST_CACHE = "worstListCache_v1";
  const SENTENCES = "sentences_v2";

  const MAX_ATTEMPTS = 1200;
  const MAX_ERRORS = 2500;

  // Chaves que pertencem à Lousa. Tudo fora desta lista veio de
  // outra ferramenta hospedada na mesma origem.
  const LOUSA_KEYS = new Set([
    "trainMode_v1", "worstPointer_v1", "worstListCache_v1",
    "newOnlyMode_v1", "seqPointer_v1", "attemptLog_v1", "errorEventLog_v1",
    "srsData_v1", "sentences_v2", "currentKey_v1", "translationCache_v1",
    "repeatSoon_v1", "madeCount", "history", "autoReadMode_v1",
    "walkMode_v1", "appPrefs_v2", "favoritePhrases_v1", "micPermission_v1",
    "sentenceGroups_v1", "activeGroupKey_v1", "bridgeMode_v1",
    "walkEngine_v1", "walkEngine_v2"
  ]);

  // Dados da Lousa que NUNCA saem em poda automática.
  const PROTECTED = new Set([
    "srsData_v1", "sentences_v2", "favoritePhrases_v1",
    "sentenceGroups_v1", "activeGroupKey_v1", "appPrefs_v2", "madeCount"
  ]);

  const nativeSet = Storage.prototype.setItem;
  let lastFreed = 0;
  let selected = new Set();

  /* ── Medição ──────────────────────────────────────────────── */

  function keySize(k) {
    const v = localStorage.getItem(k);
    // UTF-16: duas unidades de byte por caractere, chave inclusa.
    return v === null ? 0 : (k.length + v.length) * 2;
  }

  function usage() {
    const rows = [];
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const size = keySize(k);
      total += size;
      rows.push({ key: k, size, lousa: LOUSA_KEYS.has(k) });
    }
    rows.sort((a, b) => b.size - a.size);
    return { rows, total };
  }

  function human(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
    return (bytes / 1024 / 1024).toFixed(2) + " MB";
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  /* ── Backup ───────────────────────────────────────────────── */

  function download(name, text) {
    try {
      const blob = new Blob([text], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return true;
    } catch {
      return false;
    }
  }

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  }

  function backupKeys(keys) {
    const dump = {};
    keys.forEach((k) => { dump[k] = localStorage.getItem(k); });
    const name = keys.length === 1
      ? `backup_${keys[0]}_${stamp()}.json`
      : `backup_localStorage_${stamp()}.json`;
    return download(name, JSON.stringify(dump, null, 2));
  }

  function backupAll() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    return backupKeys(keys);
  }

  /* ── Poda ─────────────────────────────────────────────────── */

  function readArray(key) {
    try {
      const raw = localStorage.getItem(key);
      const v = raw ? JSON.parse(raw) : [];
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }

  function trimArray(key, max) {
    const arr = readArray(key);
    if (arr.length <= max) return 0;
    const before = keySize(key);
    try {
      nativeSet.call(localStorage, key, JSON.stringify(arr.slice(-max)));
    } catch {
      try { localStorage.removeItem(key); } catch {}
      return before;
    }
    return before - keySize(key);
  }

  function trimTranslations() {
    let cache, list;
    try {
      cache = JSON.parse(localStorage.getItem(TRANSLATION) || "{}");
      list = JSON.parse(localStorage.getItem(SENTENCES) || "[]");
    } catch { return 0; }
    if (!cache || typeof cache !== "object" || !Array.isArray(list) || !list.length) return 0;

    const alive = new Set(list.map((s) => s && s.en).filter(Boolean));
    const kept = {};
    let dropped = 0;
    for (const k of Object.keys(cache)) {
      if (alive.has(k)) kept[k] = cache[k]; else dropped++;
    }
    if (!dropped) return 0;

    const before = keySize(TRANSLATION);
    try { nativeSet.call(localStorage, TRANSLATION, JSON.stringify(kept)); } catch { return 0; }
    return before - keySize(TRANSLATION);
  }

  // Só mexe em histórico da Lousa. Nunca em outra ferramenta.
  function freeSpace(aggressive) {
    let freed = 0;
    freed += trimArray(ERROR_LOG, aggressive ? 400 : MAX_ERRORS);
    freed += trimArray(ATTEMPT_LOG, aggressive ? 200 : MAX_ATTEMPTS);

    const worst = keySize(WORST_CACHE);
    if (worst > 0) {
      try { localStorage.removeItem(WORST_CACHE); freed += worst; } catch {}
    }
    freed += trimTranslations();

    lastFreed = freed;
    return freed;
  }

  /* ── Rede de segurança em toda gravação ───────────────────── */

  function isQuotaError(e) {
    if (!e) return false;
    return e.name === "QuotaExceededError" ||
           e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
           e.code === 22 || e.code === 1014;
  }

  Storage.prototype.setItem = function (key, value) {
    try {
      return nativeSet.call(this, key, value);
    } catch (e) {
      if (!isQuotaError(e) || this !== window.localStorage) throw e;

      freeSpace(false);
      try { return nativeSet.call(this, key, value); }
      catch (e2) { if (!isQuotaError(e2)) throw e2; }

      freeSpace(true);
      try { return nativeSet.call(this, key, value); }
      catch (e3) {
        openManager("<strong>O armazenamento está cheio</strong> e a poda do histórico da Lousa não foi suficiente. " +
                    "O espaço está com outras ferramentas desta mesma origem. Escolha abaixo o que remover.");
        throw e3;
      }
    }
  };

  function installLogCaps() {
    const oa = window.saveAttemptLog;
    const oe = window.saveErrorEventLog;
    if (typeof oa === "function") {
      window.saveAttemptLog = function (log) {
        const a = Array.isArray(log) ? log : [];
        return oa.call(this, a.length > MAX_ATTEMPTS ? a.slice(-MAX_ATTEMPTS) : a);
      };
    }
    if (typeof oe === "function") {
      window.saveErrorEventLog = function (log) {
        const a = Array.isArray(log) ? log : [];
        return oe.call(this, a.length > MAX_ERRORS ? a.slice(-MAX_ERRORS) : a);
      };
    }
  }

  /* ── Gerenciador visual ───────────────────────────────────── */

  function ensureModal() {
    let el = document.getElementById("storageModal");
    if (el) return el;

    el = document.createElement("div");
    el.id = "storageModal";
    el.className = "sg-modal";
    el.innerHTML = `
      <div class="sg-box" role="dialog" aria-modal="true" aria-label="Armazenamento">
        <div class="sg-head">
          <h3>Armazenamento do navegador</h3>
          <button type="button" class="sg-close" id="sgClose" aria-label="Fechar">
            <i class="fa fa-times"></i>
          </button>
        </div>
        <div class="sg-note" id="sgNote" style="display:none;"></div>
        <div class="sg-meter"><div class="sg-meter-fill" id="sgMeterFill"></div></div>
        <div class="sg-summary" id="sgSummary"></div>
        <div class="sg-toolbar">
          <button type="button" class="sg-btn" id="sgBackupAll"><i class="fa fa-download"></i> Backup de tudo</button>
          <button type="button" class="sg-btn" id="sgSelLousa"><i class="fa fa-check-double"></i> Marcar só histórico</button>
          <button type="button" class="sg-btn" id="sgSelNone"><i class="fa fa-eraser"></i> Desmarcar</button>
          <button type="button" class="sg-btn sg-btn-danger" id="sgDelSel"><i class="fa fa-trash"></i> Excluir marcadas</button>
        </div>
        <div class="sg-list" id="sgList"></div>
      </div>
    `;
    document.body.appendChild(el);

    el.addEventListener("click", (e) => { if (e.target === el) closeManager(); });
    el.querySelector("#sgClose").onclick = closeManager;
    el.querySelector("#sgBackupAll").onclick = () => {
      backupAll()
        ? note("Backup baixado. Guarde o arquivo antes de excluir qualquer coisa.", "ok")
        : note("Não consegui gerar o backup neste navegador.", "erro");
    };
    el.querySelector("#sgSelNone").onclick = () => { selected.clear(); render(); };
    el.querySelector("#sgSelLousa").onclick = () => {
      selected = new Set([ATTEMPT_LOG, ERROR_LOG, WORST_CACHE, "history"]
        .filter((k) => localStorage.getItem(k) !== null));
      render();
    };
    el.querySelector("#sgDelSel").onclick = deleteSelected;

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeManager();
    });

    return el;
  }

  function note(html, kind) {
    const el = document.getElementById("sgNote");
    if (!el) return;
    el.className = "sg-note sg-note-" + (kind || "info");
    el.innerHTML = html || "";
    el.style.display = html ? "block" : "none";
  }

  function render() {
    const u = usage();

    const fill = document.getElementById("sgMeterFill");
    if (fill) {
      // A cota real varia por navegador, comumente entre 5 e 10 MB.
      // A régua aqui é 10 MB: o que importa é a proporção.
      const pct = Math.min(100, (u.total / (10 * 1024 * 1024)) * 100);
      fill.style.width = pct.toFixed(1) + "%";
      fill.className = "sg-meter-fill" + (pct > 85 ? " sg-full" : pct > 60 ? " sg-warn" : "");
    }

    const lousaTotal = u.rows.filter((r) => r.lousa).reduce((a, r) => a + r.size, 0);
    const selSize = u.rows.filter((r) => selected.has(r.key)).reduce((a, r) => a + r.size, 0);

    const sum = document.getElementById("sgSummary");
    if (sum) {
      sum.innerHTML =
        `<strong>${human(u.total)}</strong> em ${u.rows.length} chaves. ` +
        `Lousa: ${human(lousaTotal)}. Outras ferramentas: ${human(u.total - lousaTotal)}.` +
        (selected.size
          ? ` <span class="sg-sel">${selected.size} marcada${selected.size > 1 ? "s" : ""} · ${human(selSize)}</span>`
          : "");
    }

    const list = document.getElementById("sgList");
    if (!list) return;

    list.innerHTML = u.rows.map((r) => `
      <div class="sg-row${selected.has(r.key) ? " sg-row-on" : ""}">
        <label class="sg-pick">
          <input type="checkbox" data-pick="${esc(r.key)}" ${selected.has(r.key) ? "checked" : ""} />
        </label>
        <div class="sg-info">
          <div class="sg-key">${esc(r.key)}</div>
          <div class="sg-origin">${r.lousa ? "Lousa da Fluência" : "outra ferramenta"}${PROTECTED.has(r.key) ? " · dado de estudo" : ""}</div>
        </div>
        <div class="sg-size">${human(r.size)}</div>
        <button type="button" class="sg-icon" data-save="${esc(r.key)}" title="Baixar backup desta chave">
          <i class="fa fa-download"></i>
        </button>
        <button type="button" class="sg-icon sg-icon-danger" data-del="${esc(r.key)}" title="Excluir esta chave">
          <i class="fa fa-trash"></i>
        </button>
      </div>
    `).join("");

    list.querySelectorAll("[data-pick]").forEach((cb) => {
      cb.onchange = () => {
        const k = cb.getAttribute("data-pick");
        if (cb.checked) selected.add(k); else selected.delete(k);
        render();
      };
    });
    list.querySelectorAll("[data-save]").forEach((b) => {
      b.onclick = () => {
        const k = b.getAttribute("data-save");
        backupKeys([k])
          ? note(`Backup de <code>${esc(k)}</code> baixado.`, "ok")
          : note("Não consegui gerar o backup.", "erro");
      };
    });
    list.querySelectorAll("[data-del]").forEach((b) => {
      b.onclick = () => deleteOne(b.getAttribute("data-del"));
    });
  }

  function deleteOne(key) {
    const size = keySize(key);
    const aviso = PROTECTED.has(key)
      ? "\n\nATENCAO: esta chave guarda dados de estudo da Lousa (frases, revisoes, favoritos ou grupos). Apagar e irreversivel."
      : "";
    if (!confirm(`Excluir "${key}" e liberar ${human(size)}?${aviso}\n\nBaixe o backup antes se tiver duvida.`)) return;
    try { localStorage.removeItem(key); } catch {}
    selected.delete(key);
    note(`<code>${esc(key)}</code> removida. ${human(size)} liberados.`, "ok");
    render();
  }

  function deleteSelected() {
    if (!selected.size) { note("Nenhuma chave marcada.", "info"); return; }
    const keys = [...selected];
    const size = keys.reduce((a, k) => a + keySize(k), 0);
    const protegidas = keys.filter((k) => PROTECTED.has(k));
    const aviso = protegidas.length
      ? `\n\nATENCAO: ${protegidas.length} delas guardam dados de estudo da Lousa:\n${protegidas.join(", ")}`
      : "";
    if (!confirm(`Excluir ${keys.length} chaves e liberar ${human(size)}?${aviso}\n\nBaixe o backup antes se tiver duvida.`)) return;
    keys.forEach((k) => { try { localStorage.removeItem(k); } catch {} });
    selected.clear();
    note(`${keys.length} chaves removidas. ${human(size)} liberados.`, "ok");
    render();
  }

  function openManager(msg) {
    ensureModal().classList.add("open");
    document.body.classList.add("sg-open");
    note(msg || "", msg ? "erro" : "info");
    render();
  }

  function closeManager() {
    const el = document.getElementById("storageModal");
    if (el) el.classList.remove("open");
    document.body.classList.remove("sg-open");
  }

  /* ── Limpar Histórico honesto ─────────────────────────────── */

  function clearHistory() {
    const alvos = ["history", ATTEMPT_LOG, ERROR_LOG, WORST_CACHE]
      .filter((k) => localStorage.getItem(k) !== null);
    const size = alvos.reduce((a, k) => a + keySize(k), 0);

    const texto =
      "Limpar o historico de estudo?\n\n" +
      "Sera apagado:\n" +
      "  - lista de frases vistas\n" +
      "  - registro de tentativas\n" +
      "  - registro de erros e a analise que vem dele\n\n" +
      "Sera preservado:\n" +
      "  - suas frases\n" +
      "  - repeticao espacada (o que esta para revisar)\n" +
      "  - favoritas e grupos\n\n" +
      `Libera cerca de ${human(size)}.`;

    if (!confirm(texto)) return;

    alvos.forEach((k) => { try { localStorage.removeItem(k); } catch {} });

    // Zera o estado em memória para a tela refletir na hora.
    try { history = []; } catch {}
    try { if (typeof renderSidebarHistory === "function") renderSidebarHistory(); } catch {}
    try { if (typeof refreshErrorAnalysis === "function") refreshErrorAnalysis(); } catch {}
    try { if (typeof renderSrsStats === "function") renderSrsStats(); } catch {}

    alert(`Historico limpo. ${human(size)} liberados.`);
  }

  /* ── Botão de acesso ao gerenciador ───────────────────────── */

  function addManagerButton() {
    if (document.getElementById("storageManagerBtn")) return;
    const anchor = document.getElementById("clearBtn");
    if (!anchor || !anchor.parentElement) return;

    const btn = document.createElement("button");
    btn.id = "storageManagerBtn";
    btn.type = "button";
    btn.className = "btn btn-soft";
    btn.innerHTML = '<i class="fa fa-hard-drive"></i> Armazenamento';
    btn.onclick = () => openManager();
    anchor.parentElement.insertBefore(btn, anchor.nextSibling);
  }

  /* ── Início ───────────────────────────────────────────────── */

  function boot() {
    installLogCaps();

    const clear = document.getElementById("clearBtn");
    if (clear) {
      clear.onclick = clearHistory;
      clear.innerHTML = '<i class="fa fa-trash-alt"></i> Limpar histórico';
    }

    addManagerButton();
  }

  document.addEventListener("DOMContentLoaded", boot);
  if (document.readyState !== "loading") boot();

  return {
    usage, freeSpace, human, backupAll, backupKeys,
    open: openManager, close: closeManager, clearHistory,
    get lastFreed() { return lastFreed; },
    get caps() { return { attempts: MAX_ATTEMPTS, errors: MAX_ERRORS }; }
  };
})();
