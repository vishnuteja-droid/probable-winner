/* ============================================================
   AI VANGUARD COMMAND HUB :: TACTICAL ENGINE
   Vanilla ES6 module. Zero backend. localStorage persistence.
   ============================================================ */

const STORAGE_KEY = "vanguard.ops.v1";

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

/* ---------------- STORAGE LAYER ---------------- */

function loadOps() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("Vanguard: corrupt storage, resetting.", e);
    return [];
  }
}

function saveOps(ops) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ops));
}

/* Initialize storage on first load so the app never breaks if empty. */
function initStorage() {
  if (localStorage.getItem(STORAGE_KEY) === null) {
    saveOps([]);
  }
}

let OPS = [];

/* ---------------- T-CLOCK + FUEL LOGIC ---------------- */

/* Whole days elapsed since launchDate (YYYY-MM-DD) using local midnight. */
function daysSinceLaunch(launchDate) {
  const launch = new Date(launchDate + "T00:00:00");
  if (isNaN(launch.getTime())) return 0;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = today - launch;
  return Math.floor(diffMs / 86400000);
}

function tClockLabel(launchDate) {
  const d = daysSinceLaunch(launchDate);
  return "T+" + Math.max(d, 0);
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
    const fuel = fuelState(op.launchDate);
    const tr = document.createElement("tr");
    tr.className = "fuel-" + fuel.key;
    tr.innerHTML = `
      <td><strong>${escapeHtml(op.callSign)}</strong></td>
      <td>${escapeHtml(op.target)}</td>
      <td>${escapeHtml(op.launchDate)}</td>
      <td>${tClockLabel(op.launchDate)}</td>
      <td><span class="badge ${fuel.key}">${fuel.label}</span></td>
      <td>
        <button class="act-btn promote" data-act="promote" data-id="${op.id}">Promote</button>
        <button class="act-btn kill" data-act="kill" data-id="${op.id}">Retire</button>
      </td>
    `;
    body.appendChild(tr);
  }
}

/* ---------------- RENDER: STRATCOM ---------------- */

function renderStratcom() {
  const promoted = OPS.filter((o) => o.status === STATUS.PROMOTED);
  const killed = OPS.filter((o) => o.status === STATUS.KILLED);

  // Total Operations Launched = every op ever created.
  document.getElementById("mOps").textContent = OPS.length;
  // Casualty Rate = killed tools * estimated hours saved.
  document.getElementById("mCasualty").textContent =
    killed.length * HOURS_SAVED_PER_KILL + " HRS";
  // Promotions to Core.
  document.getElementById("mPromos").textContent = promoted.length;

  const valorList = document.getElementById("valorList");
  const graveList = document.getElementById("graveyardList");
  valorList.innerHTML = "";
  graveList.innerHTML = "";

  if (promoted.length === 0) {
    valorList.innerHTML = `<li class="empty-li">No promotions recorded.</li>`;
  }
  for (const op of promoted) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="li-title">${escapeHtml(op.callSign)}</span>
      <span class="li-desc">${escapeHtml(op.target)}</span>
      <span class="meta">Promoted to Core</span>`;
    valorList.appendChild(li);
  }

  if (killed.length === 0) {
    graveList.innerHTML = `<li class="empty-li">No retired operations.</li>`;
  }
  for (const op of killed) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="li-title">${escapeHtml(op.callSign)}</span>
      <span class="li-desc">${escapeHtml(op.target)}</span>
      <span class="meta">Retired · ~${HOURS_SAVED_PER_KILL} hrs reclaimed</span>`;
    graveList.appendChild(li);
  }
}

function renderAll() {
  renderBFT();
  renderStratcom();
}

/* ---------------- ACTIONS ---------------- */

function setStatus(id, status) {
  const op = OPS.find((o) => o.id === id);
  if (!op) return;
  op.status = status;
  saveOps(OPS);
  renderAll();
}

function addOperation(callSign, target, launchDate) {
  OPS.push({
    id: "op_" + Date.now() + "_" + Math.floor(Math.random() * 1e4),
    callSign,
    target,
    launchDate,
    status: STATUS.ACTIVE,
    created: new Date().toISOString(),
  });
  saveOps(OPS);
  renderAll();
}

/* ---------------- FUNNEL GATES ---------------- */

function wireFunnel() {
  const gates = ["gData", "gHours", "gRoi"].map((id) =>
    document.getElementById(id)
  );
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

    // Reset and switch operator to the BFT to confirm the launch.
    form.reset();
    refreshGate();
    activateTab("bft");
  });
}

/* ---------------- TAB NAV ---------------- */

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

function wireBFTActions() {
  document.getElementById("bftBody").addEventListener("click", (e) => {
    const btn = e.target.closest(".act-btn");
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.act === "promote") setStatus(id, STATUS.PROMOTED);
    else if (btn.dataset.act === "kill") setStatus(id, STATUS.KILLED);
  });
}

/* ---------------- HUD CLOCK ---------------- */

function startClock() {
  const el = document.getElementById("hudClock");
  function tick() {
    const now = new Date();
    const z = now.toISOString().slice(11, 19);
    el.textContent = z + " ZULU";
  }
  tick();
  setInterval(tick, 1000);
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

/* ---------------- BOOT ---------------- */

function boot() {
  initStorage();
  OPS = loadOps();
  wireTabs();
  wireBFTActions();
  wireFunnel();
  startClock();
  renderAll();

  // Re-evaluate fuel states across a midnight boundary while running.
  setInterval(renderBFT, 60 * 1000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
