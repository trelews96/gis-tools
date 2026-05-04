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

        let sketchViewModel      = null;
        let sketchLayer          = null;
        let selectionGraphic     = null;
        let activeQueryController = null;  // cancels in-flight selections if user aborts
        let selectionGraphics    = [];
        let accumulateMode       = false;
        let selectedFeaturesByLayer = new Map();
        let layerConfigs         = [];
        let currentEditingQueue  = [];
        let currentIndex         = 0;
        let currentPhase         = 'selection';
        let highlightGraphics    = [];
        let bulkHighlightGraphics = [];
        let editLog              = [];
        let sessionStartTime     = null;
        let selectionMode        = 'single';
        let mapClickHandler      = null;
        let filesToUpload        = [];
        let lastSubmittedValues  = null;
        // Persists textarea heights within a session, keyed by field name.
        // Cleared on startOver so a fresh session starts without stale sizes.
        const textareaHeights    = new Map();

        function layerKey(layer) {
            return 'L' + String(layer.uid).replace(/\W/g, '_');
        }

        const ALLOWED_MIME_TYPES = new Set([
            'image/jpeg','image/png','image/gif','image/webp','image/bmp','image/tiff',
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel','text/csv','text/plain',
        ]);
        const ALLOWED_EXTENSIONS = new Set(['jpg','jpeg','png','gif','webp','bmp','tiff','tif','pdf','xlsx','xls','csv']);
        function isAllowedFile(f) {
            if (ALLOWED_MIME_TYPES.has(f.type)) return true;
            return ALLOWED_EXTENSIONS.has(f.name.split('.').pop().toLowerCase());
        }
        function fileTypeLabel(f) {
            const ext = f.name.split('.').pop().toLowerCase();
            if (['jpg','jpeg','png','gif','webp','bmp','tiff','tif'].includes(ext)) return '🖼️';
            if (ext==='pdf') return '📄';
            if (['xlsx','xls'].includes(ext)) return '📊';
            if (ext==='csv') return '📋';
            return '📎';
        }

        // ── Auto-calculation rules ────────────────────────────────────────────
        const AUTO_CALC_RULES = [
            {
                layerMatch: 'fiber cable',
                watchFields: ['sequential_in', 'sequential_out'],
                targetField: 'sequential_qty',
                compute: (vals) => Math.abs(vals['sequential_in'] - vals['sequential_out'])
            }
        ];

        const toolBox = document.createElement('div');
        toolBox.id = 'pathEditorToolbox';
        toolBox.style.cssText = `
            position:fixed;top:80px;right:40px;z-index:${z};
            background:#1e1e2e;color:#cdd6f4;border:1px solid #313244;border-radius:10px;
            width:400px;max-height:88vh;overflow:hidden;
            font:13px/1.4 "Segoe UI",Arial,sans-serif;
            box-shadow:0 8px 32px rgba(0,0,0,.5);display:flex;flex-direction:column;user-select:none;`;
        toolBox.innerHTML = `
        <div id="peHeader" style="padding:10px 14px;background:#181825;border-radius:10px 10px 0 0;display:flex;align-items:center;justify-content:space-between;cursor:move;border-bottom:1px solid #313244;flex-shrink:0;">
            <span style="font-weight:700;font-size:14px;color:#cba6f7;">🔧 Path Editor</span>
            <div style="display:flex;gap:6px;align-items:center;">
                <span id="phaseIndicator" style="font-size:10px;background:#313244;padding:2px 8px;border-radius:10px;color:#a6e3a1;"></span>
                <button id="closeTool" style="background:#f38ba8;border:none;color:#1e1e2e;width:20px;height:20px;border-radius:50%;cursor:pointer;font-size:12px;font-weight:bold;display:flex;align-items:center;justify-content:center;">✕</button>
            </div>
        </div>
        <div id="peBody" style="overflow-y:auto;flex:1;padding:14px;">

        <!-- Phase 1: Selection -->
        <div id="selectionPhase">
            <div style="margin-bottom:10px;font-size:11px;color:#a6adc8;">Choose a selection mode — Single Click is active by default.</div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px;">
                <label class="modeCard" data-mode="single"><input type="radio" name="selectionMode" value="single" checked style="display:none;"><div class="modeIcon">🖱️</div><div class="modeLabel">Single Click</div></label>
                <label class="modeCard" data-mode="line"><input type="radio" name="selectionMode" value="line" style="display:none;"><div class="modeIcon">📏</div><div class="modeLabel">Line Path</div></label>
                <label class="modeCard" data-mode="polygon"><input type="radio" name="selectionMode" value="polygon" style="display:none;"><div class="modeIcon">⬡</div><div class="modeLabel">Polygon</div></label>
            </div>
            <div id="multiSelectRow" style="margin-bottom:10px;padding:7px 10px;background:#313244;border-radius:6px;display:flex;align-items:center;gap:8px;">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:11px;color:#a6adc8;flex:1;">
                    <input type="checkbox" id="multiSelectChk" style="accent-color:#cba6f7;">
                    <span><strong style="color:#cdd6f4;">Multi-Select</strong> — keep clicking to build selection</span>
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
                <select id="savedConfigSelect" class="input-ctrl" style="margin-bottom:6px;"><option value="">-- Select saved config --</option></select>
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
                <input type="checkbox" id="skipSummaryChk" style="accent-color:#cba6f7;"> Skip review — go straight to editing
            </label>
        </div>

        <!-- Phase 3: Summary -->
        <div id="summaryPhase" style="display:none;">
            <div style="font-weight:700;margin-bottom:8px;">Review Configuration</div>
            <div id="summaryContent" class="card" style="margin-bottom:10px;"></div>
            <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer;background:#313244;padding:8px;border-radius:6px;">
                <input type="checkbox" id="bulkEditMode" style="accent-color:#cba6f7;">
                <div><strong style="color:#f9e2af;">⚡ Bulk Edit Mode</strong><div style="font-size:10px;color:#a6adc8;">Apply same values to all features at once</div></div>
            </label>
            <label style="display:flex;align-items:center;gap:8px;margin-bottom:12px;cursor:pointer;background:#313244;padding:8px;border-radius:6px;">
                <input type="checkbox" id="interleaveMode" style="accent-color:#89b4fa;">
                <div><strong style="color:#89b4fa;">⇄ Interleave Layers</strong><div style="font-size:10px;color:#a6adc8;">Alternate features between layers (e.g. Pole → Gig → Pole → Gig)</div></div>
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
            <div style="margin-bottom:10px;">
                <div style="font-size:11px;font-weight:700;color:#89b4fa;margin-bottom:6px;">📎 Attachments <span style="font-size:10px;color:#6c7086;font-weight:normal;"> — optional, uploads with Submit</span></div>
                <div id="dropZone" style="border:2px dashed #45475a;padding:14px;text-align:center;background:#181825;cursor:pointer;border-radius:6px;transition:all .2s;color:#a6adc8;font-size:12px;">
                    📁 Drag &amp; Drop or <span style="color:#89b4fa;text-decoration:underline;">browse</span>
                    <input type="file" id="fileInput" multiple accept="image/*,.pdf,.xlsx,.xls,.csv" style="display:none;">
                </div>
                <div id="fileList" style="margin-top:6px;"></div>
            </div>
            <div id="existingAttachmentsSection" style="margin-bottom:10px;display:none;">
                <div style="font-size:11px;font-weight:700;color:#f9e2af;margin-bottom:6px;">🗂️ Existing Attachments</div>
                <div id="existingAttachmentsList"></div>
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
            <div id="bulkEditMapNotice" style="display:none;margin-bottom:10px;padding:8px 10px;background:#2a1f3d;border:1px solid #cba6f7;border-radius:6px;font-size:11px;color:#cba6f7;">
                🗺️ Features highlighted on map in orange
            </div>
            <div id="bulkEditLayerSelector" style="margin-bottom:10px;"></div>
            <div id="bulkEditFormContainer" style="margin-bottom:10px;"></div>
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

        </div>
        <div id="toolStatus" style="padding:5px 14px;font-size:10px;color:#89dceb;background:#181825;border-top:1px solid #313244;border-radius:0 0 10px 10px;min-height:22px;flex-shrink:0;"></div>
        `;

        // ── CSS ───────────────────────────────────────────────────────────────
        if (!document.getElementById('peStyles')) {
            const s = document.createElement('style'); s.id='peStyles';
            s.textContent = `
            #pathEditorToolbox .btn{padding:6px 10px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;transition:opacity .15s;}
            #pathEditorToolbox .btn:hover{opacity:.85;}
            #pathEditorToolbox .btn:disabled{opacity:.4;cursor:not-allowed;}
            #pathEditorToolbox .btn-primary {background:#cba6f7;color:#1e1e2e;}
            #pathEditorToolbox .btn-success {background:#a6e3a1;color:#1e1e2e;}
            #pathEditorToolbox .btn-secondary{background:#45475a;color:#cdd6f4;}
            #pathEditorToolbox .btn-info    {background:#89b4fa;color:#1e1e2e;}
            #pathEditorToolbox .btn-warning {background:#f9e2af;color:#1e1e2e;}
            #pathEditorToolbox .btn-danger  {background:#f38ba8;color:#1e1e2e;}
            #pathEditorToolbox .card{background:#181825;border:1px solid #313244;border-radius:8px;padding:10px;}
            #pathEditorToolbox .info-card{background:#1e3a5f;border-color:#2a5298;}
            #pathEditorToolbox .card-label{font-size:10px;font-weight:700;text-transform:uppercase;color:#6c7086;letter-spacing:.05em;margin-bottom:6px;}
            #pathEditorToolbox .input-ctrl{width:100%;padding:6px 8px;background:#313244;border:1px solid #45475a;border-radius:6px;color:#cdd6f4;font-size:12px;box-sizing:border-box;}
            #pathEditorToolbox .input-ctrl:focus{outline:none;border-color:#cba6f7;}
            #pathEditorToolbox .field-label{font-size:11px;font-weight:700;color:#a6adc8;margin-bottom:3px;display:flex;align-items:center;justify-content:space-between;}
            #pathEditorToolbox .current-hint{font-size:10px;color:#6c7086;margin-bottom:2px;}
            #pathEditorToolbox .modeCard{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:10px 6px;background:#313244;border:2px solid #45475a;border-radius:8px;cursor:pointer;transition:all .15s;text-align:center;}
            #pathEditorToolbox .modeCard:hover{border-color:#89b4fa;background:#1e3a5f;}
            #pathEditorToolbox .modeCard.active{border-color:#cba6f7;background:#2a1f3d;}
            #pathEditorToolbox .modeIcon{font-size:20px;}
            #pathEditorToolbox .modeLabel{font-size:10px;font-weight:600;color:#a6adc8;}
            #pathEditorToolbox .layerCard{border:1px solid #45475a;border-radius:8px;margin-bottom:8px;overflow:hidden;}
            #pathEditorToolbox .layerCard.enabled{border-color:#cba6f7;}
            #pathEditorToolbox .layerCardHeader{padding:10px 12px;background:#313244;display:flex;align-items:center;gap:8px;cursor:pointer;}
            #pathEditorToolbox .layerCardBody{padding:10px 12px;display:none;}
            #pathEditorToolbox .toggle-wrap{position:relative;width:32px;height:18px;flex-shrink:0;}
            #pathEditorToolbox .toggle-wrap input{display:none;}
            #pathEditorToolbox .toggle-slider{position:absolute;inset:0;background:#45475a;border-radius:10px;cursor:pointer;transition:background .2s;}
            #pathEditorToolbox .toggle-slider::after{content:'';position:absolute;width:12px;height:12px;background:#cdd6f4;border-radius:50%;top:3px;left:3px;transition:left .2s;}
            #pathEditorToolbox .toggle-wrap input:checked+.toggle-slider{background:#cba6f7;}
            #pathEditorToolbox .toggle-wrap input:checked+.toggle-slider::after{left:17px;}
            #pathEditorToolbox .fieldListContainer{background:#0f0f17;border:1px solid #313244;border-radius:6px;max-height:160px;overflow-y:auto;}
            #pathEditorToolbox .fieldItem{display:flex;align-items:center;gap:8px;padding:5px 8px;border-bottom:1px solid #1e1e2e;cursor:pointer;}
            #pathEditorToolbox .fieldItem:last-child{border-bottom:none;}
            #pathEditorToolbox .fieldItem:hover{background:#1e1e2e;}
            #pathEditorToolbox .fieldItem input[type=checkbox]{accent-color:#cba6f7;}
            #pathEditorToolbox .fieldBadge{font-size:9px;padding:1px 5px;border-radius:4px;background:#313244;color:#a6adc8;white-space:nowrap;}
            #pathEditorToolbox .domain-btn{width:100%;padding:7px 10px;background:#313244;border:1px solid #45475a;border-radius:6px;color:#cdd6f4;font-size:12px;text-align:left;display:flex;justify-content:space-between;align-items:center;cursor:pointer;box-sizing:border-box;}
            #pathEditorToolbox .domain-btn:hover,#pathEditorToolbox .domain-btn.open{border-color:#cba6f7;}
            #pathEditorToolbox .progress-bar-wrap{background:#313244;border-radius:4px;height:6px;margin-top:6px;overflow:hidden;}
            #pathEditorToolbox .progress-bar-fill{height:100%;background:#a6e3a1;border-radius:4px;transition:width .3s;}
            #pathEditorToolbox .stat-box{background:#313244;border-radius:6px;padding:8px;text-align:center;}
            `;
            document.head.appendChild(s);
        }
        document.body.appendChild(toolBox);

        const $ = id => toolBox.querySelector(id);
        const status = $('#toolStatus');
        function updateStatus(msg){status.textContent=msg;}

        // ── Dragging ──────────────────────────────────────────────────────────
        let isDragging=false,dragOX=0,dragOY=0;
        $('#peHeader').addEventListener('mousedown',e=>{
            if(e.target.closest('#closeTool'))return;
            isDragging=true;const r=toolBox.getBoundingClientRect();dragOX=e.clientX-r.left;dragOY=e.clientY-r.top;e.preventDefault();
        });
        document.addEventListener('mousemove',e=>{if(!isDragging)return;toolBox.style.right='auto';toolBox.style.left=(e.clientX-dragOX)+'px';toolBox.style.top=(e.clientY-dragOY)+'px';});
        document.addEventListener('mouseup',()=>{isDragging=false;});

        // ── Phase management ──────────────────────────────────────────────────
        const phaseNames={selection:'Selection',configuration:'Configuration',summary:'Review',editing:'Editing',bulkEdit:'Bulk Edit',complete:'Complete'};
        function setPhase(phase){
            currentPhase=phase;
            ['selection','configuration','summary','editing','bulkEdit','complete'].forEach(p=>{const el=$(`#${p}Phase`);if(el)el.style.display='none';});
            const t=$(`#${phase}Phase`);if(t)t.style.display='block';
            const ind=$('#phaseIndicator');if(ind)ind.textContent=phaseNames[phase]||phase;
            if(phase==='configuration'){loadSavedConfigurationsList();autoLoadLastConfiguration();}
            if(phase!=='bulkEdit')clearBulkHighlights();
        }

        // ── Multi-select toggle ───────────────────────────────────────────────
        $('#multiSelectChk').addEventListener('change',e=>{
            accumulateMode=e.target.checked;
            if(!accumulateMode){
                if(mapClickHandler){mapClickHandler.remove();mapClickHandler=null;}
                if(selectedFeaturesByLayer.size===0) startSelection();
            } else {
                if(!mapClickHandler&&selectionMode==='single') enableSingleFeatureSelection();
            }
        });

        // ── Mode Cards ────────────────────────────────────────────────────────
        function updateModeCards(){
            toolBox.querySelectorAll('.modeCard').forEach(c=>c.classList.toggle('active',c.dataset.mode===selectionMode));
            const msRow=$('#multiSelectRow');
            if(msRow)msRow.style.display=selectionMode==='single'?'flex':'none';
        }
        toolBox.querySelectorAll('.modeCard').forEach(card=>{
            card.addEventListener('click',()=>{
                card.querySelector('input').checked=true;selectionMode=card.dataset.mode;updateModeCards();
                if(sketchViewModel){try{sketchViewModel.cancel();}catch(e){}}
                if(sketchLayer){try{sketchLayer.removeAll();}catch(e){sketchLayer.graphics&&sketchLayer.graphics.removeAll();}}
                if(selectionGraphic){mapView.graphics.remove(selectionGraphic);selectionGraphic=null;}
                selectionGraphics.forEach(g=>{try{mapView.graphics.remove(g);}catch(e){}});selectionGraphics=[];
                if(mapClickHandler){mapClickHandler.remove();mapClickHandler=null;}
                selectedFeaturesByLayer.clear();$('#selectionResults').innerHTML='';
                $('#configureLayersBtn').style.display='none';$('#clearSelectionBtn').disabled=true;
                clearSelectionHighlights();
                startSelection();
            });
        });
        updateModeCards();

        // ── Selection ─────────────────────────────────────────────────────────
        function startSelection(){
            clearSelection();
            if(selectionMode==='polygon') enablePolygonDrawing();
            else if(selectionMode==='line') enableLineDrawing();
            else enableSingleFeatureSelection();
        }
        function enablePolygonDrawing(){initializeSketchViewModel(()=>{sketchViewModel.create('polygon');updateStatus('Draw polygon — click points, double-click to finish.');});}
        function enableLineDrawing(){initializeSketchViewModel(()=>{sketchViewModel.create('polyline');updateStatus('Draw path — click points, double-click to finish.');});}

        function enableSingleFeatureSelection(){
            updateStatus(accumulateMode
                ? 'Click to select features — each click adds to the selection.'
                : 'Click on the map to select nearby features.');
            if(mapClickHandler){mapClickHandler.remove();mapClickHandler=null;}
            mapClickHandler=mapView.on('click',async event=>{
                try{
                    updateStatus('Selecting features…');
                    const sp=mapView.toScreen(event.mapPoint);
                    const p1=mapView.toMap({x:sp.x,y:sp.y}),p2=mapView.toMap({x:sp.x+10,y:sp.y});
                    if(!window.geometryEngine)await new Promise(r=>window.require(['esri/geometry/geometryEngine'],ge=>{window.geometryEngine=ge;r();}));
                    const rawDist=window.geometryEngine.distance(p1,p2,'meters');
                    const bufDist=Math.min(rawDist,150);
                    const bufGeom=window.geometryEngine.buffer(event.mapPoint,bufDist,'meters');

                    await new Promise(r=>window.require(['esri/Graphic'],G=>{
                        const g=new G({geometry:event.mapPoint,symbol:{type:'simple-marker',color:[255,0,0,.8],size:accumulateMode?8:12,outline:{color:[255,255,255,1],width:1.5}}});
                        mapView.graphics.add(g);
                        if(accumulateMode){selectionGraphics.push(g);}
                        else{
                            if(selectionGraphic)mapView.graphics.remove(selectionGraphic);
                            selectionGraphic=g;
                        }
                        r();
                    }));

                    const savedSelection=accumulateMode?new Map(selectedFeaturesByLayer):null;

                    selectedFeaturesByLayer.clear();
                    await queryAllLayers(bufGeom,'intersects',null);
                    const newResults=new Map(selectedFeaturesByLayer);

                    if(accumulateMode&&savedSelection&&savedSelection.size>0){
                        savedSelection.forEach((v,k)=>selectedFeaturesByLayer.set(k,v));
                        newResults.forEach((newData,key)=>{
                            if(selectedFeaturesByLayer.has(key)){
                                const existing=selectedFeaturesByLayer.get(key);
                                const oidF=newData.layer.objectIdField||'OBJECTID';
                                const existingOids=new Set(existing.features.map(f=>f.attributes[oidF]));
                                const toAdd=newData.features.filter(f=>!existingOids.has(f.attributes[oidF]));
                                if(toAdd.length)existing.features=[...existing.features,...toAdd];
                            }else{
                                selectedFeaturesByLayer.set(key,newData);
                            }
                        });
                    }

                    if(selectedFeaturesByLayer.size>0){
                        displaySelectionResults();
                        $('#clearSelectionBtn').disabled=false;
                        if(!accumulateMode){
                            if(mapClickHandler){mapClickHandler.remove();mapClickHandler=null;}
                        }
                    }else{
                        updateStatus('No features found — try clicking elsewhere.');
                    }
                }catch(err){updateStatus('Error: '+err.message);}
            });
        }

        function initializeSketchViewModel(callback){
            if(!window.require){updateStatus('Cannot load drawing tools.');return;}
            if(sketchViewModel){if(callback)callback();return;}
            window.require(['esri/widgets/Sketch/SketchViewModel','esri/layers/GraphicsLayer'],(SVM,GraphicsLayer)=>{
                sketchLayer=new GraphicsLayer({listMode:'hide',legendEnabled:false,title:'__pathEditorSketch'});
                mapView.map.add(sketchLayer);
                sketchViewModel=new SVM({
                    view:mapView,layer:sketchLayer,
                    polygonSymbol:{type:'simple-fill',color:[255,255,0,.25],outline:{color:[203,166,247,1],width:2}},
                    polylineSymbol:{type:'simple-line',color:[203,166,247,1],width:3}
                });
                sketchViewModel.on('create',async evt=>{
                    if(evt.state!=='complete')return;
                    selectionGraphic=evt.graphic;
                    try{
                        if(selectionMode==='polygon')await selectFeaturesInPolygon(selectionGraphic.geometry);
                        else if(selectionMode==='line')await selectFeaturesAlongLine(selectionGraphic.geometry);
                    }catch(err){
                        updateStatus('Selection error: '+err.message);
                        console.error('Sketch selection error:',err);
                        // Reset sketch state so the tool isn't stuck
                        try{sketchViewModel.cancel();}catch(e){}
                        if(sketchLayer)try{sketchLayer.removeAll();}catch(e){}
                        selectionGraphic=null;
                        $('#clearSelectionBtn').disabled=true;
                    }
                    $('#clearSelectionBtn').disabled=false;
                });
                if(callback)callback();
            });
        }

        async function queryAllLayers(geometry,spatialRel,lineForOrder){
            const s=mapView.scale;
            const allVisible=mapView.map.allLayers.filter(l=>{
                if(l.type!=='feature'||!l.visible)return false;
                if(l.minScale>0&&s>l.minScale)return false;
                if(l.maxScale>0&&s<l.maxScale)return false;
                return true;
            }).toArray();

            // If a saved config is loaded, only query those specific layers rather than
            // all visible feature layers. At 200-1000 users this is the single biggest
            // lever for reducing aggregate server load — most users will have a config.
            let allFL = allVisible;
            const configId = $('#savedConfigSelect')?.value;
            if(configId){
                const cfg = getSavedConfigurations()[configId];
                if(cfg?.layers?.length){
                    const cfgIds = new Set(cfg.layers.map(l=>l.layerId));
                    const filtered = allVisible.filter(l=>cfgIds.has(l.layerId));
                    if(filtered.length) allFL = filtered;
                }
            }

            // Process layers in small batches instead of all at once with Promise.all.
            // This prevents hammering the server with N simultaneous requests and is the
            // main cause of the heavy server load observed with polygon/line selections.
            const BATCH_SIZE = 3;
            for(let i=0;i<allFL.length;i+=BATCH_SIZE){
                const batch=allFL.slice(i,i+BATCH_SIZE);
                await Promise.all(batch.map(async layer=>{
                    try{
                        await layer.load();
                        let lv=null;try{lv=await mapView.whenLayerView(layer);}catch(e){}
                        const qp={
                            geometry,
                            spatialRelationship:spatialRel,
                            returnGeometry:true,
                            outFields:['*'],
                            num:2000,               // cap results per layer — prevents unbounded payloads
                            geometryPrecision:6,    // reduces geometry payload size without affecting usability
                        };
                        if(lv?.filter?.where)qp.where=lv.filter.where;else if(layer.definitionExpression)qp.where=layer.definitionExpression;
                        const res=await layer.queryFeatures(qp);
                        if(!res.features.length)return;
                        let features=res.features,orderedByLine=false;
                        if(lineForOrder){features=orderFeaturesAlongLine(features,lineForOrder);orderedByLine=true;}
                        selectedFeaturesByLayer.set(layerKey(layer),{layer,features,orderedByLine});
                    }catch(e){console.warn('Layer query error:',layer.title,e);}
                }));
            }
        }

        function orderFeaturesAlongLine(features,line){
            return features.map(f=>{
                let dist=0;
                try{
                    let pt=f.geometry.type==='point'?f.geometry:f.geometry.type==='polygon'?f.geometry.centroid:f.geometry.type==='polyline'&&f.geometry.paths?.[0]?{type:'point',x:f.geometry.paths[0][Math.floor(f.geometry.paths[0].length/2)][0],y:f.geometry.paths[0][Math.floor(f.geometry.paths[0].length/2)][1],spatialReference:f.geometry.spatialReference}:null;
                    if(pt){const nc=window.geometryEngine.nearestCoordinate(line,pt);if(nc?.coordinate&&nc.vertexIndex!==undefined){let cum=0;for(let i=0;i<nc.vertexIndex;i++){const a={type:'point',x:line.paths[0][i][0],y:line.paths[0][i][1],spatialReference:line.spatialReference},b={type:'point',x:line.paths[0][i+1][0],y:line.paths[0][i+1][1],spatialReference:line.spatialReference};cum+=window.geometryEngine.distance(a,b,'meters');}const lv2={type:'point',x:line.paths[0][nc.vertexIndex][0],y:line.paths[0][nc.vertexIndex][1],spatialReference:line.spatialReference};cum+=window.geometryEngine.distance(lv2,nc.coordinate,'meters');dist=cum;}}
                }catch(e){}
                return{f,dist};
            }).sort((a,b)=>a.dist-b.dist).map(x=>x.f);
        }

        async function selectFeaturesInPolygon(polygon){
            updateStatus('Selecting features in polygon…');
            selectedFeaturesByLayer.clear();
            // Load geometryEngine if not already available — same guard as selectFeaturesAlongLine.
            // Without this, generalize() throws if polygon fires before line has ever run.
            if(!window.geometryEngine)await new Promise(r=>window.require(['esri/geometry/geometryEngine'],ge=>{window.geometryEngine=ge;r();}));
            const tol=(mapView.extent.width/mapView.width)*2;
            const geom=window.geometryEngine.generalize(polygon,tol,true,'meters')||polygon;
            await queryAllLayers(geom,'intersects',null);
            displaySelectionResults();
        }
        async function selectFeaturesAlongLine(line){
            updateStatus('Selecting features along line…');
            selectedFeaturesByLayer.clear();
            if(!window.geometryEngine)await new Promise(r=>window.require(['esri/geometry/geometryEngine'],ge=>{window.geometryEngine=ge;r();}));
            const tol=(mapView.extent.width/mapView.width)*2;
            const simpleLine=window.geometryEngine.generalize(line,tol,true,'meters')||line;
            const rawLineDist=(mapView.extent.width/mapView.width)*20;
            const bufDist=Math.min(rawLineDist,300);
            const bufGeom=window.geometryEngine.buffer(simpleLine,bufDist,'meters');
            await queryAllLayers(bufGeom,'intersects',simpleLine);
            displaySelectionResults();
            updateStatus(`Features selected along path (${Math.round(bufDist)}m buffer).`);
        }

        function displaySelectionResults(){
            const div=$('#selectionResults');
            if(!selectedFeaturesByLayer.size){div.innerHTML='<div style="color:#f38ba8;font-size:11px;padding:6px 0;">No features found.</div>';$('#configureLayersBtn').style.display='none';}
            else{
                const totalFeatures=[...selectedFeaturesByLayer.values()].reduce((s,d)=>s+d.features.length,0);
                const msBadge=accumulateMode?`<span style="background:#cba6f7;color:#1e1e2e;font-size:9px;padding:1px 6px;border-radius:8px;font-weight:700;margin-left:6px;">${totalFeatures} total</span>`:'' ;
                let html=`<div class="card" style="padding:8px;"><div style="font-size:11px;font-weight:700;color:#a6adc8;margin-bottom:6px;">Selected Features${msBadge}</div>`;
                selectedFeaturesByLayer.forEach(d=>{html+=`<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid #313244;"><span style="font-size:11px;color:#cdd6f4;">${d.layer.title}</span><span style="font-size:11px;color:#a6e3a1;font-weight:700;">${d.features.length}${d.orderedByLine?'<span style="color:#89b4fa;font-size:9px;margin-left:4px;">↗ ordered</span>':''}</span></div>`;});
                if(accumulateMode)html+=`<div style="font-size:10px;color:#6c7086;margin-top:6px;">Click map to add more features, or Configure Layers when done.</div>`;
                div.innerHTML=html+'</div>';$('#configureLayersBtn').style.display='block';
            }
            updateStatus(accumulateMode
                ?`${[...selectedFeaturesByLayer.values()].reduce((s,d)=>s+d.features.length,0)} features selected across ${selectedFeaturesByLayer.size} layer(s) — keep clicking or Configure Layers.`
                :`Found features in ${selectedFeaturesByLayer.size} layer(s).`);
            highlightSelectionFeatures();
        }

        function clearSelection(){
            if(activeQueryController){activeQueryController.abort();activeQueryController=null;}
            if(sketchViewModel){try{sketchViewModel.cancel();}catch(e){}}
            if(selectionGraphic){mapView.graphics.remove(selectionGraphic);selectionGraphic=null;}
            selectionGraphics.forEach(g=>{try{mapView.graphics.remove(g);}catch(e){}});selectionGraphics=[];
            if(mapClickHandler){mapClickHandler.remove();mapClickHandler=null;}
            clearHighlights();clearSelectionHighlights();$('#clearSelectionBtn').disabled=true;
            selectedFeaturesByLayer.clear();$('#selectionResults').innerHTML='';
            $('#configureLayersBtn').style.display='none';updateStatus('Selection cleared.');
        }

        let selectionHighlightGraphics = new Map();

        function highlightLayerFeatures(lid, features){
            clearLayerHighlights(lid);
            if(!features.length) return;
            window.require(['esri/Graphic'], Graphic => {
                const graphics = [];
                features.forEach(feature => {
                    if(!feature.geometry) return;
                    let symbol;
                    if(feature.geometry.type==='point')
                        symbol={type:'simple-marker',color:[89,185,250,.7],size:14,outline:{color:[255,255,255,1],width:1.5}};
                    else if(feature.geometry.type==='polyline')
                        symbol={type:'simple-line',color:[89,185,250,.85],width:5};
                    else
                        symbol={type:'simple-fill',color:[89,185,250,.25],outline:{color:[89,185,250,1],width:2}};
                    const g = new Graphic({geometry:feature.geometry, symbol});
                    mapView.graphics.add(g);
                    graphics.push(g);
                });
                selectionHighlightGraphics.set(lid, graphics);
            });
        }

        function clearLayerHighlights(lid){
            const graphics = selectionHighlightGraphics.get(lid) || [];
            graphics.forEach(g=>{try{mapView.graphics.remove(g);}catch(e){}});
            selectionHighlightGraphics.delete(lid);
        }

        function highlightSelectionFeatures(){
            clearSelectionHighlights();
            selectedFeaturesByLayer.forEach((d, lid) => highlightLayerFeatures(lid, d.features));
        }

        function clearSelectionHighlights(){
            selectionHighlightGraphics.forEach(graphics => {
                graphics.forEach(g=>{try{mapView.graphics.remove(g);}catch(e){}});
            });
            selectionHighlightGraphics.clear();
        }

        function highlightBulkFeatures(features){
            clearBulkHighlights();
            if(!features.length) return;
            window.require(['esri/Graphic'], Graphic => {
                features.forEach(feature=>{
                    let symbol;
                    if(feature.geometry.type==='point')
                        symbol={type:'simple-marker',color:[255,165,0,.75],size:18,outline:{color:[255,255,255,1],width:2}};
                    else if(feature.geometry.type==='polyline')
                        symbol={type:'simple-line',color:[255,165,0,.85],width:6};
                    else
                        symbol={type:'simple-fill',color:[255,165,0,.3],outline:{color:[255,165,0,1],width:3}};
                    const g = new Graphic({geometry:feature.geometry, symbol});
                    mapView.graphics.add(g);
                    bulkHighlightGraphics.push(g);
                });
                const notice=$('#bulkEditMapNotice');
                if(notice)notice.style.display='block';
            });
        }

        function clearBulkHighlights(){
            bulkHighlightGraphics.forEach(g=>{try{mapView.graphics.remove(g);}catch(e){}});
            bulkHighlightGraphics=[];
            const notice=$('#bulkEditMapNotice');
            if(notice)notice.style.display='none';
        }

        // ── Layer Configuration ───────────────────────────────────────────────
        async function showLayerConfiguration(){
            if(mapClickHandler){mapClickHandler.remove();mapClickHandler=null;}
            accumulateMode=false;
            const msChk=$('#multiSelectChk');if(msChk)msChk.checked=false;
            selectionGraphics.forEach(g=>{try{mapView.graphics.remove(g);}catch(e){}});selectionGraphics=[];
            if(selectionGraphic){mapView.graphics.remove(selectionGraphic);selectionGraphic=null;}
            clearSelectionHighlights();
            const c=$('#layerConfigContainer');c.innerHTML='';let order=1;
            for(const[,data]of selectedFeaturesByLayer)c.appendChild(await createLayerConfigSection(data.layer,data.features,order++));
            setPhase('configuration');updateStatus('Configure layers and fields, then click Review & Start.');
        }

        async function createLayerConfigSection(layer,features,order){
            const lid=layerKey(layer);
            const card=document.createElement('div');card.className='layerCard';card.dataset.layerId=lid;card.dataset.order=order;

            const header=document.createElement('div');header.className='layerCardHeader';
            const tw=document.createElement('label');tw.className='toggle-wrap';
            const ti=document.createElement('input');ti.type='checkbox';ti.id=`layer_${lid}_enabled`;
            const ts=document.createElement('div');ts.className='toggle-slider';
            tw.appendChild(ti);tw.appendChild(ts);
            const titleSpan=document.createElement('span');titleSpan.style.cssText='flex:1;font-weight:700;font-size:12px;';titleSpan.textContent=layer.title;
            const countBadge=document.createElement('span');countBadge.className='fieldBadge';countBadge.textContent=`${features.length} features`;
            const csvBtn=document.createElement('button');csvBtn.type='button';csvBtn.className='btn btn-info';csvBtn.style.cssText='font-size:10px;padding:2px 8px;white-space:nowrap;flex-shrink:0;';csvBtn.title='Download as CSV (respects active filter)';csvBtn.textContent='⬇ CSV';csvBtn.onclick=e=>{e.stopPropagation();downloadLayerCSV(lid,layer);};
            const chevron=document.createElement('span');chevron.textContent='▼';chevron.style.cssText='font-size:10px;color:#6c7086;';
            header.appendChild(tw);header.appendChild(titleSpan);header.appendChild(countBadge);header.appendChild(csvBtn);header.appendChild(chevron);

            const body=document.createElement('div');body.className='layerCardBody';

            const modeRow=document.createElement('div');modeRow.style.cssText='display:flex;gap:8px;margin-bottom:10px;';
            ['edit','view'].forEach(m=>{const lbl=document.createElement('label');lbl.style.cssText='display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;color:#a6adc8;';const rdo=document.createElement('input');rdo.type='radio';rdo.name=`mode_${lid}`;rdo.value=m;if(m==='edit')rdo.checked=true;rdo.style.accentColor='#cba6f7';lbl.appendChild(rdo);lbl.appendChild(document.createTextNode(m==='edit'?'✏️ Edit Fields':'👁 View Only'));modeRow.appendChild(lbl);});

            await layer.load();
            const editableFields=layer.fields.filter(f=>f.editable&&f.type!=='oid'&&f.type!=='global-id').sort((a,b)=>(a.alias||a.name).localeCompare(b.alias||b.name));
            const fieldsSection=document.createElement('div');fieldsSection.id=`fields_${lid}`;
            if(editableFields.length>0){
                const ssRow=document.createElement('div');ssRow.style.cssText='display:flex;gap:6px;margin-bottom:6px;';
                const fsearch=document.createElement('input');fsearch.type='text';fsearch.placeholder='Search fields…';fsearch.className='input-ctrl';fsearch.style.flex='1';fsearch.style.fontSize='11px';
                const sortBtn=document.createElement('button');sortBtn.className='btn btn-secondary';sortBtn.style.cssText='font-size:10px;padding:4px 8px;white-space:nowrap;';sortBtn.textContent='A→Z';let sortAsc=true;
                ssRow.appendChild(fsearch);ssRow.appendChild(sortBtn);
                const flc=document.createElement('div');flc.className='fieldListContainer';
                // Persistent set tracks checked state independently of what's currently
                // visible in the list — fixes selections being lost when search text changes.
                const checkedFields=new Set();
                function renderFieldList(ft='',asc=true){
                    flc.innerHTML='';
                    let flds=editableFields.filter(f=>(f.alias||f.name).toLowerCase().includes(ft.toLowerCase()));if(!asc)flds=[...flds].reverse();
                    flds.forEach(field=>{const row=document.createElement('div');row.className='fieldItem';const chk=document.createElement('input');chk.type='checkbox';chk.dataset.fieldName=field.name;chk.style.accentColor='#cba6f7';chk.checked=checkedFields.has(field.name);chk.addEventListener('change',()=>{if(chk.checked)checkedFields.add(field.name);else checkedFields.delete(field.name);});const lbl=document.createElement('span');lbl.style.cssText='flex:1;font-size:11px;';lbl.textContent=field.alias||field.name;const badge=document.createElement('span');badge.className='fieldBadge';badge.textContent=getFieldTypeLabel(field);row.appendChild(chk);row.appendChild(lbl);row.appendChild(badge);row.addEventListener('click',e=>{if(e.target!==chk){chk.checked=!chk.checked;if(chk.checked)checkedFields.add(field.name);else checkedFields.delete(field.name);}});flc.appendChild(row);});
                }
                renderFieldList();
                fsearch.oninput=()=>renderFieldList(fsearch.value,sortAsc);
                sortBtn.onclick=()=>{sortAsc=!sortAsc;sortBtn.textContent=sortAsc?'A→Z':'Z→A';renderFieldList(fsearch.value,sortAsc);};
                fieldsSection.getCheckedFields=()=>Array.from(checkedFields);
                fieldsSection.setCheckedFields=names=>{checkedFields.clear();names.forEach(n=>checkedFields.add(n));renderFieldList(fsearch.value,sortAsc);};
                fieldsSection.appendChild(ssRow);fieldsSection.appendChild(flc);
            }else{fieldsSection.innerHTML='<div style="color:#6c7086;font-size:11px;">No editable fields.</div>';}

            const optDiv=document.createElement('div');optDiv.style.cssText='display:flex;gap:12px;margin-top:8px;margin-bottom:8px;';
            optDiv.innerHTML=`<label style="display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer;color:#a6adc8;"><input type="checkbox" id="popup_${lid}" checked style="accent-color:#cba6f7;"> Show Popup</label><label style="display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer;color:#a6adc8;"><input type="checkbox" id="allowskip_${lid}" checked style="accent-color:#cba6f7;"> Allow Skip</label>`;

            // ── Visual Filter Builder ─────────────────────────────────────────
            const filterDiv=document.createElement('div');filterDiv.style.cssText='border-top:1px solid #313244;padding-top:8px;margin-top:4px;';
            let filterConditions=[],filterConjunction='AND';
            const enLbl=document.createElement('label');enLbl.style.cssText='display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer;color:#a6adc8;margin-bottom:6px;';
            const enChk=document.createElement('input');enChk.type='checkbox';enChk.id=`enableFilter_${lid}`;enChk.style.accentColor='#cba6f7';
            enLbl.appendChild(enChk);enLbl.appendChild(document.createTextNode(' Filter Features'));filterDiv.appendChild(enLbl);
            const filterBody=document.createElement('div');filterBody.id=`filterInputs_${lid}`;filterBody.style.display='none';filterDiv.appendChild(filterBody);
            enChk.onchange=()=>{filterBody.style.display=enChk.checked?'block':'none';};

            const conjRow=document.createElement('div');conjRow.style.cssText='display:flex;gap:6px;align-items:center;margin-bottom:8px;';
            conjRow.innerHTML='<span style="font-size:11px;color:#a6adc8;">Match:</span>';
            ['AND','OR'].forEach(c=>{
                const btn=document.createElement('button');btn.type='button';btn.textContent=c==='AND'?'All (AND)':'Any (OR)';
                btn.style.cssText=`padding:3px 10px;border:1px solid #45475a;border-radius:4px;cursor:pointer;font-size:11px;transition:all .15s;background:${c===filterConjunction?'#cba6f7':'#313244'};color:${c===filterConjunction?'#1e1e2e':'#cdd6f4'};`;
                btn.onclick=()=>{filterConjunction=c;conjRow.querySelectorAll('button').forEach((b,i)=>{const a=['AND','OR'][i]===c;b.style.background=a?'#cba6f7':'#313244';b.style.color=a?'#1e1e2e':'#cdd6f4';});};
                conjRow.appendChild(btn);
            });
            filterBody.appendChild(conjRow);
            const condCont=document.createElement('div');filterBody.appendChild(condCont);

            function getOperatorsForField(field){
                if(field.domain?.type==='coded-value')return[{value:'eq',label:'is'},{value:'neq',label:'is not'},{value:'includes',label:'includes any of'},{value:'excludes',label:'excludes all of'},{value:'blank',label:'is blank'},{value:'notblank',label:'is not blank'}];
                if(field.type==='date')return[{value:'eq',label:'on'},{value:'before',label:'before'},{value:'after',label:'after'},{value:'between',label:'between'},{value:'blank',label:'is blank'},{value:'notblank',label:'is not blank'}];
                if(['integer','small-integer','double','single'].includes(field.type))return[{value:'eq',label:'equals (=)'},{value:'neq',label:'not equals (≠)'},{value:'gt',label:'greater than (>)'},{value:'gte',label:'greater or equal (≥)'},{value:'lt',label:'less than (<)'},{value:'lte',label:'less or equal (≤)'},{value:'between',label:'between'},{value:'includes',label:'includes any of'},{value:'excludes',label:'excludes all of'},{value:'blank',label:'is blank'},{value:'notblank',label:'is not blank'}];
                return[{value:'eq',label:'equals'},{value:'neq',label:'not equals'},{value:'contains',label:'contains'},{value:'notcontains',label:'does not contain'},{value:'starts',label:'starts with'},{value:'ends',label:'ends with'},{value:'includes',label:'includes any of'},{value:'excludes',label:'excludes all of'},{value:'blank',label:'is blank'},{value:'notblank',label:'is not blank'}];
            }

            function conditionToSQL(cond){
                const field=editableFields.find(f=>f.name===cond.field);if(!field||!cond.operator)return null;
                const fn=cond.field,op=cond.operator,v=cond.value,v2=cond.value2;
                const isStr=field.type==='string',isDate=field.type==='date',isDomain=field.domain?.type==='coded-value';

                if(op==='includes'||op==='excludes'){
                    if(!Array.isArray(cond.values)||!cond.values.length)return null;
                    let needsQuotes=isStr;
                    if(isDomain&&field.domain.codedValues.length>0){
                        needsQuotes=typeof field.domain.codedValues[0].code==='string';
                    }
                    const list=cond.values.map(x=>{
                        if(needsQuotes)return`'${String(x).replace(/'/g,"''")}'`;
                        const n=Number(x);
                        return isNaN(n)?`'${String(x).replace(/'/g,"''")}'`:n;
                    }).join(', ');
                    return`${fn} ${op==='includes'?'IN':'NOT IN'} (${list})`;
                }
                if(!v&&!['blank','notblank'].includes(op))return null;
                if(isDate){if(op==='eq')return`${fn} = DATE '${v}'`;if(op==='before')return`${fn} < DATE '${v}'`;if(op==='after')return`${fn} > DATE '${v}'`;if(op==='between'&&v2)return`${fn} >= DATE '${v}' AND ${fn} <= DATE '${v2}'`;return null;}
                if(isDomain){
                    let needsQuotes=isStr;
                    if(field.domain.codedValues.length>0)needsQuotes=typeof field.domain.codedValues[0].code==='string';
                    const code=needsQuotes?`'${String(v).replace(/'/g,"''")}'`:isNaN(Number(v))?`'${String(v).replace(/'/g,"''")}'`:Number(v);
                    return op==='eq'?`${fn} = ${code}`:`${fn} <> ${code}`;
                }
                if(isStr){const e=String(v).replace(/'/g,"''");if(op==='eq')return`${fn} = '${e}'`;if(op==='neq')return`${fn} <> '${e}'`;if(op==='contains')return`${fn} LIKE '%${e}%'`;if(op==='notcontains')return`${fn} NOT LIKE '%${e}%'`;if(op==='starts')return`${fn} LIKE '${e}%'`;if(op==='ends')return`${fn} LIKE '%${e}'`;}
                if(op==='eq')return`${fn} = ${v}`;if(op==='neq')return`${fn} <> ${v}`;if(op==='gt')return`${fn} > ${v}`;if(op==='gte')return`${fn} >= ${v}`;if(op==='lt')return`${fn} < ${v}`;if(op==='lte')return`${fn} <= ${v}`;if(op==='between'&&v2)return`${fn} >= ${v} AND ${fn} <= ${v2}`;
                return null;
            }

            function buildWhereFromConditions(){
                const clauses=filterConditions.map(c=>{
                    const field=editableFields.find(f=>f.name===c.field);if(!field)return null;
                    const isStr=field.type==='string',fn=c.field,op=c.operator;
                    if(op==='blank')return`(${fn} IS NULL${isStr?` OR ${fn} = ''`:''})`;
                    if(op==='notblank')return`(${fn} IS NOT NULL${isStr?` AND ${fn} <> ''`:''})`;
                    return conditionToSQL(c);
                }).filter(Boolean);
                return clauses.length?clauses.map(c=>`(${c})`).join(` ${filterConjunction} `):'';
            }

            function makeValueArea(cond,valueArea){
                valueArea.innerHTML='';
                const op=cond.operator;
                if(op==='blank'||op==='notblank'){cond.value='';cond.value2='';return;}
                const field=editableFields.find(f=>f.name===cond.field);if(!field)return;

                if(op==='includes'||op==='excludes'){
                    if(!Array.isArray(cond.values))cond.values=[];
                    if(field.domain?.type==='coded-value'){
                        const srch=document.createElement('input');srch.type='text';srch.placeholder='Search values…';srch.style.cssText='width:100%;padding:6px 8px;background:#313244;border:1px solid #45475a;border-bottom:none;border-radius:6px 6px 0 0;color:#cdd6f4;font-size:11px;outline:none;box-sizing:border-box;';
                        const listWrap=document.createElement('div');listWrap.style.cssText='max-height:140px;overflow-y:auto;background:#0f0f17;border:1px solid #45475a;border-radius:0 0 6px 6px;padding:4px;';
                        function renderCheckList(ft=''){listWrap.innerHTML='';field.domain.codedValues.filter(cv=>!ft||cv.name.toLowerCase().includes(ft.toLowerCase())).forEach(cv=>{const lbl=document.createElement('label');lbl.style.cssText='display:flex;align-items:center;gap:8px;padding:5px 8px;cursor:pointer;font-size:11px;color:#cdd6f4;border-radius:4px;';lbl.addEventListener('mouseenter',()=>lbl.style.background='#1e1e2e');lbl.addEventListener('mouseleave',()=>lbl.style.background='transparent');const chk=document.createElement('input');chk.type='checkbox';chk.style.accentColor='#cba6f7';chk.checked=cond.values.map(String).includes(String(cv.code));chk.addEventListener('change',()=>{if(chk.checked){if(!cond.values.map(String).includes(String(cv.code)))cond.values.push(cv.code);}else cond.values=cond.values.filter(v=>String(v)!==String(cv.code));});lbl.appendChild(chk);lbl.appendChild(document.createTextNode(cv.name));listWrap.appendChild(lbl);});}
                        srch.addEventListener('input',()=>renderCheckList(srch.value));renderCheckList();
                        valueArea.appendChild(srch);valueArea.appendChild(listWrap);
                    }else{
                        const tagWrap=document.createElement('div');tagWrap.style.cssText='background:#313244;border:1px solid #45475a;border-radius:6px;padding:6px;min-height:38px;display:flex;flex-wrap:wrap;gap:4px;align-items:center;cursor:text;';
                        const tagInput=document.createElement('input');tagInput.type=['integer','small-integer','double','single'].includes(field.type)?'number':'text';tagInput.placeholder='Type value, press Enter…';tagInput.style.cssText='background:transparent;border:none;color:#cdd6f4;font-size:12px;outline:none;min-width:130px;flex:1;padding:0;';
                        function renderTags(){tagWrap.querySelectorAll('.pe-tag').forEach(t=>t.remove());cond.values.forEach((val,i)=>{const pill=document.createElement('span');pill.className='pe-tag';pill.style.cssText='background:#cba6f7;color:#1e1e2e;padding:2px 8px 2px 10px;border-radius:10px;font-size:11px;display:inline-flex;align-items:center;gap:4px;font-weight:600;';const rm=document.createElement('span');rm.textContent='×';rm.style.cssText='cursor:pointer;font-size:13px;line-height:1;opacity:.7;';rm.onclick=()=>{cond.values.splice(i,1);renderTags();};pill.appendChild(document.createTextNode(val));pill.appendChild(rm);tagWrap.insertBefore(pill,tagInput);});}
                        tagInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();const v=tagInput.value.trim();if(v&&!cond.values.map(String).includes(v)){cond.values.push(v);renderTags();tagInput.value='';}}else if(e.key==='Backspace'&&tagInput.value===''&&cond.values.length){cond.values.pop();renderTags();}});
                        tagWrap.addEventListener('click',()=>tagInput.focus());tagWrap.appendChild(tagInput);renderTags();
                        valueArea.appendChild(tagWrap);
                        const hint=document.createElement('div');hint.style.cssText='font-size:10px;color:#6c7086;margin-top:3px;';hint.textContent='Press Enter to add each value.';valueArea.appendChild(hint);
                    }
                    return;
                }

                function makeInput(placeholder,currentVal,isSecond){
                    if(field.domain?.type==='coded-value'){
                        const wrap=document.createElement('div');wrap.style.marginBottom='4px';
                        let selCode=(currentVal!==''&&currentVal!==undefined)?currentVal:'';
                        if(isSecond)cond.value2=selCode;else cond.value=selCode;
                        const currentOpt=field.domain.codedValues.find(cv=>String(cv.code)===String(selCode));
                        const btn=document.createElement('button');btn.type='button';btn.className='domain-btn';
                        const btnTxt=document.createElement('span');btnTxt.textContent=currentOpt?currentOpt.name:'— Select —';
                        const btnArr=document.createElement('span');btnArr.textContent='▼';btnArr.style.fontSize='10px';
                        btn.appendChild(btnTxt);btn.appendChild(btnArr);
                        const panel=document.createElement('div');panel.style.cssText='display:none;margin-top:2px;background:#1e1e2e;border:1px solid #45475a;border-radius:6px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.5);';
                        const srch=document.createElement('input');srch.type='text';srch.placeholder='Search values…';srch.style.cssText='width:100%;padding:7px 10px;background:#313244;border:none;border-bottom:1px solid #45475a;color:#cdd6f4;font-size:12px;outline:none;box-sizing:border-box;';
                        const list=document.createElement('div');list.style.cssText='max-height:160px;overflow-y:auto;';
                        function renderOpts(ft=''){list.innerHTML='';[{code:'',name:'— Select —'},...field.domain.codedValues].filter(cv=>!ft||String(cv.name).toLowerCase().includes(ft.toLowerCase())||String(cv.code).toLowerCase().includes(ft.toLowerCase())).forEach(cv=>{const row=document.createElement('div');const isSel=String(cv.code)===String(selCode);row.style.cssText=`padding:6px 10px;cursor:pointer;font-size:11px;color:${isSel?'#cba6f7':'#cdd6f4'};background:${isSel?'#2a1f3d':'transparent'};font-weight:${isSel?'600':'normal'};border-bottom:1px solid #1e1e2e;`;row.textContent=cv.name;row.addEventListener('mouseenter',()=>{if(String(cv.code)!==String(selCode))row.style.background='#313244';});row.addEventListener('mouseleave',()=>{row.style.background=String(cv.code)===String(selCode)?'#2a1f3d':'transparent';});row.addEventListener('mousedown',e=>{e.preventDefault();selCode=cv.code;if(isSecond)cond.value2=cv.code;else cond.value=cv.code;btnTxt.textContent=cv.name||'— Select —';panel.style.display='none';btn.classList.remove('open');btnArr.textContent='▼';});list.appendChild(row);});}
                        btn.addEventListener('click',()=>{const isOpen=panel.style.display==='block';if(!isOpen){panel.style.display='block';btn.classList.add('open');btnArr.textContent='▲';srch.value='';renderOpts('');setTimeout(()=>{srch.focus();panel.scrollIntoView({behavior:'smooth',block:'nearest'});},50);}else{panel.style.display='none';btn.classList.remove('open');btnArr.textContent='▼';}});
                        srch.addEventListener('input',()=>renderOpts(srch.value));
                        panel.appendChild(srch);panel.appendChild(list);
                        wrap.appendChild(btn);wrap.appendChild(panel);return wrap;
                    }
                    let inp;
                    if(field.type==='date'){inp=document.createElement('input');inp.type='date';inp.className='input-ctrl';if(currentVal)inp.value=currentVal;}
                    else if(['integer','small-integer','double','single'].includes(field.type)){inp=document.createElement('input');inp.type='number';inp.className='input-ctrl';inp.placeholder=placeholder;if(currentVal!==''&&currentVal!==undefined)inp.value=currentVal;}
                    else{inp=document.createElement('input');inp.type='text';inp.className='input-ctrl';inp.placeholder=placeholder;if(currentVal)inp.value=currentVal;}
                    inp.style.marginBottom='4px';
                    inp.addEventListener('input',()=>{if(isSecond)cond.value2=inp.value;else cond.value=inp.value;});
                    inp.addEventListener('change',()=>{if(isSecond)cond.value2=inp.value;else cond.value=inp.value;});
                    return inp;
                }

                if(op==='between'){
                    const fl=document.createElement('div');fl.style.cssText='font-size:10px;color:#6c7086;margin-bottom:2px;';fl.textContent='From:';
                    const tl=document.createElement('div');tl.style.cssText='font-size:10px;color:#6c7086;margin-bottom:2px;margin-top:2px;';tl.textContent='To:';
                    valueArea.appendChild(fl);valueArea.appendChild(makeInput('From',cond.value,false));valueArea.appendChild(tl);valueArea.appendChild(makeInput('To',cond.value2,true));
                }else{valueArea.appendChild(makeInput('Value',cond.value,false));}
            }

            function createConditionRow(cond){
                const row=document.createElement('div');row.style.cssText='background:#0f0f17;border:1px solid #313244;border-radius:6px;padding:8px;margin-bottom:6px;';
                const fLbl=document.createElement('div');fLbl.style.cssText='font-size:10px;color:#6c7086;margin-bottom:3px;';fLbl.textContent='Field';
                const fpWrap=document.createElement('div');fpWrap.style.cssText='position:relative;margin-bottom:6px;';
                const fBtn=document.createElement('button');fBtn.type='button';fBtn.className='domain-btn';
                const fBtnTxt=document.createElement('span');const initF=editableFields.find(f=>f.name===cond.field);fBtnTxt.textContent=initF?(initF.alias||initF.name):'— Select a field —';
                const fBtnArr=document.createElement('span');fBtnArr.textContent='▼';fBtnArr.style.fontSize='10px';fBtn.appendChild(fBtnTxt);fBtn.appendChild(fBtnArr);
                const fPanel=document.createElement('div');fPanel.style.cssText='display:none;margin-top:2px;background:#1e1e2e;border:1px solid #45475a;border-radius:6px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.5);';
                const fSrch=document.createElement('input');fSrch.type='text';fSrch.placeholder='Search fields…';fSrch.style.cssText='width:100%;padding:7px 10px;background:#313244;border:none;border-bottom:1px solid #45475a;color:#cdd6f4;font-size:12px;outline:none;box-sizing:border-box;';
                const fList=document.createElement('div');fList.style.cssText='max-height:160px;overflow-y:auto;';
                function renderFOpts(ft=''){fList.innerHTML='';const f=ft.toLowerCase();const filtered=editableFields.filter(fld=>!f||(fld.alias||fld.name).toLowerCase().includes(f));if(!filtered.length){const em=document.createElement('div');em.style.cssText='padding:10px;font-size:11px;color:#6c7086;text-align:center;';em.textContent='No matches';fList.appendChild(em);return;}filtered.forEach(fld=>{const it=document.createElement('div');const isSel=fld.name===cond.field;it.style.cssText=`padding:7px 10px;cursor:pointer;font-size:12px;color:${isSel?'#cba6f7':'#cdd6f4'};background:${isSel?'#2a1f3d':'transparent'};font-weight:${isSel?'600':'normal'};border-bottom:1px solid #313244;display:flex;justify-content:space-between;align-items:center;gap:6px;`;const nm=document.createElement('span');nm.textContent=fld.alias||fld.name;nm.style.flex='1';const tp=document.createElement('span');tp.className='fieldBadge';tp.textContent=getFieldTypeLabel(fld);it.addEventListener('mouseenter',()=>{if(fld.name!==cond.field)it.style.background='#313244';});it.addEventListener('mouseleave',()=>{it.style.background=fld.name===cond.field?'#2a1f3d':'transparent';});it.addEventListener('mousedown',e=>{e.preventDefault();cond.field=fld.name;cond.operator='';cond.value='';cond.value2='';cond.values=[];fBtnTxt.textContent=fld.alias||fld.name;fPanel.style.display='none';fBtn.classList.remove('open');fBtnArr.textContent='▼';refreshOps();});it.appendChild(nm);it.appendChild(tp);fList.appendChild(it);});}
                renderFOpts();fPanel.appendChild(fSrch);fPanel.appendChild(fList);
                fBtn.addEventListener('click',()=>{const isOpen=fPanel.style.display==='block';if(!isOpen){fPanel.style.display='block';fBtn.classList.add('open');fBtnArr.textContent='▲';fSrch.value='';renderFOpts('');setTimeout(()=>{fSrch.focus();fPanel.scrollIntoView({behavior:'smooth',block:'nearest'});},50);}else{fPanel.style.display='none';fBtn.classList.remove('open');fBtnArr.textContent='▼';}});
                fSrch.addEventListener('input',()=>renderFOpts(fSrch.value));
                fpWrap.appendChild(fBtn);fpWrap.appendChild(fPanel);

                const opLbl=document.createElement('div');opLbl.style.cssText='font-size:10px;color:#6c7086;margin-bottom:3px;';opLbl.textContent='Condition';
                const opSel=document.createElement('select');opSel.className='input-ctrl';opSel.style.marginBottom='6px';
                const valLbl=document.createElement('div');valLbl.style.cssText='font-size:10px;color:#6c7086;margin-bottom:3px;';valLbl.textContent='Value';
                const valueArea=document.createElement('div');

                function refreshOps(){const field=editableFields.find(f=>f.name===cond.field);opSel.innerHTML='';if(!field)return;getOperatorsForField(field).forEach(op=>{const o=document.createElement('option');o.value=op.value;o.textContent=op.label;if(op.value===cond.operator)o.selected=true;opSel.appendChild(o);});cond.operator=opSel.value;valLbl.style.display=['blank','notblank'].includes(cond.operator)?'none':'block';makeValueArea(cond,valueArea);}
                opSel.addEventListener('change',()=>{cond.operator=opSel.value;cond.value='';cond.value2='';cond.values=[];valLbl.style.display=['blank','notblank'].includes(cond.operator)?'none':'block';makeValueArea(cond,valueArea);});

                const rmBtn=document.createElement('button');rmBtn.type='button';rmBtn.className='btn btn-danger';rmBtn.style.cssText='width:100%;margin-top:6px;font-size:11px;padding:4px;';rmBtn.textContent='× Remove';rmBtn.onclick=()=>{const idx=filterConditions.indexOf(cond);if(idx>-1)filterConditions.splice(idx,1);row.remove();};

                row.appendChild(fLbl);row.appendChild(fpWrap);row.appendChild(opLbl);row.appendChild(opSel);row.appendChild(valLbl);row.appendChild(valueArea);row.appendChild(rmBtn);
                refreshOps();return row;
            }

            const actRow=document.createElement('div');actRow.style.cssText='display:flex;gap:6px;margin-top:4px;';
            const addBtn=document.createElement('button');addBtn.type='button';addBtn.className='btn btn-info';addBtn.style.cssText='flex:1;font-size:11px;';addBtn.textContent='+ Add Condition';
            addBtn.onclick=()=>{const cond={field:'',operator:'',value:'',value2:'',values:[]};filterConditions.push(cond);condCont.appendChild(createConditionRow(cond));};
            const testBtn=document.createElement('button');testBtn.type='button';testBtn.className='btn btn-secondary';testBtn.style.cssText='flex:1;font-size:11px;';testBtn.textContent='🔍 Test';
            const testResult=document.createElement('div');testResult.style.cssText='font-size:10px;margin-top:4px;min-height:14px;';
            testBtn.onclick=async()=>{
                const where=buildWhereFromConditions();
                if(!where){testResult.textContent='Add at least one condition first.';testResult.style.color='#f38ba8';return;}
                testResult.textContent='Testing…';testResult.style.color='#a6adc8';
                try{
                    const d=selectedFeaturesByLayer.get(lid);
                    if(!d?.features.length){testResult.textContent='No features in current selection.';testResult.style.color='#f9e2af';return;}
                    const oidField=layer.objectIdField||'OBJECTID';
                    const objectIds=d.features.map(f=>f.attributes[oidField]).filter(id=>id!=null);
                    const res=await layer.queryFeatures({where,objectIds,returnGeometry:true,outFields:['*']});
                    const pct=Math.round((res.features.length/d.features.length)*100);
                    testResult.textContent=`✓ ${res.features.length} of ${d.features.length} selected features match (${pct}%)`;
                    testResult.style.color=res.features.length===0?'#f9e2af':'#a6e3a1';
                    if(ti.checked) highlightLayerFeatures(lid, res.features);
                }catch(err){testResult.textContent='✗ '+err.message;testResult.style.color='#f38ba8';}
            };
            actRow.appendChild(addBtn);actRow.appendChild(testBtn);
            filterBody.appendChild(actRow);filterBody.appendChild(testResult);

            card.getFilterClause=()=>enChk.checked?buildWhereFromConditions():'';
            card.getFilterData=()=>({filterEnabled:enChk.checked,filterConjunction,filterConditions:filterConditions.map(c=>({...c}))});
            card.setFilterData=data=>{
                if(!data?.filterEnabled)return;
                enChk.checked=true;filterBody.style.display='block';
                filterConjunction=data.filterConjunction||'AND';
                conjRow.querySelectorAll('button').forEach((b,i)=>{const a=['AND','OR'][i]===filterConjunction;b.style.background=a?'#cba6f7':'#313244';b.style.color=a?'#1e1e2e':'#cdd6f4';});
                filterConditions=[];condCont.innerHTML='';
                (data.filterConditions||[]).forEach(cd=>{const cond={...cd};filterConditions.push(cond);condCont.appendChild(createConditionRow(cond));});
            };

            const orderDiv=document.createElement('div');orderDiv.style.cssText='border-top:1px solid #313244;padding-top:8px;margin-top:8px;display:flex;align-items:center;gap:8px;';
            orderDiv.innerHTML=`<span style="font-size:11px;color:#a6adc8;">Order:</span><input type="number" min="1" value="${order}" class="orderInput input-ctrl" style="width:50px;"><button class="moveUp btn btn-secondary" style="padding:3px 8px;">↑</button><button class="moveDown btn btn-secondary" style="padding:3px 8px;">↓</button>`;

            const orderInput = orderDiv.querySelector('.orderInput');
            const moveUp     = orderDiv.querySelector('.moveUp');
            const moveDown   = orderDiv.querySelector('.moveDown');

            orderInput.addEventListener('input', () => {
                card.dataset.order = orderInput.value || '1';
            });
            moveUp.addEventListener('click', () => {
                const prev = card.previousElementSibling;
                if(!prev) return;
                card.parentElement.insertBefore(card, prev);
                const prevInput = prev.querySelector('.orderInput');
                const myVal  = parseInt(orderInput.value) || parseInt(card.dataset.order);
                const hisVal = parseInt(prevInput.value)  || parseInt(prev.dataset.order);
                orderInput.value = hisVal; card.dataset.order = hisVal;
                prevInput.value  = myVal;  prev.dataset.order  = myVal;
            });
            moveDown.addEventListener('click', () => {
                const next = card.nextElementSibling;
                if(!next) return;
                card.parentElement.insertBefore(next, card);
                const nextInput = next.querySelector('.orderInput');
                const myVal  = parseInt(orderInput.value) || parseInt(card.dataset.order);
                const hisVal = parseInt(nextInput.value)  || parseInt(next.dataset.order);
                orderInput.value = hisVal; card.dataset.order = hisVal;
                nextInput.value  = myVal;  next.dataset.order  = myVal;
            });

            body.appendChild(modeRow);body.appendChild(fieldsSection);body.appendChild(optDiv);body.appendChild(filterDiv);body.appendChild(orderDiv);
            modeRow.querySelectorAll('input[type=radio]').forEach(r=>{r.onchange=()=>{fieldsSection.style.display=r.value==='edit'?'block':'none';};});
            header.addEventListener('click',e=>{if(e.target.closest('label.toggle-wrap'))return;const open=body.style.display==='block';body.style.display=open?'none':'block';chevron.textContent=open?'▼':'▲';});
            ti.onchange=()=>{
                card.classList.toggle('enabled',ti.checked);
                if(ti.checked){
                    body.style.display='block';chevron.textContent='▲';
                    highlightLayerFeatures(lid, features);
                } else {
                    clearLayerHighlights(lid);
                }
            };
            card.appendChild(header);card.appendChild(body);
            return card;
        }

        function getFieldTypeLabel(field){if(field.domain?.type==='coded-value')return 'Dropdown';return{integer:'Int','small-integer':'Int',double:'Decimal',single:'Decimal',date:'Date',string:'Text'}[field.type]||field.type;}

        // ── Auto-calc watchers ────────────────────────────────────────────────
        function applyAutoCalcWatchers(item){
            const fc = $('#editFormContainer');
            const layerTitle = (item.layer.title || '').toLowerCase();

            AUTO_CALC_RULES.forEach(rule => {
                if(!layerTitle.includes(rule.layerMatch.toLowerCase())) return;

                const watchEls = rule.watchFields.map(fn =>
                    fc.querySelector(`[data-field-name="${fn}"]`)
                );
                if(watchEls.some(el => !el)) return;

                let targetEl = fc.querySelector(`[data-field-name="${rule.targetField}"]`);
                if(!targetEl){
                    const hidden = document.createElement('input');
                    hidden.type = 'hidden';
                    hidden.dataset.fieldName = rule.targetField;
                    hidden.dataset.fieldType = 'integer';
                    hidden.dataset.autoCalc   = 'true';
                    fc.appendChild(hidden);
                    targetEl = hidden;
                }

                const secondWatchEl = watchEls[watchEls.length - 1];
                const parentDiv = secondWatchEl.closest('div[style*="margin-bottom"]') || secondWatchEl.parentElement;
                let indicator = fc.querySelector(`[data-autocalc-indicator="${rule.targetField}"]`);
                if(!indicator){
                    indicator = document.createElement('div');
                    indicator.dataset.autocalcIndicator = rule.targetField;
                    indicator.style.cssText = 'font-size:10px;color:#a6e3a1;margin-top:3px;display:none;';
                    parentDiv.appendChild(indicator);
                }

                function recalculate(){
                    const vals = {};
                    watchEls.forEach((el, i) => {
                        const raw = el.dataset.selectedCode !== undefined
                            ? el.dataset.selectedCode : el.value;
                        vals[rule.watchFields[i]] = raw !== '' ? Number(raw) : NaN;
                    });
                    const allReady = rule.watchFields.every(fn => !isNaN(vals[fn]));
                    if(allReady){
                        const result = rule.compute(vals);
                        targetEl.value = result;
                        indicator.textContent = `↳ ${rule.targetField} will be set to ${result}`;
                        indicator.style.display = 'block';
                    } else {
                        targetEl.value = '';
                        indicator.style.display = 'none';
                    }
                }

                watchEls.forEach(el => {
                    el.addEventListener('input',  recalculate);
                    el.addEventListener('change', recalculate);
                });

                recalculate();
            });
        }

        function buildSummary(){
            layerConfigs=[];
            $('#layerConfigContainer').querySelectorAll('[data-layer-id]').forEach(section=>{
                const lid=section.dataset.layerId,chk=section.querySelector(`#layer_${lid}_enabled`);if(!chk?.checked)return;
                const data=selectedFeaturesByLayer.get(lid);if(!data)return;
                const mode=section.querySelector(`input[name="mode_${lid}"]:checked`)?.value||'edit';
                const config={lid,layerId:data.layer.layerId,layer:data.layer,features:data.features,mode,order:parseInt(section.dataset.order||1),showPopup:section.querySelector(`#popup_${lid}`)?.checked??true,allowSkip:section.querySelector(`#allowskip_${lid}`)?.checked??true,fields:[],filterEnabled:false,filterWhere:''};
                if(section.getFilterClause){config.filterWhere=section.getFilterClause();config.filterEnabled=config.filterWhere!=='';}
                if(mode==='edit'){const fd=section.querySelector(`#fields_${lid}`);const names=fd?.getCheckedFields?fd.getCheckedFields():Array.from(section.querySelectorAll(`#fields_${lid} input[type=checkbox]:checked`)).map(c=>c.dataset.fieldName);names.forEach(n=>{const f=data.layer.fields.find(f=>f.name===n);if(f)config.fields.push(f);});config.fields.sort((a,b)=>(a.alias||a.name).localeCompare(b.alias||b.name));}
                layerConfigs.push(config);
            });
            layerConfigs.sort((a,b)=>a.order-b.order);
            applyFiltersToConfigs().then(()=>{if($('#skipSummaryChk')?.checked)startEditing();else displaySummary();});
        }

        async function applyFiltersToConfigs(){
            for(const c of layerConfigs){
                if(!c.filterEnabled||!c.filterWhere){c.filterApplied=false;continue;}
                try{
                    const oidField=c.layer.objectIdField||'OBJECTID';
                    const objectIds=c.features.map(f=>f.attributes[oidField]).filter(id=>id!=null);
                    const qp={where:c.filterWhere,objectIds,returnGeometry:true,outFields:['*']};
                    const res=await c.layer.queryFeatures(qp);
                    c.features=res.features;c.filterApplied=true;
                }catch(err){c.filterError=err.message;c.filterApplied=false;}
            }
        }

        function displaySummary(){
            if(!layerConfigs.length){$('#summaryContent').innerHTML='<span style="color:#f38ba8;">No layers selected.</span>';$('#startEditingBtn').disabled=true;}
            else{$('#startEditingBtn').disabled=false;let total=0,html='';layerConfigs.forEach((c,i)=>{total+=c.features.length;html+=`<div style="padding:6px 0;border-bottom:1px solid #313244;"><div style="font-weight:700;font-size:12px;">${i+1}. ${c.mode==='edit'?'✏️':'👁'} ${c.layer.title}</div><div style="font-size:11px;color:#a6adc8;">${c.features.length} features${c.filterApplied?'<span style="color:#89b4fa;"> · filtered</span>':''}</div>${c.fields.length?`<div style="font-size:10px;color:#6c7086;margin-top:2px;">Fields: ${c.fields.map(f=>f.alias||f.name).join(', ')}</div>`:''}</div>`;});$('#summaryContent').innerHTML=`<div style="font-size:13px;font-weight:700;color:#a6e3a1;margin-bottom:8px;">${total} features total</div>`+html;}
            setPhase('summary');updateStatus('Review your configuration before starting.');
        }

        // ── Editing ───────────────────────────────────────────────────────────
        function startEditing(){
            sessionStartTime=new Date();editLog=[];lastSubmittedValues=null;
            try{const sel=$('#savedConfigSelect');if(sel?.value)localStorage.setItem('pathEditorLastConfig',sel.value);}catch(e){}
            if($('#bulkEditMode')?.checked){startBulkEdit();return;}

            const interleave = $('#interleaveMode')?.checked && layerConfigs.length > 1;
            currentEditingQueue=[];

            if(interleave){
                const queues = layerConfigs.map(cfg =>
                    cfg.features.map(f=>({layer:cfg.layer,feature:f,fields:cfg.fields,mode:cfg.mode,showPopup:cfg.showPopup,allowSkip:cfg.allowSkip}))
                );
                const maxLen = Math.max(...queues.map(q=>q.length));
                for(let i=0;i<maxLen;i++){
                    queues.forEach(q=>{ if(i<q.length) currentEditingQueue.push(q[i]); });
                }
            }else{
                layerConfigs.forEach(cfg=>cfg.features.forEach(f=>currentEditingQueue.push({layer:cfg.layer,feature:f,fields:cfg.fields,mode:cfg.mode,showPopup:cfg.showPopup,allowSkip:cfg.allowSkip})));
            }

            currentIndex=0;setPhase('editing');showCurrentFeature();
        }

        function showCurrentFeature(){
            if(currentIndex>=currentEditingQueue.length){setPhase('complete');clearHighlights();displayEditSummary();updateStatus('All features processed!');return;}
            const item=currentEditingQueue[currentIndex];
            const pct=Math.round((currentIndex/currentEditingQueue.length)*100);
            $('#editingProgress').innerHTML=`<div style="display:flex;justify-content:space-between;font-size:12px;"><span><strong>${currentIndex+1}</strong> / ${currentEditingQueue.length}</span><span style="color:#a6adc8;font-size:11px;">${item.layer.title}</span></div><div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${pct}%"></div></div>`;
            const oidField=getObjectIdField(item.feature),oid=item.feature.attributes[oidField];
            $('#featureInfo').innerHTML=`<strong>OID:</strong> ${oid} &nbsp;|&nbsp; <strong>Mode:</strong> ${item.mode==='edit'?'Editing':'View Only'}`;
            const fc=$('#editFormContainer');fc.innerHTML='';
            if(item.mode==='edit'&&item.fields.length>0){
                item.fields.forEach(f=>fc.appendChild(createFieldInput(f,item.feature.attributes[f.name])));
                applyAutoCalcWatchers(item);
            }
            else fc.innerHTML='<div style="color:#6c7086;font-style:italic;font-size:12px;">View only — no fields to edit.</div>';
            $('#prevBtn').disabled=currentIndex===0;$('#skipBtn').style.display=item.allowSkip?'block':'none';
            $('#applyPrevRow').style.display=(lastSubmittedValues&&item.mode==='edit'&&item.fields.length>0)?'block':'none';
            filesToUpload=[];updateFileList();
            // Lazy-load attachments — only query the service when the user asks.
            // Auto-firing queryAttachments on every feature advance was generating
            // one unprompted round-trip per feature, more aggressive than the native viewer.
            const attSection=$('#existingAttachmentsSection');
            const attList=$('#existingAttachmentsList');
            if(attSection&&attList){
                if(item.layer.capabilities?.data?.supportsAttachment){
                    attSection.style.display='block';
                    attList.innerHTML='<button class="btn btn-secondary pe-load-att-btn" style="width:100%;font-size:11px;">🗂️ Load Existing Attachments</button>';
                    attSection.querySelector('.pe-load-att-btn').onclick=()=>loadExistingAttachments(item);
                }else{
                    attSection.style.display='none';
                    attList.innerHTML='';
                }
            }
            highlightFeature(item.feature,item.showPopup);
            updateStatus(`${item.mode==='edit'?'Editing':'Viewing'} feature ${currentIndex+1} of ${currentEditingQueue.length}`);
        }

        function applyPreviousValues(){
            if(!lastSubmittedValues)return;
            const item=currentEditingQueue[currentIndex];
            $('#editFormContainer').querySelectorAll('[data-field-name]').forEach(el=>{
                const name=el.dataset.fieldName;if(!(name in lastSubmittedValues))return;
                const val=lastSubmittedValues[name];
                if(el.classList.contains('domain-btn')){const field=item.fields.find(f=>f.name===name);if(field?.domain?.codedValues){const opt=field.domain.codedValues.find(cv=>cv.code==val);el.querySelector('.domain-display-text').textContent=opt?opt.name:val;el.dataset.selectedCode=val;}}
                else if(el.dataset.fieldType==='date'&&val){el.value=new Date(val).toISOString().split('T')[0];}
                else{el.value=val;}
            });
            updateStatus('Previous values applied.');
        }

        function collectFormValues(fc){
            const vals={};
            fc.querySelectorAll('[data-field-name]').forEach(el=>{const name=el.dataset.fieldName,type=el.dataset.fieldType,raw=el.dataset.selectedCode!==undefined?el.dataset.selectedCode:el.value;if(raw==='')return;if(type==='integer'||type==='small-integer')vals[name]=parseInt(raw);else if(type==='double'||type==='single')vals[name]=parseFloat(raw);else if(type==='date')vals[name]=new Date(raw).getTime();else vals[name]=raw;});
            return vals;
        }

        async function submitFeature(){
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
                // Store submitted string values for predictive text on future features
                item.fields.filter(f=>f.type==='string').forEach(f=>{
                    if(vals[f.name]!==undefined) saveSuggestion(f.name, vals[f.name]);
                });
                if(filesToUpload.length>0)await uploadAttachments(item.layer,item.feature);
                updateStatus('Feature updated!');currentIndex++;setTimeout(()=>showCurrentFeature(),400);
            }catch(err){updateStatus('Error: '+err.message);alert('Error updating feature: '+err.message);}
        }

        function skipFeature(){const item=currentEditingQueue[currentIndex],oidField=getObjectIdField(item.feature);editLog.push({timestamp:new Date(),action:'skip',layerName:item.layer.title,featureOID:item.feature.attributes[oidField],success:true});currentIndex++;showCurrentFeature();}
        function prevFeature(){if(currentIndex>0){currentIndex--;showCurrentFeature();}}

        // ── Field Inputs ──────────────────────────────────────────────────────
        function getObjectIdField(feature){if(feature.attributes.objectid!==undefined)return 'objectid';if(feature.attributes.OBJECTID!==undefined)return 'OBJECTID';if(feature.layer?.objectIdField)return feature.layer.objectIdField;return Object.keys(feature.attributes).find(k=>k.toUpperCase()==='OBJECTID')||'objectid';}
        function createFieldInput(field,currentValue){
            const container=document.createElement('div');container.style.marginBottom='10px';
            const labelRow=document.createElement('div');labelRow.className='field-label';labelRow.innerHTML=`<span>${field.alias||field.name}</span><span class="fieldBadge">${getFieldTypeLabel(field)}</span>`;container.appendChild(labelRow);
            if(currentValue!==null&&currentValue!==undefined&&currentValue!==''){const hint=document.createElement('div');hint.className='current-hint';hint.textContent='Current: '+currentValue;container.appendChild(hint);}
            let input;
            if(field.domain?.type==='coded-value'){
                const wrap=document.createElement('div');
                const options=field.domain.codedValues.map(cv=>({code:cv.code,name:cv.name}));
                let selectedCode=(currentValue!==null&&currentValue!==undefined)?currentValue:'';
                const currentOpt=options.find(o=>o.code==selectedCode);
                const btn=document.createElement('button');btn.type='button';btn.className='domain-btn';btn.dataset.fieldName=field.name;btn.dataset.fieldType=field.type;btn.dataset.selectedCode=selectedCode;
                const dispText=document.createElement('span');dispText.className='domain-display-text';dispText.textContent=currentOpt?currentOpt.name:'— Select —';
                const arrow=document.createElement('span');arrow.textContent='▼';arrow.style.fontSize='10px';btn.appendChild(dispText);btn.appendChild(arrow);
                const panel=document.createElement('div');panel.className='domain-panel-inline';panel.style.cssText='display:none;margin-top:2px;background:#1e1e2e;border:1px solid #45475a;border-radius:6px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.5);';
                const srch=document.createElement('input');srch.type='text';srch.placeholder='Type to search…';srch.style.cssText='width:100%;padding:7px 10px;background:#313244;border:none;border-bottom:1px solid #45475a;color:#cdd6f4;font-size:12px;outline:none;box-sizing:border-box;';
                const list=document.createElement('div');list.style.cssText='max-height:200px;overflow-y:auto;';
                function renderList(filter=''){list.innerHTML='';const f=filter.toLowerCase();[{code:'',name:'— Select —'},...options].filter(o=>!f||o.name.toLowerCase().includes(f)||String(o.code).toLowerCase().includes(f)).forEach(opt=>{const it=document.createElement('div');const isSel=opt.code==selectedCode;it.style.cssText=`padding:8px 10px;cursor:pointer;font-size:12px;color:${isSel?'#cba6f7':'#cdd6f4'};background:${isSel?'#2a1f3d':'transparent'};font-weight:${isSel?'600':'normal'};border-bottom:1px solid #313244;`;it.textContent=opt.name;it.addEventListener('mouseenter',()=>{if(opt.code!=selectedCode)it.style.background='#313244';});it.addEventListener('mouseleave',()=>{it.style.background=opt.code==selectedCode?'#2a1f3d':'transparent';});it.addEventListener('mousedown',e=>{e.preventDefault();selectedCode=opt.code;btn.dataset.selectedCode=opt.code;dispText.textContent=opt.name;panel.style.display='none';btn.classList.remove('open');arrow.textContent='▼';});list.appendChild(it);});if(!list.children.length){const em=document.createElement('div');em.style.cssText='padding:10px;font-size:11px;color:#6c7086;text-align:center;';em.textContent='No matches';list.appendChild(em);}}
                renderList();panel.appendChild(srch);panel.appendChild(list);
                btn.addEventListener('click',()=>{const isOpen=panel.style.display==='block';$('#editFormContainer').querySelectorAll('.domain-panel-inline').forEach(p=>{p.style.display='none';});toolBox.querySelectorAll('.domain-btn').forEach(b=>{b.classList.remove('open');b.querySelector('span:last-child').textContent='▼';});if(!isOpen){panel.style.display='block';btn.classList.add('open');arrow.textContent='▲';srch.value='';renderList('');setTimeout(()=>{srch.focus();panel.scrollIntoView({behavior:'smooth',block:'nearest'});},50);}});
                srch.addEventListener('input',()=>renderList(srch.value));
                wrap.appendChild(btn);wrap.appendChild(panel);input=wrap;
            }else if(field.type==='date'){input=document.createElement('input');input.type='date';if(currentValue)input.value=new Date(currentValue).toISOString().split('T')[0];input.className='input-ctrl';input.dataset.fieldName=field.name;input.dataset.fieldType=field.type;}
            else if(field.type==='integer'||field.type==='small-integer'){input=document.createElement('input');input.type='number';input.step='1';input.value=currentValue??'';input.className='input-ctrl';input.dataset.fieldName=field.name;input.dataset.fieldType=field.type;}
            else if(field.type==='double'||field.type==='single'){input=document.createElement('input');input.type='number';input.step='any';input.value=currentValue??'';input.className='input-ctrl';input.dataset.fieldName=field.name;input.dataset.fieldType=field.type;}
            else{
                input=document.createElement('textarea');
                input.rows=3;
                input.value=currentValue??'';
                if(field.length)input.maxLength=field.length;
                input.className='input-ctrl';
                input.dataset.fieldName=field.name;
                input.dataset.fieldType=field.type;
                input.style.cssText+='resize:vertical;font-family:inherit;line-height:1.4;';

                // Auto-expand: grow to fit content but never shrink below a
                // manually set height. This runs on every keystroke.
                function autoExpand(){
                    const stored=textareaHeights.get(field.name);
                    input.style.height='auto';
                    const natural=input.scrollHeight;
                    const target=stored?Math.max(natural,stored):natural;
                    input.style.height=target+'px';
                }
                input.addEventListener('input', autoExpand);

                // Apply stored height or fit to content on first render.
                requestAnimationFrame(()=>{
                    const stored=textareaHeights.get(field.name);
                    if(stored){
                        // Honour the user's last manual size, then grow if content
                        // is taller than that saved size.
                        input.style.height=stored+'px';
                        if(input.scrollHeight>stored) input.style.height=input.scrollHeight+'px';
                    } else {
                        input.style.height='auto';
                        input.style.height=input.scrollHeight+'px';
                    }
                });

                // ResizeObserver captures both manual drags and programmatic
                // expansions and persists the final height by field name so the
                // next feature in the queue opens at the same size.
                const ro=new ResizeObserver(entries=>{
                    const h=Math.round(entries[0].contentRect.height);
                    if(h>0) textareaHeights.set(field.name, h);
                });
                ro.observe(input);
                // Clean up observer when the form is replaced by the next feature
                input.addEventListener('blur', ()=>{}, {once:false});
                const origRemove=input.remove.bind(input);
                input.remove=()=>{ ro.disconnect(); origRemove(); };

                container.style.position='relative';
            }
            container.appendChild(input);
            if(field.type==='string') attachAutocomplete(input, field.name);
            return container;
        }

        // ── Highlights ────────────────────────────────────────────────────────
        function clearHighlights(){highlightGraphics.forEach(g=>{try{mapView.graphics.remove(g);}catch(e){}});highlightGraphics=[];const tr=[];mapView.graphics.forEach(g=>{if(!g.symbol)return;const s=g.symbol;if((s.type==='simple-marker'&&s.size>=20)||(s.type==='simple-line'&&s.width>=8)||(s.type==='simple-fill'&&(s.color?.[3]>=0.3||(s.outline?.width>=4))))tr.push(g);});tr.forEach(g=>{try{mapView.graphics.remove(g);}catch(e){}});mapView.popup?.close();}
        function highlightFeature(feature,showPopup){
            clearHighlights();
            let symbol;if(feature.geometry.type==='point')symbol={type:'simple-marker',color:[203,166,247,.85],size:22,outline:{color:[255,255,255,1],width:3}};else if(feature.geometry.type==='polyline')symbol={type:'simple-line',color:[203,166,247,.85],width:8};else symbol={type:'simple-fill',color:[203,166,247,.35],outline:{color:[203,166,247,1],width:4}};
            const g={geometry:feature.geometry,symbol};mapView.graphics.add(g);highlightGraphics.push(g);
            mapView.goTo({target:feature.geometry,scale:Math.min(mapView.scale,2000)},{duration:700}).then(()=>{if(showPopup&&mapView.popup)showFeaturePopup(feature);}).catch(()=>{if(showPopup&&mapView.popup)showFeaturePopup(feature);});
        }
        function showFeaturePopup(feature){
            // Use the already-fetched feature directly — no need to re-query the service.
            // The original code fired a queryFeatures round-trip on every feature advance
            // during editing, which was the one unintended service call outside of
            // intentional queries and edit submissions.
            try{
                mapView.popup.open({features:[feature],location:getPopupLocation(feature.geometry)});
            }catch(e){console.warn('Popup open failed:',e);}
        }
        function getPopupLocation(geom){try{if(geom.type==='point')return geom;if(geom.type==='polyline'&&geom.paths?.[0]?.length>0){const p=geom.paths[0],mid=Math.floor(p.length/2);return{type:'point',x:p[mid][0],y:p[mid][1],spatialReference:geom.spatialReference};}if(geom.type==='polygon')return geom.centroid||geom.extent?.center||geom;return geom.extent?.center||geom;}catch(e){return geom;}}

        // ── Bulk Edit ─────────────────────────────────────────────────────────
        let currentBulkLayerIndex=0;
        function startBulkEdit(){currentBulkLayerIndex=0;setPhase('bulkEdit');showBulkEditForm();}
        function showBulkEditForm(){
            const el=layerConfigs.filter(c=>c.mode==='edit'&&c.fields.length>0);
            if(!el.length){alert('No layers configured for editing.');setPhase('summary');return;}
            if(currentBulkLayerIndex>=el.length){clearBulkHighlights();setPhase('complete');return;}
            const cfg=el[currentBulkLayerIndex];
            $('#bulkEditLayerSelector').innerHTML=`<div class="card"><strong>${currentBulkLayerIndex+1}/${el.length}:</strong> ${cfg.layer.title}<div style="font-size:11px;color:#a6adc8;">${cfg.features.length} features to update</div></div>`;
            const fc=$('#bulkEditFormContainer');fc.innerHTML='<div style="font-weight:700;font-size:12px;margin-bottom:8px;">Set values for all features:</div>';
            cfg.fields.forEach(f=>fc.appendChild(createFieldInput(f,null)));
            $('#applyBulkEditBtn').textContent=`Apply to ${cfg.features.length} Features`;
            $('#bulkEditResults').innerHTML='';
            highlightBulkFeatures(cfg.features);
        }
        async function applyBulkEdit(){
            const el=layerConfigs.filter(c=>c.mode==='edit'&&c.fields.length>0),cfg=el[currentBulkLayerIndex];
            const vals=collectFormValues($('#bulkEditFormContainer'));
            if(!Object.keys(vals).length){alert('Enter at least one value.');return;}
            if(!confirm(`Apply to ${cfg.features.length} features?`))return;
            updateStatus('Applying bulk edit…');$('#applyBulkEditBtn').disabled=true;

            async function applyWithRetry(batch, attempt=0){
                try{
                    return await cfg.layer.applyEdits({updateFeatures:batch});
                }catch(err){
                    if(attempt>=3) throw err;
                    const delay=500*Math.pow(2,attempt); // 500ms, 1s, 2s
                    updateStatus(`Server busy — retrying in ${delay/1000}s…`);
                    await new Promise(r=>setTimeout(r,delay));
                    return applyWithRetry(batch,attempt+1);
                }
            }

            try{let ok=0,fail=0;const oidF=getObjectIdField(cfg.features[0]);const batches=cfg.features.map(f=>({attributes:{[oidF]:f.attributes[oidF],...vals}}));for(let i=0;i<batches.length;i+=100){const res=await applyWithRetry(batches.slice(i,i+100));res.updateFeatureResults?.forEach((r,idx)=>{const s=r.success===true||(r.success===undefined&&r.error===null&&(r.objectId||r.globalId)),oid=batches[i+idx].attributes[oidF];if(s){ok++;editLog.push({timestamp:new Date(),action:'bulk_update',layerName:cfg.layer.title,featureOID:oid,changes:vals,success:true});}else{fail++;editLog.push({timestamp:new Date(),action:'bulk_update',layerName:cfg.layer.title,featureOID:oid,success:false,error:r.error?.message});}});updateStatus(`Processed ${Math.min(i+100,batches.length)}/${batches.length}`);}
            $('#bulkEditResults').innerHTML=`<div class="card" style="border-color:#a6e3a1;color:#a6e3a1;">✓ ${ok} updated${fail?` | ✗ ${fail} failed`:''}</div>`;
            clearBulkHighlights();
            if(currentBulkLayerIndex<el.length-1){
                updateStatus('Moving to next layer…');
                setTimeout(()=>{currentBulkLayerIndex++;showBulkEditForm();},2000);
            }else{
                clearBulkHighlights();
                setTimeout(()=>setPhase('complete'),2000);
            }
            }catch(err){$('#bulkEditResults').innerHTML=`<div class="card" style="border-color:#f38ba8;color:#f38ba8;">Error: ${err.message}</div>`;}
            finally{$('#applyBulkEditBtn').disabled=false;}
        }

        // ── Saved Configurations ──────────────────────────────────────────────
        function getSavedConfigurations(){try{return JSON.parse(localStorage.getItem('sequentialEditorConfigs')||'{}');}catch(e){return {};}}
        function loadSavedConfigurationsList(){const sel=$('#savedConfigSelect');sel.innerHTML='<option value="">-- Select saved config --</option>';Object.entries(getSavedConfigurations()).forEach(([id,c])=>{const d=new Date(c.savedAt),opt=document.createElement('option');opt.value=id;opt.textContent=`${c.name} (${d.toLocaleDateString()} ${d.toLocaleTimeString()})`;sel.appendChild(opt);});}
        function autoLoadLastConfiguration(){try{const id=localStorage.getItem('pathEditorLastConfig');if(!id)return;const cfg=getSavedConfigurations()[id];if(!cfg)return;const s=$('#layerConfigContainer').querySelectorAll('[data-layer-id]');if(!s?.length)return;$('#savedConfigSelect').value=id;applyConfigurationToUI(cfg);updateStatus(`Auto-loaded: "${cfg.name}"`);}catch(e){console.warn('Auto-load failed:',e);}}
        function saveConfiguration(){const layers=[];$('#layerConfigContainer').querySelectorAll('[data-layer-id]').forEach(section=>{const lid=section.dataset.layerId,chk=section.querySelector(`#layer_${lid}_enabled`);if(!chk?.checked)return;const data=selectedFeaturesByLayer.get(lid);if(!data)return;const mode=section.querySelector(`input[name="mode_${lid}"]:checked`)?.value||'edit';const lc={layerId:data.layer.layerId,layerTitle:data.layer.title,mode,order:parseInt(section.dataset.order||1),showPopup:section.querySelector(`#popup_${lid}`)?.checked??true,allowSkip:section.querySelector(`#allowskip_${lid}`)?.checked??true,fields:[],filterEnabled:false,filterConjunction:'AND',filterConditions:[]};if(section.getFilterData){const fd=section.getFilterData();lc.filterEnabled=fd.filterEnabled;lc.filterConjunction=fd.filterConjunction;lc.filterConditions=fd.filterConditions;}if(mode==='edit'){const fd=section.querySelector(`#fields_${lid}`);lc.fields=fd?.getCheckedFields?fd.getCheckedFields():Array.from(section.querySelectorAll(`#fields_${lid} input[type=checkbox]:checked`)).map(c=>c.dataset.fieldName);}layers.push(lc);});if(!layers.length){alert('No layers configured to save.');return;}const name=prompt('Configuration name:','My Configuration');if(!name)return;const all=getSavedConfigurations(),id='config_'+Date.now();all[id]={name,savedAt:new Date().toISOString(),layers};try{localStorage.setItem('sequentialEditorConfigs',JSON.stringify(all));updateStatus(`Saved "${name}"`);loadSavedConfigurationsList();}catch(e){alert('Save error: '+e.message);}}
        function loadConfiguration(){const id=$('#savedConfigSelect').value;if(!id){alert('Select a configuration first.');return;}const cfg=getSavedConfigurations()[id];if(!cfg){alert('Configuration not found.');return;}try{localStorage.setItem('pathEditorLastConfig',id);}catch(e){}applyConfigurationToUI(cfg);}
        function deleteConfiguration(){const sel=$('#savedConfigSelect'),id=sel.value;if(!id){alert('Select a configuration to delete.');return;}const all=getSavedConfigurations(),cfg=all[id];if(!cfg||!confirm(`Delete "${cfg.name}"?`))return;delete all[id];try{localStorage.setItem('sequentialEditorConfigs',JSON.stringify(all));updateStatus(`Deleted "${cfg.name}"`);loadSavedConfigurationsList();}catch(e){alert('Delete error: '+e.message);}}
        function applyConfigurationToUI(config){const sections=$('#layerConfigContainer').querySelectorAll('[data-layer-id]');let applied=0,skipped=[];sections.forEach(section=>{const lid=section.dataset.layerId,data=selectedFeaturesByLayer.get(lid);if(!data)return;const lc=config.layers.find(l=>l.layerId===data.layer.layerId);if(!lc)return;const chk=section.querySelector(`#layer_${lid}_enabled`);if(!chk){skipped.push(lc.layerTitle);return;}chk.checked=true;section.classList.add('enabled');const body=section.querySelector('.layerCardBody');if(body){body.style.display='block';const ch=section.querySelector('.layerCardHeader span:last-child');if(ch)ch.textContent='▲';}const modeR=section.querySelector(`input[name="mode_${lid}"][value="${lc.mode}"]`);if(modeR){modeR.checked=true;const fd=section.querySelector(`#fields_${lid}`);if(fd)fd.style.display=lc.mode==='edit'?'block':'none';}section.dataset.order=lc.order;const oi=section.querySelector('.orderInput');if(oi)oi.value=lc.order;const pc=section.querySelector(`#popup_${lid}`);if(pc)pc.checked=lc.showPopup;const sc=section.querySelector(`#allowskip_${lid}`);if(sc)sc.checked=lc.allowSkip;if(lc.filterEnabled&&section.setFilterData)section.setFilterData({filterEnabled:lc.filterEnabled,filterConjunction:lc.filterConjunction||'AND',filterConditions:lc.filterConditions||[]});if(lc.mode==='edit'&&lc.fields?.length){const fd=section.querySelector(`#fields_${lid}`);if(fd?.setCheckedFields)fd.setCheckedFields(lc.fields);else section.querySelectorAll(`#fields_${lid} input[type=checkbox]`).forEach(c=>{c.checked=lc.fields.includes(c.dataset.fieldName);});}applied++;});updateStatus(applied===0?`Config "${config.name}": no matching layers in current selection.`:`Loaded "${config.name}" (${applied} layer${applied>1?'s':''}${skipped.length?`, skipped: ${skipped.join(', ')}`:''}).`);}

        // ── Complete / Report ─────────────────────────────────────────────────
        function displayEditSummary(){const edits=editLog.filter(e=>e.action==='update'||e.action==='bulk_update'),ok=edits.filter(e=>e.success).length,skip=editLog.filter(e=>e.action==='skip').length,fail=edits.filter(e=>!e.success).length,dur=sessionStartTime?Math.round((new Date()-sessionStartTime)/1000):0;$('#editSummary').innerHTML=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;"><div class="stat-box"><div style="font-size:20px;font-weight:700;color:#a6e3a1;">${ok}</div><div style="font-size:10px;color:#a6adc8;">Updated</div></div><div class="stat-box"><div style="font-size:20px;font-weight:700;color:#f9e2af;">${skip}</div><div style="font-size:10px;color:#a6adc8;">Skipped</div></div>${fail?`<div class="stat-box"><div style="font-size:20px;font-weight:700;color:#f38ba8;">${fail}</div><div style="font-size:10px;color:#a6adc8;">Failed</div></div>`:''}<div class="stat-box"><div style="font-size:20px;font-weight:700;color:#89b4fa;">${Math.floor(dur/60)}m ${dur%60}s</div><div style="font-size:10px;color:#a6adc8;">Duration</div></div></div>`;}
        function exportSummaryReport(){if(!editLog.length){alert('No edits to export.');return;}const end=new Date(),dur=sessionStartTime?Math.round((end-sessionStartTime)/1000):0,edits=editLog.filter(e=>e.action==='update'||e.action==='bulk_update');let r='='.repeat(70)+'\nPATH EDITOR — EDIT SUMMARY REPORT\n'+'='.repeat(70)+'\n\n';r+=`Session: ${sessionStartTime?.toLocaleString()||'Unknown'} → ${end.toLocaleString()}\nDuration: ${Math.floor(dur/60)}m ${dur%60}s\n\nUpdated: ${edits.filter(e=>e.success).length}  Skipped: ${editLog.filter(e=>e.action==='skip').length}  Failed: ${edits.filter(e=>!e.success).length}\n\nDETAILED LOG\n${'-'.repeat(70)}\n`;editLog.forEach((e,i)=>{r+=`[${i+1}] ${e.timestamp.toLocaleTimeString()} | ${e.layerName} | OID:${e.featureOID} | ${e.action.toUpperCase()} | ${e.success?'OK':'FAIL'}\n`;if(e.changes)Object.entries(e.changes).forEach(([k,v])=>{r+=`    ${k}: ${v.oldValue??''}→${v.newValue??v}\n`;});if(e.error)r+=`    Error: ${e.error}\n`;});const blob=new Blob([r],{type:'text/plain'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`path-editor-report-${end.toISOString().split('T')[0]}.txt`;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);updateStatus('Report exported.');}
        function startOver(){currentIndex=0;currentBulkLayerIndex=0;layerConfigs=[];currentEditingQueue=[];editLog=[];sessionStartTime=null;lastSubmittedValues=null;clearHighlights();clearBulkHighlights();clearSelection();setPhase('selection');updateStatus('Ready — choose a selection mode.');}

        // ── CSV Download ──────────────────────────────────────────────────────
        async function downloadLayerCSV(lid,layer){
            try{
                updateStatus(`Preparing ${layer.title} CSV…`);
                const data=selectedFeaturesByLayer.get(lid);if(!data){updateStatus('No selection data found.');return;}
                const card=$('#layerConfigContainer')?.querySelector(`[data-layer-id="${lid}"]`);
                const where=card?.getFilterClause?.()|| '';
                let features;
                if(where){
                    const oidField=layer.objectIdField||'OBJECTID';
                    const objectIds=data.features.map(f=>f.attributes[oidField]).filter(id=>id!=null);
                    const res=await layer.queryFeatures({where,objectIds,returnGeometry:false,outFields:['*']});
                    features=res.features;
                }else{features=data.features;}
                if(!features.length){updateStatus('No features to download after applying filter.');return;}
                await layer.load();
                const fields=layer.fields.filter(f=>f.type!=='geometry'&&f.type!=='blob');
                const escape=v=>{const s=String(v);return(s.includes(',')||s.includes('"')||s.includes('\n'))?`"${s.replace(/"/g,'""')}"`  :s;};
                const headers=fields.map(f=>escape(f.alias||f.name));
                const rows=features.map(feat=>fields.map(f=>{let val=feat.attributes[f.name];if(val===null||val===undefined)return '';if(f.type==='date'&&val)val=new Date(val).toLocaleString();if(f.domain?.type==='coded-value'){const cv=f.domain.codedValues.find(c=>c.code==val);if(cv)val=cv.name;}return escape(val);}).join(','));
                const csv='\uFEFF'+[headers.join(','),...rows].join('\n');
                const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}),url=URL.createObjectURL(blob),a=document.createElement('a');
                a.href=url;a.download=`${layer.title.replace(/[^\w\s-]/g,'').trim().replace(/\s+/g,'_')}_${new Date().toISOString().split('T')[0]}.csv`;
                document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
                updateStatus(`Downloaded ${features.length} features from "${layer.title}"${where?' (filtered)':''}.`);
            }catch(e){updateStatus('CSV download error: '+e.message);}
        }

        // ── File Upload ───────────────────────────────────────────────────────
        function setupFileUpload(){
            const dz=$('#dropZone'),fi=$('#fileInput');if(!dz||!fi)return;
            dz.addEventListener('click',()=>fi.click());
            dz.addEventListener('dragover',e=>{e.preventDefault();dz.style.borderColor='#89b4fa';dz.style.background='#1e3a5f';});
            dz.addEventListener('dragleave',e=>{e.preventDefault();dz.style.borderColor='#45475a';dz.style.background='#181825';});
            dz.addEventListener('drop',e=>{e.preventDefault();dz.style.borderColor='#45475a';dz.style.background='#181825';addFilesToUpload(Array.from(e.dataTransfer.files));});
            fi.addEventListener('change',e=>{addFilesToUpload(Array.from(e.target.files));e.target.value='';});
        }
        function addFilesToUpload(files){const rej=[],added=[];files.forEach(f=>{if(!isAllowedFile(f)){rej.push(f.name);return;}if(!filesToUpload.find(x=>x.name===f.name&&x.size===f.size)){filesToUpload.push(f);added.push(f.name);}});updateFileList();if(rej.length)updateStatus('Skipped: '+rej.join(', '));else if(added.length)updateStatus(added.length+' file(s) queued — will upload on Submit');}
        function updateFileList(){const fl=$('#fileList');if(!fl)return;if(!filesToUpload.length){fl.innerHTML='';return;}fl.innerHTML=filesToUpload.map((f,i)=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 6px;background:#313244;border-radius:4px;margin:3px 0;font-size:11px;"><span>${fileTypeLabel(f)} ${f.name} <span style="color:#6c7086;">(${(f.size/1024).toFixed(1)}KB)</span></span><button class="removeFileBtn" data-index="${i}" style="background:#f38ba8;color:#1e1e2e;border:none;border-radius:3px;padding:1px 6px;cursor:pointer;font-size:11px;">×</button></div>`).join('');fl.querySelectorAll('.removeFileBtn').forEach(btn=>btn.addEventListener('click',e=>{filesToUpload.splice(parseInt(e.target.dataset.index),1);updateFileList();}));}
        async function uploadAttachments(layer,feature){if(!filesToUpload.length)return;try{await layer.load();if(!layer.capabilities?.operations?.supportsAdd){updateStatus('Layer does not support attachments — files skipped.');filesToUpload=[];updateFileList();return;}let ok=0,fail=0;for(let i=0;i<filesToUpload.length;i++){const f=filesToUpload[i];try{updateStatus(`Uploading attachment ${i+1}/${filesToUpload.length}: ${f.name}…`);const fd=new FormData();fd.append('attachment',f);const res=await layer.addAttachment(feature,fd);if(res?.addAttachmentResult||res?.objectId)ok++;else throw new Error('Unexpected result');}catch(e){fail++;console.warn('Attachment upload failed:',f.name,e);}await new Promise(r=>setTimeout(r,300));}updateStatus(`Attachments: ${ok} uploaded${fail?', '+fail+' failed':''}`);}catch(e){updateStatus('Attachment upload error: '+e.message);}filesToUpload=[];updateFileList();}

        // ── Existing Attachment Viewer ────────────────────────────────────────
        async function loadExistingAttachments(item){
            const section = $('#existingAttachmentsSection');
            const list    = $('#existingAttachmentsList');
            if(!section || !list) return;

            section.style.display = 'none';
            list.innerHTML = '<div style="font-size:11px;color:#6c7086;">Loading…</div>';

            try{
                await item.layer.load();
                if(!item.layer.capabilities?.data?.supportsAttachment){
                    section.style.display = 'none'; return;
                }

                const oidField = getObjectIdField(item.feature);
                const oid      = item.feature.attributes[oidField];
                const result   = await item.layer.queryAttachments({ objectIds:[oid] });
                const attachments = (result[oid] || []);

                if(!attachments.length){ section.style.display = 'none'; return; }

                section.style.display = 'block';
                list.innerHTML = '';

                // ── Download All button (blob fetch — actually downloads) ──────
                const dlAllBtn = document.createElement('button');
                dlAllBtn.type = 'button'; dlAllBtn.className = 'btn btn-info';
                dlAllBtn.style.cssText = 'width:100%;font-size:11px;margin-bottom:8px;';
                dlAllBtn.textContent = `⬇ Download All (${attachments.length})`;
                dlAllBtn.onclick = async () => {
                    dlAllBtn.disabled = true;
                    dlAllBtn.textContent = 'Downloading…';

                    for (let i = 0; i < attachments.length; i++) {
                        const att = attachments[i];
                        dlAllBtn.textContent = `Downloading ${i + 1} / ${attachments.length}…`;
                        try {
                            const resp = await fetch(att.url, { credentials: 'include' });
                            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                            const blob = await resp.blob();
                            const url  = URL.createObjectURL(blob);
                            const a    = document.createElement('a');
                            a.href     = url;
                            a.download = att.name;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                            await new Promise(r => setTimeout(r, 300));
                        } catch (err) {
                            updateStatus(`Failed to download "${att.name}": ${err.message}`);
                        }
                    }

                    dlAllBtn.disabled = false;
                    dlAllBtn.textContent = `⬇ Download All (${attachments.length})`;
                    updateStatus(`Downloaded ${attachments.length} attachment(s).`);
                };
                list.appendChild(dlAllBtn);

                // ── Per-attachment rows ───────────────────────────────────────
                attachments.forEach(att => {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 8px;background:#313244;border-radius:6px;margin-bottom:4px;';

                    const info = document.createElement('div');
                    info.style.cssText = 'flex:1;min-width:0;';

                    const nameDisplay = document.createElement('div');
                    nameDisplay.style.cssText = 'font-size:11px;color:#cdd6f4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:text;border-bottom:1px dashed transparent;transition:border-color .15s;';
                    nameDisplay.title = 'Click to rename';
                    nameDisplay.textContent = att.name;
                    nameDisplay.addEventListener('mouseenter', () => nameDisplay.style.borderBottomColor = '#6c7086');
                    nameDisplay.addEventListener('mouseleave', () => nameDisplay.style.borderBottomColor = 'transparent');

                    const nameInput = document.createElement('input');
                    nameInput.type = 'text'; nameInput.value = att.name;
                    nameInput.style.cssText = 'display:none;width:100%;padding:2px 4px;background:#1e1e2e;border:1px solid #cba6f7;border-radius:4px;color:#cdd6f4;font-size:11px;outline:none;box-sizing:border-box;';

                    const renameStatus = document.createElement('div');
                    renameStatus.style.cssText = 'font-size:10px;color:#6c7086;margin-top:2px;min-height:14px;';
                    renameStatus.textContent = att.size ? `${(att.size/1024).toFixed(1)} KB  ✏️ Click name to rename` : '✏️ Click name to rename';

                    let isRenaming = false;

                    function enterEditMode(){
                        if(isRenaming) return;
                        nameDisplay.style.display = 'none';
                        nameInput.style.display   = 'block';
                        nameInput.focus(); nameInput.select();
                        renameStatus.textContent  = 'Enter to confirm • Esc to cancel';
                        renameStatus.style.color  = '#a6adc8';
                    }
                    function exitEditMode(){
                        nameDisplay.style.display = 'block';
                        nameInput.style.display   = 'none';
                        renameStatus.textContent  = att.size ? `${(att.size/1024).toFixed(1)} KB  ✏️ Click name to rename` : '✏️ Click name to rename';
                        renameStatus.style.color  = '#6c7086';
                    }

                    async function commitRename(){
                        const newName = nameInput.value.trim();
                        if(!newName || newName === att.name){ exitEditMode(); return; }
                        isRenaming = true;
                        renameStatus.textContent = 'Fetching file…';
                        renameStatus.style.color = '#f9e2af';
                        nameInput.disabled = true;
                        try{
                            const resp = await fetch(att.url, { credentials:'include' });
                            if(!resp.ok) throw new Error(`HTTP ${resp.status}`);
                            const blob = await resp.blob();
                            const origExt   = att.name.includes('.') ? att.name.split('.').pop() : '';
                            const finalName = (!newName.includes('.') && origExt) ? `${newName}.${origExt}` : newName;
                            const fd = new FormData();
                            fd.append('attachment', new File([blob], finalName, { type: blob.type }));
                            renameStatus.textContent = 'Uploading…';
                            const addResult = await item.layer.addAttachment(item.feature, fd);
                            if(!addResult?.addAttachmentResult?.success && !addResult?.objectId)
                                throw new Error('Upload did not confirm success');
                            renameStatus.textContent = 'Removing original…';
                            await item.layer.deleteAttachments(item.feature, [att.id]);
                            att.name = finalName;
                            nameDisplay.textContent = finalName;
                            nameInput.value         = finalName;
                            renameStatus.textContent = `✓ Renamed  ✏️ Click name to rename`;
                            renameStatus.style.color = '#a6e3a1';
                            updateStatus(`Renamed to: ${finalName}`);
                            exitEditMode();
                        }catch(err){
                            renameStatus.textContent = `✗ Rename failed: ${err.message}`;
                            renameStatus.style.color = '#f38ba8';
                            updateStatus('Rename failed: ' + err.message);
                            exitEditMode();
                        }finally{
                            isRenaming = false;
                            nameInput.disabled = false;
                        }
                    }

                    nameDisplay.addEventListener('click', enterEditMode);
                    nameInput.addEventListener('keydown', e => {
                        if(e.key==='Enter')  { e.preventDefault(); commitRename(); }
                        if(e.key==='Escape') { exitEditMode(); }
                    });
                    nameInput.addEventListener('blur', () => { if(!isRenaming) exitEditMode(); });

                    info.appendChild(nameDisplay);
                    info.appendChild(nameInput);
                    info.appendChild(renameStatus);

                    const btnWrap = document.createElement('div');
                    btnWrap.style.cssText = 'display:flex;gap:4px;flex-shrink:0;';

                    const dlBtn = document.createElement('button');
                    dlBtn.type = 'button'; dlBtn.className = 'btn btn-info';
                    dlBtn.style.cssText = 'font-size:10px;padding:3px 8px;';
                    dlBtn.textContent = '⬇';
                    dlBtn.title = 'Download';
                    dlBtn.onclick = async () => {
                        try{
                            dlBtn.disabled = true;
                            const resp = await fetch(att.url, { credentials:'include' });
                            if(!resp.ok) throw new Error(`HTTP ${resp.status}`);
                            const blob = await resp.blob();
                            const url  = URL.createObjectURL(blob);
                            const a    = document.createElement('a');
                            a.href = url; a.download = att.name;
                            document.body.appendChild(a); a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                        }catch(err){
                            updateStatus('Download failed: ' + err.message);
                        }finally{
                            dlBtn.disabled = false;
                        }
                    };

                    const delBtn = document.createElement('button');
                    delBtn.type = 'button'; delBtn.className = 'btn btn-danger';
                    delBtn.style.cssText = 'font-size:10px;padding:3px 8px;';
                    delBtn.textContent = '🗑';
                    delBtn.title = 'Delete';
                    delBtn.onclick = async () => {
                        if(!confirm(`Delete "${att.name}"?`)) return;
                        try{
                            delBtn.disabled = true;
                            await item.layer.deleteAttachments(item.feature, [att.id]);
                            row.remove();
                            const rows = list.querySelectorAll('[data-att-row]');
                            if(!rows.length) section.style.display = 'none';
                            updateStatus(`Deleted: ${att.name}`);
                        }catch(err){
                            delBtn.disabled = false;
                            updateStatus('Delete failed: ' + err.message);
                        }
                    };

                    btnWrap.appendChild(dlBtn);
                    btnWrap.appendChild(delBtn);
                    row.dataset.attRow = att.id;
                    row.appendChild(info);
                    row.appendChild(btnWrap);
                    list.appendChild(row);
                });

            }catch(err){
                section.style.display = 'none';
                console.warn('Could not load attachments:', err);
            }
        }

        function cleanup(){
            if(sketchViewModel){sketchViewModel.destroy();sketchViewModel=null;}
            if(sketchLayer){mapView.map.remove(sketchLayer);sketchLayer=null;}
            if(mapClickHandler){mapClickHandler.remove();mapClickHandler=null;}
            clearHighlights();clearBulkHighlights();clearSelectionHighlights();
            if(selectionGraphic)mapView.graphics.remove(selectionGraphic);
            selectionGraphics.forEach(g=>{try{mapView.graphics.remove(g);}catch(e){}});selectionGraphics=[];
            toolBox.remove();
            const ps=document.getElementById('peStyles');if(ps)ps.remove();
        }

        // ── Predictive text / autocomplete ───────────────────────────────────
        const AC_KEY = fn => `pe_ac_${fn.toLowerCase()}`;
        const AC_CAP = 25;
        const AC_MIN_STORE = 4;

        function getSuggestions(fieldName){
            try{ return JSON.parse(localStorage.getItem(AC_KEY(fieldName))||'[]'); }
            catch(e){ return []; }
        }
        function saveSuggestion(fieldName, value){
            if(!value||value.trim().length<AC_MIN_STORE) return;
            try{
                let list=getSuggestions(fieldName).filter(s=>s!==value);
                list.unshift(value);
                list.length=Math.min(list.length,AC_CAP);
                localStorage.setItem(AC_KEY(fieldName),JSON.stringify(list));
            }catch(e){ console.warn('Autocomplete save failed:',e); }
        }
        function removeSuggestion(fieldName, value){
            try{
                const list=getSuggestions(fieldName).filter(s=>s!==value);
                localStorage.setItem(AC_KEY(fieldName),JSON.stringify(list));
            }catch(e){}
        }

        function attachAutocomplete(textarea, fieldName){
            let activeIdx=-1;
            let visible=[];

            // Append to body and use fixed positioning so the dropdown can render
            // to the left of the toolbox without being clipped by overflow:hidden.
            const dropdown=document.createElement('div');
            dropdown.style.cssText=[
                'display:none',
                'position:fixed',
                'width:280px',
                'background:#1e1e2e',
                'border:1px solid #cba6f7',
                'border-radius:8px',
                'z-index:999999',
                'max-height:220px',
                'overflow-y:auto',
                'box-shadow:-4px 4px 20px rgba(0,0,0,.7)',
                'font:13px/1.4 "Segoe UI",Arial,sans-serif',
            ].join(';');
            document.body.appendChild(dropdown);

            function reposition(){
                const r=textarea.getBoundingClientRect();
                // Anchor top to the textarea, nudge down if it would clip above viewport
                const top=Math.max(8, r.top);
                // Place to the left of the toolbox with an 8px gap
                const right=window.innerWidth-r.left+8;
                dropdown.style.top=top+'px';
                dropdown.style.right=right+'px';
                // If dropdown would overflow below viewport, shift it up
                const dropH=dropdown.offsetHeight;
                const maxTop=window.innerHeight-dropH-8;
                if(top>maxTop) dropdown.style.top=Math.max(8,maxTop)+'px';
            }

            // Reposition on peBody scroll so it tracks the textarea as user scrolls
            const peBody=document.getElementById('peBody');
            function onScroll(){ if(dropdown.style.display!=='none') reposition(); }
            if(peBody) peBody.addEventListener('scroll',onScroll);

            function getMatches(text){
                const all=getSuggestions(fieldName);
                if(!text||!text.trim()) return all.slice(0,10);
                const lower=text.toLowerCase();
                return all.filter(s=>s.toLowerCase().includes(lower));
            }
            function setActive(idx){
                activeIdx=idx;
                dropdown.querySelectorAll('.pe-ac-item').forEach((el,i)=>{
                    el.style.background=i===idx?'#2a1f3d':'transparent';
                });
                if(idx>=0){const el=dropdown.querySelectorAll('.pe-ac-item')[idx];if(el)el.scrollIntoView({block:'nearest'});}
            }
            function select(val){
                textarea.value=val;
                textarea.style.height='auto';
                textarea.style.height=textarea.scrollHeight+'px';
                hide();
                textarea.focus();
                textarea.setSelectionRange(val.length,val.length);
            }
            function hide(){
                dropdown.style.display='none';
                activeIdx=-1; visible=[];
            }
            function show(matches){
                visible=matches; activeIdx=-1; dropdown.innerHTML='';
                if(!matches.length){ hide(); return; }

                const hdr=document.createElement('div');
                hdr.style.cssText='padding:5px 10px;font-size:10px;color:#6c7086;border-bottom:1px solid #313244;display:flex;justify-content:space-between;align-items:center;';
                hdr.innerHTML=`<span style="color:#cba6f7;font-weight:700;">💡 ${fieldName}</span><span>↑↓ • Enter • Esc</span>`;
                dropdown.appendChild(hdr);

                matches.forEach((s,i)=>{
                    const item=document.createElement('div');
                    item.className='pe-ac-item';
                    item.style.cssText='display:flex;align-items:flex-start;padding:8px 10px;cursor:pointer;border-bottom:1px solid #313244;gap:8px;transition:background .1s;';

                    const txt=document.createElement('span');
                    txt.style.cssText='flex:1;font-size:12px;color:#cdd6f4;white-space:pre-wrap;word-break:break-word;line-height:1.4;';
                    txt.textContent=s;

                    const rm=document.createElement('button');
                    rm.type='button'; rm.textContent='✕'; rm.title='Remove suggestion';
                    rm.style.cssText='background:none;border:none;color:#6c7086;cursor:pointer;font-size:11px;padding:2px 5px;flex-shrink:0;border-radius:3px;line-height:1;transition:color .1s;';
                    rm.addEventListener('mouseenter',()=>rm.style.color='#f38ba8');
                    rm.addEventListener('mouseleave',()=>rm.style.color='#6c7086');
                    rm.addEventListener('mousedown',e=>{
                        e.preventDefault(); e.stopPropagation();
                        removeSuggestion(fieldName,s);
                        show(getMatches(textarea.value));
                    });

                    item.addEventListener('mouseenter',()=>setActive(i));
                    item.addEventListener('mousedown',e=>{ e.preventDefault(); select(s); });
                    item.appendChild(txt); item.appendChild(rm);
                    dropdown.appendChild(item);
                });

                dropdown.style.display='block';
                reposition();
            }

            textarea.addEventListener('focus',()=>{ const m=getMatches(textarea.value); if(m.length) show(m); });
            textarea.addEventListener('input',()=>show(getMatches(textarea.value)));
            textarea.addEventListener('keydown',e=>{
                if(dropdown.style.display==='none') return;
                if(e.key==='ArrowDown'){ e.preventDefault(); setActive(Math.min(activeIdx+1,visible.length-1)); }
                else if(e.key==='ArrowUp'){ e.preventDefault(); setActive(Math.max(activeIdx-1,-1)); }
                else if(e.key==='Enter'&&activeIdx>=0){ e.preventDefault(); select(visible[activeIdx]); }
                else if(e.key==='Escape'){ e.preventDefault(); hide(); }
            });
            textarea.addEventListener('blur',()=>setTimeout(hide,150));

            // Clean up the body-level dropdown and scroll listener when the
            // textarea is removed from the DOM (i.e. when advancing features).
            const origRemove=textarea.remove.bind(textarea);
            textarea.remove=()=>{
                dropdown.remove();
                if(peBody) peBody.removeEventListener('scroll',onScroll);
                origRemove();
            };
        }

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
        $('#backToSummaryBtn').onclick    = ()=>{ clearBulkHighlights(); setPhase('summary'); };
        $('#exportReportBtn').onclick     = exportSummaryReport;
        $('#startOverBtn').onclick        = startOver;
        $('#closeTool').onclick           = ()=>window.gisToolHost.closeTool('path-editor');

        setPhase('selection');
        setupFileUpload();
        startSelection();
        initializeSketchViewModel(null);
        window.gisToolHost.activeTools.set('path-editor', { cleanup, toolBox });

    } catch(error) {
        alert('Error creating Path Editor Tool: '+(error.message||error));
    }
})();
