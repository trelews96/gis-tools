// tools/parent-child-reconciliation.js - Converted from bookmarklet format
// Parent/Child Code Reconciliation Tool for analyzing quantity mismatches

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
        if (window.gisToolHost.activeTools.has('parent-child-reconciliation')) {
            console.log('Parent/Child Reconciliation Tool already active');
            return;
        }
        
        const existingToolbox = document.getElementById('parentChildReconciliationToolbox');
        if (existingToolbox) {
            existingToolbox.remove();
            console.log('Removed leftover parent-child reconciliation toolbox');
        }
        
        const utils = window.gisSharedUtils;
        if (!utils) {
            throw new Error('Shared utilities not loaded');
        }
        
        const mapView = utils.getMapView();
        let exportData = [];
        
        const toolBox = document.createElement("div");
        toolBox.id = "parentChildReconciliationToolbox";
        toolBox.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 99999;
            background: #fff;
            border: 1px solid #333;
            padding: 8px;
            max-width: 380px;
            max-height: 85vh;
            overflow-y: auto;
            font: 11px/1.2 Arial;
            box-shadow: 0 4px 16px rgba(0,0,0,.2);
            border-radius: 4px;
        `;
        
        toolBox.innerHTML = `
            <div style="font-weight:bold;margin-bottom:6px;font-size:12px;">Daily Tracking Analysis</div>
            
            <label style="font-size:11px;">Work Order ID:</label><br>
            <select id="workorderSelect" style="width:100%;margin:2px 0 6px 0;padding:3px;font-size:11px;">
                <option>Loading work orders...</option>
            </select><br>
            
            <button id="runBtn" style="padding:4px 8px;margin-right:4px;font-size:10px;">Run Analysis</button>
            <button id="resetBtn" style="padding:4px 8px;margin-right:4px;font-size:10px;">Reset</button>
            <button id="exportBtn" style="padding:4px 8px;margin-right:4px;font-size:10px;display:none;">Export CSV</button>
            <button id="closeTool" style="padding:4px 8px;font-size:10px;">Close</button><br>
            
            <div id="toolStatus" style="margin-top:6px;color:#3367d6;font-size:10px;"></div>
            <div id="results" style="margin-top:6px;font-size:10px;"></div>
        `;
        
        document.body.appendChild(toolBox);
        
        const $ = (id) => toolBox.querySelector(id);
        const status = $("#toolStatus");
        const results = $("#results");
        
        function updateStatus(text) {
            status.textContent = text;
        }
        
        function updateResults(html) {
            results.innerHTML = html;
        }
        
        function resetFilters() {
            const allLayers = mapView.map.allLayers.filter(layer => layer.type === "feature");
            
            for (const layer of allLayers) {
                layer.definitionExpression = null;
                layer.labelingInfo = null;
                layer.labelsVisible = false;
            }
            
            updateStatus("Filters reset");
            updateResults("");
            exportData = [];
            $("#exportBtn").style.display = "none";
        }
        
        function generateURL(type, objectId, geometry) {
            try {
                const baseURL = window.location.origin + window.location.pathname;
                const params = new URLSearchParams(window.location.search);
                let center = mapView.center;
                let scale = mapView.scale;
                
                if (geometry && geometry.extent && geometry.extent.center) {
                    center = geometry.extent.center;
                    scale = 2000;
                }
                
                params.set('center', center.longitude.toFixed(6) + ',' + center.latitude.toFixed(6));
                params.set('level', Math.round(Math.log2(591657527.591555 / scale)).toString());
                
                let layerId;
                if (type === "underground") layerId = 42050;
                else if (type === "aerial") layerId = 43050;
                else if (type === "fiber") layerId = 41050;
                
                if (layerId) {
                    params.set('highlight', layerId + ':' + objectId);
                }
                
                return baseURL + '?' + params.toString();
            } catch (error) {
                return window.location.href;
            }
        }
        
        function escapeCSV(field) {
            if (field === null || field === undefined) return "";
            field = String(field);
            
            if (field.indexOf(',') >= 0 || field.indexOf('"') >= 0 || field.indexOf('\n') >= 0) {
                field = '"' + field.replace(/"/g, '""') + '"';
            }
            return field;
        }
        
        function exportToCSV() {
            if (exportData.length === 0) {
                alert("No data to export. Please run analysis first.");
                return;
            }
            
            let csv = "data:text/csv;charset=utf-8,";
            csv += "Comparison Type,Span ID,Fiber ID,Span Qty,Fiber Qty,Difference,Span Map URL,Fiber Map URL\n";
            
            for (const row of exportData) {
                const spanType = row.type.includes("Underground") ? "underground" : "aerial";
                const spanURL = generateURL(spanType, row.spanOid, row.spanGeometry);
                const fiberURL = generateURL("fiber", row.fiberOid, row.fiberGeometry);
                
                csv += escapeCSV(row.type) + "," +
                       escapeCSV(row.spanId) + "," +
                       escapeCSV(row.fiberId) + "," +
                       row.spanQty + "," +
                       row.fiberQty + "," +
                       row.difference + "," +
                       escapeCSV(spanURL) + "," +
                       escapeCSV(fiberURL) + "\n";
            }
            
            const encodedURI = encodeURI(csv);
            const link = document.createElement("a");
            link.setAttribute("href", encodedURI);
            link.setAttribute("download", "quantity_mismatches_" + new Date().toISOString().slice(0, 10) + ".csv");
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
        
        window.zoomToFeature = function(layerType, objectId) {
            const allLayers = mapView.map.allLayers.filter(layer => layer.type === "feature");
            let targetLayer = null;
            
            if (layerType === "underground") {
                targetLayer = allLayers.find(layer => layer.layerId === 42050);
            } else if (layerType === "aerial") {
                targetLayer = allLayers.find(layer => layer.layerId === 43050);
            } else if (layerType === "fiber") {
                targetLayer = allLayers.find(layer => layer.layerId === 41050);
            }
            
            if (!targetLayer) {
                alert("Layer not found for zoom");
                return;
            }
            
            updateStatus("Zooming to " + layerType + " feature...");
            
            targetLayer.queryFeatures({
                where: "objectid = " + objectId,
                outFields: ["objectid"],
                returnGeometry: true
            }).then(result => {
                if (result.features.length > 0) {
                    const feature = result.features[0];
                    if (feature.geometry) {
                        mapView.goTo({
                            target: feature.geometry,
                            scale: 2000
                        }).then(() => {
                            updateStatus("Zoomed to " + layerType + " feature (ID: " + objectId + ")");
                            setTimeout(() => updateStatus("Analysis complete"), 3000);
                        });
                    }
                }
            }).catch(error => {
                updateStatus("Error zooming: " + error.message);
            });
        };
        
        function loadWorkOrders() {
            updateStatus("Loading work orders...");
            
            const allLayers = mapView.map.allLayers.filter(layer => layer.type === "feature");
            const fiberLayer = allLayers.find(layer => layer.layerId === 41050);
            
            if (!fiberLayer) {
                $("#workorderSelect").innerHTML = '<option>No fiber layer found (layerId 41050)</option>';
                updateStatus("Error: No fiber layer found with layerId 41050");
                return;
            }
            
            fiberLayer.load().then(() => {
                return fiberLayer.queryFeatures({
                    where: "workorder_id IS NOT NULL AND workorder_id <> ''",
                    outFields: ["workorder_id"],
                    returnGeometry: false,
                    returnDistinctValues: true
                });
            }).then(uniqueResult => {
                const uniqueValues = [];
                const seenValues = {};
                
                for (const feature of uniqueResult.features) {
                    const value = feature.attributes.workorder_id;
                    if (value && value.toString().trim() && !seenValues[value]) {
                        uniqueValues.push(value);
                        seenValues[value] = true;
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
            }).catch(error => {
                updateStatus("Error loading work orders: " + (error.message || error));
            });
        }
        
        function findTrackingTable() {
            let table = null;
            
            if (mapView.map.allTables) {
                table = mapView.map.allTables.find(t => t.layerId === 90100);
            }
            
            if (!table) {
                const allItems = mapView.map.allLayers || [];
                table = allItems.find(item => item.type === "table" && item.layerId === 90100);
            }
            
            return table;
        }
        
        function findCoincidentFeatures(spanFeatures, fiberFeatures) {
            const coincidentPairs = [];
            const tolerance = 0.1;
            
            for (const spanFeature of spanFeatures) {
                if (!spanFeature || !spanFeature.geometry || !spanFeature.geometry.extent) continue;
                
                const spanCenter = spanFeature.geometry.extent.center;
                if (!spanCenter) continue;
                
                for (const fiberFeature of fiberFeatures) {
                    if (!fiberFeature || !fiberFeature.geometry || !fiberFeature.geometry.extent) continue;
                    
                    const fiberCenter = fiberFeature.geometry.extent.center;
                    if (!fiberCenter) continue;
                    
                    const distance = Math.sqrt(
                        Math.pow(spanCenter.x - fiberCenter.x, 2) + 
                        Math.pow(spanCenter.y - fiberCenter.y, 2)
                    );
                    
                    if (distance <= tolerance) {
                        coincidentPairs.push({
                            span: spanFeature,
                            fiber: fiberFeature,
                            distance: distance
                        });
                    }
                }
            }
            
            return coincidentPairs;
        }
        
        function zoomToLayers(layers) {
            return Promise.all(layers.map(layer => layer.queryExtent())).then(extents => {
                const combinedBounds = extents.reduce((accumulator, current) => {
                    return accumulator ? accumulator.union(current.extent) : current.extent;
                }, null);
                
                if (!combinedBounds) return;
                
                const expandedBounds = combinedBounds.expand(1.5);
                const width = expandedBounds.xmax - expandedBounds.xmin;
                const height = expandedBounds.ymax - expandedBounds.ymin;
                
                const target = (width < 100 || height < 100) ? 
                    { target: expandedBounds, scale: 5000 } : 
                    expandedBounds;
                
                return mapView.goTo(target);
            }).catch(error => {
                console.error('Error zooming to layers:', error);
            });
        }
        
        async function runAnalysis() {
            const selectedWorkOrder = $("#workorderSelect").value;
            
            if (!selectedWorkOrder) {
                alert("Please select a work order");
                return;
            }
            
            updateStatus("Running analysis for " + selectedWorkOrder + "...");
            updateResults("");
            exportData = [];
            $("#exportBtn").style.display = "none";
            
            const trackingTable = findTrackingTable();
            if (!trackingTable) {
                updateStatus("Error: Daily Tracking table not found (layerId 90100)");
                return;
            }
            
            try {
                await trackingTable.load();
                
                let workOrderField = null;
                if (trackingTable.fields && trackingTable.fields.length > 0) {
                    for (const field of trackingTable.fields) {
                        if (field && field.name && field.name.toLowerCase().indexOf("workorder") >= 0) {
                            workOrderField = field;
                            break;
                        }
                    }
                }
                
                if (!workOrderField) {
                    throw new Error("No workorder field found in tracking table");
                }
                
                const trackingResult = await trackingTable.queryFeatures({
                    where: workOrderField.name + " = '" + selectedWorkOrder + "'",
                    outFields: ["*"]
                });
                
                if (trackingResult.features.length === 0) {
                    throw new Error("No tracking records found for work order " + selectedWorkOrder);
                }
                
                const laborSummary = {};
                const guidToQuantity = {};
                
                for (const feature of trackingResult.features) {
                    const attributes = feature.attributes;
                    const laborCode = attributes.labor_code || "Unknown";
                    const quantity = attributes.quantity || 0;
                    
                    laborSummary[laborCode] = (laborSummary[laborCode] || 0) + quantity;
                    
                    for (const fieldName in attributes) {
                        if (fieldName.indexOf("_guid") >= 0 && attributes[fieldName]) {
                            guidToQuantity[attributes[fieldName]] = quantity;
                        }
                    }
                }
                
                let summaryHTML = '<h4 style="margin:8px 0 4px 0;font-size:11px;">Labor Code Summary:</h4>';
                summaryHTML += '<div style="overflow-x:auto;"><table border="1" style="border-collapse:collapse;width:100%;font-size:10px;">';
                summaryHTML += '<tr><th style="padding:2px 4px;">Labor Code</th><th style="padding:2px 4px;">Total Quantity</th></tr>';
                
                for (const laborCode in laborSummary) {
                    summaryHTML += '<tr><td style="padding:2px 4px;">' + laborCode + '</td>';
                    summaryHTML += '<td style="padding:2px 4px;">' + laborSummary[laborCode] + '</td></tr>';
                }
                summaryHTML += '</table></div>';
                
                updateResults(summaryHTML);
                
                const allLayers = mapView.map.allLayers.filter(layer => layer.type === "feature");
                const undergroundLayer = allLayers.find(layer => layer.layerId === 42050);
                const aerialLayer = allLayers.find(layer => layer.layerId === 43050);
                const fiberLayer = allLayers.find(layer => layer.layerId === 41050);
                
                if (!fiberLayer) {
                    updateStatus("Error: Fiber Cable layer required");
                    return;
                }
                
                const guids = Object.keys(guidToQuantity);
                if (guids.length === 0) {
                    updateStatus("No related features found");
                    return;
                }
                
                const guidList = "'" + guids.join("','") + "'";
                const promises = [];
                
                if (undergroundLayer) {
                    promises.push(undergroundLayer.queryFeatures({
                        where: "globalid IN (" + guidList + ")",
                        outFields: ["objectid", "globalid", "gis_id"],
                        returnGeometry: true
                    }));
                } else {
                    promises.push(Promise.resolve({ features: [] }));
                }
                
                if (aerialLayer) {
                    promises.push(aerialLayer.queryFeatures({
                        where: "globalid IN (" + guidList + ")",
                        outFields: ["objectid", "globalid", "gis_id"],
                        returnGeometry: true
                    }));
                } else {
                    promises.push(Promise.resolve({ features: [] }));
                }
                
                promises.push(fiberLayer.queryFeatures({
                    where: "globalid IN (" + guidList + ")",
                    outFields: ["objectid", "globalid", "gis_id"],
                    returnGeometry: true
                }));
                
                const results = await Promise.all(promises);
                const undergroundFeatures = results[0].features;
                const aerialFeatures = results[1].features;
                const fiberFeatures = results[2].features;
                
                const undergroundCoincident = findCoincidentFeatures(undergroundFeatures, fiberFeatures);
                const aerialCoincident = findCoincidentFeatures(aerialFeatures, fiberFeatures);
                
                function processCoincidences(coincidences, guidToQuantity) {
                    const mismatches = [];
                    
                    for (const coincidence of coincidences) {
                        if (!coincidence || !coincidence.span || !coincidence.fiber) continue;
                        if (!coincidence.span.attributes || !coincidence.fiber.attributes) continue;
                        
                        const spanGisId = coincidence.span.attributes.gis_id || "Unknown";
                        const fiberGisId = coincidence.fiber.attributes.gis_id || "Unknown";
                        const spanGlobalId = coincidence.span.attributes.globalid;
                        const fiberGlobalId = coincidence.fiber.attributes.globalid;
                        
                        const spanQty = guidToQuantity[spanGlobalId] || 0;
                        const fiberQty = guidToQuantity[fiberGlobalId] || 0;
                        
                        if (spanQty !== fiberQty) {
                            mismatches.push({
                                spanGisId: spanGisId,
                                fiberGisId: fiberGisId,
                                spanQty: spanQty,
                                fiberQty: fiberQty,
                                difference: spanQty - fiberQty,
                                spanOid: coincidence.span.attributes.objectid,
                                fiberOid: coincidence.fiber.attributes.objectid
                            });
                        }
                    }
                    
                    return mismatches;
                }
                
                const undergroundMismatches = processCoincidences(undergroundCoincident, guidToQuantity);
                const aerialMismatches = processCoincidences(aerialCoincident, guidToQuantity);
                
                let finalHTML = results.innerHTML;
                
                if (undergroundMismatches.length > 0) {
                    finalHTML += '<h4 style="margin:8px 0 4px 0;font-size:11px;">';
                    finalHTML += 'Underground vs Fiber Mismatches (' + undergroundMismatches.length + '):</h4>';
                    finalHTML += '<div style="overflow-x:auto;"><table border="1" style="border-collapse:collapse;width:100%;font-size:9px;margin-bottom:8px;">';
                    finalHTML += '<tr><th style="padding:1px 2px;">UG ID</th><th style="padding:1px 2px;">Fiber ID</th>';
                    finalHTML += '<th style="padding:1px 2px;">UG Qty</th><th style="padding:1px 2px;">Fiber Qty</th>';
                    finalHTML += '<th style="padding:1px 2px;">Diff</th><th style="padding:1px 2px;">Actions</th></tr>';
                    
                    for (const mismatch of undergroundMismatches) {
                        exportData.push({
                            type: "Underground vs Fiber",
                            spanId: mismatch.spanGisId,
                            fiberId: mismatch.fiberGisId,
                            spanQty: mismatch.spanQty,
                            fiberQty: mismatch.fiberQty,
                            difference: mismatch.difference,
                            spanOid: mismatch.spanOid,
                            fiberOid: mismatch.fiberOid,
                            spanGeometry: undergroundFeatures.find(f => f.attributes.objectid === mismatch.spanOid)?.geometry,
                            fiberGeometry: fiberFeatures.find(f => f.attributes.objectid === mismatch.fiberOid)?.geometry
                        });
                        
                        finalHTML += '<tr>';
                        finalHTML += '<td style="padding:1px 2px;">' + mismatch.spanGisId + '</td>';
                        finalHTML += '<td style="padding:1px 2px;">' + mismatch.fiberGisId + '</td>';
                        finalHTML += '<td style="padding:1px 2px;">' + mismatch.spanQty + '</td>';
                        finalHTML += '<td style="padding:1px 2px;">' + mismatch.fiberQty + '</td>';
                        finalHTML += '<td style="color:red;font-weight:bold;padding:1px 2px;">' + mismatch.difference + '</td>';
                        finalHTML += '<td style="padding:1px 2px;">';
                        finalHTML += '<button onclick="zoomToFeature(\'underground\', ' + mismatch.spanOid + ')" ';
                        finalHTML += 'style="padding:1px 3px;margin:0px;font-size:8px;background:#8844ff;color:white;border:none;cursor:pointer;">UG</button> ';
                        finalHTML += '<button onclick="zoomToFeature(\'fiber\', ' + mismatch.fiberOid + ')" ';
                        finalHTML += 'style="padding:1px 3px;margin:0px;font-size:8px;background:#ff8800;color:white;border:none;cursor:pointer;">Fiber</button>';
                        finalHTML += '</td>';
                        finalHTML += '</tr>';
                    }
                    finalHTML += '</table></div>';
                } else if (undergroundCoincident.length > 0) {
                    finalHTML += '<h4 style="margin:8px 0 4px 0;font-size:11px;">Underground vs Fiber:</h4>';
                    finalHTML += '<p style="color:green;font-size:10px;margin:2px 0;">All ' + undergroundCoincident.length + ' coincident underground/fiber features have matching quantities!</p>';
                }
                
                if (aerialMismatches.length > 0) {
                    finalHTML += '<h4 style="margin:8px 0 4px 0;font-size:11px;">';
                    finalHTML += 'Aerial vs Fiber Mismatches (' + aerialMismatches.length + '):</h4>';
                    finalHTML += '<div style="overflow-x:auto;"><table border="1" style="border-collapse:collapse;width:100%;font-size:9px;margin-bottom:8px;">';
                    finalHTML += '<tr><th style="padding:1px 2px;">Aerial ID</th><th style="padding:1px 2px;">Fiber ID</th>';
                    finalHTML += '<th style="padding:1px 2px;">Aerial Qty</th><th style="padding:1px 2px;">Fiber Qty</th>';
                    finalHTML += '<th style="padding:1px 2px;">Diff</th><th style="padding:1px 2px;">Actions</th></tr>';
                    
                    for (const mismatch of aerialMismatches) {
                        exportData.push({
                            type: "Aerial vs Fiber",
                            spanId: mismatch.spanGisId,
                            fiberId: mismatch.fiberGisId,
                            spanQty: mismatch.spanQty,
                            fiberQty: mismatch.fiberQty,
                            difference: mismatch.difference,
                            spanOid: mismatch.spanOid,
                            fiberOid: mismatch.fiberOid,
                            spanGeometry: aerialFeatures.find(f => f.attributes.objectid === mismatch.spanOid)?.geometry,
                            fiberGeometry: fiberFeatures.find(f => f.attributes.objectid === mismatch.fiberOid)?.geometry
                        });
                        
                        finalHTML += '<tr>';
                        finalHTML += '<td style="padding:1px 2px;">' + mismatch.spanGisId + '</td>';
                        finalHTML += '<td style="padding:1px 2px;">' + mismatch.fiberGisId + '</td>';
                        finalHTML += '<td style="padding:1px 2px;">' + mismatch.spanQty + '</td>';
                        finalHTML += '<td style="padding:1px 2px;">' + mismatch.fiberQty + '</td>';
                        finalHTML += '<td style="color:red;font-weight:bold;padding:1px 2px;">' + mismatch.difference + '</td>';
                        finalHTML += '<td style="padding:1px 2px;">';
                        finalHTML += '<button onclick="zoomToFeature(\'aerial\', ' + mismatch.spanOid + ')" ';
                        finalHTML += 'style="padding:1px 3px;margin:0px;font-size:8px;background:#8844ff;color:white;border:none;cursor:pointer;">Aerial</button> ';
                        finalHTML += '<button onclick="zoomToFeature(\'fiber\', ' + mismatch.fiberOid + ')" ';
                        finalHTML += 'style="padding:1px 3px;margin:0px;font-size:8px;background:#ff8800;color:white;border:none;cursor:pointer;">Fiber</button>';
                        finalHTML += '</td>';
                        finalHTML += '</tr>';
                    }
                    finalHTML += '</table></div>';
                } else if (aerialCoincident.length > 0) {
                    finalHTML += '<h4 style="margin:8px 0 4px 0;font-size:11px;">Aerial vs Fiber:</h4>';
                    finalHTML += '<p style="color:green;font-size:10px;margin:2px 0;">All ' + aerialCoincident.length + ' coincident aerial/fiber features have matching quantities!</p>';
                }
                
                if (undergroundCoincident.length === 0 && aerialCoincident.length === 0) {
                    finalHTML += '<p style="font-size:10px;margin:2px 0;">No coincident features found for comparison.</p>';
                }
                
                // Apply map filters and labels
                if (undergroundMismatches.length > 0 && undergroundLayer) {
                    const undergroundOids = undergroundMismatches.map(x => x.spanOid);
                    undergroundLayer.definitionExpression = "objectid IN (" + undergroundOids.join(",") + ")";
                    
                    const undergroundLabels = [];
                    for (const guid in guidToQuantity) {
                        undergroundLabels.push('"' + guid + '"');
                        undergroundLabels.push('"UG: ' + guidToQuantity[guid] + '"');
                    }
                    
                    const undergroundExpression = 'var id=$feature.globalid; Decode(id,' + undergroundLabels.join(',') + ',"UG: N/A")';
                    
                    undergroundLayer.labelingInfo = [{
                        labelExpressionInfo: { expression: undergroundExpression },
                        symbol: {
                            type: "text",
                            color: "red",
                            haloSize: 3,
                            haloColor: "white",
                            font: { size: 16, family: "Arial", weight: "bold" },
                            xoffset: -40,
                            yoffset: -30
                        },
                        deconflictionStrategy: "none",
                        repeatLabel: false,
                        removeDuplicates: "none"
                    }];
                    undergroundLayer.labelsVisible = true;
                }
                
                if (aerialMismatches.length > 0 && aerialLayer) {
                    const aerialOids = aerialMismatches.map(x => x.spanOid);
                    aerialLayer.definitionExpression = "objectid IN (" + aerialOids.join(",") + ")";
                    
                    const aerialLabels = [];
                    for (const guid in guidToQuantity) {
                        aerialLabels.push('"' + guid + '"');
                        aerialLabels.push('"Aerial: ' + guidToQuantity[guid] + '"');
                    }
                    
                    const aerialExpression = 'var id=$feature.globalid; Decode(id,' + aerialLabels.join(',') + ',"Aerial: N/A")';
                    
                    aerialLayer.labelingInfo = [{
                        labelExpressionInfo: { expression: aerialExpression },
                        symbol: {
                            type: "text",
                            color: "red",
                            haloSize: 3,
                            haloColor: "white",
                            font: { size: 16, family: "Arial", weight: "bold" },
                            xoffset: -40,
                            yoffset: -30
                        },
                        deconflictionStrategy: "none",
                        repeatLabel: false,
                        removeDuplicates: "none"
                    }];
                    aerialLayer.labelsVisible = true;
                }
                
                const allMismatchedFiberOids = undergroundMismatches.concat(aerialMismatches).map(x => x.fiberOid);
                
                if (allMismatchedFiberOids.length > 0) {
                    fiberLayer.definitionExpression = "objectid IN (" + allMismatchedFiberOids.join(",") + ")";
                    
                    const fiberLabels = [];
                    for (const guid in guidToQuantity) {
                        fiberLabels.push('"' + guid + '"');
                        fiberLabels.push('"Fiber: ' + guidToQuantity[guid] + '"');
                    }
                    
                    const fiberExpression = 'var id=$feature.globalid; Decode(id,' + fiberLabels.join(',') + ',"Fiber: N/A")';
                    
                    fiberLayer.labelingInfo = [{
                        labelExpressionInfo: { expression: fiberExpression },
                        symbol: {
                            type: "text",
                            color: "orange",
                            haloSize: 3,
                            haloColor: "white",
                            font: { size: 16, family: "Arial", weight: "bold" },
                            xoffset: 0,
                            yoffset: 20
                        },
                        deconflictionStrategy: "none",
                        repeatLabel: false,
                        removeDuplicates: "none"
                    }];
                    fiberLayer.labelsVisible = true;
                }
                
                updateResults(finalHTML);
                
                if (exportData.length > 0) {
                    $("#exportBtn").style.display = "inline-block";
                }
                
                // Zoom to filtered features
                const layersToZoom = [];
                if (undergroundMismatches.length > 0 && undergroundLayer) layersToZoom.push(undergroundLayer);
                if (aerialMismatches.length > 0 && aerialLayer) layersToZoom.push(aerialLayer);
                if (allMismatchedFiberOids.length > 0) layersToZoom.push(fiberLayer);
                
                if (layersToZoom.length > 0) {
                    zoomToLayers(layersToZoom).then(() => {
                        updateStatus("Analysis complete - " + (undergroundMismatches.length + aerialMismatches.length) + " mismatches found");
                    });
                } else {
                    updateStatus("Analysis complete - No quantity mismatches found");
                }
                
            } catch (error) {
                updateStatus("Error: " + (error.message || error));
                console.error("Analysis error:", error);
            }
        }
        
        // Event listeners
        $("#runBtn").addEventListener("click", runAnalysis);
        $("#resetBtn").addEventListener("click", resetFilters);
        $("#exportBtn").addEventListener("click", exportToCSV);
        $("#closeTool").addEventListener("click", () => {
            toolBox.remove();
            // Safe removal from active tools
            if (window.gisToolHost && window.gisToolHost.activeTools && window.gisToolHost.activeTools instanceof Set) {
                window.gisToolHost.activeTools.delete('parent-child-reconciliation');
            }
        });
        
        // Initialize and register tool
        loadWorkOrders();
        
        // Register tool as active
        window.gisToolHost.activeTools.add('parent-child-reconciliation');
        
        updateStatus("Tool loaded successfully");
        
    } catch (error) {
        console.error("Tool initialization error:", error);
        alert("Error initializing Parent/Child Reconciliation Tool: " + (error.message || error));
    }
})();
