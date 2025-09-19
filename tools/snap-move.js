// tools/snap-move-tool.js - Fixed version
// Click-to-Move Tool for moving points and line vertices with snapping

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
        if (window.gisToolHost.activeTools.has('snap-move-tool')) {
            console.log('Snap Move Tool already active');
            return;
        }
        
        const existingToolbox = document.getElementById('snapMoveToolbox');
        if (existingToolbox) {
            existingToolbox.remove();
            console.log('Removed leftover snap move toolbox');
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
        
        const LAYER_CONFIG = {
            points: [
                { id: 42100, name: "Vault" },
                { id: 41150, name: "Splice Closure" },
                { id: 41100, name: "Fiber Equipment" }
            ],
            lines: [
                { id: 41050, name: "Fiber Cable" },
                { id: 42050, name: "Underground Span" },
                { id: 43050, name: "Aerial Span" }
            ]
        };
        
        const SNAP_TOLERANCE = 15;
        const POINT_SNAP_TOLERANCE = 25;
        const z = 99999;
        
        const toolBox = document.createElement("div");
        toolBox.id = "snapMoveToolbox";
        toolBox.style.cssText = `
            position: fixed; 
            top: 120px; 
            right: 40px; 
            z-index: ${z}; 
            background: #fff; 
            border: 1px solid #333; 
            padding: 12px; 
            max-width: 320px; 
            font: 12px/1.3 Arial, sans-serif; 
            box-shadow: 0 4px 16px rgba(0,0,0,.2); 
            border-radius: 4px;
        `;
        
        toolBox.innerHTML = `
            <div style="font-weight:bold;margin-bottom:8px;">🔧 Click-to-Move Tool</div>
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
        
        document.body.appendChild(toolBox);
        
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
            if (status) status.textContent = message;
        }
        
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
                    const p1 = { x: path[segmentIndex][0], y: path[segmentIndex][1] };
                    const p2 = { x: path[segmentIndex + 1][0], y: path[segmentIndex + 1][1] };
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
            
            // Use fixed tolerance instead of resolution-based
            const tolerance = 50;
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
                closestPoint = { x: segmentStart.x, y: segmentStart.y };
            } else if (param > 1) {
                closestPoint = { x: segmentEnd.x, y: segmentEnd.y };
            } else {
                closestPoint = {
                    x: segmentStart.x + param * C,
                    y: segmentStart.y + param * D
                };
            }
            
            return {
                point: closestPoint,
                distance: calculateDistance(point, closestPoint),
                param: param
            };
        }
        
        async function findNearestPointFeature(mapPoint) {
            try {
                const tolerance = POINT_SNAP_TOLERANCE * (mapView.resolution || 1);
                let nearestPoint = null;
                let minDistance = Infinity;
                
                for (const pointConfig of LAYER_CONFIG.points) {
                    try {
                        const layer = mapView.map.allLayers.find(l => l.layerId === pointConfig.id);
                        if (!layer || !layer.visible) continue;
                        
                        await layer.load();
                        
                        const extent = {
                            xmin: mapPoint.x - tolerance,
                            ymin: mapPoint.y - tolerance,
                            xmax: mapPoint.x + tolerance,
                            ymax: mapPoint.y + tolerance,
                            spatialReference: mapView.spatialReference
                        };
                        
                        const result = await layer.queryFeatures({
                            geometry: extent,
                            spatialRelationship: "intersects",
                            returnGeometry: true,
                            outFields: ["*"]
                        });
                        
                        for (const feature of result.features) {
                            const distance = calculateDistance(mapPoint, feature.geometry);
                            if (distance < minDistance) {
                                minDistance = distance;
                                nearestPoint = {
                                    feature: feature,
                                    layer: layer,
                                    layerConfig: pointConfig,
                                    distance: distance,
                                    geometry: feature.geometry
                                };
                            }
                        }
                    } catch (error) {
                        console.error("Error querying point layer:", error);
                    }
                }
                
                return (nearestPoint && nearestPoint.distance < tolerance) ? nearestPoint : null;
            } catch (error) {
                console.error("Error finding nearest point feature:", error);
                return null;
            }
        }
        
        async function findPointFeatureAtLocation(screenPoint) {
            try {
                // Try hit test first
                if (mapView.hitTest) {
                    const hitResponse = await mapView.hitTest(screenPoint, {
                        include: mapView.map.allLayers.filter(l => l.type === "feature")
                    });
                    
                    if (hitResponse.results.length > 0) {
                        for (const result of hitResponse.results) {
                            if (result.graphic && result.graphic.geometry && result.graphic.geometry.type === "point") {
                                const layerConfig = LAYER_CONFIG.points.find(p => p.id === result.layer.layerId);
                                if (layerConfig) {
                                    return {
                                        feature: result.graphic,
                                        layer: result.layer,
                                        layerConfig: layerConfig
                                    };
                                }
                            }
                        }
                    }
                }
                
                // Fallback to spatial query
                const mapPoint = mapView.toMap(screenPoint);
                const tolerance = SNAP_TOLERANCE * (mapView.resolution || 1);
                
                for (const pointConfig of LAYER_CONFIG.points) {
                    try {
                        const layer = mapView.map.allLayers.find(l => l.layerId === pointConfig.id);
                        if (!layer || !layer.visible) continue;
                        
                        await layer.load();
                        
                        const extent = {
                            xmin: mapPoint.x - tolerance,
                            ymin: mapPoint.y - tolerance,
                            xmax: mapPoint.x + tolerance,
                            ymax: mapPoint.y + tolerance,
                            spatialReference: mapView.spatialReference
                        };
                        
                        const result = await layer.queryFeatures({
                            geometry: extent,
                            spatialRelationship: "intersects",
                            returnGeometry: true,
                            outFields: ["*"]
                        });
                        
                        if (result.features.length > 0) {
                            let closestFeature = null;
                            let minDistance = Infinity;
                            
                            for (const feature of result.features) {
                                const distance = calculateDistance(mapPoint, feature.geometry);
                                if (distance < minDistance) {
                                    minDistance = distance;
                                    closestFeature = feature;
                                }
                            }
                            
                            if (closestFeature) {
                                return {
                                    feature: closestFeature,
                                    layer: layer,
                                    layerConfig: pointConfig
                                };
                            }
                        }
                    } catch (error) {
                        console.error("Error querying point layer in fallback:", error);
                    }
                }
            } catch (error) {
                console.error("Error finding point feature at location:", error);
            }
            
            return null;
        }
        
        function findClosestVertex(geometry, mapPoint) {
            if (!geometry || !geometry.paths) return null;
            
            let closestVertex = null;
            let minDistance = Infinity;
            
            for (let pathIndex = 0; pathIndex < geometry.paths.length; pathIndex++) {
                const path = geometry.paths[pathIndex];
                for (let pointIndex = 0; pointIndex < path.length; pointIndex++) {
                    const vertex = { x: path[pointIndex][0], y: path[pointIndex][1] };
                    const distance = calculateDistance(mapPoint, vertex);
                    
                    if (distance < minDistance) {
                        minDistance = distance;
                        closestVertex = {
                            pathIndex: pathIndex,
                            pointIndex: pointIndex,
                            distance: distance,
                            coordinates: vertex,
                            isEndpoint: isEndpoint(geometry, pathIndex, pointIndex)
                        };
                    }
                }
            }
            
            // Use fixed tolerance instead of resolution-based
            const tolerance = 50;
            return (closestVertex && closestVertex.distance < tolerance) ? closestVertex : null;
        }
        
        async function findCoincidentLinesForVertexCreation(screenPoint, mapPoint) {
            try {
                const coincidentLines = [];
                const bufferDistanceFeet = 10;
                const bufferDistanceMeters = bufferDistanceFeet / 3.28084;
                
                console.log(`Looking for lines to add vertex at: ${mapPoint.x}, ${mapPoint.y}`);
                
                // Try hit test first - this is often more reliable and efficient
                if (mapView.hitTest) {
                    const hitResponse = await mapView.hitTest(screenPoint, {
                        include: mapView.map.allLayers.filter(l => l.type === "feature")
                    });
                    
                    if (hitResponse.results.length > 0) {
                        for (const result of hitResponse.results) {
                            if (result.graphic && result.graphic.geometry && result.graphic.geometry.type === "polyline") {
                                const layerConfig = LAYER_CONFIG.lines.find(l => l.id === result.layer.layerId);
                                if (layerConfig) {
                                    const segmentInfo = findClosestLineSegment(result.graphic.geometry, mapPoint);
                                    if (segmentInfo && segmentInfo.distance <= bufferDistanceMeters) {
                                        console.log(`Hit test found line from layer: ${layerConfig.name}, distance: ${segmentInfo.distance.toFixed(1)}m`);
                                        coincidentLines.push({
                                            feature: result.graphic,
                                            layer: result.layer,
                                            layerConfig: layerConfig,
                                            segmentInfo: segmentInfo
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
                
                // Only query additional layers if hit test didn't find anything
                if (coincidentLines.length === 0) {
                    for (const lineConfig of LAYER_CONFIG.lines) {
                        try {
                            const layer = mapView.map.allLayers.find(l => l.layerId === lineConfig.id);
                            if (!layer || !layer.visible) {
                                continue;
                            }
                            
                            await layer.load();
                            
                            // Create a buffered point geometry for the query
                            const bufferedGeometry = {
                                type: "polygon",
                                spatialReference: mapPoint.spatialReference,
                                rings: [[
                                    [mapPoint.x - bufferDistanceMeters, mapPoint.y - bufferDistanceMeters],
                                    [mapPoint.x + bufferDistanceMeters, mapPoint.y - bufferDistanceMeters],
                                    [mapPoint.x + bufferDistanceMeters, mapPoint.y + bufferDistanceMeters],
                                    [mapPoint.x - bufferDistanceMeters, mapPoint.y + bufferDistanceMeters],
                                    [mapPoint.x - bufferDistanceMeters, mapPoint.y - bufferDistanceMeters]
                                ]]
                            };
                            
                            const result = await layer.queryFeatures({
                                geometry: bufferedGeometry,
                                spatialRelationship: "intersects",
                                returnGeometry: true,
                                outFields: ["*"],
                                maxRecordCount: 50
                            });
                            
                            console.log(`Layer ${lineConfig.name} returned ${result.features.length} features for vertex creation`);
                            
                            let foundForLayer = 0;
                            for (const feature of result.features) {
                                const segmentInfo = findClosestLineSegment(feature.geometry, mapPoint);
                                if (segmentInfo && segmentInfo.distance <= bufferDistanceMeters) {
                                    foundForLayer++;
                                    coincidentLines.push({
                                        feature: feature,
                                        layer: layer,
                                        layerConfig: lineConfig,
                                        segmentInfo: segmentInfo
                                    });
                                }
                            }
                            
                            if (foundForLayer > 0) {
                                console.log(`Found ${foundForLayer} lines in layer ${lineConfig.name} for vertex creation`);
                            }
                        } catch (error) {
                            console.error(`Error querying line layer ${lineConfig.name} for vertex creation:`, error);
                        }
                    }
                }
                
                console.log(`Found ${coincidentLines.length} lines total for vertex creation`);
                return coincidentLines;
            } catch (error) {
                console.error("Error in findCoincidentLinesForVertexCreation:", error);
                return [];
            }
        }
        
        async function findCoincidentLineVertices(screenPoint) {
            try {
                const coincidentLines = [];
                const clickMapPoint = mapView.toMap(screenPoint);
                const queryTolerance = 20; // Small extent for query
                const snapTolerance = 50; // Larger tolerance for snapping
                
                // Try hit test first - more efficient
                if (mapView.hitTest) {
                    const hitResponse = await mapView.hitTest(screenPoint, {
                        include: mapView.map.allLayers.filter(l => l.type === "feature")
                    });
                    
                    if (hitResponse.results.length > 0) {
                        for (const result of hitResponse.results) {
                            if (result.graphic && result.graphic.geometry && result.graphic.geometry.type === "polyline") {
                                const layerConfig = LAYER_CONFIG.lines.find(l => l.id === result.layer.layerId);
                                if (layerConfig) {
                                    const vertexInfo = findClosestVertex(result.graphic.geometry, clickMapPoint);
                                    if (vertexInfo && vertexInfo.distance < snapTolerance) {
                                        coincidentLines.push({
                                            feature: result.graphic,
                                            layer: result.layer,
                                            layerConfig: layerConfig,
                                            vertex: vertexInfo
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
                
                // Only query additional layers if hit test didn't find anything
                if (coincidentLines.length === 0) {
                    for (const lineConfig of LAYER_CONFIG.lines) {
                        try {
                            const layer = mapView.map.allLayers.find(l => l.layerId === lineConfig.id);
                            if (!layer || !layer.visible) continue;
                            
                            await layer.load();
                            
                            const extent = {
                                xmin: clickMapPoint.x - queryTolerance,
                                ymin: clickMapPoint.y - queryTolerance,
                                xmax: clickMapPoint.x + queryTolerance,
                                ymax: clickMapPoint.y + queryTolerance,
                                spatialReference: mapView.spatialReference
                            };
                            
                            const result = await layer.queryFeatures({
                                geometry: extent,
                                spatialRelationship: "intersects",
                                returnGeometry: true,
                                outFields: ["*"],
                                maxRecordCount: 50
                            });
                            
                            if (result.features.length > 25) {
                                console.warn(`Layer ${lineConfig.name} returned ${result.features.length} features for vertex selection - query area may be too large`);
                            }
                            
                            for (const feature of result.features) {
                                const vertexInfo = findClosestVertex(feature.geometry, clickMapPoint);
                                if (vertexInfo && vertexInfo.distance < snapTolerance) {
                                    coincidentLines.push({
                                        feature: feature,
                                        layer: layer,
                                        layerConfig: lineConfig,
                                        vertex: vertexInfo
                                    });
                                }
                            }
                        } catch (error) {
                            console.error("Error querying line layer for vertices:", error);
                        }
                    }
                }
                
                if (coincidentLines.length > 0) {
                    const referenceVertex = coincidentLines[0].vertex.coordinates;
                    const groupedLines = [];
                    
                    for (const lineInfo of coincidentLines) {
                        if (calculateDistance(referenceVertex, lineInfo.vertex.coordinates) < snapTolerance) {
                            groupedLines.push(lineInfo);
                        }
                    }
                    return groupedLines;
                }
                
                return [];
            } catch (error) {
                console.error("Error finding coincident line vertices:", error);
                return [];
            }
        }
        
        async function findConnectedLines(pointGeometry) {
            const connected = [];
            const bufferDistanceFeet = 10;
            // Convert feet to meters for Web Mercator (approximately 3.28 feet per meter)
            const bufferDistanceMeters = bufferDistanceFeet / 3.28084;
            
            console.log(`Looking for connected lines near point: ${pointGeometry.x}, ${pointGeometry.y}`);
            
            for (const lineConfig of LAYER_CONFIG.lines) {
                try {
                    const layer = mapView.map.allLayers.find(l => l.layerId === lineConfig.id);
                    if (!layer || !layer.visible) {
                        continue;
                    }
                    
                    await layer.load();
                    
                    // Create a buffered point geometry for the query
                    const bufferedGeometry = {
                        type: "polygon",
                        spatialReference: pointGeometry.spatialReference,
                        rings: [[
                            [pointGeometry.x - bufferDistanceMeters, pointGeometry.y - bufferDistanceMeters],
                            [pointGeometry.x + bufferDistanceMeters, pointGeometry.y - bufferDistanceMeters],
                            [pointGeometry.x + bufferDistanceMeters, pointGeometry.y + bufferDistanceMeters],
                            [pointGeometry.x - bufferDistanceMeters, pointGeometry.y + bufferDistanceMeters],
                            [pointGeometry.x - bufferDistanceMeters, pointGeometry.y - bufferDistanceMeters]
                        ]]
                    };
                    
                    const result = await layer.queryFeatures({
                        geometry: bufferedGeometry,
                        spatialRelationship: "intersects",
                        returnGeometry: true,
                        outFields: ["*"],
                        maxRecordCount: 100
                    });
                    
                    console.log(`Layer ${lineConfig.name} returned ${result.features.length} features`);
                    
                    let foundConnections = 0;
                    
                    for (const feature of result.features) {
                        const geometry = feature.geometry;
                        if (!geometry || !geometry.paths) continue;
                        
                        let connectionInfo = null;
                        for (let pathIndex = 0; pathIndex < geometry.paths.length; pathIndex++) {
                            const path = geometry.paths[pathIndex];
                            if (path.length < 2) continue;
                            
                            const startPoint = { x: path[0][0], y: path[0][1] };
                            const endPoint = { x: path[path.length - 1][0], y: path[path.length - 1][1] };
                            
                            const startDistance = calculateDistance(pointGeometry, startPoint);
                            const endDistance = calculateDistance(pointGeometry, endPoint);
                            
                            // Use the buffer distance for connection detection
                            if (startDistance < bufferDistanceMeters) {
                                connectionInfo = { pathIndex, pointIndex: 0, isStart: true };
                                foundConnections++;
                                console.log(`Found connection at start of feature ${feature.attributes.objectid}, distance: ${startDistance.toFixed(1)}m`);
                                break;
                            } else if (endDistance < bufferDistanceMeters) {
                                connectionInfo = { pathIndex, pointIndex: path.length - 1, isStart: false };
                                foundConnections++;
                                console.log(`Found connection at end of feature ${feature.attributes.objectid}, distance: ${endDistance.toFixed(1)}m`);
                                break;
                            }
                        }
                        
                        if (connectionInfo) {
                            connected.push({
                                feature: feature,
                                layer: layer,
                                layerConfig: lineConfig,
                                connection: connectionInfo
                            });
                            
                            if (geometry.clone) {
                                originalGeometries.set(feature.attributes.objectid, geometry.clone());
                            }
                        }
                    }
                    
                    if (foundConnections > 0) {
                        console.log(`Found ${foundConnections} connections in layer ${lineConfig.name}`);
                    }
                } catch (error) {
                    console.error(`Error finding connected lines for layer ${lineConfig.name}:`, error);
                }
            }
            
            console.log(`Found ${connected.length} connected lines total`);
            return connected;
        }
        
        async function updateConnectedLines(newPointGeometry) {
            const updates = [];
            
            for (const connectedInfo of connectedFeatures) {
                try {
                    const originalGeometry = originalGeometries.get(connectedInfo.feature.attributes.objectid);
                    if (!originalGeometry || !originalGeometry.clone) continue;
                    
                    const newGeometry = originalGeometry.clone();
                    const connection = connectedInfo.connection;
                    
                    if (newGeometry.paths && newGeometry.paths[connection.pathIndex]) {
                        const path = newGeometry.paths[connection.pathIndex];
                        path[connection.pointIndex] = [newPointGeometry.x, newPointGeometry.y];
                    }
                    
                    const updatedFeature = connectedInfo.feature.clone();
                    updatedFeature.geometry = newGeometry;
                    
                    const newLength = calculateGeodeticLength(newGeometry);
                    updatedFeature.attributes.calculated_length = newLength;
                    
                    updates.push({
                        layer: connectedInfo.layer,
                        feature: updatedFeature
                    });
                } catch (error) {
                    console.error("Error preparing connected line update:", error);
                }
            }
            
            for (const update of updates) {
                try {
                    if (update.layer.applyEdits) {
                        await update.layer.applyEdits({ updateFeatures: [update.feature] });
                    }
                } catch (error) {
                    console.error("Error applying connected line update:", error);
                }
            }
        }
        
        async function addVertexToLine(event) {
            const screenPoint = { x: event.x, y: event.y };
            const mapPoint = mapView.toMap(screenPoint);
            
            updateStatus("Adding vertex to line...");
            
            try {
                console.log("Add vertex triggered - searching for lines...");
                const coincidentLines = await findCoincidentLinesForVertexCreation(screenPoint, mapPoint);
                console.log(`Found ${coincidentLines.length} lines for vertex addition`);
                
                if (coincidentLines.length === 0) {
                    updateStatus("❌ No lines found to add vertex to.");
                    return;
                }
                
                let addedCount = 0;
                const updates = [];
                
                for (const lineInfo of coincidentLines) {
                    try {
                        const updatedFeature = lineInfo.feature.clone();
                        const newGeometry = updatedFeature.geometry.clone();
                        const path = newGeometry.paths[lineInfo.segmentInfo.pathIndex];
                        
                        console.log(`Adding vertex to ${lineInfo.layerConfig.name} at path ${lineInfo.segmentInfo.pathIndex}, insert at ${lineInfo.segmentInfo.insertIndex}`);
                        
                        path.splice(lineInfo.segmentInfo.insertIndex, 0, [lineInfo.segmentInfo.point.x, lineInfo.segmentInfo.point.y]);
                        
                        const newLength = calculateGeodeticLength(newGeometry);
                        updatedFeature.geometry = newGeometry;
                        updatedFeature.attributes.calculated_length = newLength;
                        
                        updates.push({
                            layer: lineInfo.layer,
                            feature: updatedFeature,
                            layerName: lineInfo.layerConfig.name,
                            newLength: newLength
                        });
                        addedCount++;
                    } catch (error) {
                        console.error(`Error preparing vertex addition for ${lineInfo.layerConfig.name}:`, error);
                    }
                }
                
                if (updates.length === 0) {
                    updateStatus("❌ No vertices could be added.");
                    return;
                }
                
                for (const update of updates) {
                    try {
                        if (update.layer.applyEdits) {
                            await update.layer.applyEdits({ updateFeatures: [update.feature] });
                            console.log(`Successfully added vertex to ${update.layerName}`);
                        }
                    } catch (error) {
                        console.error(`Error adding vertex to ${update.layerName}:`, error);
                    }
                }
                
                const lineNames = updates.map(u => u.layerName).join(", ");
                updateStatus(`✅ Added vertex to ${addedCount} coincident line(s): ${lineNames}!`);
                
                setTimeout(() => {
                    updateStatus("Line mode active. Click on a line vertex to select it, or use Ctrl+Click to add / Alt+Click to delete vertices.");
                }, 3000);
            } catch (error) {
                console.error("Error adding vertex to line:", error);
                updateStatus("❌ Error adding vertex to line.");
            }
        }
        
        async function deleteVertexFromLine(event) {
            const screenPoint = { x: event.x, y: event.y };
            
            updateStatus("Deleting vertex from line...");
            
            try {
                const results = await findCoincidentLineVertices(screenPoint);
                if (results.length === 0) {
                    updateStatus("❌ No line vertex found to delete.");
                    return;
                }
                
                let deletedCount = 0;
                const updates = [];
                
                for (const lineInfo of results) {
                    try {
                        if (lineInfo.vertex.isEndpoint) continue;
                        
                        const updatedFeature = lineInfo.feature.clone();
                        const newGeometry = updatedFeature.geometry.clone();
                        const path = newGeometry.paths[lineInfo.vertex.pathIndex];
                        
                        if (path.length <= 2) continue;
                        
                        path.splice(lineInfo.vertex.pointIndex, 1);
                        
                        const newLength = calculateGeodeticLength(newGeometry);
                        updatedFeature.geometry = newGeometry;
                        updatedFeature.attributes.calculated_length = newLength;
                        
                        updates.push({
                            layer: lineInfo.layer,
                            feature: updatedFeature,
                            layerName: lineInfo.layerConfig.name,
                            newLength: newLength
                        });
                        deletedCount++;
                    } catch (error) {
                        console.error("Error preparing vertex deletion:", error);
                    }
                }
                
                if (updates.length === 0) {
                    updateStatus("❌ No vertices could be deleted (endpoints and 2-vertex lines are protected).");
                    return;
                }
                
                for (const update of updates) {
                    try {
                        if (update.layer.applyEdits) {
                            await update.layer.applyEdits({ updateFeatures: [update.feature] });
                        }
                    } catch (error) {
                        console.error("Error applying vertex deletion:", error);
                    }
                }
                
                updateStatus(`✅ Deleted vertex from ${deletedCount} line(s) and recalculated lengths!`);
                setTimeout(() => {
                    updateStatus("Line mode active. Click on a line vertex to select it, or use Ctrl+Click to add / Alt+Click to delete vertices.");
                }, 3000);
            } catch (error) {
                console.error("Error deleting vertex from line:", error);
                updateStatus("❌ Error deleting vertex from line.");
            }
        }
        
        async function handleFeatureSelection(event) {
            const screenPoint = { x: event.x, y: event.y };
            updateStatus("Searching for feature...");
            
            if (currentMode === "point") {
                const result = await findPointFeatureAtLocation(screenPoint);
                if (result) {
                    selectedFeature = result.feature;
                    selectedLayer = result.layer;
                    selectedLayerConfig = result.layerConfig;
                    selectedVertex = null;
                    connectedFeatures = await findConnectedLines(result.feature.geometry);
                    
                    if (selectedFeature.geometry && selectedFeature.geometry.clone) {
                        originalGeometries.set(selectedFeature.attributes.objectid, selectedFeature.geometry.clone());
                    }
                    
                    if (cancelBtn) cancelBtn.disabled = false;
                    updateStatus(`🎯 ${result.layerConfig.name} selected with ${connectedFeatures.length} connected lines. Click destination to move.`);
                } else {
                    updateStatus("❌ No point feature found.");
                }
            } else if (currentMode === "line") {
                const results = await findCoincidentLineVertices(screenPoint);
                if (results.length > 0) {
                    selectedCoincidentLines = results;
                    selectedFeature = results[0].feature;
                    selectedLayer = results[0].layer;
                    selectedLayerConfig = results[0].layerConfig;
                    selectedVertex = results[0].vertex;
                    
                    for (const lineInfo of results) {
                        if (lineInfo.feature.geometry && lineInfo.feature.geometry.clone) {
                            originalGeometries.set(lineInfo.feature.attributes.objectid, lineInfo.feature.geometry.clone());
                        }
                    }
                    
                    if (cancelBtn) cancelBtn.disabled = false;
                    
                    const vertexType = results[0].vertex.isEndpoint ? "endpoint" : "vertex";
                    const lineNames = results.map(r => r.layerConfig.name).join(", ");
                    const snapNote = results[0].vertex.isEndpoint ? " (will snap to nearest point)" : "";
                    updateStatus(`🎯 Selected ${vertexType} on ${results.length} coincident lines: ${lineNames}${snapNote}. Click destination to move.`);
                } else {
                    updateStatus("❌ No line vertex found.");
                }
            }
        }
        
        async function handleClick(event) {
            if (!toolActive) return;
            
            event.stopPropagation();
            
            // Handle vertex modification modes first
            if (vertexMode === "add") {
                console.log("Add vertex mode - handling click");
                await addVertexToLine(event);
                return;
            }
            
            if (vertexMode === "delete") {
                console.log("Delete vertex mode - handling click");
                await deleteVertexFromLine(event);
                return;
            }
            
            // Handle feature selection and movement
            if (!selectedFeature) {
                await handleFeatureSelection(event);
            } else if (!waitingForDestination) {
                waitingForDestination = true;
                updateStatus("Now click where you want to move the feature to...");
            } else {
                await handleMoveToDestination(event);
            }
        }
        
        async function handleMoveToDestination(event) {
            let destinationPoint = mapView.toMap({ x: event.x, y: event.y });
            
            updateStatus("Moving feature...");
            
            try {
                if (currentMode === "point") {
                    await updateConnectedLines(destinationPoint);
                    
                    const updatedFeature = selectedFeature.clone();
                    updatedFeature.geometry = destinationPoint;
                    
                    if (selectedLayer.applyEdits) {
                        await selectedLayer.applyEdits({ updateFeatures: [updatedFeature] });
                    }
                    
                    updateStatus(`✅ Moved ${selectedLayerConfig.name} and ${connectedFeatures.length} connected lines!`);
                } else if (currentMode === "line") {
                    let snapInfo = null;
                    const isMovingEndpoints = selectedCoincidentLines.some(lineInfo => lineInfo.vertex.isEndpoint);
                    
                    if (isMovingEndpoints) {
                        snapInfo = await findNearestPointFeature(destinationPoint);
                        if (snapInfo) destinationPoint = snapInfo.geometry;
                    }
                    
                    const updates = [];
                    for (const lineInfo of selectedCoincidentLines) {
                        try {
                            const updatedFeature = lineInfo.feature.clone();
                            const newGeometry = updatedFeature.geometry.clone();
                            
                            if (newGeometry.paths && newGeometry.paths[lineInfo.vertex.pathIndex]) {
                                const path = newGeometry.paths[lineInfo.vertex.pathIndex];
                                if (path[lineInfo.vertex.pointIndex]) {
                                    path[lineInfo.vertex.pointIndex] = [destinationPoint.x, destinationPoint.y];
                                }
                            }
                            
                            const newLength = calculateGeodeticLength(newGeometry);
                            updatedFeature.geometry = newGeometry;
                            updatedFeature.attributes.calculated_length = newLength;
                            
                            updates.push({
                                layer: lineInfo.layer,
                                feature: updatedFeature,
                                layerName: lineInfo.layerConfig.name,
                                newLength: newLength
                            });
                        } catch (error) {
                            console.error("Error preparing line move:", error);
                        }
                    }
                    
                    let successCount = 0;
                    for (const update of updates) {
                        try {
                            if (update.layer.applyEdits) {
                                await update.layer.applyEdits({ updateFeatures: [update.feature] });
                                successCount++;
                            }
                        } catch (error) {
                            console.error("Error applying line move:", error);
                        }
                    }
                    
                    const vertexType = selectedVertex.isEndpoint ? "endpoint" : "vertex";
                    let statusMessage = `✅ Moved ${vertexType} on ${successCount} coincident lines and recalculated lengths!`;
                    if (snapInfo) statusMessage += ` Snapped to ${snapInfo.layerConfig.name}.`;
                    
                    updateStatus(statusMessage);
                }
                
                // Reset selection state
                selectedFeature = null;
                selectedLayer = null;
                selectedLayerConfig = null;
                selectedVertex = null;
                selectedCoincidentLines = [];
                waitingForDestination = false;
                connectedFeatures = [];
                originalGeometries.clear();
                if (cancelBtn) cancelBtn.disabled = true;
                
                setTimeout(() => {
                    const modeText = currentMode === "point" ? "point feature" : "line vertex";
                    const hotkeys = currentMode === "line" ? " Use Ctrl+Click to add / Alt+Click to delete vertices." : "";
                    updateStatus(`Ready. Click on a ${modeText} to select it.${hotkeys}`);
                }, 3000);
                
            } catch (error) {
                console.error("Error moving feature:", error);
                updateStatus("❌ Error moving feature.");
            }
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
            if (cancelBtn) cancelBtn.disabled = true;
            
            if (vertexMode === "add") {
                updateStatus("Add Vertex mode active. Click on any line segment to add a vertex.");
            } else if (vertexMode === "delete") {
                updateStatus("Delete Vertex mode active. Click on any vertex to delete it.");
            } else {
                const modeText = currentMode === "point" ? "point feature" : "line vertex";
                updateStatus(`Move cancelled. Click on a ${modeText} to select it.`);
            }
        }
        
        function setAddVertexMode() {
            vertexMode = vertexMode === "add" ? "none" : "add";
            if (addVertexBtn) addVertexBtn.style.background = vertexMode === "add" ? "#28a745" : "#666";
            if (deleteVertexBtn) deleteVertexBtn.style.background = "#666";
            if (vertexMode === "delete") vertexMode = "none";
            
            if (selectedFeature) cancelMove();
            
            if (toolActive) {
                updateStatus(vertexMode === "add" ? 
                    "Add Vertex mode active. Click anywhere on a line to add a vertex at that location." : 
                    "Mode cleared. Click on features to select them.");
            }
        }
        
        function setDeleteVertexMode() {
            vertexMode = vertexMode === "delete" ? "none" : "delete";
            if (deleteVertexBtn) deleteVertexBtn.style.background = vertexMode === "delete" ? "#dc3545" : "#666";
            if (addVertexBtn) addVertexBtn.style.background = "#666";
            if (vertexMode === "add") vertexMode = "none";
            
            if (selectedFeature) cancelMove();
            
            if (toolActive) {
                updateStatus(vertexMode === "delete" ? 
                    "Delete Vertex mode active. Click on any existing vertex to delete it." : 
                    "Mode cleared. Click on features to select them.");
            }
        }
        
        function setPointMode() {
            currentMode = "point";
            vertexMode = "none";
            if (pointModeBtn) pointModeBtn.style.background = "#3367d6";
            if (lineModeBtn) lineModeBtn.style.background = "#666";
            if (addVertexBtn) addVertexBtn.style.background = "#666";
            if (deleteVertexBtn) deleteVertexBtn.style.background = "#666";
            
            if (toolActive) updateStatus("Point mode active. Click on a point feature to select it.");
            if (selectedFeature) cancelMove();
        }
        
        function setLineMode() {
            currentMode = "line";
            vertexMode = "none";
            if (pointModeBtn) pointModeBtn.style.background = "#666";
            if (lineModeBtn) lineModeBtn.style.background = "#3367d6";
            if (addVertexBtn) addVertexBtn.style.background = "#666";
            if (deleteVertexBtn) deleteVertexBtn.style.background = "#666";
            
            if (toolActive) updateStatus("Line mode active. Click on a line vertex to select it.");
            if (selectedFeature) cancelMove();
        }
        
        function enableTool() {
            toolActive = true;
            clickHandler = mapView.on("click", handleClick);
            if (enableBtn) enableBtn.disabled = true;
            if (disableBtn) disableBtn.disabled = false;
            if (mapView.container) mapView.container.style.cursor = "crosshair";
            
            const modeText = currentMode === "point" ? "point feature" : "line vertex";
            updateStatus(`Tool enabled in ${currentMode} mode. Click on a ${modeText} to select it.`);
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
            
            if (addVertexBtn) addVertexBtn.style.background = "#666";
            if (deleteVertexBtn) deleteVertexBtn.style.background = "#666";
            
            if (clickHandler) clickHandler.remove();
            if (enableBtn) enableBtn.disabled = false;
            if (disableBtn) disableBtn.disabled = true;
            if (cancelBtn) cancelBtn.disabled = true;
            if (mapView.container) mapView.container.style.cursor = "default";
            
            updateStatus("Tool disabled.");
        }
        
        // Event listeners with null checks
        if (pointModeBtn) pointModeBtn.onclick = setPointMode;
        if (lineModeBtn) lineModeBtn.onclick = setLineMode;
        if (addVertexBtn) addVertexBtn.onclick = setAddVertexMode;
        if (deleteVertexBtn) deleteVertexBtn.onclick = setDeleteVertexMode;
        if (enableBtn) enableBtn.onclick = enableTool;
        if (disableBtn) disableBtn.onclick = disableTool;
        if (cancelBtn) cancelBtn.onclick = cancelMove;
        if (closeBtn) {
            closeBtn.onclick = () => {
                disableTool();
                toolBox.remove();
                // Safe removal from active tools
                if (window.gisToolHost && window.gisToolHost.activeTools && window.gisToolHost.activeTools instanceof Set) {
                    window.gisToolHost.activeTools.delete('snap-move-tool');
                }
            };
        }
        
        // Initialize
        setPointMode();
        
        // Register tool as active
        window.gisToolHost.activeTools.add('snap-move-tool');
        
        updateStatus("Click-to-Move Tool loaded. Select mode and click 'Enable Tool' to start.");
        
    } catch (error) {
        console.error("Error creating snap-move tool:", error);
        alert("Error creating tool: " + (error.message || error));
    }
})();
