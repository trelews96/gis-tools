// tools/click-copy.js - Enhanced with dynamic layers and snapping
// Click-to-Copy Tool for duplicating map features

(function() {
    try {
        // Check if tool is already active
        if (window.gisToolHost.activeTools.has('click-copy')) {
            console.log('Click-to-Copy Tool already active');
            return;
        }
        
        // Remove any leftover toolbox
        const existingToolbox = document.getElementById('clickCopyToolbox');
        if (existingToolbox) {
            existingToolbox.remove();
            console.log('Removed leftover click-copy toolbox');
        }
        
        // Use shared utilities
        const utils = window.gisSharedUtils;
        if (!utils) {
            throw new Error('Shared utilities not loaded');
        }
        
        const mapView = utils.getMapView();
        
        const z = 99999;
        
        // Tool state variables
        let toolActive = false;
        let availableLayers = [];
        let currentTargetLayerId = null;
        let templateFeature = null;
        let templateLayer = null;
        let clickHandler = null;
        let keyHandler = null;
        let mouseMoveHandler = null;
        let placementMode = false;
        let copiedCount = 0;
        let snappingEnabled = true;
        let snapTolerance = 10; // pixels
        let snapGraphic = null;
        
        // Create tool UI
        const toolBox = document.createElement("div");
        toolBox.id = "clickCopyToolbox";
        toolBox.style.cssText = `
            position: fixed;
            top: 120px;
            right: 40px;
            z-index: ${z};
            background: #fff;
            border: 1px solid #333;
            padding: 12px;
            max-width: 350px;
            font: 12px/1.3 Arial, sans-serif;
            box-shadow: 0 4px 16px rgba(0,0,0,.2);
            border-radius: 4px;
        `;
        
        toolBox.innerHTML = `
            <div style="font-weight:bold;margin-bottom:8px;">🔧 Click-to-Copy Tool</div>
            <div style="margin-bottom:8px;color:#666;font-size:11px;">
                <strong>Step 1:</strong> Select target layer<br>
                <strong>Step 2:</strong> Click feature to copy<br>
                <strong>Step 3:</strong> Click locations to place copies
            </div>
            
            <div style="margin-bottom:8px;">
                <label style="display:block;margin-bottom:4px;font-weight:bold;">Target Layer:</label>
                <select id="layerSelect" style="width:100%;padding:4px;border:1px solid #ccc;">
                    <option value="">Loading layers...</option>
                </select>
            </div>
            
            <div style="margin-bottom:8px;">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                    <input type="checkbox" id="snappingToggle" checked style="cursor:pointer;">
                    <span style="font-weight:bold;">Enable Snapping</span>
                </label>
                <div style="margin-top:4px;margin-left:22px;color:#666;font-size:11px;">
                    Snap to nearby points/vertices
                </div>
            </div>
            
            <div style="margin-bottom:8px;margin-left:22px;">
                <label style="display:block;font-size:11px;color:#666;margin-bottom:2px;">
                    Snap Tolerance (pixels):
                </label>
                <input type="number" id="snapTolerance" value="10" min="5" max="50" 
                    style="width:60px;padding:2px 4px;border:1px solid #ccc;">
            </div>
            
            <div id="templateInfo" style="margin-bottom:8px;padding:8px;background:#f5f5f5;border:1px solid #ddd;display:none;">
                <div style="font-weight:bold;">Template Feature:</div>
                <div id="templateDetails"></div>
            </div>
            
            <div style="display:flex;gap:8px;margin-bottom:8px;">
                <button id="enableTool" style="flex:1;padding:4px 8px;background:#28a745;color:white;border:none;border-radius:2px;">Enable Tool</button>
                <button id="disableTool" style="flex:1;padding:4px 8px;background:#666;color:white;border:none;border-radius:2px;" disabled>Disable Tool</button>
            </div>
            
            <div style="display:flex;gap:8px;margin-bottom:8px;">
                <button id="clearTemplate" style="flex:1;padding:4px 8px;background:#ff9800;color:white;border:none;border-radius:2px;" disabled>Clear Template</button>
                <button id="closeTool" style="flex:1;padding:4px 8px;background:#d32f2f;color:white;border:none;border-radius:2px;">Close</button>
            </div>
            
            <div id="toolStatus" style="margin-top:8px;color:#3367d6;font-size:11px;"></div>
            <div id="resultsDiv" style="margin-top:8px;font-size:11px;"></div>
        `;
        
        // Add to page
        document.body.appendChild(toolBox);
        
        // Get UI elements
        const $ = (id) => toolBox.querySelector(id);
        const layerSelect = $("#layerSelect");
        const snappingToggle = $("#snappingToggle");
        const snapToleranceInput = $("#snapTolerance");
        const enableBtn = $("#enableTool");
        const disableBtn = $("#disableTool");
        const clearBtn = $("#clearTemplate");
        const closeBtn = $("#closeTool");
        const status = $("#toolStatus");
        const templateInfo = $("#templateInfo");
        const templateDetails = $("#templateDetails");
        const resultsDiv = $("#resultsDiv");
        
        function updateStatus(message) {
            status.textContent = message;
        }
        
        function getCurrentLayerInfo() {
            return availableLayers.find(layer => layer.id === currentTargetLayerId);
        }
        
        // Load available layers dynamically
        async function loadAvailableLayers() {
            try {
                updateStatus("Loading available layers...");
                
                const allFeatureLayers = mapView.map.allLayers.filter(l => 
                    l.type === "feature" && 
                    l.visible !== false &&
                    l.layerId !== undefined
                );
                
                availableLayers = allFeatureLayers.map(layer => ({
                    id: layer.layerId,
                    name: layer.title || `Layer ${layer.layerId}`,
                    layer: layer
                })).sort((a, b) => a.name.localeCompare(b.name));
                
                // Populate dropdown
                layerSelect.innerHTML = availableLayers.length > 0
                    ? availableLayers.map(layer => 
                        `<option value="${layer.id}">${layer.name}</option>`
                      ).join('')
                    : '<option value="">No feature layers found</option>';
                
                if (availableLayers.length > 0) {
                    currentTargetLayerId = availableLayers[0].id;
                    updateStatus(`Loaded ${availableLayers.length} layers. Select layer and click 'Enable Tool' to start.`);
                } else {
                    updateStatus("No feature layers found in map.");
                }
                
                console.log(`Loaded ${availableLayers.length} available layers:`, availableLayers);
            } catch (error) {
                console.error("Error loading layers:", error);
                updateStatus("Error loading layers: " + error.message);
            }
        }
        
        async function getTargetLayer() {
            const layerInfo = getCurrentLayerInfo();
            if (!layerInfo) {
                throw new Error("No layer selected");
            }
            
            const layer = layerInfo.layer;
            if (!layer) {
                throw new Error(`${layerInfo.name} layer not found`);
            }
            
            await layer.load();
            return layer;
        }
        
        // Snapping functions
        async function findSnapPoint(screenPoint) {
            if (!snappingEnabled) {
                return null;
            }
            
            try {
                const response = await mapView.hitTest(screenPoint, {
                    include: mapView.map.allLayers.filter(l => l.type === "feature")
                });
                
                if (response.results.length === 0) {
                    return null;
                }
                
                const clickMapPoint = mapView.toMap(screenPoint);
                let closestPoint = null;
                let closestDistance = snapTolerance;
                
                for (const result of response.results) {
                    if (!result.graphic || !result.graphic.geometry) continue;
                    
                    const geometry = result.graphic.geometry;
                    
                    if (geometry.type === "point") {
                        // Snap to point feature
                        const distance = getScreenDistance(geometry, clickMapPoint);
                        if (distance < closestDistance) {
                            closestDistance = distance;
                            closestPoint = {
                                x: geometry.x,
                                y: geometry.y,
                                spatialReference: geometry.spatialReference
                            };
                        }
                    } else if (geometry.type === "polyline") {
                        // Snap to polyline vertices
                        for (const path of geometry.paths) {
                            for (const vertex of path) {
                                const vertexPoint = {
                                    x: vertex[0],
                                    y: vertex[1],
                                    spatialReference: geometry.spatialReference
                                };
                                const distance = getScreenDistance(vertexPoint, clickMapPoint);
                                if (distance < closestDistance) {
                                    closestDistance = distance;
                                    closestPoint = vertexPoint;
                                }
                            }
                        }
                    } else if (geometry.type === "polygon") {
                        // Snap to polygon vertices
                        for (const ring of geometry.rings) {
                            for (const vertex of ring) {
                                const vertexPoint = {
                                    x: vertex[0],
                                    y: vertex[1],
                                    spatialReference: geometry.spatialReference
                                };
                                const distance = getScreenDistance(vertexPoint, clickMapPoint);
                                if (distance < closestDistance) {
                                    closestDistance = distance;
                                    closestPoint = vertexPoint;
                                }
                            }
                        }
                    }
                }
                
                return closestPoint;
            } catch (error) {
                console.error("Error finding snap point:", error);
                return null;
            }
        }
        
        function getScreenDistance(point1, point2) {
            const screen1 = mapView.toScreen(point1);
            const screen2 = mapView.toScreen(point2);
            const dx = screen1.x - screen2.x;
            const dy = screen1.y - screen2.y;
            return Math.sqrt(dx * dx + dy * dy);
        }
        
        function showSnapIndicator(point) {
            if (!point) {
                hideSnapIndicator();
                return;
            }
            
            // Create or update snap graphic
            if (!snapGraphic) {
                const graphic = {
                    geometry: {
                        type: "point",
                        x: point.x,
                        y: point.y,
                        spatialReference: point.spatialReference
                    },
                    symbol: {
                        type: "simple-marker",
                        style: "cross",
                        color: [255, 0, 255, 0.8],
                        size: 12,
                        outline: {
                            color: [255, 255, 255, 1],
                            width: 2
                        }
                    }
                };
                
                snapGraphic = graphic;
                mapView.graphics.add(graphic);
            } else {
                snapGraphic.geometry = {
                    type: "point",
                    x: point.x,
                    y: point.y,
                    spatialReference: point.spatialReference
                };
            }
        }
        
        function hideSnapIndicator() {
            if (snapGraphic) {
                mapView.graphics.remove(snapGraphic);
                snapGraphic = null;
            }
        }
        
        function copyAttributesForNewFeature(originalFeature, layer) {
            // Fields to exclude when copying
            const excludeFields = [
                layer.objectIdField,
                layer.globalIdField,
                'created_date', 'creation_date', 'createdate',
                'created_user', 'creator', 'createuser',
                'last_edited_date', 'edit_date', 'editdate',
                'last_edited_user', 'editor', 'edituser',
                'objectid', 'globalid', 'gis_id', 'gisid'
            ].filter(field => field);
            
            const copiedAttributes = {};
            for (const [key, value] of Object.entries(originalFeature.attributes)) {
                if (!excludeFields.includes(key.toLowerCase())) {
                    copiedAttributes[key] = value;
                }
            }
            
            return copiedAttributes;
        }
        
        async function selectTemplate(event) {
            try {
                updateStatus("Identifying feature...");
                const response = await mapView.hitTest(event);
                const targetResults = response.results.filter(result => 
                    result.graphic && result.graphic.layer && 
                    result.graphic.layer.layerId === currentTargetLayerId
                );
                
                if (targetResults.length > 0) {
                    const graphic = targetResults[0].graphic;
                    const objectId = graphic.attributes[graphic.layer.objectIdField];
                    const attributeCount = Object.keys(graphic.attributes).length;
                    
                    // Get full feature if needed
                    if (attributeCount < 5) {
                        updateStatus("Loading full feature...");
                        const fullFeatureQuery = await graphic.layer.queryFeatures({
                            where: `${graphic.layer.objectIdField} = ${objectId}`,
                            outFields: ["*"],
                            returnGeometry: false
                        });
                        
                        if (fullFeatureQuery.features.length > 0) {
                            const fullFeature = fullFeatureQuery.features[0];
                            templateFeature = {
                                attributes: fullFeature.attributes,
                                geometry: graphic.geometry,
                                layer: graphic.layer
                            };
                        } else {
                            templateFeature = graphic;
                        }
                    } else {
                        templateFeature = graphic;
                    }
                    
                    templateLayer = graphic.layer;
                    placementMode = true;
                    
                    const gisId = templateFeature.attributes.gis_id || 
                                templateFeature.attributes.GIS_ID || 
                                objectId;
                    
                    templateDetails.innerHTML = `
                        <strong>Layer:</strong> ${getCurrentLayerInfo().name}<br>
                        <strong>GIS ID:</strong> ${gisId}<br>
                        <strong>Object ID:</strong> ${objectId}<br>
                        <strong>Attributes:</strong> ${Object.keys(templateFeature.attributes).length} fields
                    `;
                    
                    templateInfo.style.display = "block";
                    clearBtn.disabled = false;
                    mapView.container.style.cursor = "copy";
                    
                    // Enable mouse move for snap preview
                    if (snappingEnabled) {
                        mouseMoveHandler = mapView.on("pointer-move", handleMouseMove);
                    }
                    
                    const snapMsg = snappingEnabled ? " (snapping enabled)" : "";
                    updateStatus(`Template selected! Click locations to place copies${snapMsg}. Press ESC to stop.`);
                    copiedCount = 0;
                    resultsDiv.innerHTML = "";
                } else {
                    updateStatus(`No ${getCurrentLayerInfo().name.toLowerCase()} features found at this location.`);
                }
            } catch (error) {
                console.error("Template selection error:", error);
                updateStatus("Error selecting template: " + error.message);
            }
        }
        
        async function handleMouseMove(event) {
            if (!placementMode || !snappingEnabled) {
                hideSnapIndicator();
                return;
            }
            
            const snapPoint = await findSnapPoint(event);
            showSnapIndicator(snapPoint);
        }
        
        async function placeFeature(event) {
            try {
                if (!templateFeature || !placementMode) return;
                
                // Check for snap point
                let destinationPoint;
                if (snappingEnabled) {
                    const snapPoint = await findSnapPoint(event);
                    if (snapPoint) {
                        destinationPoint = snapPoint;
                        console.log("Snapped to point:", destinationPoint);
                    } else {
                        destinationPoint = mapView.toMap({x: event.x, y: event.y});
                    }
                } else {
                    destinationPoint = mapView.toMap({x: event.x, y: event.y});
                }
                
                let newGeometry;
                
                // Handle different geometry types
                if (templateFeature.geometry.type === "point") {
                    newGeometry = {
                        type: "point",
                        x: destinationPoint.x,
                        y: destinationPoint.y,
                        spatialReference: templateFeature.geometry.spatialReference || mapView.spatialReference
                    };
                } else if (templateFeature.geometry.type === "polyline") {
                    const originalGeometry = templateFeature.geometry;
                    const firstPath = originalGeometry.paths[0];
                    const originalStart = {x: firstPath[0][0], y: firstPath[0][1]};
                    const offset = {
                        x: destinationPoint.x - originalStart.x,
                        y: destinationPoint.y - originalStart.y
                    };
                    
                    newGeometry = {
                        type: "polyline",
                        paths: originalGeometry.paths.map(path => 
                            path.map(point => [point[0] + offset.x, point[1] + offset.y])
                        ),
                        spatialReference: originalGeometry.spatialReference
                    };
                } else if (templateFeature.geometry.type === "polygon") {
                    const originalGeometry = templateFeature.geometry;
                    const firstRing = originalGeometry.rings[0];
                    const originalCentroid = calculateCentroid(firstRing);
                    const offset = {
                        x: destinationPoint.x - originalCentroid.x,
                        y: destinationPoint.y - originalCentroid.y
                    };
                    
                    newGeometry = {
                        type: "polygon",
                        rings: originalGeometry.rings.map(ring => 
                            ring.map(point => [point[0] + offset.x, point[1] + offset.y])
                        ),
                        spatialReference: originalGeometry.spatialReference
                    };
                } else {
                    updateStatus("Unsupported geometry type: " + templateFeature.geometry.type);
                    return;
                }
                
                console.log("=== FEATURE COPY DEBUGGING ===");
                console.log("Template feature attributes:", templateFeature.attributes);
                console.log("Template feature geometry:", templateFeature.geometry);
                
                let copiedAttributes = copyAttributesForNewFeature(templateFeature, templateLayer);
                console.log("After initial copy - attributes:", copiedAttributes);
                
                // Apply layer template defaults if available
                try {
                    if (templateLayer.templates && templateLayer.templates.length > 0) {
                        const template = templateLayer.templates[0];
                        console.log("Using layer template:", template);
                        
                        if (template.prototype && template.prototype.attributes) {
                            console.log("Template default attributes:", template.prototype.attributes);
                            for (const [key, defaultValue] of Object.entries(template.prototype.attributes)) {
                                if (!(key in copiedAttributes) && defaultValue !== null && defaultValue !== undefined) {
                                    copiedAttributes[key] = defaultValue;
                                    console.log(`Added default value for ${key}:`, defaultValue);
                                }
                            }
                        }
                    } else {
                        console.log("No templates found on layer");
                    }
                } catch (templateError) {
                    console.log("Error applying template defaults:", templateError);
                }
                
                console.log("FINAL attributes to be applied:", copiedAttributes);
                console.log("FINAL new feature object:", {geometry: newGeometry, attributes: copiedAttributes});
                console.log("=== END DEBUGGING ===");
                
                const newFeature = {
                    geometry: newGeometry,
                    attributes: copiedAttributes
                };
                
                updateStatus("Creating copy...");
                const result = await templateLayer.applyEdits({addFeatures: [newFeature]});
                
                console.log("applyEdits result:", result);
                console.log("addFeatureResults array:", result.addFeatureResults);
                
                if (result.addFeatureResults && result.addFeatureResults.length > 0) {
                    const addResult = result.addFeatureResults[0];
                    console.log("First addFeatureResult:", addResult);
                    console.log("addResult.success:", addResult.success);
                    console.log("addResult.objectId:", addResult.objectId);
                    console.log("addResult.error:", addResult.error);
                    
                    if (addResult.success === true || addResult.objectId) {
                        copiedCount++;
                        const snapMsg = snappingEnabled ? " (snapping enabled)" : "";
                        updateStatus(`Copy ${copiedCount} created! Click for more${snapMsg} or press ESC to stop.`);
                        updateResultsDisplay();
                    } else {
                        const errorDetails = addResult.error;
                        const errorMsg = errorDetails?.message || addResult.error || "Unknown error";
                        const errorCode = errorDetails?.code || "No code";
                        console.error("Feature creation failed - full addResult:", addResult);
                        updateStatus(`Failed to create copy: ${errorMsg} (Code: ${errorCode})`);
                    }
                } else {
                    console.error("No addFeatureResults returned");
                    updateStatus("Failed to create copy: No results returned");
                }
            } catch (error) {
                console.error("Feature placement error:", error);
                updateStatus("Error placing feature: " + error.message);
            }
        }
        
        function calculateCentroid(ring) {
            let x = 0, y = 0;
            for (const point of ring) {
                x += point[0];
                y += point[1];
            }
            return {x: x / ring.length, y: y / ring.length};
        }
        
        function updateResultsDisplay() {
            if (copiedCount > 0) {
                resultsDiv.innerHTML = `<div style="color:#28a745;font-weight:bold;">Copies Created: ${copiedCount}</div>`;
            }
        }
        
        async function handleClick(event) {
            if (!toolActive) return;
            event.stopPropagation();
            
            if (!templateFeature) {
                await selectTemplate(event);
            } else if (placementMode) {
                await placeFeature(event);
            }
        }
        
        function handleKeyDown(event) {
            if (event.key === "Escape" && placementMode) {
                clearTemplate();
            }
        }
        
        function clearTemplate() {
            templateFeature = null;
            templateLayer = null;
            placementMode = false;
            templateInfo.style.display = "none";
            clearBtn.disabled = true;
            mapView.container.style.cursor = "crosshair";
            
            // Remove mouse move handler
            if (mouseMoveHandler) {
                mouseMoveHandler.remove();
                mouseMoveHandler = null;
            }
            
            hideSnapIndicator();
            
            if (toolActive) {
                updateStatus(`Template cleared. Click on a ${getCurrentLayerInfo().name.toLowerCase()} feature to select as template.`);
            }
            
            copiedCount = 0;
            resultsDiv.innerHTML = "";
        }
        
        function setupLayerSelector() {
            layerSelect.addEventListener('change', (e) => {
                currentTargetLayerId = parseInt(e.target.value);
                const layerInfo = getCurrentLayerInfo();
                clearTemplate();
                updateStatus(`Switched to ${layerInfo.name} layer. Click on a feature to select as template.`);
            });
        }
        
        function setupSnappingControls() {
            snappingToggle.addEventListener('change', (e) => {
                snappingEnabled = e.target.checked;
                snapToleranceInput.disabled = !snappingEnabled;
                
                if (!snappingEnabled) {
                    hideSnapIndicator();
                    if (mouseMoveHandler) {
                        mouseMoveHandler.remove();
                        mouseMoveHandler = null;
                    }
                } else if (placementMode) {
                    mouseMoveHandler = mapView.on("pointer-move", handleMouseMove);
                }
                
                const snapStatus = snappingEnabled ? "enabled" : "disabled";
                console.log(`Snapping ${snapStatus}`);
            });
            
            snapToleranceInput.addEventListener('change', (e) => {
                const value = parseInt(e.target.value);
                if (value >= 5 && value <= 50) {
                    snapTolerance = value;
                    console.log(`Snap tolerance set to ${snapTolerance} pixels`);
                }
            });
        }
        
        function enableTool() {
            toolActive = true;
            clickHandler = mapView.on("click", handleClick);
            keyHandler = document.addEventListener("keydown", handleKeyDown);
            
            enableBtn.disabled = true;
            disableBtn.disabled = false;
            mapView.container.style.cursor = "crosshair";
            
            updateStatus(`Tool enabled. Click on a ${getCurrentLayerInfo().name.toLowerCase()} feature to select as template.`);
        }
        
        function disableTool() {
            toolActive = false;
            placementMode = false;
            templateFeature = null;
            templateLayer = null;
            templateInfo.style.display = "none";
            
            if (clickHandler) {
                clickHandler.remove();
                clickHandler = null;
            }
            
            if (mouseMoveHandler) {
                mouseMoveHandler.remove();
                mouseMoveHandler = null;
            }
            
            document.removeEventListener("keydown", handleKeyDown);
            
            hideSnapIndicator();
            
            enableBtn.disabled = false;
            disableBtn.disabled = true;
            clearBtn.disabled = true;
            mapView.container.style.cursor = "default";
            
            updateStatus("Tool disabled.");
            copiedCount = 0;
            resultsDiv.innerHTML = "";
        }
        
        // Tool cleanup function
        function cleanup() {
            disableTool();
            toolBox.remove();
            console.log('Click-to-Copy Tool cleaned up');
        }
        
        // Event listeners
        setupLayerSelector();
        setupSnappingControls();
        enableBtn.onclick = enableTool;
        disableBtn.onclick = disableTool;
        clearBtn.onclick = clearTemplate;
        closeBtn.onclick = () => {
            window.gisToolHost.closeTool('click-copy');
        };
        
        // Initialize - load layers first
        loadAvailableLayers().then(() => {
            updateStatus("Click-to-Copy Tool loaded. Select layer and click 'Enable Tool' to start.");
        });
        
        // Register tool with host
        window.gisToolHost.activeTools.set('click-copy', {
            cleanup: cleanup,
            toolBox: toolBox
        });
        
        console.log('Click-to-Copy Tool loaded successfully');
        
    } catch (error) {
        console.error('Error loading Click-to-Copy Tool:', error);
        alert("Error creating Click-to-Copy Tool: " + (error.message || error));
    }
})();
