// tools/wo-dashboard.js - Work Order Analytics Dashboard
// Features:
// - Overview of all active work orders with key metrics
// - Quality tracking per WO
// - Run rate and completion forecasting
// - Drill-down detailed analysis
// - Global crew performance
// - Stale project tracking

(function() {
    try {
        // Check if tool is already active
        if (window.gisToolHost.activeTools.has('wo-dashboard')) {
            console.log('WO Dashboard Tool already active');
            return;
        }
        
        // Remove any leftover toolbox
        const existingToolbox = document.getElementById('woDashboardToolbox');
        if (existingToolbox) {
            existingToolbox.remove();
            console.log('Removed leftover WO dashboard toolbox');
        }
        
        // Use shared utilities
        const utils = window.gisSharedUtils;
        if (!utils) {
            throw new Error('Shared utilities not loaded');
        }
        
        const mapView = utils.getMapView();
        
        // Target layers configuration with weights
        const targetLayers = [
            {id: 41050, name: "Fiber Cable", metric: "sum", field: "calculated_length", additionalFilter: "cable_category <> 'DROP'", weight: 0.50, stage: "Main Infrastructure", color: "#2196F3"},
            {id: 42050, name: "Underground Span", metric: "sum", field: "calculated_length", weight: 0.10, stage: "Foundation", color: "#795548"},
            {id: 43050, name: "Aerial Span", metric: "sum", field: "calculated_length", additionalFilter: "physical_status <> 'EXISTINGINFRASTRUCTURE'", weight: 0.10, stage: "Foundation", color: "#9C27B0"},
            {id: 42100, name: "Vault", metric: "count", field: "objectid", weight: 0.05, stage: "Foundation", color: "#607D8B"},
            {id: 41150, name: "Splice Closure", metric: "count", field: "objectid", weight: 0.15, stage: "Finishing", color: "#FF9800"},
            {id: 41100, name: "Fiber Equipment", metric: "count", field: "objectid", weight: 0.10, stage: "Finishing", color: "#4CAF50"}
        ];
        
        const z = 99999;
        
        // Tool state
        let selectedPurchaseOrders = [];
        let allPurchaseOrders = [];
        let selectedLayers = targetLayers.map((_, idx) => idx); // All selected by default
        let overviewData = {
            activeWorkOrders: [],
            staleWorkOrders: [],
            globalCrewPerformance: null
        };
        let selectedWOForDrilldown = null;
        let drilldownData = null;
        let isProcessing = false;
        let sortBy = 'completion'; // completion, billing, invoice, lastActivity
        
        // Helper function to get selected layers with recalculated weights
        function getSelectedLayers() {
    return targetLayers.filter((_, idx) => selectedLayers.includes(idx));
}
        
        // Helper function to get completion bar color
        function getCompletionColor(percent) {
            if (percent >= 80) return '#4caf50'; // Green
            if (percent >= 50) return '#ff9800'; // Orange
            return '#f44336'; // Red
        }
        
        // Helper function to format dates
        function formatDateForInput(date) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }
        
        // Helper function to calculate days between dates
        function daysBetween(date1, date2) {
            const oneDay = 24 * 60 * 60 * 1000;
            return Math.round((date2 - date1) / oneDay);
        }
        
       const styles = document.createElement('style');
styles.textContent = `
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
    .wo-card {
        border: 1px solid #ddd;
        border-radius: 6px;
        padding: 12px;
        background: #fff;
        transition: all 0.2s;
        cursor: pointer;
        position: relative;
    }
    .wo-card:hover {
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        transform: translateY(-2px);
    }
    .wo-card.selected {
        border: 2px solid #3367d6;
        background: #f0f7ff;
    }
    .stale-project-item:hover {
        background-color: #fff3e0 !important;
    }
    .stale-project-item.selected {
        background-color: #ffecb3 !important;
        font-weight: bold;
    }
    .progress-bar-container {
        width: 100%;
        height: 8px;
        background: #e0e0e0;
        border-radius: 4px;
        overflow: hidden;
        margin: 3px 0;
    }
    .progress-bar-fill {
        height: 100%;
        transition: width 0.3s ease;
    }
    .freshness-indicator {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        margin-right: 4px;
    }
    .freshness-green { background: #4caf50; }
    .freshness-yellow { background: #ffc107; }
    .freshness-orange { background: #ff9800; }
    .freshness-red { background: #f44336; }
    .alert-badge {
        background: #ff5252;
        color: white;
        padding: 2px 6px;
        border-radius: 10px;
        font-size: 10px;
        font-weight: bold;
    }
    .warning-badge {
        background: #ffa726;
        color: white;
        padding: 2px 6px;
        border-radius: 10px;
        font-size: 10px;
        font-weight: bold;
    }
    .quality-good { color: #4caf50; }
    .quality-warning { color: #ff9800; }
    .quality-critical { color: #f44336; }
    .layer-checkbox-item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 0;
    }
    .layer-color-box {
        width: 16px;
        height: 16px;
        border-radius: 3px;
        border: 1px solid #ccc;
    }
    .stale-section {
        margin-top: 16px;
        padding: 12px;
        background: #fff9e6;
        border: 1px solid #ffd54f;
        border-radius: 6px;
    }
`;
        document.head.appendChild(styles);
        
        // Create tool UI
        const toolBox = document.createElement("div");
        toolBox.id = "woDashboardToolbox";
        toolBox.style.cssText = `
            position: fixed;
            top: 80px;
            right: 40px;
            z-index: ${z};
            background: #fff;
            border: 1px solid #333;
            padding: 12px;
            max-width: 90vw;
            max-height: 85vh;
            overflow: auto;
            font: 12px/1.3 Arial, sans-serif;
            box-shadow: 0 4px 16px rgba(0,0,0,.2);
        `;
        
        toolBox.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <div style="font-weight:bold;font-size:14px;">📊 Work Order Analytics Dashboard</div>
                <button id="closeTool" style="padding:4px 8px;font-size:11px;cursor:pointer;">✖ Close</button>
            </div>
            
            <div style="background:#f8f9fa;padding:10px;border-radius:4px;margin-bottom:12px;">
                <label style="font-weight:bold;margin-bottom:6px;display:block;">🎯 Filters (Optional)</label>
                
                <label style="display:block;margin-bottom:4px;">Purchase Order:</label>
                <div style="position:relative;margin-bottom:8px;">
                    <div id="purchaseDropdown" style="width:100%;border:1px solid #ccc;padding:4px;background:#fff;cursor:pointer;min-height:20px;">
                        <span id="purchasePlaceholder" style="color:#999;"><span class="spinner"></span>Loading...</span>
                    </div>
                    <div id="purchaseOptions" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid #ccc;border-top:none;max-height:150px;overflow-y:auto;z-index:1000;">
                        <div style="padding:4px;background:#f5f5f5;border-bottom:1px solid #ddd;display:flex;gap:4px;">
                            <button id="selectAllPO" style="flex:1;padding:4px;font-size:11px;">All</button>
                            <button id="clearAllPO" style="flex:1;padding:4px;font-size:11px;">Clear</button>
                        </div>
                        <div id="purchaseOptionsList"></div>
                    </div>
                </div>
                
                <label style="font-weight:bold;display:block;margin-bottom:6px;">📋 Layers to Include:</label>
                <div id="layerCheckboxes" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:6px;margin-bottom:8px;"></div>
                
                <button id="loadOverviewBtn" style="width:100%;padding:8px;font-size:12px;background:#3367d6;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:bold;">
                    🔄 Load Overview
                </button>
            </div>
            
            <div id="toolStatus" style="margin:8px 0;padding:6px;border-radius:3px;display:none;"></div>
            
            <div id="overviewSection" style="display:none;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                    <div style="font-weight:bold;font-size:13px;">🏗️ Active Projects (<span id="activeCount">0</span>)</div>
                    <select id="sortBy" style="padding:4px;font-size:11px;">
                        <option value="completion">Sort by: Completion % (least first)</option>
                        <option value="billing">Sort by: Billing % (least first)</option>
                        <option value="invoice">Sort by: Invoice % (least first)</option>
                        <option value="lastActivity">Sort by: Last Activity (stalest first)</option>
                    </select>
                </div>
                
                <div id="overviewCards" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;margin-bottom:16px;"></div>
                
                <div id="staleSection" style="display:none;" class="stale-section">
                    <div style="cursor:pointer;font-weight:bold;margin-bottom:8px;" id="staleHeader">
                        ⚠️ Stale Projects (<span id="staleCount">0</span>) - No activity in 40+ days [▼ Expand]
                    </div>
                    <div id="staleList" style="display:none;font-size:11px;"></div>
                </div>
                
                <div id="crewPerformanceSection" style="margin-top:16px;padding:12px;background:#f8f9fa;border:1px solid #d0d5dd;border-radius:4px;">
                    <div style="font-weight:bold;font-size:13px;margin-bottom:12px;">👷 Global Crew Performance</div>
                    <div id="crewPerformanceContent"></div>
                </div>
            </div>
            
            <div id="drilldownSection" style="display:none;margin-top:16px;padding:12px;background:#f0f7ff;border:1px solid #3367d6;border-radius:6px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                    <div style="font-weight:bold;font-size:13px;">📋 Detailed Analysis: <span id="selectedWOName">-</span></div>
                    <button id="closeDrilldown" style="padding:4px 8px;font-size:11px;">✖ Close</button>
                </div>
                
                <div style="margin-bottom:12px;">
                    <div style="font-weight:bold;margin-bottom:6px;">📅 Filter by Date Range (Optional)</div>
                    <div style="display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap;">
                        <button class="drilldown-date-preset" data-days="7" style="padding:4px 8px;font-size:11px;">Last 7 Days</button>
                        <button class="drilldown-date-preset" data-days="30" style="padding:4px 8px;font-size:11px;">Last 30 Days</button>
                        <button class="drilldown-date-preset" data-preset="this-month" style="padding:4px 8px;font-size:11px;">This Month</button>
                        <button class="drilldown-date-preset" data-preset="last-month" style="padding:4px 8px;font-size:11px;">Last Month</button>
                        <button id="allTimeDrilldownBtn" style="padding:4px 8px;font-size:11px;background:#3367d6;color:#fff;">All Time</button>
                    </div>
                    <div style="display:flex;gap:8px;">
                        <div style="flex:1;">
                            <label style="font-size:11px;">Start Date</label>
                            <input type="date" id="drilldownStartDate" style="width:100%;">
                        </div>
                        <div style="flex:1;">
                            <label style="font-size:11px;">End Date</label>
                            <input type="date" id="drilldownEndDate" style="width:100%;">
                        </div>
                        <div style="display:flex;align-items:end;">
                            <button id="runDrilldownBtn" style="padding:6px 12px;white-space:nowrap;">🔍 Filter</button>
                        </div>
                    </div>
                </div>
                
                <div id="drilldownResults"></div>
            </div>
            
            <div style="margin-top:12px;display:flex;gap:8px;">
                <button id="exportBtn" style="display:none;padding:6px 12px;font-size:11px;">📥 Export</button>
            </div>
        `;
        
        document.body.appendChild(toolBox);
        
        // Get UI elements
        const $ = (id) => toolBox.querySelector(id);
        const status = $("#toolStatus");
        
        function updateStatus(message, type = 'info') {
            if (!message) {
                status.style.display = 'none';
                return;
            }
            
            status.style.display = 'block';
            const colors = {
                'info': '#e3f2fd',
                'success': '#e8f5e9',
                'error': '#ffebee',
                'warning': '#fff3e0',
                'processing': '#f3e5f5'
            };
            status.style.background = colors[type] || colors.info;
            status.style.color = '#333';
            
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
        
        // Initialize layer checkboxes
        function initializeLayerCheckboxes() {
            const container = $("#layerCheckboxes");
            container.innerHTML = targetLayers.map((layer, idx) => `
                <label class="layer-checkbox-item" style="cursor:pointer;">
                    <input type="checkbox" class="layer-checkbox" data-index="${idx}" checked>
                    <span class="layer-color-box" style="background:${layer.color};"></span>
                    <span style="font-size:11px;">${layer.name}</span>
                </label>
            `).join('');
            
            container.querySelectorAll('.layer-checkbox').forEach(checkbox => {
                checkbox.addEventListener('change', (e) => {
                    const idx = parseInt(e.target.dataset.index);
                    if (e.target.checked) {
                        if (!selectedLayers.includes(idx)) {
                            selectedLayers.push(idx);
                            selectedLayers.sort((a, b) => a - b);
                        }
                    } else {
                        selectedLayers = selectedLayers.filter(i => i !== idx);
                    }
                });
            });
        }
        
        initializeLayerCheckboxes();
        
        // Load purchase orders
        async function loadPurchaseOrders() {
            try {
                const allFL = mapView.map.allLayers.filter(l => l.type === "feature");
                const fiberLayer = allFL.find(l => l.layerId === 41050);
                
                if (!fiberLayer) {
                    $("#purchasePlaceholder").innerHTML = "Fiber layer not found";
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
                    console.log("Could not access field info");
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
                    <div class="purchase-option dropdown-option" data-value="${po.code.toString().replace(/"/g, '&quot;')}" 
                         style="padding:6px;cursor:pointer;border-bottom:1px solid #eee;">
                        <input type="checkbox" style="margin-right:6px;"> ${po.name}
                    </div>
                `).join('');
                
                $("#purchaseOptionsList").innerHTML = optionsHtml;
                $("#purchasePlaceholder").innerHTML = "All Purchase Orders";
                
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
                $("#purchasePlaceholder").innerHTML = "Error loading";
            }
        }
        
        function updatePurchaseDropdownDisplay() {
            const placeholder = $("#purchasePlaceholder");
            const total = allPurchaseOrders.length;
            const selected = selectedPurchaseOrders.length;
            
            if (selected === 0 || selected === total) {
                placeholder.innerHTML = "All Purchase Orders";
                placeholder.style.color = "#333";
            } else if (selected === 1) {
                const selectedPO = allPurchaseOrders.find(p => p.code.toString() === selectedPurchaseOrders[0]);
                placeholder.innerHTML = selectedPO ? selectedPO.name : selectedPurchaseOrders[0];
                placeholder.style.color = "#333";
            } else {
                placeholder.innerHTML = `${selected} of ${total} selected`;
                placeholder.style.color = "#333";
            }
        }
        
        // Build filter clause
        function buildFilterClause() {
            const clauses = [];
            
            if (selectedPurchaseOrders.length > 0 && selectedPurchaseOrders.length < allPurchaseOrders.length) {
                const purchaseClause = selectedPurchaseOrders
                    .map(po => `purchase_order_id='${po.toString().replace(/'/g, "''")}'`)
                    .join(' OR ');
                clauses.push(`(${purchaseClause})`);
            }
            
            return clauses.length > 0 ? clauses.join(' AND ') : "1=1";
        }
        
        // Load all work orders and get last activity
        async function loadAllWorkOrders() {
            try {
                const allFL = mapView.map.allLayers.filter(l => l.type === "feature");
                const fiberLayer = allFL.find(l => l.layerId === 41050);
                
                if (!fiberLayer) {
                    throw new Error("Fiber layer not found");
                }
                
                await fiberLayer.load();
                
                const filterClause = buildFilterClause();
                
                // Get all unique work orders
                const woQuery = await fiberLayer.queryFeatures({
                    where: `(${filterClause}) AND workorder_id IS NOT NULL AND workorder_id <> ''`,
                    outFields: ["workorder_id"],
                    returnGeometry: false,
                    returnDistinctValues: true
                });
                
                const workOrders = [...new Set(
                    woQuery.features
                        .map(f => f.attributes.workorder_id)
                        .filter(v => v && v.toString().trim())
                )];
                
                console.log(`Found ${workOrders.length} work orders`);
                
                // Get most recent activity for each WO across all selected layers
                const layersToQuery = getSelectedLayers();
                const woActivityMap = new Map();
                
                for (const wo of workOrders) {
                    let mostRecentDate = null;
                    
                    for (const targetLayer of layersToQuery) {
                        const layer = allFL.find(l => l.layerId === targetLayer.id);
                        if (!layer) continue;
                        
                        await layer.load();
                        
                        const recentQuery = await layer.queryFeatures({
                            where: `(${filterClause}) AND workorder_id='${wo.toString().replace(/'/g, "''")}' AND installation_date IS NOT NULL`,
                            outFields: ["installation_date"],
                            orderByFields: ["installation_date DESC"],
                            num: 1,
                            returnGeometry: false
                        });
                        
                        if (recentQuery.features.length > 0) {
                            const date = new Date(recentQuery.features[0].attributes.installation_date);
                            if (!mostRecentDate || date > mostRecentDate) {
                                mostRecentDate = date;
                            }
                        }
                    }
                    
                    woActivityMap.set(wo, mostRecentDate);
                }
                
                // Split into active and stale
                const today = new Date();
                const activeThreshold = 40; // days
                const activeWOs = [];
                const staleWOs = [];
                
                for (const [wo, lastActivity] of woActivityMap.entries()) {
                    const daysSince = lastActivity ? daysBetween(lastActivity, today) : 999;
                    
                    if (daysSince <= activeThreshold) {
                        activeWOs.push({ 
                            workOrderId: wo, 
                            lastActivity: lastActivity,
                            daysSince: daysSince
                        });
                    } else {
                        staleWOs.push({ 
                            workOrderId: wo, 
                            lastActivity: lastActivity,
                            daysSince: daysSince
                        });
                    }
                }
                
                console.log(`Active: ${activeWOs.length}, Stale: ${staleWOs.length}`);
                
                return { activeWOs, staleWOs };
                
            } catch (error) {
                console.error("Error loading work orders:", error);
                throw error;
            }
        }
        
        // Calculate Fiber & UG metrics for a single WO (for overview cards)
        async function calculateFiberUGMetrics(workOrderId, layersToQuery, filterClause) {
            const allFL = mapView.map.allLayers.filter(l => l.type === "feature");
            const woClause = `workorder_id='${workOrderId.toString().replace(/'/g, "''")}'`;
            
            const metrics = {
                fiberOutstanding: 0,
                ugOutstanding: 0,
                fiberRunRate: 0,
                ugRunRate: 0,
                expectedCompletion: "N/A"
            };
            // Fiber Cable
const fiberLayer = allFL.find(l => l.layerId === 41050);
if (fiberLayer) {
    await fiberLayer.load();
    const additionalFilter = "cable_category <> 'DROP'";
    
    const constructedWhere = `(${filterClause}) AND ${woClause} AND workflow_status <> 'DNB' AND workflow_status <> 'ONHOLD' AND workflow_status <> 'DEFRD' AND workflow_status <> 'NA' AND workflow_status <> 'ASSG' AND workflow_status <> 'INPROG' AND ${additionalFilter}`;
    const constructedQuery = await fiberLayer.queryFeatures({
        where: constructedWhere,
        outFields: ["calculated_length", "installation_date", "workflow_status"],
        returnGeometry: false
    });
    
    let fiberConstructed = 0;
    let fiberDailyComplete = 0;
    let firstInstallDate = null;
    let lastInstallDate = null;
    
    constructedQuery.features.forEach(f => {
        const length = Number(f.attributes.calculated_length) || 0;
        const status = f.attributes.workflow_status;
        
        fiberConstructed += length;
        
        if (status === 'DLYCMPLT' || status === 'INVCMPLT') {
            fiberDailyComplete += length;
        }
        
        const installDate = f.attributes.installation_date;
        if (installDate) {
            const date = new Date(installDate);
            if (!firstInstallDate || date < firstInstallDate) {
                firstInstallDate = date;
            }
            if (!lastInstallDate || date > lastInstallDate) {
                lastInstallDate = date;
            }
        }
    });
    
    metrics.fiberOutstanding = Math.round(Math.max(0, fiberConstructed - fiberDailyComplete));
    
    // Calculate run rate based on 5-day work week
    if (firstInstallDate && lastInstallDate) {
        const calendarDays = daysBetween(firstInstallDate, lastInstallDate) + 1; // +1 to include both first and last day
        const workingDays = Math.max(1, Math.round((calendarDays / 7) * 5));
        metrics.fiberRunRate = Math.round(fiberConstructed / workingDays);
    } else {
        metrics.fiberRunRate = 0;
    }
}
            
            // Underground Span
const ugLayer = allFL.find(l => l.layerId === 42050);
if (ugLayer) {
    await ugLayer.load();
    
    const constructedWhere = `(${filterClause}) AND ${woClause} AND workflow_status <> 'DNB' AND workflow_status <> 'ONHOLD' AND workflow_status <> 'DEFRD' AND workflow_status <> 'NA' AND workflow_status <> 'ASSG' AND workflow_status <> 'INPROG'`;
    const constructedQuery = await ugLayer.queryFeatures({
        where: constructedWhere,
        outFields: ["calculated_length", "installation_date", "workflow_status"],
        returnGeometry: false
    });
    
    let ugConstructed = 0;
    let ugDailyComplete = 0;
    let firstInstallDate = null;
    let lastInstallDate = null;
    
    constructedQuery.features.forEach(f => {
        const length = Number(f.attributes.calculated_length) || 0;
        const status = f.attributes.workflow_status;
        
        ugConstructed += length;
        
        if (status === 'DLYCMPLT' || status === 'INVCMPLT') {
            ugDailyComplete += length;
        }
        
        const installDate = f.attributes.installation_date;
        if (installDate) {
            const date = new Date(installDate);
            if (!firstInstallDate || date < firstInstallDate) {
                firstInstallDate = date;
            }
            if (!lastInstallDate || date > lastInstallDate) {
                lastInstallDate = date;
            }
        }
    });
    
    metrics.ugOutstanding = Math.round(Math.max(0, ugConstructed - ugDailyComplete));
    
    // Calculate run rate based on 5-day work week
    if (firstInstallDate && lastInstallDate) {
        const calendarDays = daysBetween(firstInstallDate, lastInstallDate) + 1; // +1 to include both first and last day
        const workingDays = Math.max(1, Math.round((calendarDays / 7) * 5));
        metrics.ugRunRate = Math.round(ugConstructed / workingDays);
    } else {
        metrics.ugRunRate = 0;
    }
}
            
            // Calculate remaining work for expected completion
            const fiberLayerIdx = layersToQuery.findIndex(l => l.id === 41050);
            const ugLayerIdx = layersToQuery.findIndex(l => l.id === 42050);
            
            // We need to get Designed amounts - query them
            let fiberRemaining = 0;
            let ugRemaining = 0;
            
            if (fiberLayerIdx >= 0 && fiberLayer) {
                const designedWhere = `(${filterClause}) AND ${woClause} AND workflow_status <> 'DNB' AND workflow_status <> 'ONHOLD' AND workflow_status <> 'DEFRD' AND cable_category <> 'DROP'`;
                const designedQuery = await fiberLayer.queryFeatures({
                    where: designedWhere,
                    outFields: ["calculated_length"],
                    returnGeometry: false
                });
                const fiberDesigned = designedQuery.features.reduce((sum, f) => sum + (Number(f.attributes.calculated_length) || 0), 0);
                
                const constructedWhere = `(${filterClause}) AND ${woClause} AND workflow_status <> 'DNB' AND workflow_status <> 'ONHOLD' AND workflow_status <> 'DEFRD' AND workflow_status <> 'NA' AND workflow_status <> 'ASSG' AND workflow_status <> 'INPROG' AND cable_category <> 'DROP'`;
                const constructedQuery = await fiberLayer.queryFeatures({
                    where: constructedWhere,
                    outFields: ["calculated_length"],
                    returnGeometry: false
                });
                const fiberConstructed = constructedQuery.features.reduce((sum, f) => sum + (Number(f.attributes.calculated_length) || 0), 0);
                
                fiberRemaining = Math.max(0, fiberDesigned - fiberConstructed);
            }
            
            if (ugLayerIdx >= 0 && ugLayer) {
                const designedWhere = `(${filterClause}) AND ${woClause} AND workflow_status <> 'DNB' AND workflow_status <> 'ONHOLD' AND workflow_status <> 'DEFRD'`;
                const designedQuery = await ugLayer.queryFeatures({
                    where: designedWhere,
                    outFields: ["calculated_length"],
                    returnGeometry: false
                });
                const ugDesigned = designedQuery.features.reduce((sum, f) => sum + (Number(f.attributes.calculated_length) || 0), 0);
                
                const constructedWhere = `(${filterClause}) AND ${woClause} AND workflow_status <> 'DNB' AND workflow_status <> 'ONHOLD' AND workflow_status <> 'DEFRD' AND workflow_status <> 'NA' AND workflow_status <> 'ASSG' AND workflow_status <> 'INPROG'`;
                const constructedQuery = await ugLayer.queryFeatures({
                    where: constructedWhere,
                    outFields: ["calculated_length"],
                    returnGeometry: false
                });
                const ugConstructed = constructedQuery.features.reduce((sum, f) => sum + (Number(f.attributes.calculated_length) || 0), 0);
                
                ugRemaining = Math.max(0, ugDesigned - ugConstructed);
            }
            
            // Expected completion
            metrics.expectedCompletion = calculateExpectedCompletion(
                fiberRemaining,
                ugRemaining,
                metrics.fiberRunRate,
                metrics.ugRunRate,
                false
            );
            
            return metrics;
        }
        
        // Calculate quality metrics for a single WO (for overview cards)
        async function calculateWOQualityMetrics(workOrderId, filterClause) {
            const allFL = mapView.map.allLayers.filter(l => l.type === "feature");
            const gigLayer = allFL.find(l => l.layerId === 22100);
            
            if (!gigLayer) {
                return { openGigs: 0, avgApprovalDays: null };
            }
            
            await gigLayer.load();
            
            const woClause = `workorder_id='${workOrderId.toString().replace(/'/g, "''")}'`;
            const whereClause = `(${filterClause}) AND ${woClause}`;
            
            const gigQuery = await gigLayer.queryFeatures({
                where: whereClause,
                outFields: ["gig_status", "approval_days"],
                returnGeometry: false
            });
            
            let openGigs = 0;
            let totalApprovalDays = 0;
            let approvedCount = 0;
            
            gigQuery.features.forEach(feature => {
                const status = feature.attributes.gig_status;
                const approvalDays = feature.attributes.approval_days;
                
                if (status === 'OPEN') {
                    openGigs++;
                } else if (status === 'APPROVED' && approvalDays != null && !isNaN(approvalDays)) {
                    totalApprovalDays += Number(approvalDays);
                    approvedCount++;
                }
            });
            
            const avgApprovalDays = approvedCount > 0 ? (totalApprovalDays / approvedCount) : null;
            
            return { openGigs, avgApprovalDays };
        }
        async function batchCalculateMetrics(workOrderIds, layersToQuery, filterClause) {
            const allFL = mapView.map.allLayers.filter(l => l.type === "feature");
            
            // Build WO filter clause
            const woClause = workOrderIds.map(wo => `workorder_id='${wo.toString().replace(/'/g, "''")}'`).join(' OR ');
            
            // Initialize result map for each WO
const woMetrics = new Map();
workOrderIds.forEach(wo => {
    woMetrics.set(wo, {
        designed: 0,
        constructed: 0,
        dailycomplete: 0,
        invoiced: 0,
        fiberConstructed: 0,
        fiberDailyComplete: 0,
        fiberFirstInstall: null,
        fiberLastInstall: null,
        ugConstructed: 0,
        ugDailyComplete: 0,
        ugFirstInstall: null,
        ugLastInstall: null,
        // Per-layer tracking
        layerMetrics: []
    });
});
            
            // Initialize per-layer arrays
            workOrderIds.forEach(wo => {
                const metrics = woMetrics.get(wo);
                layersToQuery.forEach(() => {
                    metrics.layerMetrics.push({
                        designed: 0,
                        constructed: 0,
                        dailycomplete: 0,
                        invoiced: 0
                    });
                });
            });
            
            // Categories to query
            const categories = [
                {name: "designed", excludeStatuses: ['DNB', 'ONHOLD', 'DEFRD']},
                {name: "constructed", excludeStatuses: ['DNB', 'ONHOLD', 'DEFRD', 'NA', 'ASSG', 'INPROG']},
                {name: "dailycomplete", includeStatuses: ['DLYCMPLT','INVCMPLT']},
                {name: "invoiced", includeStatuses: ['INVCMPLT']}
            ];
            
            // Query each layer once for all WOs
            for (let layerIndex = 0; layerIndex < layersToQuery.length; layerIndex++) {
                const targetLayer = layersToQuery[layerIndex];
                const layer = allFL.find(l => l.layerId === targetLayer.id);
                if (!layer) continue;
                
                await layer.load();
                
                // Query each category
                for (const category of categories) {
                    let statusClause;
                    if (category.includeStatuses) {
                        statusClause = category.includeStatuses.map(s => `workflow_status = '${s}'`).join(' OR ');
                    } else if (category.excludeStatuses) {
                        statusClause = category.excludeStatuses.map(s => `workflow_status <> '${s}'`).join(' AND ');
                    }
                    
                    let additionalFilter = "";
                    if (targetLayer.additionalFilter) {
                        additionalFilter = ` AND ${targetLayer.additionalFilter}`;
                    }
                    
                    const whereClause = `(${filterClause}) AND (${woClause}) AND (${statusClause})${additionalFilter}`;
                    
                    const queryResult = await layer.queryFeatures({
                        where: whereClause,
                        outFields: ["workorder_id", targetLayer.field],
                        returnGeometry: false
                    });
                    
                    // Group by work order
                    queryResult.features.forEach(feature => {
                        const wo = feature.attributes.workorder_id;
                        if (!woMetrics.has(wo)) return;
                        
                        const metrics = woMetrics.get(wo);
                        
                        let value = 0;
                        if (targetLayer.metric === "count") {
                            value = 1;
                        } else if (targetLayer.metric === "sum") {
                            value = Number(feature.attributes[targetLayer.field]) || 0;
                        }
                        
                        // Add to totals
                        metrics[category.name] += value;
                        
                        // Add to per-layer tracking
                        metrics.layerMetrics[layerIndex][category.name] += value;
                    });
                }
            }
            
            // Query Fiber Cable specifically (for awaiting billing and run rate)
const fiberLayer = allFL.find(l => l.layerId === 41050);
if (fiberLayer) {
    await fiberLayer.load();
    const additionalFilter = "cable_category <> 'DROP'";
    
    // Constructed (with installation dates for run rate) - ALL TIME
    const constructedWhere = `(${filterClause}) AND (${woClause}) AND workflow_status <> 'DNB' AND workflow_status <> 'ONHOLD' AND workflow_status <> 'DEFRD' AND workflow_status <> 'NA' AND workflow_status <> 'ASSG' AND workflow_status <> 'INPROG' AND ${additionalFilter}`;
    const constructedQuery = await fiberLayer.queryFeatures({
        where: constructedWhere,
        outFields: ["workorder_id", "calculated_length", "installation_date", "workflow_status"],
        returnGeometry: false
    });
    
    constructedQuery.features.forEach(f => {
        const wo = f.attributes.workorder_id;
        if (!woMetrics.has(wo)) return;
        
        const metrics = woMetrics.get(wo);
        const length = Number(f.attributes.calculated_length) || 0;
        const status = f.attributes.workflow_status;
        
        metrics.fiberConstructed += length;
        
        // Track daily complete separately for fiber
        if (status === 'DLYCMPLT' || status === 'INVCMPLT') {
            metrics.fiberDailyComplete += length;
        }
        
        // Track first and last installation dates
        const installDate = f.attributes.installation_date;
        if (installDate) {
            const date = new Date(installDate);
            if (!metrics.fiberFirstInstall || date < metrics.fiberFirstInstall) {
                metrics.fiberFirstInstall = date;
            }
            if (!metrics.fiberLastInstall || date > metrics.fiberLastInstall) {
                metrics.fiberLastInstall = date;
            }
        }
    });
}
            
           // Query Underground Span specifically
const ugLayer = allFL.find(l => l.layerId === 42050);
if (ugLayer) {
    await ugLayer.load();
    
    // Constructed (with installation dates) - ALL TIME
    const constructedWhere = `(${filterClause}) AND (${woClause}) AND workflow_status <> 'DNB' AND workflow_status <> 'ONHOLD' AND workflow_status <> 'DEFRD' AND workflow_status <> 'NA' AND workflow_status <> 'ASSG' AND workflow_status <> 'INPROG'`;
    const constructedQuery = await ugLayer.queryFeatures({
        where: constructedWhere,
        outFields: ["workorder_id", "calculated_length", "installation_date", "workflow_status"],
        returnGeometry: false
    });
    
    constructedQuery.features.forEach(f => {
        const wo = f.attributes.workorder_id;
        if (!woMetrics.has(wo)) return;
        
        const metrics = woMetrics.get(wo);
        const length = Number(f.attributes.calculated_length) || 0;
        const status = f.attributes.workflow_status;
        
        metrics.ugConstructed += length;
        
        // Track daily complete separately for UG
        if (status === 'DLYCMPLT' || status === 'INVCMPLT') {
            metrics.ugDailyComplete += length;
        }
        
        // Track first and last installation dates
        const installDate = f.attributes.installation_date;
        if (installDate) {
            const date = new Date(installDate);
            if (!metrics.ugFirstInstall || date < metrics.ugFirstInstall) {
                metrics.ugFirstInstall = date;
            }
            if (!metrics.ugLastInstall || date > metrics.ugLastInstall) {
                metrics.ugLastInstall = date;
            }
        }
    });
}
            
            // Calculate derived metrics for each WO (using weighted percentages like detailed breakdown)
            woMetrics.forEach((metrics, wo) => {
               // Calculate simple total percentages
let totalDesigned = 0;
let totalConstructed = 0;
let totalDailyComplete = 0;
let totalInvoiced = 0;

layersToQuery.forEach((layer, idx) => {
    totalDesigned += metrics.layerMetrics[idx].designed || 0;
    totalConstructed += metrics.layerMetrics[idx].constructed || 0;
    totalDailyComplete += metrics.layerMetrics[idx].dailycomplete || 0;
    totalInvoiced += metrics.layerMetrics[idx].invoiced || 0;
});

metrics.completionPct = totalDesigned > 0 ? (totalConstructed / totalDesigned) * 100 : 0;
metrics.billingPct = totalDesigned > 0 ? (totalDailyComplete / totalDesigned) * 100 : 0;
metrics.invoicePct = totalDesigned > 0 ? (totalInvoiced / totalDesigned) * 100 : 0;
                
                // Awaiting billing = Constructed but not yet marked for billing
metrics.fiberOutstanding = Math.round(Math.max(0, metrics.fiberConstructed - metrics.fiberDailyComplete));
metrics.ugOutstanding = Math.round(Math.max(0, metrics.ugConstructed - metrics.ugDailyComplete));

// Run rates based on 5-day work week
if (metrics.fiberFirstInstall && metrics.fiberLastInstall) {
    const calendarDays = daysBetween(metrics.fiberFirstInstall, metrics.fiberLastInstall) + 1;
    const workingDays = Math.max(1, Math.round((calendarDays / 7) * 5));
    metrics.fiberRunRate = Math.round(metrics.fiberConstructed / workingDays);
} else {
    metrics.fiberRunRate = 0;
}

if (metrics.ugFirstInstall && metrics.ugLastInstall) {
    const calendarDays = daysBetween(metrics.ugFirstInstall, metrics.ugLastInstall) + 1;
    const workingDays = Math.max(1, Math.round((calendarDays / 7) * 5));
    metrics.ugRunRate = Math.round(metrics.ugConstructed / workingDays);
} else {
    metrics.ugRunRate = 0;
}
                
                // For expected completion: calculate remaining work based on fiber & UG designed vs constructed
                // Use the Fiber and UG layer metrics to get designed amounts
                const fiberLayerIdx = layersToQuery.findIndex(l => l.id === 41050);
                const ugLayerIdx = layersToQuery.findIndex(l => l.id === 42050);
                
                let fiberRemaining = 0;
                let ugRemaining = 0;
                
                if (fiberLayerIdx >= 0 && metrics.layerMetrics[fiberLayerIdx]) {
                    const fiberDesigned = metrics.layerMetrics[fiberLayerIdx].designed || 0;
                    const fiberConstructed = metrics.layerMetrics[fiberLayerIdx].constructed || 0;
                    fiberRemaining = Math.max(0, fiberDesigned - fiberConstructed);
                }
                
                if (ugLayerIdx >= 0 && metrics.layerMetrics[ugLayerIdx]) {
                    const ugDesigned = metrics.layerMetrics[ugLayerIdx].designed || 0;
                    const ugConstructed = metrics.layerMetrics[ugLayerIdx].constructed || 0;
                    ugRemaining = Math.max(0, ugDesigned - ugConstructed);
                }
                
                // Expected completion based on remaining construction work
                metrics.expectedCompletion = calculateExpectedCompletion(
                    fiberRemaining,
                    ugRemaining,
                    metrics.fiberRunRate,
                    metrics.ugRunRate,
                    false // construction mode
                );
            });
            
            return woMetrics;
        }
        
        // OPTIMIZED: Batch query quality metrics for all WOs
        async function batchCalculateQualityMetrics(workOrderIds, filterClause) {
            const allFL = mapView.map.allLayers.filter(l => l.type === "feature");
            const gigLayer = allFL.find(l => l.layerId === 22100);
            
            const qualityMetrics = new Map();
            workOrderIds.forEach(wo => {
                qualityMetrics.set(wo, { openGigs: 0, avgApprovalDays: null, approvalDaysSum: 0, approvedCount: 0 });
            });
            
            if (!gigLayer) {
                return qualityMetrics;
            }
            
            await gigLayer.load();
            
            const woClause = workOrderIds.map(wo => `workorder_id='${wo.toString().replace(/'/g, "''")}'`).join(' OR ');
            const whereClause = `(${filterClause}) AND (${woClause})`;
            
            const gigQuery = await gigLayer.queryFeatures({
                where: whereClause,
                outFields: ["workorder_id", "gig_status", "approval_days"],
                returnGeometry: false
            });
            
            gigQuery.features.forEach(feature => {
                const wo = feature.attributes.workorder_id;
                if (!qualityMetrics.has(wo)) return;
                
                const metrics = qualityMetrics.get(wo);
                const status = feature.attributes.gig_status;
                const approvalDays = feature.attributes.approval_days;
                
                if (status === 'OPEN') {
                    metrics.openGigs++;
                } else if (status === 'APPROVED' && approvalDays != null && !isNaN(approvalDays)) {
                    metrics.approvalDaysSum += Number(approvalDays);
                    metrics.approvedCount++;
                }
            });
            
            // Calculate averages
            qualityMetrics.forEach(metrics => {
                if (metrics.approvedCount > 0) {
                    metrics.avgApprovalDays = metrics.approvalDaysSum / metrics.approvedCount;
                }
            });
            
            return qualityMetrics;
        }
        
        // Calculate expected completion
        function calculateExpectedCompletion(fiberOutstanding, ugOutstanding, fiberRunRate, ugRunRate, isBillingMode = false) {
            if (fiberRunRate === 0 && ugRunRate === 0) {
                return "N/A";
            }
            
            let maxDays = 0;
            
            if (fiberRunRate > 0 && fiberOutstanding > 0) {
                const fiberDays = Math.ceil(fiberOutstanding / fiberRunRate);
                maxDays = Math.max(maxDays, fiberDays);
            }
            
            if (ugRunRate > 0 && ugOutstanding > 0) {
                const ugDays = Math.ceil(ugOutstanding / ugRunRate);
                maxDays = Math.max(maxDays, ugDays);
            }
            
            if (maxDays === 0) {
                return isBillingMode ? "Fully Billed" : "Complete";
            }
            
            // Assume 5 production days per week
            const calendarDays = Math.ceil(maxDays * 1.4);
            const completionDate = new Date();
            completionDate.setDate(completionDate.getDate() + calendarDays);
            
            return completionDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        }
        
        // Load overview - main function
        $("#loadOverviewBtn").onclick = async () => {
            if (isProcessing) return;
            
            try {
                isProcessing = true;
                const btn = $("#loadOverviewBtn");
                const originalText = btn.innerHTML;
                btn.innerHTML = '<span class="spinner"></span>Loading...';
                btn.disabled = true;
                
                if (selectedLayers.length === 0) {
                    alert("Please select at least one layer");
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                    isProcessing = false;
                    return;
                }
                
                updateStatus("Loading work orders...", "processing");
                
                const filterClause = buildFilterClause();
                const layersToQuery = getSelectedLayers();
                
                // Step 1: Load all work orders and split by activity
                const { activeWOs, staleWOs } = await loadAllWorkOrders();
                
                if (activeWOs.length === 0) {
                    updateStatus("No active work orders found", "warning");
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                    isProcessing = false;
                    return;
                }
                
                updateStatus(`Loading metrics for ${activeWOs.length} active work orders...`, "processing");
                
                // Step 2: Calculate metrics for all WOs using the SAME logic as detailed breakdown
                const woMetricsPromises = activeWOs.map(async (wo) => {
                    // Use the EXACT same query function as detailed analysis (All Time mode)
                    const tableData = await queryWorkOrderDetails(wo.workOrderId, null, null, layersToQuery, filterClause, true);
                    
                    // Calculate weighted percentages (EXACT same as detailed breakdown rendering)
                    const designedRow = tableData.find(r => r.category === "Designed");
                    const constructedRow = tableData.find(r => r.category === "Constructed");
                    const dailyCompleteRow = tableData.find(r => r.category === "Daily Complete");
                    const invoicedRow = tableData.find(r => r.category === "Invoiced");
                    
                    let completionPct = 0;
                    let billingPct = 0;
                    let invoicePct = 0;
                    let designed = 0;
                    let constructed = 0;
                    let dailycomplete = 0;
                    let invoiced = 0;
                    
                   if (designedRow && constructedRow) {
    layersToQuery.forEach((layer, idx) => {
        const layerDesigned = designedRow.rawValues[idx] || 0;
        const layerConstructed = constructedRow.rawValues[idx] || 0;
        const layerDailyComplete = dailyCompleteRow ? (dailyCompleteRow.rawValues[idx] || 0) : 0;
        const layerInvoiced = invoicedRow ? (invoicedRow.rawValues[idx] || 0) : 0;
        
        designed += layerDesigned;
        constructed += layerConstructed;
        dailycomplete += layerDailyComplete;
        invoiced += layerInvoiced;
    });
    
    // Calculate simple percentages from totals
    completionPct = designed > 0 ? (constructed / designed) * 100 : 0;
    billingPct = designed > 0 ? (dailycomplete / designed) * 100 : 0;
    invoicePct = designed > 0 ? (invoiced / designed) * 100 : 0;
}
                    
                    // Now get Fiber & UG metrics for awaiting billing and run rates
                    const fiberUGMetrics = await calculateFiberUGMetrics(wo.workOrderId, layersToQuery, filterClause);
                    
                    // Quality metrics
                    const qualityMetrics = await calculateWOQualityMetrics(wo.workOrderId, filterClause);
                    
                    return {
                        ...wo,
                        designed,
                        constructed,
                        dailycomplete,
                        invoiced,
                        completionPct,
                        billingPct,
                        invoicePct,
                        ...fiberUGMetrics,
                        ...qualityMetrics
                    };
                });
                
                overviewData.activeWorkOrders = await Promise.all(woMetricsPromises);
                overviewData.staleWorkOrders = staleWOs;
                
                updateStatus("Calculating global crew performance...", "processing");
                
                // Step 3: Calculate global crew performance
                overviewData.globalCrewPerformance = await calculateGlobalCrewPerformance();
                
                updateStatus("Overview loaded successfully!", "success");
                
                // Render
                renderOverview();
                
                btn.innerHTML = originalText;
                btn.disabled = false;
                isProcessing = false;
                
            } catch (error) {
                console.error("Error loading overview:", error);
                updateStatus("Error: " + error.message, "error");
                $("#loadOverviewBtn").innerHTML = '🔄 Load Overview';
                $("#loadOverviewBtn").disabled = false;
                isProcessing = false;
            }
        };
        
        // Calculate global crew performance
        async function calculateGlobalCrewPerformance() {
            try {
                const filterClause = buildFilterClause();
                const layersToQuery = getSelectedLayers();
                const allFL = mapView.map.allLayers.filter(l => l.type === "feature");
                
                // Create domain maps for crew and subcontractor
                const gigLayerForDomains = allFL.find(l => l.layerId === 22100);
                const crewDomainMap = new Map();
                const subcontractorDomainMap = new Map();
                
                if (gigLayerForDomains) {
                    await gigLayerForDomains.load();
                    
                    const crewField = gigLayerForDomains.fields.find(f => f.name === 'crew');
                    if (crewField && crewField.domain && crewField.domain.codedValues) {
                        crewField.domain.codedValues.forEach(cv => {
                            crewDomainMap.set(cv.code, cv.name);
                        });
                    }
                    
                    const subField = gigLayerForDomains.fields.find(f => f.name === 'construction_subcontractor');
                    if (subField && subField.domain && subField.domain.codedValues) {
                        subField.domain.codedValues.forEach(cv => {
                            subcontractorDomainMap.set(cv.code, cv.name);
                        });
                    }
                }
                
                const crewData = new Map();
                
                // Query each layer for crew info (all time)
                for (const targetLayer of layersToQuery) {
                    const layer = allFL.find(l => l.layerId === targetLayer.id);
                    if (!layer) continue;
                    
                    await layer.load();
                    
                    const excludedStatuses = ['DNB', 'ONHOLD', 'DEFRD', 'NA', 'ASSG', 'INPROG'];
                    const statusClause = excludedStatuses.map(s => `workflow_status <> '${s}'`).join(' AND ');
                    
                    let additionalFilter = "";
                    if (targetLayer.additionalFilter) {
                        additionalFilter = ` AND ${targetLayer.additionalFilter}`;
                    }
                    
                    const whereClause = `(${filterClause}) AND (${statusClause})${additionalFilter}`;
                    
                    const queryResult = await layer.queryFeatures({
                        where: whereClause,
                        outFields: ["crew", "construction_subcontractor", "installation_date", targetLayer.field, "workflow_status"],
                        returnGeometry: false
                    });
                    
                    queryResult.features.forEach(feature => {
                        const crewCode = feature.attributes.crew;
                        const subcontractorCode = feature.attributes.construction_subcontractor;
                        const crewDisplayName = crewDomainMap.get(crewCode) || crewCode;
                        const subcontractorDisplayName = subcontractorDomainMap.get(subcontractorCode) || subcontractorCode;
                        const crewName = (crewDisplayName || subcontractorDisplayName)?.toString().trim();
                        if (!crewName) return;
                        
                       if (!crewData.has(crewName)) {
    crewData.set(crewName, {
        name: crewName,
        totalConstructed: 0,
        dailyComplete: 0,
        firstInstallDate: null,
        lastInstallDate: null
    });
}
                        
                        const data = crewData.get(crewName);
                        
                        let value = 0;
                        if (targetLayer.metric === "count") {
                            value = 1;
                        } else if (targetLayer.metric === "sum") {
                            value = Number(feature.attributes[targetLayer.field]) || 0;
                        }
                        data.totalConstructed += value;
                        
                        // Track daily complete separately
                        const status = feature.attributes.workflow_status;
                        if (status === 'DLYCMPLT' || status === 'INVCMPLT') {
                            data.dailyComplete += value;
                        }
                        
                         const installDate = feature.attributes.installation_date;
        if (installDate) {
            const date = new Date(installDate);
            if (!data.firstInstallDate || date < data.firstInstallDate) {
                data.firstInstallDate = date;
            }
            if (!data.lastInstallDate || date > data.lastInstallDate) {
                data.lastInstallDate = date;
            }
        }
    });
}
                
                // Query gig layer for quality metrics
                const gigLayer = allFL.find(l => l.layerId === 22100);
                const qualityData = new Map();
                
                if (gigLayer) {
                    await gigLayer.load();
                    
                    const gigQuery = await gigLayer.queryFeatures({
                        where: `(${filterClause})`,
                        outFields: ["crew", "construction_subcontractor", "gig_status", "approval_days"],
                        returnGeometry: false
                    });
                    
                    gigQuery.features.forEach(feature => {
                        const crewCode = feature.attributes.crew;
                        const subcontractorCode = feature.attributes.construction_subcontractor;
                        const crewDisplayName = crewDomainMap.get(crewCode) || crewCode;
                        const subcontractorDisplayName = subcontractorDomainMap.get(subcontractorCode) || subcontractorCode;
                        const crewName = (crewDisplayName || subcontractorDisplayName)?.toString().trim();
                        if (!crewName) return;
                        
                        const status = feature.attributes.gig_status;
                        const approvalDays = feature.attributes.approval_days;
                        
                        if (!qualityData.has(crewName)) {
                            qualityData.set(crewName, {
                                totalGigs: 0,
                                openGigs: 0,
                                totalApprovalDays: 0,
                                approvalDaysCount: 0
                            });
                        }
                        
                        const qData = qualityData.get(crewName);
                        qData.totalGigs++;
                        
                        if (status === 'OPEN') {
                            qData.openGigs++;
                        } else if (status === 'APPROVED' && approvalDays != null && !isNaN(approvalDays)) {
                            qData.totalApprovalDays += Number(approvalDays);
                            qData.approvalDaysCount++;
                        }
                    });
                }
                
                // Build crew performance array
                const crewPerformance = [];
                
                crewData.forEach((data, crewName) => {
    let dailyRate = 0;
    if (data.firstInstallDate && data.lastInstallDate) {
        const calendarDays = daysBetween(data.firstInstallDate, data.lastInstallDate) + 1;
        const workingDays = Math.max(1, Math.round((calendarDays / 7) * 5));
        dailyRate = data.totalConstructed / workingDays;
    }
                    
                    // Quality metrics
                    const quality = qualityData.get(crewName);
                    const avgApprovalDays = quality && quality.approvalDaysCount > 0 ? 
                        (quality.totalApprovalDays / quality.approvalDaysCount) : null;
                    
                    // Billing metrics
                    const outstandingBilling = Math.round(data.totalConstructed - data.dailyComplete);
                    const billingEfficiency = data.totalConstructed > 0 ? 
                        (data.dailyComplete / data.totalConstructed * 100) : 0;
                    
                    crewPerformance.push({
                        name: crewName,
                        totalConstructed: Math.round(data.totalConstructed),
                        dailyRate: dailyRate,
                        avgApprovalDays: avgApprovalDays,
                        totalGigs: quality ? quality.totalGigs : 0,
                        openGigs: quality ? quality.openGigs : 0,
                        outstandingBilling: outstandingBilling,
                        billingEfficiency: billingEfficiency
                    });
                });
                
                // Sort by daily rate
                crewPerformance.sort((a, b) => b.dailyRate - a.dailyRate);
                
                // Add rankings
                crewPerformance.forEach((crew, idx) => {
                    crew.rank = idx + 1;
                    crew.medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '';
                });
                
                return crewPerformance;
                
            } catch (error) {
                console.error("Error calculating crew performance:", error);
                return [];
            }
        }
        
        // Render overview
        function renderOverview() {
            $("#overviewSection").style.display = "block";
            $("#activeCount").textContent = overviewData.activeWorkOrders.length;
            
            // Sort work orders
            sortWorkOrders();
            
            // Render cards
            renderOverviewCards();
            
            // Render stale section
            if (overviewData.staleWorkOrders.length > 0) {
                $("#staleSection").style.display = "block";
                $("#staleCount").textContent = overviewData.staleWorkOrders.length;
                renderStaleProjects();
            }
            
            // Render crew performance
            renderCrewPerformance();
            
            $("#exportBtn").style.display = "inline-block";
        }
        
        // Sort work orders
        function sortWorkOrders() {
            const sortByValue = $("#sortBy").value;
            
            overviewData.activeWorkOrders.sort((a, b) => {
                switch (sortByValue) {
                    case 'completion':
                        return a.completionPct - b.completionPct; // Ascending = least complete first
                    case 'billing':
                        return a.billingPct - b.billingPct; // Ascending = least billed first
                    case 'invoice':
                        return a.invoicePct - b.invoicePct; // Ascending = least invoiced first
                    case 'lastActivity':
                        return b.daysSince - a.daysSince; // Descending = stalest first
                    default:
                        return 0;
                }
            });
        }
        
        $("#sortBy").onchange = () => {
            sortWorkOrders();
            renderOverviewCards();
        };
        
        // Set default sort to descending (least complete first)
        $("#sortBy").value = 'completion';
        
        // Render overview cards
        function renderOverviewCards() {
            const container = $("#overviewCards");
            
            const cardsHTML = overviewData.activeWorkOrders.map(wo => {
                // Freshness indicator
                let freshnessClass = 'freshness-green';
                if (wo.daysSince > 30) freshnessClass = 'freshness-red';
                else if (wo.daysSince > 14) freshnessClass = 'freshness-orange';
                else if (wo.daysSince > 7) freshnessClass = 'freshness-yellow';
                
                // Alert badges (simplified for overview)
                let alertBadges = '';
                if (wo.openGigs > 2) {
                    alertBadges += `<span class="alert-badge">🔴 ${wo.openGigs}</span> `;
                } else if (wo.openGigs > 0) {
                    alertBadges += `<span class="warning-badge">⚠️ ${wo.openGigs}</span> `;
                }
                
                // Quality display
                let qualityClass = 'quality-good';
                if (wo.openGigs > 2) qualityClass = 'quality-critical';
                else if (wo.openGigs > 0) qualityClass = 'quality-warning';
                
                const avgDaysDisplay = wo.avgApprovalDays !== null ? 
                    `${wo.avgApprovalDays.toFixed(1)} days` : 'N/A';
                
                // Colors for progress bars
                const completionColor = getCompletionColor(wo.completionPct);
                const billingColor = getCompletionColor(wo.billingPct);
                const invoiceColor = getCompletionColor(wo.invoicePct);
                
                return `
                    <div class="wo-card" data-wo="${wo.workOrderId}" onclick="selectWOForDrilldown('${wo.workOrderId}')">
                        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">
                            <div style="font-weight:bold;font-size:11px;flex:1;">${wo.workOrderId}</div>
                            <div style="font-size:10px;white-space:nowrap;">
                                <span class="freshness-indicator ${freshnessClass}"></span>${wo.daysSince}d ${alertBadges}
                            </div>
                        </div>
                        
                        <div style="font-size:10px;color:#666;margin-bottom:8px;">
                            ${wo.designed.toLocaleString()} total
                        </div>
                        
                        <div style="margin-bottom:8px;">
                            <div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px;">
                                <span>Progress</span>
                                <span style="font-weight:bold;">${wo.completionPct.toFixed(1)}%</span>
                            </div>
                            <div class="progress-bar-container">
                                <div class="progress-bar-fill" style="width:${wo.completionPct}%;background:${completionColor};"></div>
                            </div>
                        </div>
                        
                        <div style="margin-bottom:8px;">
                            <div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px;">
                                <span>Billing</span>
                                <span style="font-weight:bold;">${wo.billingPct.toFixed(1)}%</span>
                            </div>
                            <div class="progress-bar-container">
                                <div class="progress-bar-fill" style="width:${wo.billingPct}%;background:${billingColor};"></div>
                            </div>
                        </div>
                        
                        <div style="margin-bottom:8px;">
                            <div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px;">
                                <span>Invoice</span>
                                <span style="font-weight:bold;">${wo.invoicePct.toFixed(1)}%</span>
                            </div>
                            <div class="progress-bar-container">
                                <div class="progress-bar-fill" style="width:${wo.invoicePct}%;background:${invoiceColor};"></div>
                            </div>
                        </div>
                        
                        <div style="font-size:10px;padding:6px;background:#f5f5f5;border-radius:3px;margin-bottom:6px;">
                            <div class="${qualityClass}" style="margin-bottom:2px;">
                                <strong>Quality:</strong> ${wo.openGigs} open | ⏱️ ${avgDaysDisplay}
                            </div>
                        </div>
                        
                        <div style="font-size:10px;margin-bottom:4px;">
                            <strong>Awaiting Billing:</strong><br>
                            • Fiber: ${wo.fiberOutstanding.toLocaleString()} ft<br>
                            • UG: ${wo.ugOutstanding.toLocaleString()} ft
                        </div>
                        
                        <div style="font-size:10px;margin-bottom:6px;">
                            <strong>Run Rate:</strong><br>
                            • Fiber: ${wo.fiberRunRate.toLocaleString()} ft/day<br>
                            • UG: ${wo.ugRunRate.toLocaleString()} ft/day
                        </div>
                        
                        <div style="font-size:10px;color:#666;text-align:center;border-top:1px solid #ddd;padding-top:6px;">
                            Est: <strong>${wo.expectedCompletion}</strong>
                        </div>
                    </div>
                `;
            }).join('');
            
            container.innerHTML = cardsHTML;
        }
        
        // Select WO for drilldown
window.selectWOForDrilldown = async function(workOrderId) {
    selectedWOForDrilldown = workOrderId;
    
    // Highlight selected card in active section
    toolBox.querySelectorAll('.wo-card').forEach(card => {
        if (card.dataset.wo === workOrderId) {
            card.classList.add('selected');
        } else {
            card.classList.remove('selected');
        }
    });
    
    // Highlight selected item in stale section
    toolBox.querySelectorAll('.stale-project-item').forEach(item => {
        if (item.dataset.wo === workOrderId) {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }
    });
    
    // Show drilldown section
    $("#drilldownSection").style.display = "block";
    $("#selectedWOName").textContent = workOrderId;
    
    // Set default dates (but don't use them initially - use All Time)
    const today = new Date();
    const thirtyDaysAgo = new Date(today.getTime() - (30 * 24 * 60 * 60 * 1000));
    $("#drilldownStartDate").value = formatDateForInput(thirtyDaysAgo);
    $("#drilldownEndDate").value = formatDateForInput(today);
    
    // Auto-load with All Time filter
    updateStatus("Loading work order details...", "processing");
    $("#drilldownResults").innerHTML = '<div style="text-align:center;padding:20px;"><span class="spinner"></span> Loading...</div>';
    
    try {
        const filterClause = buildFilterClause();
        const layersToQuery = getSelectedLayers();
        
        // Query with All Time (no date filter)
        drilldownData = await queryWorkOrderDetails(selectedWOForDrilldown, null, null, layersToQuery, filterClause, true);
        
        // Calculate crew performance (All Time)
        const crewPerf = await calculateWOCrewPerformance(selectedWOForDrilldown, null, null, layersToQuery, filterClause, true);
        
        // Generate alerts
        const alerts = generateWOAlerts(drilldownData, selectedWOForDrilldown);
        
        // Render results
        renderDrilldownResults(drilldownData, crewPerf, alerts, true);
        
        updateStatus("Work order details loaded", "success");
        
    } catch (error) {
        console.error("Error loading WO details:", error);
        updateStatus("Error loading details: " + error.message, "error");
        $("#drilldownResults").innerHTML = '<div style="color:#d32f2f;padding:12px;">Error loading work order details</div>';
    }
    
    // Scroll to drilldown section
    $("#drilldownSection").scrollIntoView({ behavior: 'smooth' });
};
        
      // Render stale projects
function renderStaleProjects() {
    const list = $("#staleList");
    
    const staleHTML = overviewData.staleWorkOrders.map(wo => {
        return `
            <div style="padding:6px;border-bottom:1px solid #ddd;cursor:pointer;transition:background 0.2s;" 
                 class="stale-project-item"
                 data-wo="${wo.workOrderId}" 
                 onclick="selectWOForDrilldown('${wo.workOrderId}')">
                <strong>${wo.workOrderId}</strong> - Last activity: ${wo.lastActivity ? wo.lastActivity.toLocaleDateString() : 'Unknown'} (${wo.daysSince} days ago)
            </div>
        `;
    }).join('');
    
    list.innerHTML = staleHTML;
}
        
        $("#staleHeader").onclick = () => {
            const list = $("#staleList");
            const header = $("#staleHeader");
            
            if (list.style.display === 'none') {
                list.style.display = 'block';
                header.innerHTML = header.innerHTML.replace('[▼ Expand]', '[▲ Collapse]');
            } else {
                list.style.display = 'none';
                header.innerHTML = header.innerHTML.replace('[▲ Collapse]', '[▼ Expand]');
            }
        };
        
        // Render crew performance
        function renderCrewPerformance() {
            const container = $("#crewPerformanceContent");
            
            if (!overviewData.globalCrewPerformance || overviewData.globalCrewPerformance.length === 0) {
                container.innerHTML = '<div style="font-style:italic;color:#999;">No crew performance data available</div>';
                return;
            }
            
            const tableHTML = `
                <div style="overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;font-size:11px;">
                        <thead>
                            <tr style="background:#f0f4ff;">
                                <th style="border:1px solid #ddd;padding:6px;text-align:left;">Rank</th>
                                <th style="border:1px solid #ddd;padding:6px;text-align:left;">Crew</th>
                                <th style="border:1px solid #ddd;padding:6px;text-align:right;">Total Constructed</th>
                                <th style="border:1px solid #ddd;padding:6px;text-align:right;">Daily Rate</th>
                                <th style="border:1px solid #ddd;padding:6px;text-align:center;">Open Gigs</th>
                                <th style="border:1px solid #ddd;padding:6px;text-align:center;">Total Gigs</th>
                                <th style="border:1px solid #ddd;padding:6px;text-align:center;">Avg Approval Days</th>
                                <th style="border:1px solid #ddd;padding:6px;text-align:right;">Outstanding Billing</th>
                                <th style="border:1px solid #ddd;padding:6px;text-align:center;">Billing Efficiency</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${overviewData.globalCrewPerformance.map(crew => {
                                const avgDaysDisplay = crew.avgApprovalDays !== null ? crew.avgApprovalDays.toFixed(1) : 'N/A';
                                return `
                                <tr>
                                    <td style="border:1px solid #ddd;padding:6px;text-align:center;">${crew.medal} ${crew.rank}</td>
                                    <td style="border:1px solid #ddd;padding:6px;font-weight:bold;">${crew.name}</td>
                                    <td style="border:1px solid #ddd;padding:6px;text-align:right;">${crew.totalConstructed.toLocaleString()}</td>
                                    <td style="border:1px solid #ddd;padding:6px;text-align:right;">${crew.dailyRate.toFixed(1)}</td>
                                    <td style="border:1px solid #ddd;padding:6px;text-align:center;">${crew.openGigs}</td>
                                    <td style="border:1px solid #ddd;padding:6px;text-align:center;">${crew.totalGigs}</td>
                                    <td style="border:1px solid #ddd;padding:6px;text-align:center;">${avgDaysDisplay}</td>
                                    <td style="border:1px solid #ddd;padding:6px;text-align:right;">${crew.outstandingBilling.toLocaleString()}</td>
                                    <td style="border:1px solid #ddd;padding:6px;text-align:center;">${crew.billingEfficiency.toFixed(1)}%</td>
                                </tr>
                            `}).join('')}
                        </tbody>
                    </table>
                </div>
                <div style="margin-top:6px;font-size:10px;color:#666;font-style:italic;">
                    📊 Based on all-time performance across all active work orders
                </div>
            `;
            
            container.innerHTML = tableHTML;
        }
        
   // Close drilldown
$("#closeDrilldown").onclick = () => {
    $("#drilldownSection").style.display = "none";
    selectedWOForDrilldown = null;
    drilldownData = null;
    
    // Remove selected highlighting from active cards
    toolBox.querySelectorAll('.wo-card').forEach(card => {
        card.classList.remove('selected');
    });
    
    // Remove selected highlighting from stale items
    toolBox.querySelectorAll('.stale-project-item').forEach(item => {
        item.classList.remove('selected');
    });
    
    // Reset date buttons
    $("#allTimeDrilldownBtn").style.background = "#3367d6";
    $("#allTimeDrilldownBtn").style.color = "#fff";
    toolBox.querySelectorAll('.drilldown-date-preset').forEach(b => {
        b.style.background = "";
        b.style.color = "";
    });
};
        
        // Reset button styles when manually changing dates
        $("#drilldownStartDate").onchange = $("#drilldownEndDate").onchange = () => {
            $("#allTimeDrilldownBtn").style.background = "";
            $("#allTimeDrilldownBtn").style.color = "";
            toolBox.querySelectorAll('.drilldown-date-preset').forEach(b => {
                b.style.background = "";
                b.style.color = "";
            });
        };
        
        // Run drilldown analysis
        $("#runDrilldownBtn").onclick = async () => {
            if (!selectedWOForDrilldown) return;
            
            try {
                const btn = $("#runDrilldownBtn");
                const originalText = btn.innerHTML;
                btn.innerHTML = '<span class="spinner"></span>Filtering...';
                btn.disabled = true;
                
                const startDate = $("#drilldownStartDate").value;
                const endDate = $("#drilldownEndDate").value;
                
                if (!startDate || !endDate) {
                    alert("Please select both start and end dates");
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                    return;
                }
                
                updateStatus("Filtering work order data...", "processing");
                
                const filterClause = buildFilterClause();
                const layersToQuery = getSelectedLayers();
                
                // Query with date filter
                drilldownData = await queryWorkOrderDetails(selectedWOForDrilldown, startDate, endDate, layersToQuery, filterClause, false);
                
                // Calculate crew performance with date filter
                const crewPerf = await calculateWOCrewPerformance(selectedWOForDrilldown, startDate, endDate, layersToQuery, filterClause, false);
                
                // Generate alerts
                const alerts = generateWOAlerts(drilldownData, selectedWOForDrilldown);
                
                // Render results
                renderDrilldownResults(drilldownData, crewPerf, alerts, false);
                
                updateStatus("Filtered results displayed", "success");
                
                btn.innerHTML = originalText;
                btn.disabled = false;
                
                // Reset All Time button style
                $("#allTimeDrilldownBtn").style.background = "";
                $("#allTimeDrilldownBtn").style.color = "";
                
            } catch (error) {
                console.error("Error filtering drilldown:", error);
                updateStatus("Error: " + error.message, "error");
                $("#runDrilldownBtn").innerHTML = '🔍 Filter';
                $("#runDrilldownBtn").disabled = false;
            }
        };
        
        // Date preset handlers for drilldown
        toolBox.querySelectorAll('.drilldown-date-preset').forEach(btn => {
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
                }
                
                $("#drilldownStartDate").value = formatDateForInput(startDate);
                $("#drilldownEndDate").value = formatDateForInput(endDate);
                
                // Highlight active preset
                toolBox.querySelectorAll('.drilldown-date-preset').forEach(b => {
                    b.style.background = "";
                    b.style.color = "";
                });
                btn.style.background = "#3367d6";
                btn.style.color = "#fff";
                
                // Reset All Time button
                $("#allTimeDrilldownBtn").style.background = "";
                $("#allTimeDrilldownBtn").style.color = "";
            };
        });
        
        // All Time button handler for drilldown
        $("#allTimeDrilldownBtn").onclick = async () => {
            if (!selectedWOForDrilldown) return;
            
            try {
                updateStatus("Loading all-time data...", "processing");
                
                const filterClause = buildFilterClause();
                const layersToQuery = getSelectedLayers();
                
                // Query with All Time
                drilldownData = await queryWorkOrderDetails(selectedWOForDrilldown, null, null, layersToQuery, filterClause, true);
                
                // Calculate crew performance (All Time)
                const crewPerf = await calculateWOCrewPerformance(selectedWOForDrilldown, null, null, layersToQuery, filterClause, true);
                
                // Generate alerts
                const alerts = generateWOAlerts(drilldownData, selectedWOForDrilldown);
                
                // Render results
                renderDrilldownResults(drilldownData, crewPerf, alerts, true);
                
                updateStatus("All-time data displayed", "success");
                
                // Highlight All Time button
                $("#allTimeDrilldownBtn").style.background = "#3367d6";
                $("#allTimeDrilldownBtn").style.color = "#fff";
                
                // Reset other preset buttons
                toolBox.querySelectorAll('.drilldown-date-preset').forEach(b => {
                    b.style.background = "";
                    b.style.color = "";
                });
                
            } catch (error) {
                console.error("Error loading all-time data:", error);
                updateStatus("Error: " + error.message, "error");
            }
        };
        
        // Query work order details (layer-by-layer breakdown)
        async function queryWorkOrderDetails(workOrderId, startDate, endDate, layersToQuery, filterClause, allTimeMode = false) {
            const allFL = mapView.map.allLayers.filter(l => l.type === "feature");
            const woClause = `workorder_id='${workOrderId.toString().replace(/'/g, "''")}'`;
            
            // Date clause for installation_date filters (only if not All Time)
            let dateClause = "";
            if (!allTimeMode && startDate && endDate) {
                const startLit = `TIMESTAMP '${startDate} 00:00:00'`;
                const endLit = `TIMESTAMP '${endDate} 23:59:59'`;
                dateClause = ` AND installation_date >= ${startLit} AND installation_date <= ${endLit}`;
            }
            
            // Categories with date filtering rules
            const categories = [
                {name: "Total Assigned", includeStatuses: ['ASSG'], useDate: false},
                {name: "Designed", excludeStatuses: ['DNB', 'ONHOLD', 'DEFRD'], useDate: false},
                {name: "Constructed", excludeStatuses: ['DNB', 'ONHOLD', 'DEFRD', 'NA', 'ASSG', 'INPROG'], useDate: !allTimeMode},
                {name: "Remaining to Construct", requireStage: 'OSP_CONST', includeStatuses: ['NA'], useDate: false},
                {name: "On Hold", includeStatuses: ['ONHOLD'], useDate: false},
                {name: "Daily Complete", includeStatuses: ['DLYCMPLT','INVCMPLT'], useDate: !allTimeMode},
                {name: "Ready for Daily", includeStatuses: ['RDYFDLY'], useDate: !allTimeMode},
                {name: "Invoiced", includeStatuses: ['INVCMPLT'], useDate: !allTimeMode}
            ];
            
            const tableData = [];
            
            for (const category of categories) {
                const rowValues = [];
                const rawValues = [];
                
                for (const targetLayer of layersToQuery) {
                    const layer = allFL.find(l => l.layerId === targetLayer.id);
                    if (!layer) {
                        rowValues.push("N/A");
                        rawValues.push(0);
                        continue;
                    }
                    
                    await layer.load();
                    
                    let statusClause;
                    if (category.includeStatuses) {
                        statusClause = category.includeStatuses.map(s => `workflow_status = '${s}'`).join(' OR ');
                    } else if (category.excludeStatuses) {
                        statusClause = category.excludeStatuses.map(s => `workflow_status <> '${s}'`).join(' AND ');
                    }
                    
                    if (category.requireStage) {
                        const stageClause = `workflow_stage = '${category.requireStage}'`;
                        statusClause = statusClause ? `(${statusClause}) AND ${stageClause}` : stageClause;
                    }
                    
                    let additionalFilter = "";
                    if (targetLayer.additionalFilter) {
                        additionalFilter = ` AND ${targetLayer.additionalFilter}`;
                    }
                    
                    const datePart = category.useDate ? dateClause : "";
                    const whereClause = `(${filterClause}) AND ${woClause} AND (${statusClause})${additionalFilter}${datePart}`;
                    
                    try {
                        const queryResult = await layer.queryFeatures({
                            where: whereClause,
                            outFields: [targetLayer.field],
                            returnGeometry: false
                        });
                        
                        let value = 0;
                        if (targetLayer.metric === "count") {
                            value = queryResult.features.length;
                        } else if (targetLayer.metric === "sum") {
                            value = queryResult.features.reduce((sum, feature) => {
                                return sum + (Number(feature.attributes[targetLayer.field]) || 0);
                            }, 0);
                            value = Math.round(value);
                        }
                        
                        rowValues.push(value.toLocaleString());
                        rawValues.push(value);
                        
                    } catch (err) {
                        console.error(`Error querying ${targetLayer.name} for ${category.name}:`, err);
                        rowValues.push("Error");
                        rawValues.push(0);
                    }
                }
                
                tableData.push({
                    category: category.name,
                    values: rowValues,
                    rawValues: rawValues,
                    categoryData: category
                });
            }
            
            return tableData;
        }
        
        // Calculate crew performance for specific WO
        async function calculateWOCrewPerformance(workOrderId, startDate, endDate, layersToQuery, filterClause, allTimeMode = false) {
            try {
                const allFL = mapView.map.allLayers.filter(l => l.type === "feature");
                const woClause = `workorder_id='${workOrderId.toString().replace(/'/g, "''")}'`;
                
                let dateClause = "";
                if (!allTimeMode && startDate && endDate) {
                    const startLit = `TIMESTAMP '${startDate} 00:00:00'`;
                    const endLit = `TIMESTAMP '${endDate} 23:59:59'`;
                    dateClause = ` AND installation_date >= ${startLit} AND installation_date <= ${endLit}`;
                }
                
                // Get domain maps
                const gigLayerForDomains = allFL.find(l => l.layerId === 22100);
                const crewDomainMap = new Map();
                const subcontractorDomainMap = new Map();
                
                if (gigLayerForDomains) {
                    await gigLayerForDomains.load();
                    
                    const crewField = gigLayerForDomains.fields.find(f => f.name === 'crew');
                    if (crewField && crewField.domain && crewField.domain.codedValues) {
                        crewField.domain.codedValues.forEach(cv => {
                            crewDomainMap.set(cv.code, cv.name);
                        });
                    }
                    
                    const subField = gigLayerForDomains.fields.find(f => f.name === 'construction_subcontractor');
                    if (subField && subField.domain && subField.domain.codedValues) {
                        subField.domain.codedValues.forEach(cv => {
                            subcontractorDomainMap.set(cv.code, cv.name);
                        });
                    }
                }
                
                const crewData = new Map();
                
                // Query each layer for crew info
                for (const targetLayer of layersToQuery) {
                    const layer = allFL.find(l => l.layerId === targetLayer.id);
                    if (!layer) continue;
                    
                    await layer.load();
                    
                    const excludedStatuses = ['DNB', 'ONHOLD', 'DEFRD', 'NA', 'ASSG', 'INPROG'];
                    const statusClause = excludedStatuses.map(s => `workflow_status <> '${s}'`).join(' AND ');
                    
                    let additionalFilter = "";
                    if (targetLayer.additionalFilter) {
                        additionalFilter = ` AND ${targetLayer.additionalFilter}`;
                    }
                    
                    const whereClause = `(${filterClause}) AND ${woClause} AND (${statusClause})${additionalFilter}${dateClause}`;
                    
                    const queryResult = await layer.queryFeatures({
                        where: whereClause,
                        outFields: ["crew", "construction_subcontractor", "installation_date", targetLayer.field, "workflow_status"],
                        returnGeometry: false
                    });
                    
                    queryResult.features.forEach(feature => {
                        const crewCode = feature.attributes.crew;
                        const subcontractorCode = feature.attributes.construction_subcontractor;
                        const crewDisplayName = crewDomainMap.get(crewCode) || crewCode;
                        const subcontractorDisplayName = subcontractorDomainMap.get(subcontractorCode) || subcontractorCode;
                        const crewName = (crewDisplayName || subcontractorDisplayName)?.toString().trim();
                        if (!crewName) return;
                        
                        if (!crewData.has(crewName)) {
    crewData.set(crewName, {
        name: crewName,
        totalConstructed: 0,
        dailyComplete: 0,
        firstInstallDate: null,
        lastInstallDate: null
    });
}
                        
                        const data = crewData.get(crewName);
                        
                        let value = 0;
                        if (targetLayer.metric === "count") {
                            value = 1;
                        } else if (targetLayer.metric === "sum") {
                            value = Number(feature.attributes[targetLayer.field]) || 0;
                        }
                        data.totalConstructed += value;
                        
                        const status = feature.attributes.workflow_status;
                        if (status === 'DLYCMPLT' || status === 'INVCMPLT') {
                            data.dailyComplete += value;
                        }
                        
                        const installDate = feature.attributes.installation_date;
if (installDate) {
    const date = new Date(installDate);
    if (!data.firstInstallDate || date < data.firstInstallDate) {
        data.firstInstallDate = date;
    }
    if (!data.lastInstallDate || date > data.lastInstallDate) {
        data.lastInstallDate = date;
    }
}
                    });
                }
                
                // Query gig layer for quality metrics
                const gigLayer = allFL.find(l => l.layerId === 22100);
                const qualityData = new Map();
                
                if (gigLayer) {
                    await gigLayer.load();
                    
                    const gigWhereClause = `(${filterClause}) AND ${woClause}${dateClause}`;
                    const gigQuery = await gigLayer.queryFeatures({
                        where: gigWhereClause,
                        outFields: ["crew", "construction_subcontractor", "gig_status", "approval_days"],
                        returnGeometry: false
                    });
                    
                    gigQuery.features.forEach(feature => {
                        const crewCode = feature.attributes.crew;
                        const subcontractorCode = feature.attributes.construction_subcontractor;
                        const crewDisplayName = crewDomainMap.get(crewCode) || crewCode;
                        const subcontractorDisplayName = subcontractorDomainMap.get(subcontractorCode) || subcontractorCode;
                        const crewName = (crewDisplayName || subcontractorDisplayName)?.toString().trim();
                        if (!crewName) return;
                        
                        const status = feature.attributes.gig_status;
                        const approvalDays = feature.attributes.approval_days;
                        
                        if (!qualityData.has(crewName)) {
                            qualityData.set(crewName, {
                                totalGigs: 0,
                                openGigs: 0,
                                totalApprovalDays: 0,
                                approvalDaysCount: 0
                            });
                        }
                        
                        const qData = qualityData.get(crewName);
                        qData.totalGigs++;
                        
                        if (status === 'OPEN') {
                            qData.openGigs++;
                        } else if (status === 'APPROVED' && approvalDays != null && !isNaN(approvalDays)) {
                            qData.totalApprovalDays += Number(approvalDays);
                            qData.approvalDaysCount++;
                        }
                    });
                }
                
                // Build crew performance array
                const crewPerformance = [];
                
                crewData.forEach((data, crewName) => {
    let dailyRate = 0;
    if (data.firstInstallDate && data.lastInstallDate) {
        const calendarDays = daysBetween(data.firstInstallDate, data.lastInstallDate) + 1;
        const workingDays = Math.max(1, Math.round((calendarDays / 7) * 5));
        dailyRate = data.totalConstructed / workingDays;
    }
                    
                    const quality = qualityData.get(crewName);
                    const avgApprovalDays = quality && quality.approvalDaysCount > 0 ? 
                        (quality.totalApprovalDays / quality.approvalDaysCount) : null;
                    
                    const outstandingBilling = Math.round(data.totalConstructed - data.dailyComplete);
                    const billingEfficiency = data.totalConstructed > 0 ? 
                        (data.dailyComplete / data.totalConstructed * 100) : 0;
                    
                    crewPerformance.push({
                        name: crewName,
                        totalConstructed: Math.round(data.totalConstructed),
                        dailyRate: dailyRate,
                        avgApprovalDays: avgApprovalDays,
                        totalGigs: quality ? quality.totalGigs : 0,
                        openGigs: quality ? quality.openGigs : 0,
                        outstandingBilling: outstandingBilling,
                        billingEfficiency: billingEfficiency
                    });
                });
                
                // Sort by daily rate
                crewPerformance.sort((a, b) => b.dailyRate - a.dailyRate);
                
                // Add rankings
                crewPerformance.forEach((crew, idx) => {
                    crew.rank = idx + 1;
                    crew.medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '';
                });
                
                return crewPerformance;
                
            } catch (error) {
                console.error("Error calculating WO crew performance:", error);
                return [];
            }
        }
        
        // Generate alerts for specific work order
        function generateWOAlerts(tableData, workOrderId) {
            const alerts = [];
            const layersInUse = getSelectedLayers();
            
            const designedRow = tableData.find(r => r.category === "Designed");
            const constructedRow = tableData.find(r => r.category === "Constructed");
            const dailyCompleteRow = tableData.find(r => r.category === "Daily Complete");
            const onHoldRow = tableData.find(r => r.category === "On Hold");
            const readyForDailyRow = tableData.find(r => r.category === "Ready for Daily");
            
            if (!designedRow || !constructedRow) return alerts;
            
            // Check for data quality issues per layer
            layersInUse.forEach((layer, idx) => {
                const designed = designedRow.rawValues[idx] || 0;
                const constructed = constructedRow.rawValues[idx] || 0;
                
                if (constructed > designed && designed > 0) {
                    const excess = constructed - designed;
                    const unit = layer.metric === "sum" ? "ft" : "units";
                    alerts.push({
                        type: 'critical',
                        icon: '🚨',
                        title: `Data Quality Issue - ${layer.name}`,
                        message: `Constructed (${constructed.toLocaleString()}) exceeds Designed (${designed.toLocaleString()}) by ${excess.toLocaleString()} ${unit}.`
                    });
                }
            });
            
            // Calculate totals
            let designedTotal = 0, constructedTotal = 0, dailyCompleteTotal = 0, onHoldTotal = 0, readyForDailyTotal = 0;
            
            designedRow.rawValues.forEach(val => { designedTotal += val; });
            constructedRow.rawValues.forEach(val => { constructedTotal += val; });
            if (dailyCompleteRow) dailyCompleteRow.rawValues.forEach(val => { dailyCompleteTotal += val; });
            if (onHoldRow) onHoldRow.rawValues.forEach(val => { onHoldTotal += val; });
            if (readyForDailyRow) readyForDailyRow.rawValues.forEach(val => { readyForDailyTotal += val; });
            
            // High % on hold
            if (designedTotal > 0) {
                const onHoldPct = (onHoldTotal / designedTotal) * 100;
                if (onHoldPct > 20) {
                    alerts.push({
                        type: 'warning',
                        icon: '⚠️',
                        title: 'High Volume On Hold',
                        message: `${onHoldPct.toFixed(1)}% of designed work is on hold.`
                    });
                }
            }
            
            // Large billing lag
            if (constructedTotal > 0 && dailyCompleteTotal >= 0) {
                const billingGap = constructedTotal - dailyCompleteTotal;
                const gapPct = (billingGap / constructedTotal) * 100;
                if (gapPct > 25) {
                    alerts.push({
                        type: 'warning',
                        icon: '📋',
                        title: 'Billing Lag Detected',
                        message: `${gapPct.toFixed(1)}% of constructed work not marked Daily Complete.`
                    });
                }
            }
            
            // Ready for daily stuck
            if (readyForDailyTotal > 0) {
                alerts.push({
                    type: 'info',
                    icon: '💰',
                    title: 'Invoice Opportunity',
                    message: `${readyForDailyTotal.toLocaleString()} units ready for daily submission.`
                });
            }
            
            return alerts;
        }
        
        // Render drilldown results
        function renderDrilldownResults(tableData, crewPerf, alerts, isAllTime = false) {
            const container = $("#drilldownResults");
            let html = '';
            
            // Show filter status
            const filterStatus = isAllTime ? 
                '<div style="font-size:11px;color:#666;margin-bottom:8px;">📅 Showing: <strong>All Time</strong></div>' :
                '<div style="font-size:11px;color:#666;margin-bottom:8px;">📅 Filtered by date range</div>';
            html += filterStatus;
            
            // Summary section
            const designedRow = tableData.find(r => r.category === "Designed");
            const constructedRow = tableData.find(r => r.category === "Constructed");
            const dailyCompleteRow = tableData.find(r => r.category === "Daily Complete");
            const invoicedRow = tableData.find(r => r.category === "Invoiced");
            
            if (designedRow && constructedRow) {
    const layersInUse = getSelectedLayers();
    let totalDesigned = 0;
    let totalConstructed = 0;
    let totalDailyComplete = 0;
    let totalInvoiced = 0;
    
    layersInUse.forEach((layer, idx) => {
        totalDesigned += designedRow.rawValues[idx] || 0;
        totalConstructed += constructedRow.rawValues[idx] || 0;
        totalDailyComplete += dailyCompleteRow ? (dailyCompleteRow.rawValues[idx] || 0) : 0;
        totalInvoiced += invoicedRow ? (invoicedRow.rawValues[idx] || 0) : 0;
    });
    
    const overallConstruction = totalDesigned > 0 ? (totalConstructed / totalDesigned) * 100 : 0;
    const overallBilling = totalDesigned > 0 ? (totalDailyComplete / totalDesigned) * 100 : 0;
    const overallInvoiced = totalDesigned > 0 ? (totalInvoiced / totalDesigned) * 100 : 0;
    
    const constructionColor = getCompletionColor(overallConstruction);
    const billingColor = getCompletionColor(overallBilling);
    const invoicedColor = getCompletionColor(overallInvoiced);
                
                html += `
    <div style="padding:12px;background:#f5f7fa;border-radius:4px;margin-bottom:12px;">
        <div style="font-weight:bold;margin-bottom:8px;">📈 Summary</div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;">
            <div style="flex:1;min-width:150px;">
                <div style="font-weight:bold;margin-bottom:4px;">Construction</div>
                <div style="font-size:20px;font-weight:bold;color:${constructionColor};">${overallConstruction.toFixed(1)}%</div>
                <div class="progress-bar-container" style="width:100%;height:12px;margin-top:4px;">
                    <div class="progress-bar-fill" style="width:${overallConstruction}%;background:${constructionColor};"></div>
                </div>
            </div>
            <div style="flex:1;min-width:150px;">
                <div style="font-weight:bold;margin-bottom:4px;">Billing</div>
                <div style="font-size:20px;font-weight:bold;color:${billingColor};">${overallBilling.toFixed(1)}%</div>
                <div class="progress-bar-container" style="width:100%;height:12px;margin-top:4px;">
                    <div class="progress-bar-fill" style="width:${overallBilling}%;background:${billingColor};"></div>
                </div>
            </div>
            <div style="flex:1;min-width:150px;">
                <div style="font-weight:bold;margin-bottom:4px;">Invoiced</div>
                <div style="font-size:20px;font-weight:bold;color:${invoicedColor};">${overallInvoiced.toFixed(1)}%</div>
                <div class="progress-bar-container" style="width:100%;height:12px;margin-top:4px;">
                    <div class="progress-bar-fill" style="width:${overallInvoiced}%;background:${invoicedColor};"></div>
                </div>
            </div>
        </div>
    </div>
`;
            }
            
            // Alerts section
            if (alerts.length > 0) {
                html += '<div style="margin-bottom:12px;">';
                alerts.forEach(alert => {
                    let alertClass = 'alert-info';
                    if (alert.type === 'critical') alertClass = 'alert-critical';
                    else if (alert.type === 'warning') alertClass = 'alert-warning';
                    
                    html += `
                        <div class="alert-box ${alertClass}" style="margin-bottom:8px;">
                            <div class="alert-icon">${alert.icon}</div>
                            <div class="alert-content">
                                <div class="alert-title">${alert.title}</div>
                                <div class="alert-message">${alert.message}</div>
                            </div>
                        </div>
                    `;
                });
                html += '</div>';
            }
            
            // Layer-by-layer table with completion percentages
            const layersInUse = getSelectedLayers();
            html += `
                <div style="margin-bottom:12px;">
                    <div style="font-weight:bold;margin-bottom:8px;">📊 Layer-by-Layer Breakdown</div>
                    <div style="overflow-x:auto;">
                        <table style="width:100%;border-collapse:collapse;font-size:11px;">
                            <thead>
                                <tr style="background:#f5f5f5;">
                                    <th style="border:1px solid #ddd;padding:6px;text-align:left;">Category</th>
                                    ${layersInUse.map(layer => `
                                        <th style="border:1px solid #ddd;padding:6px;text-align:center;">${layer.name}</th>
                                    `).join('')}
                                </tr>
                            </thead>
                            <tbody>
                                ${tableData.map((row, idx) => {
                                    const rowStyle = idx % 2 === 0 ? 'background:#fff;' : 'background:#f9f9f9;';
                                    
                                    // Calculate percentages for key rows
                                    let showPercentages = false;
                                    if (designedRow && (row.category === "Constructed" || row.category === "Daily Complete" || row.category === "Invoiced")) {
                                        showPercentages = true;
                                    }
                                    
                                    return `
                                        <tr style="${rowStyle}">
                                            <td style="border:1px solid #ddd;padding:6px;font-weight:bold;">${row.category}</td>
                                            ${row.values.map((value, colIdx) => {
                                                let cellContent = value;
                                                
                                                if (showPercentages && designedRow) {
                                                    const designed = designedRow.rawValues[colIdx] || 0;
                                                    const current = row.rawValues[colIdx] || 0;
                                                    
                                                    if (designed > 0) {
                                                        const pct = (current / designed * 100).toFixed(1);
                                                        const color = getCompletionColor(parseFloat(pct));
                                                        cellContent += `<div style="font-size:10px;color:${color};margin-top:2px;">(${pct}%)</div>`;
                                                    }
                                                }
                                                
                                                return `<td style="border:1px solid #ddd;padding:6px;text-align:right;">${cellContent}</td>`;
                                            }).join('')}
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                    <div style="margin-top:6px;font-size:10px;color:#666;font-style:italic;">
                        💡 Percentages shown for Constructed, Daily Complete, and Invoiced (relative to Designed)
                    </div>
                </div>
            `;
            
            // Crew performance section
            if (crewPerf.length > 0) {
                const periodLabel = isAllTime ? 'All Time' : 'Selected Period';
                html += `
                    <div style="margin-bottom:12px;">
                        <div style="font-weight:bold;margin-bottom:8px;">👷 Crew Performance (${periodLabel})</div>
                        <div style="overflow-x:auto;">
                            <table style="width:100%;border-collapse:collapse;font-size:11px;">
                                <thead>
                                    <tr style="background:#f0f4ff;">
                                        <th style="border:1px solid #ddd;padding:6px;text-align:left;">Rank</th>
                                        <th style="border:1px solid #ddd;padding:6px;text-align:left;">Crew</th>
                                        <th style="border:1px solid #ddd;padding:6px;text-align:right;">Constructed</th>
                                        <th style="border:1px solid #ddd;padding:6px;text-align:right;">Daily Rate</th>
                                        <th style="border:1px solid #ddd;padding:6px;text-align:center;">Open Gigs</th>
                                        <th style="border:1px solid #ddd;padding:6px;text-align:center;">Avg Approval</th>
                                        <th style="border:1px solid #ddd;padding:6px;text-align:right;">Outstanding</th>
                                        <th style="border:1px solid #ddd;padding:6px;text-align:center;">Efficiency</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${crewPerf.map(crew => {
                                        const avgDaysDisplay = crew.avgApprovalDays !== null ? crew.avgApprovalDays.toFixed(1) : 'N/A';
                                        return `
                                            <tr>
                                                <td style="border:1px solid #ddd;padding:6px;text-align:center;">${crew.medal} ${crew.rank}</td>
                                                <td style="border:1px solid #ddd;padding:6px;font-weight:bold;">${crew.name}</td>
                                                <td style="border:1px solid #ddd;padding:6px;text-align:right;">${crew.totalConstructed.toLocaleString()}</td>
                                                <td style="border:1px solid #ddd;padding:6px;text-align:right;">${crew.dailyRate.toFixed(1)}</td>
                                                <td style="border:1px solid #ddd;padding:6px;text-align:center;">${crew.openGigs}</td>
                                                <td style="border:1px solid #ddd;padding:6px;text-align:center;">${avgDaysDisplay}</td>
                                                <td style="border:1px solid #ddd;padding:6px;text-align:right;">${crew.outstandingBilling.toLocaleString()}</td>
                                                <td style="border:1px solid #ddd;padding:6px;text-align:center;">${crew.billingEfficiency.toFixed(1)}%</td>
                                            </tr>
                                        `;
                                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;
            }
            
            container.innerHTML = html;
        }
        
        // Export functionality (placeholder)
        $("#exportBtn").onclick = () => {
            alert("Export functionality coming soon! Will export:\n\n• All active work orders overview\n• Global crew performance\n• Detailed metrics per WO");
        };
        
        // Close tool
        $("#closeTool").onclick = () => {
            window.gisToolHost.closeTool('wo-dashboard');
        };
        
        // Cleanup function
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
            if (window.selectWOForDrilldown) {
                delete window.selectWOForDrilldown;
            }
            
            // Remove styles
            if (styles && styles.parentNode) {
                styles.parentNode.removeChild(styles);
            }
            
            toolBox.remove();
            console.log('WO Dashboard Tool cleaned up');
        }
        
        // Initialize
        loadPurchaseOrders();
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!toolBox.contains(e.target)) {
                $("#purchaseOptions").style.display = 'none';
            }
        });
        
        // Register tool
        window.gisToolHost.activeTools.set('wo-dashboard', {
            cleanup: cleanup,
            toolBox: toolBox
        });
        
        console.log('Work Order Dashboard Tool loaded successfully');
        
    } catch (error) {
        console.error('Error loading WO Dashboard Tool:', error);
        alert("Error creating WO Dashboard Tool: " + (error.message || error));
    }
})();
