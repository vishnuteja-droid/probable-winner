'use strict';

// ── DATA STORE ──────────────────────────────────────────────────────────────

const NATO = [
  'Alpha','Bravo','Charlie','Delta','Echo','Foxtrot',
  'Golf','Hotel','India','Juliet','Kilo','Lima','Mike',
  'November','Oscar','Papa','Quebec','Romeo','Sierra','Tango',
  'Uniform','Victor','Whiskey','X-Ray','Yankee','Zulu',
];

const Store = (() => {
  const KEY = 'vanguard-ops-v3';
  let _d = null;

  const blank = () => ({ ops: [], nextIdx: 0 });

  const data = () => {
    if (_d) return _d;
    try { _d = JSON.parse(localStorage.getItem(KEY)) || blank(); }
    catch { _d = blank(); }
    return _d;
  };

  const save = () => localStorage.setItem(KEY, JSON.stringify(_d));

  const uid = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const callSign = (idx) => {
    const slot = idx % NATO.length;
    const num  = Math.floor(idx / NATO.length);
    return NATO[slot] + (num > 0 ? '-' + (num + 1) : '');
  };

  return {
    submit(name, desc, filters, approved) {
      const d = data();
      const op = {
        id:          uid(),
        name:        name.trim(),
        desc:        desc.trim(),
        status:      approved ? 'active' : 'killed',
        callSign:    approved ? callSign(d.nextIdx) : null,
        submittedAt: Date.now(),
        approvedAt:  approved ? Date.now() : null,
        disposedAt:  approved ? null : Date.now(),
        filters,
        hoursLogged: 0,
        hourLog:     [],
        disposition: null,
        disposedAt2: null,
        notes:       [],
      };
      if (approved) d.nextIdx++;
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
      op.disposition  = disp;
      op.disposedAt2  = Date.now();
      op.status = disp === 'kill'  ? 'killed-active'
                : disp === 'scale' ? 'scale'
                :                    'keep';
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

    find:  (id)        => data().ops.find(o => o.id === id) || null,
    where: (...states) => { const s = new Set(states.flat()); return data().ops.filter(o => s.has(o.status)); },
    all:   ()          => data().ops,
  };
})();

// ── UTILS ────────────────────────────────────────────────────────────────────

const esc = s => String(s ?? '')
  .replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const tDay = op => op.approvedAt
  ? Math.floor((Date.now() - op.approvedAt) / 86_400_000) + 1
  : null;

const tStatus = op => {
  const d = tDay(op);
  if (d === null) return 'none';
  return d <= 7 ? 'green' : d <= 13 ? 'joker' : 'bingo';
};

const hc = h => h > 15 ? 'crit' : h > 10 ? 'warn' : 'ok';

const relTime = ts => {
  const m = Math.floor((Date.now() - ts) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const fmtDate = ts =>
  new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });

// ── CLOCK ────────────────────────────────────────────────────────────────────

const clockEl = document.getElementById('live-clock');

function tickClock() {
  if (!clockEl) return;
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  clockEl.textContent =
    `${now.getUTCFullYear()}-${pad(now.getUTCMonth()+1)}-${pad(now.getUTCDate())} ` +
    `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} UTC`;
}

tickClock();
setInterval(tickClock, 1000);

// ── TABS ─────────────────────────────────────────────────────────────────────

document.querySelectorAll('.nav-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    renderAll();
  });
});

// ── BOUNTY BOARD ─────────────────────────────────────────────────────────────

const answers = { f1: null, f2: null, f3: null };

document.querySelectorAll('.toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const fq  = 'f' + btn.dataset.fq;
    const val = btn.dataset.val;
    answers[fq] = val;

    document.querySelectorAll(`[data-fq="${btn.dataset.fq}"]`)
      .forEach(b => b.classList.remove('yes', 'no'));
    btn.classList.add(val === 'yes' ? 'yes' : 'no');

    const row = document.getElementById('fi-' + btn.dataset.fq);
    row.classList.toggle('pass', val === 'yes');
    row.classList.toggle('fail', val === 'no');

    updateActions();
  });
});

function updateActions() {
  const done   = answers.f1 && answers.f2 && answers.f3;
  const allYes = answers.f1 === 'yes' && answers.f2 === 'yes' && answers.f3 === 'yes';
  const btnA   = document.getElementById('btn-approve');
  const btnK   = document.getElementById('btn-kill');
  const verdict = document.getElementById('verdict');

  btnA.disabled = !done || !allYes;
  btnK.disabled = !done;

  if (!done) { verdict.classList.add('hidden'); return; }

  verdict.className = 'verdict ' + (allYes ? 'pass' : 'fail');
  verdict.textContent = allYes
    ? '✓ All 3 filters cleared — ready to enter T+14 countdown'
    : '✕ Filter failed — mission must be killed instantly per doctrine';
  verdict.classList.remove('hidden');
}

function resetForm() {
  document.getElementById('inp-name').value = '';
  document.getElementById('inp-desc').value = '';
  answers.f1 = answers.f2 = answers.f3 = null;
  document.querySelectorAll('.toggle').forEach(b => b.classList.remove('yes', 'no'));
  ['fi-1','fi-2','fi-3'].forEach(id =>
    document.getElementById(id).classList.remove('pass','fail')
  );
  document.getElementById('btn-approve').disabled = true;
  document.getElementById('btn-kill').disabled    = true;
  document.getElementById('verdict').classList.add('hidden');
}

function submitMission(approve) {
  const nameEl = document.getElementById('inp-name');
  const name   = nameEl.value.trim();
  if (!name) {
    nameEl.focus();
    nameEl.style.borderColor = 'var(--red)';
    setTimeout(() => nameEl.style.borderColor = '', 1800);
    return;
  }
  Store.submit(name, document.getElementById('inp-desc').value.trim(), { ...answers }, approve);
  resetForm();
  renderAll();
}

document.getElementById('btn-approve').addEventListener('click', () => submitMission(true));
document.getElementById('btn-kill').addEventListener('click', () => submitMission(false));

function renderRejected() {
  const listEl = document.getElementById('rejected-list');
  const cntEl  = document.getElementById('rejected-count');
  const killed = Store.where('killed');
  cntEl.textContent = killed.length;

  if (!killed.length) {
    listEl.innerHTML = '<div class="empty-state">No rejections on record.</div>';
    return;
  }

  listEl.innerHTML = killed.slice(0, 12).map(op => {
    const fails = [];
    if (op.filters.f1 === 'no') fails.push('prototype time');
    if (op.filters.f2 === 'no') fails.push('infra blocks');
    if (op.filters.f3 === 'no') fails.push('unmeasurable value');
    return `
      <div class="list-item">
        <div class="list-item-name">${esc(op.name)}</div>
        <div class="list-item-meta">
          <span>${relTime(op.disposedAt || op.submittedAt)}</span>
          ${fails.length
            ? `<span style="color:var(--red-hi);">Failed: ${fails.join(', ')}</span>`
            : ''}
        </div>
        ${op.desc ? `<div class="list-item-desc">${esc(op.desc)}</div>` : ''}
      </div>`;
  }).join('');
}

// ── ACTIVE OPS ───────────────────────────────────────────────────────────────

let detailId = null;

function renderBFT() {
  const ops   = Store.where('active', 'keep');
  const tbody = document.getElementById('bft-body');

  if (!ops.length) {
    tbody.innerHTML = `
      <tr class="row-empty">
        <td colspan="7">No active operations. Submit and approve a mission from the Bounty Board.</td>
      </tr>`;
    document.getElementById('op-detail').classList.add('hidden');
    return;
  }

  tbody.innerHTML = ops.map(op => {
    const d   = tDay(op);
    const ts  = tStatus(op);
    const tc  = ts === 'green' ? 't-green' : ts === 'joker' ? 't-joker' : 't-bingo';

    const hrs  = op.hoursLogged;
    const hcls = hc(hrs);
    const hCss = hcls === 'ok' ? 'h-ok' : hcls === 'warn' ? 'h-warn' : 'h-crit';
    const pct  = Math.min(100, Math.round((hrs / 15) * 100));
    const barCls = hcls === 'warn' ? 'warn' : hcls === 'crit' ? 'crit' : '';

    let statusBadge = `<span class="badge b-green">Green</span>`;
    if (op.disposition === 'keep') statusBadge = `<span class="badge b-keep">Keep</span>`;
    else if (ts === 'joker') statusBadge = `<span class="badge b-joker">Joker</span>`;
    else if (ts === 'bingo') statusBadge = `<span class="badge b-bingo">Bingo</span>`;

    const dispBadge = op.disposition
      ? `<span class="badge ${op.disposition === 'keep' ? 'b-keep' : op.disposition === 'scale' ? 'b-scale' : 'b-killed'}">${op.disposition}</span>`
      : `<span class="badge b-none">—</span>`;

    const isOpen = detailId === op.id;

    return `
      <tr>
        <td><span class="call-sign">${esc(op.callSign)}</span></td>
        <td><span class="mission-cell" title="${esc(op.name)}">${esc(op.name)}</span></td>
        <td><span class="t-val ${tc}">T+${d}</span></td>
        <td>
          <span class="${hCss}">${hrs}h / 15h</span>
          <div class="h-bar-track">
            <div class="h-bar-fill ${barCls}" style="width:${pct}%;"></div>
          </div>
        </td>
        <td>${statusBadge}</td>
        <td>${dispBadge}</td>
        <td>
          <button class="btn btn-sm btn-manage" onclick="toggleDetail('${op.id}')">
            ${isOpen ? 'Close' : 'Manage'}
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
  const hrs  = op.hoursLogged;
  const pct  = Math.min(100, Math.round((hrs / 15) * 100));
  const hcls = hc(hrs);
  const barCls = hcls === 'warn' ? 'warn' : hcls === 'crit' ? 'crit' : '';
  const rem  = Math.max(0, 15 - hrs).toFixed(1);

  const noteItems = op.notes.length
    ? op.notes.map(n =>
        `<li><span class="note-ts">${relTime(n.ts)}</span>${esc(n.text)}</li>`
      ).join('')
    : `<li style="color:var(--text-dim);font-style:italic;border:none;padding:8px 12px;">
        No BLUF entries yet.
       </li>`;

  panel.innerHTML = `
    <div class="detail-hdr">
      <span class="detail-cs">${esc(op.callSign)}</span>
      <span class="detail-name">${esc(op.name)}</span>
      <span class="badge b-green" style="margin-left:auto;">T+${d} of 14</span>
    </div>

    ${op.desc
      ? `<p style="font-size:12px;color:var(--text-dim);margin-bottom:18px;line-height:1.5;">${esc(op.desc)}</p>`
      : ''}

    <div class="detail-grid">

      <div class="detail-col">
        <h4>Hour Log — 15h Cap</h4>
        <div class="hour-row">
          <input id="h-inp" type="number" class="hour-inp"
            min="0.5" max="15" step="0.5" placeholder="0.0" />
          <button class="btn btn-sm btn-ghost" onclick="logHours('${op.id}')">Log</button>
          <span class="hour-used">${hrs}h logged</span>
        </div>
        <div class="prog-track">
          <div class="prog-fill ${barCls}" style="width:${pct}%;"></div>
        </div>
        <div class="prog-lbl">${pct}% used — ${rem}h remaining</div>
      </div>

      <div class="detail-col">
        <h4>Command Disposition</h4>
        <div class="disp-row">
          <button class="disp-btn d-keep  ${op.disposition==='keep' ?'active':''}"
            onclick="setDisp('${op.id}','keep')">Keep</button>
          <button class="disp-btn d-kill  ${op.disposition==='kill' ?'active':''}"
            onclick="confirmDisp('${op.id}','kill')">Kill</button>
          <button class="disp-btn d-scale ${op.disposition==='scale'?'active':''}"
            onclick="confirmDisp('${op.id}','scale')">Scale</button>
        </div>
        <div class="disp-hint">
          <strong>Keep</strong> — Maintain vector, continue under doctrine<br/>
          <strong>Kill</strong> — Abort mission, move to graveyard<br/>
          <strong>Scale</strong> — Promote prototype to core sprint
        </div>
      </div>

      <div class="detail-col" style="grid-column:1/-1;">
        <h4>Q&I Briefing Log — 10-Second BLUF Entries</h4>
        <ul class="note-list" id="notes-${op.id}">${noteItems}</ul>
        <div class="note-row">
          <input type="text" class="note-inp" id="note-inp-${op.id}"
            placeholder="Bottom Line Up Front in 10 seconds..."
            maxlength="200"
            onkeydown="if(event.key==='Enter') addNote('${op.id}')" />
          <button class="btn btn-sm btn-ghost" onclick="addNote('${op.id}')">Add</button>
        </div>
      </div>

    </div>`;
}

function logHours(id) {
  const inp = document.getElementById('h-inp');
  const h   = parseFloat(inp.value);
  if (isNaN(h) || h <= 0) return;
  inp.value = '';
  Store.logHours(id, h);
  renderBFT();
  renderHeaderStats();
}

function setDisp(id, disp) {
  Store.setDisposition(id, disp);
  if (disp !== 'keep') detailId = null;
  renderAll();
}

function confirmDisp(id, disp) {
  const op = Store.find(id);
  const isKill = disp === 'kill';
  showModal(
    isKill ? 'Kill Mission' : 'Scale to Core Sprint',
    isKill
      ? `Abort "${op.name}" and move it to the graveyard. Hours stop here. This cannot be undone.`
      : `Promote "${op.name}" to the core sprint (Wall of Valor). This cannot be undone.`,
    () => setDisp(id, disp)
  );
}

function addNote(id) {
  const inp = document.getElementById('note-inp-' + id);
  if (!inp?.value.trim()) return;
  Store.addNote(id, inp.value);
  inp.value = '';
  renderDetail();
}

// ── STRATCOM ─────────────────────────────────────────────────────────────────

function renderStratcom() {
  const all      = Store.all();
  const active   = Store.where('active', 'keep');
  const killed   = Store.where('killed', 'killed-active');
  const scaled   = Store.where('scale');
  const keep     = Store.where('keep');
  const launched = all.filter(o => o.approvedAt);
  const bingo    = active.filter(o => tStatus(o) === 'bingo');
  const totalH   = active.reduce((s, o) => s + o.hoursLogged, 0);

  document.getElementById('m-total').textContent  = launched.length;
  document.getElementById('m-bingo').textContent  = bingo.length;
  document.getElementById('m-scale').textContent  = scaled.length;
  document.getElementById('m-killed').textContent = killed.length;
  document.getElementById('m-hrs').textContent    = totalH.toFixed(1) + 'h';
  document.getElementById('m-keep').textContent   = keep.length;

  // Timeline
  const events = [];
  all.forEach(op => {
    if (op.approvedAt) events.push({ ts: op.approvedAt,  type: 'approved',      op });
    if (op.disposedAt && !op.approvedAt)
      events.push({ ts: op.disposedAt,  type: 'killed-board', op });
    if (op.disposedAt2)
      events.push({ ts: op.disposedAt2, type: op.status,       op });
  });
  events.sort((a, b) => b.ts - a.ts);

  const tlEl = document.getElementById('ops-timeline');
  if (!events.length) {
    tlEl.innerHTML = '<div class="empty-state">No events logged yet.</div>';
    return;
  }

  const rows = events.slice(0, 30).map(e => {
    let dot = 'd-dot-dim', label = '';
    switch (e.type) {
      case 'approved':       dot = 'd-dot-green'; label = 'Approved → T+14 countdown started'; break;
      case 'scale':          dot = 'd-dot-blue';  label = 'Scaled → promoted to core sprint'; break;
      case 'killed-active':  dot = 'd-dot-red';   label = 'Killed — active mission aborted'; break;
      case 'killed-board':   dot = 'd-dot-red';   label = 'Rejected — killed on Bounty Board'; break;
      case 'keep':           dot = 'd-dot-green'; label = 'Disposition set: Keep'; break;
      default:               dot = 'd-dot-dim';   label = e.type; break;
    }
    const name = e.op.callSign
      ? `${e.op.callSign}: ${e.op.name}`
      : e.op.name;
    return `
      <div class="tl-item">
        <div class="tl-dot ${dot}"></div>
        <div class="tl-text">
          <div class="tl-title">${esc(name)}</div>
          <div class="tl-meta">${label} &nbsp;·&nbsp; ${relTime(e.ts)}</div>
        </div>
      </div>`;
  }).join('');

  tlEl.innerHTML = `<div class="timeline">${rows}</div>`;
}

// ── THE ARENA ────────────────────────────────────────────────────────────────

function renderArena() {
  const scaled = Store.where('scale');
  const killed = Store.where('killed', 'killed-active');
  const valorEl = document.getElementById('valor-list');
  const graveEl = document.getElementById('grave-list');

  if (!scaled.length) {
    valorEl.innerHTML = '<div class="empty-state">No promotions yet. Build something worth scaling.</div>';
  } else {
    valorEl.innerHTML = scaled.map(op => {
      const days = op.disposedAt2 && op.approvedAt
        ? Math.floor((op.disposedAt2 - op.approvedAt) / 86_400_000) + 1
        : '?';
      return `
        <div class="list-item" style="border-left: 2px solid var(--green);">
          <div class="list-item-name">${esc(op.callSign || '—')} — ${esc(op.name)}</div>
          <div class="list-item-meta">
            <span>Scaled ${fmtDate(op.disposedAt2 || Date.now())}</span>
            <span>${op.hoursLogged}h logged</span>
            <span>Finished at T+${days}</span>
          </div>
          ${op.desc ? `<div class="list-item-desc">${esc(op.desc)}</div>` : ''}
        </div>`;
    }).join('');
  }

  if (!killed.length) {
    graveEl.innerHTML = '<div class="empty-state">No casualties on record.</div>';
  } else {
    graveEl.innerHTML = killed.map(op => `
      <div class="list-item" style="border-left: 2px solid var(--red);">
        <div class="list-item-name">
          ${op.callSign ? `<span style="color:var(--text-dim);font-size:11px;">${esc(op.callSign)}</span> — ` : ''}
          ${esc(op.name)}
        </div>
        <div class="list-item-meta">
          <span>Killed ${fmtDate(op.disposedAt2 || op.disposedAt || Date.now())}</span>
          ${op.hoursLogged ? `<span>${op.hoursLogged}h spent</span>` : ''}
          ${!op.callSign ? '<span>Rejected on board</span>' : ''}
        </div>
        ${op.desc ? `<div class="list-item-desc">${esc(op.desc)}</div>` : ''}
      </div>`).join('');
  }
}

// ── HEADER STATS ─────────────────────────────────────────────────────────────

function renderHeaderStats() {
  const active = Store.where('active','keep').length;
  const scaled = Store.where('scale').length;
  const killed = Store.where('killed','killed-active').length;
  const bingo  = Store.where('active','keep').filter(o => tStatus(o) === 'bingo').length;
  document.getElementById('hs-active').textContent = active;
  document.getElementById('hs-bingo').textContent  = bingo;
  document.getElementById('hs-scaled').textContent = scaled;
  document.getElementById('hs-killed').textContent = killed;
}

// ── MODAL ────────────────────────────────────────────────────────────────────

let _cb = null;

function showModal(title, body, onConfirm) {
  _cb = onConfirm;
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').textContent  = body;
  document.getElementById('modal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  _cb = null;
}

document.getElementById('modal-confirm').addEventListener('click', () => {
  closeModal();
  if (_cb) _cb();
});

document.getElementById('modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});

// ── BOOT ─────────────────────────────────────────────────────────────────────

function renderAll() {
  renderRejected();
  renderBFT();
  renderStratcom();
  renderArena();
  renderHeaderStats();
}

renderAll();

// Refresh T+ day counters every minute
setInterval(() => {
  const active = document.querySelector('.nav-tab.active');
  if (active?.dataset.tab === 'bft' || active?.dataset.tab === 'stratcom') {
    renderBFT();
    renderStratcom();
  }
  renderHeaderStats();
}, 60_000);
