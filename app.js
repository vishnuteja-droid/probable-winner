/* ============================================================
   AI VANGUARD COMMAND HUB :: ENGINE
   Vanilla ES6 module. Zero backend, hosted on GitHub Pages.

   SHARED DATA MODEL
   - data/operations.json is the published board. Everyone who opens
     the site loads it, so every viewer sees the same thing.
   - When you maintain the board (add / edit / promote / retire /
     delete) the changes are held as a local draft in this browser
     only, until you Publish.
   - "Save to GitHub" commits operations.json straight to the repo via
     the GitHub API (using a token kept only in this browser), so UI
     edits go live for everyone in ~1 minute with no manual upload.
     "Download JSON" remains as a no-token manual fallback.
   - A plain viewer never edits, so they always see the published board.
   ============================================================ */

const STORAGE_KEY = "vanguard.draft.v1";
const TOKEN_KEY = "vanguard.gh.token";          // GitHub token, this browser only
const PUBLISHED_URL = "./data/operations.json"; // shared, committed board

/* GitHub target for auto-save (public info; the token is the only secret). */
const GH = {
  owner: "vishnuteja-droid",
  repo: "probable-winner",
  branch: "main",            // GitHub Pages serves this branch
  path: "data/operations.json",
};

/* Doctrine constants */
const HOURS_SAVED_PER_KILL = 15; // estimate per terminated prototype (15-hr limit)
const JOKER_DAY = 11;            // T+11..T+13 -> yellow
const BINGO_DAY = 14;            // T+14+      -> red / bingo

/* Operation status enum */
const STATUS = {
  ACTIVE: "ACTIVE",     // live on the BFT
  PROMOTED: "PROMOTED", // Wall of Valor
  KILLED: "KILLED",     // Graveyard
};

let OPS = [];          // current working set shown in the UI
let PUBLISHED = [];     // the committed board (for "discard changes")
let editingId = null;   // id of the row currently being edited inline

/* ---------------- DATA: published board + local draft ---------------- */

/* Fetch the committed board that every viewer loads. */
async function fetchPublished() {
  try {
    const res = await fetch(PUBLISHED_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const list = Array.isArray(data) ? data : data.operations;
    if (!Array.isArray(list)) return [];
    return list.map(normalizeOp);
  } catch (e) {
    console.warn("Vanguard: could not load published board.", e);
    return [];
  }
}

/* The local draft, if this browser has unpublished edits. */
function loadDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeOp) : null;
  } catch (e) {
    console.warn("Vanguard: corrupt draft, ignoring.", e);
    return null;
  }
}

function hasDraft() {
  return localStorage.getItem(STORAGE_KEY) !== null;
}

/* Persist the working set as this browser's local draft. */
function saveDraft() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(OPS));
  renderPublishBar();
}

/* Guarantee every op has the fields the UI relies on. */
function normalizeOp(o) {
  return {
    id: o.id || newId(),
    callSign: o.callSign || "Unnamed",
    target: o.target || "",
    launchDate: o.launchDate || todayISO(),
    status: o.status || STATUS.ACTIVE,
    created: o.created || new Date().toISOString(),
  };
}

function newId() {
  return "op_" + Date.now() + "_" + Math.floor(Math.random() * 1e4);
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function clone(arr) {
  return arr.map((o) => ({ ...o }));
}

/* ---------------- T-CLOCK + FUEL LOGIC ---------------- */

/* Whole days elapsed since launchDate (YYYY-MM-DD) using local midnight. */
function daysSinceLaunch(launchDate) {
  const launch = new Date(launchDate + "T00:00:00");
  if (isNaN(launch.getTime())) return 0;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((today - launch) / 86400000);
}

function tClockLabel(launchDate) {
  return "T+" + Math.max(daysSinceLaunch(launchDate), 0);
}

/* Returns {key, label} for fuel state based on T-Clock. */
function fuelState(launchDate) {
  const d = Math.max(daysSinceLaunch(launchDate), 0);
  if (d >= BINGO_DAY) return { key: "red", label: "BINGO" };
  if (d >= JOKER_DAY) return { key: "yellow", label: "JOKER" };
  return { key: "green", label: "NOMINAL" };
}

/* ---------------- RENDER: BFT ---------------- */

function renderBFT() {
  const body = document.getElementById("bftBody");
  const emptyNote = document.getElementById("bftEmpty");
  body.innerHTML = "";

  const active = OPS.filter((o) => o.status === STATUS.ACTIVE);
  emptyNote.hidden = active.length !== 0;

  for (const op of active) {
    body.appendChild(op.id === editingId ? editRow(op) : viewRow(op));
  }
}

function viewRow(op) {
  const fuel = fuelState(op.launchDate);
  const tr = document.createElement("tr");
  tr.className = "fuel-" + fuel.key;
  tr.innerHTML = `
    <td><strong>${escapeHtml(op.callSign)}</strong></td>
    <td>${escapeHtml(op.target)}</td>
    <td>${escapeHtml(op.launchDate)}</td>
    <td>${tClockLabel(op.launchDate)}</td>
    <td><span class="badge ${fuel.key}">${fuel.label}</span></td>
    <td class="actions">
      <button class="act-btn" data-act="edit" data-id="${op.id}">Edit</button>
      <button class="act-btn promote" data-act="promote" data-id="${op.id}">Promote</button>
      <button class="act-btn kill" data-act="kill" data-id="${op.id}">Retire</button>
      <button class="act-btn danger" data-act="delete" data-id="${op.id}">Delete</button>
    </td>`;
  return tr;
}

function editRow(op) {
  const tr = document.createElement("tr");
  tr.className = "editing";
  tr.innerHTML = `
    <td><input class="cell-input" data-field="callSign" value="${escapeAttr(op.callSign)}" /></td>
    <td><input class="cell-input" data-field="target" value="${escapeAttr(op.target)}" /></td>
    <td><input class="cell-input" type="date" data-field="launchDate" value="${escapeAttr(op.launchDate)}" /></td>
    <td colspan="2" class="edit-note">Editing…</td>
    <td class="actions">
      <button class="act-btn promote" data-act="save" data-id="${op.id}">Save</button>
      <button class="act-btn" data-act="cancel" data-id="${op.id}">Cancel</button>
    </td>`;
  return tr;
}

/* ---------------- RENDER: STRATCOM ---------------- */

function renderStratcom() {
  const promoted = OPS.filter((o) => o.status === STATUS.PROMOTED);
  const killed = OPS.filter((o) => o.status === STATUS.KILLED);

  document.getElementById("mOps").textContent = OPS.length;
  document.getElementById("mCasualty").textContent =
    killed.length * HOURS_SAVED_PER_KILL + " HRS";
  document.getElementById("mPromos").textContent = promoted.length;

  const valorList = document.getElementById("valorList");
  const graveList = document.getElementById("graveyardList");
  valorList.innerHTML = "";
  graveList.innerHTML = "";

  if (promoted.length === 0) {
    valorList.innerHTML = `<li class="empty-li">No promotions recorded.</li>`;
  }
  for (const op of promoted) valorList.appendChild(arenaItem(op, "Promoted to Core"));

  if (killed.length === 0) {
    graveList.innerHTML = `<li class="empty-li">No retired operations.</li>`;
  }
  for (const op of killed)
    graveList.appendChild(arenaItem(op, `Retired · ~${HOURS_SAVED_PER_KILL} hrs reclaimed`));
}

function arenaItem(op, metaText) {
  const li = document.createElement("li");
  li.innerHTML = `
    <div class="li-main">
      <span class="li-title">${escapeHtml(op.callSign)}</span>
      <span class="li-desc">${escapeHtml(op.target)}</span>
      <span class="meta">${metaText}</span>
    </div>
    <div class="li-actions">
      <button class="act-btn" data-act="restore" data-id="${op.id}">Return to active</button>
      <button class="act-btn danger" data-act="delete" data-id="${op.id}">Delete</button>
    </div>`;
  return li;
}

/* ---------------- RENDER: publish bar ---------------- */

function renderPublishBar() {
  const bar = document.getElementById("publishBar");
  const status = document.getElementById("publishStatus");
  const discard = document.getElementById("btnDiscard");
  const tokenBtn = document.getElementById("btnToken");
  const dirty = hasDraft();
  bar.classList.toggle("dirty", dirty);
  discard.hidden = !dirty;
  tokenBtn.textContent = getToken() ? "GitHub: connected" : "Connect GitHub";
  tokenBtn.classList.toggle("connected", !!getToken());
  status.textContent = dirty
    ? "Unsaved changes in this browser. Save to GitHub to publish to everyone, or discard."
    : "Synced with the published board — the same view everyone sees.";
}

function renderAll() {
  renderBFT();
  renderStratcom();
  renderPublishBar();
}

/* ---------------- ACTIONS ---------------- */

function findOp(id) {
  return OPS.find((o) => o.id === id);
}

function setStatus(id, status) {
  const op = findOp(id);
  if (!op) return;
  op.status = status;
  saveDraft();
  renderAll();
}

function deleteOp(id) {
  const op = findOp(id);
  if (!op) return;
  if (!confirm(`Delete "${op.callSign}" permanently? This cannot be undone.`)) return;
  OPS = OPS.filter((o) => o.id !== id);
  if (editingId === id) editingId = null;
  saveDraft();
  renderAll();
}

function addOperation(callSign, target, launchDate) {
  OPS.push(normalizeOp({ id: newId(), callSign, target, launchDate, status: STATUS.ACTIVE }));
  saveDraft();
  renderAll();
}

function saveEdit(id, row) {
  const op = findOp(id);
  if (!op) return;
  const get = (f) => row.querySelector(`[data-field="${f}"]`).value;
  const callSign = get("callSign").trim();
  const target = get("target").trim();
  const launchDate = get("launchDate");
  if (!callSign || !launchDate) {
    alert("Call sign and launch date are required.");
    return;
  }
  op.callSign = callSign;
  op.target = target.trim();
  op.launchDate = launchDate;
  editingId = null;
  saveDraft();
  renderAll();
}

/* ---------------- GITHUB AUTO-SAVE ---------------- */

function getToken() {
  return (localStorage.getItem(TOKEN_KEY) || "").trim();
}

/* Prompt for and store a token (browser-only). Returns the token or "". */
function ensureToken() {
  let t = getToken();
  if (!t) {
    t = (window.prompt(
      "Paste a GitHub token with write access to this repository " +
        "(fine-grained: Contents → Read and write).\n\n" +
        "It is stored only in this browser and never shared or committed."
    ) || "").trim();
    if (t) localStorage.setItem(TOKEN_KEY, t);
  }
  return t;
}

/* Manage the stored token: update or remove it. */
function manageToken() {
  const next = window.prompt(
    "GitHub token (stored only in this browser). Leave blank to remove it.",
    getToken()
  );
  if (next === null) return; // cancelled
  if (next.trim()) localStorage.setItem(TOKEN_KEY, next.trim());
  else localStorage.removeItem(TOKEN_KEY);
  renderPublishBar();
}

function ghHeaders(token) {
  return {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}
function ghContentsUrl() {
  return `https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${GH.path}`;
}

/* UTF-8 safe base64 (GitHub wants base64-encoded file bytes). */
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function setSaving(on) {
  const btn = document.getElementById("btnSaveGithub");
  btn.disabled = on;
  btn.textContent = on ? "Saving…" : "Save to GitHub";
}

/* Commit the current board straight to data/operations.json. */
async function saveToGitHub() {
  const token = ensureToken();
  if (!token) return;
  renderPublishBar();
  setSaving(true);
  try {
    // Look up the current file SHA (required to update an existing file).
    let sha;
    const head = await fetch(ghContentsUrl() + "?ref=" + GH.branch, {
      headers: ghHeaders(token),
      cache: "no-store",
    });
    if (head.status === 401) throw new Error("token rejected (401) — re-enter it via “GitHub token”.");
    if (head.ok) sha = (await head.json()).sha;
    else if (head.status !== 404) throw new Error("HTTP " + head.status);

    const content = JSON.stringify(
      { version: 1, updated: new Date().toISOString(), operations: OPS },
      null,
      2
    );
    const body = {
      message: "Update operations board",
      content: toBase64(content),
      branch: GH.branch,
    };
    if (sha) body.sha = sha;

    const res = await fetch(ghContentsUrl(), {
      method: "PUT",
      headers: ghHeaders(token),
      body: JSON.stringify(body),
    });
    if (res.status === 401) throw new Error("token rejected (401) — re-enter it via “GitHub token”.");
    if (!res.ok) throw new Error("HTTP " + res.status + " — " + (await res.text()));

    // Saved: this is now the published board; clear the local draft.
    PUBLISHED = clone(OPS);
    localStorage.removeItem(STORAGE_KEY);
    renderAll();
    alert("Saved to GitHub. The live site updates for everyone within ~1 minute.");
  } catch (e) {
    console.error(e);
    alert("Could not save to GitHub: " + e.message);
  } finally {
    setSaving(false);
  }
}

/* ---------------- PUBLISH / DISCARD ---------------- */

/* Download the current board as operations.json (manual fallback). */
function publish() {
  const payload = { version: 1, updated: todayISO(), operations: OPS };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "operations.json";
  a.click();
  URL.revokeObjectURL(url);
  alert(
    "operations.json downloaded.\n\n" +
      "To publish to everyone:\n" +
      "1. Open the repo on GitHub → data/operations.json\n" +
      "2. Upload / replace it with this file and commit\n" +
      "3. Once the page redeploys, click “Discard local changes” here to clear this banner."
  );
}

/* Drop the local draft and fall back to the published board. */
function discardDraft() {
  if (!confirm("Discard local changes and show the published board?")) return;
  localStorage.removeItem(STORAGE_KEY);
  editingId = null;
  OPS = clone(PUBLISHED);
  renderAll();
}

/* ---------------- WIRING ---------------- */

function wireFunnel() {
  const gates = ["gData", "gHours", "gRoi"].map((id) => document.getElementById(id));
  const btn = document.getElementById("promoteBtn");
  const hint = document.getElementById("gateHint");
  const form = document.getElementById("funnelForm");

  function refreshGate() {
    const allClear = gates.every((g) => g.checked);
    btn.hidden = !allClear;
    hint.hidden = allClear;
  }
  gates.forEach((g) => g.addEventListener("change", refreshGate));
  refreshGate();

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!gates.every((g) => g.checked)) return; // hard gate guard
    const callSign = document.getElementById("fCallSign").value.trim();
    const target = document.getElementById("fTarget").value.trim();
    const launchDate = document.getElementById("fLaunchDate").value;
    if (!callSign || !target || !launchDate) return;
    addOperation(callSign, target, launchDate);
    form.reset();
    refreshGate();
    activateTab("bft");
  });
}

function activateTab(name) {
  document.querySelectorAll(".tab-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === name)
  );
  document.querySelectorAll(".tab-panel").forEach((p) =>
    p.classList.toggle("active", p.id === name)
  );
}

function wireTabs() {
  document.querySelector(".tab-bar").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (btn) activateTab(btn.dataset.tab);
  });
}

/* Single delegated handler for every row action (BFT + arena). */
function handleAction(e) {
  const btn = e.target.closest(".act-btn");
  if (!btn) return;
  const id = btn.dataset.id;
  switch (btn.dataset.act) {
    case "edit": editingId = id; renderBFT(); break;
    case "cancel": editingId = null; renderBFT(); break;
    case "save": saveEdit(id, btn.closest("tr")); break;
    case "promote": setStatus(id, STATUS.PROMOTED); break;
    case "kill": setStatus(id, STATUS.KILLED); break;
    case "restore": setStatus(id, STATUS.ACTIVE); break;
    case "delete": deleteOp(id); break;
  }
}

function wireActions() {
  document.getElementById("bftBody").addEventListener("click", handleAction);
  document.getElementById("valorList").addEventListener("click", handleAction);
  document.getElementById("graveyardList").addEventListener("click", handleAction);
  document.getElementById("btnSaveGithub").addEventListener("click", saveToGitHub);
  document.getElementById("btnPublish").addEventListener("click", publish);
  document.getElementById("btnDiscard").addEventListener("click", discardDraft);
  document.getElementById("btnToken").addEventListener("click", manageToken);
}

function renderDate() {
  document.getElementById("hudDate").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/* ---------------- UTIL ---------------- */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escapeAttr(str) {
  return escapeHtml(str);
}

/* ---------------- BOOT ---------------- */

async function boot() {
  wireTabs();
  wireActions();
  wireFunnel();
  renderDate();

  PUBLISHED = await fetchPublished();
  const draft = loadDraft();
  OPS = draft || clone(PUBLISHED); // your draft on your machine; published board for everyone else
  renderAll();

  // Re-evaluate fuel states across a midnight boundary while running.
  setInterval(renderBFT, 60 * 1000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
