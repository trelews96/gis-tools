// tools/parent-child-reconciliation.js  v4
// — Resizable panel, labor code map filter, searchable WO dropdown

(function () {
    try {
        if (!window.gisToolHost) window.gisToolHost = {};
        if (!(window.gisToolHost.activeTools instanceof Set))
            window.gisToolHost.activeTools = new Set();
        if (window.gisToolHost.activeTools.has('parent-child-reconciliation')) return;
        document.getElementById('parentChildReconciliationToolbox')?.remove();

        const utils = window.gisSharedUtils;
        if (!utils) throw new Error('Shared utilities not loaded');
        const mapView = utils.getMapView();

        // ── State ─────────────────────────────────────────────────────────────
        let exportData      = [];
        let allWorkOrders   = [];
        let selectedWO      = '';
        let pendingFilters  = null;
        let mapFilterActive = false;
        let woDropdownOpen  = false;
        let analysisCache   = null;   // { ugF, aerF, fF, codeToGuids }
        let activeCodeFilter = null;

        // ── Styles ────────────────────────────────────────────────────────────
        const STYLE_ID = 'pcr-tool-styles';
        if (!document.getElementById(STYLE_ID)) {
            const s = document.createElement('style');
            s.id = STYLE_ID;
            s.textContent = `
            #parentChildReconciliationToolbox { font-family:'Segoe UI',Arial,sans-serif; font-size:12px; color:#0f172a; }
            #parentChildReconciliationToolbox * { box-sizing:border-box; }

            .pcr-header {
                background:linear-gradient(135deg,#1e293b 0%,#334155 100%);
                color:#f1f5f9; padding:10px 12px; border-radius:6px 6px 0 0;
                cursor:grab; display:flex; align-items:center; justify-content:space-between; gap:8px;
                flex-shrink:0; user-select:none;
            }
            .pcr-header:active { cursor:grabbing; }
            .pcr-header-title  { display:flex; align-items:center; gap:7px; font-weight:600; font-size:12px; letter-spacing:.3px; }
            .pcr-header-icon   { width:20px; height:20px; background:#6366f1; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:11px; flex-shrink:0; }
            .pcr-header-actions{ display:flex; gap:4px; }
            .pcr-icon-btn      { background:rgba(255,255,255,.12); border:none; color:#cbd5e1; width:22px; height:22px; border-radius:4px; cursor:pointer; font-size:12px; display:flex; align-items:center; justify-content:center; transition:background .15s; flex-shrink:0; }
            .pcr-icon-btn:hover{ background:rgba(255,255,255,.28); color:#fff; }
            .pcr-icon-btn.pcr-close:hover { background:#ef4444; color:#fff; }

            .pcr-body          { padding:12px; overflow-y:auto; flex:1; min-height:0; }
            .pcr-body::-webkit-scrollbar       { width:4px; }
            .pcr-body::-webkit-scrollbar-thumb { background:#cbd5e1; border-radius:2px; }
            .pcr-label         { font-size:10px; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:.6px; margin-bottom:4px; }

            /* WO search */
            .pcr-wo-wrap       { position:relative; margin-bottom:10px; }
            .pcr-wo-input-row  { display:flex; align-items:center; border:1.5px solid #cbd5e1; border-radius:5px; background:#fff; transition:border-color .15s; overflow:hidden; }
            .pcr-wo-input-row:focus-within { border-color:#6366f1; box-shadow:0 0 0 3px rgba(99,102,241,.12); }
            .pcr-wo-icon       { padding:0 8px; color:#94a3b8; font-size:11px; flex-shrink:0; }
            #woSearch          { flex:1; border:none; outline:none; padding:7px 0; font-size:11px; color:#0f172a; background:transparent; min-width:0; }
            #woSearch::placeholder { color:#94a3b8; }
            #woClear           { padding:0 9px; color:#94a3b8; cursor:pointer; font-size:15px; line-height:1; flex-shrink:0; }
            #woClear:hover     { color:#ef4444; }
            .pcr-wo-dropdown   { position:fixed; background:#fff; border:1.5px solid #6366f1; border-radius:5px; max-height:170px; overflow-y:auto; z-index:100002; box-shadow:0 6px 16px rgba(0,0,0,.14); }
            .pcr-wo-dropdown::-webkit-scrollbar       { width:4px; }
            .pcr-wo-dropdown::-webkit-scrollbar-thumb { background:#c7d2fe; border-radius:2px; }
            .pcr-wo-opt        { padding:6px 10px; cursor:pointer; font-size:11px; color:#1e293b; border-bottom:1px solid #f1f5f9; }
            .pcr-wo-opt:last-child { border-bottom:none; }
            .pcr-wo-opt:hover  { background:#eef2ff; color:#4f46e5; }
            .pcr-wo-opt.sel    { background:#eef2ff; font-weight:700; color:#4f46e5; }
            .pcr-wo-empty      { padding:8px 10px; font-size:11px; color:#94a3b8; }

            /* Labor filter panel */
            .pcr-filter-panel  { border:1.5px solid #e2e8f0; border-radius:5px; margin-bottom:10px; overflow:hidden; }
            .pcr-filter-hdr    { padding:6px 10px; background:#f8fafc; cursor:pointer; display:flex; align-items:center; justify-content:space-between; font-size:10px; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:.5px; border-bottom:1.5px solid transparent; transition:background .15s; }
            .pcr-filter-hdr:hover { background:#f1f5f9; }
            .pcr-filter-hdr.open  { border-bottom-color:#e2e8f0; }
            .pcr-filter-hdr-left  { display:flex; align-items:center; gap:6px; }
            .pcr-filter-body      { padding:8px; background:#fff; }
            .pcr-filter-hint      { font-size:9px; color:#94a3b8; margin-bottom:6px; line-height:1.5; }
            .pcr-filter-actions   { display:flex; align-items:center; gap:5px; margin-bottom:6px; }
            .pcr-sel-count        { font-size:9px; color:#94a3b8; margin-left:auto; }
            .pcr-mini-btn         { padding:2px 8px; font-size:9px; font-weight:700; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:3px; cursor:pointer; color:#475569; }
            .pcr-mini-btn:hover   { background:#e2e8f0; }
            .pcr-code-list        { max-height:130px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:4px; background:#fafafa; }
            .pcr-code-list::-webkit-scrollbar       { width:4px; }
            .pcr-code-list::-webkit-scrollbar-thumb { background:#cbd5e1; border-radius:2px; }
            .pcr-code-row         { display:flex; align-items:center; padding:3px 7px; gap:5px; border-bottom:1px solid #f1f5f9; }
            .pcr-code-row:last-child  { border-bottom:none; }
            .pcr-code-row:hover       { background:#f8fafc; }
            .pcr-code-row input[type=checkbox] { margin:0; cursor:pointer; accent-color:#6366f1; }
            .pcr-code-lbl         { flex:1; font-size:10px; font-weight:600; color:#1e293b; cursor:pointer; }
            .pcr-code-badge       { font-size:8px; background:#eef2ff; color:#6366f1; padding:1px 5px; border-radius:10px; white-space:nowrap; font-weight:700; }
            .pcr-code-max         { font-size:8px; color:#94a3b8; white-space:nowrap; }

            /* Buttons */
            .pcr-actions { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:10px; }
            .pcr-btn     { padding:5px 12px; font-size:10px; font-weight:700; border:none; border-radius:5px; cursor:pointer; display:inline-flex; align-items:center; gap:4px; transition:filter .15s,transform .1s; letter-spacing:.2px; }
            .pcr-btn:active   { transform:scale(.97); }
            .pcr-btn:hover    { filter:brightness(1.1); }
            .pcr-btn:disabled { opacity:.5; cursor:not-allowed; filter:none; transform:none; }
            .pcr-btn-primary  { background:#6366f1; color:#fff; }
            .pcr-btn-ghost    { background:#f1f5f9; color:#475569; border:1px solid #e2e8f0; }
            .pcr-btn-success  { background:#059669; color:#fff; }
            .pcr-btn-map      { background:#0ea5e9; color:#fff; }
            .pcr-btn-map.active { background:#dc2626; }

            /* Status bar */
            .pcr-status       { display:flex; align-items:center; gap:7px; padding:5px 9px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:5px; margin-bottom:10px; min-height:28px; }
            .pcr-dot          { width:7px; height:7px; border-radius:50%; background:#94a3b8; flex-shrink:0; }
            .pcr-dot.ready    { background:#059669; }
            .pcr-dot.running  { background:#f59e0b; animation:pcr-pulse 1s infinite; }
            .pcr-dot.error    { background:#dc2626; }
            .pcr-dot.warn     { background:#f59e0b; }
            .pcr-status-text  { font-size:10px; color:#475569; flex:1; }
            .pcr-status-time  { font-size:9px; color:#94a3b8; font-variant-numeric:tabular-nums; }
            @keyframes pcr-pulse { 0%,100%{opacity:1} 50%{opacity:.25} }

            /* Results */
            .pcr-sec-title    { font-size:10px; font-weight:700; color:#1e293b; text-transform:uppercase; letter-spacing:.5px; margin:10px 0 5px; display:flex; align-items:center; gap:6px; }
            .pcr-pill         { font-size:9px; padding:1px 7px; border-radius:10px; font-weight:700; }
            .pcr-pill-bad     { background:#fee2e2; color:#dc2626; }
            .pcr-pill-ok      { background:#d1fae5; color:#059669; }
            .pcr-tbl-wrap     { overflow-x:auto; margin-bottom:8px; }
            .pcr-tbl          { width:100%; border-collapse:collapse; font-size:10px; }
            .pcr-tbl th       { background:#1e293b; color:#e2e8f0; padding:4px 6px; text-align:left; font-size:9px; font-weight:600; letter-spacing:.3px; white-space:nowrap; }
            .pcr-tbl th:first-child { border-radius:4px 0 0 0; }
            .pcr-tbl th:last-child  { border-radius:0 4px 0 0; }
            .pcr-tbl td       { padding:5px 6px; border-bottom:1px solid #f1f5f9; white-space:nowrap; font-size:11px; }
            .pcr-tbl tr:nth-child(even) td { background:#f8fafc; }
            .pcr-tbl tr:hover td { background:#eef2ff; }
            .pcr-diff         { font-weight:700; color:#dc2626; }
            .pcr-diff.low     { color:#d97706; }
            .pcr-chip         { font-size:11px; background:#f1f5f9; border-radius:3px; padding:1px 4px; color:#475569; font-family:monospace; }
            .pcr-zbtn         { padding:3px 8px; font-size:10px; font-weight:700; border:none; border-radius:3px; cursor:pointer; color:#fff; white-space:nowrap; }
            .pcr-zbtn:hover   { opacity:.82; }

            /* Labor code map filter button (per summary row) */
            .pcr-lcf-btn      { padding:3px 8px; font-size:10px; font-weight:700; border:1px solid #cbd5e1; border-radius:3px; cursor:pointer; background:#f1f5f9; color:#475569; white-space:nowrap; transition:background .12s,color .12s; }
            .pcr-lcf-btn:hover   { background:#e0e7ff; color:#4f46e5; border-color:#a5b4fc; }
            .pcr-lcf-btn.active  { background:#6366f1; color:#fff; border-color:#6366f1; }

            .pcr-ok-msg       { display:flex; align-items:center; gap:6px; padding:7px 10px; background:#d1fae5; border:1px solid #6ee7b7; border-radius:4px; font-size:10px; color:#065f46; font-weight:500; margin-bottom:8px; }
            .pcr-divider      { height:1px; background:#e2e8f0; margin:8px 0; }

            /* Resize handles */
            .pcr-resize-se {
                position:absolute; bottom:0; right:0;
                width:16px; height:16px; cursor:nwse-resize; z-index:2;
                background:linear-gradient(135deg, transparent 40%, #94a3b8 40%, #94a3b8 55%, transparent 55%, transparent 70%, #94a3b8 70%, #94a3b8 85%, transparent 85%);
                border-radius:0 0 8px 0; opacity:.5;
            }
            .pcr-resize-se:hover { opacity:1; }
            .pcr-resize-w {
                position:absolute; left:0; top:8px; bottom:8px;
                width:5px; cursor:ew-resize; z-index:2;
                border-radius:8px 0 0 8px;
                background:transparent; transition:background .15s;
            }
            .pcr-resize-w:hover, .pcr-resize-w.active { background:#6366f1; opacity:.5; }
            `;
            document.head.appendChild(s);
        }

        // ── Toolbox shell ─────────────────────────────────────────────────────
        const toolBox = document.createElement('div');
        toolBox.id = 'parentChildReconciliationToolbox';
        toolBox.style.cssText = `
            position:fixed; top:20px; right:20px; z-index:99999;
            width:460px; height:560px;
            background:#fff; border-radius:8px;
            box-shadow:0 8px 32px rgba(0,0,0,.18),0 2px 8px rgba(0,0,0,.1);
            display:flex; flex-direction:column; overflow:hidden;
        `;
        toolBox.innerHTML = `
            <div class="pcr-header" id="pcrHeader">
                <div class="pcr-header-title">
                    <div class="pcr-header-icon">⚡</div>
                    Daily Tracking Analysis
                </div>
                <div class="pcr-header-actions">
                    <button class="pcr-icon-btn" id="pcrMinBtn" title="Minimize">−</button>
                    <button class="pcr-icon-btn pcr-close" id="pcrCloseBtn" title="Close (Esc)">✕</button>
                </div>
            </div>

            <div class="pcr-body" id="pcrBody">
                <div class="pcr-label">Work Order</div>
                <div class="pcr-wo-wrap" id="woWrapper">
                    <div class="pcr-wo-input-row">
                        <span class="pcr-wo-icon">🔍</span>
                        <input type="text" id="woSearch" placeholder="Search work orders…">
                        <span id="woClear" style="display:none;">✕</span>
                    </div>
                    <div class="pcr-wo-dropdown" id="woDropdown" style="display:none;"></div>
                </div>

                <div class="pcr-filter-panel" id="laborFilterSection" style="display:none;">
                    <div class="pcr-filter-hdr" id="laborFilterToggle">
                        <div class="pcr-filter-hdr-left"><span>⚙</span><span>Labor Code Filter</span></div>
                        <span id="laborArrow">▼</span>
                    </div>
                    <div id="laborFilterBody" style="display:none;">
                        <div class="pcr-filter-body">
                            <div class="pcr-filter-hint">Checked codes are included in analysis. <strong>Max-quantity record wins</strong> when a feature has multiple matching codes.</div>
                            <div class="pcr-filter-actions">
                                <button class="pcr-mini-btn" id="selectAllCodes">All</button>
                                <button class="pcr-mini-btn" id="selectNoneCodes">None</button>
                                <span class="pcr-sel-count" id="codeSummary"></span>
                            </div>
                            <div class="pcr-code-list" id="laborCodeList"></div>
                        </div>
                    </div>
                </div>

                <div class="pcr-actions">
                    <button class="pcr-btn pcr-btn-primary" id="runBtn">▶ Run Analysis</button>
                    <button class="pcr-btn pcr-btn-ghost"   id="resetBtn">↺ Reset</button>
                    <button class="pcr-btn pcr-btn-success" id="exportBtn"    style="display:none;">↓ Export CSV</button>
                    <button class="pcr-btn pcr-btn-map"     id="mapFilterBtn" style="display:none;">🗺 Apply Map Filter</button>
                </div>

                <div class="pcr-status">
                    <div class="pcr-dot" id="pcrDot"></div>
                    <div class="pcr-status-text" id="pcrStatusText">Initializing…</div>
                    <div class="pcr-status-time" id="pcrStatusTime"></div>
                </div>

                <div id="results"></div>
            </div>

            <div class="pcr-resize-w"  id="pcrResizeW"></div>
            <div class="pcr-resize-se" id="pcrResizeHandle"></div>
        `;
        document.body.appendChild(toolBox);

        const $  = (sel) => toolBox.querySelector(sel);
        const $r = () => $('#results');

        // ── Status ────────────────────────────────────────────────────────────
        function setStatus(text, state = 'idle') {
            $('#pcrStatusText').textContent = text;
            $('#pcrDot').className = 'pcr-dot ' + state;
            if (state !== 'running') {
                const t = new Date();
                $('#pcrStatusTime').textContent =
                    [t.getHours(), t.getMinutes(), t.getSeconds()].map(n => String(n).padStart(2,'0')).join(':');
            } else {
                $('#pcrStatusTime').textContent = '';
            }
        }

        // ── Drag ──────────────────────────────────────────────────────────────
        let dragging = false, dOX = 0, dOY = 0;
        $('#pcrHeader').addEventListener('mousedown', e => {
            if (e.target.closest('button')) return;
            dragging = true;
            const r = toolBox.getBoundingClientRect();
            dOX = e.clientX - r.left;
            dOY = e.clientY - r.top;
            toolBox.style.transition = 'none';
            toolBox.style.right = 'auto';
            e.preventDefault();
        });

        // ── Resize ────────────────────────────────────────────────────────────
        const MIN_W = 360, MIN_H = 220;
        let resizing = false, resizeDir = '', rSX = 0, rSY = 0, rSW = 0, rSH = 0, rRight = 0;

        function startResize(e, dir) {
            resizing = true; resizeDir = dir;
            rSX = e.clientX; rSY = e.clientY;
            const rect = toolBox.getBoundingClientRect();
            rSW = rect.width; rSH = rect.height;
            // Anchor both edges explicitly before clearing right
            toolBox.style.left  = rect.left + 'px';
            toolBox.style.top   = rect.top  + 'px';
            toolBox.style.right = 'auto';
            rRight = rect.right; // fixed right edge for west resize
            e.preventDefault(); e.stopPropagation();
        }

        $('#pcrResizeHandle').addEventListener('mousedown', e => startResize(e, 'se'));
        $('#pcrResizeW').addEventListener('mousedown',      e => startResize(e, 'w'));

        document.addEventListener('mousemove', e => {
            if (dragging) {
                toolBox.style.left = Math.max(0, Math.min(window.innerWidth  - toolBox.offsetWidth,  e.clientX - dOX)) + 'px';
                toolBox.style.top  = Math.max(0, Math.min(window.innerHeight - toolBox.offsetHeight, e.clientY - dOY)) + 'px';
                if (woDropdownOpen) positionDropdown();
            }
            if (resizing) {
                if (resizeDir === 'se') {
                    const w = Math.max(MIN_W, Math.min(window.innerWidth  * 0.98, rSW + (e.clientX - rSX)));
                    const h = Math.max(MIN_H, Math.min(window.innerHeight * 0.96, rSH + (e.clientY - rSY)));
                    toolBox.style.width  = w + 'px';
                    toolBox.style.height = h + 'px';
                    toolBox.style.maxHeight = 'none';
                } else if (resizeDir === 'w') {
                    const newLeft = Math.max(0, Math.min(rRight - MIN_W, e.clientX));
                    const newW    = Math.max(MIN_W, rRight - newLeft);
                    toolBox.style.left  = newLeft + 'px';
                    toolBox.style.width = newW    + 'px';
                    toolBox.style.maxHeight = 'none';
                }
            }
        });
        document.addEventListener('mouseup', () => {
            dragging = resizing = false;
            resizeDir = '';
            $('#pcrResizeW').classList.remove('active');
        });

        // ── Minimize ──────────────────────────────────────────────────────────
        let minimized = false;
        $('#pcrMinBtn').addEventListener('click', () => {
            minimized = !minimized;
            $('#pcrBody').style.display  = minimized ? 'none' : '';
            $('#pcrMinBtn').textContent  = minimized ? '+' : '−';
            toolBox.style.height         = minimized ? 'auto' : (toolBox.offsetHeight || 560) + 'px';
        });

        // ── ESC to close ──────────────────────────────────────────────────────
        function onKey(e) { if (e.key === 'Escape') closeTool(); }
        document.addEventListener('keydown', onKey);

        // ── WO dropdown ───────────────────────────────────────────────────────
        function renderDropdown(filter) {
            const q = (filter || '').toLowerCase();
            const matches = q ? allWorkOrders.filter(v => v.toLowerCase().includes(q)) : allWorkOrders;
            $('#woDropdown').innerHTML = matches.length
                ? matches.map(v => `<div class="pcr-wo-opt${v === selectedWO ? ' sel' : ''}" data-v="${v}">${v}</div>`).join('')
                : '<div class="pcr-wo-empty">No work orders found</div>';
        }
        function positionDropdown() {
            const r = $('#woWrapper').getBoundingClientRect(), dd = $('#woDropdown');
            dd.style.top = (r.bottom + 3) + 'px';
            dd.style.left = r.left + 'px';
            dd.style.width = r.width + 'px';
        }
        function openDropdown()  { renderDropdown($('#woSearch').value); positionDropdown(); $('#woDropdown').style.display = 'block'; woDropdownOpen = true; }
        function closeDropdown() { $('#woDropdown').style.display = 'none'; woDropdownOpen = false; }
        function selectWO(v) {
            selectedWO = v;
            $('#woSearch').value = v;
            $('#woClear').style.display = v ? 'inline' : 'none';
            closeDropdown();
            if (v) {
                // Expand height only, preserve current width and position
                const rect = toolBox.getBoundingClientRect();
                toolBox.style.top      = '20px';
                toolBox.style.left     = rect.left + 'px';
                toolBox.style.right    = 'auto';
                toolBox.style.height   = (window.innerHeight - 40) + 'px';
                toolBox.style.maxHeight = 'none';
            }
            loadLaborCodes(v);
        }
        $('#woSearch').addEventListener('focus', openDropdown);
        $('#woSearch').addEventListener('input', () => { renderDropdown($('#woSearch').value); if (!woDropdownOpen) openDropdown(); });
        $('#woDropdown').addEventListener('mousedown', e => { const o = e.target.closest('.pcr-wo-opt'); if (o) selectWO(o.dataset.v); });
        $('#woClear').addEventListener('click', () => { selectWO(''); $('#laborFilterSection').style.display = 'none'; $('#woSearch').focus(); });
        document.addEventListener('mousedown', e => { if (woDropdownOpen && !$('#woWrapper').contains(e.target)) closeDropdown(); });

        // ── Labor filter panel ────────────────────────────────────────────────
        let laborOpen = false;
        $('#laborFilterToggle').addEventListener('click', () => {
            laborOpen = !laborOpen;
            $('#laborFilterBody').style.display = laborOpen ? 'block' : 'none';
            $('#laborArrow').textContent = laborOpen ? '▲' : '▼';
            $('#laborFilterToggle').classList.toggle('open', laborOpen);
        });
        function refreshCodeSummary() {
            const all = toolBox.querySelectorAll('.lcCheck'), chk = toolBox.querySelectorAll('.lcCheck:checked');
            $('#codeSummary').textContent = chk.length + ' / ' + all.length + ' included';
        }
        $('#selectAllCodes').addEventListener('click',  () => { toolBox.querySelectorAll('.lcCheck').forEach(c => c.checked = true);  refreshCodeSummary(); });
        $('#selectNoneCodes').addEventListener('click', () => { toolBox.querySelectorAll('.lcCheck').forEach(c => c.checked = false); refreshCodeSummary(); });
        function getCheckedCodes() {
            const boxes = toolBox.querySelectorAll('.lcCheck');
            if (!boxes.length) return null;
            const s = new Set();
            boxes.forEach(b => { if (b.checked) s.add(b.value); });
            return s;
        }

        // ── Shared helpers ────────────────────────────────────────────────────
        function findField(table, name) {
            return (table.fields || []).find(f => f?.name?.toLowerCase() === name.toLowerCase()) || null;
        }
        function findTrackingTable() {
            return mapView.map.allTables?.find(t => t.layerId === 90100) ||
                   mapView.map.allLayers?.find(i => i.type === 'table' && i.layerId === 90100) || null;
        }
        function getLayer(id) {
            return mapView.map.allLayers.find(l => l.type === 'feature' && l.layerId === id) || null;
        }

        // ── Map filter (mismatch) ─────────────────────────────────────────────
        function clearAllMapFilters() {
            mapView.map.allLayers.filter(l => l.type === 'feature').forEach(l => {
                l.definitionExpression = null; l.labelingInfo = null; l.labelsVisible = false;
            });
            mapFilterActive  = false;
            activeCodeFilter = null;
            $('#mapFilterBtn').textContent = '🗺 Apply Map Filter';
            $('#mapFilterBtn').classList.remove('active');
            toolBox.querySelectorAll('.pcr-lcf-btn').forEach(b => b.classList.remove('active'));
        }
        function makeLabel(guidToQty, prefix, color, xo, yo) {
            const parts = [];
            for (const g in guidToQty) parts.push(`"${g}"`, `"${prefix}: ${guidToQty[g]}"`);
            return [{
                labelExpressionInfo: { expression: `var id=$feature.globalid; Decode(id,${parts.join(',')},"${prefix}: N/A")` },
                symbol: { type:'text', color, haloSize:3, haloColor:'white', font:{size:16,family:'Arial',weight:'bold'}, xoffset:xo, yoffset:yo },
                deconflictionStrategy:'none', repeatLabel:false, removeDuplicates:'none'
            }];
        }
        function applyMismatchFilter() {
            if (!pendingFilters) return;
            const { ugLayer, aerLayer, fiberLayer, ugOids, aerOids, fiberOids, guidToQty } = pendingFilters;
            if (ugOids.length    && ugLayer)    { ugLayer.definitionExpression    = 'objectid IN (' + ugOids.join(',')    + ')'; ugLayer.labelingInfo    = makeLabel(guidToQty,'UG','red',-40,-30);    ugLayer.labelsVisible    = true; }
            if (aerOids.length   && aerLayer)   { aerLayer.definitionExpression   = 'objectid IN (' + aerOids.join(',')   + ')'; aerLayer.labelingInfo   = makeLabel(guidToQty,'Aerial','red',-40,-30); aerLayer.labelsVisible   = true; }
            if (fiberOids.length && fiberLayer) { fiberLayer.definitionExpression = 'objectid IN (' + fiberOids.join(',') + ')'; fiberLayer.labelingInfo = makeLabel(guidToQty,'Fiber','orange',0,20); fiberLayer.labelsVisible = true; }
            mapFilterActive = true;
            activeCodeFilter = null;
            $('#mapFilterBtn').textContent = '✕ Clear Map Filter';
            $('#mapFilterBtn').classList.add('active');
            toolBox.querySelectorAll('.pcr-lcf-btn').forEach(b => b.classList.remove('active'));
        }
        $('#mapFilterBtn').addEventListener('click', () => { mapFilterActive ? clearAllMapFilters() : applyMismatchFilter(); });

        // ── Labor code map filter (per row) ───────────────────────────────────
        window.pcrFilterByLaborCode = function (code, btn) {
            if (!analysisCache) return;
            const { codeToGuids } = analysisCache;
            const guids = codeToGuids[code];
            if (!guids || !guids.size) { setStatus('No features found for code: ' + code, 'warn'); return; }

            // Toggle off if same code clicked again
            if (activeCodeFilter === code) {
                clearAllMapFilters();
                setStatus('Labor code filter cleared', 'ready');
                return;
            }

            clearAllMapFilters();
            activeCodeFilter = code;

            const gList = "'" + [...guids].join("','") + "'";
            const ugLayer = getLayer(42050), aerLayer = getLayer(43050), fiberLayer = getLayer(41050);
            let layersFiltered = 0;

            if (ugLayer)    { ugLayer.definitionExpression    = 'globalid IN (' + gList + ')'; layersFiltered++; }
            if (aerLayer)   { aerLayer.definitionExpression   = 'globalid IN (' + gList + ')'; layersFiltered++; }
            if (fiberLayer) { fiberLayer.definitionExpression = 'globalid IN (' + gList + ')'; layersFiltered++; }

            // Mark button active
            toolBox.querySelectorAll('.pcr-lcf-btn').forEach(b => b.classList.remove('active'));
            if (btn) btn.classList.add('active');

            // Zoom to matching features across all layers
            const feats = [...(analysisCache.ugF || []), ...(analysisCache.aerF || []), ...(analysisCache.fF || [])]
                .filter(f => guids.has(f.attributes?.globalid) && f.geometry);
            if (feats.length) mapView.goTo(feats.map(f => f.geometry)).catch(() => {});

            setStatus('Map filtered by labor code: ' + code + ' (' + guids.size + ' features)', 'ready');
        };

        // ── Zoom helpers ──────────────────────────────────────────────────────
        window.zoomToFeature = function (type, oid) {
            const layer = getLayer({ underground:42050, aerial:43050, fiber:41050 }[type]);
            if (!layer) { alert('Layer not found'); return; }
            setStatus('Zooming to ' + type + ' feature…', 'running');
            layer.queryFeatures({ where:'objectid = ' + oid, outFields:['objectid'], returnGeometry:true })
                .then(r => r.features[0]?.geometry && mapView.goTo({ target:r.features[0].geometry, scale:2000 }))
                .then(() => setStatus('Zoomed to ' + type + ' (OID: ' + oid + ')', 'ready'))
                .catch(e => setStatus('Zoom error: ' + e.message, 'error'));
        };

        // ── Spatial coincidence ───────────────────────────────────────────────
        function coincident(spans, fibers, tol = 2) {
            const pairs = [];
            for (const s of spans) {
                const sc = s?.geometry?.extent?.center; if (!sc) continue;
                for (const f of fibers) {
                    const fc = f?.geometry?.extent?.center; if (!fc) continue;
                    if (Math.hypot(sc.x - fc.x, sc.y - fc.y) <= tol) pairs.push({ span:s, fiber:f });
                }
            }
            return pairs;
        }

        // ── Reset ─────────────────────────────────────────────────────────────
        function resetAll() {
            clearAllMapFilters();
            pendingFilters  = null;
            analysisCache   = null;
            exportData      = [];
            $r().innerHTML  = '';
            $('#exportBtn').style.display = $('#mapFilterBtn').style.display = 'none';
            setStatus('Reset complete', 'ready');
        }

        // ── CSV ───────────────────────────────────────────────────────────────
        function makeURL(type, oid, geom) {
            try {
                const p = new URLSearchParams(window.location.search);
                let c = mapView.center, sc = mapView.scale;
                if (geom?.extent?.center) { c = geom.extent.center; sc = 2000; }
                p.set('center', c.longitude.toFixed(6) + ',' + c.latitude.toFixed(6));
                p.set('level', Math.round(Math.log2(591657527.591555 / sc)).toString());
                const lm = { underground:42050, aerial:43050, fiber:41050 };
                if (lm[type]) p.set('highlight', lm[type] + ':' + oid);
                return window.location.origin + window.location.pathname + '?' + p.toString();
            } catch { return window.location.href; }
        }
        function csvEsc(v) {
            if (v == null) return '';
            v = String(v);
            return /[,"\n]/.test(v) ? '"' + v.replace(/"/g,'""') + '"' : v;
        }
        function exportToCSV() {
            if (!exportData.length) { alert('No data to export. Run analysis first.'); return; }
            let out = 'data:text/csv;charset=utf-8,';
            out += 'Type,Span ID,Fiber ID,Span Code,Fiber Code,Span Qty,Fiber Qty,Diff,Span URL,Fiber URL\n';
            for (const r of exportData) {
                const st = r.type.includes('Underground') ? 'underground' : 'aerial';
                out += [csvEsc(r.type),csvEsc(r.spanId),csvEsc(r.fiberId),csvEsc(r.spanLaborCode),csvEsc(r.fiberLaborCode),
                        r.spanQty,r.fiberQty,r.difference,
                        csvEsc(makeURL(st,r.spanOid,r.spanGeometry)), csvEsc(makeURL('fiber',r.fiberOid,r.fiberGeometry))].join(',') + '\n';
            }
            const a = document.createElement('a');
            a.href = encodeURI(out);
            a.download = 'qty_mismatches_' + selectedWO + '_' + new Date().toISOString().slice(0,10) + '.csv';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
        }

        // ── Load work orders ──────────────────────────────────────────────────
        function loadWorkOrders() {
            setStatus('Loading work orders…', 'running');
            const fl = getLayer(41050);
            if (!fl) { setStatus('Fiber layer (41050) not found', 'error'); return; }
            fl.load()
                .then(() => fl.queryFeatures({ where:"workorder_id IS NOT NULL AND workorder_id <> ''", outFields:['workorder_id'], returnGeometry:false, returnDistinctValues:true }))
                .then(r => {
                    const seen = {};
                    allWorkOrders = [];
                    for (const f of r.features) {
                        const v = String(f.attributes.workorder_id || '').trim();
                        if (v && !seen[v]) { allWorkOrders.push(v); seen[v] = true; }
                    }
                    allWorkOrders.sort();
                    $('#woSearch').placeholder = 'Search ' + allWorkOrders.length + ' work orders…';
                    setStatus('Ready — ' + allWorkOrders.length + ' work orders loaded', 'ready');
                })
                .catch(e => setStatus('Error loading work orders: ' + (e.message || e), 'error'));
        }

        // ── Load labor codes ──────────────────────────────────────────────────
        async function loadLaborCodes(woId) {
            $('#laborFilterSection').style.display = 'none';
            if (!woId) return;
            const table = findTrackingTable();
            if (!table) return;
            setStatus('Loading labor codes for ' + woId + '…', 'running');
            try {
                await table.load();
                const lcField = findField(table, 'labor_code');
                if (!lcField) throw new Error('Field "labor_code" not found in tracking table');
                let woField = null;
                for (const f of (table.fields || [])) if (f?.name?.toLowerCase().includes('workorder')) { woField = f; break; }
                if (!woField) throw new Error('No workorder field in tracking table');
                const r = await table.queryFeatures({ where: woField.name + " = '" + woId + "'", outFields:[lcField.name,'quantity'], returnGeometry:false });
                const stats = {};
                for (const f of r.features) {
                    const code = f.attributes[lcField.name] || 'Unknown', qty = f.attributes.quantity || 0;
                    if (!stats[code]) stats[code] = { count:0, totalQty:0, maxQty:0 };
                    stats[code].count++; stats[code].totalQty += qty;
                    if (qty > stats[code].maxQty) stats[code].maxQty = qty;
                }
                const list = $('#laborCodeList');
                list.innerHTML = '';
                for (const code of Object.keys(stats).sort()) {
                    const s = stats[code], uid = 'lc_' + code.replace(/\W/g,'_');
                    const row = document.createElement('div');
                    row.className = 'pcr-code-row';
                    row.innerHTML = `
                        <input type="checkbox" class="lcCheck" id="${uid}" value="${code}" checked>
                        <label class="pcr-code-lbl" for="${uid}">${code}</label>
                        <span class="pcr-code-badge">${s.count} rec${s.count !== 1 ? 's' : ''}</span>
                        <span class="pcr-code-max">max ${s.maxQty}</span>`;
                    row.querySelector('.lcCheck').addEventListener('change', refreshCodeSummary);
                    list.appendChild(row);
                }
                refreshCodeSummary();
                $('#laborFilterSection').style.display = 'block';
                setStatus('Ready — ' + Object.keys(stats).length + ' labor codes found', 'ready');
            } catch (e) { setStatus('Error: ' + (e.message || e), 'error'); }
        }

        // ── Main analysis ─────────────────────────────────────────────────────
        async function runAnalysis() {
            if (!selectedWO) { alert('Please select a work order'); return; }
            const checkedCodes = getCheckedCodes();
            if (checkedCodes?.size === 0) { alert('No labor codes selected.'); return; }

            setStatus('Running analysis for ' + selectedWO + '…', 'running');
            $r().innerHTML = '';
            exportData = []; pendingFilters = null; analysisCache = null;
            mapFilterActive = false; activeCodeFilter = null;
            $('#exportBtn').style.display = $('#mapFilterBtn').style.display = 'none';
            clearAllMapFilters();

            const table = findTrackingTable();
            if (!table) { setStatus('Tracking table (layerId 90100) not found', 'error'); return; }

            try {
                await table.load();
                const lcField = findField(table, 'labor_code');
                if (!lcField) throw new Error('Field "labor_code" not found in tracking table');
                let woField = null;
                for (const f of (table.fields || [])) if (f?.name?.toLowerCase().includes('workorder')) { woField = f; break; }
                if (!woField) throw new Error('No workorder field in tracking table');

                const tr = await table.queryFeatures({ where: woField.name + " = '" + selectedWO + "'", outFields:['*'] });
                if (!tr.features.length) throw new Error('No records found for ' + selectedWO);

                // ── GUID maps: max-qty wins + code filter ──────────────────
                const laborSummary = {}, guidToQty = {}, guidToCode = {}, codeToGuids = {};
                for (const feat of tr.features) {
                    const a = feat.attributes;
                    const code = a[lcField.name] || 'Unknown';
                    const qty  = a.quantity || 0;
                    laborSummary[code] = (laborSummary[code] || 0) + qty;

                    // Build codeToGuids regardless of filter (used for map filter buttons)
                    if (!codeToGuids[code]) codeToGuids[code] = new Set();

                    if (checkedCodes && !checkedCodes.has(code)) continue;
                    for (const field in a) {
                        if (field.includes('_guid') && a[field]) {
                            const g = a[field];
                            codeToGuids[code].add(g);
                            if (guidToQty[g] === undefined || qty > guidToQty[g]) { guidToQty[g] = qty; guidToCode[g] = code; }
                        }
                    }
                }

                // ── Labor summary table ────────────────────────────────────
                let html =
                    '<div class="pcr-sec-title">Labor Code Summary</div>' +
                    '<div class="pcr-tbl-wrap"><table class="pcr-tbl">' +
                    '<thead><tr><th>Labor Code</th><th>Total Qty</th><th>In Analysis</th><th>Map Filter</th></tr></thead><tbody>';
                for (const code of Object.keys(laborSummary).sort()) {
                    const inc = !checkedCodes || checkedCodes.has(code);
                    const hasGuids = codeToGuids[code]?.size > 0;
                    html +=
                        `<tr style="${inc ? '' : 'opacity:.4;'}">` +
                        `<td><span class="pcr-chip">${code}</span></td>` +
                        `<td>${laborSummary[code]}</td>` +
                        `<td style="text-align:center;">${inc ? '✓' : '—'}</td>` +
                        `<td>${hasGuids
                            ? `<button class="pcr-lcf-btn" onclick="pcrFilterByLaborCode('${code}',this)">⊕ Filter</button>`
                            : '<span style="font-size:8px;color:#cbd5e1;">n/a</span>'}</td>` +
                        `</tr>`;
                }
                html += '</tbody></table></div>';
                $r().innerHTML = html;

                // ── Layer queries ──────────────────────────────────────────
                const ugLayer = getLayer(42050), aerLayer = getLayer(43050), fiberLayer = getLayer(41050);
                if (!fiberLayer) throw new Error('Fiber Cable layer (41050) required');

                const guids = Object.keys(guidToQty);
                if (!guids.length) { setStatus('No related features for selected labor codes', 'warn'); return; }

                const gList = "'" + guids.join("','") + "'";
                const qo = { outFields:['objectid','globalid','gis_id'], returnGeometry:true };
                const [ugR, aerR, fiberR] = await Promise.all([
                    ugLayer  ? ugLayer.queryFeatures({ ...qo, where:'globalid IN (' + gList + ')' })  : Promise.resolve({features:[]}),
                    aerLayer ? aerLayer.queryFeatures({ ...qo, where:'globalid IN (' + gList + ')' }) : Promise.resolve({features:[]}),
                    fiberLayer.queryFeatures({ ...qo, where:'globalid IN (' + gList + ')' })
                ]);
                const ugF = ugR.features, aerF = aerR.features, fF = fiberR.features;

                // Cache for labor code filter
                analysisCache = { ugF, aerF, fF, codeToGuids };

                // ── Mismatch detection ─────────────────────────────────────
                function mismatches(pairs) {
                    return pairs.reduce((acc, p) => {
                        if (!p?.span?.attributes || !p?.fiber?.attributes) return acc;
                        const sg = p.span.attributes.globalid, fg = p.fiber.attributes.globalid;
                        const sq = guidToQty[sg], fq = guidToQty[fg];
                        if (sq === undefined || fq === undefined || sq === fq) return acc;
                        acc.push({ spanGisId:p.span.attributes.gis_id||'Unknown', fiberGisId:p.fiber.attributes.gis_id||'Unknown',
                                   spanQty:sq, fiberQty:fq, difference:sq - fq,
                                   spanCode:guidToCode[sg]||'Unknown', fiberCode:guidToCode[fg]||'Unknown',
                                   spanOid:p.span.attributes.objectid, fiberOid:p.fiber.attributes.objectid });
                        return acc;
                    }, []);
                }

                const ugPairs = coincident(ugF, fF), aerPairs = coincident(aerF, fF);
                const ugMM = mismatches(ugPairs), aerMM = mismatches(aerPairs);

                // ── Mismatch table ─────────────────────────────────────────
                function mismatchTable(mm, label, layerType, spanFeats) {
                    let t =
                        `<div class="pcr-sec-title">${label} vs Fiber ` +
                        `<span class="pcr-pill pcr-pill-bad">${mm.length} mismatch${mm.length !== 1 ? 'es' : ''}</span></div>` +
                        '<div class="pcr-tbl-wrap"><table class="pcr-tbl"><thead><tr>' +
                        `<th>${label} ID</th><th>Fiber ID</th>` +
                        `<th>${label} Code</th><th>Fiber Code</th>` +
                        `<th>${label} Qty</th><th>Fiber Qty</th><th>Diff</th><th>Zoom</th>` +
                        '</tr></thead><tbody>';
                    for (const m of mm) {
                        exportData.push({
                            type:label + ' vs Fiber', spanId:m.spanGisId, fiberId:m.fiberGisId,
                            spanLaborCode:m.spanCode, fiberLaborCode:m.fiberCode,
                            spanQty:m.spanQty, fiberQty:m.fiberQty, difference:m.difference,
                            spanOid:m.spanOid, fiberOid:m.fiberOid,
                            spanGeometry:  spanFeats.find(f => f.attributes.objectid === m.spanOid)?.geometry,
                            fiberGeometry: fF.find(f => f.attributes.objectid === m.fiberOid)?.geometry
                        });
                        const dCls = Math.abs(m.difference) <= 5 ? 'pcr-diff low' : 'pcr-diff';
                        const sign = m.difference > 0 ? '+' : '';
                        t +=
                            `<tr><td>${m.spanGisId}</td><td>${m.fiberGisId}</td>` +
                            `<td><span class="pcr-chip">${m.spanCode}</span></td>` +
                            `<td><span class="pcr-chip">${m.fiberCode}</span></td>` +
                            `<td>${m.spanQty}</td><td>${m.fiberQty}</td>` +
                            `<td class="${dCls}">${sign}${m.difference}</td>` +
                            `<td style="white-space:nowrap;">` +
                            `<button class="pcr-zbtn" style="background:#6366f1;" onclick="zoomToFeature('${layerType}',${m.spanOid})">${label}</button> ` +
                            `<button class="pcr-zbtn" style="background:#f59e0b;" onclick="zoomToFeature('fiber',${m.fiberOid})">Fiber</button>` +
                            `</td></tr>`;
                    }
                    return t + '</tbody></table></div>';
                }

                // ── Assemble results ───────────────────────────────────────
                let finalHTML = $r().innerHTML + '<div class="pcr-divider"></div>';
                if (ugMM.length)          finalHTML += mismatchTable(ugMM, 'UG', 'underground', ugF);
                else if (ugPairs.length)  finalHTML +=
                    '<div class="pcr-sec-title">Underground vs Fiber <span class="pcr-pill pcr-pill-ok">✓ Clean</span></div>' +
                    `<div class="pcr-ok-msg">✓ All ${ugPairs.length} coincident UG/fiber features have matching quantities</div>`;
                if (aerMM.length)         finalHTML += mismatchTable(aerMM, 'Aerial', 'aerial', aerF);
                else if (aerPairs.length) finalHTML +=
                    '<div class="pcr-sec-title">Aerial vs Fiber <span class="pcr-pill pcr-pill-ok">✓ Clean</span></div>' +
                    `<div class="pcr-ok-msg">✓ All ${aerPairs.length} coincident aerial/fiber features have matching quantities</div>`;
                if (!ugPairs.length && !aerPairs.length)
                    finalHTML += '<div style="font-size:10px;color:#64748b;padding:8px 0;">No coincident features found for comparison.</div>';

                $r().innerHTML = finalHTML;

                // ── Store pending filter data ───────────────────────────────
                const ugOids = ugMM.map(x => x.spanOid), aerOids = aerMM.map(x => x.spanOid);
                const fiberOids = [...ugMM, ...aerMM].map(x => x.fiberOid);
                if (ugOids.length || aerOids.length || fiberOids.length) {
                    pendingFilters = { ugLayer, aerLayer, fiberLayer, ugOids, aerOids, fiberOids, guidToQty };
                    $('#mapFilterBtn').style.display = 'inline-flex';
                }
                if (exportData.length) $('#exportBtn').style.display = 'inline-flex';

                // Zoom to all WO features (unfiltered)
                const allGeoms = [...ugF, ...aerF, ...fF].filter(f => f.geometry).map(f => f.geometry);
                const total = ugMM.length + aerMM.length;
                const done  = () => setStatus('Analysis complete — ' + total + ' mismatch' + (total !== 1 ? 'es' : '') + ' found', total > 0 ? 'warn' : 'ready');
                if (allGeoms.length) mapView.goTo(allGeoms).then(done).catch(done);
                else done();

            } catch (err) {
                setStatus('Error: ' + (err.message || err), 'error');
                console.error('Analysis error:', err);
            }
        }

        // ── Close ─────────────────────────────────────────────────────────────
        function closeTool() {
            clearAllMapFilters();
            toolBox.remove();
            document.removeEventListener('keydown', onKey);
            document.getElementById(STYLE_ID)?.remove();
            if (window.gisToolHost?.activeTools instanceof Set)
                window.gisToolHost.activeTools.delete('parent-child-reconciliation');
            delete window.pcrFilterByLaborCode;
            delete window.zoomToFeature;
        }

        // ── Wire events ───────────────────────────────────────────────────────
        $('#runBtn').addEventListener('click', runAnalysis);
        $('#resetBtn').addEventListener('click', resetAll);
        $('#exportBtn').addEventListener('click', exportToCSV);
        $('#pcrCloseBtn').addEventListener('click', closeTool);

        // ── Boot ──────────────────────────────────────────────────────────────
        loadWorkOrders();
        window.gisToolHost.activeTools.add('parent-child-reconciliation');

    } catch (err) {
        console.error('Tool initialization error:', err);
        alert('Error initializing Parent/Child Reconciliation Tool: ' + (err.message || err));
    }
})();
