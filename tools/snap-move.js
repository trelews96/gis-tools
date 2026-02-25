// tools/snap-move-tool.js
// Click-to-Move Tool for moving points and line vertices with snapping

(function() {
    try {
        if (!window.gisToolHost) {
            window.gisToolHost = {};
        }

        if (!window.gisToolHost.activeTools || !(window.gisToolHost.activeTools instanceof Set)) {
            console.warn('Creating new Set for activeTools');
            window.gisToolHost.activeTools = new Set();
        }

        if (window.gisToolHost.activeTools.has('snap-move-tool')) {
            console.log('Snap Move Tool already active');
            return;
        }

        const existingToolbox = document.getElementById('snapMoveToolbox');
        if (existingToolbox) {
            existingToolbox.remove();
            console.log('Removed leftover snap move toolbox');
        }

        // ── Map view resolution ────────────────────────────────────────────────

        function getMapView() {
            if (window.gisSharedUtils && window.gisSharedUtils.getMapView) {
                const mv = window.gisSharedUtils.getMapView();
                if (mv) return mv;
            }
            const mapView = Object.values(window).find(obj =>
                obj && obj.constructor && obj.constructor.name === "MapView" && obj.map && obj.center
            );
            if (mapView) return mapView;
            if (window.view && window.view.map) return window.view;
            if (window.mapView && window.mapView.map) return window.mapView;
            throw new Error('MapView not found');
        }

        const mapView = getMapView();

        // ── Layer config ───────────────────────────────────────────────────────

        const LAYER_CONFIG = {
            points: [
                { id: 42100, name: "Vault" },
                { id: 41150, name: "Splice Closure" },
                { id: 41100, name: "Fiber Equipment" }
            ],
            lines: [
                { id: 41050, name: "Fiber Cable" },
                { id: 42050, name: "Underground Span" },
                { id: 43050, name: "Aerial Span" }
            ]
        };

        const SNAP_TOLERANCE       = 15;
        const POINT_SNAP_TOLERANCE = 25;
        const z = 99999;

        // ── Toolbox UI ─────────────────────────────────────────────────────────

        const toolBox = document.createElement("div");
        toolBox.id = "snapMoveToolbox";
        toolBox.style.cssText = `
            position:fixed;top:120px;right:40px;z-index:${z};
            background:#fff;border:1px solid #333;padding:12px;
            max-width:320px;font:12px/1.3 Arial,sans-serif;
            box-shadow:0 4px 16px rgba(0,0,0,.2);border-radius:4px;
        `;

        toolBox.innerHTML = `
            <div style="font-weight:bold;margin-bottom:8px;">🔧 Click-to-Move Tool</div>
            <div style="margin-bottom:8px;color:#666;font-size:11px;">
                <strong>Point Mode:</strong> Click point → Click destination<br>
                <strong>Line Mode:</strong> Click line vertex → Click destination<br>
                <strong>Vertex Tools:</strong> Toggle buttons to add/delete vertices
            </div>
            <div style="display:flex;gap:4px;margin-bottom:8px;">
                <button id="pointMode"  style="flex:1;padding:4px 6px;background:#3367d6;color:white;border:none;border-radius:2px;font-size:11px;">Point Mode</button>
                <button id="lineMode"   style="flex:1;padding:4px 6px;background:#666;color:white;border:none;border-radius:2px;font-size:11px;">Line Mode</button>
            </div>
            <div style="display:flex;gap:4px;margin-bottom:8px;">
                <button id="addVertexMode"    style="flex:1;padding:4px 6px;background:#666;color:white;border:none;border-radius:2px;font-size:11px;">Add Vertex</button>
                <button id="deleteVertexMode" style="flex:1;padding:4px 6px;background:#666;color:white;border:none;border-radius:2px;font-size:11px;">Delete Vertex</button>
            </div>
            <div style="display:flex;gap:4px;margin-bottom:8px;">
                <button id="showVerticesToggle" style="flex:1;padding:4px 6px;background:#666;color:white;border:none;border-radius:2px;font-size:11px;">👁 Show Vertices</button>
                <button id="refreshVertices"    style="flex:1;padding:4px 6px;background:#666;color:white;border:none;border-radius:2px;font-size:11px;" disabled>🔄 Refresh</button>
            </div>
            <div style="margin-bottom:8px;font-size:10px;color:#888;">
                🟠 Endpoints &nbsp;|&nbsp; 🔵 Midpoints
            </div>
            <div style="display:flex;gap:8px;margin-bottom:8px;">
                <button id="enableTool"  style="flex:1;padding:4px 8px;background:#28a745;color:white;border:none;border-radius:2px;">Enable Tool</button>
                <button id="disableTool" style="flex:1;padding:4px 8px;background:#666;color:white;border:none;border-radius:2px;" disabled>Disable Tool</button>
            </div>
            <div style="display:flex;gap:8px;margin-bottom:8px;">
                <button id="cancelMove" style="flex:1;padding:4px 8px;background:#ff9800;color:white;border:none;border-radius:2px;" disabled>Cancel Move</button>
                <button id="closeTool"  style="flex:1;padding:4px 8px;background:#d32f2f;color:white;border:none;border-radius:2px;">Close</button>
            </div>
            <div id="toolStatus" style="margin-top:8px;color:#3367d6;font-size:11px;"></div>
        `;

        document.body.appendChild(toolBox);

        // ── State ──────────────────────────────────────────────────────────────

        let toolActive               = false;
        let currentMode              = "point";
        let vertexMode               = "none";
        let selectedFeature          = null;
        let selectedLayer            = null;
        let selectedLayerConfig      = null;
        let selectedVertex           = null;
        let selectedCoincidentLines  = [];
        let waitingForDestination    = false;
        let connectedFeatures        = [];
        let originalGeometries       = new Map();
        let clickHandler             = null;

        // Vertex-highlight state
        let vertexHighlightActive    = false;
        let vertexHighlightLayer     = null;   // dedicated GraphicsLayer
        let extentWatchHandle        = null;
        let highlightDebounceTimer   = null;

        // ── DOM refs ───────────────────────────────────────────────────────────

        const $ = (id) => toolBox.querySelector(id);
        const pointModeBtn          = $("#pointMode");
        const lineModeBtn           = $("#lineMode");
        const addVertexBtn          = $("#addVertexMode");
        const deleteVertexBtn       = $("#deleteVertexMode");
        const showVerticesToggleBtn = $("#showVerticesToggle");
        const refreshVerticesBtn    = $("#refreshVertices");
        const enableBtn             = $("#enableTool");
        const disableBtn            = $("#disableTool");
        const cancelBtn             = $("#cancelMove");
        const closeBtn              = $("#closeTool");
        const status                = $("#toolStatus");

        function updateStatus(msg) { if (status) status.textContent = msg; }

        // ── Geometry helpers ───────────────────────────────────────────────────

        function calculateDistance(p1, p2) {
            const dx = p1.x - p2.x, dy = p1.y - p2.y;
            return Math.sqrt(dx * dx + dy * dy);
        }

        function convertWebMercatorToLatLng(x, y) {
            const lng = (x / 20037508.34) * 180;
            let lat   = (y / 20037508.34) * 180;
            lat = 180 / Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
            return { lat, lng };
        }

        function convertMapPointToLatLng(mp) {
            try {
                const sr = mp.spatialReference;
                if (!sr || sr.wkid === 3857 || sr.wkid === 102100) return convertWebMercatorToLatLng(mp.x, mp.y);
                if (sr.wkid === 4326 || sr.wkid === 4269) return { lat: mp.y, lng: mp.x };
                return convertWebMercatorToLatLng(mp.x, mp.y);
            } catch { return { lat: 0, lng: 0 }; }
        }

        function calculateGeodeticDistanceBetweenPoints(p1, p2) {
            try {
                const ll1 = convertMapPointToLatLng(p1), ll2 = convertMapPointToLatLng(p2);
                const R = 20902231.0;
                const lat1 = ll1.lat * Math.PI / 180, lat2 = ll2.lat * Math.PI / 180;
                const dLat = (ll2.lat - ll1.lat) * Math.PI / 180;
                const dLng = (ll2.lng - ll1.lng) * Math.PI / 180;
                const a = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
                return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            } catch { return 0; }
        }

        function calculateGeodeticLength(geometry) {
            try {
                if (!geometry?.paths?.length) return 0;
                let total = 0;
                for (const path of geometry.paths) {
                    for (let i = 0; i < path.length - 1; i++) {
                        total += calculateGeodeticDistanceBetweenPoints(
                            { x: path[i][0],   y: path[i][1],   spatialReference: geometry.spatialReference },
                            { x: path[i+1][0], y: path[i+1][1], spatialReference: geometry.spatialReference }
                        );
                    }
                }
                return Math.round(total);
            } catch { return 0; }
        }

        function isEndpoint(geometry, pathIndex, pointIndex) {
            if (!geometry?.paths?.[pathIndex]) return false;
            const path = geometry.paths[pathIndex];
            return pointIndex === 0 || pointIndex === path.length - 1;
        }

        function getClosestPointOnSegment(point, s, e) {
            const A = point.x - s.x, B = point.y - s.y;
            const C = e.x - s.x,     D = e.y - s.y;
            const dot = A*C + B*D, lenSq = C*C + D*D;
            let param = lenSq !== 0 ? dot / lenSq : -1;
            const cp = param < 0 ? { x: s.x, y: s.y }
                     : param > 1 ? { x: e.x, y: e.y }
                     : { x: s.x + param*C, y: s.y + param*D };
            return { point: cp, distance: calculateDistance(point, cp), param };
        }

        function findClosestLineSegment(geometry, mapPoint) {
            if (!geometry?.paths) return null;
            let closest = null, minDist = Infinity;
            for (let pi = 0; pi < geometry.paths.length; pi++) {
                const path = geometry.paths[pi];
                for (let si = 0; si < path.length - 1; si++) {
                    const p1 = { x: path[si][0],   y: path[si][1] };
                    const p2 = { x: path[si+1][0], y: path[si+1][1] };
                    const info = getClosestPointOnSegment(mapPoint, p1, p2);
                    if (info.distance < minDist) {
                        minDist = info.distance;
                        closest = { pathIndex: pi, segmentIndex: si, insertIndex: si+1,
                                    distance: info.distance, point: info.point,
                                    segmentStart: p1, segmentEnd: p2 };
                    }
                }
            }
            return (closest && closest.distance < 50) ? closest : null;
        }

        function findClosestVertex(geometry, mapPoint) {
            if (!geometry?.paths) return null;
            let closest = null, minDist = Infinity;
            for (let pi = 0; pi < geometry.paths.length; pi++) {
                const path = geometry.paths[pi];
                for (let vi = 0; vi < path.length; vi++) {
                    const v = { x: path[vi][0], y: path[vi][1] };
                    const d = calculateDistance(mapPoint, v);
                    if (d < minDist) {
                        minDist = d;
                        closest = { pathIndex: pi, pointIndex: vi, distance: d,
                                    coordinates: v,
                                    isEndpoint: isEndpoint(geometry, pi, vi) };
                    }
                }
            }
            return (closest && closest.distance < 50) ? closest : null;
        }

        // ── Layer query helpers ────────────────────────────────────────────────

        async function findNearestPointFeature(mapPoint) {
            try {
                const tol = POINT_SNAP_TOLERANCE * (mapView.resolution || 1);
                let nearest = null, minDist = Infinity;
                for (const cfg of LAYER_CONFIG.points) {
                    try {
                        const layer = mapView.map.allLayers.find(l => l.layerId === cfg.id);
                        if (!layer || !layer.visible) continue;
                        await layer.load();
                        const extent = { xmin: mapPoint.x-tol, ymin: mapPoint.y-tol,
                                         xmax: mapPoint.x+tol, ymax: mapPoint.y+tol,
                                         spatialReference: mapView.spatialReference };
                        const res = await layer.queryFeatures({ geometry: extent,
                            spatialRelationship: "intersects", returnGeometry: true, outFields: ["*"] });
                        for (const f of res.features) {
                            const d = calculateDistance(mapPoint, f.geometry);
                            if (d < minDist) { minDist = d; nearest = { feature: f, layer, layerConfig: cfg, distance: d, geometry: f.geometry }; }
                        }
                    } catch (e) { console.error("Error querying point layer:", e); }
                }
                return (nearest && nearest.distance < tol) ? nearest : null;
            } catch (e) { console.error("findNearestPointFeature error:", e); return null; }
        }

        async function findPointFeatureAtLocation(screenPoint) {
            try {
                if (mapView.hitTest) {
                    const hit = await mapView.hitTest(screenPoint,
                        { include: mapView.map.allLayers.filter(l => l.type === "feature") });
                    for (const r of hit.results) {
                        if (r.graphic?.geometry?.type === "point") {
                            const cfg = LAYER_CONFIG.points.find(p => p.id === r.layer.layerId);
                            if (cfg) return { feature: r.graphic, layer: r.layer, layerConfig: cfg };
                        }
                    }
                }
                const mapPoint = mapView.toMap(screenPoint);
                const tol = SNAP_TOLERANCE * (mapView.resolution || 1);
                for (const cfg of LAYER_CONFIG.points) {
                    try {
                        const layer = mapView.map.allLayers.find(l => l.layerId === cfg.id);
                        if (!layer || !layer.visible) continue;
                        await layer.load();
                        const extent = { xmin: mapPoint.x-tol, ymin: mapPoint.y-tol,
                                         xmax: mapPoint.x+tol, ymax: mapPoint.y+tol,
                                         spatialReference: mapView.spatialReference };
                        const res = await layer.queryFeatures({ geometry: extent,
                            spatialRelationship: "intersects", returnGeometry: true, outFields: ["*"] });
                        if (res.features.length > 0) {
                            let best = null, bestD = Infinity;
                            for (const f of res.features) {
                                const d = calculateDistance(mapPoint, f.geometry);
                                if (d < bestD) { bestD = d; best = f; }
                            }
                            if (best) return { feature: best, layer, layerConfig: cfg };
                        }
                    } catch (e) { console.error("Error in point fallback query:", e); }
                }
            } catch (e) { console.error("findPointFeatureAtLocation error:", e); }
            return null;
        }

        async function findCoincidentLinesForVertexCreation(screenPoint, mapPoint) {
            try {
                const bufM = 10 / 3.28084;
                const lines = [];
                if (mapView.hitTest) {
                    const hit = await mapView.hitTest(screenPoint,
                        { include: mapView.map.allLayers.filter(l => l.type === "feature") });
                    for (const r of hit.results) {
                        if (r.graphic?.geometry?.type === "polyline") {
                            const cfg = LAYER_CONFIG.lines.find(l => l.id === r.layer.layerId);
                            if (cfg) {
                                const seg = findClosestLineSegment(r.graphic.geometry, mapPoint);
                                if (seg && seg.distance <= bufM)
                                    lines.push({ feature: r.graphic, layer: r.layer, layerConfig: cfg, segmentInfo: seg });
                            }
                        }
                    }
                }
                if (lines.length === 0) {
                    for (const cfg of LAYER_CONFIG.lines) {
                        try {
                            const layer = mapView.map.allLayers.find(l => l.layerId === cfg.id);
                            if (!layer || !layer.visible) continue;
                            await layer.load();
                            const buffered = { type:"polygon", spatialReference: mapPoint.spatialReference,
                                rings: [[[mapPoint.x-bufM,mapPoint.y-bufM],[mapPoint.x+bufM,mapPoint.y-bufM],
                                         [mapPoint.x+bufM,mapPoint.y+bufM],[mapPoint.x-bufM,mapPoint.y+bufM],
                                         [mapPoint.x-bufM,mapPoint.y-bufM]]] };
                            const res = await layer.queryFeatures({ geometry: buffered,
                                spatialRelationship: "intersects", returnGeometry: true, outFields: ["*"], maxRecordCount: 50 });
                            for (const f of res.features) {
                                const seg = findClosestLineSegment(f.geometry, mapPoint);
                                if (seg && seg.distance <= bufM)
                                    lines.push({ feature: f, layer, layerConfig: cfg, segmentInfo: seg });
                            }
                        } catch (e) { console.error(`Error querying ${cfg.name} for vertex creation:`, e); }
                    }
                }
                return lines;
            } catch (e) { console.error("findCoincidentLinesForVertexCreation error:", e); return []; }
        }

        async function findCoincidentLineVertices(screenPoint) {
            try {
                const clickPt = mapView.toMap(screenPoint);
                const snapTol = 50;
                const lines = [];

                if (mapView.hitTest) {
                    const hit = await mapView.hitTest(screenPoint,
                        { include: mapView.map.allLayers.filter(l => l.type === "feature") });
                    for (const r of hit.results) {
                        if (r.graphic?.geometry?.type === "polyline") {
                            const cfg = LAYER_CONFIG.lines.find(l => l.id === r.layer.layerId);
                            if (cfg) {
                                const v = findClosestVertex(r.graphic.geometry, clickPt);
                                if (v && v.distance < snapTol)
                                    lines.push({ feature: r.graphic, layer: r.layer, layerConfig: cfg, vertex: v });
                            }
                        }
                    }
                }
                if (lines.length === 0) {
                    for (const cfg of LAYER_CONFIG.lines) {
                        try {
                            const layer = mapView.map.allLayers.find(l => l.layerId === cfg.id);
                            if (!layer || !layer.visible) continue;
                            await layer.load();
                            const extent = { xmin: clickPt.x-20, ymin: clickPt.y-20,
                                             xmax: clickPt.x+20, ymax: clickPt.y+20,
                                             spatialReference: mapView.spatialReference };
                            const res = await layer.queryFeatures({ geometry: extent,
                                spatialRelationship: "intersects", returnGeometry: true, outFields: ["*"], maxRecordCount: 50 });
                            for (const f of res.features) {
                                const v = findClosestVertex(f.geometry, clickPt);
                                if (v && v.distance < snapTol)
                                    lines.push({ feature: f, layer, layerConfig: cfg, vertex: v });
                            }
                        } catch (e) { console.error("Error querying line layer for vertices:", e); }
                    }
                }
                if (lines.length > 0) {
                    const ref = lines[0].vertex.coordinates;
                    return lines.filter(li => calculateDistance(ref, li.vertex.coordinates) < snapTol);
                }
                return [];
            } catch (e) { console.error("findCoincidentLineVertices error:", e); return []; }
        }

        async function findConnectedLines(pointGeometry) {
            const connected = [];
            const bufM = 10 / 3.28084;
            for (const cfg of LAYER_CONFIG.lines) {
                try {
                    const layer = mapView.map.allLayers.find(l => l.layerId === cfg.id);
                    if (!layer || !layer.visible) continue;
                    await layer.load();
                    const buffered = { type:"polygon", spatialReference: pointGeometry.spatialReference,
                        rings: [[[pointGeometry.x-bufM,pointGeometry.y-bufM],[pointGeometry.x+bufM,pointGeometry.y-bufM],
                                 [pointGeometry.x+bufM,pointGeometry.y+bufM],[pointGeometry.x-bufM,pointGeometry.y+bufM],
                                 [pointGeometry.x-bufM,pointGeometry.y-bufM]]] };
                    const res = await layer.queryFeatures({ geometry: buffered,
                        spatialRelationship: "intersects", returnGeometry: true, outFields: ["*"], maxRecordCount: 100 });
                    for (const f of res.features) {
                        if (!f.geometry?.paths) continue;
                        for (let pi = 0; pi < f.geometry.paths.length; pi++) {
                            const path = f.geometry.paths[pi];
                            if (path.length < 2) continue;
                            const start = { x: path[0][0], y: path[0][1] };
                            const end   = { x: path[path.length-1][0], y: path[path.length-1][1] };
                            const sd = calculateDistance(pointGeometry, start);
                            const ed = calculateDistance(pointGeometry, end);
                            let conn = null;
                            if (sd < bufM) conn = { pathIndex: pi, pointIndex: 0, isStart: true };
                            else if (ed < bufM) conn = { pathIndex: pi, pointIndex: path.length-1, isStart: false };
                            if (conn) {
                                connected.push({ feature: f, layer, layerConfig: cfg, connection: conn });
                                if (f.geometry.clone) originalGeometries.set(f.attributes.objectid, f.geometry.clone());
                            }
                        }
                    }
                } catch (e) { console.error(`findConnectedLines error for ${cfg.name}:`, e); }
            }
            return connected;
        }

        async function updateConnectedLines(newPt) {
            for (const info of connectedFeatures) {
                try {
                    const orig = originalGeometries.get(info.feature.attributes.objectid);
                    if (!orig?.clone) continue;
                    const newGeom = orig.clone();
                    const path = newGeom.paths[info.connection.pathIndex];
                    path[info.connection.pointIndex] = [newPt.x, newPt.y];
                    const upd = info.feature.clone();
                    upd.geometry = newGeom;
                    upd.attributes.calculated_length = calculateGeodeticLength(newGeom);
                    if (info.layer.applyEdits) await info.layer.applyEdits({ updateFeatures: [upd] });
                } catch (e) { console.error("updateConnectedLines error:", e); }
            }
        }

        // ── Vertex operations ──────────────────────────────────────────────────

        async function addVertexToLine(event) {
            const sp = { x: event.x, y: event.y };
            const mp = mapView.toMap(sp);
            updateStatus("Adding vertex to line...");
            try {
                const lines = await findCoincidentLinesForVertexCreation(sp, mp);
                if (lines.length === 0) { updateStatus("❌ No lines found to add vertex to."); return; }
                const updates = [];
                for (const li of lines) {
                    try {
                        const upd = li.feature.clone();
                        const newGeom = upd.geometry.clone();
                        const path = newGeom.paths[li.segmentInfo.pathIndex];
                        path.splice(li.segmentInfo.insertIndex, 0, [li.segmentInfo.point.x, li.segmentInfo.point.y]);
                        upd.geometry = newGeom;
                        upd.attributes.calculated_length = calculateGeodeticLength(newGeom);
                        updates.push({ layer: li.layer, feature: upd, layerName: li.layerConfig.name });
                    } catch (e) { console.error(`Error preparing vertex add for ${li.layerConfig.name}:`, e); }
                }
                if (updates.length === 0) { updateStatus("❌ No vertices could be added."); return; }
                for (const u of updates) {
                    if (u.layer.applyEdits) await u.layer.applyEdits({ updateFeatures: [u.feature] });
                }
                updateStatus(`✅ Added vertex to ${updates.length} line(s): ${updates.map(u=>u.layerName).join(", ")}!`);
                if (vertexHighlightActive) scheduleHighlightRefresh();
                setTimeout(() => updateStatus("Line mode active. Click on a line vertex to select it."), 3000);
            } catch (e) { console.error("addVertexToLine error:", e); updateStatus("❌ Error adding vertex."); }
        }

        async function deleteVertexFromLine(event) {
            const sp = { x: event.x, y: event.y };
            updateStatus("Deleting vertex from line...");
            try {
                const results = await findCoincidentLineVertices(sp);
                if (results.length === 0) { updateStatus("❌ No line vertex found to delete."); return; }
                const updates = [];
                for (const li of results) {
                    try {
                        const srcGeom = li.feature.geometry;
                        if (!srcGeom?.paths) continue;

                        // Deep-copy all paths as plain arrays so ArcGIS can autocast cleanly
                        const newPaths = srcGeom.paths.map(p => p.map(coord => coord.slice()));
                        const path = newPaths[li.vertex.pathIndex];

                        if (path.length <= 2) {
                            // Cannot remove a vertex from a 2-point line — it would no longer be a line
                            console.log(`Skipping: path only has ${path.length} vertices — cannot reduce below 2.`);
                            continue;
                        }

                        // Remove the vertex (endpoint or midpoint).
                        // For an endpoint this naturally promotes the adjacent vertex to the new endpoint.
                        path.splice(li.vertex.pointIndex, 1);

                        // Reconstruct as a plain autocast object — avoids the Accessor type error
                        const newGeom = {
                            type: "polyline",
                            paths: newPaths,
                            spatialReference: srcGeom.spatialReference
                        };

                        const upd = li.feature.clone();
                        upd.geometry = newGeom;
                        upd.attributes.calculated_length = calculateGeodeticLength(newGeom);
                        updates.push({ layer: li.layer, feature: upd, layerName: li.layerConfig.name });
                    } catch (e) { console.error("Error preparing vertex delete:", e); }
                }
                if (updates.length === 0) {
                    updateStatus("❌ No vertices deleted (lines with only 2 vertices cannot be reduced further).");
                    return;
                }
                for (const u of updates) {
                    if (u.layer.applyEdits) await u.layer.applyEdits({ updateFeatures: [u.feature] });
                }
                updateStatus(`✅ Deleted vertex from ${updates.length} line(s): ${updates.map(u=>u.layerName).join(", ")}!`);
                if (vertexHighlightActive) scheduleHighlightRefresh();
                setTimeout(() => updateStatus("Line mode active. Click on a line vertex to select it."), 3000);
            } catch (e) { console.error("deleteVertexFromLine error:", e); updateStatus("❌ Error deleting vertex."); }
        }

        // ── Feature selection & movement ───────────────────────────────────────

        async function handleFeatureSelection(event) {
            const sp = { x: event.x, y: event.y };
            updateStatus("Searching for feature...");
            if (currentMode === "point") {
                const r = await findPointFeatureAtLocation(sp);
                if (r) {
                    selectedFeature = r.feature; selectedLayer = r.layer; selectedLayerConfig = r.layerConfig;
                    selectedVertex = null;
                    connectedFeatures = await findConnectedLines(r.feature.geometry);
                    if (selectedFeature.geometry?.clone)
                        originalGeometries.set(selectedFeature.attributes.objectid, selectedFeature.geometry.clone());
                    if (cancelBtn) cancelBtn.disabled = false;
                    updateStatus(`🎯 ${r.layerConfig.name} selected with ${connectedFeatures.length} connected lines. Click destination to move.`);
                } else { updateStatus("❌ No point feature found."); }
            } else {
                const results = await findCoincidentLineVertices(sp);
                if (results.length > 0) {
                    selectedCoincidentLines = results;
                    selectedFeature = results[0].feature; selectedLayer = results[0].layer;
                    selectedLayerConfig = results[0].layerConfig; selectedVertex = results[0].vertex;
                    for (const li of results)
                        if (li.feature.geometry?.clone)
                            originalGeometries.set(li.feature.attributes.objectid, li.feature.geometry.clone());
                    if (cancelBtn) cancelBtn.disabled = false;
                    const vType = results[0].vertex.isEndpoint ? "endpoint" : "vertex";
                    const snap  = results[0].vertex.isEndpoint ? " (will snap to nearest point)" : "";
                    updateStatus(`🎯 Selected ${vType} on ${results.length} line(s): ${results.map(r=>r.layerConfig.name).join(", ")}${snap}. Click destination.`);
                } else { updateStatus("❌ No line vertex found."); }
            }
        }

        async function handleMoveToDestination(event) {
            let dst = mapView.toMap({ x: event.x, y: event.y });
            updateStatus("Moving feature...");
            try {
                if (currentMode === "point") {
                    await updateConnectedLines(dst);
                    const upd = selectedFeature.clone();
                    upd.geometry = dst;
                    if (selectedLayer.applyEdits) await selectedLayer.applyEdits({ updateFeatures: [upd] });
                    updateStatus(`✅ Moved ${selectedLayerConfig.name} and ${connectedFeatures.length} connected lines!`);
                } else {
                    const movingEndpoints = selectedCoincidentLines.some(li => li.vertex.isEndpoint);
                    let snapInfo = null;
                    if (movingEndpoints) {
                        snapInfo = await findNearestPointFeature(dst);
                        if (snapInfo) dst = snapInfo.geometry;
                    }
                    const updates = [];
                    for (const li of selectedCoincidentLines) {
                        try {
                            const upd = li.feature.clone();
                            const newGeom = upd.geometry.clone();
                            const path = newGeom.paths[li.vertex.pathIndex];
                            if (path?.[li.vertex.pointIndex]) path[li.vertex.pointIndex] = [dst.x, dst.y];
                            upd.geometry = newGeom;
                            upd.attributes.calculated_length = calculateGeodeticLength(newGeom);
                            updates.push({ layer: li.layer, feature: upd, layerName: li.layerConfig.name });
                        } catch (e) { console.error("Error preparing line move:", e); }
                    }
                    let ok = 0;
                    for (const u of updates) {
                        try { if (u.layer.applyEdits) { await u.layer.applyEdits({ updateFeatures: [u.feature] }); ok++; } }
                        catch (e) { console.error("Error applying line move:", e); }
                    }
                    let msg = `✅ Moved ${selectedVertex.isEndpoint ? "endpoint" : "vertex"} on ${ok} line(s) and recalculated lengths!`;
                    if (snapInfo) msg += ` Snapped to ${snapInfo.layerConfig.name}.`;
                    updateStatus(msg);
                }
                // Reset
                selectedFeature = null; selectedLayer = null; selectedLayerConfig = null;
                selectedVertex = null; selectedCoincidentLines = []; waitingForDestination = false;
                connectedFeatures = []; originalGeometries.clear();
                if (cancelBtn) cancelBtn.disabled = true;
                if (vertexHighlightActive) scheduleHighlightRefresh();
                setTimeout(() => {
                    const mText = currentMode === "point" ? "point feature" : "line vertex";
                    updateStatus(`Ready. Click on a ${mText} to select it.`);
                }, 3000);
            } catch (e) { console.error("handleMoveToDestination error:", e); updateStatus("❌ Error moving feature."); }
        }

        async function handleClick(event) {
            if (!toolActive) return;
            event.stopPropagation();
            if (vertexMode === "add") { await addVertexToLine(event); return; }
            if (vertexMode === "delete") { await deleteVertexFromLine(event); return; }
            if (!selectedFeature) {
                await handleFeatureSelection(event);
            } else if (!waitingForDestination) {
                waitingForDestination = true;
                updateStatus("Now click where you want to move the feature to...");
            } else {
                await handleMoveToDestination(event);
            }
        }

        // ── Vertex highlight ───────────────────────────────────────────────────

        function loadGraphicClasses() {
            return new Promise((resolve, reject) => {
                if (typeof require !== "undefined") {
                    require(["esri/Graphic", "esri/layers/GraphicsLayer"], (Graphic, GraphicsLayer) => resolve({ Graphic, GraphicsLayer }), reject);
                } else {
                    reject(new Error("ArcGIS require() not found"));
                }
            });
        }

        async function renderVertexHighlights() {
            if (!vertexHighlightActive) return;
            updateStatus("Loading vertex highlights...");
            try {
                const { Graphic, GraphicsLayer } = await loadGraphicClasses();

                // Create a dedicated layer once; reuse on refresh
                if (!vertexHighlightLayer) {
                    vertexHighlightLayer = new GraphicsLayer({ listMode: "hide" });
                    mapView.map.add(vertexHighlightLayer);
                }

                // Wipe previous highlights cleanly
                vertexHighlightLayer.removeAll();

                const extent = mapView.extent;
                let totalAdded = 0;

                for (const cfg of LAYER_CONFIG.lines) {
                    const layer = mapView.map.allLayers.find(l => l.layerId === cfg.id);
                    if (!layer || !layer.visible) continue;
                    try {
                        await layer.load();
                        const res = await layer.queryFeatures({
                            geometry: extent, spatialRelationship: "intersects",
                            returnGeometry: true, outFields: ["objectid"], maxRecordCount: 500
                        });
                        for (const f of res.features) {
                            if (!f.geometry?.paths) continue;
                            for (const path of f.geometry.paths) {
                                for (let i = 0; i < path.length; i++) {
                                    const endpoint = (i === 0 || i === path.length - 1);
                                    vertexHighlightLayer.add(new Graphic({
                                        geometry: {
                                            type: "point",
                                            x: path[i][0], y: path[i][1],
                                            spatialReference: f.geometry.spatialReference
                                        },
                                        symbol: {
                                            type: "simple-marker",
                                            style: endpoint ? "circle" : "square",
                                            color: endpoint ? [255, 120, 0, 220] : [30, 130, 255, 200],
                                            size: endpoint ? 10 : 7,
                                            outline: { color: [255, 255, 255, 230], width: 1.5 }
                                        }
                                    }));
                                    totalAdded++;
                                }
                            }
                        }
                    } catch (e) { console.error(`Error querying ${cfg.name} for highlights:`, e); }
                }

                updateStatus(`👁 Showing ${totalAdded} vertices across visible line layers. Click Refresh to update.`);
            } catch (e) {
                console.error("renderVertexHighlights error:", e);
                updateStatus("❌ Error loading vertex highlights.");
            }
        }

        function clearVertexHighlights() {
            if (vertexHighlightLayer) {
                vertexHighlightLayer.removeAll();
                mapView.map.remove(vertexHighlightLayer);
                vertexHighlightLayer = null;
            }
        }

        function scheduleHighlightRefresh() {
            clearTimeout(highlightDebounceTimer);
            highlightDebounceTimer = setTimeout(() => renderVertexHighlights(), 600);
        }

        function toggleVertexHighlight() {
            vertexHighlightActive = !vertexHighlightActive;
            if (vertexHighlightActive) {
                showVerticesToggleBtn.style.background = "#6f42c1";
                showVerticesToggleBtn.textContent = "👁 Hide Vertices";
                if (refreshVerticesBtn) refreshVerticesBtn.disabled = false;
                renderVertexHighlights();
                // Auto-refresh when map extent changes (with debounce)
                extentWatchHandle = mapView.watch("extent", () => {
                    if (vertexHighlightActive) scheduleHighlightRefresh();
                });
            } else {
                showVerticesToggleBtn.style.background = "#666";
                showVerticesToggleBtn.textContent = "👁 Show Vertices";
                if (refreshVerticesBtn) refreshVerticesBtn.disabled = true;
                clearVertexHighlights();
                if (extentWatchHandle) { extentWatchHandle.remove(); extentWatchHandle = null; }
                clearTimeout(highlightDebounceTimer);
                const mText = currentMode === "point" ? "point feature" : "line vertex";
                updateStatus(toolActive ? `Ready. Click on a ${mText} to select it.` : "Tool disabled.");
            }
        }

        // ── Mode setters ───────────────────────────────────────────────────────

        function cancelMove() {
            selectedFeature = null; selectedLayer = null; selectedLayerConfig = null;
            selectedVertex = null; selectedCoincidentLines = []; waitingForDestination = false;
            connectedFeatures = []; originalGeometries.clear();
            if (cancelBtn) cancelBtn.disabled = true;
            if      (vertexMode === "add")    updateStatus("Add Vertex mode active. Click on any line segment.");
            else if (vertexMode === "delete") updateStatus("Delete Vertex mode active. Click on any vertex.");
            else { const m = currentMode === "point" ? "point feature" : "line vertex";
                   updateStatus(`Move cancelled. Click on a ${m} to select it.`); }
        }

        function setAddVertexMode() {
            vertexMode = vertexMode === "add" ? "none" : "add";
            if (addVertexBtn)    addVertexBtn.style.background    = vertexMode === "add" ? "#28a745" : "#666";
            if (deleteVertexBtn) deleteVertexBtn.style.background = "#666";
            if (selectedFeature) cancelMove();
            if (toolActive) updateStatus(vertexMode === "add"
                ? "Add Vertex mode active. Click anywhere on a line to insert a vertex."
                : "Mode cleared. Click on features to select them.");
        }

        function setDeleteVertexMode() {
            vertexMode = vertexMode === "delete" ? "none" : "delete";
            if (deleteVertexBtn) deleteVertexBtn.style.background = vertexMode === "delete" ? "#dc3545" : "#666";
            if (addVertexBtn)    addVertexBtn.style.background    = "#666";
            if (selectedFeature) cancelMove();
            if (toolActive) updateStatus(vertexMode === "delete"
                ? "Delete Vertex mode active. Click any vertex or endpoint to delete it."
                : "Mode cleared. Click on features to select them.");
        }

        function setPointMode() {
            currentMode = "point"; vertexMode = "none";
            if (pointModeBtn)    pointModeBtn.style.background    = "#3367d6";
            if (lineModeBtn)     lineModeBtn.style.background     = "#666";
            if (addVertexBtn)    addVertexBtn.style.background    = "#666";
            if (deleteVertexBtn) deleteVertexBtn.style.background = "#666";
            if (toolActive) updateStatus("Point mode active. Click on a point feature to select it.");
            if (selectedFeature) cancelMove();
        }

        function setLineMode() {
            currentMode = "line"; vertexMode = "none";
            if (pointModeBtn)    pointModeBtn.style.background    = "#666";
            if (lineModeBtn)     lineModeBtn.style.background     = "#3367d6";
            if (addVertexBtn)    addVertexBtn.style.background    = "#666";
            if (deleteVertexBtn) deleteVertexBtn.style.background = "#666";
            if (toolActive) updateStatus("Line mode active. Click on a line vertex to select it.");
            if (selectedFeature) cancelMove();
        }

        function enableTool() {
            toolActive = true;
            clickHandler = mapView.on("click", handleClick);
            if (enableBtn)  enableBtn.disabled  = true;
            if (disableBtn) disableBtn.disabled = false;
            if (mapView.container) mapView.container.style.cursor = "crosshair";
            const mText = currentMode === "point" ? "point feature" : "line vertex";
            updateStatus(`Tool enabled in ${currentMode} mode. Click on a ${mText} to select it.`);
        }

        function disableTool() {
            toolActive = false;
            selectedFeature = null; selectedLayer = null; selectedLayerConfig = null;
            selectedVertex = null; selectedCoincidentLines = []; waitingForDestination = false;
            connectedFeatures = []; originalGeometries.clear(); vertexMode = "none";
            if (addVertexBtn)    addVertexBtn.style.background    = "#666";
            if (deleteVertexBtn) deleteVertexBtn.style.background = "#666";
            if (clickHandler) clickHandler.remove();
            if (enableBtn)  enableBtn.disabled  = false;
            if (disableBtn) disableBtn.disabled = true;
            if (cancelBtn)  cancelBtn.disabled  = true;
            if (mapView.container) mapView.container.style.cursor = "default";
            updateStatus("Tool disabled.");
        }

        // ── Wire up buttons ────────────────────────────────────────────────────

        if (pointModeBtn)          pointModeBtn.onclick          = setPointMode;
        if (lineModeBtn)           lineModeBtn.onclick           = setLineMode;
        if (addVertexBtn)          addVertexBtn.onclick          = setAddVertexMode;
        if (deleteVertexBtn)       deleteVertexBtn.onclick       = setDeleteVertexMode;
        if (showVerticesToggleBtn) showVerticesToggleBtn.onclick = toggleVertexHighlight;
        if (refreshVerticesBtn)    refreshVerticesBtn.onclick    = () => renderVertexHighlights();
        if (enableBtn)             enableBtn.onclick             = enableTool;
        if (disableBtn)            disableBtn.onclick            = disableTool;
        if (cancelBtn)             cancelBtn.onclick             = cancelMove;
        if (closeBtn) {
            closeBtn.onclick = () => {
                disableTool();
                // Clean up vertex highlights and watchers
                clearVertexHighlights();
                clearTimeout(highlightDebounceTimer);
                if (extentWatchHandle) { extentWatchHandle.remove(); extentWatchHandle = null; }
                toolBox.remove();
                if (window.gisToolHost?.activeTools instanceof Set)
                    window.gisToolHost.activeTools.delete('snap-move-tool');
                // Ensure layer is fully removed from the map on close
                if (vertexHighlightLayer) {
                    mapView.map.remove(vertexHighlightLayer);
                    vertexHighlightLayer = null;
                }
            };
        }

        // ── Init ───────────────────────────────────────────────────────────────

        setPointMode();
        window.gisToolHost.activeTools.add('snap-move-tool');
        updateStatus("Click-to-Move Tool loaded. Select mode and click 'Enable Tool' to start.");

    } catch (error) {
        console.error("Error creating snap-move tool:", error);
        alert("Error creating tool: " + (error.message || error));
    }
})();
