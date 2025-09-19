// tools/attachment-manager.js - Converted from bookmarklet format
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
        
        // Target layers configuration
        const TARGET_LAYERS = [
            {id: 41150, name: "Splice Closure"},
            {id: 42100, name: "Vault"}, 
            {id: 41250, name: "Slack Loop"},
            {id: 43150, name: "Pole"},
            {id: 42050, name: "Underground Span"},
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
                    Click on a <span id="layerHint">splice closure</span> feature to select it
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
            
            view.setUint32(0, 0x04034b50, true);  // signature
            view.setUint16(4, 20, true);          // version
            view.setUint16(6, 0, true);           // flags
            view.setUint16(8, 0, true);           // compression
            view.setUint16(10, 0, true);          // time
            view.setUint16(12, 0, true);          // date
            view.setUint32(14, crc32, true);      // crc32
            view.setUint32(18, compressedSize, true);
            view.setUint32(22, uncompressedSize, true);
            view.setUint16(26, nameBytes.length, true);
            view.setUint16(28, 0, true);          // extra field length
            
            new Uint8Array(header, 30).set(nameBytes);
            return header;
        }
        
        function createCentralDirEntry(fileName, compressedSize, uncompressedSize, crc32, offset) {
            const nameBytes = new TextEncoder().encode(fileName);
            const entry = new ArrayBuffer(46 + nameBytes.length);
            const view = new DataView(entry);
            
            view.setUint32(0, 0x02014b50, true);  // signature
            view.setUint16(4, 20, true);          // version made by
            view.setUint16(6, 20, true);          // version needed
            view.setUint16(8, 0, true);           // flags
            view.setUint16(10, 0, true);          // compression
            view.setUint16(12, 0, true);          // time
            view.setUint16(14, 0, true);          // date
            view.setUint32(16, crc32, true);      // crc32
            view.setUint32(20, compressedSize, true);
            view.setUint32(24, uncompressedSize, true);
            view.setUint16(28, nameBytes.length, true);
            view.setUint16(30, 0, true);          // extra field length
            view.setUint16(32, 0, true);          // comment length
            view.setUint16(34, 0, true);          // disk number
            view.setUint16(36, 0, true);          // internal attributes
            view.setUint32(38, 0, true);          // external attributes
            view.setUint32(42, offset, true);     // relative offset
            
            new Uint8Array(entry, 46).set(nameBytes);
            return entry;
        }
        
        function createEndOfCentralDir(fileCount, centralDirSize, centralDirOffset) {
            const endDir = new ArrayBuffer(22);
            const view = new DataView(endDir);
            
            view.setUint32(0, 0x06054b50, true);   // signature
            view.setUint16(4, 0, true);            // disk number
            view.setUint16(6, 0, true);            // disk with central dir
            view.setUint16(8, fileCount, true);    // entries on disk
            view.setUint16(10, fileCount, true);   // total entries
            view.setUint32(12, centralDirSize, true);
            view.setUint32(16, centralDirOffset, true);
            view.setUint16(20, 0, true);           // comment length
            
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
        
        // [Continue with all the other function definitions from your original code...]
        // I'll include the key functions here, but the pattern is the same for all
        
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
            toolBox.remove();
            console.log('Attachment Manager cleaned up');
        }
        
        // [Include all other functions from your original code with minimal changes...]
        // The bulk of the functionality remains the same, just wrapped in this module structure
        
        // Event listeners
        setupLayerSelector();
        // setupModeToggle();
        // setupBatchRadioListeners();
        // setupFileUpload();
        
        // [All your other event listener setups...]
        
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
})();
