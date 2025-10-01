// tools/generic-sequential-editor.js - Configurable Sequential Feature Editor
// Allows user to select layers and fields to edit in a sequential workflow

(function() {
    try {
        if (window.gisToolHost.activeTools.has('generic-sequential-editor')) {
            return;
        }
        
        const existingToolbox = document.getElementById('genericSequentialEditorToolbox');
        if (existingToolbox) {
            existingToolbox.remove();
        }
        
        const utils = window.gisSharedUtils;
        if (!utils) {
            throw new Error('Shared utilities not loaded');
        }
        
        const mapView = utils.getMapView();
        const z = 99999;
        
        // Tool state
        let sketchViewModel = null;
        let polygonGraphic = null;
        let selectedFeaturesByLayer = new Map();
        let layerConfigs = [];
        let currentEditingQueue = [];
        let currentIndex = 0;
        let currentPhase = 'selection';
        let highlightGraphics = [];
        
        // Edit tracking for report
        let editLog = [];
        let sessionStartTime = null;
        
        // Create tool UI
        const toolBox = document.createElement("div");
        toolBox.id = "genericSequentialEditorToolbox";
        toolBox.style.cssText = `
            position: fixed;
            top: 80px;
            right: 40px;
            z-index: ${z};
            background: #fff;
            border: 1px solid #333;
            padding: 12px;
            max-width: 500px;
            max-height: 85vh;
            overflow: auto;
            font: 12px/1.3 Arial, sans-serif;
            box-shadow: 0 4px 16px rgba(0,0,0,.2);
            border-radius: 4px;
        `;
        
        toolBox.innerHTML = `
            <div style="font-weight:bold;margin-bottom:12px;font-size:14px;">🔧 Sequential Feature Editor</div>
            
            <!-- Phase 1: Polygon Selection -->
            <div id="selectionPhase">
                <div style="margin-bottom:12px;color:#666;font-size:11px;">
                    Draw a polygon to select features, then configure which layers and fields to edit.
                </div>
                
                <div style="display:flex;gap:8px;margin-bottom:12px;">
                    <button id="drawPolygonBtn" style="flex:1;padding:6px 12px;background:#28a745;color:white;border:none;border-radius:3px;cursor:pointer;">Draw Selection Polygon</button>
                    <button id="clearPolygonBtn" style="flex:1;padding:6px 12px;background:#6c757d;color:white;border:none;border-radius:3px;cursor:pointer;" disabled>Clear Polygon</button>
                </div>
                
                <div id="selectionResults" style="margin-bottom:12px;"></div>
                
                <button id="configureLayersBtn" style="width:100%;padding:6px 12px;background:#007bff;color:white;border:none;border-radius:3px;cursor:pointer;display:none;">Configure Selected Layers →</button>
            </div>
            
            <!-- Phase 2: Layer Configuration -->
            <div id="configurationPhase" style="display:none;">
                <div style="font-weight:bold;margin-bottom:8px;">Configure Layers</div>
                <div style="margin-bottom:12px;color:#666;font-size:11px;">
                    Select which layers to process and configure the fields to edit for each.
                </div>
                
                <!-- Saved Configurations -->
                <div style="margin-bottom:12px;padding:8px;background:#f8f9fa;border:1px solid #dee2e6;border-radius:3px;">
                    <div style="font-weight:bold;margin-bottom:4px;font-size:11px;">Load Saved Configuration:</div>
                    <select id="savedConfigSelect" style="width:100%;padding:4px;border:1px solid #ccc;border-radius:2px;margin-bottom:4px;">
                        <option value="">-- Select a saved configuration --</option>
                    </select>
                    <div style="display:flex;gap:4px;">
                        <button id="loadConfigBtn" style="flex:1;padding:4px 8px;background:#17a2b8;color:white;border:none;border-radius:2px;cursor:pointer;font-size:11px;">Load</button>
                        <button id="deleteConfigBtn" style="flex:1;padding:4px 8px;background:#dc3545;color:white;border:none;border-radius:2px;cursor:pointer;font-size:11px;">Delete</button>
                    </div>
                </div>
                
                <div id="layerConfigContainer"></div>
                
                <div style="border-top:1px solid #ddd;margin-top:12px;padding-top:12px;">
                    <button id="saveConfigBtn" style="width:100%;padding:6px 12px;background:#17a2b8;color:white;border:none;border-radius:3px;cursor:pointer;margin-bottom:8px;">💾 Save This Configuration</button>
                    <button id="showSummaryBtn" style="width:100%;padding:8px 12px;background:#28a745;color:white;border:none;border-radius:3px;cursor:pointer;font-weight:bold;">Review Configuration →</button>
                </div>
            </div>
            
            <!-- Phase 3: Confirmation Summary -->
            <div id="summaryPhase" style="display:none;">
                <div style="font-weight:bold;margin-bottom:8px;">Review Configuration</div>
                
                <div id="summaryContent" style="margin-bottom:12px;padding:8px;background:#f8f9fa;border:1px solid #dee2e6;border-radius:3px;"></div>
                
                <!-- Bulk Edit Option -->
                <div style="margin-bottom:12px;padding:8px;background:#fff3cd;border:1px solid #ffeaa7;border-radius:3px;">
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                        <input type="checkbox" id="bulkEditMode">
                        <div>
                            <strong>Enable Bulk Edit Mode</strong>
                            <div style="font-size:10px;color:#666;">Apply the same values to all features at once (skip individual editing)</div>
                        </div>
                    </label>
                </div>
                
                <div style="display:flex;gap:8px;">
                    <button id="backToConfigBtn" style="flex:1;padding:6px 12px;background:#6c757d;color:white;border:none;border-radius:3px;cursor:pointer;">← Back</button>
                    <button id="startEditingBtn" style="flex:1;padding:8px 12px;background:#28a745;color:white;border:none;border-radius:3px;cursor:pointer;font-weight:bold;">Start Editing →</button>
                </div>
            </div>
            
            <!-- Phase 4: Editing -->
            <div id="editingPhase" style="display:none;">
                <div id="editingProgress" style="margin-bottom:12px;padding:8px;background:#f8f9fa;border:1px solid #dee2e6;border-radius:3px;"></div>
                
                <div id="featureInfo" style="margin-bottom:12px;padding:8px;background:#e3f2fd;border:1px solid #bbdefb;border-radius:3px;"></div>
                
                <div id="editFormContainer" style="margin-bottom:12px;"></div>
                
                <div style="display:flex;gap:8px;margin-bottom:8px;">
                    <button id="submitBtn" style="flex:1;padding:6px 12px;background:#28a745;color:white;border:none;border-radius:3px;cursor:pointer;">Submit & Next</button>
                    <button id="skipBtn" style="flex:1;padding:6px 12px;background:#ffc107;color:black;border:none;border-radius:3px;cursor:pointer;">Skip</button>
                </div>
                
                <button id="prevBtn" style="width:100%;padding:6px 12px;background:#6c757d;color:white;border:none;border-radius:3px;cursor:pointer;margin-bottom:8px;">← Previous</button>
                
                <button id="clearHighlightsBtn" style="width:100%;padding:6px 12px;background:#ffc107;color:black;border:none;border-radius:3px;cursor:pointer;">Clear Highlights</button>
            </div>
            
            <!-- Phase 4b: Bulk Edit -->
            <div id="bulkEditPhase" style="display:none;">
                <div style="font-weight:bold;margin-bottom:8px;color:#e67e22;">⚡ Bulk Edit Mode</div>
                <div style="margin-bottom:12px;color:#666;font-size:11px;">
                    Set values once and apply them to all selected features at the same time.
                </div>
                
                <div id="bulkEditLayerSelector" style="margin-bottom:12px;"></div>
                
                <div id="bulkEditFormContainer" style="margin-bottom:12px;"></div>
                
                <div id="bulkEditPreview" style="margin-bottom:12px;padding:8px;background:#fff3cd;border:1px solid #ffeaa7;border-radius:3px;display:none;"></div>
                
                <div style="display:flex;gap:8px;margin-bottom:8px;">
                    <button id="applyBulkEditBtn" style="flex:1;padding:8px 12px;background:#e67e22;color:white;border:none;border-radius:3px;cursor:pointer;font-weight:bold;">Apply to All Features</button>
                </div>
                
                <button id="backToSummaryBtn" style="width:100%;padding:6px 12px;background:#6c757d;color:white;border:none;border-radius:3px;cursor:pointer;margin-bottom:8px;">← Back to Summary</button>
                
                <div id="bulkEditResults" style="margin-top:12px;"></div>
            </div>
            
            <!-- Phase 5: Complete -->
            <div id="completePhase" style="display:none;">
                <div style="font-weight:bold;margin-bottom:8px;color:#28a745;">✅ Editing Complete!</div>
                <div style="margin-bottom:12px;color:#666;">All features have been processed.</div>
                
                <div id="editSummary" style="margin-bottom:12px;padding:8px;background:#f8f9fa;border:1px solid #dee2e6;border-radius:3px;"></div>
                
                <button id="exportReportBtn" style="width:100%;padding:6px 12px;background:#17a2b8;color:white;border:none;border-radius:3px;cursor:pointer;margin-bottom:8px;">📄 Export Summary Report</button>
                <button id="startOverBtn" style="width:100%;padding:6px 12px;background:#28a745;color:white;border:none;border-radius:3px;cursor:pointer;">Start Over</button>
            </div>
            
            <div style="border-top:1px solid #ddd;margin-top:12px;padding-top:8px;">
                <button id="closeTool" style="width:100%;padding:6px;background:#d32f2f;color:white;border:none;border-radius:3px;cursor:pointer;">Close Tool</button>
            </div>
            
            <div id="toolStatus" style="margin-top:8px;color:#3367d6;font-size:11px;"></div>
        `;
        
        document.body.appendChild(toolBox);
        
        const $ = (id) => toolBox.querySelector(id);
        const status = $("#toolStatus");
        
        function updateStatus(message) {
            status.textContent = message;
        }
        
        function setPhase(phase) {
            currentPhase = phase;
            
            $("#selectionPhase").style.display = "none";
            $("#configurationPhase").style.display = "none";
            $("#summaryPhase").style.display = "none";
            $("#editingPhase").style.display = "none";
            $("#bulkEditPhase").style.display = "none";
            $("#completePhase").style.display = "none";
            
            switch(phase) {
                case 'selection':
                    $("#selectionPhase").style.display = "block";
                    break;
                case 'configuration':
                    $("#configurationPhase").style.display = "block";
                    loadSavedConfigurationsList();
                    break;
                case 'summary':
                    $("#summaryPhase").style.display = "block";
                    break;
                case 'editing':
                    $("#editingPhase").style.display = "block";
                    break;
                case 'bulkEdit':
                    $("#bulkEditPhase").style.display = "block";
                    break;
                case 'complete':
                    $("#completePhase").style.display = "block";
                    break;
            }
        }
        
        function clearHighlights() {
            highlightGraphics.forEach(g => {
                try { mapView.graphics.remove(g); } catch(e) {}
            });
            highlightGraphics = [];
            
            const graphicsToRemove = [];
            mapView.graphics.forEach(graphic => {
                if (graphic.symbol) {
                    const symbol = graphic.symbol;
                    if ((symbol.type === "simple-marker" && symbol.size >= 20) ||
                        (symbol.type === "simple-line" && symbol.width >= 8) ||
                        (symbol.type === "simple-fill" && (symbol.color[3] >= 0.3 || (symbol.outline && symbol.outline.width >= 4)))) {
                        graphicsToRemove.push(graphic);
                    }
                }
            });
            
            graphicsToRemove.forEach(graphic => {
                try { mapView.graphics.remove(graphic); } catch(e) {}
            });
            
            if (mapView.popup) {
                mapView.popup.close();
            }
        }
        
        // (Continue with remaining functions from document...)
