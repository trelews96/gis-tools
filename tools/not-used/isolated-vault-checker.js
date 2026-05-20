// tools/fiber-cable-qty-check.js  v5
// Compares SUM of daily-tracking qty to sequential_qty on fiber_cable layer.
// Also flags fiber features with no tracking record at all.

(function () {
    try {
        // ── ⚙ CONFIG ──────────────────────────────────────────────────────────
        const FIBER_LAYER_ID     = 41050;
        const SEQ_QTY_FIELD      = 'sequential_qty';
        const TRACKING_TABLE_ID  = 90100;
        const FIBER_GUID_FIELD   = 'rel_fiber_cable_guid';
        const TRACKING_QTY_FIELD = 'quantity';
        // ─────────────────────────────────────────────────────────────────────

        if (!window.gisToolHost) window.gisToolHost = {};
        if (!(window.gisToolHost.activeTools instanceof Set))
            window.gisToolHost.activeTools = new Set();
        if (window.gisToolHost.activeTools.has('fiber-cable-qty-check')) return;
        document.getElementById('fiberQtyCheckToolbox')?.remove();

        const utils = window.gisSharedUtils;
        if (!utils) throw new Error('Shared utilities not loaded');
        const mapView = utils.getMapView();

        // ── State ─────────────────────────────────────────────────────────────
        let exportData     = [];
        let allWorkOrders  = [];
        let selectedWOs    = new Set();
        let woDropdownOpen = false;
        let mapFilterActive = false;
        let pendingFilter  = null;   // { oids, guidToSum, guidToDiff }
        let lastLoadedWOKey = '';

        // ── Styles ────────────────────────────────────────────────────────────
        const STYLE_ID = 'fcqc-tool-styles';
        if (!document.getElementById(STYLE_ID)) {
            const s = document.createElement('style');
            s.id = STYLE_ID;
            s.textContent = `
            #fiberQtyCheckToolbox { font-family:'Segoe UI',Arial,sans-serif; font-size:12px; color:#0f172a; }
            #fiberQtyCheckToolbox * { box-sizing:border-box; }

            .fcqc-header {
                background:linear-gradient(135deg,#164e63 0%,#0e7490 100%);
                color:#f0f9ff; padding:10px 12px; border-radius:6px 6px 0 0;
                cursor:grab; display:flex; align-items:center; justify-content:space-between; gap:8px;
                flex-shrink:0; user-select:none;
            }
            .fcqc-header:active { cursor:grabbing; }
            .fcqc-header-title  { display:flex; align-items:center; gap:7px; font-weight:600; font-size:12px; letter-spacing:.3px; }
            .fcqc-header-icon   { width:20px; height:20px; background:#06b6d4; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:11px; flex-shrink:0; }
            .fcqc-header-actions{ display:flex; gap:4px; }
            .fcqc-icon-btn      { background:rgba(255,255,255,.12); border:none; color:#bae6fd; width:22px; height:22px; border-radius:4px; cursor:pointer; font-size:12px; display:flex; align-items:center; justify-content:center; transition:background .15s; flex-shrink:0; }
            .fcqc-icon-btn:hover{ background:rgba(255,255,255,.28); color:#fff; }
            .fcqc-icon-btn.fcqc-close:hover { background:#ef4444; color:#fff; }

            .fcqc-body { padding:12px; overflow-y:auto; flex:1; min-height:0; }
            .fcqc-body::-webkit-scrollbar       { width:4px; }
            .fcqc-body::-webkit-scrollbar-thumb { background:#cbd5e1; border-radius:2px; }
            .fcqc-label { font-size:10px; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:.6px; margin-bottom:4px; }

            .fcqc-wo-wrap      { position:relative; margin-bottom:10px; }
            .fcqc-wo-input-row { display:flex; align-items:flex-start; border:1.5px solid #cbd5e1; border-radius:5px; background:#fff; transition:border-color .15s; padding:3px 4px; gap:4px; }
            .fcqc-wo-input-row:focus-within { border-color:#06b6d4; box-shadow:0 0 0 3px rgba(6,182,212,.12); }
            .fcqc-wo-icon      { padding:3px 4px; color:#94a3b8; font-size:11px; flex-shrink:0; margin-top:1px; }
            .fcqc-chips-wrap   { display:flex; flex-wrap:wrap; align-items:center; gap:3px; flex:1; min-width:0; }
            .fcqc-chip-tag     { display:inline-flex; align-items:center; gap:3px; background:#e0f2fe; color:#0369a1; font-size:10px; font-weight:600; padding:2px 7px; border-radius:10px; white-space:nowrap; max-width:160px; }
            .fcqc-chip-tag span{ overflow:hidden; text-overflow:ellipsis; }
            .fcqc-chip-x       { cursor:pointer; font-size:13px; line-height:1; color:#0891b2; flex-shrink:0; }
            .fcqc-chip-x:hover { color:#ef4444; }
            #fcqcWoSearch      { border:none; outline:none; padding:3px 0; font-size:11px; color:#0f172a; background:transparent; min-width:80px; flex:1; }
            #fcqcWoSearch::placeholder { color:#94a3b8; }
            #fcqcWoClear       { padding:3px 7px; color:#94a3b8; cursor:pointer; font-size:13px; line-height:1; flex-shrink:0; margin-top:2px; }
            #fcqcWoClear:hover { color:#ef4444; }

            .fcqc-wo-dropdown  { position:fixed; background:#fff; border:1.5px solid #06b6d4; border-radius:5px; max-height:200px; overflow-y:auto; z-index:100002; box-shadow:0 6px 16px rgba(0,0,0,.14); }
            .fcqc-wo-dropdown::-webkit-scrollbar       { width:4px; }
            .fcqc-wo-dropdown::-webkit-scrollbar-thumb { background:#a5f3fc; border-radius:2px; }
            .fcqc-wo-opt       { padding:6px 10px; cursor:pointer; font-size:11px; color:#1e293b; border-bottom:1px solid #f1f5f9; display:flex; align-items:center; gap:6px; }
            .fcqc-wo-opt:last-child { border-bottom:none; }
            .fcqc-wo-opt:hover { background:#ecfeff; color:#0891b2; }
            .fcqc-wo-opt.sel   { background:#e0f2fe; font-weight:700; color:#0369a1; }
            .fcqc-wo-opt .fcqc-opt-check { font-size:11px; color:#0891b2; width:12px; flex-shrink:0; }
            .fcqc-wo-empty     { padding:8px 10px; font-size:11px; color:#94a3b8; }

            .fcqc-actions { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:10px; }
            .fcqc-btn     { padding:5px 12px; font-size:10px; font-weight:700; border:none; border-radius:5px; cursor:pointer; display:inline-flex; align-items:center; gap:4px; transition:filter .15s,transform .1s; letter-spacing:.2px; }
            .fcqc-btn:active  { transform:scale(.97); }
            .fcqc-btn:hover   { filter:brightness(1.1); }
            .fcqc-btn:disabled{ opacity:.5; cursor:not-allowed; filter:none; transform:none; }
            .fcqc-btn-primary { background:#0891b2; color:#fff; }
            .fcqc-btn-ghost   { background:#f1f5f9; color:#475569; border:1px solid #e2e8f0; }
            .fcqc-btn-success { background:#059669; color:#fff; }
            .fcqc-btn-map     { background:#0ea5e9; color:#fff; }
            .fcqc-btn-map.active { background:#dc2626; }

            .fcqc-status      { display:flex; align-items:center; gap:7px; padding:5px 9px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:5px; margin-bottom:10px; min-height:28px; }
            .fcqc-dot         { width:7px; height:7px; border-radius:50%; background:#94a3b8; flex-shrink:0; }
            .fcqc-dot.ready   { background:#059669; }
            .fcqc-dot.running { background:#0891b2; animation:fcqc-pulse 1s infinite; }
            .fcqc-dot.error   { background:#dc2626; }
            .fcqc-dot.warn    { background:#f59e0b; }
            .fcqc-status-text { font-size:10px; color:#475569; flex:1; }
            .fcqc-status-time { font-size:9px; color:#94a3b8; font-variant-numeric:tabular-nums; }
            @keyframes fcqc-pulse { 0%,100%{opacity:1} 50%{opacity:.25} }

            .fcqc-sec-title { font-size:10px; font-weight:700; color:#1e293b; text-transform:uppercase; letter-spacing:.5px; margin:10px 0 5px; display:flex; align-items:center; gap:6px; }
            .fcqc-pill      { font-size:9px; padding:1px 7px; border-radius:10px; font-weight:700; }
            .fcqc-pill-bad  { background:#fee2e2; color:#dc2626; }
            .fcqc-pill-warn { background:#fef3c7; color:#d97706; }
            .fcqc-pill-ok   { background:#d1fae5; color:#059669; }
            .fcqc-tbl-wrap  { overflow-x:auto; margin-bottom:8px; }
            .fcqc-tbl       { width:100%; border-collapse:collapse; font-size:10px; }
            .fcqc-tbl th    { background:#164e63; color:#e0f2fe; padding:4px 6px; text-align:left; font-size:9px; font-weight:600; letter-spacing:.3px; white-space:nowrap; }
            .fcqc-tbl th:first-child { border-radius:4px 0 0 0; }
            .fcqc-tbl th:last-child  { border-radius:0 4px 0 0; }
            .fcqc-tbl td    { padding:5px 6px; border-bottom:1px solid #f1f5f9; white-space:nowrap; font-size:11px; }
            .fcqc-tbl tr:nth-child(even) td { background:#f8fafc; }
            .fcqc-tbl tr:hover td { background:#ecfeff; }
            .fcqc-diff      { font-weight:700; color:#dc2626; }
            .fcqc-diff.low  { color:#d97706; }
            .fcqc-chip      { font-size:11px; background:#f1f5f9; border-radius:3px; padding:1px 4px; color:#475569; font-family:monospace; }
            .fcqc-zbtn      { padding:3px 8px; font-size:10px; font-weight:700; border:none; border-radius:3px; cursor:pointer; color:#fff; white-space:nowrap; }
            .fcqc-zbtn:hover{ opacity:.82; }
            .fcqc-ok-msg    { display:flex; align-items:center; gap:6px; padding:7px 10px; background:#d1fae5; border:1px solid #6ee7b7; border-radius:4px; font-size:10px; color:#065f46; font-weight:500; margin-bottom:8px; }
            .fcqc-warn-msg  { display:flex; align-items:center; gap:6px; padding:7px 10px; background:#fef3c7; border:1px solid #fcd34d; border-radius:4px; font-size:10px; color:#92400e; font-weight:500; margin-bottom:8px; }

            .fcqc-legend      { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:8px; padding:6px 9px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:5px; }
            .fcqc-legend-item { display:flex; align-items:center; gap:4px; font-size:9px; font-weight:700; }
            .fcqc-legend-dot  { width:10px; height:10px; border-radius:50%; flex-shrink:0; }

            .fcqc-resize-se {
                position:absolute; bottom:0; right:0; width:16px; height:16px;
                cursor:nwse-resize; z-index:2; border-radius:0 0 8px 0; opacity:.5;
                background:linear-gradient(135deg, transparent 40%, #94a3b8 40%, #94a3b8 55%, transparent 55%, transparent 70%, #94a3b8 70%, #94a3b8 85%, transparent 85%);
            }
            .fcqc-resize-se:hover { opacity:1; }
            .fcqc-resize-w {
                position:absolute; left:0; top:8px; bottom:8px; width:5px;
                cursor:ew-resize; z-index:2; border-radius:8px 0 0 8px;
                background:transparent; transition:background .15s;
            }
            .fcqc-resize-w:hover, .fcqc-resize-w.active { background:#06b6d4; opacity:.5; }
            `;
            document.head.appendChild(s);
        }

        // ── Toolbox shell ─────────────────────────────────────────────────────
        const toolBox = document.createElement('div');
        toolBox.id = 'fiberQtyCheckToolbox';
        toolBox.style.cssText = `
            position:fixed; top:20px; right:20px; z-index:99999;
            width:580px; height:520px;
            background:#fff; border-radius:8px;
            box-shadow:0 8px 32px rgba(0,0,0,.18),0 2px 8px rgba(0,0,0,.1);
            display:flex; flex-direction:column; overflow:hidden;
        `;
        toolBox.innerHTML = `
            <div class="fcqc-header" id="fcqcHeader">
                <div class="fcqc-header-title">
                    <div class="fcqc-header-icon">🔌</div>
                    Fiber Cable Qty vs Sequential Qty Check
                </div>
                <div class="fcqc-header-actions">
                    <button class="fcqc-icon-btn" id="fcqcMinBtn" title="Minimize">−</button>
                    <button class="fcqc-icon-btn fcqc-close" id="fcqcCloseBtn" title="Close (Esc)">✕</button>
                </div>
            </div>

            <div class="fcqc-body" id="fcqcBody">
                <div class="fcqc-label">Work Orders <span id="fcqcWoCount" style="font-size:9px;color:#06b6d4;font-weight:700;text-transform:none;letter-spacing:0;"></span></div>
                <div class="fcqc-wo-wrap" id="fcqcWoWrapper">
                    <div class="fcqc-wo-input-row">
                        <span class="fcqc-wo-icon">🔍</span>
                        <div class="fcqc-chips-wrap" id="fcqcChipsWrap">
                            <input type="text" id="fcqcWoSearch" placeholder="Search work orders…">
                        </div>
                        <span id="fcqcWoClear" title="Clear all" style="display:none;">✕</span>
                    </div>
                    <div class="fcqc-wo-dropdown" id="fcqcWoDropdown" style="display:none;"></div>
                </div>

                <div class="fcqc-actions">
                    <button class="fcqc-btn fcqc-btn-primary" id="fcqcRunBtn">▶ Run Check</button>
                    <button class="fcqc-btn fcqc-btn-ghost"   id="fcqcResetBtn">↺ Reset</button>
                    <button class="fcqc-btn fcqc-btn-success" id="fcqcExportBtn"    style="display:none;">↓ Export CSV</button>
                    <button class="fcqc-btn fcqc-btn-map"     id="fcqcMapFilterBtn" style="display:none;">🗺 Apply Map Filter</button>
                </div>

                <div class="fcqc-status">
                    <div class="fcqc-dot" id="fcqcDot"></div>
                    <div class="fcqc-status-text" id="fcqcStatusText">Initializing…</div>
                    <div class="fcqc-status-time" id="fcqcStatusTime"></div>
                </div>

                <div id="fcqcResults"></div>
            </div>

            <div class="fcqc-resize-w"  id="fcqcResizeW"></div>
            <div class="fcqc-resize-se" id="fcqcResizeHandle"></div>
        `;
        document.body.appendChild(toolBox);

        const $  = (sel) => toolBox.querySelector(sel);
        const $r = () => $('#fcqcResults');

        // ── Status ────────────────────────────────────────────────────────────
        function setStatus(text, state = 'idle') {
            $('#fcqcStatusText').textContent = text;
            $('#fcqcDot').className = 'fcqc-dot ' + state;
            if (state !== 'running') {
                const t = new Date();
                $('#fcqcStatusTime').textContent =
                    [t.getHours(), t.getMinutes(), t.getSeconds()].map(n => String(n).padStart(2,'0')).join(':');
            } else { $('#fcqcStatusTime').textContent = ''; }
        }

        // ── Drag ──────────────────────────────────────────────────────────────
        let dragging = false, dOX = 0, dOY = 0;
        $('#fcqcHeader').addEventListener('mousedown', e => {
            if (e.target.closest('button')) return;
            dragging = true;
            const r = toolBox.getBoundingClientRect();
            dOX = e.clientX - r.left; dOY = e.clientY - r.top;
            toolBox.style.transition = 'none'; toolBox.style.right = 'auto';
            e.preventDefault();
        });

        // ── Resize ────────────────────────────────────────────────────────────
        const MIN_W = 400, MIN_H = 220;
        let resizing = false, resizeDir = '', rSX = 0, rSY = 0, rSW = 0, rSH = 0, rRight = 0;
        function startResize(e, dir) {
            resizing = true; resizeDir = dir;
            rSX = e.clientX; rSY = e.clientY;
            const rect = toolBox.getBoundingClientRect();
            rSW = rect.width; rSH = rect.height;
            toolBox.style.left = rect.left + 'px'; toolBox.style.top = rect.top + 'px'; toolBox.style.right = 'auto';
            rRight = rect.right;
            e.preventDefault(); e.stopPropagation();
        }
        $('#fcqcResizeHandle').addEventListener('mousedown', e => startResize(e, 'se'));
        $('#fcqcResizeW').addEventListener('mousedown',      e => startResize(e, 'w'));
        document.addEventListener('mousemove', e => {
            if (dragging) {
                toolBox.style.left = Math.max(0, Math.min(window.innerWidth  - toolBox.offsetWidth,  e.clientX - dOX)) + 'px';
                toolBox.style.top  = Math.max(0, Math.min(window.innerHeight - toolBox.offsetHeight, e.clientY - dOY)) + 'px';
                if (woDropdownOpen) positionDropdown();
            }
            if (resizing) {
                if (resizeDir === 'se') {
                    toolBox.style.width  = Math.max(MIN_W, Math.min(window.innerWidth  * .98, rSW + (e.clientX - rSX))) + 'px';
                    toolBox.style.height = Math.max(MIN_H, Math.min(window.innerHeight * .96, rSH + (e.clientY - rSY))) + 'px';
                    toolBox.style.maxHeight = 'none';
                } else if (resizeDir === 'w') {
                    const newLeft = Math.max(0, Math.min(rRight - MIN_W, e.clientX));
                    toolBox.style.left  = newLeft + 'px';
                    toolBox.style.width = Math.max(MIN_W, rRight - newLeft) + 'px';
                    toolBox.style.maxHeight = 'none';
                }
            }
        });
        document.addEventListener('mouseup', () => { dragging = resizing = false; resizeDir = ''; });

        // ── Minimize ──────────────────────────────────────────────────────────
        let minimized = false;
        $('#fcqcMinBtn').addEventListener('click', () => {
            minimized = !minimized;
            $('#fcqcBody').style.display = minimized ? 'none' : '';
            $('#fcqcMinBtn').textContent = minimized ? '+' : '−';
            toolBox.style.height = minimized ? 'auto' : (toolBox.offsetHeight || 520) + 'px';
        });

        // ── ESC ───────────────────────────────────────────────────────────────
        function onKey(e) { if (e.key === 'Escape') closeTool(); }
        document.addEventListener('keydown', onKey);

        // ── WO multi-select ───────────────────────────────────────────────────
        function renderChips() {
            const wrap = $('#fcqcChipsWrap'), inp = $('#fcqcWoSearch');
            wrap.querySelectorAll('.fcqc-chip-tag').forEach(c => c.remove());
            for (const v of selectedWOs) {
                const chip = document.createElement('span');
                chip.className = 'fcqc-chip-tag';
                chip.innerHTML = `<span title="${v}">${v}</span><span class="fcqc-chip-x" data-v="${v}">×</span>`;
                chip.querySelector('.fcqc-chip-x').addEventListener('click', e => {
                    e.stopPropagation();
                    selectedWOs.delete(v); renderChips(); renderDropdown($('#fcqcWoSearch').value);
                });
                wrap.insertBefore(chip, inp);
            }
            $('#fcqcWoClear').style.display = selectedWOs.size ? 'inline' : 'none';
            inp.placeholder = selectedWOs.size ? '' : ('Search ' + allWorkOrders.length + ' work orders…');
            $('#fcqcWoCount').textContent = selectedWOs.size ? selectedWOs.size + ' selected' : '';
        }

        function renderDropdown(filter) {
            const q = (filter || '').toLowerCase();
            const matches = q ? allWorkOrders.filter(v => v.toLowerCase().includes(q)) : allWorkOrders;
            if (!matches.length) { $('#fcqcWoDropdown').innerHTML = '<div class="fcqc-wo-empty">No work orders found</div>'; return; }
            $('#fcqcWoDropdown').innerHTML = matches.map(v => {
                const sel = selectedWOs.has(v);
                return `<div class="fcqc-wo-opt${sel ? ' sel' : ''}" data-v="${v}">` +
                       `<span class="fcqc-opt-check">${sel ? '✓' : ''}</span>${v}</div>`;
            }).join('');
        }
        function positionDropdown() {
            const r = $('#fcqcWoWrapper').getBoundingClientRect(), dd = $('#fcqcWoDropdown');
            dd.style.top = (r.bottom + 3) + 'px'; dd.style.left = r.left + 'px'; dd.style.width = r.width + 'px';
        }
        function openDropdown()  { renderDropdown($('#fcqcWoSearch').value); positionDropdown(); $('#fcqcWoDropdown').style.display = 'block'; woDropdownOpen = true; }
        function closeDropdown() { $('#fcqcWoDropdown').style.display = 'none'; woDropdownOpen = false; $('#fcqcWoSearch').value = ''; }

        $('#fcqcWoSearch').addEventListener('focus', openDropdown);
        $('#fcqcWoSearch').addEventListener('input', () => { renderDropdown($('#fcqcWoSearch').value); if (!woDropdownOpen) openDropdown(); });
        $('#fcqcWoDropdown').addEventListener('mousedown', e => {
            const o = e.target.closest('.fcqc-wo-opt'); if (!o) return;
            const v = o.dataset.v;
            if (selectedWOs.has(v)) selectedWOs.delete(v); else selectedWOs.add(v);
            renderChips(); renderDropdown($('#fcqcWoSearch').value); e.preventDefault();
        });
        $('#fcqcWoClear').addEventListener('click', () => {
            selectedWOs.clear(); renderChips(); renderDropdown(''); setStatus('Selection cleared', 'ready');
        });
        document.addEventListener('mousedown', e => { if (woDropdownOpen && !$('#fcqcWoWrapper').contains(e.target)) closeDropdown(); });

        // ── Helpers ───────────────────────────────────────────────────────────
        function getLayer(id)  { return mapView.map.allLayers.find(l => l.type === 'feature' && l.layerId === id) || null; }
        function findTrackingTable() {
            return mapView.map.allTables?.find(t => t.layerId === TRACKING_TABLE_ID) ||
                   mapView.map.allLayers?.find(i => i.type === 'table' && i.layerId === TRACKING_TABLE_ID) || null;
        }
        function findField(table, name) {
            return (table.fields || []).find(f => f?.name?.toLowerCase() === name.toLowerCase()) || null;
        }

        // ── Map filter + labels ───────────────────────────────────────────────
        // Returns null when map is empty so caller can skip the label class entirely
        function makeDecodeLabel(guidToVal, prefix, fallback) {
            const entries = Object.entries(guidToVal);
            if (!entries.length) return null;
            const parts = [];
            for (const [g, v] of entries) parts.push(`"${g}"`, `"${prefix}${v}"`);
            return `var id = $feature.globalid; Decode(id, ${parts.join(',')}, "${fallback}")`;
        }

        function applyMapFilter() {
            if (!pendingFilter) return;
            const fl = getLayer(FIBER_LAYER_ID);
            if (!fl) { setStatus('Fiber layer not found', 'error'); return; }

            const { oids, guidToSum, guidToDiff } = pendingFilter;

            fl.definitionExpression = 'objectid IN (' + oids.join(',') + ')';

            const rawLabels = [
                // Tracking sum — cyan, top
                { expr: makeDecodeLabel(guidToSum, 'Track: ', 'No Tracking'), color:[8,145,178,255],  yoffset: 18 },
                // Sequential qty — indigo, middle (read straight from field)
                { expr: `"Seq: " + $feature.${SEQ_QTY_FIELD}`,               color:[99,102,241,255], yoffset:  4 },
                // Difference — red, bottom (only present on mismatches)
                { expr: makeDecodeLabel(guidToDiff, 'Diff: ', ''),            color:[220,38,38,255],  yoffset:-10 }
            ];

            fl.labelingInfo = rawLabels
                .filter(lc => lc.expr !== null)
                .map(lc => ({
                    labelExpressionInfo: { expression: lc.expr },
                    symbol: {
                        type:'text', color: lc.color,
                        haloColor:'white', haloSize:2,
                        font:{ size:13, family:'Arial', weight:'bold' },
                        yoffset: lc.yoffset
                    },
                    deconflictionStrategy:'none', repeatLabel:false, removeDuplicates:'none'
                }));
            fl.labelsVisible = true;

            mapFilterActive = true;
            $('#fcqcMapFilterBtn').textContent = '✕ Clear Map Filter';
            $('#fcqcMapFilterBtn').classList.add('active');
        }

        function clearMapFilter() {
            const fl = getLayer(FIBER_LAYER_ID);
            if (fl) { fl.definitionExpression = null; fl.labelingInfo = []; fl.labelsVisible = false; }
            mapFilterActive = false;
            $('#fcqcMapFilterBtn').textContent = '🗺 Apply Map Filter';
            $('#fcqcMapFilterBtn').classList.remove('active');
        }
        $('#fcqcMapFilterBtn').addEventListener('click', () => { mapFilterActive ? clearMapFilter() : applyMapFilter(); });

        // ── Zoom ──────────────────────────────────────────────────────────────
        window.fcqcZoomTo = function (oid) {
            const fl = getLayer(FIBER_LAYER_ID); if (!fl) { alert('Fiber cable layer not found'); return; }
            setStatus('Zooming…', 'running');
            fl.queryFeatures({ where:'objectid = ' + oid, outFields:['objectid'], returnGeometry:true })
                .then(r => r.features[0]?.geometry && mapView.goTo({ target:r.features[0].geometry, scale:1000 }))
                .then(() => setStatus('Zoomed to fiber OID: ' + oid, 'ready'))
                .catch(e => setStatus('Zoom error: ' + e.message, 'error'));
        };

        // ── CSV ───────────────────────────────────────────────────────────────
        function csvEsc(v) {
            if (v == null) return ''; v = String(v);
            return /[,"\n]/.test(v) ? '"' + v.replace(/"/g,'""') + '"' : v;
        }
        function exportToCSV() {
            if (!exportData.length) { alert('No data to export.'); return; }
            let out = 'data:text/csv;charset=utf-8,Work Order,Fiber GIS ID,Fiber OID,Tracking Qty (Sum),Sequential Qty,Difference,Status\n';
            for (const r of exportData)
                out += [csvEsc(r.workOrder), csvEsc(r.fiberGisId), r.fiberOid,
                        r.trackingQtySum ?? '', r.seqQty ?? '', r.difference ?? '', csvEsc(r.status)].join(',') + '\n';
            const woLabel = [...selectedWOs].join('-') || 'multi';
            const a = document.createElement('a');
            a.href = encodeURI(out);
            a.download = 'fiber_cable_qty_check_' + woLabel + '_' + new Date().toISOString().slice(0,10) + '.csv';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
        }

        // ── Load work orders ──────────────────────────────────────────────────
        function loadWorkOrders() {
            setStatus('Loading work orders…', 'running');
            const fl = getLayer(FIBER_LAYER_ID);
            if (!fl) { setStatus('Fiber cable layer (' + FIBER_LAYER_ID + ') not found', 'error'); return; }
            fl.load()
                .then(() => fl.queryFeatures({ where:"workorder_id IS NOT NULL AND workorder_id <> ''", outFields:['workorder_id'], returnGeometry:false, returnDistinctValues:true }))
                .then(r => {
                    const seen = {}; allWorkOrders = [];
                    for (const f of r.features) {
                        const v = String(f.attributes.workorder_id || '').trim();
                        if (v && !seen[v]) { allWorkOrders.push(v); seen[v] = true; }
                    }
                    allWorkOrders.sort(); renderChips();
                    setStatus('Ready — ' + allWorkOrders.length + ' work orders loaded', 'ready');
                })
                .catch(e => setStatus('Error loading work orders: ' + (e.message || e), 'error'));
        }

        // ── Reset ─────────────────────────────────────────────────────────────
        function resetAll() {
            clearMapFilter();
            exportData = []; pendingFilter = null;
            $r().innerHTML = '';
            $('#fcqcExportBtn').style.display = $('#fcqcMapFilterBtn').style.display = 'none';
            setStatus('Reset complete', 'ready');
        }

        // ── Main analysis ─────────────────────────────────────────────────────
        async function runCheck() {
            if (!selectedWOs.size) { alert('Please select at least one work order'); return; }

            const woLabel = selectedWOs.size === 1 ? [...selectedWOs][0] : selectedWOs.size + ' work orders';
            setStatus('Running check for ' + woLabel + '…', 'running');
            $r().innerHTML = ''; exportData = []; pendingFilter = null; mapFilterActive = false;
            clearMapFilter();
            $('#fcqcExportBtn').style.display = $('#fcqcMapFilterBtn').style.display = 'none';

            const table = findTrackingTable();
            if (!table) { setStatus('Tracking table (' + TRACKING_TABLE_ID + ') not found', 'error'); return; }
            const fiberLayer = getLayer(FIBER_LAYER_ID);
            if (!fiberLayer) { setStatus('Fiber cable layer (' + FIBER_LAYER_ID + ') not found', 'error'); return; }

            try {
                await table.load(); await fiberLayer.load();

                const woList = "'" + [...selectedWOs].join("','") + "'";

                // ── Step 1: ALL fiber features for the selected WO(s) ──────────
                // Query by workorder_id so we catch features with NO tracking record
                setStatus('Querying fiber cable features…', 'running');
                const allFiberResult = await fiberLayer.queryFeatures({
                    where: 'workorder_id IN (' + woList + ')',
                    outFields: ['objectid', 'globalid', 'gis_id', SEQ_QTY_FIELD, 'workorder_id'],
                    returnGeometry: true
                });
                const allFiberFeats = allFiberResult.features;
                if (!allFiberFeats.length) throw new Error('No fiber cable features found for selected work order(s)');

                // ── Step 2: All tracking records for the selected WO(s) ────────
                let woField = null;
                for (const f of (table.fields || [])) if (f?.name?.toLowerCase().includes('workorder')) { woField = f; break; }
                if (!woField) throw new Error('No workorder field in tracking table');

                let guidField = findField(table, FIBER_GUID_FIELD);
                if (!guidField) {
                    for (const f of (table.fields || [])) {
                        const n = f?.name?.toLowerCase() || '';
                        if (n.includes('fiber') || n.includes('cable') || (n.includes('guid') && n !== 'globalid')) { guidField = f; break; }
                    }
                }
                if (!guidField) throw new Error('Cannot locate fiber GUID field. Available: ' + table.fields.map(f => f.name).join(', '));

                setStatus('Querying tracking records…', 'running');
                const trackingResult = await table.queryFeatures({
                    where: woField.name + ' IN (' + woList + ')',
                    outFields: ['*'], returnGeometry: false
                });

                // Build guid → { qtySum, workOrder } from tracking records
                const guidMap = {};
                let skippedNoGuid = 0;
                for (const feat of trackingResult.features) {
                    const a    = feat.attributes;
                    const qty  = Number(a[TRACKING_QTY_FIELD]) || 0;
                    const guid = a[guidField.name];
                    const wo   = a[woField.name] || '';
                    if (!guid) { skippedNoGuid++; continue; }
                    if (!guidMap[guid]) guidMap[guid] = { qtySum: 0, workOrder: wo };
                    guidMap[guid].qtySum += qty;
                }

                // Track which tracking GUIDs were actually matched to a fiber feature
                const fiberGlobalIds = new Set(allFiberFeats.map(f => f.attributes.globalid));
                const orphanedGuids  = Object.keys(guidMap).filter(g => !fiberGlobalIds.has(g));

                // ── Step 3: Categorize every fiber feature ─────────────────────
                const mismatches = [], untracked = [], matched = [], woMismatches = [];
                const guidToSum = {}, guidToDiff = {};

                for (const feat of allFiberFeats) {
                    const a      = feat.attributes;
                    const guid   = a.globalid;
                    const seqQty = a[SEQ_QTY_FIELD];
                    const gisId  = a.gis_id || a.objectid;
                    const oid    = a.objectid;
                    const wo     = a.workorder_id || '';

                    if (!guidMap[guid]) {
                        // ── No tracking record at all ──────────────────────────
                        const row = { workOrder:wo, fiberGisId:gisId, fiberOid:oid, trackingQtySum:null, seqQty, difference:null, status:'No Tracking Record' };
                        untracked.push(row);
                        exportData.push(row);
                        // Label shows "No Tracking" via fallback — no entry in guidToSum needed
                        continue;
                    }

                    const { qtySum, workOrder } = guidMap[guid];
                    const fiberWO = a.workorder_id || '';
                    if (fiberWO !== workOrder)
                        woMismatches.push({ trackingWO:workOrder, fiberWO, fiberGisId:gisId, fiberOid:oid, seqQty, trackingQtySum:qtySum });

                    const diff = (typeof seqQty === 'number') ? qtySum - seqQty : null;

                    guidToSum[guid] = qtySum;
                    if (diff !== null && diff !== 0) guidToDiff[guid] = (diff > 0 ? '+' : '') + diff;

                    const row = { workOrder, fiberGisId:gisId, fiberOid:oid, trackingQtySum:qtySum, seqQty, difference:diff };

                    if (seqQty == null || seqQty === '') { row.status = 'No Sequential Qty'; mismatches.push({ ...row, noSeqQty:true }); }
                    else if (diff !== 0)                 { row.status = 'Mismatch';          mismatches.push(row); }
                    else                                 { row.status = 'Match';             matched.push(row); }
                    exportData.push(row);
                }

                // ── Store filter data (ALL fiber features for the WO) ──────────
                pendingFilter = {
                    oids:       allFiberFeats.map(f => f.attributes.objectid),
                    guidToSum,
                    guidToDiff
                };

                // ── Build results HTML ─────────────────────────────────────────
                const totalTrackingSum = exportData.filter(r => r.trackingQtySum != null).reduce((s, r) => s + r.trackingQtySum, 0);
                const totalSeqQty      = exportData.filter(r => typeof r.seqQty === 'number').reduce((s, r) => s + r.seqQty, 0);
                const nMatch = matched.length, nMismatch = mismatches.length, nUntracked = untracked.length;
                const nTotal = allFiberFeats.length;

                function sumCard(label, val, color, bg) {
                    return `<div style="flex:1;min-width:80px;background:${bg};border-radius:5px;padding:6px 10px;text-align:center;">` +
                           `<div style="font-size:18px;font-weight:700;color:${color};">${val}</div>` +
                           `<div style="font-size:9px;color:${color};font-weight:600;text-transform:uppercase;letter-spacing:.5px;">${label}</div>` +
                           `</div>`;
                }

                let html =
                    `<div class="fcqc-sec-title">Summary — ${selectedWOs.size === 1 ? 'WO: <span class="fcqc-chip">' + [...selectedWOs][0] + '</span>' : selectedWOs.size + ' Work Orders'}</div>` +
                    `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">` +
                    sumCard('Total Tracking Sum', totalTrackingSum, '#6366f1', '#eef2ff') +
                    sumCard('Total Sequential Qty', totalSeqQty,   '#0891b2', '#e0f2fe') + `</div>` +
                    `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">` +
                    sumCard('Total Features', nTotal,     '#334155',                      '#f1f5f9') +
                    sumCard('Match',          nMatch,     '#059669',                      '#d1fae5') +
                    sumCard('Mismatch',       nMismatch,  nMismatch  ? '#dc2626' : '#059669', nMismatch  ? '#fee2e2' : '#d1fae5') +
                    sumCard('No Tracking',    nUntracked,           nUntracked           ? '#d97706' : '#059669', nUntracked           ? '#fef3c7' : '#d1fae5') +
                    sumCard('WO ID Mismatch', woMismatches.length,  woMismatches.length  ? '#7c3aed' : '#059669', woMismatches.length  ? '#ede9fe' : '#d1fae5') +
                    (orphanedGuids.length ? sumCard('Orphan Track', orphanedGuids.length, '#94a3b8', '#f1f5f9') : '') +
                    (skippedNoGuid       ? sumCard('No GUID',      skippedNoGuid,         '#94a3b8', '#f1f5f9') : '') +
                    `</div>`;

                // Label legend
                html +=
                    `<div class="fcqc-legend">` +
                    `<div class="fcqc-legend-item"><div class="fcqc-legend-dot" style="background:#0891b2;"></div>Track: — tracking qty sum</div>` +
                    `<div class="fcqc-legend-item"><div class="fcqc-legend-dot" style="background:#6366f1;"></div>Seq: — sequential qty</div>` +
                    `<div class="fcqc-legend-item"><div class="fcqc-legend-dot" style="background:#dc2626;"></div>Diff: — difference (mismatches only)</div>` +
                    `</div>`;

                // Mismatch table
                if (mismatches.length) {
                    html +=
                        `<div class="fcqc-sec-title">Qty Mismatches <span class="fcqc-pill fcqc-pill-bad">${mismatches.length}</span></div>` +
                        `<div class="fcqc-tbl-wrap"><table class="fcqc-tbl"><thead><tr>` +
                        `<th>WO</th><th>Fiber GIS ID</th><th>Tracking Sum</th><th>Sequential Qty</th><th>Diff</th><th>Zoom</th>` +
                        `</tr></thead><tbody>`;
                    for (const m of mismatches) {
                        const abs = typeof m.difference === 'number' ? Math.abs(m.difference) : 0;
                        const dCls = m.noSeqQty ? 'fcqc-diff' : (abs <= 5 ? 'fcqc-diff low' : 'fcqc-diff');
                        const diffTxt = m.noSeqQty ? '—' : (m.difference > 0 ? '+' : '') + m.difference;
                        html +=
                            `<tr>` +
                            `<td><span class="fcqc-chip">${m.workOrder || '—'}</span></td>` +
                            `<td>${m.fiberGisId}</td>` +
                            `<td>${m.trackingQtySum}</td>` +
                            `<td>${m.noSeqQty ? '<span style="color:#dc2626;font-weight:700;">NULL</span>' : m.seqQty}</td>` +
                            `<td class="${dCls}">${diffTxt}</td>` +
                            `<td><button class="fcqc-zbtn" style="background:#0891b2;" onclick="fcqcZoomTo(${m.fiberOid})">Zoom</button></td>` +
                            `</tr>`;
                    }
                    html += '</tbody></table></div>';
                } else if (!nUntracked) {
                    html += `<div class="fcqc-ok-msg">✓ All ${nTotal} fiber cable features match their tracking quantity sums</div>`;
                }

                // No-tracking table
                if (untracked.length) {
                    html +=
                        `<div class="fcqc-sec-title">No Tracking Record <span class="fcqc-pill fcqc-pill-warn">${untracked.length}</span></div>` +
                        `<div class="fcqc-tbl-wrap"><table class="fcqc-tbl"><thead><tr>` +
                        `<th>WO</th><th>Fiber GIS ID</th><th>Sequential Qty</th><th>Zoom</th>` +
                        `</tr></thead><tbody>`;
                    for (const u of untracked) {
                        html +=
                            `<tr>` +
                            `<td><span class="fcqc-chip">${u.workOrder || '—'}</span></td>` +
                            `<td>${u.fiberGisId}</td>` +
                            `<td>${u.seqQty ?? '<span style="color:#94a3b8;">NULL</span>'}</td>` +
                            `<td><button class="fcqc-zbtn" style="background:#d97706;" onclick="fcqcZoomTo(${u.fiberOid})">Zoom</button></td>` +
                            `</tr>`;
                    }
                    html += '</tbody></table></div>';
                }

                // WO ID mismatch table
                if (woMismatches.length) {
                    html +=
                        `<div class="fcqc-sec-title">Work Order ID Mismatch <span class="fcqc-pill" style="background:#ede9fe;color:#7c3aed;">${woMismatches.length}</span></div>` +
                        `<div class="fcqc-tbl-wrap"><table class="fcqc-tbl"><thead><tr>` +
                        `<th>Fiber GIS ID</th><th>Fiber WO</th><th>Tracking WO</th><th>Tracking Sum</th><th>Sequential Qty</th><th>Zoom</th>` +
                        `</tr></thead><tbody>`;
                    for (const w of woMismatches) {
                        html +=
                            `<tr>` +
                            `<td>${w.fiberGisId}</td>` +
                            `<td><span class="fcqc-chip" style="color:#7c3aed;">${w.fiberWO || '—'}</span></td>` +
                            `<td><span class="fcqc-chip" style="color:#dc2626;">${w.trackingWO || '—'}</span></td>` +
                            `<td>${w.trackingQtySum}</td>` +
                            `<td>${w.seqQty ?? '<span style="color:#94a3b8;">NULL</span>'}</td>` +
                            `<td><button class="fcqc-zbtn" style="background:#7c3aed;" onclick="fcqcZoomTo(${w.fiberOid})">Zoom</button></td>` +
                            `</tr>`;
                    }
                    html += '</tbody></table></div>';
                }

                // Orphaned tracking records
                if (orphanedGuids.length)
                    html += `<div class="fcqc-warn-msg">⚠ ${orphanedGuids.length} tracking record(s) reference a fiber GUID not found in the fiber layer.</div>`;

                $r().innerHTML = html;

                if (exportData.length) $('#fcqcExportBtn').style.display = 'inline-flex';
                if (pendingFilter.oids.length) $('#fcqcMapFilterBtn').style.display = 'inline-flex';

                const allGeoms = allFiberFeats.filter(f => f.geometry).map(f => f.geometry);
                const totalIssues = nMismatch + nUntracked;
                const done = () => setStatus(
                    `Check complete — ${nMismatch} mismatch${nMismatch !== 1 ? 'es' : ''}, ${nUntracked} untracked out of ${nTotal} features`,
                    totalIssues > 0 ? 'warn' : 'ready'
                );
                if (allGeoms.length) mapView.goTo(allGeoms).then(done).catch(done); else done();

            } catch (err) {
                setStatus('Error: ' + (err.message || err), 'error');
                console.error('Fiber cable check error:', err);
            }
        }

        // ── Close ─────────────────────────────────────────────────────────────
        function closeTool() {
            clearMapFilter();
            toolBox.remove();
            document.removeEventListener('keydown', onKey);
            document.getElementById(STYLE_ID)?.remove();
            if (window.gisToolHost?.activeTools instanceof Set)
                window.gisToolHost.activeTools.delete('fiber-cable-qty-check');
            delete window.fcqcZoomTo;
        }

        // ── Wire events ───────────────────────────────────────────────────────
        $('#fcqcRunBtn').addEventListener('click', runCheck);
        $('#fcqcResetBtn').addEventListener('click', resetAll);
        $('#fcqcExportBtn').addEventListener('click', exportToCSV);
        $('#fcqcCloseBtn').addEventListener('click', closeTool);

        // ── Boot ──────────────────────────────────────────────────────────────
        loadWorkOrders();
        window.gisToolHost.activeTools.add('fiber-cable-qty-check');

    } catch (err) {
        console.error('Tool init error:', err);
        alert('Error initializing Fiber Cable Qty Check Tool: ' + (err.message || err));
    }
})();
