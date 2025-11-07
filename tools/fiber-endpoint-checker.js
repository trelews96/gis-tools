// tools/fiber-endpoint-checker.js
// Fiber Endpoint Snapping Checker - Identifies unsnapped fiber cable endpoints

(function() {
    try {
        // Initialize tool host system if it doesn't exist
        if (!window.gisToolHost) {
            window.gisToolHost = {};
        }
        
        // Ensure activeTools is always a proper Set
        if (!window.gisToolHost.activeTools || !(window.gisToolHost.activeTools instanceof Set)) {
            console.warn('Creating new Set for activeTools');
            window.gisToolHost.activeTools = new Set();
        }
        
        // Check for existing tool
        if (window.gisToolHost.activeTools.has('fiber-endpoint-checker')) {
            console.log('Fiber Endpoint Checker Tool already active');
            return;
        }
        
        const existingToolbox = document.getElementById('fiberEndpointCheckerToolbox');
        if (existingToolbox) {
            existingToolbox.remove();
            console.log('Removed leftover fiber endpoint checker toolbox');
        }
        
        // Get map view with fallback methods
        function getMapView() {
            // Try shared utils first
            if (window.gisSharedUtils && window.gisSharedUtils.getMapView) {
                const mv = window.gisSharedUtils.getMapView();
                if (mv) return mv;
            }
            
            // Fallback to searching window objects
            const mapView = Object.values(window).find(obj => 
                obj && 
                obj.constructor && 
                obj.constructor.name === "MapView" &&
                obj.map &&
                obj.center
            );
            
            if (mapView) return mapView;
            
            // Additional fallback for common variable names
            if (window.view && window.view.map) return window.view;
            if (window.mapView && window.mapView.map) return window.mapView;
            
            throw new Error('MapView not found');
        }
        
        const mapView = getMapView();
        
        // Layer configuration
        const FIBER_LAYER_ID = 41050;
        const POINT_LAYERS = [
            { id: 42100, name: "Vault" },
            { id: 41150, name: "Splice Closure" },
            { id: 41100, name: "Fiber Equipment" }
        ];
        
        // Tolerance in map units (meters for Web Mercator)
        const SNAP_TOLERANCE = 3; // 3 meters
        
        let unsnappedEndpoints = [];
        let currentIndex = 0;
        let highlightHandle = null;
        
        // Create toolbox UI
        const toolBox = document.createElement("div");
        toolBox.id = "fiberEndpointCheckerToolbox";
        toolBox.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 99999;
            background: #fff;
            border: 1px solid #333;
            padding: 10px;
            width: 550px;
            max-height: 85vh;
            overflow-y: auto;
            font: 12px/1.3 Arial, sans-serif;
            box-shadow: 0 4px 16px rgba(0,0,0,.2);
            border-radius: 4px;
        `;
        
        toolBox.innerHTML = `
            <div id="toolboxHeader" style="font-weight:bold;margin-bottom:8px;font-size:13px;cursor:move;padding:4px;margin:-10px -10px 8px -10px;background:#f0f0f0;border-bottom:1px solid #ccc;border-radius:4px 4px 0 0;">
                🔍 Fiber Endpoint Checker
                <span style="float:right;font-size:11px;color:#666;font-weight:normal;">📌 Drag to move</span>
            </div>
            
            <div style="margin-bottom:10px;color:#666;font-size:11px;">
                Identifies fiber cable endpoints that are not snapped to point features or other fiber endpoints.
            </div>
            
            <div style="margin-bottom:10px;">
                <label style="font-size:11px;">Purchase Order ID:</label>
                <select id="purchaseOrderSelect" style="width:100%;margin-top:2px;padding:4px;font-size:11px;">
                    <option value="">Loading...</option>
                </select>
            </div>
            
            <div style="margin-bottom:10px;">
                <label style="font-size:11px;">Work Order ID:</label>
                <select id="workOrderSelect" style="width:100%;margin-top:2px;padding:4px;font-size:11px;">
                    <option value="">Loading...</option>
                </select>
            </div>
            
            <div style="display:flex;gap:6px;margin-bottom:10px;">
                <label style="flex:1;font-size:11px;">
                    Snap Tolerance (meters):
                    <input id="toleranceInput" type="number" value="3" min="0.5" max="20" step="0.5" 
                           style="width:100%;margin-top:2px;padding:4px;font-size:11px;">
                </label>
            </div>
            
            <div style="display:flex;gap:6px;margin-bottom:10px;">
                <button id="runCheckBtn" style="flex:1;padding:6px 10px;background:#3367d6;color:white;border:none;border-radius:3px;cursor:pointer;font-size:11px;">
                    Run Check
                </button>
                <button id="exportBtn" style="flex:1;padding:6px 10px;background:#28a745;color:white;border:none;border-radius:3px;cursor:pointer;font-size:11px;display:none;">
                    Export CSV
                </button>
                <button id="closeToolBtn" style="flex:1;padding:6px 10px;background:#d32f2f;color:white;border:none;border-radius:3px;cursor:pointer;font-size:11px;">
                    Close
                </button>
            </div>
            
            <div id="toolStatus" style="margin-bottom:8px;padding:6px;background:#f0f0f0;border-radius:3px;font-size:11px;min-height:20px;">
                Ready. Click "Run Check" to start.
            </div>
            
            <div id="summarySection" style="display:none;margin-bottom:10px;padding:8px;background:#fff3cd;border:1px solid #ffc107;border-radius:3px;font-size:11px;">
                <div style="font-weight:bold;margin-bottom:4px;">Summary:</div>
                <div id="summaryText"></div>
            </div>
            
            <div id="navigationSection" style="display:none;margin-bottom:10px;">
                <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
                    <button id="prevBtn" style="padding:4px 12px;background:#666;color:white;border:none;border-radius:3px;cursor:pointer;font-size:11px;">
                        ← Previous
                    </button>
                    <div id="counterText" style="flex:1;text-align:center;font-weight:bold;font-size:11px;">
                        1 / 0
                    </div>
                    <button id="nextBtn" style="padding:4px 12px;background:#666;color:white;border:none;border-radius:3px;cursor:pointer;font-size:11px;">
                        Next →
                    </button>
                </div>
                <div id="currentFeatureInfo" style="padding:6px;background:#f8f9fa;border:1px solid #ddd;border-radius:3px;font-size:10px;">
                </div>
            </div>
            
            <div id="resultsSection" style="display:none;">
                <div style="font-weight:bold;margin-bottom:6px;font-size:11px;">Unsnapped Endpoints:</div>
                <div id="resultsTable" style="max-height:400px;overflow-y:auto;"></div>
            </div>
        `;
        
        document.body.appendChild(toolBox);
        
        // Make toolbox draggable
        const toolboxHeader = document.getElementById('toolboxHeader');
        let isDragging = false;
        let currentX;
        let currentY;
        let initialX;
        let initialY;
        let xOffset = 0;
        let yOffset = 0;
        
        toolboxHeader.addEventListener('mousedown', dragStart);
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', dragEnd);
        
        function dragStart(e) {
            initialX = e.clientX - xOffset;
            initialY = e.clientY - yOffset;
            
            if (e.target === toolboxHeader || toolboxHeader.contains(e.target)) {
                isDragging = true;
                toolBox.style.cursor = 'move';
            }
        }
        
        function drag(e) {
            if (isDragging) {
                e.preventDefault();
                
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;
                
                xOffset = currentX;
                yOffset = currentY;
                
                // Keep toolbox within viewport bounds
                const rect = toolBox.getBoundingClientRect();
                const maxX = window.innerWidth - rect.width;
                const maxY = window.innerHeight - rect.height;
                
                const finalX = Math.min(Math.max(0, currentX), maxX);
                const finalY = Math.min(Math.max(0, currentY), maxY);
                
                toolBox.style.top = finalY + 'px';
                toolBox.style.left = finalX + 'px';
                toolBox.style.right = 'auto';
            }
        }
        
        function dragEnd(e) {
            if (isDragging) {
                initialX = currentX;
                initialY = currentY;
                isDragging = false;
                toolBox.style.cursor = 'default';
            }
        }
        
        // UI element references
        const $ = (id) => toolBox.querySelector(id);
        const purchaseOrderSelect = $("#purchaseOrderSelect");
        const workOrderSelect = $("#workOrderSelect");
        const toleranceInput = $("#toleranceInput");
        const runCheckBtn = $("#runCheckBtn");
        const exportBtn = $("#exportBtn");
        const closeToolBtn = $("#closeToolBtn");
        const toolStatus = $("#toolStatus");
        const summarySection = $("#summarySection");
        const summaryText = $("#summaryText");
        const navigationSection = $("#navigationSection");
        const prevBtn = $("#prevBtn");
        const nextBtn = $("#nextBtn");
        const counterText = $("#counterText");
        const currentFeatureInfo = $("#currentFeatureInfo");
        const resultsSection = $("#resultsSection");
        const resultsTable = $("#resultsTable");
        
        function updateStatus(message, type = 'info') {
            toolStatus.textContent = message;
            toolStatus.style.background = type === 'error' ? '#ffebee' : 
                                         type === 'success' ? '#e8f5e9' : 
                                         type === 'warning' ? '#fff3cd' : '#f0f0f0';
            toolStatus.style.color = type === 'error' ? '#c62828' : 
                                    type === 'success' ? '#2e7d32' : 
                                    type === 'warning' ? '#856404' : '#333';
        }
        
        function calculateDistance(point1, point2) {
            const dx = point1.x - point2.x;
            const dy = point1.y - point2.y;
            return Math.sqrt(dx * dx + dy * dy);
        }
        
        async function loadPurchaseOrders() {
            try {
                updateStatus("Loading purchase orders...");
                
                const fiberLayer = mapView.map.allLayers.find(l => l.layerId === FIBER_LAYER_ID);
                if (!fiberLayer) {
                    purchaseOrderSelect.innerHTML = '<option value="">All Purchase Orders</option><option value="" disabled>Fiber layer not found</option>';
                    return;
                }
                
                await fiberLayer.load();
                
                const result = await fiberLayer.queryFeatures({
                    where: "purchase_order_id IS NOT NULL AND purchase_order_id <> ''",
                    outFields: ["purchase_order_id"],
                    returnGeometry: false,
                    returnDistinctValues: true
                });
                
                const uniqueValues = [];
                const seenValues = {};
                
                for (const feature of result.features) {
                    const value = feature.attributes.purchase_order_id;
                    if (value && value.toString().trim() && !seenValues[value]) {
                        uniqueValues.push(value);
                        seenValues[value] = true;
                    }
                }
                
                uniqueValues.sort();
                
                purchaseOrderSelect.innerHTML = '<option value="">All Purchase Orders</option>';
                for (const value of uniqueValues) {
                    const option = document.createElement("option");
                    option.value = value;
                    option.textContent = value;
                    purchaseOrderSelect.appendChild(option);
                }
                
                console.log(`Loaded ${uniqueValues.length} purchase orders`);
            } catch (error) {
                console.error("Error loading purchase orders:", error);
                purchaseOrderSelect.innerHTML = '<option value="">All Purchase Orders</option><option value="" disabled>Error loading</option>';
            }
        }
        
        async function loadWorkOrders() {
            try {
                updateStatus("Loading work orders...");
                
                const fiberLayer = mapView.map.allLayers.find(l => l.layerId === FIBER_LAYER_ID);
                if (!fiberLayer) {
                    workOrderSelect.innerHTML = '<option value="">All Work Orders</option><option value="" disabled>Fiber layer not found</option>';
                    return;
                }
                
                await fiberLayer.load();
                
                const result = await fiberLayer.queryFeatures({
                    where: "workorder_id IS NOT NULL AND workorder_id <> ''",
                    outFields: ["workorder_id"],
                    returnGeometry: false,
                    returnDistinctValues: true
                });
                
                const uniqueValues = [];
                const seenValues = {};
                
                for (const feature of result.features) {
                    const value = feature.attributes.workorder_id;
                    if (value && value.toString().trim() && !seenValues[value]) {
                        uniqueValues.push(value);
                        seenValues[value] = true;
                    }
                }
                
                uniqueValues.sort();
                
                workOrderSelect.innerHTML = '<option value="">All Work Orders</option>';
                for (const value of uniqueValues) {
                    const option = document.createElement("option");
                    option.value = value;
                    option.textContent = value;
                    workOrderSelect.appendChild(option);
                }
                
                console.log(`Loaded ${uniqueValues.length} work orders`);
                updateStatus("Ready. Select filters and click 'Run Check' to start.");
            } catch (error) {
                console.error("Error loading work orders:", error);
                workOrderSelect.innerHTML = '<option value="">All Work Orders</option><option value="" disabled>Error loading</option>';
            }
        }
        
        function calculateDistance(point1, point2) {
            const dx = point1.x - point2.x;
            const dy = point1.y - point2.y;
            return Math.sqrt(dx * dx + dy * dy);
        }
        
        async function checkFiberEndpoints() {
            try {
                updateStatus("Loading fiber layer...");
                unsnappedEndpoints = [];
                currentIndex = 0;
                
                const tolerance = parseFloat(toleranceInput.value) || 3;
                const selectedPurchaseOrder = purchaseOrderSelect.value;
                const selectedWorkOrder = workOrderSelect.value;
                
                // Build where clause based on filters
                let whereClause = "1=1";
                const filters = [];
                
                if (selectedPurchaseOrder) {
                    filters.push(`purchase_order_id = '${selectedPurchaseOrder}'`);
                }
                
                if (selectedWorkOrder) {
                    filters.push(`workorder_id = '${selectedWorkOrder}'`);
                }
                
                if (filters.length > 0) {
                    whereClause = filters.join(" AND ");
                }
                
                // Get fiber layer
                const fiberLayer = mapView.map.allLayers.find(l => l.layerId === FIBER_LAYER_ID);
                if (!fiberLayer) {
                    updateStatus("Error: Fiber Cable layer not found (layerId " + FIBER_LAYER_ID + ")", 'error');
                    return;
                }
                
                await fiberLayer.load();
                
                // Get point layers
                updateStatus("Loading point layers...");
                const pointLayers = [];
                for (const config of POINT_LAYERS) {
                    const layer = mapView.map.allLayers.find(l => l.layerId === config.id);
                    if (layer && layer.visible) {
                        await layer.load();
                        pointLayers.push({ layer, config });
                    }
                }
                
                // Query fiber features with filters
                updateStatus("Querying fiber features" + (filters.length > 0 ? " (filtered)..." : "..."));
                const fiberResult = await fiberLayer.queryFeatures({
                    where: whereClause,
                    outFields: ["objectid", "gis_id", "globalid", "purchase_order_id", "workorder_id"],
                    returnGeometry: true
                });
                
                if (fiberResult.features.length === 0) {
                    updateStatus("No fiber features found with the selected filters.", 'warning');
                    summarySection.style.display = 'none';
                    navigationSection.style.display = 'none';
                    resultsSection.style.display = 'none';
                    exportBtn.style.display = 'none';
                    return;
                }
                
                updateStatus(`Analyzing ${fiberResult.features.length} fiber features...`);
                
                // Query all point features once
                const allPointFeatures = [];
                for (const { layer, config } of pointLayers) {
                    const pointResult = await layer.queryFeatures({
                        where: "1=1",
                        outFields: ["objectid", "gis_id"],
                        returnGeometry: true
                    });
                    for (const feature of pointResult.features) {
                        allPointFeatures.push({
                            feature,
                            layerName: config.name,
                            geometry: feature.geometry
                        });
                    }
                }
                
                updateStatus(`Found ${allPointFeatures.length} point features for comparison...`);
                
                // Build spatial index of all fiber endpoints for faster lookup
                const fiberEndpoints = [];
                for (const fiber of fiberResult.features) {
                    if (!fiber.geometry || !fiber.geometry.paths || fiber.geometry.paths.length === 0) continue;
                    
                    for (let pathIndex = 0; pathIndex < fiber.geometry.paths.length; pathIndex++) {
                        const path = fiber.geometry.paths[pathIndex];
                        if (path.length < 2) continue;
                        
                        // Start endpoint
                        fiberEndpoints.push({
                            point: { x: path[0][0], y: path[0][1] },
                            fiberOid: fiber.attributes.objectid,
                            isStart: true
                        });
                        
                        // End endpoint
                        fiberEndpoints.push({
                            point: { x: path[path.length - 1][0], y: path[path.length - 1][1] },
                            fiberOid: fiber.attributes.objectid,
                            isStart: false
                        });
                    }
                }
                
                // Check each fiber feature
                let processedCount = 0;
                for (const fiber of fiberResult.features) {
                    processedCount++;
                    if (processedCount % 50 === 0) {
                        updateStatus(`Analyzing feature ${processedCount} of ${fiberResult.features.length}...`);
                    }
                    
                    if (!fiber.geometry || !fiber.geometry.paths || fiber.geometry.paths.length === 0) continue;
                    
                    for (let pathIndex = 0; pathIndex < fiber.geometry.paths.length; pathIndex++) {
                        const path = fiber.geometry.paths[pathIndex];
                        if (path.length < 2) continue;
                        
                        // Check both endpoints
                        const endpoints = [
                            { coords: path[0], type: "start", pathIndex },
                            { coords: path[path.length - 1], type: "end", pathIndex }
                        ];
                        
                        for (const endpoint of endpoints) {
                            const endpointGeom = { x: endpoint.coords[0], y: endpoint.coords[1] };
                            let isSnapped = false;
                            let snapInfo = null;
                            
                            // Check against point features
                            for (const pointInfo of allPointFeatures) {
                                const distance = calculateDistance(endpointGeom, pointInfo.geometry);
                                if (distance <= tolerance) {
                                    isSnapped = true;
                                    snapInfo = {
                                        type: "point",
                                        layerName: pointInfo.layerName,
                                        gisId: pointInfo.feature.attributes.gis_id,
                                        distance: distance.toFixed(2)
                                    };
                                    break;
                                }
                            }
                            
                            // Check against other fiber endpoints
                            if (!isSnapped) {
                                for (const otherEndpoint of fiberEndpoints) {
                                    // Skip self
                                    if (otherEndpoint.fiberOid === fiber.attributes.objectid) continue;
                                    
                                    const distance = calculateDistance(endpointGeom, otherEndpoint.point);
                                    if (distance <= tolerance) {
                                        isSnapped = true;
                                        snapInfo = {
                                            type: "fiber",
                                            fiberOid: otherEndpoint.fiberOid,
                                            distance: distance.toFixed(2)
                                        };
                                        break;
                                    }
                                }
                            }
                            
                            // If not snapped, add to results
                            if (!isSnapped) {
                                unsnappedEndpoints.push({
                                    objectId: fiber.attributes.objectid,
                                    gisId: fiber.attributes.gis_id || "N/A",
                                    globalId: fiber.attributes.globalid,
                                    purchaseOrderId: fiber.attributes.purchase_order_id || "",
                                    workOrderId: fiber.attributes.workorder_id || "",
                                    endpointType: endpoint.type,
                                    pathIndex: pathIndex,
                                    geometry: fiber.geometry,
                                    endpointCoords: endpointGeom,
                                    x: endpointGeom.x.toFixed(2),
                                    y: endpointGeom.y.toFixed(2)
                                });
                            }
                        }
                    }
                }
                
                // Display results
                displayResults();
                
                if (unsnappedEndpoints.length === 0) {
                    updateStatus(`✅ All ${fiberResult.features.length} fiber features have properly snapped endpoints!`, 'success');
                } else {
                    updateStatus(`Found ${unsnappedEndpoints.length} unsnapped endpoints in ${fiberResult.features.length} fiber features.`, 'warning');
                }
                
            } catch (error) {
                console.error("Error checking fiber endpoints:", error);
                updateStatus("Error: " + (error.message || error), 'error');
            }
        }
        
        function displayResults() {
            if (unsnappedEndpoints.length === 0) {
                summarySection.style.display = 'none';
                navigationSection.style.display = 'none';
                resultsSection.style.display = 'none';
                exportBtn.style.display = 'none';
                return;
            }
            
            // Build filter info
            const selectedPurchaseOrder = purchaseOrderSelect.value;
            const selectedWorkOrder = workOrderSelect.value;
            let filterInfo = '';
            
            if (selectedPurchaseOrder || selectedWorkOrder) {
                filterInfo = '<div style="margin-top:4px;font-size:10px;color:#856404;background:#fff3cd;padding:3px;border-radius:2px;">';
                filterInfo += '📋 Active Filters: ';
                const activeFilters = [];
                if (selectedPurchaseOrder) activeFilters.push(`PO: ${selectedPurchaseOrder}`);
                if (selectedWorkOrder) activeFilters.push(`WO: ${selectedWorkOrder}`);
                filterInfo += activeFilters.join(' | ');
                filterInfo += '</div>';
            }
            
            // Show summary
            summarySection.style.display = 'block';
            summaryText.innerHTML = `
                <div>Total Unsnapped Endpoints: <strong>${unsnappedEndpoints.length}</strong></div>
                <div style="margin-top:4px;font-size:10px;color:#666;">
                    Tolerance: ${toleranceInput.value}m | 
                    Start Points: ${unsnappedEndpoints.filter(e => e.endpointType === 'start').length} | 
                    End Points: ${unsnappedEndpoints.filter(e => e.endpointType === 'end').length}
                </div>
                ${filterInfo}
            `;
            
            // Show navigation
            navigationSection.style.display = 'block';
            exportBtn.style.display = 'inline-block';
            
            // Show results table
            resultsSection.style.display = 'block';
            
            let tableHTML = '<div style="overflow-x:auto;"><table border="1" style="border-collapse:collapse;width:100%;font-size:10px;">';
            tableHTML += '<tr style="background:#f0f0f0;">';
            tableHTML += '<th style="padding:4px;">GIS ID</th>';
            tableHTML += '<th style="padding:4px;">Endpoint</th>';
            tableHTML += '<th style="padding:4px;">Purchase Order</th>';
            tableHTML += '<th style="padding:4px;">Work Order</th>';
            tableHTML += '<th style="padding:4px;">Coordinates</th>';
            tableHTML += '<th style="padding:4px;">Action</th>';
            tableHTML += '</tr>';
            
            for (let i = 0; i < unsnappedEndpoints.length; i++) {
                const endpoint = unsnappedEndpoints[i];
                tableHTML += '<tr>';
                tableHTML += `<td style="padding:4px;">${endpoint.gisId}</td>`;
                tableHTML += `<td style="padding:4px;">${endpoint.endpointType === 'start' ? '▶ Start' : '◀ End'}</td>`;
                tableHTML += `<td style="padding:4px;font-size:9px;">${endpoint.purchaseOrderId || 'N/A'}</td>`;
                tableHTML += `<td style="padding:4px;font-size:9px;">${endpoint.workOrderId || 'N/A'}</td>`;
                tableHTML += `<td style="padding:4px;font-family:monospace;font-size:9px;">${endpoint.x}, ${endpoint.y}</td>`;
                tableHTML += `<td style="padding:4px;text-align:center;">`;
                tableHTML += `<button onclick="window.fiberEndpointChecker.zoomToEndpoint(${i})" `;
                tableHTML += `style="padding:2px 6px;background:#3367d6;color:white;border:none;border-radius:2px;cursor:pointer;font-size:9px;">`;
                tableHTML += `Zoom</button>`;
                tableHTML += `</td>`;
                tableHTML += '</tr>';
            }
            
            tableHTML += '</table></div>';
            resultsTable.innerHTML = tableHTML;
            
            // Initialize navigation
            currentIndex = 0;
            updateNavigation();
            
            // Automatically zoom to first endpoint
            setTimeout(() => {
                zoomToCurrentEndpoint();
            }, 500);
        }
        
        function updateNavigation() {
            if (unsnappedEndpoints.length === 0) return;
            
            counterText.textContent = `${currentIndex + 1} / ${unsnappedEndpoints.length}`;
            prevBtn.disabled = currentIndex === 0;
            nextBtn.disabled = currentIndex === unsnappedEndpoints.length - 1;
            
            prevBtn.style.opacity = currentIndex === 0 ? '0.5' : '1';
            nextBtn.style.opacity = currentIndex === unsnappedEndpoints.length - 1 ? '0.5' : '1';
            
            const endpoint = unsnappedEndpoints[currentIndex];
            currentFeatureInfo.innerHTML = `
                <div style="font-weight:bold;margin-bottom:4px;">Fiber Cable: ${endpoint.gisId}</div>
                <div>Endpoint Type: <strong>${endpoint.endpointType === 'start' ? 'Start Point' : 'End Point'}</strong></div>
                ${endpoint.purchaseOrderId ? `<div style="margin-top:2px;">Purchase Order: <strong>${endpoint.purchaseOrderId}</strong></div>` : ''}
                ${endpoint.workOrderId ? `<div style="margin-top:2px;">Work Order: <strong>${endpoint.workOrderId}</strong></div>` : ''}
                <div style="margin-top:4px;font-family:monospace;font-size:9px;">
                    X: ${endpoint.x}<br>
                    Y: ${endpoint.y}
                </div>
                <div style="margin-top:4px;color:#d32f2f;font-size:10px;">
                    ⚠ Not snapped to any point feature or other fiber endpoint
                </div>
            `;
        }
        
        function zoomToCurrentEndpoint() {
            if (unsnappedEndpoints.length === 0) return;
            zoomToEndpoint(currentIndex, true); // Explicit zoom calls should zoom
        }
        
        function zoomToEndpoint(index, shouldZoom = true) {
            if (index < 0 || index >= unsnappedEndpoints.length) return;
            
            currentIndex = index;
            updateNavigation();
            
            const endpoint = unsnappedEndpoints[index];
            
            // Create a point geometry for the endpoint
            const pointGeometry = {
                type: "point",
                x: endpoint.endpointCoords.x,
                y: endpoint.endpointCoords.y,
                spatialReference: mapView.spatialReference
            };
            
            if (shouldZoom) {
                // Zoom to the endpoint with a fixed scale
                mapView.goTo({
                    target: pointGeometry,
                    scale: 500
                }).then(() => {
                    updateStatus(`Viewing endpoint ${index + 1} of ${unsnappedEndpoints.length}`, 'info');
                    
                    // Highlight the feature temporarily
                    if (mapView.graphics) {
                        mapView.graphics.removeAll();
                        
                        // Add a highlight graphic
                        const highlightSymbol = {
                            type: "simple-marker",
                            color: [255, 0, 0, 0.8],
                            size: "16px",
                            outline: {
                                color: [255, 255, 255],
                                width: 2
                            }
                        };
                        
                        const highlightGraphic = {
                            geometry: pointGeometry,
                            symbol: highlightSymbol
                        };
                        
                        mapView.graphics.add(highlightGraphic);
                        
                        // Remove highlight after 5 seconds
                        setTimeout(() => {
                            if (mapView.graphics) {
                                mapView.graphics.removeAll();
                            }
                        }, 5000);
                    }
                    
                    // Show the feature popup
                    showFeaturePopup(endpoint);
                }).catch(error => {
                    console.error("Error zooming to endpoint:", error);
                });
            } else {
                // Just show the popup without zooming
                updateStatus(`Viewing endpoint ${index + 1} of ${unsnappedEndpoints.length}`, 'info');
                showFeaturePopup(endpoint);
            }
        }
        
        function getPopupLocation(geometry) {
            try {
                if (geometry.type === "point") {
                    return geometry;
                } else if (geometry.type === "polyline") {
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
                    if (geometry.centroid) {
                        return geometry.centroid;
                    }
                }
                
                if (geometry.extent && geometry.extent.center) {
                    return geometry.extent.center;
                }
                
                return geometry;
            } catch (error) {
                return geometry;
            }
        }
        
        async function showFeaturePopup(endpoint) {
            try {
                // Clear any existing highlight
                if (highlightHandle) {
                    highlightHandle.remove();
                    highlightHandle = null;
                }
                
                // Get the fiber layer
                const fiberLayer = mapView.map.allLayers.find(l => l.layerId === FIBER_LAYER_ID);
                if (!fiberLayer) {
                    console.error("Fiber layer not found for popup");
                    return;
                }
                
                await fiberLayer.load();
                
                // Query the feature fresh to get all attributes and ensure popup config
                const oidField = fiberLayer.objectIdField;
                const oid = endpoint.objectId;
                
                const queryResult = await fiberLayer.queryFeatures({
                    where: `${oidField} = ${oid}`,
                    outFields: ['*'],
                    returnGeometry: true
                });
                
                if (queryResult.features.length > 0) {
                    const freshFeature = queryResult.features[0];
                    
                    // Create highlight
                    mapView.whenLayerView(fiberLayer).then(layerView => {
                        highlightHandle = layerView.highlight(oid);
                    }).catch(err => {
                        console.error("Error highlighting feature:", err);
                    });
                    
                    // Open popup with fresh feature at the endpoint location
                    const popupLocation = {
                        type: "point",
                        x: endpoint.endpointCoords.x,
                        y: endpoint.endpointCoords.y,
                        spatialReference: mapView.spatialReference
                    };
                    
                    mapView.popup.open({
                        features: [freshFeature],
                        location: popupLocation,
                        updateLocationEnabled: false
                    });
                } else {
                    console.warn("Feature not found for popup");
                }
                
            } catch (error) {
                console.error("Error showing popup:", error);
                updateStatus("Error showing popup: " + error.message, 'error');
            }
        }
        
        function exportToCSV() {
            if (unsnappedEndpoints.length === 0) {
                alert("No data to export. Please run the check first.");
                return;
            }
            
            const selectedPurchaseOrder = purchaseOrderSelect.value;
            const selectedWorkOrder = workOrderSelect.value;
            
            // Build CSV content as array of lines
            let csvLines = [];
            
            // Add metadata header
            csvLines.push(`# Fiber Endpoint Checker Export`);
            csvLines.push(`# Export Date: ${new Date().toISOString()}`);
            csvLines.push(`# Snap Tolerance: ${toleranceInput.value} meters`);
            csvLines.push(`# Total Unsnapped Endpoints: ${unsnappedEndpoints.length}`);
            
            // Add filter information as header comments
            if (selectedPurchaseOrder || selectedWorkOrder) {
                let filterLine = "# Active Filters:";
                if (selectedPurchaseOrder) filterLine += ` Purchase Order: ${selectedPurchaseOrder}`;
                if (selectedWorkOrder) filterLine += ` Work Order: ${selectedWorkOrder}`;
                csvLines.push(filterLine);
            }
            csvLines.push("#");
            
            // CSV column headers
            csvLines.push("GIS ID,Object ID,Layer Name,Endpoint Type,Path Index,X Coordinate,Y Coordinate,Purchase Order,Work Order,Global ID");
            
            // Helper function to escape CSV values
            const escapeCSV = (val) => {
                if (val === null || val === undefined) return "";
                val = String(val);
                if (val.includes(',') || val.includes('"') || val.includes('\n')) {
                    return '"' + val.replace(/"/g, '""') + '"';
                }
                return val;
            };
            
            // Add data rows
            for (const endpoint of unsnappedEndpoints) {
                const row = [
                    escapeCSV(endpoint.gisId),
                    endpoint.objectId,
                    escapeCSV(`Fiber Cable (${FIBER_LAYER_ID})`),
                    escapeCSV(endpoint.endpointType),
                    endpoint.pathIndex,
                    endpoint.x,
                    endpoint.y,
                    escapeCSV(endpoint.purchaseOrderId || ""),
                    escapeCSV(endpoint.workOrderId || ""),
                    escapeCSV(endpoint.globalId || "")
                ];
                csvLines.push(row.join(','));
            }
            
            // Join all lines with newline
            const csvContent = csvLines.join('\n');
            
            // Create blob and download
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            
            let filename = "unsnapped_fiber_endpoints";
            if (selectedPurchaseOrder) filename += `_PO${selectedPurchaseOrder}`;
            if (selectedWorkOrder) filename += `_WO${selectedWorkOrder}`;
            filename += `_${new Date().toISOString().slice(0, 10)}.csv`;
            
            link.setAttribute("href", url);
            link.setAttribute("download", filename);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            
            updateStatus("CSV exported successfully!", 'success');
            
            // Show brief summary
            setTimeout(() => {
                updateStatus(`Exported ${unsnappedEndpoints.length} unsnapped endpoints`, 'info');
            }, 2000);
        }
        
        // Event listeners
        runCheckBtn.addEventListener("click", checkFiberEndpoints);
        exportBtn.addEventListener("click", exportToCSV);
        
        prevBtn.addEventListener("click", () => {
            if (currentIndex > 0) {
                zoomToEndpoint(currentIndex - 1, false); // Don't zoom, just show popup
            }
        });
        
        nextBtn.addEventListener("click", () => {
            if (currentIndex < unsnappedEndpoints.length - 1) {
                zoomToEndpoint(currentIndex + 1, false); // Don't zoom, just show popup
            }
        });
        
        closeToolBtn.addEventListener("click", () => {
            // Clean up drag event listeners
            if (toolboxHeader) {
                toolboxHeader.removeEventListener('mousedown', dragStart);
            }
            document.removeEventListener('mousemove', drag);
            document.removeEventListener('mouseup', dragEnd);
            
            // Clean up graphics
            if (mapView.graphics) {
                mapView.graphics.removeAll();
            }
            
            // Clean up highlight
            if (highlightHandle) {
                highlightHandle.remove();
                highlightHandle = null;
            }
            
            // Close popup
            if (mapView.popup) {
                mapView.popup.close();
            }
            
            toolBox.remove();
            
            // Safe removal from active tools
            if (window.gisToolHost && window.gisToolHost.activeTools && window.gisToolHost.activeTools instanceof Set) {
                window.gisToolHost.activeTools.delete('fiber-endpoint-checker');
            }
            
            // Clean up global reference
            if (window.fiberEndpointChecker) {
                delete window.fiberEndpointChecker;
            }
        });
        
        // Create global reference for zoom function
        window.fiberEndpointChecker = {
            zoomToEndpoint: zoomToEndpoint
        };
        
        // Register tool as active
        window.gisToolHost.activeTools.add('fiber-endpoint-checker');
        
        // Initialize dropdowns
        loadPurchaseOrders();
        loadWorkOrders();
        
        updateStatus("Tool loaded successfully. Select filters and click 'Run Check' to analyze fiber endpoints.");
        
    } catch (error) {
        console.error("Error initializing Fiber Endpoint Checker:", error);
        alert("Error initializing Fiber Endpoint Checker: " + (error.message || error));
    }
})();
