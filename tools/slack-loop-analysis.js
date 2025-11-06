// tools/slack-loop-analysis.js - Converted from bookmarklet format
// Parent/Child Code Reconciliation Tool for analyzing slack loops and fiber infrastructure

(function() {
    try {
        // Check if tool is already active
        if (window.gisToolHost.activeTools.has('slack-loop-analysis')) {
            console.log('Slack Loop Analysis Tool already active');
            return;
        }
        
        // Remove any leftover toolbox
        const existingToolbox = document.getElementById('slackLoopAnalysisToolbox');
        if (existingToolbox) {
            existingToolbox.remove();
            console.log('Removed leftover slack loop analysis toolbox');
        }
        
        // Use shared utilities
        const utils = window.gisSharedUtils;
        if (!utils) {
            throw new Error('Shared utilities not loaded');
        }
        
        const mapView = utils.getMapView();
        
        // Tool state variables
        let analysisData = [];
        let originalLabelingInfo = null;
        let highlightGraphic = null;
        
        // Create tool UI
        const toolBox = document.createElement("div");
        toolBox.id = "slackLoopAnalysisToolbox";
        toolBox.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 99999;
            background: #fff;
            border: 1px solid #333;
            padding: 8px;
            max-width: 400px;
            max-height: 85vh;
            overflow-y: auto;
            font: 11px/1.2 Arial;
            box-shadow: 0 4px 16px rgba(0,0,0,.2);
            border-radius: 4px;
        `;
        
        toolBox.innerHTML = `
            <div style="font-weight:bold;margin-bottom:6px;font-size:12px;">Slack Loop Analysis</div>
            
            <label style="font-size:11px;">Work Order ID:</label><br>
            <select id="workorderSelect" style="width:100%;margin:2px 0 6px 0;padding:3px;font-size:11px;">
                <option>Loading work orders...</option>
            </select><br>
            
            <label style="font-size:11px;">Fiber Detection Tolerance (meters):</label><br>
            <input id="fiberTolerance" type="number" value="10" min="1" max="100" style="width:60px;margin:2px 0 6px 0;padding:3px;font-size:11px;"><br>
            
            <label style="font-size:11px;">Slack Loop Tolerance (meters):</label><br>
            <input id="slackTolerance" type="number" value="5" min="1" max="50" style="width:60px;margin:2px 0 6px 0;padding:3px;font-size:11px;"><br>
            
            <label style="font-size:11px;"><input type="checkbox" id="debugMode" style="margin-right:4px;">Debug Mode</label><br>
            
            <button id="runBtn" style="padding:4px 8px;margin-right:4px;font-size:10px;">Run Analysis</button>
            <button id="resetBtn" style="padding:4px 8px;margin-right:4px;font-size:10px;">Reset</button>
            <button id="exportBtn" style="padding:4px 8px;margin-right:4px;font-size:10px;display:none;">Export CSV</button>
            <button id="closeTool" style="padding:4px 8px;font-size:10px;">Close</button><br>
            
            <div id="toolStatus" style="margin-top:6px;color:#3367d6;font-size:10px;"></div>
            <div id="results" style="margin-top:6px;font-size:10px;"></div>
        `;
        
        // Add to page
        document.body.appendChild(toolBox);
        
        // Get UI elements
        const $ = (id) => toolBox.querySelector(id);
        const status = $("#toolStatus");
        const results = $("#results");
        
        function updateStatus(message) {
            status.textContent = message;
        }
        
        function updateResults(html) {
            results.innerHTML = html;
        }
        
        // Reset filters and layers
        function resetFilters() {
            const layers = mapView.map.allLayers.filter(l => l && l.type === "feature");
            
            for (const layer of layers) {
                if (layer && typeof layer.layerId !== 'undefined') {
                    layer.definitionExpression = null;
                    
                    if (layer.layerId === 41250) { // Slack Loop layer
                        layer.labelingInfo = originalLabelingInfo;
                        layer.labelsVisible = false;
                    }
                }
            }
            
            if (highlightGraphic) {
                mapView.graphics.remove(highlightGraphic);
                highlightGraphic = null;
            }
            
            updateStatus("Filters reset");
            updateResults("");
            analysisData = [];
            $("#exportBtn").style.display = "none";
        }
        
        // Generate map URL with location highlighting
        function generateMapUrl(objectId, geometry) {
            try {
                const url = window.location.origin + window.location.pathname;
                const params = new URLSearchParams(window.location.search);
                let center = mapView.center;
                let scale = mapView.scale;
                
                if (geometry && geometry.extent && geometry.extent.center) {
                    center = geometry.extent.center;
                    scale = 2000;
                }
                
                params.set('center', center.longitude.toFixed(6) + ',' + center.latitude.toFixed(6));
                params.set('level', Math.round(Math.log2(591657527.591555 / scale)).toString());
                params.set('highlight', '41250:' + objectId);
                
                return url + '?' + params.toString();
            } catch (e) {
                return window.location.href;
            }
        }
        
        // CSV escape function
        function escapeCSV(field) {
            if (field === null || field === undefined) return "";
            field = String(field);
            if (field.indexOf(',') >= 0 || field.indexOf('"') >= 0 || field.indexOf('\n') >= 0) {
                field = '"' + field.replace(/"/g, '""') + '"';
            }
            return field;
        }
        
        // Export analysis data to CSV
        function exportCSV() {
            if (analysisData.length === 0) {
                alert("No data to export. Please run analysis first.");
                return;
            }
            
            let csv = "data:text/csv;charset=utf-8,";
            csv += "Issue Type,Location Type,Location ID,Slack Loop ID,Fiber Count,Distance (m),Description,Map URL\n";
            
            for (const row of analysisData) {
                const slackId = row.slackLoopId || "N/A";
                const distance = row.distance !== undefined ? row.distance.toFixed(2) : "N/A";
                let mapUrl = "";
                
                if (row.slackLoopOid) {
                    mapUrl = generateMapUrl(row.slackLoopOid, row.slackLoopGeometry);
                } else if (row.locationOid) {
                    mapUrl = generateMapUrl(row.locationOid, row.locationGeometry);
                }
                
                csv += escapeCSV(row.issueType) + "," + 
                       escapeCSV(row.locationType) + "," + 
                       escapeCSV(row.locationId) + "," + 
                       escapeCSV(slackId) + "," + 
                       row.fiberCount + "," + 
                       distance + "," + 
                       escapeCSV(row.description) + "," + 
                       escapeCSV(mapUrl) + "\n";
            }
            
            const uri = encodeURI(csv);
            const link = document.createElement("a");
            link.setAttribute("href", uri);
            link.setAttribute("download", "slackloop_analysis_" + new Date().toISOString().slice(0, 10) + ".csv");
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
        
        // Highlight feature on map
        function highlightFeature(geometry, color) {
            if (highlightGraphic) {
                mapView.graphics.remove(highlightGraphic);
            }
            
            let symbol;
            if (geometry.type === "point") {
                symbol = {
                    type: "simple-marker",
                    style: "circle",
                    color: [255, 255, 255, 0],
                    size: "20px",
                    outline: {
                        color: color,
                        width: 4
                    }
                };
            } else {
                symbol = {
                    type: "simple-line",
                    color: color,
                    width: 4,
                    style: "solid"
                };
            }
            
            highlightGraphic = mapView.graphics.add({
                geometry: geometry,
                symbol: symbol
            });
            
            setTimeout(() => {
                if (highlightGraphic) {
                    mapView.graphics.remove(highlightGraphic);
                    highlightGraphic = null;
                }
            }, 5000);
        }
        
        // Calculate distance between two points
        function calculateDistance(point1, point2) {
            let x1, y1, x2, y2;
            
            if (point1.x !== undefined && point1.y !== undefined) {
                x1 = point1.x;
                y1 = point1.y;
            } else if (point1.extent && point1.extent.center) {
                x1 = point1.extent.center.x;
                y1 = point1.extent.center.y;
            } else {
                return Infinity;
            }
            
            if (point2.x !== undefined && point2.y !== undefined) {
                x2 = point2.x;
                y2 = point2.y;
            } else if (point2.extent && point2.extent.center) {
                x2 = point2.extent.center.x;
                y2 = point2.extent.center.y;
            } else {
                return Infinity;
            }
            
            return Math.sqrt(Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2));
        }
        
        // Calculate distance from point to line segment
        function distanceToLineSegment(point, lineStart, lineEnd) {
            const A = point.x - lineStart.x;
            const B = point.y - lineStart.y;
            const C = lineEnd.x - lineStart.x;
            const D = lineEnd.y - lineStart.y;
            const dot = A * C + B * D;
            const lenSq = C * C + D * D;
            
            if (lenSq === 0) {
                return Math.sqrt(A * A + B * B);
            }
            
            const param = dot / lenSq;
            let xx, yy;
            
            if (param < 0) {
                xx = lineStart.x;
                yy = lineStart.y;
            } else if (param > 1) {
                xx = lineEnd.x;
                yy = lineEnd.y;
            } else {
                xx = lineStart.x + param * C;
                yy = lineStart.y + param * D;
            }
            
            const dx = point.x - xx;
            const dy = point.y - yy;
            return Math.sqrt(dx * dx + dy * dy);
        }
        
        // Get minimum distance from location to a fiber
        function getMinimumFiberDistance(location, fiber) {
            const locationCenter = location.geometry.x && location.geometry.y ? 
                {x: location.geometry.x, y: location.geometry.y} : 
                (location.geometry.extent && location.geometry.extent.center ? 
                    location.geometry.extent.center : null);
            
            if (!locationCenter || !fiber.geometry) return Infinity;
            
            let minDistance = Infinity;
            
            // Handle polyline geometry
            if (fiber.geometry.type === "polyline" && fiber.geometry.paths) {
                for (const path of fiber.geometry.paths) {
                    for (let v = 0; v < path.length - 1; v++) {
                        const start = {x: path[v][0], y: path[v][1]};
                        const end = {x: path[v + 1][0], y: path[v + 1][1]};
                        const segmentDistance = distanceToLineSegment(locationCenter, start, end);
                        minDistance = Math.min(minDistance, segmentDistance);
                    }
                }
            }
            // Handle other geometry types with paths
            else if (fiber.geometry.paths && fiber.geometry.paths.length > 0) {
                for (const path of fiber.geometry.paths) {
                    for (let v = 0; v < path.length - 1; v++) {
                        const start = {x: path[v][0], y: path[v][1]};
                        const end = {x: path[v + 1][0], y: path[v + 1][1]};
                        const segmentDistance = distanceToLineSegment(locationCenter, start, end);
                        minDistance = Math.min(minDistance, segmentDistance);
                    }
                }
            }
            // Handle extent-based geometry
            else if (fiber.geometry.extent) {
                const extent = fiber.geometry.extent;
                const checkPoints = [
                    {x: extent.xmin, y: extent.ymin},
                    {x: extent.xmax, y: extent.ymax},
                    {x: extent.xmin, y: extent.ymax},
                    {x: extent.xmax, y: extent.ymin}
                ];
                
                if (extent.center) {
                    checkPoints.push({x: extent.center.x, y: extent.center.y});
                }
                
                for (const checkPoint of checkPoints) {
                    const pointDistance = calculateDistance(locationCenter, checkPoint);
                    minDistance = Math.min(minDistance, pointDistance);
                }
            }
            // Handle point geometry
            else if (fiber.geometry.x !== undefined && fiber.geometry.y !== undefined) {
                minDistance = calculateDistance(locationCenter, fiber.geometry);
            }
            
            // Handle polygon geometry with rings
            if (fiber.geometry.rings && fiber.geometry.rings.length > 0) {
                for (const ring of fiber.geometry.rings) {
                    for (let v = 0; v < ring.length - 1; v++) {
                        const start = {x: ring[v][0], y: ring[v][1]};
                        const end = {x: ring[v + 1][0], y: ring[v + 1][1]};
                        const segmentDistance = distanceToLineSegment(locationCenter, start, end);
                        minDistance = Math.min(minDistance, segmentDistance);
                    }
                }
            }
            
            return minDistance;
        }
        
        // Get fiber count near a location with improved accuracy
        function getFiberCountNearLocation(location, fibers, tolerance) {
            const nearbyFibers = [];
            
            for (const fiber of fibers) {
                if (!fiber.geometry) continue;
                
                // Skip fibers with workflow_status = 'NA'
                if (fiber.attributes.workflow_status === 'NA') {
                    if (window.fiberDebug) {
                        console.log('Skipping fiber with workflow_status=NA:', fiber.attributes.gis_id || fiber.attributes.objectid);
                    }
                    continue;
                }
                
                const minDistance = getMinimumFiberDistance(location, fiber);
                
                if (minDistance <= tolerance) {
                    nearbyFibers.push({
                        fiber: fiber,
                        distance: minDistance,
                        fiberId: fiber.attributes.gis_id || fiber.attributes.objectid || 'Unknown'
                    });
                }
            }
            
            if (window.fiberDebug && nearbyFibers.length > 0) {
                console.log('Fibers found near location:', nearbyFibers.map(f => ({
                    id: f.fiberId,
                    distance: f.distance.toFixed(2) + 'm',
                    geometryType: f.fiber.geometry.type || 'Unknown'
                })));
            }
            
            return nearbyFibers;
        }
        
        // Global zoom functions for buttons in results
        window.zoomToLocation = function(objectId) {
            updateStatus("Zooming to location...");
            
            const allLayers = mapView.map.allLayers.filter(l => l && l.type === "feature");
            const poleLayer = allLayers.find(l => l && l.layerId === 43150);
            const vaultLayer = allLayers.find(l => l && l.layerId === 42100);
            
            if (poleLayer) {
                poleLayer.queryFeatures({
                    where: "objectid = " + objectId,
                    outFields: ["objectid"],
                    returnGeometry: true
                }).then(result => {
                    if (result.features.length > 0) {
                        const feature = result.features[0];
                        if (feature.geometry) {
                            mapView.goTo({target: feature.geometry, scale: 2000}).then(() => {
                                highlightFeature(feature.geometry, [255, 0, 0, 255]);
                                updateStatus("Zoomed to pole location (ID: " + objectId + ")");
                                setTimeout(() => updateStatus("Analysis complete"), 3000);
                            });
                            return;
                        }
                    }
                    
                    if (vaultLayer) {
                        vaultLayer.queryFeatures({
                            where: "objectid = " + objectId,
                            outFields: ["objectid"],
                            returnGeometry: true
                        }).then(result2 => {
                            if (result2.features.length > 0) {
                                const feature2 = result2.features[0];
                                if (feature2.geometry) {
                                    mapView.goTo({target: feature2.geometry, scale: 2000}).then(() => {
                                        highlightFeature(feature2.geometry, [255, 0, 0, 255]);
                                        updateStatus("Zoomed to vault location (ID: " + objectId + ")");
                                        setTimeout(() => updateStatus("Analysis complete"), 3000);
                                    });
                                }
                            }
                        });
                    }
                }).catch(e => {
                    updateStatus("Error zooming to location: " + e.message);
                });
            }
        };
        
        window.zoomToSlackLoop = function(objectId, geometry) {
            updateStatus("Zooming to slack loop...");
            
            if (geometry) {
                mapView.goTo({target: geometry, scale: 2000}).then(() => {
                    highlightFeature(geometry, [255, 165, 0, 255]);
                    updateStatus("Zoomed to slack loop (ID: " + objectId + ")");
                    setTimeout(() => updateStatus("Analysis complete"), 3000);
                });
            } else {
                const slackLayer = mapView.map.allLayers
                    .filter(l => l && l.type === "feature")
                    .find(l => l && l.layerId === 41250);
                
                if (!slackLayer) {
                    alert("Slack loop layer not found");
                    return;
                }
                
                slackLayer.queryFeatures({
                    where: "objectid = " + objectId,
                    outFields: ["objectid"],
                    returnGeometry: true
                }).then(result => {
                    if (result.features.length > 0) {
                        const feature = result.features[0];
                        if (feature.geometry) {
                            mapView.goTo({target: feature.geometry, scale: 2000}).then(() => {
                                highlightFeature(feature.geometry, [255, 165, 0, 255]);
                                updateStatus("Zoomed to slack loop (ID: " + objectId + ")");
                                setTimeout(() => updateStatus("Analysis complete"), 3000);
                            });
                        }
                    }
                }).catch(e => {
                    updateStatus("Error zooming: " + e.message);
                });
            }
        };
        
        // Load work orders
        function loadWorkOrders() {
            updateStatus("Loading work orders...");
            
            const allLayers = mapView.map.allLayers.filter(l => l && l.type === "feature");
            const fiberLayer = allLayers.find(l => l && l.layerId === 41050);
            
            if (!fiberLayer) {
                $("#workorderSelect").innerHTML = '<option>No fiber cable layer found (layerId 41050)</option>';
                updateStatus("Error: No fiber cable layer found with layerId 41050");
                return;
            }
            
            fiberLayer.load().then(() => {
                return fiberLayer.queryFeatures({
                    where: "workorder_id IS NOT NULL AND workorder_id <> ''",
                    outFields: ["workorder_id"],
                    returnGeometry: false,
                    returnDistinctValues: true
                });
            }).then(uniqueQuery => {
                const uniqueValues = [];
                const seen = {};
                
                for (const feature of uniqueQuery.features) {
                    const value = feature.attributes.workorder_id;
                    if (value && value.toString().trim() && !seen[value]) {
                        uniqueValues.push(value);
                        seen[value] = true;
                    }
                }
                
                uniqueValues.sort();
                
                const select = $("#workorderSelect");
                select.innerHTML = '<option value="">Select Work Order...</option>';
                
                for (const value of uniqueValues) {
                    const option = document.createElement("option");
                    option.value = value;
                    option.textContent = value;
                    select.appendChild(option);
                }
                
                updateStatus("Ready - " + uniqueValues.length + " work orders loaded");
            }).catch(e => {
                updateStatus("Error loading work orders: " + (e.message || e));
            });
        }
        
        // Configure slack loop labeling
        function configureSlackLoopLabeling(slackLayer, workOrderId) {
            if (originalLabelingInfo === null) {
                originalLabelingInfo = slackLayer.labelingInfo ? [...slackLayer.labelingInfo] : null;
            }
            
            const labelClassIn = {
                symbol: {
                    type: "text",
                    color: [0, 100, 0, 255],
                    haloColor: [255, 255, 255, 255],
                    haloSize: 2,
                    font: {
                        family: "Arial",
                        size: 9,
                        weight: "bold"
                    }
                },
                labelPlacement: "above-left",
                labelExpression: "'In:' + [sequential_in]",
                where: `workorder_id = '${workOrderId}' AND sequential_in IS NOT NULL`
            };
            
            const labelClassOut = {
                symbol: {
                    type: "text",
                    color: [0, 0, 200, 255],
                    haloColor: [255, 255, 255, 255],
                    haloSize: 2,
                    font: {
                        family: "Arial",
                        size: 9,
                        weight: "bold"
                    }
                },
                labelPlacement: "above-right",
                labelExpression: "'Out:' + [sequential_out]",
                where: `workorder_id = '${workOrderId}' AND sequential_out IS NOT NULL`
            };
            
            slackLayer.labelingInfo = [labelClassIn, labelClassOut];
            slackLayer.labelsVisible = true;
        }
        
        // Run analysis
        async function runAnalysis() {
            const workOrderSelect = $("#workorderSelect");
            const selectedWorkOrder = workOrderSelect.value;
            
            if (!selectedWorkOrder) {
                alert("Please select a work order");
                return;
            }
            
            const toleranceInput = $("#fiberTolerance");
            const slackToleranceInput = $("#slackTolerance");
            const debugMode = $("#debugMode").checked;
            const fiberTolerance = parseFloat(toleranceInput.value) || 10;
            const slackTolerance = parseFloat(slackToleranceInput.value) || 5;
            
            window.fiberDebug = debugMode;
            
            updateStatus(`Running slack loop analysis for ${selectedWorkOrder} (Fiber: ${fiberTolerance}m, Slack: ${slackTolerance}m${debugMode ? ", Debug ON" : ""})...`);
            updateResults("");
            analysisData = [];
            $("#exportBtn").style.display = "none";
            
            const allLayers = mapView.map.allLayers.filter(l => l && l.type === "feature");
            const poleLayer = allLayers.find(l => l && l.layerId === 43150);
            const vaultLayer = allLayers.find(l => l && l.layerId === 42100);
            const fiberLayer = allLayers.find(l => l && l.layerId === 41050);
            const slackLayer = allLayers.find(l => l && l.layerId === 41250);
            
            if (!fiberLayer) {
                updateStatus("Error: Fiber Cable layer not found (layerId 41050)");
                return;
            }
            
            if (!slackLayer) {
                updateStatus("Error: Slack Loop layer not found (layerId 41250)");
                return;
            }
            
            updateStatus(`Loading layers - Poles: ${poleLayer ? "Found" : "Not Found"}, Vaults: ${vaultLayer ? "Found" : "Not Found"}, Fibers: Found, Slack Loops: Found`);
            
            const workOrderFilter = `workorder_id = '${selectedWorkOrder}'`;
            const promises = [];
            
            if (poleLayer) {
                promises.push(poleLayer.queryFeatures({
                    where: workOrderFilter,
                    outFields: ["objectid", "gis_id", "globalid", "workflow_status"],
                    returnGeometry: true
                }));
            } else {
                promises.push(Promise.resolve({features: []}));
            }
            
            if (vaultLayer) {
                promises.push(vaultLayer.queryFeatures({
                    where: workOrderFilter,
                    outFields: ["objectid", "gis_id", "globalid", "workflow_status"],
                    returnGeometry: true
                }));
            } else {
                promises.push(Promise.resolve({features: []}));
            }
            
            promises.push(fiberLayer.queryFeatures({
                where: workOrderFilter,
                outFields: ["objectid", "gis_id", "globalid", "workflow_status"],
                returnGeometry: true
            }));
            
            promises.push(slackLayer.queryFeatures({
                where: workOrderFilter + " AND (workflow_stage IS NULL OR workflow_stage <> 'OSP_CONST')",
                outFields: ["objectid", "gis_id", "globalid", "sequential_in", "sequential_out"],
                returnGeometry: true
            }));
            
            try {
                const results = await Promise.all(promises);
                const allPoles = results[0].features;
                const allVaults = results[1].features;
                const allFibers = results[2].features;
                const slacks = results[3].features;
                
                // Filter out poles with workflow_status = 'NA'
                const poles = allPoles.filter(p => p.attributes.workflow_status !== 'NA');
                const excludedPoles = allPoles.length - poles.length;
                
                // Filter out vaults with workflow_status = 'NA'
                const vaults = allVaults.filter(v => v.attributes.workflow_status !== 'NA');
                const excludedVaults = allVaults.length - vaults.length;
                
                // Filter out fibers with workflow_status = 'NA'
                const fibers = allFibers.filter(f => f.attributes.workflow_status !== 'NA');
                const excludedFibers = allFibers.length - fibers.length;
                
                const excludedLocations = excludedPoles + excludedVaults;
                
                let statusMessage = `Found: ${poles.length} poles`;
                if (excludedPoles > 0) statusMessage += ` (${excludedPoles} excluded)`;
                statusMessage += `, ${vaults.length} vaults`;
                if (excludedVaults > 0) statusMessage += ` (${excludedVaults} excluded)`;
                statusMessage += `, ${fibers.length} fibers`;
                if (excludedFibers > 0) statusMessage += ` (${excludedFibers} excluded)`;
                statusMessage += `, ${slacks.length} slack loops`;
                
                updateStatus(statusMessage);
                
                if (debugMode) {
                    console.log("Analysis starting with filtered data:");
                    console.log("  Poles:", poles.length, "Excluded:", excludedPoles);
                    console.log("  Vaults:", vaults.length, "Excluded:", excludedVaults);
                    console.log("  Fibers:", fibers.length, "Excluded:", excludedFibers);
                    console.log("  Total locations excluded with status=NA:", excludedLocations);
                }
                
                const allLocations = poles.concat(vaults);
                
                if (allLocations.length === 0) {
                    updateResults('<p style="color:red;font-size:10px;">No active poles or vaults found for this work order (all may have status=NA).</p>');
                    updateStatus("Analysis complete - no active locations found");
                    return;
                }
                
                const problems = [];
                const missingSlackLoops = [];
                
                // Analyze each location
                for (const location of allLocations) {
                    const locationType = poles.includes(location) ? "Pole" : "Vault";
                    const locationId = location.attributes.gis_id || "Unknown";
                    const locationCenter = location.geometry.x && location.geometry.y ? 
                        {x: location.geometry.x, y: location.geometry.y} :
                        (location.geometry.extent && location.geometry.extent.center ?
                            location.geometry.extent.center : null);
                    
                    if (!locationCenter) continue;
                    
                    if (debugMode) {
                        console.log("Analyzing location:", locationType, locationId, "at coordinates:", locationCenter);
                    }
                    
                    const nearbyFibersData = getFiberCountNearLocation(location, fibers, fiberTolerance);
                    const nearbyFibers = nearbyFibersData.length;
                    
                    if (debugMode) {
                        console.log("  -> Found", nearbyFibers, "nearby fibers");
                    }
                    
                    // Find slack loops at this location
                    const locationSlacks = [];
                    for (const slack of slacks) {
                        if (!slack.geometry) continue;
                        
                        const slackCenter = slack.geometry.x && slack.geometry.y ?
                            {x: slack.geometry.x, y: slack.geometry.y} :
                            (slack.geometry.extent && slack.geometry.extent.center ?
                                slack.geometry.extent.center : null);
                        
                        if (!slackCenter) continue;
                        
                        const distance = calculateDistance(locationCenter, slackCenter);
                        if (distance <= slackTolerance) {
                            locationSlacks.push({
                                slack: slack,
                                distance: distance
                            });
                        }
                    }
                    
                    if (debugMode) {
                        console.log("  -> Found", locationSlacks.length, "slack loops at this location");
                        if (locationSlacks.length > 0) {
                            console.log("     Slack loop distances:", locationSlacks.map(s => s.distance.toFixed(2) + 'm'));
                        }
                    }
                    
                    // Check for missing slack loops (only if fibers are present)
                    if (nearbyFibers > 0 && locationSlacks.length === 0) {
                        // Get the minimum fiber distance for better reporting
                        const minFiberDistance = Math.min(...nearbyFibersData.map(f => f.distance));
                        
                        missingSlackLoops.push({
                            locationType: locationType,
                            locationId: locationId,
                            locationOid: location.attributes.objectid,
                            fiberCount: nearbyFibers,
                            distance: minFiberDistance,
                            locationGeometry: location.geometry,
                            issueType: "Missing Slack Loop",
                            description: `Location has ${nearbyFibers} fiber cable(s) within ${fiberTolerance}m but no slack loop within ${slackTolerance}m`
                        });
                        
                        if (debugMode) {
                            console.log("  *** MISSING SLACK LOOP DETECTED ***");
                            console.log("     Closest fiber:", minFiberDistance.toFixed(2) + 'm');
                        }
                    }
                    
                    // Check for invalid slack loops (missing sequential data)
                    const invalidSlacks = [];
                    for (const slackData of locationSlacks) {
                        const slack = slackData.slack;
                        const seqIn = slack.attributes.sequential_in;
                        const seqOut = slack.attributes.sequential_out;
                        
                        if ((!seqIn || seqIn === "") && (!seqOut || seqOut === "")) {
                            invalidSlacks.push({
                                slack: slack,
                                distance: slackData.distance
                            });
                        }
                    }
                    
                    if (invalidSlacks.length > 0) {
                        for (const invalidSlackData of invalidSlacks) {
                            const invalidSlack = invalidSlackData.slack;
                            problems.push({
                                locationType: locationType,
                                locationId: locationId,
                                locationOid: location.attributes.objectid,
                                fiberCount: nearbyFibers,
                                slackLoop: invalidSlack,
                                slackLoopId: invalidSlack.attributes.gis_id || "Unknown",
                                slackLoopOid: invalidSlack.attributes.objectid,
                                slackLoopGeometry: invalidSlack.geometry,
                                distance: invalidSlackData.distance,
                                issueType: "Invalid Sequential Data",
                                description: `Slack loop exists but sequential_in and sequential_out are both empty (${invalidSlackData.distance.toFixed(2)}m from location)`
                            });
                        }
                    }
                }
                
                const totalIssues = problems.length + missingSlackLoops.length;
                let formattedResults = '<h4 style="margin:8px 0 4px 0;font-size:11px;">Analysis Summary:</h4>';
                
                // Show location counts with exclusions
                let locationSummary = `<p style="font-size:10px;margin:2px 0;">Locations: ${allLocations.length} (${poles.length} poles`;
                if (excludedPoles > 0) locationSummary += `, ${excludedPoles} excluded`;
                locationSummary += `; ${vaults.length} vaults`;
                if (excludedVaults > 0) locationSummary += `, ${excludedVaults} excluded`;
                locationSummary += `)</p>`;
                formattedResults += locationSummary;
                
                formattedResults += `<p style="font-size:10px;margin:2px 0;">Fiber Cables: ${fibers.length}${excludedFibers > 0 ? ` (${excludedFibers} excluded with status=NA)` : ''}</p>`;
                formattedResults += `<p style="font-size:10px;margin:2px 0;">Slack Loops: ${slacks.length}</p>`;
                formattedResults += `<p style="font-size:10px;margin:2px 0;">Tolerances: Fiber ${fiberTolerance}m, Slack Loop ${slackTolerance}m</p>`;
                
                if (debugMode) {
                    formattedResults += '<p style="font-size:10px;margin:2px 0;color:orange;">Debug Mode: Check browser console for details</p>';
                }
                
                formattedResults += `<p style="font-size:10px;margin:2px 0;">Total Issues: ${totalIssues}</p>`;
                
                const allIssues = [];
                
                // Missing slack loops table
                if (missingSlackLoops.length > 0) {
                    formattedResults += `<h4 style="margin:8px 0 4px 0;font-size:11px;">Missing Slack Loops (${missingSlackLoops.length}):</h4>`;
                    formattedResults += '<div style="overflow-x:auto;"><table border="1" style="border-collapse:collapse;width:100%;font-size:9px;margin-bottom:8px;">';
                    formattedResults += '<tr><th style="padding:1px 2px;">Location Type</th><th style="padding:1px 2px;">Location ID</th><th style="padding:1px 2px;">Fiber Count</th><th style="padding:1px 2px;">Min Distance</th><th style="padding:1px 2px;">Issue</th><th style="padding:1px 2px;">Action</th></tr>';
                    
                    for (const missing of missingSlackLoops) {
                        allIssues.push(missing);
                        formattedResults += '<tr>';
                        formattedResults += `<td style="padding:1px 2px;">${missing.locationType}</td>`;
                        formattedResults += `<td style="padding:1px 2px;">${missing.locationId}</td>`;
                        formattedResults += `<td style="padding:1px 2px;">${missing.fiberCount}</td>`;
                        formattedResults += `<td style="padding:1px 2px;">${missing.distance.toFixed(2)}m</td>`;
                        formattedResults += '<td style="padding:1px 2px;color:red;">Missing Slack Loop</td>';
                        formattedResults += '<td style="padding:1px 2px;">';
                        formattedResults += `<button onclick="zoomToLocation(${missing.locationOid})" style="padding:1px 3px;margin:0px;font-size:8px;background:#ff4444;color:white;border:none;cursor:pointer;">Zoom</button>`;
                        formattedResults += '</td>';
                        formattedResults += '</tr>';
                    }
                    
                    formattedResults += '</table></div>';
                }
                
                // Invalid slack loops table
                if (problems.length > 0) {
                    formattedResults += `<h4 style="margin:8px 0 4px 0;font-size:11px;">Slack Loops Missing Sequential Data (${problems.length}):</h4>`;
                    formattedResults += '<div style="overflow-x:auto;"><table border="1" style="border-collapse:collapse;width:100%;font-size:9px;margin-bottom:8px;">';
                    formattedResults += '<tr><th style="padding:1px 2px;">Location Type</th><th style="padding:1px 2px;">Location ID</th><th style="padding:1px 2px;">Slack Loop ID</th><th style="padding:1px 2px;">Fiber Count</th><th style="padding:1px 2px;">Distance</th><th style="padding:1px 2px;">Action</th></tr>';
                    
                    for (const problem of problems) {
                        allIssues.push(problem);
                        formattedResults += '<tr>';
                        formattedResults += `<td style="padding:1px 2px;">${problem.locationType}</td>`;
                        formattedResults += `<td style="padding:1px 2px;">${problem.locationId}</td>`;
                        formattedResults += `<td style="padding:1px 2px;">${problem.slackLoopId}</td>`;
                        formattedResults += `<td style="padding:1px 2px;">${problem.fiberCount}</td>`;
                        formattedResults += `<td style="padding:1px 2px;">${problem.distance.toFixed(2)}m</td>`;
                        formattedResults += '<td style="padding:1px 2px;">';
                        formattedResults += `<button onclick="zoomToSlackLoop(${problem.slackLoopOid})" style="padding:1px 3px;margin:0px;font-size:8px;background:#ff4444;color:white;border:none;cursor:pointer;">Zoom</button>`;
                        formattedResults += '</td>';
                        formattedResults += '</tr>';
                    }
                    
                    formattedResults += '</table></div>';
                }
                
                // Configure labeling
                configureSlackLoopLabeling(slackLayer, selectedWorkOrder);
                
                if (totalIssues === 0) {
                    formattedResults += '<p style="color:green;font-size:10px;margin:8px 0;">✓ No issues found! All active locations with fibers have properly configured slack loops.</p>';
                }
                
                if (totalIssues > 0) {
                    analysisData = allIssues;
                    $("#exportBtn").style.display = "inline";
                }
                
                updateResults(formattedResults);
                updateStatus(`Analysis complete - ${totalIssues} total issues found (${missingSlackLoops.length} missing, ${problems.length} invalid). Labels now visible.`);
                
            } catch (e) {
                updateStatus("Error: " + (e.message || e));
            }
        }
        
        // Tool cleanup function
        function cleanup() {
            // Reset filters and layers
            const layers = mapView.map.allLayers.filter(l => l && l.type === "feature");
            
            for (const layer of layers) {
                if (layer && typeof layer.layerId !== 'undefined') {
                    layer.definitionExpression = null;
                    
                    if (layer.layerId === 41250) {
                        layer.labelingInfo = originalLabelingInfo;
                        layer.labelsVisible = false;
                    }
                }
            }
            
            if (highlightGraphic) {
                mapView.graphics.remove(highlightGraphic);
                highlightGraphic = null;
            }
            
            // Clean up global functions
            if (window.zoomToLocation) {
                delete window.zoomToLocation;
            }
            if (window.zoomToSlackLoop) {
                delete window.zoomToSlackLoop;
            }
            if (window.fiberDebug) {
                delete window.fiberDebug;
            }
            
            toolBox.remove();
            console.log('Slack Loop Analysis Tool cleaned up');
        }
        
        // Event listeners
        $("#runBtn").addEventListener("click", runAnalysis);
        $("#resetBtn").addEventListener("click", resetFilters);
        $("#exportBtn").addEventListener("click", exportCSV);
        $("#closeTool").onclick = () => {
            window.gisToolHost.closeTool('slack-loop-analysis');
        };
        
        // Initialize
        loadWorkOrders();
        
        // Register tool with host
        window.gisToolHost.activeTools.set('slack-loop-analysis', {
            cleanup: cleanup,
            toolBox: toolBox
        });
        
        console.log('Slack Loop Analysis Tool loaded successfully');
        
    } catch (error) {
        console.error('Error loading Slack Loop Analysis Tool:', error);
        alert("Error creating Slack Loop Analysis Tool: " + (error.message || error));
    }
})();
