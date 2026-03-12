// tools/pothole-qty-check.js  v1
// Compares daily-tracking-table quantity vs pothole feature footage for a given WO.

(function () {
    try {
        // ── ⚙ CONFIG — adjust these to match your schema ──────────────────────
        const POTHOLE_LAYER_ID   = 23250;              // layerId of your pothole feature layer
        const FOOTAGE_FIELD      = 'footage';         // numeric field on pothole layer
        const TRACKING_TABLE_ID  = 90100;             // layerId of the daily tracking table (same as original)
        const POTHOLE_GUID_FIELD = 'rel_pothole_guid'; // field in tracking table that holds the pothole globalid
        // ─────────────────────────────────────────────────────────────────────

        if (!window.gisToolHost) window.gisToolHost = {};
        if (!(window.gisToolHost.activeTools instanceof Set))
            window.gisToolHost.activeTools = new Set();
        if (window.gisToolHost.activeTools.has('pothole-qty-check')) return;
        document.getElementById('potholeQtyCheckToolbox')?.remove();

        const utils = window.gisSharedUtils;
        if (!utils) throw new Error('Shared utilities not loaded');
        const mapView = utils.getMapView();

        // ── State ─────────────────────────────────────────────────────────────
        let exportData     = [];
        let allWorkOrders  = [];
        let selectedWO     = '';
        let woDropdownOpen = false;
        let mapFilterActive = false;
        let pendingOids    = null;  // { potholeLayer, oids }

        // ── Styles ────────────────────────────────────────────────────────────
        const STYLE_ID = 'phqc-tool-styles';
        if (!document.getElementById(STYLE_ID)) {
            const s = document.createElement('style');
            s.id = STYLE_ID;
            s.textContent = `
            #potholeQtyCheckToolbox { font-family:'Segoe UI',Arial,sans-serif; font-size:12px; color:#0f172a; }
            #potholeQtyCheckToolbox * { box-sizing:border-box; }

            .phqc-header {
                background:linear-gradient(135deg,#1e293b 0%,#334155 100%);
                color:#f1f5f9; padding:10px 12px; border-radius:6px 6px 0 0;
                cursor:grab; display:flex; align-items:center; justify-content:space-between; gap:8px;
                flex-shrink:0; user-select:none;
            }
            .phqc-header:active { cursor:grabbing; }
            .phqc-header-title  { display:flex; align-items:center; gap:7px; font-weight:600; font-size:12px; letter-spacing:.3px; }
            .phqc-header-icon   { width:20px; height:20px; background:#f59e0b; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:11px; flex-shrink:0; }
            .phqc-header-actions{ display:flex; gap:4px; }
            .phqc-icon-btn      { background:rgba(255,255,255,.12); border:none; color:#cbd5e1; width:22px; height:22px; border-radius:4px; cursor:pointer; font-size:12px; display:flex; align-items:center; justify-content:center; transition:background .15s; flex-shrink:0; }
            .phqc-icon-btn:hover{ background:rgba(255,255,255,.28); color:#fff; }
            .phqc-icon-btn.phqc-close:hover { background:#ef4444; color:#fff; }

            .phqc-body          { padding:12px; overflow-y:auto; flex:1; min-height:0; }
            .phqc-body::-webkit-scrollbar       { width:4px; }
            .phqc-body::-webkit-scrollbar-thumb { background:#cbd5e1; border-radius:2px; }
            .phqc-label         { font-size:10px; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:.6px; margin-bottom:4px; }

            .phqc-wo-wrap       { position:relative; margin-bottom:10px; }
            .phqc-wo-input-row  { display:flex; align-items:center; border:1.5px solid #cbd5e1; border-radius:5px; background:#fff; transition:border-color .15s; overflow:hidden; }
            .phqc-wo-input-row:focus-within { border-color:#f59e0b; box-shadow:0 0 0 3px rgba(245,158,11,.12); }
            .phqc-wo-icon       { padding:0 8px; color:#94a3b8; font-size:11px; flex-shrink:0; }
            #phqcWoSearch       { flex:1; border:none; outline:none; padding:7px 0; font-size:11px; color:#0f172a; background:transparent; min-width:0; }
            #phqcWoSearch::placeholder { color:#94a3b8; }
            #phqcWoClear        { padding:0 9px; color:#94a3b8; cursor:pointer; font-size:15px; line-height:1; flex-shrink:0; }
            #phqcWoClear:hover  { color:#ef4444; }
            .phqc-wo-dropdown   { position:fixed; background:#fff; border:1.5px solid #f59e0b; border-radius:5px; max-height:170px; overflow-y:auto; z-index:100002; box-shadow:0 6px 16px rgba(0,0,0,.14); }
            .phqc-wo-dropdown::-webkit-scrollbar       { width:4px; }
            .phqc-wo-dropdown::-webkit-scrollbar-thumb { background:#fde68a; border-radius:2px; }
            .phqc-wo-opt        { padding:6px 10px; cursor:pointer; font-size:11px; color:#1e293b; border-bottom:1px solid #f1f5f9; }
            .phqc-wo-opt:last-child { border-bottom:none; }
            .phqc-wo-opt:hover  { background:#fffbeb; color:#d97706; }
            .phqc-wo-opt.sel    { background:#fffbeb; font-weight:700; color:#d97706; }
            .phqc-wo-empty      { padding:8px 10px; font-size:11px; color:#94a3b8; }

            .phqc-actions { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:10px; }
            .phqc-btn     { padding:5px 12px; font-size:10px; font-weight:700; border:none; border-radius:5px; cursor:pointer; display:inline-flex; align-items:center; gap:4px; transition:filter .15s,transform .1s; letter-spacing:.2px; }
            .phqc-btn:active  { transform:scale(.97); }
            .phqc-btn:hover   { filter:brightness(1.1); }
            .phqc-btn:disabled{ opacity:.5; cursor:not-allowed; filter:none; transform:none; }
            .phqc-btn-primary { background:#f59e0b; color:#fff; }
            .phqc-btn-ghost   { background:#f1f5f9; color:#475569; border:1px solid #e2e8f0; }
            .phqc-btn-success { background:#059669; color:#fff; }
            .phqc-btn-map     { background:#0ea5e9; color:#fff; }
            .phqc-btn-map.active { background:#dc2626; }

            .phqc-status      { display:flex; align-items:center; gap:7px; padding:5px 9px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:5px; margin-bottom:10px; min-height:28px; }
            .phqc-dot         { width:7px; height:7px; border-radius:50%; background:#94a3b8; flex-shrink:0; }
            .phqc-dot.ready   { background:#059669; }
            .phqc-dot.running { background:#f59e0b; animation:phqc-pulse 1s infinite; }
            .phqc-dot.error   { background:#dc2626; }
            .phqc-dot.warn    { background:#f59e0b; }
            .phqc-status-text { font-size:10px; color:#475569; flex:1; }
            .phqc-status-time { font-size:9px; color:#94a3b8; font-variant-numeric:tabular-nums; }
            @keyframes phqc-pulse { 0%,100%{opacity:1} 50%{opacity:.25} }

            .phqc-sec-title   { font-size:10px; font-weight:700; color:#1e293b; text-transform:uppercase; letter-spacing:.5px; margin:10px 0 5px; display:flex; align-items:center; gap:6px; }
            .phqc-pill        { font-size:9px; padding:1px 7px; border-radius:10px; font-weight:700; }
            .phqc-pill-bad    { background:#fee2e2; color:#dc2626; }
            .phqc-pill-ok     { background:#d1fae5; color:#059669; }
            .phqc-tbl-wrap    { overflow-x:auto; margin-bottom:8px; }
            .phqc-tbl         { width:100%; border-collapse:collapse; font-size:10px; }
            .phqc-tbl th      { background:#1e293b; color:#e2e8f0; padding:4px 6px; text-align:left; font-size:9px; font-weight:600; letter-spacing:.3px; white-space:nowrap; }
            .phqc-tbl th:first-child { border-radius:4px 0 0 0; }
            .phqc-tbl th:last-child  { border-radius:0 4px 0 0; }
            .phqc-tbl td      { padding:5px 6px; border-bottom:1px solid #f1f5f9; white-space:nowrap; font-size:11px; }
            .phqc-tbl tr:nth-child(even) td { background:#f8fafc; }
            .phqc-tbl tr:hover td { background:#fffbeb; }
            .phqc-diff        { font-weight:700; color:#dc2626; }
            .phqc-diff.low    { color:#d97706; }
            .phqc-chip        { font-size:11px; background:#f1f5f9; border-radius:3px; padding:1px 4px; color:#475569; font-family:monospace; }
            .phqc-zbtn        { padding:3px 8px; font-size:10px; font-weight:700; border:none; border-radius:3px; cursor:pointer; color:#fff; white-space:nowrap; }
            .phqc-zbtn:hover  { opacity:.82; }
            .phqc-ok-msg      { display:flex; align-items:center; gap:6px; padding:7px 10px; background:#d1fae5; border:1px solid #6ee7b7; border-radius:4px; font-size:10px; color:#065f46; font-weight:500; margin-bottom:8px; }
            .phqc-warn-msg    { display:flex; align-items:center; gap:6px; padding:7px 10px; background:#fef3c7; border:1px solid #fcd34d; border-radius:4px; font-size:10px; color:#92400e; font-weight:500; margin-bottom:8px; }

            .phqc-resize-se {
                position:absolute; bottom:0; right:0; width:16px; height:16px;
                cursor:nwse-resize; z-index:2; border-radius:0 0 8px 0; opacity:.5;
                background:linear-gradient(135deg, transparent 40%, #94a3b8 40%, #94a3b8 55%, transparent 55%, transparent 70%, #94a3b8 70%, #94a3b8 85%, transparent 85%);
            }
            .phqc-resize-se:hover { opacity:1; }
            .phqc-resize-w {
                position:absolute; left:0; top:8px; bottom:8px; width:5px;
                cursor:ew-resize; z-index:2; border-radius:8px 0 0 8px;
                background:transparent; transition:background .15s;
            }
            .phqc-resize-w:hover, .phqc-resize-w.active { background:#f59e0b; opacity:.5; }
            `;
            document.head.appendChild(s);
        }

        // ── Toolbox shell ─────────────────────────────────────────────────────
        const toolBox = document.createElement('div');
        toolBox.id = 'potholeQtyCheckToolbox';
        toolBox.style.cssText = `
            position:fixed; top:20px; right:20px; z-index:99999;
            width:520px; height:520px;
            background:#fff; border-radius:8px;
            box-shadow:0 8px 32px rgba(0,0,0,.18),0 2px 8px rgba(0,0,0,.1);
            display:flex; flex-direction:column; overflow:hidden;
        `;
        toolBox.innerHTML = `
            <div class="phqc-header" id="phqcHeader">
                <div class="phqc-header-title">
                    <div class="phqc-header-icon">🕳</div>
                    Pothole Qty vs Footage Check
                </div>
                <div class="phqc-header-actions">
                    <button class="phqc-icon-btn" id="phqcMinBtn" title="Minimize">−</button>
                    <button class="phqc-icon-btn phqc-close" id="phqcCloseBtn" title="Close (Esc)">✕</button>
                </div>
            </div>

            <div class="phqc-body" id="phqcBody">
                <div class="phqc-label">Work Order</div>
                <div class="phqc-wo-wrap" id="phqcWoWrapper">
                    <div class="phqc-wo-input-row">
                        <span class="phqc-wo-icon">🔍</span>
                        <input type="text" id="phqcWoSearch" placeholder="Search work orders…">
                        <span id="phqcWoClear" style="display:none;">✕</span>
                    </div>
                    <div class="phqc-wo-dropdown" id="phqcWoDropdown" style="display:none;"></div>
                </div>

                <div class="phqc-actions">
                    <button class="phqc-btn phqc-btn-primary" id="phqcRunBtn">▶ Run Check</button>
                    <button class="phqc-btn phqc-btn-ghost"   id="phqcResetBtn">↺ Reset</button>
                    <button class="phqc-btn phqc-btn-success" id="phqcExportBtn"    style="display:none;">↓ Export CSV</button>
                    <button class="phqc-btn phqc-btn-map"     id="phqcMapFilterBtn" style="display:none;">🗺 Filter Mismatches</button>
                </div>

                <div class="phqc-status">
                    <div class="phqc-dot" id="phqcDot"></div>
                    <div class="phqc-status-text" id="phqcStatusText">Initializing…</div>
                    <div class="phqc-status-time" id="phqcStatusTime"></div>
                </div>

                <div id="phqcResults"></div>
            </div>

            <div class="phqc-resize-w"  id="phqcResizeW"></div>
            <div class="phqc-resize-se" id="phqcResizeHandle"></div>
        `;
        document.body.appendChild(toolBox);

        const $  = (sel) => toolBox.querySelector(sel);
        const $r = () => $('#phqcResults');

        // ── Status ────────────────────────────────────────────────────────────
        function setStatus(text, state = 'idle') {
            $('#phqcStatusText').textContent = text;
            $('#phqcDot').className = 'phqc-dot ' + state;
            if (state !== 'running') {
                const t = new Date();
                $('#phqcStatusTime').textContent =
                    [t.getHours(), t.getMinutes(), t.getSeconds()].map(n => String(n).padStart(2,'0')).join(':');
            } else {
                $('#phqcStatusTime').textContent = '';
            }
        }

        // ── Drag ──────────────────────────────────────────────────────────────
        let dragging = false, dOX = 0, dOY = 0;
        $('#phqcHeader').addEventListener('mousedown', e => {
            if (e.target.closest('button')) return;
            dragging = true;
            const r = toolBox.getBoundingClientRect();
            dOX = e.clientX - r.left; dOY = e.clientY - r.top;
            toolBox.style.transition = 'none'; toolBox.style.right = 'auto';
            e.preventDefault();
        });

        // ── Resize ────────────────────────────────────────────────────────────
        const MIN_W = 380, MIN_H = 220;
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
        $('#phqcResizeHandle').addEventListener('mousedown', e => startResize(e, 'se'));
        $('#phqcResizeW').addEventListener('mousedown',      e => startResize(e, 'w'));
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
        $('#phqcMinBtn').addEventListener('click', () => {
            minimized = !minimized;
            $('#phqcBody').style.display = minimized ? 'none' : '';
            $('#phqcMinBtn').textContent = minimized ? '+' : '−';
            toolBox.style.height = minimized ? 'auto' : (toolBox.offsetHeight || 520) + 'px';
        });

        // ── ESC to close ──────────────────────────────────────────────────────
        function onKey(e) { if (e.key === 'Escape') closeTool(); }
        document.addEventListener('keydown', onKey);

        // ── WO dropdown ───────────────────────────────────────────────────────
        function renderDropdown(filter) {
            const q = (filter || '').toLowerCase();
            const matches = q ? allWorkOrders.filter(v => v.toLowerCase().includes(q)) : allWorkOrders;
            $('#phqcWoDropdown').innerHTML = matches.length
                ? matches.map(v => `<div class="phqc-wo-opt${v === selectedWO ? ' sel' : ''}" data-v="${v}">${v}</div>`).join('')
                : '<div class="phqc-wo-empty">No work orders found</div>';
        }
        function positionDropdown() {
            const r = $('#phqcWoWrapper').getBoundingClientRect(), dd = $('#phqcWoDropdown');
            dd.style.top = (r.bottom + 3) + 'px';
            dd.style.left = r.left + 'px';
            dd.style.width = r.width + 'px';
        }
        function openDropdown()  { renderDropdown($('#phqcWoSearch').value); positionDropdown(); $('#phqcWoDropdown').style.display = 'block'; woDropdownOpen = true; }
        function closeDropdown() { $('#phqcWoDropdown').style.display = 'none'; woDropdownOpen = false; }
        function selectWO(v) {
            selectedWO = v;
            $('#phqcWoSearch').value = v;
            $('#phqcWoClear').style.display = v ? 'inline' : 'none';
            closeDropdown();
            if (v) {
                const rect = toolBox.getBoundingClientRect();
                toolBox.style.top = '20px'; toolBox.style.left = rect.left + 'px';
                toolBox.style.right = 'auto';
                toolBox.style.height = (window.innerHeight - 40) + 'px';
                toolBox.style.maxHeight = 'none';
            }
        }
        $('#phqcWoSearch').addEventListener('focus', openDropdown);
        $('#phqcWoSearch').addEventListener('input', () => { renderDropdown($('#phqcWoSearch').value); if (!woDropdownOpen) openDropdown(); });
        $('#phqcWoDropdown').addEventListener('mousedown', e => { const o = e.target.closest('.phqc-wo-opt'); if (o) selectWO(o.dataset.v); });
        $('#phqcWoClear').addEventListener('click', () => { selectWO(''); $('#phqcWoSearch').focus(); });
        document.addEventListener('mousedown', e => { if (woDropdownOpen && !$('#phqcWoWrapper').contains(e.target)) closeDropdown(); });

        // ── Helpers ───────────────────────────────────────────────────────────
        function getLayer(id)  { return mapView.map.allLayers.find(l => l.type === 'feature' && l.layerId === id) || null; }
        function findTrackingTable() {
            return mapView.map.allTables?.find(t => t.layerId === TRACKING_TABLE_ID) ||
                   mapView.map.allLayers?.find(i => i.type === 'table' && i.layerId === TRACKING_TABLE_ID) || null;
        }
        function findField(table, name) {
            return (table.fields || []).find(f => f?.name?.toLowerCase() === name.toLowerCase()) || null;
        }

        // ── Map filter ────────────────────────────────────────────────────────
        function clearMapFilter() {
            const pl = getLayer(POTHOLE_LAYER_ID);
            if (pl) { pl.definitionExpression = null; pl.labelsVisible = false; }
            mapFilterActive = false;
            $('#phqcMapFilterBtn').textContent = '🗺 Filter Mismatches';
            $('#phqcMapFilterBtn').classList.remove('active');
        }
        function applyMapFilter() {
            if (!pendingOids?.oids?.length) return;
            const pl = getLayer(POTHOLE_LAYER_ID);
            if (!pl) { setStatus('Pothole layer not found for filter', 'error'); return; }
            pl.definitionExpression = 'objectid IN (' + pendingOids.oids.join(',') + ')';
            mapFilterActive = true;
            $('#phqcMapFilterBtn').textContent = '✕ Clear Filter';
            $('#phqcMapFilterBtn').classList.add('active');
        }
        $('#phqcMapFilterBtn').addEventListener('click', () => { mapFilterActive ? clearMapFilter() : applyMapFilter(); });

        // ── Zoom ──────────────────────────────────────────────────────────────
        window.phqcZoomTo = function (oid) {
            const pl = getLayer(POTHOLE_LAYER_ID);
            if (!pl) { alert('Pothole layer not found'); return; }
            setStatus('Zooming to pothole…', 'running');
            pl.queryFeatures({ where:'objectid = ' + oid, outFields:['objectid'], returnGeometry:true })
                .then(r => r.features[0]?.geometry && mapView.goTo({ target:r.features[0].geometry, scale:1000 }))
                .then(() => setStatus('Zoomed to pothole OID: ' + oid, 'ready'))
                .catch(e => setStatus('Zoom error: ' + e.message, 'error'));
        };

        // ── CSV ───────────────────────────────────────────────────────────────
        function csvEsc(v) {
            if (v == null) return '';
            v = String(v);
            return /[,"\n]/.test(v) ? '"' + v.replace(/"/g,'""') + '"' : v;
        }
        function exportToCSV() {
            if (!exportData.length) { alert('No data to export. Run check first.'); return; }
            let out = 'data:text/csv;charset=utf-8,';
            out += 'Pothole GIS ID,Pothole OID,Labor Code,Tracking Qty,Pothole Footage,Difference,Status\n';
            for (const r of exportData) {
                out += [csvEsc(r.potholeGisId), r.potholeOid, csvEsc(r.laborCode),
                        r.trackingQty, r.footage, r.difference, csvEsc(r.status)].join(',') + '\n';
            }
            const a = document.createElement('a');
            a.href = encodeURI(out);
            a.download = 'pothole_qty_check_' + selectedWO + '_' + new Date().toISOString().slice(0,10) + '.csv';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
        }

        // ── Load work orders ──────────────────────────────────────────────────
        function loadWorkOrders() {
            setStatus('Loading work orders…', 'running');
            const pl = getLayer(POTHOLE_LAYER_ID);
            if (!pl) { setStatus('Pothole layer (' + POTHOLE_LAYER_ID + ') not found', 'error'); return; }
            pl.load()
                .then(() => pl.queryFeatures({ where:"workorder_id IS NOT NULL AND workorder_id <> ''", outFields:['workorder_id'], returnGeometry:false, returnDistinctValues:true }))
                .then(r => {
                    const seen = {};
                    allWorkOrders = [];
                    for (const f of r.features) {
                        const v = String(f.attributes.workorder_id || '').trim();
                        if (v && !seen[v]) { allWorkOrders.push(v); seen[v] = true; }
                    }
                    allWorkOrders.sort();
                    $('#phqcWoSearch').placeholder = 'Search ' + allWorkOrders.length + ' work orders…';
                    setStatus('Ready — ' + allWorkOrders.length + ' work orders loaded', 'ready');
                })
                .catch(e => setStatus('Error loading work orders: ' + (e.message || e), 'error'));
        }

        // ── Reset ─────────────────────────────────────────────────────────────
        function resetAll() {
            clearMapFilter();
            exportData = []; pendingOids = null;
            $r().innerHTML = '';
            $('#phqcExportBtn').style.display = $('#phqcMapFilterBtn').style.display = 'none';
            setStatus('Reset complete', 'ready');
        }

        // ── Main analysis ─────────────────────────────────────────────────────
        async function runCheck() {
            if (!selectedWO) { alert('Please select a work order'); return; }

            setStatus('Running check for ' + selectedWO + '…', 'running');
            $r().innerHTML = ''; exportData = []; pendingOids = null; mapFilterActive = false;
            clearMapFilter();
            $('#phqcExportBtn').style.display = $('#phqcMapFilterBtn').style.display = 'none';

            const table = findTrackingTable();
            if (!table) { setStatus('Tracking table (layerId ' + TRACKING_TABLE_ID + ') not found', 'error'); return; }

            const potholeLayer = getLayer(POTHOLE_LAYER_ID);
            if (!potholeLayer) { setStatus('Pothole layer (layerId ' + POTHOLE_LAYER_ID + ') not found', 'error'); return; }

            try {
                await table.load();
                await potholeLayer.load();

                // ── Find workorder field in tracking table ─────────────────
                let woField = null;
                for (const f of (table.fields || []))
                    if (f?.name?.toLowerCase().includes('workorder')) { woField = f; break; }
                if (!woField) throw new Error('No workorder field in tracking table');

                const lcField = findField(table, 'labor_code');
                if (!lcField) throw new Error('Field "labor_code" not found in tracking table');

                // ── Locate the GUID link field ─────────────────────────────
                // Try exact config name first, then scan for any *_guid or *pothole* field
                let guidField = findField(table, POTHOLE_GUID_FIELD);
                if (!guidField) {
                    for (const f of (table.fields || [])) {
                        const n = f?.name?.toLowerCase() || '';
                        if (n.includes('pothole') || (n.includes('guid') && n !== 'globalid')) { guidField = f; break; }
                    }
                }
                if (!guidField) throw new Error(
                    'Cannot locate pothole GUID link field. Set POTHOLE_GUID_FIELD at top of script. ' +
                    'Available fields: ' + table.fields.map(f => f.name).join(', ')
                );

                // ── Query tracking records for this WO ─────────────────────
                const trackingResult = await table.queryFeatures({
                    where: woField.name + " = '" + selectedWO + "'",
                    outFields: ['*'],
                    returnGeometry: false
                });

                if (!trackingResult.features.length)
                    throw new Error('No tracking records found for work order: ' + selectedWO);

                // Build guid → { qty, laborCode } map (max-qty wins per guid)
                const guidMap = {}; // guid → { qty, laborCode }
                let skippedNoGuid = 0;
                for (const feat of trackingResult.features) {
                    const a     = feat.attributes;
                    const guid  = a[guidField.name];
                    const qty   = a.quantity || 0;
                    const code  = a[lcField.name] || 'Unknown';
                    if (!guid) { skippedNoGuid++; continue; }
                    if (guidMap[guid] === undefined || qty > guidMap[guid].qty) {
                        guidMap[guid] = { qty, laborCode: code };
                    }
                }

                const guids = Object.keys(guidMap);
                if (!guids.length) throw new Error('No tracking records with a pothole GUID link found. Check field: ' + guidField.name);

                // ── Query pothole features by globalid ─────────────────────
                const gList = "'" + guids.join("','") + "'";
                const potholeResult = await potholeLayer.queryFeatures({
                    where: 'globalid IN (' + gList + ')',
                    outFields: ['objectid', 'globalid', 'gis_id', FOOTAGE_FIELD],
                    returnGeometry: true
                });

                const potholeFeats = potholeResult.features;

                // ── Verify footage field exists ────────────────────────────
                if (potholeFeats.length && !(FOOTAGE_FIELD in potholeFeats[0].attributes)) {
                    const avail = Object.keys(potholeFeats[0].attributes).join(', ');
                    throw new Error(`Footage field "${FOOTAGE_FIELD}" not found on pothole layer. Available: ${avail}`);
                }

                // ── Compare ────────────────────────────────────────────────
                const mismatches = [], matched = [], orphaned = [];

                // Features found in pothole layer
                const foundGuids = new Set(potholeFeats.map(f => f.attributes.globalid));

                for (const feat of potholeFeats) {
                    const a       = feat.attributes;
                    const guid    = a.globalid;
                    const footage = a[FOOTAGE_FIELD];
                    const gisId   = a.gis_id || a.objectid;
                    const oid     = a.objectid;
                    const { qty: trackQty, laborCode } = guidMap[guid];
                    const diff    = trackQty - footage;

                    const row = { potholeGisId: gisId, potholeOid: oid, laborCode, trackingQty: trackQty, footage, difference: diff };

                    if (footage == null || footage === '') {
                        row.status = 'No Footage';
                        mismatches.push({ ...row, noFootage: true, geometry: feat.geometry });
                    } else if (diff !== 0) {
                        row.status = 'Mismatch';
                        mismatches.push({ ...row, geometry: feat.geometry });
                    } else {
                        row.status = 'Match';
                        matched.push(row);
                    }
                    exportData.push(row);
                }

                // Tracking records whose guid wasn't in pothole layer
                for (const guid of guids) {
                    if (!foundGuids.has(guid)) orphaned.push(guid);
                }

                // ── Build results HTML ─────────────────────────────────────
                let html = '';

                // Summary cards
                const totalLinked = guids.length;
                const nMatch   = matched.length;
                const nMismatch = mismatches.length;
                html +=
                    `<div class="phqc-sec-title">Summary — Work Order: <span class="phqc-chip">${selectedWO}</span></div>` +
                    `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">` +
                    sumCard('Linked', totalLinked, '#6366f1', '#eef2ff') +
                    sumCard('Match',  nMatch,      '#059669', '#d1fae5') +
                    sumCard('Mismatch', nMismatch, nMismatch ? '#dc2626' : '#059669', nMismatch ? '#fee2e2' : '#d1fae5') +
                    (orphaned.length ? sumCard('Not Found', orphaned.length, '#d97706', '#fef3c7') : '') +
                    (skippedNoGuid  ? sumCard('No GUID',  skippedNoGuid,   '#94a3b8', '#f1f5f9') : '') +
                    `</div>`;

                function sumCard(label, val, color, bg) {
                    return `<div style="flex:1;min-width:70px;background:${bg};border-radius:5px;padding:6px 10px;text-align:center;">` +
                           `<div style="font-size:18px;font-weight:700;color:${color};">${val}</div>` +
                           `<div style="font-size:9px;color:${color};font-weight:600;text-transform:uppercase;letter-spacing:.5px;">${label}</div>` +
                           `</div>`;
                }

                // Mismatch table
                if (mismatches.length) {
                    html +=
                        `<div class="phqc-sec-title">Mismatches <span class="phqc-pill phqc-pill-bad">${mismatches.length}</span></div>` +
                        `<div class="phqc-tbl-wrap"><table class="phqc-tbl"><thead><tr>` +
                        `<th>Pothole ID</th><th>Labor Code</th><th>Tracking Qty</th><th>Footage</th><th>Diff</th><th>Zoom</th>` +
                        `</tr></thead><tbody>`;

                    for (const m of mismatches) {
                        const abs  = Math.abs(m.difference);
                        const dCls = m.noFootage ? 'phqc-diff' : (abs <= 5 ? 'phqc-diff low' : 'phqc-diff');
                        const diffTxt = m.noFootage ? '—' : (m.difference > 0 ? '+' : '') + m.difference;
                        html +=
                            `<tr>` +
                            `<td>${m.potholeGisId}</td>` +
                            `<td><span class="phqc-chip">${m.laborCode}</span></td>` +
                            `<td>${m.trackingQty}</td>` +
                            `<td>${m.noFootage ? '<span style="color:#dc2626;font-weight:700;">NULL</span>' : m.footage}</td>` +
                            `<td class="${dCls}">${diffTxt}</td>` +
                            `<td><button class="phqc-zbtn" style="background:#f59e0b;" onclick="phqcZoomTo(${m.potholeOid})">Zoom</button></td>` +
                            `</tr>`;
                    }
                    html += '</tbody></table></div>';
                } else {
                    html += `<div class="phqc-ok-msg">✓ All ${potholeFeats.length} pothole features match their tracking quantities</div>`;
                }

                // Orphaned GUIDs
                if (orphaned.length) {
                    html +=
                        `<div class="phqc-warn-msg">⚠ ${orphaned.length} tracking record(s) reference a pothole GUID not found in the pothole layer.</div>`;
                }

                $r().innerHTML = html;

                // ── Map filter setup ──────────────────────────────────────
                const mismatchOids = mismatches.map(m => m.potholeOid);
                if (mismatchOids.length) {
                    pendingOids = { potholeLayer, oids: mismatchOids };
                    $('#phqcMapFilterBtn').style.display = 'inline-flex';
                }
                if (exportData.length) $('#phqcExportBtn').style.display = 'inline-flex';

                // Zoom to all WO pothole features
                const allGeoms = potholeFeats.filter(f => f.geometry).map(f => f.geometry);
                const done = () => setStatus(
                    'Check complete — ' + nMismatch + ' mismatch' + (nMismatch !== 1 ? 'es' : '') +
                    ' out of ' + totalLinked + ' features', nMismatch > 0 ? 'warn' : 'ready'
                );
                if (allGeoms.length) mapView.goTo(allGeoms).then(done).catch(done);
                else done();

            } catch (err) {
                setStatus('Error: ' + (err.message || err), 'error');
                console.error('Pothole check error:', err);
            }
        }

        // ── Close ─────────────────────────────────────────────────────────────
        function closeTool() {
            clearMapFilter();
            toolBox.remove();
            document.removeEventListener('keydown', onKey);
            document.getElementById(STYLE_ID)?.remove();
            if (window.gisToolHost?.activeTools instanceof Set)
                window.gisToolHost.activeTools.delete('pothole-qty-check');
            delete window.phqcZoomTo;
        }

        // ── Wire events ───────────────────────────────────────────────────────
        $('#phqcRunBtn').addEventListener('click', runCheck);
        $('#phqcResetBtn').addEventListener('click', resetAll);
        $('#phqcExportBtn').addEventListener('click', exportToCSV);
        $('#phqcCloseBtn').addEventListener('click', closeTool);

        // ── Boot ──────────────────────────────────────────────────────────────
        loadWorkOrders();
        window.gisToolHost.activeTools.add('pothole-qty-check');

    } catch (err) {
        console.error('Tool init error:', err);
        alert('Error initializing Pothole Qty Check Tool: ' + (err.message || err));
    }
})();
