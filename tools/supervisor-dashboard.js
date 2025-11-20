// tools/supervisor-dashboard.js - Supervisor Performance Tracking
// Features:
// - Daily/weekly feature updates by supervisor
// - Crew production metrics by supervisor
// - Gig quality tracking per supervisor
// - Photo requirement compliance
// - CSV export functionality

(function() {
    try {
        // Check if tool is already active
        if (window.gisToolHost.activeTools.has('supervisor-dashboard')) {
            console.log('Supervisor Dashboard Tool already active');
            return;
        }
        
        // Remove any leftover toolbox
        const existingToolbox = document.getElementById('supervisorDashboardToolbox');
        if (existingToolbox) {
            existingToolbox.remove();
            console.log('Removed leftover Supervisor dashboard toolbox');
        }
        
        // Use shared utilities
        const utils = window.gisSharedUtils;
        if (!utils) {
            throw new Error('Shared utilities not loaded');
        }
        
        const mapView = utils.getMapView();
        
        // Target layers configuration
        const targetLayers = {
            undergroundSpan: { layerId: 42050, name: "Underground Span", attachmentReq: 2 },
            vault: { layerId: 42100, name: "Vault", attachmentReq: 4 },
            pothole: { layerId: 23250, name: "Pothole", attachmentReq: 1 },
            gig: { layerId: 22100, name: "Gig", attachmentReq: 0 }
        };
        
        const z = 99999;
        
        // Tool state
        let supervisorData = null;
        let isProcessing = false;
        let dateRangeMode = 'weekly'; // 'daily' or 'weekly'
        
        // Styles
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
            .metric-card {
                border: 1px solid #ddd;
                border-radius: 6px;
                padding: 12px;
                background: #fff;
                margin-bottom: 12px;
            }
            .metric-header {
                font-weight: bold;
                font-size: 13px;
                margin-bottom: 8px;
                color: #333;
            }
            .compliance-good { color: #4caf50; font-weight: bold; }
            .compliance-warning { color: #ff9800; font-weight: bold; }
            .compliance-critical { color: #f44336; font-weight: bold; }
            .chart-bar {
                background: #3367d6;
                height: 20px;
                border-radius: 3px;
                margin: 2px 0;
                transition: width 0.3s ease;
            }
            .chart-container {
                margin: 12px 0;
            }
            .supervisor-row:hover {
                background: #f5f5f5;
            }
        `;
        document.head.appendChild(styles);
        
        // Helper function to format dates
        function formatDateForInput(date) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }
        
        // Helper function to get start of week (Sunday)
        function getStartOfWeek(date) {
            const d = new Date(date);
            const day = d.getDay();
            const diff = d.getDate() - day;
            return new Date(d.setDate(diff));
        }
        
        // Helper function to get week label
        function getWeekLabel(date) {
            const start = getStartOfWeek(date);
            const end = new Date(start);
            end.setDate(end.getDate() + 6);
            return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
        }
        
        // Create tool UI
        const toolBox = document.createElement("div");
        toolBox.id = "supervisorDashboardToolbox";
        toolBox.style.cssText = `
            position: fixed;
            top: 80px;
            right: 40px;
            z-index: ${z};
            background: #fff;
            border: 1px solid #333;
            padding: 12px;
            max-width: 95vw;
            max-height: 85vh;
            overflow: auto;
            font: 12px/1.3 Arial, sans-serif;
            box-shadow: 0 4px 16px rgba(0,0,0,.2);
            width: 900px;
        `;
        
        toolBox.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <div style="font-weight:bold;font-size:14px;">👷‍♂️ Supervisor Performance Dashboard</div>
                <button id="closeTool" style="padding:4px 8px;font-size:11px;cursor:pointer;">✖ Close</button>
            </div>
            
            <div style="background:#f8f9fa;padding:10px;border-radius:4px;margin-bottom:12px;">
                <label style="font-weight:bold;margin-bottom:6px;display:block;">📅 Date Range</label>
                
                <div style="display:flex;gap:8px;margin-bottom:8px;">
                    <div style="flex:1;">
                        <label style="font-size:11px;">Start Date</label>
                        <input type="date" id="startDate" style="width:100%;">
                    </div>
                    <div style="flex:1;">
                        <label style="font-size:11px;">End Date</label>
                        <input type="date" id="endDate" style="width:100%;">
                    </div>
                </div>
                
                <div style="display:flex;gap:4px;margin-bottom:8px;">
                    <button class="date-preset" data-days="7" style="padding:4px 8px;font-size:11px;">Last 7 Days</button>
                    <button class="date-preset" data-days="30" style="padding:4px 8px;font-size:11px;">Last 30 Days</button>
                    <button class="date-preset" data-preset="this-month" style="padding:4px 8px;font-size:11px;">This Month</button>
                    <button id="allTimeBtn" style="padding:4px 8px;font-size:11px;background:#3367d6;color:#fff;">All Time</button>
                </div>
                
                <label style="font-weight:bold;margin-bottom:6px;display:block;">📊 Update Frequency View</label>
                <div style="display:flex;gap:8px;margin-bottom:8px;">
                    <label style="cursor:pointer;">
                        <input type="radio" name="dateMode" value="daily" checked> Daily
                    </label>
                    <label style="cursor:pointer;">
                        <input type="radio" name="dateMode" value="weekly"> Weekly
                    </label>
                </div>
                
                <label style="cursor:pointer;display:block;margin-bottom:8px;">
                    <input type="checkbox" id="includeAttachments"> Include Photo Compliance (slower, queries attachments)
                </label>
                
                <button id="loadDataBtn" style="width:100%;padding:8px;font-size:12px;background:#3367d6;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:bold;">
                    🔄 Load Supervisor Data
                </button>
            </div>
            
            <div id="toolStatus" style="margin:8px 0;padding:6px;border-radius:3px;display:none;"></div>
            
            <div id="resultsSection" style="display:none;">
                <div style="display:flex;gap:8px;margin-bottom:12px;">
                    <button id="exportBtn" style="padding:6px 12px;font-size:11px;background:#4caf50;color:#fff;border:none;border-radius:4px;cursor:pointer;">
                        📥 Export to CSV
                    </button>
                    <select id="metricFilter" style="padding:4px;font-size:11px;">
                        <option value="all">Show All Metrics</option>
                        <option value="updates">Feature Updates Only</option>
                        <option value="production">Production Only</option>
                        <option value="quality">Quality Only</option>
                        <option value="photos">Photo Compliance Only</option>
                    </select>
                </div>
                
                <div id="summaryCards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px;"></div>
                
                <div id="metricsContent"></div>
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
        
        // Set default dates (last 30 days)
        const today = new Date();
        const thirtyDaysAgo = new Date(today.getTime() - (30 * 24 * 60 * 60 * 1000));
        $("#startDate").value = formatDateForInput(thirtyDaysAgo);
        $("#endDate").value = formatDateForInput(today);
        
        // Date preset handlers
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
                }
                
                $("#startDate").value = formatDateForInput(startDate);
                $("#endDate").value = formatDateForInput(endDate);
                
                // Highlight active preset
                toolBox.querySelectorAll('.date-preset').forEach(b => {
                    b.style.background = "";
                    b.style.color = "";
                });
                btn.style.background = "#3367d6";
                btn.style.color = "#fff";
                
                $("#allTimeBtn").style.background = "";
                $("#allTimeBtn").style.color = "";
            };
        });
        
        // All Time button
        $("#allTimeBtn").onclick = () => {
            $("#startDate").value = "";
            $("#endDate").value = "";
            
            $("#allTimeBtn").style.background = "#3367d6";
            $("#allTimeBtn").style.color = "#fff";
            
            toolBox.querySelectorAll('.date-preset').forEach(b => {
                b.style.background = "";
                b.style.color = "";
            });
        };
        
        // Date mode radio buttons
        toolBox.querySelectorAll('input[name="dateMode"]').forEach(radio => {
            radio.onchange = () => {
                dateRangeMode = radio.value;
            };
        });
        
        // Main load function
        $("#loadDataBtn").onclick = async () => {
            if (isProcessing) return;
            
            try {
                isProcessing = true;
                const btn = $("#loadDataBtn");
                const originalText = btn.innerHTML;
                btn.innerHTML = '<span class="spinner"></span>Loading...';
                btn.disabled = true;
                
                const startDate = $("#startDate").value;
                const endDate = $("#endDate").value;
                const isAllTime = !startDate && !endDate;
                const includeAttachments = $("#includeAttachments").checked;
                
                updateStatus("Loading supervisor data...", "processing");
                
                // Load all supervisor data
                supervisorData = await loadSupervisorData(startDate, endDate, isAllTime, includeAttachments);
                
                updateStatus("Data loaded successfully!", "success");
                
                // Render results
                renderResults();
                
                btn.innerHTML = originalText;
                btn.disabled = false;
                isProcessing = false;
                
            } catch (error) {
                console.error("Error loading supervisor data:", error);
                updateStatus("Error: " + error.message, "error");
                $("#loadDataBtn").innerHTML = '🔄 Load Supervisor Data';
                $("#loadDataBtn").disabled = false;
                isProcessing = false;
            }
        };
        
        // Load supervisor data
        async function loadSupervisorData(startDate, endDate, isAllTime, includeAttachments) {
            const allFL = mapView.map.allLayers.filter(l => l.type === "feature");
            const data = {
                supervisors: new Map(),
                dateRange: { start: startDate, end: endDate, isAllTime },
                mode: dateRangeMode,
                includeAttachments: includeAttachments
            };
            
            // Build date clause - use simpler date format
            let dateClause = "";
            if (!isAllTime && startDate && endDate) {
                // Convert to epoch milliseconds for compatibility
                const startDate_obj = new Date(startDate + 'T00:00:00');
                const endDate_obj = new Date(endDate + 'T23:59:59');
                const startMs = startDate_obj.getTime();
                const endMs = endDate_obj.getTime();
                dateClause = ` AND installation_date >= ${startMs} AND installation_date <= ${endMs}`;
            }
            
            console.log('Date clause:', dateClause);
            console.log('Include attachments:', includeAttachments);
            
            // Get supervisor domain maps
            const supervisorDomainMap = await getSupervisorDomain(allFL);
            console.log('Found supervisors in domain:', supervisorDomainMap.size);
            
            // 1. Load Underground Span data
            updateStatus("Loading underground span data...", "processing");
            await loadUndergroundSpanData(allFL, data, dateClause, supervisorDomainMap, includeAttachments);
            
            // 2. Load Vault data
            updateStatus("Loading vault data...", "processing");
            await loadVaultData(allFL, data, dateClause, supervisorDomainMap, includeAttachments);
            
            // 3. Load Pothole data
            updateStatus("Loading pothole data...", "processing");
            await loadPotholeData(allFL, data, dateClause, supervisorDomainMap, includeAttachments);
            
            // 4. Load Gig data
            updateStatus("Loading gig data...", "processing");
            await loadGigData(allFL, data, dateClause, supervisorDomainMap);
            
            // Calculate aggregated metrics
            calculateAggregatedMetrics(data);
            
            return data;
        }
        
        // Get supervisor domain
        async function getSupervisorDomain(allFL) {
            const domainMap = new Map();
            
            // Try to get from any layer that has supervisor field
            const ugLayer = allFL.find(l => l.layerId === targetLayers.undergroundSpan.layerId);
            if (ugLayer) {
                await ugLayer.load();
                const supervisorField = ugLayer.fields.find(f => f.name === 'supervisor');
                if (supervisorField && supervisorField.domain && supervisorField.domain.codedValues) {
                    supervisorField.domain.codedValues.forEach(cv => {
                        domainMap.set(cv.code, cv.name);
                    });
                }
            }
            
            return domainMap;
        }
        
        // Initialize supervisor entry
        function initSupervisor(supervisorMap, supervisorCode, supervisorName) {
            if (!supervisorMap.has(supervisorCode)) {
                supervisorMap.set(supervisorCode, {
                    code: supervisorCode,
                    name: supervisorName || supervisorCode,
                    // Feature updates
                    dailyUpdates: new Map(), // date -> count
                    weeklyUpdates: new Map(), // week -> count
                    // Production
                    ugLength: 0,
                    vaultCount: 0,
                    potholeCount: 0,
                    crewProduction: new Map(), // crew -> production
                    // Gigs
                    totalGigs: 0,
                    totalApprovalDays: 0,
                    approvalDaysCount: 0,
                    // Photos
                    ugPhotos: { total: 0, compliant: 0, nonCompliant: 0 },
                    vaultPhotos: { total: 0, compliant: 0, nonCompliant: 0 },
                    potholePhotos: { total: 0, compliant: 0, nonCompliant: 0 }
                });
            }
            return supervisorMap.get(supervisorCode);
        }
        
        // Load Underground Span data
        async function loadUndergroundSpanData(allFL, data, dateClause, supervisorDomainMap, includeAttachments) {
            const layer = allFL.find(l => l.layerId === targetLayers.undergroundSpan.layerId);
            if (!layer) {
                console.warn('Underground Span layer not found');
                return;
            }
            
            await layer.load();
            console.log('Underground Span layer loaded, fields:', layer.fields.map(f => f.name));
            
            // Get crew domain
            const crewDomainMap = new Map();
            const crewField = layer.fields.find(f => f.name === 'crew');
            if (crewField && crewField.domain && crewField.domain.codedValues) {
                crewField.domain.codedValues.forEach(cv => {
                    crewDomainMap.set(cv.code, cv.name);
                });
            }
            
            const subDomainMap = new Map();
            const subField = layer.fields.find(f => f.name === 'construction_subcontractor');
            if (subField && subField.domain && subField.domain.codedValues) {
                subField.domain.codedValues.forEach(cv => {
                    subDomainMap.set(cv.code, cv.name);
                });
            }
            
            // Build where clause - check if supervisor field exists
            const hasSupervisorField = layer.fields.some(f => f.name === 'supervisor');
            if (!hasSupervisorField) {
                console.error('supervisor field not found in Underground Span layer');
                return;
            }
            
            const whereClause = `supervisor IS NOT NULL${dateClause}`;
            console.log('Underground Span where clause:', whereClause);
            
            try {
                const query = await layer.queryFeatures({
                    where: whereClause,
                    outFields: ["supervisor", "crew", "construction_subcontractor", "calculated_length", "installation_date", "objectid"],
                    returnGeometry: false
                });
                
                console.log('Underground Span query returned', query.features.length, 'features');
            
            // Query attachments only if requested
            const attachmentsByFeature = new Map();
            if (includeAttachments && layer.capabilities?.operations?.supportsQueryAttachments) {
                try {
                    console.log('Querying attachments for Underground Span...');
                    const objectIds = query.features.map(f => f.attributes.objectid);
                    
                    // Batch attachment queries in chunks of 100 to avoid timeout
                    const batchSize = 100;
                    for (let i = 0; i < objectIds.length; i += batchSize) {
                        const batch = objectIds.slice(i, i + batchSize);
                        const attachmentQuery = await layer.queryAttachments({
                            objectIds: batch,
                            returnMetadata: false
                        });
                        
                        for (const [oid, attachments] of Object.entries(attachmentQuery)) {
                            attachmentsByFeature.set(parseInt(oid), attachments.length);
                        }
                    }
                    console.log('Attachments queried for', attachmentsByFeature.size, 'features');
                } catch (err) {
                    console.warn("Could not query attachments for underground span:", err);
                }
            }
            
            query.features.forEach(feature => {
                const supervisorCode = feature.attributes.supervisor;
                const supervisorName = supervisorDomainMap.get(supervisorCode) || supervisorCode;
                const supervisor = initSupervisor(data.supervisors, supervisorCode, supervisorName);
                
                const length = Number(feature.attributes.calculated_length) || 0;
                supervisor.ugLength += length;
                
                // Track crew production
                const crewCode = feature.attributes.crew;
                const subCode = feature.attributes.construction_subcontractor;
                const crewName = crewDomainMap.get(crewCode) || subDomainMap.get(subCode) || crewCode || subCode;
                
                if (crewName) {
                    if (!supervisor.crewProduction.has(crewName)) {
                        supervisor.crewProduction.set(crewName, { ugLength: 0, vaultCount: 0, potholeCount: 0 });
                    }
                    supervisor.crewProduction.get(crewName).ugLength += length;
                }
                
                // Track daily/weekly updates
                const installDate = feature.attributes.installation_date;
                if (installDate) {
                    const date = new Date(installDate);
                    const dateKey = date.toISOString().split('T')[0];
                    
                    supervisor.dailyUpdates.set(dateKey, (supervisor.dailyUpdates.get(dateKey) || 0) + 1);
                    
                    const weekKey = getWeekLabel(date);
                    supervisor.weeklyUpdates.set(weekKey, (supervisor.weeklyUpdates.get(weekKey) || 0) + 1);
                }
                
                // Track photo compliance only if attachments were queried
                if (includeAttachments) {
                    const oid = feature.attributes.objectid;
                    const attachmentCount = attachmentsByFeature.get(oid) || 0;
                    supervisor.ugPhotos.total++;
                    if (attachmentCount >= targetLayers.undergroundSpan.attachmentReq) {
                        supervisor.ugPhotos.compliant++;
                    } else {
                        supervisor.ugPhotos.nonCompliant++;
                    }
                }
            });
            } catch (err) {
                console.error('Error querying Underground Span:', err);
                throw new Error('Failed to query Underground Span: ' + err.message);
            }
        }
        
        // Load Vault data
        async function loadVaultData(allFL, data, dateClause, supervisorDomainMap, includeAttachments) {
            const layer = allFL.find(l => l.layerId === targetLayers.vault.layerId);
            if (!layer) {
                console.warn('Vault layer not found');
                return;
            }
            
            await layer.load();
            console.log('Vault layer loaded, fields:', layer.fields.map(f => f.name));
            
            // Get crew domain
            const crewDomainMap = new Map();
            const crewField = layer.fields.find(f => f.name === 'crew');
            if (crewField && crewField.domain && crewField.domain.codedValues) {
                crewField.domain.codedValues.forEach(cv => {
                    crewDomainMap.set(cv.code, cv.name);
                });
            }
            
            const subDomainMap = new Map();
            const subField = layer.fields.find(f => f.name === 'construction_subcontractor');
            if (subField && subField.domain && subField.domain.codedValues) {
                subField.domain.codedValues.forEach(cv => {
                    subDomainMap.set(cv.code, cv.name);
                });
            }
            
            const whereClause = `supervisor IS NOT NULL${dateClause}`;
            console.log('Vault where clause:', whereClause);
            
            try {
                const query = await layer.queryFeatures({
                    where: whereClause,
                    outFields: ["supervisor", "crew", "construction_subcontractor", "installation_date", "objectid"],
                    returnGeometry: false
                });
                
                console.log('Vault query returned', query.features.length, 'features');
            
            // Query attachments only if requested
            const attachmentsByFeature = new Map();
            if (includeAttachments && layer.capabilities?.operations?.supportsQueryAttachments) {
                try {
                    console.log('Querying attachments for Vault...');
                    const objectIds = query.features.map(f => f.attributes.objectid);
                    
                    // Batch attachment queries in chunks of 100 to avoid timeout
                    const batchSize = 100;
                    for (let i = 0; i < objectIds.length; i += batchSize) {
                        const batch = objectIds.slice(i, i + batchSize);
                        const attachmentQuery = await layer.queryAttachments({
                            objectIds: batch,
                            returnMetadata: false
                        });
                        
                        for (const [oid, attachments] of Object.entries(attachmentQuery)) {
                            attachmentsByFeature.set(parseInt(oid), attachments.length);
                        }
                    }
                    console.log('Attachments queried for', attachmentsByFeature.size, 'features');
                } catch (err) {
                    console.warn("Could not query attachments for vault:", err);
                }
            }
            
            query.features.forEach(feature => {
                const supervisorCode = feature.attributes.supervisor;
                const supervisorName = supervisorDomainMap.get(supervisorCode) || supervisorCode;
                const supervisor = initSupervisor(data.supervisors, supervisorCode, supervisorName);
                
                supervisor.vaultCount++;
                
                // Track crew production
                const crewCode = feature.attributes.crew;
                const subCode = feature.attributes.construction_subcontractor;
                const crewName = crewDomainMap.get(crewCode) || subDomainMap.get(subCode) || crewCode || subCode;
                
                if (crewName) {
                    if (!supervisor.crewProduction.has(crewName)) {
                        supervisor.crewProduction.set(crewName, { ugLength: 0, vaultCount: 0, potholeCount: 0 });
                    }
                    supervisor.crewProduction.get(crewName).vaultCount++;
                }
                
                // Track daily/weekly updates
                const installDate = feature.attributes.installation_date;
                if (installDate) {
                    const date = new Date(installDate);
                    const dateKey = date.toISOString().split('T')[0];
                    
                    supervisor.dailyUpdates.set(dateKey, (supervisor.dailyUpdates.get(dateKey) || 0) + 1);
                    
                    const weekKey = getWeekLabel(date);
                    supervisor.weeklyUpdates.set(weekKey, (supervisor.weeklyUpdates.get(weekKey) || 0) + 1);
                }
                
                // Track photo compliance only if attachments were queried
                if (includeAttachments) {
                    const oid = feature.attributes.objectid;
                    const attachmentCount = attachmentsByFeature.get(oid) || 0;
                    supervisor.vaultPhotos.total++;
                    if (attachmentCount >= targetLayers.vault.attachmentReq) {
                        supervisor.vaultPhotos.compliant++;
                    } else {
                        supervisor.vaultPhotos.nonCompliant++;
                    }
                }
            });
            } catch (err) {
                console.error('Error querying Vault:', err);
                throw new Error('Failed to query Vault: ' + err.message);
            }
        }
        
        // Load Pothole data
        async function loadPotholeData(allFL, data, dateClause, supervisorDomainMap, includeAttachments) {
            const layer = allFL.find(l => l.layerId === targetLayers.pothole.layerId);
            if (!layer) {
                console.warn('Pothole layer not found');
                return;
            }
            
            await layer.load();
            console.log('Pothole layer loaded, fields:', layer.fields.map(f => f.name));
            
            // Get crew domain
            const crewDomainMap = new Map();
            const crewField = layer.fields.find(f => f.name === 'crew');
            if (crewField && crewField.domain && crewField.domain.codedValues) {
                crewField.domain.codedValues.forEach(cv => {
                    crewDomainMap.set(cv.code, cv.name);
                });
            }
            
            const subDomainMap = new Map();
            const subField = layer.fields.find(f => f.name === 'construction_subcontractor');
            if (subField && subField.domain && subField.domain.codedValues) {
                subField.domain.codedValues.forEach(cv => {
                    subDomainMap.set(cv.code, cv.name);
                });
            }
            
            // Use created_date for pothole instead of installation_date
            let potholeDateClause = "";
            if (dateClause) {
                potholeDateClause = dateClause.replace(/installation_date/g, 'created_date');
            }
            
            const whereClause = `supervisor IS NOT NULL${potholeDateClause}`;
            console.log('Pothole where clause:', whereClause);
            
            try {
                const query = await layer.queryFeatures({
                    where: whereClause,
                    outFields: ["supervisor", "crew", "construction_subcontractor", "created_date", "objectid"],
                    returnGeometry: false
                });
                
                console.log('Pothole query returned', query.features.length, 'features');
            
            // Query attachments only if requested
            const attachmentsByFeature = new Map();
            if (includeAttachments && layer.capabilities?.operations?.supportsQueryAttachments) {
                try {
                    console.log('Querying attachments for Pothole...');
                    const objectIds = query.features.map(f => f.attributes.objectid);
                    
                    // Batch attachment queries in chunks of 100 to avoid timeout
                    const batchSize = 100;
                    for (let i = 0; i < objectIds.length; i += batchSize) {
                        const batch = objectIds.slice(i, i + batchSize);
                        const attachmentQuery = await layer.queryAttachments({
                            objectIds: batch,
                            returnMetadata: false
                        });
                        
                        for (const [oid, attachments] of Object.entries(attachmentQuery)) {
                            attachmentsByFeature.set(parseInt(oid), attachments.length);
                        }
                    }
                    console.log('Attachments queried for', attachmentsByFeature.size, 'features');
                } catch (err) {
                    console.warn("Could not query attachments for pothole:", err);
                }
            }
            
            query.features.forEach(feature => {
                const supervisorCode = feature.attributes.supervisor;
                const supervisorName = supervisorDomainMap.get(supervisorCode) || supervisorCode;
                const supervisor = initSupervisor(data.supervisors, supervisorCode, supervisorName);
                
                supervisor.potholeCount++;
                
                // Track crew production
                const crewCode = feature.attributes.crew;
                const subCode = feature.attributes.construction_subcontractor;
                const crewName = crewDomainMap.get(crewCode) || subDomainMap.get(subCode) || crewCode || subCode;
                
                if (crewName) {
                    if (!supervisor.crewProduction.has(crewName)) {
                        supervisor.crewProduction.set(crewName, { ugLength: 0, vaultCount: 0, potholeCount: 0 });
                    }
                    supervisor.crewProduction.get(crewName).potholeCount++;
                }
                
                // Track daily/weekly updates using created_date
                const createdDate = feature.attributes.created_date;
                if (createdDate) {
                    const date = new Date(createdDate);
                    const dateKey = date.toISOString().split('T')[0];
                    
                    supervisor.dailyUpdates.set(dateKey, (supervisor.dailyUpdates.get(dateKey) || 0) + 1);
                    
                    const weekKey = getWeekLabel(date);
                    supervisor.weeklyUpdates.set(weekKey, (supervisor.weeklyUpdates.get(weekKey) || 0) + 1);
                }
                
                // Track photo compliance only if attachments were queried
                if (includeAttachments) {
                    const oid = feature.attributes.objectid;
                    const attachmentCount = attachmentsByFeature.get(oid) || 0;
                    supervisor.potholePhotos.total++;
                    if (attachmentCount >= targetLayers.pothole.attachmentReq) {
                        supervisor.potholePhotos.compliant++;
                    } else {
                        supervisor.potholePhotos.nonCompliant++;
                    }
                }
            });
            } catch (err) {
                console.error('Error querying Pothole:', err);
                throw new Error('Failed to query Pothole: ' + err.message);
            }
        }
        
        // Load Gig data
        async function loadGigData(allFL, data, dateClause, supervisorDomainMap) {
            const layer = allFL.find(l => l.layerId === targetLayers.gig.layerId);
            if (!layer) {
                console.warn('Gig layer not found');
                return;
            }
            
            await layer.load();
            console.log('Gig layer loaded, fields:', layer.fields.map(f => f.name));
            
            const whereClause = `supervisor IS NOT NULL${dateClause}`;
            console.log('Gig where clause:', whereClause);
            
            try {
                const query = await layer.queryFeatures({
                    where: whereClause,
                    outFields: ["supervisor", "approval_days"],
                    returnGeometry: false
                });
                
                console.log('Gig query returned', query.features.length, 'features');
            
            query.features.forEach(feature => {
                const supervisorCode = feature.attributes.supervisor;
                const supervisorName = supervisorDomainMap.get(supervisorCode) || supervisorCode;
                const supervisor = initSupervisor(data.supervisors, supervisorCode, supervisorName);
                
                supervisor.totalGigs++;
                
                const approvalDays = feature.attributes.approval_days;
                if (approvalDays != null && !isNaN(approvalDays)) {
                    supervisor.totalApprovalDays += Number(approvalDays);
                    supervisor.approvalDaysCount++;
                }
            });
            } catch (err) {
                console.error('Error querying Gig:', err);
                throw new Error('Failed to query Gig: ' + err.message);
            }
        }
        
        // Calculate aggregated metrics
        function calculateAggregatedMetrics(data) {
            data.supervisors.forEach(supervisor => {
                // Average approval days
                if (supervisor.approvalDaysCount > 0) {
                    supervisor.avgApprovalDays = supervisor.totalApprovalDays / supervisor.approvalDaysCount;
                } else {
                    supervisor.avgApprovalDays = null;
                }
                
                // Photo compliance percentages
                const totalPhotos = supervisor.ugPhotos.total + supervisor.vaultPhotos.total + supervisor.potholePhotos.total;
                const totalCompliant = supervisor.ugPhotos.compliant + supervisor.vaultPhotos.compliant + supervisor.potholePhotos.compliant;
                
                if (totalPhotos > 0) {
                    supervisor.overallPhotoCompliance = (totalCompliant / totalPhotos) * 100;
                } else {
                    supervisor.overallPhotoCompliance = null;
                }
                
                // Total features updated
                supervisor.totalFeaturesUpdated = Array.from(supervisor.dailyUpdates.values()).reduce((sum, count) => sum + count, 0);
                
                // Average daily/weekly updates
                if (supervisor.dailyUpdates.size > 0) {
                    supervisor.avgDailyUpdates = supervisor.totalFeaturesUpdated / supervisor.dailyUpdates.size;
                } else {
                    supervisor.avgDailyUpdates = 0;
                }
                
                if (supervisor.weeklyUpdates.size > 0) {
                    supervisor.avgWeeklyUpdates = supervisor.totalFeaturesUpdated / supervisor.weeklyUpdates.size;
                } else {
                    supervisor.avgWeeklyUpdates = 0;
                }
            });
        }
        
        // Render results
        function renderResults() {
            $("#resultsSection").style.display = "block";
            
            // Summary cards
            renderSummaryCards();
            
            // Metrics tables
            renderMetrics();
        }
        
        // Render summary cards
        function renderSummaryCards() {
            const container = $("#summaryCards");
            
            const totalSupervisors = supervisorData.supervisors.size;
            
            let totalFeatures = 0;
            let totalGigs = 0;
            let avgCompliance = 0;
            let complianceCount = 0;
            
            supervisorData.supervisors.forEach(sup => {
                totalFeatures += sup.totalFeaturesUpdated;
                totalGigs += sup.totalGigs;
                if (supervisorData.includeAttachments && sup.overallPhotoCompliance !== null) {
                    avgCompliance += sup.overallPhotoCompliance;
                    complianceCount++;
                }
            });
            
            if (complianceCount > 0) {
                avgCompliance = avgCompliance / complianceCount;
            }
            
            const complianceColor = avgCompliance >= 80 ? '#4caf50' : avgCompliance >= 50 ? '#ff9800' : '#f44336';
            
            let cards = `
                <div class="metric-card">
                    <div style="font-size:24px;font-weight:bold;color:#3367d6;">${totalSupervisors}</div>
                    <div style="font-size:11px;color:#666;">Supervisors</div>
                </div>
                
                <div class="metric-card">
                    <div style="font-size:24px;font-weight:bold;color:#2196f3;">${totalFeatures.toLocaleString()}</div>
                    <div style="font-size:11px;color:#666;">Total Features Updated</div>
                </div>
                
                <div class="metric-card">
                    <div style="font-size:24px;font-weight:bold;color:#ff9800;">${totalGigs}</div>
                    <div style="font-size:11px;color:#666;">Total Gigs</div>
                </div>
            `;
            
            if (supervisorData.includeAttachments) {
                cards += `
                    <div class="metric-card">
                        <div style="font-size:24px;font-weight:bold;color:${complianceColor};">${avgCompliance.toFixed(1)}%</div>
                        <div style="font-size:11px;color:#666;">Avg Photo Compliance</div>
                    </div>
                `;
            }
            
            container.innerHTML = cards;
        }
        
        // Render metrics
        function renderMetrics() {
            const container = $("#metricsContent");
            const filter = $("#metricFilter").value;
            
            let html = '';
            
            // Convert supervisors map to sorted array
            const supervisors = Array.from(supervisorData.supervisors.values()).sort((a, b) => 
                b.totalFeaturesUpdated - a.totalFeaturesUpdated
            );
            
            // 1. Feature Updates
            if (filter === 'all' || filter === 'updates') {
                html += renderFeatureUpdatesTable(supervisors);
            }
            
            // 2. Production Metrics
            if (filter === 'all' || filter === 'production') {
                html += renderProductionTable(supervisors);
            }
            
            // 3. Gig Quality
            if (filter === 'all' || filter === 'quality') {
                html += renderGigQualityTable(supervisors);
            }
            
            // 4. Photo Compliance (only if attachments were included)
            if (supervisorData.includeAttachments && (filter === 'all' || filter === 'photos')) {
                html += renderPhotoComplianceTable(supervisors);
            } else if (!supervisorData.includeAttachments && filter === 'photos') {
                html += `
                    <div class="metric-card">
                        <div class="metric-header">📸 Photo Requirement Compliance</div>
                        <div style="padding:12px;color:#666;font-style:italic;">
                            Photo compliance data not loaded. Check "Include Photo Compliance" and reload to see this metric.
                        </div>
                    </div>
                `;
            }
            
            container.innerHTML = html;
        }
        
        // Render feature updates table
        function renderFeatureUpdatesTable(supervisors) {
            const mode = supervisorData.mode;
            const modeLabel = mode === 'daily' ? 'Daily' : 'Weekly';
            
            return `
                <div class="metric-card">
                    <div class="metric-header">📅 Feature Updates (${modeLabel})</div>
                    <div style="overflow-x:auto;">
                        <table style="width:100%;border-collapse:collapse;font-size:11px;">
                            <thead>
                                <tr style="background:#f5f5f5;">
                                    <th style="border:1px solid #ddd;padding:6px;text-align:left;">Supervisor</th>
                                    <th style="border:1px solid #ddd;padding:6px;text-align:right;">Total Features</th>
                                    <th style="border:1px solid #ddd;padding:6px;text-align:right;">Avg Per ${mode === 'daily' ? 'Day' : 'Week'}</th>
                                    <th style="border:1px solid #ddd;padding:6px;text-align:right;">Active ${mode === 'daily' ? 'Days' : 'Weeks'}</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${supervisors.map(sup => {
                                    const avgUpdates = mode === 'daily' ? sup.avgDailyUpdates : sup.avgWeeklyUpdates;
                                    const activePeriods = mode === 'daily' ? sup.dailyUpdates.size : sup.weeklyUpdates.size;
                                    
                                    return `
                                        <tr class="supervisor-row">
                                            <td style="border:1px solid #ddd;padding:6px;font-weight:bold;">${sup.name}</td>
                                            <td style="border:1px solid #ddd;padding:6px;text-align:right;">${sup.totalFeaturesUpdated}</td>
                                            <td style="border:1px solid #ddd;padding:6px;text-align:right;">${avgUpdates.toFixed(1)}</td>
                                            <td style="border:1px solid #ddd;padding:6px;text-align:right;">${activePeriods}</td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }
        
        // Render production table
        function renderProductionTable(supervisors) {
            return `
                <div class="metric-card">
                    <div class="metric-header">🏗️ Production Metrics by Supervisor</div>
                    <div style="overflow-x:auto;">
                        <table style="width:100%;border-collapse:collapse;font-size:11px;">
                            <thead>
                                <tr style="background:#f5f5f5;">
                                    <th style="border:1px solid #ddd;padding:6px;text-align:left;">Supervisor</th>
                                    <th style="border:1px solid #ddd;padding:6px;text-align:right;">UG Span (ft)</th>
                                    <th style="border:1px solid #ddd;padding:6px;text-align:right;">Vaults</th>
                                    <th style="border:1px solid #ddd;padding:6px;text-align:right;">Potholes</th>
                                    <th style="border:1px solid #ddd;padding:6px;text-align:left;">Crews</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${supervisors.map(sup => {
                                    const crewList = Array.from(sup.crewProduction.keys()).join(', ') || 'N/A';
                                    
                                    return `
                                        <tr class="supervisor-row">
                                            <td style="border:1px solid #ddd;padding:6px;font-weight:bold;">${sup.name}</td>
                                            <td style="border:1px solid #ddd;padding:6px;text-align:right;">${Math.round(sup.ugLength).toLocaleString()}</td>
                                            <td style="border:1px solid #ddd;padding:6px;text-align:right;">${sup.vaultCount}</td>
                                            <td style="border:1px solid #ddd;padding:6px;text-align:right;">${sup.potholeCount}</td>
                                            <td style="border:1px solid #ddd;padding:6px;font-size:10px;">${crewList}</td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }
        
        // Render gig quality table
        function renderGigQualityTable(supervisors) {
            return `
                <div class="metric-card">
                    <div class="metric-header">✅ Gig Quality Metrics</div>
                    <div style="overflow-x:auto;">
                        <table style="width:100%;border-collapse:collapse;font-size:11px;">
                            <thead>
                                <tr style="background:#f5f5f5;">
                                    <th style="border:1px solid #ddd;padding:6px;text-align:left;">Supervisor</th>
                                    <th style="border:1px solid #ddd;padding:6px;text-align:right;">Total Gigs</th>
                                    <th style="border:1px solid #ddd;padding:6px;text-align:right;">Avg Approval Days</th>
                                    <th style="border:1px solid #ddd;padding:6px;text-align:center;">Quality Rating</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${supervisors.map(sup => {
                                    const avgDays = sup.avgApprovalDays !== null ? sup.avgApprovalDays.toFixed(1) : 'N/A';
                                    
                                    let qualityClass = 'compliance-good';
                                    let qualityLabel = '⭐ Excellent';
                                    if (sup.avgApprovalDays !== null) {
                                        if (sup.avgApprovalDays > 5) {
                                            qualityClass = 'compliance-critical';
                                            qualityLabel = '🔴 Needs Improvement';
                                        } else if (sup.avgApprovalDays > 3) {
                                            qualityClass = 'compliance-warning';
                                            qualityLabel = '⚠️ Good';
                                        }
                                    } else {
                                        qualityClass = '';
                                        qualityLabel = 'N/A';
                                    }
                                    
                                    return `
                                        <tr class="supervisor-row">
                                            <td style="border:1px solid #ddd;padding:6px;font-weight:bold;">${sup.name}</td>
                                            <td style="border:1px solid #ddd;padding:6px;text-align:right;">${sup.totalGigs}</td>
                                            <td style="border:1px solid #ddd;padding:6px;text-align:right;">${avgDays}</td>
                                            <td style="border:1px solid #ddd;padding:6px;text-align:center;" class="${qualityClass}">${qualityLabel}</td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }
        
        // Render photo compliance table
        function renderPhotoComplianceTable(supervisors) {
            return `
                <div class="metric-card">
                    <div class="metric-header">📸 Photo Requirement Compliance</div>
                    <div style="margin-bottom:8px;font-size:11px;color:#666;">
                        Requirements: UG Span (2+), Vault (4+), Pothole (1+)
                    </div>
                    <div style="overflow-x:auto;">
                        <table style="width:100%;border-collapse:collapse;font-size:11px;">
                            <thead>
                                <tr style="background:#f5f5f5;">
                                    <th style="border:1px solid #ddd;padding:6px;text-align:left;">Supervisor</th>
                                    <th style="border:1px solid #ddd;padding:6px;text-align:center;">UG Span</th>
                                    <th style="border:1px solid #ddd;padding:6px;text-align:center;">Vault</th>
                                    <th style="border:1px solid #ddd;padding:6px;text-align:center;">Pothole</th>
                                    <th style="border:1px solid #ddd;padding:6px;text-align:center;">Overall</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${supervisors.map(sup => {
                                    const ugPct = sup.ugPhotos.total > 0 ? (sup.ugPhotos.compliant / sup.ugPhotos.total * 100) : null;
                                    const vaultPct = sup.vaultPhotos.total > 0 ? (sup.vaultPhotos.compliant / sup.vaultPhotos.total * 100) : null;
                                    const potholePct = sup.potholePhotos.total > 0 ? (sup.potholePhotos.compliant / sup.potholePhotos.total * 100) : null;
                                    
                                    const ugDisplay = ugPct !== null ? `${ugPct.toFixed(1)}% (${sup.ugPhotos.compliant}/${sup.ugPhotos.total})` : 'N/A';
                                    const vaultDisplay = vaultPct !== null ? `${vaultPct.toFixed(1)}% (${sup.vaultPhotos.compliant}/${sup.vaultPhotos.total})` : 'N/A';
                                    const potholeDisplay = potholePct !== null ? `${potholePct.toFixed(1)}% (${sup.potholePhotos.compliant}/${sup.potholePhotos.total})` : 'N/A';
                                    const overallDisplay = sup.overallPhotoCompliance !== null ? `${sup.overallPhotoCompliance.toFixed(1)}%` : 'N/A';
                                    
                                    const ugClass = ugPct !== null ? (ugPct >= 80 ? 'compliance-good' : ugPct >= 50 ? 'compliance-warning' : 'compliance-critical') : '';
                                    const vaultClass = vaultPct !== null ? (vaultPct >= 80 ? 'compliance-good' : vaultPct >= 50 ? 'compliance-warning' : 'compliance-critical') : '';
                                    const potholeClass = potholePct !== null ? (potholePct >= 80 ? 'compliance-good' : potholePct >= 50 ? 'compliance-warning' : 'compliance-critical') : '';
                                    const overallClass = sup.overallPhotoCompliance !== null ? (sup.overallPhotoCompliance >= 80 ? 'compliance-good' : sup.overallPhotoCompliance >= 50 ? 'compliance-warning' : 'compliance-critical') : '';
                                    
                                    return `
                                        <tr class="supervisor-row">
                                            <td style="border:1px solid #ddd;padding:6px;font-weight:bold;">${sup.name}</td>
                                            <td style="border:1px solid #ddd;padding:6px;text-align:center;" class="${ugClass}">${ugDisplay}</td>
                                            <td style="border:1px solid #ddd;padding:6px;text-align:center;" class="${vaultClass}">${vaultDisplay}</td>
                                            <td style="border:1px solid #ddd;padding:6px;text-align:center;" class="${potholeClass}">${potholeDisplay}</td>
                                            <td style="border:1px solid #ddd;padding:6px;text-align:center;" class="${overallClass}">${overallDisplay}</td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }
        
        // Metric filter change handler
        $("#metricFilter").onchange = () => {
            if (supervisorData) {
                renderMetrics();
            }
        };
        
        // Export to CSV
        $("#exportBtn").onclick = () => {
            if (!supervisorData) return;
            
            try {
                const csv = generateCSV();
                downloadCSV(csv, 'supervisor-performance.csv');
                updateStatus("CSV exported successfully!", "success");
            } catch (error) {
                console.error("Error exporting CSV:", error);
                updateStatus("Error exporting CSV: " + error.message, "error");
            }
        };
        
        // Generate CSV content
        function generateCSV() {
            const supervisors = Array.from(supervisorData.supervisors.values()).sort((a, b) => 
                b.totalFeaturesUpdated - a.totalFeaturesUpdated
            );
            
            let csv = '';
            
            // Header
            csv += 'Supervisor,Total Features Updated,Avg Daily Updates,Avg Weekly Updates,';
            csv += 'UG Span (ft),Vaults,Potholes,';
            csv += 'Total Gigs,Avg Approval Days,';
            csv += 'UG Photo Compliance (%),Vault Photo Compliance (%),Pothole Photo Compliance (%),Overall Photo Compliance (%)\n';
            
            // Data rows
            supervisors.forEach(sup => {
                const ugPct = sup.ugPhotos.total > 0 ? (sup.ugPhotos.compliant / sup.ugPhotos.total * 100).toFixed(1) : 'N/A';
                const vaultPct = sup.vaultPhotos.total > 0 ? (sup.vaultPhotos.compliant / sup.vaultPhotos.total * 100).toFixed(1) : 'N/A';
                const potholePct = sup.potholePhotos.total > 0 ? (sup.potholePhotos.compliant / sup.potholePhotos.total * 100).toFixed(1) : 'N/A';
                const overallPct = sup.overallPhotoCompliance !== null ? sup.overallPhotoCompliance.toFixed(1) : 'N/A';
                const avgApproval = sup.avgApprovalDays !== null ? sup.avgApprovalDays.toFixed(1) : 'N/A';
                
                csv += `"${sup.name}",${sup.totalFeaturesUpdated},${sup.avgDailyUpdates.toFixed(1)},${sup.avgWeeklyUpdates.toFixed(1)},`;
                csv += `${Math.round(sup.ugLength)},${sup.vaultCount},${sup.potholeCount},`;
                csv += `${sup.totalGigs},${avgApproval},`;
                csv += `${ugPct},${vaultPct},${potholePct},${overallPct}\n`;
            });
            
            return csv;
        }
        
        // Download CSV
        function downloadCSV(csv, filename) {
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            
            link.setAttribute('href', url);
            link.setAttribute('download', filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
        
        // Close tool
        $("#closeTool").onclick = () => {
            window.gisToolHost.closeTool('supervisor-dashboard');
        };
        
        // Cleanup function
        function cleanup() {
            if (styles && styles.parentNode) {
                styles.parentNode.removeChild(styles);
            }
            
            toolBox.remove();
            console.log('Supervisor Dashboard Tool cleaned up');
        }
        
        // Register tool
        window.gisToolHost.activeTools.set('supervisor-dashboard', {
            cleanup: cleanup,
            toolBox: toolBox
        });
        
        console.log('Supervisor Performance Dashboard Tool loaded successfully');
        
    } catch (error) {
        console.error('Error loading Supervisor Dashboard Tool:', error);
        alert("Error creating Supervisor Dashboard Tool: " + (error.message || error));
    }
})();
