// tools/metrics-by-woid.js - Converted from bookmarklet format
// Layer Metrics Report with Purchase Order and Work Order filtering

(function() {
    try {
        // Check if tool is already active
        if (window.gisToolHost.activeTools.has('metrics-by-woid')) {
            console.log('Metrics By WOID Tool already active');
            return;
        }
        
        // Remove any leftover toolbox
        const existingToolbox = document.getElementById('metricsByWoidToolbox');
        if (existingToolbox) {
            existingToolbox.remove();
            console.log('Removed leftover metrics by woid toolbox');
        }
        
        // Use shared utilities
        const utils = window.gisSharedUtils;
        if (!utils) {
            throw new Error('Shared utilities not loaded');
        }
        
        const mapView = utils.getMapView();
        
        // Target layers configuration
        const targetLayers = [
            {id: 41050, name: "Fiber Cable", metric: "sum", field: "calculated_length", additionalFilter: "cable_category <> 'DROP'"},
            {id: 42050, name: "Underground Span", metric: "sum", field: "calculated_length"},
            {id: 43050, name: "Aerial Span", metric: "sum", field: "calculated_length", additionalFilter: "physical_status <> 'EXISTINGINFRASTRUCTURE'"},
            {id: 42100, name: "Vault", metric: "count", field: "objectid"},
            {id: 41150, name: "Splice Closure", metric: "count", field: "objectid"},
            {id: 41100, name: "Fiber Equipment", metric: "count", field: "objectid"}
        ];
        
        const z = 99999;
        
        // Tool state variables
        let selectedWorkorders = [];
        let allWorkorders = [];
        let selectedPurchaseOrders = [];
        let allPurchaseOrders = [];
        let currentTableData = [];
        
        // Create tool UI
        const toolBox = document.createElement("div");
        toolBox.id = "metricsByWoidToolbox";
        toolBox.style.cssText = `
            position: fixed;
            top: 80px;
            right: 40px;
            z-index: ${z};
            background: #fff;
            border: 1px solid #333;
            padding: 12px;
            max-width: 90vw;
            max-height: 80vh;
            overflow: auto;
            font: 12px/1.3 Arial, sans-serif;
            box-shadow: 0 4px 16px rgba(0,0,0,.2);
        `;
        
        toolBox.innerHTML = `
            <div style="font-weight:bold;margin-bottom:8px;">📊 Layer Metrics Report</div>
            
            <label>Purchase Order ID:</label><br>
            <div style="position:relative;margin:4px 0 8px 0;">
                <div id="purchaseDropdown" style="width:100%;border:1px solid #ccc;padding:4px;background:#fff;cursor:pointer;min-height:20px;">
                    <span id="purchasePlaceholder" style="color:#999;">Loading purchase orders...</span>
                </div>
                <div id="purchaseOptions" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid #ccc;border-top:none;max-height:150px;overflow-y:auto;z-index:1000;"></div>
            </div>
            
            <label>Work Order ID:</label><br>
            <div style="position:relative;margin:4px 0 8px 0;">
                <div id="workorderDropdown" style="width:100%;border:1px solid #ccc;padding:4px;background:#fff;cursor:pointer;min-height:20px;">
                    <span id="workorderPlaceholder" style="color:#999;">Loading work orders...</span>
                </div>
                <div id="workorderOptions" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid #ccc;border-top:none;max-height:150px;overflow-y:auto;z-index:1000;"></div>
            </div>
            
            <div style="display:flex;gap:8px;margin:4px 0 8px 0;">
                <div style="flex:1;">
                    <label>Start date</label><br>
                    <input type="date" id="startDate" style="width:100%;">
                </div>
                <div style="flex:1;">
                    <label>End date</label><br>
                    <input type="date" id="endDate" style="width:100%;">
                </div>
                <div style="flex:0;">
                    <label>&nbsp;</label><br>
                    <button id="allTimeBtn" style="height:100%;padding:0 12px;">All Time</button>
                </div>
            </div>
            
            <div style="display:flex;gap:8px;">
                <button id="runBtn">Run Report</button>
                <button id="exportBtn" style="display:none;">Export CSV</button>
                <button id="clearBtn" style="display:none;">Clear Filters</button>
                <button id="closeTool">Close</button>
            </div>
            
            <div id="toolStatus" style="margin-top:8px;color:#3367d6;"></div>
            <div id="resultsTable" style="margin-top:12px;"></div>
        `;
        
        // Add to page
        document.body.appendChild(toolBox);
        
        // Get UI elements
        const $ = (id) => toolBox.querySelector(id);
        const status = $("#toolStatus");
        
        function updateStatus(message) {
            status.textContent = message;
        }
        
        // Load purchase orders from fiber layer
        async function loadPurchaseOrders() {
            try {
                const allFL = mapView.map.allLayers.filter(l => l.type === "feature");
                const fiberLayer = allFL.find(l => l.layerId === 41050);
                
                if (!fiberLayer) {
                    $("#purchasePlaceholder").textContent = "No fiber layer found";
                    return;
                }
                
                await fiberLayer.load();
                const uniqueQuery = await fiberLayer.queryFeatures({
                    where: "purchase_order_id IS NOT NULL AND purchase_order_id <> ''",
                    outFields: ["purchase_order_id"],
                    returnGeometry: false,
                    returnDistinctValues: true
                });
                
                const uniqueValues = [...new Set(
                    uniqueQuery.features
                        .map(f => f.attributes.purchase_order_id)
                        .filter(v => v && v.toString().trim())
                )].sort();
                
                let purchaseField;
                try {
                    purchaseField = fiberLayer.fields.find(f => f.name === "purchase_order_id");
                } catch (e) {
                    console.log("Could not access field info for aliases");
                }
                
                allPurchaseOrders = uniqueValues.map(value => {
                    let displayName = value;
                    if (purchaseField && purchaseField.domain && purchaseField.domain.codedValues) {
                        const codedValue = purchaseField.domain.codedValues.find(cv => cv.code === value);
                        if (codedValue) displayName = codedValue.name;
                    }
                    return { code: value, name: displayName };
                });
                
                if (!allPurchaseOrders.length) {
                    $("#purchasePlaceholder").textContent = "No purchase orders found";
                    return;
                }
                
                const optionsHtml = allPurchaseOrders.map(po => `
                    <div class="purchase-option" data-value="${po.code.toString().replace(/"/g, '&quot;')}" style="padding:6px;cursor:pointer;border-bottom:1px solid #eee;">
                        <input type="checkbox" style="margin-right:6px;"> ${po.name}
                    </div>
                `).join('');
                
                $("#purchaseOptions").innerHTML = optionsHtml;
                $("#purchasePlaceholder").textContent = "Select purchase orders...";
                
                $("#purchaseDropdown").onclick = () => {
                    $("#purchaseOptions").style.display = $("#purchaseOptions").style.display === 'none' ? 'block' : 'none';
                };
                
                $("#purchaseOptions").addEventListener('click', (e) => {
                    if (e.target.classList.contains('purchase-option') || e.target.type === 'checkbox') {
                        const option = e.target.classList.contains('purchase-option') ? e.target : e.target.parentElement;
                        const checkbox = option.querySelector('input[type="checkbox"]');
                        const value = option.dataset.value;
                        
                        checkbox.checked = !checkbox.checked;
                        
                        if (checkbox.checked) {
                            if (!selectedPurchaseOrders.includes(value)) {
                                selectedPurchaseOrders.push(value);
                            }
                        } else {
                            selectedPurchaseOrders = selectedPurchaseOrders.filter(p => p !== value);
                        }
                        
                        updatePurchaseDropdownDisplay();
                        e.stopPropagation();
                    }
                });
                
            } catch (error) {
                console.error("Error loading purchase orders:", error);
                $("#purchasePlaceholder").textContent = "Error loading purchase orders";
            }
        }
        
        function updatePurchaseDropdownDisplay() {
            const placeholder = $("#purchasePlaceholder");
            
            if (selectedPurchaseOrders.length === 0) {
                placeholder.textContent = "Select purchase orders...";
                placeholder.style.color = "#999";
            } else if (selectedPurchaseOrders.length === 1) {
                const selected = allPurchaseOrders.find(p => p.code.toString() === selectedPurchaseOrders[0]);
                placeholder.textContent = selected ? selected.name : selectedPurchaseOrders[0];
                placeholder.style.color = "#000";
            } else {
                placeholder.textContent = `${selectedPurchaseOrders.length} purchase orders selected`;
                placeholder.style.color = "#000";
            }
        }
        
        // Load work orders from fiber layer
        async function loadWorkorders() {
            try {
                const allFL = mapView.map.allLayers.filter(l => l.type === "feature");
                const fiberLayer = allFL.find(l => l.layerId === 41050);
                
                if (!fiberLayer) {
                    $("#workorderPlaceholder").textContent = "No fiber layer found";
                    return;
                }
                
                await fiberLayer.load();
                const uniqueQuery = await fiberLayer.queryFeatures({
                    where: "workorder_id IS NOT NULL AND workorder_id <> ''",
                    outFields: ["workorder_id"],
                    returnGeometry: false,
                    returnDistinctValues: true
                });
                
                const uniqueValues = [...new Set(
                    uniqueQuery.features
                        .map(f => f.attributes.workorder_id)
                        .filter(v => v && v.toString().trim())
                )].sort();
                
                let workorderField;
                try {
                    workorderField = fiberLayer.fields.find(f => f.name === "workorder_id");
                } catch (e) {
                    console.log("Could not access field info for aliases");
                }
                
                allWorkorders = uniqueValues.map(value => {
                    let displayName = value;
                    if (workorderField && workorderField.domain && workorderField.domain.codedValues) {
                        const codedValue = workorderField.domain.codedValues.find(cv => cv.code === value);
                        if (codedValue) displayName = codedValue.name;
                    }
                    return { code: value, name: displayName };
                });
                
                if (!allWorkorders.length) {
                    $("#workorderPlaceholder").textContent = "No work orders found";
                    return;
                }
                
                const optionsHtml = allWorkorders.map(wo => `
                    <div class="workorder-option" data-value="${wo.code.toString().replace(/"/g, '&quot;')}" style="padding:6px;cursor:pointer;border-bottom:1px solid #eee;">
                        <input type="checkbox" style="margin-right:6px;"> ${wo.name}
                    </div>
                `).join('');
                
                $("#workorderOptions").innerHTML = optionsHtml;
                $("#workorderPlaceholder").textContent = "Select work orders...";
                
                $("#workorderDropdown").onclick = () => {
                    $("#workorderOptions").style.display = $("#workorderOptions").style.display === 'none' ? 'block' : 'none';
                };
                
                $("#workorderOptions").addEventListener('click', (e) => {
                    if (e.target.classList.contains('workorder-option') || e.target.type === 'checkbox') {
                        const option = e.target.classList.contains('workorder-option') ? e.target : e.target.parentElement;
                        const checkbox = option.querySelector('input[type="checkbox"]');
                        const value = option.dataset.value;
                        
                        checkbox.checked = !checkbox.checked;
                        
                        if (checkbox.checked) {
                            if (!selectedWorkorders.includes(value)) {
                                selectedWorkorders.push(value);
                            }
                        } else {
                            selectedWorkorders = selectedWorkorders.filter(w => w !== value);
                        }
                        
                        updateWorkorderDropdownDisplay();
                        e.stopPropagation();
                    }
                });
                
            } catch (error) {
                console.error("Error loading work orders:", error);
                $("#workorderPlaceholder").textContent = "Error loading work orders";
            }
        }
        
        function updateWorkorderDropdownDisplay() {
            const placeholder = $("#workorderPlaceholder");
            
            if (selectedWorkorders.length === 0) {
                placeholder.textContent = "Select work orders...";
                placeholder.style.color = "#999";
            } else if (selectedWorkorders.length === 1) {
                const selected = allWorkorders.find(w => w.code.toString() === selectedWorkorders[0]);
                placeholder.textContent = selected ? selected.name : selectedWorkorders[0];
                placeholder.style.color = "#000";
            } else {
                placeholder.textContent = `${selectedWorkorders.length} work orders selected`;
                placeholder.style.color = "#000";
            }
        }
        
        // Date controls
        $("#allTimeBtn").onclick = () => {
            $("#startDate").value = "";
            $("#endDate").value = "";
            $("#startDate").disabled = true;
            $("#endDate").disabled = true;
            $("#allTimeBtn").style.background = "#3367d6";
            $("#allTimeBtn").style.color = "#fff";
        };
        
        $("#startDate").onclick = $("#endDate").onclick = () => {
            $("#startDate").disabled = false;
            $("#endDate").disabled = false;
            $("#allTimeBtn").style.background = "";
            $("#allTimeBtn").style.color = "";
        };
        
        // Build filter clause for queries
        function buildFilterClause() {
            const clauses = [];
            
            if (selectedPurchaseOrders.length > 0) {
                const purchaseClause = selectedPurchaseOrders
                    .map(po => `purchase_order_id='${po.toString().replace(/'/g, "''")}'`)
                    .join(' OR ');
                clauses.push(`(${purchaseClause})`);
            }
            
            if (selectedWorkorders.length > 0) {
                const workorderClause = selectedWorkorders
                    .map(wo => `workorder_id='${wo.toString().replace(/'/g, "''")}'`)
                    .join(' OR ');
                clauses.push(`(${workorderClause})`);
            }
            
            return clauses.length > 0 ? clauses.join(' OR ') : "1=1";
        }
        
        // CSV export utility
        const csvEsc = (v) => {
            if (v == null) v = "";
            v = String(v);
            return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        };
        
        // Export CSV function
        $("#exportBtn").onclick = () => {
            if (!currentTableData.length) return alert("No data to export");
            
            const csvRows = [["Category", ...targetLayers.map(l => l.name)]];
            currentTableData.forEach(row => {
                csvRows.push([csvEsc(row.category), ...row.values.map(v => csvEsc(v))]);
            });
            
            const csv = csvRows.map(r => r.join(",")).join("\n");
            const dateRange = $("#startDate").disabled ? "all_time" : `${$("#startDate").value}_${$("#endDate").value}`;
            const file = `layer_metrics_${dateRange}.csv`;
            
            const blob = new Blob([csv], {type: "text/csv;charset=utf-8"});
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = file;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        };
        
        // Clear map filters
        $("#clearBtn").onclick = async () => {
            try {
                const allFL = mapView.map.allLayers.filter(l => l.type === "feature");
                allFL.forEach(layer => {
                    if (layer.definitionExpression) {
                        layer.definitionExpression = "";
                    }
                });
                updateStatus("Map filters cleared.");
                $("#clearBtn").style.display = "none";
            } catch (error) {
                console.error("Error clearing filters:", error);
                updateStatus("Error clearing filters.");
            }
        };
        
        // Global function for filtering map by category
        window.filterMapByCategory = async function(categoryName, categoryData) {
            try {
                updateStatus(`Applying ${categoryName} filters to map...`);
                
                const allFL = mapView.map.allLayers.filter(l => l.type === "feature");
                
                for (const layer of allFL) {
                    const targetLayer = targetLayers.find(tl => tl.id === layer.layerId);
                    if (!targetLayer) continue;
                    
                    await layer.load();
                    
                    const filterClause = buildFilterClause();
                    let statusClause;
                    
                    if (categoryData.includeStatuses) {
                        statusClause = categoryData.includeStatuses.map(status => `workflow_status = '${status}'`).join(' OR ');
                    } else if (categoryData.excludeStatuses) {
                        statusClause = categoryData.excludeStatuses.map(status => `workflow_status <> '${status}'`).join(' AND ');
                    }
                    
                    if (categoryData.requireStage) {
                        const stageClause = `workflow_stage = '${categoryData.requireStage}'`;
                        statusClause = statusClause ? `(${statusClause}) AND ${stageClause}` : stageClause;
                    }
                    
                    let additionalFilter = "";
                    if (targetLayer.additionalFilter) {
                        additionalFilter = ` AND ${targetLayer.additionalFilter}`;
                    }
                    
                    const start = $("#startDate").value;
                    const end = $("#endDate").value;
                    const allTimeMode = $("#startDate").disabled;
                    let baseDateClause = "";
                    
                    if (!allTimeMode) {
                        const startLit = `TIMESTAMP '${start} 00:00:00'`;
                        const endLit = `TIMESTAMP '${end} 23:59:59'`;
                        baseDateClause = ` AND installation_date >= ${startLit} AND installation_date <= ${endLit}`;
                    }
                    
                    const fullFilter = `(${filterClause}) AND (${statusClause})${additionalFilter}${baseDateClause}`;
                    layer.definitionExpression = fullFilter;
                }
                
                updateStatus(`Map filtered to show ${categoryName} features. Click "Clear Filters" to reset.`);
                $("#clearBtn").style.display = "inline-block";
                
            } catch (error) {
                console.error("Error filtering map:", error);
                updateStatus("Error applying map filters.");
            }
        };
        
        // Main report function
        $("#runBtn").onclick = async () => {
            try {
                const start = $("#startDate").value;
                const end = $("#endDate").value;
                const allTimeMode = $("#startDate").disabled;
                
                if (selectedWorkorders.length === 0 && selectedPurchaseOrders.length === 0) {
                    return alert("Please select at least one work order or purchase order.");
                }
                
                if (!allTimeMode && (!start || !end)) {
                    return alert("Please select both dates or use All Time.");
                }
                
                let s = start, e = end;
                if (!allTimeMode && e < s) [s, e] = [e, s];
                
                const filterClause = buildFilterClause();
                let baseDateClause = "";
                
                if (!allTimeMode) {
                    const startLit = `TIMESTAMP '${s} 00:00:00'`;
                    const endLit = `TIMESTAMP '${e} 23:59:59'`;
                    baseDateClause = ` AND installation_date >= ${startLit} AND installation_date <= ${endLit}`;
                }
                
                const categories = [
                    {name: "Designed", excludeStatuses: ['DNB', 'ONHOLD', 'DEFRD']},
                    {name: "Constructed", excludeStatuses: ['DNB', 'ONHOLD', 'DEFRD', 'NA', 'ASSG', 'INPROG']},
                    {name: "Left to Build", requireStage: 'OSP_CONST', includeStatuses: ['NA']},
                    {name: "Missing Billing", includeStatuses: ['RDYFDLY']}
                ];
                
                const dateRangeText = allTimeMode ? "All Time" : `${s} to ${e}`;
                let selectionText = "";
                
                if (selectedPurchaseOrders.length > 0 && selectedWorkorders.length > 0) {
                    selectionText = `${selectedPurchaseOrders.length} PO(s) and ${selectedWorkorders.length} WO(s)`;
                } else if (selectedPurchaseOrders.length > 0) {
                    selectionText = selectedPurchaseOrders.length === 1 ? selectedPurchaseOrders[0] : `${selectedPurchaseOrders.length} purchase orders`;
                } else {
                    selectionText = selectedWorkorders.length === 1 ? selectedWorkorders[0] : `${selectedWorkorders.length} work orders`;
                }
                
                updateStatus(`Querying layers for ${selectionText} (${dateRangeText})...`);
                $("#resultsTable").innerHTML = "";
                currentTableData = [];
                
                const allFL = mapView.map.allLayers.filter(l => l.type === "feature");
                if (!allFL.length) return alert("No feature layers found.");
                
                const results = [];
                
                for (const category of categories) {
                    const categoryResults = {
                        name: category.name,
                        layers: [],
                        categoryData: category
                    };
                    
                    for (const targetLayer of targetLayers) {
                        try {
                            const layer = allFL.find(l => l.layerId === targetLayer.id);
                            if (!layer) {
                                categoryResults.layers.push({
                                    name: targetLayer.name,
                                    value: "Layer not found",
                                    error: true
                                });
                                continue;
                            }
                            
                            await layer.load();
                            
                            let statusClause;
                            if (category.includeStatuses) {
                                statusClause = category.includeStatuses.map(status => `workflow_status = '${status}'`).join(' OR ');
                            } else if (category.excludeStatuses) {
                                statusClause = category.excludeStatuses.map(status => `workflow_status <> '${status}'`).join(' AND ');
                            }
                            
                            if (category.requireStage) {
                                const stageClause = `workflow_stage = '${category.requireStage}'`;
                                statusClause = statusClause ? `(${statusClause}) AND ${stageClause}` : stageClause;
                            }
                            
                            let additionalFilter = "";
                            if (targetLayer.additionalFilter) {
                                additionalFilter = ` AND ${targetLayer.additionalFilter}`;
                            }
                            
                            const whereClause = `(${filterClause}) AND (${statusClause})${additionalFilter}${baseDateClause}`;
                            
                            const oidField = layer.objectIdField;
                            const outFields = [oidField, targetLayer.field];
                            
                            const queryResult = await layer.queryFeatures({
                                where: whereClause,
                                outFields: outFields,
                                returnGeometry: false
                            });
                            
                            let value;
                            if (targetLayer.metric === "count") {
                                value = queryResult.features.length;
                            } else if (targetLayer.metric === "sum") {
                                value = queryResult.features.reduce((sum, feature) => {
                                    const fieldValue = feature.attributes[targetLayer.field];
                                    return sum + (Number(fieldValue) || 0);
                                }, 0);
                                value = Math.round(value * 100) / 100;
                            }
                            
                            categoryResults.layers.push({
                                name: targetLayer.name,
                                value: value,
                                metric: targetLayer.metric,
                                error: false
                            });
                            
                        } catch (err) {
                            console.error(`Error querying layer ${targetLayer.name} for ${category.name}:`, err);
                            categoryResults.layers.push({
                                name: targetLayer.name,
                                value: "Error: " + (err.message || "Unknown error"),
                                error: true
                            });
                        }
                    }
                    
                    results.push(categoryResults);
                }
                
                // Build results table
                let tableHTML = `<div style="overflow-x:auto;margin-top:8px;"><table style="min-width:100%;border-collapse:collapse;white-space:nowrap;"><thead><tr style="background:#f5f5f5;"><th style="border:1px solid #ddd;padding:8px;text-align:left;font-weight:bold;">Category</th>`;
                
                targetLayers.forEach(layer => {
                    let headerText = layer.name;
                    if (layer.additionalFilter) {
                        if (layer.name === "Fiber Cable") headerText += " (Excl. DROP)";
                        else if (layer.name === "Aerial Span") headerText += " (Excl. EXISTINGINFRA)";
                    }
                    tableHTML += `<th style="border:1px solid #ddd;padding:8px;text-align:center;font-weight:bold;">${headerText}</th>`;
                });
                
                tableHTML += `</tr></thead><tbody>`;
                
                results.forEach(categoryResult => {
                    const rowValues = [];
                    tableHTML += `<tr><td style="border:1px solid #ddd;padding:8px;font-weight:bold;cursor:pointer;background:#f8f9fa;transition:background 0.2s;" onclick="filterMapByCategory('${categoryResult.name}',${JSON.stringify(categoryResult.categoryData).replace(/"/g, '&quot;')})" title="Click to filter map to show only ${categoryResult.name} features">${categoryResult.name}</td>`;
                    
                    categoryResult.layers.forEach(layerResult => {
                        const valueDisplay = layerResult.error ? layerResult.value : 
                            (layerResult.metric === "sum" ? layerResult.value.toLocaleString() : layerResult.value.toLocaleString());
                        rowValues.push(valueDisplay);
                        
                        const cellStyle = layerResult.error ? "color:#d32f2f;" : "";
                        tableHTML += `<td style="border:1px solid #ddd;padding:8px;text-align:right;${cellStyle}">${valueDisplay}</td>`;
                    });
                    
                    currentTableData.push({category: categoryResult.name, values: rowValues});
                    tableHTML += `</tr>`;
                });
                
                tableHTML += `</tbody></table></div><div style="margin-top:8px;font-size:11px;color:#666;font-style:italic;">💡 Click on any category name to filter the map to show only those features</div>`;
                
                $("#resultsTable").innerHTML = tableHTML;
                $("#exportBtn").style.display = "inline-block";
                updateStatus("Report completed.");
                
            } catch (err) {
                console.error(err);
                updateStatus("Error: " + (err.message || err));
            }
        };
        
        // Document click handler for dropdown closing
        document.addEventListener('click', (e) => {
            if (!toolBox.contains(e.target)) {
                $("#purchaseOptions").style.display = 'none';
                $("#workorderOptions").style.display = 'none';
            }
        });
        
        // Tool cleanup function
        function cleanup() {
            // Clear map filters
            try {
                const allFL = mapView.map.allLayers.filter(l => l.type === "feature");
                allFL.forEach(layer => {
                    if (layer.definitionExpression) {
                        layer.definitionExpression = "";
                    }
                });
            } catch (error) {
                console.warn("Error clearing filters during cleanup:", error);
            }
            
            // Clean up global function
            if (window.filterMapByCategory) {
                delete window.filterMapByCategory;
            }
            
            toolBox.remove();
            console.log('Metrics By WOID Tool cleaned up');
        }
        
        // Initialize data loading
        loadPurchaseOrders();
        loadWorkorders();
        
        // Close button
        $("#closeTool").onclick = () => {
            window.gisToolHost.closeTool('metrics-by-woid');
        };
        
        // Register tool with host
        window.gisToolHost.activeTools.set('metrics-by-woid', {
            cleanup: cleanup,
            toolBox: toolBox
        });
        
        console.log('Metrics By WOID Tool loaded successfully');
        
    } catch (error) {
        console.error('Error loading Metrics By WOID Tool:', error);
        alert("Error creating Metrics By WOID Tool: " + (error.message || error));
    }
})();
