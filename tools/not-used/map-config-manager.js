// tools/map-configuration-manager.js - Save and Load Map Layer Configurations
// Saves: visibility, filters, labels, opacity for all layers

(function() {
    try {
        if (window.gisToolHost.activeTools.has('map-config-manager')) {
            return;
        }
        
        const existingToolbox = document.getElementById('mapConfigManagerToolbox');
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
        let currentSnapshot = null;
        let previewChanges = null;
        
        // Create tool UI
        const toolBox = document.createElement("div");
        toolBox.id = "mapConfigManagerToolbox";
        toolBox.style.cssText = `
            position: fixed;
            top: 80px;
            right: 40px;
            z-index: ${z};
            background: #fff;
            border: 1px solid #333;
            padding: 12px;
            width: 450px;
            max-height: 85vh;
            overflow: auto;
            font: 12px/1.3 Arial, sans-serif;
            box-shadow: 0 4px 16px rgba(0,0,0,.2);
            border-radius: 4px;
        `;
        
        toolBox.innerHTML = `
            <div style="font-weight:bold;margin-bottom:12px;font-size:14px;">🗺️ Map Configuration Manager</div>
            
            <div style="margin-bottom:12px;color:#666;font-size:11px;">
                Save and load layer visibility, filters, labels, and transparency settings.
            </div>
            
            <!-- Current State Section -->
            <div style="border:1px solid #dee2e6;border-radius:4px;margin-bottom:12px;overflow:hidden;">
                <div style="padding:8px;background:#e9ecef;font-weight:bold;">
                    📸 Current Map State
                </div>
                <div style="padding:8px;">
                    <button id="captureStateBtn" style="width:100%;padding:6px 12px;background:#17a2b8;color:white;border:none;border-radius:3px;cursor:pointer;margin-bottom:8px;">
                        Capture Current State
                    </button>
                    <div id="currentStateDisplay" style="font-size:11px;color:#666;">
                        <em>Click to capture current layer settings</em>
                    </div>
                </div>
            </div>
            
            <!-- Save Configuration Section -->
            <div style="border:1px solid #dee2e6;border-radius:4px;margin-bottom:12px;overflow:hidden;">
                <div style="padding:8px;background:#e9ecef;font-weight:bold;">
                    💾 Save Configuration
                </div>
                <div style="padding:8px;">
                    <input type="text" id="configNameInput" placeholder="Enter configuration name..." 
                        style="width:100%;padding:6px;border:1px solid #ccc;border-radius:3px;margin-bottom:8px;">
                    <button id="saveConfigBtn" style="width:100%;padding:6px 12px;background:#28a745;color:white;border:none;border-radius:3px;cursor:pointer;" disabled>
                        Save Current State
                    </button>
                    <div id="saveStatus" style="margin-top:8px;font-size:11px;"></div>
                </div>
            </div>
            
            <!-- Load Configuration Section -->
            <div style="border:1px solid #dee2e6;border-radius:4px;margin-bottom:12px;overflow:hidden;">
                <div style="padding:8px;background:#e9ecef;font-weight:bold;">
                    📂 Load Configuration
                </div>
                <div style="padding:8px;">
                    <select id="savedConfigSelect" style="width:100%;padding:6px;border:1px solid #ccc;border-radius:3px;margin-bottom:8px;">
                        <option value="">-- Select a saved configuration --</option>
                    </select>
                    <div style="display:flex;gap:8px;margin-bottom:8px;">
                        <button id="previewConfigBtn" style="flex:1;padding:6px 12px;background:#007bff;color:white;border:none;border-radius:3px;cursor:pointer;">
                            Preview Changes
                        </button>
                        <button id="deleteConfigBtn" style="flex:1;padding:6px 12px;background:#dc3545;color:white;border:none;border-radius:3px;cursor:pointer;">
                            Delete
                        </button>
                    </div>
                    <div id="previewDisplay" style="margin-bottom:8px;"></div>
                    <button id="applyConfigBtn" style="width:100%;padding:8px 12px;background:#28a745;color:white;border:none;border-radius:3px;cursor:pointer;font-weight:bold;display:none;">
                        Apply Configuration
                    </button>
                </div>
            </div>
            
            <!-- Export/Import Section -->
            <div style="border:1px solid #dee2e6;border-radius:4px;margin-bottom:12px;overflow:hidden;">
                <div style="padding:8px;background:#e9ecef;font-weight:bold;">
                    📤 Export / Import
                </div>
                <div style="padding:8px;">
                    <button id="exportConfigBtn" style="width:100%;padding:6px 12px;background:#6c757d;color:white;border:none;border-radius:3px;cursor:pointer;margin-bottom:8px;">
                        Export Selected Config
                    </button>
                    <button id="exportAllBtn" style="width:100%;padding:6px 12px;background:#6c757d;color:white;border:none;border-radius:3px;cursor:pointer;margin-bottom:8px;">
                        Export All Configs
                    </button>
                    <input type="file" id="importFileInput" accept=".json" style="display:none;">
                    <button id="importConfigBtn" style="width:100%;padding:6px 12px;background:#ffc107;color:black;border:none;border-radius:3px;cursor:pointer;">
                        Import Config File
                    </button>
                    <div id="importStatus" style="margin-top:8px;font-size:11px;"></div>
                </div>
            </div>
            
            <div style="border-top:1px solid #ddd;margin-top:12px;padding-top:8px;">
                <button id="closeTool" style="width:100%;padding:6px;background:#d32f2f;color:white;border:none;border-radius:3px;cursor:pointer;">
                    Close Tool
                </button>
            </div>
            
            <div id="toolStatus" style="margin-top:8px;color:#3367d6;font-size:11px;"></div>
        `;
        
        document.body.appendChild(toolBox);
        
        const $ = (id) => toolBox.querySelector(id);
        const status = $("#toolStatus");
        
        function updateStatus(message, isError = false) {
            status.textContent = message;
            status.style.color = isError ? '#dc3545' : '#3367d6';
        }
        
        // ===== CAPTURE STATE =====
        
        function captureCurrentState() {
            try {
                updateStatus("Capturing current map state...");
                
                const allLayers = mapView.map.allLayers.filter(l => l.type === "feature");
                
                if (allLayers.length === 0) {
                    updateStatus("No feature layers found in map.", true);
                    return null;
                }
                
                const snapshot = {
                    capturedAt: new Date().toISOString(),
                    layers: []
                };
                
                allLayers.forEach(layer => {
                    const layerState = {
                        layerId: layer.layerId,
                        title: layer.title,
                        visible: layer.visible,
                        labelsVisible: layer.labelsVisible !== undefined ? layer.labelsVisible : null,
                        opacity: layer.opacity !== undefined ? layer.opacity : 1,
                        definitionExpression: layer.definitionExpression || null
                    };
                    
                    snapshot.layers.push(layerState);
                });
                
                currentSnapshot = snapshot;
                displayCurrentState();
                $("#saveConfigBtn").disabled = false;
                
                updateStatus(`Captured state for ${snapshot.layers.length} layers.`);
                return snapshot;
                
            } catch (error) {
                updateStatus("Error capturing state: " + error.message, true);
                return null;
            }
        }
        
        function displayCurrentState() {
            if (!currentSnapshot) return;
            
            const display = $("#currentStateDisplay");
            
            let html = `<div style="padding:8px;background:#f8f9fa;border:1px solid #dee2e6;border-radius:3px;">`;
            html += `<strong>Captured ${currentSnapshot.layers.length} layers:</strong><br>`;
            html += `<div style="max-height:200px;overflow-y:auto;margin-top:4px;">`;
            
            currentSnapshot.layers.forEach(layer => {
                const details = [];
                if (!layer.visible) details.push("Hidden");
                if (layer.labelsVisible) details.push("Labels On");
                if (layer.opacity !== 1) details.push(`${Math.round(layer.opacity * 100)}% opacity`);
                if (layer.definitionExpression) details.push("Filtered");
                
                const detailStr = details.length > 0 ? ` (${details.join(', ')})` : '';
                
                html += `<div style="padding:2px 0;font-size:11px;">• ${layer.title}${detailStr}</div>`;
            });
            
            html += `</div></div>`;
            display.innerHTML = html;
        }
        
        // ===== SAVE CONFIGURATION =====
        
        function saveConfiguration() {
            if (!currentSnapshot) {
                alert("Please capture current state first.");
                return;
            }
            
            const configName = $("#configNameInput").value.trim();
            if (!configName) {
                alert("Please enter a configuration name.");
                return;
            }
            
            const config = {
                name: configName,
                savedAt: new Date().toISOString(),
                layers: currentSnapshot.layers
            };
            
            const savedConfigs = getSavedConfigurations();
            const configId = 'config_' + Date.now();
            savedConfigs[configId] = config;
            
            try {
                localStorage.setItem('mapConfigManager', JSON.stringify(savedConfigs));
                $("#saveStatus").innerHTML = `<span style="color:#28a745;">✓ Saved "${configName}"</span>`;
                $("#configNameInput").value = '';
                loadSavedConfigurationsList();
                updateStatus(`Configuration "${configName}" saved successfully!`);
            } catch (e) {
                $("#saveStatus").innerHTML = `<span style="color:#dc3545;">✗ Error: ${e.message}</span>`;
                updateStatus("Error saving configuration: " + e.message, true);
            }
        }
        
        function getSavedConfigurations() {
            try {
                const saved = localStorage.getItem('mapConfigManager');
                return saved ? JSON.parse(saved) : {};
            } catch (e) {
                return {};
            }
        }
        
        function loadSavedConfigurationsList() {
            const select = $("#savedConfigSelect");
            select.innerHTML = '<option value="">-- Select a saved configuration --</option>';
            
            const savedConfigs = getSavedConfigurations();
            
            Object.keys(savedConfigs).sort((a, b) => {
                return new Date(savedConfigs[b].savedAt) - new Date(savedConfigs[a].savedAt);
            }).forEach(configId => {
                const config = savedConfigs[configId];
                const option = document.createElement('option');
                option.value = configId;
                
                const date = new Date(config.savedAt);
                const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
                
                option.textContent = `${config.name} (${dateStr})`;
                select.appendChild(option);
            });
        }
        
        // ===== PREVIEW & APPLY =====
        
        function previewConfiguration() {
            const configId = $("#savedConfigSelect").value;
            if (!configId) {
                alert("Please select a configuration to preview.");
                return;
            }
            
            const savedConfigs = getSavedConfigurations();
            const config = savedConfigs[configId];
            
            if (!config) {
                alert("Configuration not found.");
                return;
            }
            
            // Compare config to current map state
            const currentState = captureCurrentState();
            if (!currentState) return;
            
            const changes = [];
            
            config.layers.forEach(savedLayer => {
                const currentLayer = currentState.layers.find(l => l.layerId === savedLayer.layerId);
                
                if (!currentLayer) {
                    changes.push({
                        type: 'warning',
                        layer: savedLayer.title,
                        message: 'Layer not found in current map'
                    });
                    return;
                }
                
                const layerChanges = [];
                
                if (savedLayer.visible !== currentLayer.visible) {
                    layerChanges.push(`Visibility: ${currentLayer.visible ? 'On' : 'Off'} → ${savedLayer.visible ? 'On' : 'Off'}`);
                }
                
                if (savedLayer.labelsVisible !== null && savedLayer.labelsVisible !== currentLayer.labelsVisible) {
                    layerChanges.push(`Labels: ${currentLayer.labelsVisible ? 'On' : 'Off'} → ${savedLayer.labelsVisible ? 'On' : 'Off'}`);
                }
                
                if (Math.abs(savedLayer.opacity - currentLayer.opacity) > 0.01) {
                    layerChanges.push(`Opacity: ${Math.round(currentLayer.opacity * 100)}% → ${Math.round(savedLayer.opacity * 100)}%`);
                }
                
                if (savedLayer.definitionExpression !== currentLayer.definitionExpression) {
                    const oldFilter = currentLayer.definitionExpression || 'None';
                    const newFilter = savedLayer.definitionExpression || 'None';
                    layerChanges.push(`Filter: ${oldFilter.substring(0, 30)}${oldFilter.length > 30 ? '...' : ''} → ${newFilter.substring(0, 30)}${newFilter.length > 30 ? '...' : ''}`);
                }
                
                if (layerChanges.length > 0) {
                    changes.push({
                        type: 'change',
                        layer: savedLayer.title,
                        changes: layerChanges
                    });
                }
            });
            
            previewChanges = { config, changes };
            displayPreview();
        }
        
        function displayPreview() {
            if (!previewChanges) return;
            
            const display = $("#previewDisplay");
            const { config, changes } = previewChanges;
            
            if (changes.length === 0) {
                display.innerHTML = `
                    <div style="padding:8px;background:#d4edda;border:1px solid #c3e6cb;border-radius:3px;">
                        <strong>✓ No Changes</strong><br>
                        <span style="font-size:11px;">Current map state matches this configuration.</span>
                    </div>
                `;
                $("#applyConfigBtn").style.display = "none";
                updateStatus("No changes needed.");
                return;
            }
            
            let html = `<div style="padding:8px;background:#fff3cd;border:1px solid #ffeaa7;border-radius:3px;">`;
            html += `<strong>Preview Changes (${changes.length}):</strong><br>`;
            html += `<div style="max-height:250px;overflow-y:auto;margin-top:4px;">`;
            
            changes.forEach(change => {
                if (change.type === 'warning') {
                    html += `<div style="padding:4px;margin:4px 0;background:#f8d7da;border-left:3px solid #dc3545;">`;
                    html += `<strong style="font-size:11px;">${change.layer}</strong><br>`;
                    html += `<span style="font-size:10px;color:#721c24;">${change.message}</span>`;
                    html += `</div>`;
                } else {
                    html += `<div style="padding:4px;margin:4px 0;background:#e3f2fd;border-left:3px solid #007bff;">`;
                    html += `<strong style="font-size:11px;">${change.layer}</strong><br>`;
                    change.changes.forEach(c => {
                        html += `<span style="font-size:10px;">• ${c}</span><br>`;
                    });
                    html += `</div>`;
                }
            });
            
            html += `</div></div>`;
            display.innerHTML = html;
            $("#applyConfigBtn").style.display = "block";
            updateStatus(`Preview ready: ${changes.length} layer(s) will change.`);
        }
        
        function applyConfiguration() {
            if (!previewChanges) {
                alert("Please preview changes first.");
                return;
            }
            
            const { config, changes } = previewChanges;
            
            if (changes.length === 0) {
                alert("No changes to apply.");
                return;
            }
            
            if (!confirm(`Apply configuration "${config.name}"?\n\n${changes.length} layer(s) will be updated.`)) {
                return;
            }
            
            try {
                updateStatus("Applying configuration...");
                
                let appliedCount = 0;
                let errorCount = 0;
                const errors = [];
                
                config.layers.forEach(savedLayer => {
                    try {
                        const layer = mapView.map.allLayers.find(l => l.layerId === savedLayer.layerId);
                        
                        if (!layer) {
                            errors.push(`${savedLayer.title}: Layer not found`);
                            errorCount++;
                            return;
                        }
                        
                        layer.visible = savedLayer.visible;
                        
                        if (savedLayer.labelsVisible !== null && layer.labelsVisible !== undefined) {
                            layer.labelsVisible = savedLayer.labelsVisible;
                        }
                        
                        if (savedLayer.opacity !== undefined) {
                            layer.opacity = savedLayer.opacity;
                        }
                        
                        layer.definitionExpression = savedLayer.definitionExpression;
                        
                        appliedCount++;
                        
                    } catch (layerError) {
                        errors.push(`${savedLayer.title}: ${layerError.message}`);
                        errorCount++;
                    }
                });
                
                // Clear preview
                previewChanges = null;
                $("#previewDisplay").innerHTML = '';
                $("#applyConfigBtn").style.display = "none";
                
                if (errorCount === 0) {
                    updateStatus(`✓ Configuration applied successfully! (${appliedCount} layers updated)`);
                    
                    $("#previewDisplay").innerHTML = `
                        <div style="padding:8px;background:#d4edda;border:1px solid #c3e6cb;border-radius:3px;">
                            <strong>✓ Successfully Applied</strong><br>
                            <span style="font-size:11px;">${appliedCount} layers updated.</span>
                        </div>
                    `;
                } else {
                    updateStatus(`Applied with ${errorCount} error(s). Check console for details.`, true);
                    console.error("Configuration apply errors:", errors);
                    
                    $("#previewDisplay").innerHTML = `
                        <div style="padding:8px;background:#f8d7da;border:1px solid #f5c6cb;border-radius:3px;">
                            <strong>⚠ Partially Applied</strong><br>
                            <span style="font-size:11px;">
                                Success: ${appliedCount}<br>
                                Errors: ${errorCount}
                            </span>
                        </div>
                    `;
                }
                
            } catch (error) {
                updateStatus("Error applying configuration: " + error.message, true);
                alert("Error applying configuration: " + error.message);
            }
        }
        
        function deleteConfiguration() {
            const configId = $("#savedConfigSelect").value;
            if (!configId) {
                alert("Please select a configuration to delete.");
                return;
            }
            
            const savedConfigs = getSavedConfigurations();
            const config = savedConfigs[configId];
            
            if (!config) {
                alert("Configuration not found.");
                return;
            }
            
            if (!confirm(`Delete configuration "${config.name}"?`)) {
                return;
            }
            
            delete savedConfigs[configId];
            
            try {
                localStorage.setItem('mapConfigManager', JSON.stringify(savedConfigs));
                updateStatus(`Configuration "${config.name}" deleted.`);
                loadSavedConfigurationsList();
                $("#previewDisplay").innerHTML = '';
                $("#applyConfigBtn").style.display = "none";
                previewChanges = null;
            } catch (e) {
                updateStatus("Error deleting configuration: " + e.message, true);
            }
        }
        
        // ===== EXPORT / IMPORT =====
        
        function exportConfiguration() {
            const configId = $("#savedConfigSelect").value;
            if (!configId) {
                alert("Please select a configuration to export.");
                return;
            }
            
            const savedConfigs = getSavedConfigurations();
            const config = savedConfigs[configId];
            
            if (!config) {
                alert("Configuration not found.");
                return;
            }
            
            downloadJSON(config, `map-config-${sanitizeFilename(config.name)}.json`);
            updateStatus(`Configuration "${config.name}" exported.`);
        }
        
        function exportAllConfigurations() {
            const savedConfigs = getSavedConfigurations();
            
            if (Object.keys(savedConfigs).length === 0) {
                alert("No configurations to export.");
                return;
            }
            
            const exportData = {
                exportedAt: new Date().toISOString(),
                configurations: savedConfigs
            };
            
            downloadJSON(exportData, `map-configs-all-${new Date().toISOString().split('T')[0]}.json`);
            updateStatus(`Exported ${Object.keys(savedConfigs).length} configuration(s).`);
        }
        
        function importConfiguration() {
            $("#importFileInput").click();
        }
        
        function handleImportFile(event) {
            const file = event.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            
            reader.onload = (e) => {
                try {
                    const imported = JSON.parse(e.target.result);
                    
                    const savedConfigs = getSavedConfigurations();
                    let importedCount = 0;
                    
                    // Check if it's a single config or multiple configs
                    if (imported.configurations) {
                        // Multiple configs export format
                        Object.values(imported.configurations).forEach(config => {
                            if (validateConfig(config)) {
                                const configId = 'config_' + Date.now() + '_' + importedCount;
                                savedConfigs[configId] = config;
                                importedCount++;
                            }
                        });
                    } else if (validateConfig(imported)) {
                        // Single config
                        const configId = 'config_' + Date.now();
                        savedConfigs[configId] = imported;
                        importedCount = 1;
                    } else {
                        throw new Error("Invalid configuration format");
                    }
                    
                    localStorage.setItem('mapConfigManager', JSON.stringify(savedConfigs));
                    loadSavedConfigurationsList();
                    
                    $("#importStatus").innerHTML = `<span style="color:#28a745;">✓ Imported ${importedCount} configuration(s)</span>`;
                    updateStatus(`Successfully imported ${importedCount} configuration(s).`);
                    
                } catch (error) {
                    $("#importStatus").innerHTML = `<span style="color:#dc3545;">✗ Error: ${error.message}</span>`;
                    updateStatus("Error importing: " + error.message, true);
                }
            };
            
            reader.readAsText(file);
            event.target.value = ''; // Reset file input
        }
        
        function validateConfig(config) {
            return config && 
                   config.name && 
                   config.layers && 
                   Array.isArray(config.layers) &&
                   config.layers.length > 0;
        }
        
        function downloadJSON(data, filename) {
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }
        
        function sanitizeFilename(name) {
            return name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
        }
        
        // ===== EVENT LISTENERS =====
        
        $("#captureStateBtn").onclick = captureCurrentState;
        $("#saveConfigBtn").onclick = saveConfiguration;
        $("#previewConfigBtn").onclick = previewConfiguration;
        $("#applyConfigBtn").onclick = applyConfiguration;
        $("#deleteConfigBtn").onclick = deleteConfiguration;
        $("#exportConfigBtn").onclick = exportConfiguration;
        $("#exportAllBtn").onclick = exportAllConfigurations;
        $("#importConfigBtn").onclick = importConfiguration;
        $("#importFileInput").onchange = handleImportFile;
        
        $("#closeTool").onclick = () => {
            window.gisToolHost.closeTool('map-config-manager');
        };
        
        // ===== INITIALIZATION =====
        
        loadSavedConfigurationsList();
        updateStatus("Ready. Capture current map state to begin.");
        
        // ===== CLEANUP =====
        
        function cleanup() {
            toolBox.remove();
        }
        
        // Register tool with host
        window.gisToolHost.activeTools.set('map-config-manager', {
            cleanup: cleanup,
            toolBox: toolBox
        });
        
    } catch (error) {
        alert("Error creating Map Configuration Manager: " + (error.message || error));
    }
})();
