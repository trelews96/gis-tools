// tools/attachment-manager.js
// Feature Attachment Manager - Compatible with both Enterprise GIS host and AGOL Map Viewer

(function () {
    try {

        // ── Duplicate guard ───────────────────────────────────────────
        if (window.__attachmentManagerActive) {
            document.getElementById('attachmentManagerToolbox')?.remove();
            document.getElementById('amStyleEl')?.remove();
        }
        window.__attachmentManagerActive = true;

        const HAS_ENTERPRISE_GLOBALS = !!(window.gisToolHost && window.gisSharedUtils);
        let IS_ENTERPRISE = false;

        // ── Map view acquisition ──────────────────────────────────────
        function getMapViewAGOL() {
            return new Promise((resolve, reject) => {
                const known = ['esriMapView', 'calciteMapView', 'mapView', '__mapView', 'view'];
                for (const k of known) {
                    const v = window[k];
                    if (v && typeof v === 'object' && (v.type === '2d' || v.type === '3d') && v.map) {
                        console.log(`Attachment Manager: found view at window.${k}`);
                        return resolve(v);
                    }
                }
                for (const k of Object.keys(window)) {
                    try {
                        const v = window[k];
                        if (v && typeof v === 'object' && (v.type === '2d' || v.type === '3d') && v.map) {
                            console.log(`Attachment Manager: found view at window.${k}`);
                            return resolve(v);
                        }
                    } catch (_) {}
                }
                let attempts = 0;
                const poll = setInterval(() => {
                    attempts++;
                    for (const k of known) {
                        const v = window[k];
                        if (v && (v.type === '2d' || v.type === '3d') && v.map) {
                            clearInterval(poll); return resolve(v);
                        }
                    }
                    if (attempts >= 20) {
                        clearInterval(poll);
                        reject(new Error('Could not find the ArcGIS MapView. Make sure the map is fully loaded.'));
                    }
                }, 500);
            });
        }

        async function init() {
            let mapView;
            if (HAS_ENTERPRISE_GLOBALS) {
                try {
                    mapView = window.gisSharedUtils.getMapView();
                    if (mapView) IS_ENTERPRISE = true;
                } catch (e) {
                    console.warn('gisSharedUtils.getMapView() failed, trying AGOL path:', e.message);
                }
            }
            if (!mapView) {
                try { mapView = await getMapViewAGOL(); }
                catch (e) { alert('Attachment Manager: ' + e.message); window.__attachmentManagerActive = false; return; }
            }
            buildTool(mapView);
        }

        init();

        // ═══════════════════════════════════════════════════════════════
        // MAIN TOOL
        // ═══════════════════════════════════════════════════════════════
        function buildTool(mapView) {

            // ── Layer detection ───────────────────────────────────────
            const TARGET_LAYERS = [];
            mapView.map.allLayers.forEach(layer => {
                if (layer.type === 'feature') {
                    TARGET_LAYERS.push({
                        uid: layer.id,
                        layerId: layer.layerId,
                        name: layer.title || `Layer ${layer.id}`,
                        layer
                    });
                }
            });
            TARGET_LAYERS.sort((a, b) => a.name.localeCompare(b.name));

            if (!TARGET_LAYERS.length) {
                alert('No feature layers found. Make sure the map is fully loaded.');
                window.__attachmentManagerActive = false;
                return;
            }

            // ── Inject styles ─────────────────────────────────────────
            const styleEl = document.createElement('style');
            styleEl.id = 'amStyleEl';
            styleEl.textContent = `
                #attachmentManagerToolbox * { box-sizing: border-box; }
                #attachmentManagerToolbox a, #attachmentManagerToolbox label { color: #c4b5fd; cursor: pointer; }
                #attachmentManagerToolbox select {
                    width: 100%; padding: 6px 10px;
                    background: #0f0f1a; color: #e2e8f0;
                    border: 1px solid #4a3570; border-radius: 7px;
                    font-size: 12px; outline: none; cursor: pointer;
                }
                #attachmentManagerToolbox select:focus { border-color: #7c3aed; }
                #attachmentManagerToolbox input[type="radio"],
                #attachmentManagerToolbox input[type="checkbox"] { accent-color: #9c6fef; cursor: pointer; }
                .am-section {
                    background: #13132a; border: 1px solid #2a2050;
                    border-radius: 8px; padding: 10px 12px; margin-bottom: 10px;
                }
                .am-label {
                    display: block; font-weight: 700; color: #7c3aed;
                    font-size: 10px; text-transform: uppercase; letter-spacing: 0.09em;
                    margin-bottom: 8px;
                }
                .am-row { display: flex; align-items: center; gap: 8px; padding: 3px 0; color: #d4d4e8; font-size: 12px; }
                .am-hint { font-size: 10px; color: #52527a; margin-left: 22px; margin-top: 2px; }
                .am-btn {
                    padding: 7px 14px; border: none; border-radius: 7px; cursor: pointer;
                    font-size: 12px; font-weight: 600; transition: all 0.15s; outline: none;
                    display: inline-flex; align-items: center; gap: 5px; line-height: 1;
                }
                .am-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(0,0,0,.5); }
                .am-btn:active { transform: translateY(0); box-shadow: none; }
                .am-btn-primary { background: linear-gradient(135deg,#4c1d95,#6d28d9); color: #f0e6ff; }
                .am-btn-primary:hover { background: linear-gradient(135deg,#5b21b6,#7c3aed); }
                .am-btn-secondary { background: #1e1040; color: #c4b5fd; border: 1px solid #4a3570; }
                .am-btn-secondary:hover { background: #2d1b4e; border-color: #7c3aed; }
                .am-btn-ghost { background: transparent; color: #6b6b9a; border: 1px solid #2a2050; }
                .am-btn-ghost:hover { color: #c4b5fd; border-color: #4a3570; background: #13132a; }
                #polygonInstructions {
                    background: #1a0f35; border: 1px solid #5b21b6;
                    color: #c4b5fd; border-radius: 7px; padding: 8px 10px;
                    font-size: 11px; margin-top: 8px;
                }
                #attachmentManagerToolbox #dropZone {
                    border: 2px dashed #2a2050; border-radius: 8px; padding: 20px;
                    text-align: center; background: #0a0a18; cursor: pointer;
                    color: #52527a; transition: all 0.15s;
                }
                #attachmentManagerToolbox #dropZone:hover,
                #attachmentManagerToolbox #dropZone.drag-over {
                    border-color: #7c3aed; color: #c4b5fd; background: #13132a;
                }
                #attachmentManagerToolbox #selectedFeatureInfo .am-section { margin-bottom: 0; }
                #attachmentManagerToolbox ::-webkit-scrollbar { width: 5px; }
                #attachmentManagerToolbox ::-webkit-scrollbar-track { background: #0a0a18; }
                #attachmentManagerToolbox ::-webkit-scrollbar-thumb { background: #3b2061; border-radius: 3px; }
                #attachmentManagerToolbox ::-webkit-scrollbar-thumb:hover { background: #6d28d9; }
            `;
            document.head.appendChild(styleEl);

            // ── State ─────────────────────────────────────────────────
            let currentUid = TARGET_LAYERS[0].uid;
            let selectedFeatures = [];
            let selectedSingleFeature = null;
            let clickHandler = null;
            let popupWatcher = null;
            let filesToUpload = [];

            // Polygon draw state
            let drawnPolygonGraphic = null;
            let isDrawingPolygon = false;
            let polygonPoints     = [];
            let committedGraphics = [];
            let rubberGraphic     = null;
            let rafPending        = false;
            let lastCursor        = null;
            let prevPopupEnabled  = null;
            let polyClickHandler  = null;
            let polyMoveHandler   = null;
            let polyDblHandler    = null;
            let polyKeyHandler    = null;

            // ── Build UI ──────────────────────────────────────────────
            const toolBox = document.createElement('div');
            toolBox.id = 'attachmentManagerToolbox';
            toolBox.style.cssText = `
                position:fixed; top:80px; right:40px; z-index:99999;
                background:#0d0d1e; border:1px solid #3b2061;
                width:460px; max-width:90vw; max-height:85vh;
                font:12px/1.4 Arial,sans-serif;
                box-shadow:0 8px 40px rgba(0,0,0,.7); border-radius:10px;
                resize:both; overflow:hidden;
                display:flex; flex-direction:column;
            `;

            toolBox.innerHTML = `
                <!-- DRAG HANDLE -->
                <div id="amDragHandle" style="
                    cursor:grab; flex-shrink:0; user-select:none;
                    background:linear-gradient(135deg,#1e0a40,#120830);
                    border-bottom:1px solid #3b2061; border-radius:10px 10px 0 0;
                    padding:10px 14px; display:flex; align-items:center; justify-content:space-between;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="color:#6d28d9;font-size:16px;line-height:1;">⠿</span>
                        <span style="font-weight:700;color:#e2e8f0;font-size:13px;letter-spacing:0.02em;">📎 Feature Attachment Manager</span>
                    </div>
                    <button id="closeTool" title="Close" style="
                        background:transparent;border:none;color:#52527a;cursor:pointer;
                        font-size:18px;line-height:1;padding:2px 4px;transition:color 0.15s;
                    " onmouseover="this.style.color='#c4b5fd'" onmouseout="this.style.color='#52527a'">✕</button>
                </div>

                <!-- SCROLLABLE CONTENT -->
                <div style="overflow-y:auto; flex:1; padding:12px;">

                    <div class="am-section">
                        <label class="am-label">Target Layer</label>
                        <select id="layerSelect">
                            ${TARGET_LAYERS.map(l => `<option value="${l.uid}">${l.name} (ID: ${l.layerId})</option>`).join('')}
                        </select>
                    </div>

                    <div class="am-section">
                        <label class="am-label">Mode</label>
                        <div class="am-row"><input type="radio" id="batchMode" name="mode" value="batch" checked>
                            <label for="batchMode">Batch Download (Multiple Features)</label></div>
                        <div class="am-row"><input type="radio" id="singleMode" name="mode" value="single">
                            <label for="singleMode">Single Feature (Download / Upload)</label></div>
                    </div>

                    <!-- ── Batch controls ── -->
                    <div id="batchControls">
                        <div class="am-section">
                            <label class="am-label">Selection Method</label>
                            <div class="am-row"><input type="radio" id="currentSelection" name="selectionMethod" value="current" checked>
                                <label for="currentSelection">Use Current Selection</label></div>
                            <div class="am-row"><input type="radio" id="manualSelection" name="selectionMethod" value="manual">
                                <label for="manualSelection">Click to Select Features</label></div>
                            <div class="am-row"><input type="radio" id="polygonSelection" name="selectionMethod" value="polygon">
                                <label for="polygonSelection">Draw Polygon to Select</label></div>
                            <div id="polygonInstructions" style="display:none;">
                                🖊️ <strong>Click</strong> to add points &nbsp;|&nbsp; <strong>Double-click</strong> to finish &nbsp;|&nbsp; <strong>ESC</strong> to cancel
                            </div>
                        </div>

                        <div class="am-section">
                            <label class="am-label">Download Format</label>
                            <div class="am-row"><input type="radio" id="individualFiles" name="downloadFormat" value="individual" checked>
                                <label for="individualFiles">Individual Files</label></div>
                            <div class="am-row"><input type="radio" id="zipFile" name="downloadFormat" value="zip">
                                <label for="zipFile">Single ZIP File</label></div>
                        </div>

                        <div class="am-section">
                            <label class="am-label">Image Options</label>
                            <div class="am-row"><input type="checkbox" id="watermarkImages">
                                <label for="watermarkImages">Add Metadata Watermark to Images</label></div>
                            <div class="am-hint">Adds timestamp, address, and GIS ID to image corner</div>
                            <div class="am-hint">⚠️ Skips images that already have watermarks</div>
                            <div style="margin-left:22px;margin-top:6px;">
                                <div class="am-row"><input type="checkbox" id="includeStreetAddress" checked>
                                    <label for="includeStreetAddress" style="font-size:11px;">Include street address</label></div>
                            </div>
                        </div>

                        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
                            <button id="downloadBtn" class="am-btn am-btn-primary">⬇ Download All Attachments</button>
                            <button id="deselectBtn" class="am-btn am-btn-ghost" style="display:none;">✕ Deselect All</button>
                            <button id="clearPolygonBtn" class="am-btn am-btn-secondary" style="display:none;">↺ Redraw Polygon</button>
                        </div>
                    </div>

                    <!-- ── Single controls ── -->
                    <div id="singleControls" style="display:none;">
                        <div class="am-section" style="color:#6b6b9a;font-style:italic;font-size:12px;">
                            Click a <span id="layerHint">feature</span> to select it
                            <div style="margin-top:4px;font-size:11px;color:#3d3d5c;">💡 Use the map popup to pick a specific feature when multiple overlap</div>
                        </div>

                        <div class="am-section">
                            <label class="am-label">Image Options</label>
                            <div class="am-row"><input type="checkbox" id="watermarkImagesSingle">
                                <label for="watermarkImagesSingle">Add Metadata Watermark to Images</label></div>
                            <div style="margin-left:22px;margin-top:6px;">
                                <div class="am-row"><input type="checkbox" id="includeStreetAddressSingle" checked>
                                    <label for="includeStreetAddressSingle" style="font-size:11px;">Include street address</label></div>
                            </div>
                        </div>

                        <div id="selectedFeatureInfo" style="display:none;margin-bottom:10px;">
                            <div class="am-section">
                                <div style="font-weight:700;color:#7c3aed;margin-bottom:6px;font-size:10px;text-transform:uppercase;letter-spacing:0.09em;">Selected Feature</div>
                                <div id="featureDetails" style="color:#e2e8f0;font-size:12px;line-height:1.6;"></div>
                            </div>
                        </div>

                        <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
                            <button id="downloadSingleBtn" class="am-btn am-btn-primary" style="display:none;">⬇ Download Attachments</button>
                            <button id="clearSingleBtn" class="am-btn am-btn-ghost" style="display:none;">✕ Clear Selection</button>
                        </div>

                        <div id="uploadArea" style="display:none;margin-bottom:10px;">
                            <div id="dropZone">
                                <div style="font-size:24px;margin-bottom:6px;">📁</div>
                                <div style="font-weight:600;margin-bottom:4px;">Drag &amp; Drop Files Here</div>
                                <div style="font-size:11px;">or click to browse</div>
                                <input type="file" id="fileInput" multiple style="display:none;">
                            </div>
                            <div id="fileList" style="margin-top:8px;"></div>
                            <button id="uploadBtn" class="am-btn am-btn-primary" style="display:none;margin-top:8px;">⬆ Upload Files</button>
                        </div>
                    </div>

                    <div id="toolStatus" style="margin-top:6px;color:#9c6fef;min-height:16px;font-size:11px;"></div>
                    <div id="resultsDiv" style="margin-top:10px;"></div>
                </div>
            `;

            document.body.appendChild(toolBox);

            const $  = id => toolBox.querySelector(id);
            const setStatus = msg => { $('#toolStatus').textContent = msg; };

            // ── Drag ──────────────────────────────────────────────────
            const dragHandle = $('#amDragHandle');
            let isDragging = false, dragOffX = 0, dragOffY = 0;

            dragHandle.addEventListener('mousedown', e => {
                if (e.target.closest('#closeTool')) return;
                isDragging = true;
                const rect = toolBox.getBoundingClientRect();
                dragOffX = e.clientX - rect.left;
                dragOffY = e.clientY - rect.top;
                dragHandle.style.cursor = 'grabbing';
                e.preventDefault();
            });

            function onDragMove(e) {
                if (!isDragging) return;
                const x = Math.max(0, Math.min(e.clientX - dragOffX, window.innerWidth - toolBox.offsetWidth));
                const y = Math.max(0, Math.min(e.clientY - dragOffY, window.innerHeight - 40));
                toolBox.style.left = x + 'px';
                toolBox.style.top  = y + 'px';
                toolBox.style.right = 'auto';
            }
            function onDragUp() {
                isDragging = false;
                dragHandle.style.cursor = 'grab';
            }
            document.addEventListener('mousemove', onDragMove);
            document.addEventListener('mouseup',   onDragUp);

            // ── Layer helpers ─────────────────────────────────────────
            function getCurrentLayerInfo() { return TARGET_LAYERS.find(l => l.uid === currentUid); }
            async function getTargetLayer() {
                const info = getCurrentLayerInfo();
                if (!info) throw new Error('No layer selected.');
                await info.layer.load();
                return info.layer;
            }

            // ── Layer selector ────────────────────────────────────────
            $('#layerSelect').addEventListener('change', e => {
                currentUid = e.target.value;
                const info = getCurrentLayerInfo();
                $('#layerHint').textContent = info.name.toLowerCase();
                clearAllSelections();
                setStatus(`Switched to "${info.name}".`);
            });

            function clearAllSelections() {
                stopPolygonDraw();
                selectedFeatures = [];
                selectedSingleFeature = null;
                mapView.graphics.removeAll();
                drawnPolygonGraphic = null;
                $('#deselectBtn').style.display = 'none';
                $('#clearPolygonBtn').style.display = 'none';
                $('#polygonInstructions').style.display = 'none';
                $('#selectedFeatureInfo').style.display = 'none';
                $('#downloadSingleBtn').style.display = 'none';
                $('#clearSingleBtn').style.display = 'none';
                $('#uploadArea').style.display = 'none';
                $('#fileList').innerHTML = '';
                $('#uploadBtn').style.display = 'none';
                filesToUpload = [];
                $('#resultsDiv').innerHTML = '';
            }

            // ── Mode toggle ───────────────────────────────────────────
            toolBox.querySelectorAll('input[name="mode"]').forEach(r => {
                r.addEventListener('change', e => {
                    if (e.target.value === 'batch') {
                        $('#batchControls').style.display = 'block';
                        $('#singleControls').style.display = 'none';
                        stopPolygonDraw();
                        clearSingleSelection();
                        clickHandler?.remove(); clickHandler = null;
                        popupWatcher?.remove(); popupWatcher = null;
                    } else {
                        $('#batchControls').style.display = 'none';
                        $('#singleControls').style.display = 'block';
                        stopPolygonDraw();
                        selectedFeatures = [];
                        mapView.graphics.removeAll();
                        enableSingleSelection();
                    }
                });
            });

            // ── Batch selection method radios ─────────────────────────
            toolBox.querySelectorAll('input[name="selectionMethod"]').forEach(r => {
                r.addEventListener('change', e => {
                    stopPolygonDraw();
                    clickHandler?.remove(); clickHandler = null;
                    selectedFeatures = [];
                    mapView.graphics.removeAll();
                    drawnPolygonGraphic = null;
                    $('#deselectBtn').style.display = 'none';
                    $('#clearPolygonBtn').style.display = 'none';

                    if (e.target.value === 'manual') {
                        enableBatchManualSelection();
                    } else if (e.target.value === 'polygon') {
                        startPolygonDraw();
                    } else {
                        setStatus('Using current map selection.');
                    }
                });
            });

            // ══════════════════════════════════════════════════════════
            // POLYGON DRAW (manual — no module imports needed)
            // ══════════════════════════════════════════════════════════
            const polyVertexSymbol = { type:'simple-marker', style:'circle', color:[255,255,0,1],   size:9,  outline:{ color:[255,0,0,1], width:1.5 } };
            const polyLineSymbol   = { type:'simple-line',   color:[255,0,0,0.9], width:2, style:'dash' };
            const polyFillSymbol   = { type:'simple-fill',   color:[255,255,0,0.15], outline:{ color:[255,0,0,1], width:2 } };

            function sr() { return mapView.spatialReference; }

            function addGraphic(geometry, symbol) {
                mapView.graphics.add({ geometry, symbol });
                return mapView.graphics.getItemAt(mapView.graphics.length - 1);
            }
            function clearCommitted() {
                committedGraphics.forEach(g => { try { mapView.graphics.remove(g); } catch (_) {} });
                committedGraphics = [];
            }
            function clearRubber() {
                if (rubberGraphic) { try { mapView.graphics.remove(rubberGraphic); } catch (_) {} rubberGraphic = null; }
            }
            function clearPreview() { clearCommitted(); clearRubber(); }

            function rebuildCommitted() {
                clearCommitted();
                polygonPoints.forEach(p =>
                    committedGraphics.push(addGraphic({ type:'point', x:p[0], y:p[1], spatialReference: sr() }, polyVertexSymbol)));
                if (polygonPoints.length >= 2)
                    committedGraphics.push(addGraphic({ type:'polyline', paths:[polygonPoints.slice()], spatialReference: sr() }, polyLineSymbol));
                if (polygonPoints.length >= 3)
                    committedGraphics.push(addGraphic({ type:'polygon', rings:[[...polygonPoints, polygonPoints[0]]], spatialReference: sr() }, polyFillSymbol));
            }

            function updateRubber(cursor) {
                clearRubber();
                if (!polygonPoints.length || !cursor) return;
                const last = polygonPoints[polygonPoints.length - 1];
                rubberGraphic = addGraphic({ type:'polyline', paths:[[last, [cursor.x, cursor.y]]], spatialReference: sr() }, polyLineSymbol);
            }

            function startPolygonDraw() {
                stopPolygonDraw();
                mapView.graphics.removeAll();
                drawnPolygonGraphic = null;
                selectedFeatures = [];
                polygonPoints = [];
                isDrawingPolygon = true;
                prevPopupEnabled = mapView.popupEnabled;
                mapView.popupEnabled = false;
                $('#polygonInstructions').style.display = 'block';
                $('#clearPolygonBtn').style.display = 'none';
                $('#deselectBtn').style.display = 'none';
                $('#resultsDiv').innerHTML = '';
                setStatus('Click to add points. Double-click to finish. Esc to cancel.');

                polyClickHandler = mapView.on('immediate-click', event => {
                    if (!isDrawingPolygon) return;
                    const mp = event.mapPoint || mapView.toMap({ x: event.x, y: event.y });
                    if (!mp) return;
                    polygonPoints.push([mp.x, mp.y]);
                    rebuildCommitted();
                    clearRubber();
                    setStatus(`${polygonPoints.length} point(s). Double-click to finish.`);
                });

                polyMoveHandler = mapView.on('pointer-move', event => {
                    if (!isDrawingPolygon || !polygonPoints.length) return;
                    lastCursor = { x: event.x, y: event.y };
                    if (rafPending) return;
                    rafPending = true;
                    requestAnimationFrame(() => {
                        rafPending = false;
                        if (!isDrawingPolygon || !lastCursor) return;
                        const mp = mapView.toMap(lastCursor);
                        if (mp) updateRubber(mp);
                    });
                });

                polyDblHandler = mapView.on('double-click', event => {
                    if (!isDrawingPolygon) return;
                    event.stopPropagation();
                    finishPolygon();
                });

                polyKeyHandler = e => {
                    if (e.key === 'Escape') { stopPolygonDraw(); setStatus('Drawing cancelled.'); }
                };
                window.addEventListener('keydown', polyKeyHandler);
            }

            function finishPolygon() {
                const cleaned = [];
                polygonPoints.forEach(p => {
                    const last = cleaned[cleaned.length - 1];
                    if (!last || last[0] !== p[0] || last[1] !== p[1]) cleaned.push(p);
                });
                if (cleaned.length < 3) {
                    setStatus('Need at least 3 points — keep clicking, then double-click to finish.');
                    return;
                }
                isDrawingPolygon = false;
                removeDrawHandlers();
                clearPreview();
                $('#polygonInstructions').style.display = 'none';

                const ring = ensureClockwise(cleaned);
                ring.push([ring[0][0], ring[0][1]]);
                const geom = { type:'polygon', rings:[ring], spatialReference: sr() };

                drawnPolygonGraphic = { geometry: geom, symbol: polyFillSymbol };
                mapView.graphics.add(drawnPolygonGraphic);
                $('#clearPolygonBtn').style.display = 'inline-flex';
                selectFeaturesInPolygon(geom);
            }

            function ensureClockwise(pts) {
                let area = 0;
                for (let i = 0; i < pts.length; i++) {
                    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
                    area += (x1 * y2 - x2 * y1);
                }
                return area > 0 ? pts.slice().reverse() : pts.slice();
            }

            function removeDrawHandlers() {
                polyClickHandler?.remove(); polyClickHandler = null;
                polyMoveHandler?.remove();  polyMoveHandler  = null;
                polyDblHandler?.remove();   polyDblHandler   = null;
                if (polyKeyHandler) { window.removeEventListener('keydown', polyKeyHandler); polyKeyHandler = null; }
            }

            function stopPolygonDraw() {
                isDrawingPolygon = false;
                removeDrawHandlers();
                clearPreview();
                polygonPoints = [];
                rafPending = false;
                lastCursor = null;
                if (prevPopupEnabled !== null) { mapView.popupEnabled = prevPopupEnabled; prevPopupEnabled = null; }
                $('#polygonInstructions').style.display = 'none';
            }

            // "↺ Redraw Polygon" button: clear current polygon + immediately start a new draw
            // so the user never has to toggle the radio off and back on.
            function clearPolygonSelection() {
                stopPolygonDraw();
                mapView.graphics.removeAll();
                drawnPolygonGraphic = null;
                selectedFeatures = [];
                $('#clearPolygonBtn').style.display = 'none';
                $('#deselectBtn').style.display = 'none';
                $('#resultsDiv').innerHTML = '';
                startPolygonDraw();
            }

            async function selectFeaturesInPolygon(polygon) {
                try {
                    setStatus('Selecting features within polygon…');
                    const layer = await getTargetLayer();
                    const result = await layer.queryFeatures({
                        geometry: polygon, spatialRelationship: 'intersects',
                        returnGeometry: true, outFields: ['*']
                    });
                    selectedFeatures = result.features.map(f => ({ attributes: f.attributes, layer, geometry: f.geometry }));
                    result.features.forEach(f => {
                        mapView.graphics.add({
                            geometry: f.geometry,
                            symbol: { type:'simple-marker', color:[255,255,0,0.9], size:12, outline:{ color:[255,0,0,1], width:2 } }
                        });
                    });
                    $('#deselectBtn').style.display = 'inline-flex';
                    setStatus(`✅ ${selectedFeatures.length} feature(s) selected.`);
                } catch (err) {
                    console.error('Polygon query error:', err);
                    setStatus('Error selecting features: ' + err.message);
                }
            }

            // ── Manual batch click selection ──────────────────────────
            function enableBatchManualSelection() {
                clickHandler = mapView.on('click', async event => {
                    try {
                        setStatus('Identifying features…');
                        const response = await mapView.hitTest(event);
                        const hits = response.results.filter(r => r.graphic?.layer?.id === currentUid);
                        if (!hits.length) { setStatus(`No "${getCurrentLayerInfo().name}" features found here.`); return; }
                        const g = hits[0].graphic;
                        const oid = g.attributes[g.layer.objectIdField];
                        if (selectedFeatures.some(f => f.attributes[f.layer.objectIdField] === oid)) { setStatus('Feature already selected.'); return; }
                        selectedFeatures.push({ attributes: g.attributes, layer: g.layer, geometry: g.geometry });
                        mapView.graphics.add({ geometry: g.geometry, symbol: { type:'simple-marker', color:[255,255,0,0.9], size:12, outline:{ color:[255,0,0,1], width:2 } } });
                        $('#deselectBtn').style.display = 'inline-flex';
                        setStatus(`${selectedFeatures.length} feature(s) selected.`);
                    } catch (err) { setStatus('Error: ' + err.message); }
                });
                setStatus(`Click "${getCurrentLayerInfo().name}" features to select them.`);
            }

            // ── Single feature selection ──────────────────────────────
            function enableSingleSelection() {
                popupWatcher?.remove();
                popupWatcher = mapView.popup.watch('selectedFeature', f => {
                    if (f?.layer?.id === currentUid) selectSingleFromFeature(f);
                });
                clickHandler?.remove();
                clickHandler = mapView.on('click', async event => {
                    try {
                        const response = await mapView.hitTest(event);
                        const hits = response.results.filter(r => r.graphic?.layer?.id === currentUid);
                        if (!hits.length) { setStatus(`No "${getCurrentLayerInfo().name}" features found here.`); return; }
                        selectSingleFromFeature(hits[0].graphic);
                    } catch (err) { setStatus('Error: ' + err.message); }
                });
                setStatus(`Click a "${getCurrentLayerInfo().name}" feature to select it.`);
            }

            async function selectSingleFromFeature(featureOrGraphic) {
                try {
                    const layer = await getTargetLayer();
                    const oid = featureOrGraphic.attributes[layer.objectIdField];
                    const qr = await layer.queryFeatures({ objectIds:[oid], outFields:['*'], returnGeometry:true });
                    if (!qr.features.length) { setStatus('Could not load feature.'); return; }
                    clearSingleSelection();
                    const f = qr.features[0];
                    selectedSingleFeature = { attributes: f.attributes, layer, geometry: f.geometry };
                    mapView.graphics.add({ geometry: f.geometry, symbol: { type:'simple-marker', color:[0,255,0,0.8], size:14, outline:{ color:[0,150,0,1], width:3 } } });
                    const gisId = f.attributes.gis_id || f.attributes.GIS_ID || oid;
                    $('#featureDetails').innerHTML = `<span style="color:#7c3aed;font-size:10px;font-weight:700;">LAYER</span><br>${getCurrentLayerInfo().name}<br><span style="color:#7c3aed;font-size:10px;font-weight:700;">GIS ID</span><br>${gisId}<br><span style="color:#7c3aed;font-size:10px;font-weight:700;">OBJECT ID</span><br>${oid}`;
                    $('#selectedFeatureInfo').style.display = 'block';
                    $('#downloadSingleBtn').style.display = 'inline-flex';
                    $('#clearSingleBtn').style.display = 'inline-flex';
                    $('#uploadArea').style.display = 'block';
                    setStatus('Feature selected. Download or upload attachments.');
                } catch (err) { setStatus('Error: ' + err.message); }
            }

            function clearSingleSelection() {
                selectedSingleFeature = null;
                mapView.graphics.removeAll();
                $('#selectedFeatureInfo').style.display = 'none';
                $('#downloadSingleBtn').style.display = 'none';
                $('#clearSingleBtn').style.display = 'none';
                $('#uploadArea').style.display = 'none';
                $('#fileList').innerHTML = '';
                $('#uploadBtn').style.display = 'none';
                filesToUpload = [];
                setStatus('Selection cleared.');
            }

            // ── File upload ───────────────────────────────────────────
            const dropZone = $('#dropZone'), fileInput = $('#fileInput');
            dropZone.addEventListener('click', () => fileInput.click());
            dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
            dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
            dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('drag-over'); addFiles(Array.from(e.dataTransfer.files)); });
            fileInput.addEventListener('change', e => addFiles(Array.from(e.target.files)));

            function addFiles(files) {
                files.forEach(f => { if (!filesToUpload.find(x => x.name === f.name && x.size === f.size)) filesToUpload.push(f); });
                renderFileList();
            }
            function renderFileList() {
                if (!filesToUpload.length) { $('#fileList').innerHTML = ''; $('#uploadBtn').style.display = 'none'; return; }
                $('#fileList').innerHTML = `<div style="font-weight:700;color:#7c3aed;font-size:10px;text-transform:uppercase;letter-spacing:0.09em;margin-bottom:6px;">Files to Upload</div>` +
                    filesToUpload.map((f, i) => `
                        <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:#0a0a18;border:1px solid #2a2050;border-radius:6px;margin:3px 0;">
                            <span style="font-size:11px;color:#e2e8f0;">${f.name} <span style="color:#52527a;">(${(f.size/1024).toFixed(1)} KB)</span></span>
                            <button onclick="window.__amRemoveFile(${i})" style="background:#3b0a0a;color:#f87171;border:1px solid #7f1d1d;padding:2px 8px;cursor:pointer;border-radius:5px;font-size:11px;font-weight:600;">✕</button>
                        </div>`).join('');
                $('#uploadBtn').style.display = 'inline-flex';
            }
            window.__amRemoveFile = i => { filesToUpload.splice(i, 1); renderFileList(); };

            // ── Geocoding ─────────────────────────────────────────────
            async function reverseGeocode(lat, lon, includeStreet = true) {
                try {
                    const r = await fetch(`https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?f=json&location=${lon},${lat}&langCode=EN`);
                    if (!r.ok) return null;
                    const d = await r.json();
                    if (!d.address) return null;
                    const a = d.address, parts = [];
                    if (includeStreet && a.Address) parts.push(a.Address);
                    const csz = [a.City, a.Region, a.Postal].filter(Boolean);
                    if (csz.length) parts.push(csz.join(', '));
                    return { fullAddress: parts.join('\n'), streetAddress: a.Address||null, city: a.City||null, state: a.Region||null, zip: a.Postal||null };
                } catch { return null; }
            }

            // ── EXIF / watermark libs ─────────────────────────────────
            function loadLib(name, src) {
                return new Promise((res, rej) => {
                    if (window[name]) { res(window[name]); return; }
                    const s = document.createElement('script');
                    s.src = src; s.onload = () => res(window[name]); s.onerror = () => rej(new Error('Failed to load ' + src));
                    document.head.appendChild(s);
                });
            }
            const loadEXIF   = () => loadLib('EXIF',   'https://cdn.jsdelivr.net/npm/exif-js');
            const loadPiexif = () => loadLib('piexif', 'https://cdn.jsdelivr.net/npm/piexifjs/piexif.min.js');

            async function hasExistingWatermark(blob) {
                try {
                    if (await checkOurMarker(blob)) return true;
                    if (await checkWatermarkApps(blob)) return true;
                    if (await detectVisualWatermark(blob)) return true;
                    return false;
                } catch { return false; }
            }

            async function checkOurMarker(blob) {
                try {
                    const EXIF = await loadEXIF();
                    return new Promise(res => {
                        const img = new Image(), url = URL.createObjectURL(blob);
                        img.onload = function() { EXIF.getData(img, function() { const uc = EXIF.getTag(this,'UserComment'); URL.revokeObjectURL(url); res(!!(uc&&uc.includes('GIS_WATERMARKED_v1'))); }); };
                        img.onerror = () => { URL.revokeObjectURL(url); res(false); };
                        img.src = url;
                    });
                } catch { return false; }
            }

            async function checkWatermarkApps(blob) {
                try {
                    const EXIF = await loadEXIF();
                    return new Promise(res => {
                        const img = new Image(), url = URL.createObjectURL(blob);
                        img.onload = function() {
                            EXIF.getData(img, function() {
                                const apps = ['timestamp','watermark','photowatermark','iwatermark','camerafi','photo stamp','salt camera'];
                                const fields = [EXIF.getTag(this,'Software'),EXIF.getTag(this,'UserComment'),EXIF.getTag(this,'ImageDescription')].filter(Boolean).map(f=>String(f).toLowerCase());
                                URL.revokeObjectURL(url);
                                res(apps.some(a => fields.some(f => f.includes(a))));
                            });
                        };
                        img.onerror = () => { URL.revokeObjectURL(url); res(false); };
                        img.src = url;
                    });
                } catch { return false; }
            }

            async function detectVisualWatermark(blob) {
                return new Promise(res => {
                    const img = new Image(), url = URL.createObjectURL(blob);
                    img.onload = () => {
                        try {
                            const sw = Math.min(400, Math.floor(img.width*0.3)), sh = Math.min(300, Math.floor(img.height*0.2));
                            const c = document.createElement('canvas'); c.width=sw; c.height=sh;
                            const ctx = c.getContext('2d');
                            ctx.drawImage(img, img.width-sw, 0, sw, sh, 0, 0, sw, sh);
                            const d = ctx.getImageData(0,0,sw,sh).data;
                            let w=0,b=0,ct=0,br=0; const tot=sw*sh;
                            for (let i=0;i<d.length;i+=4) {
                                const [r,g,bv]=[d[i],d[i+1],d[i+2]]; br+=(r+g+bv)/3;
                                if(r>240&&g>240&&bv>240) w++; if(r<50&&g<50&&bv<50) b++;
                                if(i<d.length-4){const df=Math.abs(r-d[i+4])+Math.abs(g-d[i+5])+Math.abs(bv-d[i+6]); if(df>200) ct++;}
                            }
                            const wp=w/tot*100,bp=b/tot*100,cp=ct/tot*100,avg=br/tot;
                            const uniform=cp<2&&(avg>200||avg<50);
                            URL.revokeObjectURL(url);
                            res(!uniform&&((wp>3&&bp>1.5&&cp>5)||(wp>5&&cp>8)||(bp>3&&wp>2&&cp>6)));
                        } catch { URL.revokeObjectURL(url); res(false); }
                    };
                    img.onerror = () => { URL.revokeObjectURL(url); res(false); };
                    img.src = url;
                });
            }

            async function extractExifData(blob, includeStreet=true) {
                try {
                    const EXIF = await loadEXIF();
                    return new Promise(res => {
                        const img = new Image(), url = URL.createObjectURL(blob);
                        img.onload = async function() {
                            EXIF.getData(img, async function() {
                                const data = { timestamp:null, location:null, addressData:null };
                                const dts = EXIF.getTag(this,'DateTimeOriginal')||EXIF.getTag(this,'DateTime');
                                if (dts) {
                                    const [dp,tp] = dts.split(' ');
                                    const d = new Date(`${dp.replace(/:/g,'-')}T${tp}`);
                                    if (!isNaN(d)) data.timestamp = d.toLocaleString('en-US',{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true});
                                }
                                const lat=EXIF.getTag(this,'GPSLatitude'),latR=EXIF.getTag(this,'GPSLatitudeRef');
                                const lon=EXIF.getTag(this,'GPSLongitude'),lonR=EXIF.getTag(this,'GPSLongitudeRef');
                                if (lat&&lon) {
                                    const lt=dmsToDD(lat,latR), ln=dmsToDD(lon,lonR);
                                    const addr = await reverseGeocode(lt,ln,includeStreet);
                                    data.location = addr ? addr.fullAddress : `${lt.toFixed(6)}, ${ln.toFixed(6)}`;
                                    data.addressData = addr;
                                }
                                URL.revokeObjectURL(url); res(data);
                            });
                        };
                        img.onerror = () => { URL.revokeObjectURL(url); res({timestamp:null,location:null}); };
                        img.src = url;
                    });
                } catch { return {timestamp:null,location:null}; }
            }

            function dmsToDD(dms, ref) {
                if (!Array.isArray(dms)||dms.length<3) return 0;
                let dd = dms[0]+dms[1]/60+dms[2]/3600;
                if (ref==='S'||ref==='W') dd*=-1;
                return dd;
            }

            function formatTimestamp(att) {
                const ts = att.createdDate||att.editDate||att.uploadDate;
                if (!ts) return null;
                const d = new Date(ts);
                return isNaN(d)?null:d.toLocaleString('en-US',{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true});
            }

            function extractLocation(feature) {
                if (!feature?.geometry) return null;
                const a = feature.attributes;
                const addr = a.address||a.Address||a.location||a.Location||a.site_address||a.SITE_ADDRESS;
                if (addr) return addr;
                if (feature.geometry.type==='point') {
                    const x=feature.geometry.longitude??feature.geometry.x, y=feature.geometry.latitude??feature.geometry.y;
                    if (x&&y) return `${y.toFixed(6)}, ${x.toFixed(6)}`;
                }
                return null;
            }

            async function watermarkImage(blob, metadata, exifData=null) {
                return new Promise(async (resolve, reject) => {
                    const img = new Image(), url = URL.createObjectURL(blob);
                    img.onload = async () => {
                        try {
                            const canvas = document.createElement('canvas');
                            canvas.width=img.width; canvas.height=img.height;
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(img,0,0);
                            const lines = [];
                            const ts = exifData?.timestamp || metadata.timestamp;
                            if (ts) lines.push(ts);
                            if (exifData?.addressData) {
                                if (exifData.addressData.streetAddress) lines.push(exifData.addressData.streetAddress);
                                const csz=[exifData.addressData.city,exifData.addressData.state,exifData.addressData.zip].filter(Boolean);
                                if (csz.length) lines.push(csz.join(', '));
                            } else if (exifData?.location) {
                                lines.push(...exifData.location.split('\n'));
                            } else if (metadata.location) {
                                lines.push(metadata.location);
                            }
                            if (metadata.gisId) lines.push(`GIS ${metadata.gisId}`);
                            if (lines.length) {
                                const fs=Math.max(28,Math.floor(img.height/35)), lh=fs*1.25, pad=fs*1.2;
                                ctx.font=`bold ${fs}px Arial,sans-serif`; ctx.textAlign='right'; ctx.textBaseline='top';
                                lines.forEach((line,i) => {
                                    ctx.strokeStyle='rgba(0,0,0,0.9)'; ctx.lineWidth=Math.max(3,fs/10);
                                    ctx.strokeText(line, img.width-pad, pad+i*lh);
                                    ctx.fillStyle='white'; ctx.fillText(line, img.width-pad, pad+i*lh);
                                });
                            }
                            canvas.toBlob(async cb => {
                                try { resolve(await addWatermarkExif(cb, blob)); }
                                catch { URL.revokeObjectURL(url); resolve(cb); }
                            }, 'image/jpeg', 0.95);
                        } catch(e) { URL.revokeObjectURL(url); reject(e); }
                    };
                    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
                    img.src = url;
                });
            }

            async function addWatermarkExif(wBlob, origBlob) {
                try {
                    const piexif = await loadPiexif();
                    const origUrl = await blobToDataUrl(origBlob), wUrl = await blobToDataUrl(wBlob);
                    let exifObj;
                    try { exifObj = piexif.load(origUrl); } catch { exifObj = {'0th':{},'Exif':{},'GPS':{},'Interop':{},'1st':{},thumbnail:null}; }
                    if (!exifObj.Exif) exifObj.Exif = {};
                    exifObj.Exif[piexif.ExifIFD.UserComment] = 'GIS_WATERMARKED_v1';
                    return dataUrlToBlob(piexif.insert(piexif.dump(exifObj), wUrl));
                } catch { return wBlob; }
            }

            const blobToDataUrl = b => new Promise((res,rej) => { const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(b); });
            const dataUrlToBlob = du => new Promise(res => {
                const [hdr,data]=du.split(','), mime=hdr.match(/:(.*?);/)[1], bstr=atob(data);
                let n=bstr.length; const u8=new Uint8Array(n);
                while(n--) u8[n]=bstr.charCodeAt(n);
                res(new Blob([u8],{type:mime}));
            });

            // ── ZIP ───────────────────────────────────────────────────
            function crc32(data) {
                const t=[]; for(let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++) c=(c&1)?(c>>>1)^0xEDB88320:c>>>1; t[i]=c;}
                let crc=0xFFFFFFFF; new Uint8Array(data).forEach(b=>{crc=t[(crc^b)&0xFF]^(crc>>>8);}); return (crc^0xFFFFFFFF)>>>0;
            }
            function localHeader(name, size, crc) {
                const nb=new TextEncoder().encode(name), h=new DataView(new ArrayBuffer(30+nb.length));
                h.setUint32(0,0x04034b50,true); h.setUint16(4,20,true); h.setUint32(14,crc,true); h.setUint32(18,size,true); h.setUint32(22,size,true); h.setUint16(26,nb.length,true);
                new Uint8Array(h.buffer,30).set(nb); return h.buffer;
            }
            function centralEntry(name, size, crc, offset) {
                const nb=new TextEncoder().encode(name), h=new DataView(new ArrayBuffer(46+nb.length));
                h.setUint32(0,0x02014b50,true); h.setUint16(4,20,true); h.setUint16(6,20,true); h.setUint32(16,crc,true); h.setUint32(20,size,true); h.setUint32(24,size,true); h.setUint16(28,nb.length,true); h.setUint32(42,offset,true);
                new Uint8Array(h.buffer,46).set(nb); return h.buffer;
            }
            function endRecord(count, cdSize, cdOffset) {
                const h=new DataView(new ArrayBuffer(22));
                h.setUint32(0,0x06054b50,true); h.setUint16(8,count,true); h.setUint16(10,count,true); h.setUint32(12,cdSize,true); h.setUint32(16,cdOffset,true); return h.buffer;
            }
            function createZip(files) {
                const locals=[],central=[]; let offset=0;
                files.forEach(f=>{const c=crc32(f.data),lh=localHeader(f.name,f.data.byteLength,c); locals.push(lh,f.data); central.push(centralEntry(f.name,f.data.byteLength,c,offset)); offset+=lh.byteLength+f.data.byteLength;});
                const cdSize=central.reduce((s,e)=>s+e.byteLength,0);
                return new Blob([...locals,...central,endRecord(files.length,cdSize,offset)],{type:'application/zip'});
            }

            function triggerDownload(blob, filename) {
                const url=URL.createObjectURL(blob), a=document.createElement('a');
                a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
                setTimeout(()=>URL.revokeObjectURL(url),1000);
            }

            // ── Batch download ────────────────────────────────────────
            async function downloadBatchAttachments() {
                try {
                    setStatus('Preparing…');
                    $('#resultsDiv').innerHTML = '';
                    const layer = await getTargetLayer();
                    let features = [];

                    const method = toolBox.querySelector('input[name="selectionMethod"]:checked').value;
                    if (method === 'current') {
                        const sf = mapView.popup?.selectedFeature;
                        if (sf?.layer?.id === currentUid) features = [sf];
                        else {
                            const lv = mapView.allLayerViews?.find(v => v.layer.id === currentUid);
                            if (lv?.highlightedFeatures?.length) features = lv.highlightedFeatures.toArray();
                        }
                    } else {
                        features = selectedFeatures;
                    }

                    if (!features.length) { alert('No features selected. Please select features first.'); return; }

                    const fmt = toolBox.querySelector('input[name="downloadFormat"]:checked').value;
                    const doWatermark = $('#watermarkImages')?.checked;
                    const includeStreet = $('#includeStreetAddress')?.checked;
                    setStatus(`${features.length} feature(s). Fetching attachments…`);

                    let totalAtts=0, downloaded=0;
                    const results=[], zipFiles=[];

                    for (let i=0; i<features.length; i++) {
                        const feat = features[i];
                        const oid = feat.attributes[layer.objectIdField];
                        setStatus(`Checking feature ${i+1}/${features.length}…`);
                        try {
                            const q = await layer.queryAttachments({ objectIds:[oid], returnMetadata:true });
                            const atts = q[oid] || [];
                            totalAtts += atts.length;
                            results.push({ oid, atts, ok:true });
                            for (const att of atts) {
                                setStatus(`Downloading ${att.name} (${downloaded+1}/${totalAtts})…`);
                                const resp = await fetch(att.url);
                                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                                let blob = await resp.blob();
                                const gisId = feat.attributes.gis_id || feat.attributes.GIS_ID || oid;
                                const fname = `${getCurrentLayerInfo().name.replace(/\s+/g,'')}_GIS_${gisId}_${att.name}`;
                                if (doWatermark && att.contentType?.startsWith('image/')) {
                                    if (await hasExistingWatermark(blob)) {
                                        setStatus(`Skipping ${att.name} – already watermarked`);
                                    } else {
                                        setStatus(`Watermarking ${att.name}…`);
                                        const exif = await extractExifData(blob, includeStreet);
                                        blob = await watermarkImage(blob, { timestamp:formatTimestamp(att), location:extractLocation(feat), gisId, layerName:getCurrentLayerInfo().name }, exif);
                                    }
                                }
                                if (fmt==='zip') { zipFiles.push({name:fname, data:await blob.arrayBuffer()}); }
                                else { triggerDownload(blob, fname); await new Promise(r=>setTimeout(r,100)); }
                                downloaded++;
                            }
                        } catch(e) { results.push({oid, atts:[], ok:false, error:e.message}); }
                    }

                    if (fmt==='zip' && zipFiles.length) {
                        setStatus('Building ZIP…');
                        const today = new Date().toISOString().split('T')[0];
                        triggerDownload(createZip(zipFiles), `${getCurrentLayerInfo().name.replace(/\s+/g,'')}_Attachments_${today}.zip`);
                    }

                    let html = `<div style="background:#13132a;border:1px solid #2a2050;border-radius:8px;padding:10px;">
                        <div style="font-weight:700;color:#9c6fef;margin-bottom:6px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;">Results — ${getCurrentLayerInfo().name}</div>
                        <div style="color:#d4d4e8;margin-bottom:6px;">Features: ${features.length} &nbsp;|&nbsp; Attachments: ${totalAtts} &nbsp;|&nbsp; Downloaded: ${downloaded}</div>
                        <div style="max-height:160px;overflow-y:auto;">`;
                    results.forEach(r => {
                        html += r.ok
                            ? `<div style="color:#86efac;">✓ OID ${r.oid}: ${r.atts.length} file(s)</div>${r.atts.map(a=>`<div style="margin-left:14px;font-size:11px;color:#52527a;">• ${a.name}</div>`).join('')}`
                            : `<div style="color:#f87171;">✗ OID ${r.oid}: ${r.error}</div>`;
                    });
                    html += '</div></div>';
                    $('#resultsDiv').innerHTML = html;
                    setStatus(fmt==='zip' ? `✅ ZIP ready — ${downloaded} file(s).` : `✅ Done — ${downloaded} file(s) downloaded.`);
                } catch(e) { console.error(e); setStatus('Error: '+e.message); }
            }

            // ── Single download ───────────────────────────────────────
            async function downloadSingleAttachments() {
                if (!selectedSingleFeature) { alert('Select a feature first.'); return; }
                try {
                    setStatus('Downloading…');
                    const layer = await getTargetLayer();
                    const oid = selectedSingleFeature.attributes[layer.objectIdField];
                    const q = await layer.queryAttachments({ objectIds:[oid], returnMetadata:true });
                    const atts = q[oid];
                    if (!atts?.length) { setStatus('No attachments found.'); $('#resultsDiv').innerHTML='<div style="color:#52527a;padding:8px;">No attachments found.</div>'; return; }
                    const doWatermark = $('#watermarkImagesSingle')?.checked;
                    const includeStreet = $('#includeStreetAddressSingle')?.checked;
                    let done=0;
                    for (const att of atts) {
                        setStatus(`Downloading ${att.name} (${done+1}/${atts.length})…`);
                        const resp = await fetch(att.url); if (!resp.ok) continue;
                        let blob = await resp.blob();
                        const gisId = selectedSingleFeature.attributes.gis_id || selectedSingleFeature.attributes.GIS_ID || oid;
                        if (doWatermark && att.contentType?.startsWith('image/')) {
                            if (!await hasExistingWatermark(blob)) {
                                const exif = await extractExifData(blob, includeStreet);
                                blob = await watermarkImage(blob, { timestamp:formatTimestamp(att), location:extractLocation(selectedSingleFeature), gisId, layerName:getCurrentLayerInfo().name }, exif);
                            }
                        }
                        triggerDownload(blob, `${getCurrentLayerInfo().name.replace(/\s+/g,'')}_GIS_${gisId}_${att.name}`);
                        done++; await new Promise(r=>setTimeout(r,100));
                    }
                    $('#resultsDiv').innerHTML = `<div style="background:#13132a;border:1px solid #2a2050;border-radius:8px;padding:10px;">
                        <div style="font-weight:700;color:#9c6fef;margin-bottom:6px;font-size:11px;text-transform:uppercase;">Results</div>
                        <div style="color:#86efac;margin-bottom:4px;">✓ ${done}/${atts.length} downloaded</div>
                        ${atts.map(a=>`<div style="font-size:11px;color:#52527a;">• ${a.name}</div>`).join('')}
                    </div>`;
                    setStatus(`✅ Done — ${done} file(s).`);
                } catch(e) { console.error(e); setStatus('Error: '+e.message); }
            }

            // ── Upload ────────────────────────────────────────────────
            async function uploadAttachments() {
                if (!selectedSingleFeature) { alert('Select a feature first.'); return; }
                if (!filesToUpload.length) { alert('Choose files to upload.'); return; }
                setStatus('Uploading…');
                const layer = await getTargetLayer();
                let ok=0, fail=0; const results=[];
                for (let i=0; i<filesToUpload.length; i++) {
                    const file = filesToUpload[i];
                    setStatus(`Uploading ${file.name} (${i+1}/${filesToUpload.length})…`);
                    try {
                        const fd = new FormData(); fd.append('attachment',file); fd.append('f','json');
                        await layer.addAttachment(selectedSingleFeature, fd);
                        results.push({name:file.name,ok:true}); ok++;
                    } catch(e) { results.push({name:file.name,ok:false,error:e.message}); fail++; }
                    await new Promise(r=>setTimeout(r,200));
                }
                $('#resultsDiv').innerHTML = `<div style="background:#13132a;border:1px solid #2a2050;border-radius:8px;padding:10px;">
                    <div style="font-weight:700;color:#9c6fef;margin-bottom:6px;font-size:11px;text-transform:uppercase;">Upload Results</div>
                    <div style="color:#d4d4e8;margin-bottom:4px;">${ok} succeeded${fail?`, ${fail} failed`:''}</div>
                    ${results.map(r=>`<div style="font-size:11px;color:${r.ok?'#86efac':'#f87171'};">${r.ok?'✓':'✗'} ${r.name}${r.ok?'':' — '+r.error}</div>`).join('')}
                </div>`;
                setStatus(`✅ Upload complete — ${ok}/${filesToUpload.length}.`);
                filesToUpload=[]; $('#fileList').innerHTML=''; $('#uploadBtn').style.display='none';
            }

            // ── Button wiring ─────────────────────────────────────────
            $('#downloadBtn').onclick    = downloadBatchAttachments;
            $('#downloadSingleBtn').onclick = downloadSingleAttachments;
            $('#uploadBtn').onclick      = uploadAttachments;
            $('#deselectBtn').onclick    = () => {
                selectedFeatures=[]; mapView.graphics.removeAll(); drawnPolygonGraphic = null;
                $('#deselectBtn').style.display='none'; $('#clearPolygonBtn').style.display='none';
                $('#resultsDiv').innerHTML=''; setStatus('');
                // If polygon mode is still active, restart drawing immediately
                const method = toolBox.querySelector('input[name="selectionMethod"]:checked')?.value;
                if (method === 'polygon') startPolygonDraw();
            };
            $('#clearSingleBtn').onclick  = clearSingleSelection;
            $('#clearPolygonBtn').onclick = clearPolygonSelection;
            $('#closeTool').onclick       = cleanup;

            // ── Cleanup ───────────────────────────────────────────────
            function cleanup() {
                stopPolygonDraw();
                clickHandler?.remove();
                popupWatcher?.remove();
                document.removeEventListener('mousemove', onDragMove);
                document.removeEventListener('mouseup',   onDragUp);
                mapView.graphics.removeAll();
                if (window.__amRemoveFile) delete window.__amRemoveFile;
                document.getElementById('amStyleEl')?.remove();
                toolBox.remove();
                if (IS_ENTERPRISE && window.gisToolHost) window.gisToolHost.activeTools?.delete('attachment-manager');
                window.__attachmentManagerActive = false;
                console.log('Attachment Manager cleaned up.');
            }

            if (IS_ENTERPRISE && window.gisToolHost) {
                window.gisToolHost.activeTools?.set('attachment-manager', { cleanup, toolBox });
            }

            setStatus(`Ready — ${TARGET_LAYERS.length} layer(s) detected.`);
            console.log('Attachment Manager loaded successfully.');
        }

    } catch(err) {
        console.error('Attachment Manager init error:', err);
        alert('Attachment Manager failed to load: ' + (err.message || err));
        window.__attachmentManagerActive = false;
    }
})();
