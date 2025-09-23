// tools/curve-drawing-tool.js - Freehand Curve Drawing and Smoothing Tool
// Allows users to draw rough curves that get smoothed into proper geometric curves

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
        if (window.gisToolHost.activeTools.has('curve-drawing-tool')) {
            console.log('Curve Drawing Tool already active');
            return;
        }
        
        const existingToolbox = document.getElementById('curveDrawingToolbox');
        if (existingToolbox) {
            existingToolbox.remove();
            console.log('Removed leftover curve drawing toolbox');
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
        
        const LINE_LAYER_CONFIG = [
            { id: 41050, name: "Fiber Cable" },
            { id: 42050, name: "Underground Span" },
            { id: 43050, name: "Aerial Span" }
        ];
        
        const z = 99999;
        
        const toolBox = document.createElement("div");
        toolBox.id = "curveDrawingToolbox";
        toolBox.style.cssText = `
            position: fixed; 
            top: 120px; 
            right: 40px; 
            z-index: ${z}; 
            background: #fff; 
            border: 1px solid #333; 
            padding: 12px; 
            max-width: 360px; 
            font: 12px/1.3 Arial, sans-serif; 
            box-shadow: 0 4px 16px rgba(0,0,0,.2); 
            border-radius: 4px;
        `;
        
        toolBox.innerHTML = `
            <div style="font-weight:bold;margin-bottom:8px;">🎨 Curve Drawing Tool</div>
            <div style="margin-bottom:8px;color:#666;font-size:11px;">
                <strong>Instructions:</strong><br>
                1. Select target layer<br>
                2. Enable drawing mode<br>
                3. Click and drag to draw curve<br>
                4. Tool will auto-smooth your input
            </div>
            
            <div style="margin-bottom:8px;">
                <label style="font-weight:bold;font-size:11px;">Target Layer:</label><br>
                <select id="layerSelect" style="width:100%;padding:4px;margin-top:2px;font-size:11px;">
                    <option value="">Select Layer...</option>
                </select>
            </div>
            
            <div style="margin-bottom:8px;">
                <label style="font-weight:bold;font-size:11px;">Smoothing Level:</label><br>
                <input type="range" id="smoothingSlider" min="1" max="5" value="3" style="width:100%;margin-top:2px;">
                <div style="font-size:10px;color:#666;">Light ← → Heavy</div>
            </div>
            
            <div style="display:flex;gap:4px;margin-bottom:8px;">
                <button id="enableDrawing" style="flex:1;padding:6px 8px;background:#28a745;color:white;border:none;border-radius:2px;font-size:11px;">Enable Drawing</button>
                <button id="disableDrawing" style="flex:1;padding:6px 8px;background:#666;color:white;border:none;border-radius:2px;font-size:11px;" disabled>Disable Drawing</button>
            </div>
            
            <div style="display:flex;gap:4px;margin-bottom:8px;">
                <button id="previewCurve" style="flex:1;padding:6px 8px;background:#3367d6;color:white;border:none;border-radius:2px;font-size:11px;" disabled>Preview</button>
                <button id="acceptCurve" style="flex:1;padding:6px 8px;background:#ff9800;color:white;border:none;border-radius:2px;font-size:11px;" disabled>Accept</button>
            </div>
            
            <div style="display:flex;gap:4px;margin-bottom:8px;">
                <button id="cancelCurve" style="flex:1;padding:6px 8px;background:#dc3545;color:white;border:none;border-radius:2px;font-size:11px;" disabled>Cancel</button>
                <button id="closeTool" style="flex:1;padding:6px 8px;background:#6c757d;color:white;border:none;border-radius:2px;font-size:11px;">Close</button>
            </div>
            
            <div id="curveStatus" style="margin-top:8px;color:#3367d6;font-size:11px;min-height:16px;"></div>
        `;
        
        document.body.appendChild(toolBox);
        
        // Tool state
        let drawingActive = false;
        let isDrawing = false;
        let currentPath = [];
        let rawPoints = [];
        let smoothedPath = null;
        let previewGraphic = null;
        let selectedLayer = null;
        let dragHandler = null;
        let pointerMoveHandler = null;
        let pointerUpHandler = null;
        
        // UI Elements
        const $ = (id) => toolBox.querySelector('#' + id);
        const layerSelect = $('layerSelect');
        const smoothingSlider = $('smoothingSlider');
        const enableBtn = $('enableDrawing');
        const disableBtn = $('disableDrawing');
        const previewBtn = $('previewCurve');
        const acceptBtn = $('acceptCurve');
        const cancelBtn = $('cancelCurve');
        const closeBtn = $('closeTool');
        const status = $('curveStatus');
        
        function updateStatus(message) {
            if (status) status.textContent = message;
        }
        
        // Initialize layer dropdown
        function populateLayerDropdown() {
            layerSelect.innerHTML = '<option value="">Select Layer...</option>';
            
            for (const layerConfig of LINE_LAYER_CONFIG) {
                const layer = mapView.map.allLayers.find(l => l.layerId === layerConfig.id);
                if (layer && layer.visible) {
                    const option = document.createElement('option');
                    option.value = layerConfig.id;
                    option.textContent = layerConfig.name;
                    layerSelect.appendChild(option);
                }
            }
        }
        
        // Utility functions
        function calculateDistance(point1, point2) {
            const dx = point1.x - point2.x;
            const dy = point1.y - point2.y;
            return Math.sqrt(dx * dx + dy * dy);
        }
        
        function calculateGeodeticLength(geometry) {
            try {
                if (!geometry || !geometry.paths || geometry.paths.length === 0) return 0;
                
                let totalLength = 0;
                for (const path of geometry.paths) {
                    if (path.length < 2) continue;
                    
                    for (let i = 0; i < path.length - 1; i++) {
                        const point1 = {
                            x: path[i][0],
                            y: path[i][1],
                            spatialReference: geometry.spatialReference
                        };
                        const point2 = {
                            x: path[i + 1][0],
                            y: path[i + 1][1],
                            spatialReference: geometry.spatialReference
                        };
                        totalLength += calculateGeodeticDistanceBetweenPoints(point1, point2);
                    }
                }
                return Math.round(totalLength);
            } catch (error) {
                console.error("Error calculating geodetic length:", error);
                return 0;
            }
        }
        
        function calculateGeodeticDistanceBetweenPoints(point1, point2) {
            try {
                const latLng1 = convertMapPointToLatLng(point1);
                const latLng2 = convertMapPointToLatLng(point2);
                const earthRadiusFeet = 20902231.0;
                const lat1Rad = latLng1.lat * Math.PI / 180;
                const lat2Rad = latLng2.lat * Math.PI / 180;
                const deltaLatRad = (latLng2.lat - latLng1.lat) * Math.PI / 180;
                const deltaLngRad = (latLng2.lng - latLng1.lng) * Math.PI / 180;
                
                const a = Math.sin(deltaLatRad / 2) * Math.sin(deltaLatRad / 2) +
                         Math.cos(lat1Rad) * Math.cos(lat2Rad) *
                         Math.sin(deltaLngRad / 2) * Math.sin(deltaLngRad / 2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                
                return earthRadiusFeet * c;
            } catch (error) {
                console.error("Error calculating distance between points:", error);
                return 0;
            }
        }
        
        function convertMapPointToLatLng(mapPoint) {
            try {
                const sr = mapPoint.spatialReference;
                if (!sr || sr.wkid === 3857 || sr.wkid === 102100) {
                    return convertWebMercatorToLatLng(mapPoint.x, mapPoint.y);
                } else if (sr.wkid === 4326 || sr.wkid === 4269) {
                    return { lat: mapPoint.y, lng: mapPoint.x };
                } else {
                    return convertWebMercatorToLatLng(mapPoint.x, mapPoint.y);
                }
            } catch (error) {
                console.error("Error converting map point:", error);
                return { lat: 0, lng: 0 };
            }
        }
        
        function convertWebMercatorToLatLng(x, y) {
            const lng = (x / 20037508.34) * 180;
            let lat = (y / 20037508.34) * 180;
            lat = 180 / Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
            return { lat: lat, lng: lng };
        }
        
        // Curve smoothing algorithms
        function douglasPeucker(points, tolerance) {
            if (points.length <= 2) return points;
            
            // Find the point with maximum distance from line between first and last points
            let maxDistance = 0;
            let maxIndex = 0;
            const firstPoint = points[0];
            const lastPoint = points[points.length - 1];
            
            for (let i = 1; i < points.length - 1; i++) {
                const distance = perpendicularDistance(points[i], firstPoint, lastPoint);
                if (distance > maxDistance) {
                    maxDistance = distance;
                    maxIndex = i;
                }
            }
            
            if (maxDistance > tolerance) {
                // Recursively simplify both halves
                const firstHalf = douglasPeucker(points.slice(0, maxIndex + 1), tolerance);
                const secondHalf = douglasPeucker(points.slice(maxIndex), tolerance);
                
                // Combine results (remove duplicate point at connection)
                return firstHalf.slice(0, -1).concat(secondHalf);
            } else {
                return [firstPoint, lastPoint];
            }
        }
        
        function perpendicularDistance(point, lineStart, lineEnd) {
            const A = lineEnd.y - lineStart.y;
            const B = lineStart.x - lineEnd.x;
            const C = lineEnd.x * lineStart.y - lineStart.x * lineEnd.y;
            
            return Math.abs(A * point.x + B * point.y + C) / Math.sqrt(A * A + B * B);
        }
        
        function smoothPath(points, smoothingLevel) {
            if (points.length < 3) return points;
            
            // Apply Douglas-Peucker first to remove excessive points
            const tolerance = Math.max(1, mapView.resolution * (6 - smoothingLevel));
            let simplified = douglasPeucker(points, tolerance);
            
            // Apply moving average smoothing
            if (smoothingLevel > 2 && simplified.length > 3) {
                simplified = applyMovingAverage(simplified, smoothingLevel);
            }
            
            return simplified;
        }
        
        function applyMovingAverage(points, windowSize) {
            if (points.length <= 2) return points;
            
            const smoothed = [points[0]]; // Keep first point unchanged
            const window = Math.min(windowSize, Math.floor(points.length / 3));
            
            for (let i = 1; i < points.length - 1; i++) {
                let sumX = 0, sumY = 0, count = 0;
                
                const start = Math.max(0, i - window);
                const end = Math.min(points.length, i + window + 1);
                
                for (let j = start; j < end; j++) {
                    sumX += points[j].x;
                    sumY += points[j].y;
                    count++;
                }
                
                smoothed.push({
                    x: sumX / count,
                    y: sumY / count
                });
            }
            
            smoothed.push(points[points.length - 1]); // Keep last point unchanged
            return smoothed;
        }
        
        function detectCurveType(points) {
            if (points.length < 5) return 'line';
            
            // Simple heuristic: if the path curves consistently in one direction, it might be circular
            let totalTurnAngle = 0;
            let turnCount = 0;
            
            for (let i = 1; i < points.length - 1; i++) {
                const prev = points[i - 1];
                const curr = points[i];
                const next = points[i + 1];
                
                const angle1 = Math.atan2(curr.y - prev.y, curr.x - prev.x);
                const angle2 = Math.atan2(next.y - curr.y, next.x - curr.x);
                let turnAngle = angle2 - angle1;
                
                // Normalize angle to [-π, π]
                if (turnAngle > Math.PI) turnAngle -= 2 * Math.PI;
                if (turnAngle < -Math.PI) turnAngle += 2 * Math.PI;
                
                totalTurnAngle += Math.abs(turnAngle);
                turnCount++;
            }
            
            const avgTurnAngle = totalTurnAngle / turnCount;
            
            if (avgTurnAngle > 0.1) {
                return 'curve';
            } else {
                return 'line';
            }
        }
        
        // Drawing functions
        function startDrawing(event) {
            if (!drawingActive || !selectedLayer) return;
            
            isDrawing = true;
            currentPath = [];
            rawPoints = [];
            
            const mapPoint = mapView.toMap({ x: event.x, y: event.y });
            rawPoints.push(mapPoint);
            currentPath.push([mapPoint.x, mapPoint.y]);
            
            updateStatus("Drawing curve... drag to continue, release to finish.");
            
            // Set up pointer tracking
            mapView.container.style.cursor = "crosshair";
            
            // Add pointer move handler
            pointerMoveHandler = mapView.on("pointer-move", function(event) {
                if (isDrawing) {
                    const mapPoint = mapView.toMap({ x: event.x, y: event.y });
                    
                    // Only add point if it's far enough from the last point
                    const lastPoint = rawPoints[rawPoints.length - 1];
                    const distance = calculateDistance(mapPoint, lastPoint);
                    const minDistance = mapView.resolution * 5; // Minimum distance between points
                    
                    if (distance > minDistance) {
                        rawPoints.push(mapPoint);
                        currentPath.push([mapPoint.x, mapPoint.y]);
                        
                        // Update preview in real-time (optional - might be too intensive)
                        if (rawPoints.length > 3) {
                            updatePreview();
                        }
                    }
                }
            });
            
            // Add pointer up handler
            pointerUpHandler = mapView.on("pointer-up", function(event) {
                if (isDrawing) {
                    finishDrawing();
                }
            });
        }
        
        function finishDrawing() {
            if (!isDrawing) return;
            
            isDrawing = false;
            mapView.container.style.cursor = "default";
            
            // Clean up event handlers
            if (pointerMoveHandler) {
                pointerMoveHandler.remove();
                pointerMoveHandler = null;
            }
            if (pointerUpHandler) {
                pointerUpHandler.remove();
                pointerUpHandler = null;
            }
            
            if (rawPoints.length < 2) {
                updateStatus("❌ Need at least 2 points to create a curve. Try again.");
                return;
            }
            
            updateStatus(`Captured ${rawPoints.length} points. Processing curve...`);
            
            // Enable preview and accept buttons
            if (previewBtn) previewBtn.disabled = false;
            if (acceptBtn) acceptBtn.disabled = false;
            if (cancelBtn) cancelBtn.disabled = false;
            
            // Auto-preview
            setTimeout(() => updatePreview(), 100);
        }
        
        function updatePreview() {
            if (!rawPoints || rawPoints.length < 2) return;
            
            try {
                // Clear existing preview
                clearPreview();
                
                // Smooth the path
                const smoothingLevel = parseInt(smoothingSlider.value);
                smoothedPath = smoothPath([...rawPoints], smoothingLevel);
                
                if (smoothedPath.length < 2) {
                    updateStatus("❌ Not enough points after smoothing.");
                    return;
                }
                
                // Create preview geometry
                const pathCoords = smoothedPath.map(p => [p.x, p.y]);
                const previewGeometry = {
                    type: "polyline",
                    paths: [pathCoords],
                    spatialReference: mapView.spatialReference
                };
                
                // Detect curve type
                const curveType = detectCurveType(smoothedPath);
                
                // Create preview graphic
                const previewSymbol = {
                    type: "simple-line",
                    color: [255, 0, 0, 0.8], // Red with transparency
                    width: 3,
                    style: "dash"
                };
                
                previewGraphic = {
                    geometry: previewGeometry,
                    symbol: previewSymbol
                };
                
                // Add to map view
                if (mapView.graphics) {
                    mapView.graphics.add(previewGraphic);
                }
                
                const length = calculateGeodeticLength(previewGeometry);
                updateStatus(`✅ Preview ready: ${curveType} with ${smoothedPath.length} vertices, ${length}ft long. Click Accept to create.`);
            } catch (error) {
                console.error("Error creating preview:", error);
                updateStatus("❌ Error creating preview.");
            }
        }
        
        function clearPreview() {
            if (previewGraphic && mapView.graphics) {
                mapView.graphics.remove(previewGraphic);
                previewGraphic = null;
            }
        }
        
        async function acceptCurve() {
            if (!smoothedPath || !selectedLayer) return;
            
            updateStatus("Creating feature...");
            
            try {
                const pathCoords = smoothedPath.map(p => [p.x, p.y]);
                const geometry = {
                    type: "polyline",
                    paths: [pathCoords],
                    spatialReference: mapView.spatialReference
                };
                
                const length = calculateGeodeticLength(geometry);
                
                // Create new feature
                const newFeature = {
                    geometry: geometry,
                    attributes: {
                        calculated_length: length
                        // Add other default attributes as needed
                    }
                };
                
                // Add to layer
                if (selectedLayer.applyEdits) {
                    await selectedLayer.applyEdits({ addFeatures: [newFeature] });
                    updateStatus(`✅ Created curve feature with length ${length}ft!`);
                } else {
                    updateStatus("❌ Layer doesn't support editing.");
                }
                
                // Clean up
                clearPreview();
                resetDrawing();
                
                setTimeout(() => {
                    updateStatus("Ready to draw next curve.");
                }, 3000);
                
            } catch (error) {
                console.error("Error creating feature:", error);
                updateStatus("❌ Error creating feature: " + error.message);
            }
        }
        
        function cancelCurve() {
            clearPreview();
            resetDrawing();
            updateStatus("Curve cancelled. Ready to draw next curve.");
        }
        
        function resetDrawing() {
            rawPoints = [];
            currentPath = [];
            smoothedPath = null;
            isDrawing = false;
            
            if (previewBtn) previewBtn.disabled = true;
            if (acceptBtn) acceptBtn.disabled = true;
            if (cancelBtn) cancelBtn.disabled = true;
            
            if (pointerMoveHandler) {
                pointerMoveHandler.remove();
                pointerMoveHandler = null;
            }
            if (pointerUpHandler) {
                pointerUpHandler.remove();
                pointerUpHandler = null;
            }
        }
        
        function enableDrawing() {
            const layerId = parseInt(layerSelect.value);
            if (!layerId) {
                updateStatus("❌ Please select a target layer first.");
                return;
            }
            
            selectedLayer = mapView.map.allLayers.find(l => l.layerId === layerId);
            if (!selectedLayer) {
                updateStatus("❌ Selected layer not found.");
                return;
            }
            
            drawingActive = true;
            if (enableBtn) enableBtn.disabled = true;
            if (disableBtn) disableBtn.disabled = false;
            if (layerSelect) layerSelect.disabled = true;
            
            // Set up drawing handler
            dragHandler = mapView.on("drag", ["Shift"], function(event) {
                event.stopPropagation();
                
                switch (event.action) {
                    case "start":
                        startDrawing(event);
                        break;
                    case "update":
                        // Handled by pointer-move
                        break;
                    case "end":
                        finishDrawing();
                        break;
                }
            });
            
            updateStatus("Drawing enabled! Hold Shift and drag to draw curves.");
        }
        
        function disableDrawing() {
            drawingActive = false;
            
            if (dragHandler) {
                dragHandler.remove();
                dragHandler = null;
            }
            
            resetDrawing();
            clearPreview();
            
            if (enableBtn) enableBtn.disabled = false;
            if (disableBtn) disableBtn.disabled = true;
            if (layerSelect) layerSelect.disabled = false;
            
            selectedLayer = null;
            updateStatus("Drawing disabled.");
        }
        
        // Event listeners
        if (layerSelect) {
            layerSelect.onchange = function() {
                updateStatus("Layer selected. Click Enable Drawing to start.");
            };
        }
        
        if (smoothingSlider) {
            smoothingSlider.oninput = function() {
                if (rawPoints.length > 0) {
                    updatePreview(); // Update preview when smoothing changes
                }
            };
        }
        
        if (enableBtn) enableBtn.onclick = enableDrawing;
        if (disableBtn) disableBtn.onclick = disableDrawing;
        if (previewBtn) previewBtn.onclick = updatePreview;
        if (acceptBtn) acceptBtn.onclick = acceptCurve;
        if (cancelBtn) cancelBtn.onclick = cancelCurve;
        
        if (closeBtn) {
            closeBtn.onclick = function() {
                disableDrawing();
                clearPreview();
                toolBox.remove();
                // Safe removal from active tools
                if (window.gisToolHost && window.gisToolHost.activeTools && window.gisToolHost.activeTools instanceof Set) {
                    window.gisToolHost.activeTools.delete('curve-drawing-tool');
                }
            };
        }
        
        // Initialize
        populateLayerDropdown();
        
        // Register tool as active
        window.gisToolHost.activeTools.add('curve-drawing-tool');
        
        updateStatus("Curve Drawing Tool loaded. Select a layer and enable drawing to start.");
        
    } catch (error) {
        console.error("Error creating curve drawing tool:", error);
        alert("Error creating curve drawing tool: " + (error.message || error));
    }
})();
