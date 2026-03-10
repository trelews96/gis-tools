// tools/parent-child-reconciliation.js
// Parent/Child Code Reconciliation Tool
// Improvements: max-quantity-wins per GUID, dynamic labor code filter UI

(function () {
    try {
        if (!window.gisToolHost) window.gisToolHost = {};
        if (!window.gisToolHost.activeTools || !(window.gisToolHost.activeTools instanceof Set)) {
            console.warn('Creating new Set for activeTools');
            window.gisToolHost.activeTools = new Set();
        }
        if (window.gisToolHost.activeTools.has('parent-child-reconciliation')) {
            console.log('Parent/Child Reconciliation Tool already active');
            return;
        }

        const existingToolbox = document.getElementById('parentChildReconciliationToolbox');
        if (existingToolbox) existingToolbox.remove();

        const utils = window.gisSharedUtils;
        if (!utils) throw new Error('Shared utilities not loaded');

        const mapView = utils.getMapView();
        let exportData = [];

        // ── Toolbox shell ─────────────────────────────────────────────────────
        const toolBox = document.createElement('div');
        toolBox.id = 'parentChildReconciliationToolbox';
        toolBox.style.cssText = `
            position:fixed;top:20px;right:20px;z-index:99999;
            background:#fff;border:1px solid #333;padding:8px;
            max-width:400px;max-height:85vh;overflow-y:auto;
            font:11px/1.2 Arial;box-shadow:0 4px 16px rgba(0,0,0,.2);border-radius:4px;
        `;

        toolBox.innerHTML = `
            <div style="font-weight:bold;margin-bottom:6px;font-size:12px;">Daily Tracking Analysis</div>

            <label style="font-size:11px;">Work Order ID:</label><br>
            <select id="workorderSelect" style="width:100%;margin:2px 0 6px;padding:3px;font-size:11px;">
                <option>Loading work orders...</option>
            </select>

            <!-- Labor Code Filter (hidden until a WO is chosen) -->
            <div id="laborFilterSection" style="display:none;margin-bottom:6px;border:1px solid #bbb;border-radius:3px;overflow:hidden;">
                <div id="laborFilterToggle"
                     style="background:#f0f4ff;padding:4px 6px;cursor:pointer;font-size:10px;
                            font-weight:bold;display:flex;justify-content:space-between;align-items:center;
                            user-select:none;">
                    <span>⚙ Labor Code Filter</span>
                    <span id="laborFilterArrow" style="font-size:9px;">▼</span>
                </div>
                <div id="laborFilterBody" style="display:none;padding:5px 6px;">
                    <div style="font-size:9px;color:#666;margin-bottom:4px;">
                        Checked codes are included in analysis.
                        <b>Max-quantity record wins</b> when a feature has multiple matching codes.
                    </div>
                    <div style="margin-bottom:4px;display:flex;gap:4px;align-items:center;">
                        <button id="selectAllCodes"  style="padding:2px 6px;font-size:9px;">All</button>
                        <button id="selectNoneCodes" style="padding:2px 6px;font-size:9px;">None</button>
                        <span id="codeSelectionSummary" style="font-size:9px;color:#888;"></span>
                    </div>
                    <div id="laborCodeList"
                         style="max-height:130px;overflow-y:auto;border:1px solid #ddd;
                                padding:3px;border-radius:2px;"></div>
                </div>
            </div>

            <button id="runBtn"    style="padding:4px 8px;margin-right:4px;font-size:10px;">Run Analysis</button>
            <button id="resetBtn"  style="padding:4px 8px;margin-right:4px;font-size:10px;">Reset</button>
            <button id="exportBtn" style="padding:4px 8px;margin-right:4px;font-size:10px;display:none;">Export CSV</button>
            <button id="closeTool" style="padding:4px 8px;font-size:10px;">Close</button>

            <div id="toolStatus"  style="margin-top:6px;color:#3367d6;font-size:10px;"></div>
            <div id="results"     style="margin-top:6px;font-size:10px;"></div>
        `;

        document.body.appendChild(toolBox);

        const $  = (sel) => toolBox.querySelector(sel);
        const updateStatus  = (t)    => { $('#toolStatus').textContent = t; };
        const updateResults = (html) => { $('#results').innerHTML = html; };

        // ── Labor filter panel toggle ──────────────────────────────────────────
        let laborFilterOpen = false;
        $('#laborFilterToggle').addEventListener('click', () => {
            laborFilterOpen = !laborFilterOpen;
            $('#laborFilterBody').style.display  = laborFilterOpen ? 'block' : 'none';
            $('#laborFilterArrow').textContent   = laborFilterOpen ? '▲' : '▼';
        });

        function updateCodeSelectionSummary() {
            const all     = toolBox.querySelectorAll('.laborCodeCheck');
            const checked = toolBox.querySelectorAll('.laborCodeCheck:checked');
            $('#codeSelectionSummary').textContent =
                checked.length + ' / ' + all.length + ' selected';
        }

        $('#selectAllCodes').addEventListener('click', () => {
            toolBox.querySelectorAll('.laborCodeCheck').forEach(cb => cb.checked = true);
            updateCodeSelectionSummary();
        });
        $('#selectNoneCodes').addEventListener('click', () => {
            toolBox.querySelectorAll('.laborCodeCheck').forEach(cb => cb.checked = false);
            updateCodeSelectionSummary();
        });

        /** Returns a Set of checked codes, or null if no checkboxes exist yet. */
        function getCheckedLaborCodes() {
            const boxes = toolBox.querySelectorAll('.laborCodeCheck');
            if (!boxes.length) return null;
            const s = new Set();
            boxes.forEach(cb => { if (cb.checked) s.add(cb.value); });
            return s;
        }

        // ── Utility helpers ───────────────────────────────────────────────────
        function resetFilters() {
            mapView.map.allLayers
                .filter(l => l.type === 'feature')
                .forEach(l => {
                    l.definitionExpression = null;
                    l.labelingInfo  = null;
                    l.labelsVisible = false;
                });
            updateStatus('Filters reset');
            updateResults('');
            exportData = [];
            $('#exportBtn').style.display = 'none';
        }

        function generateURL(type, objectId, geometry) {
            try {
                const base   = window.location.origin + window.location.pathname;
                const params = new URLSearchParams(window.location.search);
                let center = mapView.center, scale = mapView.scale;
                if (geometry?.extent?.center) { center = geometry.extent.center; scale = 2000; }
                params.set('center', center.longitude.toFixed(6) + ',' + center.latitude.toFixed(6));
                params.set('level', Math.round(Math.log2(591657527.591555 / scale)).toString());
                const layerMap = { underground: 42050, aerial: 43050, fiber: 41050 };
                if (layerMap[type]) params.set('highlight', layerMap[type] + ':' + objectId);
                return base + '?' + params.toString();
            } catch { return window.location.href; }
        }

        function escapeCSV(field) {
            if (field == null) return '';
            field = String(field);
            if (/[,"\n]/.test(field)) field = '"' + field.replace(/"/g, '""') + '"';
            return field;
        }

        /** Finds a field by exact name (case-insensitive) and returns it, or null. */
        function findTableField(table, fieldName) {
            return (table.fields || []).find(f => f?.name?.toLowerCase() === fieldName.toLowerCase()) || null;
        }

        function findTrackingTable() {
            return (mapView.map.allTables?.find(t => t.layerId === 90100)) ||
                   (mapView.map.allLayers?.find(i => i.type === 'table' && i.layerId === 90100)) ||
                   null;
        }

        function getFeatureLayer(layerId) {
            return mapView.map.allLayers.find(l => l.type === 'feature' && l.layerId === layerId) || null;
        }

        // ── Zoom helpers ──────────────────────────────────────────────────────
        window.zoomToFeature = function (layerType, objectId) {
            const idMap  = { underground: 42050, aerial: 43050, fiber: 41050 };
            const layer  = getFeatureLayer(idMap[layerType]);
            if (!layer) { alert('Layer not found for zoom'); return; }
            updateStatus('Zooming to ' + layerType + ' feature...');
            layer.queryFeatures({ where: 'objectid = ' + objectId, outFields: ['objectid'], returnGeometry: true })
                .then(r => {
                    if (r.features[0]?.geometry)
                        return mapView.goTo({ target: r.features[0].geometry, scale: 2000 });
                })
                .then(() => {
                    updateStatus('Zoomed to ' + layerType + ' (ID: ' + objectId + ')');
                    setTimeout(() => updateStatus('Analysis complete'), 3000);
                })
                .catch(e => updateStatus('Error zooming: ' + e.message));
        };

        function zoomToLayers(layers) {
            return Promise.all(layers.map(l => l.queryExtent()))
                .then(extents => {
                    const combined = extents.reduce((acc, cur) => acc ? acc.union(cur.extent) : cur.extent, null);
                    if (!combined) return;
                    const exp = combined.expand(1.5);
                    const narrow = (exp.xmax - exp.xmin) < 100 || (exp.ymax - exp.ymin) < 100;
                    return mapView.goTo(narrow ? { target: exp, scale: 5000 } : exp);
                })
                .catch(e => console.error('Error zooming to layers:', e));
        }

        // ── Spatial coincidence ───────────────────────────────────────────────
        function findCoincidentFeatures(spanFeatures, fiberFeatures, tolerance = 2) {
            const pairs = [];
            for (const span of spanFeatures) {
                const sc = span?.geometry?.extent?.center;
                if (!sc) continue;
                for (const fiber of fiberFeatures) {
                    const fc = fiber?.geometry?.extent?.center;
                    if (!fc) continue;
                    const dist = Math.hypot(sc.x - fc.x, sc.y - fc.y);
                    if (dist <= tolerance) pairs.push({ span, fiber, distance: dist });
                }
            }
            return pairs;
        }

        // ── CSV export ────────────────────────────────────────────────────────
        function exportToCSV() {
            if (!exportData.length) { alert('No data to export. Please run analysis first.'); return; }
            let csv = 'data:text/csv;charset=utf-8,';
            csv += 'Comparison Type,Span ID,Fiber ID,Winning Span Code,Winning Fiber Code,' +
                   'Span Qty,Fiber Qty,Difference,Span Map URL,Fiber Map URL\n';
            for (const row of exportData) {
                const spanType = row.type.includes('Underground') ? 'underground' : 'aerial';
                csv += [
                    escapeCSV(row.type),
                    escapeCSV(row.spanId),
                    escapeCSV(row.fiberId),
                    escapeCSV(row.spanLaborCode),
                    escapeCSV(row.fiberLaborCode),
                    row.spanQty,
                    row.fiberQty,
                    row.difference,
                    escapeCSV(generateURL(spanType, row.spanOid, row.spanGeometry)),
                    escapeCSV(generateURL('fiber',   row.fiberOid, row.fiberGeometry))
                ].join(',') + '\n';
            }
            const link = document.createElement('a');
            link.href     = encodeURI(csv);
            link.download = 'quantity_mismatches_' + new Date().toISOString().slice(0, 10) + '.csv';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        // ── Work order loading ────────────────────────────────────────────────
        function loadWorkOrders() {
            updateStatus('Loading work orders...');
            const fiberLayer = getFeatureLayer(41050);
            if (!fiberLayer) {
                $('#workorderSelect').innerHTML = '<option>No fiber layer found (layerId 41050)</option>';
                updateStatus('Error: No fiber layer found (layerId 41050)');
                return;
            }
            fiberLayer.load()
                .then(() => fiberLayer.queryFeatures({
                    where: "workorder_id IS NOT NULL AND workorder_id <> ''",
                    outFields: ['workorder_id'],
                    returnGeometry: false,
                    returnDistinctValues: true
                }))
                .then(r => {
                    const seen = {}, vals = [];
                    for (const f of r.features) {
                        const v = f.attributes.workorder_id;
                        if (v && String(v).trim() && !seen[v]) { vals.push(v); seen[v] = true; }
                    }
                    vals.sort();
                    const sel = $('#workorderSelect');
                    sel.innerHTML = '<option value="">Select Work Order...</option>';
                    vals.forEach(v => {
                        const o = document.createElement('option');
                        o.value = o.textContent = v;
                        sel.appendChild(o);
                    });
                    updateStatus('Ready — ' + vals.length + ' work orders loaded');
                })
                .catch(e => updateStatus('Error loading work orders: ' + (e.message || e)));
        }

        // ── Labor code filter loader (fires on WO change) ─────────────────────
        async function loadLaborCodesForWorkOrder(workOrderId) {
            $('#laborFilterSection').style.display = 'none';
            $('#laborCodeList').innerHTML = '';
            if (!workOrderId) return;

            const table = findTrackingTable();
            if (!table) return;

            updateStatus('Loading labor codes for ' + workOrderId + '...');
            try {
                await table.load();

                // Validate required fields exist
                const laborCodeField = findTableField(table, 'labor_code');
                if (!laborCodeField) throw new Error('Field "labor_code" not found in tracking table — check field name');

                let woField = null;
                for (const f of (table.fields || [])) {
                    if (f?.name?.toLowerCase().includes('workorder')) { woField = f; break; }
                }
                if (!woField) throw new Error('No workorder field found in tracking table');

                const r = await table.queryFeatures({
                    where: woField.name + " = '" + workOrderId + "'",
                    outFields: [laborCodeField.name, 'quantity'],
                    returnGeometry: false
                });

                // Aggregate stats per code
                const stats = {};
                for (const f of r.features) {
                    const code = f.attributes.labor_code || 'Unknown';
                    const qty  = f.attributes.quantity   || 0;
                    if (!stats[code]) stats[code] = { count: 0, totalQty: 0, maxQty: 0 };
                    stats[code].count++;
                    stats[code].totalQty += qty;
                    if (qty > stats[code].maxQty) stats[code].maxQty = qty;
                }

                const codes = Object.keys(stats).sort();
                const list  = $('#laborCodeList');
                list.innerHTML = '';

                for (const code of codes) {
                    const s = stats[code];
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex;align-items:center;padding:2px 0;gap:4px;';

                    const cb = document.createElement('input');
                    cb.type      = 'checkbox';
                    cb.className = 'laborCodeCheck';
                    cb.value     = code;
                    cb.checked   = true;
                    cb.id        = 'lc_' + code.replace(/\W/g, '_');
                    cb.addEventListener('change', updateCodeSelectionSummary);

                    const lbl  = document.createElement('label');
                    lbl.htmlFor   = cb.id;
                    lbl.style.cssText = 'font-size:9px;cursor:pointer;flex:1;font-weight:bold;';
                    lbl.textContent   = code;

                    // Badge: record count
                    const badge = document.createElement('span');
                    badge.style.cssText =
                        'font-size:8px;background:#e8eaf6;border-radius:3px;padding:0 3px;color:#555;white-space:nowrap;';
                    badge.textContent = s.count + (s.count === 1 ? ' rec' : ' recs');

                    // Max qty
                    const maxSpan = document.createElement('span');
                    maxSpan.style.cssText = 'font-size:8px;color:#888;white-space:nowrap;';
                    maxSpan.textContent   = 'max: ' + s.maxQty;

                    row.append(cb, lbl, badge, maxSpan);
                    list.appendChild(row);
                }

                updateCodeSelectionSummary();
                $('#laborFilterSection').style.display = 'block';
                updateStatus('Ready — adjust labor codes if needed, then Run Analysis');
            } catch (e) {
                updateStatus('Error loading labor codes: ' + (e.message || e));
            }
        }

        // ── Map label helper ──────────────────────────────────────────────────
        function applyLayerLabel(layer, guidToQty, prefix, color, xoffset, yoffset) {
            const parts = [];
            for (const guid in guidToQty) {
                parts.push('"' + guid + '"', '"' + prefix + ': ' + guidToQty[guid] + '"');
            }
            layer.labelingInfo = [{
                labelExpressionInfo: {
                    expression: 'var id=$feature.globalid; Decode(id,' + parts.join(',') + ',"' + prefix + ': N/A")'
                },
                symbol: {
                    type: 'text', color, haloSize: 3, haloColor: 'white',
                    font: { size: 16, family: 'Arial', weight: 'bold' },
                    xoffset, yoffset
                },
                deconflictionStrategy: 'none',
                repeatLabel: false,
                removeDuplicates: 'none'
            }];
            layer.labelsVisible = true;
        }

        // ── Main analysis ─────────────────────────────────────────────────────
        async function runAnalysis() {
            const selectedWO   = $('#workorderSelect').value;
            if (!selectedWO) { alert('Please select a work order'); return; }

            const checkedCodes = getCheckedLaborCodes();
            if (checkedCodes && checkedCodes.size === 0) {
                alert('No labor codes selected. Check at least one code in the Labor Code Filter.');
                return;
            }

            updateStatus('Running analysis for ' + selectedWO + '...');
            updateResults('');
            exportData = [];
            $('#exportBtn').style.display = 'none';

            const table = findTrackingTable();
            if (!table) { updateStatus('Error: Daily Tracking table not found (layerId 90100)'); return; }

            try {
                await table.load();

                // Validate required fields exist
                const laborCodeField = findTableField(table, 'labor_code');
                if (!laborCodeField) throw new Error('Field "labor_code" not found in tracking table — check field name');

                let woField = null;
                for (const f of (table.fields || [])) {
                    if (f?.name?.toLowerCase().includes('workorder')) { woField = f; break; }
                }
                if (!woField) throw new Error('No workorder field found in tracking table');

                const trackingResult = await table.queryFeatures({
                    where: woField.name + " = '" + selectedWO + "'",
                    outFields: ['*']
                });
                if (!trackingResult.features.length)
                    throw new Error('No tracking records found for work order ' + selectedWO);

                // ── Build guidToQuantity with max-qty-wins + labor code filter ──
                //    laborSummary always covers all codes (for display)
                const laborSummary    = {};   // code → total qty (all records, no filter)
                const guidToQuantity  = {};   // guid → winning qty  (filtered, max wins)
                const guidToLaborCode = {};   // guid → winning labor code

                for (const feat of trackingResult.features) {
                    const attrs     = feat.attributes;
                    const code      = attrs.labor_code || 'Unknown';
                    const qty       = attrs.quantity   || 0;

                    // Always accumulate summary
                    laborSummary[code] = (laborSummary[code] || 0) + qty;

                    // Skip excluded codes for GUID mapping
                    if (checkedCodes && !checkedCodes.has(code)) continue;

                    // Scan all _guid fields on this record
                    for (const field in attrs) {
                        if (field.includes('_guid') && attrs[field]) {
                            const guid = attrs[field];
                            // Max-quantity wins; tie-break: first seen
                            if (guidToQuantity[guid] === undefined || qty > guidToQuantity[guid]) {
                                guidToQuantity[guid]  = qty;
                                guidToLaborCode[guid] = code;
                            }
                        }
                    }
                }

                // ── Labor summary table ────────────────────────────────────────
                let summaryHTML =
                    '<h4 style="margin:8px 0 4px;font-size:11px;">Labor Code Summary:</h4>' +
                    '<div style="overflow-x:auto;"><table border="1" style="border-collapse:collapse;width:100%;font-size:10px;">' +
                    '<tr>' +
                    '<th style="padding:2px 4px;">Labor Code</th>' +
                    '<th style="padding:2px 4px;">Total Qty</th>' +
                    '<th style="padding:2px 4px;">In Analysis</th>' +
                    '</tr>';

                for (const code of Object.keys(laborSummary).sort()) {
                    const included = !checkedCodes || checkedCodes.has(code);
                    summaryHTML +=
                        '<tr style="' + (included ? '' : 'color:#bbb;') + '">' +
                        '<td style="padding:2px 4px;">' + code + '</td>' +
                        '<td style="padding:2px 4px;">' + laborSummary[code] + '</td>' +
                        '<td style="padding:2px 4px;text-align:center;">' + (included ? '✓' : '—') + '</td>' +
                        '</tr>';
                }
                summaryHTML += '</table></div>';
                updateResults(summaryHTML);

                // ── Layer lookups ──────────────────────────────────────────────
                const ugLayer    = getFeatureLayer(42050);
                const aerLayer   = getFeatureLayer(43050);
                const fiberLayer = getFeatureLayer(41050);
                if (!fiberLayer) { updateStatus('Error: Fiber Cable layer (layerId 41050) required'); return; }

                const guids = Object.keys(guidToQuantity);
                if (!guids.length) {
                    updateStatus('No related features found for the selected labor codes');
                    return;
                }

                const guidList = "'" + guids.join("','") + "'";
                const q = { outFields: ['objectid', 'globalid', 'gis_id'], returnGeometry: true };

                const [ugRes, aerRes, fiberRes] = await Promise.all([
                    ugLayer  ? ugLayer.queryFeatures({ ...q, where: 'globalid IN (' + guidList + ')' })
                             : Promise.resolve({ features: [] }),
                    aerLayer ? aerLayer.queryFeatures({ ...q, where: 'globalid IN (' + guidList + ')' })
                             : Promise.resolve({ features: [] }),
                    fiberLayer.queryFeatures({ ...q, where: 'globalid IN (' + guidList + ')' })
                ]);

                const ugFeatures    = ugRes.features;
                const aerFeatures   = aerRes.features;
                const fiberFeatures = fiberRes.features;

                // ── Coincidence + mismatch detection ──────────────────────────
                function processPairs(coincidences) {
                    return coincidences.reduce((acc, c) => {
                        if (!c?.span?.attributes || !c?.fiber?.attributes) return acc;
                        const spanG  = c.span.attributes.globalid;
                        const fiberG = c.fiber.attributes.globalid;
                        const spanQ  = guidToQuantity[spanG];
                        const fiberQ = guidToQuantity[fiberG];
                        if (spanQ === undefined || fiberQ === undefined) return acc; // not in filtered set
                        if (spanQ !== fiberQ) {
                            acc.push({
                                spanGisId:      c.span.attributes.gis_id  || 'Unknown',
                                fiberGisId:     c.fiber.attributes.gis_id || 'Unknown',
                                spanQty:        spanQ,
                                fiberQty:       fiberQ,
                                difference:     spanQ - fiberQ,
                                spanLaborCode:  guidToLaborCode[spanG]  || 'Unknown',
                                fiberLaborCode: guidToLaborCode[fiberG] || 'Unknown',
                                spanOid:        c.span.attributes.objectid,
                                fiberOid:       c.fiber.attributes.objectid
                            });
                        }
                        return acc;
                    }, []);
                }

                const ugCoincident  = findCoincidentFeatures(ugFeatures,  fiberFeatures);
                const aerCoincident = findCoincidentFeatures(aerFeatures, fiberFeatures);
                const ugMismatches  = processPairs(ugCoincident);
                const aerMismatches = processPairs(aerCoincident);

                // ── Mismatch table builder ─────────────────────────────────────
                function mismatchTable(mismatches, spanLabel, layerType, spanFeats) {
                    let h =
                        '<h4 style="margin:8px 0 4px;font-size:11px;">' +
                        spanLabel + ' vs Fiber Mismatches (' + mismatches.length + '):</h4>' +
                        '<div style="overflow-x:auto;"><table border="1" style="border-collapse:collapse;width:100%;font-size:9px;margin-bottom:8px;">' +
                        '<tr>' +
                        '<th style="padding:1px 2px;">' + spanLabel + ' ID</th>' +
                        '<th style="padding:1px 2px;">Fiber ID</th>' +
                        '<th style="padding:1px 2px;">' + spanLabel + ' Code</th>' +
                        '<th style="padding:1px 2px;">Fiber Code</th>' +
                        '<th style="padding:1px 2px;">' + spanLabel + ' Qty</th>' +
                        '<th style="padding:1px 2px;">Fiber Qty</th>' +
                        '<th style="padding:1px 2px;">Diff</th>' +
                        '<th style="padding:1px 2px;">Actions</th>' +
                        '</tr>';

                    for (const m of mismatches) {
                        exportData.push({
                            type:          spanLabel + ' vs Fiber',
                            spanId:        m.spanGisId,
                            fiberId:       m.fiberGisId,
                            spanLaborCode: m.spanLaborCode,
                            fiberLaborCode:m.fiberLaborCode,
                            spanQty:       m.spanQty,
                            fiberQty:      m.fiberQty,
                            difference:    m.difference,
                            spanOid:       m.spanOid,
                            fiberOid:      m.fiberOid,
                            spanGeometry:  spanFeats.find(f => f.attributes.objectid === m.spanOid)?.geometry,
                            fiberGeometry: fiberFeatures.find(f => f.attributes.objectid === m.fiberOid)?.geometry
                        });

                        const ugColor    = '#8844ff';
                        const fiberColor = '#ff8800';
                        h +=
                            '<tr>' +
                            '<td style="padding:1px 2px;">' + m.spanGisId + '</td>' +
                            '<td style="padding:1px 2px;">' + m.fiberGisId + '</td>' +
                            '<td style="padding:1px 2px;font-size:8px;color:#444;">' + m.spanLaborCode + '</td>' +
                            '<td style="padding:1px 2px;font-size:8px;color:#444;">' + m.fiberLaborCode + '</td>' +
                            '<td style="padding:1px 2px;">' + m.spanQty + '</td>' +
                            '<td style="padding:1px 2px;">' + m.fiberQty + '</td>' +
                            '<td style="color:red;font-weight:bold;padding:1px 2px;">' + m.difference + '</td>' +
                            '<td style="padding:1px 2px;">' +
                            '<button onclick="zoomToFeature(\'' + layerType + '\',' + m.spanOid + ')" ' +
                            'style="padding:1px 3px;font-size:8px;background:' + ugColor + ';color:#fff;border:none;cursor:pointer;">' +
                            spanLabel + '</button> ' +
                            '<button onclick="zoomToFeature(\'fiber\',' + m.fiberOid + ')" ' +
                            'style="padding:1px 3px;font-size:8px;background:' + fiberColor + ';color:#fff;border:none;cursor:pointer;">' +
                            'Fiber</button>' +
                            '</td></tr>';
                    }
                    return h + '</table></div>';
                }

                // ── Build results HTML ─────────────────────────────────────────
                let finalHTML = $('#results').innerHTML;

                if (ugMismatches.length > 0) {
                    finalHTML += mismatchTable(ugMismatches, 'UG', 'underground', ugFeatures);
                } else if (ugCoincident.length > 0) {
                    finalHTML +=
                        '<h4 style="margin:8px 0 4px;font-size:11px;">Underground vs Fiber:</h4>' +
                        '<p style="color:green;font-size:10px;margin:2px 0;">All ' +
                        ugCoincident.length + ' coincident UG/fiber features match! ✓</p>';
                }

                if (aerMismatches.length > 0) {
                    finalHTML += mismatchTable(aerMismatches, 'Aerial', 'aerial', aerFeatures);
                } else if (aerCoincident.length > 0) {
                    finalHTML +=
                        '<h4 style="margin:8px 0 4px;font-size:11px;">Aerial vs Fiber:</h4>' +
                        '<p style="color:green;font-size:10px;margin:2px 0;">All ' +
                        aerCoincident.length + ' coincident aerial/fiber features match! ✓</p>';
                }

                if (!ugCoincident.length && !aerCoincident.length) {
                    finalHTML += '<p style="font-size:10px;margin:2px 0;">No coincident features found for comparison.</p>';
                }

                // ── Apply map definition expressions + labels ──────────────────
                if (ugMismatches.length && ugLayer) {
                    ugLayer.definitionExpression =
                        'objectid IN (' + ugMismatches.map(x => x.spanOid).join(',') + ')';
                    applyLayerLabel(ugLayer, guidToQuantity, 'UG', 'red', -40, -30);
                }
                if (aerMismatches.length && aerLayer) {
                    aerLayer.definitionExpression =
                        'objectid IN (' + aerMismatches.map(x => x.spanOid).join(',') + ')';
                    applyLayerLabel(aerLayer, guidToQuantity, 'Aerial', 'red', -40, -30);
                }

                const allFiberOids = [...ugMismatches, ...aerMismatches].map(x => x.fiberOid);
                if (allFiberOids.length) {
                    fiberLayer.definitionExpression = 'objectid IN (' + allFiberOids.join(',') + ')';
                    applyLayerLabel(fiberLayer, guidToQuantity, 'Fiber', 'orange', 0, 20);
                }

                updateResults(finalHTML);
                if (exportData.length) $('#exportBtn').style.display = 'inline-block';

                // Zoom to results
                const toZoom = [
                    ugMismatches.length && ugLayer   ? ugLayer   : null,
                    aerMismatches.length && aerLayer  ? aerLayer  : null,
                    allFiberOids.length               ? fiberLayer : null
                ].filter(Boolean);

                const total = ugMismatches.length + aerMismatches.length;
                if (toZoom.length) {
                    zoomToLayers(toZoom).then(() =>
                        updateStatus('Analysis complete — ' + total + ' mismatch' + (total !== 1 ? 'es' : '') + ' found')
                    );
                } else {
                    updateStatus('Analysis complete — No quantity mismatches found');
                }

            } catch (err) {
                updateStatus('Error: ' + (err.message || err));
                console.error('Analysis error:', err);
            }
        }

        // ── Event wiring ──────────────────────────────────────────────────────
        $('#workorderSelect').addEventListener('change', e => loadLaborCodesForWorkOrder(e.target.value));
        $('#runBtn').addEventListener('click', runAnalysis);
        $('#resetBtn').addEventListener('click', resetFilters);
        $('#exportBtn').addEventListener('click', exportToCSV);
        $('#closeTool').addEventListener('click', () => {
            toolBox.remove();
            if (window.gisToolHost?.activeTools instanceof Set)
                window.gisToolHost.activeTools.delete('parent-child-reconciliation');
        });

        loadWorkOrders();
        window.gisToolHost.activeTools.add('parent-child-reconciliation');
        updateStatus('Tool loaded successfully');

    } catch (err) {
        console.error('Tool initialization error:', err);
        alert('Error initializing Parent/Child Reconciliation Tool: ' + (err.message || err));
    }
})();
