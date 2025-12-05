// tools/attachment-manager.js - Complete conversion from bookmarklet format
// Feature Attachment Manager with upload/download capabilities

(function() {
    try {
        // Check if tool is already active
        if (window.gisToolHost.activeTools.has('attachment-manager')) {
            console.log('Attachment Manager already active');
            return;
        }
        
        // Remove any leftover toolbox
        const existingToolbox = document.getElementById('attachmentManagerToolbox');
        if (existingToolbox) {
            existingToolbox.remove();
            console.log('Removed leftover attachment manager toolbox');
        }
        
        // Use shared utilities
        const utils = window.gisSharedUtils;
        if (!utils) {
            throw new Error('Shared utilities not loaded');
        }
        
        const mapView = utils.getMapView();
        
        // Target layers configuration - EXPANDED
        const TARGET_LAYERS = [
            {id: 21050, name: "Info Point"},
            {id: 22100, name: "GIG"},
            {id: 22200, name: "Make Ready"},
            {id: 23100, name: "Adder Line"},
            {id: 23150, name: "Restoration Polygon"},
            {id: 23250, name: "Pothole"},
            {id: 41050, name: "Fiber Cable"},
            {id: 41150, name: "Splice Closure"},
            {id: 41200, name: "Fiber Equipment"},
            {id: 41250, name: "Slack Loop"},
            {id: 42050, name: "Underground Span"},
            {id: 42100, name: "Vault"},
            {id: 43050, name: "Aerial Span"},
            {id: 43150, name: "Pole"},
            {id: 43200, name: "Riser"},
            {id: 43250, name: "Anchor"},
            {id: 45000, name: "Equipment"}
        ];
        
        const z = 99999;
        
        // Tool state variables
        let selectedFeatures = [];
        let selectedSingleFeature = null;
        let clickHandler = null;
        let filesToUpload = [];
        let currentTargetLayerId = TARGET_LAYERS[0].id;
        let sketchViewModel = null;
        let polygonGraphic = null;
        
        // Create tool UI
        const toolBox = document.createElement("div");
        toolBox.id = "attachmentManagerToolbox";
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
            <div style="font-weight:bold;margin-bottom:12px;">📎 Feature Attachment Manager</div>
            <div style="margin-bottom:12px;">
                <label style="display:block;margin-bottom:4px;font-weight:bold;">Target Layer:</label>
                <select id="layerSelect" style="width:100%;padding:4px;border:1px solid #ccc;">
                    ${TARGET_LAYERS.map(layer => `<option value="${layer.id}">${layer.name} (${layer.id})</option>`).join('')}
                </select>
            </div>
            
            <div style="margin-bottom:12px;">
                <label style="display:block;margin-bottom:4px;">Mode:</label>
                <div><input type="radio" id="batchMode" name="mode" value="batch" checked><label for="batchMode" style="margin-left:4px;">Batch Download (Multiple Features)</label></div>
                <div><input type="radio" id="singleMode" name="mode" value="single"><label for="singleMode" style="margin-left:4px;">Single Feature (Download/Upload)</label></div>
            </div>
            
            <div id="batchControls">
                <div style="margin-bottom:12px;">
                    <label style="display:block;margin-bottom:4px;">Selection Method:</label>
                    <div><input type="radio" id="currentSelection" name="selectionMethod" value="current" checked><label for="currentSelection" style="margin-left:4px;">Use Current Selection</label></div>
                    <div><input type="radio" id="manualSelection" name="selectionMethod" value="manual"><label for="manualSelection" style="margin-left:4px;">Click to Select Features</label></div>
                    <div><input type="radio" id="polygonSelection" name="selectionMethod" value="polygon"><label for="polygonSelection" style="margin-left:4px;">Draw Polygon to Select</label></div>
                </div>
                
                <div style="margin-bottom:12px;">
                    <label style="display:block;margin-bottom:4px;">Download Format:</label>
                    <div><input type="radio" id="individualFiles" name="downloadFormat" value="individual" checked><label for="individualFiles" style="margin-left:4px;">Individual Files</label></div>
                    <div><input type="radio" id="zipFile" name="downloadFormat" value="zip"><label for="zipFile" style="margin-left:4px;">Single ZIP File</label></div>
                </div>
                
                <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
                    <button id="downloadBtn">Download All Attachments</button>
                    <button id="deselectBtn" style="display:none;">Deselect All</button>
                    <button id="clearPolygonBtn" style="display:none;">Clear Polygon</button>
                </div>
            </div>
            
            <div id="singleControls" style="display:none;">
                <div style="margin-bottom:12px;color:#666;font-style:italic;">
                    Click on a <span id="layerHint">info point</span> feature to select it
                </div>
                
                <div id="selectedFeatureInfo" style="margin-bottom:12px;padding:8px;background:#f5f5f5;border:1px solid #ddd;display:none;">
                    <div style="font-weight:bold;">Selected Feature:</div>
                    <div id="featureDetails"></div>
                </div>
                
                <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
                    <button id="downloadSingleBtn" style="display:none;">Download Attachments</button>
                    <button id="clearSingleBtn" style="display:none;">Clear Selection</button>
                </div>
                
                <div id="uploadArea" style="display:none;margin-bottom:12px;">
                    <div style="border:2px dashed #ccc;padding:20px;text-align:center;background:#f9f9f9;cursor:pointer;transition:all 0.3s;" id="dropZone">
                        <div style="margin-bottom:8px;">📁 Drag & Drop Files Here</div>
                        <div style="font-size:11px;color:#666;">or click to browse</div>
                        <input type="file" id="fileInput" multiple style="display:none;">
                    </div>
                    <div id="fileList" style="margin-top:8px;"></div>
                    <button id="uploadBtn" style="display:none;margin-top:8px;">Upload Selected Files</button>
                </div>
            </div>
            
            <button id="closeTool" style="margin-top:8px;">Close</button>
            <div id="toolStatus" style="margin-top:8px;color:#3367d6;"></div>
            <div id="resultsDiv" style="margin-top:12px;"></div>
        `;
        
        // Add to page
        document.body.appendChild(toolBox);
        
        // Get UI elements
        const $ = (id) => toolBox.querySelector(id);
        const status = $("#toolStatus");
        
        function updateStatus(message) {
            status.textContent = message;
        }
        
        // ZIP file creation utilities
        function createZipFile(files, zipName) {
            const zipData = [];
            const centralDir = [];
            let offset = 0;
            
            files.forEach((file, index) => {
                const fileName = file.name;
                const fileData = file.data;
                const crc32 = calculateCRC32(fileData);
                const compressedData = fileData;
                
                const localHeader = createLocalFileHeader(fileName, compressedData.byteLength, compressedData.byteLength, crc32);
                zipData.push(localHeader);
                zipData.push(compressedData);
                
                const centralDirEntry = createCentralDirEntry(fileName, compressedData.byteLength, compressedData.byteLength, crc32, offset);
                centralDir.push(centralDirEntry);
                offset += localHeader.byteLength + compressedData.byteLength;
            });
            
            const endOfCentralDir = createEndOfCentralDir(files.length, centralDir.reduce((sum, entry) => sum + entry.byteLength, 0), offset);
            const zipBuffer = new Uint8Array(offset + centralDir.reduce((sum, entry) => sum + entry.byteLength, 0) + endOfCentralDir.byteLength);
            
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
        
        // Layer management functions
        function getCurrentLayerInfo() {
            return TARGET_LAYERS.find(layer => layer.id === currentTargetLayerId);
        }
        
        async function getTargetLayer() {
            const allFL = mapView.map.allLayers.filter(l => l.type === "feature");
            const layer = allFL.find(l => l.layerId === currentTargetLayerId);
            if (!layer) {
                throw new Error(`${getCurrentLayerInfo().name} layer (ID: ${currentTargetLayerId}) not found`);
            }
            await layer.load();
            return layer;
        }
        
        function setupLayerSelector() {
            const layerSelect = $("#layerSelect");
            layerSelect.addEventListener('change', (e) => {
                currentTargetLayerId = parseInt(e.target.value);
                const layerInfo = getCurrentLayerInfo();
                $("#layerHint").textContent = layerInfo.name.toLowerCase();
                clearAllSelections();
                updateStatus(`Switched to ${layerInfo.name} layer.`);
            });
        }
        
        function clearAllSelections() {
            selectedFeatures = [];
            selectedSingleFeature = null;
            mapView.graphics.removeAll();
            $("#deselectBtn").style.display = "none";
            $("#clearPolygonBtn").style.display = "none";
            $("#selectedFeatureInfo").style.display = "none";
            $("#downloadSingleBtn").style.display = "none";
            $("#clearSingleBtn").style.display = "none";
            $("#uploadArea").style.display = "none";
            $("#fileList").innerHTML = "";
            $("#uploadBtn").style.display = "none";
            filesToUpload = [];
            $("#resultsDiv").innerHTML = "";
            if (polygonGraphic) {
                polygonGraphic = null;
            }
        }
        
        function setupModeToggle() {
            const modeRadios = toolBox.querySelectorAll('input[name="mode"]');
            for (let i = 0; i < modeRadios.length; i++) {
                const radio = modeRadios[i];
                radio.addEventListener('change', (e) => {
                    if (e.target.value === 'batch') {
                        $("#batchControls").style.display = "block";
                        $("#singleControls").style.display = "none";
                        clearSingleSelection();
                        if (clickHandler) {
                            clickHandler.remove();
                            clickHandler = null;
                        }
                    } else {
                        $("#batchControls").style.display = "none";
                        $("#singleControls").style.display = "block";
                        selectedFeatures = [];
                        mapView.graphics.removeAll();
                        enableSingleSelection();
                    }
                });
            }
        }
        
        function enablePolygonSelection() {
            if (clickHandler) {
                clickHandler.remove();
                clickHandler = null;
            }
            clearPolygonSelection();
            
            if (!sketchViewModel) {
                try {
                    if (window.require) {
                        window.require(['esri/widgets/Sketch/SketchViewModel'], (SketchViewModel) => {
                            sketchViewModel = new SketchViewModel({
                                view: mapView,
                                layer: mapView.graphics,
                                polygonSymbol: {
                                    type: 'simple-fill',
                                    color: [255, 255, 0, 0.3],
                                    outline: {
                                        color: [255, 0, 0, 1],
                                        width: 2
                                    }
                                }
                            });
                            
                            sketchViewModel.on('create', (event) => {
                                if (event.state === 'complete') {
                                    polygonGraphic = event.graphic;
                                    selectFeaturesInPolygon(polygonGraphic.geometry);
                                    $("#clearPolygonBtn").style.display = "inline-block";
                                }
                            });
                            
                            startPolygonDrawing();
                        });
                    } else {
                        alert('Unable to load polygon drawing tools. Using simplified selection.');
                    }
                } catch (e) {
                    console.error('Error loading SketchViewModel:', e);
                    alert('Polygon selection not available. Please use manual selection.');
                }
            } else {
                startPolygonDrawing();
            }
            
            function startPolygonDrawing() {
                if (sketchViewModel) {
                    sketchViewModel.create('polygon');
                    updateStatus("Draw a polygon on the map to select features. Double-click to finish.");
                }
            }
        }
        
        async function selectFeaturesInPolygon(polygon) {
            try {
                updateStatus("Selecting features within polygon...");
                const layer = await getTargetLayer();
                
                const queryResult = await layer.queryFeatures({
                    geometry: polygon,
                    spatialRelationship: 'intersects',
                    returnGeometry: true,
                    outFields: ['*']
                });
                
                selectedFeatures = queryResult.features.map(feature => ({
                    attributes: feature.attributes,
                    layer: layer,
                    geometry: feature.geometry
                }));
                
                queryResult.features.forEach(feature => {
                    const highlightGraphic = {
                        geometry: feature.geometry,
                        symbol: {
                            type: "simple-marker",
                            color: [255, 255, 0, 0.8],
                            size: 12,
                            outline: {
                                color: [255, 0, 0, 1],
                                width: 2
                            }
                        }
                    };
                    mapView.graphics.add(highlightGraphic);
                });
                
                $("#deselectBtn").style.display = "inline-block";
                updateStatus(`Selected ${selectedFeatures.length} feature(s) within polygon. Click download to get attachments.`);
            } catch (error) {
                console.error("Polygon selection error:", error);
                updateStatus("Error selecting features: " + error.message);
            }
        }
        
        function clearPolygonSelection() {
            if (polygonGraphic) {
                mapView.graphics.remove(polygonGraphic);
                polygonGraphic = null;
            }
            mapView.graphics.removeAll();
            $("#clearPolygonBtn").style.display = "none";
            $("#deselectBtn").style.display = "none";
            selectedFeatures = [];
            updateStatus("Polygon selection cleared.");
        }
        
        function enableBatchManualSelection() {
            if (clickHandler) {
                clickHandler.remove();
            }
            clearPolygonSelection();
            
            clickHandler = mapView.on("click", async (event) => {
                try {
                    updateStatus("Identifying features...");
                    const response = await mapView.hitTest(event);
                    const targetResults = response.results.filter(result => 
                        result.graphic && result.graphic.layer && result.graphic.layer.layerId === currentTargetLayerId
                    );
                    
                    if (targetResults.length > 0) {
                        const graphic = targetResults[0].graphic;
                        const objectId = graphic.attributes[graphic.layer.objectIdField];
                        const alreadySelected = selectedFeatures.some(f => 
                            f.attributes[f.layer.objectIdField] === objectId
                        );
                        
                        if (!alreadySelected) {
                            selectedFeatures.push({
                                attributes: graphic.attributes,
                                layer: graphic.layer
                            });
                            
                            const highlightGraphic = {
                                geometry: graphic.geometry,
                                symbol: {
                                    type: "simple-marker",
                                    color: [255, 255, 0, 0.8],
                                    size: 12,
                                    outline: {
                                        color: [255, 0, 0, 1],
                                        width: 2
                                    }
                                }
                            };
                            mapView.graphics.add(highlightGraphic);
                            
                            $("#deselectBtn").style.display = "inline-block";
                            updateStatus(`Selected ${selectedFeatures.length} feature(s). Click more or download attachments.`);
                        } else {
                            updateStatus("Feature already selected.");
                        }
                    } else {
                        updateStatus(`No ${getCurrentLayerInfo().name.toLowerCase()} features found at this location.`);
                    }
                } catch (error) {
                    console.error("Selection error:", error);
                    updateStatus("Error selecting feature: " + error.message);
                }
            });
            
            updateStatus(`Manual selection enabled. Click on ${getCurrentLayerInfo().name.toLowerCase()} features to select them.`);
        }
        
        function enableSingleSelection() {
            if (clickHandler) {
                clickHandler.remove();
            }
            
            clickHandler = mapView.on("click", async (event) => {
                try {
                    updateStatus("Identifying feature...");
                    const response = await mapView.hitTest(event);
                    const targetResults = response.results.filter(result => 
                        result.graphic && result.graphic.layer && result.graphic.layer.layerId === currentTargetLayerId
                    );
                    
                    if (targetResults.length > 0) {
                        const graphic = targetResults[0].graphic;
                        clearSingleSelection();
                        
                        selectedSingleFeature = {
                            attributes: graphic.attributes,
                            layer: graphic.layer,
                            geometry: graphic.geometry
                        };
                        
                        const highlightGraphic = {
                            geometry: graphic.geometry,
                            symbol: {
                                type: "simple-marker",
                                color: [0, 255, 0, 0.8],
                                size: 14,
                                outline: {
                                    color: [0, 150, 0, 1],
                                    width: 3
                                }
                            }
                        };
                        mapView.graphics.add(highlightGraphic);
                        
                        const objectId = graphic.attributes[graphic.layer.objectIdField];
                        const gisId = graphic.attributes.gis_id || graphic.attributes.GIS_ID || objectId;
                        
                        $("#featureDetails").innerHTML = `
                            <strong>Layer:</strong> ${getCurrentLayerInfo().name}<br>
                            <strong>GIS ID:</strong> ${gisId}<br>
                            <strong>Object ID:</strong> ${objectId}
                        `;
                        $("#selectedFeatureInfo").style.display = "block";
                        $("#downloadSingleBtn").style.display = "inline-block";
                        $("#clearSingleBtn").style.display = "inline-block";
                        $("#uploadArea").style.display = "block";
                        
                        updateStatus("Feature selected. You can now download or upload attachments.");
                    } else {
                        updateStatus(`No ${getCurrentLayerInfo().name.toLowerCase()} features found at this location.`);
                    }
                } catch (error) {
                    console.error("Selection error:", error);
                    updateStatus("Error selecting feature: " + error.message);
                }
            });
            
            updateStatus(`Single mode enabled. Click on a ${getCurrentLayerInfo().name.toLowerCase()} feature to select it.`);
        }
        
        function clearSingleSelection() {
            selectedSingleFeature = null;
            mapView.graphics.removeAll();
            $("#selectedFeatureInfo").style.display = "none";
            $("#downloadSingleBtn").style.display = "none";
            $("#clearSingleBtn").style.display = "none";
            $("#uploadArea").style.display = "none";
            $("#fileList").innerHTML = "";
            $("#uploadBtn").style.display = "none";
            filesToUpload = [];
            updateStatus("Feature selection cleared.");
        }
        
        function setupBatchRadioListeners() {
            const radios = toolBox.querySelectorAll('input[name="selectionMethod"]');
            for (let i = 0; i < radios.length; i++) {
                const radio = radios[i];
                radio.addEventListener('change', (e) => {
                    if (e.target.value === 'manual') {
                        enableBatchManualSelection();
                        selectedFeatures = [];
                        mapView.graphics.removeAll();
                        $("#deselectBtn").style.display = "none";
                        $("#clearPolygonBtn").style.display = "none";
                    } else if (e.target.value === 'polygon') {
                        enablePolygonSelection();
                    } else {
                        if (clickHandler) {
                            clickHandler.remove();
                            clickHandler = null;
                        }
                        clearPolygonSelection();
                        selectedFeatures = [];
                        mapView.graphics.removeAll();
                        $("#deselectBtn").style.display = "none";
                        updateStatus("Using current map selection.");
                    }
                });
            }
        }
        
        function setupFileUpload() {
            const dropZone = $("#dropZone");
            const fileInput = $("#fileInput");
            
            dropZone.addEventListener('click', () => fileInput.click());
            
            dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropZone.style.borderColor = "#007acc";
                dropZone.style.backgroundColor = "#f0f8ff";
            });
            
            dropZone.addEventListener('dragleave', (e) => {
                e.preventDefault();
                dropZone.style.borderColor = "#ccc";
                dropZone.style.backgroundColor = "#f9f9f9";
            });
            
            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.style.borderColor = "#ccc";
                dropZone.style.backgroundColor = "#f9f9f9";
                const files = Array.from(e.dataTransfer.files);
                addFilesToUpload(files);
            });
            
            fileInput.addEventListener('change', (e) => {
                const files = Array.from(e.target.files);
                addFilesToUpload(files);
            });
            
            function addFilesToUpload(files) {
                files.forEach(file => {
                    if (!filesToUpload.find(f => f.name === file.name && f.size === file.size)) {
                        filesToUpload.push(file);
                    }
                });
                updateFileList();
            }
            
            function updateFileList() {
                const fileListDiv = $("#fileList");
                
                if (filesToUpload.length === 0) {
                    fileListDiv.innerHTML = "";
                    $("#uploadBtn").style.display = "none";
                    return;
                }
                
                let html = "<div style='font-weight:bold;margin-bottom:4px;'>Files to upload:</div>";
                filesToUpload.forEach((file, index) => {
                    html += `
                        <div style='display:flex;align-items:center;justify-content:space-between;padding:4px;border:1px solid #ddd;margin:2px 0;background:#fff;'>
                            <span style='font-size:11px;'>${file.name} (${(file.size / 1024).toFixed(1)}KB)</span>
                            <button onclick='window.removeFile(${index})' style='background:#ff4444;color:white;border:none;padding:2px 6px;font-size:10px;cursor:pointer;'>×</button>
                        </div>
                    `;
                });
                fileListDiv.innerHTML = html;
                $("#uploadBtn").style.display = "inline-block";
            }
            
            // Global function for removing files
            window.removeFile = function(index) {
                filesToUpload.splice(index, 1);
                updateFileList();
            };
        }
        
        async function downloadBatchAttachments() {
            try {
                updateStatus("Preparing download...");
                $("#resultsDiv").innerHTML = "";
                
                const layer = await getTargetLayer();
                let features = [];
                
                const selectionMethod = toolBox.querySelector('input[name="selectionMethod"]:checked').value;
                if (selectionMethod === 'current') {
                    if (mapView.popup.selectedFeature && mapView.popup.selectedFeature.layer && 
                        mapView.popup.selectedFeature.layer.layerId === currentTargetLayerId) {
                        features = [mapView.popup.selectedFeature];
                    } else {
                        const layerView = mapView.allLayerViews.find(lv => lv.layer.layerId === currentTargetLayerId);
                        if (layerView && layerView.highlightedFeatures && layerView.highlightedFeatures.length > 0) {
                            features = layerView.highlightedFeatures.toArray();
                        }
                    }
                } else {
                    features = selectedFeatures;
                }
                
                if (!features.length) {
                    alert(`No ${getCurrentLayerInfo().name.toLowerCase()} features selected. Please select features first.`);
                    return;
                }
                
                const downloadFormat = toolBox.querySelector('input[name="downloadFormat"]:checked').value;
                updateStatus(`Found ${features.length} selected feature(s). Checking for attachments...`);
                
                let totalAttachments = 0;
                let downloadedCount = 0;
                const results = [];
                const zipFiles = [];
                
                for (let i = 0; i < features.length; i++) {
                    const feature = features[i];
                    const objectId = feature.attributes[layer.objectIdField];
                    
                    updateStatus(`Checking feature ${i + 1}/${features.length} for attachments...`);
                    
                    try {
                        const attachmentQuery = await layer.queryAttachments({
                            objectIds: [objectId],
                            returnMetadata: true
                        });
                        
                        if (attachmentQuery[objectId] && attachmentQuery[objectId].length > 0) {
                            const attachments = attachmentQuery[objectId];
                            totalAttachments += attachments.length;
                            results.push({
                                objectId: objectId,
                                attachments: attachments,
                                success: true
                            });
                            
                            for (const attachment of attachments) {
                                try {
                                    updateStatus(`Downloading: ${attachment.name} (${downloadedCount + 1}/${totalAttachments})...`);
                                    const response = await fetch(attachment.url);
                                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                                    
                                    const blob = await response.blob();
                                    const gisId = feature.attributes.gis_id || feature.attributes.GIS_ID || objectId;
                                    const fileName = `${getCurrentLayerInfo().name.replace(/\s+/g, '')}_GIS_${gisId}_${attachment.name}`;
                                    
                                    if (downloadFormat === 'zip') {
                                        const arrayBuffer = await blob.arrayBuffer();
                                        zipFiles.push({
                                            name: fileName,
                                            data: arrayBuffer
                                        });
                                    } else {
                                        const url = URL.createObjectURL(blob);
                                        const a = document.createElement("a");
                                        a.href = url;
                                        a.download = fileName;
                                        document.body.appendChild(a);
                                        a.click();
                                        a.remove();
                                        URL.revokeObjectURL(url);
                                    }
                                    
                                    downloadedCount++;
                                    await new Promise(resolve => setTimeout(resolve, 100));
                                } catch (downloadError) {
                                    console.error(`Error downloading ${attachment.name}:`, downloadError);
                                }
                            }
                        } else {
                            results.push({
                                objectId: objectId,
                                attachments: [],
                                success: true
                            });
                        }
                    } catch (error) {
                        console.error(`Error querying attachments for ObjectID ${objectId}:`, error);
                        results.push({
                            objectId: objectId,
                            error: error.message,
                            success: false
                        });
                    }
                }
                
                if (downloadFormat === 'zip' && zipFiles.length > 0) {
                    updateStatus("Creating ZIP file...");
                    const today = new Date().toISOString().split('T')[0];
                    const zipName = `${getCurrentLayerInfo().name.replace(/\s+/g, '')}_Attachments_${today}.zip`;
                    const zipBlob = createZipFile(zipFiles, zipName);
                    
                    const url = URL.createObjectURL(zipBlob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = zipName;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                }
                
                let resultsHTML = `<div style="margin-top:12px;"><strong>Download Results (${getCurrentLayerInfo().name}):</strong></div>`;
                resultsHTML += `<div>Total Features: ${features.length}</div>`;
                resultsHTML += `<div>Total Attachments Found: ${totalAttachments}</div>`;
                resultsHTML += `<div>Downloaded: ${downloadedCount}</div>`;
                
                if (downloadFormat === 'zip' && zipFiles.length > 0) {
                    resultsHTML += `<div>Format: ZIP file with ${zipFiles.length} files</div>`;
                }
                
                resultsHTML += `<br><div style="max-height:200px;overflow-y:auto;">`;
                results.forEach(result => {
                    if (result.success) {
                        resultsHTML += `<div>ObjectID ${result.objectId}: ${result.attachments.length} attachment(s)</div>`;
                        result.attachments.forEach(att => {
                            resultsHTML += `<div style="margin-left:20px;font-size:11px;color:#666;">• ${att.name}</div>`;
                        });
                    } else {
                        resultsHTML += `<div style="color:#d32f2f;">ObjectID ${result.objectId}: Error - ${result.error}</div>`;
                    }
                });
                resultsHTML += `</div>`;
                
                $("#resultsDiv").innerHTML = resultsHTML;
                updateStatus(downloadFormat === 'zip' ? 
                    `ZIP download completed! ${downloadedCount} files in archive.` :
                    `Download completed! ${downloadedCount} files downloaded.`);
                
            } catch (error) {
                console.error("Download error:", error);
                updateStatus("Error: " + error.message);
                alert("Error downloading attachments: " + error.message);
            }
        }
        
        async function downloadSingleAttachments() {
            try {
                if (!selectedSingleFeature) {
                    alert("Please select a feature first.");
                    return;
                }
                
                updateStatus("Downloading attachments...");
                $("#resultsDiv").innerHTML = "";
                
                const layer = await getTargetLayer();
                const objectId = selectedSingleFeature.attributes[layer.objectIdField];
                
                const attachmentQuery = await layer.queryAttachments({
                    objectIds: [objectId],
                    returnMetadata: true
                });
                
                if (!attachmentQuery[objectId] || attachmentQuery[objectId].length === 0) {
                    updateStatus("No attachments found for this feature.");
                    $("#resultsDiv").innerHTML = "<div>No attachments found.</div>";
                    return;
                }
                
                const attachments = attachmentQuery[objectId];
                let downloadedCount = 0;
                
                for (const attachment of attachments) {
                    try {
                        updateStatus(`Downloading: ${attachment.name} (${downloadedCount + 1}/${attachments.length})...`);
                        const response = await fetch(attachment.url);
                        if (!response.ok) throw new Error(`HTTP ${response.status}`);
                        
                        const blob = await response.blob();
                        const url = URL.createObjectURL(blob);
                        const gisId = selectedSingleFeature.attributes.gis_id || selectedSingleFeature.attributes.GIS_ID || objectId;
                        
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `${getCurrentLayerInfo().name.replace(/\s+/g, '')}_GIS_${gisId}_${attachment.name}`;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        URL.revokeObjectURL(url);
                        
                        downloadedCount++;
                        await new Promise(resolve => setTimeout(resolve, 100));
                    } catch (downloadError) {
                        console.error(`Error downloading ${attachment.name}:`, downloadError);
                    }
                }
                
                let resultsHTML = `<div style="margin-top:12px;"><strong>Download Results (${getCurrentLayerInfo().name}):</strong></div>`;
                resultsHTML += `<div>Feature: ${selectedSingleFeature.attributes.gis_id || selectedSingleFeature.attributes.GIS_ID || objectId}</div>`;
                resultsHTML += `<div>Downloaded: ${downloadedCount}/${attachments.length} attachments</div><br>`;
                resultsHTML += `<div style="max-height:150px;overflow-y:auto;">`;
                attachments.forEach(att => {
                    resultsHTML += `<div style="font-size:11px;color:#666;">• ${att.name}</div>`;
                });
                resultsHTML += `</div>`;
                
                $("#resultsDiv").innerHTML = resultsHTML;
                updateStatus(`Download completed! ${downloadedCount} files downloaded.`);
                
            } catch (error) {
                console.error("Download error:", error);
                updateStatus("Error: " + error.message);
                alert("Error downloading attachments: " + error.message);
            }
        }
        
        async function uploadAttachments() {
            try {
                if (!selectedSingleFeature) {
                    alert("Please select a feature first.");
                    return;
                }
                
                if (filesToUpload.length === 0) {
                    alert("Please select files to upload.");
                    return;
                }
                
                updateStatus("Uploading attachments...");
                $("#resultsDiv").innerHTML = "";
                
                const layer = await getTargetLayer();
                const objectId = selectedSingleFeature.attributes[layer.objectIdField];
                let uploadedCount = 0;
                let failedCount = 0;
                const results = [];
                
                for (let i = 0; i < filesToUpload.length; i++) {
                    const file = filesToUpload[i];
                    try {
                        updateStatus(`Uploading: ${file.name} (${i + 1}/${filesToUpload.length})...`);
                        
                        const feature = selectedSingleFeature;
                        const formData = new FormData();
                        formData.append('attachment', file);
                        formData.append('f', 'json');
                        
                        const uploadResult = await layer.addAttachment(feature, formData);
                        console.log('Upload success:', uploadResult);
                        
                        results.push({
                            fileName: file.name,
                            success: true,
                            result: uploadResult
                        });
                        uploadedCount++;
                    } catch (error) {
                        console.error(`Error uploading ${file.name}:`, error);
                        results.push({
                            fileName: file.name,
                            success: false,
                            error: error.message || error
                        });
                        failedCount++;
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
                
                let resultsHTML = `<div style="margin-top:12px;"><strong>Upload Results (${getCurrentLayerInfo().name}):</strong></div>`;
                resultsHTML += `<div>Feature: ${selectedSingleFeature.attributes.gis_id || selectedSingleFeature.attributes.GIS_ID || objectId}</div>`;
                resultsHTML += `<div>Uploaded: ${uploadedCount}/${filesToUpload.length} files</div>`;
                if (failedCount > 0) resultsHTML += `<div style="color:#d32f2f;">Failed: ${failedCount} files</div>`;
                resultsHTML += `<br><div style="max-height:150px;overflow-y:auto;">`;
                
                results.forEach(result => {
                    if (result.success) {
                        resultsHTML += `<div style="color:#2e7d32;">✓ ${result.fileName}</div>`;
                    } else {
                        resultsHTML += `<div style="color:#d32f2f;">✗ ${result.fileName} - ${result.error}</div>`;
                    }
                });
                resultsHTML += `</div>`;
                
                $("#resultsDiv").innerHTML = resultsHTML;
                updateStatus(`Upload completed! ${uploadedCount} files uploaded.`);
                
                filesToUpload = [];
                $("#fileList").innerHTML = "";
                $("#uploadBtn").style.display = "none";
                
            } catch (error) {
                console.error("Upload error:", error);
                updateStatus("Error: " + error.message);
                alert("Error uploading attachments: " + error.message);
            }
        }
        
        function deselectAllFeatures() {
            selectedFeatures = [];
            mapView.graphics.removeAll();
            $("#deselectBtn").style.display = "none";
            $("#clearPolygonBtn").style.display = "none";
            updateStatus("All features deselected.");
            $("#resultsDiv").innerHTML = "";
        }
        
        // Tool cleanup function
        function cleanup() {
            if (clickHandler) {
                clickHandler.remove();
                clickHandler = null;
            }
            if (sketchViewModel) {
                sketchViewModel.destroy();
                sketchViewModel = null;
            }
            mapView.graphics.removeAll();
            
            // Clean up global function
            if (window.removeFile) {
                delete window.removeFile;
            }
            
            toolBox.remove();
            console.log('Attachment Manager cleaned up');
        }
        
        // Setup all event listeners
        setupLayerSelector();
        setupModeToggle();
        setupBatchRadioListeners();
        setupFileUpload();
        
        $("#downloadBtn").onclick = downloadBatchAttachments;
        $("#downloadSingleBtn").onclick = downloadSingleAttachments;
        $("#uploadBtn").onclick = uploadAttachments;
        $("#deselectBtn").onclick = deselectAllFeatures;
        $("#clearSingleBtn").onclick = clearSingleSelection;
        $("#clearPolygonBtn").onclick = clearPolygonSelection;
        $("#closeTool").onclick = () => {
            window.gisToolHost.closeTool('attachment-manager');
        };
        
        // Initialize
        updateStatus("Ready. Choose a layer and mode, then select features.");
        
        // Register tool with host
        window.gisToolHost.activeTools.set('attachment-manager', {
            cleanup: cleanup,
            toolBox: toolBox
        });
        
        console.log('Attachment Manager loaded successfully');
        
    } catch (error) {
        console.error('Error loading Attachment Manager:', error);
        alert("Error creating Attachment Manager: " + (error.message || error));
    }
})()
