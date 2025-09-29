(function() {
    try {
        // Tool initialization similar to your snap-move-tool
        if (!window.gisToolHost) {
            window.gisToolHost = {};
        }
        if (!window.gisToolHost.activeTools) {
            window.gisToolHost.activeTools = new Set();
        }
        if (window.gisToolHost.activeTools.has('cut-snap-tool')) {
            console.log('Cut and Snap Tool already active');
            return;
        }

        // Get MapView
        function getMapView() {
            if (window.gisSharedUtils && window.gisSharedUtils.getMapView) {
                const mv = window.gisSharedUtils.getMapView();
                if (mv) return mv;
            }
            const mapView = Object.values(window).find(obj => 
                obj && obj.constructor && obj.constructor.name === "MapView"
            );
            if (mapView) return mapView;
            throw new Error('MapView not found');
        }

        const mapView = getMapView();

        // Configuration
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

        const CUT_TOLERANCE = 15; // feet
        const POINT_SNAP_TOLERANCE = 25; // feet
        const z = 99999;

        // State
        let toolActive = false;
        let selectedPoint = null;
        let selectedPointLayer = null;
        let linesToCut = [];
        let previewMode = false;
        let undoStack = [];
        let clickHandler = null;

        // Create UI
        const toolBox = document.createElement("div");
        toolBox.id = "cutSnapToolbox";
        toolBox.style.cssText = `
            position: fixed; 
            top: 120px; 
            right: 40px; 
            z-index: ${z}; 
            background: #fff; 
            border: 1px solid #333; 
            padding: 12px; 
            max-width: 360px; 
            font: 12px/1.3 Arial, sans-serif; 
            box-shadow: 0 4px 16px rgba(0,0,0,.2); 
            border-radius: 4px;
        `;

        toolBox.innerHTML = `
            <div style="font-weight:bold;margin-bottom:8px;">✂️ Cut & Snap Lines Tool</div>
            <div style="margin-bottom:8px;color:#666;font-size:11px;">
                <strong>Workflow:</strong><br>
                1. Click on a point feature<br>
                2. Review lines to be cut<br>
                3. Execute cut operation<br>
                Lines will be split at the point with proper snapping.
            </div>
            <div style="display:flex;gap:8px;margin-bottom:8px;">
                <button id="enableTool" style="flex:1;padding:4px 8px;background:#28a745;color:white;border:none;border-radius:2px;">Enable Tool</button>
                <button id="disableTool" style="flex:1;padding:4px 8px;background:#666;color:white;border:none;border-radius:2px;" disabled>Disable Tool</button>
            </div>
            <div id="previewSection" style="display:none;margin-bottom:8px;padding:8px;background:#f0f8ff;border:1px solid #3367d6;border-radius:2px;">
                <div style="font-weight:bold;margin-bottom:4px;">Lines to Cut:</div>
                <div id="linesList" style="font-size:11px;margin-bottom:8px;"></div>
                <div style="display:flex;gap:8px;">
                    <button id="executeCut" style="flex:1;padding:4px 8px;background:#dc3545;color:white;border:none;border-radius:2px;">Execute Cut</button>
                    <button id="cancelCut" style="flex:1;padding:4px 8px;background:#6c757d;color:white;border:none;border-radius:2px;">Cancel</button>
                </div>
            </div>
            <div style="display:flex;gap:8px;margin-bottom:8px;">
                <button id="undoLast" style="flex:1;padding:4px 8px;background:#ff9800;color:white;border:none;border-radius:2px;" disabled>Undo Last Cut</button>
                <button id="closeTool" style="flex:1;padding:4px 8px;background:#d32f2f;color:white;border:none;border-radius:2px;">Close</button>
            </div>
            <div id="toolStatus" style="margin-top:8px;color:#3367d6;font-size:11px;"></div>
        `;

        document.body.appendChild(toolBox);

        // Element references
        const $ = (id) => toolBox.querySelector(id);
        const enableBtn = $("#enableTool");
        const disableBtn = $("#disableTool");
        const executeCutBtn = $("#executeCut");
        const cancelCutBtn = $("#cancelCut");
        const undoBtn = $("#undoLast");
        const closeBtn = $("#closeTool");
        const status = $("#toolStatus");
        const previewSection = $("#previewSection");
        const linesList = $("#linesList");

        function updateStatus(message) {
            if (status) status.textContent = message;
        }

        // Utility functions (reuse from your code)
        function calculateDistance(point1, point2) {
            const dx = point1.x - point2.x;
            const dy = point1.y - point2.y;
            return Math.sqrt(dx * dx + dy * dy);
        }

        function calculateGeodeticLength(geometry) {
            try {
                if (!geometry || !geometry.paths || geometry.paths.length === 0) return 0;
                let totalLength = 0;
                for (const path of geometry.paths) {
                    if (path.length < 2) continue;
                    for (let i = 0; i < path.length - 1; i++) {
                        const point1 = {
                            x: path[i][0],
                            y: path[i][1],
                            spatialReference: geometry.spatialReference
                        };
                        const point2 = {
                            x: path[i + 1][0],
                            y: path[i + 1][1],
                            spatialReference: geometry.spatialReference
                        };
                        totalLength += calculateGeodeticDistanceBetweenPoints(point1, point2);
                    }
                }
                return Math.round(totalLength);
            } catch (error) {
                console.error("Error calculating geodetic length:", error);
                return 0;
            }
        }

        function calculateGeodeticDistanceBetweenPoints(point1, point2) {
            try {
                const latLng1 = convertMapPointToLatLng(point1);
                const latLng2 = convertMapPointToLatLng(point2);
                const earthRadiusFeet = 20902231.0;
                const lat1Rad = latLng1.lat * Math.PI / 180;
                const lat2Rad = latLng2.lat * Math.PI / 180;
                const deltaLatRad = (latLng2.lat - latLng1.lat) * Math.PI / 180;
                const deltaLngRad = (latLng2.lng - latLng1.lng) * Math.PI / 180;
                const a = Math.sin(deltaLatRad / 2) * Math.sin(deltaLatRad / 2) +
                         Math.cos(lat1Rad) * Math.cos(lat2Rad) *
                         Math.sin(deltaLngRad / 2) * Math.sin(deltaLngRad / 2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                return earthRadiusFeet * c;
            } catch (error) {
                console.error("Error calculating distance:", error);
                return 0;
            }
        }

        function convertMapPointToLatLng(mapPoint) {
            try {
                const sr = mapPoint.spatialReference;
                if (!sr || sr.wkid === 3857 || sr.wkid === 102100) {
                    return convertWebMercatorToLatLng(mapPoint.x, mapPoint.y);
                } else if (sr.wkid === 4326 || sr.wkid === 4269) {
                    return { lat: mapPoint.y, lng: mapPoint.x };
                } else {
                    return convertWebMercatorToLatLng(mapPoint.x, mapPoint.y);
                }
            } catch (error) {
                console.error("Error converting map point:", error);
                return { lat: 0, lng: 0 };
            }
        }

        function convertWebMercatorToLatLng(x, y) {
            const lng = (x / 20037508.34) * 180;
            let lat = (y / 20037508.34) * 180;
            lat = 180 / Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
            return { lat: lat, lng: lng };
        }

function resetSelection() {
    selectedPoint = null;
    selectedPointLayer = null;
    linesToCut = [];
    previewMode = false;
    if (previewSection) previewSection.style.display = "none";
    if (toolActive) {
        updateStatus("Tool ready. Click on a point feature to start.");
    }
}


        // Find point feature at click location
        async function findPointFeatureAtLocation(screenPoint) {
            try {
                const mapPoint = mapView.toMap(screenPoint);
                const tolerance = POINT_SNAP_TOLERANCE * (mapView.resolution || 1);

                for (const pointConfig of LAYER_CONFIG.points) {
                    try {
                        const layer = mapView.map.allLayers.find(l => l.layerId === pointConfig.id);
                        if (!layer || !layer.visible) continue;

                        await layer.load();

                        const extent = {
                            xmin: mapPoint.x - tolerance,
                            ymin: mapPoint.y - tolerance,
                            xmax: mapPoint.x + tolerance,
                            ymax: mapPoint.y + tolerance,
                            spatialReference: mapView.spatialReference
                        };

                        const result = await layer.queryFeatures({
                            geometry: extent,
                            spatialRelationship: "intersects",
                            returnGeometry: true,
                            outFields: ["*"]
                        });

                        if (result.features.length > 0) {
                            let closestFeature = null;
                            let minDistance = Infinity;

                            for (const feature of result.features) {
                                const distance = calculateDistance(mapPoint, feature.geometry);
                                if (distance < minDistance) {
                                    minDistance = distance;
                                    closestFeature = feature;
                                }
                            }

                            if (closestFeature) {
                                return {
                                    feature: closestFeature,
                                    layer: layer,
                                    layerConfig: pointConfig
                                };
                            }
                        }
                    } catch (error) {
                        console.error("Error querying point layer:", error);
                    }
                }
            } catch (error) {
                console.error("Error finding point feature:", error);
            }
            return null;
        }

        // Find closest point on line segment
        function getClosestPointOnSegment(point, segmentStart, segmentEnd) {
            const A = point.x - segmentStart.x;
            const B = point.y - segmentStart.y;
            const C = segmentEnd.x - segmentStart.x;
            const D = segmentEnd.y - segmentStart.y;
            const dot = A * C + B * D;
            const lenSq = C * C + D * D;

            let param = -1;
            if (lenSq !== 0) param = dot / lenSq;

            let closestPoint;
            if (param < 0) {
                closestPoint = { x: segmentStart.x, y: segmentStart.y };
            } else if (param > 1) {
                closestPoint = { x: segmentEnd.x, y: segmentEnd.y };
            } else {
                closestPoint = {
                    x: segmentStart.x + param * C,
                    y: segmentStart.y + param * D
                };
            }

            return {
                point: closestPoint,
                distance: calculateDistance(point, closestPoint),
                param: param
            };
        }

        // Find closest segment and calculate cut point
        function findCutPoint(lineGeometry, pointGeometry) {
            if (!lineGeometry || !lineGeometry.paths) return null;

            let closestCut = null;
            let minDistance = Infinity;

            for (let pathIndex = 0; pathIndex < lineGeometry.paths.length; pathIndex++) {
                const path = lineGeometry.paths[pathIndex];
                for (let segmentIndex = 0; segmentIndex < path.length - 1; segmentIndex++) {
                    const p1 = { x: path[segmentIndex][0], y: path[segmentIndex][1] };
                    const p2 = { x: path[segmentIndex + 1][0], y: path[segmentIndex + 1][1] };
                    const segmentInfo = getClosestPointOnSegment(pointGeometry, p1, p2);

                    if (segmentInfo.distance < minDistance) {
                        minDistance = segmentInfo.distance;
                        closestCut = {
                            pathIndex: pathIndex,
                            segmentIndex: segmentIndex,
                            insertIndex: segmentIndex + 1,
                            distance: segmentInfo.distance,
                            cutPoint: segmentInfo.point,
                            snapPoint: { x: pointGeometry.x, y: pointGeometry.y }
                        };
                    }
                }
            }

            return closestCut;
        }

        // Find all lines to cut
        async function findLinesToCut(pointGeometry) {
            const lines = [];
            const bufferDistanceFeet = CUT_TOLERANCE;
            const bufferDistanceMeters = bufferDistanceFeet / 3.28084;

            console.log(`Searching for lines within ${bufferDistanceFeet}ft of point`);

            for (const lineConfig of LAYER_CONFIG.lines) {
                try {
                    const layer = mapView.map.allLayers.find(l => l.layerId === lineConfig.id);
                    if (!layer || !layer.visible) continue;

                    await layer.load();

                    const bufferedGeometry = {
                        type: "polygon",
                        spatialReference: pointGeometry.spatialReference,
                        rings: [[
                            [pointGeometry.x - bufferDistanceMeters, pointGeometry.y - bufferDistanceMeters],
                            [pointGeometry.x + bufferDistanceMeters, pointGeometry.y - bufferDistanceMeters],
                            [pointGeometry.x + bufferDistanceMeters, pointGeometry.y + bufferDistanceMeters],
                            [pointGeometry.x - bufferDistanceMeters, pointGeometry.y + bufferDistanceMeters],
                            [pointGeometry.x - bufferDistanceMeters, pointGeometry.y - bufferDistanceMeters]
                        ]]
                    };

                    const result = await layer.queryFeatures({
                        geometry: bufferedGeometry,
                        spatialRelationship: "intersects",
                        returnGeometry: true,
                        outFields: ["*"],
                        maxRecordCount: 100
                    });

                    console.log(`Layer ${lineConfig.name} returned ${result.features.length} candidates`);

                    for (const feature of result.features) {
                        const cutInfo = findCutPoint(feature.geometry, pointGeometry);
                        if (cutInfo && cutInfo.distance <= bufferDistanceMeters) {
                            lines.push({
                                feature: feature,
                                layer: layer,
                                layerConfig: lineConfig,
                                cutInfo: cutInfo
                            });
                            console.log(`Will cut ${lineConfig.name} feature ${feature.attributes.objectid}, distance: ${cutInfo.distance.toFixed(1)}m`);
                        }
                    }
                } catch (error) {
                    console.error(`Error finding lines in layer ${lineConfig.name}:`, error);
                }
            }

            console.log(`Found ${lines.length} total lines to cut`);
            return lines;
        }

        // Split line geometry at cut point
        function splitLineGeometry(originalGeometry, cutInfo, snapPoint) {
            const path = originalGeometry.paths[cutInfo.pathIndex];

            // Create segment 1: start to cut point (snapped)
            const geometry1 = originalGeometry.clone();
            geometry1.paths[cutInfo.pathIndex] = [
                ...path.slice(0, cutInfo.insertIndex),
                [snapPoint.x, snapPoint.y]
            ];

            // Create segment 2: cut point (snapped) to end
            const geometry2 = originalGeometry.clone();
            geometry2.paths[cutInfo.pathIndex] = [
                [snapPoint.x, snapPoint.y],
                ...path.slice(cutInfo.insertIndex)
            ];

            return { segment1: geometry1, segment2: geometry2 };
        }

        // Create new feature from segment
        function createFeatureFromSegment(geometry, originalFeature) {
            const newAttributes = { ...originalFeature.attributes };
            
            // Remove fields that shouldn't be copied
            delete newAttributes.objectid;
            delete newAttributes.gis_id;
            delete newAttributes.OBJECTID;
            delete newAttributes.GIS_ID;
            
            // Recalculate length
            newAttributes.calculated_length = calculateGeodeticLength(geometry);

            return {
                geometry: geometry,
                attributes: newAttributes
            };
        }

       // Execute the cut operation
async function executeCut() {
    if (linesToCut.length === 0) {
        updateStatus("No lines to cut");
        return;
    }

    updateStatus("Cutting lines...");
    
    const undoInfo = {
        timestamp: new Date(),
        pointFeature: selectedPoint,
        operations: []
    };

    let successCount = 0;
    let errorCount = 0;

    for (const lineInfo of linesToCut) {
        try {
            const { segment1, segment2 } = splitLineGeometry(
                lineInfo.feature.geometry,
                lineInfo.cutInfo,
                lineInfo.cutInfo.snapPoint
            );

            // Instead of deleting original:
            // 1. Update the original feature to become segment1
            // 2. Add a new feature for segment2
            
            const updatedOriginal = lineInfo.feature.clone();
            updatedOriginal.geometry = segment1;
            updatedOriginal.attributes.calculated_length = calculateGeodeticLength(segment1);

            const newFeature2 = createFeatureFromSegment(segment2, lineInfo.feature);

            console.log(`Cutting ${lineInfo.layerConfig.name} feature ${lineInfo.feature.attributes.objectid}`);
            console.log(`  Updated original to length: ${updatedOriginal.attributes.calculated_length}ft`);
            console.log(`  New segment length: ${newFeature2.attributes.calculated_length}ft`);

            const editResult = await lineInfo.layer.applyEdits({
                updateFeatures: [updatedOriginal],
                addFeatures: [newFeature2]
            });

            // Check for errors
            if (editResult.updateFeatureResults && editResult.updateFeatureResults.length > 0) {
                const updateResult = editResult.updateFeatureResults[0];
                if (!updateResult.error) {
                    console.log(`Successfully updated feature ${updateResult.objectId}`);
                } else {
                    console.error(`Error updating feature:`, updateResult.error);
                    errorCount++;
                    continue;
                }
            }

            if (editResult.addFeatureResults && editResult.addFeatureResults.length > 0) {
                const addResult = editResult.addFeatureResults[0];
                if (!addResult.error) {
                    console.log(`Successfully added new feature ${addResult.objectId}`);
                    
                    // Store undo information
                    undoInfo.operations.push({
                        layer: lineInfo.layer,
                        layerName: lineInfo.layerConfig.name,
                        originalFeature: lineInfo.feature.clone(),
                        updatedFeatureId: lineInfo.feature.attributes.objectid,
                        addedFeatureId: addResult.objectId
                    });
                    
                    successCount++;
                } else {
                    console.error(`Error adding feature:`, addResult.error);
                    errorCount++;
                }
            }

        } catch (error) {
            console.error(`Error cutting line in ${lineInfo.layerConfig.name}:`, error);
            errorCount++;
        }
    }

    // Add to undo stack
    if (undoInfo.operations.length > 0) {
        undoStack.push(undoInfo);
        if (undoBtn) undoBtn.disabled = false;
    }

    if (successCount > 0) {
        updateStatus(`✅ Cut complete! ${successCount} lines cut, ${errorCount} errors.`);
    } else {
        updateStatus(`❌ Cut failed. ${errorCount} errors. Check console for details.`);
    }
    
    // Reset state
    setTimeout(() => {
        resetSelection();
    }, 3000);
}
        // Undo last cut operation
async function undoLastCut() {
    if (undoStack.length === 0) {
        updateStatus("Nothing to undo");
        return;
    }

    updateStatus("Undoing last cut...");
    const undoInfo = undoStack.pop();

    let successCount = 0;
    let errorCount = 0;

    for (const operation of undoInfo.operations) {
        try {
            // Delete the added feature
            const featureToDelete = { objectId: operation.addedFeatureId };
            
            // Restore the original feature geometry and attributes
            const restoredFeature = operation.originalFeature.clone();
            
            await operation.layer.applyEdits({
                deleteFeatures: [featureToDelete],
                updateFeatures: [restoredFeature]
            });

            successCount++;
        } catch (error) {
            console.error(`Error undoing cut in ${operation.layerName}:`, error);
            errorCount++;
        }
    }

    if (undoStack.length === 0 && undoBtn) {
        undoBtn.disabled = true;
    }

    updateStatus(`✅ Undo complete! ${successCount} operations reversed, ${errorCount} errors.`);
    setTimeout(() => {
        updateStatus("Tool ready. Click on a point feature to start.");
    }, 3000);
}

        // Show preview of lines to cut
        function showPreview() {
            if (linesToCut.length === 0) {
                updateStatus("No lines found within tolerance to cut");
                resetSelection();
                return;
            }

            previewMode = true;
            previewSection.style.display = "block";

            // Group by layer
            const byLayer = {};
            for (const lineInfo of linesToCut) {
                const name = lineInfo.layerConfig.name;
                if (!byLayer[name]) byLayer[name] = 0;
                byLayer[name]++;
            }

            let html = "";
            for (const [layerName, count] of Object.entries(byLayer)) {
                html += `${layerName}: ${count}<br>`;
            }
            linesList.innerHTML = html;

            updateStatus(`Found ${linesToCut.length} lines to cut. Review and click 'Execute Cut'.`);
        }

        // Handle click event
        async function handleClick(event) {
            if (!toolActive) return;
            event.stopPropagation();

            if (previewMode) return; // Prevent additional clicks during preview

            const screenPoint = { x: event.x, y: event.y };
            updateStatus("Searching for point feature...");

            const pointResult = await findPointFeatureAtLocation(screenPoint);
            if (!pointResult) {
                updateStatus("No point feature found. Try again.");
                return;
            }

            selectedPoint = pointResult.feature;
            selectedPointLayer = pointResult.layer;

            updateStatus(`Point selected: ${pointResult.layerConfig.name}. Searching for lines...`);

            linesToCut = await findLinesToCut(selectedPoint.geometry);
            showPreview();
        }

        // Tool controls
        function enableTool() {
            toolActive = true;
            clickHandler = mapView.on("click", handleClick);
            if (enableBtn) enableBtn.disabled = true;
            if (disableBtn) disableBtn.disabled = false;
            if (mapView.container) mapView.container.style.cursor = "crosshair";
            updateStatus("Tool enabled. Click on a point feature to start.");
        }

        function disableTool() {
            toolActive = false;
            resetSelection();
            if (clickHandler) clickHandler.remove();
            if (enableBtn) enableBtn.disabled = false;
            if (disableBtn) disableBtn.disabled = true;
            if (mapView.container) mapView.container.style.cursor = "default";
            updateStatus("Tool disabled.");
        }

        // Event listeners
        if (enableBtn) enableBtn.onclick = enableTool;
        if (disableBtn) disableBtn.onclick = disableTool;
        if (executeCutBtn) executeCutBtn.onclick = executeCut;
        if (cancelCutBtn) cancelCutBtn.onclick = resetSelection;
        if (undoBtn) undoBtn.onclick = undoLastCut;
        if (closeBtn) {
            closeBtn.onclick = () => {
                disableTool();
                toolBox.remove();
                if (window.gisToolHost && window.gisToolHost.activeTools) {
                    window.gisToolHost.activeTools.delete('cut-snap-tool');
                }
            };
        }

        // Register tool
        window.gisToolHost.activeTools.add('cut-snap-tool');
        updateStatus("Cut & Snap Tool loaded. Click 'Enable Tool' to start.");

    } catch (error) {
        console.error("Error creating cut-snap tool:", error);
        alert("Error creating tool: " + (error.message || error));
    }
})();
