// tools/remote-qc-workflow.js — Remote QC Workflow Tool v3
(function () {
  try {
    if (window.gisToolHost.activeTools.has('remote-qc-workflow')) return;
    document.getElementById('remoteQcWorkflowToolbox')?.remove();

    const utils = window.gisSharedUtils;
    if (!utils) throw new Error('Shared utilities not loaded');
    const mapView = utils.getMapView();
    const Z = 99999;

    // AMD module loader
    const loadModule = path => new Promise((res, rej) => require([path], res, rej));

    // ── State ─────────────────────────────────────────────────────────
    let mode = 'new_qc';
    let qcQueue = [], currentIndex = 0, currentPhase = 'query';
    let gigTypes = [], workOrderOptions = [], poOptions = [];
    let sessionLog = [], sessionStartTime = null;
    let featureStartTime = null, timerInterval = null, highlightHandle = null;
    // Spatial filter
    let spatialMode = 'none'; // 'none' | 'screen' | 'drawn'
    let drawnGeometry = null, sketchLayer = null, sketchVM = null, isDrawing = false;

    // ── CSS ───────────────────────────────────────────────────────────
    const css = document.createElement('style');
    css.textContent = `
      #rqcw *, #rqcw *::before, #rqcw *::after { box-sizing:border-box; margin:0; padding:0; }
      #rqcw { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:12px; color:#1e293b; }
      #rqcw .btn { display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:7px 13px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;transition:filter .15s,opacity .15s;white-space:nowrap; }
      #rqcw .btn:disabled { opacity:.45;cursor:not-allowed; }
      #rqcw .btn:not(:disabled):hover { filter:brightness(1.08); }
      #rqcw .btn-primary { background:#2563eb;color:#fff; }
      #rqcw .btn-success { background:#16a34a;color:#fff; }
      #rqcw .btn-danger  { background:#dc2626;color:#fff; }
      #rqcw .btn-amber   { background:#d97706;color:#fff; }
      #rqcw .btn-slate   { background:#64748b;color:#fff; }
      #rqcw .btn-cyan    { background:#0891b2;color:#fff; }
      #rqcw .btn-violet  { background:#7c3aed;color:#fff; }
      #rqcw .btn-ghost   { background:transparent;color:#64748b;border:1px solid #e2e8f0; }
      #rqcw .btn-ghost:not(:disabled):hover { background:#f1f5f9; }
      #rqcw .btn-full { width:100%; }
      #rqcw .btn-sm   { padding:5px 10px;font-size:11px; }
      #rqcw .card       { background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:14px; }
      #rqcw .card-inset { background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px; }
      #rqcw label.field-label { display:block;font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px; }
      #rqcw input[type=text], #rqcw input[type=date], #rqcw select, #rqcw textarea {
        width:100%;padding:7px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;
        color:#1e293b;background:#fff;outline:none;transition:border-color .15s,box-shadow .15s;
      }
      #rqcw input:focus, #rqcw select:focus, #rqcw textarea:focus { border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.12); }
      #rqcw .tab-bar { display:flex;background:#fff;border-bottom:2px solid #e2e8f0; }
      #rqcw .tab { flex:1;padding:10px;border:none;background:none;cursor:pointer;font-size:12px;font-weight:600;
        color:#64748b;border-bottom:2px solid transparent;margin-bottom:-2px;transition:color .15s,border-color .15s; }
      #rqcw .tab.active { color:#2563eb;border-bottom-color:#2563eb; }
      #rqcw .radio-card { display:flex;align-items:center;gap:10px;padding:10px 12px;border:2px solid #e2e8f0;
        border-radius:8px;cursor:pointer;transition:border-color .15s,background .15s;margin-bottom:7px; }
      #rqcw .radio-card:hover { border-color:#94a3b8;background:#f8fafc; }
      #rqcw .radio-card.sel-pass    { border-color:#16a34a;background:#f0fdf4; }
      #rqcw .radio-card.sel-fail    { border-color:#dc2626;background:#fef2f2; }
      #rqcw .radio-card.sel-photo   { border-color:#d97706;background:#fffbeb; }
      #rqcw .radio-card.sel-approve { border-color:#16a34a;background:#f0fdf4; }
      #rqcw .radio-card.sel-reopen  { border-color:#dc2626;background:#fef2f2; }
      #rqcw .radio-card input[type=radio] { accent-color:#2563eb;width:15px;height:15px;flex-shrink:0; }
      #rqcw .rc-icon  { font-size:20px;flex-shrink:0; }
      #rqcw .rc-title { font-size:12px;font-weight:700; }
      #rqcw .rc-sub   { font-size:10px;color:#64748b;margin-top:1px; }
      #rqcw .kbd { display:inline-block;background:rgba(0,0,0,.06);border:1px solid #cbd5e1;border-radius:3px;padding:0 5px;font-size:10px;font-family:monospace; }
      #rqcw .pbar-track { height:6px;background:#e2e8f0;border-radius:99px;overflow:hidden; }
      #rqcw .pbar-fill  { height:100%;background:linear-gradient(90deg,#2563eb,#06b6d4);transition:width .35s ease; }
      #rqcw .dropdown-list { position:absolute;top:100%;left:0;right:0;max-height:210px;overflow-y:auto;background:#fff;
        border:1px solid #cbd5e1;border-top:none;border-radius:0 0 6px 6px;z-index:1100;box-shadow:0 6px 16px rgba(0,0,0,.12); }
      #rqcw .dd-item { padding:8px 10px;cursor:pointer;font-size:12px;transition:background .1s; }
      #rqcw .dd-item:hover { background:#eff6ff; }
      #rqcw .dd-sep { border-bottom:1px solid #f1f5f9;font-style:italic;color:#94a3b8; }
      #rqcw .scroll-box { max-height:175px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:6px;padding:4px; }
      #rqcw .check-item { display:flex;align-items:center;gap:8px;padding:5px 6px;cursor:pointer;border-radius:4px;transition:background .1s; }
      #rqcw .check-item:hover { background:#f8fafc; }
      #rqcw .check-item input { accent-color:#2563eb;width:14px;height:14px;flex-shrink:0; }
      #rqcw .attr-grid { display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:11px; }
      #rqcw .attr-key { color:#64748b;font-weight:600;white-space:nowrap; }
      #rqcw .attr-val { color:#1e293b; }
      /* Chip radio group */
      #rqcw .chip-group { display:flex;gap:6px;flex-wrap:wrap; }
      #rqcw .chip { display:inline-flex;align-items:center;gap:4px;padding:5px 11px;border:1.5px solid #cbd5e1;
        border-radius:99px;cursor:pointer;font-size:11px;font-weight:600;color:#64748b;background:#fff;
        transition:all .15s;user-select:none; }
      #rqcw .chip:hover { border-color:#94a3b8;background:#f8fafc; }
      #rqcw .chip.active       { border-color:#2563eb;background:#eff6ff;color:#2563eb; }
      #rqcw .chip.active-green { border-color:#16a34a;background:#f0fdf4;color:#15803d; }
      #rqcw .chip input { display:none; }
      /* Draw panel */
      #rqcw .draw-panel { margin-top:8px;padding:10px 12px;background:#f0f9ff;border:1.5px solid #bae6fd;border-radius:6px; }
      #rqcw .draw-hint  { font-size:11px;color:#0369a1;margin-top:7px;display:flex;align-items:center;gap:6px;line-height:1.4; }
      #rqcw .draw-hint.drawing { color:#dc2626; }
      #rqcw .draw-hint.done    { color:#16a34a; }
      #rqcw .pulse { width:8px;height:8px;border-radius:50%;background:currentColor;flex-shrink:0;animation:qcPulse 1s ease-in-out infinite; }
      @keyframes qcPulse { 0%,100%{opacity:1}50%{opacity:.25} }
      /* Filter badge */
      #rqcw .filter-badge { display:inline-flex;align-items:center;padding:2px 8px;background:#dbeafe;color:#1d4ed8;border-radius:99px;font-size:10px;font-weight:700; }
      /* Quick-date strip */
      #rqcw .qd-strip { display:flex;gap:4px;margin-top:5px; }
      #rqcw .qd-strip .btn { padding:3px 9px;font-size:10px;color:#475569;border-color:#e2e8f0; }
      #rqcw .qd-strip .btn:hover { background:#f1f5f9; }
    `;
    document.head.appendChild(css);

    // ── Toolbox shell ─────────────────────────────────────────────────
    const box = document.createElement('div');
    box.id = 'rqcw';
    box.style.cssText = `
      position:fixed;top:70px;right:20px;z-index:${Z};
      width:468px;max-height:90vh;overflow-y:auto;
      background:#f8fafc;border:1px solid #cbd5e1;border-radius:12px;
      box-shadow:0 10px 40px rgba(0,0,0,.22);
    `;

    box.innerHTML = `
      <!-- Header -->
      <div style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);padding:14px 16px;
                  border-radius:12px 12px 0 0;display:flex;align-items:center;justify-content:space-between;
                  position:sticky;top:0;z-index:10;">
        <div>
          <div style="color:#fff;font-weight:700;font-size:15px;letter-spacing:-.2px;">🔍 Remote QC Workflow</div>
          <div id="hdrSub" style="color:#93c5fd;font-size:11px;margin-top:2px;">Configure filters to begin</div>
        </div>
        <button id="btnClose" style="background:rgba(255,255,255,.15);border:none;color:#fff;width:28px;height:28px;
          border-radius:6px;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;">×</button>
      </div>

      <!-- Mode Tabs -->
      <div class="tab-bar">
        <button class="tab active" id="tabNew">New Feature QC</button>
        <button class="tab"        id="tabClear">Review Cleared GIGs</button>
      </div>

      <!-- Content -->
      <div style="padding:14px;display:flex;flex-direction:column;gap:10px;">

        <!-- ══ QUERY PHASE ══ -->
        <div id="phaseQuery">
          <div class="card" style="margin-bottom:10px;">

            <!-- Filter header -->
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
              <div style="display:flex;align-items:center;gap:8px;">
                <span id="filterTitle" style="font-weight:700;font-size:13px;">Filter Criteria</span>
                <span id="filterBadge" class="filter-badge" style="display:none;"></span>
              </div>
              <button class="btn btn-ghost btn-sm" id="btnClearFilters">✕ Clear All</button>
            </div>

            <!-- Two-column filter grid -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 12px;">

              <!-- Work Order -->
              <div style="margin-bottom:10px;">
                <label class="field-label">Work Order</label>
                <div style="position:relative;">
                  <input type="text" id="woSearch" placeholder="Search…" autocomplete="off">
                  <div id="woDrop" class="dropdown-list" style="display:none;"></div>
                </div>
              </div>

              <!-- Purchase Order -->
              <div style="margin-bottom:10px;">
                <label class="field-label">Purchase Order</label>
                <div style="position:relative;">
                  <input type="text" id="poSearch" placeholder="Search…" autocomplete="off">
                  <div id="poDrop" class="dropdown-list" style="display:none;"></div>
                </div>
              </div>

            </div><!-- /grid -->

            <!-- GIG Type (clear mode only) -->
            <div id="gigTypeWrap" style="margin-bottom:10px;display:none;">
              <label class="field-label">GIG Type</label>
              <select id="gigTypeFilter"><option value="">All Types</option></select>
            </div>

            <!-- Date Range -->
            <div style="margin-bottom:10px;">
              <label class="field-label" id="dateLabel">Installation Date Range</label>
              <div style="display:grid;grid-template-columns:1fr 14px 1fr;gap:4px;align-items:center;">
                <input type="date" id="dateFrom">
                <span style="text-align:center;color:#94a3b8;font-size:11px;">–</span>
                <input type="date" id="dateTo">
              </div>
              <div class="qd-strip">
                <button class="btn btn-ghost" data-days="7">Last 7 days</button>
                <button class="btn btn-ghost" data-days="30">30 days</button>
                <button class="btn btn-ghost" data-days="90">90 days</button>
                <button class="btn btn-ghost" id="qdClear" style="color:#dc2626;margin-left:auto;">✕</button>
              </div>
            </div>

            <!-- Sort -->
            <div style="margin-bottom:12px;">
              <label class="field-label">Sort Order</label>
              <select id="sortOrder">
                <option value="desc">Newest First</option>
                <option value="asc">Oldest First</option>
              </select>
            </div>

            <!-- ─ Spatial Filter ─ -->
            <div style="margin-bottom:12px;">
              <label class="field-label">Spatial Filter</label>
              <div class="chip-group">
                <label class="chip active" id="spAll">
                  <input type="radio" name="sp" value="none" checked> 🌐 All Features
                </label>
                <label class="chip" id="spScreen">
                  <input type="radio" name="sp" value="screen"> 📺 Current Screen
                </label>
                <label class="chip" id="spDraw">
                  <input type="radio" name="sp" value="draw"> ✏️ Draw Area
                </label>
              </div>

              <!-- Draw panel — shown only when draw chip active -->
              <div id="drawPanel" class="draw-panel" style="display:none;">
                <div style="display:flex;gap:6px;">
                  <button id="btnDrawPoly" class="btn btn-cyan btn-sm" style="flex:1;">⬡ Polygon</button>
                  <button id="btnDrawFree" class="btn btn-violet btn-sm" style="flex:1;">〰 Freehand</button>
                  <button id="btnClearDraw" class="btn btn-ghost btn-sm" title="Clear drawn area">✕</button>
                </div>
                <div id="drawHint" class="draw-hint">Select a tool above to start drawing</div>
              </div>
            </div>

            <div style="display:flex;gap:8px;">
              <button id="btnQuery"   class="btn btn-primary btn-full">🔍 Query Features</button>
              <button id="btnRefresh" class="btn btn-slate" style="padding:7px 14px;" disabled title="Re-run last query">↺</button>
            </div>
          </div>

          <!-- Results -->
          <div id="queryResults" class="card" style="display:none;border-color:#bfdbfe;background:#eff6ff;">
            <div style="font-weight:700;font-size:12px;color:#1d4ed8;margin-bottom:8px;">Query Results</div>
            <div id="resultsContent"></div>
            <button id="btnStart" class="btn btn-success btn-full" style="margin-top:10px;">Start Review →</button>
          </div>
        </div>

        <!-- ══ REVIEW PHASE ══ -->
        <div id="phaseReview" style="display:none;">

          <!-- Progress -->
          <div class="card-inset" style="margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
              <span style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:.4px;">PROGRESS</span>
              <span id="progressText" style="font-size:11px;font-weight:700;color:#2563eb;">0 / 0</span>
            </div>
            <div class="pbar-track"><div id="progressBar" class="pbar-fill" style="width:0%;"></div></div>
            <div style="display:flex;justify-content:space-between;margin-top:5px;">
              <span id="progressStats" style="font-size:10px;color:#94a3b8;"></span>
              <span style="font-size:10px;color:#64748b;">⏱ <span id="featureTimer" style="font-weight:700;">0:00</span></span>
            </div>
          </div>

          <!-- Feature Info -->
          <div class="card" style="margin-bottom:10px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
              <span id="featureCardLabel" style="font-size:10px;font-weight:700;color:#64748b;
                text-transform:uppercase;letter-spacing:.4px;">Current Feature</span>
              <button id="btnZoom" class="btn btn-cyan btn-sm">📍 Zoom</button>
            </div>
            <div id="featureInfo" class="attr-grid"></div>
            <div id="gigCommentsBanner" style="display:none;margin-top:10px;padding:8px 10px;
              background:#faf5ff;border:1px solid #ddd6fe;border-radius:6px;">
              <div style="font-size:10px;font-weight:700;color:#6b21a8;margin-bottom:3px;
                text-transform:uppercase;letter-spacing:.4px;">Existing GIG Comments</div>
              <div id="gigCommentsText" style="font-size:11px;color:#4c1d95;line-height:1.5;"></div>
            </div>
          </div>

          <!-- Decision -->
          <div class="card" style="margin-bottom:10px;">
            <div style="font-size:10px;font-weight:700;color:#64748b;
              text-transform:uppercase;letter-spacing:.4px;margin-bottom:10px;">QC Decision</div>

            <div id="newQcOpts">
              <label class="radio-card" id="rcPass">
                <input type="radio" name="qcDec" value="pass" id="radPass">
                <span class="rc-icon">✅</span>
                <div style="flex:1;"><div class="rc-title" style="color:#15803d;">Pass</div>
                  <div class="rc-sub">Feature meets QC requirements</div></div>
                <span class="kbd">P</span>
              </label>
              <label class="radio-card" id="rcFail">
                <input type="radio" name="qcDec" value="fail" id="radFail">
                <span class="rc-icon">❌</span>
                <div style="flex:1;"><div class="rc-title" style="color:#b91c1c;">Fail</div>
                  <div class="rc-sub">Issues requiring correction</div></div>
                <span class="kbd">F</span>
              </label>
              <label class="radio-card" id="rcPhoto">
                <input type="radio" name="qcDec" value="missing_photo" id="radPhoto">
                <span class="rc-icon">📷</span>
                <div style="flex:1;"><div class="rc-title" style="color:#92400e;">Missing Photo</div>
                  <div class="rc-sub">Photo required but not attached</div></div>
                <span class="kbd">M</span>
              </label>
            </div>

            <div id="clearOpts" style="display:none;">
              <label class="radio-card" id="rcApprove">
                <input type="radio" name="clrDec" value="approve" id="radApprove">
                <span class="rc-icon">✅</span>
                <div style="flex:1;"><div class="rc-title" style="color:#15803d;">Approve</div>
                  <div class="rc-sub">Fix verified — APPROVED + feature → QCCMPLT</div></div>
                <span class="kbd">A</span>
              </label>
              <label class="radio-card" id="rcReopen">
                <input type="radio" name="clrDec" value="reopen" id="radReopen">
                <span class="rc-icon">↩️</span>
                <div style="flex:1;"><div class="rc-title" style="color:#b91c1c;">Re-open</div>
                  <div class="rc-sub">Fix insufficient — return to OPEN</div></div>
                <span class="kbd">R</span>
              </label>
            </div>

            <!-- Issue types -->
            <div id="issueSection" style="display:none;margin-top:10px;">
              <label class="field-label">Issue Type(s) <span style="color:#dc2626;">*</span></label>
              <input type="text" id="issueSearch" placeholder="Search issue types…" style="margin-bottom:6px;">
              <div class="scroll-box" id="issueList"></div>
              <div style="font-size:10px;color:#94a3b8;margin-top:3px;">Select all that apply</div>
            </div>

            <!-- Notes -->
            <div style="margin-top:12px;">
              <label class="field-label">
                Notes
                <span style="font-size:9px;color:#94a3b8;font-weight:400;text-transform:none;letter-spacing:0;">
                  — saved to GIG <code style="font-size:9px;">comments</code> field
                </span>
              </label>
              <textarea id="qcNotes" rows="2" placeholder="Additional comments…" style="resize:vertical;"></textarea>
            </div>

            <div style="display:flex;gap:8px;margin-top:12px;">
              <button id="btnSubmit" class="btn btn-success" style="flex:1;">Submit <span class="kbd" style="filter:invert(1);">↵</span></button>
              <button id="btnSkip"   class="btn btn-amber"   style="padding:7px 14px;">Skip <span class="kbd" style="filter:invert(1);">→</span></button>
            </div>
            <button id="btnPrev" class="btn btn-ghost btn-full" style="margin-top:6px;">← Previous <span class="kbd">←</span></button>
          </div>
        </div>

        <!-- ══ COMPLETE PHASE ══ -->
        <div id="phaseComplete" style="display:none;">
          <div style="text-align:center;padding:18px 0 10px;">
            <div style="font-size:42px;">🎉</div>
            <div style="font-weight:700;font-size:15px;color:#15803d;margin-top:8px;">Session Complete</div>
            <div style="color:#64748b;font-size:12px;margin-top:3px;">All features reviewed</div>
          </div>
          <div id="sessionSummary" class="card" style="margin-bottom:10px;"></div>
          <div style="display:flex;gap:8px;">
            <button id="btnExport"    class="btn btn-cyan"    style="flex:1;">📄 Export Report</button>
            <button id="btnStartOver" class="btn btn-success" style="flex:1;">↺ New Session</button>
          </div>
        </div>

      </div><!-- /content -->

      <!-- Status Bar -->
      <div style="background:#fff;border-top:1px solid #e2e8f0;padding:7px 14px;
                  border-radius:0 0 12px 12px;display:flex;align-items:center;gap:7px;
                  position:sticky;bottom:0;">
        <div id="statusDot" style="width:7px;height:7px;border-radius:50%;background:#94a3b8;flex-shrink:0;transition:background .3s;"></div>
        <div id="statusMsg" style="font-size:11px;color:#64748b;flex:1;"></div>
      </div>
    `;

    document.body.appendChild(box);
    const $ = sel => box.querySelector(sel);

    // ── Helpers ───────────────────────────────────────────────────────
    function setStatus(msg, type = 'idle') {
      $('#statusMsg').textContent = msg;
      const c = { idle:'#94a3b8', busy:'#f59e0b', ok:'#16a34a', error:'#dc2626' };
      $('#statusDot').style.background = c[type] ?? c.idle;
    }

    function setPhase(ph) {
      currentPhase = ph;
      $('#phaseQuery').style.display    = ph === 'query'    ? 'block' : 'none';
      $('#phaseReview').style.display   = ph === 'review'   ? 'block' : 'none';
      $('#phaseComplete').style.display = ph === 'complete' ? 'block' : 'none';
    }

    function updateFilterBadge() {
      let n = 0;
      if ($('#woSearch').dataset.code)  n++;
      if ($('#poSearch').dataset.code)  n++;
      if ($('#gigTypeFilter').value)    n++;
      if ($('#dateFrom').value || $('#dateTo').value) n++;
      if (spatialMode !== 'none')       n++;
      const b = $('#filterBadge');
      b.style.display = n ? 'inline-flex' : 'none';
      b.textContent   = n + (n === 1 ? ' filter' : ' filters');
    }

    // ── Mode switching ─────────────────────────────────────────────────
    function applyMode(m) {
      mode = m;
      $('#tabNew').classList.toggle('active',   m === 'new_qc');
      $('#tabClear').classList.toggle('active', m === 'clear_review');
      $('#gigTypeWrap').style.display = m === 'clear_review' ? 'block' : 'none';
      $('#dateLabel').textContent     = m === 'clear_review' ? 'GIG Date Range' : 'Installation Date Range';
      $('#filterTitle').textContent   = m === 'clear_review' ? 'Filter Cleared GIGs' : 'Filter Criteria';
      resetSession(false);
    }
    $('#tabNew').onclick   = () => applyMode('new_qc');
    $('#tabClear').onclick = () => applyMode('clear_review');

    // ── Initialize ─────────────────────────────────────────────────────
    async function init() {
      setStatus('Initializing…', 'busy');
      try {
        await loadGigTypes();
        await loadWorkOrders();
        await loadPurchaseOrders();
        setStatus('Ready — configure filters and query.', 'ok');
      } catch (e) { setStatus('Init error: ' + e.message, 'error'); console.error(e); }
    }

    async function loadGigTypes() {
      const lyr = mapView.map.allLayers.find(l => l.layerId === 22100);
      if (!lyr) throw new Error('GIG layer (22100) not found');
      await lyr.load();
      const fld = lyr.fields.find(f => f.name.toLowerCase() === 'gig_type');
      if (!fld?.domain?.codedValues) throw new Error('gig_type coded-value domain not found on layer 22100');
      gigTypes = fld.domain.codedValues.map(cv => ({ code: cv.code, name: cv.name }));
      const sel = $('#gigTypeFilter');
      gigTypes.forEach(gt => {
        const o = document.createElement('option');
        o.value = gt.code; o.textContent = gt.name; sel.appendChild(o);
      });
    }

    // Generic: collect distinct values that actually exist in visible feature layers.
    // Domain (if present) is used only as a name-lookup — values not in the data are excluded.
    async function collectFieldValues(fieldName) {
      const layers = mapView.map.allLayers.filter(l => l.type === 'feature' && l.visible);
      const map = new Map(); // code → display name

      for (const lyr of layers.items) {
        try {
          if (lyr === sketchLayer) continue;
          await lyr.load();
          const fld = lyr.fields.find(f => f.name.toLowerCase() === fieldName.toLowerCase());
          if (!fld) continue;

          // Build a code→name lookup from the domain (if available)
          const domainLookup = new Map();
          if (fld.domain?.type === 'coded-value') {
            fld.domain.codedValues.forEach(cv => domainLookup.set(cv.code, cv.name));
          }

          // Always query for values that are actually in the data
          const q = lyr.createQuery();
          q.where = '1=1'; q.returnDistinctValues = true;
          q.outFields = [fld.name]; q.returnGeometry = false;
          const res = await lyr.queryFeatures(q);

          res.features.forEach(f => {
            const code = f.attributes[fld.name];
            if (code == null || code === '') return;
            // Prefer the domain display name; fall back to the raw code value
            const name = domainLookup.get(code) ?? code;
            map.set(code, name);
          });
        } catch (_) {}
      }

      return Array.from(map.entries())
        .map(([code, name]) => ({ code, name }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    }

    async function loadWorkOrders()    { workOrderOptions = await collectFieldValues('workorder_id');       setupDropdown('#woSearch', '#woDrop', workOrderOptions); }
    async function loadPurchaseOrders(){ poOptions         = await collectFieldValues('purchase_order_id'); setupDropdown('#poSearch', '#poDrop', poOptions); }

    function setupDropdown(inputSel, dropSel, options) {
      const inp = $(inputSel), dd = $(dropSel);
      const render = (filter = '') => {
        dd.innerHTML = '';
        const lc = filter.toLowerCase();
        const all = document.createElement('div');
        all.className = 'dd-item dd-sep'; all.textContent = '— All —';
        all.onmousedown = () => { inp.value = ''; delete inp.dataset.code; dd.style.display = 'none'; updateFilterBadge(); };
        dd.appendChild(all);
        const hits = options.filter(o => String(o.name).toLowerCase().includes(lc) || String(o.code).toLowerCase().includes(lc)).slice(0, 60);
        if (!hits.length) {
          const none = document.createElement('div'); none.className = 'dd-item'; none.style.color = '#94a3b8'; none.textContent = 'No matches'; dd.appendChild(none);
        } else {
          hits.forEach(o => {
            const d = document.createElement('div'); d.className = 'dd-item'; d.textContent = o.name;
            d.onmousedown = () => { inp.value = o.name; inp.dataset.code = o.code; dd.style.display = 'none'; updateFilterBadge(); };
            dd.appendChild(d);
          });
        }
      };
      inp.onfocus = () => { render(inp.value); dd.style.display = 'block'; };
      inp.oninput = () => { render(inp.value); dd.style.display = 'block'; };
      inp.onblur  = () => setTimeout(() => dd.style.display = 'none', 160);
    }

    // ── Date quick-picks ───────────────────────────────────────────────
    box.querySelectorAll('.qd-strip [data-days]').forEach(btn => {
      btn.onclick = () => {
        const days = parseInt(btn.dataset.days);
        const to = new Date(), from = new Date();
        from.setDate(from.getDate() - days);
        $('#dateTo').value   = to.toISOString().split('T')[0];
        $('#dateFrom').value = from.toISOString().split('T')[0];
        updateFilterBadge();
      };
    });
    $('#qdClear').onclick = () => { $('#dateFrom').value = ''; $('#dateTo').value = ''; updateFilterBadge(); };
    ['#dateFrom','#dateTo'].forEach(s => $(s).onchange = updateFilterBadge);
    $('#gigTypeFilter').onchange = updateFilterBadge;

    // ── Spatial filter chips ───────────────────────────────────────────
    function setSpatialMode(m) {
      spatialMode = m;
      $('#spAll').className    = 'chip' + (m === 'none'   ? ' active' : '');
      $('#spScreen').className = 'chip' + (m === 'screen' ? ' active' : '');
      $('#spDraw').className   = 'chip'
        + (m === 'draw'  ? ' active' : '')
        + (m === 'drawn' ? ' active-green' : '');
      $('#drawPanel').style.display = (m === 'draw' || m === 'drawn') ? 'block' : 'none';
      updateFilterBadge();
    }

    box.querySelectorAll("input[name='sp']").forEach(radio => {
      radio.closest('label').onclick = () => {
        const v = radio.value;
        if (v === 'draw') {
          setSpatialMode('draw');
          initSketch().catch(e => { setStatus('Sketch error: ' + e.message, 'error'); console.error(e); });
        } else {
          if (sketchVM && isDrawing) sketchVM.cancel();
          setSpatialMode(v);
        }
      };
    });

    function setDrawHint(state, msg) {
      const el = $('#drawHint');
      el.className = 'draw-hint' + (state ? ' ' + state : '');
      el.innerHTML = state === 'drawing' ? `<span class="pulse"></span>${msg}` : msg;
    }

    $('#btnDrawPoly').onclick = () => startDraw('polygon', 'click');
    $('#btnDrawFree').onclick = () => startDraw('polygon', 'freehand');
    $('#btnClearDraw').onclick = () => {
      clearSketchGraphics();
      setSpatialMode('draw');
      setDrawHint('', 'Select a tool above to start drawing');
    };

    async function initSketch() {
      if (sketchVM) return;
      setStatus('Loading sketch tools…', 'busy');
      const [GraphicsLayer, SketchViewModel] = await Promise.all([
        loadModule('esri/layers/GraphicsLayer'),
        loadModule('esri/widgets/Sketch/SketchViewModel')
      ]);
      sketchLayer = new GraphicsLayer({ listMode: 'hide', title: 'QC Selection Area' });
      mapView.map.add(sketchLayer);
      sketchVM = new SketchViewModel({
        view: mapView,
        layer: sketchLayer,
        updateOnGraphicClick: false,
        polygonSymbol: {
          type: 'simple-fill',
          color: [37, 99, 235, 0.07],
          outline: { type: 'simple-line', color: [37, 99, 235, 0.85], width: 2, style: 'dash' }
        }
      });
      sketchVM.on('create', e => {
        if (e.state === 'start') {
          isDrawing = true;
          setDrawHint('drawing', 'Drawing…');
        } else if (e.state === 'complete') {
          isDrawing = false;
          drawnGeometry = e.graphic.geometry;
          setSpatialMode('drawn');
          setDrawHint('done', '✓ Area selected — run query to apply');
          setStatus('Drawn area ready', 'ok');
        } else if (e.state === 'cancel') {
          isDrawing = false;
          setDrawHint('', 'Drawing cancelled — select a tool to try again');
        }
      });
      setStatus('Sketch ready', 'ok');
      setDrawHint('', 'Select a tool above to start drawing');
    }

    function startDraw(tool, drawMode) {
      if (!sketchVM) { initSketch().then(() => sketchVM.create(tool, { mode: drawMode })).catch(console.error); return; }
      if (isDrawing) sketchVM.cancel();
      clearSketchGraphics();
      sketchVM.create(tool, { mode: drawMode });
      setDrawHint('drawing', drawMode === 'freehand' ? 'Hold and drag to draw a freehand area' : 'Click to place vertices — double-click to finish');
    }

    function clearSketchGraphics() { if (sketchLayer) sketchLayer.removeAll(); drawnGeometry = null; }

    // ── Apply spatial filter to a query object ─────────────────────────
    function applySpatialFilter(query) {
      if (spatialMode === 'screen') {
        query.geometry = mapView.extent; query.spatialRelationship = 'intersects';
      } else if (spatialMode === 'drawn' && drawnGeometry) {
        query.geometry = drawnGeometry; query.spatialRelationship = 'intersects';
      }
    }

    // ── Run query ──────────────────────────────────────────────────────
    async function runQuery() {
      try {
        setStatus('Querying…', 'busy');
        $('#btnQuery').disabled = true;
        if (sketchVM && isDrawing) { sketchVM.cancel(); isDrawing = false; }
        mode === 'new_qc' ? await queryNewFeatures() : await queryClearedGigs();
        $('#btnRefresh').disabled = false;
      } catch (e) { setStatus('Query error: ' + e.message, 'error'); alert('Query error:\n' + e.message); }
      finally { $('#btnQuery').disabled = false; }
    }

    async function queryNewFeatures() {
      const clauses = ["workflow_stage = 'OSP_CONST'", "workflow_status = 'CMPLT'"];
      const woCode = $('#woSearch').dataset.code, poCode = $('#poSearch').dataset.code;
      if (woCode) clauses.push(`workorder_id = '${woCode.replace(/'/g,"''")}'`);
      if (poCode) clauses.push(`purchase_order_id = '${poCode.replace(/'/g,"''")}'`);
      const df = $('#dateFrom').value, dt = $('#dateTo').value;
      if (df) clauses.push(`installation_date >= ${new Date(df).getTime()}`);
      if (dt) clauses.push(`installation_date <= ${new Date(dt + 'T23:59:59').getTime()}`);
      const where = clauses.join(' AND '), sort = $('#sortOrder').value;

      const layers = mapView.map.allLayers.filter(l => l.type === 'feature' && l.visible);
      qcQueue = [];
      const counts = {}, errs = [];

      for (const lyr of layers.items) {
        try {
          if (lyr === sketchLayer) continue;
          await lyr.load();
          const req = ['workflow_stage','workflow_status','gis_id'];
          if (!req.every(fn => lyr.fields.some(f => f.name.toLowerCase() === fn))) continue;
          const q = lyr.createQuery();
          q.where = where; q.outFields = ['*']; q.returnGeometry = true;
          applySpatialFilter(q);
          try { q.orderByFields = [`installation_date ${sort.toUpperCase()}`]; } catch (_) {}
          const res = await lyr.queryFeatures(q);
          if (res.features.length) {
            counts[lyr.title] = res.features.length;
            res.features.forEach(f => {
              const gisId = f.attributes.gis_id || f.attributes.GIS_ID || f.attributes.gisid || 'Unknown';
              qcQueue.push({ layer: lyr, feature: f, gisId, type: 'new_qc' });
            });
          }
        } catch (_) { errs.push(lyr.title); }
      }

      qcQueue.sort((a, b) => {
        const da = a.feature.attributes.installation_date || 0, db = b.feature.attributes.installation_date || 0;
        return sort === 'desc' ? db - da : da - db;
      });
      showQueryResults(counts, errs);
    }

    async function queryClearedGigs() {
      const gigLyr = mapView.map.allLayers.find(l => l.layerId === 22100);
      if (!gigLyr) throw new Error('GIG layer (22100) not found');
      await gigLyr.load();

      const clauses = ["gig_status = 'CLEAR'"];
      const woCode = $('#woSearch').dataset.code, poCode = $('#poSearch').dataset.code, gtCode = $('#gigTypeFilter').value;
      if (woCode) clauses.push(`workorder_id = '${woCode.replace(/'/g,"''")}'`);
      if (poCode) clauses.push(`purchase_order_id = '${poCode.replace(/'/g,"''")}'`);
      if (gtCode) clauses.push(`gig_type = '${gtCode.replace(/'/g,"''")}'`);
      const df = $('#dateFrom').value, dt = $('#dateTo').value;
      if (df) clauses.push(`created_date >= ${new Date(df).getTime()}`);
      if (dt) clauses.push(`created_date <= ${new Date(dt + 'T23:59:59').getTime()}`);

      const sort = $('#sortOrder').value;
      const q = gigLyr.createQuery();
      q.where = clauses.join(' AND '); q.outFields = ['*']; q.returnGeometry = true;
      applySpatialFilter(q);
      try { q.orderByFields = [`created_date ${sort.toUpperCase()}`]; } catch (_) {}

      const res = await gigLyr.queryFeatures(q);
      qcQueue = res.features.map(f => {
        const a = f.attributes;
        const gigTypeName = gigTypes.find(gt => gt.code == a.gig_type)?.name ?? (a.gig_type || 'Unknown');
        return { layer: gigLyr, feature: f, gisId: a.billing_area_code || 'Unknown', gigTypeName, type: 'clear_review' };
      });
      showQueryResults(qcQueue.length ? { 'Cleared GIGs (layer 22100)': qcQueue.length } : {}, []);
    }

    function showQueryResults(counts, errs) {
      const cont = $('#resultsContent'), res = $('#queryResults');
      if (!qcQueue.length) {
        cont.innerHTML = `<div style="text-align:center;padding:10px;color:#64748b;">No features found — try adjusting your filters.</div>
          ${errs.length ? `<div style="font-size:11px;color:#dc2626;margin-top:6px;">⚠ ${errs.length} layer(s) had errors: ${errs.join(', ')}</div>` : ''}`;
        res.style.display = 'block'; $('#btnStart').style.display = 'none';
        setStatus('No features found', 'idle'); return;
      }
      const spatialNote = spatialMode === 'screen' ? ' <span style="font-size:10px;color:#0891b2;">📺 screen</span>'
                        : spatialMode === 'drawn'  ? ' <span style="font-size:10px;color:#2563eb;">✏️ drawn area</span>' : '';
      let html = `<div style="font-weight:700;font-size:13px;color:#1d4ed8;margin-bottom:8px;">${qcQueue.length} feature${qcQueue.length !== 1 ? 's' : ''} ready${spatialNote}</div><div style="line-height:1.9;">`;
      Object.entries(counts).forEach(([n, c]) =>
        html += `<div style="display:flex;justify-content:space-between;font-size:11px;"><span>${n}</span><strong>${c}</strong></div>`);
      html += '</div>';
      if (errs.length) html += `<div style="font-size:10px;color:#92400e;margin-top:6px;padding:4px 8px;background:#fffbeb;border-radius:4px;">⚠ ${errs.length} layer(s) skipped</div>`;
      cont.innerHTML = html;
      res.style.display = 'block'; $('#btnStart').style.display = 'block';
      setStatus(`${qcQueue.length} feature${qcQueue.length !== 1 ? 's' : ''} ready`, 'ok');
    }

    // ── Review session ─────────────────────────────────────────────────
    function startReview() {
      if (!qcQueue.length) { alert('No features to review'); return; }
      currentIndex = 0; sessionLog = []; sessionStartTime = new Date();
      setPhase('review'); wireDecisionForm(); showFeature();
    }

    function wireDecisionForm() {
      const isNew = mode === 'new_qc';
      $('#newQcOpts').style.display = isNew ? 'block' : 'none';
      $('#clearOpts').style.display = isNew ? 'none' : 'block';
      $('#featureCardLabel').textContent = isNew ? 'Current Feature' : 'Cleared GIG';
      if (isNew) {
        const sync = () => {
          const v = box.querySelector("input[name='qcDec']:checked")?.value;
          $('#rcPass').className  = 'radio-card' + (v === 'pass'          ? ' sel-pass'  : '');
          $('#rcFail').className  = 'radio-card' + (v === 'fail'          ? ' sel-fail'  : '');
          $('#rcPhoto').className = 'radio-card' + (v === 'missing_photo' ? ' sel-photo' : '');
          $('#issueSection').style.display = v === 'fail' ? 'block' : 'none';
        };
        ['#radPass','#radFail','#radPhoto'].forEach(s => $(s).onchange = sync);
        setupIssueTypes();
      } else {
        const sync = () => {
          const v = box.querySelector("input[name='clrDec']:checked")?.value;
          $('#rcApprove').className = 'radio-card' + (v === 'approve' ? ' sel-approve' : '');
          $('#rcReopen').className  = 'radio-card' + (v === 'reopen'  ? ' sel-reopen'  : '');
        };
        $('#radApprove').onchange = sync; $('#radReopen').onchange = sync;
      }
    }

    function setupIssueTypes() {
      const inp = $('#issueSearch'), list = $('#issueList');
      const render = (filter = '') => {
        list.innerHTML = '';
        const lc = filter.toLowerCase();
        const hits = gigTypes.filter(gt => gt.name.toLowerCase().includes(lc) || String(gt.code).toLowerCase().includes(lc));
        if (!hits.length) { list.innerHTML = '<div style="padding:8px;color:#94a3b8;font-size:11px;text-align:center;">No matches</div>'; return; }
        hits.forEach(gt => {
          const lbl = document.createElement('label'); lbl.className = 'check-item';
          lbl.innerHTML = `<input type="checkbox" class="issueCheck" data-code="${gt.code}" data-name="${gt.name}"><span style="font-size:11px;">${gt.name}</span>`;
          list.appendChild(lbl);
        });
      };
      render(); inp.oninput = () => render(inp.value);
    }

    function showFeature() {
      if (currentIndex >= qcQueue.length) { completeSession(); return; }
      const item = qcQueue[currentIndex];
      const pct  = ((currentIndex + 1) / qcQueue.length) * 100;
      $('#progressBar').style.width  = pct + '%';
      $('#progressText').textContent = `${currentIndex + 1} / ${qcQueue.length}`;
      const rev = sessionLog.filter(e => e.action === 'qc_review' && e.success);
      const pc  = rev.filter(e => e.decision === 'Pass' || e.decision === 'Approve').length;
      const sk  = sessionLog.filter(e => e.action === 'skip').length;
      $('#progressStats').textContent = rev.length ? `${pc} ✓  ${rev.length - pc} ✗${sk ? '  ' + sk + ' skipped' : ''}` : '';
      $('#hdrSub').textContent = mode === 'new_qc' ? `New QC · ${item.layer.title}` : `Clear Review · GIS ${item.gisId}`;
      renderFeatureInfo(item); resetForm(); startTimer();
      $('#btnPrev').disabled = currentIndex === 0;
      showPopup(item);
      setStatus(`Reviewing ${currentIndex + 1} of ${qcQueue.length}`, 'busy');
    }

    function renderFeatureInfo(item) {
      const a = item.feature.attributes, isNew = item.type === 'new_qc';
      const rows = [];
      if (isNew) {
        rows.push(['GIS ID', item.gisId], ['Layer', item.layer.title],
          ['Work Order', a.workorder_id || 'N/A']);
        if (a.purchase_order_id) rows.push(['Purchase Order', a.purchase_order_id]);
        if (a.installation_date) rows.push(['Install Date', new Date(a.installation_date).toLocaleDateString()]);
        if (a.supervisor) rows.push(['Supervisor', a.supervisor]);
        if (a.crew)       rows.push(['Crew', a.crew]);
      } else {
        rows.push(['Origin GlobalID', item.gisId], ['GIG Type', item.gigTypeName],
          ['Work Order', a.workorder_id || 'N/A']);
        if (a.purchase_order_id) rows.push(['Purchase Order', a.purchase_order_id]);
        if (a.created_date) rows.push(['Created', new Date(a.created_date).toLocaleDateString()]);
        rows.push(['GIG Status', a.gig_status || 'N/A']);
      }
      $('#featureInfo').innerHTML = rows.map(([k, v]) => `<span class="attr-key">${k}:</span><span class="attr-val">${v}</span>`).join('');
      const banner = $('#gigCommentsBanner');
      if (!isNew && a.comments) { banner.style.display = 'block'; $('#gigCommentsText').textContent = a.comments; }
      else banner.style.display = 'none';
    }

    function resetForm() {
      box.querySelectorAll("input[name='qcDec'],input[name='clrDec']").forEach(r => r.checked = false);
      box.querySelectorAll('.radio-card').forEach(rc => rc.className = 'radio-card');
      $('#issueSection').style.display = 'none'; $('#qcNotes').value = '';
    }

    // ── Timer ─────────────────────────────────────────────────────────
    const startTimer = () => {
      stopTimer(); featureStartTime = new Date();
      timerInterval = setInterval(() => {
        const s = Math.floor((new Date() - featureStartTime) / 1000);
        $('#featureTimer').textContent = `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;
      }, 1000);
    };
    const stopTimer = () => { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } };
    const elapsed   = () => featureStartTime ? Math.floor((new Date() - featureStartTime) / 1000) : 0;

    // ── Map helpers ───────────────────────────────────────────────────
    const zoomToFeature = () => mapView.goTo({ target: qcQueue[currentIndex].feature.geometry, scale: Math.min(mapView.scale, 2000) }).catch(console.error);

    async function showPopup(item) {
      try {
        if (highlightHandle) { highlightHandle.remove(); highlightHandle = null; }
        const oid = item.feature.attributes[item.layer.objectIdField];
        const qr  = await item.layer.queryFeatures({ where: `${item.layer.objectIdField} = ${oid}`, outFields: ['*'], returnGeometry: true });
        const feat = qr.features[0] || item.feature;
        mapView.whenLayerView(item.layer).then(lv => { highlightHandle = lv.highlight(oid); }).catch(() => {});
        mapView.popup.open({ features: [feat], location: popupLoc(feat.geometry), updateLocationEnabled: false });
      } catch (e) { console.error('Popup:', e); }
    }

    function popupLoc(g) {
      try {
        if (g.type === 'point') return g;
        if (g.type === 'polyline' && g.paths?.[0]) { const p = g.paths[0], m = Math.floor(p.length/2); return { type:'point', x:p[m][0], y:p[m][1], spatialReference:g.spatialReference }; }
        return g.centroid || g.extent?.center || g;
      } catch (_) { return g; }
    }

    function gigLayerRef() { const l = mapView.map.allLayers.find(l => l.layerId === 22100); if (!l) throw new Error('GIG layer (22100) not found'); return l; }

    function gigPointGeom(g) {
      if (g.type === 'point') return g;
      if (g.type === 'polyline' && g.paths?.[0]?.length > 1) {
        const path = g.paths[0]; let total = 0;
        const segs = path.slice(0,-1).map((pt,i) => { const dx=path[i+1][0]-pt[0],dy=path[i+1][1]-pt[1],len=Math.sqrt(dx*dx+dy*dy); total+=len; return {x1:pt[0],y1:pt[1],x2:path[i+1][0],y2:path[i+1][1],len,cum:total}; });
        let prev=0, target=total/2;
        for (const s of segs) { if (s.cum>=target) { const t=(target-prev)/s.len; return {type:'point',x:s.x1+(s.x2-s.x1)*t,y:s.y1+(s.y2-s.y1)*t,spatialReference:g.spatialReference}; } prev=s.cum; }
      }
      if (g.type === 'polygon') return g.centroid || g.extent?.center;
      return g.extent?.center || g;
    }

    function buildGigAttrs(src, gigType, gigStatus, comments) {
      const a = src.attributes;
      return { billing_area_code: a.globalid, client_code:a.client_code, project_id:a.project_id,
        job_number:a.job_number, purchase_order_id:a.purchase_order_id, workorder_id:a.workorder_id,
        workflow_stage:a.workflow_stage, workflow_status:a.workflow_status, supervisor:a.supervisor,
        crew:a.crew, construction_subcontractor:a.construction_subcontractor,
        gig_type:gigType, gig_status:gigStatus, comments:comments||null };
    }

    // ── Submit — New QC ───────────────────────────────────────────────
    async function submitNewQc() {
      const item = qcQueue[currentIndex];
      const dec  = box.querySelector("input[name='qcDec']:checked");
      if (!dec) { alert('Please select Pass, Fail, or Missing Photo'); return; }
      const dv = dec.value, notes = $('#qcNotes').value.trim();
      let issues = [];
      if (dv === 'fail') {
        const checked = box.querySelectorAll('.issueCheck:checked');
        if (!checked.length) { alert('Please select at least one issue type'); return; }
        issues = Array.from(checked).map(cb => ({ code: cb.dataset.code, name: cb.dataset.name }));
      }
      try {
        setStatus('Saving…', 'busy'); $('#btnSubmit').disabled = true;
        const cfg = {
          pass:          { gigStatus:'PASS',          wfStatus:'QCCMPLT',  pts:[{type:null,status:'PASS'}],                              update:true  },
          fail:          { gigStatus:'OPEN',           wfStatus:'QCINPROG', pts:issues.map(it=>({type:it.code,status:'OPEN'})),           update:true  },
          missing_photo: { gigStatus:'MISSING_PHOTO', wfStatus:null,        pts:[{type:null,status:'MISSING_PHOTO'}],                     update:false }
        }[dv];
        const gl = gigLayerRef(); await gl.load();
        const geom = gigPointGeom(item.feature.geometry);
        const addRes = await gl.applyEdits({ addFeatures: cfg.pts.map(gp => ({ geometry:geom, attributes:buildGigAttrs(item.feature,gp.type,gp.status,notes) })) });
        const ok = (addRes.addFeatureResults||[]).filter(r => r.success===true||(r.success===undefined&&r.error===null&&(r.objectId||r.globalId))).length;
        if (ok < cfg.pts.length) { const e=(addRes.addFeatureResults||[]).filter(r=>!(r.success===true||(r.success===undefined&&r.error===null))).map(r=>r.error?.message||'Unknown').join(', '); throw new Error('GIG creation failed: '+e); }
        if (cfg.update) {
          const oid = item.feature.attributes[item.layer.objectIdField];
          const up  = await item.layer.applyEdits({ updateFeatures:[{attributes:{[item.layer.objectIdField]:oid,workflow_status:cfg.wfStatus}}] });
          const ur  = up.updateFeatureResults?.[0];
          if (!(ur?.success===true||(ur?.success===undefined&&ur?.error===null))) throw new Error(ur?.error?.message||'Feature update failed');
        }
        const label = {pass:'Pass',fail:'Fail',missing_photo:'Missing Photo'}[dv];
        sessionLog.push({ timestamp:new Date(), action:'qc_review', layerName:item.layer.title, gisId:item.gisId, decision:label, gigPointsCreated:ok, issueTypes:issues, notes, timeSpent:elapsed(), success:true });
        setStatus(`${label} submitted · ${ok} GIG point(s) created`, 'ok');
        stopTimer(); currentIndex++; setTimeout(showFeature, 600);
      } catch (e) {
        setStatus('Error: '+e.message, 'error'); alert('Error submitting QC:\n'+e.message+'\n\nNo changes saved.');
        sessionLog.push({ timestamp:new Date(), action:'qc_review', layerName:item.layer.title, gisId:item.gisId, success:false, error:e.message });
        console.error(e);
      } finally { $('#btnSubmit').disabled = false; }
    }

    // ── Submit — Clear Review ─────────────────────────────────────────
    async function submitClearReview() {
      const item = qcQueue[currentIndex];
      const dec  = box.querySelector("input[name='clrDec']:checked");
      if (!dec) { alert('Please select Approve or Re-open'); return; }
      const dv = dec.value, notes = $('#qcNotes').value.trim();
      try {
        setStatus('Saving…', 'busy'); $('#btnSubmit').disabled = true;
        const gl  = gigLayerRef(); await gl.load();
        const oid = item.feature.attributes[gl.objectIdField];
        const gigAttrs = { [gl.objectIdField]:oid, gig_status: dv==='approve' ? 'APPROVED' : 'OPEN' };
        if (notes) gigAttrs.comments = notes;
        const gigRes = await gl.applyEdits({ updateFeatures:[{attributes:gigAttrs}] });
        const gr = gigRes.updateFeatureResults?.[0];
        if (!(gr?.success===true||(gr?.success===undefined&&gr?.error===null))) throw new Error(gr?.error?.message||'GIG update failed');
        if (dv === 'approve') await updateOriginatingFeature(item.gisId, 'QCCMPLT');
        sessionLog.push({ timestamp:new Date(), action:'qc_review', layerName:'GIG Layer (22100)', gisId:item.gisId, decision:dv==='approve'?'Approve':'Re-open', gigPointsCreated:0, notes, timeSpent:elapsed(), success:true });
        setStatus(`GIG ${dv==='approve'?'approved':'re-opened'}`, 'ok');
        stopTimer(); currentIndex++; setTimeout(showFeature, 600);
      } catch (e) { setStatus('Error: '+e.message, 'error'); alert('Error:\n'+e.message); console.error(e); }
      finally { $('#btnSubmit').disabled = false; }
    }

    async function updateOriginatingFeature(globalId, newStatus) {
      const layers = mapView.map.allLayers.filter(l => l.type === 'feature' && l.visible);
      for (const lyr of layers.items) {
        try {
          if (lyr === sketchLayer) continue;
          await lyr.load();
          // GlobalID is a system-managed field — skip layers that don't have one
          if (!lyr.globalIdField) continue;
          const q = lyr.createQuery();
          q.where = `${lyr.globalIdField} = '${globalId}'`;
          q.outFields = [lyr.objectIdField]; q.returnGeometry = false;
          const res = await lyr.queryFeatures(q);
          if (!res.features.length) continue;
          const oid = res.features[0].attributes[lyr.objectIdField];
          const up  = await lyr.applyEdits({ updateFeatures:[{attributes:{[lyr.objectIdField]:oid, workflow_status:newStatus}}] });
          const ur  = up.updateFeatureResults?.[0];
          if (!(ur?.success===true||(ur?.success===undefined&&ur?.error===null)))
            throw new Error(ur?.error?.message || 'Originating feature update failed');
          return; // matched exactly one record — done
        } catch (e) { throw e; }
      }
      setStatus(`⚠ Originating feature GlobalID "${globalId}" not found in visible layers`, 'error');
      console.warn('Originating feature not found by GlobalID:', globalId);
    }

    // ── Skip / Prev ───────────────────────────────────────────────────
    const skipFeature = () => {
      sessionLog.push({ timestamp:new Date(), action:'skip', layerName:qcQueue[currentIndex].layer.title, gisId:qcQueue[currentIndex].gisId, timeSpent:elapsed(), success:true });
      stopTimer(); currentIndex++; showFeature();
    };
    const prevFeature = () => { if (currentIndex>0) { stopTimer(); currentIndex--; showFeature(); } };

    // ── Complete ──────────────────────────────────────────────────────
    function completeSession() {
      stopTimer();
      if (highlightHandle) { highlightHandle.remove(); highlightHandle = null; }
      mapView.popup?.close(); renderSummary(); setPhase('complete'); setStatus('Session complete!', 'ok');
    }

    function renderSummary() {
      const rev  = sessionLog.filter(e => e.action==='qc_review');
      const pass = rev.filter(e => e.decision==='Pass'||e.decision==='Approve').length;
      const fail = rev.filter(e => e.decision==='Fail'||e.decision==='Re-open').length;
      const photo = rev.filter(e => e.decision==='Missing Photo').length;
      const skip = sessionLog.filter(e => e.action==='skip').length;
      const errs = sessionLog.filter(e => !e.success).length;
      const gigs = rev.filter(e=>e.success).reduce((s,e)=>s+(e.gigPointsCreated||0),0);
      const rate = rev.length ? Math.round((pass/rev.length)*100) : 0;
      const dur  = sessionStartTime ? Math.floor((new Date()-sessionStartTime)/1000) : 0;
      const row  = (l,v,c='#1e293b') => `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f1f5f9;"><span style="font-size:11px;color:#64748b;">${l}</span><span style="font-size:12px;font-weight:700;color:${c};">${v}</span></div>`;
      $('#sessionSummary').innerHTML = `<div style="font-weight:700;font-size:13px;margin-bottom:10px;">Session Summary</div>
        ${row('Total Reviewed',rev.length)}${row('Passed / Approved',pass,'#16a34a')}${row('Failed / Re-opened',fail,'#dc2626')}
        ${photo?row('Missing Photo',photo,'#d97706'):''}${skip?row('Skipped',skip):''}${errs?row('Errors',errs,'#dc2626'):''}
        ${row('Pass Rate',rate+'%',rate>=80?'#16a34a':'#dc2626')}${gigs?row('GIG Points Created',gigs,'#0891b2'):''}
        ${row('Session Duration',`${Math.floor(dur/60)}m ${dur%60}s`)}`;
    }

    // ── Export ────────────────────────────────────────────────────────
    function exportReport() {
      if (!sessionLog.length) { alert('No data to export'); return; }
      const now=new Date(), dur=sessionStartTime?Math.floor((now-sessionStartTime)/1000):0;
      const rev=sessionLog.filter(e=>e.action==='qc_review');
      const pass=rev.filter(e=>e.decision==='Pass'||e.decision==='Approve').length;
      const fail=rev.filter(e=>e.decision==='Fail'||e.decision==='Re-open').length;
      const photo=rev.filter(e=>e.decision==='Missing Photo').length;
      const skip=sessionLog.filter(e=>e.action==='skip').length;
      const errs=sessionLog.filter(e=>!e.success).length;
      const gigs=rev.filter(e=>e.success).reduce((s,e)=>s+(e.gigPointsCreated||0),0);
      const rate=rev.length?Math.round((pass/rev.length)*100):0;
      const hr='='.repeat(80);
      let r=`${hr}\nREMOTE QC WORKFLOW — SESSION REPORT\nMode: ${mode==='new_qc'?'New Feature QC':'Clear GIG Review'}\n${hr}\n\n`;
      r+=`Start:    ${sessionStartTime?.toLocaleString()??'N/A'}\nEnd:      ${now.toLocaleString()}\nDuration: ${Math.floor(dur/60)}m ${dur%60}s\n\n`;
      r+=`SUMMARY\n${'-'.repeat(40)}\nTotal: ${rev.length}\nPassed/Approved: ${pass}\nFailed/Re-opened: ${fail}\n`;
      if(photo)r+=`Missing Photo: ${photo}\n`; if(skip)r+=`Skipped: ${skip}\n`; if(errs)r+=`Errors: ${errs}\n`;
      r+=`Pass Rate: ${rate}%\n`; if(gigs)r+=`GIG Points Created: ${gigs}\n`;
      r+=`\nDETAILED LOG\n${hr}\n\n`;
      sessionLog.forEach((e,i)=>{
        r+=`[${i+1}] ${e.timestamp.toLocaleTimeString()} | GIS: ${e.gisId} | ${e.layerName}\n    Action: ${e.action.toUpperCase()}`;
        if(e.action==='qc_review')r+=` | ${e.decision} | ${e.success?'OK':'ERROR'}`;
        r+='\n';
        if(e.gigPointsCreated)r+=`    GIG Points: ${e.gigPointsCreated}\n`;
        if(e.issueTypes?.length)r+=`    Issues: ${e.issueTypes.map(it=>it.name).join(', ')}\n`;
        if(e.notes)r+=`    Notes: ${e.notes}\n`;
        if(e.timeSpent!=null)r+=`    Time: ${Math.floor(e.timeSpent/60)}:${(e.timeSpent%60).toString().padStart(2,'0')}\n`;
        if(e.error)r+=`    Error: ${e.error}\n`; r+='\n';
      });
      r+=`${hr}\nEND OF REPORT\n${hr}\n`;
      const url=URL.createObjectURL(new Blob([r],{type:'text/plain'}));
      const a=Object.assign(document.createElement('a'),{href:url,download:`qc-report-${now.toISOString().split('T')[0]}.txt`});
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      setStatus('Report exported', 'ok');
    }

    // ── Reset ─────────────────────────────────────────────────────────
    function resetSession(clearForm = true) {
      currentIndex=0; qcQueue=[]; sessionLog=[]; sessionStartTime=null;
      stopTimer();
      if (highlightHandle) { highlightHandle.remove(); highlightHandle=null; }
      mapView.popup?.close();
      if (clearForm) {
        ['#woSearch','#poSearch','#dateFrom','#dateTo'].forEach(s => { $(s).value=''; delete $(s).dataset.code; });
        $('#sortOrder').value='desc'; $('#gigTypeFilter').value='';
        $('#queryResults').style.display='none'; $('#btnRefresh').disabled=true;
        setSpatialMode('none'); clearSketchGraphics();
        setDrawHint('', 'Select a tool above to start drawing');
      }
      setPhase('query'); updateFilterBadge(); setStatus('Ready', 'idle');
    }

    // ── Keyboard shortcuts ────────────────────────────────────────────
    function onKey(e) {
      if (currentPhase !== 'review') return;
      if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
      if (mode === 'new_qc') {
        if (e.key==='p'||e.key==='P') { $('#radPass').click();  $('#radPass').dispatchEvent(new Event('change')); }
        if (e.key==='f'||e.key==='F') { $('#radFail').click();  $('#radFail').dispatchEvent(new Event('change')); }
        if (e.key==='m'||e.key==='M') { $('#radPhoto').click(); $('#radPhoto').dispatchEvent(new Event('change')); }
      } else {
        if (e.key==='a'||e.key==='A') { $('#radApprove').click(); $('#radApprove').dispatchEvent(new Event('change')); }
        if (e.key==='r'||e.key==='R') { $('#radReopen').click();  $('#radReopen').dispatchEvent(new Event('change')); }
      }
      if (e.key==='Enter')      $('#btnSubmit').click();
      if (e.key==='ArrowRight') skipFeature();
      if (e.key==='ArrowLeft')  prevFeature();
    }
    document.addEventListener('keydown', onKey);

    // ── Wire events ───────────────────────────────────────────────────
    $('#btnQuery').onclick    = runQuery;
    $('#btnRefresh').onclick  = runQuery;
    $('#btnStart').onclick    = startReview;
    $('#btnZoom').onclick     = zoomToFeature;
    $('#btnSubmit').onclick   = () => mode === 'new_qc' ? submitNewQc() : submitClearReview();
    $('#btnSkip').onclick     = skipFeature;
    $('#btnPrev').onclick     = prevFeature;
    $('#btnExport').onclick   = exportReport;
    $('#btnStartOver').onclick = () => resetSession(true);
    $('#btnClearFilters').onclick = () => {
      ['#woSearch','#poSearch','#dateFrom','#dateTo'].forEach(s => { $(s).value=''; delete $(s).dataset.code; });
      $('#gigTypeFilter').value=''; $('#sortOrder').value='desc';
      setSpatialMode('none'); clearSketchGraphics();
      $('#queryResults').style.display='none'; updateFilterBadge();
    };
    $('#btnClose').onclick = () => window.gisToolHost.closeTool('remote-qc-workflow');

    // ── Cleanup & register ────────────────────────────────────────────
    function cleanup() {
      stopTimer();
      document.removeEventListener('keydown', onKey);
      if (highlightHandle) highlightHandle.remove();
      if (sketchVM)    { try { sketchVM.cancel(); sketchVM.destroy(); }   catch (_) {} }
      if (sketchLayer) { try { mapView.map.remove(sketchLayer); }         catch (_) {} }
      mapView.popup?.close();
      css.remove(); box.remove();
    }

    init();
    setPhase('query');
    window.gisToolHost.activeTools.set('remote-qc-workflow', { cleanup, toolBox: box });

  } catch (e) {
    alert('Error creating Remote QC Workflow Tool: ' + (e.message || e));
    console.error(e);
  }
})();
