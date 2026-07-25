/* ═══════════════════════════════════════════════════════════════
   DATA VAULT — Cofre de Progresso
   Lousa da Fluência · Igarapé Digital

   Todo o histórico do app vive em ~23 chaves de localStorage. Isso
   significa que ele morre com uma limpeza de cache, não atravessa
   de aparelho para aparelho e não existe fora do navegador.

   Este módulo resolve três coisas:
   1. Exportação integral em JSON (backup e migração entre aparelhos).
   2. Importação com snapshot automático de segurança antes de aplicar.
   3. Exportação analítica em CSV: tentativas, erros e um agregado por
      frase pronto para z-score, IQR de Tukey e detecção de outlier.

   Não altera app.js.
═══════════════════════════════════════════════════════════════ */

window.DataVault = (function () {
  "use strict";

  const SIGNATURE = "lousa-da-fluencia";
  const FORMAT_VERSION = 1;
  const LAST_EXPORT_KEY = "vaultLastExport_v1";
  const WARN_AFTER_DAYS = 7;

  // Chaves conhecidas. A exportação varre o localStorage inteiro, então
  // esta lista serve para validação e diagnóstico, não para filtrar.
  const KNOWN_KEYS = [
    "srsData_v1", "sentences_v2", "currentKey_v1", "translationCache_v1",
    "attemptLog_v1", "errorEventLog_v1", "trainMode_v1", "worstPointer_v1",
    "worstListCache_v1", "newOnlyMode_v1", "seqPointer_v1", "appPrefs_v2",
    "favoritePhrases_v1", "micPermission_v1", "autoReadMode_v1", "walkMode_v1",
    "sentenceGroups_v1", "activeGroupKey_v1", "repeatSoon_v1",
    "history", "madeCount", "walkEngine_v1", "bridgeMode_v1"
  ];

  /* ── Utilidades ───────────────────────────────────────────── */

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  }

  function iso(ts) {
    if (!ts) return "";
    try { return new Date(ts).toISOString(); } catch { return ""; }
  }

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime + ";charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
  }

  // Excel PT-BR: separador ponto e vírgula e BOM para acento não quebrar.
  function toCsv(headers, rows) {
    const esc = (v) => {
      const s = String(v === null || v === undefined ? "" : v);
      return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [headers.map(esc).join(";")];
    for (const r of rows) lines.push(r.map(esc).join(";"));
    return "\uFEFF" + lines.join("\r\n");
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }

  /* ── Exportação integral ──────────────────────────────────── */

  function snapshot() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k === LAST_EXPORT_KEY) continue;
      data[k] = localStorage.getItem(k);
    }
    return {
      __signature: SIGNATURE,
      __format: FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      keyCount: Object.keys(data).length,
      missingKnownKeys: KNOWN_KEYS.filter((k) => !(k in data)),
      data: data
    };
  }

  function exportJson(silent) {
    const payload = snapshot();
    download(`lousa-progresso_${stamp()}.json`, JSON.stringify(payload, null, 2), "application/json");
    if (!silent) {
      localStorage.setItem(LAST_EXPORT_KEY, String(Date.now()));
      renderPanel();
      toast(`Backup gerado: ${payload.keyCount} chaves.`);
    }
    return payload;
  }

  /* ── Exportações analíticas ───────────────────────────────── */

  function exportAttemptsCsv() {
    const log = readJson("attemptLog_v1", []);
    if (!log.length) return toast("Ainda não há tentativas registradas.");

    const rows = log.map((r) => [
      iso(r.ts), r.en || "", r.pt || "",
      r.ruleCorrect ? 1 : 0,
      r.hadAnyError ? 1 : 0,
      r.errorCount || 0,
      (r.errorTypes || []).join("|"),
      String(r.en || "").split(/\s+/).filter(Boolean).length
    ]);

    download(
      `lousa-tentativas_${stamp()}.csv`,
      toCsv(["ts_iso", "en", "pt", "acerto", "teve_erro", "qtd_erros", "tipos_erro", "palavras"], rows),
      "text/csv"
    );
    toast(`${rows.length} tentativas exportadas.`);
  }

  function exportErrorsCsv() {
    const log = readJson("errorEventLog_v1", []);
    if (!log.length) return toast("Ainda não há erros registrados.");

    const rows = log.map((e) => [
      iso(e.ts), e.en || "", e.expected || "", e.received || "",
      e.position, e.type || "outros"
    ]);

    download(
      `lousa-erros_${stamp()}.csv`,
      toCsv(["ts_iso", "en", "esperado", "recebido", "posicao", "tipo"], rows),
      "text/csv"
    );
    toast(`${rows.length} eventos de erro exportados.`);
  }

  // Agregado por frase: a base pronta para análise estatística.
  function exportPhrasesCsv() {
    const attempts = readJson("attemptLog_v1", []);
    if (!attempts.length) return toast("Ainda não há histórico para agregar.");

    const srs = readJson("srsData_v1", {});
    const favs = readJson("favoritePhrases_v1", []);
    const map = {};

    for (const r of attempts) {
      const en = r.en || "";
      if (!en) continue;
      if (!map[en]) {
        map[en] = {
          en, pt: r.pt || "", tentativas: 0, acertos: 0, erros: 0,
          primeiro: r.ts, ultimo: r.ts, tipos: {}
        };
      }
      const m = map[en];
      m.tentativas++;
      if (r.ruleCorrect) m.acertos++;
      m.erros += r.errorCount || 0;
      if (r.ts < m.primeiro) m.primeiro = r.ts;
      if (r.ts > m.ultimo) m.ultimo = r.ts;
      for (const t of (r.errorTypes || [])) m.tipos[t] = (m.tipos[t] || 0) + 1;
      if (!m.pt && r.pt) m.pt = r.pt;
    }

    const rows = Object.values(map).map((m) => {
      const entry = srs[m.en] || {};
      const dominante = Object.entries(m.tipos).sort((a, b) => b[1] - a[1])[0];
      const palavras = m.en.split(/\s+/).filter(Boolean).length;
      return [
        m.en, m.pt, palavras,
        m.tentativas, m.acertos,
        (m.tentativas - m.acertos),
        (m.tentativas ? ((m.tentativas - m.acertos) / m.tentativas) : 0).toFixed(4).replace(".", ","),
        m.erros,
        (m.tentativas ? (m.erros / m.tentativas) : 0).toFixed(4).replace(".", ","),
        dominante ? dominante[0] : "",
        entry.box || "",
        iso(entry.due),
        iso(m.primeiro), iso(m.ultimo),
        favs.includes(m.en) ? 1 : 0
      ];
    });

    rows.sort((a, b) => b[7] - a[7]);

    download(
      `lousa-frases_agregado_${stamp()}.csv`,
      toCsv([
        "en", "pt", "palavras", "tentativas", "acertos", "falhas",
        "taxa_falha", "erros_totais", "erros_por_tentativa",
        "tipo_dominante", "caixa_srs", "vencimento_iso",
        "primeiro_contato_iso", "ultimo_contato_iso", "favorita"
      ], rows),
      "text/csv"
    );
    toast(`${rows.length} frases agregadas. Base pronta para IQR e z-score.`);
  }

  /* ── Importação ───────────────────────────────────────────── */

  function applyImport(payload, mode) {
    if (!payload || payload.__signature !== SIGNATURE || !payload.data) {
      throw new Error("Arquivo não é um backup válido da Lousa da Fluência.");
    }

    // Rede de segurança: baixa o estado atual antes de sobrescrever.
    exportJson(true);

    if (mode === "replace") {
      const keep = localStorage.getItem(LAST_EXPORT_KEY);
      localStorage.clear();
      if (keep) localStorage.setItem(LAST_EXPORT_KEY, keep);
    }

    let applied = 0;
    for (const [k, v] of Object.entries(payload.data)) {
      if (typeof v !== "string") continue;
      try { localStorage.setItem(k, v); applied++; } catch {}
    }
    return applied;
  }

  function handleFile(file, mode) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result));
        const count = Object.keys(payload.data || {}).length;
        const label = mode === "replace" ? "SUBSTITUIR todo o progresso atual" : "MESCLAR sobre o progresso atual";
        const ok = confirm(
          `Backup de ${payload.exportedAt || "data desconhecida"} com ${count} chaves.\n\n` +
          `Ação: ${label}.\n\n` +
          `Um backup do estado atual será baixado automaticamente antes.\n\nConfirmar?`
        );
        if (!ok) return;

        const applied = applyImport(payload, mode);
        alert(`${applied} chaves restauradas. A página será recarregada.`);
        location.reload();
      } catch (e) {
        alert("Falha ao importar: " + e.message);
      }
    };
    reader.readAsText(file);
  }

  /* ── Aviso de backup vencido ──────────────────────────────── */

  function daysSinceExport() {
    const raw = localStorage.getItem(LAST_EXPORT_KEY);
    if (!raw) return null;
    return Math.floor((Date.now() - Number(raw)) / 86400000);
  }

  function toast(msg) {
    let el = document.getElementById("vaultToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "vaultToast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 3600);
  }

  /* ── Painel ───────────────────────────────────────────────── */

  function renderPanel() {
    const box = document.getElementById("vaultStatus");
    if (!box) return;

    const attempts = readJson("attemptLog_v1", []).length;
    const errors = readJson("errorEventLog_v1", []).length;
    const days = daysSinceExport();

    let warn = "";
    if (days === null) {
      warn = '<div class="vault-warn">Nunca exportado. Todo o histórico existe só neste navegador.</div>';
    } else if (days >= WARN_AFTER_DAYS) {
      warn = `<div class="vault-warn">Último backup há ${days} dias.</div>`;
    } else {
      warn = `<div class="vault-ok">Último backup há ${days === 0 ? "menos de um dia" : days + " dia(s)"}.</div>`;
    }

    box.innerHTML = `${warn}
      <div class="vault-metrics">
        <span><strong>${attempts}</strong> tentativas</span>
        <span><strong>${errors}</strong> erros</span>
      </div>`;
  }

  /* ── Ligações de interface ────────────────────────────────── */

  function wireUi() {
    const bind = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("click", fn);
    };

    bind("vaultExportBtn", () => exportJson(false));
    bind("vaultAttemptsBtn", exportAttemptsCsv);
    bind("vaultErrorsBtn", exportErrorsCsv);
    bind("vaultPhrasesBtn", exportPhrasesCsv);

    const input = document.getElementById("vaultImportInput");
    const mergeBtn = document.getElementById("vaultMergeBtn");
    const replaceBtn = document.getElementById("vaultReplaceBtn");
    let pendingMode = "merge";

    if (mergeBtn) mergeBtn.addEventListener("click", () => { pendingMode = "merge"; input && input.click(); });
    if (replaceBtn) replaceBtn.addEventListener("click", () => { pendingMode = "replace"; input && input.click(); });
    if (input) input.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) handleFile(f, pendingMode);
      e.target.value = "";
    });

    renderPanel();
  }

  document.addEventListener("DOMContentLoaded", wireUi);
  if (document.readyState !== "loading") wireUi();

  return {
    exportJson, exportAttemptsCsv, exportErrorsCsv, exportPhrasesCsv,
    snapshot, renderPanel, toast, KNOWN_KEYS
  };
})();
