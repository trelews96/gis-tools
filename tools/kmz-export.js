// tools/kmz-export.js - KMZ Export Tool for ArcGIS Online
// Allows users to draw a polygon and export features from selected layers as KMZ

(function() {
    try {
        // Check if tool is already active
        if (window.gisToolHost && window.gisToolHost.activeTools && window.gisToolHost.activeTools.has('kmz-export')) {
            console.log('KMZ Export Tool already active');
            return;
        }
        
        // Remove any leftover toolbox
        const existingToolbox = document.getElementById('kmzExportToolbox');
        if (existingToolbox) {
            existingToolbox.remove();
            console.log('Removed leftover KMZ export toolbox');
        }
        
        // Use shared utilities or get mapView directly
        let mapView;
        if (window.gisSharedUtils) {
            mapView = window.gisSharedUtils.getMapView();
        } else {
            // Fallback: try to find mapView in window
            mapView = window.mapView || (window.esriConfig && window.esriConfig.mapView);
        }
        
        if (!mapView) {
            throw new Error('MapView not found. Ensure map is loaded.');
        }
        
        const z = 99999;
        
        // Tool state variables
        let polygonGraphic = null;
        let selectedLayers = [];
        let availableLayers = [];
        let isDrawing = false;
        let drawingPoints = [];
        let tempGraphics = [];
        let clickHandler = null;
        
        // Create tool UI
        const toolBox = document.createElement("div");
        toolBox.id = "kmzExportToolbox";
        toolBox.style.cssText = `
            position: fixed;
            top: 80px;
            right: 40px;
            z-index: ${z};
            background: #fff;
            border: 1px solid #333;
            padding: 12px;
            max-width: 450px;
            max-height: 85vh;
            overflow: auto;
            font: 12px/1.3 Arial, sans-serif;
            box-shadow: 0 4px 16px rgba(0,0,0,.2);
            resize: both;
        `;
        
        toolBox.innerHTML = `
            <div style="font-weight:bold;margin-bottom:12px;">🗺️ KMZ Export Tool</div>
            
            <div style="margin-bottom:12px;">
                <div style="font-weight:bold;margin-bottom:8px;">Step 1: Select Layers to Export</div>
                <div id="layerCheckboxes" style="max-height:200px;overflow-y:auto;border:1px solid #ddd;padding:8px;background:#f9f9f9;">
                    <div style="color:#666;font-style:italic;">Loading layers...</div>
                </div>
                <div style="margin-top:4px;">
                    <button id="selectAllBtn" style="font-size:11px;padding:2px 8px;">Select All</button>
                    <button id="deselectAllBtn" style="font-size:11px;padding:2px 8px;">Deselect All</button>
                </div>
            </div>
            
            <div style="margin-bottom:12px;">
                <div style="font-weight:bold;margin-bottom:8px;">Step 2: Draw Export Area</div>
                <button id="drawPolygonBtn">Start Drawing Polygon</button>
                <button id="finishPolygonBtn" style="display:none;background:#2e7d32;color:white;">Finish Polygon</button>
                <button id="clearPolygonBtn" style="display:none;">Clear & Restart</button>
                <div id="polygonStatus" style="margin-top:4px;font-size:11px;color:#666;"></div>
                <div style="margin-top:4px;font-size:10px;color:#999;font-style:italic;">
                    Click points on map to draw polygon. At least 3 points required.
                </div>
            </div>
            
            <div style="margin-bottom:12px;">
                <div style="font-weight:bold;margin-bottom:8px;">Step 3: Export Options</div>
                <div style="margin-top:4px;">
                    <input type="checkbox" id="includeSymbology" checked>
                    <label for="includeSymbology">Include Layer Symbology</label>
                </div>
                <div>
                    <input type="checkbox" id="includeAttributes" checked>
                    <label for="includeAttributes">Include Feature Attributes</label>
                </div>
                <div style="margin-top:4px;">
                    <label>Export Filename:</label>
                    <input type="text" id="exportFilename" value="export" style="width:100%;padding:4px;margin-top:2px;border:1px solid #ccc;">
                    <div style="font-size:10px;color:#666;margin-top:2px;">Will be saved as: [filename]_YYYY-MM-DD.kmz</div>
                </div>
            </div>
            
            <div style="margin-bottom:12px;">
                <button id="exportBtn" style="background:#2e7d32;color:white;font-weight:bold;padding:8px 16px;">Export to KMZ</button>
            </div>
            
            <button id="closeTool" style="margin-top:8px;">Close Tool</button>
            <div id="toolStatus" style="margin-top:8px;color:#3367d6;font-weight:bold;"></div>
            <div id="resultsDiv" style="margin-top:12px;"></div>
        `;
        
        document.body.appendChild(toolBox);
        
        // Helper function for element selection
        const $ = (id) => toolBox.querySelector(id);
        const status = $("#toolStatus");
        
        function updateStatus(message) {
            status.textContent = message;
            console.log('KMZ Export:', message);
        }
        
        // Discover available feature layers from the map
        function getAvailableFeatureLayers() {
            const layers = [];
            mapView.map.allLayers.forEach(layer => {
                if (layer.type === "feature" && layer.visible) {
                    layers.push({
                        id: layer.id,
                        layerId: layer.layerId,
                        title: layer.title || `Layer ${layer.layerId}`,
                        url: layer.url,
                        geometryType: layer.geometryType,
                        layer: layer
                    });
                }
            });
            return layers;
        }
        
        // Build layer checkbox UI
        function buildLayerCheckboxes() {
            availableLayers = getAvailableFeatureLayers();
            const container = $("#layerCheckboxes");
            
            if (availableLayers.length === 0) {
                container.innerHTML = '<div style="color:#d32f2f;">No visible feature layers found in map.</div>';
                return;
            }
            
            let html = '';
            availableLayers.forEach(layer => {
                html += `
                    <div style="margin:4px 0;">
                        <input type="checkbox" 
                               id="layer_${layer.id}" 
                               value="${layer.id}" 
                               class="layer-checkbox">
                        <label for="layer_${layer.id}" style="cursor:pointer;">
                            ${layer.title}
                            <span style="font-size:10px;color:#666;">(${layer.geometryType || 'unknown'})</span>
                        </label>
                    </div>
                `;
            });
            
            container.innerHTML = html;
            updateStatus(`Found ${availableLayers.length} feature layer(s) in map.`);
        }
        
        // Select/Deselect all layers
        function selectAllLayers() {
            const checkboxes = toolBox.querySelectorAll('.layer-checkbox');
            checkboxes.forEach(cb => cb.checked = true);
            updateSelectedLayers();
        }
        
        function deselectAllLayers() {
            const checkboxes = toolBox.querySelectorAll('.layer-checkbox');
            checkboxes.forEach(cb => cb.checked = false);
            updateSelectedLayers();
        }
        
        function updateSelectedLayers() {
            const checkboxes = toolBox.querySelectorAll('.layer-checkbox:checked');
            selectedLayers = Array.from(checkboxes).map(cb => cb.value);
        }
        
        // Simple click-based polygon drawing
        function startPolygonDrawing() {
            if (isDrawing) {
                updateStatus("Already drawing. Finish current polygon first.");
                return;
            }
            
            clearPolygon();
            isDrawing = true;
            drawingPoints = [];
            tempGraphics = [];
            
            $("#drawPolygonBtn").style.display = "none";
            $("#finishPolygonBtn").style.display = "inline-block";
            $("#clearPolygonBtn").style.display = "inline-block";
            $("#polygonStatus").textContent = "Click on map to add points (need at least 3)";
            $("#polygonStatus").style.color = "#3367d6";
            
            // Add click handler to map
            clickHandler = mapView.on("click", handleMapClick);
            
            updateStatus("Drawing mode active. Click on the map to add points.");
        }
        
        function handleMapClick(event) {
            if (!isDrawing) return;
            
            // Add point to array
            const point = {
                x: event.mapPoint.x,
                y: event.mapPoint.y,
                spatialReference: event.mapPoint.spatialReference
            };
            drawingPoints.push(point);
            
            // Draw point marker
            const pointGraphic = {
                geometry: {
                    type: "point",
                    x: point.x,
                    y: point.y,
                    spatialReference: point.spatialReference
                },
                symbol: {
                    type: "simple-marker",
                    color: [51, 103, 214],
                    size: 8,
                    outline: {
                        color: [255, 255, 255],
                        width: 2
                    }
                }
            };
            mapView.graphics.add(pointGraphic);
            tempGraphics.push(pointGraphic);
            
            // Draw lines between points
            if (drawingPoints.length > 1) {
                const lineGraphic = {
                    geometry: {
                        type: "polyline",
                        paths: [[
                            [drawingPoints[drawingPoints.length - 2].x, drawingPoints[drawingPoints.length - 2].y],
                            [point.x, point.y]
                        ]],
                        spatialReference: point.spatialReference
                    },
                    symbol: {
                        type: "simple-line",
                        color: [51, 103, 214],
                        width: 2,
                        style: "solid"
                    }
                };
                mapView.graphics.add(lineGraphic);
                tempGraphics.push(lineGraphic);
            }
            
            // Update status
            const pointsNeeded = Math.max(0, 3 - drawingPoints.length);
            if (drawingPoints.length >= 3) {
                $("#polygonStatus").textContent = `${drawingPoints.length} points added. Click 'Finish Polygon' or add more points.`;
                $("#polygonStatus").style.color = "#2e7d32";
            } else {
                $("#polygonStatus").textContent = `${drawingPoints.length} point(s) added. Need ${pointsNeeded} more.`;
                $("#polygonStatus").style.color = "#ff9800";
            }
            
            console.log(`Point ${drawingPoints.length} added:`, point);
        }
        
        function finishPolygon() {
            if (!isDrawing) return;
            
            if (drawingPoints.length < 3) {
                alert("Need at least 3 points to create a polygon.");
                return;
            }
            
            // Stop drawing mode
            isDrawing = false;
            if (clickHandler) {
                clickHandler.remove();
                clickHandler = null;
            }
            
            // Create polygon geometry
            const rings = [drawingPoints.map(p => [p.x, p.y])];
            // Close the ring
            rings[0].push([drawingPoints[0].x, drawingPoints[0].y]);
            
            // Clear temporary graphics
            tempGraphics.forEach(g => mapView.graphics.remove(g));
            tempGraphics = [];
            
            // Create final polygon graphic
            polygonGraphic = {
                geometry: {
                    type: "polygon",
                    rings: rings,
                    spatialReference: drawingPoints[0].spatialReference
                },
                symbol: {
                    type: "simple-fill",
                    color: [51, 103, 214, 0.25],
                    outline: {
                        color: [51, 103, 214],
                        width: 3
                    }
                }
            };
            
            mapView.graphics.add(polygonGraphic);
            
            $("#drawPolygonBtn").style.display = "inline-block";
            $("#finishPolygonBtn").style.display = "none";
            $("#polygonStatus").textContent = `✓ Polygon created with ${drawingPoints.length} points`;
            $("#polygonStatus").style.color = "#2e7d32";
            
            updateStatus(`Polygon complete with ${drawingPoints.length} points. Ready to export!`);
            console.log('Polygon created:', polygonGraphic.geometry);
        }
        
        function clearPolygon() {
            // Stop drawing if active
            if (isDrawing) {
                isDrawing = false;
                if (clickHandler) {
                    clickHandler.remove();
                    clickHandler = null;
                }
            }
            
            // Clear all graphics
            if (polygonGraphic) {
                mapView.graphics.remove(polygonGraphic);
                polygonGraphic = null;
            }
            
            tempGraphics.forEach(g => mapView.graphics.remove(g));
            tempGraphics = [];
            drawingPoints = [];
            
            $("#drawPolygonBtn").style.display = "inline-block";
            $("#finishPolygonBtn").style.display = "none";
            $("#clearPolygonBtn").style.display = "none";
            $("#polygonStatus").textContent = "";
            
            updateStatus("Polygon cleared. Click 'Start Drawing Polygon' to begin.");
        }
        
        // Convert geometry to WGS84 (required for KML/KMZ) - Manual implementation
        async function convertToWGS84(geometry) {
            // Get the wkid from spatial reference (handle both object and Accessor)
            let wkid;
            if (geometry.spatialReference) {
                wkid = geometry.spatialReference.wkid || geometry.spatialReference.latestWkid;
            }
            
            // Check if already in WGS84
            if (wkid === 4326) {
                return geometry;
            }
            
            // Manual conversion from Web Mercator (3857) to WGS84 (4326)
            if (wkid === 3857 || wkid === 102100) {
                const converted = {
                    type: geometry.type,
                    spatialReference: { wkid: 4326 }
                };
                
                if (geometry.type === 'point') {
                    const [lon, lat] = webMercatorToWGS84(geometry.x, geometry.y);
                    converted.x = lon;
                    converted.y = lat;
                } else if (geometry.type === 'polyline') {
                    converted.paths = geometry.paths.map(path =>
                        path.map(coord => webMercatorToWGS84(coord[0], coord[1]))
                    );
                } else if (geometry.type === 'polygon') {
                    converted.rings = geometry.rings.map(ring =>
                        ring.map(coord => webMercatorToWGS84(coord[0], coord[1]))
                    );
                }
                
                return converted;
            }
            
            // If unknown spatial reference, log warning once
            if (wkid !== 4326 && wkid !== 3857 && wkid !== 102100) {
                console.warn('Unknown spatial reference WKID:', wkid, '- attempting to use coordinates as-is');
            }
            
            return geometry;
        }
        
        // Web Mercator to WGS84 conversion formula
        function webMercatorToWGS84(x, y) {
            const earthRadius = 6378137.0; // Earth's radius in meters
            const lon = (x / earthRadius) * (180 / Math.PI);
            const lat = (Math.atan(Math.exp(y / earthRadius)) * 2 - Math.PI / 2) * (180 / Math.PI);
            return [lon, lat];
        }
        
        // Format coordinates for KML
        function formatCoordinates(coords) {
            // KML format: lon,lat,alt (altitude optional, use 0)
            if (Array.isArray(coords[0])) {
                // Array of coordinates
                return coords.map(c => `${c[0]},${c[1]},0`).join(' ');
            } else {
                // Single coordinate
                return `${coords[0]},${coords[1]},0`;
            }
        }
        
        // Convert Point geometry to KML
        function pointToKML(geometry) {
            return `
                <Point>
                    <coordinates>${formatCoordinates([geometry.x, geometry.y])}</coordinates>
                </Point>`;
        }
        
        // Convert Polyline geometry to KML
        function polylineToKML(geometry) {
            let kml = '<MultiGeometry>';
            geometry.paths.forEach(path => {
                kml += `
                <LineString>
                    <coordinates>${formatCoordinates(path)}</coordinates>
                </LineString>`;
            });
            kml += '</MultiGeometry>';
            return kml;
        }
        
        // Convert Polygon geometry to KML
        function polygonToKML(geometry) {
            let kml = '<MultiGeometry>';
            geometry.rings.forEach((ring, index) => {
                kml += `
                <Polygon>
                    <outerBoundaryIs>
                        <LinearRing>
                            <coordinates>${formatCoordinates(ring)}</coordinates>
                        </LinearRing>
                    </outerBoundaryIs>
                </Polygon>`;
            });
            kml += '</MultiGeometry>';
            return kml;
        }
        
        // Convert feature attributes to KML ExtendedData
        function attributesToKML(attributes, includeAttributes) {
            if (!includeAttributes) return '';
            
            let kml = '<ExtendedData>';
            for (const [key, value] of Object.entries(attributes)) {
                if (value !== null && value !== undefined) {
                    const cleanValue = String(value).replace(/[<>&"']/g, c => {
                        return {'<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":"&apos;"}[c];
                    });
                    kml += `
                    <Data name="${key}">
                        <value>${cleanValue}</value>
                    </Data>`;
                }
            }
            kml += '</ExtendedData>';
            return kml;
        }
        
        // Convert RGBA color to KML format (AABBGGRR hex)
        function rgbaToKmlColor(color, opacity = 1) {
            if (!color) return 'ffffffff'; // Default white
            
            let r, g, b, a;
            
            if (Array.isArray(color)) {
                // [r, g, b, a] format
                [r, g, b, a = 255] = color;
            } else if (typeof color === 'string') {
                // Parse hex color
                const hex = color.replace('#', '');
                r = parseInt(hex.substr(0, 2), 16);
                g = parseInt(hex.substr(2, 2), 16);
                b = parseInt(hex.substr(4, 2), 16);
                a = 255;
            } else if (color.r !== undefined) {
                // {r, g, b, a} format
                r = color.r;
                g = color.g;
                b = color.b;
                a = color.a !== undefined ? color.a : 255;
            } else {
                return 'ffffffff';
            }
            
            // Apply opacity
            if (opacity !== undefined && opacity !== 1) {
                a = Math.round(opacity * 255);
            }
            
            // KML format: AABBGGRR (note: BGR not RGB!)
            const aa = a.toString(16).padStart(2, '0');
            const bb = b.toString(16).padStart(2, '0');
            const gg = g.toString(16).padStart(2, '0');
            const rr = r.toString(16).padStart(2, '0');
            
            return aa + bb + gg + rr;
        }
        
        // Extract symbology from layer
        function getLayerStyle(layer, geometryType) {
            console.log('=== Extracting symbology for layer ===');
            console.log('Layer:', layer.title);
            console.log('Geometry type:', geometryType);
            console.log('Renderer:', layer.renderer);
            
            const style = {
                geometryType: geometryType,
                pointColor: 'ff0000ff', // Default red
                pointSize: 1.0,
                lineColor: 'ff0000ff',
                lineWidth: 2,
                fillColor: '4d0000ff',
                outlineColor: 'ff0000ff',
                outlineWidth: 1
            };
            
            try {
                if (!layer.renderer) {
                    console.log('No renderer found for layer');
                    return style;
                }
                
                const renderer = layer.renderer;
                console.log('Renderer type:', renderer.type);
                
                let symbol = null;
                
                // Handle simple renderer
                if (renderer.type === 'simple' && renderer.symbol) {
                    symbol = renderer.symbol;
                    console.log('Using simple renderer symbol');
                }
                // Handle unique-value renderer (use default symbol or first symbol)
                else if (renderer.type === 'unique-value') {
                    console.log('Renderer is unique-value type');
                    if (renderer.defaultSymbol) {
                        symbol = renderer.defaultSymbol;
                        console.log('Using defaultSymbol from unique-value renderer');
                    } else if (renderer.uniqueValueInfos && renderer.uniqueValueInfos.length > 0) {
                        symbol = renderer.uniqueValueInfos[0].symbol;
                        console.log('Using first uniqueValueInfo symbol');
                    }
                }
                // Handle class-breaks renderer
                else if (renderer.type === 'class-breaks') {
                    console.log('Renderer is class-breaks type');
                    if (renderer.defaultSymbol) {
                        symbol = renderer.defaultSymbol;
                        console.log('Using defaultSymbol from class-breaks renderer');
                    } else if (renderer.classBreakInfos && renderer.classBreakInfos.length > 0) {
                        symbol = renderer.classBreakInfos[0].symbol;
                        console.log('Using first classBreakInfo symbol');
                    }
                }
                
                if (!symbol) {
                    console.log('No symbol found in renderer');
                    return style;
                }
                
                console.log('Symbol type:', symbol.type);
                console.log('Symbol details:', symbol);
                
                // Process symbol based on type
                if (symbol.type === 'simple-marker' || symbol.type === 'esriSMS') {
                    console.log('Processing point symbol...');
                    style.pointColor = rgbaToKmlColor(symbol.color);
                    style.pointSize = (symbol.size || 8) / 8; // Scale to KML size
                    console.log('Point color:', style.pointColor, 'Size:', style.pointSize);
                    if (symbol.outline) {
                        style.outlineColor = rgbaToKmlColor(symbol.outline.color);
                        style.outlineWidth = symbol.outline.width || 1;
                    }
                } else if (symbol.type === 'simple-line' || symbol.type === 'esriSLS') {
                    console.log('Processing line symbol...');
                    style.lineColor = rgbaToKmlColor(symbol.color);
                    style.lineWidth = symbol.width || 2;
                    console.log('Line color:', style.lineColor, 'Width:', style.lineWidth);
                } else if (symbol.type === 'simple-fill' || symbol.type === 'esriSFS') {
                    console.log('Processing polygon symbol...');
                    const fillOpacity = symbol.color && symbol.color[3] !== undefined ? 
                        symbol.color[3] / 255 : 0.3;
                    style.fillColor = rgbaToKmlColor(symbol.color, fillOpacity);
                    console.log('Fill color:', style.fillColor);
                    if (symbol.outline) {
                        style.outlineColor = rgbaToKmlColor(symbol.outline.color);
                        style.outlineWidth = symbol.outline.width || 1;
                        console.log('Outline color:', style.outlineColor, 'Width:', style.outlineWidth);
                    }
                }
                
                console.log('Final extracted style:', style);
            } catch (error) {
                console.error('Error extracting symbology:', error);
            }
            
            return style;
        }
        
        // Create KML style definition
        function createKmlStyle(styleId, style) {
            console.log('Creating KML style:', styleId, 'for geometry type:', style.geometryType);
            
            let kml = `
        <Style id="${styleId}">`;
            
            if (style.geometryType === 'point') {
                kml += `
            <IconStyle>
                <color>${style.pointColor}</color>
                <scale>${style.pointSize}</scale>
                <Icon>
                    <href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href>
                </Icon>
            </IconStyle>`;
                
                if (style.outlineColor) {
                    kml += `
            <LineStyle>
                <color>${style.outlineColor}</color>
                <width>${style.outlineWidth}</width>
            </LineStyle>`;
                }
            }
            
            if (style.geometryType === 'polyline') {
                kml += `
            <LineStyle>
                <color>${style.lineColor}</color>
                <width>${style.lineWidth}</width>
            </LineStyle>`;
            }
            
            if (style.geometryType === 'polygon') {
                kml += `
            <LineStyle>
                <color>${style.outlineColor}</color>
                <width>${style.outlineWidth}</width>
            </LineStyle>
            <PolyStyle>
                <color>${style.fillColor}</color>
                <fill>1</fill>
                <outline>1</outline>
            </PolyStyle>`;
            }
            
            kml += `
        </Style>`;
            
            console.log('Generated KML style:', kml);
            return kml;
        }
        function attributesToKML(attributes, includeAttributes) {
            if (!includeAttributes) return '';
            
            let kml = '<ExtendedData>';
            for (const [key, value] of Object.entries(attributes)) {
                if (value !== null && value !== undefined) {
                    const cleanValue = String(value).replace(/[<>&"']/g, c => {
                        return {'<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":"&apos;"}[c];
                    });
                    kml += `
                    <Data name="${key}">
                        <value>${cleanValue}</value>
                    </Data>`;
                }
            }
            kml += '</ExtendedData>';
            return kml;
        }
        
        // Create KML Placemark from feature
        async function createPlacemark(feature, layerName, includeAttributes) {
            const geometry = await convertToWGS84(feature.geometry);
            const name = feature.attributes.name || feature.attributes.NAME || 
                        feature.attributes.gis_id || feature.attributes.GIS_ID || 
                        feature.attributes.OBJECTID || 'Feature';
            
            let geometryKML = '';
            const geomType = geometry.type;
            
            if (geomType === 'point') {
                geometryKML = pointToKML(geometry);
            } else if (geomType === 'polyline') {
                geometryKML = polylineToKML(geometry);
            } else if (geomType === 'polygon') {
                geometryKML = polygonToKML(geometry);
            } else {
                console.warn('Unknown geometry type:', geomType);
                return '';
            }
            
            const extendedData = attributesToKML(feature.attributes, includeAttributes);
            
            return `
            <Placemark>
                <name>${name}</name>
                <description>Layer: ${layerName}</description>
                ${extendedData}
                ${geometryKML}
            </Placemark>`;
        }
        
        // Create complete KML document
        async function createKML(layerResults, includeAttributes) {
            let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
    <Document>
        <name>GIS Export</name>
        <description>Exported from ArcGIS Online</description>`;
            
            for (const result of layerResults) {
                kml += `
        <Folder>
            <name>${result.layerName}</name>
            <description>${result.features.length} feature(s)</description>`;
                
                for (const feature of result.features) {
                    const placemark = await createPlacemark(feature, result.layerName, includeAttributes);
                    kml += placemark;
                }
                
                kml += `
        </Folder>`;
            }
            
            kml += `
    </Document>
</kml>`;
            
            return kml;
        }
        
        // ZIP file creation (reused from attachment manager)
        function createZipFile(files) {
            const zipData = [];
            const centralDir = [];
            let offset = 0;
            
            files.forEach((file) => {
                const fileName = file.name;
                const fileData = file.data;
                const crc32 = calculateCRC32(fileData);
                
                const localHeader = createLocalFileHeader(fileName, fileData.byteLength, fileData.byteLength, crc32);
                zipData.push(localHeader);
                zipData.push(fileData);
                
                const centralDirEntry = createCentralDirEntry(fileName, fileData.byteLength, fileData.byteLength, crc32, offset);
                centralDir.push(centralDirEntry);
                offset += localHeader.byteLength + fileData.byteLength;
            });
            
            const endOfCentralDir = createEndOfCentralDir(files.length, 
                centralDir.reduce((sum, entry) => sum + entry.byteLength, 0), offset);
            
            const totalSize = offset + 
                centralDir.reduce((sum, entry) => sum + entry.byteLength, 0) + 
                endOfCentralDir.byteLength;
            const zipBuffer = new Uint8Array(totalSize);
            
            let pos = 0;
            zipData.forEach(data => {
                zipBuffer.set(new Uint8Array(data), pos);
                pos += data.byteLength;
            });
            
            centralDir.forEach(entry => {
                zipBuffer.set(new Uint8Array(entry), pos);
                pos += entry.byteLength;
            });
            
            zipBuffer.set(new Uint8Array(endOfCentralDir), pos);
            return new Blob([zipBuffer], {type: 'application/zip'});
        }
        
        function createLocalFileHeader(fileName, compressedSize, uncompressedSize, crc32) {
            const nameBytes = new TextEncoder().encode(fileName);
            const header = new ArrayBuffer(30 + nameBytes.length);
            const view = new DataView(header);
            
            view.setUint32(0, 0x04034b50, true);
            view.setUint16(4, 20, true);
            view.setUint16(6, 0, true);
            view.setUint16(8, 0, true);
            view.setUint16(10, 0, true);
            view.setUint16(12, 0, true);
            view.setUint32(14, crc32, true);
            view.setUint32(18, compressedSize, true);
            view.setUint32(22, uncompressedSize, true);
            view.setUint16(26, nameBytes.length, true);
            view.setUint16(28, 0, true);
            
            new Uint8Array(header, 30).set(nameBytes);
            return header;
        }
        
        function createCentralDirEntry(fileName, compressedSize, uncompressedSize, crc32, offset) {
            const nameBytes = new TextEncoder().encode(fileName);
            const entry = new ArrayBuffer(46 + nameBytes.length);
            const view = new DataView(entry);
            
            view.setUint32(0, 0x02014b50, true);
            view.setUint16(4, 20, true);
            view.setUint16(6, 20, true);
            view.setUint16(8, 0, true);
            view.setUint16(10, 0, true);
            view.setUint16(12, 0, true);
            view.setUint16(14, 0, true);
            view.setUint32(16, crc32, true);
            view.setUint32(20, compressedSize, true);
            view.setUint32(24, uncompressedSize, true);
            view.setUint16(28, nameBytes.length, true);
            view.setUint16(30, 0, true);
            view.setUint16(32, 0, true);
            view.setUint16(34, 0, true);
            view.setUint16(36, 0, true);
            view.setUint32(38, 0, true);
            view.setUint32(42, offset, true);
            
            new Uint8Array(entry, 46).set(nameBytes);
            return entry;
        }
        
        function createEndOfCentralDir(fileCount, centralDirSize, centralDirOffset) {
            const endDir = new ArrayBuffer(22);
            const view = new DataView(endDir);
            
            view.setUint32(0, 0x06054b50, true);
            view.setUint16(4, 0, true);
            view.setUint16(6, 0, true);
            view.setUint16(8, fileCount, true);
            view.setUint16(10, fileCount, true);
            view.setUint32(12, centralDirSize, true);
            view.setUint32(16, centralDirOffset, true);
            view.setUint16(20, 0, true);
            
            return endDir;
        }
        
        function calculateCRC32(data) {
            const crcTable = [];
            for (let i = 0; i < 256; i++) {
                let crc = i;
                for (let j = 0; j < 8; j++) {
                    crc = (crc & 1) ? ((crc >>> 1) ^ 0xEDB88320) : (crc >>> 1);
                }
                crcTable[i] = crc;
            }
            
            let crc = 0xFFFFFFFF;
            const bytes = new Uint8Array(data);
            for (let i = 0; i < bytes.length; i++) {
                crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
            }
            return (crc ^ 0xFFFFFFFF) >>> 0;
        }
        
        // Main export function
        async function exportToKMZ() {
            try {
                updateSelectedLayers();
                
                // Validation
                if (selectedLayers.length === 0) {
                    alert('Please select at least one layer to export.');
                    return;
                }
                
                if (!polygonGraphic) {
                    alert('Please draw a polygon on the map first.');
                    return;
                }
                
                const includeAttributes = $("#includeAttributes").checked;
                const includeSymbology = $("#includeSymbology").checked;
                const filename = $("#exportFilename").value.trim() || 'export';
                
                console.log('Export options:', {
                    includeAttributes,
                    includeSymbology,
                    filename
                });
                
                updateStatus("Querying features from selected layers...");
                $("#resultsDiv").innerHTML = '<div>Processing...</div>';
                
                const layerResults = [];
                let totalFeatures = 0;
                
                // Query each selected layer
                for (let i = 0; i < selectedLayers.length; i++) {
                    const layerId = selectedLayers[i];
                    const layerInfo = availableLayers.find(l => l.id === layerId);
                    
                    if (!layerInfo) continue;
                    
                    updateStatus(`Querying layer ${i + 1}/${selectedLayers.length}: ${layerInfo.title}...`);
                    
                    try {
                        const layer = layerInfo.layer;
                        await layer.load();
                        
                        // Get geometry type from layer
                        const geometryType = layer.geometryType || layerInfo.geometryType;
                        console.log('Layer geometry type:', geometryType);
                        
                        const queryResult = await layer.queryFeatures({
                            geometry: polygonGraphic.geometry,
                            spatialRelationship: 'intersects',
                            outFields: ['*'],
                            returnGeometry: true,
                            returnZ: false,
                            returnM: false
                        });
                        
                        if (queryResult.features.length > 0) {
                            const result = {
                                layerName: layerInfo.title,
                                features: queryResult.features,
                                geometryType: geometryType
                            };
                            
                            // Extract symbology if requested
                            if (includeSymbology) {
                                result.style = getLayerStyle(layer, geometryType);
                            }
                            
                            layerResults.push(result);
                            totalFeatures += queryResult.features.length;
                        }
                        
                    } catch (error) {
                        console.error(`Error querying layer ${layerInfo.title}:`, error);
                        $("#resultsDiv").innerHTML += `<div style="color:#d32f2f;">Error querying ${layerInfo.title}: ${error.message}</div>`;
                    }
                }
                
                if (totalFeatures === 0) {
                    updateStatus("No features found within polygon.");
                    $("#resultsDiv").innerHTML = '<div>No features found within the drawn polygon.</div>';
                    return;
                }
                
                // Generate KML
                updateStatus(`Generating KML for ${totalFeatures} feature(s)...`);
                const kmlString = await createKML(layerResults, includeAttributes, includeSymbology);
                
                // Create KMZ (zip with doc.kml)
                updateStatus("Creating KMZ file...");
                const kmlBytes = new TextEncoder().encode(kmlString);
                const zipFiles = [{
                    name: 'doc.kml',
                    data: kmlBytes.buffer
                }];
                
                const kmzBlob = createZipFile(zipFiles);
                
                // Download
                const today = new Date().toISOString().split('T')[0];
                const kmzFilename = `${filename}_${today}.kmz`;
                
                const url = URL.createObjectURL(kmzBlob);
                const a = document.createElement("a");
                a.href = url;
                a.download = kmzFilename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
                
                // Display results
                let resultsHTML = '<div style="margin-top:12px;"><strong>Export Complete!</strong></div>';
                resultsHTML += `<div>Filename: ${kmzFilename}</div>`;
                resultsHTML += `<div>Total Features: ${totalFeatures}</div>`;
                resultsHTML += `<div>Layers Exported: ${layerResults.length}</div>`;
                if (includeSymbology) {
                    resultsHTML += `<div>Symbology: Included</div>`;
                }
                resultsHTML += '<br><div style="max-height:150px;overflow-y:auto;">';
                
                layerResults.forEach(result => {
                    resultsHTML += `<div>• ${result.layerName}: ${result.features.length} feature(s)</div>`;
                });
                
                resultsHTML += '</div>';
                $("#resultsDiv").innerHTML = resultsHTML;
                updateStatus(`Export complete! ${totalFeatures} features exported to ${kmzFilename}`);
                
            } catch (error) {
                console.error("Export error:", error);
                updateStatus("Error during export: " + error.message);
                alert("Error exporting to KMZ: " + error.message);
            }
        }
        
        // Tool cleanup
        function cleanup() {
            if (clickHandler) {
                clickHandler.remove();
                clickHandler = null;
            }
            tempGraphics.forEach(g => mapView.graphics.remove(g));
            if (polygonGraphic) {
                mapView.graphics.remove(polygonGraphic);
            }
            mapView.graphics.removeAll();
            toolBox.remove();
            console.log('KMZ Export Tool cleaned up');
        }
        
        // Setup event listeners
        $("#selectAllBtn").onclick = selectAllLayers;
        $("#deselectAllBtn").onclick = deselectAllLayers;
        $("#drawPolygonBtn").onclick = startPolygonDrawing;
        $("#finishPolygonBtn").onclick = finishPolygon;
        $("#clearPolygonBtn").onclick = clearPolygon;
        $("#exportBtn").onclick = exportToKMZ;
        $("#closeTool").onclick = () => {
            if (window.gisToolHost && window.gisToolHost.closeTool) {
                window.gisToolHost.closeTool('kmz-export');
            } else {
                cleanup();
            }
        };
        
        // Initialize
        buildLayerCheckboxes();
        updateStatus("Ready. Select layers and draw a polygon to begin.");
        
        // Register tool with host if available
        if (window.gisToolHost && window.gisToolHost.activeTools) {
            window.gisToolHost.activeTools.set('kmz-export', {
                cleanup: cleanup,
                toolBox: toolBox
            });
        }
        
        console.log('KMZ Export Tool loaded successfully');
        
    } catch (error) {
        console.error('Error loading KMZ Export Tool:', error);
        alert("Error creating KMZ Export Tool: " + (error.message || error));
    }
})();
