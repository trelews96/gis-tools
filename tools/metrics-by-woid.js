// tools/metrics-by-woid.js - Week 2 Core Metrics (Fixed)
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
        
        // Target layers configuration with weights based on construction sequence
        const targetLayers = [
            {id: 41050, name: "Fiber Cable", metric: "sum", field: "calculated_length", additionalFilter: "cable_category <> 'DROP'", weight: 0.50, stage: "Main Infrastructure"},
            {id: 42050, name: "Underground Span", metric: "sum", field: "calculated_length", weight: 0.15, stage: "Foundation"},
            {id: 43050, name: "Aerial Span", metric: "sum", field: "calculated_length", additionalFilter: "physical_status <> 'EXISTINGINFRASTRUCTURE'", weight: 0.15, stage: "Foundation"},
            {id: 42100, name: "Vault", metric: "count", field: "objectid", weight: 0.10, stage: "Foundation"},
            {id: 41150, name: "Splice Closure", metric: "count", field: "objectid", weight: 0.15, stage: "Finishing"},
            {id: 41100, name: "Fiber Equipment", metric: "count", field: "objectid", weight: 0.10, stage: "Finishing"}
        ];
        
        const z = 99999;
        
        // Tool state variables
        let selectedWorkorders = [];
        let allWorkorders = [];
        let selectedPurchaseOrders = [];
        let allPurchaseOrders = [];
        let currentTableData = [];
        let sortColumn = null;
        let sortDirection = 'asc';
        let isProcessing = false;
        let showPercentages = false;
        
        // CSS Spinner keyframes
        const spinnerStyle = document.createElement('style');
        spinnerStyle.textContent = `
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            .spinner {
                display: inline-block;
                width: 14px;
                height: 14px;
                border: 2px solid #f3f3f3;
                border-top: 2px solid #3367d6;
                border-radius: 50%;
                animation: spin 1s linear infinite;
                margin-right: 6px;
                vertical-align: middle;
            }
            .dropdown-option:hover {
                background-color: #e3f2fd !important;
            }
            .table-row:hover {
                background-color: #f0f7ff !important;
            }
            .sortable-header {
                cursor: pointer;
                user-select: none;
            }
            .sortable-header:hover {
                background-color: #e8e8e8 !important;
            }
            .sort-indicator {
                font-size: 10px;
                margin-left: 4px;
            }
            .completion-bar {
                display: inline-block;
                height: 12px;
                background: #e0e0e0;
                border-radius: 6px;
                overflow: hidden;
                width: 60px;
                vertical-align: middle;
                margin-left: 8px;
            }
            .completion-fill {
                height: 100%;
                transition: width 0.3s ease;
            }
            .layer-percent {
                font-size: 10px;
                color: #666;
                display: block;
                margin-top: 2px;
            }
        `;
        document.head.appendChild(spinnerStyle);
        
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
                    <span id="purchasePlaceholder" style="color:#999;"><span class="spinner"></span>Loading purchase orders...</span>
                </div>
                <div id="purchaseOptions" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid #ccc;border-top:none;max-height:150px;overflow-y:auto;z-index:1000;">
                    <div style="padding:4px;background:#f5f5f5;border-bottom:1px solid #ddd;display:flex;gap:4px;">
                        <button id="selectAllPO" style="flex:1;padding:4px;font-size:11px;">Select All</button>
                        <button id="clearAllPO" style="flex:1;padding:4px;font-size:11px;">Clear All</button>
                    </div>
                    <div id="purchaseOptionsList"></div>
                </div>
            </div>
            
            <label>Work Order ID:</label><br>
            <div style="position:relative;margin:4px 0 8px 0;">
                <div id="workorderDropdown" style="width:100%;border:1px solid #ccc;padding:4px;background:#fff;cursor:pointer;min-height:20px;">
                    <span id="workorderPlaceholder" style="color:#999;"><span class="spinner"></span>Loading work orders...</span>
                </div>
                <div id="workorderOptions" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid #ccc;border-top:none;max-height:150px;overflow-y:auto;z-index:1000;">
                    <div style="padding:4px;background:#f5f5f5;border-bottom:1px solid #ddd;display:flex;gap:4px;">
                        <button id="selectAllWO" style="flex:1;padding:4px;font-size:11px;">Select All</button>
                        <button id="clearAllWO" style="flex:1;padding:4px;font-size:11px;">Clear All</button>
                    </div>
                    <div id="workorderOptionsList"></div>
                </div>
            </div>
            
            <label>Quick Date Range:</label><br>
            <div style="display:flex;gap:4px;margin:4px 0 8px 0;flex-wrap:wrap;">
                <button class="date-preset" data-days="7" style="padding:4px 8px;font-size:11px;">Last 7 Days</button>
                <button class="date-preset" data-days="30" style="padding:4px 8px;font-size:11px;">Last 30 Days</button>
                <button class="date-preset" data-preset="this-month" style="padding:4px 8px;font-size:11px;">This Month</button>
                <button class="date-preset" data-preset="last-month" style="padding:4px 8px;font-size:11px;">Last Month</button>
                <button class="date-preset" data-preset="this-quarter" style="padding:4px 8px;font-size:11px;">This Quarter</button>
                <button class="date-preset" data-preset="ytd" style="padding:4px 8px;font-size:11px;">YTD</button>
                <button id="allTimeBtn" style="padding:4px 8px;font-size:11px;">All Time</button>
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
            </div>
            
            <div style="display:flex;gap:8px;margin-bottom:8px;">
                <button id="runBtn">▶ Run Report</button>
                <button id="exportBtn" style="display:none;">📥 Export CSV</button>
                <button id="clearBtn" style="display:none;">🔄 Clear Filters</button>
                <button id="closeTool">✖ Close</button>
            </div>
            
            <div style="display:none;" id="viewOptions">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                    <input type="checkbox" id="showPercentToggle">
                    <span>Show as % of Total Assigned</span>
                </label>
            </div>
            
            <div id="toolStatus" style="margin-top:8px;padding:6px;border-radius:3px;"></div>
            <div id="summarySection" style="display:none;margin-top:12px;padding:12px;background:#f5f7fa;border:1px solid #d0d5dd;border-radius:4px;"></div>
            <div id="resultsTable" style="margin-top:12px;"></div>
        `;
        
        // Add to page
        document.body.appendChild(toolBox);
        
        // Get UI elements
        const $ = (id) => toolBox.querySelector(id);
        const status = $("#toolStatus");
        
        function updateStatus(message, type = 'info') {
            status.textContent = message;
            status.style.display = message ? 'block' : 'none';
            
            // Color code by type
            const colors = {
                'info': '#e3f2fd',
                'success': '#e8f5e9',
                'error': '#ffebee',
                'warning': '#fff3e0',
                'processing': '#f3e5f5'
            };
            status.style.background = colors[type] || colors.info;
            status.style.color = '#333';
            
            // Add icon
            const icons = {
                'info': 'ℹ️',
                'success': '✅',
                'error': '❌',
                'warning': '⚠️',
                'processing': '⏳'
            };
            const icon = icons[type] || icons.info;
            status.textContent = `${icon} ${message}`;
        }
        
        // Show percentage toggle handler
        $("#showPercentToggle").onchange = (e) => {
            showPercentages = e.target.checked;
            renderTable();
            renderSummary();
        };
        
        // Date preset handlers
        function setDateRange(startDate, endDate) {
            $("#startDate").value = startDate;
            $("#endDate").value = endDate;
            $("#startDate").disabled = false;
            $("#endDate").disabled = false;
            $("#allTimeBtn").style.background = "";
            $("#allTimeBtn").style.color = "";
            
            // Reset all preset buttons
            toolBox.querySelectorAll('.date-preset').forEach(btn => {
                btn.style.background = "";
                btn.style.color = "";
            });
        }
        
        function formatDateForInput(date) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }
        
        toolBox.querySelectorAll('.date-preset').forEach(btn => {
            btn.onclick = () => {
                const today = new Date();
                let startDate, endDate;
                
                if (btn.dataset.days) {
                    const days = parseInt(btn.dataset.days);
                    endDate = new Date(today);
                    startDate = new Date(today);
                    startDate.setDate(startDate.getDate() - days);
                } else if (btn.dataset.preset === 'this-month') {
                    startDate = new Date(today.getFullYear(), today.getMonth(), 1);
                    endDate = new Date(today);
                } else if (btn.dataset.preset === 'last-month') {
                    startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                    endDate = new Date(today.getFullYear(), today.getMonth(), 0);
                } else if (btn.dataset.preset === 'this-quarter') {
                    const quarter = Math.floor(today.getMonth() / 3);
                    startDate = new Date(today.getFullYear(), quarter * 3, 1);
                    endDate = new Date(today);
                } else if (btn.dataset.preset === 'ytd') {
                    startDate = new Date(today.getFullYear(), 0, 1);
                    endDate = new Date(today);
                }
                
                setDateRange(formatDateForInput(startDate), formatDateForInput(endDate));
                
                // Highlight active button
                btn.style.background = "#3367d6";
                btn.style.color = "#fff";
            };
        });
        
        // Load purchase orders from fiber layer
        async function loadPurchaseOrders() {
            try {
                const allFL = mapView.map.allLayers.filter(l => l.type === "feature");
                const fiberLayer = allFL.find(l => l.layerId === 41050);
                
                if (!fiberLayer) {
                    $("#purchasePlaceholder").innerHTML = "No fiber layer found";
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
                    $("#purchasePlaceholder").innerHTML = "No purchase orders found";
                    return;
                }
                
                const optionsHtml = allPurchaseOrders.map(po => `
                    <div class="purchase-option dropdown-option" data-value="${po.code.toString().replace(/"/g, '&quot;')}" style="padding:6px;cursor:pointer;border-bottom:1px solid #eee;">
                        <input type="checkbox" style="margin-right:6px;"> ${po.name}
                    </div>
                `).join('');
                
                $("#purchaseOptionsList").innerHTML = optionsHtml;
                $("#purchasePlaceholder").innerHTML = "Select purchase orders...";
                
                // Select All / Clear All handlers
                $("#selectAllPO").onclick = (e) => {
                    e.stopPropagation();
                    selectedPurchaseOrders = allPurchaseOrders.map(po => po.code.toString());
                    $("#purchaseOptionsList").querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
                    updatePurchaseDropdownDisplay();
                };
                
                $("#clearAllPO").onclick = (e) => {
                    e.stopPropagation();
                    selectedPurchaseOrders = [];
                    $("#purchaseOptionsList").querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
                    updatePurchaseDropdownDisplay();
                };
                
                $("#purchaseDropdown").onclick = () => {
                    $("#purchaseOptions").style.display = $("#purchaseOptions").style.display === 'none' ? 'block' : 'none';
                    $("#workorderOptions").style.display = 'none';
                };
                
                $("#purchaseOptionsList").addEventListener('click', (e) => {
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
                $("#purchasePlaceholder").innerHTML = "Error loading purchase orders";
            }
        }
        
        function updatePurchaseDropdownDisplay() {
            const placeholder = $("#purchasePlaceholder");
            const total = allPurchaseOrders.length;
            const selected = selectedPurchaseOrders.length;
            
            if (selected === 0) {
                placeholder.innerHTML = "Select purchase orders...";
                placeholder.style.color = "#999";
            } else if (selected === 1) {
                const selectedPO = allPurchaseOrders.find(p => p.code.toString() === selectedPurchaseOrders[0]);
                placeholder.innerHTML = selectedPO ? selectedPO.name : selectedPurchaseOrders[0];
                placeholder.style.color = "#000";
            } else if (selected === total) {
                placeholder.innerHTML = `All ${total} purchase orders selected`;
                placeholder.style.color = "#000";
            } else {
                placeholder.innerHTML = `${selected} of ${total} purchase orders selected`;
                placeholder.style.color = "#000";
            }
        }
        
        // Load work orders from fiber layer
        async function loadWorkorders() {
            try {
                const allFL = mapView.map.allLayers.filter(l => l.type === "feature");
                const fiberLayer = allFL.find(l => l.layerId === 41050);
                
                if (!fiberLayer) {
                    $("#workorderPlaceholder").innerHTML = "No fiber layer found";
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
                    $("#workorderPlaceholder").innerHTML = "No work orders found";
                    return;
                }
                
                const optionsHtml = allWorkorders.map(wo => `
                    <div class="workorder-option dropdown-option" data-value="${wo.code.toString().replace(/"/g, '&quot;')}" style="padding:6px;cursor:pointer;border-bottom:1px solid #eee;">
                        <input type="checkbox" style="margin-right:6px;"> ${wo.name}
                    </div>
                `).join('');
                
                $("#workorderOptionsList").innerHTML = optionsHtml;
                $("#workorderPlaceholder").innerHTML = "Select work orders...";
                
                // Select All / Clear All handlers
                $("#selectAllWO").onclick = (e) => {
                    e.stopPropagation();
                    selectedWorkorders = allWorkorders.map(wo => wo.code.toString());
                    $("#workorderOptionsList").querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
                    updateWorkorderDropdownDisplay();
                };
                
                $("#clearAllWO").onclick = (e) => {
                    e.stopPropagation();
                    selectedWorkorders = [];
                    $("#workorderOptionsList").querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
                    updateWorkorderDropdownDisplay();
                };
                
                $("#workorderDropdown").onclick = () => {
                    $("#workorderOptions").style.display = $("#workorderOptions").style.display === 'none' ? 'block' : 'none';
                    $("#purchaseOptions").style.display = 'none';
                };
                
                $("#workorderOptionsList").addEventListener('click', (e) => {
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
                $("#workorderPlaceholder").innerHTML = "Error loading work orders";
            }
        }
        
        function updateWorkorderDropdownDisplay() {
            const placeholder = $("#workorderPlaceholder");
            const total = allWorkorders.length;
            const selected = selectedWorkorders.length;
            
            if (selected === 0) {
                placeholder.innerHTML = "Select work orders...";
                placeholder.style.color = "#999";
            } else if (selected === 1) {
                const selectedWO = allWorkorders.find(w => w.code.toString() === selectedWorkorders[0]);
                placeholder.innerHTML = selectedWO ? selectedWO.name : selectedWorkorders[0];
                placeholder.style.color = "#000";
            } else if (selected === total) {
                placeholder.innerHTML = `All ${total} work orders selected`;
                placeholder.style.color = "#000";
            } else {
                placeholder.innerHTML = `${selected} of ${total} work orders selected`;
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
            
            // Reset date preset buttons
            toolBox.querySelectorAll('.date-preset').forEach(btn => {
                btn.style.background = "";
                btn.style.color = "";
            });
        };
        
        $("#startDate").onclick = $("#endDate").onclick = () => {
            $("#startDate").disabled = false;
            $("#endDate").disabled = false;
            $("#allTimeBtn").style.background = "";
            $("#allTimeBtn").style.color = "";
            
            // Reset date preset buttons
            toolBox.querySelectorAll('.date-preset').forEach(btn => {
                btn.style.background = "";
                btn.style.color = "";
            });
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
            
            const headers = ["Category", ...targetLayers.map(l => l.name)];
            const csvRows = [headers];
            
            currentTableData.forEach(row => {
                if (row.category !== 'TOTALS') {
                    const rowData = [csvEsc(row.category), ...row.values.map(v => csvEsc(v))];
                    csvRows.push(rowData);
                }
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
            
            updateStatus("CSV exported successfully!", "success");
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
                updateStatus("Map filters cleared.", "success");
                $("#clearBtn").style.display = "none";
            } catch (error) {
                console.error("Error clearing filters:", error);
                updateStatus("Error clearing filters.", "error");
            }
        };
        
        // Global function for filtering map by category
        window.filterMapByCategory = async function(categoryName, categoryData) {
            try {
                updateStatus(`Applying ${categoryName} filters to map...`, "processing");
                
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
                
                updateStatus(`Map filtered to show ${categoryName} features. Click "Clear Filters" to reset.`, "success");
                $("#clearBtn").style.display = "inline-block";
                
            } catch (error) {
                console.error("Error filtering map:", error);
                updateStatus("Error applying map filters.", "error");
            }
        };
        
        // Sorting function
        function sortTable(columnIndex) {
            if (sortColumn === columnIndex) {
                sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                sortColumn = columnIndex;
                sortDirection = 'asc';
            }
            
            // Don't sort the TOTALS row
            const totalsRow = currentTableData.find(row => row.category === 'TOTALS');
            const dataRows = currentTableData.filter(row => row.category !== 'TOTALS');
            
            if (columnIndex === -1) {
                // Sort by category name
                dataRows.sort((a, b) => {
                    const comparison = a.category.localeCompare(b.category);
                    return sortDirection === 'asc' ? comparison : -comparison;
                });
            } else {
                // Sort by numeric value
                dataRows.sort((a, b) => {
                    const aVal = parseFloat(a.values[columnIndex].replace(/[,%]/g, '')) || 0;
                    const bVal = parseFloat(b.values[columnIndex].replace(/[,%]/g, '')) || 0;
                    return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
                });
            }
            
            // Rebuild table data with totals at bottom
            currentTableData = [...dataRows];
            if (totalsRow) {
                currentTableData.push(totalsRow);
            }
            
            // Redraw table
            renderTable();
        }
        
        // Get completion bar color
        function getCompletionColor(percent) {
            if (percent >= 80) return '#4caf50'; // Green
            if (percent >= 50) return '#ff9800'; // Orange
            return '#f44336'; // Red
        }
        
        // Render summary section
        function renderSummary() {
            const summarySection = $("#summarySection");
            
            // Find key rows
            const designedRow = currentTableData.find(r => r.category === "Designed");
            const constructedRow = currentTableData.find(r => r.category === "Constructed");
            const invoicedRow = currentTableData.find(r => r.category === "Invoiced");
            
            if (!designedRow || !constructedRow) {
                summarySection.style.display = "none";
                return;
            }
            
            // Calculate weighted percentages
            let weightedConstruction = 0;
            let weightedBilling = 0;
            
            targetLayers.forEach((layer, idx) => {
                const designed = designedRow.rawValues[idx] || 0;
                const constructed = constructedRow.rawValues[idx] || 0;
                const invoiced = invoicedRow ? (invoicedRow.rawValues[idx] || 0) : 0;
                
                if (designed > 0) {
                    const layerConstructionPct = (constructed / designed) * 100;
                    const layerBillingPct = (invoiced / designed) * 100;
                    
                    weightedConstruction += layerConstructionPct * layer.weight;
                    weightedBilling += layerBillingPct * layer.weight;
                }
            });
            
            const constructionColor = getCompletionColor(weightedConstruction);
            const billingColor = getCompletionColor(weightedBilling);
            
            summarySection.innerHTML = `
                <div style="font-weight:bold;margin-bottom:8px;font-size:14px;">📈 Project Summary</div>
                <div style="display:flex;gap:16px;flex-wrap:wrap;">
                    <div style="flex:1;min-width:200px;">
                        <div style="font-weight:bold;margin-bottom:4px;">Construction Progress</div>
                        <div style="font-size:24px;font-weight:bold;color:${constructionColor};">${weightedConstruction.toFixed(1)}%</div>
                        <div class="completion-bar" style="width:100%;height:16px;margin-top:6px;">
                            <div class="completion-fill" style="width:${weightedConstruction}%;background:${constructionColor};"></div>
                        </div>
                        <div style="font-size:10px;color:#666;margin-top:4px;">Weighted average across all layers</div>
                    </div>
                    <div style="flex:1;min-width:200px;">
                        <div style="font-weight:bold;margin-bottom:4px;">Billing Progress</div>
                        <div style="font-size:24px;font-weight:bold;color:${billingColor};">${weightedBilling.toFixed(1)}%</div>
                        <div class="completion-bar" style="width:100%;height:16px;margin-top:6px;">
                            <div class="completion-fill" style="width:${weightedBilling}%;background:${billingColor};"></div>
                        </div>
                        <div style="font-size:10px;color:#666;margin-top:4px;">Weighted average of invoiced work</div>
                    </div>
                </div>
                <div style="margin-top:12px;font-size:11px;color:#666;">
                    <strong>Layer Weights:</strong> 
                    Foundation (25%): UG Span 15%, Vaults 10% | 
                    Main Infrastructure (50%): Fiber Cable 50% | 
                    Finishing (25%): Splice Closures 15%, Equipment 10%
                </div>
            `;
            
            summarySection.style.display = "block";
        }
        
        // Render table function
        function renderTable() {
            if (!currentTableData.length) return;
            
            let tableHTML = `<div style="overflow-x:auto;margin-top:8px;"><table style="min-width:100%;border-collapse:collapse;white-space:nowrap;"><thead><tr style="background:#f5f5f5;">`;
            
            // Category header with sort
            tableHTML += `<th class="sortable-header" onclick="sortTable(-1)" style="border:1px solid #ddd;padding:8px;text-align:left;font-weight:bold;">Category`;
            if (sortColumn === -1) {
                tableHTML += `<span class="sort-indicator">${sortDirection === 'asc' ? '▲' : '▼'}</span>`;
            }
            tableHTML += `</th>`;
            
            // Layer headers with sort
            targetLayers.forEach((layer, idx) => {
                let headerText = layer.name;
                if (layer.additionalFilter) {
                    if (layer.name === "Fiber Cable") headerText += " (Excl. DROP)";
                    else if (layer.name === "Aerial Span") headerText += " (Excl. EXISTINGINFRA)";
                }
                tableHTML += `<th class="sortable-header" onclick="sortTable(${idx})" style="border:1px solid #ddd;padding:8px;text-align:center;font-weight:bold;">${headerText}`;
                if (sortColumn === idx) {
                    tableHTML += `<span class="sort-indicator">${sortDirection === 'asc' ? '▲' : '▼'}</span>`;
                }
                tableHTML += `</th>`;
            });
            
            tableHTML += `</tr></thead><tbody>`;
            
            // Get designed and constructed rows for per-layer percentages
            const designedRow = currentTableData.find(r => r.category === "Designed");
            const constructedRow = currentTableData.find(r => r.category === "Constructed");
            const invoicedRow = currentTableData.find(r => r.category === "Invoiced");
            
            // Data rows
            currentTableData.forEach((row, rowIdx) => {
                const isTotals = row.category === 'TOTALS';
                const rowClass = isTotals ? '' : 'table-row';
                const rowStyle = isTotals ? 
                    'background:#e8eaf6;font-weight:bold;border-top:2px solid #333;' : 
                    (rowIdx % 2 === 0 ? 'background:#fff;' : 'background:#f9f9f9;');
                
                if (isTotals) {
                    tableHTML += `<tr class="${rowClass}" style="${rowStyle}"><td style="border:1px solid #ddd;padding:8px;font-weight:bold;">${row.category}</td>`;
                } else {
                    tableHTML += `<tr class="${rowClass}" style="${rowStyle}"><td style="border:1px solid #ddd;padding:8px;font-weight:bold;cursor:pointer;transition:background 0.2s;" onclick="filterMapByCategory('${row.category}',${JSON.stringify(row.categoryData).replace(/"/g, '&quot;')})" title="Click to filter map to show only ${row.category} features">${row.category}</td>`;
                }
                
                row.values.forEach((value, colIdx) => {
                    const cellStyle = row.error ? "color:#d32f2f;" : "";
                    let cellContent = value;
                    
                    // Add per-layer percentages for Constructed and Invoiced rows
                    if (!showPercentages && !isTotals && designedRow && row.rawValues) {
                        const designed = designedRow.rawValues[colIdx] || 0;
                        const current = row.rawValues[colIdx] || 0;
                        
                        if (row.category === "Constructed" && designed > 0) {
                            const pct = (current / designed * 100).toFixed(1);
                            const color = getCompletionColor(parseFloat(pct));
                            cellContent += `<span class="layer-percent" style="color:${color};">(${pct}%)</span>`;
                        } else if (row.category === "Invoiced" && designed > 0) {
                            const pct = (current / designed * 100).toFixed(1);
                            const color = getCompletionColor(parseFloat(pct));
                            cellContent += `<span class="layer-percent" style="color:${color};">(${pct}%)</span>`;
                        }
                    }
                    
                    tableHTML += `<td style="border:1px solid #ddd;padding:8px;text-align:right;${cellStyle}">${cellContent}</td>`;
                });
                
                tableHTML += `</tr>`;
            });
            
            tableHTML += `</tbody></table></div><div style="margin-top:8px;font-size:11px;color:#666;font-style:italic;">💡 Click on any category name to filter the map | Click column headers to sort | Percentages show layer completion</div>`;
            
            $("#resultsTable").innerHTML = tableHTML;
        }
        
        // Make sortTable global so onclick handlers can access it
        window.sortTable = sortTable;
        
        // Main report function
        $("#runBtn").onclick = async () => {
            if (isProcessing) return;
            
            try {
                isProcessing = true;
                const runBtn = $("#runBtn");
                const originalText = runBtn.innerHTML;
                runBtn.innerHTML = '<span class="spinner"></span>Running...';
                runBtn.disabled = true;
                runBtn.style.opacity = '0.6';
                runBtn.style.cursor = 'not-allowed';
                
                const start = $("#startDate").value;
                const end = $("#endDate").value;
                const allTimeMode = $("#startDate").disabled;
                
                if (selectedWorkorders.length === 0 && selectedPurchaseOrders.length === 0) {
                    runBtn.innerHTML = originalText;
                    runBtn.disabled = false;
                    runBtn.style.opacity = '1';
                    runBtn.style.cursor = 'pointer';
                    isProcessing = false;
                    return alert("Please select at least one work order or purchase order.");
                }
                
                if (!allTimeMode && (!start || !end)) {
                    runBtn.innerHTML = originalText;
                    runBtn.disabled = false;
                    runBtn.style.opacity = '1';
                    runBtn.style.cursor = 'pointer';
                    isProcessing = false;
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
                    {name: "Total Assigned", includeStatuses: ['ASSG']},
                    {name: "Designed", excludeStatuses: ['DNB', 'ONHOLD', 'DEFRD']},
                    {name: "Constructed", excludeStatuses: ['DNB', 'ONHOLD', 'DEFRD', 'NA', 'ASSG', 'INPROG']},
                    {name: "Remaining to Construct", requireStage: 'OSP_CONST', includeStatuses: ['NA']},
                    {name: "On Hold", includeStatuses: ['ONHOLD']},
                    {name: "Ready to Bill", includeStatuses: ['RDYFDLY']},
                    {name: "Invoiced", includeStatuses: ['INVCMPLT']}
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
                
                updateStatus(`Querying layers for ${selectionText} (${dateRangeText})...`, "processing");
                $("#resultsTable").innerHTML = "";
                $("#summarySection").style.display = "none";
                currentTableData = [];
                
                const allFL = mapView.map.allLayers.filter(l => l.type === "feature");
                if (!allFL.length) {
                    runBtn.innerHTML = originalText;
                    runBtn.disabled = false;
                    runBtn.style.opacity = '1';
                    runBtn.style.cursor = 'pointer';
                    isProcessing = false;
                    return alert("No feature layers found.");
                }
                
                const results = [];
                const totalQueries = categories.length * targetLayers.length;
                let completedQueries = 0;
                
                for (const category of categories) {
                    const categoryResults = {
                        name: category.name,
                        layers: [],
                        categoryData: category
                    };
                    
                    for (const targetLayer of targetLayers) {
                        try {
                            completedQueries++;
                            updateStatus(`Querying ${category.name}: ${targetLayer.name} (${completedQueries}/${totalQueries})...`, "processing");
                            
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
                
                // Build results table data
                currentTableData = [];
                const totals = new Array(targetLayers.length).fill(0);
                
                results.forEach(categoryResult => {
                    const rowValues = [];
                    const rawValues = [];
                    
                    categoryResult.layers.forEach((layerResult, idx) => {
                        let valueDisplay;
                        let rawValue = 0;
                        
                        if (layerResult.error) {
                            valueDisplay = layerResult.value;
                        } else {
                            rawValue = layerResult.value;
                            
                            if (showPercentages) {
                                // Show as percentage of Total Assigned
                                const totalAssignedResult = results.find(r => r.name === "Total Assigned");
                                if (totalAssignedResult) {
                                    const totalValue = totalAssignedResult.layers[idx].value;
                                    const percentage = totalValue > 0 ? (rawValue / totalValue * 100) : 0;
                                    valueDisplay = percentage.toFixed(1) + '%';
                                }
                            } else {
                                // Show actual values
                                valueDisplay = layerResult.metric === "sum" ? 
                                    layerResult.value.toLocaleString() : 
                                    layerResult.value.toLocaleString();
                            }
                            
                            // Add to totals if not error and not in percentage mode
                            if (!showPercentages) {
                                totals[idx] += layerResult.value;
                            }
                        }
                        
                        rowValues.push(valueDisplay);
                        rawValues.push(rawValue);
                    });
                    
                    currentTableData.push({
                        category: categoryResult.name, 
                        values: rowValues,
                        rawValues: rawValues,
                        categoryData: categoryResult.categoryData
                    });
                });
                
                // Add totals row (only when not in percentage mode)
                if (!showPercentages) {
                    const totalsRow = {
                        category: 'TOTALS',
                        values: totals.map(total => total.toLocaleString())
                    };
                    currentTableData.push(totalsRow);
                }
                
                // Show view options
                $("#viewOptions").style.display = "block";
                
                // Render summary and table
                renderSummary();
                renderTable();
                
                $("#exportBtn").style.display = "inline-block";
                updateStatus(`Report completed for ${selectionText} (${dateRangeText})`, "success");
                
                runBtn.innerHTML = originalText;
                runBtn.disabled = false;
                runBtn.style.opacity = '1';
                runBtn.style.cursor = 'pointer';
                isProcessing = false;
                
            } catch (err) {
                console.error(err);
                updateStatus("Error: " + (err.message || err), "error");
                
                const runBtn = $("#runBtn");
                runBtn.innerHTML = '▶ Run Report';
                runBtn.disabled = false;
                runBtn.style.opacity = '1';
                runBtn.style.cursor = 'pointer';
                isProcessing = false;
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
            
            // Clean up global functions
            if (window.filterMapByCategory) {
                delete window.filterMapByCategory;
            }
            if (window.sortTable) {
                delete window.sortTable;
            }
            
            // Remove spinner style
            if (spinnerStyle && spinnerStyle.parentNode) {
                spinnerStyle.parentNode.removeChild(spinnerStyle);
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
        
        console.log('Metrics By WOID Tool loaded successfully (Week 2 Core Metrics - Fixed)');
        
    } catch (error) {
        console.error('Error loading Metrics By WOID Tool:', error);
        alert("Error creating Metrics By WOID Tool: " + (error.message || error));
    }
})();
