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
        let selectedFeaturesByLayer = new Map(); // layerId -> features[]
        let layerConfigs = []; // User's configuration per layer
        let currentEditingQueue = []; // Flattened queue of {layer, feature, fields, options}
        let currentIndex = 0;
        let currentPhase = 'selection';
        let highlightGraphics = [];
        
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
        }
        
        function enablePolygonDrawing() {
            clearPolygonSelection();
            
            if (!sketchViewModel) {
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
                                $("#clearPolygonBtn").disabled = false;
                                $("#drawPolygonBtn").disabled = false;
                            }
                        });
                        
                        startPolygonDrawing();
                    });
                } else {
                    updateStatus('Unable to load polygon drawing tools.');
                }
            } else {
                startPolygonDrawing();
            }
            
            function startPolygonDrawing() {
                if (sketchViewModel) {
                    $("#drawPolygonBtn").disabled = true;
                    sketchViewModel.create('polygon');
                    updateStatus("Draw a polygon on the map. Double-click to finish.");
                }
            }
        }
        
        async function selectFeaturesInPolygon(polygon) {
            try {
                updateStatus("Selecting features within polygon...");
                selectedFeaturesByLayer.clear();
                
                const allFL = mapView.map.allLayers.filter(l => 
                    l.type === "feature" && l.visible
                );
                
                const queries = allFL.map(async (layer) => {
                    try {
                        await layer.load();
                        
                        const result = await layer.queryFeatures({
                            geometry: polygon,
                            spatialRelationship: 'intersects',
                            returnGeometry: true,
                            outFields: ['*']
                        });
                        
                        if (result.features.length > 0) {
                            selectedFeaturesByLayer.set(layer.layerId, {
                                layer: layer,
                                features: result.features
                            });
                        }
                    } catch (e) {
                        // Skip layers that fail
                    }
                });
                
                await Promise.all(queries);
                
                displaySelectionResults();
                
            } catch (error) {
                updateStatus("Error selecting features: " + error.message);
            }
        }
        
        function displaySelectionResults() {
            let html = '<div style="padding:8px;background:#f8f9fa;border:1px solid #dee2e6;border-radius:3px;">';
            html += '<strong>Features Found:</strong><br>';
            
            if (selectedFeaturesByLayer.size === 0) {
                html += '<em>No features found in selection</em>';
                $("#configureLayersBtn").style.display = "none";
            } else {
                selectedFeaturesByLayer.forEach((data, layerId) => {
                    html += `${data.layer.title}: ${data.features.length}<br>`;
                });
                $("#configureLayersBtn").style.display = "block";
            }
            
            html += '</div>';
            $("#selectionResults").innerHTML = html;
            updateStatus(`Found features in ${selectedFeaturesByLayer.size} layers.`);
        }
        
        function clearPolygonSelection() {
            if (polygonGraphic) {
                mapView.graphics.remove(polygonGraphic);
                polygonGraphic = null;
            }
            clearHighlights();
            $("#clearPolygonBtn").disabled = true;
            selectedFeaturesByLayer.clear();
            $("#selectionResults").innerHTML = "";
            $("#configureLayersBtn").style.display = "none";
            updateStatus("Polygon selection cleared.");
        }
        
        async function showLayerConfiguration() {
            const container = $("#layerConfigContainer");
            container.innerHTML = '';
            
            let order = 1;
            for (const [layerId, data] of selectedFeaturesByLayer) {
                const section = await createLayerConfigSection(data.layer, data.features, order);
                container.appendChild(section);
                order++;
            }
            
            setPhase('configuration');
            updateStatus("Configure which layers and fields to edit.");
        }
        
        async function createLayerConfigSection(layer, features, order) {
            const section = document.createElement('div');
            section.style.cssText = `
                margin-bottom: 12px;
                border: 1px solid #dee2e6;
                border-radius: 4px;
                overflow: hidden;
            `;
            section.dataset.layerId = layer.layerId;
            section.dataset.order = order;
            
            // Header
            const header = document.createElement('div');
            header.style.cssText = `
                padding: 8px;
                background: #e9ecef;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
            `;
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `layer_${layer.layerId}_enabled`;
            checkbox.checked = false;
            
            const label = document.createElement('label');
            label.style.cssText = 'flex: 1; cursor: pointer; font-weight: bold;';
            label.textContent = `${layer.title} (${features.length} features)`;
            label.htmlFor = checkbox.id;
            
            const expandIcon = document.createElement('span');
            expandIcon.textContent = '▼';
            expandIcon.style.fontSize = '10px';
            
            header.appendChild(checkbox);
            header.appendChild(label);
            header.appendChild(expandIcon);
            
            // Config body (collapsed by default)
            const body = document.createElement('div');
            body.style.cssText = `
                padding: 8px;
                display: none;
                background: #fff;
            `;
            
            // Mode selection
            const modeDiv = document.createElement('div');
            modeDiv.style.marginBottom = '8px';
            modeDiv.innerHTML = `
                <div style="font-weight:bold;margin-bottom:4px;">Mode:</div>
                <label style="margin-right:12px;">
                    <input type="radio" name="mode_${layer.layerId}" value="edit" checked>
                    Edit Fields
                </label>
                <label>
                    <input type="radio" name="mode_${layer.layerId}" value="view">
                    View Only
                </label>
            `;
            
            // Field selection container
            const fieldsDiv = document.createElement('div');
            fieldsDiv.id = `fields_${layer.layerId}`;
            fieldsDiv.style.marginTop = '8px';
            
            // Load fields
            await layer.load();
            const editableFields = layer.fields.filter(f => f.editable && f.type !== 'oid' && f.type !== 'global-id');
            
            if (editableFields.length > 0) {
                fieldsDiv.innerHTML = '<div style="font-weight:bold;margin-bottom:4px;">Fields to Edit:</div>';
                
                const fieldList = document.createElement('div');
                fieldList.style.cssText = 'max-height:150px;overflow-y:auto;border:1px solid #dee2e6;padding:4px;border-radius:2px;background:#f8f9fa;';
                
                editableFields.forEach(field => {
                    const fieldItem = document.createElement('label');
                    fieldItem.style.cssText = 'display:block;padding:2px 4px;cursor:pointer;';
                    
                    const fieldCheck = document.createElement('input');
                    fieldCheck.type = 'checkbox';
                    fieldCheck.dataset.fieldName = field.name;
                    fieldCheck.style.marginRight = '4px';
                    
                    const fieldLabel = document.createElement('span');
                    const typeLabel = getFieldTypeLabel(field);
                    fieldLabel.textContent = `${field.alias || field.name} (${typeLabel})`;
                    
                    fieldItem.appendChild(fieldCheck);
                    fieldItem.appendChild(fieldLabel);
                    fieldList.appendChild(fieldItem);
                });
                
                fieldsDiv.appendChild(fieldList);
            } else {
                fieldsDiv.innerHTML = '<div style="color:#999;font-size:11px;">No editable fields available</div>';
            }
            
            // Options
            const optionsDiv = document.createElement('div');
            optionsDiv.style.marginTop = '8px';
            optionsDiv.innerHTML = `
                <div style="font-weight:bold;margin-bottom:4px;">Options:</div>
                <label style="display:block;">
                    <input type="checkbox" id="popup_${layer.layerId}" checked>
                    Show popup for each feature
                </label>
                <label style="display:block;">
                    <input type="checkbox" id="allowskip_${layer.layerId}" checked>
                    Allow skip
                </label>
            `;
            
            // Order controls
            const orderDiv = document.createElement('div');
            orderDiv.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px solid #dee2e6;';
            orderDiv.innerHTML = `
                <div style="display:flex;align-items:center;gap:8px;">
                    <span style="font-weight:bold;">Processing Order:</span>
                    <input type="number" min="1" value="${order}" style="width:50px;padding:2px;" class="orderInput">
                    <button class="moveUp" style="padding:2px 6px;">↑</button>
                    <button class="moveDown" style="padding:2px 6px;">↓</button>
                </div>
            `;
            
            body.appendChild(modeDiv);
            body.appendChild(fieldsDiv);
            body.appendChild(optionsDiv);
            body.appendChild(orderDiv);
            
            section.appendChild(header);
            section.appendChild(body);
            
            // Toggle expand/collapse
            header.onclick = (e) => {
                if (e.target !== checkbox) {
                    const isExpanded = body.style.display === 'block';
                    body.style.display = isExpanded ? 'none' : 'block';
                    expandIcon.textContent = isExpanded ? '▼' : '▲';
                }
            };
            
            // Auto-expand when checked
            checkbox.onchange = () => {
                if (checkbox.checked) {
                    body.style.display = 'block';
                    expandIcon.textContent = '▲';
                }
            };
            
            // Toggle fields visibility based on mode
            const modeRadios = modeDiv.querySelectorAll('input[type="radio"]');
            modeRadios.forEach(radio => {
                radio.onchange = () => {
                    fieldsDiv.style.display = radio.value === 'edit' ? 'block' : 'none';
                };
            });
            
            return section;
        }
        
        function getFieldTypeLabel(field) {
            if (field.domain && field.domain.type === 'coded-value') {
                return 'Dropdown';
            }
            switch(field.type) {
                case 'integer':
                case 'small-integer':
                    return 'Number';
                case 'double':
                case 'single':
                    return 'Decimal';
                case 'date':
                    return 'Date';
                case 'string':
                    return 'Text';
                default:
                    return field.type;
            }
        }
        
        function buildSummary() {
            layerConfigs = [];
            
            const sections = $("#layerConfigContainer").querySelectorAll('[data-layer-id]');
            sections.forEach(section => {
                const layerId = parseInt(section.dataset.layerId);
                const checkbox = section.querySelector(`#layer_${layerId}_enabled`);
                
                if (checkbox && checkbox.checked) {
                    const data = selectedFeaturesByLayer.get(layerId);
                    const mode = section.querySelector(`input[name="mode_${layerId}"]:checked`).value;
                    
                    const config = {
                        layerId: layerId,
                        layer: data.layer,
                        features: data.features,
                        mode: mode,
                        order: parseInt(section.dataset.order),
                        showPopup: section.querySelector(`#popup_${layerId}`).checked,
                        allowSkip: section.querySelector(`#allowskip_${layerId}`).checked,
                        fields: []
                    };
                    
                    if (mode === 'edit') {
                        const fieldChecks = section.querySelectorAll(`#fields_${layerId} input[type="checkbox"]:checked`);
                        fieldChecks.forEach(check => {
                            const fieldName = check.dataset.fieldName;
                            const field = data.layer.fields.find(f => f.name === fieldName);
                            if (field) {
                                config.fields.push(field);
                            }
                        });
                    }
                    
                    layerConfigs.push(config);
                }
            });
            
            // Sort by order
            layerConfigs.sort((a, b) => a.order - b.order);
            
            // Display summary
            let html = '';
            if (layerConfigs.length === 0) {
                html = '<em style="color:#dc3545;">No layers selected. Please select at least one layer to process.</em>';
                $("#startEditingBtn").disabled = true;
            } else {
                $("#startEditingBtn").disabled = false;
                
                let totalFeatures = 0;
                layerConfigs.forEach((config, idx) => {
                    totalFeatures += config.features.length;
                    
                    html += `<div style="margin-bottom:8px;padding:6px;background:#fff;border:1px solid #dee2e6;border-radius:2px;">`;
                    html += `<strong>${idx + 1}. ${config.mode === 'edit' ? 'Edit' : 'View'} ${config.layer.title}</strong><br>`;
                    html += `<span style="font-size:11px;color:#666;">${config.features.length} features</span><br>`;
                    
                    if (config.mode === 'edit' && config.fields.length > 0) {
                        html += `<span style="font-size:11px;">Fields: ${config.fields.map(f => f.alias || f.name).join(', ')}</span>`;
                    } else if (config.mode === 'view') {
                        html += `<span style="font-size:11px;">View only</span>`;
                    }
                    
                    html += `</div>`;
                });
                
                html = `<div style="margin-bottom:12px;padding:6px;background:#d4edda;border:1px solid #c3e6cb;border-radius:2px;font-weight:bold;">
                    Total: ${totalFeatures} features to process
                </div>` + html;
            }
            
            $("#summaryContent").innerHTML = html;
            setPhase('summary');
            updateStatus("Review your configuration before starting.");
        }
        
        function startEditing() {
            // Check if bulk edit mode is enabled
            const bulkEditEnabled = $("#bulkEditMode").checked;
            
            if (bulkEditEnabled) {
                startBulkEdit();
                return;
            }
            
            // Build flat queue for sequential editing
            currentEditingQueue = [];
            
            layerConfigs.forEach(config => {
                config.features.forEach(feature => {
                    currentEditingQueue.push({
                        layer: config.layer,
                        feature: feature,
                        fields: config.fields,
                        mode: config.mode,
                        showPopup: config.showPopup,
                        allowSkip: config.allowSkip
                    });
                });
            });
            
            currentIndex = 0;
            setPhase('editing');
            showCurrentFeature();
        }
        
        // Bulk Edit Functions
        let currentBulkLayerIndex = 0;
        
        function startBulkEdit() {
            currentBulkLayerIndex = 0;
            setPhase('bulkEdit');
            showBulkEditForm();
        }
        
        function showBulkEditForm() {
            // Filter to only layers with edit mode
            const editLayers = layerConfigs.filter(c => c.mode === 'edit' && c.fields.length > 0);
            
            if (editLayers.length === 0) {
                alert('No layers configured for editing. Please configure at least one layer with fields to edit.');
                setPhase('summary');
                return;
            }
            
            if (currentBulkLayerIndex >= editLayers.length) {
                // All bulk edits complete
                setPhase('complete');
                updateStatus('All bulk edits applied successfully!');
                return;
            }
            
            const config = editLayers[currentBulkLayerIndex];
            
            // Show layer selector
            const selectorHTML = `
                <div style="padding:8px;background:#f8f9fa;border:1px solid #dee2e6;border-radius:3px;">
                    <strong>Layer ${currentBulkLayerIndex + 1} of ${editLayers.length}:</strong> ${config.layer.title}<br>
                    <span style="font-size:11px;color:#666;">Features to update: ${config.features.length}</span>
                </div>
            `;
            $("#bulkEditLayerSelector").innerHTML = selectorHTML;
            
            // Build form for this layer's fields
            const formContainer = $("#bulkEditFormContainer");
            formContainer.innerHTML = '<div style="font-weight:bold;margin-bottom:8px;">Set values to apply to all features:</div>';
            
            config.fields.forEach(field => {
                const input = createFieldInput(field, null);
                formContainer.appendChild(input);
            });
            
            // Update preview button text
            $("#applyBulkEditBtn").textContent = `Apply to ${config.features.length} Features`;
            $("#bulkEditResults").innerHTML = '';
            $("#bulkEditPreview").style.display = 'none';
            
            updateStatus(`Bulk editing ${config.layer.title} - Set values for ${config.features.length} features`);
        }
        
        async function applyBulkEdit() {
            const editLayers = layerConfigs.filter(c => c.mode === 'edit' && c.fields.length > 0);
            const config = editLayers[currentBulkLayerIndex];
            
            // Collect values from form
            const bulkValues = {};
            let hasValues = false;
            
            const inputs = $("#bulkEditFormContainer").querySelectorAll('input, select');
            inputs.forEach(input => {
                const fieldName = input.dataset.fieldName;
                const fieldType = input.dataset.fieldType;
                const value = input.value;
                
                if (value !== '') {
                    hasValues = true;
                    
                    if (fieldType === 'integer' || fieldType === 'small-integer') {
                        bulkValues[fieldName] = parseInt(value);
                    } else if (fieldType === 'double' || fieldType === 'single') {
                        bulkValues[fieldName] = parseFloat(value);
                    } else if (fieldType === 'date') {
                        bulkValues[fieldName] = new Date(value).getTime();
                    } else {
                        bulkValues[fieldName] = value;
                    }
                }
            });
            
            if (!hasValues) {
                alert('Please enter at least one value to apply.');
                return;
            }
            
            // Confirm
            const fieldNames = Object.keys(bulkValues).join(', ');
            if (!confirm(`Apply these values to ${config.features.length} features?\n\nFields: ${fieldNames}`)) {
                return;
            }
            
            updateStatus('Applying bulk edit...');
            $("#applyBulkEditBtn").disabled = true;
            
            try {
                // Build update features array
                const updateFeatures = config.features.map(feature => {
                    const oidField = getObjectIdField(feature);
                    const oid = feature.attributes[oidField];
                    
                    return {
                        attributes: {
                            [oidField]: oid,
                            ...bulkValues
                        }
                    };
                });
                
                // Apply edits in batches
                const batchSize = 100;
                let successCount = 0;
                let errorCount = 0;
                const errors = [];
                
                for (let i = 0; i < updateFeatures.length; i += batchSize) {
                    const batch = updateFeatures.slice(i, i + batchSize);
                    
                    const result = await config.layer.applyEdits({
                        updateFeatures: batch
                    });
                    
                    if (result.updateFeatureResults) {
                        result.updateFeatureResults.forEach((res, idx) => {
                            const isSuccess = res.success === true || 
                                            (res.success === undefined && 
                                             res.error === null && 
                                             (res.objectId || res.globalId));
                            
                            if (isSuccess) {
                                successCount++;
                            } else {
                                errorCount++;
                                errors.push(`Feature ${batch[idx].attributes[getObjectIdField(config.features[0])]}: ${res.error?.message || 'Unknown error'}`);
                            }
                        });
                    }
                    
                    // Update progress
                    updateStatus(`Processed ${Math.min(i + batchSize, updateFeatures.length)} of ${updateFeatures.length}...`);
                }
                
                // Show results
                let resultsHTML = `
                    <div style="padding:8px;background:#d4edda;border:1px solid #c3e6cb;border-radius:3px;margin-bottom:8px;">
                        <strong>✓ Bulk Edit Complete</strong><br>
                        Successfully updated: ${successCount}<br>
                        ${errorCount > 0 ? `Failed: ${errorCount}<br>` : ''}
                    </div>
                `;
                
                if (errors.length > 0) {
                    resultsHTML += `
                        <div style="padding:8px;background:#f8d7da;border:1px solid #f5c6cb;border-radius:3px;max-height:150px;overflow-y:auto;">
                            <strong>Errors:</strong><br>
                            <div style="font-size:10px;">${errors.slice(0, 10).join('<br>')}</div>
                            ${errors.length > 10 ? `<div style="font-size:10px;color:#666;">...and ${errors.length - 10} more</div>` : ''}
                        </div>
                    `;
                }
                
                $("#bulkEditResults").innerHTML = resultsHTML;
                
                // Move to next layer after a delay
                if (currentBulkLayerIndex < editLayers.length - 1) {
                    updateStatus('Bulk edit applied. Moving to next layer...');
                    setTimeout(() => {
                        currentBulkLayerIndex++;
                        showBulkEditForm();
                    }, 2000);
                } else {
                    updateStatus('All bulk edits complete!');
                    setTimeout(() => {
                        setPhase('complete');
                    }, 2000);
                }
                
            } catch (error) {
                $("#bulkEditResults").innerHTML = `
                    <div style="padding:8px;background:#f8d7da;border:1px solid #f5c6cb;border-radius:3px;">
                        <strong>Error:</strong> ${error.message}
                    </div>
                `;
                updateStatus('Error applying bulk edit: ' + error.message);
            } finally {
                $("#applyBulkEditBtn").disabled = false;
            }
        }
        
        function showCurrentFeature() {
            if (currentIndex >= currentEditingQueue.length) {
                setPhase('complete');
                clearHighlights();
                updateStatus("All features processed!");
                return;
            }
            
            const item = currentEditingQueue[currentIndex];
            
            // Update progress
            $("#editingProgress").innerHTML = `
                <strong>Progress:</strong> ${currentIndex + 1} of ${currentEditingQueue.length}<br>
                <strong>Layer:</strong> ${item.layer.title}
            `;
            
            // Update feature info
            const oidField = getObjectIdField(item.feature);
            const oid = item.feature.attributes[oidField];
            
            $("#featureInfo").innerHTML = `
                <strong>Current Feature:</strong><br>
                Object ID: ${oid}<br>
                Mode: ${item.mode === 'edit' ? 'Editing' : 'View Only'}
            `;
            
            // Build form
            const formContainer = $("#editFormContainer");
            formContainer.innerHTML = '';
            
            if (item.mode === 'edit' && item.fields.length > 0) {
                item.fields.forEach(field => {
                    const input = createFieldInput(field, item.feature.attributes[field.name]);
                    formContainer.appendChild(input);
                });
            } else {
                formContainer.innerHTML = '<div style="color:#666;font-style:italic;">View only - no fields to edit</div>';
            }
            
            // Update buttons
            $("#prevBtn").disabled = currentIndex === 0;
            $("#skipBtn").style.display = item.allowSkip ? 'block' : 'none';
            
            // Highlight feature
            highlightFeature(item.feature, item.showPopup);
            
            updateStatus(`${item.mode === 'edit' ? 'Editing' : 'Viewing'} feature ${currentIndex + 1} of ${currentEditingQueue.length}`);
        }
        
        function getObjectIdField(feature) {
            if (feature.attributes.objectid !== undefined) return 'objectid';
            if (feature.attributes.OBJECTID !== undefined) return 'OBJECTID';
            if (feature.layer && feature.layer.objectIdField) return feature.layer.objectIdField;
            
            const attrs = Object.keys(feature.attributes);
            const oidKey = attrs.find(k => k.toUpperCase() === 'OBJECTID');
            return oidKey || 'objectid';
        }
        
        function createFieldInput(field, currentValue) {
            const container = document.createElement('div');
            container.style.marginBottom = '8px';
            
            const label = document.createElement('label');
            label.textContent = field.alias || field.name;
            label.style.display = 'block';
            label.style.fontWeight = 'bold';
            label.style.marginBottom = '4px';
            
            let input;
            
            if (field.domain && field.domain.type === 'coded-value') {
                input = document.createElement('select');
                input.innerHTML = '<option value="">-- Select --</option>';
                field.domain.codedValues.forEach(cv => {
                    const opt = document.createElement('option');
                    opt.value = cv.code;
                    opt.textContent = cv.name;
                    if (cv.code === currentValue) opt.selected = true;
                    input.appendChild(opt);
                });
                
            } else if (field.type === 'date') {
                input = document.createElement('input');
                input.type = 'date';
                if (currentValue) {
                    input.value = new Date(currentValue).toISOString().split('T')[0];
                }
                
            } else if (field.type === 'integer' || field.type === 'small-integer') {
                input = document.createElement('input');
                input.type = 'number';
                input.step = '1';
                input.value = currentValue ?? '';
                
            } else if (field.type === 'double' || field.type === 'single') {
                input = document.createElement('input');
                input.type = 'number';
                input.step = 'any';
                input.value = currentValue ?? '';
                
            } else {
                input = document.createElement('input');
                input.type = 'text';
                input.value = currentValue ?? '';
                if (field.length) input.maxLength = field.length;
            }
            
            input.style.width = '100%';
            input.style.padding = '4px';
            input.style.border = '1px solid #ccc';
            input.style.borderRadius = '2px';
            input.dataset.fieldName = field.name;
            input.dataset.fieldType = field.type;
            
            if (currentValue !== null && currentValue !== undefined && currentValue !== '') {
                const hint = document.createElement('div');
                hint.style.fontSize = '10px';
                hint.style.color = '#666';
                hint.style.marginBottom = '2px';
                hint.textContent = `Current: ${currentValue}`;
                container.appendChild(hint);
            }
            
            container.appendChild(label);
            container.appendChild(input);
            
            return container;
        }
        
        function highlightFeature(feature, showPopup) {
            clearHighlights();
            
            let symbol;
            if (feature.geometry.type === "point") {
                symbol = {
                    type: "simple-marker",
                    color: [255, 255, 0, 0.8],
                    size: 20,
                    outline: { color: [255, 255, 255, 1], width: 4 }
                };
            } else if (feature.geometry.type === "polyline") {
                symbol = {
                    type: "simple-line",
                    color: [255, 255, 0, 0.8],
                    width: 8,
                    style: "solid"
                };
            } else if (feature.geometry.type === "polygon") {
                symbol = {
                    type: "simple-fill",
                    color: [255, 255, 0, 0.5],
                    outline: { color: [255, 255, 255, 1], width: 4 }
                };
            }
            
            const graphic = {
                geometry: feature.geometry,
                symbol: symbol
            };
            
            mapView.graphics.add(graphic);
            highlightGraphics.push(graphic);
            
            mapView.goTo({
                target: feature.geometry,
                scale: Math.min(mapView.scale, 2000)
            }, {duration: 800}).then(() => {
                if (showPopup && mapView.popup) {
                    showFeaturePopup(feature);
                }
            }).catch(() => {
                if (showPopup && mapView.popup) {
                    showFeaturePopup(feature);
                }
            });
        }
        
        async function showFeaturePopup(feature) {
            try {
                const oidField = getObjectIdField(feature);
                const oid = feature.attributes[oidField];
                
                const queryResult = await feature.layer.queryFeatures({
                    where: `${oidField} = ${oid}`,
                    outFields: ['*'],
                    returnGeometry: true
                });
                
                if (queryResult.features.length > 0) {
                    mapView.popup.open({
                        features: queryResult.features,
                        location: getPopupLocation(feature.geometry)
                    });
                }
            } catch (error) {
                mapView.popup.open({
                    features: [{
                        geometry: feature.geometry,
                        attributes: feature.attributes
                    }],
                    location: getPopupLocation(feature.geometry)
                });
            }
        }
        
        function getPopupLocation(geometry) {
            try {
                if (geometry.type === "point") {
                    return geometry;
                } else if (geometry.type === "polyline") {
                    if (geometry.paths && geometry.paths[0] && geometry.paths[0].length > 0) {
                        const path = geometry.paths[0];
                        const midIndex = Math.floor(path.length / 2);
                        return {
                            type: "point",
                            x: path[midIndex][0],
                            y: path[midIndex][1],
                            spatialReference: geometry.spatialReference
                        };
                    }
                } else if (geometry.type === "polygon") {
                    if (geometry.centroid) {
                        return geometry.centroid;
                    } else if (geometry.rings && geometry.rings[0] && geometry.rings[0].length > 0) {
                        const ring = geometry.rings[0];
                        let sumX = 0, sumY = 0;
                        for (let i = 0; i < ring.length - 1; i++) {
                            sumX += ring[i][0];
                            sumY += ring[i][1];
                        }
                        return {
                            type: "point",
                            x: sumX / (ring.length - 1),
                            y: sumY / (ring.length - 1),
                            spatialReference: geometry.spatialReference
                        };
                    }
                }
                
                if (geometry.extent && geometry.extent.center) {
                    return geometry.extent.center;
                }
                
                return geometry;
            } catch (error) {
                return geometry;
            }
        }
        
        async function submitFeature() {
            const item = currentEditingQueue[currentIndex];
            
            if (item.mode === 'view') {
                currentIndex++;
                showCurrentFeature();
                return;
            }
            
            try {
                updateStatus("Updating feature...");
                
                const oidField = getObjectIdField(item.feature);
                const oid = item.feature.attributes[oidField];
                
                const updateAttributes = {
                    [oidField]: oid
                };
                
                // Collect values from form
                const inputs = $("#editFormContainer").querySelectorAll('input, select');
                inputs.forEach(input => {
                    const fieldName = input.dataset.fieldName;
                    const fieldType = input.dataset.fieldType;
                    const value = input.value;
                    
                    if (value !== '') {
                        if (fieldType === 'integer' || fieldType === 'small-integer') {
                            updateAttributes[fieldName] = parseInt(value);
                        } else if (fieldType === 'double' || fieldType === 'single') {
                            updateAttributes[fieldName] = parseFloat(value);
                        } else if (fieldType === 'date') {
                            updateAttributes[fieldName] = new Date(value).getTime();
                        } else {
                            updateAttributes[fieldName] = value;
                        }
                    }
                });
                
                const updateFeature = {
                    attributes: updateAttributes
                };
                
                const result = await item.layer.applyEdits({
                    updateFeatures: [updateFeature]
                });
                
                if (result.updateFeatureResults && result.updateFeatureResults.length > 0) {
                    const updateResult = result.updateFeatureResults[0];
                    
                    const isSuccess = updateResult.success === true || 
                                    (updateResult.success === undefined && 
                                     updateResult.error === null && 
                                     (updateResult.objectId || updateResult.globalId));
                    
                    if (isSuccess) {
                        updateStatus("Feature updated successfully!");
                        currentIndex++;
                        setTimeout(() => showCurrentFeature(), 500);
                    } else {
                        let errorMessage = "Unknown error";
                        if (updateResult.error && updateResult.error.message) {
                            errorMessage = updateResult.error.message;
                        }
                        throw new Error(`Update failed: ${errorMessage}`);
                    }
                } else {
                    throw new Error('No update results returned from server');
                }
                
            } catch (error) {
                updateStatus("Error updating feature: " + error.message);
                alert("Error updating feature: " + error.message);
            }
        }
        
        function skipFeature() {
            currentIndex++;
            showCurrentFeature();
        }
        
        function prevFeature() {
            if (currentIndex > 0) {
                currentIndex--;
                showCurrentFeature();
            }
        }
        
        function startOver() {
            currentIndex = 0;
            layerConfigs = [];
            currentEditingQueue = [];
            clearPolygonSelection();
            setPhase('selection');
            updateStatus("Ready to start over. Draw a polygon to select features.");
        }
        
        // Configuration Save/Load Functions
        function saveConfiguration() {
            // Build config from current UI state
            const config = {
                layers: []
            };
            
            const sections = $("#layerConfigContainer").querySelectorAll('[data-layer-id]');
            sections.forEach(section => {
                const layerId = parseInt(section.dataset.layerId);
                const checkbox = section.querySelector(`#layer_${layerId}_enabled`);
                
                if (checkbox && checkbox.checked) {
                    const data = selectedFeaturesByLayer.get(layerId);
                    const mode = section.querySelector(`input[name="mode_${layerId}"]:checked`).value;
                    
                    const layerConfig = {
                        layerId: layerId,
                        layerTitle: data.layer.title,
                        mode: mode,
                        order: parseInt(section.dataset.order),
                        showPopup: section.querySelector(`#popup_${layerId}`).checked,
                        allowSkip: section.querySelector(`#allowskip_${layerId}`).checked,
                        fields: []
                    };
                    
                    if (mode === 'edit') {
                        const fieldChecks = section.querySelectorAll(`#fields_${layerId} input[type="checkbox"]:checked`);
                        fieldChecks.forEach(check => {
                            layerConfig.fields.push(check.dataset.fieldName);
                        });
                    }
                    
                    config.layers.push(layerConfig);
                }
            });
            
            if (config.layers.length === 0) {
                alert('No layers configured. Please configure at least one layer before saving.');
                return;
            }
            
            // Prompt for name
            const configName = prompt('Enter a name for this configuration:', 'My Configuration');
            if (!configName) return;
            
            config.name = configName;
            config.savedAt = new Date().toISOString();
            
            // Save to localStorage
            const savedConfigs = getSavedConfigurations();
            const configId = 'config_' + Date.now();
            savedConfigs[configId] = config;
            
            try {
                localStorage.setItem('sequentialEditorConfigs', JSON.stringify(savedConfigs));
                updateStatus(`Configuration "${configName}" saved successfully!`);
                loadSavedConfigurationsList();
            } catch (e) {
                alert('Error saving configuration: ' + e.message);
            }
        }
        
        function getSavedConfigurations() {
            try {
                const saved = localStorage.getItem('sequentialEditorConfigs');
                return saved ? JSON.parse(saved) : {};
            } catch (e) {
                return {};
            }
        }
        
        function loadSavedConfigurationsList() {
            const select = $("#savedConfigSelect");
            select.innerHTML = '<option value="">-- Select a saved configuration --</option>';
            
            const savedConfigs = getSavedConfigurations();
            
            Object.keys(savedConfigs).forEach(configId => {
                const config = savedConfigs[configId];
                const option = document.createElement('option');
                option.value = configId;
                
                const date = new Date(config.savedAt);
                const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
                
                option.textContent = `${config.name} (${dateStr})`;
                select.appendChild(option);
            });
        }
        
        function loadConfiguration() {
            const select = $("#savedConfigSelect");
            const configId = select.value;
            
            if (!configId) {
                alert('Please select a configuration to load.');
                return;
            }
            
            const savedConfigs = getSavedConfigurations();
            const config = savedConfigs[configId];
            
            if (!config) {
                alert('Configuration not found.');
                return;
            }
            
            // Apply configuration to UI
            const sections = $("#layerConfigContainer").querySelectorAll('[data-layer-id]');
            
            sections.forEach(section => {
                const layerId = parseInt(section.dataset.layerId);
                const checkbox = section.querySelector(`#layer_${layerId}_enabled`);
                
                // Find matching config
                const layerConfig = config.layers.find(lc => lc.layerId === layerId);
                
                if (layerConfig) {
                    // Enable this layer
                    checkbox.checked = true;
                    
                    // Expand the section
                    const body = section.querySelector('div[style*="padding: 8px"]');
                    if (body) {
                        body.style.display = 'block';
                        const expandIcon = section.querySelector('span');
                        if (expandIcon) expandIcon.textContent = '▲';
                    }
                    
                    // Set mode
                    const modeRadio = section.querySelector(`input[name="mode_${layerId}"][value="${layerConfig.mode}"]`);
                    if (modeRadio) {
                        modeRadio.checked = true;
                        
                        // Trigger mode change event to show/hide fields
                        const fieldsDiv = section.querySelector(`#fields_${layerId}`);
                        if (fieldsDiv) {
                            fieldsDiv.style.display = layerConfig.mode === 'edit' ? 'block' : 'none';
                        }
                    }
                    
                    // Set order
                    section.dataset.order = layerConfig.order;
                    const orderInput = section.querySelector('.orderInput');
                    if (orderInput) orderInput.value = layerConfig.order;
                    
                    // Set options
                    const popupCheck = section.querySelector(`#popup_${layerId}`);
                    if (popupCheck) popupCheck.checked = layerConfig.showPopup;
                    
                    const skipCheck = section.querySelector(`#allowskip_${layerId}`);
                    if (skipCheck) skipCheck.checked = layerConfig.allowSkip;
                    
                    // Set fields
                    if (layerConfig.mode === 'edit' && layerConfig.fields.length > 0) {
                        const fieldChecks = section.querySelectorAll(`#fields_${layerId} input[type="checkbox"]`);
                        fieldChecks.forEach(check => {
                            check.checked = layerConfig.fields.includes(check.dataset.fieldName);
                        });
                    }
                } else {
                    // Disable this layer
                    checkbox.checked = false;
                }
            });
            
            updateStatus(`Configuration "${config.name}" loaded successfully!`);
        }
        
        function deleteConfiguration() {
            const select = $("#savedConfigSelect");
            const configId = select.value;
            
            if (!configId) {
                alert('Please select a configuration to delete.');
                return;
            }
            
            const savedConfigs = getSavedConfigurations();
            const config = savedConfigs[configId];
            
            if (!config) {
                alert('Configuration not found.');
                return;
            }
            
            if (!confirm(`Are you sure you want to delete the configuration "${config.name}"?`)) {
                return;
            }
            
            delete savedConfigs[configId];
            
            try {
                localStorage.setItem('sequentialEditorConfigs', JSON.stringify(savedConfigs));
                updateStatus(`Configuration "${config.name}" deleted.`);
                loadSavedConfigurationsList();
            } catch (e) {
                alert('Error deleting configuration: ' + e.message);
            }
        }
        
        function cleanup() {
            if (sketchViewModel) {
                sketchViewModel.destroy();
                sketchViewModel = null;
            }
            
            clearHighlights();
            
            if (polygonGraphic) {
                mapView.graphics.remove(polygonGraphic);
            }
            
            toolBox.remove();
        }
        
        // Event listeners
        $("#drawPolygonBtn").onclick = enablePolygonDrawing;
        $("#clearPolygonBtn").onclick = clearPolygonSelection;
        $("#configureLayersBtn").onclick = showLayerConfiguration;
        $("#saveConfigBtn").onclick = saveConfiguration;
        $("#loadConfigBtn").onclick = loadConfiguration;
        $("#deleteConfigBtn").onclick = deleteConfiguration;
        $("#showSummaryBtn").onclick = buildSummary;
        $("#backToConfigBtn").onclick = () => setPhase('configuration');
        $("#startEditingBtn").onclick = startEditing;
        
        $("#submitBtn").onclick = submitFeature;
        $("#skipBtn").onclick = skipFeature;
        $("#prevBtn").onclick = prevFeature;
        $("#clearHighlightsBtn").onclick = clearHighlights;
        
        $("#applyBulkEditBtn").onclick = applyBulkEdit;
        $("#backToSummaryBtn").onclick = () => setPhase('summary');
        
        $("#startOverBtn").onclick = startOver;
        
        $("#closeTool").onclick = () => {
            window.gisToolHost.closeTool('generic-sequential-editor');
        };
        
        // Initialize
        setPhase('selection');
        updateStatus("Ready. Click 'Draw Selection Polygon' to start selecting features.");
        
        // Register tool with host
        window.gisToolHost.activeTools.set('generic-sequential-editor', {
            cleanup: cleanup,
            toolBox: toolBox
        });
        
    } catch (error) {
        alert("Error creating Generic Sequential Editor Tool: " + (error.message || error));
    }
})();
