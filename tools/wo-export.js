// tools/wo-export.js - Work Order Data Export Tool
// Exports raw feature data from all target layers to Google Sheets via Apps Script

(function () {
    try {
        if (window.gisToolHost.activeTools.has('wo-export')) {
            console.log('WO Export Tool already active');
            return;
        }

        const existingToolbox = document.getElementById('woExportToolbox');
        if (existingToolbox) {
            existingToolbox.remove();
        }

        const utils = window.gisSharedUtils;
        if (!utils) throw new Error('Shared utilities not loaded');

        const mapView = utils.getMapView();

        // ---------------------------------------------------------------
        // CONFIGURATION
        // ---------------------------------------------------------------
        const APPS_SCRIPT_URL = 'https://script.google.com/a/macros/ervincable.com/s/AKfycbw624n786AYJdVMVxDYRMNpwhuUN6Ig2hKRECZ5paMWF3Ja1FH5U6arSgqR2W5DudPR/exec';

        const targetLayers = [
            { id: 41050, name: "Fiber Cable",       metric: "sum",   field: "calculated_length", additionalFilter: "cable_category <> 'DROP'" },
            { id: 42050, name: "Underground Span",  metric: "sum",   field: "calculated_length" },
            { id: 43050, name: "Aerial Span",       metric: "sum",   field: "calculated_length", additionalFilter: "physical_status <> 'EXISTINGINFRASTRUCTURE'" },
            { id: 42100, name: "Vault",             metric: "count", field: "objectid" },
            { id: 41150, name: "Splice Closure",    metric: "count", field: "objectid" },
            { id: 41100, name: "Fiber Equipment",   metric: "count", field: "objectid" }
        ];

        const z = 99999;

        // ---------------------------------------------------------------
        // STATE
        // ---------------------------------------------------------------
        let selectedPurchaseOrders = [];
        let allPurchaseOrders = [];
        let selectedLayers = targetLayers.map((_, i) => i);
        let isExporting = false;

        // ---------------------------------------------------------------
        // STYLES
        // ---------------------------------------------------------------
        const styles = document.createElement('style');
        styles.textContent = `
            @keyframes wo-export-spin {
                0%   { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            .wo-export-spinner {
                display: inline-block;
                width: 13px; height: 13px;
                border: 2px solid #f3f3f3;
                border-top: 2px solid #3367d6;
                border-radius: 50%;
                animation: wo-export-spin 1s linear infinite;
                margin-right: 6px;
                vertical-align: middle;
            }
            #woExportToolbox .layer-row {
                display: flex; align-items: center; gap: 6px; padding: 3px 0;
            }
            #woExportToolbox .color-box {
                width: 14px; height: 14px; border-radius: 3px; border: 1px solid #ccc; flex-shrink: 0;
            }
            #woExportToolbox .export-btn {
                width: 100%; padding: 9px; font-size: 13px; font-weight: bold;
                background: #1e8c45; color: #fff; border: none; border-radius: 4px;
                cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;
            }
            #woExportToolbox .export-btn:disabled { background: #aaa; cursor: not-allowed; }
            #woExportToolbox .export-btn:hover:not(:disabled) { background: #176e36; }
            #woExportToolbox .result-link {
                display: block; margin-top: 8px; padding: 8px;
                background: #e8f5e9; border: 1px solid #81c784; border-radius: 4px;
                color: #2e7d32; font-size: 11px; text-decoration: none; text-align: center;
                font-weight: bold;
            }
            #woExportToolbox .result-link:hover { background: #c8e6c9; }
            #woExportToolbox .status-bar {
                padding: 6px 8px; border-radius: 3px; font-size: 11px;
                margin-top: 8px; display: none;
            }
            #woExportToolbox .layer-progress {
                font-size: 10px; color: #666; margin-top: 4px;
                font-style: italic; min-height: 14px;
            }
            #woExportToolbox .dropdown-option:hover { background: #e3f2fd !important; }
        `;
        document.head.appendChild(styles);

        // ---------------------------------------------------------------
        // LAYER COLORS (match dashboard)
        // ---------------------------------------------------------------
        const layerColors = ["#2196F3","#795548","#9C27B0","#607D8B","#FF9800","#4CAF50"];

        // ---------------------------------------------------------------
        // BUILD UI
        // ---------------------------------------------------------------
        const toolBox = document.createElement('div');
        toolBox.id = 'woExportToolbox';
        toolBox.style.cssText = `
            position: fixed; top: 80px; right: 40px; z-index: ${z};
            background: #fff; border: 1px solid #333; padding: 12px;
            width: 340px; max-height: 85vh; overflow: auto;
            font: 12px/1.4 Arial, sans-serif;
            box-shadow: 0 4px 16px rgba(0,0,0,.2);
        `;

        toolBox.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <div style="font-weight:bold;font-size:14px;">📤 Export to Google Sheets</div>
                <button id="weCloseBtn" style="padding:3px 8px;font-size:11px;cursor:pointer;">✖ Close</button>
            </div>

            <!-- Purchase Order filter -->
            <div style="background:#f8f9fa;padding:10px;border-radius:4px;margin-bottom:10px;">
                <label style="font-weight:bold;display:block;margin-bottom:6px;">🎯 Filters <span style="font-weight:normal;color:#888;">(optional)</span></label>

                <label style="display:block;margin-bottom:3px;font-size:11px;">Purchase Order:</label>
                <div style="position:relative;margin-bottom:10px;">
                    <div id="wePoDropdown" style="border:1px solid #ccc;padding:5px 8px;background:#fff;cursor:pointer;border-radius:3px;font-size:11px;">
                        <span id="wePoPH" style="color:#999;"><span class="wo-export-spinner"></span>Loading...</span>
                    </div>
                    <div id="wePoOptions" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid #ccc;border-top:none;max-height:140px;overflow-y:auto;z-index:1000;border-radius:0 0 3px 3px;">
                        <div style="padding:4px;background:#f5f5f5;border-bottom:1px solid #ddd;display:flex;gap:4px;">
                            <button id="wePoAll" style="flex:1;padding:3px;font-size:11px;cursor:pointer;">All</button>
                            <button id="wePoNone" style="flex:1;padding:3px;font-size:11px;cursor:pointer;">Clear</button>
                        </div>
                        <div id="wePoList"></div>
                    </div>
                </div>

                <!-- Layer selector -->
                <label style="font-weight:bold;display:block;margin-bottom:6px;">📋 Layers to Export:</label>
                <div id="weLayerList" style="display:grid;grid-template-columns:1fr 1fr;gap:2px;"></div>
            </div>

            <!-- Export button -->
            <button class="export-btn" id="weExportBtn">
                <span>📊</span><span id="weExportBtnLabel">Export All Data</span>
            </button>

            <!-- Progress indicator -->
            <div class="layer-progress" id="weProgress"></div>

            <!-- Status bar -->
            <div class="status-bar" id="weStatus"></div>

            <!-- Result link (shown after successful export) -->
            <div id="weResultArea"></div>
        `;

        document.body.appendChild(toolBox);

        // ---------------------------------------------------------------
        // HELPERS
        // ---------------------------------------------------------------
        const $ = id => toolBox.querySelector(id);

        function setStatus(msg, type = 'info') {
            const el = $('#weStatus');
            if (!msg) { el.style.display = 'none'; return; }
            const bg = { info:'#e3f2fd', success:'#e8f5e9', error:'#ffebee', processing:'#f3e5f5' };
            const ic = { info:'ℹ️', success:'✅', error:'❌', processing:'⏳' };
            el.style.cssText = `display:block;padding:6px 8px;border-radius:3px;font-size:11px;margin-top:8px;background:${bg[type]};color:#333;`;
            el.textContent = `${ic[type]} ${msg}`;
        }

        function setProgress(msg) {
            $('#weProgress').textContent = msg;
        }

        function buildFilterClause() {
            if (selectedPurchaseOrders.length > 0 && selectedPurchaseOrders.length < allPurchaseOrders.length) {
                const list = selectedPurchaseOrders.map(p => `purchase_order_id='${p.replace(/'/g,"''")}'`).join(' OR ');
                return `(${list})`;
            }
            return '1=1';
        }

        // ---------------------------------------------------------------
        // POPULATE LAYER CHECKBOXES
        // ---------------------------------------------------------------
        function initLayers() {
            const container = $('#weLayerList');
            container.innerHTML = targetLayers.map((l, i) => `
                <label class="layer-row" style="cursor:pointer;">
                    <input type="checkbox" class="we-layer-cb" data-i="${i}" checked>
                    <span class="color-box" style="background:${layerColors[i]};"></span>
                    <span style="font-size:11px;">${l.name}</span>
                </label>
            `).join('');

            container.querySelectorAll('.we-layer-cb').forEach(cb => {
                cb.addEventListener('change', e => {
                    const i = parseInt(e.target.dataset.i);
                    if (e.target.checked) {
                        if (!selectedLayers.includes(i)) { selectedLayers.push(i); selectedLayers.sort((a,b)=>a-b); }
                    } else {
                        selectedLayers = selectedLayers.filter(x => x !== i);
                    }
                });
            });
        }
        initLayers();

        // ---------------------------------------------------------------
        // LOAD PURCHASE ORDERS
        // ---------------------------------------------------------------
        async function loadPOs() {
            try {
                const fiberLayer = mapView.map.allLayers.find(l => l.layerId === 41050);
                if (!fiberLayer) { $('#wePoPH').textContent = 'Fiber layer not found'; return; }

                await fiberLayer.load();
                const result = await fiberLayer.queryFeatures({
                    where: "purchase_order_id IS NOT NULL AND purchase_order_id <> ''",
                    outFields: ["purchase_order_id"],
                    returnGeometry: false,
                    returnDistinctValues: true
                });

                const vals = [...new Set(result.features.map(f => f.attributes.purchase_order_id).filter(Boolean))].sort();

                let purchaseField;
                try { purchaseField = fiberLayer.fields.find(f => f.name === 'purchase_order_id'); } catch(e) {}

                allPurchaseOrders = vals.map(v => {
                    let name = v;
                    if (purchaseField?.domain?.codedValues) {
                        const cv = purchaseField.domain.codedValues.find(c => c.code === v);
                        if (cv) name = cv.name;
                    }
                    return { code: v.toString(), name };
                });

                if (!allPurchaseOrders.length) { $('#wePoPH').textContent = 'No purchase orders found'; return; }

                $('#wePoList').innerHTML = allPurchaseOrders.map(po => `
                    <div class="dropdown-option we-po-opt" data-v="${po.code.replace(/"/g,'&quot;')}"
                         style="padding:5px 8px;cursor:pointer;border-bottom:1px solid #eee;font-size:11px;">
                        <input type="checkbox" style="margin-right:5px;"> ${po.name}
                    </div>
                `).join('');

                $('#wePoPH').textContent = 'All Purchase Orders';
                $('#wePoPH').style.color = '#333';

                $('#wePoAll').onclick = e => {
                    e.stopPropagation();
                    selectedPurchaseOrders = allPurchaseOrders.map(p => p.code);
                    $('#wePoList').querySelectorAll('input').forEach(cb => cb.checked = true);
                    updatePODisplay();
                };
                $('#wePoNone').onclick = e => {
                    e.stopPropagation();
                    selectedPurchaseOrders = [];
                    $('#wePoList').querySelectorAll('input').forEach(cb => cb.checked = false);
                    updatePODisplay();
                };
                $('#wePoDropdown').onclick = () => {
                    $('#wePoOptions').style.display = $('#wePoOptions').style.display === 'none' ? 'block' : 'none';
                };
                $('#wePoList').addEventListener('click', e => {
                    const opt = e.target.classList.contains('we-po-opt') ? e.target : e.target.parentElement;
                    if (!opt.classList.contains('we-po-opt')) return;
                    const cb = opt.querySelector('input');
                    cb.checked = !cb.checked;
                    const v = opt.dataset.v;
                    if (cb.checked) { if (!selectedPurchaseOrders.includes(v)) selectedPurchaseOrders.push(v); }
                    else { selectedPurchaseOrders = selectedPurchaseOrders.filter(p => p !== v); }
                    updatePODisplay();
                    e.stopPropagation();
                });

            } catch (err) {
                console.error('WO Export: error loading POs', err);
                $('#wePoPH').textContent = 'Error loading';
            }
        }

        function updatePODisplay() {
            const ph = $('#wePoPH');
            const sel = selectedPurchaseOrders.length;
            const tot = allPurchaseOrders.length;
            if (sel === 0 || sel === tot) { ph.textContent = 'All Purchase Orders'; }
            else if (sel === 1) { ph.textContent = allPurchaseOrders.find(p => p.code === selectedPurchaseOrders[0])?.name || selectedPurchaseOrders[0]; }
            else { ph.textContent = `${sel} of ${tot} selected`; }
            ph.style.color = '#333';
        }

        // ---------------------------------------------------------------
        // CORE EXPORT LOGIC
        // ---------------------------------------------------------------
        async function runExport() {
            if (isExporting) return;

            if (selectedLayers.length === 0) { alert('Please select at least one layer.'); return; }
            if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes('YOUR_APPS')) {
                alert('Please set your Apps Script URL in the CONFIGURATION section of the tool code.');
                return;
            }

            isExporting = true;
            const btn = $('#weExportBtn');
            btn.disabled = true;
            $('#weExportBtnLabel').innerHTML = '<span class="wo-export-spinner"></span>Exporting...';
            $('#weResultArea').innerHTML = '';
            setStatus('Starting export...', 'processing');

            try {
                const filterClause = buildFilterClause();
                const allFL = mapView.map.allLayers.filter(l => l.type === 'feature');
                const exportedAt = new Date().toISOString();
                const layersPayload = [];

                // -- Query each selected layer --
                for (const idx of selectedLayers) {
                    const tl = targetLayers[idx];
                    const layer = allFL.find(l => l.layerId === tl.id);

                    if (!layer) {
                        console.warn(`WO Export: layer ${tl.name} (${tl.id}) not found, skipping`);
                        setProgress(`⚠️ ${tl.name} not found — skipping`);
                        continue;
                    }

                    setProgress(`Querying ${tl.name}...`);
                    setStatus(`Querying ${tl.name}...`, 'processing');

                    await layer.load();

                    let whereClause = filterClause;
                    if (tl.additionalFilter) {
                        whereClause = `(${filterClause}) AND ${tl.additionalFilter}`;
                    }

                    const result = await layer.queryFeatures({
                        where: whereClause,
                        outFields: ['*'],
                        returnGeometry: false
                    });

                    // Extract field names from the layer definition (preserves order)
                    const fields = layer.fields
                        ? layer.fields.map(f => f.name)
                        : (result.features.length > 0 ? Object.keys(result.features[0].attributes) : []);

                    // Serialize features as flat attribute objects
                    const features = result.features.map(f => f.attributes);

                    setProgress(`${tl.name}: ${features.length.toLocaleString()} features`);

                    layersPayload.push({
                        layerId:      tl.id,
                        layerName:    tl.name,
                        featureCount: features.length,
                        fields:       fields,
                        features:     features
                    });
                }

                // -- Build full payload --
                const payload = {
                    exportedAt,
                    filters: {
                        purchaseOrders: selectedPurchaseOrders.length > 0 && selectedPurchaseOrders.length < allPurchaseOrders.length
                            ? selectedPurchaseOrders
                            : 'ALL',
                        note: buildFilterClause() === '1=1' ? 'No filters applied — full dataset' : 'Filtered by purchase order(s)'
                    },
                    totalLayers:   layersPayload.length,
                    totalFeatures: layersPayload.reduce((s, l) => s + l.featureCount, 0),
                    layers:        layersPayload
                };

                setProgress(`Sending ${payload.totalFeatures.toLocaleString()} features to Google Sheets...`);
                setStatus('Sending data to Google Sheets...', 'processing');

                // -- POST to Apps Script --
                const response = await fetch(APPS_SCRIPT_URL, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify(payload)
                });

                if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

                const data = await response.json();

                if (data.status !== 'success') throw new Error(data.message || 'Unknown error from Apps Script');

                // -- Success --
                setProgress('');
                setStatus(`Export complete — ${payload.totalFeatures.toLocaleString()} features across ${payload.totalLayers} layers`, 'success');

                $('#weResultArea').innerHTML = `
                    <a class="result-link" href="${data.fileUrl}" target="_blank">
                        🔗 Open Export in Google Sheets
                    </a>
                    <div style="font-size:10px;color:#666;margin-top:4px;text-align:center;">
                        Saved to Drive: ${data.fileName || 'Export file'}
                    </div>
                `;

            } catch (err) {
                console.error('WO Export error:', err);
                setProgress('');
                setStatus('Export failed: ' + err.message, 'error');
            }

            isExporting = false;
            btn.disabled = false;
            $('#weExportBtnLabel').textContent = 'Export All Data';
        }

        // ---------------------------------------------------------------
        // EVENT LISTENERS
        // ---------------------------------------------------------------
        $('#weExportBtn').onclick = runExport;
        $('#weCloseBtn').onclick = () => window.gisToolHost.closeTool('wo-export');

        document.addEventListener('click', e => {
            if (!toolBox.contains(e.target)) {
                $('#wePoOptions').style.display = 'none';
            }
        });

        // ---------------------------------------------------------------
        // CLEANUP
        // ---------------------------------------------------------------
        function cleanup() {
            if (styles?.parentNode) styles.parentNode.removeChild(styles);
            toolBox.remove();
            console.log('WO Export Tool cleaned up');
        }

        // ---------------------------------------------------------------
        // INIT
        // ---------------------------------------------------------------
        loadPOs();

        window.gisToolHost.activeTools.set('wo-export', {
            cleanup,
            toolBox
        });

        console.log('WO Export Tool loaded successfully');

    } catch (err) {
        console.error('Error loading WO Export Tool:', err);
        alert('Error loading WO Export Tool: ' + (err.message || err));
    }
})();
