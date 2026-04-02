// tools/snap-move-tool.js
// Click-to-Move + Cut & Split + Click & Copy + Snap to Point Tool

(function() {
    try {
        if (!window.gisToolHost) window.gisToolHost = {};
        if (!window.gisToolHost.activeTools || !(window.gisToolHost.activeTools instanceof Set)) {
            window.gisToolHost.activeTools = new Set();
        }
        if (window.gisToolHost.activeTools.has('snap-move-tool')) {
            console.log('Snap Move Tool already active'); return;
        }
        const existing = document.getElementById('snapMoveToolbox');
        if (existing) existing.remove();

        // ── Map view ──────────────────────────────────────────────────────────

        function getMapView() {
            if (window.gisSharedUtils?.getMapView) { const mv = window.gisSharedUtils.getMapView(); if (mv) return mv; }
            const mv = Object.values(window).find(o => o?.constructor?.name === "MapView" && o.map && o.center);
            if (mv) return mv;
            if (window.view?.map) return window.view;
            if (window.mapView?.map) return window.mapView;
            throw new Error('MapView not found');
        }

        const mapView = getMapView();
        const z = 99999;
        const SNAP_TOLERANCE = 25, POINT_SNAP_TOLERANCE = 45;
        const CUT_TOLERANCE_M = 15 / 3.28084;
        const MIN_SEGMENT_LEN_FT = 1;

        function makeExt(cx, cy, half, sr) {
            return { type:'extent', xmin:cx-half, ymin:cy-half, xmax:cx+half, ymax:cy+half, spatialReference:sr };
        }

        // ── Dynamic layer registry ────────────────────────────────────────────

        let pointLayers = [], lineLayers = [], polygonLayers = [];

        async function loadLayers() {
            pointLayers = []; lineLayers = []; polygonLayers = [];
            const all = mapView.map.allLayers.filter(l => l.type === "feature" && l.visible !== false);
            await Promise.all(all.map(l => l.load().catch(() => null)));
            for (const l of all) {
                if (!l.loaded) continue;
                const entry = { layer: l, name: l.title || `Layer ${l.layerId}`, id: l.layerId };
                const gt = (l.geometryType || "").toLowerCase();
                if      (gt === "point" || gt === "multipoint") pointLayers.push(entry);
                else if (gt === "polyline")                     lineLayers.push(entry);
                else if (gt === "polygon")                      polygonLayers.push(entry);
            }
            return { pointLayers, lineLayers, polygonLayers };
        }

        function getAllFeatureLayers() {
            return [...pointLayers, ...lineLayers, ...polygonLayers].sort((a,b) => a.name.localeCompare(b.name));
        }

        function updateLayerBadge() {
            const badge = toolBox.querySelector("#layerBadge");
            if (badge) badge.textContent = `${pointLayers.length} point · ${lineLayers.length} line · ${polygonLayers.length} polygon`;
        }

        // ── Toolbox UI ────────────────────────────────────────────────────────

        const toolBox = document.createElement("div");
        toolBox.id = "snapMoveToolbox";
        toolBox.style.cssText = `
            position:fixed;top:120px;right:40px;z-index:${z};background:#fff;border:1px solid #333;
            padding:12px;max-width:320px;font:12px/1.3 Arial,sans-serif;
            box-shadow:0 4px 16px rgba(0,0,0,.2);border-radius:4px;
            max-height:calc(100vh - 140px);overflow-y:auto;overflow-x:hidden;`;

        toolBox.innerHTML = `
            <style>
                #snapMoveToolbox .smt-section { border-radius:3px; margin-bottom:8px; overflow:hidden; }
                #snapMoveToolbox .smt-section-header { display:flex;align-items:center;justify-content:space-between;padding:5px 8px;font-size:11px;font-weight:bold; }
                #snapMoveToolbox .smt-body { padding:0 8px 8px; }
                #snapMoveToolbox .smt-sublabel { display:flex;align-items:center;justify-content:space-between;font-size:10px;font-weight:bold;color:#444;margin:6px 0 2px; }
                #snapMoveToolbox .smt-info-btn { font-size:9px;padding:1px 5px;background:#ccc;color:#444;border:none;border-radius:8px;cursor:pointer;font-family:inherit;line-height:1.4;flex-shrink:0; }
                #snapMoveToolbox .smt-info-btn:hover { background:#bbb; }
                #snapMoveToolbox .smt-hint { font-size:10px;color:#666;line-height:1.5;margin-bottom:5px;padding:5px 7px;background:rgba(0,0,0,0.04);border-radius:3px;border-left:2px solid rgba(0,0,0,0.12); }
                #snapMoveToolbox .smt-row { display:flex;gap:4px;margin-bottom:4px; }
                #snapMoveToolbox .smt-row button { flex:1; }
                #snapMoveToolbox button { padding:4px 6px;color:white;border:none;border-radius:2px;font-size:11px;cursor:pointer;font-family:inherit; }
            </style>

            <div id="smtDragHandle" style="margin:-12px -12px 8px;padding:4px 10px;background:#e8e8e8;border-bottom:1px solid #ccc;border-radius:4px 4px 0 0;cursor:grab;display:flex;align-items:center;gap:6px;user-select:none;">
                <span style="color:#999;font-size:13px;letter-spacing:2px;">⠿</span>
                <span style="font-size:10px;color:#888;">drag to move</span>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <div style="font-weight:bold;font-size:13px;">🔧 GIS Edit Tools</div>
                <div style="display:flex;gap:4px;align-items:center;">
                    <button id="toggleAllTips" style="padding:2px 7px;background:#aaa;color:white;border:none;border-radius:2px;font-size:10px;cursor:pointer;">ℹ Show Tips</button>
                    <button id="closeTool" style="padding:2px 8px;background:#d32f2f;color:white;border:none;border-radius:2px;font-size:11px;cursor:pointer;">✕ Close</button>
                </div>
            </div>

            <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;padding:4px 8px;background:#f5f5f5;border:1px solid #ddd;border-radius:3px;font-size:10px;color:#555;">
                <span>🗂</span><span id="layerBadge" style="flex:1;">Detecting layers…</span>
                <button id="refreshLayers" style="padding:2px 7px;font-size:10px;background:#3367d6;border-radius:2px;">↺ Refresh</button>
            </div>

            <!-- ── Section 1: Tool Activation ───────────────────────── -->
            <div class="smt-section" style="border:1px solid #b8d4f0;">
                <div class="smt-section-header" style="background:#deeeff;color:#1a56a0;">⚡ Tool Activation</div>
                <div class="smt-body" style="background:#f0f7ff;">
                    <div class="smt-sublabel"><span>Activate / Deactivate</span><button class="smt-info-btn" data-hint="h-activate">▾ more</button></div>
                    <div id="h-activate" class="smt-hint" style="display:none;">Enable to start clicking on the map — cursor becomes a crosshair. Disable at any time to restore normal map navigation.</div>
                    <div class="smt-row">
                        <button id="enableTool"  style="background:#28a745;">▶ Enable Tool</button>
                        <button id="disableTool" style="background:#666;" disabled>⏹ Disable Tool</button>
                    </div>
                    <div class="smt-sublabel"><span>Snapping</span><button class="smt-info-btn" data-hint="h-snapping">▾ more</button></div>
                    <div id="h-snapping" class="smt-hint" style="display:none;">When enabled, move destinations automatically snap to the nearest point feature or line vertex. Disable if you need to place a feature at an exact click location.</div>
                    <button id="snappingToggle" style="width:100%;background:#28a745;margin-bottom:4px;">⦿ Snapping: ON</button>
                    <div class="smt-sublabel"><span>Cancel</span><button class="smt-info-btn" data-hint="h-cancel">▾ more</button></div>
                    <div id="h-cancel" class="smt-hint" style="display:none;">Cancel a pending selection before clicking the destination. Use this if you selected the wrong feature.</div>
                    <button id="cancelMove" style="width:100%;background:#ff9800;" disabled>⊘ Cancel Current Move</button>
                </div>
            </div>

            <!-- ── Section 2: Single Feature Editing ────────────────── -->
            <div class="smt-section" style="border:1px solid #d4b8f0;">
                <div class="smt-section-header" style="background:#ead8ff;color:#5a1a9e;">📌 Single Feature Editing</div>
                <div class="smt-body" style="background:#faf0ff;">
                    <div class="smt-sublabel"><span>Lock to Feature</span><button class="smt-info-btn" data-hint="h-lock">▾ more</button></div>
                    <div id="h-lock" class="smt-hint" style="display:none;">Pin all edits to one specific feature — ideal when features overlap. Hover a row in the picker to highlight that feature on the map.<br><br><strong>Point lock:</strong> moves only that point; connected lines are unaffected.<br><strong>Line lock:</strong> restricts vertex moves, add/delete, snap-to-point, and highlights to that line only.</div>
                    <div class="smt-row">
                        <button id="lockFeatureBtn"    style="background:#666;">🎯 Pick Feature</button>
                        <button id="releaseFeatureBtn" style="background:#666;" disabled>🔓 Release Lock</button>
                    </div>
                    <div id="lockedFeatureInfo" style="font-size:10px;color:#6f42c1;min-height:14px;font-style:italic;margin-top:2px;"></div>
                </div>
            </div>

            <!-- ── Section 3: Move & Vertex Tools ───────────────────── -->
            <div class="smt-section" style="border:1px solid #b8e8c8;">
                <div class="smt-section-header" style="background:#d0f0dc;color:#1a6e3a;">🖱 Move &amp; Vertex Tools</div>
                <div class="smt-body" style="background:#f0fff4;">
                    <div style="font-size:10px;color:#888;margin-bottom:6px;padding:3px 6px;background:rgba(0,0,0,0.04);border-radius:2px;">⌨️ Hotkeys active while tool is enabled</div>
                    <div class="smt-sublabel"><span>Move Features</span><button class="smt-info-btn" data-hint="h-move">▾ more</button></div>
                    <div id="h-move" class="smt-hint" style="display:none;"><strong>Point [E]:</strong> Click a point → click destination. Connected line endpoints follow.<br><strong>Line [Q]:</strong> Click a vertex → click destination. Coincident shared vertices move together.<br>Destinations snap to the nearest point feature or line vertex (when snapping is on).</div>
                    <div class="smt-row">
                        <button id="pointMode" style="background:#3367d6;">📍 Point [E]</button>
                        <button id="lineMode"  style="background:#666;">〰️ Line [Q]</button>
                    </div>
                    <div class="smt-sublabel"><span>Vertex Tools <span style="font-weight:normal;color:#888;">(Line Mode only)</span></span><button class="smt-info-btn" data-hint="h-vertex">▾ more</button></div>
                    <div id="h-vertex" class="smt-hint" style="display:none;"><strong>Add [A]:</strong> Click along a segment to insert a vertex at that spot.<br><strong>Delete [D]:</strong> Click a vertex to remove it. Lines with only 2 vertices cannot be reduced further.</div>
                    <div class="smt-row">
                        <button id="addVertexMode"    style="background:#666;">➕ Add Vertex [A]</button>
                        <button id="deleteVertexMode" style="background:#666;">✖ Delete Vertex [D]</button>
                    </div>
                    <div class="smt-sublabel"><span>Snap to Point</span><button class="smt-info-btn" data-hint="h-snap">▾ more</button></div>
                    <div id="h-snap" class="smt-hint" style="display:none;">
                        <strong>One-click shortcut</strong> that combines "Add Vertex" + "Move to Pole" into a single operation.<br><br>
                        Click anywhere near a point feature and the tool will:<br>
                        1. Find the nearest point feature within snap tolerance<br>
                        2. Find all lines within 15 ft of that point, plus any line directly clicked<br>
                        3. Insert a vertex at the exact point location on each line<br><br>
                        Lines already snapped within 1 pixel are skipped automatically.<br><br>
                        <strong>Hotkey: S</strong>
                    </div>
                    <button id="snapToPointModeBtn" style="width:100%;background:#666;margin-bottom:4px;">🧲 Snap to Point [S]</button>
                    <div class="smt-sublabel"><span>Vertex Visualisation</span><button class="smt-info-btn" data-hint="h-viz">▾ more</button></div>
                    <div id="h-viz" class="smt-hint" style="display:none;">Overlay vertex markers on all visible line features in the current extent. Auto-refreshes on pan/zoom unless a feature is locked. 🟠 = endpoints &nbsp;🔵 = midpoints</div>
                    <div class="smt-row">
                        <button id="showVerticesToggle" style="background:#666;">👁 Show Vertices</button>
                        <button id="refreshVertices"    style="background:#666;" disabled>🔄 Refresh</button>
                    </div>
                </div>
            </div>

            <!-- ── Section 4: Cut & Split ────────────────────────────── -->
            <div class="smt-section" style="border:1px solid #f0c0a0;">
                <div class="smt-section-header" style="background:#fde8d0;color:#7a2e00;">✂️ Cut &amp; Split Lines</div>
                <div class="smt-body" style="background:#fff8f4;">
                    <div class="smt-sublabel"><span>How it works</span><button class="smt-info-btn" data-hint="h-cut">▾ more</button></div>
                    <div id="h-cut" class="smt-hint" style="display:none;">Click a point feature near a line. A menu lists each detected line — hover to highlight on the map, check/uncheck to choose which to cut. Confirming splits each selected line at the point into two new segments with recalculated lengths.<br><br><strong>Undo</strong> restores the last cut batch (only available while the tool is open).<br><br><strong>Hotkey: C</strong></div>
                    <div class="smt-row">
                        <button id="cutModeBtn" style="background:#e67e00;">✂️ Cut Mode [C]</button>
                        <button id="cutUndoBtn" style="background:#666;" disabled>↩ Undo Cut</button>
                    </div>
                    <div id="cutModeInfo" style="font-size:10px;color:#7a2e00;min-height:14px;font-style:italic;margin-top:2px;"></div>
                </div>
            </div>

            <!-- ── Section 5: Click & Copy ───────────────────────────── -->
            <div class="smt-section" style="border:1px solid #a8d8a8;">
                <div class="smt-section-header" style="background:#d4efd4;color:#1a4d1a;">📋 Click &amp; Copy</div>
                <div class="smt-body" style="background:#f4fff4;">
                    <div class="smt-sublabel"><span>How it works</span><button class="smt-info-btn" data-hint="h-copy">▾ more</button></div>
                    <div id="h-copy" class="smt-hint" style="display:none;">Enable copy mode, then click any feature on the map to use it as a template. If multiple features overlap, a picker menu will appear.<br><br><strong>Points</strong> are placed exactly at the click.<br><strong>Lines</strong> are offset so the first vertex aligns with the click.<br><strong>Polygons</strong> are offset so the centroid aligns with the click.<br><br>Placement snaps to nearby points and line vertices (when snapping is on). Press <strong>ESC</strong> or click "Clear Template" to stop placing and pick a new template.</div>
                    <div class="smt-row">
                        <button id="copyModeBtn"          style="background:#2e7d32;">📋 Enable Copy Mode</button>
                        <button id="clearCopyTemplateBtn" style="background:#666;" disabled>✕ Clear Template</button>
                    </div>
                    <div id="copyTemplateInfo" style="display:none;padding:5px 7px;background:#e8ffe8;border:1px solid #a8d8a8;border-radius:3px;font-size:10px;color:#1a4d1a;margin-top:4px;">
                        <div id="copyTemplateDetails"></div>
                    </div>
                    <div id="copyCountInfo" style="font-size:10px;color:#28a745;font-weight:bold;min-height:14px;margin-top:3px;"></div>
                </div>
            </div>

            <!-- ── Status bar ────────────────────────────────────────── -->
            <div id="toolStatus" style="padding:5px 7px;background:#f5f5f5;border:1px solid #ddd;border-radius:3px;color:#3367d6;font-size:11px;min-height:18px;"></div>`;

        document.body.appendChild(toolBox);

        // ── Cut context menu ──────────────────────────────────────────────────

        const cutCtxMenu = document.createElement('div');
        cutCtxMenu.id = 'smtCutContextMenu';
        cutCtxMenu.style.cssText = `
            display:none;position:fixed;z-index:${z+1};background:#fff;
            border:1px solid #444;border-radius:6px;
            box-shadow:0 4px 16px rgba(0,0,0,.3);
            font:12px/1.4 Arial,sans-serif;min-width:200px;overflow:hidden;`;
        cutCtxMenu.innerHTML = `
            <div style="padding:6px 10px;background:#e67e00;color:#fff;font-weight:bold;font-size:11px;
                        display:flex;align-items:center;justify-content:space-between;">
                <span>✂️ Lines: <span id="cutCtxCount">0</span></span>
                <button id="cutCtxSelectAll" style="padding:1px 7px;background:rgba(255,255,255,.25);color:#fff;border:1px solid rgba(255,255,255,.5);border-radius:3px;font-size:10px;cursor:pointer;font-family:inherit;">✓ All</button>
            </div>
            <div id="cutCtxList" style="max-height:180px;overflow-y:auto;border-bottom:1px solid #eee;"></div>
            <div style="display:flex;flex-direction:column;">
                <button id="cutCtxExecute" style="padding:7px 10px;background:#dc3545;color:#fff;border:none;border-bottom:1px solid rgba(255,255,255,.2);cursor:pointer;text-align:left;font:bold 12px Arial,sans-serif;">✂ Execute Cut (0)</button>
                <button id="cutCtxCancel"  style="padding:7px 10px;background:#6c757d;color:#fff;border:none;cursor:pointer;text-align:left;font:12px Arial,sans-serif;">✕ Cancel</button>
            </div>`;
        document.body.appendChild(cutCtxMenu);

        // ── Drag to move ──────────────────────────────────────────────────────

        (function() {
            const handle = toolBox.querySelector('#smtDragHandle');
            let dragging = false, ox = 0, oy = 0;
            handle.addEventListener('mousedown', e => { dragging=true; ox=e.clientX-toolBox.getBoundingClientRect().left; oy=e.clientY-toolBox.getBoundingClientRect().top; handle.style.cursor='grabbing'; e.preventDefault(); });
            document.addEventListener('mousemove', e => { if(!dragging)return; toolBox.style.left=Math.max(0,Math.min(e.clientX-ox,window.innerWidth-toolBox.offsetWidth))+'px'; toolBox.style.top=Math.max(0,Math.min(e.clientY-oy,window.innerHeight-toolBox.offsetHeight))+'px'; toolBox.style.right='auto'; });
            document.addEventListener('mouseup', ()=>{ if(!dragging)return; dragging=false; handle.style.cursor='grab'; });
        })();

        // ── Collapsible hints ─────────────────────────────────────────────────

        toolBox.querySelectorAll('.smt-info-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const hint = toolBox.querySelector('#' + btn.dataset.hint);
                const open = hint.style.display !== 'none';
                hint.style.display = open ? 'none' : '';
                btn.textContent = open ? '▾ more' : '▴ less';
            });
        });

        toolBox.querySelector('#toggleAllTips').addEventListener('click', () => {
            const btn = toolBox.querySelector('#toggleAllTips');
            const hints = toolBox.querySelectorAll('.smt-hint');
            const infos = toolBox.querySelectorAll('.smt-info-btn');
            const anyOpen = [...hints].some(h => h.style.display !== 'none');
            hints.forEach(h => h.style.display = anyOpen ? 'none' : '');
            infos.forEach(b => b.textContent = anyOpen ? '▾ more' : '▴ less');
            btn.textContent = anyOpen ? 'ℹ Show Tips' : 'ℹ Hide Tips';
        });

        // ── State ─────────────────────────────────────────────────────────────

        let toolActive = false, currentMode = "point", vertexMode = "none";
        let selectedFeature = null, selectedLayer = null, selectedLayerConfig = null;
        let selectedVertex = null, selectedCoincidentLines = [], waitingForDestination = false;
        let connectedFeatures = [], originalGeometries = new Map(), clickHandler = null;
        let isProcessingClick = false;
        let snappingEnabled = true;
        let lockedFeature = null, pickingFeatureMode = false;
        let vertexHighlightActive = false, vertexHighlightLayer = null;
        let extentWatchHandle = null, highlightDebounceTimer = null;
        let pickerPopup = null, pickerHoverGraphic = null;
        let hotkeyHandler = null;
        let snapToPointMode = false;

        // Cut state
        let cutMode = false, cutPreviewMode = false, cutProcessing = false;
        let cutSelectedPoint = null, cutSelectedPointLayer = null, cutLinesToCut = [];
        let cutSelectedIndices = new Set(), cutGraphicMap = new Map();
        let undoStack = [];
        let cutGraphicsLayer = null;

        // Copy state
        let copyMode = false, copyPlacementMode = false;
        let copyTemplateFeature = null, copyTemplateLayer = null;
        let copiedCount = 0;
        let copyMouseMoveHandler = null, copyKeyHandler = null, copySnapGraphic = null;

        // ── DOM refs ──────────────────────────────────────────────────────────

        const $ = id => toolBox.querySelector(id);
        const pointModeBtn          = $("#pointMode");
        const lineModeBtn           = $("#lineMode");
        const addVertexBtn          = $("#addVertexMode");
        const deleteVertexBtn       = $("#deleteVertexMode");
        const snapToPointModeBtn    = $("#snapToPointModeBtn");
        const showVerticesToggleBtn = $("#showVerticesToggle");
        const refreshVerticesBtn    = $("#refreshVertices");
        const lockFeatureBtn        = $("#lockFeatureBtn");
        const releaseFeatureBtn     = $("#releaseFeatureBtn");
        const lockedFeatureInfo     = $("#lockedFeatureInfo");
        const enableBtn             = $("#enableTool");
        const disableBtn            = $("#disableTool");
        const snappingToggleBtn     = $("#snappingToggle");
        const cancelBtn             = $("#cancelMove");
        const closeBtn              = $("#closeTool");
        const status                = $("#toolStatus");
        const cutModeBtn            = $("#cutModeBtn");
        const cutUndoBtn            = $("#cutUndoBtn");
        const cutModeInfo           = $("#cutModeInfo");
        const copyModeBtn           = $("#copyModeBtn");
        const clearCopyTemplateBtn  = $("#clearCopyTemplateBtn");
        const copyTemplateInfo      = $("#copyTemplateInfo");
        const copyTemplateDetails   = $("#copyTemplateDetails");
        const copyCountInfo         = $("#copyCountInfo");

        const updateStatus = msg => { if (status) status.textContent = msg; };

        // ── Geometry helpers ──────────────────────────────────────────────────

        function calcDist(p1, p2) { const dx=p1.x-p2.x,dy=p1.y-p2.y; return Math.sqrt(dx*dx+dy*dy); }
        function webMercToLatLng(x, y) { const lng=(x/20037508.34)*180; let lat=(y/20037508.34)*180; lat=180/Math.PI*(2*Math.atan(Math.exp(lat*Math.PI/180))-Math.PI/2); return {lat,lng}; }
        function mapPtToLatLng(mp) { try { const sr=mp.spatialReference; if(!sr||sr.wkid===3857||sr.wkid===102100)return webMercToLatLng(mp.x,mp.y); if(sr.wkid===4326||sr.wkid===4269)return{lat:mp.y,lng:mp.x}; return webMercToLatLng(mp.x,mp.y); } catch{return{lat:0,lng:0};} }
        function geodeticDist(p1, p2) { try { const ll1=mapPtToLatLng(p1),ll2=mapPtToLatLng(p2),R=20902231.0,lat1=ll1.lat*Math.PI/180,lat2=ll2.lat*Math.PI/180,dLat=(ll2.lat-ll1.lat)*Math.PI/180,dLng=(ll2.lng-ll1.lng)*Math.PI/180,a=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2; return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)); } catch{return 0;} }
        function geodeticLength(geom) { try { if(!geom?.paths?.length)return 0; let t=0; for(const path of geom.paths)for(let i=0;i<path.length-1;i++)t+=geodeticDist({x:path[i][0],y:path[i][1],spatialReference:geom.spatialReference},{x:path[i+1][0],y:path[i+1][1],spatialReference:geom.spatialReference}); return Math.round(t); } catch{return 0;} }
        function isEndpoint(geom,pi,vi) { if(!geom?.paths?.[pi])return false; const p=geom.paths[pi]; return vi===0||vi===p.length-1; }
        function closestPtOnSeg(pt,s,e) { const A=pt.x-s.x,B=pt.y-s.y,C=e.x-s.x,D=e.y-s.y,dot=A*C+B*D,lenSq=C*C+D*D,param=lenSq?dot/lenSq:-1,cp=param<0?{x:s.x,y:s.y}:param>1?{x:e.x,y:e.y}:{x:s.x+param*C,y:s.y+param*D}; return{point:cp,distance:calcDist(pt,cp)}; }
        function findClosestSeg(geom,mp) { if(!geom?.paths)return null; let cl=null,mn=Infinity; for(let pi=0;pi<geom.paths.length;pi++){const path=geom.paths[pi];for(let si=0;si<path.length-1;si++){const p1={x:path[si][0],y:path[si][1]},p2={x:path[si+1][0],y:path[si+1][1]},inf=closestPtOnSeg(mp,p1,p2);if(inf.distance<mn){mn=inf.distance;cl={pathIndex:pi,segmentIndex:si,insertIndex:si+1,distance:inf.distance,point:inf.point};}}} return(cl&&cl.distance<50)?cl:null; }
        function findClosestVertex(geom,mp) { if(!geom?.paths)return null; let cl=null,mn=Infinity; for(let pi=0;pi<geom.paths.length;pi++){const path=geom.paths[pi];for(let vi=0;vi<path.length;vi++){const v={x:path[vi][0],y:path[vi][1]},d=calcDist(mp,v);if(d<mn){mn=d;cl={pathIndex:pi,pointIndex:vi,distance:d,coordinates:v,isEndpoint:isEndpoint(geom,pi,vi)};}}} return(cl&&cl.distance<POINT_SNAP_TOLERANCE*(mapView.resolution||1))?cl:null; }
        function findAbsoluteClosestVertex(geom,pt) { if(!geom?.paths)return null; let cl=null,mn=Infinity; for(const path of geom.paths)for(const v of path){const d=calcDist(pt,{x:v[0],y:v[1]});if(d<mn){mn=d;cl={distance:d};}} return cl; }
        function buildPolyline(srcGeom,newPaths) { return{type:"polyline",paths:newPaths,spatialReference:srcGeom.spatialReference}; }
        function clonePaths(geom) { return geom.paths.map(p=>p.map(c=>c.slice())); }
        function calcPolygonCentroid(ring) { let x=0,y=0; for(const pt of ring){x+=pt[0];y+=pt[1];} return{x:x/ring.length,y:y/ring.length}; }
        function toTypedPoint(g,fallbackSr) { if(!g)return g; if(g.type)return g; return{type:'point',x:g.x,y:g.y,spatialReference:g.spatialReference||fallbackSr}; }

        // ── Cut geometry helpers ──────────────────────────────────────────────

        function findCutInfo(lineGeom,snapPt) { if(!lineGeom?.paths?.length)return null; let best=null; for(let pi=0;pi<lineGeom.paths.length;pi++){const path=lineGeom.paths[pi];for(let si=0;si<path.length-1;si++){const a={x:path[si][0],y:path[si][1]},b={x:path[si+1][0],y:path[si+1][1]},res=closestPtOnSeg(snapPt,a,b);if(!best||res.distance<best.dist)best={pathIdx:pi,segIdx:si,dist:res.distance,t:res.t};}} return best; }

        function splitLine(lineGeom,cutInfo,snapPt) {
            try {
                const allPaths=lineGeom.paths,{pathIdx:pi,segIdx:si}=cutInfo,path=allPaths[pi],snap=[snapPt.x,snapPt.y],cp=p=>p.map(v=>[...v]);
                const paths1=[...allPaths.slice(0,pi).map(cp),[...path.slice(0,si+1).map(v=>[...v]),snap]];
                const paths2=[[snap,...path.slice(si+1).map(v=>[...v])],...allPaths.slice(pi+1).map(cp)];
                if(paths1.some(p=>p.length<2)||paths2.some(p=>p.length<2)){console.warn('splitLine: degenerate path.');return null;}
                const seg1=lineGeom.clone();seg1.paths=paths1;const seg2=lineGeom.clone();seg2.paths=paths2;
                if(geodeticLength(seg1)<MIN_SEGMENT_LEN_FT||geodeticLength(seg2)<MIN_SEGMENT_LEN_FT){console.warn('splitLine: segment too short.');return null;}
                return{seg1,seg2};
            } catch(e){console.error('splitLine error:',e);return null;}
        }

        // ── Shared graphics helpers ───────────────────────────────────────────

        async function ensureCutGraphicsLayer() {
            if(cutGraphicsLayer)return;
            try{await new Promise((res,rej)=>{if(typeof require!=='undefined')require(['esri/layers/GraphicsLayer'],GL=>{cutGraphicsLayer=new GL({listMode:'hide'});mapView.map.add(cutGraphicsLayer);res();},rej);else rej(new Error('require not found'));});}
            catch(e){console.error('ensureCutGraphicsLayer error:',e);}
        }
        function clearCutHighlights(){if(cutGraphicsLayer)cutGraphicsLayer.removeAll();}
        async function highlightCutGeometry(geometry,isPoint) {
            await ensureCutGraphicsLayer();if(!cutGraphicsLayer)return;
            try{await new Promise((res,rej)=>{require(['esri/Graphic'],G=>{cutGraphicsLayer.add(new G({geometry,symbol:isPoint?{type:'simple-marker',style:'circle',color:[255,200,0,0.85],size:16,outline:{color:[180,80,0],width:2.5}}:{type:'simple-line',color:[255,80,0,0.9],width:3,style:'dash'}}));res();},rej);});}
            catch(e){console.error('highlightCutGeometry error:',e);}
        }

        // ── Picker hover highlight ────────────────────────────────────────────

        function showPickerHoverHighlight(geometry) {
            clearPickerHoverHighlight();if(!geometry)return;
            const isLine=geometry.type==='polyline';
            const graphic={geometry,symbol:isLine?{type:'simple-line',color:[0,120,255,0.9],width:4,style:'solid'}:{type:'simple-marker',style:'circle',color:[0,120,255,0.3],size:22,outline:{color:[0,80,200,0.9],width:2.5}}};
            mapView.graphics.add(graphic);
            pickerHoverGraphic=mapView.graphics.getItemAt(mapView.graphics.length-1);
        }
        function clearPickerHoverHighlight(){if(pickerHoverGraphic){mapView.graphics.remove(pickerHoverGraphic);pickerHoverGraphic=null;}}

        // ── Copy helpers ──────────────────────────────────────────────────────

        function showCopySnapIndicator(point){hideCopySnapIndicator();if(!point)return;copySnapGraphic={geometry:{type:'point',x:point.x,y:point.y,spatialReference:point.spatialReference},symbol:{type:'simple-marker',style:'cross',color:[50,200,50,0.9],size:14,outline:{color:[255,255,255,1],width:2}}};mapView.graphics.add(copySnapGraphic);}
        function hideCopySnapIndicator(){if(copySnapGraphic){mapView.graphics.remove(copySnapGraphic);copySnapGraphic=null;}}

        async function findCopySnapPoint(screenPoint) {
            if(!snappingEnabled)return null;
            try{const tol=POINT_SNAP_TOLERANCE*(mapView.resolution||1),mp=mapView.toMap(screenPoint);let best=null,bestD=Infinity;const hit=await mapView.hitTest(screenPoint,{include:mapView.map.allLayers.filter(l=>l.type==='feature')});for(const r of hit.results){if(!r.graphic?.geometry)continue;const geom=r.graphic.geometry,candidates=[];if(geom.type==='point')candidates.push({x:geom.x,y:geom.y,spatialReference:geom.spatialReference});else if(geom.type==='polyline')for(const path of geom.paths)for(const v of path)candidates.push({x:v[0],y:v[1],spatialReference:geom.spatialReference});else if(geom.type==='polygon')for(const ring of geom.rings)for(const v of ring)candidates.push({x:v[0],y:v[1],spatialReference:geom.spatialReference});for(const c of candidates){const d=calcDist(mp,c);if(d<bestD&&d<tol){bestD=d;best=c;}}}return best;}
            catch(e){console.error('findCopySnapPoint error:',e);return null;}
        }

        function copyAttributesForNewFeature(feature,layer){const exclude=new Set([(layer.objectIdField||'').toLowerCase(),(layer.globalIdField||'').toLowerCase(),'objectid','globalid','gis_id','gisid','created_date','creation_date','createdate','created_user','creator','createuser','last_edited_date','edit_date','editdate','last_edited_user','editor','edituser']);const out={};for(const [k,v] of Object.entries(feature.attributes))if(!exclude.has(k.toLowerCase()))out[k]=v;return out;}

        async function applyCopyTemplate(feature,layer,cfg){
            let fullFeature=feature;
            try{const oid=feature.attributes?.[layer.objectIdField];if(oid!=null){const res=await layer.queryFeatures({where:`${layer.objectIdField}=${oid}`,outFields:['*'],returnGeometry:true});if(res.features.length>0)fullFeature=res.features[0];}}catch(e){console.warn('applyCopyTemplate:',e);}
            copyTemplateFeature=fullFeature;copyTemplateLayer=layer;copyPlacementMode=true;copiedCount=0;
            if(copyCountInfo)copyCountInfo.textContent='';
            const oid=fullFeature.attributes?.[layer.objectIdField]??'?';
            if(copyTemplateDetails)copyTemplateDetails.innerHTML=`<strong>Layer:</strong> ${cfg.name}<br><strong>OID:</strong> ${oid}<br><strong>Type:</strong> ${fullFeature.geometry?.type??'unknown'}`;
            if(copyTemplateInfo)copyTemplateInfo.style.display='block';
            if(clearCopyTemplateBtn)clearCopyTemplateBtn.disabled=false;
            mapView.container.style.cursor='copy';
            copyMouseMoveHandler=mapView.on('pointer-move',async e=>{if(!copyPlacementMode)return;showCopySnapIndicator(await findCopySnapPoint({x:e.x,y:e.y}));});
            updateStatus(`📋 Template set (${cfg.name} · ${fullFeature.geometry?.type}). Click the map to place copies. ESC to clear.`);
        }

        async function selectCopyTemplate(event){
            const sp={x:event.x,y:event.y};updateStatus('Identifying feature to copy…');
            const candidates=[],seenOids=new Set(),allCfgs=getAllFeatureLayers();
            if(mapView.hitTest){const hit=await mapView.hitTest(sp,{include:mapView.map.allLayers.filter(l=>l.type==='feature')});for(const r of hit.results){if(!r.graphic?.geometry)continue;const cfg=allCfgs.find(c=>c.id===r.layer.layerId);if(!cfg)continue;const oid=getOid(r.graphic);if(oid!=null&&seenOids.has(oid))continue;if(oid!=null)seenOids.add(oid);candidates.push({feature:r.graphic,layer:r.layer,layerConfig:cfg});}}
            if(candidates.length===0){const mp=mapView.toMap(sp),ext=makeExt(mp.x,mp.y,POINT_SNAP_TOLERANCE*(mapView.resolution||1),mapView.spatialReference);for(const cfg of allCfgs){if(!cfg.layer.visible)continue;try{const res=await cfg.layer.queryFeatures({geometry:ext,spatialRelationship:'intersects',returnGeometry:true,outFields:['*'],maxRecordCount:10});for(const f of res.features){if(!f.geometry)continue;const oid=getOid(f);if(oid!=null&&seenOids.has(oid))continue;if(oid!=null)seenOids.add(oid);candidates.push({feature:f,layer:cfg.layer,layerConfig:cfg});}}catch(e){console.error(`selectCopyTemplate fallback on ${cfg.name}:`,e);}}}
            if(candidates.length===0){updateStatus('❌ No feature found at this location.');return;}
            if(candidates.length===1)await applyCopyTemplate(candidates[0].feature,candidates[0].layer,candidates[0].layerConfig);
            else{const rect=mapView.container.getBoundingClientRect();showCopyPickerPopup(candidates,rect.left+sp.x,rect.top+sp.y);updateStatus(`🗂 ${candidates.length} overlapping features. Choose one to use as template.`);}
        }

        let copyPickerPopup=null;
        function dismissCopyPickerPopup(){if(copyPickerPopup){copyPickerPopup.remove();copyPickerPopup=null;}}
        function showCopyPickerPopup(candidates,pageX,pageY){
            dismissCopyPickerPopup();const popup=document.createElement('div');copyPickerPopup=popup;
            popup.style.cssText=`position:fixed;z-index:${z+1};background:#fff;border:1px solid #444;border-radius:4px;box-shadow:0 4px 18px rgba(0,0,0,0.28);font:12px/1.4 Arial,sans-serif;min-width:220px;max-width:300px;max-height:320px;overflow-y:auto;`;
            let left=pageX+12,top=pageY-10;if(left+310>window.innerWidth)left=pageX-310;if(top+340>window.innerHeight)top=window.innerHeight-340-12;if(top<12)top=12;popup.style.left=left+'px';popup.style.top=top+'px';
            const header=document.createElement('div');header.style.cssText='padding:7px 10px 5px;font-weight:bold;font-size:11px;color:#333;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;';header.innerHTML=`<span>📋 ${candidates.length} features — pick template</span>`;
            const closeX=document.createElement('span');closeX.textContent='✕';closeX.style.cssText='cursor:pointer;color:#999;font-size:13px;padding:0 2px;';closeX.onclick=()=>{dismissCopyPickerPopup();updateStatus('📋 Copy mode active. Click a feature to use as template.');};header.appendChild(closeX);popup.appendChild(header);
            const typeIcon=t=>t==='point'?'📍':t==='polyline'?'〰️':'⬡';
            candidates.forEach(c=>{const row=document.createElement('div');row.style.cssText='padding:6px 10px;cursor:pointer;border-bottom:1px solid #f0f0f0;display:flex;flex-direction:column;gap:2px;';row.onmouseenter=()=>row.style.background='#f0fff4';row.onmouseleave=()=>row.style.background='';const oid=getOid(c.feature)??'?',gtype=c.feature.geometry?.type??'unknown',title=document.createElement('div'),meta=document.createElement('div');title.style.cssText='font-weight:bold;color:#2a2a2a;font-size:11px;';title.textContent=`${typeIcon(gtype)} ${c.layerConfig.name}`;meta.style.cssText='color:#888;font-size:10px;';meta.textContent=`OID: ${oid}  ·  ${gtype}`;row.appendChild(title);row.appendChild(meta);row.onclick=async()=>{dismissCopyPickerPopup();await applyCopyTemplate(c.feature,c.layer,c.layerConfig);};popup.appendChild(row);});
            document.body.appendChild(popup);
            setTimeout(()=>{document.addEventListener('click',function outsideClick(e){if(!popup.contains(e.target)){dismissCopyPickerPopup();document.removeEventListener('click',outsideClick);}});},0);
        }

        async function placeCopyFeature(event){
            if(!copyTemplateFeature||!copyPlacementMode||!copyTemplateLayer)return;
            const snapPt=await findCopySnapPoint({x:event.x,y:event.y}),dst=snapPt||mapView.toMap({x:event.x,y:event.y}),tmpl=copyTemplateFeature.geometry;
            let newGeom;
            if(tmpl.type==='point')newGeom={type:'point',x:dst.x,y:dst.y,spatialReference:tmpl.spatialReference||mapView.spatialReference};
            else if(tmpl.type==='polyline'){const first=tmpl.paths[0][0],dx=dst.x-first[0],dy=dst.y-first[1];newGeom={type:'polyline',paths:tmpl.paths.map(p=>p.map(v=>[v[0]+dx,v[1]+dy])),spatialReference:tmpl.spatialReference};}
            else if(tmpl.type==='polygon'){const centroid=calcPolygonCentroid(tmpl.rings[0]),dx=dst.x-centroid.x,dy=dst.y-centroid.y;newGeom={type:'polygon',rings:tmpl.rings.map(r=>r.map(v=>[v[0]+dx,v[1]+dy])),spatialReference:tmpl.spatialReference};}
            else{updateStatus(`❌ Unsupported geometry type: ${tmpl.type}`);return;}
            const attrs=copyAttributesForNewFeature(copyTemplateFeature,copyTemplateLayer);
            try{const tpl=copyTemplateLayer.templates?.[0];if(tpl?.prototype?.attributes)for(const [k,v] of Object.entries(tpl.prototype.attributes))if(!(k in attrs)&&v!=null)attrs[k]=v;}catch{}
            updateStatus('Creating copy…');
            try{const res=await copyTemplateLayer.applyEdits({addFeatures:[{geometry:newGeom,attributes:attrs}]}),r=res.addFeatureResults?.[0];if(r?.objectId||r?.success){copiedCount++;if(copyCountInfo)copyCountInfo.textContent=`✅ ${copiedCount} cop${copiedCount===1?'y':'ies'} created`;updateStatus(`📋 Copy ${copiedCount} placed${snapPt?' (snapped)':''}. Click for more or ESC to clear.`);}else{updateStatus(`❌ Copy failed: ${r?.error?.message||'Unknown error'}`);console.error('placeCopyFeature applyEdits error:',r);}}
            catch(e){console.error('placeCopyFeature error:',e);updateStatus('❌ Error placing copy.');}
        }

        function clearCopyTemplate(){copyTemplateFeature=null;copyTemplateLayer=null;copyPlacementMode=false;copiedCount=0;if(copyMouseMoveHandler){copyMouseMoveHandler.remove();copyMouseMoveHandler=null;}hideCopySnapIndicator();if(copyTemplateInfo)copyTemplateInfo.style.display='none';if(copyCountInfo)copyCountInfo.textContent='';if(clearCopyTemplateBtn)clearCopyTemplateBtn.disabled=true;mapView.container.style.cursor='crosshair';if(copyMode)updateStatus('📋 Copy mode active. Click any feature on the map as a template.');}
        function enableCopyMode(){copyMode=true;copyModeBtn.style.background='#1a4d1a';copyModeBtn.textContent='📋 Disable Copy Mode';[pointModeBtn,lineModeBtn,addVertexBtn,deleteVertexBtn].forEach(b=>{if(b)b.style.opacity='0.45';});copyKeyHandler=e=>{if(e.key==='Escape'&&copyPlacementMode)clearCopyTemplate();};document.addEventListener('keydown',copyKeyHandler);updateStatus('📋 Copy mode active. Click any feature on the map as a template.');}
        function disableCopyMode(){copyMode=false;clearCopyTemplate();dismissCopyPickerPopup();copyModeBtn.style.background='#2e7d32';copyModeBtn.textContent='📋 Enable Copy Mode';[pointModeBtn,lineModeBtn,addVertexBtn,deleteVertexBtn].forEach(b=>{if(b)b.style.opacity='1';});if(copyKeyHandler){document.removeEventListener('keydown',copyKeyHandler);copyKeyHandler=null;}updateStatus(toolActive?`Ready. Click a ${currentMode==='point'?'point feature':'line vertex'}.`:'Tool disabled.');}
        async function handleCopyClick(event){if(!copyPlacementMode)await selectCopyTemplate(event);else await placeCopyFeature(event);}

        // ── Snap-to-Point ─────────────────────────────────────────────────────

        async function findLinesNearPoint(sp,polePt) {
            const buf=CUT_TOLERANCE_M,found=[],seenOids=new Set();
            if(lockedFeature?.featureType==='line'){await refreshLockedFeature();found.push({feature:lockedFeature.feature,layer:lockedFeature.layer,layerConfig:lockedFeature.layerConfig});return found;}
            if(mapView.hitTest&&sp){try{const hit=await mapView.hitTest(sp,{include:mapView.map.allLayers.filter(l=>l.type==='feature')});for(const r of hit.results){if(r.graphic?.geometry?.type!=='polyline')continue;const cfg=lineLayers.find(l=>l.id===r.layer.layerId);if(!cfg)continue;const oid=getOid(r.graphic);if(oid!=null&&seenOids.has(oid))continue;if(oid!=null)seenOids.add(oid);found.push({feature:r.graphic,layer:r.layer,layerConfig:cfg});}}catch(e){console.error('findLinesNearPoint hitTest error:',e);}}
            const bufGeom={type:'polygon',spatialReference:mapView.spatialReference,rings:[[[polePt.x-buf,polePt.y-buf],[polePt.x+buf,polePt.y-buf],[polePt.x+buf,polePt.y+buf],[polePt.x-buf,polePt.y+buf],[polePt.x-buf,polePt.y-buf]]]};
            for(const cfg of lineLayers){if(!cfg.layer.visible)continue;try{const res=await cfg.layer.queryFeatures({geometry:bufGeom,spatialRelationship:'intersects',returnGeometry:true,outFields:['*'],maxRecordCount:50});for(const f of res.features){const oid=getOid(f);if(oid!=null&&seenOids.has(oid))continue;if(oid!=null)seenOids.add(oid);found.push({feature:f,layer:cfg.layer,layerConfig:cfg});}}catch(e){console.error(`findLinesNearPoint buffer error on ${cfg.name}:`,e);}}
            return found;
        }

        async function handleSnapToPointClick(event) {
            const sp={x:event.x,y:event.y},mp=mapView.toMap(sp);
            updateStatus('🧲 Finding nearest point feature...');
            const poleResult=await findNearestPointFeature(mp);
            if(!poleResult){updateStatus('❌ No point feature found within snap tolerance. Click closer to a pole or point.');return;}
            const polePt={x:poleResult.geometry.x,y:poleResult.geometry.y};
            updateStatus(`📍 Found ${poleResult.layerConfig.name}. Snapping nearby lines...`);
            const lines=await findLinesNearPoint(sp,polePt);
            if(!lines.length){updateStatus(`❌ No lines found near this point. Try clicking directly on a line or closer to one.`);return;}
            const updates=[]; let alreadySnapped=0;
            const alreadyThreshold=mapView.resolution||1;
            for(const li of lines){
                try{
                    const seg=findClosestSeg(li.feature.geometry,polePt);if(!seg)continue;
                    const existing=findAbsoluteClosestVertex(li.feature.geometry,polePt);
                    if(existing&&existing.distance<alreadyThreshold){alreadySnapped++;continue;}
                    const newPaths=clonePaths(li.feature.geometry);
                    newPaths[seg.pathIndex].splice(seg.insertIndex,0,[polePt.x,polePt.y]);
                    const newGeom=buildPolyline(li.feature.geometry,newPaths),upd=li.feature.clone();upd.geometry=newGeom;upd.attributes.calculated_length=geodeticLength(newGeom);
                    updates.push({layer:li.layer,feature:upd,layerName:li.layerConfig.name});
                }catch(e){console.error(`handleSnapToPointClick prep error on ${li.layerConfig.name}:`,e);}
            }
            if(!updates.length){updateStatus(alreadySnapped>0?`✅ Line(s) already snapped to ${poleResult.layerConfig.name}.`:'❌ Could not snap any lines to this point.');return;}
            for(const u of updates)if(u.layer.applyEdits)await u.layer.applyEdits({updateFeatures:[u.feature]});
            const skipMsg=alreadySnapped>0?` · ${alreadySnapped} already snapped`:'';
            updateStatus(`✅ Snapped ${updates.length} line(s) to ${poleResult.layerConfig.name}${skipMsg}!`);
            if(lockedFeature)await refreshLockedFeature();if(vertexHighlightActive)scheduleHighlightRefresh();
            setTimeout(()=>updateStatus('🧲 Snap to Point active. Click near a point feature to snap lines to it.'),3000);
        }

        function enableSnapToPointMode(){if(cutMode)disableCutMode();if(copyMode)disableCopyMode();snapToPointMode=true;if(snapToPointModeBtn){snapToPointModeBtn.style.background='#7b2d8b';snapToPointModeBtn.textContent='🧲 Snap to Point [S] — Active';}[pointModeBtn,lineModeBtn,addVertexBtn,deleteVertexBtn].forEach(b=>{if(b)b.style.opacity='0.45';});if(toolActive)updateStatus('🧲 Snap to Point active. Click near any point feature to snap all lines within 15 ft to it.');}
        function disableSnapToPointMode(){snapToPointMode=false;if(snapToPointModeBtn){snapToPointModeBtn.style.background='#666';snapToPointModeBtn.textContent='🧲 Snap to Point [S]';}[pointModeBtn,lineModeBtn,addVertexBtn,deleteVertexBtn].forEach(b=>{if(b)b.style.opacity='1';});if(toolActive)updateStatus(`Ready. Click a ${currentMode==='point'?'point feature':'line vertex'}.`);}

        // ── Hotkeys ───────────────────────────────────────────────────────────

        function handleHotkey(e) {
            if(!toolActive)return;
            const tag=e.target.tagName;
            if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||e.target.isContentEditable)return;
            switch(e.key){
                case 'e':case 'E': e.preventDefault();if(!cutMode&&!copyMode&&!snapToPointMode)setPointMode();break;
                case 'q':case 'Q': e.preventDefault();if(!cutMode&&!copyMode&&!snapToPointMode)setLineMode();break;
                case 'a':case 'A': e.preventDefault();if(!cutMode&&!copyMode&&!snapToPointMode)setAddVertexMode();break;
                case 'd':case 'D': e.preventDefault();if(!cutMode&&!copyMode&&!snapToPointMode)setDeleteVertexMode();break;
                case 's':case 'S': e.preventDefault();snapToPointMode?disableSnapToPointMode():enableSnapToPointMode();break;
                case 'c':case 'C': e.preventDefault();cutMode?disableCutMode():enableCutMode();break;
                case 'Escape':
                    e.preventDefault();
                    if(copyPlacementMode)clearCopyTemplate();
                    else if(cutPreviewMode)resetCutSelection();
                    else if(snapToPointMode)disableSnapToPointMode();
                    else if(selectedFeature)cancelMove();
                    break;
            }
        }

        // ── Cut context menu ──────────────────────────────────────────────────

        function showCutContextMenu(mapPoint){const screen=mapView.toScreen(mapPoint),rect=mapView.container.getBoundingClientRect();let left=rect.left+screen.x+14,top=rect.top+screen.y-10;if(left+220>window.innerWidth)left=rect.left+screen.x-220;if(top+280>window.innerHeight)top=window.innerHeight-280;cutCtxMenu.style.left=left+'px';cutCtxMenu.style.top=top+'px';cutCtxMenu.style.display='block';}
        function hideCutContextMenu(){cutCtxMenu.style.display='none';}

        async function findNearbyLinesForCut(pointGeom){const buf=CUT_TOLERANCE_M,{x,y}=pointGeom,bufGeom={type:'polygon',spatialReference:pointGeom.spatialReference,rings:[[[x-buf,y-buf],[x+buf,y-buf],[x+buf,y+buf],[x-buf,y+buf],[x-buf,y-buf]]]},found=[];for(const cfg of lineLayers){if(!cfg.layer.visible)continue;try{const res=await cfg.layer.queryFeatures({geometry:bufGeom,spatialRelationship:'intersects',returnGeometry:true,outFields:['*'],maxRecordCount:100});for(const f of res.features){const cutInfo=findCutInfo(f.geometry,{x,y});if(cutInfo&&cutInfo.dist<=buf)found.push({feature:f,layer:cfg.layer,layerConfig:cfg,cutInfo});}}catch(e){console.error(`findNearbyLinesForCut error on ${cfg.name}:`,e);}}return found;}

        async function showCutPreview(){
            if(!cutLinesToCut.length){updateStatus(`❌ No lines found within ${Math.round(CUT_TOLERANCE_M*3.28084)} ft of the point.`);resetCutSelection();return;}
            cutPreviewMode=true;cutSelectedIndices=new Set(cutLinesToCut.map((_,i)=>i));
            let GraphicClass=null;
            try{GraphicClass=await new Promise((res,rej)=>{if(typeof require!=='undefined')require(['esri/Graphic'],G=>res(G),rej);else rej(new Error('require not found'));});}catch(e){console.error('showCutPreview: could not load esri/Graphic:',e);}
            await ensureCutGraphicsLayer();cutGraphicMap.clear();if(cutGraphicsLayer)cutGraphicsLayer.removeAll();
            const selSym={type:'simple-line',color:[220,53,69,0.95],width:3,style:'dash'},hovSym={type:'simple-line',color:[255,140,0,1],width:4,style:'solid'};
            for(let i=0;i<cutLinesToCut.length;i++){if(GraphicClass&&cutGraphicsLayer){const g=new GraphicClass({geometry:cutLinesToCut[i].feature.geometry,symbol:selSym});cutGraphicsLayer.add(g);cutGraphicMap.set(i,g);}else await highlightCutGeometry(cutLinesToCut[i].feature.geometry,false);}
            const listEl=cutCtxMenu.querySelector('#cutCtxList');listEl.innerHTML='';
            for(let i=0;i<cutLinesToCut.length;i++){const li=cutLinesToCut[i],oid=getOid(li.feature)??'?',vtx=(li.feature.geometry?.paths??[]).reduce((s,p)=>s+p.length,0),row=document.createElement('label');row.style.cssText='display:flex;align-items:flex-start;gap:6px;padding:6px 10px;cursor:pointer;border-bottom:1px solid #f0f0f0;user-select:none;';const cb=document.createElement('input');cb.type='checkbox';cb.checked=true;cb.dataset.idx=String(i);cb.style.cssText='margin-top:2px;cursor:pointer;flex-shrink:0;';const info=document.createElement('div');info.style.cssText='flex:1;font-size:11px;line-height:1.4;';info.innerHTML=`<strong style="color:#2a2a2a;">${li.layerConfig.name}</strong><div style="color:#888;font-size:10px;">OID: ${oid} · ${vtx} vertices</div>`;const dot=document.createElement('span');dot.textContent='●';dot.style.cssText='color:#dc3545;font-size:14px;flex-shrink:0;margin-top:1px;';cb.addEventListener('change',()=>{const idx=parseInt(cb.dataset.idx),g=cutGraphicMap.get(idx);if(cb.checked){cutSelectedIndices.add(idx);dot.style.color='#dc3545';if(g&&cutGraphicsLayer)cutGraphicsLayer.add(g);}else{cutSelectedIndices.delete(idx);dot.style.color='#bbb';if(g&&cutGraphicsLayer)cutGraphicsLayer.remove(g);}updateCutExecuteBtn();});row.addEventListener('mouseenter',()=>{const g=cutGraphicMap.get(i);if(g&&cutSelectedIndices.has(i))g.symbol=hovSym;row.style.background='#fff5ee';});row.addEventListener('mouseleave',()=>{const g=cutGraphicMap.get(i);if(g&&cutSelectedIndices.has(i))g.symbol=selSym;row.style.background='';});row.appendChild(cb);row.appendChild(info);row.appendChild(dot);listEl.appendChild(row);}
            const selectAllBtn=cutCtxMenu.querySelector('#cutCtxSelectAll');if(selectAllBtn){selectAllBtn.onclick=()=>{const allOn=cutSelectedIndices.size===cutLinesToCut.length;[...listEl.querySelectorAll('label')].forEach((row,i)=>{const cb=row.querySelector('input'),dot=row.querySelector('span'),g=cutGraphicMap.get(i),was=cutSelectedIndices.has(i);cb.checked=!allOn;if(!allOn&&!was){cutSelectedIndices.add(i);if(dot)dot.style.color='#dc3545';if(g&&cutGraphicsLayer)cutGraphicsLayer.add(g);}else if(allOn&&was){cutSelectedIndices.delete(i);if(dot)dot.style.color='#bbb';if(g&&cutGraphicsLayer)cutGraphicsLayer.remove(g);}});selectAllBtn.textContent=allOn?'✓ All':'✗ None';updateCutExecuteBtn();};}
            cutCtxMenu.querySelector('#cutCtxCount').textContent=cutLinesToCut.length;
            updateCutExecuteBtn();showCutContextMenu(cutSelectedPoint.geometry);
            updateStatus(`✂️ ${cutLinesToCut.length} line(s) found. Check/uncheck lines to cut, then confirm.`);
        }

        function updateCutExecuteBtn(){const btn=cutCtxMenu.querySelector('#cutCtxExecute');if(!btn||cutProcessing)return;const n=cutSelectedIndices.size;btn.textContent=`✂ Execute Cut (${n})`;btn.disabled=n===0;}

        async function executeCut(){
            const selectedLines=cutLinesToCut.filter((_,i)=>cutSelectedIndices.has(i));
            if(!selectedLines.length||cutProcessing)return;
            cutProcessing=true;
            cutCtxMenu.querySelector('#cutCtxExecute').disabled=true;
            cutCtxMenu.querySelector('#cutCtxCancel').disabled=true;
            updateStatus('Cutting lines…');
            const snapPt={x:cutSelectedPoint.geometry.x,y:cutSelectedPoint.geometry.y};
            const undoBatch={ts:new Date(),ops:[]};let ok=0,fail=0;
            for(const li of selectedLines){
                try{
                    const split=splitLine(li.feature.geometry,li.cutInfo,snapPt);
                    if(!split){fail++;continue;}
                    const{seg1,seg2}=split;
                    const updFeature=li.feature.clone();updFeature.geometry=seg1;updFeature.attributes.calculated_length=geodeticLength(seg1);
                    const newAttrs={...li.feature.attributes};
                    ['objectid','OBJECTID','gis_id','GIS_ID','globalid','GLOBALID','created_date','last_edited_date'].forEach(f=>delete newAttrs[f]);
                    newAttrs.calculated_length=geodeticLength(seg2);
                    const res=await li.layer.applyEdits({updateFeatures:[updFeature],addFeatures:[{geometry:seg2,attributes:newAttrs}]});
                    const updErr=res.updateFeatureResults?.[0]?.error,addErr=res.addFeatureResults?.[0]?.error;
                    if(!updErr&&!addErr){undoBatch.ops.push({layer:li.layer,layerName:li.layerConfig.name,originalFeat:li.feature.clone(),addedOID:res.addFeatureResults[0].objectId});ok++;}
                    else{console.error('executeCut error – update:',updErr,'add:',addErr);fail++;}
                }catch(e){console.error(`executeCut error (${li.layerConfig.name}):`,e);fail++;}
            }
            if(undoBatch.ops.length){undoStack.push(undoBatch);cutUndoBtn.disabled=false;}
            updateStatus(ok?`✅ ${ok} line(s) cut${fail?` · ${fail} failed`:''}.`:`❌ All ${fail} cut(s) failed.`);
            cutProcessing=false;
            cutCtxMenu.querySelector('#cutCtxExecute').disabled=false;
            cutCtxMenu.querySelector('#cutCtxCancel').disabled=false;
            hideCutContextMenu();setTimeout(resetCutSelection,3000);
        }

        async function undoLastCut(){if(!undoStack.length||cutProcessing)return;cutProcessing=true;updateStatus('Undoing last cut…');const batch=undoStack.pop();let ok=0,fail=0;for(const op of batch.ops){try{const res=await op.layer.applyEdits({updateFeatures:[op.originalFeat],deleteFeatures:[{objectId:op.addedOID}]});const updErr=res.updateFeatureResults?.[0]?.error,delErr=res.deleteFeatureResults?.[0]?.error;if(!updErr&&!delErr)ok++;else{console.error('undoLastCut error:',updErr,delErr);fail++;}}catch(e){console.error(`undoLastCut error (${op.layerName}):`,e);fail++;}}if(!undoStack.length)cutUndoBtn.disabled=true;updateStatus(`↩ Undo: ${ok} line(s) restored${fail?`, ${fail} failed`:''}.`);cutProcessing=false;setTimeout(()=>{if(cutMode)updateStatus('✂️ Cut mode active. Click a point feature.');},3000);}

        async function handleCutClick(event){
            if(cutPreviewMode||cutProcessing)return;clearCutHighlights();hideCutContextMenu();updateStatus('Searching for point feature…');
            const sp={x:event.x,y:event.y},mp=mapView.toMap(sp),ext=makeExt(mp.x,mp.y,POINT_SNAP_TOLERANCE*(mapView.resolution||1),mapView.spatialReference);
            let ptResult=null;
            if(mapView.hitTest){const hit=await mapView.hitTest(sp,{include:mapView.map.allLayers.filter(l=>l.type==='feature')});for(const r of hit.results){if(r.graphic?.geometry?.type==='point'){const cfg=pointLayers.find(p=>p.id===r.layer.layerId);if(cfg){ptResult={feature:r.graphic,layer:r.layer,layerConfig:cfg};break;}}}}
            if(!ptResult){for(const cfg of pointLayers){if(!cfg.layer.visible)continue;try{const res=await cfg.layer.queryFeatures({geometry:ext,spatialRelationship:'intersects',returnGeometry:true,outFields:['*']});let best=null,bestD=Infinity;for(const f of res.features){if(!f.geometry)continue;const d=calcDist(mp,f.geometry);if(d<bestD){bestD=d;best=f;}}if(best){ptResult={feature:best,layer:cfg.layer,layerConfig:cfg};break;}}catch(e){console.error(`handleCutClick error on ${cfg.name}:`,e);}}}
            if(!ptResult){updateStatus('❌ No point feature found. Click closer to a point.');return;}
            cutSelectedPoint=ptResult.feature;cutSelectedPointLayer=ptResult.layer;
            await highlightCutGeometry(cutSelectedPoint.geometry,true);
            updateStatus(`📍 ${ptResult.layerConfig.name} selected. Searching for nearby lines…`);
            cutLinesToCut=await findNearbyLinesForCut(cutSelectedPoint.geometry);showCutPreview();
        }

        function resetCutSelection(){cutSelectedPoint=null;cutSelectedPointLayer=null;cutLinesToCut=[];cutPreviewMode=false;cutSelectedIndices.clear();cutGraphicMap.clear();clearCutHighlights();hideCutContextMenu();if(cutMode)updateStatus('✂️ Cut mode active. Click a point feature to cut nearby lines.');}
        function enableCutMode(){if(snapToPointMode)disableSnapToPointMode();if(copyMode)disableCopyMode();cutMode=true;cutModeBtn.style.background='#c0392b';cutModeBtn.textContent='✂️ Cut Mode [C] — Active';if(cutModeInfo)cutModeInfo.textContent='Cut mode active — move/vertex tools suspended.';[pointModeBtn,lineModeBtn,addVertexBtn,deleteVertexBtn].forEach(b=>{if(b)b.style.opacity='0.45';});updateStatus('✂️ Cut mode active. Click a point feature to cut nearby lines.');}
        function disableCutMode(){cutMode=false;cutPreviewMode=false;cutProcessing=false;resetCutSelection();cutModeBtn.style.background='#e67e00';cutModeBtn.textContent='✂️ Cut Mode [C]';if(cutModeInfo)cutModeInfo.textContent='';[pointModeBtn,lineModeBtn,addVertexBtn,deleteVertexBtn].forEach(b=>{if(b)b.style.opacity='1';});updateStatus(toolActive?`Ready. Click a ${currentMode==='point'?'point feature':'line vertex'}.`:'Tool disabled.');}

        // ── Feature picker popup ──────────────────────────────────────────────

        function dismissPickerPopup(){if(pickerPopup){pickerPopup.remove();pickerPopup=null;}clearPickerHoverHighlight();}
        function showFeaturePickerPopup(candidates,pageX,pageY){
            dismissPickerPopup();const popup=document.createElement("div");pickerPopup=popup;
            popup.style.cssText=`position:fixed;z-index:${z+1};background:#fff;border:1px solid #444;border-radius:4px;box-shadow:0 4px 18px rgba(0,0,0,0.28);font:12px/1.4 Arial,sans-serif;min-width:220px;max-width:300px;max-height:320px;overflow-y:auto;`;
            let left=pageX+12,top=pageY-10;if(left+310>window.innerWidth)left=pageX-310;if(top+340>window.innerHeight)top=window.innerHeight-340-12;if(top<12)top=12;popup.style.left=left+"px";popup.style.top=top+"px";
            const header=document.createElement("div");header.style.cssText="padding:7px 10px 5px;font-weight:bold;font-size:11px;color:#333;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;";header.innerHTML=`<span>🗂 ${candidates.length} overlapping features</span>`;
            const closeX=document.createElement("span");closeX.textContent="✕";closeX.style.cssText="cursor:pointer;color:#999;font-size:13px;padding:0 2px;";closeX.onclick=()=>{dismissPickerPopup();pickingFeatureMode=false;lockFeatureBtn.style.background=lockedFeature?"#6f42c1":"#666";lockFeatureBtn.textContent=lockedFeature?"🎯 Re-Pick":"🎯 Pick Feature";updateStatus(lockedFeature?`🔒 Locked: ${lockedFeature.layerConfig.name}.`:"Pick cancelled.");};header.appendChild(closeX);popup.appendChild(header);
            candidates.forEach(c=>{const row=document.createElement("div");row.style.cssText="padding:6px 10px;cursor:pointer;border-bottom:1px solid #f0f0f0;display:flex;flex-direction:column;gap:2px;";row.onmouseenter=()=>{row.style.background="#f0f4ff";showPickerHoverHighlight(c.feature.geometry);};row.onmouseleave=()=>{row.style.background="";clearPickerHoverHighlight();};const oid=getOid(c.feature)??"?",typeIcon=c.featureType==='point'?'📍':'〰️',title=document.createElement("div"),meta=document.createElement("div");title.style.cssText="font-weight:bold;color:#2a2a2a;font-size:11px;";title.textContent=`${typeIcon} ${c.layerConfig.name}`;meta.style.cssText="color:#888;font-size:10px;";if(c.featureType==='line'){const vtxCount=(c.feature.geometry?.paths??[]).reduce((s,p)=>s+p.length,0),paths=(c.feature.geometry?.paths??[]).length;meta.textContent=`OID: ${oid}  ·  ${vtxCount} vertices  ·  ${paths} path(s)`;}else meta.textContent=`OID: ${oid}  ·  Point feature`;row.appendChild(title);row.appendChild(meta);row.onclick=()=>{dismissPickerPopup();applyLock(c.feature,c.layer,c.layerConfig,c.featureType);};popup.appendChild(row);});
            document.body.appendChild(popup);
            setTimeout(()=>{document.addEventListener("click",function outsideClick(e){if(!popup.contains(e.target)){dismissPickerPopup();document.removeEventListener("click",outsideClick);}});},0);
        }

        // ── Locked feature helpers ────────────────────────────────────────────

        const getOid = f => f?.attributes?.objectid ?? f?.attributes?.OBJECTID ?? null;
        async function refreshLockedFeature(){if(!lockedFeature)return;try{const oid=getOid(lockedFeature.feature);if(oid==null)return;const res=await lockedFeature.layer.queryFeatures({where:`objectid=${oid}`,returnGeometry:true,outFields:["*"]});if(res.features.length>0)lockedFeature.feature=res.features[0];}catch(e){console.error("refreshLockedFeature error:",e);}}

        async function applyLock(feature,layer,cfg,featureType='line'){
            lockedFeature={feature,layer,layerConfig:cfg,featureType};pickingFeatureMode=false;
            if(lockFeatureBtn){lockFeatureBtn.style.background="#6f42c1";lockFeatureBtn.textContent="🎯 Re-Pick";}
            if(releaseFeatureBtn)releaseFeatureBtn.disabled=false;
            if(lockedFeatureInfo)lockedFeatureInfo.textContent=`Locked: ${cfg.name} (OID: ${getOid(feature)??"?"}) [${featureType==='point'?'📍 point':'〰️ line'}]`;
            if(vertexHighlightActive)scheduleHighlightRefresh();
            if(featureType==='line'){setLineMode();updateStatus(`🔒 Locked to ${cfg.name}. Click any vertex to select it, then click the destination.`);}
            else{setPointMode();if(toolActive){selectedFeature=feature;selectedLayer=layer;selectedLayerConfig=cfg;selectedVertex=null;waitingForDestination=true;if(feature.geometry?.clone)originalGeometries.set(getOid(feature)?? 'locked',feature.geometry.clone());if(cancelBtn)cancelBtn.disabled=false;connectedFeatures=await findConnectedLines(feature.geometry);updateStatus(`🔒 Locked to ${cfg.name}. Click the destination to move it (${connectedFeatures.length} connected line(s)).`);}else updateStatus(`🔒 Locked to ${cfg.name}. Enable the tool then click the destination.`);}
        }

        function releaseLockedFeature(){dismissPickerPopup();lockedFeature=null;pickingFeatureMode=false;if(lockFeatureBtn){lockFeatureBtn.style.background="#666";lockFeatureBtn.textContent="🎯 Pick Feature";}if(releaseFeatureBtn)releaseFeatureBtn.disabled=true;if(lockedFeatureInfo)lockedFeatureInfo.textContent="";if(vertexHighlightActive)scheduleHighlightRefresh();updateStatus(toolActive?`Feature released. Click on a ${currentMode==="point"?"point feature":"line vertex"} to select it.`:"Feature released.");}

        async function pickFeature(event){
            const sp={x:event.x,y:event.y};updateStatus("Looking for feature...");
            try{const candidates=[],seenOids=new Set();if(mapView.hitTest){const hit=await mapView.hitTest(sp,{include:mapView.map.allLayers.filter(l=>l.type==="feature")});for(const r of hit.results){const gtype=r.graphic?.geometry?.type;if(gtype==="polyline"){const cfg=lineLayers.find(l=>l.id===r.layer.layerId);if(!cfg)continue;const oid=getOid(r.graphic);if(oid!=null&&seenOids.has(oid))continue;if(oid!=null)seenOids.add(oid);candidates.push({feature:r.graphic,layer:r.layer,layerConfig:cfg,featureType:'line'});}else if(gtype==="point"||gtype==="multipoint"){const cfg=pointLayers.find(p=>p.id===r.layer.layerId);if(!cfg)continue;const oid=getOid(r.graphic);if(oid!=null&&seenOids.has(oid))continue;if(oid!=null)seenOids.add(oid);candidates.push({feature:r.graphic,layer:r.layer,layerConfig:cfg,featureType:'point'});}}}
            if(candidates.length===0){const mp=mapView.toMap(sp),ext=makeExt(mp.x,mp.y,30,mapView.spatialReference);for(const cfg of lineLayers){if(!cfg.layer.visible)continue;const res=await cfg.layer.queryFeatures({geometry:ext,spatialRelationship:"intersects",returnGeometry:true,outFields:["*"],maxRecordCount:20});for(const f of res.features){const oid=getOid(f);if(oid!=null&&seenOids.has(oid))continue;if(oid!=null)seenOids.add(oid);candidates.push({feature:f,layer:cfg.layer,layerConfig:cfg,featureType:'line'});}}for(const cfg of pointLayers){if(!cfg.layer.visible)continue;const res=await cfg.layer.queryFeatures({geometry:ext,spatialRelationship:"intersects",returnGeometry:true,outFields:["*"],maxRecordCount:20});for(const f of res.features){const oid=getOid(f);if(oid!=null&&seenOids.has(oid))continue;if(oid!=null)seenOids.add(oid);candidates.push({feature:f,layer:cfg.layer,layerConfig:cfg,featureType:'point'});}}}
            if(candidates.length===0){updateStatus("❌ No feature found. Click directly on a point or line feature.");return;}
            if(candidates.length===1)applyLock(candidates[0].feature,candidates[0].layer,candidates[0].layerConfig,candidates[0].featureType);
            else{const rect=mapView.container.getBoundingClientRect();showFeaturePickerPopup(candidates,rect.left+sp.x,rect.top+sp.y);updateStatus(`🗂 ${candidates.length} overlapping features found. Choose one from the menu.`);}
            }catch(e){console.error("pickFeature error:",e);updateStatus("❌ Error picking feature.");}
        }

        // ── Layer query helpers ───────────────────────────────────────────────

        async function findNearestPointFeature(mapPt){try{const tol=POINT_SNAP_TOLERANCE*(mapView.resolution||1),ext=makeExt(mapPt.x,mapPt.y,tol,mapView.spatialReference);let nearest=null,minD=Infinity;for(const cfg of pointLayers){if(!cfg.layer.visible)continue;try{const res=await cfg.layer.queryFeatures({geometry:ext,spatialRelationship:"intersects",returnGeometry:true,outFields:["*"]});for(const f of res.features){if(!f.geometry)continue;const d=calcDist(mapPt,f.geometry);if(d<minD){minD=d;nearest={feature:f,layer:cfg.layer,layerConfig:cfg,distance:d,geometry:f.geometry};}}}catch(e){console.error(`findNearestPointFeature error on ${cfg.name}:`,e);}}return(nearest&&nearest.distance<tol)?nearest:null;}catch(e){console.error("findNearestPointFeature error:",e);return null;}}
        async function findNearestLineVertex(dst,excludeOids=new Set()){try{const tol=POINT_SNAP_TOLERANCE*(mapView.resolution||1),ext=makeExt(dst.x,dst.y,tol,mapView.spatialReference);let nearest=null,minD=Infinity,nearestCfg=null;for(const cfg of lineLayers){if(!cfg.layer.visible)continue;try{const res=await cfg.layer.queryFeatures({geometry:ext,spatialRelationship:"intersects",returnGeometry:true,outFields:["objectid"],outSpatialReference:mapView.spatialReference});for(const f of res.features){if(excludeOids.has(getOid(f)))continue;if(!f.geometry?.paths)continue;for(const path of f.geometry.paths){for(const coord of path){const d=calcDist(dst,{x:coord[0],y:coord[1]});if(d<minD){minD=d;nearest={x:coord[0],y:coord[1],spatialReference:dst.spatialReference};nearestCfg=cfg;}}}}}catch(e){console.error(`findNearestLineVertex error on ${cfg.name}:`,e);}}return(nearest&&minD<tol)?{geometry:nearest,layerConfig:nearestCfg,snapType:'lineVertex'}:null;}catch(e){console.error("findNearestLineVertex error:",e);return null;}}
        async function findSnapTarget(dst,excludeOids=new Set()){const[ps,vs]=await Promise.all([findNearestPointFeature(dst),findNearestLineVertex(dst,excludeOids)]);if(!ps&&!vs)return null;if(ps&&!vs)return{...ps,snapType:'pointFeature'};if(!ps&&vs)return vs;return calcDist(dst,ps.geometry)<=calcDist(dst,vs.geometry)?{...ps,snapType:'pointFeature'}:vs;}
        async function findPointFeatureAtLocation(sp){try{if(mapView.hitTest){const hit=await mapView.hitTest(sp,{include:mapView.map.allLayers.filter(l=>l.type==="feature")});for(const r of hit.results)if(r.graphic?.geometry?.type==="point"){const cfg=pointLayers.find(p=>p.id===r.layer.layerId);if(cfg)return{feature:r.graphic,layer:r.layer,layerConfig:cfg};}}const mp=mapView.toMap(sp),tol=SNAP_TOLERANCE*(mapView.resolution||1),ext=makeExt(mp.x,mp.y,tol,mapView.spatialReference);for(const cfg of pointLayers){if(!cfg.layer.visible)continue;try{const res=await cfg.layer.queryFeatures({geometry:ext,spatialRelationship:"intersects",returnGeometry:true,outFields:["*"]});if(res.features.length>0){let best=null,bestD=Infinity;for(const f of res.features){if(!f.geometry)continue;const d=calcDist(mp,f.geometry);if(d<bestD){bestD=d;best=f;}}if(best)return{feature:best,layer:cfg.layer,layerConfig:cfg};}}catch(e){console.error(`findPointFeatureAtLocation error on ${cfg.name}:`,e);}}}catch(e){console.error("findPointFeatureAtLocation error:",e);}return null;}
        async function findCoincidentLinesForVertexCreation(sp,mp){try{const bufM=10/3.28084,lines=[];if(lockedFeature?.featureType==='line'){await refreshLockedFeature();const seg=findClosestSeg(lockedFeature.feature.geometry,mp);if(seg&&seg.distance<=bufM)lines.push({feature:lockedFeature.feature,layer:lockedFeature.layer,layerConfig:lockedFeature.layerConfig,segmentInfo:seg});return lines;}if(mapView.hitTest){const hit=await mapView.hitTest(sp,{include:mapView.map.allLayers.filter(l=>l.type==="feature")});for(const r of hit.results)if(r.graphic?.geometry?.type==="polyline"){const cfg=lineLayers.find(l=>l.id===r.layer.layerId);if(cfg){const seg=findClosestSeg(r.graphic.geometry,mp);if(seg&&seg.distance<=bufM)lines.push({feature:r.graphic,layer:r.layer,layerConfig:cfg,segmentInfo:seg});}}}if(lines.length===0){for(const cfg of lineLayers){if(!cfg.layer.visible)continue;try{const buf={type:"polygon",spatialReference:mp.spatialReference,rings:[[[mp.x-bufM,mp.y-bufM],[mp.x+bufM,mp.y-bufM],[mp.x+bufM,mp.y+bufM],[mp.x-bufM,mp.y+bufM],[mp.x-bufM,mp.y-bufM]]]};const res=await cfg.layer.queryFeatures({geometry:buf,spatialRelationship:"intersects",returnGeometry:true,outFields:["*"],maxRecordCount:50});for(const f of res.features){const seg=findClosestSeg(f.geometry,mp);if(seg&&seg.distance<=bufM)lines.push({feature:f,layer:cfg.layer,layerConfig:cfg,segmentInfo:seg});}}catch(e){console.error(`findCoincidentLines error on ${cfg.name}:`,e);}}}return lines;}catch(e){console.error("findCoincidentLinesForVertexCreation error:",e);return[];}}
        async function findCoincidentLineVertices(sp){try{const clickPt=mapView.toMap(sp),snapTol=POINT_SNAP_TOLERANCE*(mapView.resolution||1),lines=[];if(lockedFeature?.featureType==='line'){await refreshLockedFeature();const v=findClosestVertex(lockedFeature.feature.geometry,clickPt);if(v&&v.distance<snapTol)lines.push({feature:lockedFeature.feature,layer:lockedFeature.layer,layerConfig:lockedFeature.layerConfig,vertex:v});return lines;}if(mapView.hitTest){const hit=await mapView.hitTest(sp,{include:mapView.map.allLayers.filter(l=>l.type==="feature")});for(const r of hit.results)if(r.graphic?.geometry?.type==="polyline"){const cfg=lineLayers.find(l=>l.id===r.layer.layerId);if(cfg){const v=findClosestVertex(r.graphic.geometry,clickPt);if(v&&v.distance<snapTol)lines.push({feature:r.graphic,layer:r.layer,layerConfig:cfg,vertex:v});}}}if(lines.length===0){const ext=makeExt(clickPt.x,clickPt.y,snapTol,mapView.spatialReference);for(const cfg of lineLayers){if(!cfg.layer.visible)continue;try{const res=await cfg.layer.queryFeatures({geometry:ext,spatialRelationship:"intersects",returnGeometry:true,outFields:["*"],maxRecordCount:50});for(const f of res.features){const v=findClosestVertex(f.geometry,clickPt);if(v&&v.distance<snapTol)lines.push({feature:f,layer:cfg.layer,layerConfig:cfg,vertex:v});}}catch(e){console.error(`findCoincidentLineVertices error on ${cfg.name}:`,e);}}}if(lines.length>0){const ref=lines[0].vertex.coordinates;return lines.filter(li=>calcDist(ref,li.vertex.coordinates)<snapTol);}return[];}catch(e){console.error("findCoincidentLineVertices error:",e);return[];}}
        async function findConnectedLines(ptGeom){const connected=[],bufM=10/3.28084;for(const cfg of lineLayers){if(!cfg.layer.visible)continue;try{const buf={type:"polygon",spatialReference:ptGeom.spatialReference,rings:[[[ptGeom.x-bufM,ptGeom.y-bufM],[ptGeom.x+bufM,ptGeom.y-bufM],[ptGeom.x+bufM,ptGeom.y+bufM],[ptGeom.x-bufM,ptGeom.y+bufM],[ptGeom.x-bufM,ptGeom.y-bufM]]]};const res=await cfg.layer.queryFeatures({geometry:buf,spatialRelationship:"intersects",returnGeometry:true,outFields:["*"],maxRecordCount:100});for(const f of res.features){if(!f.geometry?.paths)continue;for(let pi=0;pi<f.geometry.paths.length;pi++){const path=f.geometry.paths[pi];if(path.length<2)continue;const start={x:path[0][0],y:path[0][1]},end={x:path[path.length-1][0],y:path[path.length-1][1]},sd=calcDist(ptGeom,start),ed=calcDist(ptGeom,end);let conn=null;if(sd<bufM)conn={pathIndex:pi,pointIndex:0,isStart:true};else if(ed<bufM)conn={pathIndex:pi,pointIndex:path.length-1,isStart:false};if(conn){connected.push({feature:f,layer:cfg.layer,layerConfig:cfg,connection:conn});if(f.geometry.clone)originalGeometries.set(f.attributes.objectid,f.geometry.clone());}}}}catch(e){console.error(`findConnectedLines error on ${cfg.name}:`,e);}}return connected;}
        async function updateConnectedLines(newPt){for(const info of connectedFeatures){try{const orig=originalGeometries.get(info.feature.attributes.objectid);if(!orig?.clone)continue;const newGeom=orig.clone();newGeom.paths[info.connection.pathIndex][info.connection.pointIndex]=[newPt.x,newPt.y];const upd=info.feature.clone();upd.geometry=newGeom;upd.attributes.calculated_length=geodeticLength(newGeom);if(info.layer.applyEdits)await info.layer.applyEdits({updateFeatures:[upd]});}catch(e){console.error("updateConnectedLines error:",e);}}}

        // ── Vertex operations ─────────────────────────────────────────────────

        function lockedReadyStatus(){if(!lockedFeature)return currentMode==='point'?"Click on a point feature to select it.":"Line mode active. Click on a line vertex to select it.";if(lockedFeature.featureType==='point')return `🔒 Locked: ${lockedFeature.layerConfig.name} (point). Click the locked point to move it.`;return `🔒 Locked: ${lockedFeature.layerConfig.name}. Click a vertex to move, or use Add/Delete mode.`;}
        async function addVertexToLine(event){const sp={x:event.x,y:event.y},mp=mapView.toMap(sp);updateStatus("Adding vertex to line...");try{const lines=await findCoincidentLinesForVertexCreation(sp,mp);if(!lines.length){updateStatus("❌ No lines found to add vertex to.");return;}const updates=[];for(const li of lines){try{const newPaths=clonePaths(li.feature.geometry);newPaths[li.segmentInfo.pathIndex].splice(li.segmentInfo.insertIndex,0,[li.segmentInfo.point.x,li.segmentInfo.point.y]);const newGeom=buildPolyline(li.feature.geometry,newPaths),upd=li.feature.clone();upd.geometry=newGeom;upd.attributes.calculated_length=geodeticLength(newGeom);updates.push({layer:li.layer,feature:upd,layerName:li.layerConfig.name});}catch(e){console.error(`addVertexToLine error on ${li.layerConfig.name}:`,e);}}if(!updates.length){updateStatus("❌ No vertices could be added.");return;}for(const u of updates)if(u.layer.applyEdits)await u.layer.applyEdits({updateFeatures:[u.feature]});updateStatus(`✅ Added vertex to ${updates.length} line(s): ${updates.map(u=>u.layerName).join(", ")}!`);if(lockedFeature)await refreshLockedFeature();if(vertexHighlightActive)scheduleHighlightRefresh();setTimeout(()=>updateStatus(lockedReadyStatus()),3000);}catch(e){console.error("addVertexToLine error:",e);updateStatus("❌ Error adding vertex.");}}

        async function deleteVertexFromLine(event){
            const sp={x:event.x,y:event.y};updateStatus("Deleting vertex from line...");
            try{const results=await findCoincidentLineVertices(sp);if(!results.length){updateStatus("❌ No line vertex found to delete.");return;}const updates=[];
            for(const li of results){try{const oid=getOid(li.feature);let srcGeom=li.feature.geometry;if(oid!=null){try{const fresh=await li.layer.queryFeatures({where:`objectid=${oid}`,returnGeometry:true,outFields:['objectid']});if(fresh.features.length>0)srcGeom=fresh.features[0].geometry;}catch(e){console.warn('deleteVertexFromLine: fresh query failed:',e);}}if(!srcGeom?.paths)continue;const newPaths=clonePaths(srcGeom),totalVertices=newPaths.reduce((s,p)=>s+p.length,0);if(totalVertices<=2){console.log(`Skipping ${li.layerConfig.name} OID ${oid}: only ${totalVertices} total vertices.`);continue;}const path=newPaths[li.vertex.pathIndex];if(!path||path.length<=2){console.log(`Skipping path: only ${path?.length??0} vertices.`);continue;}path.splice(li.vertex.pointIndex,1);const newGeom=buildPolyline(srcGeom,newPaths),upd=li.feature.clone();upd.geometry=newGeom;upd.attributes.calculated_length=geodeticLength(newGeom);updates.push({layer:li.layer,feature:upd,layerName:li.layerConfig.name});}catch(e){console.error("deleteVertexFromLine prep error:",e);}}
            if(!updates.length){updateStatus("❌ No vertices deleted (lines with only 2 vertices cannot be reduced further).");return;}for(const u of updates)if(u.layer.applyEdits)await u.layer.applyEdits({updateFeatures:[u.feature]});updateStatus(`✅ Deleted vertex from ${updates.length} line(s): ${updates.map(u=>u.layerName).join(", ")}!`);if(lockedFeature)await refreshLockedFeature();if(vertexHighlightActive)scheduleHighlightRefresh();setTimeout(()=>updateStatus(lockedReadyStatus()),3000);}
            catch(e){console.error("deleteVertexFromLine error:",e);updateStatus("❌ Error deleting vertex.");}
        }

        // ── Feature selection & movement ──────────────────────────────────────

        async function handleFeatureSelection(event){
            const sp={x:event.x,y:event.y};updateStatus("Searching for feature...");
            if(currentMode==="point"){
                if(lockedFeature?.featureType==='point'){await refreshLockedFeature();const r=await findPointFeatureAtLocation(sp);if(!r||(getOid(lockedFeature.feature)!=null&&getOid(r.feature)!==getOid(lockedFeature.feature))){updateStatus(`🔒 Locked to ${lockedFeature.layerConfig.name}. Click directly on the locked point to move it.`);return;}selectedFeature=lockedFeature.feature;selectedLayer=lockedFeature.layer;selectedLayerConfig=lockedFeature.layerConfig;selectedVertex=null;connectedFeatures=await findConnectedLines(lockedFeature.feature.geometry);if(selectedFeature.geometry?.clone)originalGeometries.set(selectedFeature.attributes.objectid,selectedFeature.geometry.clone());if(cancelBtn)cancelBtn.disabled=false;waitingForDestination=true;updateStatus(`🎯 Locked ${lockedFeature.layerConfig.name} selected. Click destination to move.`);return;}
                const r=await findPointFeatureAtLocation(sp);if(r){selectedFeature=r.feature;selectedLayer=r.layer;selectedLayerConfig=r.layerConfig;selectedVertex=null;connectedFeatures=await findConnectedLines(r.feature.geometry);if(selectedFeature.geometry?.clone)originalGeometries.set(selectedFeature.attributes.objectid,selectedFeature.geometry.clone());if(cancelBtn)cancelBtn.disabled=false;waitingForDestination=true;updateStatus(`🎯 ${r.layerConfig.name} selected with ${connectedFeatures.length} connected line(s). Click destination to move.`);}
                else updateStatus("❌ No point feature found.");
            }else{const results=await findCoincidentLineVertices(sp);if(results.length>0){selectedCoincidentLines=results;selectedFeature=results[0].feature;selectedLayer=results[0].layer;selectedLayerConfig=results[0].layerConfig;selectedVertex=results[0].vertex;for(const li of results)if(li.feature.geometry?.clone)originalGeometries.set(li.feature.attributes.objectid,li.feature.geometry.clone());if(cancelBtn)cancelBtn.disabled=false;waitingForDestination=true;const vType=results[0].vertex.isEndpoint?"endpoint":"vertex",snap=results[0].vertex.isEndpoint?" (will snap to nearest point or line vertex)":"",lockNote=lockedFeature?.featureType==='line'?" [🔒 Locked feature]":"";updateStatus(`🎯 Selected ${vType} on ${results.length} line(s): ${results.map(r=>r.layerConfig.name).join(", ")}${snap}${lockNote}. Click destination.`);}else updateStatus("❌ No line vertex found.");}
        }

        async function handleMoveToDestination(event){
            if(!selectedFeature){updateStatus("❌ No feature selected. Click a feature first.");return;}
            let dst=mapView.toMap({x:event.x,y:event.y});updateStatus("Moving feature...");
            try{
                if(currentMode==="point"){const excludeOids=new Set([getOid(selectedFeature)].filter(Boolean));const snapInfo=snappingEnabled?await findSnapTarget(dst,excludeOids):null;if(snapInfo)dst=toTypedPoint(snapInfo.geometry,mapView.spatialReference);const isLockedPoint=lockedFeature?.featureType==='point';if(!isLockedPoint)await updateConnectedLines(dst);const upd=selectedFeature.clone();upd.geometry=dst;if(selectedLayer.applyEdits)await selectedLayer.applyEdits({updateFeatures:[upd]});const movedLines=isLockedPoint?0:connectedFeatures.length;let msg=movedLines>0?`✅ Moved ${selectedLayerConfig.name} and ${movedLines} connected line(s)!`:`✅ Moved ${selectedLayerConfig.name}!`;if(snapInfo)msg+=` Snapped to ${snapInfo.snapType==='lineVertex'?`line vertex in ${snapInfo.layerConfig.name}`:`point feature in ${snapInfo.layerConfig.name}`}.`;updateStatus(msg);}
                else{const excludeOids=new Set(selectedCoincidentLines.map(li=>getOid(li.feature)).filter(Boolean));const snapInfo=snappingEnabled?await findSnapTarget(dst,excludeOids):null;if(snapInfo)dst=snapInfo.geometry;const updates=[];for(const li of selectedCoincidentLines){try{const newPaths=clonePaths(li.feature.geometry),path=newPaths[li.vertex.pathIndex];if(path?.[li.vertex.pointIndex])path[li.vertex.pointIndex]=[dst.x,dst.y];const newGeom=buildPolyline(li.feature.geometry,newPaths),upd=li.feature.clone();upd.geometry=newGeom;upd.attributes.calculated_length=geodeticLength(newGeom);updates.push({layer:li.layer,feature:upd,layerName:li.layerConfig.name});}catch(e){console.error("handleMoveToDestination line prep error:",e);}}let ok=0;for(const u of updates){try{if(u.layer.applyEdits){await u.layer.applyEdits({updateFeatures:[u.feature]});ok++;}}catch(e){console.error("applyEdits error:",e);}}let msg=`✅ Moved ${selectedVertex.isEndpoint?"endpoint":"vertex"} on ${ok} line(s) and recalculated lengths!`;if(snapInfo)msg+=` Snapped to ${snapInfo.snapType==='lineVertex'?`line vertex in ${snapInfo.layerConfig.name}`:`point feature in ${snapInfo.layerConfig.name}`}.`;updateStatus(msg);}
                selectedFeature=null;selectedLayer=null;selectedLayerConfig=null;selectedVertex=null;selectedCoincidentLines=[];waitingForDestination=false;connectedFeatures=[];originalGeometries.clear();if(cancelBtn)cancelBtn.disabled=true;if(lockedFeature)await refreshLockedFeature();if(vertexHighlightActive)scheduleHighlightRefresh();setTimeout(()=>updateStatus(lockedReadyStatus()),3000);
            }catch(e){console.error("handleMoveToDestination error:",e);updateStatus("❌ Error moving feature.");}
        }

        async function handleClick(event){
            if(!toolActive)return;if(isProcessingClick)return;
            isProcessingClick=true;event.stopPropagation();
            try{
                if(cutMode)                 await handleCutClick(event);
                else if(copyMode)           await handleCopyClick(event);
                else if(snapToPointMode)    await handleSnapToPointClick(event);
                else if(pickingFeatureMode) await pickFeature(event);
                else if(vertexMode==="add")    await addVertexToLine(event);
                else if(vertexMode==="delete") await deleteVertexFromLine(event);
                else if(!selectedFeature)   await handleFeatureSelection(event);
                else                        await handleMoveToDestination(event);
            }finally{isProcessingClick=false;}
        }

        // ── Vertex highlight ──────────────────────────────────────────────────

        function loadGraphicClasses(){return new Promise((resolve,reject)=>{if(typeof require!=="undefined")require(["esri/Graphic","esri/layers/GraphicsLayer"],(G,GL)=>resolve({Graphic:G,GraphicsLayer:GL}),reject);else reject(new Error("ArcGIS require() not found"));});}
        function makeVertexGraphic(Graphic,x,y,sr,endpoint){return new Graphic({geometry:{type:"point",x,y,spatialReference:sr},symbol:{type:"simple-marker",style:endpoint?"circle":"square",color:endpoint?[255,120,0,220]:[30,130,255,200],size:endpoint?10:7,outline:{color:[255,255,255,230],width:1.5}}});}
        async function renderVertexHighlights(){if(!vertexHighlightActive)return;updateStatus("Loading vertex highlights...");try{const{Graphic,GraphicsLayer}=await loadGraphicClasses();if(!vertexHighlightLayer){vertexHighlightLayer=new GraphicsLayer({listMode:"hide"});mapView.map.add(vertexHighlightLayer);}vertexHighlightLayer.removeAll();let total=0;const renderGeom=geom=>{if(!geom?.paths)return;for(const path of geom.paths)for(let i=0;i<path.length;i++){vertexHighlightLayer.add(makeVertexGraphic(Graphic,path[i][0],path[i][1],geom.spatialReference,i===0||i===path.length-1));total++;}};if(lockedFeature?.featureType==='line'){renderGeom(lockedFeature.feature.geometry);updateStatus(`👁 Showing ${total} vertices for locked feature (${lockedFeature.layerConfig.name}).`);}else{for(const cfg of lineLayers){if(!cfg.layer.visible)continue;try{const res=await cfg.layer.queryFeatures({geometry:mapView.extent,spatialRelationship:"intersects",returnGeometry:true,outFields:["objectid"],maxRecordCount:500});for(const f of res.features)renderGeom(f.geometry);}catch(e){console.error(`renderVertexHighlights error on ${cfg.name}:`,e);}}updateStatus(`👁 Showing ${total} vertices across ${lineLayers.filter(l=>l.layer.visible).length} visible line layer(s).`);}}catch(e){console.error("renderVertexHighlights error:",e);updateStatus("❌ Error loading vertex highlights.");}}
        function clearVertexHighlights(){if(vertexHighlightLayer){vertexHighlightLayer.removeAll();mapView.map.remove(vertexHighlightLayer);vertexHighlightLayer=null;}}
        function scheduleHighlightRefresh(){clearTimeout(highlightDebounceTimer);highlightDebounceTimer=setTimeout(()=>renderVertexHighlights(),600);}
        function toggleVertexHighlight(){vertexHighlightActive=!vertexHighlightActive;if(vertexHighlightActive){showVerticesToggleBtn.style.background="#6f42c1";showVerticesToggleBtn.textContent="👁 Hide Vertices";if(refreshVerticesBtn)refreshVerticesBtn.disabled=false;renderVertexHighlights();extentWatchHandle=mapView.watch("extent",()=>{if(vertexHighlightActive&&lockedFeature?.featureType!=='line')scheduleHighlightRefresh();});}else{showVerticesToggleBtn.style.background="#666";showVerticesToggleBtn.textContent="👁 Show Vertices";if(refreshVerticesBtn)refreshVerticesBtn.disabled=true;clearVertexHighlights();if(extentWatchHandle){extentWatchHandle.remove();extentWatchHandle=null;}clearTimeout(highlightDebounceTimer);updateStatus(toolActive?`Ready. Click on a ${currentMode==="point"?"point feature":"line vertex"} to select it.`:"Tool disabled.");}}

        // ── Mode setters ──────────────────────────────────────────────────────

        function cancelMove(){selectedFeature=null;selectedLayer=null;selectedLayerConfig=null;selectedVertex=null;selectedCoincidentLines=[];waitingForDestination=false;connectedFeatures=[];originalGeometries.clear();isProcessingClick=false;if(cancelBtn)cancelBtn.disabled=true;if(lockedFeature)updateStatus(lockedReadyStatus());else if(vertexMode==="add")updateStatus("Add Vertex mode active. Click on any line segment.");else if(vertexMode==="delete")updateStatus("Delete Vertex mode active. Click on any vertex.");else{const m=currentMode==="point"?"point feature":"line vertex";updateStatus(`Move cancelled. Click on a ${m} to select it.`);}}
        function setAddVertexMode(){vertexMode=vertexMode==="add"?"none":"add";if(addVertexBtn)addVertexBtn.style.background=vertexMode==="add"?"#28a745":"#666";if(deleteVertexBtn)deleteVertexBtn.style.background="#666";if(selectedFeature)cancelMove();if(toolActive)updateStatus(vertexMode==="add"?"Add Vertex mode active. Click anywhere on a line to insert a vertex.":"Mode cleared.");}
        function setDeleteVertexMode(){vertexMode=vertexMode==="delete"?"none":"delete";if(deleteVertexBtn)deleteVertexBtn.style.background=vertexMode==="delete"?"#dc3545":"#666";if(addVertexBtn)addVertexBtn.style.background="#666";if(selectedFeature)cancelMove();if(toolActive)updateStatus(vertexMode==="delete"?"Delete Vertex mode active. Click any vertex or endpoint to delete it.":"Mode cleared.");}
        function setPointMode(){currentMode="point";vertexMode="none";if(pointModeBtn)pointModeBtn.style.background="#3367d6";if(lineModeBtn)lineModeBtn.style.background="#666";if(addVertexBtn)addVertexBtn.style.background="#666";if(deleteVertexBtn)deleteVertexBtn.style.background="#666";if(toolActive)updateStatus("Point mode active. Click on a point feature to select it.");if(selectedFeature)cancelMove();}
        function setLineMode(){currentMode="line";vertexMode="none";if(pointModeBtn)pointModeBtn.style.background="#666";if(lineModeBtn)lineModeBtn.style.background="#3367d6";if(addVertexBtn)addVertexBtn.style.background="#666";if(deleteVertexBtn)deleteVertexBtn.style.background="#666";if(toolActive)updateStatus(lockedReadyStatus());if(selectedFeature)cancelMove();}

        function enableTool(){
            toolActive=true;clickHandler=mapView.on("click",handleClick);
            hotkeyHandler=e=>handleHotkey(e);
            document.addEventListener('keydown',hotkeyHandler,true);
            if(enableBtn)enableBtn.disabled=true;if(disableBtn)disableBtn.disabled=false;
            if(mapView.container)mapView.container.style.cursor="crosshair";
            updateStatus(`Tool enabled in ${currentMode} mode. Click on a ${currentMode==="point"?"point feature":"line vertex"} to select it.`);
        }

        function disableTool(){
            toolActive=false;pickingFeatureMode=false;isProcessingClick=false;
            selectedFeature=null;selectedLayer=null;selectedLayerConfig=null;selectedVertex=null;selectedCoincidentLines=[];waitingForDestination=false;connectedFeatures=[];originalGeometries.clear();vertexMode="none";
            if(cutMode)disableCutMode();if(copyMode)disableCopyMode();if(snapToPointMode)disableSnapToPointMode();
            if(hotkeyHandler){document.removeEventListener('keydown',hotkeyHandler,true);hotkeyHandler=null;}
            if(addVertexBtn)addVertexBtn.style.background="#666";if(deleteVertexBtn)deleteVertexBtn.style.background="#666";
            if(lockFeatureBtn){lockFeatureBtn.style.background=lockedFeature?"#6f42c1":"#666";lockFeatureBtn.textContent=lockedFeature?"🎯 Re-Pick":"🎯 Pick Feature";}
            if(clickHandler)clickHandler.remove();
            if(enableBtn)enableBtn.disabled=false;if(disableBtn)disableBtn.disabled=true;if(cancelBtn)cancelBtn.disabled=true;
            if(mapView.container)mapView.container.style.cursor="default";updateStatus("Tool disabled.");
        }

        // ── Wire up buttons ───────────────────────────────────────────────────

        if(pointModeBtn)          pointModeBtn.onclick          = setPointMode;
        if(lineModeBtn)           lineModeBtn.onclick           = setLineMode;
        if(addVertexBtn)          addVertexBtn.onclick          = setAddVertexMode;
        if(deleteVertexBtn)       deleteVertexBtn.onclick       = setDeleteVertexMode;
        if(snapToPointModeBtn)    snapToPointModeBtn.onclick    = ()=>snapToPointMode?disableSnapToPointMode():enableSnapToPointMode();
        if(showVerticesToggleBtn) showVerticesToggleBtn.onclick = toggleVertexHighlight;
        if(refreshVerticesBtn)    refreshVerticesBtn.onclick    = ()=>renderVertexHighlights();
        if(releaseFeatureBtn)     releaseFeatureBtn.onclick     = releaseLockedFeature;
        if(enableBtn)             enableBtn.onclick             = enableTool;
        if(disableBtn)            disableBtn.onclick            = disableTool;
        if(cancelBtn)             cancelBtn.onclick             = cancelMove;
        if(cutModeBtn)            cutModeBtn.onclick            = ()=>cutMode?disableCutMode():enableCutMode();
        if(cutUndoBtn)            cutUndoBtn.onclick            = undoLastCut;
        if(copyModeBtn)           copyModeBtn.onclick           = ()=>copyMode?disableCopyMode():enableCopyMode();
        if(clearCopyTemplateBtn)  clearCopyTemplateBtn.onclick  = clearCopyTemplate;

        if(snappingToggleBtn) snappingToggleBtn.onclick=()=>{snappingEnabled=!snappingEnabled;snappingToggleBtn.style.background=snappingEnabled?'#28a745':'#888';snappingToggleBtn.textContent=snappingEnabled?'⦿ Snapping: ON':'⦾ Snapping: OFF';};

        cutCtxMenu.querySelector('#cutCtxExecute').onclick = executeCut;
        cutCtxMenu.querySelector('#cutCtxCancel').onclick  = resetCutSelection;

        const refreshLayersBtn = toolBox.querySelector("#refreshLayers");
        if(refreshLayersBtn){refreshLayersBtn.onclick=async()=>{refreshLayersBtn.disabled=true;refreshLayersBtn.textContent="…";if(lockedFeature)releaseLockedFeature();if(selectedFeature)cancelMove();if(cutMode)disableCutMode();if(copyMode)disableCopyMode();if(snapToPointMode)disableSnapToPointMode();updateStatus("Refreshing layers...");await loadLayers();updateLayerBadge();refreshLayersBtn.disabled=false;refreshLayersBtn.textContent="↺ Refresh";updateStatus(`Layers refreshed: ${pointLayers.length} point, ${lineLayers.length} line, ${polygonLayers.length} polygon.`);};}

        if(lockFeatureBtn){lockFeatureBtn.onclick=()=>{if(pickingFeatureMode){pickingFeatureMode=false;lockFeatureBtn.style.background=lockedFeature?"#6f42c1":"#666";lockFeatureBtn.textContent=lockedFeature?"🎯 Re-Pick":"🎯 Pick Feature";updateStatus(lockedFeature?`🔒 Locked: ${lockedFeature.layerConfig.name}. Pick cancelled.`:"Pick cancelled.");}else{pickingFeatureMode=true;if(selectedFeature)cancelMove();lockFeatureBtn.style.background="#e6ac00";lockFeatureBtn.textContent="⏳ Click a feature...";updateStatus("🖱 Click any point or line feature on the map to lock all edits to it.");}};}

        if(closeBtn){closeBtn.onclick=()=>{dismissPickerPopup();dismissCopyPickerPopup();disableTool();clearVertexHighlights();clearTimeout(highlightDebounceTimer);if(extentWatchHandle){extentWatchHandle.remove();extentWatchHandle=null;}if(cutGraphicsLayer){mapView.map.remove(cutGraphicsLayer);cutGraphicsLayer=null;}hideCopySnapIndicator();cutCtxMenu.remove();toolBox.remove();if(window.gisToolHost?.activeTools instanceof Set)window.gisToolHost.activeTools.delete('snap-move-tool');};}

        // ── Init ──────────────────────────────────────────────────────────────

        setPointMode();
        window.gisToolHost.activeTools.add('snap-move-tool');
        updateStatus("Detecting layers...");

        loadLayers().then(()=>{
            updateLayerBadge();
            updateStatus(`Ready: ${pointLayers.length} point, ${lineLayers.length} line, ${polygonLayers.length} polygon layer(s). Click 'Enable Tool' to start.`);
        }).catch(e=>{
            console.error("Layer load error:",e);
            updateStatus("⚠️ Error detecting layers. Try clicking ↺ Refresh.");
        });

    } catch(error) {
        console.error("Error creating snap-move tool:", error);
        alert("Error creating tool: "+(error.message||error));
    }
})();
