// tools/isolated-vault-checker.js
// Isolated Vault Checker - Identifies vaults that are not near any fiber lines.

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
        if (window.gisToolHost.activeTools.has('isolated-vault-checker')) {
            console.log('Isolated Vault Checker Tool already active');
            return;
        }

        const existingToolbox = document.getElementById('isolatedVaultCheckerToolbox');
        if (existingToolbox) {
            existingToolbox.remove();
            console.log('Removed leftover isolated vault checker toolbox');
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
        const FIBER_LAYER_ID = 41050; // Fiber Cable Lines
        const VAULT_LAYER_ID = 42100; // Vault Points
        const VAULT_LAYER_NAME = "Vault";

        // Tolerance in feet
        const ISOLATION_DISTANCE_FEET = 5;

        let isolatedVaults = [];
        let currentIndex = 0;
        let highlightHandle = null;

        // Create toolbox UI
        const toolBox = document.createElement("div");
        toolBox.id = "isolatedVaultCheckerToolbox";
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
                🗺️ Isolated Vault Checker
                <span style="float:right;font-size:11px;color:#666;font-weight:normal;">📌 Drag to move</span>
            </div>
            
            <div style="margin-bottom:10px;color:#666;font-size:11px;">
                Identifies vaults that are further than the specified distance from any fiber line (optionally filtered by PO/WO).
            </div>
            
            <div style="margin-bottom:10px;">
                <label style="font-size:11px;">Purchase Order ID (for Fiber):</label>
                <select id="purchaseOrderSelect" style="width:100%;margin-top:2px;padding:4px;font-size:11px;">
                    <option value="">Loading...</option>
                </select>
            </div>
            
            <div style="margin-bottom:10px;">
                <label style="font-size:11px;">Work Order ID (for Fiber):</label>
                <select id="workOrderSelect" style="width:100%;margin-top:2px;padding:4px;font-size:11px;">
                    <option value="">Loading...</option>
                </select>
            </div>
            
            <div style="display:flex;gap:6px;margin-bottom:10px;">
                <label style="flex:1;font-size:11px;">
                    Isolation Distance (feet):
                    <input id="distanceInput" type="number" value="${ISOLATION_DISTANCE_FEET}" min="1" max="100" step="1" 
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
                <div style="font-weight:bold;margin-bottom:6px;font-size:11px;">Isolated Vaults:</div>
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
        const distanceInput = $("#distanceInput");
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

       async function checkIsolatedVaults() {
            // Load the geometryEngine module
            let geometryEngine;
            try {
                [geometryEngine] = await new Promise((resolve, reject) => {
                    require(["esri/geometry/geometryEngine"], (engine) => {
                        resolve([engine]);
                    }, (err) => reject(err));
                });
            } catch (err) {
                updateStatus("Error: Could not load 'esri/geometry/geometryEngine'.", 'error');
                console.error("Error loading geometryEngine:", err);
                return;
            }

            try {
                updateStatus("Loading layers...");
                isolatedVaults = [];
                currentIndex = 0;

                const distance = parseFloat(distanceInput.value) || 5;
                const selectedPurchaseOrder = purchaseOrderSelect.value;
                const selectedWorkOrder = workOrderSelect.value;

                // --- MODIFICATION: Create two separate filter clauses ---

                // Build where clause for FIBER (PO and WO)
                let fiberFilterWhereClause = "1=1";
                const fiberFilters = [];

                if (selectedPurchaseOrder) {
                    fiberFilters.push(`purchase_order_id = '${selectedPurchaseOrder}'`);
                }

                if (selectedWorkOrder) {
                    fiberFilters.push(`workorder_id = '${selectedWorkOrder}'`);
                }

                if (fiberFilters.length > 0) {
                    fiberFilterWhereClause = fiberFilters.join(" AND ");
                }

                // Build where clause for VAULTS (PO, WO, and workflow_stage)
                let vaultFilterWhereClause = fiberFilterWhereClause; // Start with PO/WO
                const vaultOnlyFilter = "workflow_stage = 'OSP_CONST'";

                if (vaultFilterWhereClause === "1=1") {
                    vaultFilterWhereClause = vaultOnlyFilter;
                } else {
                    vaultFilterWhereClause += ` AND ${vaultOnlyFilter}`;
                }
                // --- END MODIFICATION ---


                // Get fiber layer
                const fiberLayer = mapView.map.allLayers.find(l => l.layerId === FIBER_LAYER_ID);
                if (!fiberLayer) {
                    updateStatus("Error: Fiber Cable layer not found (layerId " + FIBER_LAYER_ID + ")", 'error');
                    return;
                }
                await fiberLayer.load();

                // Get vault layer
                const vaultLayer = mapView.map.allLayers.find(l => l.layerId === VAULT_LAYER_ID);
                if (!vaultLayer) {
                    updateStatus("Error: Vault layer not found (layerId " + VAULT_LAYER_ID + ")", 'error');
                    return;
                }
                await vaultLayer.load();
                const vaultOidField = vaultLayer.objectIdField;

                // --- NEW EFFICIENT LOGIC (Exclusion Method) ---

                // 1. Get all *filtered* fiber line geometries
                updateStatus("Querying filtered fiber lines...");
                const fiberResult = await fiberLayer.queryFeatures({
                    where: fiberFilterWhereClause, // <-- Use fiber-specific filter
                    returnGeometry: true,
                    outFields: [] // We only need the geometry
                });

                let finalIsolationQuery;

                if (fiberResult.features.length === 0) {
                    // No fibers match the filter. Therefore, *all* vaults matching the vault filter are isolated.
                    updateStatus("No fiber lines found with filters. Finding all matching vaults...", 'warning');
                    
                    finalIsolationQuery = {
                        where: vaultFilterWhereClause, // <-- Use vault-specific filter
                        outFields: ["objectid", "gis_id", "globalid", "purchase_order_id", "workorder_id"],
                        returnGeometry: true
                    };

                } else {
                    // 2. Unify fiber lines into one geometry
                    updateStatus(`Unifying ${fiberResult.features.length} fiber lines...`);
                    const fiberGeometries = fiberResult.features.map(f => f.geometry);
                    const unifiedFiberGeometry = geometryEngine.union(fiberGeometries);

                    if (!unifiedFiberGeometry) {
                         updateStatus("Error: Could not unify fiber geometries.", 'error');
                         return;
                    }

                    // 3. Query 1: Find all vaults that *INTERSECT* the buffer
                    updateStatus(`Finding vaults *near* fiber lines...`);
                    const intersectQuery = {
                        where: vaultFilterWhereClause, // <-- Use vault-specific filter
                        geometry: unifiedFiberGeometry,
                        distance: distance,
                        units: "feet",
                        spatialRelationship: "intersects", // Find vaults *inside* the buffer
                        outFields: [vaultOidField],      // We ONLY need their IDs
                        returnGeometry: false
                    };
                    
                    const intersectResult = await vaultLayer.queryFeatures(intersectQuery);
                    const intersectingObjectIds = intersectResult.features.map(f => f.attributes[vaultOidField]);

                    // 4. Query 2: Find all vaults that are *NOT IN* the intersecting list
                    updateStatus(`Finding isolated vaults...`);
                    let finalWhereClause = vaultFilterWhereClause; // <-- Start with vault-specific filter

                    if (intersectingObjectIds.length > 0) {
                        // This is the key: find vaults that are NOT in the "good" list
                        finalWhereClause += ` AND ${vaultOidField} NOT IN (${intersectingObjectIds.join(',')})`;
                    }
                    // If intersectingObjectIds.length is 0, the base where clause is correct
                    // (all filtered vaults are isolated)

                    finalIsolationQuery = {
                        where: finalWhereClause,
                        outFields: ["objectid", "gis_id", "globalid", "purchase_order_id", "workorder_id"],
                        returnGeometry: true
                    };
                }

                // 5. Run the single, final query for isolated vaults
                const vaultResult = await vaultLayer.queryFeatures(finalIsolationQuery);
                
                if (vaultResult.features.length === 0) {
                    updateStatus("No isolated vaults found with the selected filters.", 'success');
                    summarySection.style.display = 'none';
                    navigationSection.style.display = 'none';
                    resultsSection.style.display = 'none';
                    exportBtn.style.display = 'none';
                    return;
                }

                // 6. Process the results (this is all client-side now)
                isolatedVaults = vaultResult.features.map(vault => ({
                    objectId: vault.attributes.objectid,
                    gisId: vault.attributes.gis_id || "N/A",
                    globalId: vault.attributes.globalid || "N/A",
                    purchaseOrderId: vault.attributes.purchase_order_id || "",
                    workOrderId: vault.attributes.workorder_id || "",
                    geometry: vault.geometry,
                    x: vault.geometry.x.toFixed(2),
                    y: vault.geometry.y.toFixed(2)
                }));
                
                // --- END NEW LOGIC ---

                // Display results
                displayResults();

                if (isolatedVaults.length === 0) {
                    updateStatus(`✅ All matching vaults are near fiber lines.`, 'success');
                } else {
                    updateStatus(`Found ${isolatedVaults.length} isolated vaults.`, 'warning');
                }

            } catch (error) {
                console.error("Error checking isolated vaults:", error);
                updateStatus("Error: " + (error.message || error), 'error');
            }
        }
        function displayResults() {
            if (isolatedVaults.length === 0) {
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
                filterInfo += '📋 Active Fiber Filters: ';
                const activeFilters = [];
                if (selectedPurchaseOrder) activeFilters.push(`PO: ${selectedPurchaseOrder}`);
                if (selectedWorkOrder) activeFilters.push(`WO: ${selectedWorkOrder}`);
                filterInfo += activeFilters.join(' | ');
                filterInfo += '</div>';
            }

            // Show summary
            summarySection.style.display = 'block';
            summaryText.innerHTML = `
                <div>Total Isolated Vaults: <strong>${isolatedVaults.length}</strong></div>
                <div style="margin-top:4px;font-size:10px;color:#666;">
                    Isolation Distance: ${distanceInput.value} feet
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
            tableHTML += '<th style="padding:4px;">Purchase Order</th>';
            tableHTML += '<th style="padding:4px;">Work Order</th>';
            tableHTML += '<th style="padding:4px;">Coordinates</th>';
            tableHTML += '<th style="padding:4px;">Action</th>';
            tableHTML += '</tr>';

            for (let i = 0; i < isolatedVaults.length; i++) {
                const vault = isolatedVaults[i];
                tableHTML += '<tr>';
                tableHTML += `<td style="padding:4px;">${vault.gisId}</td>`;
                tableHTML += `<td style="padding:4px;font-size:9px;">${vault.purchaseOrderId || 'N/A'}</td>`;
                tableHTML += `<td style="padding:4px;font-size:9px;">${vault.workOrderId || 'N/A'}</td>`;
                tableHTML += `<td style="padding:4px;font-family:monospace;font-size:9px;">${vault.x}, ${vault.y}</td>`;
                tableHTML += `<td style="padding:4px;text-align:center;">`;
                tableHTML += `<button onclick="window.isolatedVaultChecker.zoomToVault(${i})" `;
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

            // Automatically zoom to first vault
            setTimeout(() => {
                zoomToCurrentVault();
            }, 500);
        }

        function updateNavigation() {
            if (isolatedVaults.length === 0) return;

            counterText.textContent = `${currentIndex + 1} / ${isolatedVaults.length}`;
            prevBtn.disabled = currentIndex === 0;
            nextBtn.disabled = currentIndex === isolatedVaults.length - 1;

            prevBtn.style.opacity = currentIndex === 0 ? '0.5' : '1';
            nextBtn.style.opacity = currentIndex === isolatedVaults.length - 1 ? '0.5' : '1';

            const vault = isolatedVaults[currentIndex];
            currentFeatureInfo.innerHTML = `
                <div style="font-weight:bold;margin-bottom:4px;">Vault: ${vault.gisId}</div>
                ${vault.purchaseOrderId ? `<div style="margin-top:2px;">Purchase Order: <strong>${vault.purchaseOrderId}</strong></div>` : ''}
                ${vault.workOrderId ? `<div style="margin-top:2px;">Work Order: <strong>${vault.workOrderId}</strong></div>` : ''}
                <div style="margin-top:4px;font-family:monospace;font-size:9px;">
                    X: ${vault.x}<br>
                    Y: ${vault.y}
                </div>
                <div style="margin-top:4px;color:#d32f2f;font-size:10px;">
                    ⚠ Not within ${distanceInput.value}ft of any filtered fiber lines
                </div>
            `;
        }

        function zoomToCurrentVault() {
            if (isolatedVaults.length === 0) return;
            zoomToVault(currentIndex, true); // Explicit zoom calls should zoom
        }

        function zoomToVault(index, shouldZoom = true) {
            if (index < 0 || index >= isolatedVaults.length) return;

            currentIndex = index;
            updateNavigation();

            const vault = isolatedVaults[index];

            const pointGeometry = vault.geometry; // Vault geometry is already a point

            if (shouldZoom) {
                // Zoom to the vault with a fixed scale
                mapView.goTo({
                    target: pointGeometry,
                    scale: 500
                }).then(() => {
                    updateStatus(`Viewing vault ${index + 1} of ${isolatedVaults.length}`, 'info');

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
                    showFeaturePopup(vault);
                }).catch(error => {
                    console.error("Error zooming to vault:", error);
                });
            } else {
                // Just show the popup without zooming
                updateStatus(`Viewing vault ${index + 1} of ${isolatedVaults.length}`, 'info');
                showFeaturePopup(vault);
            }
        }

        async function showFeaturePopup(vault) {
            try {
                // Clear any existing highlight
                if (highlightHandle) {
                    highlightHandle.remove();
                    highlightHandle = null;
                }

                // Get the vault layer
                const vaultLayer = mapView.map.allLayers.find(l => l.layerId === VAULT_LAYER_ID);
                if (!vaultLayer) {
                    console.error("Vault layer not found for popup");
                    return;
                }

                await vaultLayer.load();

                // Query the feature fresh to get all attributes
                const oidField = vaultLayer.objectIdField;
                const oid = vault.objectId;

                const queryResult = await vaultLayer.queryFeatures({
                    where: `${oidField} = ${oid}`,
                    outFields: ['*'],
                    returnGeometry: true
                });

                if (queryResult.features.length > 0) {
                    const freshFeature = queryResult.features[0];

                    // Create highlight
                    mapView.whenLayerView(vaultLayer).then(layerView => {
                        highlightHandle = layerView.highlight(oid);
                    }).catch(err => {
                        console.error("Error highlighting feature:", err);
                    });

                    // Open popup with fresh feature at the vault location
                    mapView.popup.open({
                        features: [freshFeature],
                        location: freshFeature.geometry,
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
            if (isolatedVaults.length === 0) {
                alert("No data to export. Please run the check first.");
                return;
            }

            const selectedPurchaseOrder = purchaseOrderSelect.value;
            const selectedWorkOrder = workOrderSelect.value;

            // Build CSV content as array of lines
            let csvLines = [];

            // Add metadata header
            csvLines.push(`# Isolated Vault Checker Export`);
            csvLines.push(`# Export Date: ${new Date().toISOString()}`);
            csvLines.push(`# Isolation Distance: ${distanceInput.value} feet`);
            csvLines.push(`# Total Isolated Vaults: ${isolatedVaults.length}`);

            // Add filter information as header comments
            if (selectedPurchaseOrder || selectedWorkOrder) {
                let filterLine = "# Active Fiber Filters:";
                if (selectedPurchaseOrder) filterLine += ` Purchase Order: ${selectedPurchaseOrder}`;
                if (selectedWorkOrder) filterLine += ` Work Order: ${selectedWorkOrder}`;
                csvLines.push(filterLine);
            }
            csvLines.push("#");

            // CSV column headers
            csvLines.push("GIS ID,Object ID,Layer Name,X Coordinate,Y Coordinate,Purchase Order,Work Order,Global ID");

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
            for (const vault of isolatedVaults) {
                const row = [
                    escapeCSV(vault.gisId),
                    vault.objectId,
                    escapeCSV(VAULT_LAYER_NAME),
                    vault.x,
                    vault.y,
                    escapeCSV(vault.purchaseOrderId || ""),
                    escapeCSV(vault.workOrderId || ""),
                    escapeCSV(vault.globalId || "")
                ];
                csvLines.push(row.join(','));
            }

            // Join all lines with newline
            const csvContent = csvLines.join('\n');

            // Create blob and download
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");

            let filename = "isolated_vaults";
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
                updateStatus(`Exported ${isolatedVaults.length} isolated vaults`, 'info');
            }, 2000);
        }

        // Event listeners
        runCheckBtn.addEventListener("click", checkIsolatedVaults);
        exportBtn.addEventListener("click", exportToCSV);

        prevBtn.addEventListener("click", () => {
            if (currentIndex > 0) {
                zoomToVault(currentIndex - 1, false); // Don't zoom, just show popup
            }
        });

        nextBtn.addEventListener("click", () => {
            if (currentIndex < isolatedVaults.length - 1) {
                zoomToVault(currentIndex + 1, false); // Don't zoom, just show popup
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
                window.gisToolHost.activeTools.delete('isolated-vault-checker');
            }

            // Clean up global reference
            if (window.isolatedVaultChecker) {
                delete window.isolatedVaultChecker;
            }
        });

        // Create global reference for zoom function
        window.isolatedVaultChecker = {
            zoomToVault: zoomToVault
        };

        // Register tool as active
        window.gisToolHost.activeTools.add('isolated-vault-checker');

        // Initialize dropdowns
        loadPurchaseOrders();
        loadWorkOrders();

        updateStatus("Tool loaded successfully. Select filters and click 'Run Check' to analyze vaults.");

    } catch (error) {
        console.error("Error initializing Isolated Vault Checker:", error);
        alert("Error initializing Isolated Vault Checker: " + (error.message || error));
    }
})();
