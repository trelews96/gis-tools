(function () {
    'use strict';

    /* ─── Prevent duplicate instances ────────────────────── */
    if (!window.gisToolHost) window.gisToolHost = {};
    if (!window.gisToolHost.activeTools) window.gisToolHost.activeTools = new Set();
    if (window.gisToolHost.activeTools.has('cut-snap-tool')) {
        alert('Cut & Snap Tool is already open.');
        return;
    }

    /* ─── Configuration ───────────────────────────────────── */
    const LAYER_CFG = {
        points: [
            { id: 42100, name: 'Vault' },
            { id: 41150, name: 'Splice Closure' },
            { id: 41100, name: 'Fiber Equipment' }
        ],
        lines: [
            { id: 41050, name: 'Fiber Cable' },
            { id: 42050, name: 'Underground Span' },
            { id: 43050, name: 'Aerial Span' }
        ]
    };

    // Tolerances
    const CUT_TOLERANCE_M     = 15 / 3.28084;  // 15 ft → ~4.57 m (map units)
    const SNAP_TOLERANCE_PX   = 20;             // pixels for point hit-test
    const MIN_SEGMENT_LEN_FT  = 1;              // discard cuts producing < 1 ft segment
    const Z = 99999;

    /* ─── Locate MapView ──────────────────────────────────── */
    function getMapView() {
        if (window.gisSharedUtils?.getMapView) {
            const mv = window.gisSharedUtils.getMapView();
            if (mv) return mv;
        }
        const mv = Object.values(window).find(o => o?.constructor?.name === 'MapView');
        if (mv) return mv;
        throw new Error('MapView not found');
    }

    let mapView;
    try { mapView = getMapView(); }
    catch (e) { alert('Cut & Snap Tool – ' + e.message); return; }

    /* ─── State ───────────────────────────────────────────── */
    let toolActive       = false;
    let processing       = false;   // guard against concurrent async ops
    let selectedPoint    = null;
    let selectedPointLayer = null;
    let linesToCut       = [];
    let previewMode      = false;
    let undoStack        = [];
    let clickHandler     = null;
    let highlightHandles = [];
    let graphicsLayer    = null;
    let ArcGIS           = {};      // populated via require below

    /* ─── Load ArcGIS modules (Graphic + GraphicsLayer) ───── */
    if (window.require) {
        window.require(
            ['esri/Graphic', 'esri/layers/GraphicsLayer'],
            (Graphic, GraphicsLayer) => {
                ArcGIS.Graphic = Graphic;
                graphicsLayer = new GraphicsLayer({ id: 'cut-snap-highlights', listMode: 'hide' });
                mapView.map.add(graphicsLayer);
            }
        );
    }

    /* ─── Visual helpers ──────────────────────────────────── */
    function clearHighlights() {
        if (graphicsLayer) graphicsLayer.removeAll();
        highlightHandles.forEach(h => h?.remove?.());
        highlightHandles = [];
    }

    function highlightGeometry(geometry, isPoint) {
        if (!graphicsLayer || !ArcGIS.Graphic) return;
        graphicsLayer.add(new ArcGIS.Graphic({
            geometry,
            symbol: isPoint
                ? { type: 'simple-marker', style: 'circle', color: [255, 200, 0, 0.85],
                    size: 16, outline: { color: [180, 80, 0], width: 2.5 } }
                : { type: 'simple-line', color: [255, 80, 0, 0.9], width: 3, style: 'dash' }
        }));
    }

    /* ─── UI ──────────────────────────────────────────────── */
    const toolBox = document.createElement('div');
    toolBox.id = 'cutSnapToolbox';
    toolBox.style.cssText = `
        position:fixed;top:120px;right:40px;z-index:${Z};
        background:#fff;border:1px solid #444;padding:14px;
        max-width:340px;min-width:260px;font:12px/1.4 Arial,sans-serif;
        box-shadow:0 4px 20px rgba(0,0,0,.28);border-radius:6px;
    `;
    toolBox.innerHTML = `
        <div style="font-weight:bold;font-size:13px;margin-bottom:10px;">✂️ Cut &amp; Snap Lines Tool</div>
        <div style="color:#555;font-size:11px;margin-bottom:10px;padding:6px;background:#f8f8f8;border-radius:3px;line-height:1.6;">
            <b>How to use:</b><br>
            1. Enable the tool<br>
            2. Click a point feature (Vault / Splice / Equipment)<br>
            3. Review highlighted lines<br>
            4. Click <i>Execute Cut</i> to split them at the point
        </div>
        <div style="display:flex;gap:6px;margin-bottom:8px;">
            <button id="cst-enable"  style="flex:1;padding:5px;background:#28a745;color:#fff;border:none;border-radius:3px;cursor:pointer;">Enable</button>
            <button id="cst-disable" style="flex:1;padding:5px;background:#888;color:#fff;border:none;border-radius:3px;cursor:pointer;" disabled>Disable</button>
        </div>
        <div id="cst-preview" style="display:none;margin-bottom:8px;padding:8px;background:#eef4ff;border:1px solid #4a80d4;border-radius:3px;">
            <div style="font-weight:bold;margin-bottom:4px;font-size:11px;">Lines queued for cutting:</div>
            <div id="cst-lines-list" style="font-size:11px;margin-bottom:8px;line-height:1.7;"></div>
            <div style="display:flex;gap:6px;">
                <button id="cst-execute" style="flex:1;padding:5px;background:#dc3545;color:#fff;border:none;border-radius:3px;cursor:pointer;">✂ Execute Cut</button>
                <button id="cst-cancel"  style="flex:1;padding:5px;background:#6c757d;color:#fff;border:none;border-radius:3px;cursor:pointer;">Cancel</button>
            </div>
        </div>
        <div style="display:flex;gap:6px;margin-bottom:8px;">
            <button id="cst-undo"  style="flex:1;padding:5px;background:#e67e00;color:#fff;border:none;border-radius:3px;cursor:pointer;" disabled>↩ Undo</button>
            <button id="cst-close" style="flex:1;padding:5px;background:#c0392b;color:#fff;border:none;border-radius:3px;cursor:pointer;">✕ Close</button>
        </div>
        <div id="cst-status" style="font-size:11px;color:#3367d6;min-height:16px;word-break:break-word;"></div>
    `;
    document.body.appendChild(toolBox);

    const el          = id => toolBox.querySelector(id);
    const enableBtn   = el('#cst-enable');
    const disableBtn  = el('#cst-disable');
    const executeBtn  = el('#cst-execute');
    const cancelBtn   = el('#cst-cancel');
    const undoBtn     = el('#cst-undo');
    const closeBtn    = el('#cst-close');
    const statusEl    = el('#cst-status');
    const previewEl   = el('#cst-preview');
    const linesListEl = el('#cst-lines-list');

    function setStatus(msg, color) {
        statusEl.textContent = msg;
        statusEl.style.color = color || '#3367d6';
    }

    function setProcessing(val) {
        processing          = val;
        executeBtn.disabled = val;
        cancelBtn.disabled  = val;
        enableBtn.disabled  = val || !toolActive ? true : false;
        disableBtn.disabled = val || toolActive  ? false : true;
    }

    /* ─── Geometry math ───────────────────────────────────── */
    function dist2D(a, b) {
        return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
    }

    /** Closest point on segment a→b to pt, returns { pt, t, dist } */
    function closestOnSegment(pt, a, b) {
        const cx = b.x - a.x, cy = b.y - a.y;
        const lenSq = cx * cx + cy * cy;
        if (lenSq === 0) return { pt: { x: a.x, y: a.y }, t: 0, dist: dist2D(pt, a) };
        const t = Math.max(0, Math.min(1,
            ((pt.x - a.x) * cx + (pt.y - a.y) * cy) / lenSq));
        const p = { x: a.x + t * cx, y: a.y + t * cy };
        return { pt: p, t, dist: dist2D(pt, p) };
    }

    /** Walk all paths/segments and find the closest cut location to snapPt */
    function findCutInfo(lineGeom, snapPt) {
        if (!lineGeom?.paths?.length) return null;
        let best = null;
        for (let pi = 0; pi < lineGeom.paths.length; pi++) {
            const path = lineGeom.paths[pi];
            for (let si = 0; si < path.length - 1; si++) {
                const a = { x: path[si][0],     y: path[si][1] };
                const b = { x: path[si + 1][0], y: path[si + 1][1] };
                const info = closestOnSegment(snapPt, a, b);
                if (!best || info.dist < best.dist) {
                    best = { pathIdx: pi, segIdx: si, dist: info.dist, t: info.t };
                }
            }
        }
        return best;
    }

    /**
     * Split polyline at cutInfo using snapPt (the point feature location)
     * as the shared new vertex for both resulting segments.
     * Returns { seg1, seg2 } or null if the resulting segments would be degenerate.
     */
    function splitLine(lineGeom, cutInfo, snapPt) {
        try {
            const allPaths = lineGeom.paths;
            const { pathIdx: pi, segIdx: si } = cutInfo;
            const path = allPaths[pi];
            const snap = [snapPt.x, snapPt.y];

            // Deep-copy helper
            const copyPaths = paths => paths.map(p => p.map(v => [...v]));

            // Segment 1: all paths before pi unchanged; target path → [start … vertex si, snap]
            const paths1 = [
                ...copyPaths(allPaths.slice(0, pi)),
                [...path.slice(0, si + 1).map(v => [...v]), snap]
            ];

            // Segment 2: target path → [snap, vertex si+1 … end]; all paths after pi unchanged
            const paths2 = [
                [snap, ...path.slice(si + 1).map(v => [...v])],
                ...copyPaths(allPaths.slice(pi + 1))
            ];

            // Reject degenerate paths
            if (paths1.some(p => p.length < 2) || paths2.some(p => p.length < 2)) {
                console.warn('splitLine: degenerate segment detected, skipping cut.');
                return null;
            }

            const seg1 = lineGeom.clone(); seg1.paths = paths1;
            const seg2 = lineGeom.clone(); seg2.paths = paths2;

            // Reject nearly zero-length results
            if (geodeticLengthFt(seg1) < MIN_SEGMENT_LEN_FT ||
                geodeticLengthFt(seg2) < MIN_SEGMENT_LEN_FT) {
                console.warn('splitLine: resulting segment too short, skipping cut.');
                return null;
            }

            return { seg1, seg2 };
        } catch (e) {
            console.error('splitLine error:', e);
            return null;
        }
    }

    /** Haversine length in feet (assumes Web Mercator input) */
    function geodeticLengthFt(geom) {
        if (!geom?.paths) return 0;
        const R = 20902231.0; // Earth radius in feet
        let total = 0;
        const toLL = (x, y) => {
            const lng = (x / 20037508.34) * 180;
            let lat = (y / 20037508.34) * 180;
            lat = (180 / Math.PI) * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
            return { lat, lng };
        };
        for (const path of geom.paths) {
            for (let i = 0; i < path.length - 1; i++) {
                const p1 = toLL(path[i][0],     path[i][1]);
                const p2 = toLL(path[i + 1][0], path[i + 1][1]);
                const dLat = (p2.lat - p1.lat) * Math.PI / 180;
                const dLng = (p2.lng - p1.lng) * Math.PI / 180;
                const a =
                    Math.sin(dLat / 2) ** 2 +
                    Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
                    Math.sin(dLng / 2) ** 2;
                total += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            }
        }
        return Math.round(total);
    }

    /* ─── Layer queries ───────────────────────────────────── */

    /**
     * Dynamically collect all visible point-geometry feature layers from the map.
     * This replaces the hardcoded LAYER_CFG.points lookup so no layer IDs need
     * to be configured — any visible point layer is eligible.
     */
    async function getVisiblePointLayers() {
        const layers = mapView.map.allLayers.filter(l =>
            l.type === 'feature' &&
            l.visible !== false &&
            l.layerId !== undefined
        ).toArray();

        const pointLayers = [];
        for (const layer of layers) {
            try {
                await layer.load();
                // geometryType is only reliable after load()
                if (layer.geometryType === 'point' || layer.geometryType === 'multipoint') {
                    pointLayers.push({
                        layer,
                        name: layer.title || `Layer ${layer.layerId}`
                    });
                }
            } catch (e) {
                console.warn(`Could not load layer ${layer.layerId}:`, e);
            }
        }
        console.log(`Found ${pointLayers.length} visible point layer(s):`,
            pointLayers.map(l => l.name));
        return pointLayers;
    }

    async function findPointFeature(screenPoint) {
        const mapPt = mapView.toMap(screenPoint);
        const snapM = SNAP_TOLERANCE_PX * mapView.resolution;

        const extent = {
            type: 'extent',
            xmin: mapPt.x - snapM, ymin: mapPt.y - snapM,
            xmax: mapPt.x + snapM, ymax: mapPt.y + snapM,
            spatialReference: mapView.spatialReference
        };

        const pointLayers = await getVisiblePointLayers();
        let bestFeature = null, bestLayer = null, bestName = null, bestDist = Infinity;

        for (const { layer, name } of pointLayers) {
            try {
                const result = await layer.queryFeatures({
                    geometry: extent,
                    spatialRelationship: 'intersects',
                    returnGeometry: true,
                    outFields: ['*']
                });
                for (const feature of result.features) {
                    const d = dist2D(mapPt, feature.geometry);
                    if (d < bestDist) {
                        bestDist    = d;
                        bestFeature = feature;
                        bestLayer   = layer;
                        bestName    = name;
                    }
                }
            } catch (e) {
                console.warn(`Point query failed (${name}):`, e);
            }
        }

        if (!bestFeature) return null;
        return { feature: bestFeature, layer: bestLayer, cfg: { name: bestName } };
    }

    async function findNearbyLines(pointGeom) {
        const buf = CUT_TOLERANCE_M;
        const { x, y } = pointGeom;
        const bufGeom = {
            type: 'polygon',
            spatialReference: pointGeom.spatialReference,
            rings: [[
                [x - buf, y - buf], [x + buf, y - buf],
                [x + buf, y + buf], [x - buf, y + buf],
                [x - buf, y - buf]
            ]]
        };

        const found = [];
        for (const cfg of LAYER_CFG.lines) {
            const layer = mapView.map.allLayers.find(l => l.layerId === cfg.id);
            if (!layer?.visible) continue;
            try {
                await layer.load();
                const result = await layer.queryFeatures({
                    geometry: bufGeom,
                    spatialRelationship: 'intersects',
                    returnGeometry: true,
                    outFields: ['*'],
                    maxRecordCount: 100
                });
                for (const feature of result.features) {
                    const cutInfo = findCutInfo(feature.geometry, { x, y });
                    if (cutInfo && cutInfo.dist <= buf) {
                        found.push({ feature, layer, cfg, cutInfo });
                    }
                }
            } catch (e) {
                console.warn(`Line query failed (${cfg.name}):`, e);
            }
        }
        return found;
    }

    /* ─── Reset ───────────────────────────────────────────── */
    function resetSelection() {
        selectedPoint      = null;
        selectedPointLayer = null;
        linesToCut         = [];
        previewMode        = false;
        previewEl.style.display = 'none';
        clearHighlights();
        if (toolActive) setStatus('Tool ready. Click a point feature.');
    }

    /* ─── Preview ─────────────────────────────────────────── */
    function showPreview() {
        if (!linesToCut.length) {
            setStatus(`No lines found within ${Math.round(CUT_TOLERANCE_M * 3.28084)} ft tolerance.`, '#c0392b');
            resetSelection();
            return;
        }
        previewMode = true;
        previewEl.style.display = 'block';

        const byLayer = {};
        for (const li of linesToCut) {
            byLayer[li.cfg.name] = (byLayer[li.cfg.name] || 0) + 1;
            highlightGeometry(li.feature.geometry, false);
        }
        linesListEl.innerHTML = Object.entries(byLayer)
            .map(([n, c]) => `• ${n}: <b>${c}</b>`)
            .join('<br>');

        setStatus(`${linesToCut.length} line(s) ready. Review and execute.`);
    }

    /* ─── Execute cut ─────────────────────────────────────── */
    async function executeCut() {
        if (!linesToCut.length || processing) return;
        setProcessing(true);
        setStatus('Cutting lines…');

        const snapPt    = { x: selectedPoint.geometry.x, y: selectedPoint.geometry.y };
        const undoBatch = { ts: new Date(), ops: [] };
        let ok = 0, fail = 0;

        for (const li of linesToCut) {
            try {
                const split = splitLine(li.feature.geometry, li.cutInfo, snapPt);
                if (!split) { fail++; continue; }

                const { seg1, seg2 } = split;

                // Update original feature → seg1
                const updFeature = li.feature.clone();
                updFeature.geometry = seg1;
                updFeature.attributes.calculated_length = geodeticLengthFt(seg1);

                // New feature for seg2 — strip server-managed fields so the server assigns them
                const newAttrs = { ...li.feature.attributes };
                ['objectid', 'OBJECTID', 'gis_id', 'GIS_ID',
                 'globalid', 'GLOBALID', 'created_date', 'last_edited_date'].forEach(f => delete newAttrs[f]);
                newAttrs.calculated_length = geodeticLengthFt(seg2);

                const res = await li.layer.applyEdits({
                    updateFeatures: [updFeature],
                    addFeatures:    [{ geometry: seg2, attributes: newAttrs }]
                });

                const updErr = res.updateFeatureResults?.[0]?.error;
                const addErr = res.addFeatureResults?.[0]?.error;

                if (!updErr && !addErr) {
                    undoBatch.ops.push({
                        layer:         li.layer,
                        layerName:     li.cfg.name,
                        originalFeat:  li.feature.clone(),            // full original for restore
                        addedOID:      res.addFeatureResults[0].objectId
                    });
                    ok++;
                    console.log(`✔ Cut ${li.cfg.name} OID ${li.feature.attributes.objectid ?? li.feature.attributes.OBJECTID}`);
                } else {
                    console.error('applyEdits error – update:', updErr, '  add:', addErr);
                    fail++;
                }
            } catch (e) {
                console.error(`Cut error (${li.cfg.name}):`, e);
                fail++;
            }
        }

        if (undoBatch.ops.length) {
            undoStack.push(undoBatch);
            undoBtn.disabled = false;
        }

        const msg = ok
            ? `✅ ${ok} line(s) cut${fail ? ` · ${fail} failed` : ''}.`
            : `❌ All ${fail} cut(s) failed. See console for details.`;
        setStatus(msg, ok ? '#28a745' : '#c0392b');

        setProcessing(false);
        setTimeout(resetSelection, 3000);
    }

    /* ─── Undo ────────────────────────────────────────────── */
    async function undoLastCut() {
        if (!undoStack.length || processing) return;
        setProcessing(true);
        setStatus('Undoing last cut…');

        const batch = undoStack.pop();
        let ok = 0, fail = 0;

        for (const op of batch.ops) {
            try {
                // Restore original geometry & attributes, then hard-delete the added segment
                const res = await op.layer.applyEdits({
                    updateFeatures: [op.originalFeat],
                    deleteFeatures: [{ objectId: op.addedOID }]   // ← real delete, not soft-delete
                });

                const updErr = res.updateFeatureResults?.[0]?.error;
                const delErr = res.deleteFeatureResults?.[0]?.error;

                if (!updErr && !delErr) {
                    ok++;
                    console.log(`↩ Restored OID ${op.originalFeat.attributes.objectid ?? op.originalFeat.attributes.OBJECTID}, deleted OID ${op.addedOID}`);
                } else {
                    console.error('Undo applyEdits error – update:', updErr, '  delete:', delErr);
                    fail++;
                }
            } catch (e) {
                console.error(`Undo error (${op.layerName}):`, e);
                fail++;
            }
        }

        if (!undoStack.length) undoBtn.disabled = true;
        setStatus(`↩ Undo: ${ok} restored${fail ? `, ${fail} failed` : ''}.`, ok ? '#e67e00' : '#c0392b');
        setProcessing(false);
        setTimeout(() => {
            if (toolActive) setStatus('Tool ready. Click a point feature.');
        }, 3000);
    }

    /* ─── Click handler ───────────────────────────────────── */
    async function handleClick(event) {
        if (!toolActive || processing || previewMode) return;
        event.stopPropagation();
        setProcessing(true);
        clearHighlights();
        setStatus('Searching for point feature…');

        const ptResult = await findPointFeature({ x: event.x, y: event.y });
        if (!ptResult) {
            setStatus('No point feature found. Try clicking closer to one.', '#c0392b');
            setProcessing(false);
            return;
        }

        selectedPoint      = ptResult.feature;
        selectedPointLayer = ptResult.layer;
        highlightGeometry(selectedPoint.geometry, true);

        setStatus(`${ptResult.cfg.name} selected. Searching for nearby lines…`);
        linesToCut = await findNearbyLines(selectedPoint.geometry);

        setProcessing(false);
        showPreview();
    }

    /* ─── Enable / Disable ────────────────────────────────── */
    function enableTool() {
        toolActive      = true;
        clickHandler    = mapView.on('click', handleClick);
        enableBtn.disabled  = true;
        disableBtn.disabled = false;
        if (mapView.container) mapView.container.style.cursor = 'crosshair';
        setStatus('Tool enabled. Click a point feature.');
    }

    function disableTool() {
        toolActive = false;
        resetSelection();
        clickHandler?.remove();
        clickHandler = null;
        enableBtn.disabled  = false;
        disableBtn.disabled = true;
        if (mapView.container) mapView.container.style.cursor = 'default';
        setStatus('Tool disabled.');
    }

    /* ─── Button wiring ───────────────────────────────────── */
    enableBtn.onclick  = enableTool;
    disableBtn.onclick = disableTool;
    executeBtn.onclick = executeCut;
    cancelBtn.onclick  = resetSelection;
    undoBtn.onclick    = undoLastCut;
    closeBtn.onclick   = () => {
        disableTool();
        clearHighlights();
        if (graphicsLayer) {
            mapView.map.remove(graphicsLayer);
            graphicsLayer = null;
        }
        toolBox.remove();
        window.gisToolHost?.activeTools?.delete('cut-snap-tool');
    };

    /* ─── Register & initialise ───────────────────────────── */
    window.gisToolHost.activeTools.add('cut-snap-tool');
    setStatus("Cut & Snap Tool loaded. Click 'Enable' to begin.");

})();
