// tools/metrics-by-woid.js - Week 4 Analytics & Insights
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
            {id: 42050, name: "Underground Span", metric: "sum", field: "calculated_length", weight: 0.10, stage: "Foundation"},
            {id: 43050, name: "Aerial Span", metric: "sum", field: "calculated_length", additionalFilter: "physical_status <> 'EXISTINGINFRASTRUCTURE'", weight: 0.10, stage: "Foundation"},
            {id: 42100, name: "Vault", metric: "count", field: "objectid", weight: 0.05, stage: "Foundation"},
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
        let period1Data = [];
        let period2Data = [];
        let velocityData = null;
        let sortColumn = null;
        let sortDirection = 'asc';
        let isProcessing = false;
        let showPercentages = false;
        let comparisonMode = false;
        
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
            .variance-positive {
                color: #2e7d32;
                font-weight: bold;
            }
            .variance-negative {
                color: #c62828;
                font-weight: bold;
            }
            .variance-neutral {
                color: #666;
            }
            .alert-box {
                padding: 10px 12px;
                border-radius: 4px;
                margin-bottom: 8px;
                display: flex;
                align-items: start;
                gap: 8px;
            }
            .alert-critical {
                background: #ffebee;
                border-left: 4px solid #c62828;
            }
            .alert-warning {
                background: #fff3e0;
                border-left: 4px solid #f57c00;
            }
            .alert-info {
                background: #e3f2fd;
                border-left: 4px solid #1976d2;
            }
            .alert-icon {
                font-size: 18px;
                line-height: 1;
            }
            .alert-content {
                flex: 1;
            }
            .alert-title {
                font-weight: bold;
                margin-bottom: 2px;
            }
            .alert-message {
                font-size: 11px;
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
            
            <div style="margin:4px 0 8px 0;">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                    <input type="checkbox" id="comparisonModeToggle">
                    <span style="font-weight:bold;">📊 Compare Two Periods</span>
                </label>
                <div style="font-size:10px;color:#666;margin-left:22px;margin-top:2px;font-style:italic;">
                    Compares total progress at end of each period (cumulative snapshots)
                </div>
            </div>
            
            <div id="singlePeriodSection">
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
            </div>
            
            <div id="comparisonPeriodSection" style="display:none;">
                <div style="background:#f5f7fa;padding:8px;border-radius:4px;margin-bottom:8px;">
                    <label style="font-weight:bold;">Period 1 (Baseline):</label><br>
                    <div style="display:flex;gap:8px;margin:4px 0;">
                        <div style="flex:1;">
                            <label style="font-size:11px;">Start date</label><br>
                            <input type="date" id="period1Start" style="width:100%;">
                        </div>
                        <div style="flex:1;">
                            <label style="font-size:11px;">End date</label><br>
                            <input type="date" id="period1End" style="width:100%;">
                        </div>
                    </div>
                </div>
                
                <div style="background:#e8f5e9;padding:8px;border-radius:4px;">
                    <label style="font-weight:bold;">Period 2 (Comparison):</label><br>
                    <div style="display:flex;gap:8px;margin:4px 0;">
                        <div style="flex:1;">
                            <label style="font-size:11px;">Start date</label><br>
                            <input type="date" id="period2Start" style="width:100%;">
                        </div>
                        <div style="flex:1;">
                            <label style="font-size:11px;">End date</label><br>
                            <input type="date" id="period2End" style="width:100%;">
                        </div>
                    </div>
                </div>
            </div>
            
            <div style="display:flex;gap:8px;margin-top:8px;margin-bottom:8px;">
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
            <div id="alertsSection" style="display:none;margin-top:12px;"></div>
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
        
        // Comparison mode toggle
        $("#comparisonModeToggle").onchange = (e) => {
            comparisonMode = e.target.checked;
            if (comparisonMode) {
                $("#singlePeriodSection").style.display = "none";
                $("#comparisonPeriodSection").style.display = "block";
                
                // Pre-fill with suggested periods (last month vs this month)
                const today = new Date();
                const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
                const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
                
                $("#period1Start").value = formatDateForInput(lastMonthStart);
                $("#period1End").value = formatDateForInput(lastMonthEnd);
                $("#period2Start").value = formatDateForInput(thisMonthStart);
                $("#period2End").value = formatDateForInput(today);
            } else {
                $("#singlePeriodSection").style.display = "block";
                $("#comparisonPeriodSection").style.display = "none";
            }
        };
        
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
            if (comparisonMode) {
                headers.push("Variance", "% Change");
            }
            const csvRows = [headers];
            
            currentTableData.forEach(row => {
                if (row.category !== 'TOTALS') {
                    const rowData = [csvEsc(row.category), ...row.values.map(v => csvEsc(v))];
                    if (comparisonMode && row.variance) {
                        rowData.push(csvEsc(row.variance), csvEsc(row.percentChange));
                    }
                    csvRows.push(rowData);
                }
            });
            
            const csv = csvRows.map(r => r.join(",")).join("\n");
            const timestamp = new Date().toISOString().slice(0,10);
            const file = `layer_metrics_${timestamp}.csv`;
            
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
                    
                    // Use Period 2 dates if in comparison mode, otherwise use single period
                    let start, end, allTimeMode;
                    if (comparisonMode) {
                        start = $("#period2Start").value;
                        end = $("#period2End").value;
                        allTimeMode = false;
                    } else {
                        start = $("#startDate").value;
                        end = $("#endDate").value;
                        allTimeMode = $("#startDate").disabled;
                    }
                    
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
        
        // Get variance display
        function getVarianceDisplay(variance, isPercentage = false) {
            if (variance === 0) {
                return `<span class="variance-neutral">—</span>`;
            }
            
            const sign = variance > 0 ? '+' : '';
            const arrow = variance > 0 ? '↑' : '↓';
            const className = variance > 0 ? 'variance-positive' : 'variance-negative';
            const formatted = isPercentage ? `${sign}${variance.toFixed(1)}%` : `${sign}${variance.toLocaleString()}`;
            
            return `<span class="${className}">${arrow} ${formatted}</span>`;
        }
        
        // Calculate days between dates
        function daysBetween(date1, date2) {
            const oneDay = 24 * 60 * 60 * 1000;
            return Math.round((date2 - date1) / oneDay);
        }
        
        // Analyze data and generate alerts
        function generateAlerts() {
            const alerts = [];
            
            if (!currentTableData.length || comparisonMode) return alerts;
            
            const designedRow = currentTableData.find(r => r.category === "Designed");
            const constructedRow = currentTableData.find(r => r.category === "Constructed");
            const dailyCompleteRow = currentTableData.find(r => r.category === "Daily Complete");
            const onHoldRow = currentTableData.find(r => r.category === "On Hold");
            const readyForDailyRow = currentTableData.find(r => r.category === "Ready for Daily");
            const invoicedRow = currentTableData.find(r => r.category === "Invoiced");
            
            if (!designedRow || !constructedRow) return alerts;
            
            // Check for data quality issues per layer
            targetLayers.forEach((layer, idx) => {
                const designed = designedRow.rawValues[idx] || 0;
                const constructed = constructedRow.rawValues[idx] || 0;
                
                if (constructed > designed && designed > 0) {
                    const excess = constructed - designed;
                    const unit = layer.metric === "sum" ? "ft" : "units";
                    alerts.push({
                        type: 'critical',
                        icon: '🚨',
                        title: `Data Quality Issue - ${layer.name}`,
                        message: `Constructed (${constructed.toLocaleString()}) exceeds Designed (${designed.toLocaleString()}) by ${excess.toLocaleString()} ${unit}. Please verify data accuracy.`
                    });
                }
            });
            
            // Calculate totals
            let designedTotal = 0, constructedTotal = 0, dailyCompleteTotal = 0, onHoldTotal = 0, readyForDailyTotal = 0, invoicedTotal = 0;
            
            designedRow.rawValues.forEach((val, idx) => { designedTotal += val; });
            constructedRow.rawValues.forEach((val, idx) => { constructedTotal += val; });
            if (dailyCompleteRow) dailyCompleteRow.rawValues.forEach((val, idx) => { dailyCompleteTotal += val; });
            if (onHoldRow) onHoldRow.rawValues.forEach((val, idx) => { onHoldTotal += val; });
            if (readyForDailyRow) readyForDailyRow.rawValues.forEach((val, idx) => { readyForDailyTotal += val; });
            if (invoicedRow) invoicedRow.rawValues.forEach((val, idx) => { invoicedTotal += val; });
            
            // Alert: High % on hold with layer breakdown
            if (designedTotal > 0) {
                const onHoldPct = (onHoldTotal / designedTotal) * 100;
                if (onHoldPct > 20) {
                    // Find which layers have the most on hold
                    const highOnHoldLayers = [];
                    if (onHoldRow) {
                        targetLayers.forEach((layer, idx) => {
                            const designed = designedRow.rawValues[idx] || 0;
                            const onHold = onHoldRow.rawValues[idx] || 0;
                            if (designed > 0) {
                                const layerPct = (onHold / designed) * 100;
                                if (layerPct > 20) {
                                    highOnHoldLayers.push(`${layer.name} (${layerPct.toFixed(0)}%)`);
                                }
                            }
                        });
                    }
                    
                    let message = `${onHoldPct.toFixed(1)}% of designed work is on hold. Consider reviewing blocked items.`;
                    if (highOnHoldLayers.length > 0) {
                        message += ` Affected: ${highOnHoldLayers.join(', ')}.`;
                    }
                    
                    alerts.push({
                        type: 'warning',
                        icon: '⚠️',
                        title: 'High Volume On Hold',
                        message: message
                    });
                }
            }
            
            // Alert: Large billing lag with layer breakdown
            if (constructedTotal > 0 && dailyCompleteTotal > 0) {
                const billingGap = constructedTotal - dailyCompleteTotal;
                const gapPct = (billingGap / constructedTotal) * 100;
                if (gapPct > 25) {
                    // Find which layers have the biggest gap
                    const laggyLayers = [];
                    if (dailyCompleteRow) {
                        targetLayers.forEach((layer, idx) => {
                            const constructed = constructedRow.rawValues[idx] || 0;
                            const dailyComplete = dailyCompleteRow.rawValues[idx] || 0;
                            if (constructed > 0) {
                                const layerGap = constructed - dailyComplete;
                                const layerPct = (layerGap / constructed) * 100;
                                if (layerPct > 30 && layerGap > 0) {
                                    const unit = layer.metric === "sum" ? "ft" : "units";
                                    laggyLayers.push(`${layer.name} (${layerGap.toFixed(0)} ${unit}, ${layerPct.toFixed(0)}%)`);
                                }
                            }
                        });
                    }
                    
                    let message = `${gapPct.toFixed(1)}% of constructed work not marked Daily Complete. Consider submitting for billing.`;
                    if (laggyLayers.length > 0) {
                        message += ` Top gaps: ${laggyLayers.slice(0, 3).join(', ')}.`;
                    }
                    
                    alerts.push({
                        type: 'warning',
                        icon: '📋',
                        title: 'Billing Lag Detected',
                        message: message
                    });
                }
            }
            
            // Alert: Ready for Daily stuck
            if (readyForDailyTotal > 0 && invoicedTotal >= 0) {
                const totalInBilling = readyForDailyTotal + invoicedTotal;
                const stuckPct = totalInBilling > 0 ? (readyForDailyTotal / totalInBilling) * 100 : 0;
                if (stuckPct > 40) {
                    alerts.push({
                        type: 'info',
                        icon: '💰',
                        title: 'Invoice Opportunity',
                        message: `${readyForDailyTotal.toLocaleString()} units ready for daily submission. Consider processing invoices.`
                    });
                }
            }
            
            // Alert: Low completion (only for longer periods)
            const calendarDays = velocityData ? velocityData.calendarDays : 0;
            const isLongPeriod = calendarDays >= 30 || calendarDays === 0; // 0 means couldn't determine, likely All Time
            
            if (designedTotal > 0 && isLongPeriod) {
                const completionPct = (constructedTotal / designedTotal) * 100;
                if (completionPct < 10 && constructedTotal > 0) {
                    alerts.push({
                        type: 'info',
                        icon: 'ℹ️',
                        title: 'Project Early Stage',
                        message: `Only ${completionPct.toFixed(1)}% constructed. Project is in early stages.`
                    });
                }
            }
            
            // Alert: No activity (if velocity data available)
            if (velocityData && velocityData.daysSinceLastInstall > 30) {
                alerts.push({
                    type: 'warning',
                    icon: '⏸️',
                    title: 'No Recent Activity',
                    message: `No construction activity in ${velocityData.daysSinceLastInstall} days. Last install: ${velocityData.lastInstallDate}.`
                });
            } else if (velocityData && velocityData.daysSinceLastInstall > 14) {
                alerts.push({
                    type: 'info',
                    icon: '📅',
                    title: 'Low Activity',
                    message: `${velocityData.daysSinceLastInstall} days since last installation. Last activity: ${velocityData.lastInstallDate}.`
                });
            }
            
            // Alert: Identify slow layers (low velocity)
            if (velocityData && velocityData.layerVelocities) {
                const slowLayers = velocityData.layerVelocities.filter(lv => 
                    lv.rawVelocity === 0 && lv.velocity.includes("No activity")
                );
                
                if (slowLayers.length > 0 && slowLayers.length < velocityData.layerVelocities.length) {
                    const layerNames = slowLayers.map(l => l.name).join(', ');
                    alerts.push({
                        type: 'info',
                        icon: '🐌',
                        title: 'Stalled Layers',
                        message: `No activity in period for: ${layerNames}. Consider checking for blockers.`
                    });
                }
            }
            
            return alerts;
        }
        
        // Render alerts section
        function renderAlerts() {
            const alertsSection = $("#alertsSection");
            const alerts = generateAlerts();
            
            if (!alerts.length) {
                alertsSection.style.display = "none";
                return;
            }
            
            const alertsHTML = alerts.map(alert => {
                let alertClass = 'alert-info';
                if (alert.type === 'critical') alertClass = 'alert-critical';
                else if (alert.type === 'warning') alertClass = 'alert-warning';
                
                return `
                    <div class="alert-box ${alertClass}">
                        <div class="alert-icon">${alert.icon}</div>
                        <div class="alert-content">
                            <div class="alert-title">${alert.title}</div>
                            <div class="alert-message">${alert.message}</div>
                        </div>
                    </div>
                `;
            }).join('');
            
            alertsSection.innerHTML = alertsHTML;
            alertsSection.style.display = "block";
        }
        
        // Render summary section
        function renderSummary() {
            const summarySection = $("#summarySection");
            
            if (comparisonMode && period1Data.length && period2Data.length) {
                // Comparison mode summary
                const p1Designed = period1Data.find(r => r.category === "Designed");
                const p1Constructed = period1Data.find(r => r.category === "Constructed");
                const p1DailyComplete = period1Data.find(r => r.category === "Daily Complete");
                const p1Invoiced = period1Data.find(r => r.category === "Invoiced");
                
                const p2Designed = period2Data.find(r => r.category === "Designed");
                const p2Constructed = period2Data.find(r => r.category === "Constructed");
                const p2DailyComplete = period2Data.find(r => r.category === "Daily Complete");
                const p2Invoiced = period2Data.find(r => r.category === "Invoiced");
                
                if (!p1Designed || !p2Designed) {
                    summarySection.style.display = "none";
                    return;
                }
                
                // Calculate weighted percentages for both periods
                let p1Construction = 0, p2Construction = 0;
                let p1Billing = 0, p2Billing = 0;
                let p1InvoicedPct = 0, p2InvoicedPct = 0;
                
                targetLayers.forEach((layer, idx) => {
                    // Period 1
                    const p1Des = p1Designed.rawValues[idx] || 0;
                    const p1Con = p1Constructed ? (p1Constructed.rawValues[idx] || 0) : 0;
                    const p1Bill = p1DailyComplete ? (p1DailyComplete.rawValues[idx] || 0) : 0;
                    const p1Inv = p1Invoiced ? (p1Invoiced.rawValues[idx] || 0) : 0;
                    
                    if (p1Des > 0) {
                        p1Construction += (p1Con / p1Des * 100) * layer.weight;
                        p1Billing += (p1Bill / p1Des * 100) * layer.weight;
                        p1InvoicedPct += (p1Inv / p1Des * 100) * layer.weight;
                    }
                    
                    // Period 2
                    const p2Des = p2Designed.rawValues[idx] || 0;
                    const p2Con = p2Constructed ? (p2Constructed.rawValues[idx] || 0) : 0;
                    const p2Bill = p2DailyComplete ? (p2DailyComplete.rawValues[idx] || 0) : 0;
                    const p2Inv = p2Invoiced ? (p2Invoiced.rawValues[idx] || 0) : 0;
                    
                    if (p2Des > 0) {
                        p2Construction += (p2Con / p2Des * 100) * layer.weight;
                        p2Billing += (p2Bill / p2Des * 100) * layer.weight;
                        p2InvoicedPct += (p2Inv / p2Des * 100) * layer.weight;
                    }
                });
                
                const constructionDelta = p2Construction - p1Construction;
                const billingDelta = p2Billing - p1Billing;
                const invoicedDelta = p2InvoicedPct - p1InvoicedPct;
                
                const p2ConstructionColor = getCompletionColor(p2Construction);
                const p2BillingColor = getCompletionColor(p2Billing);
                const p2InvoicedColor = getCompletionColor(p2InvoicedPct);
                
                summarySection.innerHTML = `
                    <div style="font-weight:bold;margin-bottom:8px;font-size:14px;">📈 Period Comparison Summary</div>
                    <div style="display:flex;gap:16px;flex-wrap:wrap;">
                        <div style="flex:1;min-width:180px;">
                            <div style="font-weight:bold;margin-bottom:4px;">Construction Progress</div>
                            <div style="font-size:20px;font-weight:bold;color:${p2ConstructionColor};">
                                ${p2Construction.toFixed(1)}%
                                <span style="font-size:14px;margin-left:4px;">${getVarianceDisplay(constructionDelta, true)}</span>
                            </div>
                            <div style="font-size:11px;color:#666;margin-top:2px;">Period 1: ${p1Construction.toFixed(1)}% → Period 2: ${p2Construction.toFixed(1)}%</div>
                        </div>
                        <div style="flex:1;min-width:180px;">
                            <div style="font-weight:bold;margin-bottom:4px;">Billing Complete</div>
                            <div style="font-size:20px;font-weight:bold;color:${p2BillingColor};">
                                ${p2Billing.toFixed(1)}%
                                <span style="font-size:14px;margin-left:4px;">${getVarianceDisplay(billingDelta, true)}</span>
                            </div>
                            <div style="font-size:11px;color:#666;margin-top:2px;">Period 1: ${p1Billing.toFixed(1)}% → Period 2: ${p2Billing.toFixed(1)}%</div>
                        </div>
                        <div style="flex:1;min-width:180px;">
                            <div style="font-weight:bold;margin-bottom:4px;">Invoiced</div>
                            <div style="font-size:20px;font-weight:bold;color:${p2InvoicedColor};">
                                ${p2InvoicedPct.toFixed(1)}%
                                <span style="font-size:14px;margin-left:4px;">${getVarianceDisplay(invoicedDelta, true)}</span>
                            </div>
                            <div style="font-size:11px;color:#666;margin-top:2px;">Period 1: ${p1InvoicedPct.toFixed(1)}% → Period 2: ${p2InvoicedPct.toFixed(1)}%</div>
                        </div>
                    </div>
                    <div style="margin-top:12px;padding:8px;background:#e3f2fd;border-radius:4px;font-size:11px;">
                        <strong>📊 How Comparison Works:</strong><br>
                        • <strong>Constructed/Invoiced categories:</strong> Shows cumulative totals as of end date (all work installed BY that date)<br>
                        • <strong>Designed/Assigned categories:</strong> Shows current totals (no date filter)<br>
                        • <strong>Variance:</strong> Shows what was added/changed between period end dates
                    </div>
                `;
                
            } else {
                // Single period summary with velocity metrics
                const designedRow = currentTableData.find(r => r.category === "Designed");
                const constructedRow = currentTableData.find(r => r.category === "Constructed");
                const dailyCompleteRow = currentTableData.find(r => r.category === "Daily Complete");
                const invoicedRow = currentTableData.find(r => r.category === "Invoiced");
                
                if (!designedRow || !constructedRow) {
                    summarySection.style.display = "none";
                    return;
                }
                
                // Calculate weighted percentages
                let weightedConstruction = 0;
                let weightedBillingComplete = 0;
                let weightedInvoiced = 0;
                
                targetLayers.forEach((layer, idx) => {
                    const designed = designedRow.rawValues[idx] || 0;
                    const constructed = constructedRow.rawValues[idx] || 0;
                    const dailyComplete = dailyCompleteRow ? (dailyCompleteRow.rawValues[idx] || 0) : 0;
                    const invoiced = invoicedRow ? (invoicedRow.rawValues[idx] || 0) : 0;
                    
                    if (designed > 0) {
                        const layerConstructionPct = (constructed / designed) * 100;
                        const layerBillingCompletePct = (dailyComplete / designed) * 100;
                        const layerInvoicedPct = (invoiced / designed) * 100;
                        
                        weightedConstruction += layerConstructionPct * layer.weight;
                        weightedBillingComplete += layerBillingCompletePct * layer.weight;
                        weightedInvoiced += layerInvoicedPct * layer.weight;
                    }
                });
                
                const constructionColor = getCompletionColor(weightedConstruction);
                const billingColor = getCompletionColor(weightedBillingComplete);
                const invoicedColor = getCompletionColor(weightedInvoiced);
                
                // Velocity section
                let velocityHTML = '';
                if (velocityData) {
                    // Calculate total production days across all layers
                    const totalProductionDays = Math.max(...velocityData.layerVelocities.map(lv => lv.productionDays || 0));
                    
                    // Build period info
                    let periodInfo = '';
                    if (velocityData.calendarDays > 0) {
                        if (velocityData.periodStart && velocityData.periodEnd) {
                            periodInfo = ` (${velocityData.periodStart} to ${velocityData.periodEnd})`;
                            if (totalProductionDays > 0) {
                                periodInfo += `<br><span style="font-size:10px;font-weight:normal;color:#666;">${totalProductionDays} production days out of ${velocityData.calendarDays} calendar days</span>`;
                            }
                        } else {
                            periodInfo = ` (${velocityData.calendarDays} calendar days)`;
                        }
                    }
                    
                    // Build velocity table
                    let velocityTableHTML = `
                        <div style="margin-top:12px;padding:10px;background:#f0f4ff;border-radius:4px;">
                            <div style="font-weight:bold;margin-bottom:8px;">📈 Velocity Metrics${periodInfo}</div>
                            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:10px;">
                    `;
                    
                    velocityData.layerVelocities.forEach((layer, idx) => {
                        velocityTableHTML += `
                            <div style="font-size:11px;">
                                <div style="font-weight:bold;color:#1976d2;margin-bottom:2px;">${layer.name}</div>
                                <div style="color:#333;">${layer.velocity}</div>
                            </div>
                        `;
                    });
                    
                    velocityTableHTML += `
                            </div>
                            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:8px;padding-top:8px;border-top:1px solid #d0d5dd;font-size:11px;">
                                <div>
                                    <strong>Last Activity:</strong><br>
                                    ${velocityData.daysSinceLastInstall} days ago (${velocityData.lastInstallDate})
                                </div>
                                ${velocityData.estimatedCompletion ? `
                                <div>
                                    <strong>Est. Completion:</strong><br>
                                    ${velocityData.estimatedCompletion}
                                </div>
                                ` : ''}
                            </div>
                            <div style="margin-top:8px;padding-top:8px;border-top:1px solid #d0d5dd;font-size:10px;color:#666;font-style:italic;">
                                ℹ️ Run rates show actual daily output (total / days worked), not diluted by weekends or non-production days
                            </div>
                        </div>
                    `;
                    
                    // Build billing lag table
                    let billingLagHTML = `
                        <div style="margin-top:8px;padding:10px;background:#fff9e6;border-radius:4px;">
                            <div style="font-weight:bold;margin-bottom:8px;">⏱️ Billing Pipeline Status</div>
                            <div style="overflow-x:auto;">
                                <table style="width:100%;border-collapse:collapse;font-size:11px;">
                                    <thead>
                                        <tr style="background:#f5f5f5;">
                                            <th style="border:1px solid #ddd;padding:6px;text-align:left;">Layer</th>
                                            <th style="border:1px solid #ddd;padding:6px;text-align:center;">Constructed → Daily Complete</th>
                                            <th style="border:1px solid #ddd;padding:6px;text-align:center;">Constructed → Invoiced</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                    `;
                    
                    velocityData.layerBillingLags.forEach((layer, idx) => {
                        const rowStyle = idx % 2 === 0 ? 'background:#fff;' : 'background:#fefef8;';
                        billingLagHTML += `
                            <tr style="${rowStyle}">
                                <td style="border:1px solid #ddd;padding:6px;font-weight:bold;">${layer.name}</td>
                                <td style="border:1px solid #ddd;padding:6px;text-align:center;">${layer.dailyCompleteLag}</td>
                                <td style="border:1px solid #ddd;padding:6px;text-align:center;">${layer.invoiceLag}</td>
                            </tr>
                        `;
                    });
                    
                    billingLagHTML += `
                                    </tbody>
                                </table>
                            </div>
                            <div style="margin-top:6px;font-size:10px;color:#666;font-style:italic;">
                                Shows gap between constructed work and billing stages. Both columns compare to "Constructed" baseline.
                            </div>
                        </div>
                    `;
                    
                    velocityHTML = velocityTableHTML + billingLagHTML;
                }
                
                summarySection.innerHTML = `
                    <div style="font-weight:bold;margin-bottom:8px;font-size:14px;">📈 Project Summary</div>
                    <div style="display:flex;gap:16px;flex-wrap:wrap;">
                        <div style="flex:1;min-width:180px;">
                            <div style="font-weight:bold;margin-bottom:4px;">Construction Progress</div>
                            <div style="font-size:24px;font-weight:bold;color:${constructionColor};">${weightedConstruction.toFixed(1)}%</div>
                            <div class="completion-bar" style="width:100%;height:16px;margin-top:6px;">
                                <div class="completion-fill" style="width:${weightedConstruction}%;background:${constructionColor};"></div>
                            </div>
                            <div style="font-size:10px;color:#666;margin-top:4px;">Work physically constructed</div>
                        </div>
                        <div style="flex:1;min-width:180px;">
                            <div style="font-weight:bold;margin-bottom:4px;">Billing Complete</div>
                            <div style="font-size:24px;font-weight:bold;color:${billingColor};">${weightedBillingComplete.toFixed(1)}%</div>
                            <div class="completion-bar" style="width:100%;height:16px;margin-top:6px;">
                                <div class="completion-fill" style="width:${weightedBillingComplete}%;background:${billingColor};"></div>
                            </div>
                            <div style="font-size:10px;color:#666;margin-top:4px;">Marked daily complete by field</div>
                        </div>
                        <div style="flex:1;min-width:180px;">
                            <div style="font-weight:bold;margin-bottom:4px;">Invoiced</div>
                            <div style="font-size:24px;font-weight:bold;color:${invoicedColor};">${weightedInvoiced.toFixed(1)}%</div>
                            <div class="completion-bar" style="width:100%;height:16px;margin-top:6px;">
                                <div class="completion-fill" style="width:${weightedInvoiced}%;background:${invoicedColor};"></div>
                            </div>
                            <div style="font-size:10px;color:#666;margin-top:4px;">Invoiced to customer</div>
                        </div>
                    </div>
                    ${velocityHTML}
                    <div style="margin-top:12px;font-size:11px;color:#666;">
                        <strong>Layer Weights:</strong> 
                        Foundation (25%): UG Span 10%, Aerial Span 10%, Vaults 5% | 
                        Main Infrastructure (50%): Fiber Cable 50% | 
                        Finishing (25%): Splice Closures 15%, Equipment 10%
                    </div>
                `;
            }
            
            summarySection.style.display = "block";
        }
        
        // Render table function
        function renderTable() {
            if (!currentTableData.length) return;
            
            let tableHTML = `<div style="overflow-x:auto;margin-top:8px;"><table style="min-width:100%;border-collapse:collapse;white-space:nowrap;"><thead><tr style="background:#f5f5f5;">`;
            
            // Category header
            tableHTML += `<th class="sortable-header" onclick="sortTable(-1)" style="border:1px solid #ddd;padding:8px;text-align:left;font-weight:bold;">Category`;
            if (sortColumn === -1) {
                tableHTML += `<span class="sort-indicator">${sortDirection === 'asc' ? '▲' : '▼'}</span>`;
            }
            tableHTML += `</th>`;
            
            // Layer headers
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
            
            // Add variance columns in comparison mode
            if (comparisonMode) {
                tableHTML += `<th style="border:1px solid #ddd;padding:8px;text-align:center;font-weight:bold;background:#fff9e6;">Δ Total</th>`;
                tableHTML += `<th style="border:1px solid #ddd;padding:8px;text-align:center;font-weight:bold;background:#fff9e6;">% Change</th>`;
            }
            
            tableHTML += `</tr></thead><tbody>`;
            
            // Get designed rows for per-layer percentages
            const designedRow = currentTableData.find(r => r.category === "Designed");
            const constructedRow = currentTableData.find(r => r.category === "Constructed");
            const dailyCompleteRow = currentTableData.find(r => r.category === "Daily Complete");
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
                    
                    // Add per-layer percentages for key rows
                    if (!showPercentages && !isTotals && !comparisonMode && designedRow && row.rawValues) {
                        const designed = designedRow.rawValues[colIdx] || 0;
                        const current = row.rawValues[colIdx] || 0;
                        
                        if ((row.category === "Constructed" || row.category === "Daily Complete" || row.category === "Invoiced") && designed > 0) {
                            const pct = (current / designed * 100).toFixed(1);
                            const color = getCompletionColor(parseFloat(pct));
                            cellContent += `<span class="layer-percent" style="color:${color};">(${pct}%)</span>`;
                        }
                    }
                    
                    tableHTML += `<td style="border:1px solid #ddd;padding:8px;text-align:right;${cellStyle}">${cellContent}</td>`;
                });
                
                // Add variance cells in comparison mode
                if (comparisonMode && !isTotals) {
                    if (row.varianceTotal !== undefined) {
                        tableHTML += `<td style="border:1px solid #ddd;padding:8px;text-align:center;background:#fffdf0;">${getVarianceDisplay(row.varianceTotal)}</td>`;
                        tableHTML += `<td style="border:1px solid #ddd;padding:8px;text-align:center;background:#fffdf0;">${getVarianceDisplay(row.percentChange, true)}</td>`;
                    } else {
                        tableHTML += `<td style="border:1px solid #ddd;padding:8px;text-align:center;background:#fffdf0;">—</td>`;
                        tableHTML += `<td style="border:1px solid #ddd;padding:8px;text-align:center;background:#fffdf0;">—</td>`;
                    }
                }
                
                tableHTML += `</tr>`;
            });
            
            tableHTML += `</tbody></table></div><div style="margin-top:8px;font-size:11px;color:#666;font-style:italic;">💡 Click category names to filter map | Click headers to sort${comparisonMode ? ' | Variance shows change from Period 1 to Period 2 end dates' : ''}</div>`;
            
            $("#resultsTable").innerHTML = tableHTML;
        }
        
        // Make sortTable global
        window.sortTable = sortTable;
        
        // Calculate velocity metrics per layer using actual production days
        async function calculateVelocity(startDate, endDate, allTimeMode) {
            try {
                const filterClause = buildFilterClause();
                const allFL = mapView.map.allLayers.filter(l => l.type === "feature");
                
                // Get most recent installation date and earliest date across all layers
                let lastInstallDate = "N/A";
                let daysSinceLastInstall = 0;
                let earliestInstallDate = null;
                
                for (const targetLayer of targetLayers) {
                    const layer = allFL.find(l => l.layerId === targetLayer.id);
                    if (!layer) continue;
                    
                    await layer.load();
                    
                    // Get most recent
                    const recentQuery = await layer.queryFeatures({
                        where: `(${filterClause}) AND installation_date IS NOT NULL`,
                        outFields: ["installation_date"],
                        orderByFields: ["installation_date DESC"],
                        num: 1,
                        returnGeometry: false
                    });
                    
                    if (recentQuery.features.length > 0) {
                        const lastDate = new Date(recentQuery.features[0].attributes.installation_date);
                        const today = new Date();
                        const daysSince = daysBetween(lastDate, today);
                        
                        if (daysSinceLastInstall === 0 || daysSince < daysSinceLastInstall) {
                            daysSinceLastInstall = daysSince;
                            lastInstallDate = lastDate.toLocaleDateString();
                        }
                    }
                    
                    // Get earliest (for All Time mode)
                    if (allTimeMode) {
                        const earliestQuery = await layer.queryFeatures({
                            where: `(${filterClause}) AND installation_date IS NOT NULL`,
                            outFields: ["installation_date"],
                            orderByFields: ["installation_date ASC"],
                            num: 1,
                            returnGeometry: false
                        });
                        
                        if (earliestQuery.features.length > 0) {
                            const earlyDate = new Date(earliestQuery.features[0].attributes.installation_date);
                            if (!earliestInstallDate || earlyDate < earliestInstallDate) {
                                earliestInstallDate = earlyDate;
                            }
                        }
                    }
                }
                
                // Calculate calendar days for display
                let calendarDays = 1;
                let effectiveStartDate = startDate;
                let effectiveEndDate = endDate;
                
                if (allTimeMode && earliestInstallDate) {
                    effectiveStartDate = formatDateForInput(earliestInstallDate);
                    effectiveEndDate = formatDateForInput(new Date());
                    calendarDays = daysBetween(earliestInstallDate, new Date()) + 1;
                } else if (!allTimeMode && startDate && endDate) {
                    calendarDays = daysBetween(new Date(startDate), new Date(endDate)) + 1;
                }
                
                // Build date clause for queries
                let dateClause = "";
                if (allTimeMode && earliestInstallDate) {
                    const endLit = `TIMESTAMP '${effectiveEndDate} 23:59:59'`;
                    dateClause = ` AND installation_date <= ${endLit}`;
                } else if (!allTimeMode && startDate && endDate) {
                    const startLit = `TIMESTAMP '${startDate} 00:00:00'`;
                    const endLit = `TIMESTAMP '${endDate} 23:59:59'`;
                    dateClause = ` AND installation_date >= ${startLit} AND installation_date <= ${endLit}`;
                }
                
                // Calculate per-layer velocity using actual production days
                const layerVelocities = [];
                const layerBillingLags = [];
                
                const designedRow = currentTableData.find(r => r.category === "Designed");
                const constructedRow = currentTableData.find(r => r.category === "Constructed");
                const dailyCompleteRow = currentTableData.find(r => r.category === "Daily Complete");
                const invoicedRow = currentTableData.find(r => r.category === "Invoiced");
                
                if (designedRow && constructedRow) {
                    // Query each layer for production days
                    for (let idx = 0; idx < targetLayers.length; idx++) {
                        const targetLayer = targetLayers[idx];
                        const layer = allFL.find(l => l.layerId === targetLayer.id);
                        
                        const designed = designedRow.rawValues[idx] || 0;
                        const constructed = constructedRow.rawValues[idx] || 0;
                        const dailyComplete = dailyCompleteRow ? (dailyCompleteRow.rawValues[idx] || 0) : 0;
                        const invoiced = invoicedRow ? (invoicedRow.rawValues[idx] || 0) : 0;
                        
                        let velocity = 0;
                        let productionDays = 0;
                        
                        if (layer && constructed > 0 && dateClause) {
                            try {
                                await layer.load();
                                
                                // Use SAME filter logic as Constructed category
                                const excludedStatuses = ['DNB', 'ONHOLD', 'DEFRD', 'NA', 'ASSG', 'INPROG'];
                                const statusClause = excludedStatuses.map(s => `workflow_status <> '${s}'`).join(' AND ');
                                
                                let additionalFilter = "";
                                if (targetLayer.additionalFilter) {
                                    additionalFilter = ` AND ${targetLayer.additionalFilter}`;
                                }
                                
                                const whereClause = `(${filterClause}) AND (${statusClause})${additionalFilter}${dateClause}`;
                                
                                console.log(`Querying ${targetLayer.name} for production days...`);
                                
                                // Query all features with installation dates
                                const featuresQuery = await layer.queryFeatures({
                                    where: whereClause,
                                    outFields: ["installation_date", targetLayer.field],
                                    returnGeometry: false
                                });
                                
                                console.log(`${targetLayer.name}: Found ${featuresQuery.features.length} features`);
                                
                                if (featuresQuery.features.length > 0) {
                                    // Get unique installation dates
                                    const uniqueDates = new Set();
                                    let totalForLayer = 0;
                                    
                                    featuresQuery.features.forEach(feature => {
                                        const installDate = feature.attributes.installation_date;
                                        const fieldValue = feature.attributes[targetLayer.field];
                                        
                                        if (installDate) {
                                            // Normalize to YYYY-MM-DD format to ensure proper grouping
                                            const date = new Date(installDate);
                                            const year = date.getFullYear();
                                            const month = String(date.getMonth() + 1).padStart(2, '0');
                                            const day = String(date.getDate()).padStart(2, '0');
                                            const dateKey = `${year}-${month}-${day}`;
                                            
                                            uniqueDates.add(dateKey);
                                        }
                                        
                                        // Sum up totals for verification
                                        if (targetLayer.metric === "sum" && fieldValue) {
                                            totalForLayer += Number(fieldValue) || 0;
                                        } else if (targetLayer.metric === "count") {
                                            totalForLayer += 1;
                                        }
                                    });
                                    
                                    productionDays = uniqueDates.size;
                                    
                                    console.log(`${targetLayer.name}: ${productionDays} unique production days`);
                                    console.log(`${targetLayer.name}: Total from query: ${totalForLayer.toFixed(2)}, Constructed from table: ${constructed}`);
                                    console.log(`${targetLayer.name}: Unique dates:`, Array.from(uniqueDates).sort());
                                    
                                    if (productionDays > 0) {
                                        velocity = (constructed / productionDays).toFixed(2);
                                    }
                                }
                            } catch (err) {
                                console.error(`Error querying production days for ${targetLayer.name}:`, err);
                            }
                        }
                        
                        const unit = targetLayer.metric === "sum" ? "ft/day" : "units/day";
                        
                        let velocityDisplay = "No activity in period";
                        if (velocity > 0 && productionDays > 0) {
                            velocityDisplay = `${velocity} ${unit} (${productionDays} production days)`;
                        }
                        
                        layerVelocities.push({
                            name: targetLayer.name,
                            velocity: velocityDisplay,
                            rawVelocity: parseFloat(velocity),
                            productionDays: productionDays
                        });
                        
                        // Billing lag calculation - compare against CONSTRUCTED (not each other)
                        let dailyCompleteLag = "—";
                        let invoiceLag = "—";
                        
                        if (constructed > 0) {
                            const dailyCompleteGap = constructed - dailyComplete;
                            const dailyCompletePct = dailyComplete > 0 ? ((dailyComplete / constructed) * 100).toFixed(1) : 0;
                            
                            if (dailyCompleteGap > 0) {
                                const gapFormatted = targetLayer.metric === "sum" ? 
                                    `${Math.round(dailyCompleteGap)} ft` : 
                                    `${Math.round(dailyCompleteGap)} units`;
                                const gapPct = ((dailyCompleteGap / constructed) * 100).toFixed(1);
                                dailyCompleteLag = `${gapFormatted} lag (${dailyCompletePct}% complete)`;
                            } else {
                                dailyCompleteLag = `✓ 100% marked complete`;
                            }
                            
                            // Invoice lag compared to CONSTRUCTED (not daily complete)
                            const invoiceGap = constructed - invoiced;
                            const invoicedPct = invoiced > 0 ? ((invoiced / constructed) * 100).toFixed(1) : 0;
                            
                            if (invoiceGap > 0) {
                                const gapFormatted = targetLayer.metric === "sum" ? 
                                    `${Math.round(invoiceGap)} ft` : 
                                    `${Math.round(invoiceGap)} units`;
                                const gapPct = ((invoiceGap / constructed) * 100).toFixed(1);
                                invoiceLag = `${gapFormatted} lag (${invoicedPct}% invoiced)`;
                            } else {
                                invoiceLag = `✓ 100% invoiced`;
                            }
                        }
                        
                        layerBillingLags.push({
                            name: targetLayer.name,
                            dailyCompleteLag: dailyCompleteLag,
                            invoiceLag: invoiceLag
                        });
                    }
                }
                
                // Calculate weighted estimated completion
                let estimatedCompletion = null;
                if (designedRow && constructedRow) {
                    let weightedVelocity = 0;
                    let totalRemaining = 0;
                    let hasActiveVelocity = false;
                    
                    targetLayers.forEach((layer, idx) => {
                        const designed = designedRow.rawValues[idx] || 0;
                        const constructed = constructedRow.rawValues[idx] || 0;
                        const remaining = designed - constructed;
                        
                        if (remaining > 0 && layerVelocities[idx].rawVelocity > 0) {
                            // Weight by the layer's overall project weight
                            weightedVelocity += layerVelocities[idx].rawVelocity * layer.weight;
                            totalRemaining += remaining * layer.weight;
                            hasActiveVelocity = true;
                        }
                    });
                    
                    if (hasActiveVelocity && weightedVelocity > 0 && totalRemaining > 0) {
                        const productionDaysNeeded = Math.ceil(totalRemaining / weightedVelocity);
                        
                        // Assume 5 production days per week (Mon-Fri)
                        const calendarDaysNeeded = Math.ceil(productionDaysNeeded * 1.4); // 7/5 ratio
                        const completionDate = new Date();
                        completionDate.setDate(completionDate.getDate() + calendarDaysNeeded);
                        estimatedCompletion = `${productionDaysNeeded} production days (~${calendarDaysNeeded} calendar days, ${completionDate.toLocaleDateString()})`;
                    }
                }
                
                return {
                    layerVelocities,
                    layerBillingLags,
                    daysSinceLastInstall,
                    lastInstallDate,
                    estimatedCompletion,
                    calendarDays: calendarDays,
                    periodStart: effectiveStartDate,
                    periodEnd: effectiveEndDate
                };
                
            } catch (error) {
                console.error("Error calculating velocity:", error);
                return null;
            }
        }
        
        // Query function for a single period
        async function queryPeriod(startDate, endDate, allTimeMode, isComparison = false) {
            const filterClause = buildFilterClause();
            
            // Categories that should NOT be filtered by date
            const noDateFilterCategories = ['Total Assigned', 'Designed', 'Remaining to Construct', 'On Hold'];
            
            function getDateClause(categoryName) {
                // No date filter for these categories
                if (noDateFilterCategories.includes(categoryName)) {
                    return "";
                }
                
                // All other categories use installation_date
                if (allTimeMode) {
                    return "";
                }
                
                if (isComparison) {
                    // Comparison mode: cumulative snapshot (everything installed BY end date)
                    const endLit = `TIMESTAMP '${endDate} 23:59:59'`;
                    return ` AND installation_date <= ${endLit}`;
                } else {
                    // Single-period mode: activity DURING the period
                    const startLit = `TIMESTAMP '${startDate} 00:00:00'`;
                    const endLit = `TIMESTAMP '${endDate} 23:59:59'`;
                    return ` AND installation_date >= ${startLit} AND installation_date <= ${endLit}`;
                }
            }
            
            const categories = [
                {name: "Total Assigned", includeStatuses: ['ASSG']},
                {name: "Designed", excludeStatuses: ['DNB', 'ONHOLD', 'DEFRD']},
                {name: "Constructed", excludeStatuses: ['DNB', 'ONHOLD', 'DEFRD', 'NA', 'ASSG', 'INPROG']},
                {name: "Remaining to Construct", requireStage: 'OSP_CONST', includeStatuses: ['NA']},
                {name: "On Hold", includeStatuses: ['ONHOLD','DEFRD']},
                {name: "Daily Complete", includeStatuses: ['DLYCMPLT','INVCMPLT']},
                {name: "Ready for Daily", includeStatuses: ['RDYFDLY','QCCMPLT']},
                {name: "Invoiced", includeStatuses: ['INVCMPLT']}
            ];
            
            const allFL = mapView.map.allLayers.filter(l => l.type === "feature");
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
                        
                        const dateClause = getDateClause(category.name);
                        const whereClause = `(${filterClause}) AND (${statusClause})${additionalFilter}${dateClause}`;
                        
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
            
            // Build table data
            const tableData = [];
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
                        valueDisplay = layerResult.metric === "sum" ? 
                            layerResult.value.toLocaleString() : 
                            layerResult.value.toLocaleString();
                    }
                    
                    rowValues.push(valueDisplay);
                    rawValues.push(rawValue);
                });
                
                tableData.push({
                    category: categoryResult.name, 
                    values: rowValues,
                    rawValues: rawValues,
                    categoryData: categoryResult.categoryData
                });
            });
            
            return tableData;
        }
        
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
                
                if (selectedWorkorders.length === 0 && selectedPurchaseOrders.length === 0) {
                    runBtn.innerHTML = originalText;
                    runBtn.disabled = false;
                    runBtn.style.opacity = '1';
                    runBtn.style.cursor = 'pointer';
                    isProcessing = false;
                    return alert("Please select at least one work order or purchase order.");
                }
                
                if (comparisonMode) {
                    // Comparison mode - query both periods
                    const p1Start = $("#period1Start").value;
                    const p1End = $("#period1End").value;
                    const p2Start = $("#period2Start").value;
                    const p2End = $("#period2End").value;
                    
                    if (!p1Start || !p1End || !p2Start || !p2End) {
                        runBtn.innerHTML = originalText;
                        runBtn.disabled = false;
                        runBtn.style.opacity = '1';
                        runBtn.style.cursor = 'pointer';
                        isProcessing = false;
                        return alert("Please select dates for both periods.");
                    }
                    
                    updateStatus(`Querying Period 1 (${p1Start} to ${p1End})...`, "processing");
                    period1Data = await queryPeriod(p1Start, p1End, false, true);
                    
                    updateStatus(`Querying Period 2 (${p2Start} to ${p2End})...`, "processing");
                    period2Data = await queryPeriod(p2Start, p2End, false, true);
                    
                    // Build comparison table
                    currentTableData = [];
                    period2Data.forEach((p2Row, rowIdx) => {
                        const p1Row = period1Data[rowIdx];
                        const values = [];
                        const rawValues = [];
                        
                        // Calculate total variance
                        let p1Total = 0, p2Total = 0;
                        
                        targetLayers.forEach((layer, colIdx) => {
                            const p1Val = p1Row.rawValues[colIdx] || 0;
                            const p2Val = p2Row.rawValues[colIdx] || 0;
                            
                            p1Total += p1Val;
                            p2Total += p2Val;
                            
                            values.push(p2Row.values[colIdx]);
                            rawValues.push(p2Val);
                        });
                        
                        const varianceTotal = p2Total - p1Total;
                        const percentChange = p1Total > 0 ? ((p2Total - p1Total) / p1Total * 100) : 0;
                        
                        currentTableData.push({
                            category: p2Row.category,
                            values: values,
                            rawValues: rawValues,
                            categoryData: p2Row.categoryData,
                            varianceTotal: varianceTotal,
                            percentChange: percentChange
                        });
                    });
                    
                    velocityData = null; // No velocity in comparison mode
                    updateStatus(`Comparison completed: Period 1 vs Period 2`, "success");
                    
                } else {
                    // Single period mode
                    const start = $("#startDate").value;
                    const end = $("#endDate").value;
                    const allTimeMode = $("#startDate").disabled;
                    
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
                    
                    const dateRangeText = allTimeMode ? "All Time" : `${s} to ${e}`;
                    updateStatus(`Querying layers for ${dateRangeText}...`, "processing");
                    
                    currentTableData = await queryPeriod(s, e, allTimeMode, false);
                    
                    // Calculate velocity metrics
                    velocityData = await calculateVelocity(s, e, allTimeMode);
                    
                    // Add totals row
                    const totals = new Array(targetLayers.length).fill(0);
                    currentTableData.forEach(row => {
                        row.rawValues.forEach((val, idx) => {
                            totals[idx] += val;
                        });
                    });
                    
                    currentTableData.push({
                        category: 'TOTALS',
                        values: totals.map(total => total.toLocaleString())
                    });
                    
                    updateStatus(`Report completed for ${dateRangeText}`, "success");
                }
                
                // Show view options and render
                $("#viewOptions").style.display = "block";
                renderAlerts();
                renderSummary();
                renderTable();
                $("#exportBtn").style.display = "inline-block";
                
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
        
        console.log('Metrics By WOID Tool loaded successfully (Week 4 Analytics)');
        
    } catch (error) {
        console.error('Error loading Metrics By WOID Tool:', error);
        alert("Error creating Metrics By WOID Tool: " + (error.message || error));
    }
})();
