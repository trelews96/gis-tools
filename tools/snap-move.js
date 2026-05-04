// tools/snap-move-tool.js
// Click-to-Move + Cut & Split + Click & Copy + Flip Direction + Soft Delete Tool

(function() {
    try {
        if (!window.gisToolHost) window.gisToolHost = {};
        if (!window.gisToolHost.activeTools || !(window.gisToolHost.activeTools instanceof Set))
            window.gisToolHost.activeTools = new Set();
        if (window.gisToolHost.activeTools.has('snap-move-tool')) { console.log('Snap Move Tool already active'); return; }
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
        const COLOC_BUF_M = 1 / 3.28084;
        const ARROW_SPACING = 200, ARROW_MIN = 1, ARROW_MAX = 5;
        const ARROW_LABEL_OFFSET_PX = 18;
        const DELETE_FIELD = 'delete_feature';
        const MAX_QUERIED_EXTENTS = 10;

        function makeExt(cx, cy, half, sr) {
            return { type:'extent', xmin:cx-half, ymin:cy-half, xmax:cx+half, ymax:cy+half, spatialReference:sr };
        }

        // ── Dynamic layer registry ────────────────────────────────────────────

        let pointLayers = [], lineLayers = [], polygonLayers = [];

        async function loadLayers() {
            pointLayers = []; lineLayers = []; polygonLayers = [];
            clearVertexCache();
            const all = mapView.map.allLayers.filter(l => l.type === "feature" && l.visible !== false);
            await Promise.all(all.map(l => l.load().catch(() => null)));
            const seenKeys = new Set();
            for (const l of all) {
                if (!l.loaded) continue;
                const url = (l.url || '').toLowerCase().replace(/\/+$/, '');
                const dedupKey = url ? `${url}__${l.layerId ?? ''}` : null;
                if (dedupKey && seenKeys.has(dedupKey)) { console.log(`GIS Edit Tools: skipping duplicate layer "${l.title}"`); continue; }
                if (dedupKey) seenKeys.add(dedupKey);
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
            if (badge) badge.textContent = `${pointLayers.length}pt · ${lineLayers.length}ln · ${polygonLayers.length}poly`;
        }

        // ── Cached ArcGIS graphic classes ─────────────────────────────────────

        let _Graphic = null, _GraphicsLayer = null;

        async function ensureGraphicClasses() {
            if (_Graphic && _GraphicsLayer) return;
            try {
                await new Promise((res, rej) => {
                    if (typeof require !== 'undefined')
                        require(['esri/Graphic', 'esri/layers/GraphicsLayer'], (G, GL) => { _Graphic = G; _GraphicsLayer = GL; res(); }, rej);
                    else rej(new Error('require not found'));
                });
            } catch(e) { console.error('ensureGraphicClasses error:', e); }
        }

        // ── Vertex geometry cache ─────────────────────────────────────────────

        let vertexGeomCache = new Map();
        let queriedExtentList = [];
        const vtxKey = (layerId, oid) => `${layerId}:${oid}`;

        function isExtentCovered(ext) {
            return queriedExtentList.some(qe =>
                qe.xmin <= ext.xmin && qe.xmax >= ext.xmax &&
                qe.ymin <= ext.ymin && qe.ymax >= ext.ymax
            );
        }
        function recordQueriedExtent(ext) {
            if (isExtentCovered(ext)) return;
            queriedExtentList.push({ xmin:ext.xmin, xmax:ext.xmax, ymin:ext.ymin, ymax:ext.ymax });
            if (queriedExtentList.length > MAX_QUERIED_EXTENTS) queriedExtentList.shift();
        }
        function updateVertexCacheGeom(layerId, oid, geom) {
            if (!geom?.paths || oid == null || layerId == null) return;
            vertexGeomCache.set(vtxKey(layerId, oid), geom);
        }
        function clearVertexCache() { vertexGeomCache.clear(); queriedExtentList = []; }
        function geomIntersectsExtent(geom, ext) {
            if (!geom?.paths) return false;
            for (const path of geom.paths)
                for (const [x, y] of path)
                    if (x >= ext.xmin && x <= ext.xmax && y >= ext.ymin && y <= ext.ymax) return true;
            return false;
        }

        // ── Toolbox UI ────────────────────────────────────────────────────────

        const toolBox = document.createElement("div");
        toolBox.id = "snapMoveToolbox";
        toolBox.style.cssText = `
            position:fixed;top:120px;right:40px;z-index:${z};
            background:#0f0d1a;border:1px solid #2d2550;
            padding:12px;width:300px;font:12px/1.4 Arial,sans-serif;
            box-shadow:0 6px 24px rgba(0,0,0,.6);border-radius:6px;
            max-height:calc(100vh - 140px);overflow-y:auto;overflow-x:hidden;
            color:#e2d9f3;`;

        toolBox.innerHTML = `
        <style>
            #snapMoveToolbox * { box-sizing:border-box; }
            #snapMoveToolbox button { font-family:inherit; cursor:pointer; border:none; border-radius:3px; transition:background 0.13s,opacity 0.13s; }
            #snapMoveToolbox button:disabled { opacity:0.35; cursor:default; }
            #smtDragHandle { margin:-12px -12px 10px;padding:5px 10px;background:#0a0814;border-bottom:1px solid #1e1935;border-radius:6px 6px 0 0;cursor:grab;display:flex;align-items:center;gap:6px;user-select:none; }
            #smtDragHandle:active { cursor:grabbing; }
            #smtHeader { display:flex;align-items:center;justify-content:space-between;margin-bottom:8px; }
            #smtTitle  { font-weight:bold;font-size:13px;color:#d4bbff; }
            #toggleTool.smt-off { padding:4px 12px;font-size:11px;font-weight:bold;color:#fff;background:#1a6b3a; }
            #toggleTool.smt-off:hover { background:#15803d; }
            #toggleTool.smt-on  { padding:4px 12px;font-size:11px;font-weight:bold;color:#fff;background:#7f1d1d; }
            #toggleTool.smt-on:hover { background:#991b1b; }
            #closeTool { padding:3px 8px;background:#2d2550;color:#9b8ec4;font-size:12px; }
            #closeTool:hover { background:#dc2626;color:#fff; }
            #smtLayerBar { display:flex;align-items:center;gap:6px;padding:4px 8px;background:#14112a;border:1px solid #2d2550;border-radius:4px;font-size:10px;color:#7a6d96;margin-bottom:8px; }
            #refreshLayers { padding:2px 8px;font-size:10px;background:#1e3a5f;color:#93c5fd;border-radius:3px; }
            #refreshLayers:hover { background:#1e40af; }
            #smtModeStrip { display:flex;gap:2px;margin-bottom:8px;flex-wrap:wrap; }
            #snapMoveToolbox .smt-mb { flex:1;min-width:30px;display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 2px;background:#1a1535;border:1px solid #2d2550;border-radius:4px;color:#7a6d96;font-family:inherit;transition:all 0.13s; }
            #snapMoveToolbox .smt-mb:hover { background:#261f47;border-color:#5b4a8a;color:#c4b5fd; }
            #snapMoveToolbox .smt-mb.smt-active { background:#3b0764;border-color:#7c3aed;color:#fff;box-shadow:0 0 10px rgba(124,58,237,0.35); }
            #snapMoveToolbox .smt-mb.smt-active-delete { background:#4a0a0a;border-color:#dc2626;color:#fca5a5;box-shadow:0 0 10px rgba(220,38,38,0.35); }
            #snapMoveToolbox .smt-mb .mi { font-size:15px;line-height:1.2; }
            #snapMoveToolbox .smt-mb .ml { font-size:8px;font-weight:bold;text-transform:uppercase;letter-spacing:0.3px;opacity:0.9; }
            #smtLockRow { display:flex;align-items:center;gap:4px;padding:5px 8px;background:#14112a;border:1px solid #2d2550;border-radius:4px;margin-bottom:8px; }
            #smtLockInfo { flex:1;font-size:10px;color:#5c5070;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
            #smtLockInfo.smt-locked { color:#a78bfa;font-weight:bold; }
            #lockFeatureBtn { padding:3px 8px;font-size:10px;background:#261f47;color:#9b8ec4; }
            #lockFeatureBtn:hover { background:#2d2550;color:#c4b5fd; }
            #lockFeatureBtn.smt-picking { background:#92400e;color:#fde68a; }
            #lockFeatureBtn.smt-locked-btn { background:#3b0764;color:#c4b5fd; }
            #releaseFeatureBtn { padding:3px 8px;font-size:10px;background:#261f47;color:#9b8ec4; }
            #releaseFeatureBtn:hover:not(:disabled) { background:#7f1d1d;color:#fca5a5; }
            .smt-ctx { display:flex;flex-direction:column;gap:5px;padding:8px;background:#14112a;border:1px solid #2d2550;border-radius:4px;margin-bottom:8px; }
            .smt-ctx.hidden { display:none; }
            #cancelMove { width:100%;padding:5px;background:#451a03;color:#fed7aa; }
            #cancelMove:hover:not(:disabled) { background:#78350f; }
            #cutModeInfo { font-size:10px;color:#fbbf24;min-height:12px; }
            #clearCopyTemplateBtn { width:100%;padding:5px;background:#1e2535;color:#9b8ec4; }
            #clearCopyTemplateBtn:hover:not(:disabled) { background:#2d2550; }
            #copyTemplateInfo { padding:5px 7px;background:#0f2a1e;border:1px solid #14532d;border-radius:3px;font-size:10px;color:#86efac; }
            #copyCountInfo { font-size:10px;color:#22c55e;font-weight:bold;min-height:12px; }
            #toolStatus { padding:6px 10px;background:#14112a;border:1px solid #2d2550;border-left:3px solid #3b82f6;border-radius:4px;color:#c4b5fd;font-size:11px;min-height:20px;line-height:1.4;margin-bottom:8px;transition:border-left-color 0.2s; }
            #smtFooter { display:flex;gap:3px; }
            #smtFooter button { flex:1;padding:4px 2px;font-size:10px;background:#1a1535;border:1px solid #2d2550;color:#7a6d96;border-radius:3px;font-family:inherit;transition:all 0.13s; }
            #smtFooter button:hover:not(:disabled) { background:#261f47;color:#c4b5fd;border-color:#5b4a8a; }
            #smtFooter button.smt-footer-on { background:#3b0764;border-color:#7c3aed;color:#fff; }
            #smtFooter button:disabled { opacity:0.35;cursor:default; }
        </style>

        <div id="smtDragHandle">
            <span style="color:#2d2550;font-size:14px;letter-spacing:2px;">⠿</span>
            <span style="font-size:10px;color:#3d3268;">GIS Edit Tools</span>
        </div>
        <div id="smtHeader">
            <span id="smtTitle">🔧 GIS Edit Tools</span>
            <div style="display:flex;gap:4px;align-items:center;">
                <button id="toggleTool" class="smt-off">▶ Enable</button>
                <button id="closeTool">✕</button>
            </div>
        </div>
        <div id="smtLayerBar">
            <span style="flex:1;" id="layerBadge">Detecting…</span>
            <button id="refreshLayers">↺ Refresh</button>
        </div>
        <div id="smtModeStrip">
            <button class="smt-mb" id="pointMode"        data-tip="Move point features [E]&#10;Connected line endpoints + co-located points move automatically."><span class="mi">📍</span><span class="ml">Point</span></button>
            <button class="smt-mb" id="lineMode"         data-tip="Move line vertices [Q]&#10;Coincident shared vertices move together."><span class="mi">〰️</span><span class="ml">Line</span></button>
            <button class="smt-mb" id="addVertexMode"    data-tip="Add vertex [Space]&#10;Click a line segment to insert a new vertex."><span class="mi">➕</span><span class="ml">Add Vtx</span></button>
            <button class="smt-mb" id="deleteVertexMode" data-tip="Delete vertex [Shift]&#10;Lines with only 2 vertices cannot be reduced."><span class="mi">✕</span><span class="ml">Del Vtx</span></button>
            <button class="smt-mb" id="flipModeBtn"      data-tip="Flip line direction [F]&#10;Reverses vertex order of all coincident lines at click."><span class="mi">🔄</span><span class="ml">Flip</span></button>
            <button class="smt-mb" id="arcModeBtn"       data-tip="Arc Fit [A]&#10;Click a line to select it.&#10;Move mouse to preview a full arc, then click to apply.&#10;— OR —&#10;Right-click the line to plant an anchor point.&#10;Hover left/right of anchor to preview that side's curve.&#10;Left-click to apply. Right-click again to reposition anchor.&#10;ESC clears anchor without deselecting the line."><span class="mi">⌒</span><span class="ml">Arc Fit</span></button>
            <button class="smt-mb" id="cutModeBtn"       data-tip="Cut &amp; split lines [C]&#10;Click a point feature or line vertex near a line.&#10;Choose which lines to split, then confirm."><span class="mi">✂️</span><span class="ml">Cut</span></button>
            <button class="smt-mb" id="copyModeBtn"      data-tip="Click &amp; copy&#10;Click any feature as a template, then click the map to place copies."><span class="mi">📋</span><span class="ml">Copy</span></button>
            <button class="smt-mb" id="deleteModeBtn"    data-tip="Soft delete features [D]&#10;Sets delete_feature = YES."><span class="mi">🗑️</span><span class="ml">Delete</span></button>
        </div>
        <div id="smtLockRow">
            <span id="smtLockInfo">No lock active</span>
            <button id="lockFeatureBtn" data-tip="Lock all edits to one specific feature. [Z]">🎯 Pick [Z]</button>
            <button id="releaseFeatureBtn" data-tip="Release the locked feature. [X]" disabled>🔓 [X]</button>
        </div>
        <div id="smtCtxDefault" class="smt-ctx">
            <button id="cancelMove" disabled>⊘ Cancel Current Move</button>
        </div>
        <div id="smtCtxCut" class="smt-ctx hidden">
            <div id="cutModeInfo"></div>
        </div>
        <div id="smtCtxCopy" class="smt-ctx hidden">
            <button id="clearCopyTemplateBtn" disabled>✕ Clear Template</button>
            <div id="copyTemplateInfo" style="display:none;"><div id="copyTemplateDetails"></div></div>
            <div id="copyCountInfo"></div>
        </div>
        <div id="smtCtxDelete" class="smt-ctx hidden"></div>
        <div id="toolStatus">Tool disabled — click Enable to start.</div>
        <div id="smtFooter">
            <button id="snappingToggle"     data-tip="Toggle snapping to nearby points and line vertices.">⦿ Snap ON</button>
            <button id="showVerticesToggle" data-tip="Overlay vertex markers on all visible line features.&#10;🟠 endpoints  🔵 midpoints&#10;Cached after first load — pan/zoom reuses memory.">👁 Vertices</button>
            <button id="directionToggle"    data-tip="Overlay direction arrows on visible line features." disabled>🔺 Direction</button>
            <button id="refreshVertices"    data-tip="Clear vertex cache and re-query from service." disabled>↺ Vtx</button>
        </div>`;

        document.body.appendChild(toolBox);

        // ── Context menus ─────────────────────────────────────────────────────

        const cutCtxMenu = document.createElement('div');
        cutCtxMenu.id = 'smtCutContextMenu';
        cutCtxMenu.style.cssText = `display:none;position:fixed;z-index:${z+1};background:#0f0d1a;border:1px solid #3a3060;border-radius:6px;box-shadow:0 4px 20px rgba(0,0,0,.6);font:12px/1.4 Arial,sans-serif;min-width:210px;overflow:hidden;color:#e2d9f3;`;
        cutCtxMenu.innerHTML = `
            <div style="padding:6px 10px;background:#2d1b69;color:#e2d9f3;font-weight:bold;font-size:11px;display:flex;align-items:center;justify-content:space-between;">
                <span>✂️ Lines: <span id="cutCtxCount">0</span></span>
                <button id="cutCtxSelectAll" style="padding:1px 7px;background:rgba(255,255,255,.12);color:#e2d9f3;border:1px solid rgba(255,255,255,.25);border-radius:3px;font-size:10px;cursor:pointer;font-family:inherit;">✓ All</button>
            </div>
            <div id="cutCtxList" style="max-height:180px;overflow-y:auto;border-bottom:1px solid #2d2550;background:#0f0d1a;"></div>
            <div style="display:flex;flex-direction:column;background:#0f0d1a;">
                <button id="cutCtxExecute" style="padding:7px 10px;background:#6d28d9;color:#fff;border:none;border-bottom:1px solid #2d2550;cursor:pointer;text-align:left;font:bold 12px Arial,sans-serif;">✂ Execute Cut (0)</button>
                <button id="cutCtxCancel"  style="padding:7px 10px;background:#1a1535;color:#9b8ec4;border:none;cursor:pointer;text-align:left;font:12px Arial,sans-serif;">✕ Cancel</button>
            </div>`;
        document.body.appendChild(cutCtxMenu);

        const delCtxMenu = document.createElement('div');
        delCtxMenu.id = 'smtDeleteContextMenu';
        delCtxMenu.style.cssText = `display:none;position:fixed;z-index:${z+1};background:#0f0d1a;border:1px solid #7f1d1d;border-radius:6px;box-shadow:0 4px 20px rgba(0,0,0,.6);font:12px/1.4 Arial,sans-serif;min-width:220px;overflow:hidden;color:#e2d9f3;`;
        delCtxMenu.innerHTML = `
            <div style="padding:6px 10px;background:#4a0a0a;color:#fca5a5;font-weight:bold;font-size:11px;display:flex;align-items:center;justify-content:space-between;">
                <span>🗑️ Features: <span id="delCtxCount">0</span></span>
                <button id="delCtxSelectAll" style="padding:1px 7px;background:rgba(255,255,255,.12);color:#fca5a5;border:1px solid rgba(255,150,150,.35);border-radius:3px;font-size:10px;cursor:pointer;font-family:inherit;">✓ All</button>
            </div>
            <div id="delCtxList" style="max-height:200px;overflow-y:auto;border-bottom:1px solid #2d2550;background:#0f0d1a;"></div>
            <div style="display:flex;flex-direction:column;background:#0f0d1a;">
                <button id="delCtxExecute" style="padding:7px 10px;background:#991b1b;color:#fff;border:none;border-bottom:1px solid #2d2550;cursor:pointer;text-align:left;font:bold 12px Arial,sans-serif;">🗑️ Mark as Deleted (0)</button>
                <button id="delCtxCancel"  style="padding:7px 10px;background:#1a1535;color:#9b8ec4;border:none;cursor:pointer;text-align:left;font:12px Arial,sans-serif;">✕ Cancel</button>
            </div>`;
        document.body.appendChild(delCtxMenu);

        // ── Drag to move ──────────────────────────────────────────────────────

        (function() {
            const handle = toolBox.querySelector('#smtDragHandle');
            let dragging = false, ox = 0, oy = 0;
            handle.addEventListener('mousedown', e => { dragging=true; ox=e.clientX-toolBox.getBoundingClientRect().left; oy=e.clientY-toolBox.getBoundingClientRect().top; e.preventDefault(); });
            document.addEventListener('mousemove', e => { if(!dragging)return; toolBox.style.left=Math.max(0,Math.min(e.clientX-ox,window.innerWidth-toolBox.offsetWidth))+'px'; toolBox.style.top=Math.max(0,Math.min(e.clientY-oy,window.innerHeight-toolBox.offsetHeight))+'px'; toolBox.style.right='auto'; });
            document.addEventListener('mouseup', ()=>{ dragging=false; });
        })();

        // ── Tooltip system ────────────────────────────────────────────────────

        let smtTip = null;
        (function initTooltips() {
            smtTip = document.createElement('div');
            smtTip.style.cssText = `position:fixed;z-index:${z+2};background:#0a0814;color:#e2d9f3;padding:6px 10px;border-radius:4px;border:1px solid #3a3060;font:11px/1.5 Arial,sans-serif;max-width:220px;white-space:pre-wrap;pointer-events:none;opacity:0;transition:opacity 0.15s;box-shadow:0 4px 14px rgba(0,0,0,0.6);display:none;`;
            document.body.appendChild(smtTip);
            function pos(el) { const r=el.getBoundingClientRect(),tw=smtTip.offsetWidth||200,th=smtTip.offsetHeight||40; let left=r.left+r.width/2-tw/2,top=r.top-th-8; if(top<8)top=r.bottom+8; left=Math.max(8,Math.min(left,window.innerWidth-tw-8)); smtTip.style.left=left+'px';smtTip.style.top=top+'px'; }
            toolBox.querySelectorAll('[data-tip]').forEach(el=>{
                el.addEventListener('mouseenter',()=>{ smtTip.textContent=el.dataset.tip; smtTip.style.display='block'; requestAnimationFrame(()=>{ pos(el); smtTip.style.opacity='1'; }); });
                el.addEventListener('mouseleave',()=>{ smtTip.style.opacity='0'; setTimeout(()=>{ if(smtTip.style.opacity==='0')smtTip.style.display='none'; },160); });
            });
        })();

        // ── State ─────────────────────────────────────────────────────────────

        let toolActive = false, currentMode = "point", vertexMode = "none";
        let selectedFeature = null, selectedLayer = null, selectedLayerConfig = null;
        let selectedVertex = null, selectedCoincidentLines = [], waitingForDestination = false;
        let connectedFeatures = [], colocatedPoints = [], originalGeometries = new Map(), clickHandler = null;
        let isProcessingClick = false, snappingEnabled = true;
        let lockedFeature = null, pickingFeatureMode = false;
        let vertexHighlightActive = false, directionArrowsActive = false, vertexHighlightLayer = null;
        let extentWatchHandle = null, highlightDebounceTimer = null;
        let pickerPopup = null, pickerHoverGraphic = null;
        let hotkeyHandler = null, flipMode = false;

        // ── Arc mode state ────────────────────────────────────────────────────
        let arcMode = false, arcWaitingForMidpoint = false;
        let arcSelectedLines = [], arcStartPt = null, arcEndPt = null;
        let arcHighlightGraphics = [], arcPreviewGraphic = null;
        let arcMoveHandler = null;
        let arcAnchorMode = false, arcAnchorPt = null, arcAnchorSegInfo = null;
        let arcAnchorGraphic = null, arcActiveSide = 'left';
        let arcRightClickHandler = null, arcContextMenuHandler = null;

        // ── Move preview state ────────────────────────────────────────────────
        // movePreviewGraphics: array of dashed preview line graphics.
        // Vertex mode  → one graphic per coincident line, showing full modified geometry.
        // Point mode   → one graphic per connected line (endpoint stretched to cursor);
        //                falls back to a single rubber-band line if no connected data yet.
        // moveSnapGraphic: crosshair at the nearest cache snap target.

        let movePreviewGraphics = [];    // array — supports multiple simultaneous preview lines
        let movePreviewHandler  = null;  // esri pointer-move handle
        let moveSnapGraphic     = null;  // crosshair indicator

        let copyMode = false, copyPlacementMode = false;
        let cutMode = false, cutPreviewMode = false, cutProcessing = false;
        let cutSelectedPoint = null, cutSelectedPointLayer = null, cutLinesToCut = [];
        let cutSelectedIndices = new Set(), cutGraphicMap = new Map();
        let cutGraphicsLayer = null;

        let deleteMode = false, deleteProcessing = false;
        let deleteCandidates = [], deleteSelectedIndices = new Set();

        let copySnapGeneration = 0;
        let copyTemplateFeature = null, copyTemplateLayer = null, copiedCount = 0;
        let copyMouseMoveHandler = null, copyKeyHandler = null, copySnapGraphic = null;
        let optimisticGraphic = null;

        // ── DOM refs ──────────────────────────────────────────────────────────

        const $ = id => toolBox.querySelector(id);
        const toggleToolBtn         = $("#toggleTool");
        const pointModeBtn          = $("#pointMode");
        const lineModeBtn           = $("#lineMode");
        const addVertexBtn          = $("#addVertexMode");
        const deleteVertexBtn       = $("#deleteVertexMode");
        const flipModeBtn           = $("#flipModeBtn");
        const arcModeBtn            = $("#arcModeBtn");
        const showVerticesToggleBtn = $("#showVerticesToggle");
        const directionToggleBtn    = $("#directionToggle");
        const refreshVerticesBtn    = $("#refreshVertices");
        const lockFeatureBtn        = $("#lockFeatureBtn");
        const releaseFeatureBtn     = $("#releaseFeatureBtn");
        const lockedFeatureInfo     = $("#smtLockInfo");
        const snappingToggleBtn     = $("#snappingToggle");
        const cancelBtn             = $("#cancelMove");
        const closeBtn              = $("#closeTool");
        const status                = $("#toolStatus");
        const cutModeBtn            = $("#cutModeBtn");
        const cutModeInfo           = $("#cutModeInfo");
        const copyModeBtn           = $("#copyModeBtn");
        const clearCopyTemplateBtn  = $("#clearCopyTemplateBtn");
        const copyTemplateInfo      = $("#copyTemplateInfo");
        const copyTemplateDetails   = $("#copyTemplateDetails");
        const copyCountInfo         = $("#copyCountInfo");
        const deleteModeBtn         = $("#deleteModeBtn");

        // ── Status bar ────────────────────────────────────────────────────────

        const updateStatus = msg => {
            if (!status) return;
            status.textContent = msg;
            let c = '#3b82f6';
            if      (msg.startsWith('✅'))                                                           c = '#16a34a';
            else if (msg.startsWith('❌'))                                                           c = '#dc2626';
            else if (msg.includes('🎯') || msg.includes('Click destination'))                       c = '#f97316';
            else if (msg.startsWith('↩'))                                                           c = '#8b5cf6';
            else if (msg.includes('🗑️'))                                                            c = '#ef4444';
            else if (msg.includes('✂️')||msg.includes('📋')||msg.includes('🔄')||msg.includes('🔒')) c = '#a78bfa';
            status.style.borderLeftColor = c;
        };

        // ── UI helpers ────────────────────────────────────────────────────────

        function setActiveModeBtn(id, isDelete = false) {
            toolBox.querySelectorAll('.smt-mb').forEach(b => { b.classList.remove('smt-active','smt-active-delete'); });
            if (id) { const b = toolBox.querySelector('#'+id); if (b) b.classList.add(isDelete ? 'smt-active-delete' : 'smt-active'); }
        }

        function showCtxPanel(name) {
            ['Default','Cut','Copy','Delete'].forEach(n => {
                const el = toolBox.querySelector(`#smtCtx${n}`);
                if (el) el.classList.toggle('hidden', n.toLowerCase() !== (name||'').toLowerCase());
            });
        }

        function exitSpecialMode() {
            if (cutMode)    disableCutMode();
            if (copyMode)   disableCopyMode();
            if (flipMode)   disableFlipMode();
            if (arcMode)    disableArcMode();
            if (deleteMode) disableDeleteMode();
        }

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
        function buildPolyline(srcGeom,newPaths) { return{type:"polyline",paths:newPaths,spatialReference:srcGeom.spatialReference}; }
        function clonePaths(geom) { return geom.paths.map(p=>p.map(c=>c.slice())); }
        function calcPolygonCentroid(ring) { let x=0,y=0; for(const pt of ring){x+=pt[0];y+=pt[1];} return{x:x/ring.length,y:y/ring.length}; }
        function toTypedPoint(g,fallbackSr) { if(!g)return g; if(g.type)return g; return{type:'point',x:g.x,y:g.y,spatialReference:g.spatialReference||fallbackSr}; }
        function layerKey(layer, cfg) { return layer?.layerId ?? layer?.id ?? cfg?.id ?? Math.random(); }
        const getOid = f => f?.attributes?.objectid ?? f?.attributes?.OBJECTID ?? null;

        // ── Arc path geometry helpers ─────────────────────────────────────────

        function findClosestPointOnPath(geom, mp) {
            let minD=Infinity,result={pathIdx:0,segIdx:0,t:0,point:{x:mp.x,y:mp.y}};
            for(let pi=0;pi<geom.paths.length;pi++){const path=geom.paths[pi];for(let si=0;si<path.length-1;si++){const ax=path[si][0],ay=path[si][1],bx=path[si+1][0],by=path[si+1][1],C=bx-ax,D=by-ay,A=mp.x-ax,B=mp.y-ay,lenSq=C*C+D*D,t=lenSq?Math.max(0,Math.min(1,(A*C+B*D)/lenSq)):0,px=ax+t*C,py=ay+t*D,d=Math.sqrt((mp.x-px)**2+(mp.y-py)**2);if(d<minD){minD=d;result={pathIdx:pi,segIdx:si,t,point:{x:px,y:py}};}}}
            return result;
        }
        function pathLengthToPoint(geom,pathIdx,segIdx,t){const path=geom.paths[pathIdx];let len=0;for(let i=0;i<segIdx;i++){const dx=path[i+1][0]-path[i][0],dy=path[i+1][1]-path[i][1];len+=Math.sqrt(dx*dx+dy*dy);}if(segIdx<path.length-1){const dx=path[segIdx+1][0]-path[segIdx][0],dy=path[segIdx+1][1]-path[segIdx][1];len+=t*Math.sqrt(dx*dx+dy*dy);}return len;}
        function getArcSide(geom,anchorInfo,mousePoint){const anchorLen=pathLengthToPoint(geom,anchorInfo.pathIdx,anchorInfo.segIdx,anchorInfo.t),mInfo=findClosestPointOnPath(geom,mousePoint),mouseLen=pathLengthToPoint(geom,mInfo.pathIdx,mInfo.segIdx,mInfo.t);return mouseLen<=anchorLen?'left':'right';}
        function buildAnchoredArcPath(geom,anchorInfo,arcPts,side){const path=geom.paths[anchorInfo.pathIdx],anchorCoord=[anchorInfo.point.x,anchorInfo.point.y];if(side==='left'){const tail=path.slice(anchorInfo.segIdx+1).map(v=>v.slice());return[...arcPts,...tail];}else{const head=path.slice(0,anchorInfo.segIdx+1).map(v=>v.slice());return[...head,anchorCoord,...arcPts.slice(1)];}}

        // ── Arc anchor graphics ───────────────────────────────────────────────

        function showArcAnchorGraphic(pt){clearArcAnchorGraphic();mapView.graphics.add({geometry:{type:'point',x:pt.x,y:pt.y,spatialReference:pt.spatialReference||mapView.spatialReference},symbol:{type:'simple-marker',style:'diamond',color:[167,139,250,1],size:13,outline:{color:[255,255,255,1],width:2}}});arcAnchorGraphic=mapView.graphics.getItemAt(mapView.graphics.length-1);}
        function clearArcAnchorGraphic(){if(arcAnchorGraphic){mapView.graphics.remove(arcAnchorGraphic);arcAnchorGraphic=null;}}

        // ── Move preview: full-geometry rubber-band ───────────────────────────

        // Shared preview line symbol — dashed purple, consistent with arc preview.
        const PREVIEW_SYM = { type:'simple-line', color:[167,139,250,0.75], width:1.5, style:'dash' };

        /** Remove all current preview line graphics. */
        function clearMovePreviewGraphics() {
            for (const g of movePreviewGraphics) mapView.graphics.remove(g);
            movePreviewGraphics = [];
        }

        /** Add one dashed preview line to the map and track it. */
        function addMovePreviewGraphic(geometry) {
            mapView.graphics.add({ geometry, symbol: PREVIEW_SYM });
            movePreviewGraphics.push(mapView.graphics.getItemAt(mapView.graphics.length - 1));
        }

        /** Crosshair at the nearest cache-based snap target. */
        function showMoveSnapIndicator(point, snapType) {
            hideMoveSnapIndicator();
            if (!point) return;
            const color = snapType === 'pointFeature' ? [255,140,0,0.9] : [167,139,250,0.9];
            mapView.graphics.add({ geometry:{ type:'point', x:point.x, y:point.y, spatialReference:point.spatialReference||mapView.spatialReference }, symbol:{ type:'simple-marker', style:'cross', color, size:18, outline:{ color:[255,255,255,0.85], width:2 } } });
            moveSnapGraphic = mapView.graphics.getItemAt(mapView.graphics.length - 1);
        }
        function hideMoveSnapIndicator() { if(moveSnapGraphic){mapView.graphics.remove(moveSnapGraphic);moveSnapGraphic=null;} }

        /** Nearest snap target from in-memory cache — synchronous, zero network. */
        function findNearestSnapInCache(mp, excludeOids=new Set()) {
            const tol=POINT_SNAP_TOLERANCE*(mapView.resolution||1);
            let nearest=null,minD=Infinity,snapType='lineVertex';
            for(const[key,geom]of vertexGeomCache){if(!geom?.paths)continue;const oid=Number(key.split(':')[1]);if(excludeOids.has(oid)||excludeOids.has(String(oid)))continue;for(const path of geom.paths)for(const coord of path){const d=calcDist(mp,{x:coord[0],y:coord[1]});if(d<minD&&d<tol){minD=d;nearest={x:coord[0],y:coord[1],spatialReference:geom.spatialReference};snapType='lineVertex';}}const seg=findClosestSeg(geom,mp);if(seg&&seg.distance<minD&&seg.distance<tol){minD=seg.distance;nearest={x:seg.point.x,y:seg.point.y,spatialReference:geom.spatialReference};snapType='lineSegment';}}
            return nearest?{geometry:nearest,snapType}:null;
        }

        /**
         * Start the live move preview. Registers a pointer-move handler that
         * redraws preview geometry on every mouse event.
         *
         * options.mode           'point' | 'vertex'
         * options.coincidentLines  (vertex mode) array of { feature, vertex } — available immediately
         * options.connectedLines   (point mode)  array of connected-line infos — if already known
         * options.connectedPromise (point mode)  Promise that resolves to connected-line infos
         *
         * Vertex mode  — Redraws each coincident line with the selected vertex
         *               moved to the cursor, showing both sides of the move in real time.
         *
         * Point mode   — If connected lines are available, redraws each with its
         *               endpoint stretched to the cursor, showing exactly how the
         *               network will deform. Falls back to a single rubber-band
         *               line while the background query is still in flight, or for
         *               standalone points with no connections.
         */
        function startMovePreview(fromPt, excludeOids=new Set(), options={}) {
            stopMovePreview();

            // For non-locked points the connected line query fires in the background;
            // store the result when it arrives so pointer-move can use it.
            let resolvedConnected = options.connectedLines || null;
            if (options.connectedPromise) {
                options.connectedPromise
                    .then(lines => { resolvedConnected = lines; })
                    .catch(() => {});
            }

            movePreviewHandler = mapView.on('pointer-move', e => {
                if (!waitingForDestination) { stopMovePreview(); return; }
                const mp = mapView.toMap({ x: e.x, y: e.y });
                let toPt = { x: mp.x, y: mp.y, spatialReference: mp.spatialReference || mapView.spatialReference };

                // Cache-only snap (synchronous)
                if (snappingEnabled && vertexGeomCache.size > 0) {
                    const snap = findNearestSnapInCache(mp, excludeOids);
                    if (snap) {
                        toPt = { x: snap.geometry.x, y: snap.geometry.y, spatialReference: snap.geometry.spatialReference || mapView.spatialReference };
                        showMoveSnapIndicator(toPt, snap.snapType);
                    } else {
                        hideMoveSnapIndicator();
                    }
                }

                clearMovePreviewGraphics();

                if (options.mode === 'vertex' && options.coincidentLines?.length) {
                    // ── Vertex mode ──────────────────────────────────────────
                    // Redraw each coincident line with the vertex at toPt.
                    // This shows both adjacent segments updating simultaneously.
                    for (const li of options.coincidentLines) {
                        const geom = li.feature.geometry;
                        if (!geom?.paths) continue;
                        const newPaths = geom.paths.map(p => p.map(c => c.slice()));
                        const path = newPaths[li.vertex.pathIndex];
                        if (path?.[li.vertex.pointIndex]) path[li.vertex.pointIndex] = [toPt.x, toPt.y];
                        addMovePreviewGraphic({ type:'polyline', paths:newPaths, spatialReference:geom.spatialReference });
                    }

                } else if (options.mode === 'point' && resolvedConnected?.length) {
                    // ── Point mode with connected lines ──────────────────────
                    // Stretch each connected line's endpoint to toPt so the user
                    // can see exactly how the network will deform.
                    for (const info of resolvedConnected) {
                        const geom = info.feature.geometry;
                        if (!geom?.paths) continue;
                        const newPaths = geom.paths.map(p => p.map(c => c.slice()));
                        const path = newPaths[info.connection.pathIndex];
                        if (path?.[info.connection.pointIndex] !== undefined)
                            path[info.connection.pointIndex] = [toPt.x, toPt.y];
                        addMovePreviewGraphic({ type:'polyline', paths:newPaths, spatialReference:geom.spatialReference });
                    }

                } else {
                    // ── Fallback: rubber-band line ────────────────────────────
                    // Used for standalone points (no connections) or while the
                    // background connected-line query is still in flight.
                    addMovePreviewGraphic({
                        type: 'polyline',
                        paths: [[[fromPt.x, fromPt.y], [toPt.x, toPt.y]]],
                        spatialReference: fromPt.spatialReference || mapView.spatialReference
                    });
                }
            });
        }

        /** Tear down the preview handler and remove all preview graphics. */
        function stopMovePreview() {
            if (movePreviewHandler) { movePreviewHandler.remove(); movePreviewHandler = null; }
            clearMovePreviewGraphics();
            hideMoveSnapIndicator();
        }

        // ── Optimistic UI ─────────────────────────────────────────────────────

        function showOptimisticPoint(dst){clearOptimisticGraphic();mapView.graphics.add({geometry:{type:'point',x:dst.x,y:dst.y,spatialReference:dst.spatialReference||mapView.spatialReference},symbol:{type:'simple-marker',style:'circle',color:[255,255,255,0.12],size:24,outline:{color:[50,200,50,0.85],width:2.5}}});optimisticGraphic=mapView.graphics.getItemAt(mapView.graphics.length-1);}
        function clearOptimisticGraphic(){if(optimisticGraphic){mapView.graphics.remove(optimisticGraphic);optimisticGraphic=null;}}

        // ── Picker hover highlight ────────────────────────────────────────────

        function showPickerHoverHighlight(geometry){clearPickerHoverHighlight();if(!geometry)return;const isLine=geometry.type==='polyline';mapView.graphics.add({geometry,symbol:isLine?{type:'simple-line',color:[0,120,255,0.9],width:4,style:'solid'}:{type:'simple-marker',style:'circle',color:[0,120,255,0.3],size:22,outline:{color:[0,80,200,0.9],width:2.5}}});pickerHoverGraphic=mapView.graphics.getItemAt(mapView.graphics.length-1);}
        function clearPickerHoverHighlight(){if(pickerHoverGraphic){mapView.graphics.remove(pickerHoverGraphic);pickerHoverGraphic=null;}}

        // ── Copy helpers ──────────────────────────────────────────────────────

        function showCopySnapIndicator(point){hideCopySnapIndicator();if(!point)return;mapView.graphics.add({geometry:{type:'point',x:point.x,y:point.y,spatialReference:point.spatialReference},symbol:{type:'simple-marker',style:'cross',color:[50,200,50,0.9],size:14,outline:{color:[255,255,255,1],width:2}}});copySnapGraphic=mapView.graphics.getItemAt(mapView.graphics.length-1);}
        function hideCopySnapIndicator(){if(copySnapGraphic){mapView.graphics.remove(copySnapGraphic);copySnapGraphic=null;}}
        async function findCopySnapPoint(screenPoint){if(!snappingEnabled)return null;try{const tol=POINT_SNAP_TOLERANCE*(mapView.resolution||1),mp=mapView.toMap(screenPoint);let best=null,bestD=Infinity;const hit=await mapView.hitTest(screenPoint,{include:mapView.map.allLayers.filter(l=>l.type==='feature')});for(const r of hit.results){if(!r.graphic?.geometry)continue;const geom=r.graphic.geometry,candidates=[];if(geom.type==='point')candidates.push({x:geom.x,y:geom.y,spatialReference:geom.spatialReference});else if(geom.type==='polyline')for(const path of geom.paths)for(const v of path)candidates.push({x:v[0],y:v[1],spatialReference:geom.spatialReference});else if(geom.type==='polygon')for(const ring of geom.rings)for(const v of ring)candidates.push({x:v[0],y:v[1],spatialReference:geom.spatialReference});for(const c of candidates){const d=calcDist(mp,c);if(d<bestD&&d<tol){bestD=d;best=c;}}}return best;}catch(e){console.error('findCopySnapPoint error:',e);return null;}}
        function copyAttributesForNewFeature(feature,layer){const exclude=new Set([(layer.objectIdField||'').toLowerCase(),(layer.globalIdField||'').toLowerCase(),'objectid','globalid','gis_id','gisid','created_date','creation_date','createdate','created_user','creator','createuser','last_edited_date','edit_date','editdate','last_edited_user','editor','edituser']);const out={};for(const[k,v]of Object.entries(feature.attributes))if(!exclude.has(k.toLowerCase()))out[k]=v;return out;}
        async function applyCopyTemplate(feature,layer,cfg){let fullFeature=feature;try{const oid=feature.attributes?.[layer.objectIdField];if(oid!=null){const res=await layer.queryFeatures({where:`${layer.objectIdField}=${oid}`,outFields:['*'],returnGeometry:true});if(res.features.length>0)fullFeature=res.features[0];}}catch(e){console.warn('applyCopyTemplate:',e);}copyTemplateFeature=fullFeature;copyTemplateLayer=layer;copyPlacementMode=true;copiedCount=0;if(copyCountInfo)copyCountInfo.textContent='';const oid=fullFeature.attributes?.[layer.objectIdField]??'?';if(copyTemplateDetails)copyTemplateDetails.innerHTML=`<strong>Layer:</strong> ${cfg.name}<br><strong>OID:</strong> ${oid}<br><strong>Type:</strong> ${fullFeature.geometry?.type??'unknown'}`;if(copyTemplateInfo)copyTemplateInfo.style.display='block';if(clearCopyTemplateBtn)clearCopyTemplateBtn.disabled=false;mapView.container.style.cursor='copy';copyMouseMoveHandler=mapView.on('pointer-move',async e=>{if(!copyPlacementMode)return;const gen=++copySnapGeneration;const snap=await findCopySnapPoint({x:e.x,y:e.y});if(gen!==copySnapGeneration)return;showCopySnapIndicator(snap);});updateStatus(`📋 Template set (${cfg.name} · ${fullFeature.geometry?.type}). Click the map to place copies. ESC to clear.`);}
        async function selectCopyTemplate(event){const sp={x:event.x,y:event.y};updateStatus('Identifying feature to copy…');const candidates=[],seenOids=new Set(),allCfgs=getAllFeatureLayers();if(mapView.hitTest){const hit=await mapView.hitTest(sp,{include:mapView.map.allLayers.filter(l=>l.type==='feature')});for(const r of hit.results){if(!r.graphic?.geometry)continue;const cfg=allCfgs.find(c=>c.id===r.layer.layerId);if(!cfg)continue;const oid=getOid(r.graphic);if(oid!=null&&seenOids.has(oid))continue;if(oid!=null)seenOids.add(oid);candidates.push({feature:r.graphic,layer:r.layer,layerConfig:cfg});}}if(candidates.length===0){const mp=mapView.toMap(sp),ext=makeExt(mp.x,mp.y,POINT_SNAP_TOLERANCE*(mapView.resolution||1),mapView.spatialReference);for(const cfg of allCfgs){if(!cfg.layer.visible)continue;try{const res=await cfg.layer.queryFeatures({geometry:ext,spatialRelationship:'intersects',returnGeometry:true,outFields:['*'],maxRecordCount:10});for(const f of res.features){if(!f.geometry)continue;const oid=getOid(f);if(oid!=null&&seenOids.has(oid))continue;if(oid!=null)seenOids.add(oid);candidates.push({feature:f,layer:cfg.layer,layerConfig:cfg});}}catch(e){console.error(`selectCopyTemplate fallback on ${cfg.name}:`,e);}}}if(candidates.length===0){updateStatus('❌ No feature found at this location.');return;}if(candidates.length===1)await applyCopyTemplate(candidates[0].feature,candidates[0].layer,candidates[0].layerConfig);else{const rect=mapView.container.getBoundingClientRect();showCopyPickerPopup(candidates,rect.left+sp.x,rect.top+sp.y);updateStatus(`🗂 ${candidates.length} overlapping features. Choose one to use as template.`);}}
        let copyPickerPopup=null;
        function dismissCopyPickerPopup(){if(copyPickerPopup){copyPickerPopup.remove();copyPickerPopup=null;}}
        function showCopyPickerPopup(candidates,pageX,pageY){dismissCopyPickerPopup();const popup=document.createElement('div');copyPickerPopup=popup;popup.style.cssText=`position:fixed;z-index:${z+1};background:#0f0d1a;border:1px solid #3a3060;border-radius:4px;box-shadow:0 4px 18px rgba(0,0,0,0.5);font:12px/1.4 Arial,sans-serif;min-width:220px;max-width:300px;max-height:320px;overflow-y:auto;color:#e2d9f3;`;let left=pageX+12,top=pageY-10;if(left+310>window.innerWidth)left=pageX-310;if(top+340>window.innerHeight)top=window.innerHeight-340-12;if(top<12)top=12;popup.style.left=left+'px';popup.style.top=top+'px';const header=document.createElement('div');header.style.cssText='padding:7px 10px 5px;font-weight:bold;font-size:11px;color:#d4bbff;border-bottom:1px solid #2d2550;display:flex;justify-content:space-between;align-items:center;background:#2d1b69;';header.innerHTML=`<span>📋 ${candidates.length} features — pick template</span>`;const closeX=document.createElement('span');closeX.textContent='✕';closeX.style.cssText='cursor:pointer;color:#9b8ec4;font-size:13px;padding:0 2px;';closeX.onclick=()=>{dismissCopyPickerPopup();updateStatus('📋 Copy mode active. Click a feature to use as template.');};header.appendChild(closeX);popup.appendChild(header);const typeIcon=t=>t==='point'?'📍':t==='polyline'?'〰️':'⬡';candidates.forEach(c=>{const row=document.createElement('div');row.style.cssText='padding:6px 10px;cursor:pointer;border-bottom:1px solid #1e1935;display:flex;flex-direction:column;gap:2px;';row.onmouseenter=()=>row.style.background='#2d1b69';row.onmouseleave=()=>row.style.background='';const oid=getOid(c.feature)??'?',gtype=c.feature.geometry?.type??'unknown',title=document.createElement('div'),meta=document.createElement('div');title.style.cssText='font-weight:bold;color:#e2d9f3;font-size:11px;';title.textContent=`${typeIcon(gtype)} ${c.layerConfig.name}`;meta.style.cssText='color:#7a6d96;font-size:10px;';meta.textContent=`OID: ${oid}  ·  ${gtype}`;row.appendChild(title);row.appendChild(meta);row.onclick=async()=>{dismissCopyPickerPopup();await applyCopyTemplate(c.feature,c.layer,c.layerConfig);};popup.appendChild(row);});document.body.appendChild(popup);setTimeout(()=>{document.addEventListener('click',function outsideClick(e){if(!popup.contains(e.target)){dismissCopyPickerPopup();document.removeEventListener('click',outsideClick);}});},0);}
        async function placeCopyFeature(event){if(!copyTemplateFeature||!copyPlacementMode||!copyTemplateLayer)return;const snapPt=await findCopySnapPoint({x:event.x,y:event.y}),dst=snapPt||mapView.toMap({x:event.x,y:event.y}),tmpl=copyTemplateFeature.geometry;let newGeom;if(tmpl.type==='point')newGeom={type:'point',x:dst.x,y:dst.y,spatialReference:tmpl.spatialReference||mapView.spatialReference};else if(tmpl.type==='polyline'){const first=tmpl.paths[0][0],dx=dst.x-first[0],dy=dst.y-first[1];newGeom={type:'polyline',paths:tmpl.paths.map(p=>p.map(v=>[v[0]+dx,v[1]+dy])),spatialReference:tmpl.spatialReference};}else if(tmpl.type==='polygon'){const centroid=calcPolygonCentroid(tmpl.rings[0]),dx=dst.x-centroid.x,dy=dst.y-centroid.y;newGeom={type:'polygon',rings:tmpl.rings.map(r=>r.map(v=>[v[0]+dx,v[1]+dy])),spatialReference:tmpl.spatialReference};}else{updateStatus(`❌ Unsupported geometry type: ${tmpl.type}`);return;}const attrs=copyAttributesForNewFeature(copyTemplateFeature,copyTemplateLayer);try{const tpl=copyTemplateLayer.templates?.[0];if(tpl?.prototype?.attributes)for(const[k,v]of Object.entries(tpl.prototype.attributes))if(!(k in attrs)&&v!=null)attrs[k]=v;}catch{}updateStatus('Creating copy…');try{const res=await copyTemplateLayer.applyEdits({addFeatures:[{geometry:newGeom,attributes:attrs}]}),r=res.addFeatureResults?.[0];if(r?.objectId||r?.success){copiedCount++;if(copyCountInfo)copyCountInfo.textContent=`✅ ${copiedCount} cop${copiedCount===1?'y':'ies'} created`;updateStatus(`📋 Copy ${copiedCount} placed${snapPt?' (snapped)':''}. Click for more or ESC to clear.`);}else{updateStatus(`❌ Copy failed: ${r?.error?.message||'Unknown error'}`);}}catch(e){console.error('placeCopyFeature error:',e);updateStatus('❌ Error placing copy.');}}
        function clearCopyTemplate(){copyTemplateFeature=null;copyTemplateLayer=null;copyPlacementMode=false;copiedCount=0;if(copyMouseMoveHandler){copyMouseMoveHandler.remove();copyMouseMoveHandler=null;}hideCopySnapIndicator();if(copyTemplateInfo)copyTemplateInfo.style.display='none';if(copyCountInfo)copyCountInfo.textContent='';if(clearCopyTemplateBtn)clearCopyTemplateBtn.disabled=true;mapView.container.style.cursor='crosshair';if(copyMode)updateStatus('📋 Copy mode active. Click any feature on the map as a template.');}
        function enableCopyMode(){if(cutMode)disableCutMode();if(flipMode)disableFlipMode();if(deleteMode)disableDeleteMode();copyMode=true;setActiveModeBtn('copyModeBtn');showCtxPanel('copy');copyKeyHandler=e=>{if(e.key==='Escape'&&copyPlacementMode)clearCopyTemplate();};document.addEventListener('keydown',copyKeyHandler);updateStatus('📋 Copy mode active. Click any feature on the map as a template.');}
        function disableCopyMode(){copyMode=false;clearCopyTemplate();dismissCopyPickerPopup();if(copyKeyHandler){document.removeEventListener('keydown',copyKeyHandler);copyKeyHandler=null;}setActiveModeBtn(currentMode==='point'?'pointMode':'lineMode');showCtxPanel('default');updateStatus(toolActive?`Ready · click a ${currentMode==='point'?'point feature':'line vertex'}.`:'Tool disabled.');}
        async function handleCopyClick(event){if(!copyPlacementMode)await selectCopyTemplate(event);else await placeCopyFeature(event);}

        // ── Flip Direction ────────────────────────────────────────────────────

        async function findLinesAtClick(sp, mp) {
            const candidates=[], seenOids=new Set();
            if(mapView.hitTest){try{const hit=await mapView.hitTest(sp,{include:mapView.map.allLayers.filter(l=>l.type==='feature')});for(const r of hit.results){if(r.graphic?.geometry?.type!=='polyline')continue;const cfg=lineLayers.find(l=>l.id===r.layer.layerId);if(!cfg)continue;const oid=getOid(r.graphic);if(oid!=null&&seenOids.has(oid))continue;if(oid!=null)seenOids.add(oid);candidates.push({feature:r.graphic,layer:r.layer,layerConfig:cfg});}}catch(e){console.error('findLinesAtClick hitTest error:',e);}}
            if(candidates.length===0){const tol=POINT_SNAP_TOLERANCE*(mapView.resolution||1),ext=makeExt(mp.x,mp.y,tol,mapView.spatialReference);await Promise.all(lineLayers.filter(cfg=>cfg.layer.visible).map(async cfg=>{try{const res=await cfg.layer.queryFeatures({geometry:ext,spatialRelationship:'intersects',returnGeometry:true,outFields:['*'],maxRecordCount:20});for(const f of res.features){const seg=findClosestSeg(f.geometry,mp);if(!seg||seg.distance>tol)continue;const oid=getOid(f);if(oid!=null&&seenOids.has(oid))continue;if(oid!=null)seenOids.add(oid);candidates.push({feature:f,layer:cfg.layer,layerConfig:cfg});}}catch(e){console.error(`findLinesAtClick fallback error on ${cfg.name}:`,e);}}))}
            return candidates;
        }

        async function handleFlipClick(event) {
            updateStatus('🔄 Finding line(s) to flip…');
            let linesToFlip=[];
            if(lockedFeature?.featureType==='line'){linesToFlip=[{feature:lockedFeature.feature,layer:lockedFeature.layer,layerConfig:lockedFeature.layerConfig}];}
            else{const sp={x:event.x,y:event.y},mp=mapView.toMap(sp);linesToFlip=await findLinesAtClick(sp,mp);}
            if(!linesToFlip.length){updateStatus('❌ No line found at click location.');return;}
            const lockedOid=lockedFeature?.featureType==='line'?getOid(lockedFeature.feature):null;
            let ok=0,fail=0;
            for(const li of linesToFlip){try{const newPaths=li.feature.geometry.paths.map(p=>[...p].reverse()),newGeom=buildPolyline(li.feature.geometry,newPaths),upd=li.feature.clone();upd.geometry=newGeom;await li.layer.applyEdits({updateFeatures:[upd]});const oid=getOid(li.feature);updateVertexCacheGeom(layerKey(li.layer,li.layerConfig),oid,newGeom);if(lockedOid!=null&&oid===lockedOid)syncLockedFeature(newGeom);ok++;}catch(e){console.error(`handleFlipClick error on ${li.layerConfig.name}:`,e);fail++;}}
            const names=[...new Set(linesToFlip.slice(0,ok).map(l=>l.layerConfig.name))];
            updateStatus(`✅ Flipped ${ok} line(s): ${names.join(', ')}${fail?` · ${fail} failed`:''}`);
            if(vertexHighlightActive)scheduleHighlightRefresh();
        }

        function enableFlipMode(){if(cutMode)disableCutMode();if(copyMode)disableCopyMode();if(deleteMode)disableDeleteMode();flipMode=true;setActiveModeBtn('flipModeBtn');showCtxPanel(null);if(toolActive){const lockHint=lockedFeature?.featureType==='line'?` (locked to ${lockedFeature.layerConfig.name} — click anywhere to flip)`:'';updateStatus(`🔄 Flip mode active. Click any line to reverse its direction${lockHint}.`);}}
        function disableFlipMode(){flipMode=false;setActiveModeBtn(currentMode==='point'?'pointMode':'lineMode');showCtxPanel('default');if(toolActive)updateStatus(`Ready · click a ${currentMode==='point'?'point feature':'line vertex'}.`);}

        // ── Hotkeys ───────────────────────────────────────────────────────────

        function handleHotkey(e) {
            if(!toolActive)return;
            const tag=e.target?.tagName;
            if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||e.target?.isContentEditable)return;
            switch(e.key){
                case 'e':case 'E': e.preventDefault();setPointMode();break;
                case 'q':case 'Q': e.preventDefault();setLineMode();break;
                case ' ':          e.preventDefault();if(!cutMode&&!copyMode&&!flipMode&&!deleteMode)setAddVertexMode();break;
                case 'c':case 'C': e.preventDefault();cutMode?disableCutMode():enableCutMode();break;
                case 'Shift':      e.preventDefault();if(!cutMode&&!copyMode&&!flipMode&&!deleteMode)setDeleteVertexMode();break;
                case 'f':case 'F': e.preventDefault();flipMode?disableFlipMode():enableFlipMode();break;
                case 'a':case 'A': e.preventDefault();arcMode?disableArcMode():enableArcMode();break;
                case 'd':case 'D': e.preventDefault();deleteMode?disableDeleteMode():enableDeleteMode();break;
                case 'z':case 'Z':
                    e.preventDefault();
                    if(!cutMode&&!copyMode&&!deleteMode){if(pickingFeatureMode){pickingFeatureMode=false;lockFeatureBtn.classList.remove('smt-picking');if(lockedFeature)lockFeatureBtn.classList.add('smt-locked-btn');lockFeatureBtn.textContent=lockedFeature?'🎯 Re-Pick':'🎯 Pick [Z]';updateStatus(lockedFeature?`🔒 Locked: ${lockedFeature.layerConfig.name}. Pick cancelled.`:"Pick cancelled.");}else{pickingFeatureMode=true;if(selectedFeature)cancelMove();lockFeatureBtn.classList.remove('smt-locked-btn');lockFeatureBtn.classList.add('smt-picking');lockFeatureBtn.textContent='⏳ Click feature…';updateStatus("🖱 Click any point or line feature on the map to lock all edits to it.");}}
                    break;
                case 'x':case 'X': e.preventDefault();if(lockedFeature)releaseLockedFeature();break;
                case 'Escape':
                    e.preventDefault();
                    if(copyPlacementMode)          clearCopyTemplate();
                    else if(cutPreviewMode)         resetCutSelection();
                    else if(arcMode&&arcAnchorMode) { clearArcAnchor(); updateStatus('⌒ Anchor cleared — move mouse to preview full arc, or right-click to set a new anchor.'); }
                    else if(arcMode&&arcWaitingForMidpoint){ resetArcState(); updateStatus('⌒ Arc Fit active — click a line segment to begin.'); }
                    else if(arcMode)                disableArcMode();
                    else if(deleteMode&&delCtxMenu.style.display!=='none'){hideDelContextMenu();clearPickerHoverHighlight();updateStatus('🗑️ Delete mode active. Click any feature to flag it.');}
                    else if(deleteMode)             disableDeleteMode();
                    else if(flipMode)               disableFlipMode();
                    else if(selectedFeature)        cancelMove();
                    break;
            }
        }

        // ── Cut context menu ──────────────────────────────────────────────────

        function showCutContextMenu(mapPoint){const screen=mapView.toScreen(mapPoint),rect=mapView.container.getBoundingClientRect();let left=rect.left+screen.x+14,top=rect.top+screen.y-10;if(left+220>window.innerWidth)left=rect.left+screen.x-220;if(top+280>window.innerHeight)top=window.innerHeight-280;cutCtxMenu.style.left=left+'px';cutCtxMenu.style.top=top+'px';cutCtxMenu.style.display='block';}
        function hideCutContextMenu(){cutCtxMenu.style.display='none';}

        async function findNearbyLinesForCut(pointGeom){const buf=CUT_TOLERANCE_M,{x,y}=pointGeom,bufGeom={type:'polygon',spatialReference:pointGeom.spatialReference,rings:[[[x-buf,y-buf],[x+buf,y-buf],[x+buf,y+buf],[x-buf,y+buf],[x-buf,y-buf]]]},found=[];await Promise.all(lineLayers.filter(cfg=>cfg.layer.visible).map(async cfg=>{try{const res=await cfg.layer.queryFeatures({geometry:bufGeom,spatialRelationship:'intersects',returnGeometry:true,outFields:['*'],maxRecordCount:100});for(const f of res.features){const cutInfos=findAllCutInfos(f.geometry,{x,y},buf);if(cutInfos.length>0)found.push({feature:f,layer:cfg.layer,layerConfig:cfg,cutInfos});}}catch(e){console.error(`findNearbyLinesForCut error on ${cfg.name}:`,e);}}));return found;}

        async function showCutPreview(){
            if(!cutLinesToCut.length){updateStatus(`❌ No lines found within ${Math.round(CUT_TOLERANCE_M*3.28084)} ft of the point.`);resetCutSelection();return;}
            cutPreviewMode=true;cutSelectedIndices=new Set(cutLinesToCut.map((_,i)=>i));
            await ensureGraphicClasses();await ensureCutGraphicsLayer();cutGraphicMap.clear();if(cutGraphicsLayer)cutGraphicsLayer.removeAll();
            const selSym={type:'simple-line',color:[220,53,69,0.95],width:3,style:'dash'},hovSym={type:'simple-line',color:[255,140,0,1],width:4,style:'solid'};
            for(let i=0;i<cutLinesToCut.length;i++){if(_Graphic&&cutGraphicsLayer){const g=new _Graphic({geometry:cutLinesToCut[i].feature.geometry,symbol:selSym});cutGraphicsLayer.add(g);cutGraphicMap.set(i,g);}else await highlightCutGeometry(cutLinesToCut[i].feature.geometry,false);}
            const listEl=cutCtxMenu.querySelector('#cutCtxList');listEl.innerHTML='';
            for(let i=0;i<cutLinesToCut.length;i++){const li=cutLinesToCut[i],oid=getOid(li.feature)??'?',vtx=(li.feature.geometry?.paths??[]).reduce((s,p)=>s+p.length,0),crossings=li.cutInfos.length,row=document.createElement('label');row.style.cssText='display:flex;align-items:flex-start;gap:6px;padding:6px 10px;cursor:pointer;border-bottom:1px solid #1e1935;user-select:none;';const cb=document.createElement('input');cb.type='checkbox';cb.checked=true;cb.dataset.idx=String(i);cb.style.cssText='margin-top:2px;cursor:pointer;flex-shrink:0;';const info=document.createElement('div');info.style.cssText='flex:1;font-size:11px;line-height:1.4;';info.innerHTML=`<strong style="color:#e2d9f3;">${li.layerConfig.name}</strong><div style="color:#7a6d96;font-size:10px;">OID: ${oid} · ${vtx} vertices`+(crossings>1?` · <span style="color:#fbbf24;">⚠ ${crossings} crossings → ${crossings+1} segments</span>`:'')+`</div>`;const dot=document.createElement('span');dot.textContent='●';dot.style.cssText='color:#ef4444;font-size:14px;flex-shrink:0;margin-top:1px;';cb.addEventListener('change',()=>{const idx=parseInt(cb.dataset.idx),g=cutGraphicMap.get(idx);if(cb.checked){cutSelectedIndices.add(idx);dot.style.color='#ef4444';if(g&&cutGraphicsLayer)cutGraphicsLayer.add(g);}else{cutSelectedIndices.delete(idx);dot.style.color='#3d3268';if(g&&cutGraphicsLayer)cutGraphicsLayer.remove(g);}updateCutExecuteBtn();});row.addEventListener('mouseenter',()=>{const g=cutGraphicMap.get(i);if(g&&cutSelectedIndices.has(i))g.symbol=hovSym;row.style.background='#2d1b69';});row.addEventListener('mouseleave',()=>{const g=cutGraphicMap.get(i);if(g&&cutSelectedIndices.has(i))g.symbol=selSym;row.style.background='';});row.appendChild(cb);row.appendChild(info);row.appendChild(dot);listEl.appendChild(row);}
            const selectAllBtn=cutCtxMenu.querySelector('#cutCtxSelectAll');if(selectAllBtn){selectAllBtn.onclick=()=>{const allOn=cutSelectedIndices.size===cutLinesToCut.length;[...listEl.querySelectorAll('label')].forEach((row,i)=>{const cb=row.querySelector('input'),dot=row.querySelector('span'),g=cutGraphicMap.get(i),was=cutSelectedIndices.has(i);cb.checked=!allOn;if(!allOn&&!was){cutSelectedIndices.add(i);if(dot)dot.style.color='#ef4444';if(g&&cutGraphicsLayer)cutGraphicsLayer.add(g);}else if(allOn&&was){cutSelectedIndices.delete(i);if(dot)dot.style.color='#3d3268';if(g&&cutGraphicsLayer)cutGraphicsLayer.remove(g);}});selectAllBtn.textContent=allOn?'✓ All':'✗ None';updateCutExecuteBtn();};}
            cutCtxMenu.querySelector('#cutCtxCount').textContent=cutLinesToCut.length;updateCutExecuteBtn();showCutContextMenu(cutSelectedPoint.geometry);
            updateStatus(`✂️ ${cutLinesToCut.length} line(s) found. Check/uncheck lines to cut, then confirm.`);
        }

        function updateCutExecuteBtn(){const btn=cutCtxMenu.querySelector('#cutCtxExecute');if(!btn||cutProcessing)return;const n=cutSelectedIndices.size;btn.textContent=`✂ Execute Cut (${n})`;btn.disabled=n===0;}

        async function executeCut(){
            const linesToProcess=cutLinesToCut.filter((_,i)=>cutSelectedIndices.has(i));if(!linesToProcess.length||cutProcessing)return;
            cutProcessing=true;const snapPt={x:cutSelectedPoint.geometry.x,y:cutSelectedPoint.geometry.y},lineCount=linesToProcess.length;
            hideCutContextMenu();clearCutHighlights();cutLinesToCut=[];cutSelectedPoint=null;cutSelectedPointLayer=null;cutPreviewMode=false;cutSelectedIndices.clear();cutGraphicMap.clear();
            updateStatus(`✂️ Cutting ${lineCount} line(s) in background — you can continue working.`);
            (async()=>{let ok=0,fail=0,totalCreated=0;for(const li of linesToProcess){try{const snapPtGeom={x:snapPt.x,y:snapPt.y},segments=splitLineMulti(li.feature.geometry,li.cutInfos,snapPtGeom);if(segments.length<2){fail++;continue;}const updFeature=li.feature.clone();updFeature.geometry=segments[0];updFeature.attributes.calculated_length=geodeticLength(segments[0]);const newFeatures=segments.slice(1).map(seg=>{const attrs={...li.feature.attributes};['objectid','OBJECTID','gis_id','GIS_ID','globalid','GLOBALID','created_date','last_edited_date'].forEach(f=>delete attrs[f]);attrs.calculated_length=geodeticLength(seg);return{geometry:seg,attributes:attrs};});const res=await li.layer.applyEdits({updateFeatures:[updFeature],addFeatures:newFeatures}),updErr=res.updateFeatureResults?.[0]?.error,addErrs=res.addFeatureResults?.filter(r=>r.error)??[];if(!updErr&&addErrs.length===0){updateVertexCacheGeom(layerKey(li.layer,li.layerConfig),getOid(li.feature),segments[0]);ok++;totalCreated+=newFeatures.length;}else{console.error('executeCut error:',updErr,addErrs);fail++;}}catch(e){console.error(`executeCut error (${li.layerConfig.name}):`,e);fail++;}}cutProcessing=false;updateStatus(ok?`✅ ${ok} line(s) cut into ${ok+totalCreated} segments${fail?` · ${fail} failed`:''}.`:`❌ All ${fail} cut(s) failed.`);})();
        }

        async function handleCutClick(event){
            if(cutPreviewMode||cutProcessing)return;clearCutHighlights();hideCutContextMenu();updateStatus('Searching for cut location…');
            const sp={x:event.x,y:event.y},mp=mapView.toMap(sp),ext=makeExt(mp.x,mp.y,POINT_SNAP_TOLERANCE*(mapView.resolution||1),mapView.spatialReference);
            let ptResult=null;
            if(mapView.hitTest){const hit=await mapView.hitTest(sp,{include:mapView.map.allLayers.filter(l=>l.type==='feature')});for(const r of hit.results){if(r.graphic?.geometry?.type==='point'){const cfg=pointLayers.find(p=>p.id===r.layer.layerId);if(cfg){ptResult={feature:r.graphic,layer:r.layer,layerConfig:cfg};break;}}}}
            if(!ptResult){const results=await Promise.all(pointLayers.filter(cfg=>cfg.layer.visible).map(async cfg=>{try{const res=await cfg.layer.queryFeatures({geometry:ext,spatialRelationship:'intersects',returnGeometry:true,outFields:['*']});return{cfg,features:res.features};}catch(e){return{cfg,features:[]};}}));let best=null,bestD=Infinity;for(const{cfg,features}of results){for(const f of features){if(!f.geometry)continue;const d=calcDist(mp,f.geometry);if(d<bestD){bestD=d;best={feature:f,layer:cfg.layer,layerConfig:cfg};}}}if(best)ptResult=best;}
            if(ptResult){cutSelectedPoint=ptResult.feature;cutSelectedPointLayer=ptResult.layer;await highlightCutGeometry(cutSelectedPoint.geometry,true);updateStatus(`📍 ${ptResult.layerConfig.name} selected. Searching for nearby lines…`);cutLinesToCut=await findNearbyLinesForCut(cutSelectedPoint.geometry);showCutPreview();return;}
            const vtxResults=await findCoincidentLineVertices(sp);
            if(vtxResults.length>0){const vtx=vtxResults[0].vertex,vtxGeom={type:'point',x:vtx.coordinates.x,y:vtx.coordinates.y,spatialReference:vtxResults[0].feature.geometry.spatialReference||mapView.spatialReference};cutSelectedPoint={geometry:vtxGeom,attributes:{}};cutSelectedPointLayer=null;const layerNames=[...new Set(vtxResults.map(r=>r.layerConfig.name))].join(', ');await highlightCutGeometry(vtxGeom,true);updateStatus(`📍 Vertex on ${layerNames} selected. Searching for nearby lines…`);cutLinesToCut=await findNearbyLinesForCut(vtxGeom);showCutPreview();return;}
            updateStatus('❌ No point feature or line vertex found. Click closer to a point or vertex.');
        }

        function resetCutSelection(){cutSelectedPoint=null;cutSelectedPointLayer=null;cutLinesToCut=[];cutPreviewMode=false;cutSelectedIndices.clear();cutGraphicMap.clear();clearCutHighlights();hideCutContextMenu();if(cutMode)updateStatus('✂️ Cut mode active. Click a point feature or line vertex to cut nearby lines.');}
        function enableCutMode(){if(flipMode)disableFlipMode();if(copyMode)disableCopyMode();if(deleteMode)disableDeleteMode();cutMode=true;setActiveModeBtn('cutModeBtn');showCtxPanel('cut');if(cutModeInfo)cutModeInfo.textContent='';updateStatus('✂️ Cut mode active. Click a point feature or line vertex to cut nearby lines.');}
        function disableCutMode(){cutMode=false;cutPreviewMode=false;cutProcessing=false;resetCutSelection();setActiveModeBtn(currentMode==='point'?'pointMode':'lineMode');showCtxPanel('default');if(cutModeInfo)cutModeInfo.textContent='';updateStatus(toolActive?`Ready · click a ${currentMode==='point'?'point feature':'line vertex'}.`:'Tool disabled.');}

        // ── Cut geometry helpers ──────────────────────────────────────────────

        function findAllCutInfos(lineGeom,snapPt,tolerance){if(!lineGeom?.paths?.length)return[];const hits=[];for(let pi=0;pi<lineGeom.paths.length;pi++){const path=lineGeom.paths[pi];for(let si=0;si<path.length-1;si++){const a={x:path[si][0],y:path[si][1]},b={x:path[si+1][0],y:path[si+1][1]},res=closestPtOnSeg(snapPt,a,b);if(res.distance<=tolerance)hits.push({pathIdx:pi,segIdx:si,dist:res.distance});}}return hits.sort((a,b)=>a.pathIdx-b.pathIdx||a.segIdx-b.segIdx);}
        function splitLineMulti(lineGeom,sortedCutInfos,snapPt){if(!sortedCutInfos.length)return[];const snap=[snapPt.x,snapPt.y],cutsByPath=new Map();for(const ci of sortedCutInfos){if(!cutsByPath.has(ci.pathIdx))cutsByPath.set(ci.pathIdx,[]);cutsByPath.get(ci.pathIdx).push(ci.segIdx);}const outputSegments=[];let currentPaths=[],currentVerts=[];for(let pi=0;pi<lineGeom.paths.length;pi++){const path=lineGeom.paths[pi],cutsHere=(cutsByPath.get(pi)||[]).slice().sort((a,b)=>a-b);let vi=0;for(const si of cutsHere){for(let i=vi;i<=si&&i<path.length;i++)currentVerts.push([...path[i]]);currentVerts.push([...snap]);if(currentVerts.length>=2)currentPaths.push(currentVerts.slice());if(currentPaths.length)outputSegments.push(currentPaths.slice());currentPaths=[];currentVerts=[[...snap]];vi=si+1;}for(let i=vi;i<path.length;i++)currentVerts.push([...path[i]]);if(pi<lineGeom.paths.length-1){if(currentVerts.length>=2)currentPaths.push(currentVerts.slice());currentVerts=[];}}if(currentVerts.length>=2)currentPaths.push(currentVerts.slice());if(currentPaths.length)outputSegments.push(currentPaths.slice());return outputSegments.filter(paths=>paths.length>0&&paths.every(p=>p.length>=2)).map(paths=>buildPolyline(lineGeom,paths)).filter(g=>geodeticLength(g)>=MIN_SEGMENT_LEN_FT);}

        // ── Shared graphics helpers ───────────────────────────────────────────

        async function ensureCutGraphicsLayer(){if(cutGraphicsLayer)return;await ensureGraphicClasses();if(!_GraphicsLayer)return;cutGraphicsLayer=new _GraphicsLayer({listMode:'hide'});mapView.map.add(cutGraphicsLayer);}
        function clearCutHighlights(){if(cutGraphicsLayer)cutGraphicsLayer.removeAll();}
        async function highlightCutGeometry(geometry,isPoint){await ensureCutGraphicsLayer();if(!cutGraphicsLayer||!_Graphic)return;cutGraphicsLayer.add(new _Graphic({geometry,symbol:isPoint?{type:'simple-marker',style:'circle',color:[255,200,0,0.85],size:16,outline:{color:[180,80,0],width:2.5}}:{type:'simple-line',color:[255,80,0,0.9],width:3,style:'dash'}}));}

        // ── Delete (soft) ─────────────────────────────────────────────────────

        function getDeleteFieldName(layer){if(!layer?.fields)return null;const m=layer.fields.find(f=>f.name.toLowerCase()===DELETE_FIELD.toLowerCase());return m?m.name:null;}
        async function findAllFeaturesAtClick(sp,mp){const candidates=[],seenOids=new Set(),allCfgs=[...pointLayers,...lineLayers].sort((a,b)=>a.name.localeCompare(b.name)),hitLayerIds=new Set();if(mapView.hitTest){try{const hit=await mapView.hitTest(sp,{include:mapView.map.allLayers.filter(l=>l.type==='feature')});for(const r of hit.results){if(!r.graphic?.geometry)continue;const cfg=allCfgs.find(c=>c.id===r.layer.layerId);if(!cfg)continue;hitLayerIds.add(cfg.id);const oid=getOid(r.graphic);if(oid!=null&&seenOids.has(oid))continue;if(oid!=null)seenOids.add(oid);candidates.push({feature:r.graphic,layer:r.layer,layerConfig:cfg});}}catch(e){console.error('findAllFeaturesAtClick hitTest error:',e);}}const uncoveredCfgs=allCfgs.filter(c=>!hitLayerIds.has(c.id)&&c.layer.visible);if(uncoveredCfgs.length>0){const tol=POINT_SNAP_TOLERANCE*(mapView.resolution||1),ext=makeExt(mp.x,mp.y,tol,mapView.spatialReference);await Promise.all(uncoveredCfgs.map(async cfg=>{try{const res=await cfg.layer.queryFeatures({geometry:ext,spatialRelationship:'intersects',returnGeometry:true,outFields:['*'],maxRecordCount:20});for(const f of res.features){if(!f.geometry)continue;const oid=getOid(f);if(oid!=null&&seenOids.has(oid))continue;if(oid!=null)seenOids.add(oid);candidates.push({feature:f,layer:cfg.layer,layerConfig:cfg});}}catch(e){console.error(`findAllFeaturesAtClick fallback error on ${cfg.name}:`,e);}}))}return candidates;}
        function showDelContextMenu(mapPoint){const screen=mapView.toScreen(mapPoint),rect=mapView.container.getBoundingClientRect();let left=rect.left+screen.x+14,top=rect.top+screen.y-10;if(left+240>window.innerWidth)left=rect.left+screen.x-240;if(top+320>window.innerHeight)top=window.innerHeight-320;delCtxMenu.style.left=left+'px';delCtxMenu.style.top=top+'px';delCtxMenu.style.display='block';}
        function hideDelContextMenu(){delCtxMenu.style.display='none';}
        function updateDelExecuteBtn(){const btn=delCtxMenu.querySelector('#delCtxExecute');if(!btn||deleteProcessing)return;const n=deleteSelectedIndices.size;btn.textContent=`🗑️ Mark as Deleted (${n})`;btn.disabled=n===0;}
        async function handleDeleteClick(event){if(deleteProcessing)return;hideDelContextMenu();updateStatus('🗑️ Finding features at click location…');const sp={x:event.x,y:event.y},mp=mapView.toMap(sp);deleteCandidates=await findAllFeaturesAtClick(sp,mp);if(!deleteCandidates.length){updateStatus('❌ No features found at this location.');return;}const eligible=deleteCandidates.filter(c=>getDeleteFieldName(c.layer)!==null),ineligible=deleteCandidates.length-eligible.length;if(!eligible.length){updateStatus(`❌ None of the ${deleteCandidates.length} feature(s) found have a "${DELETE_FIELD}" field.`);return;}deleteCandidates=eligible;deleteSelectedIndices=new Set(deleteCandidates.map((_,i)=>i));const listEl=delCtxMenu.querySelector('#delCtxList');listEl.innerHTML='';const typeIcon=t=>t==='point'?'📍':t==='polyline'?'〰️':'⬡';for(let i=0;i<deleteCandidates.length;i++){const c=deleteCandidates[i],oid=getOid(c.feature)??'?',gtype=c.feature.geometry?.type??'unknown',fieldName=getDeleteFieldName(c.layer),curVal=c.feature.attributes?.[fieldName]??'null',alreadyDeleted=String(curVal).toUpperCase()==='YES',row=document.createElement('label');row.style.cssText='display:flex;align-items:flex-start;gap:6px;padding:6px 10px;cursor:pointer;border-bottom:1px solid #1e1935;user-select:none;';const cb=document.createElement('input');cb.type='checkbox';cb.checked=true;cb.dataset.idx=String(i);cb.style.cssText='margin-top:2px;cursor:pointer;flex-shrink:0;';const info=document.createElement('div');info.style.cssText='flex:1;font-size:11px;line-height:1.5;';info.innerHTML=`<strong style="color:${alreadyDeleted?'#fca5a5':'#e2d9f3'};">${typeIcon(gtype)} ${c.layerConfig.name}</strong><div style="color:#7a6d96;font-size:10px;">OID: ${oid} · ${DELETE_FIELD}: ${curVal}${alreadyDeleted?' ⚠️ already flagged':''}</div>`;const dot=document.createElement('span');dot.textContent='●';dot.style.cssText='color:#ef4444;font-size:14px;flex-shrink:0;margin-top:1px;';cb.addEventListener('change',()=>{const idx=parseInt(cb.dataset.idx);if(cb.checked){deleteSelectedIndices.add(idx);dot.style.color='#ef4444';}else{deleteSelectedIndices.delete(idx);dot.style.color='#3d3268';}updateDelExecuteBtn();});row.addEventListener('mouseenter',()=>{row.style.background='#2d1b0a';showPickerHoverHighlight(c.feature.geometry);});row.addEventListener('mouseleave',()=>{row.style.background='';clearPickerHoverHighlight();});row.appendChild(cb);row.appendChild(info);row.appendChild(dot);listEl.appendChild(row);}delCtxMenu.querySelector('#delCtxCount').textContent=deleteCandidates.length;const selAllBtn=delCtxMenu.querySelector('#delCtxSelectAll');if(selAllBtn){selAllBtn.textContent='✓ All';selAllBtn.onclick=()=>{const rows=[...listEl.querySelectorAll('label')],allOn=deleteSelectedIndices.size===deleteCandidates.length;rows.forEach((_,i)=>{const cb=rows[i].querySelector('input'),dot=rows[i].querySelector('span');cb.checked=!allOn;if(!allOn){deleteSelectedIndices.add(i);if(dot)dot.style.color='#ef4444';}else{deleteSelectedIndices.delete(i);if(dot)dot.style.color='#3d3268';}});selAllBtn.textContent=allOn?'✓ All':'✗ None';updateDelExecuteBtn();};}updateDelExecuteBtn();showDelContextMenu(mp);updateStatus(`🗑️ ${deleteCandidates.length} eligible feature(s)${ineligible>0?` · ${ineligible} skipped (no ${DELETE_FIELD} field)`:''}.`);}
        async function executeDelete(){const toDelete=deleteCandidates.filter((_,i)=>deleteSelectedIndices.has(i));if(!toDelete.length||deleteProcessing)return;deleteProcessing=true;delCtxMenu.querySelector('#delCtxExecute').disabled=true;delCtxMenu.querySelector('#delCtxCancel').disabled=true;updateStatus('🗑️ Flagging features…');let ok=0,fail=0;for(const c of toDelete){const fieldName=getDeleteFieldName(c.layer);if(!fieldName){fail++;continue;}try{const upd=c.feature.clone();upd.attributes[fieldName]='YES';await c.layer.applyEdits({updateFeatures:[upd]});ok++;}catch(e){console.error(`executeDelete error on ${c.layerConfig.name}:`,e);fail++;}}const names=[...new Set(toDelete.slice(0,ok).map(c=>c.layerConfig.name))];updateStatus(ok?`✅ Flagged ${ok} feature(s) as deleted: ${names.join(', ')}${fail?` · ${fail} failed`:''}.`:`❌ All ${fail} flag(s) failed.`);deleteProcessing=false;delCtxMenu.querySelector('#delCtxExecute').disabled=false;delCtxMenu.querySelector('#delCtxCancel').disabled=false;hideDelContextMenu();clearPickerHoverHighlight();deleteCandidates=[];deleteSelectedIndices.clear();setTimeout(()=>{if(deleteMode)updateStatus('🗑️ Delete mode active. Click any feature to flag it.');},3000);}
        function enableDeleteMode(){if(cutMode)disableCutMode();if(copyMode)disableCopyMode();if(flipMode)disableFlipMode();deleteMode=true;setActiveModeBtn('deleteModeBtn',true);showCtxPanel('delete');if(toolActive)updateStatus('🗑️ Delete mode active. Click any feature to flag it.');}
        function disableDeleteMode(){deleteMode=false;deleteProcessing=false;hideDelContextMenu();clearPickerHoverHighlight();deleteCandidates=[];deleteSelectedIndices.clear();setActiveModeBtn(currentMode==='point'?'pointMode':'lineMode');showCtxPanel('default');if(toolActive)updateStatus(`Ready · click a ${currentMode==='point'?'point feature':'line vertex'}.`);}

        // ── Feature picker popup ──────────────────────────────────────────────

        function dismissPickerPopup(){if(pickerPopup){pickerPopup.remove();pickerPopup=null;}clearPickerHoverHighlight();}
        function showFeaturePickerPopup(candidates,pageX,pageY){dismissPickerPopup();const popup=document.createElement("div");pickerPopup=popup;popup.style.cssText=`position:fixed;z-index:${z+1};background:#0f0d1a;border:1px solid #3a3060;border-radius:4px;box-shadow:0 4px 18px rgba(0,0,0,0.5);font:12px/1.4 Arial,sans-serif;min-width:220px;max-width:300px;max-height:320px;overflow-y:auto;color:#e2d9f3;`;let left=pageX+12,top=pageY-10;if(left+310>window.innerWidth)left=pageX-310;if(top+340>window.innerHeight)top=window.innerHeight-340-12;if(top<12)top=12;popup.style.left=left+"px";popup.style.top=top+"px";const header=document.createElement("div");header.style.cssText="padding:7px 10px 5px;font-weight:bold;font-size:11px;color:#d4bbff;border-bottom:1px solid #2d2550;display:flex;justify-content:space-between;align-items:center;background:#2d1b69;";header.innerHTML=`<span>🗂 ${candidates.length} overlapping features</span>`;const closeX=document.createElement("span");closeX.textContent="✕";closeX.style.cssText="cursor:pointer;color:#9b8ec4;font-size:13px;padding:0 2px;";closeX.onclick=()=>{dismissPickerPopup();pickingFeatureMode=false;lockFeatureBtn.classList.remove('smt-picking');if(lockedFeature)lockFeatureBtn.classList.add('smt-locked-btn');lockFeatureBtn.textContent=lockedFeature?'🎯 Re-Pick':'🎯 Pick [Z]';updateStatus(lockedFeature?`🔒 Locked: ${lockedFeature.layerConfig.name}.`:"Pick cancelled.");};header.appendChild(closeX);popup.appendChild(header);candidates.forEach(c=>{const row=document.createElement("div");row.style.cssText="padding:6px 10px;cursor:pointer;border-bottom:1px solid #1e1935;display:flex;flex-direction:column;gap:2px;";row.onmouseenter=()=>{row.style.background="#2d1b69";showPickerHoverHighlight(c.feature.geometry);};row.onmouseleave=()=>{row.style.background="";clearPickerHoverHighlight();};const oid=getOid(c.feature)??"?",typeIcon=c.featureType==='point'?'📍':'〰️',title=document.createElement("div"),meta=document.createElement("div");title.style.cssText="font-weight:bold;color:#e2d9f3;font-size:11px;";title.textContent=`${typeIcon} ${c.layerConfig.name}`;meta.style.cssText="color:#7a6d96;font-size:10px;";if(c.featureType==='line'){const vtxCount=(c.feature.geometry?.paths??[]).reduce((s,p)=>s+p.length,0),paths=(c.feature.geometry?.paths??[]).length;meta.textContent=`OID: ${oid}  ·  ${vtxCount} vertices  ·  ${paths} path(s)`;}else meta.textContent=`OID: ${oid}  ·  Point feature`;row.appendChild(title);row.appendChild(meta);row.onclick=()=>{dismissPickerPopup();applyLock(c.feature,c.layer,c.layerConfig,c.featureType,true);};popup.appendChild(row);});document.body.appendChild(popup);setTimeout(()=>{document.addEventListener("click",function outsideClick(e){if(!popup.contains(e.target)&&!delCtxMenu.contains(e.target)){dismissPickerPopup();document.removeEventListener("click",outsideClick);}});},0);}

        // ── Locked feature helpers ────────────────────────────────────────────

        function syncLockedFeature(newGeom){if(!lockedFeature||!newGeom)return;try{if(lockedFeature.feature?.clone){const c=lockedFeature.feature.clone();c.geometry=newGeom;lockedFeature.feature=c;}else if(lockedFeature.feature)lockedFeature.feature.geometry=newGeom;}catch(e){console.warn('syncLockedFeature:',e);}}

        async function applyLock(feature, layer, cfg, featureType='line', explicitPick=false) {
            lockedFeature={feature,layer,layerConfig:cfg,featureType};pickingFeatureMode=false;
            const typeIcon=featureType==='point'?'📍':'〰️';
            if(lockedFeatureInfo){lockedFeatureInfo.textContent=`${typeIcon} ${cfg.name} · OID ${getOid(feature)??'?'}`;lockedFeatureInfo.className='smt-locked';}
            if(lockFeatureBtn){lockFeatureBtn.classList.remove('smt-picking');lockFeatureBtn.classList.add('smt-locked-btn');lockFeatureBtn.textContent='🎯 Re-Pick';}
            if(releaseFeatureBtn)releaseFeatureBtn.disabled=false;
            if(vertexHighlightActive)scheduleHighlightRefresh();
            if(featureType==='line'){if(flipMode){updateStatus(`🔒 Locked to ${cfg.name}. Click anywhere to flip its direction.`);return;}setLineMode();updateStatus(`🔒 Locked to ${cfg.name}. Click any vertex to select it, then click the destination.`);}
            else{
                setPointMode();
                if(toolActive){
                    updateStatus(`🔒 Locked to ${cfg.name}. Preparing…`);
                    const[preFetchedConnected,preFetchedColocated]=await Promise.all([findConnectedLines(feature.geometry),explicitPick?Promise.resolve([]):findColocatedPoints(feature.geometry,getOid(feature))]);
                    lockedFeature.preloaded={connectedFeatures:preFetchedConnected,colocatedPoints:preFetchedColocated};
                    selectedFeature=feature;selectedLayer=layer;selectedLayerConfig=cfg;selectedVertex=null;waitingForDestination=true;
                    connectedFeatures=preFetchedConnected;colocatedPoints=preFetchedColocated;
                    if(feature.geometry?.clone)originalGeometries.set(getOid(feature)??'locked',feature.geometry.clone());
                    for(const info of preFetchedConnected)if(info.feature.geometry?.clone)originalGeometries.set(info.feature.attributes.objectid,info.feature.geometry.clone());
                    if(cancelBtn)cancelBtn.disabled=false;

                    // Preview: stretch connected lines to cursor; data already available
                    startMovePreview(
                        {x:feature.geometry.x,y:feature.geometry.y,spatialReference:feature.geometry.spatialReference},
                        new Set([getOid(feature),...preFetchedColocated.map(p=>getOid(p.feature))].filter(Boolean)),
                        {mode:'point', connectedLines:preFetchedConnected}
                    );

                    const connNote=preFetchedConnected.length?` · ${preFetchedConnected.length} connected`:'',colocNote=preFetchedColocated.length?` · ${preFetchedColocated.length} co-located will move`:'';
                    updateStatus(`🔒 Locked to ${cfg.name}${connNote}${colocNote}. Click destination.`);
                }else{updateStatus(`🔒 Locked to ${cfg.name}. Enable the tool then click the destination.`);}
            }
        }

        function releaseLockedFeature(){dismissPickerPopup();lockedFeature=null;pickingFeatureMode=false;if(lockedFeatureInfo){lockedFeatureInfo.textContent='No lock active';lockedFeatureInfo.className='';}if(lockFeatureBtn){lockFeatureBtn.classList.remove('smt-picking','smt-locked-btn');lockFeatureBtn.textContent='🎯 Pick [Z]';}if(releaseFeatureBtn)releaseFeatureBtn.disabled=true;if(vertexHighlightActive)scheduleHighlightRefresh();updateStatus(toolActive?`Feature released. Click on a ${currentMode==="point"?"point feature":"line vertex"}.`:"Feature released.");}

        async function pickFeature(event){const sp={x:event.x,y:event.y};updateStatus("Looking for feature...");try{const candidates=[],seenOids=new Set();if(mapView.hitTest){const hit=await mapView.hitTest(sp,{include:mapView.map.allLayers.filter(l=>l.type==="feature")});for(const r of hit.results){const gtype=r.graphic?.geometry?.type;if(gtype==="polyline"){const cfg=lineLayers.find(l=>l.id===r.layer.layerId);if(!cfg)continue;const oid=getOid(r.graphic);if(oid!=null&&seenOids.has(oid))continue;if(oid!=null)seenOids.add(oid);candidates.push({feature:r.graphic,layer:r.layer,layerConfig:cfg,featureType:'line'});}else if(gtype==="point"||gtype==="multipoint"){const cfg=pointLayers.find(p=>p.id===r.layer.layerId);if(!cfg)continue;const oid=getOid(r.graphic);if(oid!=null&&seenOids.has(oid))continue;if(oid!=null)seenOids.add(oid);candidates.push({feature:r.graphic,layer:r.layer,layerConfig:cfg,featureType:'point'});}}}if(candidates.length===0){const mp=mapView.toMap(sp),ext=makeExt(mp.x,mp.y,30,mapView.spatialReference);await Promise.all([...lineLayers,...pointLayers].filter(cfg=>cfg.layer.visible).map(async cfg=>{try{const res=await cfg.layer.queryFeatures({geometry:ext,spatialRelationship:"intersects",returnGeometry:true,outFields:["*"],maxRecordCount:20});const ft=lineLayers.includes(cfg)?'line':'point';for(const f of res.features){const oid=getOid(f);if(oid!=null&&seenOids.has(oid))continue;if(oid!=null)seenOids.add(oid);candidates.push({feature:f,layer:cfg.layer,layerConfig:cfg,featureType:ft});}}catch(e){console.error(`pickFeature fallback on ${cfg.name}:`,e);}}))}if(candidates.length===0){updateStatus("❌ No feature found. Click directly on a point or line feature.");return;}if(candidates.length===1)applyLock(candidates[0].feature,candidates[0].layer,candidates[0].layerConfig,candidates[0].featureType);else{const rect=mapView.container.getBoundingClientRect();showFeaturePickerPopup(candidates,rect.left+sp.x,rect.top+sp.y);updateStatus(`🗂 ${candidates.length} overlapping features found.`);}}catch(e){console.error("pickFeature error:",e);updateStatus("❌ Error picking feature.");}}

        // ── Layer query helpers ───────────────────────────────────────────────

        async function findNearestPointFeature(mapPt){try{const tol=POINT_SNAP_TOLERANCE*(mapView.resolution||1),ext=makeExt(mapPt.x,mapPt.y,tol,mapView.spatialReference),results=await Promise.all(pointLayers.filter(cfg=>cfg.layer.visible).map(async cfg=>{try{const res=await cfg.layer.queryFeatures({geometry:ext,spatialRelationship:"intersects",returnGeometry:true,outFields:["*"]});return{cfg,features:res.features};}catch(e){return{cfg,features:[]};}}));let nearest=null,minD=Infinity;for(const{cfg,features}of results)for(const f of features){if(!f.geometry)continue;const d=calcDist(mapPt,f.geometry);if(d<minD){minD=d;nearest={feature:f,layer:cfg.layer,layerConfig:cfg,distance:d,geometry:f.geometry};}}return(nearest&&nearest.distance<tol)?nearest:null;}catch(e){console.error("findNearestPointFeature error:",e);return null;}}
        async function findNearestLineVertex(dst,excludeOids=new Set()){try{const tol=POINT_SNAP_TOLERANCE*(mapView.resolution||1),ext=makeExt(dst.x,dst.y,tol,mapView.spatialReference),results=await Promise.all(lineLayers.filter(cfg=>cfg.layer.visible).map(async cfg=>{try{const res=await cfg.layer.queryFeatures({geometry:ext,spatialRelationship:"intersects",returnGeometry:true,outFields:["objectid"],outSpatialReference:mapView.spatialReference});return{cfg,features:res.features};}catch(e){return{cfg,features:[]};}}));let nearest=null,minD=Infinity,nearestCfg=null;for(const{cfg,features}of results)for(const f of features){if(excludeOids.has(getOid(f))||!f.geometry?.paths)continue;for(const path of f.geometry.paths)for(const coord of path){const d=calcDist(dst,{x:coord[0],y:coord[1]});if(d<minD){minD=d;nearest={x:coord[0],y:coord[1],spatialReference:dst.spatialReference};nearestCfg=cfg;}}}return(nearest&&minD<tol)?{geometry:nearest,layerConfig:nearestCfg,snapType:'lineVertex'}:null;}catch(e){console.error("findNearestLineVertex error:",e);return null;}}
        async function findNearestPointOnLine(dst,excludeOids=new Set()){try{const tol=POINT_SNAP_TOLERANCE*(mapView.resolution||1),ext=makeExt(dst.x,dst.y,tol,mapView.spatialReference),results=await Promise.all(lineLayers.filter(cfg=>cfg.layer.visible).map(async cfg=>{try{const res=await cfg.layer.queryFeatures({geometry:ext,spatialRelationship:'intersects',returnGeometry:true,outFields:['objectid'],outSpatialReference:mapView.spatialReference});return{cfg,features:res.features};}catch(e){return{cfg,features:[]};}}));let nearest=null,minD=Infinity,nearestCfg=null;for(const{cfg,features}of results){for(const f of features){if(excludeOids.has(getOid(f))||!f.geometry?.paths)continue;const seg=findClosestSeg(f.geometry,dst);if(seg&&seg.distance<minD&&seg.distance<tol){minD=seg.distance;nearest={x:seg.point.x,y:seg.point.y,spatialReference:dst.spatialReference};nearestCfg=cfg;}}}return nearest?{geometry:nearest,layerConfig:nearestCfg,snapType:'lineSegment'}:null;}catch(e){console.error('findNearestPointOnLine error:',e);return null;}}
        async function findSnapTarget(dst,excludeOids=new Set()){const[ps,vs,ls]=await Promise.all([findNearestPointFeature(dst),findNearestLineVertex(dst,excludeOids),findNearestPointOnLine(dst,excludeOids)]);const candidates=[ps?{...ps,snapType:'pointFeature',dist:calcDist(dst,ps.geometry)}:null,vs?{...vs,dist:calcDist(dst,vs.geometry)}:null,ls?{...ls,dist:calcDist(dst,ls.geometry)}:null].filter(Boolean);if(!candidates.length)return null;return candidates.reduce((best,c)=>c.dist<best.dist?c:best);}
        async function findPointFeatureAtLocation(sp){try{if(mapView.hitTest){const hit=await mapView.hitTest(sp,{include:mapView.map.allLayers.filter(l=>l.type==="feature")});for(const r of hit.results)if(r.graphic?.geometry?.type==="point"){const cfg=pointLayers.find(p=>p.id===r.layer.layerId);if(cfg)return{feature:r.graphic,layer:r.layer,layerConfig:cfg};}}const mp=mapView.toMap(sp),tol=SNAP_TOLERANCE*(mapView.resolution||1),ext=makeExt(mp.x,mp.y,tol,mapView.spatialReference),results=await Promise.all(pointLayers.filter(cfg=>cfg.layer.visible).map(async cfg=>{try{const res=await cfg.layer.queryFeatures({geometry:ext,spatialRelationship:"intersects",returnGeometry:true,outFields:["*"]});return{cfg,features:res.features};}catch(e){return{cfg,features:[]};}}));let best=null,bestD=Infinity;for(const{cfg,features}of results)for(const f of features){if(!f.geometry)continue;const d=calcDist(mp,f.geometry);if(d<bestD){bestD=d;best={feature:f,layer:cfg.layer,layerConfig:cfg};}}return best;}catch(e){console.error("findPointFeatureAtLocation error:",e);return null;}}
        async function findColocatedPoints(ptGeom,primaryOid){const ext=makeExt(ptGeom.x,ptGeom.y,COLOC_BUF_M,ptGeom.spatialReference),results=await Promise.all(pointLayers.filter(cfg=>cfg.layer.visible).map(async cfg=>{try{const res=await cfg.layer.queryFeatures({geometry:ext,spatialRelationship:'intersects',returnGeometry:true,outFields:['*'],maxRecordCount:50});return{cfg,features:res.features};}catch(e){return{cfg,features:[]};}})),coloc=[];for(const{cfg,features}of results)for(const f of features){if(!f.geometry)continue;const oid=getOid(f);if(primaryOid!=null&&oid===primaryOid)continue;if(calcDist(ptGeom,f.geometry)<=COLOC_BUF_M)coloc.push({feature:f,layer:cfg.layer,layerConfig:cfg});}return coloc;}
        async function findCoincidentLinesForVertexCreation(sp,mp){try{const bufM=10/3.28084,lines=[];if(lockedFeature?.featureType==='line'){const seg=findClosestSeg(lockedFeature.feature.geometry,mp);if(seg&&seg.distance<=bufM)lines.push({feature:lockedFeature.feature,layer:lockedFeature.layer,layerConfig:lockedFeature.layerConfig,segmentInfo:seg});return lines;}if(mapView.hitTest){const hit=await mapView.hitTest(sp,{include:mapView.map.allLayers.filter(l=>l.type==="feature")});for(const r of hit.results)if(r.graphic?.geometry?.type==="polyline"){const cfg=lineLayers.find(l=>l.id===r.layer.layerId);if(cfg){const seg=findClosestSeg(r.graphic.geometry,mp);if(seg&&seg.distance<=bufM)lines.push({feature:r.graphic,layer:r.layer,layerConfig:cfg,segmentInfo:seg});}}}if(lines.length===0){const buf={type:"polygon",spatialReference:mp.spatialReference,rings:[[[mp.x-bufM,mp.y-bufM],[mp.x+bufM,mp.y-bufM],[mp.x+bufM,mp.y+bufM],[mp.x-bufM,mp.y+bufM],[mp.x-bufM,mp.y-bufM]]]};await Promise.all(lineLayers.filter(cfg=>cfg.layer.visible).map(async cfg=>{try{const res=await cfg.layer.queryFeatures({geometry:buf,spatialRelationship:"intersects",returnGeometry:true,outFields:["*"],maxRecordCount:50});for(const f of res.features){const seg=findClosestSeg(f.geometry,mp);if(seg&&seg.distance<=bufM)lines.push({feature:f,layer:cfg.layer,layerConfig:cfg,segmentInfo:seg});}}catch(e){console.error(`findCoincidentLines on ${cfg.name}:`,e);}}))}return lines;}catch(e){console.error("findCoincidentLinesForVertexCreation error:",e);return[];}}
        async function findCoincidentLineVertices(sp){try{const clickPt=mapView.toMap(sp),snapTol=POINT_SNAP_TOLERANCE*(mapView.resolution||1),lines=[];if(lockedFeature?.featureType==='line'){const v=findClosestVertex(lockedFeature.feature.geometry,clickPt);if(v&&v.distance<snapTol)lines.push({feature:lockedFeature.feature,layer:lockedFeature.layer,layerConfig:lockedFeature.layerConfig,vertex:v});return lines;}if(mapView.hitTest){const hit=await mapView.hitTest(sp,{include:mapView.map.allLayers.filter(l=>l.type==="feature")});for(const r of hit.results)if(r.graphic?.geometry?.type==="polyline"){const cfg=lineLayers.find(l=>l.id===r.layer.layerId);if(cfg){const v=findClosestVertex(r.graphic.geometry,clickPt);if(v&&v.distance<snapTol)lines.push({feature:r.graphic,layer:r.layer,layerConfig:cfg,vertex:v});}}}if(lines.length===0){const ext=makeExt(clickPt.x,clickPt.y,snapTol,mapView.spatialReference);await Promise.all(lineLayers.filter(cfg=>cfg.layer.visible).map(async cfg=>{try{const res=await cfg.layer.queryFeatures({geometry:ext,spatialRelationship:"intersects",returnGeometry:true,outFields:["*"],maxRecordCount:50});for(const f of res.features){const v=findClosestVertex(f.geometry,clickPt);if(v&&v.distance<snapTol)lines.push({feature:f,layer:cfg.layer,layerConfig:cfg,vertex:v});}}catch(e){console.error(`findCoincidentLineVertices on ${cfg.name}:`,e);}}))}if(lines.length>0){const ref=lines[0].vertex.coordinates;return lines.filter(li=>calcDist(ref,li.vertex.coordinates)<snapTol);}return[];}catch(e){console.error("findCoincidentLineVertices error:",e);return[];}}
        async function findConnectedLines(ptGeom){const connected=[],bufM=10/3.28084,buf={type:"polygon",spatialReference:ptGeom.spatialReference,rings:[[[ptGeom.x-bufM,ptGeom.y-bufM],[ptGeom.x+bufM,ptGeom.y-bufM],[ptGeom.x+bufM,ptGeom.y+bufM],[ptGeom.x-bufM,ptGeom.y+bufM],[ptGeom.x-bufM,ptGeom.y-bufM]]]},results=await Promise.all(lineLayers.filter(cfg=>cfg.layer.visible).map(async cfg=>{try{const res=await cfg.layer.queryFeatures({geometry:buf,spatialRelationship:"intersects",returnGeometry:true,outFields:["*"],maxRecordCount:100});return{cfg,features:res.features};}catch(e){return{cfg,features:[]};}}));for(const{cfg,features}of results){for(const f of features){if(!f.geometry?.paths)continue;for(let pi=0;pi<f.geometry.paths.length;pi++){const path=f.geometry.paths[pi];if(path.length<2)continue;const start={x:path[0][0],y:path[0][1]},end={x:path[path.length-1][0],y:path[path.length-1][1]},sd=calcDist(ptGeom,start),ed=calcDist(ptGeom,end);let conn=null;if(sd<bufM)conn={pathIndex:pi,pointIndex:0,isStart:true};else if(ed<bufM)conn={pathIndex:pi,pointIndex:path.length-1,isStart:false};if(conn){connected.push({feature:f,layer:cfg.layer,layerConfig:cfg,connection:conn});if(f.geometry.clone)originalGeometries.set(f.attributes.objectid,f.geometry.clone());}}}}return connected;}
        async function updateConnectedLines(newPt){const byLayer=new Map(),cacheUpdates=[];for(const info of connectedFeatures){const orig=originalGeometries.get(info.feature.attributes.objectid);if(!orig?.clone)continue;const newGeom=orig.clone();newGeom.paths[info.connection.pathIndex][info.connection.pointIndex]=[newPt.x,newPt.y];const upd=info.feature.clone();upd.geometry=newGeom;upd.attributes.calculated_length=geodeticLength(newGeom);const lid=layerKey(info.layer,info.layerConfig);if(!byLayer.has(lid))byLayer.set(lid,{layer:info.layer,features:[]});byLayer.get(lid).features.push(upd);cacheUpdates.push({lid,oid:getOid(info.feature),geom:newGeom});}for(const{layer,features}of byLayer.values())try{if(layer.applyEdits)await layer.applyEdits({updateFeatures:features});}catch(e){console.error('updateConnectedLines batch error:',e);}for(const{lid,oid,geom}of cacheUpdates)updateVertexCacheGeom(lid,oid,geom);}

        // ── Vertex operations ─────────────────────────────────────────────────

        function lockedReadyStatus(){if(!lockedFeature)return currentMode==='point'?"Click on a point feature to select it.":"Line mode · click a vertex to select it.";if(lockedFeature.featureType==='point')return `🔒 Locked: ${lockedFeature.layerConfig.name} (point). Click the locked point to move it.`;return `🔒 Locked: ${lockedFeature.layerConfig.name}. Click a vertex to move it.`;}
        async function addVertexToLine(event){const sp={x:event.x,y:event.y},mp=mapView.toMap(sp);updateStatus("Adding vertex to line...");try{const lines=await findCoincidentLinesForVertexCreation(sp,mp);if(!lines.length){updateStatus("❌ No lines found to add vertex to.");return;}const updates=[],lockedOid=lockedFeature?.featureType==='line'?getOid(lockedFeature.feature):null;for(const li of lines){try{const newPaths=clonePaths(li.feature.geometry);newPaths[li.segmentInfo.pathIndex].splice(li.segmentInfo.insertIndex,0,[li.segmentInfo.point.x,li.segmentInfo.point.y]);const newGeom=buildPolyline(li.feature.geometry,newPaths),upd=li.feature.clone();upd.geometry=newGeom;upd.attributes.calculated_length=geodeticLength(newGeom);updates.push({layer:li.layer,feature:upd,layerName:li.layerConfig.name,newGeom,oid:getOid(li.feature),lid:layerKey(li.layer,li.layerConfig)});}catch(e){console.error(`addVertexToLine on ${li.layerConfig.name}:`,e);}}if(!updates.length){updateStatus("❌ No vertices could be added.");return;}const byLayer=new Map();for(const u of updates){if(!byLayer.has(u.lid))byLayer.set(u.lid,{layer:u.layer,updates:[]});byLayer.get(u.lid).updates.push(u);}for(const{layer,updates:batch}of byLayer.values())if(layer.applyEdits)await layer.applyEdits({updateFeatures:batch.map(u=>u.feature)});for(const u of updates){updateVertexCacheGeom(u.lid,u.oid,u.newGeom);if(lockedOid!=null&&u.oid===lockedOid)syncLockedFeature(u.newGeom);}updateStatus(`✅ Added vertex to ${updates.length} line(s): ${[...new Set(updates.map(u=>u.layerName))].join(", ")}!`);if(vertexHighlightActive)scheduleHighlightRefresh();setTimeout(()=>updateStatus(lockedReadyStatus()),3000);}catch(e){console.error("addVertexToLine error:",e);updateStatus("❌ Error adding vertex.");}}
        async function deleteVertexFromLine(event){const sp={x:event.x,y:event.y};updateStatus("Deleting vertex from line...");try{const results=await findCoincidentLineVertices(sp);if(!results.length){updateStatus("❌ No line vertex found to delete.");return;}const updates=[],lockedOid=lockedFeature?.featureType==='line'?getOid(lockedFeature.feature):null;for(const li of results){try{const srcGeom=li.feature.geometry;if(!srcGeom?.paths)continue;const newPaths=clonePaths(srcGeom),totalVertices=newPaths.reduce((s,p)=>s+p.length,0);if(totalVertices<=2)continue;const path=newPaths[li.vertex.pathIndex];if(!path||path.length<=2)continue;path.splice(li.vertex.pointIndex,1);const newGeom=buildPolyline(srcGeom,newPaths),upd=li.feature.clone();upd.geometry=newGeom;upd.attributes.calculated_length=geodeticLength(newGeom);updates.push({layer:li.layer,feature:upd,layerName:li.layerConfig.name,newGeom,oid:getOid(li.feature),lid:layerKey(li.layer,li.layerConfig)});}catch(e){console.error("deleteVertexFromLine prep error:",e);}}if(!updates.length){updateStatus("❌ No vertices deleted (lines with only 2 vertices cannot be reduced further).");return;}const byLayer=new Map();for(const u of updates){if(!byLayer.has(u.lid))byLayer.set(u.lid,{layer:u.layer,updates:[]});byLayer.get(u.lid).updates.push(u);}for(const{layer,updates:batch}of byLayer.values())if(layer.applyEdits)await layer.applyEdits({updateFeatures:batch.map(u=>u.feature)});for(const u of updates){updateVertexCacheGeom(u.lid,u.oid,u.newGeom);if(lockedOid!=null&&u.oid===lockedOid)syncLockedFeature(u.newGeom);}updateStatus(`✅ Deleted vertex from ${updates.length} line(s): ${[...new Set(updates.map(u=>u.layerName))].join(", ")}!`);if(vertexHighlightActive)scheduleHighlightRefresh();setTimeout(()=>updateStatus(lockedReadyStatus()),3000);}catch(e){console.error("deleteVertexFromLine error:",e);updateStatus("❌ Error deleting vertex.");}}

        // ── Feature selection & movement ──────────────────────────────────────

        async function handleFeatureSelection(event) {
            const sp = { x: event.x, y: event.y };
            updateStatus("Searching for feature...");

            if (currentMode === "point") {
                if (lockedFeature?.featureType === 'point') {
                    const r = await findPointFeatureAtLocation(sp);
                    if (!r || (getOid(lockedFeature.feature) != null && getOid(r.feature) !== getOid(lockedFeature.feature))) {
                        updateStatus(`🔒 Locked to ${lockedFeature.layerConfig.name}. Click directly on the locked point.`);
                        return;
                    }
                    selectedFeature = lockedFeature.feature;
                    selectedLayer = lockedFeature.layer;
                    selectedLayerConfig = lockedFeature.layerConfig;
                    selectedVertex = null;
                    connectedFeatures = lockedFeature.preloaded?.connectedFeatures || [];
                    colocatedPoints  = lockedFeature.preloaded?.colocatedPoints  || [];
                    if (selectedFeature.geometry?.clone)
                        originalGeometries.set(selectedFeature.attributes.objectid, selectedFeature.geometry.clone());
                    for (const info of connectedFeatures)
                        if (info.feature.geometry?.clone) originalGeometries.set(info.feature.attributes.objectid, info.feature.geometry.clone());
                    if (cancelBtn) cancelBtn.disabled = false;
                    waitingForDestination = true;

                    // Connected lines already preloaded — preview stretches them immediately
                    startMovePreview(
                        { x: selectedFeature.geometry.x, y: selectedFeature.geometry.y, spatialReference: selectedFeature.geometry.spatialReference },
                        new Set([getOid(selectedFeature), ...colocatedPoints.map(p => getOid(p.feature))].filter(Boolean)),
                        { mode: 'point', connectedLines: connectedFeatures }
                    );
                    updateStatus(`🎯 Locked ${lockedFeature.layerConfig.name} selected. Click destination.`);
                    return;
                }

                const r = await findPointFeatureAtLocation(sp);
                if (r) {
                    selectedFeature = r.feature;
                    selectedLayer = r.layer;
                    selectedLayerConfig = r.layerConfig;
                    selectedVertex = null;
                    if (selectedFeature.geometry?.clone)
                        originalGeometries.set(selectedFeature.attributes.objectid, selectedFeature.geometry.clone());
                    if (cancelBtn) cancelBtn.disabled = false;
                    waitingForDestination = true;

                    // Fire connected-line query in background; preview upgrades once it resolves.
                    // Falls back to rubber-band until then (or permanently for standalone points).
                    const connectedPromise = findConnectedLines(selectedFeature.geometry);
                    startMovePreview(
                        { x: selectedFeature.geometry.x, y: selectedFeature.geometry.y, spatialReference: selectedFeature.geometry.spatialReference },
                        new Set([getOid(selectedFeature)].filter(Boolean)),
                        { mode: 'point', connectedPromise }
                    );
                    updateStatus(`🎯 ${r.layerConfig.name} selected. Click destination to move.`);
                } else {
                    updateStatus("❌ No point feature found.");
                }

            } else {
                const results = await findCoincidentLineVertices(sp);
                if (results.length > 0) {
                    selectedCoincidentLines = results;
                    selectedFeature  = results[0].feature;
                    selectedLayer    = results[0].layer;
                    selectedLayerConfig = results[0].layerConfig;
                    selectedVertex   = results[0].vertex;
                    for (const li of results)
                        if (li.feature.geometry?.clone) originalGeometries.set(li.feature.attributes.objectid, li.feature.geometry.clone());
                    if (cancelBtn) cancelBtn.disabled = false;
                    waitingForDestination = true;

                    // Preview: redraw all coincident lines with vertex at cursor
                    startMovePreview(
                        { x: selectedVertex.coordinates.x, y: selectedVertex.coordinates.y, spatialReference: selectedFeature.geometry.spatialReference },
                        new Set(results.map(r => getOid(r.feature)).filter(Boolean)),
                        { mode: 'vertex', coincidentLines: results }
                    );

                    const vType  = results[0].vertex.isEndpoint ? "endpoint" : "vertex";
                    const snap   = results[0].vertex.isEndpoint ? " (will snap)" : "";
                    const lock   = lockedFeature?.featureType === 'line' ? " [🔒]" : "";
                    updateStatus(`🎯 Selected ${vType} on ${results.length} line(s): ${results.map(r => r.layerConfig.name).join(", ")}${snap}${lock}. Click destination.`);
                } else {
                    updateStatus("❌ No line vertex found.");
                }
            }
        }

        async function handleMoveToDestination(event) {
            if (!selectedFeature) { updateStatus("❌ No feature selected."); return; }
            let dst = mapView.toMap({ x: event.x, y: event.y });
            stopMovePreview();  // clear preview immediately on destination click
            updateStatus("Moving feature…");
            try {
                if (currentMode === "point") {
                    const isLockedPoint = lockedFeature?.featureType === 'point';
                    if (isLockedPoint) { colocatedPoints = lockedFeature.preloaded?.colocatedPoints || colocatedPoints; connectedFeatures = []; }
                    else { updateStatus("Moving feature — finding connected features…"); [connectedFeatures, colocatedPoints] = await Promise.all([findConnectedLines(selectedFeature.geometry), findColocatedPoints(selectedFeature.geometry, getOid(selectedFeature))]); }
                    const excludeOids=new Set([getOid(selectedFeature),...colocatedPoints.map(p=>getOid(p.feature))].filter(Boolean)),snapInfo=snappingEnabled?await findSnapTarget(dst,excludeOids):null;
                    if(snapInfo)dst=toTypedPoint(snapInfo.geometry,mapView.spatialReference);
                    if(!isLockedPoint)await updateConnectedLines(dst);
                    const upd=selectedFeature.clone();upd.geometry=dst;if(selectedLayer.applyEdits)await selectedLayer.applyEdits({updateFeatures:[upd]});if(isLockedPoint)syncLockedFeature(dst);
                    const colocByLayer=new Map();for(const cp of colocatedPoints){const coUpd=cp.feature.clone();coUpd.geometry=dst;const lid=layerKey(cp.layer,cp.layerConfig);if(!colocByLayer.has(lid))colocByLayer.set(lid,{layer:cp.layer,features:[],names:new Set()});colocByLayer.get(lid).features.push(coUpd);colocByLayer.get(lid).names.add(cp.layerConfig.name);}
                    let colocOk=0,colocFail=0;for(const{layer,features}of colocByLayer.values()){try{await layer.applyEdits({updateFeatures:features});colocOk+=features.length;}catch(e){console.error('co-located batch error:',e);colocFail+=features.length;}}
                    const movedLines=isLockedPoint?0:connectedFeatures.length;let msg=`✅ Moved ${selectedLayerConfig.name}`;if(colocOk>0){const allNames=[...new Set([...colocByLayer.values()].flatMap(v=>[...v.names]))];msg+=` + ${colocOk} co-located (${allNames.join(', ')})`;}if(colocFail>0)msg+=` · ${colocFail} co-located failed`;if(movedLines>0)msg+=` + ${movedLines} line(s)`;msg+='!';if(snapInfo)msg+=` Snapped to ${snapInfo.snapType==='pointFeature'?`point in ${snapInfo.layerConfig.name}`:snapInfo.snapType==='lineVertex'?`vertex in ${snapInfo.layerConfig.name}`:`line in ${snapInfo.layerConfig.name}`}.`;updateStatus(msg);
                } else {
                    const excludeOids=new Set(selectedCoincidentLines.map(li=>getOid(li.feature)).filter(Boolean)),snapInfo=snappingEnabled?await findSnapTarget(dst,excludeOids):null;if(snapInfo)dst=snapInfo.geometry;
                    const updates=[],lockedOid=lockedFeature?.featureType==='line'?getOid(lockedFeature.feature):null;
                    for(const li of selectedCoincidentLines){try{const newPaths=clonePaths(li.feature.geometry),path=newPaths[li.vertex.pathIndex];if(path?.[li.vertex.pointIndex])path[li.vertex.pointIndex]=[dst.x,dst.y];const newGeom=buildPolyline(li.feature.geometry,newPaths),upd=li.feature.clone();upd.geometry=newGeom;upd.attributes.calculated_length=geodeticLength(newGeom);updates.push({layer:li.layer,feature:upd,layerName:li.layerConfig.name,newGeom,oid:getOid(li.feature),lid:layerKey(li.layer,li.layerConfig)});}catch(e){console.error("handleMoveToDestination line prep error:",e);}}
                    const byLayer=new Map();for(const u of updates){if(!byLayer.has(u.lid))byLayer.set(u.lid,{layer:u.layer,updates:[]});byLayer.get(u.lid).updates.push(u);}let ok=0;for(const{layer,updates:batch}of byLayer.values()){try{if(layer.applyEdits){await layer.applyEdits({updateFeatures:batch.map(u=>u.feature)});ok+=batch.length;}}catch(e){console.error("applyEdits error:",e);}}for(const u of updates){updateVertexCacheGeom(u.lid,u.oid,u.newGeom);if(lockedOid!=null&&u.oid===lockedOid)syncLockedFeature(u.newGeom);}
                    let msg=`✅ Moved ${selectedVertex.isEndpoint?"endpoint":"vertex"} on ${ok} line(s)!`;if(snapInfo)msg+=` Snapped to ${snapInfo.snapType==='lineVertex'?`vertex in ${snapInfo.layerConfig.name}`:`point in ${snapInfo.layerConfig.name}`}.`;updateStatus(msg);
                }
                selectedFeature=null;selectedLayer=null;selectedLayerConfig=null;selectedVertex=null;selectedCoincidentLines=[];waitingForDestination=false;connectedFeatures=[];colocatedPoints=[];originalGeometries.clear();if(cancelBtn)cancelBtn.disabled=true;if(vertexHighlightActive)scheduleHighlightRefresh();setTimeout(()=>updateStatus(lockedReadyStatus()),3000);
            } catch(e) { console.error("handleMoveToDestination error:", e); updateStatus("❌ Error moving feature."); }
        }

        // ── Main click dispatcher ─────────────────────────────────────────────

        async function handleClick(event) {
            if (!toolActive) return;
            if (event.button !== 0) return;
            if (isProcessingClick) return;
            isProcessingClick = true; event.stopPropagation();
            try {
                if      (cutMode)                  await handleCutClick(event);
                else if (copyMode)                 await handleCopyClick(event);
                else if (flipMode)                 await handleFlipClick(event);
                else if (arcMode)                  await handleArcClick(event);
                else if (deleteMode)               await handleDeleteClick(event);
                else if (pickingFeatureMode)       await pickFeature(event);
                else if (vertexMode === "add")     await addVertexToLine(event);
                else if (vertexMode === "delete")  await deleteVertexFromLine(event);
                else if (!selectedFeature)         await handleFeatureSelection(event);
                else                               await handleMoveToDestination(event);
            } finally { isProcessingClick = false; }
        }

        // ── Vertex highlight + direction arrows ───────────────────────────────

        function makeVertexGraphic(x,y,sr,endpoint){return new _Graphic({geometry:{type:"point",x,y,spatialReference:sr},symbol:{type:"simple-marker",style:endpoint?"circle":"square",color:endpoint?[255,120,0,220]:[30,130,255,200],size:endpoint?10:7,outline:{color:[255,255,255,230],width:1.5}}});}
        function computePathArrows(path,sr){if(!path||path.length<2)return[];let totalLen=0;const segLens=[];for(let i=0;i<path.length-1;i++){const dx=path[i+1][0]-path[i][0],dy=path[i+1][1]-path[i][1];segLens.push(Math.sqrt(dx*dx+dy*dy));totalLen+=segLens[segLens.length-1];}if(totalLen===0)return[];const n=Math.max(ARROW_MIN,Math.min(ARROW_MAX,Math.floor(totalLen/ARROW_SPACING))),labelShift=ARROW_LABEL_OFFSET_PX*(mapView.resolution||1),arrows=[];for(let a=0;a<n;a++){const target=((a+0.5)/n)*totalLen;let dist=0;for(let i=0;i<path.length-1;i++){if(dist+segLens[i]>=target||i===path.length-2){const t=segLens[i]>0?Math.min(1,(target-dist)/segLens[i]):0,dx=path[i+1][0]-path[i][0],dy=path[i+1][1]-path[i][1],bearing=Math.atan2(dx,dy)*180/Math.PI,bRad=bearing*Math.PI/180;arrows.push({x:path[i][0]+t*dx+Math.sin(bRad)*labelShift,y:path[i][1]+t*dy+Math.cos(bRad)*labelShift,bearing,spatialReference:sr});break;}dist+=segLens[i];}}return arrows;}
        function applyCoincidentOffset(arrows){const offsetDist=(mapView.resolution||1)*10,groupThresh=offsetDist*2,SAME_DIR_DEG=30,processed=new Set();for(let i=0;i<arrows.length;i++){if(processed.has(i))continue;const group=[i];for(let j=i+1;j<arrows.length;j++){if(processed.has(j))continue;const dx=arrows[i].x-arrows[j].x,dy=arrows[i].y-arrows[j].y;if(Math.sqrt(dx*dx+dy*dy)<groupThresh){group.push(j);processed.add(j);}}processed.add(i);if(group.length<2)continue;const refBearing=arrows[group[0]].bearing,allSameDir=group.every(idx=>{let d=Math.abs(refBearing-arrows[idx].bearing)%360;if(d>180)d=360-d;return d<SAME_DIR_DEG;});if(allSameDir)continue;const bRad=refBearing*Math.PI/180,perpX=Math.cos(bRad),perpY=-Math.sin(bRad);for(let k=0;k<group.length;k++){const slot=k-(group.length-1)/2;arrows[group[k]].x+=perpX*slot*offsetDist;arrows[group[k]].y+=perpY*slot*offsetDist;}}}
        async function renderVertexHighlights(){if(!vertexHighlightActive)return;await ensureGraphicClasses();if(!_Graphic||!_GraphicsLayer){updateStatus('❌ Could not load graphic classes.');return;}if(!vertexHighlightLayer){vertexHighlightLayer=new _GraphicsLayer({listMode:"hide"});mapView.map.add(vertexHighlightLayer);}vertexHighlightLayer.removeAll();let totalVtx=0;const allArrows=[],sr=mapView.spatialReference;const processGeom=geom=>{if(!geom?.paths)return;for(const path of geom.paths){for(let i=0;i<path.length;i++){vertexHighlightLayer.add(makeVertexGraphic(path[i][0],path[i][1],geom.spatialReference,i===0||i===path.length-1));totalVtx++;}if(directionArrowsActive)for(const a of computePathArrows(path,geom.spatialReference||sr))allArrows.push(a);}};if(lockedFeature?.featureType==='line'){processGeom(lockedFeature.feature.geometry);}else{const currentExtent=mapView.extent;let geomsToRender=[];if(isExtentCovered(currentExtent)){geomsToRender=[...vertexGeomCache.values()].filter(geom=>geomIntersectsExtent(geom,currentExtent));}else{updateStatus("Loading vertex highlights…");const queryResults=await Promise.all(lineLayers.filter(cfg=>cfg.layer.visible).map(async cfg=>{try{const res=await cfg.layer.queryFeatures({geometry:currentExtent,spatialRelationship:"intersects",returnGeometry:true,outFields:["objectid"],maxRecordCount:500});return{cfg,features:res.features};}catch(e){return{cfg,features:[]};}}));for(const{cfg,features}of queryResults){for(const f of features){const oid=getOid(f),cachedGeom=vertexGeomCache.get(vtxKey(cfg.id,oid)),geom=cachedGeom||f.geometry;updateVertexCacheGeom(cfg.id,oid,geom);geomsToRender.push(geom);}}recordQueriedExtent(currentExtent);}for(const geom of geomsToRender)processGeom(geom);}if(directionArrowsActive&&allArrows.length){applyCoincidentOffset(allArrows);for(const a of allArrows)vertexHighlightLayer.add(new _Graphic({geometry:{type:'point',x:a.x,y:a.y,spatialReference:a.spatialReference||sr},symbol:{type:'simple-marker',style:'triangle',color:[167,139,250,210],size:11,outline:{color:[255,255,255,160],width:1},angle:a.bearing}}));}const scope=lockedFeature?.featureType==='line'?`locked (${lockedFeature.layerConfig.name})`:`${lineLayers.filter(l=>l.layer.visible).length} line layer(s)`,cached=isExtentCovered(mapView.extent)&&lockedFeature?.featureType!=='line'?' (cached)':'';updateStatus(`👁 ${totalVtx} vertices${directionArrowsActive?` · ${allArrows.length} arrows`:''}${cached} — ${scope}.`);}
        function clearVertexHighlights(){if(vertexHighlightLayer){vertexHighlightLayer.removeAll();mapView.map.remove(vertexHighlightLayer);vertexHighlightLayer=null;}}
        function scheduleHighlightRefresh(){clearTimeout(highlightDebounceTimer);highlightDebounceTimer=setTimeout(()=>renderVertexHighlights(),600);}
        function toggleVertexHighlight(){vertexHighlightActive=!vertexHighlightActive;if(vertexHighlightActive){showVerticesToggleBtn.classList.add('smt-footer-on');showVerticesToggleBtn.textContent='👁 Hide Vtx';if(refreshVerticesBtn)refreshVerticesBtn.disabled=false;if(directionToggleBtn)directionToggleBtn.disabled=false;renderVertexHighlights();extentWatchHandle=mapView.watch("extent",()=>{if(vertexHighlightActive&&lockedFeature?.featureType!=='line')scheduleHighlightRefresh();});}else{showVerticesToggleBtn.classList.remove('smt-footer-on');showVerticesToggleBtn.textContent='👁 Vertices';if(refreshVerticesBtn)refreshVerticesBtn.disabled=true;if(directionToggleBtn)directionToggleBtn.disabled=true;clearVertexHighlights();if(extentWatchHandle){extentWatchHandle.remove();extentWatchHandle=null;}clearTimeout(highlightDebounceTimer);updateStatus(toolActive?`Ready · click a ${currentMode==="point"?"point feature":"line vertex"}.`:"Tool disabled.");}}
        function toggleDirectionArrows(){directionArrowsActive=!directionArrowsActive;directionToggleBtn.classList.toggle('smt-footer-on',directionArrowsActive);directionToggleBtn.textContent=directionArrowsActive?'🔺 Dir ON':'🔺 Direction';if(vertexHighlightActive)scheduleHighlightRefresh();}

        // ── Arc Fit ───────────────────────────────────────────────────────────

        function showArcSelectionHighlight(lines){clearArcSelectionHighlight();for(const li of lines){mapView.graphics.add({geometry:li.feature.geometry,symbol:{type:'simple-line',color:[124,58,237,0.75],width:4,style:'solid'}});arcHighlightGraphics.push(mapView.graphics.getItemAt(mapView.graphics.length-1));}}
        function clearArcSelectionHighlight(){for(const g of arcHighlightGraphics)mapView.graphics.remove(g);arcHighlightGraphics=[];}
        function showArcPreview(pts,sr){clearArcPreview();if(!pts||pts.length<2)return;mapView.graphics.add({geometry:{type:'polyline',paths:[pts],spatialReference:sr},symbol:{type:'simple-line',color:[167,139,250,0.9],width:2.5,style:'dash'}});arcPreviewGraphic=mapView.graphics.getItemAt(mapView.graphics.length-1);}
        function clearArcPreview(){if(arcPreviewGraphic){mapView.graphics.remove(arcPreviewGraphic);arcPreviewGraphic=null;}}
        function ccwSweep(from,to){let d=to-from;while(d<0)d+=2*Math.PI;while(d>=2*Math.PI)d-=2*Math.PI;return d;}
        function circumscribedCircle(p1,p2,p3){const ax=p1.x,ay=p1.y,bx=p2.x,by=p2.y,cx=p3.x,cy=p3.y,D=2*(ax*(by-cy)+bx*(cy-ay)+cx*(ay-by));if(Math.abs(D)<1e-6)return null;const a2=ax*ax+ay*ay,b2=bx*bx+by*by,c2=cx*cx+cy*cy,ux=(a2*(by-cy)+b2*(cy-ay)+c2*(ay-by))/D,uy=(a2*(cx-bx)+b2*(ax-cx)+c2*(bx-ax))/D;return{center:{x:ux,y:uy},radius:Math.sqrt((ax-ux)**2+(ay-uy)**2)};}
        function generateArcPoints(startPt,endPt,midPt,circle,sr){const c=circle.center,startAngle=Math.atan2(startPt.y-c.y,startPt.x-c.x),endAngle=Math.atan2(endPt.y-c.y,endPt.x-c.x),midAngle=Math.atan2(midPt.y-c.y,midPt.x-c.x),sweepToEnd=ccwSweep(startAngle,endAngle),sweepToMid=ccwSweep(startAngle,midAngle),goCCW=(sweepToMid>0&&sweepToMid<sweepToEnd),totalSweep=goCCW?sweepToEnd:(2*Math.PI-sweepToEnd),arcLen=circle.radius*totalSweep,chord=Math.sqrt((startPt.x-endPt.x)**2+(startPt.y-endPt.y)**2),spacing=Math.max(chord/24,(mapView.resolution||1)*10),nInt=Math.max(4,Math.min(48,Math.round(arcLen/spacing))),dir=goCCW?1:-1,pts=[[startPt.x,startPt.y]];for(let i=1;i<=nInt;i++){const t=i/(nInt+1),angle=startAngle+dir*totalSweep*t;pts.push([c.x+circle.radius*Math.cos(angle),c.y+circle.radius*Math.sin(angle)]);}pts.push([endPt.x,endPt.y]);return pts;}
        function clearArcAnchor(){arcAnchorMode=false;arcAnchorPt=null;arcAnchorSegInfo=null;arcActiveSide='left';clearArcAnchorGraphic();clearArcPreview();}
        function resetArcState(){arcWaitingForMidpoint=false;clearArcAnchor();arcSelectedLines=[];arcStartPt=null;arcEndPt=null;clearArcSelectionHighlight();clearArcPreview();}
        async function handleArcClick(event){const sp={x:event.x,y:event.y},mp=mapView.toMap(sp);if(!arcWaitingForMidpoint){updateStatus('⌒ Finding line segment…');let lines=[];if(lockedFeature?.featureType==='line'){lines=[{feature:lockedFeature.feature,layer:lockedFeature.layer,layerConfig:lockedFeature.layerConfig}];}else{lines=await findLinesAtClick(sp,mp);}if(!lines.length){updateStatus('❌ No line found. Click directly on a line segment.');return;}const seg=findClosestSeg(lines[0].feature.geometry,mp);if(!seg){updateStatus('❌ Could not determine segment endpoints.');return;}const path=lines[0].feature.geometry.paths[seg.pathIndex],geomSr=lines[0].feature.geometry.spatialReference;arcStartPt={x:path[0][0],y:path[0][1],spatialReference:geomSr};arcEndPt={x:path[path.length-1][0],y:path[path.length-1][1],spatialReference:geomSr};arcSelectedLines=lines;arcWaitingForMidpoint=true;showArcSelectionHighlight(lines);const lockNote=lockedFeature?.featureType==='line'?` [🔒 ${lockedFeature.layerConfig.name}]`:'';updateStatus(`⌒ ${lines.length} line(s) selected${lockNote} — move mouse to preview arc, then click to apply. Right-click to set an anchor point.`);}else{clearArcPreview();const p1=arcAnchorMode&&arcActiveSide==='right'?arcAnchorPt:arcStartPt,p2=arcAnchorMode&&arcActiveSide==='left'?arcAnchorPt:arcEndPt,circle=circumscribedCircle(p1,mp,p2);if(!circle){updateStatus('❌ Points are collinear — click somewhere off the line to create a curve.');return;}const arcPts=generateArcPoints(p1,p2,mp,circle,mapView.spatialReference);clearArcSelectionHighlight();clearArcAnchorGraphic();updateStatus(`⌒ Applying arc to ${arcSelectedLines.length} line(s)…`);const updates=[],lockedOid=lockedFeature?.featureType==='line'?getOid(lockedFeature.feature):null;for(const li of arcSelectedLines){try{const newPaths=clonePaths(li.feature.geometry);if(arcAnchorMode){const info=findClosestPointOnPath(li.feature.geometry,arcAnchorPt);newPaths[info.pathIdx]=buildAnchoredArcPath(li.feature.geometry,info,arcPts,arcActiveSide);}else{const paths=li.feature.geometry.paths;let bestPi=0,bestDist=Infinity;for(let pi=0;pi<paths.length;pi++){const p=paths[pi],d=Math.min(calcDist(arcStartPt,{x:p[0][0],y:p[0][1]})+calcDist(arcEndPt,{x:p[p.length-1][0],y:p[p.length-1][1]}),calcDist(arcEndPt,{x:p[0][0],y:p[0][1]})+calcDist(arcStartPt,{x:p[p.length-1][0],y:p[p.length-1][1]}));if(d<bestDist){bestDist=d;bestPi=pi;}}const p=paths[bestPi],isReversed=calcDist(arcEndPt,{x:p[0][0],y:p[0][1]})<calcDist(arcStartPt,{x:p[0][0],y:p[0][1]});newPaths[bestPi]=isReversed?[...arcPts].reverse():arcPts;}const newGeom=buildPolyline(li.feature.geometry,newPaths),upd=li.feature.clone();upd.geometry=newGeom;upd.attributes.calculated_length=geodeticLength(newGeom);updates.push({layer:li.layer,feature:upd,layerName:li.layerConfig.name,newGeom,oid:getOid(li.feature),lid:layerKey(li.layer,li.layerConfig)});}catch(e){console.error(`handleArcClick prep on ${li.layerConfig.name}:`,e);}}const byLayer=new Map();for(const u of updates){if(!byLayer.has(u.lid))byLayer.set(u.lid,{layer:u.layer,updates:[]});byLayer.get(u.lid).updates.push(u);}let ok=0;for(const{layer,updates:batch}of byLayer.values()){try{if(layer.applyEdits){await layer.applyEdits({updateFeatures:batch.map(u=>u.feature)});ok+=batch.length;}}catch(e){console.error('handleArcClick applyEdits error:',e);}}for(const u of updates){updateVertexCacheGeom(u.lid,u.oid,u.newGeom);if(lockedOid!=null&&u.oid===lockedOid)syncLockedFeature(u.newGeom);}updateStatus(`✅ Arc applied to ${ok} line(s) — ${arcPts.length} vertices.`);resetArcState();if(vertexHighlightActive)scheduleHighlightRefresh();setTimeout(()=>{if(arcMode)updateStatus('⌒ Arc Fit active — click a line segment to begin.');},3000);}}
        function enableArcMode(){if(cutMode)disableCutMode();if(copyMode)disableCopyMode();if(flipMode)disableFlipMode();if(deleteMode)disableDeleteMode();arcMode=true;setActiveModeBtn('arcModeBtn');showCtxPanel(null);arcContextMenuHandler=e=>{if(arcWaitingForMidpoint)e.preventDefault();};mapView.container.addEventListener('contextmenu',arcContextMenuHandler);arcRightClickHandler=mapView.on('pointer-down',e=>{if(e.button!==2||!arcWaitingForMidpoint||arcSelectedLines.length===0)return;const mp=mapView.toMap({x:e.x,y:e.y}),geom=arcSelectedLines[0].feature.geometry,info=findClosestPointOnPath(geom,mp);arcAnchorPt={x:info.point.x,y:info.point.y,spatialReference:geom.spatialReference};arcAnchorSegInfo=info;arcAnchorMode=true;showArcAnchorGraphic(arcAnchorPt);updateStatus('⌒ Anchor set ◆ — hover either side to preview the curve, then left-click to apply. Right-click to reposition. ESC to clear anchor.');});arcMoveHandler=mapView.on('pointer-move',e=>{if(!arcWaitingForMidpoint||!arcStartPt||!arcEndPt)return;const mp=mapView.toMap({x:e.x,y:e.y}),sr=arcStartPt.spatialReference||mapView.spatialReference;if(arcAnchorMode&&arcAnchorPt&&arcAnchorSegInfo){const geom=arcSelectedLines[0].feature.geometry;arcActiveSide=getArcSide(geom,arcAnchorSegInfo,mp);let previewPts;if(arcActiveSide==='left'){const circle=circumscribedCircle(arcStartPt,mp,arcAnchorPt);if(!circle){clearArcPreview();return;}const arcPts=generateArcPoints(arcStartPt,arcAnchorPt,mp,circle,sr),path=geom.paths[arcAnchorSegInfo.pathIdx],tail=path.slice(arcAnchorSegInfo.segIdx+1).map(v=>[v[0],v[1]]);previewPts=[...arcPts,...tail];}else{const circle=circumscribedCircle(arcAnchorPt,mp,arcEndPt);if(!circle){clearArcPreview();return;}const arcPts=generateArcPoints(arcAnchorPt,arcEndPt,mp,circle,sr),path=geom.paths[arcAnchorSegInfo.pathIdx],head=path.slice(0,arcAnchorSegInfo.segIdx+1).map(v=>[v[0],v[1]]);previewPts=[...head,[arcAnchorPt.x,arcAnchorPt.y],...arcPts.slice(1)];}showArcPreview(previewPts,sr);}else{const circle=circumscribedCircle(arcStartPt,mp,arcEndPt);if(!circle){clearArcPreview();return;}showArcPreview(generateArcPoints(arcStartPt,arcEndPt,mp,circle,sr),sr);}});if(toolActive)updateStatus('⌒ Arc Fit active — click a line to select it.');}
        function disableArcMode(){arcMode=false;resetArcState();if(arcMoveHandler){arcMoveHandler.remove();arcMoveHandler=null;}if(arcRightClickHandler){arcRightClickHandler.remove();arcRightClickHandler=null;}if(arcContextMenuHandler){mapView.container.removeEventListener('contextmenu',arcContextMenuHandler);arcContextMenuHandler=null;}setActiveModeBtn(currentMode==='point'?'pointMode':'lineMode');showCtxPanel('default');if(toolActive)updateStatus(`Ready · click a ${currentMode==='point'?'point feature':'line vertex'}.`);}

        // ── Mode setters ──────────────────────────────────────────────────────

        function cancelMove(){
            stopMovePreview();
            selectedFeature=null;selectedLayer=null;selectedLayerConfig=null;selectedVertex=null;selectedCoincidentLines=[];waitingForDestination=false;connectedFeatures=[];colocatedPoints=[];originalGeometries.clear();isProcessingClick=false;if(cancelBtn)cancelBtn.disabled=true;
            if(lockedFeature)updateStatus(lockedReadyStatus());else if(vertexMode==="add")updateStatus("Add Vertex mode · click a line segment.");else if(vertexMode==="delete")updateStatus("Delete Vertex mode · click a vertex.");else updateStatus(`Move cancelled · click a ${currentMode==="point"?"point feature":"line vertex"}.`);
        }
        function setPointMode(){exitSpecialMode();currentMode="point";vertexMode="none";setActiveModeBtn('pointMode');showCtxPanel('default');if(toolActive)updateStatus("Point mode · click a point feature to select it.");if(selectedFeature)cancelMove();}
        function setLineMode(){exitSpecialMode();currentMode="line";vertexMode="none";setActiveModeBtn('lineMode');showCtxPanel('default');if(toolActive)updateStatus(lockedReadyStatus());if(selectedFeature)cancelMove();}
        function setAddVertexMode(){exitSpecialMode();const wasAdd=vertexMode==="add";vertexMode=wasAdd?"none":"add";if(vertexMode==="add"){setActiveModeBtn('addVertexMode');showCtxPanel(null);}else{setActiveModeBtn('lineMode');showCtxPanel('default');}if(selectedFeature)cancelMove();if(toolActive)updateStatus(vertexMode==="add"?"Add Vertex · click a line segment to insert a vertex.":"Add Vertex off.");}
        function setDeleteVertexMode(){exitSpecialMode();const wasDel=vertexMode==="delete";vertexMode=wasDel?"none":"delete";if(vertexMode==="delete"){setActiveModeBtn('deleteVertexMode');showCtxPanel(null);}else{setActiveModeBtn('lineMode');showCtxPanel('default');}if(selectedFeature)cancelMove();if(toolActive)updateStatus(vertexMode==="delete"?"Delete Vertex · click any vertex to remove it.":"Delete Vertex off.");}
        function enableTool(){toolActive=true;clickHandler=mapView.on("click",handleClick);hotkeyHandler=e=>handleHotkey(e);document.addEventListener('keydown',hotkeyHandler,true);if(toggleToolBtn){toggleToolBtn.textContent='⏹ Disable';toggleToolBtn.classList.remove('smt-off');toggleToolBtn.classList.add('smt-on');toggleToolBtn.onclick=disableTool;}if(mapView.container)mapView.container.style.cursor="crosshair";updateStatus(`Tool enabled · click a ${currentMode==="point"?"point feature":"line vertex"} to begin.`);}
        function disableTool(){
            toolActive=false;pickingFeatureMode=false;isProcessingClick=false;selectedFeature=null;selectedLayer=null;selectedLayerConfig=null;selectedVertex=null;selectedCoincidentLines=[];waitingForDestination=false;connectedFeatures=[];colocatedPoints=[];originalGeometries.clear();vertexMode="none";
            stopMovePreview();
            exitSpecialMode();if(hotkeyHandler){document.removeEventListener('keydown',hotkeyHandler,true);hotkeyHandler=null;}setActiveModeBtn(currentMode==='point'?'pointMode':'lineMode');showCtxPanel('default');if(lockFeatureBtn){lockFeatureBtn.classList.remove('smt-picking');if(lockedFeature)lockFeatureBtn.classList.add('smt-locked-btn');else lockFeatureBtn.classList.remove('smt-locked-btn');lockFeatureBtn.textContent=lockedFeature?'🎯 Re-Pick':'🎯 Pick [Z]';}if(clickHandler)clickHandler.remove();if(cancelBtn)cancelBtn.disabled=true;if(mapView.container)mapView.container.style.cursor="default";if(toggleToolBtn){toggleToolBtn.textContent='▶ Enable';toggleToolBtn.classList.remove('smt-on');toggleToolBtn.classList.add('smt-off');toggleToolBtn.onclick=enableTool;}updateStatus("Tool disabled — click Enable to start.");
        }

        // ── Wire up buttons ───────────────────────────────────────────────────

        toggleToolBtn.onclick         = enableTool;
        pointModeBtn.onclick          = setPointMode;
        lineModeBtn.onclick           = setLineMode;
        addVertexBtn.onclick          = setAddVertexMode;
        deleteVertexBtn.onclick       = setDeleteVertexMode;
        flipModeBtn.onclick           = enableFlipMode;
        arcModeBtn.onclick            = enableArcMode;
        showVerticesToggleBtn.onclick = toggleVertexHighlight;
        directionToggleBtn.onclick    = toggleDirectionArrows;
        refreshVerticesBtn.onclick    = () => { clearVertexCache(); renderVertexHighlights(); };
        releaseFeatureBtn.onclick     = releaseLockedFeature;
        cancelBtn.onclick             = cancelMove;
        cutModeBtn.onclick            = enableCutMode;
        copyModeBtn.onclick           = enableCopyMode;
        clearCopyTemplateBtn.onclick  = clearCopyTemplate;
        deleteModeBtn.onclick         = enableDeleteMode;

        lockFeatureBtn.onclick=()=>{if(pickingFeatureMode){pickingFeatureMode=false;lockFeatureBtn.classList.remove('smt-picking');if(lockedFeature)lockFeatureBtn.classList.add('smt-locked-btn');lockFeatureBtn.textContent=lockedFeature?'🎯 Re-Pick':'🎯 Pick [Z]';updateStatus(lockedFeature?`🔒 Locked: ${lockedFeature.layerConfig.name}. Pick cancelled.`:"Pick cancelled.");}else{pickingFeatureMode=true;if(selectedFeature)cancelMove();lockFeatureBtn.classList.remove('smt-locked-btn');lockFeatureBtn.classList.add('smt-picking');lockFeatureBtn.textContent='⏳ Click feature…';updateStatus("🖱 Click any point or line feature on the map to lock all edits to it.");}};
        snappingToggleBtn.onclick=()=>{snappingEnabled=!snappingEnabled;snappingToggleBtn.classList.toggle('smt-footer-on',snappingEnabled);snappingToggleBtn.textContent=snappingEnabled?'⦿ Snap ON':'⦾ Snap OFF';};
        snappingToggleBtn.classList.add('smt-footer-on');

        cutCtxMenu.querySelector('#cutCtxExecute').onclick = executeCut;
        cutCtxMenu.querySelector('#cutCtxCancel').onclick  = resetCutSelection;
        delCtxMenu.querySelector('#delCtxExecute').onclick = executeDelete;
        delCtxMenu.querySelector('#delCtxCancel').onclick  = ()=>{hideDelContextMenu();clearPickerHoverHighlight();deleteCandidates=[];deleteSelectedIndices.clear();updateStatus('🗑️ Delete mode active. Click any feature to flag it.');};

        const refreshLayersBtn=toolBox.querySelector("#refreshLayers");
        if(refreshLayersBtn){refreshLayersBtn.onclick=async()=>{refreshLayersBtn.disabled=true;refreshLayersBtn.textContent="…";if(lockedFeature)releaseLockedFeature();if(selectedFeature)cancelMove();exitSpecialMode();updateStatus("Refreshing layers...");await loadLayers();updateLayerBadge();refreshLayersBtn.disabled=false;refreshLayersBtn.textContent="↺ Refresh";updateStatus(`Layers refreshed: ${pointLayers.length} point, ${lineLayers.length} line, ${polygonLayers.length} polygon.`);};}

        if(closeBtn){closeBtn.onclick=()=>{dismissPickerPopup();dismissCopyPickerPopup();disableTool();clearVertexHighlights();clearVertexCache();clearTimeout(highlightDebounceTimer);if(extentWatchHandle){extentWatchHandle.remove();extentWatchHandle=null;}if(cutGraphicsLayer){mapView.map.remove(cutGraphicsLayer);cutGraphicsLayer=null;}hideCopySnapIndicator();hideDelContextMenu();if(smtTip)smtTip.remove();cutCtxMenu.remove();delCtxMenu.remove();toolBox.remove();if(window.gisToolHost?.activeTools instanceof Set)window.gisToolHost.activeTools.delete('snap-move-tool');};}

        // ── Init ──────────────────────────────────────────────────────────────

        setPointMode();
        window.gisToolHost.activeTools.add('snap-move-tool');
        ensureGraphicClasses().catch(e => console.warn('ensureGraphicClasses on init:', e));

        updateStatus("Detecting layers…");
        loadLayers().then(() => {
            updateLayerBadge();
            updateStatus(`Ready: ${pointLayers.length} point, ${lineLayers.length} line, ${polygonLayers.length} polygon layer(s) — click Enable to start.`);
        }).catch(e => {
            console.error("Layer load error:", e);
            updateStatus("⚠️ Error detecting layers. Try clicking ↺ Refresh.");
        });

    } catch(error) {
        console.error("Error creating snap-move tool:", error);
        alert("Error creating tool: " + (error.message || error));
    }
})();
