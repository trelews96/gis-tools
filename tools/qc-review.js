// tools/remote-qc-workflow.js - Remote QC Workflow Tool
// Allows sequential QC review of completed construction features

(function() {
    try {
        if (window.gisToolHost.activeTools.has('remote-qc-workflow')) {
            return;
        }
        
        const existingToolbox = document.getElementById('remoteQcWorkflowToolbox');
        if (existingToolbox) {
            existingToolbox.remove();
        }
        
        const utils = window.gisSharedUtils;
        if (!utils) {
            throw new Error('Shared utilities not loaded');
        }
        
        const mapView = utils.getMapView();
        const z = 99999;
        
        // Tool state
        let qcQueue = []; // Array of {layer, feature, gisId}
        let currentIndex = 0;
        let currentPhase = 'query';
        let gigTypes = []; // Loaded from layer 22100
        let workOrderOptions = []; // Loaded from domain/unique values
        let sessionLog = []; // Track all QC actions
        let sessionStartTime = null;
        let currentFeatureStartTime = null;
        let highlightHandle = null;
        let featureTimerInterval = null;
        
        // Create tool UI
        const toolBox = document.createElement("div");
        toolBox.id = "remoteQcWorkflowToolbox";
        toolBox.style.cssText = `
            position: fixed;
            top: 80px;
            right: 40px;
            z-index: ${z};
            background: #fff;
            border: 1px solid #333;
            padding: 16px;
            width: 450px;
            max-height: 85vh;
            overflow-y: auto;
            font: 12px/1.4 Arial, sans-serif;
            box-shadow: 0 4px 16px rgba(0,0,0,.2);
            border-radius: 6px;
        `;
        
        toolBox.innerHTML = `
            <div style="font-weight:bold;margin-bottom:16px;font-size:16px;color:#2c3e50;">🔍 Remote QC Workflow</div>
            
            <!-- Phase 1: Query & Filter -->
            <div id="queryPhase">
                <div style="margin-bottom:16px;padding:12px;background:#f8f9fa;border:1px solid #dee2e6;border-radius:4px;">
                    <div style="font-weight:bold;margin-bottom:8px;color:#495057;">Filter Criteria</div>
                    
                    <!-- Work Order Filter -->
                    <div style="margin-bottom:12px;">
                        <label style="display:block;font-weight:bold;margin-bottom:4px;font-size:11px;">Work Order:</label>
                        <div id="workOrderDropdownContainer" style="position:relative;">
                            <input type="text" id="workOrderSearch" placeholder="Search work orders..." 
                                style="width:100%;padding:6px;border:1px solid #ced4da;border-radius:3px;font-size:12px;">
                            <div id="workOrderDropdown" style="
                                position:absolute;
                                top:100%;
                                left:0;
                                right:0;
                                max-height:200px;
                                overflow-y:auto;
                                background:#fff;
                                border:1px solid #ced4da;
                                border-top:none;
                                display:none;
                                z-index:1000;
                                box-shadow:0 2px 4px rgba(0,0,0,0.1);
                            "></div>
                        </div>
                        <div style="font-size:10px;color:#6c757d;margin-top:2px;">Leave empty for all work orders</div>
                    </div>
                    
                    <!-- Date Range Filter -->
                    <div style="margin-bottom:12px;">
                        <label style="display:block;font-weight:bold;margin-bottom:4px;font-size:11px;">Installation Date Range:</label>
                        <div style="display:flex;gap:8px;align-items:center;">
                            <input type="date" id="dateFrom" style="flex:1;padding:6px;border:1px solid #ced4da;border-radius:3px;font-size:11px;">
                            <span style="color:#6c757d;">to</span>
                            <input type="date" id="dateTo" style="flex:1;padding:6px;border:1px solid #ced4da;border-radius:3px;font-size:11px;">
                        </div>
                        <div style="font-size:10px;color:#6c757d;margin-top:2px;">Leave empty for all dates</div>
                    </div>
                    
                    <!-- Sort Order -->
                    <div style="margin-bottom:12px;">
                        <label style="display:block;font-weight:bold;margin-bottom:4px;font-size:11px;">Sort Order:</label>
                        <select id="sortOrder" style="width:100%;padding:6px;border:1px solid #ced4da;border-radius:3px;font-size:12px;">
                            <option value="desc">Newest to Oldest</option>
                            <option value="asc">Oldest to Newest</option>
                        </select>
                    </div>
                    
                    <!-- Action Buttons -->
                    <div style="display:flex;gap:8px;">
                        <button id="queryFeaturesBtn" style="flex:1;padding:8px 12px;background:#007bff;color:white;border:none;border-radius:3px;cursor:pointer;font-weight:bold;font-size:12px;">
                            🔍 Query Features
                        </button>
                        <button id="refreshQueryBtn" style="padding:8px 12px;background:#6c757d;color:white;border:none;border-radius:3px;cursor:pointer;font-size:12px;" disabled>
                            🔄 Refresh
                        </button>
                    </div>
                </div>
                
                <!-- Query Results -->
                <div id="queryResults" style="display:none;margin-bottom:12px;padding:12px;background:#e7f3ff;border:1px solid #b3d9ff;border-radius:4px;">
                    <div style="font-weight:bold;margin-bottom:8px;color:#004085;">Query Results</div>
                    <div id="resultsContent"></div>
                    <button id="startQcBtn" style="width:100%;margin-top:12px;padding:10px;background:#28a745;color:white;border:none;border-radius:3px;cursor:pointer;font-weight:bold;font-size:13px;">
                        Start QC Review →
                    </button>
                </div>
            </div>
            
            <!-- Phase 2: QC Review -->
            <div id="reviewPhase" style="display:none;">
                <!-- Progress Bar -->
                <div style="margin-bottom:16px;padding:12px;background:#e7f3ff;border:1px solid #b3d9ff;border-radius:4px;">
                    <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                        <span style="font-weight:bold;color:#004085;">Progress</span>
                        <span id="progressText" style="color:#004085;">0 of 0</span>
                    </div>
                    <div style="background:#cfe2ff;height:8px;border-radius:4px;overflow:hidden;">
                        <div id="progressBar" style="background:#0d6efd;height:100%;width:0%;transition:width 0.3s;"></div>
                    </div>
                </div>
                
                <!-- Feature Info -->
                <div style="margin-bottom:16px;padding:12px;background:#f8f9fa;border:1px solid #dee2e6;border-radius:4px;">
                    <div style="font-weight:bold;margin-bottom:8px;color:#495057;">Current Feature</div>
                    <div id="featureInfoContent" style="font-size:11px;line-height:1.6;"></div>
                    
                    <!-- Feature Actions -->
                    <div style="display:flex;gap:8px;margin-top:12px;">
                        <button id="zoomToFeatureBtn" style="width:100%;padding:6px 10px;background:#17a2b8;color:white;border:none;border-radius:3px;cursor:pointer;font-size:11px;">
                            📍 Zoom to Feature
                        </button>
                    </div>
                    
                    <!-- Timer -->
                    <div style="margin-top:8px;padding:6px;background:#fff;border:1px solid #dee2e6;border-radius:3px;text-align:center;">
                        <span style="font-size:10px;color:#6c757d;">Time on feature: </span>
                        <span id="featureTimer" style="font-weight:bold;color:#495057;">0:00</span>
                    </div>
                </div>
                
                <!-- QC Form -->
                <div style="margin-bottom:16px;padding:12px;background:#fff;border:2px solid #dee2e6;border-radius:4px;">
                    <div style="font-weight:bold;margin-bottom:12px;color:#495057;font-size:13px;">QC Decision</div>
                    
                    <!-- Pass/Fail/Missing Photo Radio -->
                    <div style="margin-bottom:16px;">
                        <label style="display:flex;align-items:center;gap:8px;padding:8px;background:#d4edda;border:1px solid #c3e6cb;border-radius:3px;cursor:pointer;margin-bottom:8px;">
                            <input type="radio" name="qcDecision" value="pass" id="qcPass">
                            <span style="font-weight:bold;color:#155724;">✓ Pass</span>
                        </label>
                        <label style="display:flex;align-items:center;gap:8px;padding:8px;background:#f8d7da;border:1px solid #f5c6cb;border-radius:3px;cursor:pointer;margin-bottom:8px;">
                            <input type="radio" name="qcDecision" value="fail" id="qcFail">
                            <span style="font-weight:bold;color:#721c24;">✗ Fail</span>
                        </label>
                        <label style="display:flex;align-items:center;gap:8px;padding:8px;background:#fff3cd;border:1px solid #ffeaa7;border-radius:3px;cursor:pointer;">
                            <input type="radio" name="qcDecision" value="missing_photo" id="qcMissingPhoto">
                            <span style="font-weight:bold;color:#856404;">📷 Missing Photo</span>
                        </label>
                    </div>
                    
                    <!-- Issue Types (shown when Fail selected) -->
                    <div id="issueTypesSection" style="display:none;margin-bottom:16px;">
                        <label style="display:block;font-weight:bold;margin-bottom:4px;font-size:11px;">Issue Type(s):</label>
                        <div style="position:relative;">
                            <input type="text" id="issueTypeSearch" placeholder="Search issue types..." 
                                style="width:100%;padding:6px;border:1px solid #ced4da;border-radius:3px;font-size:11px;margin-bottom:8px;">
                        </div>
                        <div id="issueTypesList" style="
                            max-height:200px;
                            overflow-y:auto;
                            border:1px solid #ced4da;
                            border-radius:3px;
                            padding:8px;
                            background:#f8f9fa;
                        "></div>
                        <div style="font-size:10px;color:#6c757d;margin-top:4px;">Select all that apply</div>
                    </div>
                    
                    <!-- Notes -->
                    <div style="margin-bottom:16px;">
                        <label style="display:block;font-weight:bold;margin-bottom:4px;font-size:11px;">Notes (Optional):</label>
                        <textarea id="qcNotes" rows="3" placeholder="Add any additional comments..." 
                            style="width:100%;padding:6px;border:1px solid #ced4da;border-radius:3px;font-size:11px;resize:vertical;"></textarea>
                    </div>
                    
                    <!-- Submit Buttons -->
                    <div style="display:flex;gap:8px;">
                        <button id="submitQcBtn" style="flex:1;padding:10px;background:#28a745;color:white;border:none;border-radius:3px;cursor:pointer;font-weight:bold;font-size:12px;">
                            Submit QC →
                        </button>
                        <button id="skipFeatureBtn" style="padding:10px 16px;background:#ffc107;color:#000;border:none;border-radius:3px;cursor:pointer;font-size:12px;">
                            Skip
                        </button>
                    </div>
                    
                    <button id="prevFeatureBtn" style="width:100%;margin-top:8px;padding:8px;background:#6c757d;color:white;border:none;border-radius:3px;cursor:pointer;font-size:11px;">
                        ← Previous
                    </button>
                </div>
            </div>
            
            <!-- Phase 3: Complete -->
            <div id="completePhase" style="display:none;">
                <div style="padding:16px;background:#d4edda;border:1px solid #c3e6cb;border-radius:4px;margin-bottom:16px;text-align:center;">
                    <div style="font-size:24px;margin-bottom:8px;">✅</div>
                    <div style="font-weight:bold;color:#155724;font-size:14px;margin-bottom:4px;">QC Session Complete!</div>
                    <div style="color:#155724;font-size:11px;">All features have been reviewed</div>
                </div>
                
                <div id="sessionSummary" style="margin-bottom:16px;padding:12px;background:#f8f9fa;border:1px solid #dee2e6;border-radius:4px;"></div>
                
                <button id="exportReportBtn" style="width:100%;padding:10px;background:#17a2b8;color:white;border:none;border-radius:3px;cursor:pointer;font-weight:bold;margin-bottom:8px;font-size:12px;">
                    📄 Export Session Report
                </button>
                <button id="startOverBtn" style="width:100%;padding:10px;background:#28a745;color:white;border:none;border-radius:3px;cursor:pointer;font-weight:bold;font-size:12px;">
                    Start New Session
                </button>
            </div>
            
            <div style="border-top:1px solid #ddd;margin-top:16px;padding-top:12px;">
                <button id="closeTool" style="width:100%;padding:8px;background:#dc3545;color:white;border:none;border-radius:3px;cursor:pointer;font-size:12px;">
                    Close Tool
                </button>
            </div>
            
            <div id="toolStatus" style="margin-top:8px;color:#007bff;font-size:11px;min-height:16px;"></div>
        `;
        
        document.body.appendChild(toolBox);
        
        const $ = (id) => toolBox.querySelector(id);
        const status = $("#toolStatus");
        
        function updateStatus(message) {
            status.textContent = message;
        }
        
        function setPhase(phase) {
            currentPhase = phase;
            
            $("#queryPhase").style.display = "none";
            $("#reviewPhase").style.display = "none";
            $("#completePhase").style.display = "none";
            
            switch(phase) {
                case 'query':
                    $("#queryPhase").style.display = "block";
                    break;
                case 'review':
                    $("#reviewPhase").style.display = "block";
                    break;
                case 'complete':
                    $("#completePhase").style.display = "block";
                    break;
            }
        }
        
        // Initialize: Load GIG types and work orders
        async function initialize() {
            updateStatus("Initializing tool...");
            
            try {
                // Load GIG types from layer 22100
                await loadGigTypes();
                
                // Load work order options
                await loadWorkOrders();
                
                updateStatus("Ready. Configure filters and click 'Query Features'.");
                
            } catch (error) {
                updateStatus("Error initializing: " + error.message);
                console.error(error);
            }
        }
        
        async function loadGigTypes() {
            try {
                const gigLayer = mapView.map.allLayers.find(l => l.layerId === 22100);
                
                if (!gigLayer) {
                    throw new Error("GIG layer (22100) not found in map");
                }
                
                await gigLayer.load();
                
                const gigTypeField = gigLayer.fields.find(f => f.name.toLowerCase() === 'gig_type');
                
                if (!gigTypeField || !gigTypeField.domain || gigTypeField.domain.type !== 'coded-value') {
                    throw new Error("gig_type field or domain not found on layer 22100");
                }
                
                gigTypes = gigTypeField.domain.codedValues.map(cv => ({
                    code: cv.code,
                    name: cv.name
                }));
                
                updateStatus(`Loaded ${gigTypes.length} issue types`);
                
            } catch (error) {
                gigTypes = [];
                console.error("Error loading GIG types:", error);
                throw error;
            }
        }
        
        async function loadWorkOrders() {
            try {
                // Get all visible feature layers
                const featureLayers = mapView.map.allLayers.filter(l => 
                    l.type === "feature" && l.visible
                );
                
                if (featureLayers.length === 0) {
                    throw new Error("No visible feature layers found");
                }
                
                const allWorkOrders = new Map(); // Use Map to store code -> name mapping
                
                // Query all layers for unique work order values
                for (const layer of featureLayers.items) {
                    try {
                        await layer.load();
                        
                        // Check if layer has workorder_id field
                        const workOrderField = layer.fields.find(f => 
                            f.name.toLowerCase() === 'workorder_id'
                        );
                        
                        if (!workOrderField) {
                            continue; // Skip this layer
                        }
                        
                        // If domain exists, use it (this preserves code/name relationship)
                        if (workOrderField.domain && workOrderField.domain.type === 'coded-value') {
                            workOrderField.domain.codedValues.forEach(cv => {
                                // Store code as key, name as value
                                allWorkOrders.set(cv.code, cv.name);
                            });
                        } else {
                            // Otherwise query for unique values (no code/name distinction)
                            const query = layer.createQuery();
                            query.where = "1=1";
                            query.returnDistinctValues = true;
                            query.outFields = ['workorder_id'];
                            query.returnGeometry = false;
                            
                            const result = await layer.queryFeatures(query);
                            result.features.forEach(f => {
                                const wo = f.attributes.workorder_id;
                                if (wo !== null && wo !== undefined && wo !== '') {
                                    // Store as both code and name (same value)
                                    allWorkOrders.set(wo, wo);
                                }
                            });
                        }
                    } catch (error) {
                        console.error(`Error querying work orders from layer ${layer.title}:`, error);
                        // Continue with other layers
                    }
                }
                
                // Convert to array of objects with code and name
                workOrderOptions = Array.from(allWorkOrders.entries()).map(([code, name]) => ({
                    code: code,
                    name: name
                })).sort((a, b) => a.name.localeCompare(b.name));
                
                if (workOrderOptions.length === 0) {
                    updateStatus("Warning: No work orders found in any layer");
                } else {
                    updateStatus(`Loaded ${workOrderOptions.length} work orders from ${featureLayers.length} layers`);
                }
                
                setupWorkOrderDropdown();
                
            } catch (error) {
                console.error("Error loading work orders:", error);
                workOrderOptions = [];
            }
        }
        
        function setupWorkOrderDropdown() {
            const searchInput = $("#workOrderSearch");
            const dropdown = $("#workOrderDropdown");
            
            let selectedWorkOrderCode = '';
            
            function renderOptions(filterText = '') {
                dropdown.innerHTML = '';
                const filter = filterText.toLowerCase();
                
                // Add "All" option
                const allOption = document.createElement('div');
                allOption.style.cssText = 'padding:8px;cursor:pointer;border-bottom:1px solid #e9ecef;';
                allOption.textContent = '-- All Work Orders --';
                allOption.onclick = () => {
                    selectedWorkOrderCode = '';
                    searchInput.value = '';
                    searchInput.dataset.selectedCode = '';
                    dropdown.style.display = 'none';
                };
                allOption.onmouseenter = () => allOption.style.background = '#e3f2fd';
                allOption.onmouseleave = () => allOption.style.background = '#fff';
                dropdown.appendChild(allOption);
                
                const filtered = workOrderOptions.filter(wo => 
                    wo.name.toLowerCase().includes(filter) || 
                    wo.code.toLowerCase().includes(filter)
                );
                
                if (filtered.length === 0) {
                    const noResults = document.createElement('div');
                    noResults.style.padding = '8px';
                    noResults.style.color = '#999';
                    noResults.textContent = 'No matches found';
                    dropdown.appendChild(noResults);
                } else {
                    filtered.forEach(wo => {
                        const optDiv = document.createElement('div');
                        optDiv.style.cssText = 'padding:8px;cursor:pointer;';
                        optDiv.textContent = wo.name; // Display the name
                        optDiv.dataset.code = wo.code; // Store the code
                        
                        optDiv.onmouseenter = () => optDiv.style.background = '#e3f2fd';
                        optDiv.onmouseleave = () => optDiv.style.background = '#fff';
                        
                        optDiv.onclick = () => {
                            selectedWorkOrderCode = wo.code;
                            searchInput.value = wo.name; // Show the name in input
                            searchInput.dataset.selectedCode = wo.code; // Store the code for query
                            dropdown.style.display = 'none';
                        };
                        
                        dropdown.appendChild(optDiv);
                    });
                }
            }
            
            searchInput.onfocus = () => {
                renderOptions(searchInput.value);
                dropdown.style.display = 'block';
            };
            
            searchInput.oninput = () => {
                renderOptions(searchInput.value);
                dropdown.style.display = 'block';
            };
            
            searchInput.onblur = () => {
                setTimeout(() => dropdown.style.display = 'none', 200);
            };
        }
        
        // Query features based on filters
        async function queryFeatures() {
            try {
                updateStatus("Querying features...");
                $("#queryFeaturesBtn").disabled = true;
                
                // Build WHERE clause
                let whereClauses = [
                    "workflow_stage = 'OSP_CONST'",
                    "workflow_status = 'CMPLT'"
                ];
                
                // Add work order filter
                const workOrderCode = $("#workOrderSearch").dataset.selectedCode;
                console.log("Work order filter code:", workOrderCode);
                if (workOrderCode) {
                    whereClauses.push(`workorder_id = '${workOrderCode.replace(/'/g, "''")}'`);
                }
                
                // Add date range filter
                const dateFrom = $("#dateFrom").value;
                const dateTo = $("#dateTo").value;
                
                if (dateFrom || dateTo) {
                    if (dateFrom && dateTo) {
                        const fromMs = new Date(dateFrom).getTime();
                        const toMs = new Date(dateTo + "T23:59:59").getTime();
                        whereClauses.push(`installation_date >= ${fromMs} AND installation_date <= ${toMs}`);
                    } else if (dateFrom) {
                        const fromMs = new Date(dateFrom).getTime();
                        whereClauses.push(`installation_date >= ${fromMs}`);
                    } else if (dateTo) {
                        const toMs = new Date(dateTo + "T23:59:59").getTime();
                        whereClauses.push(`installation_date <= ${toMs}`);
                    }
                }
                
                const whereClause = whereClauses.join(" AND ");
                
                // Debug: Log the WHERE clause
                console.log("Query WHERE clause:", whereClause);
                updateStatus("Building query: " + whereClause);
                
                // Get sort order
                const sortOrder = $("#sortOrder").value;
                
                // Query all visible feature layers
                const featureLayers = mapView.map.allLayers.filter(l => 
                    l.type === "feature" && l.visible
                );
                
                qcQueue = [];
                const layerCounts = {};
                const layerErrors = [];
                
                for (const layer of featureLayers.items) {
                    try {
                        await layer.load();
                        
                        console.log(`Checking layer: ${layer.title} (ID: ${layer.layerId})`);
                        
                        // Check if layer has required fields
                        const hasRequiredFields = ['workflow_stage', 'workflow_status', 'gis_id'].every(
                            fieldName => layer.fields.some(f => f.name.toLowerCase() === fieldName.toLowerCase())
                        );
                        
                        if (!hasRequiredFields) {
                            console.log(`Skipping layer ${layer.title} - missing required fields`);
                            continue;
                        }
                        
                        console.log(`Querying layer ${layer.title} with WHERE: ${whereClause}`);
                        
                        const query = layer.createQuery();
                        query.where = whereClause;
                        query.outFields = ['*'];
                        query.returnGeometry = true;
                        
                        // Try to add order by, but don't fail if it doesn't work
                        try {
                            query.orderByFields = [`installation_date ${sortOrder.toUpperCase()}`];
                        } catch (e) {
                            console.warn(`Could not set orderBy for layer ${layer.title}`);
                        }
                        
                        const result = await layer.queryFeatures(query);
                        
                        console.log(`Layer ${layer.title} returned ${result.features.length} features`);
                        
                        if (result.features.length > 0) {
                            layerCounts[layer.title] = result.features.length;
                            
                            result.features.forEach(feature => {
                                const gisId = feature.attributes.gis_id || feature.attributes.GIS_ID || 
                                            feature.attributes.gisid || 'Unknown';
                                
                                qcQueue.push({
                                    layer: layer,
                                    feature: feature,
                                    gisId: gisId
                                });
                            });
                        }
                        
                    } catch (error) {
                        console.error(`Error querying layer ${layer.title}:`, error);
                        layerErrors.push(layer.title);
                        // Continue with other layers
                    }
                }
                
                // Sort the queue by installation_date if available
                if (qcQueue.length > 0) {
                    qcQueue.sort((a, b) => {
                        const dateA = a.feature.attributes.installation_date || 0;
                        const dateB = b.feature.attributes.installation_date || 0;
                        return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
                    });
                }
                
                // Display results
                displayQueryResults(layerCounts, layerErrors);
                
                $("#refreshQueryBtn").disabled = false;
                
            } catch (error) {
                updateStatus("Error querying features: " + error.message);
                alert("Error querying features: " + error.message);
            } finally {
                $("#queryFeaturesBtn").disabled = false;
            }
        }
        
        function displayQueryResults(layerCounts, layerErrors = []) {
            const resultsDiv = $("#queryResults");
            const contentDiv = $("#resultsContent");
            
            if (qcQueue.length === 0) {
                let html = `
                    <div style="padding:12px;background:#fff3cd;border:1px solid #ffeaa7;border-radius:3px;text-align:center;">
                        <strong>No features found</strong><br>
                        <span style="font-size:11px;">Try adjusting your filter criteria</span>
                    </div>
                `;
                
                if (layerErrors.length > 0) {
                    html += `
                        <div style="padding:8px;background:#f8d7da;border:1px solid #f5c6cb;border-radius:3px;margin-top:8px;font-size:11px;">
                            <strong>Note:</strong> ${layerErrors.length} layer(s) had query errors: ${layerErrors.join(', ')}
                        </div>
                    `;
                }
                
                contentDiv.innerHTML = html;
                resultsDiv.style.display = 'block';
                $("#startQcBtn").style.display = 'none';
                updateStatus("No features found matching criteria");
                return;
            }
            
            let html = `<div style="font-size:13px;margin-bottom:8px;"><strong>Total: ${qcQueue.length} features</strong></div>`;
            html += '<div style="font-size:11px;line-height:1.8;">';
            
            Object.keys(layerCounts).forEach(layerName => {
                html += `<div>• ${layerName}: <strong>${layerCounts[layerName]}</strong></div>`;
            });
            
            html += '</div>';
            
            if (layerErrors.length > 0) {
                html += `
                    <div style="padding:6px;background:#fff3cd;border:1px solid #ffeaa7;border-radius:3px;margin-top:8px;font-size:10px;">
                        <strong>⚠️ Warning:</strong> ${layerErrors.length} layer(s) had query errors and were skipped: ${layerErrors.join(', ')}
                    </div>
                `;
            }
            
            contentDiv.innerHTML = html;
            resultsDiv.style.display = 'block';
            $("#startQcBtn").style.display = 'block';
            
            const statusMsg = `Found ${qcQueue.length} features ready for QC` + 
                             (layerErrors.length > 0 ? ` (${layerErrors.length} layers had errors)` : '');
            updateStatus(statusMsg);
        }
        
        // Start QC Review
        function startQcReview() {
            if (qcQueue.length === 0) {
                alert("No features to review");
                return;
            }
            
            currentIndex = 0;
            sessionLog = [];
            sessionStartTime = new Date();
            
            setPhase('review');
            showCurrentFeature();
        }
        
        function showCurrentFeature() {
            if (currentIndex >= qcQueue.length) {
                completeSession();
                return;
            }
            
            const item = qcQueue[currentIndex];
            
            // Update progress
            const progress = ((currentIndex + 1) / qcQueue.length) * 100;
            $("#progressBar").style.width = progress + "%";
            $("#progressText").textContent = `${currentIndex + 1} of ${qcQueue.length}`;
            
            // Display feature info
            displayFeatureInfo(item);
            
            // Reset form
            resetQcForm();
            
            // Start timer
            startFeatureTimer();
            
            // Update button states
            $("#prevFeatureBtn").disabled = currentIndex === 0;
            
            // Automatically show popup for this feature (async, don't wait)
            showFeaturePopup(item);
            
            updateStatus(`Reviewing feature ${currentIndex + 1} of ${qcQueue.length}`);
        }
        
        function displayFeatureInfo(item) {
            const attrs = item.feature.attributes;
            
            let html = `
                <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:11px;">
                    <strong>GIS ID:</strong> <span>${item.gisId}</span>
                    <strong>Layer:</strong> <span>${item.layer.title}</span>
                    <strong>Work Order:</strong> <span>${attrs.workorder_id || 'N/A'}</span>
            `;
            
            if (attrs.installation_date) {
                const date = new Date(attrs.installation_date);
                html += `<strong>Install Date:</strong> <span>${date.toLocaleDateString()}</span>`;
            }
            
            html += '</div>';
            
            $("#featureInfoContent").innerHTML = html;
        }
        
        function resetQcForm() {
            // Clear radio buttons
            toolBox.querySelectorAll("input[name='qcDecision']").forEach(radio => radio.checked = false);
            
            // Hide issue types section
            $("#issueTypesSection").style.display = 'none';
            
            // Clear notes
            $("#qcNotes").value = '';
            
            // Setup issue types checkboxes
            setupIssueTypesSection();
        }
        
        function setupIssueTypesSection() {
            const searchInput = $("#issueTypeSearch");
            const listDiv = $("#issueTypesList");
            
            function renderIssueTypes(filterText = '') {
                listDiv.innerHTML = '';
                const filter = filterText.toLowerCase();
                
                const filtered = gigTypes.filter(gt => 
                    gt.name.toLowerCase().includes(filter) || 
                    String(gt.code).toLowerCase().includes(filter)
                );
                
                if (filtered.length === 0) {
                    listDiv.innerHTML = '<div style="color:#999;text-align:center;padding:8px;">No matches found</div>';
                } else {
                    filtered.forEach(gt => {
                        const label = document.createElement('label');
                        label.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px;cursor:pointer;';
                        label.innerHTML = `
                            <input type="checkbox" class="issueTypeCheck" data-code="${gt.code}" data-name="${gt.name}" style="margin:0;">
                            <span style="font-size:11px;">${gt.name}</span>
                        `;
                        listDiv.appendChild(label);
                    });
                }
            }
            
            renderIssueTypes();
            
            searchInput.oninput = () => {
                renderIssueTypes(searchInput.value);
            };
            
            // Show/hide issue types section based on Pass/Fail/Missing Photo selection
            $("#qcPass").onchange = () => {
                $("#issueTypesSection").style.display = 'none';
            };
            
            $("#qcFail").onchange = () => {
                $("#issueTypesSection").style.display = 'block';
            };
            
            $("#qcMissingPhoto").onchange = () => {
                $("#issueTypesSection").style.display = 'none';
            };
        }
        
        function startFeatureTimer() {
            // Clear existing timer
            if (featureTimerInterval) {
                clearInterval(featureTimerInterval);
            }
            
            currentFeatureStartTime = new Date();
            
            featureTimerInterval = setInterval(() => {
                const elapsed = Math.floor((new Date() - currentFeatureStartTime) / 1000);
                const minutes = Math.floor(elapsed / 60);
                const seconds = elapsed % 60;
                $("#featureTimer").textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            }, 1000);
        }
        
        function stopFeatureTimer() {
            if (featureTimerInterval) {
                clearInterval(featureTimerInterval);
                featureTimerInterval = null;
            }
        }
        
        function getFeatureTimeSpent() {
            if (currentFeatureStartTime) {
                return Math.floor((new Date() - currentFeatureStartTime) / 1000);
            }
            return 0;
        }
        
        // Zoom to feature
        function zoomToFeature() {
            const item = qcQueue[currentIndex];
            
            mapView.goTo({
                target: item.feature.geometry,
                scale: Math.min(mapView.scale, 2000)
            }).catch(err => {
                console.error("Error zooming to feature:", err);
            });
        }
        
        // Show popup for current feature
        async function showFeaturePopup(item) {
            try {
                if (!item) {
                    item = qcQueue[currentIndex];
                }
                
                // Clear any existing highlight
                if (highlightHandle) {
                    highlightHandle.remove();
                    highlightHandle = null;
                }
                
                // Query the feature fresh to get all attributes and ensure popup config
                const oidField = item.layer.objectIdField;
                const oid = item.feature.attributes[oidField];
                
                const queryResult = await item.layer.queryFeatures({
                    where: `${oidField} = ${oid}`,
                    outFields: ['*'],
                    returnGeometry: true
                });
                
                if (queryResult.features.length > 0) {
                    const freshFeature = queryResult.features[0];
                    
                    // Create highlight
                    mapView.whenLayerView(item.layer).then(layerView => {
                        highlightHandle = layerView.highlight(oid);
                    }).catch(err => {
                        console.error("Error highlighting feature:", err);
                    });
                    
                    // Open popup with fresh feature
                    mapView.popup.open({
                        features: [freshFeature],
                        location: getPopupLocation(freshFeature.geometry),
                        updateLocationEnabled: false
                    });
                } else {
                    // Fallback to original feature
                    mapView.whenLayerView(item.layer).then(layerView => {
                        highlightHandle = layerView.highlight(oid);
                    }).catch(err => {
                        console.error("Error highlighting feature:", err);
                    });
                    
                    mapView.popup.open({
                        features: [item.feature],
                        location: getPopupLocation(item.feature.geometry),
                        updateLocationEnabled: false
                    });
                }
                
            } catch (error) {
                console.error("Error showing popup:", error);
                updateStatus("Error showing popup: " + error.message);
                
                // Fallback: try to show popup with original feature
                try {
                    mapView.popup.open({
                        features: [item.feature],
                        location: getPopupLocation(item.feature.geometry),
                        updateLocationEnabled: false
                    });
                } catch (fallbackError) {
                    console.error("Fallback popup also failed:", fallbackError);
                }
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
        
        // Helper: Get GIG layer
        function getGigLayer() {
            const gigLayer = mapView.map.allLayers.find(l => l.layerId === 22100);
            if (!gigLayer) {
                throw new Error("GIG layer (22100) not found in map");
            }
            return gigLayer;
        }
        
        // Helper: Get point geometry from any geometry type
        function getGigPointGeometry(geometry) {
            if (geometry.type === "point") {
                return geometry;
            } else if (geometry.type === "polyline") {
                // For polylines, calculate the actual midpoint along the line's length
                if (geometry.paths && geometry.paths[0] && geometry.paths[0].length > 1) {
                    const path = geometry.paths[0];
                    
                    // Calculate total length and segment lengths
                    const segments = [];
                    let totalLength = 0;
                    
                    for (let i = 0; i < path.length - 1; i++) {
                        const x1 = path[i][0];
                        const y1 = path[i][1];
                        const x2 = path[i + 1][0];
                        const y2 = path[i + 1][1];
                        
                        const segmentLength = Math.sqrt(
                            Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2)
                        );
                        
                        segments.push({
                            start: [x1, y1],
                            end: [x2, y2],
                            length: segmentLength,
                            cumulativeLength: totalLength + segmentLength
                        });
                        
                        totalLength += segmentLength;
                    }
                    
                    // Find the midpoint (50% of total length)
                    const targetLength = totalLength / 2;
                    
                    // Find which segment contains the midpoint
                    let currentLength = 0;
                    for (let i = 0; i < segments.length; i++) {
                        const seg = segments[i];
                        
                        if (seg.cumulativeLength >= targetLength) {
                            // This segment contains the midpoint
                            const remainingLength = targetLength - currentLength;
                            const ratio = remainingLength / seg.length;
                            
                            // Interpolate along this segment
                            const x = seg.start[0] + (seg.end[0] - seg.start[0]) * ratio;
                            const y = seg.start[1] + (seg.end[1] - seg.start[1]) * ratio;
                            
                            return {
                                type: "point",
                                x: x,
                                y: y,
                                spatialReference: geometry.spatialReference
                            };
                        }
                        
                        currentLength = seg.cumulativeLength;
                    }
                    
                    // Fallback to last point if something went wrong
                    const lastPoint = path[path.length - 1];
                    return {
                        type: "point",
                        x: lastPoint[0],
                        y: lastPoint[1],
                        spatialReference: geometry.spatialReference
                    };
                }
            } else if (geometry.type === "polygon") {
                // For polygons, use centroid
                if (geometry.centroid) {
                    return geometry.centroid;
                }
                
                // Calculate centroid manually for polygon
                if (geometry.rings && geometry.rings[0]) {
                    const ring = geometry.rings[0];
                    let sumX = 0, sumY = 0;
                    for (let i = 0; i < ring.length - 1; i++) {
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
            
            // Fallback to geometry extent center
            if (geometry.extent && geometry.extent.center) {
                return geometry.extent.center;
            }
            
            throw new Error("Unable to determine point location from geometry");
        }
        
        // Helper: Build GIG point attributes
        function buildGigAttributes(sourceFeature, gigType, gigStatus) {
            const attrs = sourceFeature.attributes;
            
            return {
                billing_area_code: attrs.gis_id || attrs.GIS_ID || attrs.gisid,
                client_code: attrs.client_code,
                project_id: attrs.project_id,
                job_number: attrs.job_number,
                purchase_order_id: attrs.purchase_order_id,
                workorder_id: attrs.workorder_id,
                workflow_stage: attrs.workflow_stage,
                workflow_status: attrs.workflow_status,
                supervisor: attrs.supervisor,
                crew: attrs.crew,
                construction_subcontractor: attrs.construction_subcontractor,
                gig_type: gigType,
                gig_status: gigStatus
            };
        }
        
        // Submit QC
        async function submitQc() {
            const item = qcQueue[currentIndex];
            
            // Validate form
            const decision = toolBox.querySelector("input[name='qcDecision']:checked");
            if (!decision) {
                alert("Please select Pass, Fail, or Missing Photo");
                return;
            }
            
            const decisionValue = decision.value; // 'pass', 'fail', or 'missing_photo'
            
            // If failed, check for issue types
            let selectedIssueTypes = [];
            if (decisionValue === 'fail') {
                const checkedBoxes = toolBox.querySelectorAll('.issueTypeCheck:checked');
                if (checkedBoxes.length === 0) {
                    alert("Please select at least one issue type for failed features");
                    return;
                }
                
                selectedIssueTypes = Array.from(checkedBoxes).map(cb => ({
                    code: cb.dataset.code,
                    name: cb.dataset.name
                }));
            }
            
            const notes = $("#qcNotes").value.trim();
            const timeSpent = getFeatureTimeSpent();
            
            try {
                updateStatus("Processing QC decision...");
                $("#submitQcBtn").disabled = true;
                
             // Determine GIG status and workflow status based on decision
let gigStatus, newWorkflowStatus, gigPointsToCreate, shouldUpdateFeature;

if (decisionValue === 'pass') {
    gigStatus = 'PASS';
    newWorkflowStatus = 'QCCMPLT';
    gigPointsToCreate = [{ gigType: null, gigStatus: 'PASS' }];
    shouldUpdateFeature = true;
} else if (decisionValue === 'fail') {
    gigStatus = 'OPEN';
    newWorkflowStatus = 'QCINPROG';
    gigPointsToCreate = selectedIssueTypes.map(it => ({ 
        gigType: it.code, 
        gigStatus: 'OPEN' 
    }));
    shouldUpdateFeature = true;
} else if (decisionValue === 'missing_photo') {
    gigStatus = 'MISSING_PHOTO';
    newWorkflowStatus = null; // Not used since we skip update
    gigPointsToCreate = [{ gigType: null, gigStatus: 'MISSING_PHOTO' }];
    shouldUpdateFeature = false; // Skip feature update
}
                
                // Show progress
                updateStatus(`Creating ${gigPointsToCreate.length} GIG point(s)...`);
                
                // Get GIG layer
                const gigLayer = getGigLayer();
                await gigLayer.load();
                
                // Get point geometry for GIG points
                const gigGeometry = getGigPointGeometry(item.feature.geometry);
                
                // Build GIG features to add
                const gigFeaturesToAdd = gigPointsToCreate.map(gp => ({
                    geometry: gigGeometry,
                    attributes: buildGigAttributes(item.feature, gp.gigType, gp.gigStatus)
                }));
                
                // Add GIG points
                updateStatus(`Adding ${gigFeaturesToAdd.length} GIG point(s)...`);
                const gigResult = await gigLayer.applyEdits({
                    addFeatures: gigFeaturesToAdd
                });
                
                // Check GIG creation results
                if (!gigResult.addFeatureResults || gigResult.addFeatureResults.length === 0) {
                    throw new Error('No GIG point creation results returned');
                }
                
                const gigSuccessCount = gigResult.addFeatureResults.filter(r => 
                    r.success === true || 
                    (r.success === undefined && r.error === null && (r.objectId || r.globalId))
                ).length;
                
                const gigFailCount = gigResult.addFeatureResults.length - gigSuccessCount;
                
                if (gigFailCount > 0) {
                    const errors = gigResult.addFeatureResults
                        .filter(r => !(r.success === true || (r.success === undefined && r.error === null)))
                        .map(r => r.error?.message || 'Unknown error')
                        .join(', ');
                    throw new Error(`Failed to create ${gigFailCount} GIG point(s): ${errors}`);
                }
                
               // Update feature workflow_status (skip for missing photo)
if (shouldUpdateFeature) {
    updateStatus("Updating feature workflow status...");
    
    const oidField = item.layer.objectIdField;
    const oid = item.feature.attributes[oidField];
    
    const updateFeature = {
        attributes: {
            [oidField]: oid,
            workflow_status: newWorkflowStatus
        }
    };
    
    const featureResult = await item.layer.applyEdits({
        updateFeatures: [updateFeature]
    });
    
    if (featureResult.updateFeatureResults && featureResult.updateFeatureResults.length > 0) {
        const updateResult = featureResult.updateFeatureResults[0];
        
        const isSuccess = updateResult.success === true || 
                        (updateResult.success === undefined && 
                         updateResult.error === null && 
                         (updateResult.objectId || updateResult.globalId));
        
        if (!isSuccess) {
            throw new Error(updateResult.error?.message || 'Feature update failed');
        }
    } else {
        throw new Error('No feature update results returned');
    }
} else {
    updateStatus("Skipping feature update (Missing Photo - feature remains CMPLT)");
}
                
                // Log the successful QC action
                const logEntry = {
                    timestamp: new Date(),
                    action: 'qc_review',
                    layerName: item.layer.title,
                    gisId: item.gisId,
                    decision: decisionValue === 'pass' ? 'Pass' : (decisionValue === 'fail' ? 'Fail' : 'Missing Photo'),
                    gigPointsCreated: gigSuccessCount,
                    issueTypes: selectedIssueTypes,
                    notes: notes,
                    timeSpent: timeSpent,
                    success: true
                };
                
                sessionLog.push(logEntry);
                
                // Success message
                const decisionLabel = decisionValue === 'pass' ? 'passed' : 
                                     (decisionValue === 'fail' ? 'failed' : 'marked as missing photo');
                updateStatus(`Feature ${decisionLabel}! Created ${gigSuccessCount} GIG point(s).`);
                
                // Move to next feature
                stopFeatureTimer();
                currentIndex++;
                
                setTimeout(() => {
                    showCurrentFeature();
                }, 800);
                
            } catch (error) {
                updateStatus("Error submitting QC: " + error.message);
                alert("Error submitting QC: " + error.message + "\n\nNo changes were saved. Please try again.");
                console.error("QC submission error:", error);
                
                // Log the failed attempt
                sessionLog.push({
                    timestamp: new Date(),
                    action: 'qc_review',
                    layerName: item.layer.title,
                    gisId: item.gisId,
                    decision: decisionValue === 'pass' ? 'Pass' : (decisionValue === 'fail' ? 'Fail' : 'Missing Photo'),
                    success: false,
                    error: error.message
                });
                
            } finally {
                $("#submitQcBtn").disabled = false;
            }
        }
        
        // Skip feature
        function skipFeature() {
            const item = qcQueue[currentIndex];
            const timeSpent = getFeatureTimeSpent();
            
            // Log the skip
            sessionLog.push({
                timestamp: new Date(),
                action: 'skip',
                layerName: item.layer.title,
                gisId: item.gisId,
                timeSpent: timeSpent,
                success: true
            });
            
            stopFeatureTimer();
            currentIndex++;
            showCurrentFeature();
        }
        
        // Previous feature
        function prevFeature() {
            if (currentIndex > 0) {
                stopFeatureTimer();
                currentIndex--;
                showCurrentFeature();
            }
        }
        
        // Complete session
        function completeSession() {
            stopFeatureTimer();
            
            // Clear highlight
            if (highlightHandle) {
                highlightHandle.remove();
                highlightHandle = null;
            }
            
            // Close popup
            if (mapView.popup) {
                mapView.popup.close();
            }
            
            displaySessionSummary();
            setPhase('complete');
            updateStatus("QC session complete!");
        }
        
        function displaySessionSummary() {
            const summaryDiv = $("#sessionSummary");
            
            const totalReviewed = sessionLog.filter(e => e.action === 'qc_review').length;
            const passed = sessionLog.filter(e => e.action === 'qc_review' && e.decision === 'Pass').length;
            const failed = sessionLog.filter(e => e.action === 'qc_review' && e.decision === 'Fail').length;
            const missingPhoto = sessionLog.filter(e => e.action === 'qc_review' && e.decision === 'Missing Photo').length;
            const skipped = sessionLog.filter(e => e.action === 'skip').length;
            const errors = sessionLog.filter(e => !e.success).length;
            
            const totalGigPoints = sessionLog
                .filter(e => e.action === 'qc_review' && e.success && e.gigPointsCreated)
                .reduce((sum, e) => sum + e.gigPointsCreated, 0);
            
            const totalTimeSpent = sessionLog.reduce((sum, e) => sum + (e.timeSpent || 0), 0);
            const avgTime = totalReviewed > 0 ? Math.round(totalTimeSpent / totalReviewed) : 0;
            
            const passRate = totalReviewed > 0 ? Math.round((passed / totalReviewed) * 100) : 0;
            
            const sessionDuration = sessionStartTime ? Math.floor((new Date() - sessionStartTime) / 1000) : 0;
            const sessionMinutes = Math.floor(sessionDuration / 60);
            const sessionSeconds = sessionDuration % 60;
            
            summaryDiv.innerHTML = `
                <div style="font-weight:bold;margin-bottom:8px;font-size:13px;">Session Summary</div>
                <div style="font-size:11px;line-height:1.8;">
                    <strong>Total Features Reviewed:</strong> ${totalReviewed}<br>
                    <strong style="color:#28a745;">Passed:</strong> ${passed}<br>
                    <strong style="color:#dc3545;">Failed:</strong> ${failed}<br>
                    <strong style="color:#ffc107;">Missing Photo:</strong> ${missingPhoto}<br>
                    ${skipped > 0 ? `<strong>Skipped:</strong> ${skipped}<br>` : ''}
                    ${errors > 0 ? `<strong style="color:#dc3545;">Errors:</strong> ${errors}<br>` : ''}
                    <strong>Pass Rate:</strong> ${passRate}%<br>
                    <strong style="color:#17a2b8;">GIG Points Created:</strong> ${totalGigPoints}<br>
                    <strong>Avg Time per Feature:</strong> ${Math.floor(avgTime / 60)}:${(avgTime % 60).toString().padStart(2, '0')}<br>
                    <strong>Total Session Time:</strong> ${sessionMinutes}:${sessionSeconds.toString().padStart(2, '0')}
                </div>
            `;
        }
        
        // Export report
        function exportReport() {
            if (sessionLog.length === 0) {
                alert('No QC data to export');
                return;
            }
            
            const sessionEnd = new Date();
            const duration = sessionStartTime ? Math.floor((sessionEnd - sessionStartTime) / 1000) : 0;
            
            let report = '='.repeat(80) + '\n';
            report += 'REMOTE QC WORKFLOW - SESSION REPORT\n';
            report += '='.repeat(80) + '\n\n';
            
            report += 'SESSION INFORMATION\n';
            report += '-'.repeat(80) + '\n';
            report += `Start Time: ${sessionStartTime ? sessionStartTime.toLocaleString() : 'Unknown'}\n`;
            report += `End Time: ${sessionEnd.toLocaleString()}\n`;
            report += `Duration: ${Math.floor(duration / 60)}m ${duration % 60}s\n\n`;
            
            // Summary statistics
            const totalReviewed = sessionLog.filter(e => e.action === 'qc_review').length;
            const passed = sessionLog.filter(e => e.action === 'qc_review' && e.decision === 'Pass').length;
            const failed = sessionLog.filter(e => e.action === 'qc_review' && e.decision === 'Fail').length;
            const missingPhoto = sessionLog.filter(e => e.action === 'qc_review' && e.decision === 'Missing Photo').length;
            const skipped = sessionLog.filter(e => e.action === 'skip').length;
            const errors = sessionLog.filter(e => !e.success).length;
            const passRate = totalReviewed > 0 ? Math.round((passed / totalReviewed) * 100) : 0;
            
            const totalGigPoints = sessionLog
                .filter(e => e.action === 'qc_review' && e.success && e.gigPointsCreated)
                .reduce((sum, e) => sum + e.gigPointsCreated, 0);
            
            report += 'SUMMARY STATISTICS\n';
            report += '-'.repeat(80) + '\n';
            report += `Total Features Reviewed: ${totalReviewed}\n`;
            report += `Passed: ${passed}\n`;
            report += `Failed: ${failed}\n`;
            report += `Missing Photo: ${missingPhoto}\n`;
            report += `Skipped: ${skipped}\n`;
            if (errors > 0) report += `Errors: ${errors}\n`;
            report += `Pass Rate: ${passRate}%\n`;
            report += `GIG Points Created: ${totalGigPoints}\n\n`;
            
            // By layer breakdown
            const layerStats = {};
            sessionLog.forEach(entry => {
                if (!layerStats[entry.layerName]) {
                    layerStats[entry.layerName] = { passed: 0, failed: 0, missingPhoto: 0, skipped: 0 };
                }
                
                if (entry.action === 'qc_review' && entry.success) {
                    if (entry.decision === 'Pass') {
                        layerStats[entry.layerName].passed++;
                    } else if (entry.decision === 'Fail') {
                        layerStats[entry.layerName].failed++;
                    } else if (entry.decision === 'Missing Photo') {
                        layerStats[entry.layerName].missingPhoto++;
                    }
                } else if (entry.action === 'skip') {
                    layerStats[entry.layerName].skipped++;
                }
            });
            
            report += 'BY LAYER\n';
            report += '-'.repeat(80) + '\n';
            Object.keys(layerStats).forEach(layerName => {
                const stats = layerStats[layerName];
                report += `${layerName}:\n`;
                report += `  Passed: ${stats.passed}\n`;
                report += `  Failed: ${stats.failed}\n`;
                report += `  Missing Photo: ${stats.missingPhoto}\n`;
                if (stats.skipped > 0) report += `  Skipped: ${stats.skipped}\n`;
            });
            report += '\n';
            
            // Detailed log
            report += 'DETAILED QC LOG\n';
            report += '='.repeat(80) + '\n\n';
            
            sessionLog.forEach((entry, idx) => {
                report += `[${idx + 1}] ${entry.timestamp.toLocaleTimeString()}\n`;
                report += `GIS ID: ${entry.gisId}\n`;
                report += `Layer: ${entry.layerName}\n`;
                report += `Action: ${entry.action.toUpperCase()}\n`;
                
                if (entry.action === 'qc_review') {
                    report += `Decision: ${entry.decision}\n`;
                    report += `Status: ${entry.success ? 'SUCCESS' : 'FAILED'}\n`;
                    
                    if (entry.gigPointsCreated) {
                        report += `GIG Points Created: ${entry.gigPointsCreated}\n`;
                    }
                    
                    if (entry.decision === 'Fail' && entry.issueTypes && entry.issueTypes.length > 0) {
                        report += `Issue Types:\n`;
                        entry.issueTypes.forEach(it => {
                            report += `  - ${it.name}\n`;
                        });
                    }
                    
                    if (entry.notes) {
                        report += `Notes: ${entry.notes}\n`;
                    }
                }
                
                if (entry.timeSpent) {
                    report += `Time Spent: ${Math.floor(entry.timeSpent / 60)}:${(entry.timeSpent % 60).toString().padStart(2, '0')}\n`;
                }
                
                if (entry.error) {
                    report += `Error: ${entry.error}\n`;
                }
                
                report += '\n';
            });
            
            report += '='.repeat(80) + '\n';
            report += 'END OF REPORT\n';
            report += '='.repeat(80) + '\n';
            
            // Create download
            const blob = new Blob([report], { type: 'text/plain' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `qc-report-${sessionEnd.toISOString().split('T')[0]}-${sessionEnd.getHours()}${sessionEnd.getMinutes()}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            updateStatus('Report exported successfully!');
        }
        
        // Start over
        function startOver() {
            currentIndex = 0;
            qcQueue = [];
            sessionLog = [];
            sessionStartTime = null;
            
            stopFeatureTimer();
            
            if (highlightHandle) {
                highlightHandle.remove();
                highlightHandle = null;
            }
            
            if (mapView.popup) {
                mapView.popup.close();
            }
            
            $("#queryResults").style.display = 'none';
            $("#workOrderSearch").value = '';
            $("#workOrderSearch").dataset.selectedCode = '';
            $("#dateFrom").value = '';
            $("#dateTo").value = '';
            $("#sortOrder").value = 'desc';
            
            setPhase('query');
            updateStatus("Ready to start new session");
        }
        
        // Cleanup
        function cleanup() {
            stopFeatureTimer();
            
            if (highlightHandle) {
                highlightHandle.remove();
            }
            
            if (mapView.popup) {
                mapView.popup.close();
            }
            
            toolBox.remove();
        }
        
        // Event listeners
        $("#queryFeaturesBtn").onclick = queryFeatures;
        $("#refreshQueryBtn").onclick = queryFeatures;
        $("#startQcBtn").onclick = startQcReview;
        
        $("#zoomToFeatureBtn").onclick = zoomToFeature;
        
        $("#submitQcBtn").onclick = submitQc;
        $("#skipFeatureBtn").onclick = skipFeature;
        $("#prevFeatureBtn").onclick = prevFeature;
        
        $("#exportReportBtn").onclick = exportReport;
        $("#startOverBtn").onclick = startOver;
        
        $("#closeTool").onclick = () => {
            window.gisToolHost.closeTool('remote-qc-workflow');
        };
        
        // Initialize tool
        initialize();
        setPhase('query');
        
        // Register tool with host
        window.gisToolHost.activeTools.set('remote-qc-workflow', {
            cleanup: cleanup,
            toolBox: toolBox
        });
        
    } catch (error) {
        alert("Error creating Remote QC Workflow Tool: " + (error.message || error));
        console.error(error);
    }
})();
