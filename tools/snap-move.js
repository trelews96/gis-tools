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
        const SNAP_TOLERANCE = 15, POINT_SNAP_TOLERANCE = 25;

        // ── Dynamic layer registry ────────────────────────────────────────────
        // Each entry: { layer, name, id }
        // Populated by loadLayers(); all query functions reference these directly.

        let pointLayers = [];   // geometry: point / multipoint
        let lineLayers  = [];   // geometry: polyline

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
            box-shadow:0 4px 16px rgba(0,0,0,.2);border-radius:4px;`;

        toolBox.innerHTML = `
            <div style="font-weight:bold;margin-bottom:6px;">🔧 Click-to-Move Tool</div>
            <div style="margin-bottom:6px;color:#666;font-size:11px;">
                <strong>Point Mode:</strong> Click point → Click destination<br>
                <strong>Line Mode:</strong> Click line vertex → Click destination<br>
                <strong>Vertex Tools:</strong> Toggle buttons to add/delete vertices
            </div>

            <!-- Layer status -->
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;padding:5px 8px;
                        background:#f5f5f5;border:1px solid #ddd;border-radius:3px;font-size:10px;color:#555;">
                <span id="layerBadge" style="flex:1;">Detecting layers…</span>
                <button id="refreshLayers" style="padding:2px 7px;font-size:10px;background:#3367d6;color:#fff;
                    border:none;border-radius:2px;cursor:pointer;">↺ Refresh</button>
            </div>

            <div style="display:flex;gap:4px;margin-bottom:8px;">
                <button id="pointMode" style="flex:1;padding:4px 6px;background:#3367d6;color:white;border:none;border-radius:2px;font-size:11px;">Point Mode</button>
                <button id="lineMode"  style="flex:1;padding:4px 6px;background:#666;color:white;border:none;border-radius:2px;font-size:11px;">Line Mode</button>
            </div>
            <div style="display:flex;gap:4px;margin-bottom:8px;">
                <button id="addVertexMode"    style="flex:1;padding:4px 6px;background:#666;color:white;border:none;border-radius:2px;font-size:11px;">Add Vertex</button>
                <button id="deleteVertexMode" style="flex:1;padding:4px 6px;background:#666;color:white;border:none;border-radius:2px;font-size:11px;">Delete Vertex</button>
            </div>
            <div style="display:flex;gap:4px;margin-bottom:4px;">
                <button id="showVerticesToggle" style="flex:1;padding:4px 6px;background:#666;color:white;border:none;border-radius:2px;font-size:11px;">👁 Show Vertices</button>
                <button id="refreshVertices"    style="flex:1;padding:4px 6px;background:#666;color:white;border:none;border-radius:2px;font-size:11px;" disabled>🔄 Refresh</button>
            </div>
            <div style="margin-bottom:8px;font-size:10px;color:#888;">🟠 Endpoints &nbsp;|&nbsp; 🔵 Midpoints</div>
            <hr style="margin:6px 0;border:none;border-top:1px solid #ddd;">
            <div style="font-weight:bold;font-size:11px;margin-bottom:2px;">📌 Single Feature Editing</div>
            <div style="margin-bottom:4px;color:#666;font-size:10px;">Lock all edits to one specific line feature.</div>
            <div style="display:flex;gap:4px;margin-bottom:4px;">
                <button id="lockFeatureBtn"    style="flex:1;padding:4px 6px;background:#666;color:white;border:none;border-radius:2px;font-size:11px;">🎯 Pick Feature</button>
                <button id="releaseFeatureBtn" style="flex:1;padding:4px 6px;background:#666;color:white;border:none;border-radius:2px;font-size:11px;" disabled>🔓 Release</button>
            </div>
            <div id="lockedFeatureInfo" style="font-size:10px;color:#6f42c1;min-height:14px;font-style:italic;margin-bottom:8px;"></div>
            <hr style="margin:6px 0;border:none;border-top:1px solid #ddd;">
            <div style="display:flex;gap:8px;margin-bottom:8px;">
                <button id="enableTool"  style="flex:1;padding:4px 8px;background:#28a745;color:white;border:none;border-radius:2px;">Enable Tool</button>
                <button id="disableTool" style="flex:1;padding:4px 8px;background:#666;color:white;border:none;border-radius:2px;" disabled>Disable Tool</button>
            </div>
            <div style="display:flex;gap:8px;margin-bottom:8px;">
                <button id="cancelMove" style="flex:1;padding:4px 8px;background:#ff9800;color:white;border:none;border-radius:2px;" disabled>Cancel Move</button>
                <button id="closeTool"  style="flex:1;padding:4px 8px;background:#d32f2f;color:white;border:none;border-radius:2px;">Close</button>
            </div>
            <div id="toolStatus" style="margin-top:8px;color:#3367d6;font-size:11px;"></div>`;

        document.body.appendChild(toolBox);

        // ── State ─────────────────────────────────────────────────────────────

        let toolActive = false, currentMode = "point", vertexMode = "none";
        let selectedFeature = null, selectedLayer = null, selectedLayerConfig = null;
        let selectedVertex = null, selectedCoincidentLines = [], waitingForDestination = false;
        let connectedFeatures = [], originalGeometries = new Map(), clickHandler = null;

        // Single-feature lock
        let lockedLineFeature = null, pickingFeatureMode = false;

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
            return (cl&&cl.distance<50)?cl:null;
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
                lockFeatureBtn.style.background=lockedLineFeature?"#6f42c1":"#666";
                lockFeatureBtn.textContent=lockedLineFeature?"🎯 Re-Pick":"🎯 Pick Feature";
                updateStatus(lockedLineFeature?`🔒 Locked: ${lockedLineFeature.layerConfig.name}.`:"Pick cancelled.");
            };
            header.appendChild(closeX); popup.appendChild(header);

            candidates.forEach(c => {
                const row=document.createElement("div");
                row.style.cssText="padding:6px 10px;cursor:pointer;border-bottom:1px solid #f0f0f0;display:flex;flex-direction:column;gap:2px;";
                row.onmouseenter=()=>row.style.background="#f0f4ff";
                row.onmouseleave=()=>row.style.background="";
                const oid=getOid(c.feature)??"?";
                const vtxCount=(c.feature.geometry?.paths??[]).reduce((s,p)=>s+p.length,0);
                const paths=(c.feature.geometry?.paths??[]).length;
                const title=document.createElement("div");
                title.style.cssText="font-weight:bold;color:#2a2a2a;font-size:11px;";
                title.textContent=c.layerConfig.name;
                const meta=document.createElement("div");
                meta.style.cssText="color:#888;font-size:10px;";
                meta.textContent=`OID: ${oid}  ·  ${vtxCount} vertices  ·  ${paths} path(s)`;
                row.appendChild(title); row.appendChild(meta);
                row.onclick=()=>{ dismissPickerPopup(); applyLock(c.feature,c.layer,c.layerConfig); };
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
            if (!lockedLineFeature) return;
            try {
                const oid=getOid(lockedLineFeature.feature); if (oid==null) return;
                const res=await lockedLineFeature.layer.queryFeatures({where:`objectid=${oid}`,returnGeometry:true,outFields:["*"]});
                if (res.features.length>0) lockedLineFeature.feature=res.features[0];
            } catch(e){console.error("refreshLockedFeature error:",e);}
        }

        function applyLock(feature,layer,cfg) {
            lockedLineFeature={feature,layer,layerConfig:cfg}; pickingFeatureMode=false;
            if(lockFeatureBtn){lockFeatureBtn.style.background="#6f42c1";lockFeatureBtn.textContent="🎯 Re-Pick";}
            if(releaseFeatureBtn) releaseFeatureBtn.disabled=false;
            if(lockedFeatureInfo) lockedFeatureInfo.textContent=`Locked: ${cfg.name} (OID: ${getOid(feature)??"?"})`;
            if(vertexHighlightActive) scheduleHighlightRefresh();
            setLineMode();
            updateStatus(`🔒 Locked to ${cfg.name}. All line edits apply only to this feature.`);
        }

        function releaseLockedFeature() {
            dismissPickerPopup(); lockedLineFeature=null; pickingFeatureMode=false;
            if(lockFeatureBtn){lockFeatureBtn.style.background="#666";lockFeatureBtn.textContent="🎯 Pick Feature";}
            if(releaseFeatureBtn) releaseFeatureBtn.disabled=true;
            if(lockedFeatureInfo) lockedFeatureInfo.textContent="";
            if(vertexHighlightActive) scheduleHighlightRefresh();
            const mText=currentMode==="point"?"point feature":"line vertex";
            updateStatus(toolActive?`Feature released. Click on a ${mText} to select it.`:"Feature released.");
        }

        async function pickLineFeature(event) {
            const sp={x:event.x,y:event.y};
            updateStatus("Looking for line feature...");
            try {
                const candidates=[], seenOids=new Set();

                if (mapView.hitTest) {
                    const hit=await mapView.hitTest(sp,{include:mapView.map.allLayers.filter(l=>l.type==="feature")});
                    for (const r of hit.results) {
                        if (r.graphic?.geometry?.type==="polyline") {
                            // Match against dynamic line layers
                            const cfg=lineLayers.find(l=>l.id===r.layer.layerId);
                            if (!cfg) continue;
                            const oid=getOid(r.graphic);
                            if (oid!=null&&seenOids.has(oid)) continue;
                            if (oid!=null) seenOids.add(oid);
                            candidates.push({feature:r.graphic,layer:r.layer,layerConfig:cfg});
                        }
                    }
                }

                if (candidates.length===0) {
                    const mp=mapView.toMap(sp),tol=30;
                    for (const cfg of lineLayers) {
                        if (!cfg.layer.visible) continue;
                        const ext={xmin:mp.x-tol,ymin:mp.y-tol,xmax:mp.x+tol,ymax:mp.y+tol,spatialReference:mapView.spatialReference};
                        const res=await cfg.layer.queryFeatures({geometry:ext,spatialRelationship:"intersects",returnGeometry:true,outFields:["*"],maxRecordCount:20});
                        for (const f of res.features) {
                            const oid=getOid(f);
                            if (oid!=null&&seenOids.has(oid)) continue;
                            if (oid!=null) seenOids.add(oid);
                            candidates.push({feature:f,layer:cfg.layer,layerConfig:cfg});
                        }
                    }
                }

                if (candidates.length===0){updateStatus("❌ No line feature found. Click directly on a line.");return;}
                if (candidates.length===1){applyLock(candidates[0].feature,candidates[0].layer,candidates[0].layerConfig);}
                else {
                    const rect=mapView.container.getBoundingClientRect();
                    showFeaturePickerPopup(candidates,rect.left+sp.x,rect.top+sp.y);
                    updateStatus(`🗂 ${candidates.length} overlapping features found. Choose one from the menu.`);
                }
            } catch(e){console.error("pickLineFeature error:",e);updateStatus("❌ Error picking feature.");}
        }

        // ── Layer query helpers ───────────────────────────────────────────────
        // All functions now iterate the dynamic pointLayers / lineLayers arrays
        // and use cfg.layer directly — no allLayers.find() needed.

        async function findNearestPointFeature(mapPt) {
            try {
                const tol=POINT_SNAP_TOLERANCE*(mapView.resolution||1);
                let nearest=null,minD=Infinity;
                for (const cfg of pointLayers) {
                    if (!cfg.layer.visible) continue;
                    try {
                        const ext={xmin:mapPt.x-tol,ymin:mapPt.y-tol,xmax:mapPt.x+tol,ymax:mapPt.y+tol,spatialReference:mapView.spatialReference};
                        const res=await cfg.layer.queryFeatures({geometry:ext,spatialRelationship:"intersects",returnGeometry:true,outFields:["*"]});
                        for (const f of res.features){const d=calcDist(mapPt,f.geometry);if(d<minD){minD=d;nearest={feature:f,layer:cfg.layer,layerConfig:cfg,distance:d,geometry:f.geometry};}}
                    } catch(e){console.error(`findNearestPointFeature error on ${cfg.name}:`,e);}
                }
                return (nearest&&nearest.distance<tol)?nearest:null;
            } catch(e){console.error("findNearestPointFeature error:",e);return null;}
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
                for (const cfg of pointLayers) {
                    if (!cfg.layer.visible) continue;
                    try {
                        const ext={xmin:mp.x-tol,ymin:mp.y-tol,xmax:mp.x+tol,ymax:mp.y+tol,spatialReference:mapView.spatialReference};
                        const res=await cfg.layer.queryFeatures({geometry:ext,spatialRelationship:"intersects",returnGeometry:true,outFields:["*"]});
                        if (res.features.length>0){
                            let best=null,bestD=Infinity;
                            for(const f of res.features){const d=calcDist(mp,f.geometry);if(d<bestD){bestD=d;best=f;}}
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
                if (lockedLineFeature) {
                    await refreshLockedFeature();
                    const seg=findClosestSeg(lockedLineFeature.feature.geometry,mp);
                    if (seg&&seg.distance<=bufM) lines.push({feature:lockedLineFeature.feature,layer:lockedLineFeature.layer,layerConfig:lockedLineFeature.layerConfig,segmentInfo:seg});
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
                const clickPt=mapView.toMap(sp),snapTol=50,lines=[];
                if (lockedLineFeature) {
                    await refreshLockedFeature();
                    const v=findClosestVertex(lockedLineFeature.feature.geometry,clickPt);
                    if (v&&v.distance<snapTol) lines.push({feature:lockedLineFeature.feature,layer:lockedLineFeature.layer,layerConfig:lockedLineFeature.layerConfig,vertex:v});
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
                    for (const cfg of lineLayers) {
                        if (!cfg.layer.visible) continue;
                        try {
                            const ext={xmin:clickPt.x-20,ymin:clickPt.y-20,xmax:clickPt.x+20,ymax:clickPt.y+20,spatialReference:mapView.spatialReference};
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
            return lockedLineFeature
                ?`🔒 Locked: ${lockedLineFeature.layerConfig.name}. Click a vertex to move, or use Add/Delete mode.`
                :"Line mode active. Click on a line vertex to select it.";
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
                if(lockedLineFeature) await refreshLockedFeature();
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
                if(lockedLineFeature) await refreshLockedFeature();
                if(vertexHighlightActive) scheduleHighlightRefresh();
                setTimeout(()=>updateStatus(lockedReadyStatus()),3000);
            } catch(e){console.error("deleteVertexFromLine error:",e);updateStatus("❌ Error deleting vertex.");}
        }

        // ── Feature selection & movement ──────────────────────────────────────

        async function handleFeatureSelection(event) {
            const sp={x:event.x,y:event.y};
            updateStatus("Searching for feature...");
            if (currentMode==="point") {
                const r=await findPointFeatureAtLocation(sp);
                if (r){
                    selectedFeature=r.feature;selectedLayer=r.layer;selectedLayerConfig=r.layerConfig;selectedVertex=null;
                    connectedFeatures=await findConnectedLines(r.feature.geometry);
                    if(selectedFeature.geometry?.clone)originalGeometries.set(selectedFeature.attributes.objectid,selectedFeature.geometry.clone());
                    if(cancelBtn)cancelBtn.disabled=false;
                    updateStatus(`🎯 ${r.layerConfig.name} selected with ${connectedFeatures.length} connected lines. Click destination to move.`);
                } else {updateStatus("❌ No point feature found.");}
            } else {
                const results=await findCoincidentLineVertices(sp);
                if (results.length>0){
                    selectedCoincidentLines=results;selectedFeature=results[0].feature;
                    selectedLayer=results[0].layer;selectedLayerConfig=results[0].layerConfig;selectedVertex=results[0].vertex;
                    for(const li of results)if(li.feature.geometry?.clone)originalGeometries.set(li.feature.attributes.objectid,li.feature.geometry.clone());
                    if(cancelBtn)cancelBtn.disabled=false;
                    const vType=results[0].vertex.isEndpoint?"endpoint":"vertex";
                    const snap=results[0].vertex.isEndpoint?" (will snap to nearest point)":"";
                    const lockNote=lockedLineFeature?" [🔒 Locked feature]":"";
                    updateStatus(`🎯 Selected ${vType} on ${results.length} line(s): ${results.map(r=>r.layerConfig.name).join(", ")}${snap}${lockNote}. Click destination.`);
                } else {updateStatus("❌ No line vertex found.");}
            }
        }

        async function handleMoveToDestination(event) {
            let dst=mapView.toMap({x:event.x,y:event.y});
            updateStatus("Moving feature...");
            try {
                if (currentMode==="point") {
                    await updateConnectedLines(dst);
                    const upd=selectedFeature.clone(); upd.geometry=dst;
                    if(selectedLayer.applyEdits)await selectedLayer.applyEdits({updateFeatures:[upd]});
                    updateStatus(`✅ Moved ${selectedLayerConfig.name} and ${connectedFeatures.length} connected lines!`);
                } else {
                    let snapInfo = await findNearestPointFeature(dst);
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
                    if (snapInfo) msg += ` Snapped to ${snapInfo.layerConfig.name}.`;
                    updateStatus(msg);
                }
                selectedFeature=null;selectedLayer=null;selectedLayerConfig=null;
                selectedVertex=null;selectedCoincidentLines=[];waitingForDestination=false;
                connectedFeatures=[];originalGeometries.clear();
                if(cancelBtn)cancelBtn.disabled=true;
                if(lockedLineFeature)await refreshLockedFeature();
                if(vertexHighlightActive)scheduleHighlightRefresh();
                setTimeout(()=>updateStatus(lockedLineFeature?lockedReadyStatus():`Ready. Click on a ${currentMode==="point"?"point feature":"line vertex"} to select it.`),3000);
            } catch(e){console.error("handleMoveToDestination error:",e);updateStatus("❌ Error moving feature.");}
        }

        async function handleClick(event) {
            if (!toolActive) return;
            event.stopPropagation();
            if(pickingFeatureMode){await pickLineFeature(event);return;}
            if(vertexMode==="add"){await addVertexToLine(event);return;}
            if(vertexMode==="delete"){await deleteVertexFromLine(event);return;}
            if(!selectedFeature){await handleFeatureSelection(event);}
            else if(!waitingForDestination){waitingForDestination=true;updateStatus("Now click where you want to move the feature to...");}
            else{await handleMoveToDestination(event);}
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

                if (lockedLineFeature) {
                    renderGeom(lockedLineFeature.feature.geometry);
                    updateStatus(`👁 Showing ${total} vertices for locked feature (${lockedLineFeature.layerConfig.name}).`);
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
                extentWatchHandle=mapView.watch("extent",()=>{if(vertexHighlightActive&&!lockedLineFeature)scheduleHighlightRefresh();});
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
            connectedFeatures=[];originalGeometries.clear();
            if(cancelBtn)cancelBtn.disabled=true;
            if(lockedLineFeature)      updateStatus(lockedReadyStatus());
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
            if(toolActive) updateStatus(lockedLineFeature?lockedReadyStatus():"Line mode active. Click on a line vertex to select it.");
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
            toolActive=false;pickingFeatureMode=false;
            selectedFeature=null;selectedLayer=null;selectedLayerConfig=null;
            selectedVertex=null;selectedCoincidentLines=[];waitingForDestination=false;
            connectedFeatures=[];originalGeometries.clear();vertexMode="none";
            if(addVertexBtn)    addVertexBtn.style.background="#666";
            if(deleteVertexBtn) deleteVertexBtn.style.background="#666";
            if(lockFeatureBtn)  {lockFeatureBtn.style.background=lockedLineFeature?"#6f42c1":"#666";lockFeatureBtn.textContent=lockedLineFeature?"🎯 Re-Pick":"🎯 Pick Feature";}
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
                if(lockedLineFeature) releaseLockedFeature();
                if(selectedFeature)   cancelMove();
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
                    lockFeatureBtn.style.background=lockedLineFeature?"#6f42c1":"#666";
                    lockFeatureBtn.textContent=lockedLineFeature?"🎯 Re-Pick":"🎯 Pick Feature";
                    updateStatus(lockedLineFeature?`🔒 Locked: ${lockedLineFeature.layerConfig.name}. Pick cancelled.`:"Pick cancelled.");
                } else {
                    pickingFeatureMode=true;
                    if(selectedFeature)cancelMove();
                    lockFeatureBtn.style.background="#e6ac00";
                    lockFeatureBtn.textContent="⏳ Click a line...";
                    updateStatus("🖱 Click any line on the map to lock all edits to that feature.");
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

        // ── Init: load layers then start ──────────────────────────────────────

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
