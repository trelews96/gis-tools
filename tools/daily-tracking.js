// tools/daily-tracking.js - Converted from bookmarklet format
// Daily Tracking Query Tool with map filtering and labeling

(function() {
    try {
        // Check if tool is already active
        if (window.gisToolHost.activeTools.has('daily-tracking')) {
            console.log('Daily Tracking Tool already active');
            return;
        }
        
        // Remove any leftover toolbox
        const existingToolbox = document.getElementById('dailyTrackingToolbox');
        if (existingToolbox) {
            existingToolbox.remove();
            console.log('Removed leftover daily tracking toolbox');
        }
        
        // Use shared utilities
        const utils = window.gisSharedUtils;
        if (!utils) {
            throw new Error('Shared utilities not loaded');
        }
        
        const mapView = utils.getMapView();
        
        // Configuration constants
        const CONFIG = {
            ZOOM_SCALE: 5000,
            EXTENT_EXPAND_FACTOR: 1.5,
            MIN_EXTENT_WIDTH: 100,
            MIN_EXTENT_HEIGHT: 100,
            UI_Z_INDEX: 10000
        };
        
        // Store original layer states
        const originalLayerStates = new Map();
        
        // Capture original layer filters and label settings
        function captureOriginalStates() {
            mapView.map.allLayers.filter(l => l.type === 'feature').forEach(layer => {
                originalLayerStates.set(layer.id, {
                    definitionExpression: layer.definitionExpression,
                    labelingInfo: layer.labelingInfo ? JSON.parse(JSON.stringify(layer.labelingInfo)) : null,
                    labelsVisible: layer.labelsVisible
                });
            });
            console.log(`Captured original states for ${originalLayerStates.size} layers`);
        }
        
        // Capture states when tool opens
        captureOriginalStates();
        
        // Create tool UI
        const toolBox = document.createElement("div");
        toolBox.id = "dailyTrackingToolbox";
        toolBox.style.cssText = `
            position: fixed;
            top: 65px;
            right: 40px;
            z-index: ${CONFIG.UI_Z_INDEX};
            background: #fff;
            border: 1px solid #333;
            padding: 12px;
            max-width: 350px;
            font: 12px/1.3 Arial, sans-serif;
            box-shadow: 0 4px 16px rgba(0,0,0,.2);
            border-radius: 4px;
        `;
        
        toolBox.innerHTML = `
            <div style="font-weight:bold;margin-bottom:12px;">📋 Daily Tracking Query</div>
            
            <div style="margin-bottom:12px;">
                <label style="display:block;margin-bottom:4px;">Daily Number:</label>
                <input type="text" id="dailyNumberInput" placeholder="Enter daily number..." style="width:100%;padding:4px;border:1px solid #ccc;">
            </div>
            
            <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
                <button id="runQueryBtn" style="flex:1;padding:6px 12px;background:#28a745;color:white;border:none;border-radius:3px;cursor:pointer;">Run Query</button>
                <button id="resetFiltersBtn" style="flex:1;padding:6px 12px;background:#6c757d;color:white;border:none;border-radius:3px;cursor:pointer;">Reset Filters</button>
            </div>
            
            <div id="toolStatus" style="margin-bottom:8px;color:#3367d6;font-size:11px;min-height:16px;"></div>
            
            <div id="laborSummary" style="max-height:200px;overflow-y:auto;"></div>
            
            <button id="closeTool" style="width:100%;padding:6px;background:#d32f2f;color:white;border:none;border-radius:3px;cursor:pointer;margin-top:8px;">Close</button>
        `;
        
        // Add to page
        document.body.appendChild(toolBox);
        
        // Get UI elements
        const $ = (id) => toolBox.querySelector(id);
        const status = $("#toolStatus");
        
        function updateStatus(message) {
            status.textContent = message;
        }
        
        // Utility functions
        function validateDailyNumber(input) {
            if (!input) return null;
            const sanitized = input.trim().replace(/['"]/g, '');
            return sanitized.length > 0 ? sanitized : null;
        }
        
        function createSummaryTable(data) {
            let html = '<div style="margin-top:8px;"><strong>Labor Code Summary:</strong></div>';
            html += '<table style="border-collapse:collapse;margin-top:8px;width:100%;font-size:11px;"><thead><tr style="background:#f5f5f5;"><th style="border:1px solid #ddd;padding:4px;text-align:left;">Labor Code</th><th style="border:1px solid #ddd;padding:4px;text-align:right;">Total Quantity</th></tr></thead><tbody>';
            
            for (const lc in data) {
                html += `<tr><td style="border:1px solid #ddd;padding:4px;">${lc || 'N/A'}</td><td style="border:1px solid #ddd;padding:4px;text-align:right;">${data[lc]}</td></tr>`;
            }
            
            html += '</tbody></table>';
            return html;
        }
        
        function resetFilters() {
            try {
                updateStatus("Restoring original filters...");
                
                mapView.map.allLayers.filter(l => l.type === 'feature').forEach(layer => {
                    const originalState = originalLayerStates.get(layer.id);
                    if (originalState) {
                        layer.definitionExpression = originalState.definitionExpression;
                        layer.labelingInfo = originalState.labelingInfo;
                        layer.labelsVisible = originalState.labelsVisible;
                    }
                });
                
                $("#laborSummary").innerHTML = "";
                updateStatus("Original filters restored successfully.");
                
                setTimeout(() => updateStatus(""), 2000);
            } catch (error) {
                console.error("Error resetting filters:", error);
                updateStatus("Error resetting filters.");
            }
        }
        
        function zoomToLayers(layers) {
            const promises = layers.map(layer => layer.queryExtent());
            
            return Promise.all(promises).then(extents => {
                const combined = extents.reduce((acc, current) => {
                    return acc ? acc.union(current.extent) : current.extent;
                }, null);
                
                if (!combined) return;
                
                const expanded = combined.expand(CONFIG.EXTENT_EXPAND_FACTOR);
                const width = expanded.xmax - expanded.xmin;
                const height = expanded.ymax - expanded.ymin;
                
                const target = (width < CONFIG.MIN_EXTENT_WIDTH || height < CONFIG.MIN_EXTENT_HEIGHT) ? 
                    { target: expanded, scale: CONFIG.ZOOM_SCALE } : expanded;
                
                return mapView.goTo(target);
            }).catch(error => {
                console.error('Error zooming to layers:', error);
                updateStatus("Error zooming to results.");
            });
        }
        
        async function runDailyNumberQuery() {
            try {
                const dailyNumber = validateDailyNumber($("#dailyNumberInput").value);
                
                if (!dailyNumber) {
                    alert("Please enter a valid daily number.");
                    return;
                }
                
                $("#runQueryBtn").disabled = true;
                updateStatus("Loading...");
                
                // Reset to original filters first
                resetFilters();
                
                // Find Daily Tracking table
                const trackingTable = mapView.map.allTables && 
                    mapView.map.allTables.find(t => t.title && t.title.includes('Daily Tracking'));
                
                if (!trackingTable) {
                    throw new Error('Daily Tracking table not found');
                }
                
                // Query tracking table
                const queryParams = {
                    where: `daily_number='${dailyNumber}'`,
                    outFields: ['*']
                };
                
                updateStatus("Querying Daily Tracking table...");
                const trackingResult = await trackingTable.queryFeatures(queryParams);
                
                if (!trackingResult.features.length) {
                    throw new Error('No rows found for the specified daily number');
                }
                
                // Create labor code summary
                const laborSummary = trackingResult.features.reduce((summary, feature) => {
                    const laborCode = feature.attributes['labor_code'];
                    const quantity = feature.attributes['quantity'] || 0;
                    summary[laborCode] = (summary[laborCode] || 0) + quantity;
                    return summary;
                }, {});
                
                // Display summary
                $("#laborSummary").innerHTML = createSummaryTable(laborSummary);
                
                // Build globalId to quantity mapping
                const gidToQty = {};
                trackingResult.features.forEach(record => {
                    const quantity = record.attributes['quantity'] || 0;
                    Object.entries(record.attributes).forEach(([key, value]) => {
                        if (key.endsWith('_guid') && value) {
                            gidToQty[value] = quantity;
                        }
                    });
                });
                
                const globalIds = Object.keys(gidToQty);
                if (!globalIds.length) {
                    throw new Error('No related globalIds found');
                }
                
                updateStatus("Filtering and labeling map layers...");
                
                // Find feature layers with globalId fields
                const featureLayers = mapView.map.allLayers.filter(layer => 
                    layer.type === 'feature' && 
                    layer.fields.some(field => field.name.toLowerCase() === 'globalid')
                );
                
                // Query each layer for matching globalIds
                const layerPromises = featureLayers.map(async layer => {
                    try {
                        const baseFields = ['objectid', 'globalid'];
                        
                        // Check if layer has calculated_length field
                        if (layer.fields.some(field => field.name.toLowerCase() === 'calculated_length')) {
                            baseFields.push('calculated_length');
                        }
                        
                        const layerResult = await layer.queryFeatures({
                            where: `globalid IN ('${globalIds.join("','")}')`,
                            outFields: baseFields
                        });
                        
                        if (layerResult.features.length) {
                            const objectIds = layerResult.features.map(f => f.attributes.objectid);
                            
                            // Get original definition expression
                            const originalState = originalLayerStates.get(layer.id);
                            const originalDef = originalState?.definitionExpression;
                            
                            // Combine with original filter if it exists
                            const newDef = `objectid IN (${objectIds.join(',')})`;
                            layer.definitionExpression = originalDef ? 
                                `(${originalDef}) AND (${newDef})` : newDef;
                            
                            // Create quantity label expression
                            const args = [];
                            for (const gid in gidToQty) {
                                args.push(`"${gid}"`);
                                args.push(`"${gidToQty[gid]}"`);
                            }
                            
                            const qtyExpression = `var id = $feature.globalid; Decode(id, ${args.join(',')}, "N/A")`;
                            
                            const labelClasses = [];
                            
                            // Check if layer has calculated_length field for combined label
                            const hasLength = layer.fields.some(field => field.name.toLowerCase() === 'calculated_length');
                            
                            if (hasLength) {
                                // Quantity label (red) - positioned to the left
                                const qtyLabelExpression = `"Qty: " + Decode($feature.globalid, ${args.join(',')}, "N/A")`;
                                
                                labelClasses.push({
                                    labelExpressionInfo: { expression: qtyLabelExpression },
                                    symbol: {
                                        type: 'text',
                                        color: 'red',
                                        haloSize: 2,
                                        haloColor: 'white',
                                        font: {
                                            size: 12,
                                            family: 'Arial',
                                            weight: 'bold'
                                        },
                                        xoffset: -30
                                    },
                                    deconflictionStrategy: 'none',
                                    labelPlacement: 'center-center',
                                    repeatLabel: false
                                });
                                
                                // Length label (blue) - positioned to the right
                                labelClasses.push({
                                    labelExpressionInfo: { expression: '"Len: " + $feature.calculated_length' },
                                    symbol: {
                                        type: 'text',
                                        color: 'blue',
                                        haloSize: 2,
                                        haloColor: 'white',
                                        font: {
                                            size: 12,
                                            family: 'Arial',
                                            weight: 'bold'
                                        },
                                        xoffset: 30
                                    },
                                    deconflictionStrategy: 'none',
                                    labelPlacement: 'center-center',
                                    repeatLabel: false
                                });
                            } else {
                                // Quantity only label
                                labelClasses.push({
                                    labelExpressionInfo: { expression: qtyExpression },
                                    symbol: {
                                        type: 'text',
                                        color: 'red',
                                        haloSize: 1,
                                        haloColor: 'white',
                                        font: {
                                            size: 12,
                                            family: 'Arial',
                                            weight: 'bold'
                                        }
                                    },
                                    deconflictionStrategy: 'none',
                                    labelPlacement: 'center-center',
                                    repeatLabel: false
                                });
                            }
                            
                            layer.labelingInfo = labelClasses;
                            layer.labelsVisible = true;
                            
                            return layer;
                        } else {
                            // No features found, apply restrictive filter
                            const originalState = originalLayerStates.get(layer.id);
                            const originalDef = originalState?.definitionExpression;
                            layer.definitionExpression = originalDef ? 
                                `(${originalDef}) AND (1=0)` : '1=0';
                            return null;
                        }
                    } catch (error) {
                        console.error(`Error querying layer ${layer.title}:`, error);
                        return null;
                    }
                });
                
                const processedLayers = await Promise.all(layerPromises);
                const validLayers = processedLayers.filter(Boolean);
                
                if (validLayers.length > 0) {
                    updateStatus("Zooming to results...");
                    await zoomToLayers(validLayers);
                    updateStatus(`Query completed! Found ${trackingResult.features.length} tracking records across ${validLayers.length} layers.`);
                } else {
                    updateStatus("No matching features found on map layers.");
                }
                
            } catch (error) {
                console.error("Error running daily number query:", error);
                updateStatus(`Error: ${error.message}`);
                alert(`Error: ${error.message}`);
            } finally {
                $("#runQueryBtn").disabled = false;
            }
        }
        
        // Event listeners
        $("#runQueryBtn").onclick = runDailyNumberQuery;
        $("#resetFiltersBtn").onclick = resetFilters;
        
        // Allow Enter key to run query
        $("#dailyNumberInput").addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                runDailyNumberQuery();
            }
        });
        
        // Tool cleanup function
        function cleanup() {
            // Restore original filters when closing
            try {
                mapView.map.allLayers.filter(l => l.type === 'feature').forEach(layer => {
                    const originalState = originalLayerStates.get(layer.id);
                    if (originalState) {
                        layer.definitionExpression = originalState.definitionExpression;
                        layer.labelingInfo = originalState.labelingInfo;
                        layer.labelsVisible = originalState.labelsVisible;
                    }
                });
            } catch (error) {
                console.warn("Error restoring filters during cleanup:", error);
            }
            
            toolBox.remove();
            console.log('Daily Tracking Tool cleaned up');
        }
        
        // Close button
        $("#closeTool").onclick = () => {
            window.gisToolHost.closeTool('daily-tracking');
        };
        
        // Initialize
        updateStatus("Enter a daily number and click 'Run Query' to filter the map.");
        
        // Register tool with host
        window.gisToolHost.activeTools.set('daily-tracking', {
            cleanup: cleanup,
            toolBox: toolBox
        });
        
        console.log('Daily Tracking Tool loaded successfully');
        
    } catch (error) {
        console.error('Error loading Daily Tracking Tool:', error);
        alert("Error creating Daily Tracking Tool: " + (error.message || error));
    }
})();
