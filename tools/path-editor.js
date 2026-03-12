// tools/path-editor.js - Sequential Feature Editor with Multiple Selection Modes
(function() {
    try {
        if (!(window.gisToolHost.activeTools instanceof Map)) {
            console.warn('activeTools was corrupted, restoring Map...');
            window.gisToolHost.activeTools = new Map();
        }
        if (window.gisToolHost.activeTools.has('path-editor')) return;

        const existingToolbox = document.getElementById('pathEditorToolbox');
        if (existingToolbox) existingToolbox.remove();

        const utils = window.gisSharedUtils;
        if (!utils) throw new Error('Shared utilities not loaded');

        const mapView = utils.getMapView();
        const z = 99999;

        let sketchViewModel   = null;
        let selectionGraphic  = null;
        let selectedFeaturesByLayer = new Map();
        let layerConfigs      = [];
        let currentEditingQueue = [];
        let currentIndex      = 0;
        let currentPhase      = 'selection';
        let highlightGraphics = [];
        let editLog           = [];
        let sessionStartTime  = null;
        let selectionMode     = 'single';
        let mapClickHandler   = null;
        let filesToUpload     = [];
        let lastSubmittedValues = null;

        function layerKey(layer) {
            return 'L' + String(layer.uid).replace(/\W/g, '_');
        }

        const ALLOWED_MIME_TYPES = new Set([
            'image/jpeg','image/png','image/gif','image/webp','image/bmp','image/tiff',
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel','text/csv','text/plain',
        ]);
        const ALLOWED_EXTENSIONS = new Set([
            'jpg','jpeg','png','gif','webp','bmp','tiff','tif','pdf','xlsx','xls','csv',
        ]);
        function isAllowedFile(f) {
            if (ALLOWED_MIME_TYPES.has(f.type)) return true;
            return ALLOWED_EXTENSIONS.has(f.name.split('.').pop().toLowerCase());
        }
        function fileTypeLabel(f) {
            const ext = f.name.split('.').pop().toLowerCase();
            if (['jpg','jpeg','png','gif','webp','bmp','tiff','tif'].includes(ext)) return '🖼️';
            if (ext === 'pdf') return '📄';
            if (['xlsx','xls'].includes(ext)) return '📊';
            if (ext === 'csv') return '📋';
            return '📎';
        }

        // ── Toolbox HTML ──────────────────────────────────────────────────────
        const toolBox = document.createElement('div');
        toolBox.id = 'pathEditorToolbox';
        toolBox.style.cssText = `
            position:fixed; top:80px; right:40px; z-index:${z};
            background:#1e1e2e; color:#cdd6f4;
            border:1px solid #313244; border-radius:10px;
            width:400px; max-height:88vh; overflow:hidden;
            font:13px/1.4 "Segoe UI",Arial,sans-serif;
            box-shadow:0 8px 32px rgba(0,0,0,.5);
            display:flex; flex-direction:column;
            user-select:none;
        `;

        toolBox.innerHTML = `
        <div id="peHeader" style="
            padding:10px 14px; background:#181825; border-radius:10px 10px 0 0;
            display:flex; align-items:center; justify-content:space-between;
            cursor:move; border-bottom:1px solid #313244; flex-shrink:0;">
            <span style="font-weight:700;font-size:14px;color:#cba6f7;">🔧 Path Editor</span>
            <div style="display:flex;gap:6px;align-items:center;">
                <span id="phaseIndicator" style="font-size:10px;background:#313244;padding:2px 8px;border-radius:10px;color:#a6e3a1;"></span>
                <button id="closeTool" style="background:#f38ba8;border:none;color:#1e1e2e;width:20px;height:20px;border-radius:50%;cursor:pointer;font-size:12px;font-weight:bold;line-height:1;display:flex;align-items:center;justify-content:center;">✕</button>
            </div>
        </div>

        <div id="peBody" style="overflow-y:auto;flex:1;padding:14px;">

        <!-- Phase 1: Selection -->
        <div id="selectionPhase">
            <div style="margin-bottom:10px;font-size:11px;color:#a6adc8;">Choose a selection mode — Single Click is active by default.</div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px;" id="modeCards">
                <label class="modeCard" data-mode="single">
                    <input type="radio" name="selectionMode" value="single" checked style="display:none;">
                    <div class="modeIcon">🖱️</div><div class="modeLabel">Single Click</div>
                </label>
                <label class="modeCard" data-mode="line">
                    <input type="radio" name="selectionMode" value="line" style="display:none;">
                    <div class="modeIcon">📏</div><div class="modeLabel">Line Path</div>
                </label>
                <label class="modeCard" data-mode="polygon">
                    <input type="radio" name="selectionMode" value="polygon" style="display:none;">
                    <div class="modeIcon">⬡</div><div class="modeLabel">Polygon</div>
                </label>
            </div>
            <div id="selectionResults" style="margin-bottom:10px;"></div>
            <div style="display:flex;gap:6px;">
                <button id="clearSelectionBtn" class="btn btn-secondary" disabled style="flex:1;">Clear</button>
                <button id="configureLayersBtn" class="btn btn-primary" style="flex:2;display:none;">Configure Layers →</button>
            </div>
        </div>

        <!-- Phase 2: Configuration -->
        <div id="configurationPhase" style="display:none;">
            <div class="card" style="margin-bottom:10px;">
                <div class="card-label">Saved Configurations</div>
                <select id="savedConfigSelect" class="input-ctrl" style="margin-bottom:6px;">
                    <option value="">-- Select saved config --</option>
                </select>
                <div style="display:flex;gap:6px;">
                    <button id="loadConfigBtn"   class="btn btn-info"    style="flex:1;font-size:11px;">Load</button>
                    <button id="deleteConfigBtn" class="btn btn-danger"  style="flex:1;font-size:11px;">Delete</button>
                    <button id="saveConfigBtn"   class="btn btn-success" style="flex:1;font-size:11px;">💾 Save</button>
                </div>
            </div>
            <div id="layerConfigContainer"></div>
            <div style="display:flex;gap:6px;margin-top:10px;">
                <button id="backToSelectionBtn" class="btn btn-secondary" style="flex:1;">← Back</button>
                <button id="showSummaryBtn"     class="btn btn-primary"   style="flex:2;">Review & Start →</button>
            </div>
            <label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:11px;color:#a6adc8;cursor:pointer;">
                <input type="checkbox" id="skipSummaryChk" style="accent-color:#cba6f7;">
                Skip review — go straight to editing
            </label>
        </div>

        <!-- Phase 3: Summary -->
        <div id="summaryPhase" style="display:none;">
            <div style="font-weight:700;margin-bottom:8px;">Review Configuration</div>
            <div id="summaryContent" class="card" style="margin-bottom:10px;"></div>
            <label style="display:flex;align-items:center;gap:8px;margin-bottom:12px;cursor:pointer;background:#313244;padding:8px;border-radius:6px;">
                <input type="checkbox" id="bulkEditMode" style="accent-color:#cba6f7;">
                <div>
                    <strong style="color:#f9e2af;">⚡ Bulk Edit Mode</strong>
                    <div style="font-size:10px;color:#a6adc8;">Apply same values to all features at once</div>
                </div>
            </label>
            <div style="display:flex;gap:6px;">
                <button id="backToConfigBtn" class="btn btn-secondary" style="flex:1;">← Back</button>
                <button id="startEditingBtn" class="btn btn-success"   style="flex:2;">▶ Start Editing</button>
            </div>
        </div>

        <!-- Phase 4: Editing -->
        <div id="editingPhase" style="display:none;">
            <div id="editingProgress" class="card" style="margin-bottom:8px;"></div>
            <div id="featureInfo" class="card info-card" style="margin-bottom:10px;"></div>
            <div id="applyPrevRow" style="display:none;margin-bottom:8px;">
                <button id="applyPrevBtn" class="btn btn-warning" style="width:100%;font-size:12px;">↩ Apply Previous Values</button>
            </div>
            <div id="editFormContainer" style="margin-bottom:10px;"></div>

            <!-- Attachments: inline, no dropdown wrapper, uploads automatically on Submit -->
            <div style="margin-bottom:10px;">
                <div style="font-size:11px;font-weight:700;color:#89b4fa;margin-bottom:6px;">
                    📎 Attachments
                    <span style="font-size:10px;color:#6c7086;font-weight:normal;"> — optional, uploads with Submit</span>
                </div>
                <div id="dropZone" style="border:2px dashed #45475a;padding:14px;text-align:center;background:#181825;cursor:pointer;border-radius:6px;transition:all .2s;color:#a6adc8;font-size:12px;">
                    📁 Drag &amp; Drop or <span style="color:#89b4fa;text-decoration:underline;">browse</span>
                    <input type="file" id="fileInput" multiple accept="image/*,.pdf,.xlsx,.xls,.csv" style="display:none;">
                </div>
                <div id="fileList" style="margin-top:6px;"></div>
            </div>

            <div style="display:flex;gap:6px;margin-bottom:6px;">
                <button id="submitBtn" class="btn btn-success" style="flex:2;">Submit & Next ›</button>
                <button id="skipBtn"   class="btn btn-warning" style="flex:1;">Skip</button>
            </div>
            <button id="prevBtn" class="btn btn-secondary" style="width:100%;margin-bottom:8px;">‹ Previous</button>
            <button id="clearHighlightsBtn" class="btn btn-secondary" style="width:100%;font-size:11px;">Clear Map Highlights</button>
        </div>

        <!-- Phase 4b: Bulk Edit -->
        <div id="bulkEditPhase" style="display:none;">
            <div style="font-weight:700;color:#f9e2af;margin-bottom:6px;">⚡ Bulk Edit Mode</div>
            <div style="font-size:11px;color:#a6adc8;margin-bottom:10px;">Set values once and apply to all selected features.</div>
            <div id="bulkEditLayerSelector" style="margin-bottom:10px;"></div>
            <div id="bulkEditFormContainer" style="margin-bottom:10px;"></div>
            <div id="bulkEditPreview" style="display:none;margin-bottom:10px;" class="card"></div>
            <button id="applyBulkEditBtn" class="btn btn-warning" style="width:100%;margin-bottom:6px;">Apply to All Features</button>
            <button id="backToSummaryBtn" class="btn btn-secondary" style="width:100%;">← Back to Summary</button>
            <div id="bulkEditResults" style="margin-top:10px;"></div>
        </div>

        <!-- Phase 5: Complete -->
        <div id="completePhase" style="display:none;">
            <div style="font-weight:700;color:#a6e3a1;font-size:16px;margin-bottom:6px;">✅ Editing Complete</div>
            <div id="editSummary" class="card" style="margin-bottom:10px;"></div>
            <button id="exportReportBtn" class="btn btn-info"   style="width:100%;margin-bottom:6px;">📄 Export Summary Report</button>
            <button id="startOverBtn"   class="btn btn-success" style="width:100%;">↩ Start Over</button>
        </div>

        </div><!-- /peBody -->
        <div id="toolStatus" style="padding:5px 14px;font-size:10px;color:#89dceb;background:#181825;border-top:1px solid #313244;border-radius:0 0 10px 10px;min-height:22px;flex-shrink:0;"></div>
        `;

        // ── Shared CSS ────────────────────────────────────────────────────────
        if (!document.getElementById('peStyles')) {
            const style = document.createElement('style');
            style.id = 'peStyles';
            style.textContent = `
            #pathEditorToolbox .btn {
                padding:6px 10px; border:none; border-radius:6px; cursor:pointer;
                font-size:12px; font-weight:600; transition:opacity .15s;
            }
            #pathEditorToolbox .btn:hover { opacity:.85; }
            #pathEditorToolbox .btn:disabled { opacity:.4; cursor:not-allowed; }
            #pathEditorToolbox .btn-primary  { background:#cba6f7; color:#1e1e2e; }
            #pathEditorToolbox .btn-success  { background:#a6e3a1; color:#1e1e2e; }
            #pathEditorToolbox .btn-secondary{ background:#45475a; color:#cdd6f4; }
            #pathEditorToolbox .btn-info     { background:#89b4fa; color:#1e1e2e; }
            #pathEditorToolbox .btn-warning  { background:#f9e2af; color:#1e1e2e; }
            #pathEditorToolbox .btn-danger   { background:#f38ba8; color:#1e1e2e; }
            #pathEditorToolbox .card {
                background:#181825; border:1px solid #313244; border-radius:8px; padding:10px;
            }
            #pathEditorToolbox .info-card { background:#1e3a5f; border-color:#2a5298; }
            #pathEditorToolbox .card-label {
                font-size:10px; font-weight:700; text-transform:uppercase;
                color:#6c7086; letter-spacing:.05em; margin-bottom:6px;
            }
            #pathEditorToolbox .input-ctrl {
                width:100%; padding:6px 8px; background:#313244; border:1px solid #45475a;
                border-radius:6px; color:#cdd6f4; font-size:12px; box-sizing:border-box;
            }
            #pathEditorToolbox .input-ctrl:focus { outline:none; border-color:#cba6f7; }
            #pathEditorToolbox .field-label {
                font-size:11px; font-weight:700; color:#a6adc8; margin-bottom:3px;
                display:flex; align-items:center; justify-content:space-between;
            }
            #pathEditorToolbox .current-hint { font-size:10px; color:#6c7086; margin-bottom:2px; }
            #pathEditorToolbox .modeCard {
                display:flex; flex-direction:column; align-items:center; justify-content:center;
                gap:4px; padding:10px 6px; background:#313244; border:2px solid #45475a;
                border-radius:8px; cursor:pointer; transition:all .15s; text-align:center;
            }
            #pathEditorToolbox .modeCard:hover  { border-color:#89b4fa; background:#1e3a5f; }
            #pathEditorToolbox .modeCard.active { border-color:#cba6f7; background:#2a1f3d; }
            #pathEditorToolbox .modeIcon  { font-size:20px; }
            #pathEditorToolbox .modeLabel { font-size:10px; font-weight:600; color:#a6adc8; }
            #pathEditorToolbox .layerCard {
                border:1px solid #45475a; border-radius:8px; margin-bottom:8px; overflow:hidden;
            }
            #pathEditorToolbox .layerCard.enabled { border-color:#cba6f7; }
            #pathEditorToolbox .layerCardHeader {
                padding:10px 12px; background:#313244; display:flex; align-items:center;
                gap:8px; cursor:pointer;
            }
            #pathEditorToolbox .layerCardBody { padding:10px 12px; display:none; }
            #pathEditorToolbox .toggle-wrap { position:relative; width:32px; height:18px; flex-shrink:0; }
            #pathEditorToolbox .toggle-wrap input { display:none; }
            #pathEditorToolbox .toggle-slider {
                position:absolute; inset:0; background:#45475a; border-radius:10px;
                cursor:pointer; transition:background .2s;
            }
            #pathEditorToolbox .toggle-slider::after {
                content:''; position:absolute; width:12px; height:12px;
                background:#cdd6f4; border-radius:50%; top:3px; left:3px; transition:left .2s;
            }
            #pathEditorToolbox .toggle-wrap input:checked + .toggle-slider { background:#cba6f7; }
            #pathEditorToolbox .toggle-wrap input:checked + .toggle-slider::after { left:17px; }
            #pathEditorToolbox .fieldListContainer {
                background:#0f0f17; border:1px solid #313244; border-radius:6px;
                max-height:160px; overflow-y:auto;
            }
            #pathEditorToolbox .fieldItem {
                display:flex; align-items:center; gap:8px;
                padding:5px 8px; border-bottom:1px solid #1e1e2e; cursor:pointer;
            }
            #pathEditorToolbox .fieldItem:last-child { border-bottom:none; }
            #pathEditorToolbox .fieldItem:hover { background:#1e1e2e; }
            #pathEditorToolbox .fieldItem input[type=checkbox] { accent-color:#cba6f7; }
            #pathEditorToolbox .fieldBadge {
                font-size:9px; padding:1px 5px; border-radius:4px; background:#313244;
                color:#a6adc8; white-space:nowrap;
            }
            #pathEditorToolbox .domain-btn {
                width:100%; padding:7px 10px; background:#313244; border:1px solid #45475a;
                border-radius:6px; color:#cdd6f4; font-size:12px; text-align:left;
                display:flex; justify-content:space-between; align-items:center;
                cursor:pointer; box-sizing:border-box;
            }
            #pathEditorToolbox .domain-btn:hover,
            #pathEditorToolbox .domain-btn.open { border-color:#cba6f7; }
            #pathEditorToolbox .progress-bar-wrap {
                background:#313244; border-radius:4px; height:6px; margin-top:6px; overflow:hidden;
            }
            #pathEditorToolbox .progress-bar-fill {
                height:100%; background:#a6e3a1; border-radius:4px; transition:width .3s;
            }
            #pathEditorToolbox .stat-box {
                background:#313244; border-radius:6px; padding:8px; text-align:center;
            }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(toolBox);

        const $ = (id) => toolBox.querySelector(id);
        const status = $('#toolStatus');
        function updateStatus(msg) { status.textContent = msg; }

        // ── Dragging ──────────────────────────────────────────────────────────
        let isDragging = false, dragOX = 0, dragOY = 0;
        $('#peHeader').addEventListener('mousedown', (e) => {
            if (e.target.closest('#closeTool')) return;
            isDragging = true;
            const r = toolBox.getBoundingClientRect();
            dragOX = e.clientX - r.left; dragOY = e.clientY - r.top;
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            toolBox.style.right = 'auto';
            toolBox.style.left  = (e.clientX - dragOX) + 'px';
            toolBox.style.top   = (e.clientY - dragOY) + 'px';
        });
        document.addEventListener('mouseup', () => { isDragging = false; });

        // ── Phase management ──────────────────────────────────────────────────
        const phaseNames = { selection:'Selection', configuration:'Configuration', summary:'Review', editing:'Editing', bulkEdit:'Bulk Edit', complete:'Complete' };
        function setPhase(phase) {
            currentPhase = phase;
            ['selection','configuration','summary','editing','bulkEdit','complete'].forEach(p => {
                const el = $(`#${p}Phase`); if (el) el.style.display = 'none';
            });
            const target = $(`#${phase}Phase`); if (target) target.style.display = 'block';
            const ind = $('#phaseIndicator'); if (ind) ind.textContent = phaseNames[phase] || phase;
            if (phase === 'configuration') { loadSavedConfigurationsList(); autoLoadLastConfiguration(); }
        }

        // ── Mode Cards ────────────────────────────────────────────────────────
        function updateModeCards() {
            toolBox.querySelectorAll('.modeCard').forEach(card => {
                card.classList.toggle('active', card.dataset.mode === selectionMode);
            });
        }
        toolBox.querySelectorAll('.modeCard').forEach(card => {
            card.addEventListener('click', () => {
                card.querySelector('input').checked = true;
                selectionMode = card.dataset.mode;
                updateModeCards();
                if (selectionGraphic) { mapView.graphics.remove(selectionGraphic); selectionGraphic = null; }
                if (mapClickHandler)  { mapClickHandler.remove(); mapClickHandler = null; }
                if (sketchViewModel)  { try { sketchViewModel.cancel(); } catch(e){} }
                selectedFeaturesByLayer.clear();
                $('#selectionResults').innerHTML = '';
                $('#configureLayersBtn').style.display = 'none';
                $('#clearSelectionBtn').disabled = true;
                startSelection();
            });
        });
        updateModeCards();

        // ── Selection ─────────────────────────────────────────────────────────
        function startSelection() {
            clearSelection();
            if (selectionMode === 'polygon') enablePolygonDrawing();
            else if (selectionMode === 'line') enableLineDrawing();
            else enableSingleFeatureSelection();
        }
        function enablePolygonDrawing() {
            initializeSketchViewModel(() => { sketchViewModel.create('polygon'); updateStatus('Draw polygon — click points, double-click to finish.'); });
        }
        function enableLineDrawing() {
            initializeSketchViewModel(() => { sketchViewModel.create('polyline'); updateStatus('Draw path — click points, double-click to finish.'); });
        }
        function enableSingleFeatureSelection() {
            updateStatus('Click on the map to select nearby features.');
            if (mapClickHandler) { mapClickHandler.remove(); mapClickHandler = null; }
            mapClickHandler = mapView.on('click', async (event) => {
                try {
                    updateStatus('Selecting features…');
                    const sp = mapView.toScreen(event.mapPoint);
                    const p1 = mapView.toMap({ x:sp.x, y:sp.y });
                    const p2 = mapView.toMap({ x:sp.x+10, y:sp.y });
                    if (!window.geometryEngine) await new Promise(r => window.require(['esri/geometry/geometryEngine'], ge => { window.geometryEngine=ge; r(); }));
                    const bufDist = window.geometryEngine.distance(p1, p2, 'meters');
                    const bufGeom = window.geometryEngine.buffer(event.mapPoint, bufDist, 'meters');
                    await new Promise(r => window.require(['esri/Graphic'], G => {
                        selectionGraphic = new G({ geometry:event.mapPoint, symbol:{type:'simple-marker',color:[255,0,0,.8],size:12,outline:{color:[255,255,255,1],width:2}} });
                        mapView.graphics.add(selectionGraphic); r();
                    }));
                    selectedFeaturesByLayer.clear();
                    await queryAllLayers(bufGeom, 'intersects', null);
                    if (selectedFeaturesByLayer.size > 0) {
                        displaySelectionResults(); $('#clearSelectionBtn').disabled = false;
                        if (mapClickHandler) { mapClickHandler.remove(); mapClickHandler = null; }
                    } else { updateStatus('No features found — try clicking elsewhere.'); }
                } catch(err) { updateStatus('Error: '+err.message); }
            });
        }
        function initializeSketchViewModel(callback) {
            if (!window.require) { updateStatus('Cannot load drawing tools.'); return; }
            if (sketchViewModel) { if (callback) callback(); return; }
            window.require(['esri/widgets/Sketch/SketchViewModel'], SVM => {
                sketchViewModel = new SVM({
                    view:mapView, layer:mapView.graphics,
                    polygonSymbol: { type:'simple-fill', color:[255,255,0,.25], outline:{color:[203,166,247,1],width:2} },
                    polylineSymbol:{ type:'simple-line', color:[203,166,247,1], width:3 }
                });
                sketchViewModel.on('create', async evt => {
                    if (evt.state !== 'complete') return;
                    selectionGraphic = evt.graphic;
                    if (selectionMode==='polygon') await selectFeaturesInPolygon(selectionGraphic.geometry);
                    else if (selectionMode==='line') await selectFeaturesAlongLine(selectionGraphic.geometry);
                    $('#clearSelectionBtn').disabled = false;
                });
                if (callback) callback();
            });
        }
        async function queryAllLayers(geometry, spatialRel, lineForOrder) {
            const allFL = mapView.map.allLayers.filter(l => l.type==='feature' && l.visible);
            await Promise.all(allFL.toArray().map(async layer => {
                try {
                    await layer.load();
                    let lv = null; try { lv = await mapView.whenLayerView(layer); } catch(e){}
                    const qp = { geometry, spatialRelationship:spatialRel, returnGeometry:true, outFields:['*'] };
                    if (lv?.filter?.where) qp.where = lv.filter.where;
                    else if (layer.definitionExpression) qp.where = layer.definitionExpression;
                    const res = await layer.queryFeatures(qp);
                    if (!res.features.length) return;
                    let features = res.features, orderedByLine = false;
                    if (lineForOrder) { features = orderFeaturesAlongLine(features, lineForOrder); orderedByLine = true; }
                    selectedFeaturesByLayer.set(layerKey(layer), { layer, features, orderedByLine });
                } catch(e) { console.warn('Layer query error:', layer.title, e); }
            }));
        }
        function orderFeaturesAlongLine(features, line) {
            return features.map(f => {
                let dist = 0;
                try {
                    let pt = f.geometry.type==='point' ? f.geometry
                           : f.geometry.type==='polygon' ? f.geometry.centroid
                           : f.geometry.type==='polyline' && f.geometry.paths?.[0]
                             ? { type:'point', x:f.geometry.paths[0][Math.floor(f.geometry.paths[0].length/2)][0], y:f.geometry.paths[0][Math.floor(f.geometry.paths[0].length/2)][1], spatialReference:f.geometry.spatialReference }
                             : null;
                    if (pt) {
                        const nc = window.geometryEngine.nearestCoordinate(line, pt);
                        if (nc?.coordinate && nc.vertexIndex !== undefined) {
                            let cum = 0;
                            for (let i=0; i<nc.vertexIndex; i++) {
                                const a = { type:'point', x:line.paths[0][i][0],   y:line.paths[0][i][1],   spatialReference:line.spatialReference };
                                const b = { type:'point', x:line.paths[0][i+1][0], y:line.paths[0][i+1][1], spatialReference:line.spatialReference };
                                cum += window.geometryEngine.distance(a, b, 'meters');
                            }
                            const lv = { type:'point', x:line.paths[0][nc.vertexIndex][0], y:line.paths[0][nc.vertexIndex][1], spatialReference:line.spatialReference };
                            cum += window.geometryEngine.distance(lv, nc.coordinate, 'meters');
                            dist = cum;
                        }
                    }
                } catch(e){}
                return { f, dist };
            }).sort((a,b)=>a.dist-b.dist).map(x=>x.f);
        }
        async function selectFeaturesInPolygon(polygon) {
            updateStatus('Selecting features in polygon…'); selectedFeaturesByLayer.clear();
            await queryAllLayers(polygon, 'intersects', null); displaySelectionResults();
        }
        async function selectFeaturesAlongLine(line) {
            updateStatus('Selecting features along line…'); selectedFeaturesByLayer.clear();
            if (!window.geometryEngine) await new Promise(r => window.require(['esri/geometry/geometryEngine'], ge => { window.geometryEngine=ge; r(); }));
            const bufDist = (mapView.extent.width / mapView.width) * 20;
            const bufGeom = window.geometryEngine.buffer(line, bufDist, 'meters');
            await queryAllLayers(bufGeom, 'intersects', line);
            displaySelectionResults();
            updateStatus(`Features selected along path (${Math.round(bufDist)}m buffer).`);
        }
        function displaySelectionResults() {
            const div = $('#selectionResults');
            if (!selectedFeaturesByLayer.size) {
                div.innerHTML = '<div style="color:#f38ba8;font-size:11px;padding:6px 0;">No features found.</div>';
                $('#configureLayersBtn').style.display = 'none';
            } else {
                let html = '<div class="card" style="padding:8px;">';
                selectedFeaturesByLayer.forEach(d => {
                    html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid #313244;">
                        <span style="font-size:11px;color:#cdd6f4;">${d.layer.title}</span>
                        <span style="font-size:11px;color:#a6e3a1;font-weight:700;">${d.features.length}
                        ${d.orderedByLine?'<span style="color:#89b4fa;font-size:9px;margin-left:4px;">↗ ordered</span>':''}</span></div>`;
                });
                div.innerHTML = html + '</div>';
                $('#configureLayersBtn').style.display = 'block';
            }
            updateStatus(`Found features in ${selectedFeaturesByLayer.size} layer(s).`);
        }
        function clearSelection() {
            if (selectionGraphic) { mapView.graphics.remove(selectionGraphic); selectionGraphic = null; }
            if (mapClickHandler)  { mapClickHandler.remove(); mapClickHandler = null; }
            clearHighlights(); $('#clearSelectionBtn').disabled = true;
            selectedFeaturesByLayer.clear(); $('#selectionResults').innerHTML = '';
            $('#configureLayersBtn').style.display = 'none'; updateStatus('Selection cleared.');
        }

        // ── Layer Configuration ───────────────────────────────────────────────
        async function showLayerConfiguration() {
            const container = $('#layerConfigContainer'); container.innerHTML = '';
            let order = 1;
            for (const [, data] of selectedFeaturesByLayer) {
                container.appendChild(await createLayerConfigSection(data.layer, data.features, order++));
            }
            setPhase('configuration'); updateStatus('Configure layers and fields, then click Review & Start.');
        }
        async function createLayerConfigSection(layer, features, order) {
            const lid = layerKey(layer);
            const card = document.createElement('div');
            card.className='layerCard'; card.dataset.layerId=lid; card.dataset.order=order;

            const header = document.createElement('div'); header.className='layerCardHeader';
            const toggleWrap = document.createElement('label'); toggleWrap.className='toggle-wrap';
            const toggleInput = document.createElement('input'); toggleInput.type='checkbox'; toggleInput.id=`layer_${lid}_enabled`;
            const toggleSlider = document.createElement('div'); toggleSlider.className='toggle-slider';
            toggleWrap.appendChild(toggleInput); toggleWrap.appendChild(toggleSlider);
            const titleSpan = document.createElement('span'); titleSpan.style.cssText='flex:1;font-weight:700;font-size:12px;'; titleSpan.textContent=layer.title;
            const countBadge = document.createElement('span'); countBadge.className='fieldBadge'; countBadge.textContent=`${features.length} features`;
            const chevron = document.createElement('span'); chevron.textContent='▼'; chevron.style.cssText='font-size:10px;color:#6c7086;';
            header.appendChild(toggleWrap); header.appendChild(titleSpan); header.appendChild(countBadge); header.appendChild(chevron);

            const body = document.createElement('div'); body.className='layerCardBody';

            const modeRow = document.createElement('div'); modeRow.style.cssText='display:flex;gap:8px;margin-bottom:10px;';
            ['edit','view'].forEach(m => {
                const lbl = document.createElement('label'); lbl.style.cssText='display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;color:#a6adc8;';
                const rdo = document.createElement('input'); rdo.type='radio'; rdo.name=`mode_${lid}`; rdo.value=m; if(m==='edit') rdo.checked=true; rdo.style.accentColor='#cba6f7';
                lbl.appendChild(rdo); lbl.appendChild(document.createTextNode(m==='edit'?'✏️ Edit Fields':'👁 View Only')); modeRow.appendChild(lbl);
            });

            await layer.load();
            const editableFields = layer.fields.filter(f=>f.editable&&f.type!=='oid'&&f.type!=='global-id').sort((a,b)=>(a.alias||a.name).localeCompare(b.alias||b.name));
            const fieldsSection = document.createElement('div'); fieldsSection.id=`fields_${lid}`;

            if (editableFields.length>0) {
                const searchSortRow = document.createElement('div'); searchSortRow.style.cssText='display:flex;gap:6px;margin-bottom:6px;';
                const fsearch = document.createElement('input'); fsearch.type='text'; fsearch.placeholder='Search fields…'; fsearch.className='input-ctrl'; fsearch.style.flex='1'; fsearch.style.fontSize='11px';
                const sortBtn = document.createElement('button'); sortBtn.className='btn btn-secondary'; sortBtn.style.cssText='font-size:10px;padding:4px 8px;white-space:nowrap;'; sortBtn.textContent='A→Z';
                let sortAsc=true; searchSortRow.appendChild(fsearch); searchSortRow.appendChild(sortBtn);
                const fieldListContainer = document.createElement('div'); fieldListContainer.className='fieldListContainer';

                function renderFieldList(filterText='', ascending=true) {
                    const prevChecked = new Set(Array.from(fieldListContainer.querySelectorAll('input[type=checkbox]:checked')).map(c=>c.dataset.fieldName));
                    fieldListContainer.innerHTML='';
                    let flds = editableFields.filter(f=>(f.alias||f.name).toLowerCase().includes(filterText.toLowerCase()));
                    if (!ascending) flds=[...flds].reverse();
                    flds.forEach(field=>{
                        const row=document.createElement('div'); row.className='fieldItem';
                        const chk=document.createElement('input'); chk.type='checkbox'; chk.dataset.fieldName=field.name; chk.style.accentColor='#cba6f7'; chk.checked=prevChecked.has(field.name);
                        const lbl=document.createElement('span'); lbl.style.cssText='flex:1;font-size:11px;'; lbl.textContent=field.alias||field.name;
                        const badge=document.createElement('span'); badge.className='fieldBadge'; badge.textContent=getFieldTypeLabel(field);
                        row.appendChild(chk); row.appendChild(lbl); row.appendChild(badge);
                        row.addEventListener('click',e=>{ if(e.target!==chk) chk.checked=!chk.checked; });
                        fieldListContainer.appendChild(row);
                    });
                }
                renderFieldList();
                fsearch.oninput=()=>renderFieldList(fsearch.value,sortAsc);
                sortBtn.onclick=()=>{ sortAsc=!sortAsc; sortBtn.textContent=sortAsc?'A→Z':'Z→A'; renderFieldList(fsearch.value,sortAsc); };
                fieldsSection.getCheckedFields=()=>Array.from(fieldListContainer.querySelectorAll('input[type=checkbox]:checked')).map(c=>c.dataset.fieldName);
                fieldsSection.setCheckedFields=(names)=>{ fieldListContainer.querySelectorAll('input[type=checkbox]').forEach(c=>{ c.checked=names.includes(c.dataset.fieldName); }); };
                fieldsSection.appendChild(searchSortRow); fieldsSection.appendChild(fieldListContainer);
            } else { fieldsSection.innerHTML='<div style="color:#6c7086;font-size:11px;">No editable fields.</div>'; }

            const optDiv=document.createElement('div'); optDiv.style.cssText='display:flex;gap:12px;margin-top:8px;margin-bottom:8px;';
            optDiv.innerHTML=`<label style="display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer;color:#a6adc8;"><input type="checkbox" id="popup_${lid}" checked style="accent-color:#cba6f7;"> Show Popup</label>
                <label style="display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer;color:#a6adc8;"><input type="checkbox" id="allowskip_${lid}" checked style="accent-color:#cba6f7;"> Allow Skip</label>`;

            const filterDiv=document.createElement('div'); filterDiv.style.cssText='border-top:1px solid #313244;padding-top:8px;margin-top:4px;';
            filterDiv.innerHTML=`<label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer;color:#a6adc8;margin-bottom:4px;"><input type="checkbox" id="enableFilter_${lid}" style="accent-color:#cba6f7;"> WHERE clause filter</label>
                <div id="filterInputs_${lid}" style="display:none;">
                    <textarea id="filterWhere_${lid}" class="input-ctrl" placeholder="e.g. status = 'ASSG' AND count > 5" style="min-height:44px;font-family:monospace;font-size:10px;resize:vertical;"></textarea>
                    <div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
                        <button class="testFilterBtn btn btn-info" style="font-size:10px;padding:3px 8px;">Test</button>
                        <span class="filterTestResult" style="font-size:10px;"></span>
                    </div>
                </div>`;
            filterDiv.querySelector(`#enableFilter_${lid}`).onchange=e=>{ filterDiv.querySelector(`#filterInputs_${lid}`).style.display=e.target.checked?'block':'none'; };
            filterDiv.querySelector('.testFilterBtn').onclick=async()=>{
                const tr=filterDiv.querySelector('.filterTestResult'), wh=filterDiv.querySelector(`#filterWhere_${lid}`).value.trim().replace(/\\"/g,'"').replace(/\\'/g,"'");
                if(!wh){tr.textContent='Enter a WHERE clause first';tr.style.color='#f38ba8';return;}
                tr.textContent='Testing…';tr.style.color='#a6adc8';
                try{const d=selectedFeaturesByLayer.get(lid),q={where:wh,returnCountOnly:true,returnGeometry:false};if(selectionGraphic?.geometry){q.geometry=selectionGraphic.geometry;q.spatialRelationship='intersects';}const res=await layer.queryFeatures(q);tr.textContent=`✓ ${res.count}/${d?.features.length||'?'} match`;tr.style.color='#a6e3a1';}
                catch(err){tr.textContent='✗ '+err.message;tr.style.color='#f38ba8';}
            };

            const orderDiv=document.createElement('div'); orderDiv.style.cssText='border-top:1px solid #313244;padding-top:8px;margin-top:8px;display:flex;align-items:center;gap:8px;';
            orderDiv.innerHTML=`<span style="font-size:11px;color:#a6adc8;">Order:</span><input type="number" min="1" value="${order}" class="orderInput input-ctrl" style="width:50px;"><button class="moveUp btn btn-secondary" style="padding:3px 8px;">↑</button><button class="moveDown btn btn-secondary" style="padding:3px 8px;">↓</button>`;

            body.appendChild(modeRow); body.appendChild(fieldsSection); body.appendChild(optDiv); body.appendChild(filterDiv); body.appendChild(orderDiv);
            modeRow.querySelectorAll('input[type=radio]').forEach(r=>{ r.onchange=()=>{ fieldsSection.style.display=r.value==='edit'?'block':'none'; }; });
            header.addEventListener('click',e=>{ if(e.target.closest('label.toggle-wrap'))return; const open=body.style.display==='block'; body.style.display=open?'none':'block'; chevron.textContent=open?'▼':'▲'; });
            toggleInput.onchange=()=>{ card.classList.toggle('enabled',toggleInput.checked); if(toggleInput.checked){body.style.display='block';chevron.textContent='▲';} };
            card.appendChild(header); card.appendChild(body);
            return card;
        }
        function getFieldTypeLabel(field) {
            if (field.domain?.type==='coded-value') return 'Dropdown';
            return { integer:'Int','small-integer':'Int',double:'Decimal',single:'Decimal',date:'Date',string:'Text' }[field.type]||field.type;
        }

        // ── Summary ───────────────────────────────────────────────────────────
        function buildSummary() {
            layerConfigs=[];
            $('#layerConfigContainer').querySelectorAll('[data-layer-id]').forEach(section=>{
                const lid=section.dataset.layerId, chk=section.querySelector(`#layer_${lid}_enabled`);
                if(!chk?.checked)return;
                const data=selectedFeaturesByLayer.get(lid); if(!data)return;
                const mode=section.querySelector(`input[name="mode_${lid}"]:checked`)?.value||'edit';
                const config={lid,layerId:data.layer.layerId,layer:data.layer,features:data.features,mode,order:parseInt(section.dataset.order||1),showPopup:section.querySelector(`#popup_${lid}`)?.checked??true,allowSkip:section.querySelector(`#allowskip_${lid}`)?.checked??true,fields:[],filterEnabled:false,filterWhere:''};
                const filterEn=section.querySelector(`#enableFilter_${lid}`);
                if(filterEn?.checked){const fw=section.querySelector(`#filterWhere_${lid}`)?.value.trim();if(fw){config.filterEnabled=true;config.filterWhere=fw;}}
                if(mode==='edit'){const fd=section.querySelector(`#fields_${lid}`);const names=fd?.getCheckedFields?fd.getCheckedFields():Array.from(section.querySelectorAll(`#fields_${lid} input[type=checkbox]:checked`)).map(c=>c.dataset.fieldName);names.forEach(n=>{const f=data.layer.fields.find(f=>f.name===n);if(f)config.fields.push(f);});config.fields.sort((a,b)=>(a.alias||a.name).localeCompare(b.alias||b.name));}
                layerConfigs.push(config);
            });
            layerConfigs.sort((a,b)=>a.order-b.order);
            applyFiltersToConfigs().then(()=>{ if($('#skipSummaryChk')?.checked) startEditing(); else displaySummary(); });
        }
        async function applyFiltersToConfigs() {
            for(const c of layerConfigs){if(!c.filterEnabled||!c.filterWhere){c.filterApplied=false;continue;}try{const clean=c.filterWhere.replace(/\\"/g,'"').replace(/\\'/g,"'"),qp={where:clean,returnGeometry:true,outFields:['*']};if(selectionGraphic?.geometry){qp.geometry=selectionGraphic.geometry;qp.spatialRelationship='intersects';}const res=await c.layer.queryFeatures(qp);c.features=res.features;c.filterApplied=true;}catch(err){c.filterError=err.message;c.filterApplied=false;}}
        }
        function displaySummary() {
            if(!layerConfigs.length){$('#summaryContent').innerHTML='<span style="color:#f38ba8;">No layers selected.</span>';$('#startEditingBtn').disabled=true;}
            else{$('#startEditingBtn').disabled=false;let total=0,html='';layerConfigs.forEach((c,i)=>{total+=c.features.length;html+=`<div style="padding:6px 0;border-bottom:1px solid #313244;"><div style="font-weight:700;font-size:12px;">${i+1}. ${c.mode==='edit'?'✏️':'👁'} ${c.layer.title}</div><div style="font-size:11px;color:#a6adc8;">${c.features.length} features${c.filterApplied?'<span style="color:#89b4fa;"> · filtered</span>':''}</div>${c.fields.length?`<div style="font-size:10px;color:#6c7086;margin-top:2px;">Fields: ${c.fields.map(f=>f.alias||f.name).join(', ')}</div>`:''}</div>`;});$('#summaryContent').innerHTML=`<div style="font-size:13px;font-weight:700;color:#a6e3a1;margin-bottom:8px;">${total} features total</div>`+html;}
            setPhase('summary'); updateStatus('Review your configuration before starting.');
        }

        // ── Editing ───────────────────────────────────────────────────────────
        function startEditing() {
            sessionStartTime=new Date(); editLog=[]; lastSubmittedValues=null;
            try{const sel=$('#savedConfigSelect');if(sel?.value)localStorage.setItem('pathEditorLastConfig',sel.value);}catch(e){}
            if($('#bulkEditMode')?.checked){startBulkEdit();return;}
            currentEditingQueue=[];
            layerConfigs.forEach(cfg=>cfg.features.forEach(f=>currentEditingQueue.push({layer:cfg.layer,feature:f,fields:cfg.fields,mode:cfg.mode,showPopup:cfg.showPopup,allowSkip:cfg.allowSkip})));
            currentIndex=0; setPhase('editing'); showCurrentFeature();
        }
        function showCurrentFeature() {
            if(currentIndex>=currentEditingQueue.length){setPhase('complete');clearHighlights();displayEditSummary();updateStatus('All features processed!');return;}
            const item=currentEditingQueue[currentIndex];
            const pct=Math.round((currentIndex/currentEditingQueue.length)*100);
            $('#editingProgress').innerHTML=`<div style="display:flex;justify-content:space-between;font-size:12px;"><span><strong>${currentIndex+1}</strong> / ${currentEditingQueue.length}</span><span style="color:#a6adc8;font-size:11px;">${item.layer.title}</span></div><div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${pct}%"></div></div>`;
            const oidField=getObjectIdField(item.feature),oid=item.feature.attributes[oidField];
            $('#featureInfo').innerHTML=`<strong>OID:</strong> ${oid} &nbsp;|&nbsp; <strong>Mode:</strong> ${item.mode==='edit'?'Editing':'View Only'}`;
            const fc=$('#editFormContainer'); fc.innerHTML='';
            if(item.mode==='edit'&&item.fields.length>0) item.fields.forEach(f=>fc.appendChild(createFieldInput(f,item.feature.attributes[f.name])));
            else fc.innerHTML='<div style="color:#6c7086;font-style:italic;font-size:12px;">View only — no fields to edit.</div>';
            $('#prevBtn').disabled=currentIndex===0;
            $('#skipBtn').style.display=item.allowSkip?'block':'none';
            $('#applyPrevRow').style.display=(lastSubmittedValues&&item.mode==='edit'&&item.fields.length>0)?'block':'none';
            filesToUpload=[]; updateFileList();
            highlightFeature(item.feature,item.showPopup);
            updateStatus(`${item.mode==='edit'?'Editing':'Viewing'} feature ${currentIndex+1} of ${currentEditingQueue.length}`);
        }

        function applyPreviousValues() {
            if (!lastSubmittedValues) return;
            const item = currentEditingQueue[currentIndex];
            const fc = $('#editFormContainer');
            fc.querySelectorAll('[data-field-name]').forEach(el => {
                const name = el.dataset.fieldName;
                if (!(name in lastSubmittedValues)) return;
                const val = lastSubmittedValues[name];
                if (el.classList.contains('domain-btn')) {
                    const field = item.fields.find(f => f.name === name);
                    if (field?.domain?.codedValues) {
                        const opt = field.domain.codedValues.find(cv => cv.code == val);
                        el.querySelector('.domain-display-text').textContent = opt ? opt.name : val;
                        el.dataset.selectedCode = val;
                    }
                } else if (el.dataset.fieldType === 'date' && val) {
                    // val is stored as a ms timestamp; date input needs YYYY-MM-DD
                    el.value = new Date(val).toISOString().split('T')[0];
                } else {
                    el.value = val;
                }
            });
            updateStatus('Previous values applied.');
        }

        function collectFormValues(fc) {
            const vals={};
            fc.querySelectorAll('[data-field-name]').forEach(el=>{
                const name=el.dataset.fieldName,type=el.dataset.fieldType,raw=el.dataset.selectedCode!==undefined?el.dataset.selectedCode:el.value;
                if(raw==='')return;
                if(type==='integer'||type==='small-integer')vals[name]=parseInt(raw);
                else if(type==='double'||type==='single')vals[name]=parseFloat(raw);
                else if(type==='date')vals[name]=new Date(raw).getTime();
                else vals[name]=raw;
            });
            return vals;
        }

        async function submitFeature() {
            const item=currentEditingQueue[currentIndex];
            if(item.mode==='view'){currentIndex++;showCurrentFeature();return;}
            try{
                updateStatus('Updating feature…');
                const oidField=getObjectIdField(item.feature),oid=item.feature.attributes[oidField];
                const vals=collectFormValues($('#editFormContainer'));
                const result=await item.layer.applyEdits({updateFeatures:[{attributes:{[oidField]:oid,...vals}}]});
                const ur=result.updateFeatureResults?.[0];
                const ok=ur?.success===true||(ur?.success===undefined&&ur?.error===null&&(ur?.objectId||ur?.globalId));
                if(!ok)throw new Error(ur?.error?.message||'Update failed');
                lastSubmittedValues={...vals};
                const log={timestamp:new Date(),action:'update',layerName:item.layer.title,featureOID:oid,changes:{},success:true};
                Object.keys(vals).forEach(k=>{const field=item.fields.find(f=>f.name===k);log.changes[k]={fieldAlias:field?(field.alias||field.name):k,oldValue:item.feature.attributes[k],newValue:vals[k]};});
                editLog.push(log);
                // Upload any queued attachments silently, then advance
                if (filesToUpload.length > 0) {
                    await uploadAttachments(item.layer, item.feature);
                }
                updateStatus('Feature updated!');
                currentIndex++;
                setTimeout(()=>showCurrentFeature(), 400);
            }catch(err){updateStatus('Error: '+err.message);alert('Error updating feature: '+err.message);}
        }

        function skipFeature(){const item=currentEditingQueue[currentIndex],oidField=getObjectIdField(item.feature);editLog.push({timestamp:new Date(),action:'skip',layerName:item.layer.title,featureOID:item.feature.attributes[oidField],success:true});currentIndex++;showCurrentFeature();}
        function prevFeature(){if(currentIndex>0){currentIndex--;showCurrentFeature();}}

        // ── Field Input ───────────────────────────────────────────────────────
        function getObjectIdField(feature){if(feature.attributes.objectid!==undefined)return 'objectid';if(feature.attributes.OBJECTID!==undefined)return 'OBJECTID';if(feature.layer?.objectIdField)return feature.layer.objectIdField;return Object.keys(feature.attributes).find(k=>k.toUpperCase()==='OBJECTID')||'objectid';}

        function createFieldInput(field, currentValue) {
            const container=document.createElement('div'); container.style.marginBottom='10px';
            const labelRow=document.createElement('div'); labelRow.className='field-label';
            labelRow.innerHTML=`<span>${field.alias||field.name}</span><span class="fieldBadge">${getFieldTypeLabel(field)}</span>`;
            container.appendChild(labelRow);
            if(currentValue!==null&&currentValue!==undefined&&currentValue!==''){const hint=document.createElement('div');hint.className='current-hint';hint.textContent='Current: '+currentValue;container.appendChild(hint);}
            let input;
            if(field.domain?.type==='coded-value'){
                const wrap=document.createElement('div');
                const options=field.domain.codedValues.map(cv=>({code:cv.code,name:cv.name}));
                let selectedCode=(currentValue!==null&&currentValue!==undefined)?currentValue:'';
                const currentOpt=options.find(o=>o.code==selectedCode);
                const btn=document.createElement('button'); btn.type='button'; btn.className='domain-btn';
                btn.dataset.fieldName=field.name; btn.dataset.fieldType=field.type; btn.dataset.selectedCode=selectedCode;
                const dispText=document.createElement('span'); dispText.className='domain-display-text'; dispText.textContent=currentOpt?currentOpt.name:'— Select —';
                const arrow=document.createElement('span'); arrow.textContent='▼'; arrow.style.fontSize='10px';
                btn.appendChild(dispText); btn.appendChild(arrow);

                // Inline panel — sits in normal document flow so peBody scrolls naturally
                const panel=document.createElement('div');
                panel.className='domain-panel-inline';
                panel.style.cssText='display:none;margin-top:2px;background:#1e1e2e;border:1px solid #45475a;border-radius:6px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.5);';
                const srch=document.createElement('input'); srch.type='text'; srch.placeholder='Type to search…';
                srch.style.cssText='width:100%;padding:7px 10px;background:#313244;border:none;border-bottom:1px solid #45475a;color:#cdd6f4;font-size:12px;outline:none;box-sizing:border-box;';
                const list=document.createElement('div'); list.style.cssText='max-height:200px;overflow-y:auto;';

                function renderList(filter=''){
                    list.innerHTML='';
                    const f=filter.toLowerCase();
                    const filtered=[{code:'',name:'— Select —'},...options].filter(o=>!f||o.name.toLowerCase().includes(f)||String(o.code).toLowerCase().includes(f));
                    filtered.forEach(opt=>{
                        const it=document.createElement('div');
                        const isSel=opt.code==selectedCode;
                        it.style.cssText=`padding:8px 10px;cursor:pointer;font-size:12px;color:${isSel?'#cba6f7':'#cdd6f4'};background:${isSel?'#2a1f3d':'transparent'};font-weight:${isSel?'600':'normal'};border-bottom:1px solid #313244;`;
                        it.textContent=opt.name;
                        it.addEventListener('mouseenter',()=>{ if(opt.code!=selectedCode) it.style.background='#313244'; });
                        it.addEventListener('mouseleave',()=>{ it.style.background=opt.code==selectedCode?'#2a1f3d':'transparent'; });
                        it.addEventListener('mousedown',e=>{
                            e.preventDefault();
                            selectedCode=opt.code; btn.dataset.selectedCode=opt.code; dispText.textContent=opt.name;
                            panel.style.display='none'; btn.classList.remove('open'); arrow.textContent='▼';
                        });
                        list.appendChild(it);
                    });
                    if(!filtered.length){const em=document.createElement('div');em.style.cssText='padding:10px;font-size:11px;color:#6c7086;text-align:center;';em.textContent='No matches found';list.appendChild(em);}
                }
                renderList(); panel.appendChild(srch); panel.appendChild(list);

                btn.addEventListener('click',()=>{
                    const isOpen=panel.style.display==='block';
                    // Close other open panels in this form
                    $('#editFormContainer').querySelectorAll('.domain-panel-inline').forEach(p=>{ p.style.display='none'; });
                    toolBox.querySelectorAll('.domain-btn').forEach(b=>{ b.classList.remove('open'); b.querySelector('span:last-child').textContent='▼'; });
                    if(!isOpen){
                        panel.style.display='block'; btn.classList.add('open'); arrow.textContent='▲';
                        srch.value=''; renderList('');
                        setTimeout(()=>{ srch.focus(); panel.scrollIntoView({behavior:'smooth',block:'nearest'}); },50);
                    }
                });
                srch.addEventListener('input',()=>renderList(srch.value));

                wrap.appendChild(btn); wrap.appendChild(panel); input=wrap;
            } else if(field.type==='date'){
                input=document.createElement('input'); input.type='date';
                if(currentValue) input.value=new Date(currentValue).toISOString().split('T')[0];
                input.className='input-ctrl'; input.dataset.fieldName=field.name; input.dataset.fieldType=field.type;
            } else if(field.type==='integer'||field.type==='small-integer'){
                input=document.createElement('input'); input.type='number'; input.step='1'; input.value=currentValue??'';
                input.className='input-ctrl'; input.dataset.fieldName=field.name; input.dataset.fieldType=field.type;
            } else if(field.type==='double'||field.type==='single'){
                input=document.createElement('input'); input.type='number'; input.step='any'; input.value=currentValue??'';
                input.className='input-ctrl'; input.dataset.fieldName=field.name; input.dataset.fieldType=field.type;
            } else {
                input=document.createElement('input'); input.type='text'; input.value=currentValue??'';
                if(field.length) input.maxLength=field.length;
                input.className='input-ctrl'; input.dataset.fieldName=field.name; input.dataset.fieldType=field.type;
            }
            container.appendChild(input);
            return container;
        }

        // ── Highlights / Popup ────────────────────────────────────────────────
        function clearHighlights(){highlightGraphics.forEach(g=>{try{mapView.graphics.remove(g);}catch(e){}});highlightGraphics=[];const tr=[];mapView.graphics.forEach(g=>{if(!g.symbol)return;const s=g.symbol;if((s.type==='simple-marker'&&s.size>=20)||(s.type==='simple-line'&&s.width>=8)||(s.type==='simple-fill'&&(s.color?.[3]>=0.3||(s.outline?.width>=4))))tr.push(g);});tr.forEach(g=>{try{mapView.graphics.remove(g);}catch(e){}});mapView.popup?.close();}
        function highlightFeature(feature,showPopup){
            clearHighlights();
            let symbol;
            if(feature.geometry.type==='point') symbol={type:'simple-marker',color:[203,166,247,.85],size:22,outline:{color:[255,255,255,1],width:3}};
            else if(feature.geometry.type==='polyline') symbol={type:'simple-line',color:[203,166,247,.85],width:8};
            else symbol={type:'simple-fill',color:[203,166,247,.35],outline:{color:[203,166,247,1],width:4}};
            const g={geometry:feature.geometry,symbol}; mapView.graphics.add(g); highlightGraphics.push(g);
            mapView.goTo({target:feature.geometry,scale:Math.min(mapView.scale,2000)},{duration:700}).then(()=>{if(showPopup&&mapView.popup)showFeaturePopup(feature);}).catch(()=>{if(showPopup&&mapView.popup)showFeaturePopup(feature);});
        }
        async function showFeaturePopup(feature){try{const oF=getObjectIdField(feature),oid=feature.attributes[oF];const res=await feature.layer.queryFeatures({where:`${oF}=${oid}`,outFields:['*'],returnGeometry:true});mapView.popup.open({features:res.features.length?res.features:[feature],location:getPopupLocation(feature.geometry)});}catch(e){mapView.popup.open({features:[feature],location:getPopupLocation(feature.geometry)});}}
        function getPopupLocation(geom){try{if(geom.type==='point')return geom;if(geom.type==='polyline'&&geom.paths?.[0]?.length>0){const p=geom.paths[0],mid=Math.floor(p.length/2);return{type:'point',x:p[mid][0],y:p[mid][1],spatialReference:geom.spatialReference};}if(geom.type==='polygon')return geom.centroid||geom.extent?.center||geom;return geom.extent?.center||geom;}catch(e){return geom;}}

        // ── Bulk Edit ─────────────────────────────────────────────────────────
        let currentBulkLayerIndex=0;
        function startBulkEdit(){currentBulkLayerIndex=0;setPhase('bulkEdit');showBulkEditForm();}
        function showBulkEditForm(){
            const el=layerConfigs.filter(c=>c.mode==='edit'&&c.fields.length>0);
            if(!el.length){alert('No layers configured for editing.');setPhase('summary');return;}
            if(currentBulkLayerIndex>=el.length){setPhase('complete');return;}
            const cfg=el[currentBulkLayerIndex];
            $('#bulkEditLayerSelector').innerHTML=`<div class="card"><strong>${currentBulkLayerIndex+1}/${el.length}:</strong> ${cfg.layer.title}<div style="font-size:11px;color:#a6adc8;">${cfg.features.length} features to update</div></div>`;
            const fc=$('#bulkEditFormContainer');fc.innerHTML='<div style="font-weight:700;font-size:12px;margin-bottom:8px;">Set values for all features:</div>';
            cfg.fields.forEach(f=>fc.appendChild(createFieldInput(f,null)));
            $('#applyBulkEditBtn').textContent=`Apply to ${cfg.features.length} Features`;
            $('#bulkEditResults').innerHTML='';
        }
        async function applyBulkEdit(){
            const el=layerConfigs.filter(c=>c.mode==='edit'&&c.fields.length>0),cfg=el[currentBulkLayerIndex];
            const vals=collectFormValues($('#bulkEditFormContainer'));
            if(!Object.keys(vals).length){alert('Enter at least one value.');return;}
            if(!confirm(`Apply to ${cfg.features.length} features?`))return;
            updateStatus('Applying bulk edit…');$('#applyBulkEditBtn').disabled=true;
            try{let ok=0,fail=0;const oidF=getObjectIdField(cfg.features[0]);const batches=cfg.features.map(f=>({attributes:{[oidF]:f.attributes[oidF],...vals}}));
            for(let i=0;i<batches.length;i+=100){const res=await cfg.layer.applyEdits({updateFeatures:batches.slice(i,i+100)});res.updateFeatureResults?.forEach((r,idx)=>{const s=r.success===true||(r.success===undefined&&r.error===null&&(r.objectId||r.globalId)),oid=batches[i+idx].attributes[oidF];if(s){ok++;editLog.push({timestamp:new Date(),action:'bulk_update',layerName:cfg.layer.title,featureOID:oid,changes:vals,success:true});}else{fail++;editLog.push({timestamp:new Date(),action:'bulk_update',layerName:cfg.layer.title,featureOID:oid,success:false,error:r.error?.message});}});updateStatus(`Processed ${Math.min(i+100,batches.length)}/${batches.length}`);}
            $('#bulkEditResults').innerHTML=`<div class="card" style="border-color:#a6e3a1;color:#a6e3a1;">✓ ${ok} updated${fail?` | ✗ ${fail} failed`:''}</div>`;
            if(currentBulkLayerIndex<el.length-1){updateStatus('Moving to next layer…');setTimeout(()=>{currentBulkLayerIndex++;showBulkEditForm();},2000);}else{setTimeout(()=>setPhase('complete'),2000);}
            }catch(err){$('#bulkEditResults').innerHTML=`<div class="card" style="border-color:#f38ba8;color:#f38ba8;">Error: ${err.message}</div>`;}
            finally{$('#applyBulkEditBtn').disabled=false;}
        }

        // ── Saved Configurations ──────────────────────────────────────────────
        function getSavedConfigurations(){try{return JSON.parse(localStorage.getItem('sequentialEditorConfigs')||'{}');}catch(e){return {};}}
        function loadSavedConfigurationsList(){const sel=$('#savedConfigSelect');sel.innerHTML='<option value="">-- Select saved config --</option>';Object.entries(getSavedConfigurations()).forEach(([id,c])=>{const d=new Date(c.savedAt),opt=document.createElement('option');opt.value=id;opt.textContent=`${c.name} (${d.toLocaleDateString()} ${d.toLocaleTimeString()})`;sel.appendChild(opt);});}
        function autoLoadLastConfiguration(){try{const id=localStorage.getItem('pathEditorLastConfig');if(!id)return;const cfg=getSavedConfigurations()[id];if(!cfg)return;const s=$('#layerConfigContainer').querySelectorAll('[data-layer-id]');if(!s?.length)return;$('#savedConfigSelect').value=id;applyConfigurationToUI(cfg);updateStatus(`Auto-loaded: "${cfg.name}"`);}catch(e){console.warn('Auto-load failed:',e);}}
        function saveConfiguration(){const layers=[];$('#layerConfigContainer').querySelectorAll('[data-layer-id]').forEach(section=>{const lid=section.dataset.layerId,chk=section.querySelector(`#layer_${lid}_enabled`);if(!chk?.checked)return;const data=selectedFeaturesByLayer.get(lid);if(!data)return;const mode=section.querySelector(`input[name="mode_${lid}"]:checked`)?.value||'edit';const lc={layerId:data.layer.layerId,layerTitle:data.layer.title,mode,order:parseInt(section.dataset.order||1),showPopup:section.querySelector(`#popup_${lid}`)?.checked??true,allowSkip:section.querySelector(`#allowskip_${lid}`)?.checked??true,fields:[],filterEnabled:false,filterWhere:''};const fEn=section.querySelector(`#enableFilter_${lid}`);if(fEn?.checked){lc.filterEnabled=true;lc.filterWhere=section.querySelector(`#filterWhere_${lid}`)?.value.trim()||'';}if(mode==='edit'){const fd=section.querySelector(`#fields_${lid}`);lc.fields=fd?.getCheckedFields?fd.getCheckedFields():Array.from(section.querySelectorAll(`#fields_${lid} input[type=checkbox]:checked`)).map(c=>c.dataset.fieldName);}layers.push(lc);});if(!layers.length){alert('No layers configured to save.');return;}const name=prompt('Configuration name:','My Configuration');if(!name)return;const all=getSavedConfigurations(),id='config_'+Date.now();all[id]={name,savedAt:new Date().toISOString(),layers};try{localStorage.setItem('sequentialEditorConfigs',JSON.stringify(all));updateStatus(`Saved "${name}"`);loadSavedConfigurationsList();}catch(e){alert('Save error: '+e.message);}}
        function loadConfiguration(){const id=$('#savedConfigSelect').value;if(!id){alert('Select a configuration first.');return;}const cfg=getSavedConfigurations()[id];if(!cfg){alert('Configuration not found.');return;}try{localStorage.setItem('pathEditorLastConfig',id);}catch(e){}applyConfigurationToUI(cfg);}
        function deleteConfiguration(){const sel=$('#savedConfigSelect'),id=sel.value;if(!id){alert('Select a configuration to delete.');return;}const all=getSavedConfigurations(),cfg=all[id];if(!cfg||!confirm(`Delete "${cfg.name}"?`))return;delete all[id];try{localStorage.setItem('sequentialEditorConfigs',JSON.stringify(all));updateStatus(`Deleted "${cfg.name}"`);loadSavedConfigurationsList();}catch(e){alert('Delete error: '+e.message);}}
        function applyConfigurationToUI(config){const sections=$('#layerConfigContainer').querySelectorAll('[data-layer-id]');let applied=0,skipped=[];sections.forEach(section=>{const lid=section.dataset.layerId,data=selectedFeaturesByLayer.get(lid);if(!data)return;const lc=config.layers.find(l=>l.layerId===data.layer.layerId);if(!lc)return;const chk=section.querySelector(`#layer_${lid}_enabled`);if(!chk){skipped.push(lc.layerTitle);return;}chk.checked=true;section.classList.add('enabled');const body=section.querySelector('.layerCardBody');if(body){body.style.display='block';const ch=section.querySelector('.layerCardHeader span:last-child');if(ch)ch.textContent='▲';}const modeR=section.querySelector(`input[name="mode_${lid}"][value="${lc.mode}"]`);if(modeR){modeR.checked=true;const fd=section.querySelector(`#fields_${lid}`);if(fd)fd.style.display=lc.mode==='edit'?'block':'none';}section.dataset.order=lc.order;const oi=section.querySelector('.orderInput');if(oi)oi.value=lc.order;const pc=section.querySelector(`#popup_${lid}`);if(pc)pc.checked=lc.showPopup;const sc=section.querySelector(`#allowskip_${lid}`);if(sc)sc.checked=lc.allowSkip;if(lc.filterEnabled){const fe=section.querySelector(`#enableFilter_${lid}`);if(fe)fe.checked=true;const fi=section.querySelector(`#filterInputs_${lid}`);if(fi)fi.style.display='block';const fw=section.querySelector(`#filterWhere_${lid}`);if(fw&&lc.filterWhere)fw.value=lc.filterWhere;}if(lc.mode==='edit'&&lc.fields?.length){const fd=section.querySelector(`#fields_${lid}`);if(fd?.setCheckedFields)fd.setCheckedFields(lc.fields);else section.querySelectorAll(`#fields_${lid} input[type=checkbox]`).forEach(c=>{c.checked=lc.fields.includes(c.dataset.fieldName);});}applied++;});if(applied===0)alert(`Configuration "${config.name}" could not be applied — no matching layers.`);else updateStatus(`Loaded "${config.name}" (${applied} layer${applied>1?'s':''}${skipped.length?`, skipped: ${skipped.join(', ')}`:''}).`);}

        // ── Complete / Report ─────────────────────────────────────────────────
        function displayEditSummary(){const edits=editLog.filter(e=>e.action==='update'||e.action==='bulk_update'),ok=edits.filter(e=>e.success).length,skip=editLog.filter(e=>e.action==='skip').length,fail=edits.filter(e=>!e.success).length,dur=sessionStartTime?Math.round((new Date()-sessionStartTime)/1000):0;$('#editSummary').innerHTML=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;"><div class="stat-box"><div style="font-size:20px;font-weight:700;color:#a6e3a1;">${ok}</div><div style="font-size:10px;color:#a6adc8;">Updated</div></div><div class="stat-box"><div style="font-size:20px;font-weight:700;color:#f9e2af;">${skip}</div><div style="font-size:10px;color:#a6adc8;">Skipped</div></div>${fail?`<div class="stat-box"><div style="font-size:20px;font-weight:700;color:#f38ba8;">${fail}</div><div style="font-size:10px;color:#a6adc8;">Failed</div></div>`:''}<div class="stat-box"><div style="font-size:20px;font-weight:700;color:#89b4fa;">${Math.floor(dur/60)}m ${dur%60}s</div><div style="font-size:10px;color:#a6adc8;">Duration</div></div></div>`;}
        function exportSummaryReport(){if(!editLog.length){alert('No edits to export.');return;}const end=new Date(),dur=sessionStartTime?Math.round((end-sessionStartTime)/1000):0,edits=editLog.filter(e=>e.action==='update'||e.action==='bulk_update');let r='='.repeat(70)+'\nPATH EDITOR — EDIT SUMMARY REPORT\n'+'='.repeat(70)+'\n\n';r+=`Session: ${sessionStartTime?.toLocaleString()||'Unknown'} → ${end.toLocaleString()}\nDuration: ${Math.floor(dur/60)}m ${dur%60}s\n\nUpdated: ${edits.filter(e=>e.success).length}  Skipped: ${editLog.filter(e=>e.action==='skip').length}  Failed: ${edits.filter(e=>!e.success).length}\n\nDETAILED LOG\n${'-'.repeat(70)}\n`;editLog.forEach((e,i)=>{r+=`[${i+1}] ${e.timestamp.toLocaleTimeString()} | ${e.layerName} | OID:${e.featureOID} | ${e.action.toUpperCase()} | ${e.success?'OK':'FAIL'}\n`;if(e.changes)Object.entries(e.changes).forEach(([k,v])=>{r+=`    ${k}: ${v.oldValue??''}→${v.newValue??v}\n`;});if(e.error)r+=`    Error: ${e.error}\n`;});const blob=new Blob([r],{type:'text/plain'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`path-editor-report-${end.toISOString().split('T')[0]}.txt`;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);updateStatus('Report exported.');}
        function startOver(){currentIndex=0;currentBulkLayerIndex=0;layerConfigs=[];currentEditingQueue=[];editLog=[];sessionStartTime=null;lastSubmittedValues=null;clearHighlights();clearSelection();setPhase('selection');updateStatus('Ready — choose a selection mode.');}

        // ── File Upload ───────────────────────────────────────────────────────
        function setupFileUpload(){
            const dz=$('#dropZone'),fi=$('#fileInput');
            if(!dz||!fi)return;
            dz.addEventListener('click',()=>fi.click());
            dz.addEventListener('dragover',e=>{e.preventDefault();dz.style.borderColor='#89b4fa';dz.style.background='#1e3a5f';});
            dz.addEventListener('dragleave',e=>{e.preventDefault();dz.style.borderColor='#45475a';dz.style.background='#181825';});
            dz.addEventListener('drop',e=>{e.preventDefault();dz.style.borderColor='#45475a';dz.style.background='#181825';addFilesToUpload(Array.from(e.dataTransfer.files));});
            fi.addEventListener('change',e=>{addFilesToUpload(Array.from(e.target.files));e.target.value='';});
        }
        function addFilesToUpload(files){
            const rej=[],added=[];
            files.forEach(f=>{if(!isAllowedFile(f)){rej.push(f.name);return;}if(!filesToUpload.find(x=>x.name===f.name&&x.size===f.size)){filesToUpload.push(f);added.push(f.name);}});
            updateFileList();
            if(rej.length)updateStatus('Skipped: '+rej.join(', '));
            else if(added.length)updateStatus(added.length+' file(s) queued — will upload on Submit');
        }
        function updateFileList(){
            const fl=$('#fileList');
            if(!fl)return;
            if(!filesToUpload.length){fl.innerHTML='';return;}
            fl.innerHTML=filesToUpload.map((f,i)=>`
                <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 6px;background:#313244;border-radius:4px;margin:3px 0;font-size:11px;">
                    <span>${fileTypeLabel(f)} ${f.name} <span style="color:#6c7086;">(${(f.size/1024).toFixed(1)}KB)</span></span>
                    <button class="removeFileBtn" data-index="${i}" style="background:#f38ba8;color:#1e1e2e;border:none;border-radius:3px;padding:1px 6px;cursor:pointer;font-size:11px;">×</button>
                </div>`).join('');
            fl.querySelectorAll('.removeFileBtn').forEach(btn=>btn.addEventListener('click',e=>{filesToUpload.splice(parseInt(e.target.dataset.index),1);updateFileList();}));
        }

        // Silent attachment uploader — called automatically from submitFeature
        async function uploadAttachments(layer, feature) {
            if (!filesToUpload.length) return;
            try {
                await layer.load();
                if (!layer.capabilities?.operations?.supportsAdd) {
                    updateStatus('Layer does not support attachments — files skipped.');
                    filesToUpload = []; updateFileList(); return;
                }
                let ok = 0, fail = 0;
                for (let i = 0; i < filesToUpload.length; i++) {
                    const f = filesToUpload[i];
                    try {
                        updateStatus(`Uploading attachment ${i+1}/${filesToUpload.length}: ${f.name}…`);
                        const fd = new FormData(); fd.append('attachment', f);
                        const res = await layer.addAttachment(feature, fd);
                        if (res?.addAttachmentResult || res?.objectId) ok++;
                        else throw new Error('Unexpected result');
                    } catch(e) { fail++; console.warn('Attachment upload failed:', f.name, e); }
                    await new Promise(r => setTimeout(r, 300));
                }
                updateStatus(`Attachments: ${ok} uploaded${fail ? ', ' + fail + ' failed' : ''}`);
            } catch(e) { updateStatus('Attachment upload error: ' + e.message); }
            filesToUpload = []; updateFileList();
        }

        // ── Cleanup ───────────────────────────────────────────────────────────
        function cleanup(){if(sketchViewModel){sketchViewModel.destroy();sketchViewModel=null;}if(mapClickHandler){mapClickHandler.remove();mapClickHandler=null;}clearHighlights();if(selectionGraphic)mapView.graphics.remove(selectionGraphic);toolBox.remove();const ps=document.getElementById('peStyles');if(ps)ps.remove();}

        // ── Event Wiring ──────────────────────────────────────────────────────
        $('#clearSelectionBtn').onclick  = clearSelection;
        $('#configureLayersBtn').onclick  = showLayerConfiguration;
        $('#backToSelectionBtn').onclick  = ()=>setPhase('selection');
        $('#saveConfigBtn').onclick       = saveConfiguration;
        $('#loadConfigBtn').onclick       = loadConfiguration;
        $('#deleteConfigBtn').onclick     = deleteConfiguration;
        $('#showSummaryBtn').onclick      = buildSummary;
        $('#backToConfigBtn').onclick     = ()=>setPhase('configuration');
        $('#startEditingBtn').onclick     = startEditing;
        $('#submitBtn').onclick           = submitFeature;
        $('#skipBtn').onclick             = skipFeature;
        $('#prevBtn').onclick             = prevFeature;
        $('#applyPrevBtn').onclick        = applyPreviousValues;
        $('#clearHighlightsBtn').onclick  = clearHighlights;
        $('#applyBulkEditBtn').onclick    = applyBulkEdit;
        $('#backToSummaryBtn').onclick    = ()=>setPhase('summary');
        $('#exportReportBtn').onclick     = exportSummaryReport;
        $('#startOverBtn').onclick        = startOver;
        $('#closeTool').onclick           = ()=>window.gisToolHost.closeTool('path-editor');

        setPhase('selection'); setupFileUpload(); startSelection();
        window.gisToolHost.activeTools.set('path-editor', { cleanup, toolBox });

    } catch(error) {
        alert('Error creating Path Editor Tool: '+(error.message||error));
    }
})();
