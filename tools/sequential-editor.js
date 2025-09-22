// tools/sequential-editor.js - Sequential Feature Editor with Polygon Selection
// Allows editing slackloop sequential fields and generating daily tracking links for fiber cables

(function() {
    try {
        // Check if tool is already active
        if (window.gisToolHost.activeTools.has('sequential-editor')) {
            console.log('Sequential Editor Tool already active');
            return;
        }
        
        // Remove any leftover toolbox
        const existingToolbox = document.getElementById('sequentialEditorToolbox');
        if (existingToolbox) {
            existingToolbox.remove();
            console.log('Removed leftover sequential editor toolbox');
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
            </div>
            
            <!-- Complete Phase -->
            <div id="completePhase" style="display:none;">
                <div style="font-weight:bold;margin-bottom:8px;color:#28a745;">✅ Editing Complete!</div>
                <div style="margin-bottom:12px;color:#666;">All features have been processed.</div>
                <button id="startOverBtn" style="width:100%;padding:6px 12px;background:#28a745;color:white;border:none;border-radius:3px;cursor:pointer;">Start Over</button>
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
                // Also remove pulse graphic if it exists
                if (currentHighlight.pulseGraphic) {
                    mapView.graphics.remove(currentHighlight.pulseGraphic);
                }
                currentHighlight = null;
            }
        }
        
        function getObjectIdField(feature) {
            console.log('getObjectIdField called with feature:', feature);
            
            // Robust validation as suggested
            if (!feature) {
                console.error('Feature is null or undefined');
                return null;
            }
            
            if (!feature.attributes) {
                console.error('Feature missing attributes property:', feature);
                return null;
            }
            
            console.log('Feature attributes keys:', Object.keys(feature.attributes));
            
            // Simplified object ID field detection for your system
            let objectIdField = null;
            
            // Check for your system's standard "objectid" field first
            if (feature.attributes.objectid !== undefined) {
                objectIdField = 'objectid';
            } else if (feature.layer && feature.layer.objectIdField) {
                // Use layer's declared objectIdField as backup
                objectIdField = feature.layer.objectIdField;
            } else {
                // Check for other common variations as fallback
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
                    // Final fallback to gis_id
                    objectIdField = 'gis_id';
                }
            }
            
            console.log('Determined object ID field:', objectIdField, 'Value:', objectIdField ? feature.attributes[objectIdField] : 'N/A');
            return objectIdField;
        }
        
        function highlightFeature(feature, color = [255, 255, 0, 0.8]) {
            try {
                console.log('highlightFeature called with:', feature, color);
                
                // Validate feature structure
                if (!feature) {
                    console.error('No feature provided to highlightFeature');
                    return;
                }
                
                if (!feature.geometry) {
                    console.error('Feature missing geometry:', feature);
                    return;
                }
                
                if (!feature.attributes) {
                    console.error('Feature missing attributes:', feature);
                    return;
                }
                
                clearHighlight();
                
                console.log('Feature geometry type:', feature.geometry.type);
                
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
                
                console.log('Created symbol:', symbol);
                
                currentHighlight = {
                    geometry: feature.geometry,
                    symbol: symbol
                };
                
                console.log('Adding highlight graphic to map');
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
                
                console.log('Adding pulse graphic to map');
                mapView.graphics.add(pulseGraphic);
                
                // Store both graphics for cleanup
                currentHighlight.pulseGraphic = pulseGraphic;
                
                console.log('Zooming to feature');
                // Zoom to feature with padding
                mapView.goTo({
                    target: feature.geometry,
                    scale: Math.min(mapView.scale, 2000) // Don't zoom out if already closer
                }, {duration: 800}).then(() => {
                    console.log('Zoom completed');
                }).catch(err => {
                    console.error('Zoom failed:', err);
                });
                
                console.log('Highlighting completed successfully');
            } catch (error) {
                console.error('Error in highlightFeature:', error);
                updateStatus('Error highlighting feature: ' + error.message);
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
                    console.error('Error loading SketchViewModel:', e);
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
                
                console.log('Raw slackloop query results:', slackloopQuery.features);
                
                selectedSlackloops = slackloopQuery.features.map(feature => {
                    console.log('Processing slackloop feature:', feature);
                    console.log('Feature attributes:', feature.attributes);
                    console.log('Feature geometry:', feature.geometry);
                    
                    return {
                        attributes: feature.attributes,
                        geometry: feature.geometry,
                        layer: slackloopLayer
                    };
                });
                
                console.log('Processed selectedSlackloops:', selectedSlackloops);
                
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
                console.error("Selection error:", error);
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
            console.log('Starting slackloop editing...');
            console.log('Selected slackloops:', selectedSlackloops);
            
            if (selectedSlackloops.length === 0) {
                console.log('No slackloops, moving to fiber cable phase');
                startFiberCablePhase();
                return;
            }
            
            currentSlackloopIndex = 0;
            console.log('Setting phase to slackloop');
            setPhase('slackloop');
            
            // Don't highlight immediately - wait for showCurrentSlackloop to handle it properly
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
            
            console.log(`Showing slackloop ${currentSlackloopIndex + 1}:`, {
                objectIdField,
                objectId,
                gisId,
                geometry: current.geometry,
                allAttributes: Object.keys(current.attributes)
            });
            
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
            
            // Highlight feature - ensure this happens
            console.log('Highlighting slackloop feature...');
            highlightFeature(current, [0, 255, 0, 0.8]);
            
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
                
                console.log('Submitting slackloop update:', {
                    objectIdField,
                    objectId,
                    sequentialIn,
                    sequentialOut,
                    layer: current.layer
                });
                
                // Create a more conservative update that preserves existing attributes
                // Only include the objectId and the fields we want to change
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
                
                console.log('Conservative update feature object:', updateFeature);
                console.log('Current feature attributes for reference:', current.attributes);
                
                // Check if layer supports editing
                if (current.layer.capabilities && current.layer.capabilities.operations) {
                    console.log('Layer editing capabilities:', current.layer.capabilities.operations);
                } else {
                    console.log('Layer capabilities not available or unclear');
                }
                
                // Apply the edit
                const result = await current.layer.applyEdits({
                    updateFeatures: [updateFeature]
                });
                
                console.log('Full applyEdits result:', result);
                
                if (result.updateFeatureResults && result.updateFeatureResults.length > 0) {
                    const updateResult = result.updateFeatureResults[0];
                    console.log('Update result details:', updateResult);
                    
                    // Check for success in multiple ways
                    const isSuccess = updateResult.success === true || 
                                    (updateResult.success === undefined && 
                                     updateResult.error === null && 
                                     (updateResult.objectId || updateResult.globalId));
                    
                    if (isSuccess) {
                        updateStatus("Slack loop updated successfully!");
                        console.log('Update successful! ObjectId:', updateResult.objectId, 'GlobalId:', updateResult.globalId);
                        
                        // Move to next
                        currentSlackloopIndex++;
                        setTimeout(() => {
                            showCurrentSlackloop();
                        }, 500);
                    } else {
                        // Enhanced error details
                        let errorMessage = "Unknown error";
                        let errorCode = null;
                        
                        if (updateResult.error) {
                            if (updateResult.error.message) {
                                errorMessage = updateResult.error.message;
                            } else if (updateResult.error.description) {
                                errorMessage = updateResult.error.description;
                            } else if (typeof updateResult.error === 'string') {
                                errorMessage = updateResult.error;
                            } else {
                                errorMessage = JSON.stringify(updateResult.error);
                            }
                            
                            if (updateResult.error.code) {
                                errorCode = updateResult.error.code;
                            }
                        }
                        
                        console.error('Update failed with details:', {
                            success: updateResult.success,
                            error: updateResult.error,
                            objectId: updateResult.objectId,
                            globalId: updateResult.globalId,
                            errorCode: errorCode
                        });
                        
                        const fullErrorMsg = errorCode ? 
                            `${errorMessage} (Code: ${errorCode})` : 
                            errorMessage;
                            
                        throw new Error(`Update failed: ${fullErrorMsg}`);
                    }
                } else {
                    console.error('No updateFeatureResults returned:', result);
                    throw new Error('No update results returned from server');
                }
                
            } catch (error) {
                console.error("Update error details:", {
                    error: error,
                    message: error.message,
                    stack: error.stack
                });
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
            
            // Generate daily tracking link using the arcade expression logic
            const link = generateDailyTrackingLink(current);
            
            $("#dailyTrackingLink").innerHTML = `
                <strong>Daily Tracking Link:</strong><br>
                <div style="word-break:break-all;font-size:10px;margin-top:4px;padding:4px;background:#fff;border:1px solid #ddd;">
                    <a href="${link}" target="_blank" style="color:#007bff;">${link}</a>
                </div>
            `;
            
            // Store link for open button
            $("#openLinkBtn").onclick = () => window.open(link, '_blank');
            
            // Highlight feature
            highlightFeature(current, [255, 0, 255, 0.8]);
            
            updateStatus(`Viewing fiber cable ${currentFiberCableIndex + 1} of ${selectedFiberCables.length}`);
        }
        
        function generateDailyTrackingLink(fiberCableFeature) {
            // Implementing the arcade expression logic with better field handling:
            // var baseUrl = 'https://dycom.outsystemsenterprise.com/ECCGISHub/DailyTracking?'
            // var serviceUrl = 'serviceUrl=' + GetFeatureSetInfo($layer).ServiceLayerUrl  
            // var dtg = 'dtg=' + $feature.globalid
            // var rfg = 'rfg=' + $feature[Lower('rel_' + $feature.featureclass_type + '_guid')]  
            // return baseUrl + dtg + "&" + rfg + "&" + serviceUrl
            
            const baseUrl = 'https://dycom.outsystemsenterprise.com/ECCGISHub/DailyTracking?';
            const globalId = fiberCableFeature.attributes.globalid || 
                            fiberCableFeature.attributes.GlobalID || 
                            fiberCableFeature.attributes.GLOBALID;
            
            // Get featureclass_type, with fallback options
            const featureclassType = fiberCableFeature.attributes.featureclass_type || 
                                   fiberCableFeature.attributes.FeatureClass_Type ||
                                   fiberCableFeature.attributes.FEATURECLASS_TYPE ||
                                   'fiber_cable'; // fallback
            
            // Get service URL from layer - with better URL construction
            let serviceLayerUrl = '';
            if (fiberCableFeature.layer && fiberCableFeature.layer.url) {
                serviceLayerUrl = fiberCableFeature.layer.url;
            } else if (mapView.map.portalItem && mapView.map.portalItem.portal) {
                serviceLayerUrl = mapView.map.portalItem.portal.url + '/rest/services/';
            }
            
            // Build the related GUID field name (rel_ + featureclass_type + _guid)
            const relGuidFieldName = `rel_${featureclassType.toLowerCase()}_guid`;
            let rfgValue = fiberCableFeature.attributes[relGuidFieldName] || '';
            
            // If the exact field isn't found, try some variations
            if (!rfgValue) {
                const possibleFields = [
                    `rel_${featureclassType}_guid`,
                    `REL_${featureclassType.toUpperCase()}_GUID`,
                    `Rel_${featureclassType}_Guid`,
                    'rel_fiber_cable_guid',
                    'REL_FIBER_CABLE_GUID'
                ];
                
                for (const fieldName of possibleFields) {
                    if (fiberCableFeature.attributes[fieldName]) {
                        rfgValue = fiberCableFeature.attributes[fieldName];
                        console.log(`Found related GUID in field: ${fieldName}`);
                        break;
                    }
                }
            }
            
            // Build parameters
            const serviceUrl = `serviceUrl=${encodeURIComponent(serviceLayerUrl)}`;
            const dtg = `dtg=${globalId}`;
            const rfg = `rfg=${rfgValue}`;
            
            const finalUrl = `${baseUrl}${dtg}&${rfg}&${serviceUrl}`;
            
            console.log('Generated OutSystems link:', {
                globalId,
                featureclassType,
                relGuidFieldName,
                rfgValue,
                serviceLayerUrl,
                finalUrl
            });
            
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
            console.log('Sequential Editor Tool cleaned up');
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
        
        console.log('Sequential Editor Tool loaded successfully');
        
    } catch (error) {
        console.error('Error loading Sequential Editor Tool:', error);
        alert("Error creating Sequential Editor Tool: " + (error.message || error));
    }
})();
