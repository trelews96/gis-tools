// tools/snap-move-tool.js
// Click-to-Move Tool — dynamic layer detection, no hardcoded IDs

(function() {
    try {
        if (!window.gisToolHost) window.gisToolHost = {};
        if (!window.gisToolHost.activeTools || !(window.gisToolHost.activeTools instanceof Set)) {
            console.warn('Creating new Set for activeTools');
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

        // ── FIX 1: makeExt — always includes type:'extent' so ArcGIS API ──────
        // accepts the plain object without logging accessor errors.
        function makeExt(cx, cy, half, sr) {
            return { type:'extent', xmin:cx-half, ymin:cy-half, xmax:cx+half, ymax:cy+half, spatialReference:sr };
        }

        // ── Dynamic layer registry ────────────────────────────────────────────

        let pointLayers = [];
        let lineLayers  = [];

        async function loadLayers() {
            pointLayers = []; lineLayers = [];
            const all = mapView.map.allLayers.filter(l => l.type === "feature" && l.visible !== false);
            const loads = all.map(l => l.load().catch(() => null));
            await Promise.all(loads);

            for (const l of all) {
                if (!l.loaded) continue;
                const entry = { layer: l, name: l.title || `Layer ${l.layerId}`, id: l.layerId };
                const gt = (l.geometryType || "").toLowerCase();
                if (gt === "point" || gt === "multipoint") pointLayers.push(entry);
                else if (gt === "polyline")                lineLayers.push(entry);
            }

            console.log(`Snap-Move: detected ${pointLayers.length} point layer(s), ${lineLayers.length} line layer(s)`);
            return { pointLayers, lineLayers };
        }

        function updateLayerBadge() {
            const badge = toolBox.querySelector("#layerBadge");
            if (badge) badge.textContent =
                `${pointLayers.length} point layer${pointLayers.length!==1?"s":""} · ${lineLayers.length} line layer${lineLayers.length!==1?"s":""}`;
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
                #snapMoveToolbox .smt-section {
                    border-radius:3px; margin-bottom:8px; overflow:hidden;
                }
                #snapMoveToolbox .smt-section-header {
                    display:flex; align-items:center; justify-content:space-between;
                    padding:5px 8px; font-size:11px; font-weight:bold;
                }
                #snapMoveToolbox .smt-body { padding:0 8px 8px; }
                #snapMoveToolbox .smt-sublabel {
                    display:flex; align-items:center; justify-content:space-between;
                    font-size:10px; font-weight:bold; color:#444; margin:6px 0 2px;
                }
                #snapMoveToolbox .smt-info-btn {
                    font-size:9px; padding:1px 5px; background:#ccc; color:#444;
                    border:none; border-radius:8px; cursor:pointer; font-family:inherit;
                    line-height:1.4; flex-shrink:0;
                }
                #snapMoveToolbox .smt-info-btn:hover { background:#bbb; }
                #snapMoveToolbox .smt-hint {
                    font-size:10px; color:#666; line-height:1.5;
                    margin-bottom:5px; padding:5px 7px;
                    background:rgba(0,0,0,0.04); border-radius:3px;
                    border-left:2px solid rgba(0,0,0,0.12);
                }
                #snapMoveToolbox .smt-row { display:flex; gap:4px; margin-bottom:4px; }
                #snapMoveToolbox .smt-row button { flex:1; }
                #snapMoveToolbox button {
                    padding:4px 6px; color:white; border:none; border-radius:2px;
                    font-size:11px; cursor:pointer; font-family:inherit;
                }
            </style>

            <!-- ── Drag handle ────────────────────────────────────────── -->
            <div id="smtDragHandle" style="margin:-12px -12px 8px;padding:4px 10px;
                background:#e8e8e8;border-bottom:1px solid #ccc;border-radius:4px 4px 0 0;
                cursor:grab;display:flex;align-items:center;gap:6px;user-select:none;">
                <span style="color:#999;font-size:13px;letter-spacing:2px;">⠿</span>
                <span style="font-size:10px;color:#888;">drag to move</span>
            </div>

            <!-- ── Header ───────────────────────────────────────────── -->
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <div style="font-weight:bold;font-size:13px;">🔧 Click-to-Move Tool</div>
                <div style="display:flex;gap:4px;align-items:center;">
                    <button id="toggleAllTips" title="Show or hide all hint text"
                        style="padding:2px 7px;background:#aaa;color:white;border:none;border-radius:2px;font-size:10px;cursor:pointer;">
                        ℹ Hide Tips</button>
                    <button id="closeTool" title="Close and deactivate the tool"
                        style="padding:2px 8px;background:#d32f2f;color:white;border:none;border-radius:2px;font-size:11px;cursor:pointer;">✕ Close</button>
                </div>
            </div>

            <!-- ── Layer status ──────────────────────────────────────── -->
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;padding:4px 8px;
                        background:#f5f5f5;border:1px solid #ddd;border-radius:3px;font-size:10px;color:#555;"
                 title="Auto-detected layers. Click Refresh if you change visibility or add new layers.">
                <span>🗂</span>
                <span id="layerBadge" style="flex:1;">Detecting layers…</span>
                <button id="refreshLayers" style="padding:2px 7px;font-size:10px;background:#3367d6;border-radius:2px;"
                    title="Re-scan all visible layers">↺ Refresh</button>
            </div>

            <!-- ── Section 1: Tool Activation ───────────────────────── -->
            <div class="smt-section" style="border:1px solid #b8d4f0;">
                <div class="smt-section-header" style="background:#deeeff;color:#1a56a0;">⚡ Tool Activation</div>
                <div class="smt-body" style="background:#f0f7ff;">
                    <div class="smt-sublabel">
                        <span>Activate / Deactivate</span>
                        <button class="smt-info-btn" data-hint="h-activate">▾ more</button>
                    </div>
                    <div id="h-activate" class="smt-hint">
                        Enable to start clicking on the map — the cursor becomes a crosshair.
                        Disable at any time to restore normal map navigation.
                    </div>
                    <div class="smt-row">
                        <button id="enableTool" style="background:#28a745;"
                            title="Activate the tool and begin editing">▶ Enable Tool</button>
                        <button id="disableTool" style="background:#666;" disabled
                            title="Deactivate and restore normal navigation">⏹ Disable Tool</button>
                    </div>
                    <div class="smt-sublabel">
                        <span>Cancel</span>
                        <button class="smt-info-btn" data-hint="h-cancel">▾ more</button>
                    </div>
                    <div id="h-cancel" class="smt-hint">
                        Cancel a pending selection before you've clicked the destination.
                        Use this if you clicked the wrong feature.
                    </div>
                    <button id="cancelMove" style="width:100%;background:#ff9800;" disabled
                        title="Cancel a pending move without saving any changes">⊘ Cancel Current Move</button>
                </div>
            </div>

            <!-- ── Section 2: Single Feature Editing ────────────────── -->
            <div class="smt-section" style="border:1px solid #d4b8f0;">
                <div class="smt-section-header" style="background:#ead8ff;color:#5a1a9e;">📌 Single Feature Editing</div>
                <div class="smt-body" style="background:#faf0ff;">
                    <div class="smt-sublabel">
                        <span>Lock to Feature</span>
                        <button class="smt-info-btn" data-hint="h-lock">▾ more</button>
                    </div>
                    <div id="h-lock" class="smt-hint">
                        Pin all edits to one specific feature — ideal when features overlap.
                        Once locked, only that feature is affected by any click on the map.<br><br>
                        <strong>Point lock:</strong> moves only that point; connected lines are unaffected.<br>
                        <strong>Line lock:</strong> restricts vertex moves, add/delete, and vertex highlights to that line only.
                    </div>
                    <div class="smt-row">
                        <button id="lockFeatureBtn" style="background:#666;"
                            title="Click then click any point or line on the map to lock edits to it">🎯 Pick Feature</button>
                        <button id="releaseFeatureBtn" style="background:#666;" disabled
                            title="Release the lock and return to editing any feature">🔓 Release Lock</button>
                    </div>
                    <div id="lockedFeatureInfo" style="font-size:10px;color:#6f42c1;min-height:14px;font-style:italic;margin-top:2px;"></div>
                </div>
            </div>

            <!-- ── Section 3: Feature Editing Modes ─────────────────── -->
            <div class="smt-section" style="border:1px solid #b8e8c8;">
                <div class="smt-section-header" style="background:#d0f0dc;color:#1a6e3a;">🖱 Feature Editing Modes</div>
                <div class="smt-body" style="background:#f0fff4;">

                    <div class="smt-sublabel">
                        <span>Move Features</span>
                        <button class="smt-info-btn" data-hint="h-move">▾ more</button>
                    </div>
                    <div id="h-move" class="smt-hint">
                        <strong>Point:</strong> Click a point → click the destination. Connected line endpoints follow automatically.<br>
                        <strong>Line:</strong> Click a vertex → click the destination. All coincident lines sharing that vertex move together.<br>
                        Destinations snap to the nearest point feature or line vertex within tolerance.
                    </div>
                    <div class="smt-row">
                        <button id="pointMode" style="background:#3367d6;"
                            title="Move point features. Connected line endpoints follow.">📍 Point Mode</button>
                        <button id="lineMode"  style="background:#666;"
                            title="Move line vertices. Coincident shared vertices move together.">〰️ Line Mode</button>
                    </div>

                    <div class="smt-sublabel">
                        <span>Vertex Tools <span style="font-weight:normal;color:#888;">(Line Mode only)</span></span>
                        <button class="smt-info-btn" data-hint="h-vertex">▾ more</button>
                    </div>
                    <div id="h-vertex" class="smt-hint">
                        <strong>Add:</strong> Click anywhere along a segment to insert a vertex at that exact spot.<br>
                        <strong>Delete:</strong> Click an existing vertex to remove it. Lines with only 2 vertices cannot be reduced further.
                    </div>
                    <div class="smt-row">
                        <button id="addVertexMode"    style="background:#666;"
                            title="Toggle: click along a line segment to insert a new vertex">➕ Add Vertex</button>
                        <button id="deleteVertexMode" style="background:#666;"
                            title="Toggle: click an existing vertex to remove it">✖ Delete Vertex</button>
                    </div>

                    <div class="smt-sublabel">
                        <span>Vertex Visualisation</span>
                        <button class="smt-info-btn" data-hint="h-viz">▾ more</button>
                    </div>
                    <div id="h-viz" class="smt-hint">
                        Overlay vertex markers on all visible line features in the current extent.
                        Auto-refreshes on pan/zoom unless a feature is locked.
                        🟠 = endpoints &nbsp; 🔵 = midpoints
                    </div>
                    <div class="smt-row">
                        <button id="showVerticesToggle" style="background:#666;"
                            title="Toggle vertex markers on the map">👁 Show Vertices</button>
                        <button id="refreshVertices"    style="background:#666;" disabled
                            title="Manually refresh markers for the current extent">🔄 Refresh</button>
                    </div>
                </div>
            </div>

            <!-- ── Status bar ────────────────────────────────────────── -->
            <div id="toolStatus" style="padding:5px 7px;background:#f5f5f5;border:1px solid #ddd;
                border-radius:3px;color:#3367d6;font-size:11px;min-height:18px;"></div>`;

        document.body.appendChild(toolBox);

        // ── Drag to move ──────────────────────────────────────────────────────

        (function() {
            const handle = toolBox.querySelector('#smtDragHandle');
            let dragging = false, ox = 0, oy = 0;

            handle.addEventListener('mousedown', e => {
                dragging = true;
                ox = e.clientX - toolBox.getBoundingClientRect().left;
                oy = e.clientY - toolBox.getBoundingClientRect().top;
                handle.style.cursor = 'grabbing';
                e.preventDefault();
            });

            document.addEventListener('mousemove', e => {
                if (!dragging) return;
                let left = e.clientX - ox;
                let top  = e.clientY - oy;
                left = Math.max(0, Math.min(left, window.innerWidth  - toolBox.offsetWidth));
                top  = Math.max(0, Math.min(top,  window.innerHeight - toolBox.offsetHeight));
                toolBox.style.left   = left + 'px';
                toolBox.style.top    = top  + 'px';
                toolBox.style.right  = 'auto';
            });

            document.addEventListener('mouseup', () => {
                if (!dragging) return;
                dragging = false;
                handle.style.cursor = 'grab';
            });
        })();

        // ── Collapsible hints ─────────────────────────────────────────────────

        toolBox.querySelectorAll('.smt-info-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const hint = toolBox.querySelector('#' + btn.dataset.hint);
                const open = hint.style.display !== 'none';
                hint.style.display = open ? 'none' : '';
                btn.textContent    = open ? '▾ more' : '▴ less';
            });
        });

        toolBox.querySelector('#toggleAllTips').addEventListener('click', () => {
            const btn   = toolBox.querySelector('#toggleAllTips');
            const hints = toolBox.querySelectorAll('.smt-hint');
            const infos = toolBox.querySelectorAll('.smt-info-btn');
            const anyOpen = [...hints].some(h => h.style.display !== 'none');
            hints.forEach(h => h.style.display = anyOpen ? 'none' : '');
            infos.forEach(b => b.textContent   = anyOpen ? '▾ more' : '▴ less');
            btn.textContent = anyOpen ? 'ℹ Show Tips' : 'ℹ Hide Tips';
        });

        // ── State ─────────────────────────────────────────────────────────────

        let toolActive = false, currentMode = "point", vertexMode = "none";
        let selectedFeature = null, selectedLayer = null, selectedLayerConfig = null;
        let selectedVertex = null, selectedCoincidentLines = [], waitingForDestination = false;
        let connectedFeatures = [], originalGeometries = new Map(), clickHandler = null;

        // FIX 2: processing lock — prevents a second click firing handleMoveToDestination
        // while the first async operation is still running (double-click / fast clicks).
        let isProcessingClick = false;

        // Single-feature lock
        let lockedFeature = null, pickingFeatureMode = false;

        // Vertex highlight
        let vertexHighlightActive = false, vertexHighlightLayer = null;
        let extentWatchHandle = null, highlightDebounceTimer = null;

        // Feature picker popup
        let pickerPopup = null;

        // ── DOM refs ──────────────────────────────────────────────────────────

        const $  = id => toolBox.querySelector(id);
        const pointModeBtn          = $("#pointMode");
        const lineModeBtn           = $("#lineMode");
        const addVertexBtn          = $("#addVertexMode");
        const deleteVertexBtn       = $("#deleteVertexMode");
        const showVerticesToggleBtn = $("#showVerticesToggle");
        const refreshVerticesBtn    = $("#refreshVertices");
        const lockFeatureBtn        = $("#lockFeatureBtn");
        const releaseFeatureBtn     = $("#releaseFeatureBtn");
        const lockedFeatureInfo     = $("#lockedFeatureInfo");
        const enableBtn             = $("#enableTool");
        const disableBtn            = $("#disableTool");
        const cancelBtn             = $("#cancelMove");
        const closeBtn              = $("#closeTool");
        const status                = $("#toolStatus");

        const updateStatus = msg => { if (status) status.textContent = msg; };

        // ── Geometry helpers ──────────────────────────────────────────────────

        function calcDist(p1, p2) { const dx=p1.x-p2.x,dy=p1.y-p2.y; return Math.sqrt(dx*dx+dy*dy); }

        function webMercToLatLng(x, y) {
            const lng=(x/20037508.34)*180;
            let lat=(y/20037508.34)*180;
            lat=180/Math.PI*(2*Math.atan(Math.exp(lat*Math.PI/180))-Math.PI/2);
            return {lat,lng};
        }
        function mapPtToLatLng(mp) {
            try {
                const sr=mp.spatialReference;
                if (!sr||sr.wkid===3857||sr.wkid===102100) return webMercToLatLng(mp.x,mp.y);
                if (sr.wkid===4326||sr.wkid===4269) return {lat:mp.y,lng:mp.x};
                return webMercToLatLng(mp.x,mp.y);
            } catch { return {lat:0,lng:0}; }
        }
        function geodeticDist(p1, p2) {
            try {
                const ll1=mapPtToLatLng(p1),ll2=mapPtToLatLng(p2),R=20902231.0;
                const lat1=ll1.lat*Math.PI/180,lat2=ll2.lat*Math.PI/180;
                const dLat=(ll2.lat-ll1.lat)*Math.PI/180,dLng=(ll2.lng-ll1.lng)*Math.PI/180;
                const a=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
                return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
            } catch { return 0; }
        }
        function geodeticLength(geom) {
            try {
                if (!geom?.paths?.length) return 0;
                let t=0;
                for (const path of geom.paths)
                    for (let i=0;i<path.length-1;i++)
                        t+=geodeticDist({x:path[i][0],y:path[i][1],spatialReference:geom.spatialReference},
                                        {x:path[i+1][0],y:path[i+1][1],spatialReference:geom.spatialReference});
                return Math.round(t);
            } catch { return 0; }
        }
        function isEndpoint(geom,pi,vi) {
            if (!geom?.paths?.[pi]) return false;
            const p=geom.paths[pi]; return vi===0||vi===p.length-1;
        }
        function closestPtOnSeg(pt,s,e) {
            const A=pt.x-s.x,B=pt.y-s.y,C=e.x-s.x,D=e.y-s.y;
            const dot=A*C+B*D,lenSq=C*C+D*D,param=lenSq?dot/lenSq:-1;
            const cp=param<0?{x:s.x,y:s.y}:param>1?{x:e.x,y:e.y}:{x:s.x+param*C,y:s.y+param*D};
            return {point:cp,distance:calcDist(pt,cp)};
        }
        function findClosestSeg(geom,mp) {
            if (!geom?.paths) return null;
            let cl=null,mn=Infinity;
            for (let pi=0;pi<geom.paths.length;pi++) {
                const path=geom.paths[pi];
                for (let si=0;si<path.length-1;si++) {
                    const p1={x:path[si][0],y:path[si][1]},p2={x:path[si+1][0],y:path[si+1][1]};
                    const inf=closestPtOnSeg(mp,p1,p2);
                    if (inf.distance<mn){mn=inf.distance;cl={pathIndex:pi,segmentIndex:si,insertIndex:si+1,
                        distance:inf.distance,point:inf.point,segmentStart:p1,segmentEnd:p2};}
                }
            }
            return (cl&&cl.distance<50)?cl:null;
        }
        function findClosestVertex(geom,mp) {
            if (!geom?.paths) return null;
            let cl=null,mn=Infinity;
            for (let pi=0;pi<geom.paths.length;pi++) {
                const path=geom.paths[pi];
                for (let vi=0;vi<path.length;vi++) {
                    const v={x:path[vi][0],y:path[vi][1]},d=calcDist(mp,v);
                    if (d<mn){mn=d;cl={pathIndex:pi,pointIndex:vi,distance:d,coordinates:v,isEndpoint:isEndpoint(geom,pi,vi)};}
                }
            }
            return (cl&&cl.distance < POINT_SNAP_TOLERANCE*(mapView.resolution||1))?cl:null;
        }
        function buildPolyline(srcGeom,newPaths) {
            return {type:"polyline",paths:newPaths,spatialReference:srcGeom.spatialReference};
        }
        function clonePaths(geom) { return geom.paths.map(p=>p.map(c=>c.slice())); }

        // ── Feature picker popup ──────────────────────────────────────────────

        function dismissPickerPopup() { if (pickerPopup){pickerPopup.remove();pickerPopup=null;} }

        function showFeaturePickerPopup(candidates, pageX, pageY) {
            dismissPickerPopup();
            const popup = document.createElement("div");
            pickerPopup = popup;
            popup.style.cssText = `position:fixed;z-index:${z+1};background:#fff;border:1px solid #444;
                border-radius:4px;box-shadow:0 4px 18px rgba(0,0,0,0.28);
                font:12px/1.4 Arial,sans-serif;min-width:220px;max-width:300px;
                max-height:320px;overflow-y:auto;`;
            const margin=12;
            let left=pageX+12,top=pageY-10;
            if (left+310>window.innerWidth)  left=pageX-310;
            if (top+340>window.innerHeight)  top=window.innerHeight-340-margin;
            if (top<margin) top=margin;
            popup.style.left=left+"px"; popup.style.top=top+"px";

            const header=document.createElement("div");
            header.style.cssText="padding:7px 10px 5px;font-weight:bold;font-size:11px;color:#333;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;";
            header.innerHTML=`<span>🗂 ${candidates.length} overlapping features</span>`;
            const closeX=document.createElement("span");
            closeX.textContent="✕"; closeX.style.cssText="cursor:pointer;color:#999;font-size:13px;padding:0 2px;";
            closeX.onclick=()=>{
                dismissPickerPopup(); pickingFeatureMode=false;
                lockFeatureBtn.style.background=lockedFeature?"#6f42c1":"#666";
                lockFeatureBtn.textContent=lockedFeature?"🎯 Re-Pick":"🎯 Pick Feature";
                updateStatus(lockedFeature?`🔒 Locked: ${lockedFeature.layerConfig.name}.`:"Pick cancelled.");
            };
            header.appendChild(closeX); popup.appendChild(header);

            candidates.forEach(c => {
                const row=document.createElement("div");
                row.style.cssText="padding:6px 10px;cursor:pointer;border-bottom:1px solid #f0f0f0;display:flex;flex-direction:column;gap:2px;";
                row.onmouseenter=()=>row.style.background="#f0f4ff";
                row.onmouseleave=()=>row.style.background="";
                const oid=getOid(c.feature)??"?";
                const typeIcon = c.featureType === 'point' ? '📍' : '〰️';
                const title=document.createElement("div");
                title.style.cssText="font-weight:bold;color:#2a2a2a;font-size:11px;";
                title.textContent=`${typeIcon} ${c.layerConfig.name}`;
                const meta=document.createElement("div");
                meta.style.cssText="color:#888;font-size:10px;";
                if (c.featureType === 'line') {
                    const vtxCount=(c.feature.geometry?.paths??[]).reduce((s,p)=>s+p.length,0);
                    const paths=(c.feature.geometry?.paths??[]).length;
                    meta.textContent=`OID: ${oid}  ·  ${vtxCount} vertices  ·  ${paths} path(s)`;
                } else {
                    meta.textContent=`OID: ${oid}  ·  Point feature`;
                }
                row.appendChild(title); row.appendChild(meta);
                row.onclick=()=>{ dismissPickerPopup(); applyLock(c.feature, c.layer, c.layerConfig, c.featureType); };
                popup.appendChild(row);
            });
            document.body.appendChild(popup);
            setTimeout(()=>{
                document.addEventListener("click",function outsideClick(e){
                    if (!popup.contains(e.target)){dismissPickerPopup();document.removeEventListener("click",outsideClick);}
                });
            },0);
        }

        // ── Locked feature helpers ────────────────────────────────────────────

        const getOid = f => f?.attributes?.objectid ?? f?.attributes?.OBJECTID ?? null;

        async function refreshLockedFeature() {
            if (!lockedFeature) return;
            try {
                const oid=getOid(lockedFeature.feature); if (oid==null) return;
                const res=await lockedFeature.layer.queryFeatures({where:`objectid=${oid}`,returnGeometry:true,outFields:["*"]});
                if (res.features.length>0) lockedFeature.feature=res.features[0];
            } catch(e){console.error("refreshLockedFeature error:",e);}
        }

        async function applyLock(feature, layer, cfg, featureType = 'line') {
            lockedFeature = { feature, layer, layerConfig: cfg, featureType };
            pickingFeatureMode = false;
            if (lockFeatureBtn) { lockFeatureBtn.style.background="#6f42c1"; lockFeatureBtn.textContent="🎯 Re-Pick"; }
            if (releaseFeatureBtn) releaseFeatureBtn.disabled=false;
            if (lockedFeatureInfo) {
                const typeLabel = featureType === 'point' ? '📍 point' : '〰️ line';
                lockedFeatureInfo.textContent=`Locked: ${cfg.name} (OID: ${getOid(feature)??"?"}) [${typeLabel}]`;
            }
            if (vertexHighlightActive) scheduleHighlightRefresh();

            if (featureType === 'line') {
                setLineMode();
                updateStatus(`🔒 Locked to ${cfg.name}. Click any vertex to select it, then click the destination.`);
            } else {
                setPointMode();
                if (toolActive) {
                    selectedFeature   = feature;
                    selectedLayer     = layer;
                    selectedLayerConfig = cfg;
                    selectedVertex    = null;
                    waitingForDestination = true;
                    if (feature.geometry?.clone) originalGeometries.set(getOid(feature) ?? 'locked', feature.geometry.clone());
                    if (cancelBtn) cancelBtn.disabled = false;
                    connectedFeatures = await findConnectedLines(feature.geometry);
                    updateStatus(`🔒 Locked to ${cfg.name}. Click the destination to move it (${connectedFeatures.length} connected line(s)).`);
                } else {
                    updateStatus(`🔒 Locked to ${cfg.name}. Enable the tool then click the destination.`);
                }
            }
        }

        function releaseLockedFeature() {
            dismissPickerPopup(); lockedFeature=null; pickingFeatureMode=false;
            if (lockFeatureBtn) { lockFeatureBtn.style.background="#666"; lockFeatureBtn.textContent="🎯 Pick Feature"; }
            if (releaseFeatureBtn) releaseFeatureBtn.disabled=true;
            if (lockedFeatureInfo) lockedFeatureInfo.textContent="";
            if (vertexHighlightActive) scheduleHighlightRefresh();
            const mText=currentMode==="point"?"point feature":"line vertex";
            updateStatus(toolActive?`Feature released. Click on a ${mText} to select it.`:"Feature released.");
        }

        async function pickFeature(event) {
            const sp={x:event.x,y:event.y};
            updateStatus("Looking for feature...");
            try {
                const candidates=[], seenOids=new Set();

                if (mapView.hitTest) {
                    const hit=await mapView.hitTest(sp,{include:mapView.map.allLayers.filter(l=>l.type==="feature")});
                    for (const r of hit.results) {
                        const gtype = r.graphic?.geometry?.type;
                        if (gtype === "polyline") {
                            const cfg=lineLayers.find(l=>l.id===r.layer.layerId);
                            if (!cfg) continue;
                            const oid=getOid(r.graphic);
                            if (oid!=null&&seenOids.has(oid)) continue;
                            if (oid!=null) seenOids.add(oid);
                            candidates.push({feature:r.graphic,layer:r.layer,layerConfig:cfg,featureType:'line'});
                        } else if (gtype === "point" || gtype === "multipoint") {
                            const cfg=pointLayers.find(p=>p.id===r.layer.layerId);
                            if (!cfg) continue;
                            const oid=getOid(r.graphic);
                            if (oid!=null&&seenOids.has(oid)) continue;
                            if (oid!=null) seenOids.add(oid);
                            candidates.push({feature:r.graphic,layer:r.layer,layerConfig:cfg,featureType:'point'});
                        }
                    }
                }

                if (candidates.length===0) {
                    const mp=mapView.toMap(sp), tol=30;
                    const ext = makeExt(mp.x, mp.y, tol, mapView.spatialReference);

                    for (const cfg of lineLayers) {
                        if (!cfg.layer.visible) continue;
                        const res=await cfg.layer.queryFeatures({geometry:ext,spatialRelationship:"intersects",returnGeometry:true,outFields:["*"],maxRecordCount:20});
                        for (const f of res.features) {
                            const oid=getOid(f);
                            if (oid!=null&&seenOids.has(oid)) continue;
                            if (oid!=null) seenOids.add(oid);
                            candidates.push({feature:f,layer:cfg.layer,layerConfig:cfg,featureType:'line'});
                        }
                    }

                    for (const cfg of pointLayers) {
                        if (!cfg.layer.visible) continue;
                        const res=await cfg.layer.queryFeatures({geometry:ext,spatialRelationship:"intersects",returnGeometry:true,outFields:["*"],maxRecordCount:20});
                        for (const f of res.features) {
                            const oid=getOid(f);
                            if (oid!=null&&seenOids.has(oid)) continue;
                            if (oid!=null) seenOids.add(oid);
                            candidates.push({feature:f,layer:cfg.layer,layerConfig:cfg,featureType:'point'});
                        }
                    }
                }

                if (candidates.length===0){updateStatus("❌ No feature found. Click directly on a point or line feature.");return;}
                if (candidates.length===1){applyLock(candidates[0].feature,candidates[0].layer,candidates[0].layerConfig,candidates[0].featureType);}
                else {
                    const rect=mapView.container.getBoundingClientRect();
                    showFeaturePickerPopup(candidates,rect.left+sp.x,rect.top+sp.y);
                    updateStatus(`🗂 ${candidates.length} overlapping features found. Choose one from the menu.`);
                }
            } catch(e){console.error("pickFeature error:",e);updateStatus("❌ Error picking feature.");}
        }

        // ── Layer query helpers ───────────────────────────────────────────────

        async function findNearestPointFeature(mapPt) {
            try {
                const tol=POINT_SNAP_TOLERANCE*(mapView.resolution||1);
                const ext = makeExt(mapPt.x, mapPt.y, tol, mapView.spatialReference);
                let nearest=null,minD=Infinity;
                for (const cfg of pointLayers) {
                    if (!cfg.layer.visible) continue;
                    try {
                        const res=await cfg.layer.queryFeatures({geometry:ext,spatialRelationship:"intersects",returnGeometry:true,outFields:["*"]});
                        for (const f of res.features){
                            if (!f.geometry) continue;
                            const d=calcDist(mapPt,f.geometry);
                            if(d<minD){minD=d;nearest={feature:f,layer:cfg.layer,layerConfig:cfg,distance:d,geometry:f.geometry};}
                        }
                    } catch(e){console.error(`findNearestPointFeature error on ${cfg.name}:`,e);}
                }
                return (nearest&&nearest.distance<tol)?nearest:null;
            } catch(e){console.error("findNearestPointFeature error:",e);return null;}
        }

        async function findNearestLineVertex(dst, excludeOids = new Set()) {
            try {
                const tol = POINT_SNAP_TOLERANCE * (mapView.resolution || 1);
                const ext = makeExt(dst.x, dst.y, tol, mapView.spatialReference);
                let nearest = null, minD = Infinity, nearestCfg = null;
                for (const cfg of lineLayers) {
                    if (!cfg.layer.visible) continue;
                    try {
                        const res = await cfg.layer.queryFeatures({
                            geometry: ext, spatialRelationship: "intersects",
                            returnGeometry: true, outFields: ["objectid"],
                            outSpatialReference: mapView.spatialReference
                        });
                        for (const f of res.features) {
                            if (excludeOids.has(getOid(f))) continue;
                            if (!f.geometry?.paths) continue;
                            for (const path of f.geometry.paths) {
                                for (const coord of path) {
                                    const d = calcDist(dst, {x: coord[0], y: coord[1]});
                                    if (d < minD) {
                                        minD = d;
                                        nearest = {x: coord[0], y: coord[1], spatialReference: dst.spatialReference};
                                        nearestCfg = cfg;
                                    }
                                }
                            }
                        }
                    } catch(e) { console.error(`findNearestLineVertex error on ${cfg.name}:`, e); }
                }
                return (nearest && minD < tol)
                    ? { geometry: nearest, layerConfig: nearestCfg, snapType: 'lineVertex' }
                    : null;
            } catch(e) { console.error("findNearestLineVertex error:", e); return null; }
        }

        async function findSnapTarget(dst, excludeOids = new Set()) {
            const [pointSnap, vertexSnap] = await Promise.all([
                findNearestPointFeature(dst),
                findNearestLineVertex(dst, excludeOids)
            ]);
            if (!pointSnap && !vertexSnap) return null;
            if (pointSnap && !vertexSnap) return { ...pointSnap, snapType: 'pointFeature' };
            if (!pointSnap && vertexSnap) return vertexSnap;
            const dPoint  = calcDist(dst, pointSnap.geometry);
            const dVertex = calcDist(dst, vertexSnap.geometry);
            return dPoint <= dVertex
                ? { ...pointSnap, snapType: 'pointFeature' }
                : vertexSnap;
        }

        async function findPointFeatureAtLocation(sp) {
            try {
                if (mapView.hitTest) {
                    const hit=await mapView.hitTest(sp,{include:mapView.map.allLayers.filter(l=>l.type==="feature")});
                    for (const r of hit.results)
                        if (r.graphic?.geometry?.type==="point") {
                            const cfg=pointLayers.find(p=>p.id===r.layer.layerId);
                            if (cfg) return {feature:r.graphic,layer:r.layer,layerConfig:cfg};
                        }
                }
                const mp=mapView.toMap(sp),tol=SNAP_TOLERANCE*(mapView.resolution||1);
                const ext = makeExt(mp.x, mp.y, tol, mapView.spatialReference);
                for (const cfg of pointLayers) {
                    if (!cfg.layer.visible) continue;
                    try {
                        const res=await cfg.layer.queryFeatures({geometry:ext,spatialRelationship:"intersects",returnGeometry:true,outFields:["*"]});
                        if (res.features.length>0){
                            let best=null,bestD=Infinity;
                            for(const f of res.features){
                                if (!f.geometry) continue;
                                const d=calcDist(mp,f.geometry);if(d<bestD){bestD=d;best=f;}
                            }
                            if (best) return {feature:best,layer:cfg.layer,layerConfig:cfg};
                        }
                    } catch(e){console.error(`findPointFeatureAtLocation error on ${cfg.name}:`,e);}
                }
            } catch(e){console.error("findPointFeatureAtLocation error:",e);}
            return null;
        }

        async function findCoincidentLinesForVertexCreation(sp, mp) {
            try {
                const bufM=10/3.28084, lines=[];
                if (lockedFeature?.featureType === 'line') {
                    await refreshLockedFeature();
                    const seg=findClosestSeg(lockedFeature.feature.geometry,mp);
                    if (seg&&seg.distance<=bufM) lines.push({feature:lockedFeature.feature,layer:lockedFeature.layer,layerConfig:lockedFeature.layerConfig,segmentInfo:seg});
                    return lines;
                }
                if (mapView.hitTest) {
                    const hit=await mapView.hitTest(sp,{include:mapView.map.allLayers.filter(l=>l.type==="feature")});
                    for (const r of hit.results)
                        if (r.graphic?.geometry?.type==="polyline") {
                            const cfg=lineLayers.find(l=>l.id===r.layer.layerId);
                            if (cfg){const seg=findClosestSeg(r.graphic.geometry,mp);if(seg&&seg.distance<=bufM)lines.push({feature:r.graphic,layer:r.layer,layerConfig:cfg,segmentInfo:seg});}
                        }
                }
                if (lines.length===0) {
                    for (const cfg of lineLayers) {
                        if (!cfg.layer.visible) continue;
                        try {
                            const buf={type:"polygon",spatialReference:mp.spatialReference,
                                rings:[[[mp.x-bufM,mp.y-bufM],[mp.x+bufM,mp.y-bufM],[mp.x+bufM,mp.y+bufM],[mp.x-bufM,mp.y+bufM],[mp.x-bufM,mp.y-bufM]]]};
                            const res=await cfg.layer.queryFeatures({geometry:buf,spatialRelationship:"intersects",returnGeometry:true,outFields:["*"],maxRecordCount:50});
                            for(const f of res.features){const seg=findClosestSeg(f.geometry,mp);if(seg&&seg.distance<=bufM)lines.push({feature:f,layer:cfg.layer,layerConfig:cfg,segmentInfo:seg});}
                        } catch(e){console.error(`findCoincidentLines error on ${cfg.name}:`,e);}
                    }
                }
                return lines;
            } catch(e){console.error("findCoincidentLinesForVertexCreation error:",e);return [];}
        }

        async function findCoincidentLineVertices(sp) {
            try {
                const clickPt=mapView.toMap(sp);
                const snapTol=POINT_SNAP_TOLERANCE*(mapView.resolution||1);
                const lines=[];
                if (lockedFeature?.featureType === 'line') {
                    await refreshLockedFeature();
                    const v=findClosestVertex(lockedFeature.feature.geometry,clickPt);
                    if (v&&v.distance<snapTol) lines.push({feature:lockedFeature.feature,layer:lockedFeature.layer,layerConfig:lockedFeature.layerConfig,vertex:v});
                    return lines;
                }
                if (mapView.hitTest) {
                    const hit=await mapView.hitTest(sp,{include:mapView.map.allLayers.filter(l=>l.type==="feature")});
                    for (const r of hit.results)
                        if (r.graphic?.geometry?.type==="polyline") {
                            const cfg=lineLayers.find(l=>l.id===r.layer.layerId);
                            if (cfg){const v=findClosestVertex(r.graphic.geometry,clickPt);if(v&&v.distance<snapTol)lines.push({feature:r.graphic,layer:r.layer,layerConfig:cfg,vertex:v});}
                        }
                }
                if (lines.length===0) {
                    const ext = makeExt(clickPt.x, clickPt.y, snapTol, mapView.spatialReference);
                    for (const cfg of lineLayers) {
                        if (!cfg.layer.visible) continue;
                        try {
                            const res=await cfg.layer.queryFeatures({geometry:ext,spatialRelationship:"intersects",returnGeometry:true,outFields:["*"],maxRecordCount:50});
                            for(const f of res.features){const v=findClosestVertex(f.geometry,clickPt);if(v&&v.distance<snapTol)lines.push({feature:f,layer:cfg.layer,layerConfig:cfg,vertex:v});}
                        } catch(e){console.error(`findCoincidentLineVertices error on ${cfg.name}:`,e);}
                    }
                }
                if (lines.length>0){const ref=lines[0].vertex.coordinates;return lines.filter(li=>calcDist(ref,li.vertex.coordinates)<snapTol);}
                return [];
            } catch(e){console.error("findCoincidentLineVertices error:",e);return [];}
        }

        async function findConnectedLines(ptGeom) {
            const connected=[],bufM=10/3.28084;
            for (const cfg of lineLayers) {
                if (!cfg.layer.visible) continue;
                try {
                    const buf={type:"polygon",spatialReference:ptGeom.spatialReference,
                        rings:[[[ptGeom.x-bufM,ptGeom.y-bufM],[ptGeom.x+bufM,ptGeom.y-bufM],[ptGeom.x+bufM,ptGeom.y+bufM],[ptGeom.x-bufM,ptGeom.y+bufM],[ptGeom.x-bufM,ptGeom.y-bufM]]]};
                    const res=await cfg.layer.queryFeatures({geometry:buf,spatialRelationship:"intersects",returnGeometry:true,outFields:["*"],maxRecordCount:100});
                    for (const f of res.features) {
                        if (!f.geometry?.paths) continue;
                        for (let pi=0;pi<f.geometry.paths.length;pi++) {
                            const path=f.geometry.paths[pi]; if(path.length<2)continue;
                            const start={x:path[0][0],y:path[0][1]},end={x:path[path.length-1][0],y:path[path.length-1][1]};
                            const sd=calcDist(ptGeom,start),ed=calcDist(ptGeom,end);
                            let conn=null;
                            if(sd<bufM) conn={pathIndex:pi,pointIndex:0,isStart:true};
                            else if(ed<bufM) conn={pathIndex:pi,pointIndex:path.length-1,isStart:false};
                            if(conn){connected.push({feature:f,layer:cfg.layer,layerConfig:cfg,connection:conn});if(f.geometry.clone)originalGeometries.set(f.attributes.objectid,f.geometry.clone());}
                        }
                    }
                } catch(e){console.error(`findConnectedLines error on ${cfg.name}:`,e);}
            }
            return connected;
        }

        async function updateConnectedLines(newPt) {
            for (const info of connectedFeatures) {
                try {
                    const orig=originalGeometries.get(info.feature.attributes.objectid);
                    if (!orig?.clone) continue;
                    const newGeom=orig.clone();
                    newGeom.paths[info.connection.pathIndex][info.connection.pointIndex]=[newPt.x,newPt.y];
                    const upd=info.feature.clone(); upd.geometry=newGeom;
                    upd.attributes.calculated_length=geodeticLength(newGeom);
                    if(info.layer.applyEdits) await info.layer.applyEdits({updateFeatures:[upd]});
                } catch(e){console.error("updateConnectedLines error:",e);}
            }
        }

        // ── Vertex operations ─────────────────────────────────────────────────

        function lockedReadyStatus() {
            if (!lockedFeature) {
                return currentMode === 'point'
                    ? "Click on a point feature to select it."
                    : "Line mode active. Click on a line vertex to select it.";
            }
            if (lockedFeature.featureType === 'point') {
                return `🔒 Locked: ${lockedFeature.layerConfig.name} (point). Click the locked point to move it.`;
            }
            return `🔒 Locked: ${lockedFeature.layerConfig.name}. Click a vertex to move, or use Add/Delete mode.`;
        }

        async function addVertexToLine(event) {
            const sp={x:event.x,y:event.y},mp=mapView.toMap(sp);
            updateStatus("Adding vertex to line...");
            try {
                const lines=await findCoincidentLinesForVertexCreation(sp,mp);
                if (!lines.length){updateStatus("❌ No lines found to add vertex to.");return;}
                const updates=[];
                for (const li of lines) {
                    try {
                        const newPaths=clonePaths(li.feature.geometry);
                        newPaths[li.segmentInfo.pathIndex].splice(li.segmentInfo.insertIndex,0,[li.segmentInfo.point.x,li.segmentInfo.point.y]);
                        const newGeom=buildPolyline(li.feature.geometry,newPaths);
                        const upd=li.feature.clone(); upd.geometry=newGeom; upd.attributes.calculated_length=geodeticLength(newGeom);
                        updates.push({layer:li.layer,feature:upd,layerName:li.layerConfig.name});
                    } catch(e){console.error(`addVertexToLine error on ${li.layerConfig.name}:`,e);}
                }
                if (!updates.length){updateStatus("❌ No vertices could be added.");return;}
                for (const u of updates) if(u.layer.applyEdits) await u.layer.applyEdits({updateFeatures:[u.feature]});
                updateStatus(`✅ Added vertex to ${updates.length} line(s): ${updates.map(u=>u.layerName).join(", ")}!`);
                if(lockedFeature) await refreshLockedFeature();
                if(vertexHighlightActive) scheduleHighlightRefresh();
                setTimeout(()=>updateStatus(lockedReadyStatus()),3000);
            } catch(e){console.error("addVertexToLine error:",e);updateStatus("❌ Error adding vertex.");}
        }

        async function deleteVertexFromLine(event) {
            const sp={x:event.x,y:event.y};
            updateStatus("Deleting vertex from line...");
            try {
                const results=await findCoincidentLineVertices(sp);
                if (!results.length){updateStatus("❌ No line vertex found to delete.");return;}
                const updates=[];
                for (const li of results) {
                    try {
                        const srcGeom=li.feature.geometry; if(!srcGeom?.paths)continue;
                        const newPaths=clonePaths(srcGeom);
                        const path=newPaths[li.vertex.pathIndex];
                        if(path.length<=2){console.log(`Skipping: path has only ${path.length} vertices.`);continue;}
                        path.splice(li.vertex.pointIndex,1);
                        const newGeom=buildPolyline(srcGeom,newPaths);
                        const upd=li.feature.clone(); upd.geometry=newGeom; upd.attributes.calculated_length=geodeticLength(newGeom);
                        updates.push({layer:li.layer,feature:upd,layerName:li.layerConfig.name});
                    } catch(e){console.error("deleteVertexFromLine prep error:",e);}
                }
                if (!updates.length){updateStatus("❌ No vertices deleted (lines with only 2 vertices cannot be reduced further).");return;}
                for (const u of updates) if(u.layer.applyEdits) await u.layer.applyEdits({updateFeatures:[u.feature]});
                updateStatus(`✅ Deleted vertex from ${updates.length} line(s): ${updates.map(u=>u.layerName).join(", ")}!`);
                if(lockedFeature) await refreshLockedFeature();
                if(vertexHighlightActive) scheduleHighlightRefresh();
                setTimeout(()=>updateStatus(lockedReadyStatus()),3000);
            } catch(e){console.error("deleteVertexFromLine error:",e);updateStatus("❌ Error deleting vertex.");}
        }

        // ── Feature selection & movement ──────────────────────────────────────

        async function handleFeatureSelection(event) {
            const sp={x:event.x,y:event.y};
            updateStatus("Searching for feature...");

            if (currentMode==="point") {
                if (lockedFeature?.featureType === 'point') {
                    await refreshLockedFeature();
                    const r = await findPointFeatureAtLocation(sp);
                    const clickOid = r ? getOid(r.feature) : null;
                    const lockOid = getOid(lockedFeature.feature);
                    if (!r || (lockOid != null && clickOid !== lockOid)) {
                        updateStatus(`🔒 Locked to ${lockedFeature.layerConfig.name}. Click directly on the locked point to move it.`);
                        return;
                    }
                    selectedFeature = lockedFeature.feature;
                    selectedLayer = lockedFeature.layer;
                    selectedLayerConfig = lockedFeature.layerConfig;
                    selectedVertex = null;
                    connectedFeatures = await findConnectedLines(lockedFeature.feature.geometry);
                    if (selectedFeature.geometry?.clone) originalGeometries.set(selectedFeature.attributes.objectid, selectedFeature.geometry.clone());
                    if (cancelBtn) cancelBtn.disabled = false;
                    waitingForDestination = true;
                    updateStatus(`🎯 Locked ${lockedFeature.layerConfig.name} selected. Click destination to move.`);
                    return;
                }

                const r=await findPointFeatureAtLocation(sp);
                if (r){
                    selectedFeature=r.feature;selectedLayer=r.layer;selectedLayerConfig=r.layerConfig;selectedVertex=null;
                    connectedFeatures=await findConnectedLines(r.feature.geometry);
                    if(selectedFeature.geometry?.clone)originalGeometries.set(selectedFeature.attributes.objectid,selectedFeature.geometry.clone());
                    if(cancelBtn)cancelBtn.disabled=false;
                    waitingForDestination=true;
                    updateStatus(`🎯 ${r.layerConfig.name} selected with ${connectedFeatures.length} connected line(s). Click destination to move.`);
                } else {updateStatus("❌ No point feature found.");}
            } else {
                const results=await findCoincidentLineVertices(sp);
                if (results.length>0){
                    selectedCoincidentLines=results;selectedFeature=results[0].feature;
                    selectedLayer=results[0].layer;selectedLayerConfig=results[0].layerConfig;selectedVertex=results[0].vertex;
                    for(const li of results)if(li.feature.geometry?.clone)originalGeometries.set(li.feature.attributes.objectid,li.feature.geometry.clone());
                    if(cancelBtn)cancelBtn.disabled=false;
                    waitingForDestination=true;
                    const vType=results[0].vertex.isEndpoint?"endpoint":"vertex";
                    const snap=results[0].vertex.isEndpoint?" (will snap to nearest point or line vertex)":"";
                    const lockNote=lockedFeature?.featureType==='line'?" [🔒 Locked feature]":"";
                    updateStatus(`🎯 Selected ${vType} on ${results.length} line(s): ${results.map(r=>r.layerConfig.name).join(", ")}${snap}${lockNote}. Click destination.`);
                } else {updateStatus("❌ No line vertex found.");}
            }
        }

        async function handleMoveToDestination(event) {
            // FIX 2: guard against selectedFeature being cleared by a concurrent call
            if (!selectedFeature) { updateStatus("❌ No feature selected. Click a feature first."); return; }

            let dst=mapView.toMap({x:event.x,y:event.y});
            updateStatus("Moving feature...");
            try {
                if (currentMode==="point") {
                    const excludeOids = new Set([getOid(selectedFeature)].filter(Boolean));
                    const snapInfo = await findSnapTarget(dst, excludeOids);
                    if (snapInfo) dst = snapInfo.geometry;

                    const isLockedPoint = lockedFeature?.featureType === 'point';
                    if (!isLockedPoint) await updateConnectedLines(dst);
                    const upd=selectedFeature.clone(); upd.geometry=dst;
                    if(selectedLayer.applyEdits)await selectedLayer.applyEdits({updateFeatures:[upd]});
                    const movedLines = isLockedPoint ? 0 : connectedFeatures.length;
                    let msg = movedLines > 0
                        ? `✅ Moved ${selectedLayerConfig.name} and ${movedLines} connected line(s)!`
                        : `✅ Moved ${selectedLayerConfig.name}!`;
                    if (snapInfo) {
                        const snapDesc = snapInfo.snapType === 'lineVertex'
                            ? `line vertex in ${snapInfo.layerConfig.name}`
                            : `point feature in ${snapInfo.layerConfig.name}`;
                        msg += ` Snapped to ${snapDesc}.`;
                    }
                    updateStatus(msg);
                } else {
                    const excludeOids = new Set(
                        selectedCoincidentLines.map(li => getOid(li.feature)).filter(Boolean)
                    );
                    const snapInfo = await findSnapTarget(dst, excludeOids);
                    if (snapInfo) dst = snapInfo.geometry;

                    const updates=[];
                    for (const li of selectedCoincidentLines) {
                        try {
                            const newPaths=clonePaths(li.feature.geometry);
                            const path=newPaths[li.vertex.pathIndex];
                            if(path?.[li.vertex.pointIndex])path[li.vertex.pointIndex]=[dst.x,dst.y];
                            const newGeom=buildPolyline(li.feature.geometry,newPaths);
                            const upd=li.feature.clone(); upd.geometry=newGeom; upd.attributes.calculated_length=geodeticLength(newGeom);
                            updates.push({layer:li.layer,feature:upd,layerName:li.layerConfig.name});
                        } catch(e){console.error("handleMoveToDestination line prep error:",e);}
                    }
                    let ok=0;
                    for(const u of updates){try{if(u.layer.applyEdits){await u.layer.applyEdits({updateFeatures:[u.feature]});ok++;}}catch(e){console.error("applyEdits error:",e);}}
                    const vLabel = selectedVertex.isEndpoint ? "endpoint" : "vertex";
                    let msg = `✅ Moved ${vLabel} on ${ok} line(s) and recalculated lengths!`;
                    if (snapInfo) {
                        const snapDesc = snapInfo.snapType === 'lineVertex'
                            ? `line vertex in ${snapInfo.layerConfig.name}`
                            : `point feature in ${snapInfo.layerConfig.name}`;
                        msg += ` Snapped to ${snapDesc}.`;
                    }
                    updateStatus(msg);
                }

                selectedFeature=null;selectedLayer=null;selectedLayerConfig=null;
                selectedVertex=null;selectedCoincidentLines=[];waitingForDestination=false;
                connectedFeatures=[];originalGeometries.clear();
                if(cancelBtn)cancelBtn.disabled=true;
                if(lockedFeature)await refreshLockedFeature();
                if(vertexHighlightActive)scheduleHighlightRefresh();
                setTimeout(()=>updateStatus(lockedReadyStatus()),3000);
            } catch(e){console.error("handleMoveToDestination error:",e);updateStatus("❌ Error moving feature.");}
        }

        // FIX 2: isProcessingClick gate prevents double-click or rapid clicks from
        // firing a second async handleClick before the first one completes.
        async function handleClick(event) {
            if (!toolActive) return;
            if (isProcessingClick) return;
            isProcessingClick = true;
            event.stopPropagation();
            try {
                if(pickingFeatureMode){await pickFeature(event);}
                else if(vertexMode==="add"){await addVertexToLine(event);}
                else if(vertexMode==="delete"){await deleteVertexFromLine(event);}
                else if(!selectedFeature){await handleFeatureSelection(event);}
                else{await handleMoveToDestination(event);}
            } finally {
                isProcessingClick = false;
            }
        }

        // ── Vertex highlight ──────────────────────────────────────────────────

        function loadGraphicClasses() {
            return new Promise((resolve,reject)=>{
                if(typeof require!=="undefined") require(["esri/Graphic","esri/layers/GraphicsLayer"],(G,GL)=>resolve({Graphic:G,GraphicsLayer:GL}),reject);
                else reject(new Error("ArcGIS require() not found"));
            });
        }

        function makeVertexGraphic(Graphic,x,y,sr,endpoint) {
            return new Graphic({geometry:{type:"point",x,y,spatialReference:sr},
                symbol:{type:"simple-marker",style:endpoint?"circle":"square",
                    color:endpoint?[255,120,0,220]:[30,130,255,200],size:endpoint?10:7,
                    outline:{color:[255,255,255,230],width:1.5}}});
        }

        async function renderVertexHighlights() {
            if (!vertexHighlightActive) return;
            updateStatus("Loading vertex highlights...");
            try {
                const {Graphic,GraphicsLayer}=await loadGraphicClasses();
                if (!vertexHighlightLayer){vertexHighlightLayer=new GraphicsLayer({listMode:"hide"});mapView.map.add(vertexHighlightLayer);}
                vertexHighlightLayer.removeAll();
                let total=0;

                const renderGeom=(geom)=>{
                    if(!geom?.paths)return;
                    for(const path of geom.paths)
                        for(let i=0;i<path.length;i++){
                            vertexHighlightLayer.add(makeVertexGraphic(Graphic,path[i][0],path[i][1],geom.spatialReference,i===0||i===path.length-1));
                            total++;
                        }
                };

                if (lockedFeature?.featureType === 'line') {
                    renderGeom(lockedFeature.feature.geometry);
                    updateStatus(`👁 Showing ${total} vertices for locked feature (${lockedFeature.layerConfig.name}).`);
                } else {
                    for (const cfg of lineLayers) {
                        if (!cfg.layer.visible) continue;
                        try {
                            const res=await cfg.layer.queryFeatures({geometry:mapView.extent,spatialRelationship:"intersects",
                                returnGeometry:true,outFields:["objectid"],maxRecordCount:500});
                            for(const f of res.features)renderGeom(f.geometry);
                        } catch(e){console.error(`renderVertexHighlights error on ${cfg.name}:`,e);}
                    }
                    updateStatus(`👁 Showing ${total} vertices across ${lineLayers.filter(l=>l.layer.visible).length} visible line layer(s). Click Refresh to update.`);
                }
            } catch(e){console.error("renderVertexHighlights error:",e);updateStatus("❌ Error loading vertex highlights.");}
        }

        function clearVertexHighlights() {
            if(vertexHighlightLayer){vertexHighlightLayer.removeAll();mapView.map.remove(vertexHighlightLayer);vertexHighlightLayer=null;}
        }

        function scheduleHighlightRefresh() {
            clearTimeout(highlightDebounceTimer);
            highlightDebounceTimer=setTimeout(()=>renderVertexHighlights(),600);
        }

        function toggleVertexHighlight() {
            vertexHighlightActive=!vertexHighlightActive;
            if (vertexHighlightActive){
                showVerticesToggleBtn.style.background="#6f42c1";
                showVerticesToggleBtn.textContent="👁 Hide Vertices";
                if(refreshVerticesBtn)refreshVerticesBtn.disabled=false;
                renderVertexHighlights();
                extentWatchHandle=mapView.watch("extent",()=>{if(vertexHighlightActive&&lockedFeature?.featureType!=='line')scheduleHighlightRefresh();});
            } else {
                showVerticesToggleBtn.style.background="#666";
                showVerticesToggleBtn.textContent="👁 Show Vertices";
                if(refreshVerticesBtn)refreshVerticesBtn.disabled=true;
                clearVertexHighlights();
                if(extentWatchHandle){extentWatchHandle.remove();extentWatchHandle=null;}
                clearTimeout(highlightDebounceTimer);
                updateStatus(toolActive?`Ready. Click on a ${currentMode==="point"?"point feature":"line vertex"} to select it.`:"Tool disabled.");
            }
        }

        // ── Mode setters ──────────────────────────────────────────────────────

        function cancelMove() {
            selectedFeature=null;selectedLayer=null;selectedLayerConfig=null;
            selectedVertex=null;selectedCoincidentLines=[];waitingForDestination=false;
            connectedFeatures=[];originalGeometries.clear();isProcessingClick=false;
            if(cancelBtn)cancelBtn.disabled=true;
            if(lockedFeature)          updateStatus(lockedReadyStatus());
            else if(vertexMode==="add")    updateStatus("Add Vertex mode active. Click on any line segment.");
            else if(vertexMode==="delete") updateStatus("Delete Vertex mode active. Click on any vertex.");
            else { const m=currentMode==="point"?"point feature":"line vertex"; updateStatus(`Move cancelled. Click on a ${m} to select it.`); }
        }

        function setAddVertexMode() {
            vertexMode=vertexMode==="add"?"none":"add";
            if(addVertexBtn)    addVertexBtn.style.background    =vertexMode==="add"?"#28a745":"#666";
            if(deleteVertexBtn) deleteVertexBtn.style.background="#666";
            if(selectedFeature) cancelMove();
            if(toolActive) updateStatus(vertexMode==="add"?"Add Vertex mode active. Click anywhere on a line to insert a vertex.":"Mode cleared.");
        }
        function setDeleteVertexMode() {
            vertexMode=vertexMode==="delete"?"none":"delete";
            if(deleteVertexBtn) deleteVertexBtn.style.background=vertexMode==="delete"?"#dc3545":"#666";
            if(addVertexBtn)    addVertexBtn.style.background="#666";
            if(selectedFeature) cancelMove();
            if(toolActive) updateStatus(vertexMode==="delete"?"Delete Vertex mode active. Click any vertex or endpoint to delete it.":"Mode cleared.");
        }
        function setPointMode() {
            currentMode="point";vertexMode="none";
            if(pointModeBtn)    pointModeBtn.style.background="#3367d6";
            if(lineModeBtn)     lineModeBtn.style.background="#666";
            if(addVertexBtn)    addVertexBtn.style.background="#666";
            if(deleteVertexBtn) deleteVertexBtn.style.background="#666";
            if(toolActive) updateStatus("Point mode active. Click on a point feature to select it.");
            if(selectedFeature) cancelMove();
        }
        function setLineMode() {
            currentMode="line";vertexMode="none";
            if(pointModeBtn)    pointModeBtn.style.background="#666";
            if(lineModeBtn)     lineModeBtn.style.background="#3367d6";
            if(addVertexBtn)    addVertexBtn.style.background="#666";
            if(deleteVertexBtn) deleteVertexBtn.style.background="#666";
            if(toolActive) updateStatus(lockedReadyStatus());
            if(selectedFeature) cancelMove();
        }
        function enableTool() {
            toolActive=true;
            clickHandler=mapView.on("click",handleClick);
            if(enableBtn)  enableBtn.disabled=true;
            if(disableBtn) disableBtn.disabled=false;
            if(mapView.container)mapView.container.style.cursor="crosshair";
            updateStatus(`Tool enabled in ${currentMode} mode. Click on a ${currentMode==="point"?"point feature":"line vertex"} to select it.`);
        }
        function disableTool() {
            toolActive=false;pickingFeatureMode=false;isProcessingClick=false;
            selectedFeature=null;selectedLayer=null;selectedLayerConfig=null;
            selectedVertex=null;selectedCoincidentLines=[];waitingForDestination=false;
            connectedFeatures=[];originalGeometries.clear();vertexMode="none";
            if(addVertexBtn)    addVertexBtn.style.background="#666";
            if(deleteVertexBtn) deleteVertexBtn.style.background="#666";
            if(lockFeatureBtn)  {lockFeatureBtn.style.background=lockedFeature?"#6f42c1":"#666";lockFeatureBtn.textContent=lockedFeature?"🎯 Re-Pick":"🎯 Pick Feature";}
            if(clickHandler)clickHandler.remove();
            if(enableBtn)  enableBtn.disabled=false;
            if(disableBtn) disableBtn.disabled=true;
            if(cancelBtn)  cancelBtn.disabled=true;
            if(mapView.container)mapView.container.style.cursor="default";
            updateStatus("Tool disabled.");
        }

        // ── Wire up buttons ───────────────────────────────────────────────────

        if(pointModeBtn)          pointModeBtn.onclick          =setPointMode;
        if(lineModeBtn)           lineModeBtn.onclick           =setLineMode;
        if(addVertexBtn)          addVertexBtn.onclick          =setAddVertexMode;
        if(deleteVertexBtn)       deleteVertexBtn.onclick       =setDeleteVertexMode;
        if(showVerticesToggleBtn) showVerticesToggleBtn.onclick =toggleVertexHighlight;
        if(refreshVerticesBtn)    refreshVerticesBtn.onclick    =()=>renderVertexHighlights();
        if(releaseFeatureBtn)     releaseFeatureBtn.onclick     =releaseLockedFeature;
        if(enableBtn)             enableBtn.onclick             =enableTool;
        if(disableBtn)            disableBtn.onclick            =disableTool;
        if(cancelBtn)             cancelBtn.onclick             =cancelMove;

        const refreshLayersBtn = toolBox.querySelector("#refreshLayers");
        if(refreshLayersBtn) {
            refreshLayersBtn.onclick = async () => {
                refreshLayersBtn.disabled=true;
                refreshLayersBtn.textContent="…";
                if(lockedFeature)   releaseLockedFeature();
                if(selectedFeature) cancelMove();
                updateStatus("Refreshing layers...");
                await loadLayers();
                updateLayerBadge();
                refreshLayersBtn.disabled=false;
                refreshLayersBtn.textContent="↺ Refresh";
                updateStatus(`Layers refreshed: ${pointLayers.length} point, ${lineLayers.length} line.`);
            };
        }

        if(lockFeatureBtn) {
            lockFeatureBtn.onclick=()=>{
                if(pickingFeatureMode){
                    pickingFeatureMode=false;
                    lockFeatureBtn.style.background=lockedFeature?"#6f42c1":"#666";
                    lockFeatureBtn.textContent=lockedFeature?"🎯 Re-Pick":"🎯 Pick Feature";
                    updateStatus(lockedFeature?`🔒 Locked: ${lockedFeature.layerConfig.name}. Pick cancelled.`:"Pick cancelled.");
                } else {
                    pickingFeatureMode=true;
                    if(selectedFeature)cancelMove();
                    lockFeatureBtn.style.background="#e6ac00";
                    lockFeatureBtn.textContent="⏳ Click a feature...";
                    updateStatus("🖱 Click any point or line feature on the map to lock all edits to it.");
                }
            };
        }

        if(closeBtn) {
            closeBtn.onclick=()=>{
                dismissPickerPopup(); disableTool();
                clearVertexHighlights(); clearTimeout(highlightDebounceTimer);
                if(extentWatchHandle){extentWatchHandle.remove();extentWatchHandle=null;}
                toolBox.remove();
                if(window.gisToolHost?.activeTools instanceof Set) window.gisToolHost.activeTools.delete('snap-move-tool');
            };
        }

        // ── Init ──────────────────────────────────────────────────────────────

        setPointMode();
        window.gisToolHost.activeTools.add('snap-move-tool');
        updateStatus("Detecting layers...");

        loadLayers().then(()=>{
            updateLayerBadge();
            updateStatus(`Ready: ${pointLayers.length} point layer(s), ${lineLayers.length} line layer(s) detected. Click 'Enable Tool' to start.`);
        }).catch(e=>{
            console.error("Layer load error:",e);
            updateStatus("⚠️ Error detecting layers. Try clicking ↺ Refresh.");
        });

    } catch(error) {
        console.error("Error creating snap-move tool:", error);
        alert("Error creating tool: "+(error.message||error));
    }
})();
