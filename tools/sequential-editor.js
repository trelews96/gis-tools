// tools/sequential-editor.js - Sequential Feature Editor with Polygon Selection
// Allows editing slackloop sequential fields and generating daily tracking links for fiber cables

(function() {
    try {
        // Check if tool is already active
        if (window.gisToolHost.activeTools.has('sequential-editor')) {
            return;
        }
        
        // Remove any leftover toolbox
        const existingToolbox = document.getElementById('sequentialEditorToolbox');
        if (existingToolbox) {
            existingToolbox.remove();
        }
        
        // Use shared utilities
        const utils = window.gisSharedUtils;
        if (!utils) {
            throw new Error('Shared utilities not loaded');
        }
        
        const mapView = utils.getMapView();
        
        // Configuration
        const LAYER_CONFIG = [
            {id: 41250, name: "Slack Loop", type: "slackloop"},
            {id: 41050, name: "Fiber Cable", type: "fiber_cable"}
        ];
        
        const z = 99999;
        
        // Tool state variables
        let sketchViewModel = null;
        let polygonGraphic = null;
        let selectedSlackloops = [];
        let selectedFiberCables = [];
        let currentSlackloopIndex = 0;
        let currentFiberCableIndex = 0;
        let currentPhase = 'selection'; // 'selection', 'slackloop', 'fiber_cable', 'complete'
        let currentHighlight = null;
        
        // Create tool UI
        const toolBox = document.createElement("div");
        toolBox.id = "sequentialEditorToolbox";
        toolBox.style.cssText = `
            position: fixed;
            top: 80px;
            right: 40px;
            z-index: ${z};
            background: #fff;
            border: 1px solid #333;
            padding: 12px;
            max-width: 450px;
            max-height: 85vh;
            overflow: auto;
            font: 12px/1.3 Arial, sans-serif;
            box-shadow: 0 4px 16px rgba(0,0,0,.2);
            border-radius: 4px;
        `;
        
        toolBox.innerHTML = `
            <div style="font-weight:bold;margin-bottom:12px;">🔧 Sequential Feature Editor</div>
            
            <!-- Selection Phase -->
            <div id="selectionPhase">
                <div style="margin-bottom:12px;color:#666;font-size:11px;">
                    <strong>Step 1:</strong> Draw a polygon to select features<br>
                    <strong>Step 2:</strong> Edit slackloop sequential fields<br>
                    <strong>Step 3:</strong> Access fiber cable daily tracking links
                </div>
                
                <div style="display:flex;gap:8px;margin-bottom:12px;">
                    <button id="drawPolygonBtn" style="flex:1;padding:6px 12px;background:#28a745;color:white;border:none;border-radius:3px;cursor:pointer;">Draw Selection Polygon</button>
                    <button id="clearPolygonBtn" style="flex:1;padding:6px 12px;background:#6c757d;color:white;border:none;border-radius:3px;cursor:pointer;" disabled>Clear Polygon</button>
                </div>
                
                <div id="selectionResults" style="margin-bottom:12px;"></div>
                
                <button id="startEditingBtn" style="width:100%;padding:6px 12px;background:#007bff;color:white;border:none;border-radius:3px;cursor:pointer;display:none;">Start Sequential Editing</button>
                
                <button id="clearHighlightsBtn" style="width:100%;padding:6px 12px;background:#ffc107;color:black;border:none;border-radius:3px;cursor:pointer;margin-top:8px;">Clear All Highlights</button>
            </div>
            
            <!-- Slackloop Editing Phase -->
            <div id="slackloopPhase" style="display:none;">
                <div style="font-weight:bold;margin-bottom:8px;color:#28a745;">Editing Slack Loops</div>
                
                <div id="slackloopProgress" style="margin-bottom:12px;padding:8px;background:#f8f9fa;border:1px solid #dee2e6;border-radius:3px;"></div>
                
                <div id="slackloopInfo" style="margin-bottom:12px;padding:8px;background:#e3f2fd;border:1px solid #bbdefb;border-radius:3px;"></div>
                
                <div style="margin-bottom:8px;">
                    <label style="display:block;margin-bottom:4px;font-weight:bold;">Sequential In:</label>
                    <input type="number" id="sequentialInInput" style="width:100%;padding:4px;border:1px solid #ccc;border-radius:2px;" min="0" step="1">
                </div>
                
                <div style="margin-bottom:12px;">
                    <label style="display:block;margin-bottom:4px;font-weight:bold;">Sequential Out:</label>
                    <input type="number" id="sequentialOutInput" style="width:100%;padding:4px;border:1px solid #ccc;border-radius:2px;" min="0" step="1">
                </div>
                
                <div style="display:flex;gap:8px;margin-bottom:12px;">
                    <button id="submitSlackloopBtn" style="flex:1;padding:6px 12px;background:#28a745;color:white;border:none;border-radius:3px;cursor:pointer;">Submit & Next</button>
                    <button id="skipSlackloopBtn" style="flex:1;padding:6px 12px;background:#ffc107;color:black;border:none;border-radius:3px;cursor:pointer;">Skip This One</button>
                </div>
                
                <button id="clearHighlightsBtn2" style="width:100%;padding:6px 12px;background:#ffc107;color:black;border:none;border-radius:3px;cursor:pointer;margin-bottom:8px;">Clear All Highlights</button>
            </div>
            
            <!-- Fiber Cable Phase -->
            <div id="fiberCablePhase" style="display:none;">
                <div style="font-weight:bold;margin-bottom:8px;color:#dc3545;">Fiber Cable Daily Tracking</div>
                
                <div id="fiberCableProgress" style="margin-bottom:12px;padding:8px;background:#f8f9fa;border:1px solid #dee2e6;border-radius:3px;"></div>
                
                <div id="fiberCableInfo" style="margin-bottom:12px;padding:8px;background:#fff3cd;border:1px solid #ffeaa7;border-radius:3px;"></div>
                
                <div id="dailyTrackingLink" style="margin-bottom:12px;padding:8px;background:#d1ecf1;border:1px solid #bee5eb;border-radius:3px;"></div>
                
                <div style="display:flex;gap:8px;margin-bottom:12px;">
                    <button id="nextFiberCableBtn" style="flex:1;padding:6px 12px;background:#007bff;color:white;border:none;border-radius:3px;cursor:pointer;">Next Feature</button>
                    <button id="openLinkBtn" style="flex:1;padding:6px 12px;background:#17a2b8;color:white;border:none;border-radius:3px;cursor:pointer;">Open Link</button>
                </div>
                
                <button id="clearHighlightsBtn3" style="width:100%;padding:6px 12px;background:#ffc107;color:black;border:none;border-radius:3px;cursor:pointer;margin-bottom:8px;">Clear All Highlights</button>
            </div>
            
            <!-- Complete Phase -->
            <div id="completePhase" style="display:none;">
                <div style="font-weight:bold;margin-bottom:8px;color:#28a745;">✅ Editing Complete!</div>
                <div style="margin-bottom:12px;color:#666;">All features have been processed.</div>
                <button id="startOverBtn" style="width:100%;padding:6px 12px;background:#28a745;color:white;border:none;border-radius:3px;cursor:pointer;margin-bottom:8px;">Start Over</button>
                <button id="clearHighlightsBtn4" style="width:100%;padding:6px 12px;background:#ffc107;color:black;border:none;border-radius:3px;cursor:pointer;margin-bottom:8px;">Clear All Highlights</button>
            </div>
            
            <div style="border-top:1px solid #ddd;margin-top:12px;padding-top:8px;">
                <button id="closeTool" style="width:100%;padding:6px;background:#d32f2f;color:white;border:none;border-radius:3px;cursor:pointer;">Close Tool</button>
            </div>
            
            <div id="toolStatus" style="margin-top:8px;color:#3367d6;font-size:11px;"></div>
        `;
        
        // Add to page
        document.body.appendChild(toolBox);
        
        // Get UI elements
        const $ = (id) => toolBox.querySelector(id);
        const status = $("#toolStatus");
        
        function updateStatus(message) {
            status.textContent = message;
        }
        
        function setPhase(phase) {
            currentPhase = phase;
            
            // Hide all phases
            $("#selectionPhase").style.display = "none";
            $("#slackloopPhase").style.display = "none";
            $("#fiberCablePhase").style.display = "none";
            $("#completePhase").style.display = "none";
            
            // Show current phase
            switch(phase) {
                case 'selection':
                    $("#selectionPhase").style.display = "block";
                    break;
                case 'slackloop':
                    $("#slackloopPhase").style.display = "block";
                    break;
                case 'fiber_cable':
                    $("#fiberCablePhase").style.display = "block";
                    break;
                case 'complete':
                    $("#completePhase").style.display = "block";
                    break;
            }
        }
        
        function clearHighlight() {
            if (currentHighlight) {
                mapView.graphics.remove(currentHighlight);
                if (currentHighlight.pulseGraphic) {
                    mapView.graphics.remove(currentHighlight.pulseGraphic);
                }
                currentHighlight = null;
            }
        }
        
        function getObjectIdField(feature) {
            if (!feature || !feature.attributes) {
                return null;
            }
            
            let objectIdField = null;
            
            // Check for standard "objectid" field first
            if (feature.attributes.objectid !== undefined) {
                objectIdField = 'objectid';
            } else if (feature.layer && feature.layer.objectIdField) {
                objectIdField = feature.layer.objectIdField;
            } else {
                // Check for common variations
                const attrs = Object.keys(feature.attributes);
                const upperAttrs = attrs.map(a => a.toUpperCase());
                
                if (upperAttrs.includes('OBJECTID')) {
                    objectIdField = attrs.find(a => a.toUpperCase() === 'OBJECTID');
                } else if (upperAttrs.includes('OBJECTID_1')) {
                    objectIdField = attrs.find(a => a.toUpperCase() === 'OBJECTID_1');
                } else if (upperAttrs.includes('OID')) {
                    objectIdField = attrs.find(a => a.toUpperCase() === 'OID');
                } else if (upperAttrs.includes('FID')) {
                    objectIdField = attrs.find(a => a.toUpperCase() === 'FID');
                } else if (feature.attributes.gis_id) {
                    objectIdField = 'gis_id';
                }
            }
            
            return objectIdField;
        }
        
        // Helper function to get appropriate popup location based on geometry type
        function getPopupLocation(geometry) {
            try {
                if (geometry.type === "point") {
                    return geometry;
                } else if (geometry.type === "polyline") {
                    // Use the midpoint of the polyline
                    if (geometry.paths && geometry.paths[0] && geometry.paths[0].length > 0) {
                        const path = geometry.paths[0];
                        const midIndex = Math.floor(path.length / 2);
                        return {
                            type: "point",
                            x: path[midIndex][0],
                            y: path[midIndex][1],
                            spatialReference: geometry.spatialReference
                        };
                    }
                } else if (geometry.type === "polygon") {
                    // Use the centroid of the polygon
                    if (geometry.centroid) {
                        return geometry.centroid;
                    } else if (geometry.rings && geometry.rings[0] && geometry.rings[0].length > 0) {
                        // Calculate simple centroid if not available
                        const ring = geometry.rings[0];
                        let sumX = 0, sumY = 0;
                        for (let i = 0; i < ring.length - 1; i++) { // -1 to exclude closing point
                            sumX += ring[i][0];
                            sumY += ring[i][1];
                        }
                        return {
                            type: "point",
                            x: sumX / (ring.length - 1),
                            y: sumY / (ring.length - 1),
                            spatialReference: geometry.spatialReference
                        };
                    }
                }
                
                // Fallback to geometry extent center if available
                if (geometry.extent && geometry.extent.center) {
                    return geometry.extent.center;
                }
                
                // Final fallback - return the geometry itself
                return geometry;
            } catch (error) {
                return geometry; // Fallback to original geometry
            }
        }
        
        function highlightFeature(feature, color = [255, 255, 0, 0.8], showPopup = false) {
            try {
                if (!feature || !feature.geometry || !feature.attributes) {
                    return;
                }
                
                clearHighlight();
                
                let symbol;
                if (feature.geometry.type === "point") {
                    symbol = {
                        type: "simple-marker",
                        color: color,
                        size: 20,
                        outline: {
                            color: [255, 255, 255, 1],
                            width: 4
                        }
                    };
                } else if (feature.geometry.type === "polyline") {
                    symbol = {
                        type: "simple-line",
                        color: color,
                        width: 8,
                        style: "solid"
                    };
                } else if (feature.geometry.type === "polygon") {
                    symbol = {
                        type: "simple-fill",
                        color: color,
                        outline: {
                            color: [255, 255, 255, 1],
                            width: 4
                        }
                    };
                }
                
                currentHighlight = {
                    geometry: feature.geometry,
                    symbol: symbol
                };
                
                mapView.graphics.add(currentHighlight);
                
                // Add a pulsing effect by creating a second, larger graphic
                let pulseSymbol;
                if (feature.geometry.type === "point") {
                    pulseSymbol = {
                        type: "simple-marker",
                        color: [color[0], color[1], color[2], 0.3],
                        size: 30,
                        outline: {
                            color: [255, 255, 255, 0.8],
                            width: 2
                        }
                    };
                } else if (feature.geometry.type === "polyline") {
                    pulseSymbol = {
                        type: "simple-line",
                        color: [color[0], color[1], color[2], 0.5],
                        width: 12,
                        style: "solid"
                    };
                } else if (feature.geometry.type === "polygon") {
                    pulseSymbol = {
                        type: "simple-fill",
                        color: [color[0], color[1], color[2], 0.3],
                        outline: {
                            color: [255, 255, 255, 0.8],
                            width: 6
                        }
                    };
                }
                
                const pulseGraphic = {
                    geometry: feature.geometry,
                    symbol: pulseSymbol
                };
                
                mapView.graphics.add(pulseGraphic);
                
                // Store both graphics for cleanup
                currentHighlight.pulseGraphic = pulseGraphic;
                
                // Zoom to feature with padding
                mapView.goTo({
                    target: feature.geometry,
                    scale: Math.min(mapView.scale, 2000) // Don't zoom out if already closer
                }, {duration: 800}).then(() => {
                    // Show popup after zoom completes if requested
                    if (showPopup && mapView.popup && feature.layer) {
                        showFeaturePopup(feature);
                    }
                }).catch(err => {
                    // Still try to show popup even if zoom fails
                    if (showPopup && mapView.popup && feature.layer) {
                        showFeaturePopup(feature);
                    }
                });
                
            } catch (error) {
                updateStatus('Error highlighting feature: ' + error.message);
            }
        }
        
        // Separate function to handle popup display using proper feature query
        async function showFeaturePopup(feature) {
            try {
                const objectIdField = getObjectIdField(feature);
                const objectId = feature.attributes[objectIdField];
                
                if (!objectIdField || !objectId) {
                    // Fallback to simple popup if we can't query
                    mapView.popup.open({
                        features: [{
                            geometry: feature.geometry,
                            attributes: feature.attributes
                        }],
                        location: getPopupLocation(feature.geometry)
                    });
                    return;
                }
                
                // Query the feature directly from the layer to get proper ArcGIS Feature object
                const queryResult = await feature.layer.queryFeatures({
                    where: `${objectIdField} = ${objectId}`,
                    outFields: ['*'],
                    returnGeometry: true
                });
                
                if (queryResult.features.length > 0) {
                    // Use the properly queried feature which will have all ArcGIS API methods
                    mapView.popup.open({
                        features: queryResult.features,
                        location: getPopupLocation(feature.geometry)
                    });
                } else {
                    // Fallback if query fails
                    mapView.popup.open({
                        features: [{
                            geometry: feature.geometry,
                            attributes: feature.attributes
                        }],
                        location: getPopupLocation(feature.geometry)
                    });
                }
            } catch (error) {
                // Fallback to basic popup on any error
                mapView.popup.open({
                    features: [{
                        geometry: feature.geometry,
                        attributes: feature.attributes
                    }],
                    location: getPopupLocation(feature.geometry)
                });
            }
        }
        
        function enablePolygonDrawing() {
            clearPolygonSelection();
            
            if (!sketchViewModel) {
                try {
                    if (window.require) {
                        window.require(['esri/widgets/Sketch/SketchViewModel'], (SketchViewModel) => {
                            sketchViewModel = new SketchViewModel({
                                view: mapView,
                                layer: mapView.graphics,
                                polygonSymbol: {
                                    type: 'simple-fill',
                                    color: [255, 255, 0, 0.3],
                                    outline: {
                                        color: [255, 0, 0, 1],
                                        width: 2
                                    }
                                }
                            });
                            
                            sketchViewModel.on('create', (event) => {
                                if (event.state === 'complete') {
                                    polygonGraphic = event.graphic;
                                    selectFeaturesInPolygon(polygonGraphic.geometry);
                                    $("#clearPolygonBtn").disabled = false;
                                    $("#drawPolygonBtn").disabled = false;
                                }
                            });
                            
                            startPolygonDrawing();
                        });
                    } else {
                        updateStatus('Unable to load polygon drawing tools.');
                    }
                } catch (e) {
                    updateStatus('Polygon drawing not available.');
                }
            } else {
                startPolygonDrawing();
            }
            
            function startPolygonDrawing() {
                if (sketchViewModel) {
                    $("#drawPolygonBtn").disabled = true;
                    sketchViewModel.create('polygon');
                    updateStatus("Draw a polygon on the map. Double-click to finish.");
                }
            }
        }
        
        async function selectFeaturesInPolygon(polygon) {
            try {
                updateStatus("Selecting features within polygon...");
                selectedSlackloops = [];
                selectedFiberCables = [];
                
                // Get layers
                const allFL = mapView.map.allLayers.filter(l => l.type === "feature");
                const slackloopLayer = allFL.find(l => l.layerId === 41250);
                const fiberCableLayer = allFL.find(l => l.layerId === 41050);
                
                if (!slackloopLayer || !fiberCableLayer) {
                    throw new Error('Required layers not found (Slack Loop: 41250, Fiber Cable: 41050)');
                }
                
                await Promise.all([slackloopLayer.load(), fiberCableLayer.load()]);
                
                // Query slackloop features
                const slackloopQuery = await slackloopLayer.queryFeatures({
                    geometry: polygon,
                    spatialRelationship: 'intersects',
                    returnGeometry: true,
                    outFields: ['*']
                });
                
                selectedSlackloops = slackloopQuery.features.map(feature => ({
                    attributes: feature.attributes,
                    geometry: feature.geometry,
                    layer: slackloopLayer
                }));
                
                // Query fiber cable features
                const fiberCableQuery = await fiberCableLayer.queryFeatures({
                    geometry: polygon,
                    spatialRelationship: 'intersects',
                    returnGeometry: true,
                    outFields: ['*']
                });
                
                selectedFiberCables = fiberCableQuery.features.map(feature => ({
                    attributes: feature.attributes,
                    geometry: feature.geometry,
                    layer: fiberCableLayer
                }));
                
                // Display results
                let resultsHTML = `
                    <div style="padding:8px;background:#f8f9fa;border:1px solid #dee2e6;border-radius:3px;">
                        <strong>Selection Results:</strong><br>
                        Slack Loops: ${selectedSlackloops.length}<br>
                        Fiber Cables: ${selectedFiberCables.length}
                    </div>
                `;
                
                $("#selectionResults").innerHTML = resultsHTML;
                
                if (selectedSlackloops.length > 0 || selectedFiberCables.length > 0) {
                    $("#startEditingBtn").style.display = "block";
                    updateStatus(`Found ${selectedSlackloops.length} slack loops and ${selectedFiberCables.length} fiber cables.`);
                } else {
                    updateStatus("No features found in the selected area.");
                }
                
            } catch (error) {
                updateStatus("Error selecting features: " + error.message);
            }
        }
        
        function clearPolygonSelection() {
            if (polygonGraphic) {
                mapView.graphics.remove(polygonGraphic);
                polygonGraphic = null;
            }
            clearHighlight();
            $("#clearPolygonBtn").disabled = true;
            selectedSlackloops = [];
            selectedFiberCables = [];
            $("#selectionResults").innerHTML = "";
            $("#startEditingBtn").style.display = "none";
            updateStatus("Polygon selection cleared.");
        }
        
        function startSlackloopEditing() {
            if (selectedSlackloops.length === 0) {
                startFiberCablePhase();
                return;
            }
            
            currentSlackloopIndex = 0;
            setPhase('slackloop');
            
            setTimeout(() => {
                showCurrentSlackloop();
            }, 200);
        }
        
        function showCurrentSlackloop() {
            if (currentSlackloopIndex >= selectedSlackloops.length) {
                startFiberCablePhase();
                return;
            }
            
            const current = selectedSlackloops[currentSlackloopIndex];
            const objectIdField = getObjectIdField(current);
            const objectId = current.attributes[objectIdField];
            const gisId = current.attributes.gis_id || current.attributes.GIS_ID || objectId;
            
            // Update progress
            $("#slackloopProgress").innerHTML = `
                <strong>Progress:</strong> ${currentSlackloopIndex + 1} of ${selectedSlackloops.length} slack loops
            `;
            
            // Update info
            $("#slackloopInfo").innerHTML = `
                <strong>Current Slack Loop:</strong><br>
                GIS ID: ${gisId}<br>
                Object ID: ${objectId}<br>
                <span style="color:#28a745;font-weight:bold;">⚡ Currently highlighted on map</span>
            `;
            
            // Pre-fill current values
            $("#sequentialInInput").value = current.attributes.sequential_in || '';
            $("#sequentialOutInput").value = current.attributes.sequential_out || '';
            
            // Highlight feature with popup
            highlightFeature(current, [0, 255, 0, 0.8], true);
            
            updateStatus(`Editing slack loop ${currentSlackloopIndex + 1} of ${selectedSlackloops.length} - Feature highlighted on map`);
            
            // Focus on first input for better UX
            setTimeout(() => {
                $("#sequentialInInput").focus();
            }, 200);
        }
        
        async function submitSlackloop() {
            try {
                const current = selectedSlackloops[currentSlackloopIndex];
                const sequentialIn = $("#sequentialInInput").value;
                const sequentialOut = $("#sequentialOutInput").value;
                
                updateStatus("Updating slack loop...");
                
                const objectIdField = getObjectIdField(current);
                const objectId = current.attributes[objectIdField];
                
                // Create a conservative update that preserves existing attributes
                const updateAttributes = {
                    [objectIdField]: objectId
                };
                
                // Only add fields that have values or are being explicitly cleared
                if (sequentialIn !== '') {
                    updateAttributes.sequential_in = parseInt(sequentialIn);
                }
                if (sequentialOut !== '') {
                    updateAttributes.sequential_out = parseInt(sequentialOut);
                }
                
                const updateFeature = {
                    attributes: updateAttributes
                };
                
                // Apply the edit
                const result = await current.layer.applyEdits({
                    updateFeatures: [updateFeature]
                });
                
                if (result.updateFeatureResults && result.updateFeatureResults.length > 0) {
                    const updateResult = result.updateFeatureResults[0];
                    
                    // Check for success
                    const isSuccess = updateResult.success === true || 
                                    (updateResult.success === undefined && 
                                     updateResult.error === null && 
                                     (updateResult.objectId || updateResult.globalId));
                    
                    if (isSuccess) {
                        updateStatus("Slack loop updated successfully!");
                        
                        // Move to next
                        currentSlackloopIndex++;
                        setTimeout(() => {
                            showCurrentSlackloop();
                        }, 500);
                    } else {
                        // Enhanced error details
                        let errorMessage = "Unknown error";
                        if (updateResult.error && updateResult.error.message) {
                            errorMessage = updateResult.error.message;
                        } else if (updateResult.error) {
                            errorMessage = JSON.stringify(updateResult.error);
                        }
                        
                        throw new Error(`Update failed: ${errorMessage}`);
                    }
                } else {
                    throw new Error('No update results returned from server');
                }
                
            } catch (error) {
                updateStatus("Error updating slack loop: " + error.message);
                alert("Error updating slack loop: " + error.message);
            }
        }
        
        function skipSlackloop() {
            currentSlackloopIndex++;
            showCurrentSlackloop();
        }
        
        function startFiberCablePhase() {
            if (selectedFiberCables.length === 0) {
                setPhase('complete');
                return;
            }
            
            currentFiberCableIndex = 0;
            setPhase('fiber_cable');
            showCurrentFiberCable();
        }
        
        function showCurrentFiberCable() {
            if (currentFiberCableIndex >= selectedFiberCables.length) {
                setPhase('complete');
                return;
            }
            
            const current = selectedFiberCables[currentFiberCableIndex];
            const objectIdField = getObjectIdField(current);
            const objectId = current.attributes[objectIdField];
            const gisId = current.attributes.gis_id || current.attributes.GIS_ID || objectId;
            const globalId = current.attributes.globalid || current.attributes.GlobalID || current.attributes.GLOBALID;
            
            // Update progress
            $("#fiberCableProgress").innerHTML = `
                <strong>Progress:</strong> ${currentFiberCableIndex + 1} of ${selectedFiberCables.length} fiber cables
            `;
            
            // Update info
            $("#fiberCableInfo").innerHTML = `
                <strong>Current Fiber Cable:</strong><br>
                GIS ID: ${gisId}<br>
                Object ID: ${objectId}<br>
                Global ID: ${globalId}
            `;
            
            // Generate daily tracking link
           // With this:
generateDailyTrackingLink(current).then(link => {
    $("#dailyTrackingLink").innerHTML = `
        <strong>Daily Tracking Link:</strong><br>
        <div style="word-break:break-all;font-size:10px;margin-top:4px;padding:4px;background:#fff;border:1px solid #ddd;">
            <a href="${link}" target="_blank" style="color:#007bff;">${link}</a>
        </div>
    `;
    
    // Store link for open button
    $("#openLinkBtn").onclick = () => window.open(link, '_blank');
}).catch(error => {
    console.error('Error generating daily tracking link:', error);
    $("#dailyTrackingLink").innerHTML = `<div style="color:red;">Error generating link: ${error.message}</div>`;
});
            
            // Highlight feature
            highlightFeature(current, [255, 0, 255, 0.8]);
            
            updateStatus(`Viewing fiber cable ${currentFiberCableIndex + 1} of ${selectedFiberCables.length}`);
        }
        
        async function generateDailyTrackingLink(fiberCableFeature) {
    const baseUrl = 'https://dycom.outsystemsenterprise.com/ECCGISHub/DailyTracking?';
    
    // Get globalid - ensure it's properly formatted with braces
    let globalId = fiberCableFeature.attributes.globalid || 
                   fiberCableFeature.attributes.GlobalID || 
                   fiberCableFeature.attributes.GLOBALID;
    
    // Ensure globalid has proper GUID format with braces
    if (globalId && !globalId.startsWith('{')) {
        globalId = `{${globalId}}`;
    }
    if (globalId && !globalId.endsWith('}')) {
        globalId = `${globalId}}`;
    }
    
    // Get featureclass_type
    const featureclassType = fiberCableFeature.attributes.featureclass_type || 
                           fiberCableFeature.attributes.FeatureClass_Type ||
                           fiberCableFeature.attributes.FEATURECLASS_TYPE ||
                           'fiber_cable';
    
    console.log('Feature class type:', featureclassType);
    console.log('Fiber cable globalid:', globalId);
    
    // Now we need to query the related daily tracking table to get the rel_fiber_cable_guid
    let rfgValue = '';
    
    try {
        // Find the daily tracking layer with layer ID 90100
        const allFL = mapView.map.allLayers.filter(l => l.type === "feature");
        const dailyTrackingLayer = allFL.find(l => l.layerId === 90100);
        
        if (dailyTrackingLayer) {
            await dailyTrackingLayer.load();
            console.log('Found daily tracking layer:', dailyTrackingLayer.title);
            
            // Query the daily tracking table for records where rel_fiber_cable_guid matches the fiber cable's globalid
            // Remove the braces from globalid for the query
            const fiberGlobalIdForQuery = globalId.replace(/[{}]/g, '');
            
            const relatedQuery = await dailyTrackingLayer.queryFeatures({
                where: `rel_fiber_cable_guid = '${fiberGlobalIdForQuery}'`,
                outFields: ['*'],
                returnGeometry: false
            });
            
            console.log(`Querying daily tracking with: rel_fiber_cable_guid = '${fiberGlobalIdForQuery}'`);
            console.log('Found related records:', relatedQuery.features.length);
            
            if (relatedQuery.features.length > 0) {
                const relatedFeature = relatedQuery.features[0];
                console.log('Related record attributes:', Object.keys(relatedFeature.attributes));
                
                // The rfg value should be the globalid of the related daily tracking record
                rfgValue = relatedFeature.attributes.globalid || 
                          relatedFeature.attributes.GlobalID || 
                          relatedFeature.attributes.GLOBALID;
                
                console.log('Found RFG value from daily tracking record globalid:', rfgValue);
            } else {
                console.log('No related records found in daily tracking table for globalid:', fiberGlobalIdForQuery);
                
                // Try alternative query in case the field stores GUIDs with braces
                const alternativeQuery = await dailyTrackingLayer.queryFeatures({
                    where: `rel_fiber_cable_guid = '${globalId}'`,
                    outFields: ['*'],
                    returnGeometry: false
                });
                
                console.log('Alternative query with braces found:', alternativeQuery.features.length);
                
                if (alternativeQuery.features.length > 0) {
                    const relatedFeature = alternativeQuery.features[0];
                    rfgValue = relatedFeature.attributes.globalid || 
                              relatedFeature.attributes.GlobalID || 
                              relatedFeature.attributes.GLOBALID;
                    console.log('Found RFG value from alternative query:', rfgValue);
                }
            }
        } else {
            console.log('Daily tracking layer (90100) not found');
            console.log('Available layers:', allFL.map(l => `${l.layerId}: ${l.title}`));
        }
        
    } catch (error) {
        console.log('Error querying related table:', error);
    }
    
    // Ensure rfgValue has proper GUID format with braces
    if (rfgValue && !rfgValue.startsWith('{')) {
        rfgValue = `{${rfgValue}}`;
    }
    if (rfgValue && !rfgValue.endsWith('}')) {
        rfgValue = `${rfgValue}}`;
    }
    
    // Get service URL and fix the encoding issue
    let serviceLayerUrl = '';
    if (fiberCableFeature.layer && fiberCableFeature.layer.url) {
        serviceLayerUrl = fiberCableFeature.layer.url;
        
        // The working URL uses layer 90100, but your code shows 41050
        // We need to determine the correct layer ID for the Daily Tracking system
        // Based on the working example, it might be a different layer ID than what's in the feature layer
        
        // Check if the URL already ends with a layer ID (number)
        const urlParts = serviceLayerUrl.split('/');
        const lastPart = urlParts[urlParts.length - 1];
        
        // Replace the current layer ID with the one used in the working URL
        if (!isNaN(parseInt(lastPart))) {
            // Remove the current layer ID and replace with 90100
            urlParts[urlParts.length - 1] = '90100';
            serviceLayerUrl = urlParts.join('/');
        } else {
            // Add the layer ID if it's missing
            serviceLayerUrl = `${serviceLayerUrl}/90100`;
        }
    }
    
    // Build parameters in the same order as the working example
    const dtg = `dtg=${globalId}`;
    const rfg = `rfg=${rfgValue}`;
    // DON'T encode the service URL - the working URL doesn't have encoding
    const serviceUrl = `serviceUrl=${serviceLayerUrl}`;
    
    // Construct final URL matching the working pattern exactly
    const finalUrl = `${baseUrl}${dtg}&${rfg}&${serviceUrl}`;
    
    // Debug logging to help troubleshoot
    console.log('Link Generation Debug Info:');
    console.log('Global ID:', globalId);
    console.log('Feature Class Type:', featureclassType);
    console.log('RFG Value:', rfgValue);
    console.log('Service Layer URL:', serviceLayerUrl);
    console.log('Generated URL:', finalUrl);
    
    return finalUrl;
}
        
        function clearAllHighlights() {
            // Clear current highlight
            clearHighlight();
            
            // Clear polygon selection
            clearPolygonSelection();
            
            // Close any open popup
            if (mapView.popup) {
                mapView.popup.close();
            }
            
            updateStatus("All highlights cleared.");
        }
        
        function nextFiberCable() {
            currentFiberCableIndex++;
            showCurrentFiberCable();
        }
        
        function startOver() {
            currentSlackloopIndex = 0;
            currentFiberCableIndex = 0;
            selectedSlackloops = [];
            selectedFiberCables = [];
            clearPolygonSelection();
            setPhase('selection');
            updateStatus("Ready to start over. Draw a polygon to select features.");
        }
        
        // Tool cleanup function
        function cleanup() {
            if (sketchViewModel) {
                sketchViewModel.destroy();
                sketchViewModel = null;
            }
            
            clearHighlight();
            
            if (polygonGraphic) {
                mapView.graphics.remove(polygonGraphic);
            }
            
            toolBox.remove();
        }
        
        // Event listeners
        $("#drawPolygonBtn").onclick = enablePolygonDrawing;
        $("#clearPolygonBtn").onclick = clearPolygonSelection;
        $("#startEditingBtn").onclick = () => {
            // Clear any existing highlights first
            clearHighlight();
            
            // Start the editing process
            startSlackloopEditing();
        };
        $("#clearHighlightsBtn").onclick = clearAllHighlights;
        $("#clearHighlightsBtn2").onclick = clearAllHighlights;
        $("#clearHighlightsBtn3").onclick = clearAllHighlights;
        $("#clearHighlightsBtn4").onclick = clearAllHighlights;
        
        $("#submitSlackloopBtn").onclick = submitSlackloop;
        $("#skipSlackloopBtn").onclick = skipSlackloop;
        
        $("#nextFiberCableBtn").onclick = nextFiberCable;
        
        $("#startOverBtn").onclick = startOver;
        
        $("#closeTool").onclick = () => {
            window.gisToolHost.closeTool('sequential-editor');
        };
        
        // Allow Enter key to submit slackloop
        $("#sequentialInInput").addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                $("#sequentialOutInput").focus();
            }
        });
        
        $("#sequentialOutInput").addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                submitSlackloop();
            }
        });
        
        // Initialize
        setPhase('selection');
        updateStatus("Ready. Click 'Draw Selection Polygon' to start selecting features.");
        
        // Register tool with host
        window.gisToolHost.activeTools.set('sequential-editor', {
            cleanup: cleanup,
            toolBox: toolBox
        });
        
    } catch (error) {
        alert("Error creating Sequential Editor Tool: " + (error.message || error));
    }
})();
