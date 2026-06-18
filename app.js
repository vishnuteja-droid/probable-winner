/* ============================================================
   AI VANGUARD COMMAND HUB :: ENGINE
   Vanilla ES6 module. Zero backend, hosted on GitHub Pages.

   SHARED DATA MODEL
   - data/operations.json is the published board. Everyone who opens
     the site loads it, so every viewer sees the same thing.
   - Maintenance edits are held as a local draft in this browser only,
     until saved.
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
const HOURS_SAVED_PER_KILL = 15; // fallback estimate when an op logs no hours
const JOKER_DAY = 11;            // T+11..T+13 -> yellow
const BINGO_DAY = 14;            // T+14+      -> red / bingo

/* Operation status enum */
const STATUS = {
  CANDIDATE: "CANDIDATE", // parked pitch in the acquisition pipeline
  REJECTED: "REJECTED",   // candidate that did not qualify (rejection log)
  ACTIVE: "ACTIVE",       // live on the BFT
  PROMOTED: "PROMOTED",   // Wall of Valor
  KILLED: "KILLED",       // Graveyard
};

/* Statuses that count as having reached the tracker. */
const LAUNCHED = [STATUS.ACTIVE, STATUS.PROMOTED, STATUS.KILLED];

let OPS = [];               // current working set shown in the UI
let PUBLISHED = [];          // the committed board (for "discard changes")
let PUBLISHED_UPDATED = null; // timestamp from operations.json
let HOLIDAYS = [];           // YYYY-MM-DD dates excluded from the T-Clock
let HOLIDAY_SET = new Set();

/* ---------------- DATA: published board + local draft ---------------- */

async function fetchPublished() {
  try {
    const res = await fetch(PUBLISHED_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const list = Array.isArray(data) ? data : data.operations;
    PUBLISHED_UPDATED = (data && data.updated) || null;
    HOLIDAYS = Array.isArray(data && data.holidays) ? data.holidays : [];
    HOLIDAY_SET = new Set(HOLIDAYS);
    if (!Array.isArray(list)) return [];
    return list.map(normalizeOp);
  } catch (e) {
    console.warn("Vanguard: could not load published board.", e);
    return [];
  }
}

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

function saveDraft() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(OPS));
  renderPublishBar();
}

/* Guarantee every op has the fields the UI relies on. */
function normalizeOp(o) {
  const g = o.gates || {};
  return {
    id: o.id || newId(),
    callSign: o.callSign || "Unnamed",
    target: o.target || "",
    owner: o.owner || "",
    launchDate: o.launchDate || todayISO(),
    hours: Number(o.hours) || 0,
    link: o.link || "",
    category: o.category || "",
    gates: { data: !!g.data, hours: !!g.hours, roi: !!g.roi },
    roiPerWeek: Number(o.roiPerWeek) || 0,
    rejectReason: o.rejectReason || "",
    readiness: o.readiness || "FIELD-READY", // armory: FIELD-READY | DEPLOYED | SUSTAINED
    adoption: Number(o.adoption) || 0,
    status: o.status || STATUS.ACTIVE,
    statusAt: o.statusAt || "",
    created: o.created || new Date().toISOString(),
  };
}

function gatesPass(op) {
  return !!(op.gates && op.gates.data && op.gates.hours && op.gates.roi);
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

function localISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* A business day = weekday (Mon–Fri) that is not in the holiday list. */
function isBusinessDay(d) {
  const wd = d.getDay();
  if (wd === 0 || wd === 6) return false; // Sun / Sat
  return !HOLIDAY_SET.has(localISO(d));
}

/* T-Clock = business days elapsed since launch. Weekends and holidays
   are skipped, so the day after launch only advances on the next working
   day. Launch day itself is T+0. */
function daysSinceLaunch(launchDate) {
  const launch = new Date(launchDate + "T00:00:00");
  if (isNaN(launch.getTime())) return 0;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (today <= launch) return 0;
  let count = 0;
  const d = new Date(launch);
  while (d < today) {
    d.setDate(d.getDate() + 1);
    if (isBusinessDay(d)) count++;
  }
  return count;
}

function tClockLabel(launchDate) {
  return "T+" + Math.max(daysSinceLaunch(launchDate), 0);
}

function fuelState(launchDate) {
  const d = Math.max(daysSinceLaunch(launchDate), 0);
  if (d >= BINGO_DAY) return { key: "red", label: "BINGO" };
  if (d >= JOKER_DAY) return { key: "yellow", label: "JOKER" };
  return { key: "green", label: "NOMINAL" };
}

/* ---------------- FILTER / SORT ---------------- */

function currentFilters() {
  return {
    search: (document.getElementById("bftSearch").value || "").trim().toLowerCase(),
    fuel: document.getElementById("bftFuel").value,
    sort: document.getElementById("bftSort").value,
  };
}

function visibleActiveOps() {
  const f = currentFilters();
  let rows = OPS.filter((o) => o.status === STATUS.ACTIVE);
  if (f.search) {
    rows = rows.filter((o) =>
      (o.callSign + " " + o.target + " " + o.owner).toLowerCase().includes(f.search)
    );
  }
  if (f.fuel !== "all") {
    rows = rows.filter((o) => fuelState(o.launchDate).key === f.fuel);
  }
  rows.sort((a, b) => {
    if (f.sort === "callsign") return a.callSign.localeCompare(b.callSign);
    const da = daysSinceLaunch(a.launchDate);
    const db = daysSinceLaunch(b.launchDate);
    return f.sort === "tclock-asc" ? da - db : db - da; // default: oldest first
  });
  return rows;
}

/* ---------------- RENDER: BFT ---------------- */

function renderBFT() {
  const body = document.getElementById("bftBody");
  const emptyNote = document.getElementById("bftEmpty");
  body.innerHTML = "";

  const rows = visibleActiveOps();
  emptyNote.hidden = rows.length !== 0;
  for (const op of rows) body.appendChild(viewRow(op));

  renderBingo();
}

function viewRow(op) {
  const fuel = fuelState(op.launchDate);
  const tr = document.createElement("tr");
  tr.className = "fuel-" + fuel.key;
  const target = op.link
    ? `<a class="op-link" href="${escapeAttr(op.link)}" target="_blank" rel="noopener">${escapeHtml(op.target)}</a>`
    : escapeHtml(op.target);
  tr.innerHTML = `
    <td><strong>${escapeHtml(op.callSign)}</strong></td>
    <td>${target}</td>
    <td>${op.owner ? escapeHtml(op.owner) : "—"}</td>
    <td>${escapeHtml(op.launchDate)}</td>
    <td>${tClockLabel(op.launchDate)}</td>
    <td>${op.hours ? op.hours : "—"}</td>
    <td><span class="badge ${fuel.key}">${fuel.label}</span></td>
    <td class="actions">
      <button class="act-btn" data-act="edit" data-id="${op.id}">Edit</button>
      <button class="act-btn promote" data-act="promote" data-id="${op.id}">Promote</button>
      <button class="act-btn kill" data-act="kill" data-id="${op.id}">Retire</button>
      <button class="act-btn danger" data-act="delete" data-id="${op.id}">Delete</button>
    </td>`;
  return tr;
}

function renderBingo() {
  const banner = document.getElementById("bingoBanner");
  const n = OPS.filter(
    (o) => o.status === STATUS.ACTIVE && fuelState(o.launchDate).key === "red"
  ).length;
  banner.hidden = n === 0;
  if (n) banner.textContent = `⚠ ${n} operation${n > 1 ? "s" : ""} at BINGO fuel — promote to Core or retire.`;
}

/* ---------------- RENDER: STRATCOM ---------------- */

function renderStratcom() {
  const promoted = OPS.filter((o) => o.status === STATUS.PROMOTED);
  const killed = OPS.filter((o) => o.status === STATUS.KILLED);

  document.getElementById("mOps").textContent =
    OPS.filter((o) => LAUNCHED.includes(o.status)).length;
  const reclaimed = killed.reduce(
    (sum, o) => sum + (o.hours > 0 ? o.hours : HOURS_SAVED_PER_KILL),
    0
  );
  document.getElementById("mCasualty").textContent = Math.round(reclaimed) + " HRS";
  document.getElementById("mPromos").textContent = promoted.length;

  renderFuelBreakdown();
  renderReadiness();

  const valorList = document.getElementById("valorList");
  const graveList = document.getElementById("graveyardList");
  valorList.innerHTML = "";
  graveList.innerHTML = "";

  if (promoted.length === 0) {
    valorList.innerHTML = `<li class="empty-li">No promotions recorded.</li>`;
  }
  for (const op of promoted) valorList.appendChild(arenaItem(op, statusMeta(op, "Promoted to Core")));

  if (killed.length === 0) {
    graveList.innerHTML = `<li class="empty-li">No retired operations.</li>`;
  }
  for (const op of killed) {
    const hrs = op.hours > 0 ? op.hours : HOURS_SAVED_PER_KILL;
    graveList.appendChild(arenaItem(op, statusMeta(op, `Retired · ${hrs} hrs reclaimed`)));
  }
}

function statusMeta(op, verb) {
  if (!op.statusAt) return verb;
  const d = new Date(op.statusAt);
  if (isNaN(d)) return verb;
  return `${verb} · ${d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}`;
}

function arenaItem(op, metaText) {
  const li = document.createElement("li");
  const desc = op.link
    ? `<a class="op-link" href="${escapeAttr(op.link)}" target="_blank" rel="noopener">${escapeHtml(op.target)}</a>`
    : escapeHtml(op.target);
  li.innerHTML = `
    <div class="li-main">
      <span class="li-title">${escapeHtml(op.callSign)}</span>
      <span class="li-desc">${desc}</span>
      <span class="meta">${metaText}</span>
    </div>
    <div class="li-actions">
      <button class="act-btn" data-act="restore" data-id="${op.id}">Return to active</button>
      <button class="act-btn danger" data-act="delete" data-id="${op.id}">Delete</button>
    </div>`;
  return li;
}

/* Force Readiness posture derived from the active fleet's fuel states.
   Level 1 (Maximum) is the hottest, Level 5 (Standby) the calmest. */
function computeReadiness() {
  const active = OPS.filter((o) => o.status === STATUS.ACTIVE);
  let red = 0, yellow = 0;
  for (const o of active) {
    const k = fuelState(o.launchDate).key;
    if (k === "red") red++;
    else if (k === "yellow") yellow++;
  }
  if (active.length === 0)
    return { level: 5, name: "STANDBY", desc: "No active operations underway.", cls: "level-5" };
  if (red >= 3 || red > active.length / 2)
    return { level: 1, name: "MAXIMUM", desc: `${red} operations at Bingo — immediate command attention required.`, cls: "level-1" };
  if (red >= 1)
    return { level: 2, name: "CRITICAL", desc: `${red} operation${red > 1 ? "s" : ""} at Bingo fuel — action required.`, cls: "level-2" };
  if (yellow >= 1)
    return { level: 3, name: "ELEVATED", desc: `${yellow} operation${yellow > 1 ? "s" : ""} at Joker fuel — monitor closely.`, cls: "level-3" };
  return { level: 4, name: "STEADY", desc: "All active operations nominal.", cls: "level-4" };
}

function renderReadiness() {
  const r = computeReadiness();
  document.getElementById("readiness").className = "readiness " + r.cls;
  document.getElementById("readinessLevel").textContent = r.level;
  document.getElementById("readinessName").textContent = `READINESS ${r.level} — ${r.name}`;
  document.getElementById("readinessDesc").textContent = r.desc;
}

function renderFuelBreakdown() {
  const active = OPS.filter((o) => o.status === STATUS.ACTIVE);
  const c = { green: 0, yellow: 0, red: 0 };
  active.forEach((o) => c[fuelState(o.launchDate).key]++);
  document.getElementById("fbGreen").textContent = c.green;
  document.getElementById("fbYellow").textContent = c.yellow;
  document.getElementById("fbRed").textContent = c.red;
  document.getElementById("fbTotal").textContent = active.length + " active";

  const bar = document.getElementById("fbBar");
  bar.innerHTML = "";
  const total = active.length || 1;
  for (const k of ["green", "yellow", "red"]) {
    if (!c[k]) continue;
    const seg = document.createElement("div");
    seg.className = "fb-seg " + k;
    seg.style.width = (c[k] / total) * 100 + "%";
    seg.title = `${k}: ${c[k]}`;
    bar.appendChild(seg);
  }
  if (!active.length) {
    const seg = document.createElement("div");
    seg.className = "fb-seg empty";
    seg.style.width = "100%";
    bar.appendChild(seg);
  }
}

/* ---------------- RENDER: publish bar ---------------- */

function fmtUpdated() {
  if (!PUBLISHED_UPDATED) return "";
  const d = new Date(PUBLISHED_UPDATED);
  if (isNaN(d)) return "";
  return " · updated " + d.toLocaleString(undefined, {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

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
    : "Synced with the published board" + fmtUpdated();
}

/* ---------------- RENDER: pipeline (candidates + rejections) ---------------- */

function gateChip(op, key, label) {
  const on = op.gates && op.gates[key];
  return `<button type="button" class="chip ${on ? "on" : "off"}" data-act="togglegate" data-gate="${key}" data-id="${op.id}">${label} ${on ? "✓" : "✗"}</button>`;
}

function renderCandidates() {
  const list = document.getElementById("candidateList");
  const empty = document.getElementById("candidateEmpty");
  const cands = OPS.filter((o) => o.status === STATUS.CANDIDATE);
  empty.hidden = cands.length !== 0;
  list.innerHTML = "";
  for (const op of cands) {
    const ready = gatesPass(op);
    const target = op.link
      ? `<a class="op-link" href="${escapeAttr(op.link)}" target="_blank" rel="noopener">${escapeHtml(op.target)}</a>`
      : escapeHtml(op.target);
    const card = document.createElement("div");
    card.className = "cand-card" + (ready ? " ready" : "");
    card.innerHTML = `
      <div class="cand-head">
        <span class="cand-title">${escapeHtml(op.callSign)}</span>
        ${op.owner ? `<span class="cand-owner">${escapeHtml(op.owner)}</span>` : ""}
      </div>
      <div class="cand-target">${target}</div>
      <div class="cand-gates">
        ${gateChip(op, "data", "Data")}
        ${gateChip(op, "hours", "15 hrs")}
        ${gateChip(op, "roi", "2hr ROI")}
        ${op.roiPerWeek > 0 ? `<span class="cand-roi">${op.roiPerWeek} hrs/wk</span>` : ""}
      </div>
      <div class="cand-actions">
        <button class="act-btn promote" data-act="launch" data-id="${op.id}" ${ready ? "" : "disabled"}>Launch to BFT</button>
        <button class="act-btn" data-act="edit" data-id="${op.id}">Edit</button>
        <button class="act-btn kill" data-act="reject" data-id="${op.id}">Reject</button>
        <button class="act-btn danger" data-act="delete" data-id="${op.id}">Delete</button>
      </div>`;
    list.appendChild(card);
  }
}

function renderRejections() {
  const list = document.getElementById("rejectionLog");
  const empty = document.getElementById("rejectionEmpty");
  const rej = OPS.filter((o) => o.status === STATUS.REJECTED);
  empty.hidden = rej.length !== 0;
  list.innerHTML = "";
  for (const op of rej) {
    const failed = [];
    if (!op.gates.data) failed.push("Data");
    if (!op.gates.hours) failed.push("15 hrs");
    if (!op.gates.roi) failed.push("ROI");
    const bits = [op.rejectReason || "No reason recorded"];
    if (failed.length) bits.push("Failed: " + failed.join(", "));
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="li-main">
        <span class="li-title">${escapeHtml(op.callSign)}</span>
        <span class="li-desc">${escapeHtml(op.target)}</span>
        <span class="meta">${escapeHtml(bits.join(" · "))}${statusDateSuffix(op)}</span>
      </div>
      <div class="li-actions">
        <button class="act-btn" data-act="reopen" data-id="${op.id}">Reopen</button>
        <button class="act-btn danger" data-act="delete" data-id="${op.id}">Delete</button>
      </div>`;
    list.appendChild(li);
  }
}

function statusDateSuffix(op) {
  if (!op.statusAt) return "";
  const d = new Date(op.statusAt);
  if (isNaN(d)) return "";
  return " · " + d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

/* ---------------- RENDER: Armory ---------------- */

const READINESS_ORDER = ["FIELD-READY", "DEPLOYED", "SUSTAINED"];
function readinessInfo(r) {
  if (r === "DEPLOYED") return { label: "DEPLOYED", cls: "green" };
  if (r === "SUSTAINED") return { label: "SUSTAINED", cls: "accent" };
  return { label: "FIELD-READY", cls: "amber" };
}

function renderArmory() {
  const list = document.getElementById("armoryList");
  const empty = document.getElementById("armoryEmpty");
  const assets = OPS.filter((o) => o.status === STATUS.PROMOTED);
  empty.hidden = assets.length !== 0;
  list.innerHTML = "";

  let impact = 0, adopters = 0;
  for (const op of assets) {
    impact += op.roiPerWeek || 0;
    adopters += op.adoption || 0;
    const ri = readinessInfo(op.readiness);
    const link = op.link
      ? `<a class="op-link" href="${escapeAttr(op.link)}" target="_blank" rel="noopener">Deployment / docs ↗</a>`
      : `<span class="muted">No link</span>`;
    const card = document.createElement("div");
    card.className = "armory-card";
    card.innerHTML = `
      <div class="armory-head">
        <span class="armory-title">${escapeHtml(op.callSign)}</span>
        <button class="badge-btn ${ri.cls}" data-act="cycle-readiness" data-id="${op.id}" title="Cycle readiness state">${ri.label}</button>
      </div>
      <div class="armory-target">${escapeHtml(op.target)}</div>
      <div class="armory-meta">
        ${op.category ? `<span class="tagk">${escapeHtml(op.category)}</span>` : ""}
        ${op.owner ? `<span class="muted">${escapeHtml(op.owner)}</span>` : ""}
        ${op.statusAt ? `<span class="muted">Commissioned ${fmtDate(op.statusAt)}</span>` : ""}
      </div>
      <div class="armory-stats-row">
        <div class="ast"><span class="ast-v">${op.roiPerWeek || 0}</span><span class="ast-l">hrs/wk saved</span></div>
        <div class="ast">
          <button class="step" data-act="adopt-minus" data-id="${op.id}" aria-label="Decrease adopters">−</button>
          <span class="ast-v">${op.adoption || 0}</span><span class="ast-l">adopters</span>
          <button class="step" data-act="adopt-plus" data-id="${op.id}" aria-label="Increase adopters">+</button>
        </div>
      </div>
      <div class="armory-foot">
        ${link}
        <div class="armory-actions">
          <button class="act-btn" data-act="edit" data-id="${op.id}">Edit</button>
          <button class="act-btn" data-act="restore" data-id="${op.id}">Return to BFT</button>
          <button class="act-btn danger" data-act="kill" data-id="${op.id}">Decommission</button>
        </div>
      </div>`;
    list.appendChild(card);
  }

  document.getElementById("aCount").textContent = assets.length;
  document.getElementById("aImpact").textContent = Math.round(impact);
  document.getElementById("aAdoption").textContent = adopters;
}

function cycleReadiness(id) {
  const op = findOp(id);
  if (!op) return;
  const i = READINESS_ORDER.indexOf(op.readiness);
  op.readiness = READINESS_ORDER[(i + 1) % READINESS_ORDER.length];
  saveDraft();
  renderArmory();
}

function adjustAdoption(id, delta) {
  const op = findOp(id);
  if (!op) return;
  op.adoption = Math.max(0, (op.adoption || 0) + delta);
  saveDraft();
  renderArmory();
}

function renderAll() {
  renderBFT();
  renderArmory();
  renderStratcom();
  renderCandidates();
  renderRejections();
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
  op.statusAt = status === STATUS.ACTIVE ? "" : new Date().toISOString();
  saveDraft();
  renderAll();
}

async function deleteOp(id) {
  const op = findOp(id);
  if (!op) return;
  const ok = await modalConfirm(`Delete "${op.callSign}" permanently? This cannot be undone.`, {
    title: "Delete operation",
    okLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  OPS = OPS.filter((o) => o.id !== id);
  saveDraft();
  renderAll();
  toast("Operation deleted.", "success");
}

function addOperation(data) {
  OPS.push(normalizeOp({ id: newId(), status: STATUS.ACTIVE, ...data }));
  saveDraft();
  renderAll();
}

/* Toggle one qualification gate on a parked candidate. */
function toggleGate(id, key) {
  const op = findOp(id);
  if (!op) return;
  op.gates[key] = !op.gates[key];
  saveDraft();
  renderCandidates();
}

/* Promote a fully-qualified candidate onto the tracker; clock starts now. */
function launchCandidate(id) {
  const op = findOp(id);
  if (!op) return;
  if (!gatesPass(op)) {
    toast("All three gates must pass before launch.", "error");
    return;
  }
  op.status = STATUS.ACTIVE;
  op.launchDate = todayISO(); // T+0 — fuel clock begins on launch
  op.statusAt = "";
  saveDraft();
  renderAll();
  activateTab("bft");
  toast(`"${op.callSign}" launched to the tracker at T+0.`, "success");
}

/* Send a candidate to the rejection log with a recorded reason. */
async function rejectCandidate(id) {
  const op = findOp(id);
  if (!op) return;
  const reason = await modalPrompt("Why is this candidate rejected?", {
    title: "Reject candidate",
    placeholder: "e.g. Data not available until Q3",
    okLabel: "Reject",
    danger: true,
  });
  if (reason === null) return; // cancelled
  op.status = STATUS.REJECTED;
  op.rejectReason = reason.trim();
  op.statusAt = new Date().toISOString();
  saveDraft();
  renderAll();
  toast("Candidate moved to the rejection log.", "info");
}

/* Reopen a rejected candidate back into the pipeline. */
function reopenCandidate(id) {
  const op = findOp(id);
  if (!op) return;
  op.status = STATUS.CANDIDATE;
  op.rejectReason = "";
  op.statusAt = "";
  saveDraft();
  renderAll();
  toast("Candidate reopened in the pipeline.", "info");
}

async function editOperation(op) {
  if (!op) return;
  let captured = null;
  const result = await openModal({
    title: "Edit operation",
    bodyNode: opFormNode(op),
    actions: [
      { label: "Cancel", value: null },
      { label: "Save changes", value: "save", variant: "primary" },
    ],
    onAction: (value, body) => {
      if (value !== "save") return true;
      const d = readOpForm(body);
      if (!d.callSign || !d.launchDate) {
        toast("Call sign and launch date are required.", "error");
        return false;
      }
      captured = d;
      return true;
    },
  });
  if (result !== "save" || !captured) return;
  Object.assign(op, captured);
  saveDraft();
  renderAll();
  toast("Operation updated.", "success");
}

/* ---------------- GITHUB AUTO-SAVE ---------------- */

function getToken() {
  return (localStorage.getItem(TOKEN_KEY) || "").trim();
}

/* Ensure a token exists, prompting via modal if needed. Returns token or "". */
async function ensureToken() {
  if (getToken()) return getToken();
  await manageToken();
  return getToken();
}

/* Connection modal: set or clear the token. */
async function manageToken() {
  const node = document.createElement("div");
  node.innerHTML = `
    <form class="modal-form" autocomplete="off">
      <label class="field">
        <span>GitHub token (stored only in this browser)</span>
        <input name="token" type="password" value="${escapeAttr(getToken())}"
               placeholder="github_pat_… or ghp_…" autocomplete="off" />
      </label>
      <p class="modal-hint">
        Fine-grained token scoped to this repo with <strong>Contents: Read &amp; write</strong>.
        Leave blank and save to remove it.
      </p>
    </form>`;
  let captured = null;
  const result = await openModal({
    title: "GitHub connection",
    bodyNode: node,
    actions: [
      { label: "Cancel", value: null },
      { label: "Save", value: "save", variant: "primary" },
    ],
    onAction: (value, body) => {
      if (value === "save") captured = body.querySelector("[name=token]").value.trim();
      return true;
    },
  });
  if (result !== "save") return;
  if (captured) {
    localStorage.setItem(TOKEN_KEY, captured);
    toast("GitHub token saved in this browser.", "success");
  } else {
    localStorage.removeItem(TOKEN_KEY);
    toast("GitHub token removed.", "info");
  }
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

function boardPayload() {
  return JSON.stringify(
    { version: 1, updated: new Date().toISOString(), holidays: HOLIDAYS, operations: OPS },
    null,
    2
  );
}

async function saveToGitHub() {
  const token = await ensureToken();
  if (!token) {
    toast("Connect GitHub first to save.", "error");
    return;
  }
  setSaving(true);
  try {
    let sha;
    const head = await fetch(ghContentsUrl() + "?ref=" + GH.branch, {
      headers: ghHeaders(token),
      cache: "no-store",
    });
    if (head.status === 401) throw new Error("token rejected (401) — re-enter it via “GitHub: connected”.");
    if (head.ok) sha = (await head.json()).sha;
    else if (head.status !== 404) throw new Error("HTTP " + head.status);

    const payload = boardPayload();
    const body = { message: "Update operations board", content: toBase64(payload), branch: GH.branch };
    if (sha) body.sha = sha;

    const res = await fetch(ghContentsUrl(), {
      method: "PUT",
      headers: ghHeaders(token),
      body: JSON.stringify(body),
    });
    if (res.status === 401) throw new Error("token rejected (401) — re-enter it via “GitHub: connected”.");
    if (!res.ok) throw new Error("HTTP " + res.status + " — " + (await res.text()));

    // Saved: this is now the published board; clear the local draft.
    PUBLISHED = clone(OPS);
    PUBLISHED_UPDATED = JSON.parse(payload).updated;
    localStorage.removeItem(STORAGE_KEY);
    renderAll();
    toast("Saved to GitHub — live for everyone in ~1 minute.", "success");
  } catch (e) {
    console.error(e);
    toast("Could not save to GitHub: " + e.message, "error", 7000);
  } finally {
    setSaving(false);
  }
}

/* ---------------- PUBLISH (manual) / DISCARD / CSV ---------------- */

function downloadBlob(content, name, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function publish() {
  downloadBlob(boardPayload(), "operations.json", "application/json");
  toast("operations.json downloaded — commit it to data/ to publish.", "info", 6000);
}

async function discardDraft() {
  const ok = await modalConfirm("Discard local changes and show the published board?", {
    title: "Discard changes",
    okLabel: "Discard",
    danger: true,
  });
  if (!ok) return;
  localStorage.removeItem(STORAGE_KEY);
  OPS = clone(PUBLISHED);
  renderAll();
  toast("Reverted to the published board.", "info");
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function exportCsv() {
  if (!OPS.length) {
    toast("Nothing to export.", "error");
    return;
  }
  const cols = [
    "CallSign", "Target", "Owner", "Category", "Status", "LaunchDate", "T-ClockDays",
    "Hours", "FuelState", "ROIPerWeek", "Readiness", "Adopters",
    "GateData", "GateHours", "GateROI", "RejectReason", "StatusChanged", "Link",
  ];
  const lines = [cols.join(",")];
  for (const o of OPS) {
    const launched = LAUNCHED.includes(o.status);
    lines.push([
      o.callSign, o.target, o.owner, o.category, o.status, o.launchDate,
      launched ? daysSinceLaunch(o.launchDate) : "",
      o.hours, launched ? fuelState(o.launchDate).label : "",
      o.roiPerWeek || "", o.status === STATUS.PROMOTED ? o.readiness : "",
      o.status === STATUS.PROMOTED ? o.adoption : "",
      o.gates.data, o.gates.hours, o.gates.roi,
      o.rejectReason || "", o.statusAt || "", o.link || "",
    ].map(csvCell).join(","));
  }
  downloadBlob(lines.join("\n"), "operations.csv", "text/csv");
  toast("CSV exported.", "success");
}

/* ---------------- MODAL + TOAST ---------------- */

let modalResolve = null;

function openModal({ title, bodyNode, actions, onAction }) {
  const overlay = document.getElementById("modalOverlay");
  const body = document.getElementById("modalBody");
  const acts = document.getElementById("modalActions");
  document.getElementById("modalTitle").textContent = title || "";
  body.innerHTML = "";
  if (bodyNode) body.appendChild(bodyNode);
  acts.innerHTML = "";

  const list = actions || [{ label: "OK", value: true, variant: "primary" }];
  const fire = (value) => {
    if (onAction && onAction(value, body) === false) return;
    closeModal(value);
  };
  for (const a of list) {
    const b = document.createElement("button");
    b.className = "tool-btn" + (a.variant ? " " + a.variant : "");
    b.textContent = a.label;
    b.addEventListener("click", () => fire(a.value));
    acts.appendChild(b);
  }

  const form = body.querySelector("form");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const primary = list.find((a) => a.variant === "primary");
      if (primary) fire(primary.value);
    });
  }

  overlay.hidden = false;
  const focusEl = body.querySelector("input, textarea, select") || acts.querySelector("button");
  if (focusEl) focusEl.focus();
  return new Promise((res) => (modalResolve = res));
}

function closeModal(value) {
  document.getElementById("modalOverlay").hidden = true;
  const r = modalResolve;
  modalResolve = null;
  if (r) r(value);
}

function modalConfirm(message, opts = {}) {
  const node = document.createElement("p");
  node.className = "modal-message";
  node.textContent = message;
  return openModal({
    title: opts.title || "Confirm",
    bodyNode: node,
    actions: [
      { label: "Cancel", value: false },
      { label: opts.okLabel || "Confirm", value: true, variant: opts.danger ? "danger" : "primary" },
    ],
  }).then((v) => v === true);
}

/* Single-line text prompt. Resolves to the entered string, or null if cancelled. */
function modalPrompt(message, opts = {}) {
  const node = document.createElement("div");
  node.innerHTML = `
    <form class="modal-form" autocomplete="off">
      <p class="modal-message">${escapeHtml(message)}</p>
      <label class="field">
        <input name="val" value="${escapeAttr(opts.value || "")}"
               placeholder="${escapeAttr(opts.placeholder || "")}" />
      </label>
    </form>`;
  let captured = null;
  return openModal({
    title: opts.title || "Input",
    bodyNode: node,
    actions: [
      { label: "Cancel", value: null },
      { label: opts.okLabel || "OK", value: "ok", variant: opts.danger ? "danger" : "primary" },
    ],
    onAction: (value, body) => {
      if (value === "ok") captured = body.querySelector("[name=val]").value;
      return true;
    },
  }).then((r) => (r === "ok" ? captured || "" : null));
}

function toast(message, type = "info", ms = 3500) {
  const host = document.getElementById("toastHost");
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 250);
  }, ms);
}

/* ---------------- OP FORM (shared by edit modal) ---------------- */

function opFormNode(op) {
  const div = document.createElement("div");
  div.innerHTML = `
    <form class="modal-form" autocomplete="off">
      <label class="field"><span>Call Sign</span>
        <input name="callSign" value="${escapeAttr(op.callSign || "")}" required /></label>
      <label class="field"><span>Target / Objective</span>
        <input name="target" value="${escapeAttr(op.target || "")}" /></label>
      <div class="field-row">
        <label class="field"><span>Owner / Engineer</span>
          <input name="owner" value="${escapeAttr(op.owner || "")}" /></label>
        <label class="field"><span>Category / Domain</span>
          <input name="category" value="${escapeAttr(op.category || "")}" placeholder="e.g. Support, Sales" /></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Launch Date</span>
          <input name="launchDate" type="date" value="${escapeAttr(op.launchDate || "")}" required /></label>
        <label class="field"><span>Hours/wk Saved</span>
          <input name="roiPerWeek" type="number" min="0" step="0.5" value="${escapeAttr(String(op.roiPerWeek || 0))}" /></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Hours Logged</span>
          <input name="hours" type="number" min="0" step="0.5" value="${escapeAttr(String(op.hours || 0))}" /></label>
        <label class="field"><span>Prototype Link</span>
          <input name="link" type="url" value="${escapeAttr(op.link || "")}" /></label>
      </div>
    </form>`;
  return div;
}

function readOpForm(body) {
  const g = (n) => {
    const el = body.querySelector(`[name=${n}]`);
    return el ? el.value : "";
  };
  return {
    callSign: g("callSign").trim(),
    target: g("target").trim(),
    owner: g("owner").trim(),
    category: g("category").trim(),
    launchDate: g("launchDate"),
    roiPerWeek: Number(g("roiPerWeek")) || 0,
    hours: Number(g("hours")) || 0,
    link: g("link").trim(),
  };
}

/* ---------------- WIRING ---------------- */

function wireFunnel() {
  const gates = ["gData", "gHours", "gRoi"].map((id) => document.getElementById(id));
  const btn = document.getElementById("promoteBtn");
  const hint = document.getElementById("gateHint");
  const form = document.getElementById("funnelForm");
  const pips = document.querySelectorAll("#gateProgress .pips i");
  const progLabel = document.getElementById("gateProgressLabel");

  function refreshGate() {
    const cleared = gates.filter((g) => g.checked).length;
    pips.forEach((p, i) => p.classList.toggle("on", i < cleared));
    progLabel.textContent = `${cleared} of 3 gates cleared`;
    const allClear = cleared === 3;
    btn.hidden = !allClear;
    hint.hidden = allClear;
    if (!allClear) {
      hint.textContent = `Clear all three gates to enable promotion — ${3 - cleared} remaining.`;
    }
  }
  gates.forEach((g) => g.addEventListener("change", refreshGate));
  refreshGate();

  // ROI calculator: minutes × frequency → hours/week, drives the ROI gate.
  const roiMin = document.getElementById("roiMin");
  const roiFreq = document.getElementById("roiFreq");
  const roiResult = document.getElementById("roiResult");
  const roiHidden = document.getElementById("fRoiPerWeek");
  function calcRoi() {
    const m = Number(roiMin.value) || 0;
    const f = Number(roiFreq.value) || 0;
    if (!m || !f) {
      roiResult.textContent = "= — hrs/week";
      roiResult.className = "roi-result";
      roiHidden.value = "0";
      return;
    }
    const hrs = (m * f) / 60;
    roiHidden.value = hrs.toFixed(2);
    const ok = hrs >= 2;
    roiResult.textContent = `= ${hrs.toFixed(1)} hrs/week ${ok ? "— qualifies" : "— below 2 hr threshold"}`;
    roiResult.className = "roi-result " + (ok ? "pass" : "fail");
    document.getElementById("gRoi").checked = ok;
    refreshGate();
  }
  roiMin.addEventListener("input", calcRoi);
  roiFreq.addEventListener("input", calcRoi);

  function readFunnel() {
    return {
      callSign: document.getElementById("fCallSign").value.trim(),
      target: document.getElementById("fTarget").value.trim(),
      owner: document.getElementById("fOwner").value.trim(),
      category: document.getElementById("fCategory").value.trim(),
      launchDate: document.getElementById("fLaunchDate").value,
      hours: Number(document.getElementById("fHours").value) || 0,
      link: document.getElementById("fLink").value.trim(),
      roiPerWeek: Number(roiHidden.value) || 0,
      gates: { data: gates[0].checked, hours: gates[1].checked, roi: gates[2].checked },
    };
  }

  function resetFunnel() {
    form.reset();
    roiResult.textContent = "= — hrs/week";
    roiResult.className = "roi-result";
    roiHidden.value = "0";
    refreshGate();
  }

  // Promote: only when all gates cleared (button hidden otherwise).
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!gates.every((g) => g.checked)) return; // hard gate guard
    const d = readFunnel();
    if (!d.callSign || !d.target || !d.launchDate) return;
    addOperation({ ...d, status: STATUS.ACTIVE });
    resetFunnel();
    activateTab("bft");
    toast(`Operation "${d.callSign}" added to the tracker.`, "success");
  });

  // Save as candidate: always available, gates optional.
  document.getElementById("candidateBtn").addEventListener("click", () => {
    const d = readFunnel();
    if (!d.callSign || !d.target) {
      toast("Call sign and target are required to save a candidate.", "error");
      return;
    }
    addOperation({ ...d, status: STATUS.CANDIDATE });
    resetFunnel();
    toast(`"${d.callSign}" saved to the candidate pipeline.`, "success");
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
    case "edit": editOperation(findOp(id)); break;
    case "promote": setStatus(id, STATUS.PROMOTED); break;
    case "kill": setStatus(id, STATUS.KILLED); break;
    case "restore": setStatus(id, STATUS.ACTIVE); break;
    case "delete": deleteOp(id); break;
    case "togglegate": toggleGate(id, btn.dataset.gate); break;
    case "launch": launchCandidate(id); break;
    case "reject": rejectCandidate(id); break;
    case "reopen": reopenCandidate(id); break;
    case "cycle-readiness": cycleReadiness(id); break;
    case "adopt-plus": adjustAdoption(id, 1); break;
    case "adopt-minus": adjustAdoption(id, -1); break;
  }
}

function wireActions() {
  document.getElementById("bftBody").addEventListener("click", handleAction);
  document.getElementById("valorList").addEventListener("click", handleAction);
  document.getElementById("graveyardList").addEventListener("click", handleAction);
  document.getElementById("candidateList").addEventListener("click", handleAction);
  document.getElementById("rejectionLog").addEventListener("click", handleAction);
  document.getElementById("armoryList").addEventListener("click", handleAction);
  document.getElementById("btnSaveGithub").addEventListener("click", saveToGitHub);
  document.getElementById("btnPublish").addEventListener("click", publish);
  document.getElementById("btnDiscard").addEventListener("click", discardDraft);
  document.getElementById("btnToken").addEventListener("click", manageToken);
  document.getElementById("btnCsv").addEventListener("click", exportCsv);

  ["bftSearch", "bftFuel", "bftSort"].forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener("input", renderBFT);
    el.addEventListener("change", renderBFT);
  });
}

function wireModal() {
  const overlay = document.getElementById("modalOverlay");
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal(null);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) closeModal(null);
  });
}

function renderDate() {
  document.getElementById("hudDate").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "short", day: "2-digit", month: "short", year: "numeric",
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
  wireModal();
  renderDate();

  PUBLISHED = await fetchPublished();
  const draft = loadDraft();
  OPS = draft || clone(PUBLISHED); // your draft on your machine; published board for everyone else
  renderAll();

  // Re-evaluate fuel states across a midnight boundary while running.
  setInterval(() => {
    renderBFT();
    renderFuelBreakdown();
  }, 60 * 1000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
