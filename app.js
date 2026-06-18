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

let OPS = [];                  // current working operations
let INTENT = "";               // Commander's Intent (working)
let THEATERS = [];             // Theaters of Operation (working)
let BOUNTIES = [];             // Bounty Board (working)
let HOLIDAYS = [];             // YYYY-MM-DD dates excluded from the T-Clock (working)
let HOLIDAY_SET = new Set();

// Published copies (the committed board) — used to discard local changes.
let PUBLISHED = [];
let PUBLISHED_INTENT = "";
let PUBLISHED_THEATERS = [];
let PUBLISHED_BOUNTIES = [];
let PUBLISHED_HOLIDAYS = [];
let PUBLISHED_UPDATED = null;

/* ---------------- DATA: published board + local draft ---------------- */

async function fetchPublished() {
  try {
    const res = await fetch(PUBLISHED_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const list = Array.isArray(data) ? data : data.operations;
    PUBLISHED_UPDATED = (data && data.updated) || null;
    PUBLISHED_HOLIDAYS = Array.isArray(data && data.holidays) ? data.holidays : [];
    PUBLISHED_INTENT = (data && data.intent) || "";
    PUBLISHED_THEATERS = Array.isArray(data && data.theaters) ? data.theaters.map(normalizeTheater) : [];
    PUBLISHED_BOUNTIES = Array.isArray(data && data.bounties) ? data.bounties.map(normalizeBounty) : [];
    return Array.isArray(list) ? list.map(normalizeOp) : [];
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
    if (Array.isArray(parsed)) return { operations: parsed.map(normalizeOp) }; // legacy format
    return {
      operations: Array.isArray(parsed.operations) ? parsed.operations.map(normalizeOp) : [],
      intent: parsed.intent,
      theaters: Array.isArray(parsed.theaters) ? parsed.theaters.map(normalizeTheater) : undefined,
      bounties: Array.isArray(parsed.bounties) ? parsed.bounties.map(normalizeBounty) : undefined,
      holidays: Array.isArray(parsed.holidays) ? parsed.holidays : undefined,
    };
  } catch (e) {
    console.warn("Vanguard: corrupt draft, ignoring.", e);
    return null;
  }
}

function hasDraft() {
  return localStorage.getItem(STORAGE_KEY) !== null;
}

function saveDraft() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ operations: OPS, intent: INTENT, theaters: THEATERS, bounties: BOUNTIES, holidays: HOLIDAYS })
  );
  renderPublishBar();
}

function normalizeTheater(t) {
  return {
    id: t.id || "th_" + Date.now() + "_" + Math.floor(Math.random() * 1e4),
    name: t.name || "Theater",
    desc: t.desc || "",
    target: Number(t.target) || 0,
  };
}

function normalizeBounty(b) {
  return {
    id: b.id || "bnt_" + Date.now() + "_" + Math.floor(Math.random() * 1e4),
    title: b.title || "Untitled bounty",
    desc: b.desc || "",
    theater: b.theater || "",
    reward: Number(b.reward) || 0,
    status: b.status || "OPEN", // OPEN | CLAIMED | DELIVERED
    claimedBy: b.claimedBy || "",
    deliveredBy: b.deliveredBy || "",
    statusAt: b.statusAt || "",
  };
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

/* ---------------- RENDER: Personnel & Honors ---------------- */

const RANKS = [
  { min: 0, name: "Recruit", abbr: "RCT" },
  { min: 25, name: "Private", abbr: "PVT" },
  { min: 75, name: "Corporal", abbr: "CPL" },
  { min: 150, name: "Sergeant", abbr: "SGT" },
  { min: 275, name: "Lieutenant", abbr: "LT" },
  { min: 450, name: "Captain", abbr: "CPT" },
  { min: 700, name: "Major", abbr: "MAJ" },
  { min: 1000, name: "Colonel", abbr: "COL" },
  { min: 1400, name: "General", abbr: "GEN" },
];

function rankFor(points) {
  let rank = RANKS[0];
  let next = null;
  for (let i = 0; i < RANKS.length; i++) {
    if (points >= RANKS[i].min) {
      rank = RANKS[i];
      next = RANKS[i + 1] || null;
    }
  }
  return { rank, next };
}

/* Aggregate per-owner stats and command points across all operations. */
function ensureContrib(map, name) {
  if (!map.has(name)) {
    map.set(name, { name, launched: 0, active: 0, promoted: 0, killed: 0, candidates: 0, hrsWeek: 0, adopters: 0, bounties: 0, bountyPoints: 0 });
  }
  return map.get(name);
}

function computeContributors() {
  const map = new Map();
  for (const o of OPS) {
    const name = (o.owner || "").trim();
    if (!name) continue;
    const c = ensureContrib(map, name);
    if (LAUNCHED.includes(o.status)) c.launched++;
    if (o.status === STATUS.ACTIVE) c.active++;
    if (o.status === STATUS.PROMOTED) {
      c.promoted++;
      c.hrsWeek += o.roiPerWeek || 0;
      c.adopters += o.adoption || 0;
    }
    if (o.status === STATUS.KILLED) c.killed++;
    if (o.status === STATUS.CANDIDATE) c.candidates++;
  }
  // Delivered bounties credit their reward to the contributor who delivered.
  for (const b of BOUNTIES) {
    if (b.status !== "DELIVERED") continue;
    const name = (b.deliveredBy || "").trim();
    if (!name) continue;
    const c = ensureContrib(map, name);
    c.bounties++;
    c.bountyPoints += b.reward || 0;
  }
  const arr = [...map.values()];
  for (const c of arr) {
    c.points = c.launched * 10 + c.promoted * 50 + c.killed * 5 + Math.round(c.hrsWeek) * 5 + c.adopters * 2 + c.bountyPoints;
  }
  arr.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  return arr;
}

function medalsFor(c, topName) {
  const m = [];
  if (c.promoted >= 1) m.push({ code: "FB", name: "First Blood" });
  if (c.promoted >= 3) m.push({ code: "ACE", name: "Ace" });
  if (c.hrsWeek >= 20) m.push({ code: "EC", name: "Efficiency Cross" });
  if (c.launched >= 5) m.push({ code: "TB", name: "Trailblazer" });
  if (c.killed >= 3) m.push({ code: "CV", name: "Combat Veteran" });
  if (c.launched >= 3 && c.promoted / c.launched >= 0.5) m.push({ code: "SS", name: "Sharpshooter" });
  if (c.bounties >= 2) m.push({ code: "BH", name: "Bounty Hunter" });
  if (topName && c.name === topName && c.points > 0) m.push({ code: "TG", name: "Top Gun" });
  return m;
}

function renderPersonnel() {
  const list = document.getElementById("personnelList");
  const empty = document.getElementById("personnelEmpty");
  const arr = computeContributors();
  empty.hidden = arr.length !== 0;

  const topName = arr.length && arr[0].points > 0 ? arr[0].name : null;
  document.getElementById("pCount").textContent = arr.length;
  document.getElementById("pTop").textContent = topName || "—";
  document.getElementById("pMedals").textContent = arr.reduce((s, c) => s + medalsFor(c, topName).length, 0);

  // Rank ladder reference (rendered once into the honors key).
  const ladder = document.getElementById("rankLadder");
  if (ladder) ladder.innerHTML = RANKS.map((r) => `${escapeHtml(r.name)} <em>${r.min}</em>`).join(" · ");

  list.innerHTML = "";
  arr.forEach((c) => {
    const { rank, next } = rankFor(c.points);
    const pct = next ? Math.min(100, Math.round(((c.points - rank.min) / (next.min - rank.min)) * 100)) : 100;
    const medals = medalsFor(c, topName);
    const nextLabel = next ? `${next.min - c.points} pts to ${next.name}` : "Highest rank achieved";
    const card = document.createElement("div");
    card.className = "person-card";
    card.innerHTML = `
      <div class="person-head">
        <span class="rank-insignia" title="${escapeAttr(rank.name)}">${rank.abbr}</span>
        <div class="person-id">
          <span class="person-name">${escapeHtml(c.name)}</span>
          <span class="person-rank">${escapeHtml(rank.name)}</span>
        </div>
        <span class="person-points">${c.points}<small>pts</small></span>
      </div>
      <div class="person-stats">
        <span><b>${c.launched}</b> launched</span>
        <span><b>${c.promoted}</b> to Core</span>
        <span><b>${c.killed}</b> retired</span>
        <span><b>${Math.round(c.hrsWeek)}</b> hrs/wk</span>
      </div>
      <div class="rank-progress" title="${escapeAttr(nextLabel)}">
        <div class="rank-progress-fill" style="width:${pct}%"></div>
      </div>
      <div class="rank-next">${escapeHtml(nextLabel)}</div>
      <div class="medals">${medals.length ? medals.map(medalChip).join("") : '<span class="muted">No commendations yet</span>'}</div>`;
    list.appendChild(card);
  });
}

function medalChip(m) {
  return `<span class="medal" title="${escapeAttr(m.name)}"><span class="medal-code">${m.code}</span>${escapeHtml(m.name)}</span>`;
}

/* ---------------- RENDER: Strategy (Commander's Intent + Theaters) ---------------- */

/* Operations join a theater when their Category matches the theater name. */
function theaterCounts(name) {
  const key = (name || "").trim().toLowerCase();
  let fielded = 0, deployed = 0, pipeline = 0;
  for (const o of OPS) {
    if ((o.category || "").trim().toLowerCase() !== key) continue;
    if (LAUNCHED.includes(o.status)) fielded++;
    if (o.status === STATUS.PROMOTED) deployed++;
    if (o.status === STATUS.CANDIDATE) pipeline++;
  }
  return { fielded, deployed, pipeline };
}

function renderStrategy() {
  const intentEl = document.getElementById("intentText");
  if (INTENT.trim()) {
    intentEl.textContent = INTENT;
    intentEl.classList.remove("muted");
  } else {
    intentEl.textContent = "No Commander's Intent set. Use Edit to state the strategic priorities for the campaign.";
    intentEl.classList.add("muted");
  }

  const list = document.getElementById("theaterList");
  const empty = document.getElementById("theaterEmpty");
  empty.hidden = THEATERS.length !== 0;
  list.innerHTML = "";
  for (const t of THEATERS) {
    const c = theaterCounts(t.name);
    const pct = t.target > 0 ? Math.min(100, Math.round((c.fielded / t.target) * 100)) : (c.fielded > 0 ? 100 : 0);
    const card = document.createElement("div");
    card.className = "theater-card";
    card.innerHTML = `
      <div class="theater-head">
        <span class="theater-name">${escapeHtml(t.name)}</span>
        <span class="theater-target">${c.fielded}${t.target > 0 ? " / " + t.target : ""} fielded</span>
      </div>
      ${t.desc ? `<div class="theater-desc">${escapeHtml(t.desc)}</div>` : ""}
      <div class="theater-progress"><div class="theater-progress-fill" style="width:${pct}%"></div></div>
      <div class="theater-meta">
        <span><b>${c.deployed}</b> deployed</span>
        <span><b>${c.pipeline}</b> in pipeline</span>
      </div>
      <div class="theater-actions">
        <button class="act-btn" data-tact="edit" data-id="${t.id}">Edit</button>
        <button class="act-btn danger" data-tact="remove" data-id="${t.id}">Remove</button>
      </div>`;
    list.appendChild(card);
  }
}

async function editIntent() {
  const node = document.createElement("div");
  node.innerHTML = `
    <form class="modal-form">
      <label class="field"><span>Commander's Intent</span>
        <textarea name="intent" rows="6" class="modal-textarea"
          placeholder="State the strategic priorities for the AI innovation campaign…">${escapeHtml(INTENT)}</textarea></label>
    </form>`;
  let captured = null;
  const r = await openModal({
    title: "Edit Commander's Intent",
    bodyNode: node,
    actions: [{ label: "Cancel", value: null }, { label: "Save", value: "save", variant: "primary" }],
    onAction: (v, b) => { if (v === "save") captured = b.querySelector("[name=intent]").value; return true; },
  });
  if (r !== "save") return;
  INTENT = captured.trim();
  saveDraft();
  renderStrategy();
  toast("Commander's Intent updated.", "success");
}

function theaterFormNode(t) {
  t = t || {};
  const div = document.createElement("div");
  div.innerHTML = `
    <form class="modal-form" autocomplete="off">
      <label class="field"><span>Theater Name</span>
        <input name="name" value="${escapeAttr(t.name || "")}" placeholder="e.g. Customer Support" required /></label>
      <label class="field"><span>Strategic Aim</span>
        <input name="desc" value="${escapeAttr(t.desc || "")}" placeholder="What this theater is for" /></label>
      <label class="field"><span>Target (operations to field)</span>
        <input name="target" type="number" min="0" step="1" value="${escapeAttr(String(t.target || 0))}" /></label>
      <p class="modal-hint">Operations join this theater when their <strong>Category</strong> equals the theater name.</p>
    </form>`;
  return div;
}

async function theaterModal(existing) {
  let captured = null;
  const r = await openModal({
    title: existing ? "Edit Theater" : "Add Theater",
    bodyNode: theaterFormNode(existing),
    actions: [{ label: "Cancel", value: null }, { label: "Save", value: "save", variant: "primary" }],
    onAction: (v, b) => {
      if (v !== "save") return true;
      const name = b.querySelector("[name=name]").value.trim();
      if (!name) { toast("Theater name is required.", "error"); return false; }
      captured = {
        name,
        desc: b.querySelector("[name=desc]").value.trim(),
        target: Number(b.querySelector("[name=target]").value) || 0,
      };
      return true;
    },
  });
  return r === "save" ? captured : null;
}

async function addTheater() {
  const data = await theaterModal(null);
  if (!data) return;
  THEATERS.push(normalizeTheater(data));
  saveDraft();
  renderStrategy();
  toast(`Theater "${data.name}" added.`, "success");
}

async function editTheater(id) {
  const t = THEATERS.find((x) => x.id === id);
  if (!t) return;
  const data = await theaterModal(t);
  if (!data) return;
  Object.assign(t, data);
  saveDraft();
  renderStrategy();
  toast("Theater updated.", "success");
}

async function removeTheater(id) {
  const t = THEATERS.find((x) => x.id === id);
  if (!t) return;
  const ok = await modalConfirm(`Remove theater "${t.name}"? Operations are not affected.`, {
    title: "Remove theater", okLabel: "Remove", danger: true,
  });
  if (!ok) return;
  THEATERS = THEATERS.filter((x) => x.id !== id);
  saveDraft();
  renderStrategy();
  toast("Theater removed.", "info");
}

function handleTheaterAction(e) {
  const btn = e.target.closest(".act-btn");
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.tact === "edit") editTheater(id);
  else if (btn.dataset.tact === "remove") removeTheater(id);
}

/* ---------------- RENDER: Bounty Board ---------------- */

const BOUNTY_STATUS = {
  OPEN: { label: "OPEN", cls: "open" },
  CLAIMED: { label: "CLAIMED", cls: "claimed" },
  DELIVERED: { label: "DELIVERED", cls: "delivered" },
};

function renderBounties() {
  const list = document.getElementById("bountyList");
  const empty = document.getElementById("bountyEmpty");
  empty.hidden = BOUNTIES.length !== 0;

  const counts = { OPEN: 0, CLAIMED: 0, DELIVERED: 0 };
  BOUNTIES.forEach((b) => { counts[b.status] = (counts[b.status] || 0) + 1; });
  const tally = document.getElementById("bountyTally");
  if (tally) tally.textContent = `${counts.OPEN} open · ${counts.CLAIMED} claimed · ${counts.DELIVERED} delivered`;

  list.innerHTML = "";
  for (const b of BOUNTIES) {
    const st = BOUNTY_STATUS[b.status] || BOUNTY_STATUS.OPEN;
    let who = "";
    if (b.status === "CLAIMED" && b.claimedBy) who = `<span class="muted">Claimed by ${escapeHtml(b.claimedBy)}</span>`;
    if (b.status === "DELIVERED" && b.deliveredBy) who = `<span class="muted">Delivered by ${escapeHtml(b.deliveredBy)}</span>`;

    let actions = "";
    if (b.status === "OPEN") {
      actions = `
        <button class="act-btn promote" data-bact="claim" data-id="${b.id}">Claim</button>
        <button class="act-btn" data-bact="edit" data-id="${b.id}">Edit</button>
        <button class="act-btn danger" data-bact="remove" data-id="${b.id}">Remove</button>`;
    } else if (b.status === "CLAIMED") {
      actions = `
        <button class="act-btn promote" data-bact="deliver" data-id="${b.id}">Mark Delivered</button>
        <button class="act-btn" data-bact="release" data-id="${b.id}">Release</button>
        <button class="act-btn danger" data-bact="remove" data-id="${b.id}">Remove</button>`;
    } else {
      actions = `
        <button class="act-btn" data-bact="reopen" data-id="${b.id}">Reopen</button>
        <button class="act-btn danger" data-bact="remove" data-id="${b.id}">Remove</button>`;
    }

    const card = document.createElement("div");
    card.className = "bounty-card status-" + st.cls;
    card.innerHTML = `
      <div class="bounty-head">
        <span class="bounty-title">${escapeHtml(b.title)}</span>
        <span class="bounty-reward">+${b.reward} pts</span>
      </div>
      ${b.desc ? `<div class="bounty-desc">${escapeHtml(b.desc)}</div>` : ""}
      <div class="bounty-meta">
        <span class="bounty-status ${st.cls}">${st.label}</span>
        ${b.theater ? `<span class="tagk">${escapeHtml(b.theater)}</span>` : ""}
        ${who}
      </div>
      <div class="bounty-actions">${actions}</div>`;
    list.appendChild(card);
  }
}

function bountyFormNode(b) {
  b = b || {};
  const opts = THEATERS.map((t) => `<option value="${escapeAttr(t.name)}"></option>`).join("");
  const div = document.createElement("div");
  div.innerHTML = `
    <form class="modal-form" autocomplete="off">
      <label class="field"><span>Target / Problem</span>
        <input name="title" value="${escapeAttr(b.title || "")}" placeholder="e.g. Cut Tier-1 first-response time" required /></label>
      <label class="field"><span>Details</span>
        <textarea name="desc" rows="3" class="modal-textarea" placeholder="What success looks like">${escapeHtml(b.desc || "")}</textarea></label>
      <div class="field-row">
        <label class="field"><span>Theater (optional)</span>
          <input name="theater" list="theaterOptions" value="${escapeAttr(b.theater || "")}" placeholder="Match a theater" />
          <datalist id="theaterOptions">${opts}</datalist></label>
        <label class="field"><span>Reward (points)</span>
          <input name="reward" type="number" min="0" step="5" value="${escapeAttr(String(b.reward || 25))}" /></label>
      </div>
    </form>`;
  return div;
}

async function bountyModal(existing) {
  let captured = null;
  const r = await openModal({
    title: existing ? "Edit Bounty" : "Post Bounty",
    bodyNode: bountyFormNode(existing),
    actions: [{ label: "Cancel", value: null }, { label: "Save", value: "save", variant: "primary" }],
    onAction: (v, b) => {
      if (v !== "save") return true;
      const title = b.querySelector("[name=title]").value.trim();
      if (!title) { toast("A target/problem title is required.", "error"); return false; }
      captured = {
        title,
        desc: b.querySelector("[name=desc]").value.trim(),
        theater: b.querySelector("[name=theater]").value.trim(),
        reward: Number(b.querySelector("[name=reward]").value) || 0,
      };
      return true;
    },
  });
  return r === "save" ? captured : null;
}

async function postBounty() {
  const data = await bountyModal(null);
  if (!data) return;
  BOUNTIES.push(normalizeBounty({ ...data, status: "OPEN" }));
  saveDraft();
  renderBounties();
  toast("Bounty posted.", "success");
}

async function editBounty(id) {
  const b = BOUNTIES.find((x) => x.id === id);
  if (!b) return;
  const data = await bountyModal(b);
  if (!data) return;
  Object.assign(b, data);
  saveDraft();
  renderBounties();
  toast("Bounty updated.", "success");
}

async function claimBounty(id) {
  const b = BOUNTIES.find((x) => x.id === id);
  if (!b) return;
  const name = await modalPrompt("Who is claiming this bounty?", {
    title: "Claim bounty", placeholder: "Name / call sign", okLabel: "Claim",
  });
  if (name === null) return;
  if (!name.trim()) { toast("A name is required to claim.", "error"); return; }
  b.status = "CLAIMED";
  b.claimedBy = name.trim();
  b.statusAt = new Date().toISOString();
  saveDraft();
  renderBounties();
  toast(`Bounty claimed by ${b.claimedBy}.`, "success");
}

function releaseBounty(id) {
  const b = BOUNTIES.find((x) => x.id === id);
  if (!b) return;
  b.status = "OPEN";
  b.claimedBy = "";
  b.statusAt = new Date().toISOString();
  saveDraft();
  renderBounties();
  toast("Bounty released back to open.", "info");
}

function deliverBounty(id) {
  const b = BOUNTIES.find((x) => x.id === id);
  if (!b) return;
  b.status = "DELIVERED";
  b.deliveredBy = b.claimedBy || b.deliveredBy;
  b.statusAt = new Date().toISOString();
  saveDraft();
  renderAll(); // affects Personnel points
  toast(`Bounty delivered — ${b.reward} pts to ${b.deliveredBy || "the team"}.`, "success");
}

function reopenBounty(id) {
  const b = BOUNTIES.find((x) => x.id === id);
  if (!b) return;
  b.status = "OPEN";
  b.claimedBy = "";
  b.deliveredBy = "";
  b.statusAt = new Date().toISOString();
  saveDraft();
  renderAll();
  toast("Bounty reopened.", "info");
}

async function removeBounty(id) {
  const b = BOUNTIES.find((x) => x.id === id);
  if (!b) return;
  const ok = await modalConfirm(`Remove bounty "${b.title}"?`, { title: "Remove bounty", okLabel: "Remove", danger: true });
  if (!ok) return;
  BOUNTIES = BOUNTIES.filter((x) => x.id !== id);
  saveDraft();
  renderAll();
  toast("Bounty removed.", "info");
}

function handleBountyAction(e) {
  const btn = e.target.closest(".act-btn");
  if (!btn) return;
  const id = btn.dataset.id;
  switch (btn.dataset.bact) {
    case "claim": claimBounty(id); break;
    case "deliver": deliverBounty(id); break;
    case "release": releaseBounty(id); break;
    case "reopen": reopenBounty(id); break;
    case "edit": editBounty(id); break;
    case "remove": removeBounty(id); break;
  }
}

function renderAll() {
  renderBFT();
  renderArmory();
  renderStratcom();
  renderPersonnel();
  renderStrategy();
  renderBounties();
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
    {
      version: 1,
      updated: new Date().toISOString(),
      intent: INTENT,
      theaters: THEATERS,
      bounties: BOUNTIES,
      holidays: HOLIDAYS,
      operations: OPS,
    },
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
    PUBLISHED_INTENT = INTENT;
    PUBLISHED_THEATERS = THEATERS.map((t) => ({ ...t }));
    PUBLISHED_BOUNTIES = BOUNTIES.map((b) => ({ ...b }));
    PUBLISHED_HOLIDAYS = [...HOLIDAYS];
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
  INTENT = PUBLISHED_INTENT;
  THEATERS = PUBLISHED_THEATERS.map((t) => ({ ...t }));
  BOUNTIES = PUBLISHED_BOUNTIES.map((b) => ({ ...b }));
  HOLIDAYS = [...PUBLISHED_HOLIDAYS];
  HOLIDAY_SET = new Set(HOLIDAYS);
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
  document.getElementById("theaterList").addEventListener("click", handleTheaterAction);
  document.getElementById("btnEditIntent").addEventListener("click", editIntent);
  document.getElementById("btnAddTheater").addEventListener("click", addTheater);
  document.getElementById("bountyList").addEventListener("click", handleBountyAction);
  document.getElementById("btnPostBounty").addEventListener("click", postBounty);
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
  if (draft) {
    OPS = draft.operations;
    INTENT = draft.intent !== undefined ? draft.intent : PUBLISHED_INTENT;
    THEATERS = draft.theaters !== undefined ? draft.theaters : PUBLISHED_THEATERS.map((t) => ({ ...t }));
    BOUNTIES = draft.bounties !== undefined ? draft.bounties : PUBLISHED_BOUNTIES.map((b) => ({ ...b }));
    HOLIDAYS = draft.holidays !== undefined ? draft.holidays : [...PUBLISHED_HOLIDAYS];
  } else {
    OPS = clone(PUBLISHED);
    INTENT = PUBLISHED_INTENT;
    THEATERS = PUBLISHED_THEATERS.map((t) => ({ ...t }));
    BOUNTIES = PUBLISHED_BOUNTIES.map((b) => ({ ...b }));
    HOLIDAYS = [...PUBLISHED_HOLIDAYS];
  }
  HOLIDAY_SET = new Set(HOLIDAYS);
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
