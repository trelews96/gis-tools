// tools/snap-move.js - Converted from bookmarklet format
// This will be loaded by the host launcher

(function() {
    try {
        // Check if tool is already loaded
        if (window.gisToolHost.activeTools.has('snap-move')) {
            console.log('Snap Move Tool already active');
            return;
        }
        
        // Use shared utilities
        const utils = window.gisSharedUtils;
        if (!utils) {
            throw new Error('Shared utilities not loaded');
        }
        
        const mapView = utils.getMapView();
        const LAYER_CONFIG = utils.LAYER_CONFIG;
        const SNAP_TOLERANCE = utils.SNAP_TOLERANCE;
        const POINT_SNAP_TOLERANCE = utils.POINT_SNAP_TOLERANCE;
        
        // Tool state variables
        let toolActive = false;
        let currentMode = "point";
        let vertexMode = "none";
        let selectedFeature = null;
        let selectedLayer = null;
        let selectedLayerConfig = null;
        let selectedVertex = null;
        let selectedCoincidentLines = [];
        let waitingForDestination = false;
        let connectedFeatures = [];
        let originalGeometries = new Map();
        let clickHandler = null;
        
        // Create tool UI
        const toolBox = document.createElement("div");
        toolBox.id = "snapMoveToolbox";
        toolBox.style.cssText = utils.getToolboxStyle();
        
        toolBox.innerHTML = `
            <div style="font-weight:bold;margin-bottom:8px;">📐 Click-to-Move Tool</div>
            <div style="margin-bottom:8px;color:#666;font-size:11px;">
                <strong>Point Mode:</strong> Click point → Click destination<br>
                <strong>Line Mode:</strong> Click line vertex → Click destination<br>
                <strong>Vertex Tools:</strong> Toggle buttons to add/delete vertices
            </div>
            <div style="display:flex;gap:4px;margin-bottom:8px;">
                <button id="pointMode" style="flex:1;padding:4px 6px;background:#3367d6;color:white;border:none;border-radius:2px;font-size:11px;">Point Mode</button>
                <button id="lineMode" style="flex:1;padding:4px 6px;background:#666;color:white;border:none;border-radius:2px;font-size:11px;">Line Mode</button>
            </div>
            <div style="display:flex;gap:4px;margin-bottom:8px;">
                <button id="addVertexMode" style="flex:1;padding:4px 6px;background:#666;color:white;border:none;border-radius:2px;font-size:11px;">Add Vertex</button>
                <button id="deleteVertexMode" style="flex:1;padding:4px 6px;background:#666;color:white;border:none;border-radius:2px;font-size:11px;">Delete Vertex</button>
            </div>
            <div style="display:flex;gap:8px;margin-bottom:8px;">
                <button id="enableTool" style="flex:1;padding:4px 8px;background:#28a745;color:white;border:none;border-radius:2px;">Enable Tool</button>
                <button id="disableTool" style="flex:1;padding:4px 8px;background:#666;color:white;border:none;border-radius:2px;" disabled>Disable Tool</button>
            </div>
            <div style="display:flex;gap:8px;margin-bottom:8px;">
                <button id="cancelMove" style="flex:1;padding:4px 8px;background:#ff9800;color:white;border:none;border-radius:2px;" disabled>Cancel Move</button>
                <button id="closeTool" style="flex:1;padding:4px 8px;background:#d32f2f;color:white;border:none;border-radius:2px;">Close</button>
            </div>
            <div id="toolStatus" style="margin-top:8px;color:#3367d6;font-size:11px;"></div>
        `;
        
        // Add to page
        document.body.appendChild(toolBox);
        
        // Get UI elements
        const $ = (id) => toolBox.querySelector(id);
        const pointModeBtn = $("#pointMode");
        const lineModeBtn = $("#lineMode");
        const addVertexBtn = $("#addVertexMode");
        const deleteVertexBtn = $("#deleteVertexMode");
        const enableBtn = $("#enableTool");
        const disableBtn = $("#disableTool");
        const cancelBtn = $("#cancelMove");
        const closeBtn = $("#closeTool");
        const status = $("#toolStatus");
        
        function updateStatus(message) {
            status.textContent = message;
        }
        
        // [Insert all your existing function definitions here - they remain mostly the same]
        // Just need to replace references to:
        // - calculateDistance -> utils.calculateDistance
        // - calculateGeodeticLength -> utils.calculateGeodeticLength
        // - etc. for other utility functions
        
        function isEndpoint(geometry, pathIndex, pointIndex) {
            if (!geometry || !geometry.paths || !geometry.paths[pathIndex]) return false;
            const path = geometry.paths[pathIndex];
            return pointIndex === 0 || pointIndex === path.length - 1;
        }
        
        function findClosestLineSegment(geometry, mapPoint) {
            if (!geometry || !geometry.paths) return null;
            
            let closestSegment = null;
            let minDistance = Infinity;
            
            for (let pathIndex = 0; pathIndex < geometry.paths.length; pathIndex++) {
                const path = geometry.paths[pathIndex];
                for (let segmentIndex = 0; segmentIndex < path.length - 1; segmentIndex++) {
                    const p1 = {x: path[segmentIndex][0], y: path[segmentIndex][1]};
                    const p2 = {x: path[segmentIndex + 1][0], y: path[segmentIndex + 1][1]};
                    
                    const segmentInfo = getClosestPointOnSegment(mapPoint, p1, p2);
                    if (segmentInfo.distance < minDistance) {
                        minDistance = segmentInfo.distance;
                        closestSegment = {
                            pathIndex: pathIndex,
                            segmentIndex: segmentIndex,
                            insertIndex: segmentIndex + 1,
                            distance: segmentInfo.distance,
                            point: segmentInfo.point,
                            segmentStart: p1,
                            segmentEnd: p2
                        };
                    }
                }
            }
            
            const tolerance = SNAP_TOLERANCE * mapView.resolution;
            return (closestSegment && closestSegment.distance < tolerance) ? closestSegment : null;
        }
        
        function getClosestPointOnSegment(point, segmentStart, segmentEnd) {
            const A = point.x - segmentStart.x;
            const B = point.y - segmentStart.y;
            const C = segmentEnd.x - segmentStart.x;
            const D = segmentEnd.y - segmentStart.y;
            const dot = A * C + B * D;
            const lenSq = C * C + D * D;
            let param = -1;
            
            if (lenSq !== 0) param = dot / lenSq;
            
            let closestPoint;
            if (param < 0) {
                closestPoint = {x: segmentStart.x, y: segmentStart.y};
            } else if (param > 1) {
                closestPoint = {x: segmentEnd.x, y: segmentEnd.y};
            } else {
                closestPoint = {
                    x: segmentStart.x + param * C,
                    y: segmentStart.y + param * D
                };
            }
            
            return {
                point: closestPoint,
                distance: utils.calculateDistance(point, closestPoint),
                param: param
            };
        }
        
        // [Continue with all other existing functions, updating utility calls...]
        
        // Tool cleanup function
        function cleanup() {
            if (toolActive) {
                disableTool();
            }
            toolBox.remove();
            console.log('Snap Move Tool cleaned up');
        }
        
        function disableTool() {
            toolActive = false;
            selectedFeature = null;
            selectedLayer = null;
            selectedLayerConfig = null;
            selectedVertex = null;
            selectedCoincidentLines = [];
            waitingForDestination = false;
            connectedFeatures = [];
            originalGeometries.clear();
            vertexMode = "none";
            
            addVertexBtn.style.background = "#666";
            deleteVertexBtn.style.background = "#666";
            
            if (clickHandler) clickHandler.remove();
            enableBtn.disabled = false;
            disableBtn.disabled = true;
            cancelBtn.disabled = true;
            mapView.container.style.cursor = "default";
            updateStatus("Tool disabled.");
        }
        
        function enableTool() {
            toolActive = true;
            clickHandler = mapView.on("click", handleClick);
            enableBtn.disabled = true;
            disableBtn.disabled = false;
            mapView.container.style.cursor = "crosshair";
            
            const modeText = currentMode === "point" ? "point feature" : "line vertex";
            updateStatus(`Tool enabled in ${currentMode} mode. Click on a ${modeText} to select it.`);
        }
        
        function setPointMode() {
            currentMode = "point";
            vertexMode = "none";
            pointModeBtn.style.background = "#3367d6";
            lineModeBtn.style.background = "#666";
            addVertexBtn.style.background = "#666";
            deleteVertexBtn.style.background = "#666";
            
            if (toolActive) updateStatus("Point mode active. Click on a point feature to select it.");
            if (selectedFeature) cancelMove();
        }
        
        function setLineMode() {
            currentMode = "line";
            vertexMode = "none";
            pointModeBtn.style.background = "#666";
            lineModeBtn.style.background = "#3367d6";
            addVertexBtn.style.background = "#666";
            deleteVertexBtn.style.background = "#666";
            
            if (toolActive) updateStatus("Line mode active. Click on a line vertex to select it.");
            if (selectedFeature) cancelMove();
        }
        
        function cancelMove() {
            selectedFeature = null;
            selectedLayer = null;
            selectedLayerConfig = null;
            selectedVertex = null;
            selectedCoincidentLines = [];
            waitingForDestination = false;
            connectedFeatures = [];
            originalGeometries.clear();
            cancelBtn.disabled = true;
            
            if (vertexMode === "add") {
                updateStatus("Add Vertex mode active. Click on any line segment to add a vertex.");
            } else if (vertexMode === "delete") {
                updateStatus("Delete Vertex mode active. Click on any vertex to delete it.");
            } else {
                const modeText = currentMode === "point" ? "point feature" : "line vertex";
                updateStatus(`Move cancelled. Click on a ${modeText} to select it.`);
            }
        }
        
        // [Include all other missing function definitions from your original code...]
        
        // Event listeners
        pointModeBtn.onclick = setPointMode;
        lineModeBtn.onclick = setLineMode;
        enableBtn.onclick = enableTool;
        disableBtn.onclick = disableTool;
        cancelBtn.onclick = cancelMove;
        closeBtn.onclick = () => {
            window.gisToolHost.closeTool('snap-move');
        };
        
        // Initialize
        setPointMode();
        updateStatus("Click-to-Move Tool loaded. Select mode and click 'Enable Tool' to start.");
        
        // Register tool with host
        window.gisToolHost.activeTools.set('snap-move', {
            cleanup: cleanup,
            toolBox: toolBox
        });
        
        console.log('Snap Move Tool loaded successfully');
        
    } catch (error) {
        console.error('Error loading Snap Move Tool:', error);
        alert("Error creating Snap Move Tool: " + (error.message || error));
    }
})()
