/* ============================================================
   VANGUARD OPS — COMMAND HUB
   All data lives in localStorage. No backend needed.
   ============================================================ */

// ─────────────────────────────────────────────────────────────
// DATA STORE
// ─────────────────────────────────────────────────────────────

const NATO = [
  'Alpha','Bravo','Charlie','Delta','Echo','Foxtrot',
  'Golf','Hotel','India','Juliet','Kilo','Lima','Mike',
  'November','Oscar','Papa','Quebec','Romeo','Sierra','Tango',
  'Uniform','Victor','Whiskey','X-Ray','Yankee','Zulu',
];

const Store = (() => {
  const KEY = 'vanguard-ops-v2';
  let _d = null;

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || blank(); }
    catch { return blank(); }
  }

  function blank() { return { ops: [], nextIdx: 0 }; }

  function data() { return _d || (_d = load()); }

  function save() { localStorage.setItem(KEY, JSON.stringify(_d)); }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function callSign(idx) {
    const slot = idx % NATO.length;
    const num  = Math.floor(idx / NATO.length);
    return NATO[slot] + (num > 0 ? '-' + (num + 1) : '');
  }

  return {
    // Create a new op; immediately approve or kill based on allPass
    submit(name, desc, filterResults, allPass) {
      const d = data();
      const op = {
        id:          uid(),
        name:        name.trim(),
        desc:        desc.trim(),
        status:      allPass ? 'active' : 'killed',
        callSign:    allPass ? callSign(d.nextIdx) : null,
        submittedAt: Date.now(),
        approvedAt:  allPass ? Date.now() : null,
        disposedAt:  allPass ? null : Date.now(),
        filters:     filterResults,
        hoursLogged: 0,
        hourLog:     [],
        disposition: null,
        disposedAt2: null,
        notes:       [],
      };
      if (allPass) d.nextIdx++;
      d.ops.unshift(op);
      save();
      return op;
    },

    logHours(id, delta) {
      const op = data().ops.find(o => o.id === id);
      if (!op) return null;
      op.hoursLogged = Math.max(0, +(op.hoursLogged + delta).toFixed(1));
      op.hourLog.push({ ts: Date.now(), delta });
      save();
      return op;
    },

    setDisposition(id, disp) {
      const op = data().ops.find(o => o.id === id);
      if (!op) return null;
      op.disposition = disp;
      op.disposedAt2 = Date.now();
      if (disp === 'kill')  op.status = 'killed-active';
      else if (disp === 'scale') op.status = 'scale';
      else op.status = 'keep';
      save();
      return op;
    },

    addNote(id, text) {
      const op = data().ops.find(o => o.id === id);
      if (!op) return null;
      op.notes.push({ text: text.trim(), ts: Date.now() });
      save();
      return op;
    },

    find(id) { return data().ops.find(o => o.id === id) || null; },

    where(...statuses) {
      const set = new Set(statuses.flat());
      return data().ops.filter(o => set.has(o.status));
    },

    all() { return data().ops; },
  };
})();

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function tDay(op) {
  if (!op.approvedAt) return null;
  return Math.floor((Date.now() - op.approvedAt) / 86_400_000) + 1;
}

function tStatus(op) {
  const d = tDay(op);
  if (d === null) return 'none';
  if (d <= 7)  return 'green';
  if (d <= 13) return 'joker';
  return 'bingo';
}

function hoursClass(h) {
  if (h > 15) return 'crit';
  if (h > 10) return 'warn';
  return 'ok';
}

function relTime(ts) {
  const m = Math.floor((Date.now() - ts) / 60_000);
  if (m < 1)  return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const day = Math.floor(h / 24);
  return day + 'd ago';
}

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

// ─────────────────────────────────────────────────────────────
// TAB NAVIGATION
// ─────────────────────────────────────────────────────────────

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    renderAll();
  });
});

// ─────────────────────────────────────────────────────────────
// BOUNTY BOARD
// ─────────────────────────────────────────────────────────────

const answers = { f1: null, f2: null, f3: null };

document.querySelectorAll('.fq-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const fq  = 'f' + btn.dataset.fq;
    const val = btn.dataset.val;
    answers[fq] = val;

    // Update button highlighting
    document.querySelectorAll(`[data-fq="${btn.dataset.fq}"]`).forEach(b => {
      b.classList.remove('sel-yes', 'sel-no');
    });
    btn.classList.add(val === 'yes' ? 'sel-yes' : 'sel-no');

    // Highlight row
    const row = document.getElementById('fr-' + btn.dataset.fq);
    row.classList.toggle('fail', val === 'no');
    row.classList.toggle('pass', val === 'yes');

    updateBountyActions();
  });
});

function updateBountyActions() {
  const allAnswered = answers.f1 && answers.f2 && answers.f3;
  const allYes = answers.f1 === 'yes' && answers.f2 === 'yes' && answers.f3 === 'yes';

  const approveBtn = document.getElementById('btn-approve');
  const killBtn    = document.getElementById('btn-kill');
  const verdict    = document.getElementById('filter-verdict');

  approveBtn.disabled = !allAnswered || !allYes;
  killBtn.disabled    = !allAnswered;

  verdict.className = 'filter-verdict';

  if (!allAnswered) {
    verdict.classList.add('hidden');
  } else if (allYes) {
    verdict.classList.add('v-pass');
    verdict.textContent = '✓ ALL 3 FILTERS CLEARED — READY TO APPROVE';
    verdict.classList.remove('hidden');
  } else {
    verdict.classList.add('v-fail');
    verdict.textContent = '✕ FILTER(S) FAILED — KILL INSTANTLY';
    verdict.classList.remove('hidden');
  }
}

function resetBountyForm() {
  document.getElementById('inp-name').value = '';
  document.getElementById('inp-desc').value = '';
  answers.f1 = answers.f2 = answers.f3 = null;
  document.querySelectorAll('.fq-btn').forEach(b => b.classList.remove('sel-yes','sel-no'));
  ['fr-1','fr-2','fr-3'].forEach(id => {
    const r = document.getElementById(id);
    r.classList.remove('fail','pass');
  });
  document.getElementById('btn-approve').disabled = true;
  document.getElementById('btn-kill').disabled    = true;
  document.getElementById('filter-verdict').classList.add('hidden');
}

function submitMission(approve) {
  const name = document.getElementById('inp-name').value.trim();
  const desc = document.getElementById('inp-desc').value.trim();
  if (!name) {
    document.getElementById('inp-name').focus();
    return;
  }
  Store.submit(name, desc, { ...answers }, approve);
  resetBountyForm();
  renderAll();
}

document.getElementById('btn-approve').addEventListener('click', () => submitMission(true));
document.getElementById('btn-kill').addEventListener('click', () => submitMission(false));

function renderRejected() {
  const list = document.getElementById('rejected-list');
  const killed = Store.where('killed');
  if (!killed.length) {
    list.innerHTML = '<div class="empty-msg">No rejections yet. The doctrine is mercy.</div>';
    return;
  }
  list.innerHTML = killed.slice(0, 8).map(op => `
    <div class="op-item">
      <div class="op-item-main">
        <div class="op-name">${esc(op.name)}</div>
        <div class="op-meta">${esc(op.desc || '—')} &nbsp;·&nbsp; ${relTime(op.disposedAt || op.submittedAt)}</div>
      </div>
      <span class="pill pill-killed">KILLED</span>
    </div>
  `).join('');
}

// ─────────────────────────────────────────────────────────────
// ACTIVE OPS (BFT MATRIX)
// ─────────────────────────────────────────────────────────────

let detailId = null;

function renderBFT() {
  const ops  = Store.where('active', 'keep');
  const tbody = document.getElementById('bft-body');

  if (!ops.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-msg" style="text-align:center;padding:20px;">
      No active operations. Go approve something on the Bounty Board.
    </td></tr>`;
    document.getElementById('op-detail').classList.add('hidden');
    return;
  }

  tbody.innerHTML = ops.map(op => {
    const d  = tDay(op);
    const ts = tStatus(op);
    const tClass = ts === 'green' ? 't-green' : ts === 'joker' ? 't-joker' : 't-bingo';

    const hc  = hoursClass(op.hoursLogged);
    const hClass = hc === 'ok' ? 'hours-ok' : hc === 'warn' ? 'hours-warn' : 'hours-crit';

    let pillCls = 'pill-green', pillLbl = 'GREEN';
    if (op.disposition === 'keep') { pillCls = 'pill-keep'; pillLbl = 'KEEP'; }
    else if (ts === 'joker') { pillCls = 'pill-joker'; pillLbl = 'JOKER'; }
    else if (ts === 'bingo') { pillCls = 'pill-bingo'; pillLbl = 'BINGO'; }

    const isOpen = detailId === op.id;

    return `<tr>
      <td><span class="call-sign">${esc(op.callSign)}</span></td>
      <td><span class="mission-name" title="${esc(op.name)}">${esc(op.name)}</span></td>
      <td><span class="t-num ${tClass}">T+${d}</span></td>
      <td><span class="${hClass}">${op.hoursLogged}h / 15h</span></td>
      <td><span class="pill ${pillCls}">${pillLbl}</span></td>
      <td>
        <button class="sm-btn manage" onclick="toggleDetail('${op.id}')">
          ${isOpen ? 'CLOSE' : 'MANAGE'}
        </button>
      </td>
    </tr>`;
  }).join('');

  renderDetail();
}

function toggleDetail(id) {
  detailId = detailId === id ? null : id;
  renderBFT();
}

function renderDetail() {
  const panel = document.getElementById('op-detail');
  if (!detailId) { panel.classList.add('hidden'); return; }

  const op = Store.find(detailId);
  if (!op) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');

  const d    = tDay(op);
  const pct  = Math.min(100, Math.round((op.hoursLogged / 15) * 100));
  const hc   = hoursClass(op.hoursLogged);
  const barCls = hc === 'warn' ? 'warn' : hc === 'crit' ? 'crit' : '';

  const noteItems = op.notes.length
    ? op.notes.map(n =>
        `<li>${esc(n.text)} <span style="color:var(--text-dim);font-size:9px;">${relTime(n.ts)}</span></li>`
      ).join('')
    : '<li class="empty-note">No BLUF entries yet.</li>';

  panel.innerHTML = `
    <div class="detail-top">
      <span class="detail-cs">${esc(op.callSign)}</span>
      <span class="detail-name">${esc(op.name)}</span>
      <span class="pill pill-green" style="margin-left:auto;">T+${d} / 14</span>
    </div>
    ${op.desc ? `<p style="font-size:10px;color:var(--text-dim);margin-bottom:14px;line-height:1.5;">${esc(op.desc)}</p>` : ''}

    <div class="detail-grid">

      <!-- HOUR LOG -->
      <div class="detail-section">
        <h4>HOUR LOG &mdash; 15h CAP</h4>
        <div class="hour-logger-row">
          <input type="number" id="h-inp" class="hour-inp"
            min="0.5" max="15" step="0.5" placeholder="+hrs" />
          <button class="sm-btn" onclick="logHours('${op.id}')">LOG</button>
          <span class="hour-used">${op.hoursLogged}h used</span>
        </div>
        <div class="hour-bar-track">
          <div class="hour-bar-fill ${barCls}" style="width:${pct}%"></div>
        </div>
        <div class="hour-bar-label">${pct}% of 15h cap — ${(15 - op.hoursLogged).toFixed(1)}h remaining</div>
      </div>

      <!-- DISPOSITION -->
      <div class="detail-section">
        <h4>COMMAND DISPOSITION</h4>
        <div class="disp-btns">
          <button class="disp-btn disp-keep ${op.disposition==='keep'?'active':''}"
            onclick="setDisp('${op.id}','keep')">▲ KEEP</button>
          <button class="disp-btn disp-kill ${op.disposition==='kill'?'active':''}"
            onclick="confirmDisp('${op.id}','kill')">☠ KILL</button>
          <button class="disp-btn disp-scale ${op.disposition==='scale'?'active':''}"
            onclick="confirmDisp('${op.id}','scale')">⬆ SCALE</button>
        </div>
        <div class="disp-hint">
          KEEP: maintain vector.<br/>
          KILL: abort, move to graveyard.<br/>
          SCALE: promote to core sprint &rarr; Wall of Valor.
        </div>
      </div>

      <!-- BLUF NOTES (full width) -->
      <div class="detail-section" style="grid-column:1/-1;">
        <h4>Q&amp;I BRIEFING LOG &mdash; 10-SECOND BLUF ENTRIES</h4>
        <ul class="note-list" id="notes-${op.id}">${noteItems}</ul>
        <div class="note-row">
          <input type="text" class="note-input" id="note-inp-${op.id}"
            placeholder="10-second BLUF: state the bottom line up front..." maxlength="200"
            onkeydown="if(event.key==='Enter')addNote('${op.id}')" />
          <button class="sm-btn" onclick="addNote('${op.id}')">LOG</button>
        </div>
      </div>

    </div>
  `;
}

function logHours(id) {
  const inp = document.getElementById('h-inp');
  const h   = parseFloat(inp.value);
  if (isNaN(h) || h <= 0) return;
  Store.logHours(id, h);
  renderBFT();
  renderHeaderStats();
}

function setDisp(id, disp) {
  Store.setDisposition(id, disp);
  if (disp === 'kill' || disp === 'scale') {
    detailId = null;
  }
  renderAll();
}

function confirmDisp(id, disp) {
  const op    = Store.find(id);
  const title = disp === 'kill' ? 'CONFIRM: KILL MISSION' : 'CONFIRM: SCALE TO CORE';
  const body  = disp === 'kill'
    ? `Abort "${op.name}" and move it to the graveyard. Hours stop here. Confirm?`
    : `Promote "${op.name}" to core sprint. Wall of Valor territory. Confirm?`;
  showModal(title, body, () => setDisp(id, disp));
}

function addNote(id) {
  const inp = document.getElementById('note-inp-' + id);
  if (!inp || !inp.value.trim()) return;
  Store.addNote(id, inp.value);
  inp.value = '';
  renderDetail();
}

// ─────────────────────────────────────────────────────────────
// STRATCOM
// ─────────────────────────────────────────────────────────────

function renderStratcom() {
  const all     = Store.all();
  const active  = Store.where('active', 'keep');
  const killed  = Store.where('killed', 'killed-active');
  const scaled  = Store.where('scale');
  const keep    = Store.where('keep');
  const launched = all.filter(o => o.approvedAt);
  const bingo   = active.filter(o => tStatus(o) === 'bingo');
  const totalH  = active.reduce((s, o) => s + o.hoursLogged, 0);

  document.getElementById('m-total').textContent  = launched.length;
  document.getElementById('m-bingo').textContent  = bingo.length;
  document.getElementById('m-scale').textContent  = scaled.length;
  document.getElementById('m-killed').textContent = killed.length;
  document.getElementById('m-hrs').textContent    = totalH.toFixed(1) + 'h';
  document.getElementById('m-keep').textContent   = keep.length;

  // Timeline: collect all events
  const events = [];
  all.forEach(op => {
    if (op.approvedAt)  events.push({ ts: op.approvedAt,  type: 'approved',    op });
    if (op.disposedAt && !op.approvedAt)
                        events.push({ ts: op.disposedAt,  type: 'killed-board',op });
    if (op.disposedAt2) events.push({ ts: op.disposedAt2, type: op.status,     op });
  });
  events.sort((a, b) => b.ts - a.ts);

  const tl = document.getElementById('ops-timeline');
  if (!events.length) {
    tl.innerHTML = '<div class="empty-msg">No events yet.</div>';
    return;
  }

  tl.innerHTML = events.slice(0, 30).map(e => {
    let dotCls = 'dot-dim', label = '';
    switch (e.type) {
      case 'approved':      dotCls = 'dot-green';  label = 'APPROVED → T+14 COUNTDOWN'; break;
      case 'scale':         dotCls = 'dot-blue';   label = 'SCALED → CORE SPRINT 🏆'; break;
      case 'killed-active': dotCls = 'dot-red';    label = 'KILLED (active mission)'; break;
      case 'killed-board':  dotCls = 'dot-red';    label = 'KILLED (board rejection)'; break;
      case 'keep':          dotCls = 'dot-green';  label = 'DISPOSITION: KEEP'; break;
      default:              dotCls = 'dot-dim';    label = e.type.toUpperCase();
    }
    const name = e.op.callSign ? `${e.op.callSign}: ${e.op.name}` : e.op.name;
    return `
      <div class="tl-item">
        <div class="tl-dot ${dotCls}"></div>
        <div class="tl-content">
          <div class="tl-title">${esc(name)}</div>
          <div class="tl-meta">${label} &nbsp;·&nbsp; ${relTime(e.ts)}</div>
        </div>
      </div>
    `;
  }).join('');
}

// ─────────────────────────────────────────────────────────────
// THE ARENA
// ─────────────────────────────────────────────────────────────

function renderArena() {
  const scaled = Store.where('scale');
  const killed = Store.where('killed', 'killed-active');

  const valor = document.getElementById('valor-list');
  const grave = document.getElementById('grave-list');

  if (!scaled.length) {
    valor.innerHTML = '<div class="empty-msg">No promotions yet. Build something worth scaling.</div>';
  } else {
    valor.innerHTML = scaled.map(op => {
      const days = op.disposedAt2 && op.approvedAt
        ? Math.floor((op.disposedAt2 - op.approvedAt) / 86_400_000) + 1
        : '?';
      return `
        <div class="arena-item">
          <div class="arena-item-name">${esc(op.callSign)}: ${esc(op.name)}</div>
          <div class="arena-item-meta">
            Scaled ${fmtDate(op.disposedAt2 || Date.now())}
            &nbsp;·&nbsp; ${op.hoursLogged}h logged
            &nbsp;·&nbsp; T+${days} day
            ${op.desc ? '<br/>' + esc(op.desc) : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  if (!killed.length) {
    grave.innerHTML = '<div class="empty-msg">No casualties yet. The doctrine demands discipline.</div>';
  } else {
    grave.innerHTML = killed.map(op => `
      <div class="arena-item">
        <div class="arena-item-name">${esc(op.name)}${op.callSign ? ' (' + esc(op.callSign) + ')' : ''}</div>
        <div class="arena-item-meta">
          Killed ${fmtDate(op.disposedAt2 || op.disposedAt || Date.now())}
          ${op.hoursLogged ? ' &nbsp;·&nbsp; ' + op.hoursLogged + 'h spent' : ''}
          ${op.desc ? '<br/>' + esc(op.desc) : ''}
        </div>
      </div>
    `).join('');
  }
}

// ─────────────────────────────────────────────────────────────
// HEADER STATS
// ─────────────────────────────────────────────────────────────

function renderHeaderStats() {
  const active = Store.where('active', 'keep').length;
  const scaled = Store.where('scale').length;
  const killed = Store.where('killed', 'killed-active').length;
  const bingo  = Store.where('active','keep')
    .filter(o => tStatus(o) === 'bingo').length;

  document.getElementById('hs-active').textContent = active;
  document.getElementById('hs-scaled').textContent = scaled;
  document.getElementById('hs-bingo').textContent  = bingo;
  document.getElementById('hs-killed').textContent = killed;
}

// ─────────────────────────────────────────────────────────────
// MODAL
// ─────────────────────────────────────────────────────────────

let _modalCb = null;

function showModal(title, body, onConfirm) {
  _modalCb = onConfirm;
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').textContent  = body;
  document.getElementById('modal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  _modalCb = null;
}

document.getElementById('modal-confirm').addEventListener('click', () => {
  closeModal();
  if (_modalCb) _modalCb();
});

document.getElementById('modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});

// ─────────────────────────────────────────────────────────────
// RENDER ALL
// ─────────────────────────────────────────────────────────────

function renderAll() {
  renderRejected();
  renderBFT();
  renderStratcom();
  renderArena();
  renderHeaderStats();
}

// ─────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────

renderAll();

// Refresh T+ counters every minute (so BINGO status updates live)
setInterval(() => {
  const activeTab = document.querySelector('.nav-btn.active');
  if (activeTab && ['bft', 'stratcom'].includes(activeTab.dataset.tab)) {
    renderBFT();
    renderStratcom();
  }
  renderHeaderStats();
}, 60_000);
