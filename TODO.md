# AI Vanguard Command Hub — TODO / Roadmap

Zero-backend SPA (vanilla JS + CSS, GitHub Pages). Data lives in
`data/operations.json` (shared board) with a per-browser draft and
"Save to GitHub" publishing.

---

## ✅ Done

- 4-tab MVP: Doctrine, Blue Force Tracker, STRATCOM, Target Acquisition
- Dark "command" theme, military typography, responsive **left sidebar**
  (Command / Operations / People) with mobile slide-in drawer
- T-Clock in **business days** (weekends + configurable holidays excluded)
- Shared data model: published `operations.json` + local draft + **GitHub
  auto-save** via token; Download JSON / Discard fallback
- Maintenance: add / edit (modal) / promote / retire / delete / restore;
  toasts + modals (no browser dialogs)
- BFT: search / fuel filter / sort, CSV export, Bingo alert banner,
  last-updated stamp
- Target Acquisition: gate guide, descriptive gates, progress meter,
  **Candidate pipeline**, **Rejection log**, **ROI calculator**
- **Force Readiness** indicator (DEFCON-style) + fuel distribution
- **The Armory**: commissioned assets, readiness states, adoption, hrs/wk
- **Personnel & Honors**: command points, rank ladder, medals
- **Strategy**: Commander's Intent + Theaters of Operation
- **Bounty Board**: post / claim / deliver, rewards feed Personnel points
- Verified via simulated-DOM smoke test (boot + interactions, no errors)

---

## 🔜 Backlog (prioritized)

### P1 — finish the responsive story
- [ ] **Sidebar live badges** — counts next to nav items (active Bingo on
      BFT in red, open candidates on Target Acquisition, open bounties).
- [ ] **BFT mobile card view** — collapse table rows into cards on phones
      instead of horizontal scroll.

### P1 — intelligence / analytics (leadership will ask for this)
- [ ] **Trends over time** — ops launched / promoted / killed per month,
      promotion rate, avg time-to-promotion (CSS/SVG sparklines, no lib).
- [ ] **Theater heatmap** — over/under-investment vs. target per theater.
- [ ] **Stale-op nudges** — flag active ops with no edits in N days.

### P2 — workflow depth
- [ ] **After-Action Reports** for the Graveyard (lessons learned), mirroring
      the rejection log.
- [ ] **Global search / command palette** (`Ctrl/Cmd-K`) to jump to any op
      or tab.
- [ ] **SITREP generator** — one-click copyable status report for leadership.

### P2 — trust / robustness
- [ ] **Conflict-safe save** — re-check the GitHub file SHA before writing so
      two editors cannot clobber each other.
- [ ] **Activity log** — lightweight audit trail of changes since last publish.
- [ ] **Print / PDF "command brief"** stylesheet for STRATCOM.

### P3 — polish / nice-to-have
- [ ] Collapsible icon-only desktop sidebar.
- [ ] Classification banner (UNCLASSIFIED // INTERNAL) — deferred from the
      military-upgrades set.
- [ ] Call sign generator for the funnel.
- [ ] Accessibility pass: focus trap in modals, ARIA roles on tabs/drawer.
- [ ] Operator's guide (one-page) documenting the workflow.

---

## Notes / known constraints

- Zero-backend: browser cannot write to the repo, so publishing data is
  either GitHub auto-save (token, operator-only) or Download JSON + commit.
- GitHub token is stored only in the operator's browser localStorage.
- Live GitHub API save path is not exercisable from the build env; first
  real save is the true test (clear errors surface via toast).
