javascript:(function(){
    async function createEnhancedPackageCreatorTool(){
        try{
            const mapView = Object.values(window).find(o => 
                o && o.constructor && o.constructor.name === "MapView"
            );
            if(!mapView){
                return alert("No MapView found");
            }

            const LAYER_CONFIG = {
                vault: { id: 42100, name: "Vault" },
                underground_span: { id: 42050, name: "Underground Span" },
                fiber_cable: { id: 41050, name: "Fiber Cable" }
            };

            // Field definitions based on your schema
            const FIELD_DEFINITIONS = {
                vault: {
                    required: [
                        { name: 'workflow_stage', type: 'TEXT', domain: 'WorkflowStage', alias: 'Workflow Stage' },
                        { name: 'workflow_status', type: 'TEXT', domain: 'WorkflowStatus', alias: 'Workflow Status' },
                        { name: 'work_type', type: 'TEXT', domain: 'WorkType', alias: 'Work Type' },
                        { name: 'client_code', type: 'TEXT', domain: 'ClientCode', alias: 'Client Code' },
                        { name: 'project_id', type: 'TEXT', domain: 'Projects', alias: 'Project ID' },
                        { name: 'job_number', type: 'TEXT', alias: 'Job Number' },
                        { name: 'purchase_order_id', type: 'TEXT', alias: 'Purchase Order ID' },
                        { name: 'workorder_id', type: 'TEXT', alias: 'Work Order ID' },
                        { name: 'delete_feature', type: 'TEXT', domain: 'YesNoText', alias: 'Delete Feature', default: 'No' }
                    ],
                    optional: [
                        { name: 'vault_name', type: 'TEXT', alias: 'Vault Name' },
                        { name: 'vault_type', type: 'TEXT', domain: 'VaultType', alias: 'Vault Type' },
                        { name: 'vault_size', type: 'TEXT', domain: 'VaultSize', alias: 'Vault Size' },
                        { name: 'vault_material', type: 'TEXT', domain: 'VaultMaterial', alias: 'Vault Material' },
                        { name: 'vault_tier_rating', type: 'TEXT', domain: 'NA', alias: 'Vault Tier Rating' },
                        { name: 'construction_status', type: 'TEXT', domain: 'ConstructionStatus', alias: 'Construction Status', default: 'NA' },
                        { name: 'photo', type: 'TEXT', domain: 'YesNoText', alias: 'Photo', default: 'No' },
                        { name: 'physical_status', type: 'TEXT', domain: 'PhysicalStatus', alias: 'Physical Status' }
                    ]
                },
                underground_span: {
                    required: [
                        { name: 'workflow_stage', type: 'TEXT', domain: 'WorkflowStage', alias: 'Workflow Stage' },
                        { name: 'workflow_status', type: 'TEXT', domain: 'WorkflowStatus', alias: 'Workflow Status' },
                        { name: 'work_type', type: 'TEXT', domain: 'WorkType', alias: 'Work Type' },
                        { name: 'client_code', type: 'TEXT', domain: 'ClientCode', alias: 'Client Code' },
                        { name: 'project_id', type: 'TEXT', domain: 'Projects', alias: 'Project ID' },
                        { name: 'job_number', type: 'TEXT', alias: 'Job Number' },
                        { name: 'purchase_order_id', type: 'TEXT', alias: 'Purchase Order ID' },
                        { name: 'workorder_id', type: 'TEXT', alias: 'Work Order ID' },
                        { name: 'delete_feature', type: 'TEXT', domain: 'YesNoText', alias: 'Delete Feature', default: 'No' }
                    ],
                    optional: [
                        { name: 'installation_method', type: 'TEXT', domain: 'UnderGroundInstallationMethod', alias: 'Installation Method' },
                        { name: 'placement_type', type: 'TEXT', domain: 'PlacementType', alias: 'Placement Type' },
                        { name: 'conduit_diameter', type: 'TEXT', domain: 'DuctDiameter', alias: 'Conduit Diameter' },
                        { name: 'conduit_material', type: 'TEXT', domain: 'DuctMaterial', alias: 'Conduit Material' },
                        { name: 'inner_duct', type: 'TEXT', domain: 'YesNoText', alias: 'Inner Duct' },
                        { name: 'construction_status', type: 'TEXT', domain: 'ConstructionStatus', alias: 'Construction Status', default: 'NA' },
                        { name: 'conduit_count', type: 'LONG', alias: 'Conduit Count' },
                        { name: 'minimum_depth', type: 'LONG', alias: 'Minimum Depth' }
                    ]
                },
                fiber_cable: {
                    required: [
                        { name: 'workflow_stage', type: 'TEXT', domain: 'WorkflowStage', alias: 'Workflow Stage' },
                        { name: 'workflow_status', type: 'TEXT', domain: 'WorkflowStatus', alias: 'Workflow Status' },
                        { name: 'work_type', type: 'TEXT', domain: 'WorkType', alias: 'Work Type' },
                        { name: 'client_code', type: 'TEXT', domain: 'ClientCode', alias: 'Client Code' },
                        { name: 'project_id', type: 'TEXT', domain: 'Projects', alias: 'Project ID' },
                        { name: 'job_number', type: 'TEXT', alias: 'Job Number' },
                        { name: 'purchase_order_id', type: 'TEXT', alias: 'Purchase Order ID' },
                        { name: 'workorder_id', type: 'TEXT', alias: 'Work Order ID' },
                        { name: 'delete_feature', type: 'TEXT', domain: 'YesNoText', alias: 'Delete Feature', default: 'No' },
                        { name: 'buffer_count', type: 'LONG', domain: 'BufferCount', alias: 'Buffer Count' },
                        { name: 'fiber_count', type: 'LONG', domain: 'FiberCount', alias: 'Fiber Count' }
                    ],
                    optional: [
                        { name: 'cable_name', type: 'TEXT', alias: 'Cable Name' },
                        { name: 'cable_category', type: 'TEXT', domain: 'FiberCategory', alias: 'Cable Category' },
                        { name: 'cable_type', type: 'TEXT', domain: 'FiberCableType', alias: 'Cable Type' },
                        { name: 'sheath_type', type: 'TEXT', domain: 'FiberSheathType', alias: 'Sheath Type' },
                        { name: 'core_type', type: 'TEXT', domain: 'FiberCableCoreType', alias: 'Core Type' },
                        { name: 'installation_method', type: 'TEXT', domain: 'FiberInstallationMethod', alias: 'Installation Method' },
                        { name: 'placement_type', type: 'TEXT', domain: 'PlacementType', alias: 'Placement Type' },
                        { name: 'construction_status', type: 'TEXT', domain: 'ConstructionStatus', alias: 'Construction Status', default: 'NA' }
                    ]
                }
            };

            const SNAP_TOLERANCE = 15;
            const z = 99999;

            // Create main container
            const toolBox = document.createElement("div");
            toolBox.style = `
                position: fixed; 
                top: 120px; 
                right: 40px; 
                z-index: ${z}; 
                background: #fff; 
                border: 1px solid #333; 
                padding: 12px; 
                max-width: 450px; 
                font: 12px/1.3 Arial, sans-serif; 
                box-shadow: 0 4px 16px rgba(0,0,0,.2); 
                border-radius: 4px;
                max-height: 80vh;
                overflow-y: auto;
            `;

            // State variables
            let currentStep = 'setup'; // 'setup' | 'placement'
            let packageConfig = null;
            let toolActive = false;
            let clickHandler = null;
            let packagePoints = [];
            let creatingPackage = false;
            let layerDomains = {}; // Store domain values from layers
            
            // Template management
            const TEMPLATE_STORAGE_KEY = 'packageCreatorTemplates';
            
            function saveTemplate() {
                const templateName = prompt('Enter a name for this template:');
                if (!templateName) return;
                
                // Collect current field values
                const fieldValues = {};
                const fieldIds = [
                    // Required common fields
                    'workflow_stage', 'workflow_status', 'work_type', 'client_code',
                    'project_id', 'job_number', 'purchase_order_id', 'workorder_id',
                    // Vault optional fields
                    'vault_type', 'vault_size', 'vault_material', 'vault_tier_rating', 'physical_status',
                    // Span optional fields
                    'installation_method', 'placement_type', 'conduit_diameter', 'conduit_material',
                    'inner_duct', 'conduit_count', 'minimum_depth',
                    // Fiber required fields
                    'buffer_count', 'fiber_count',
                    // Fiber optional fields
                    'cable_category', 'cable_type', 'sheath_type', 'core_type',
                    'fiber_installation_method', 'fiber_placement_type',
                    // Checkbox
                    'createFiber'
                ];
                
                fieldIds.forEach(id => {
                    const element = toolBox.querySelector(`#${id}`);
                    if (element) {
                        if (element.type === 'checkbox') {
                            fieldValues[id] = element.checked;
                        } else {
                            fieldValues[id] = element.value;
                        }
                    }
                });
                
                // Load existing templates
                const templates = JSON.parse(localStorage.getItem(TEMPLATE_STORAGE_KEY) || '{}');
                
                // Save new template
                templates[templateName] = {
                    name: templateName,
                    created: new Date().toISOString(),
                    values: fieldValues
                };
                
                localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
                
                alert(`Template "${templateName}" saved successfully!`);
                updateUI(); // Refresh to show new template
            }
            
            function loadTemplate(templateName) {
                const templates = JSON.parse(localStorage.getItem(TEMPLATE_STORAGE_KEY) || '{}');
                const template = templates[templateName];
                
                if (!template) {
                    alert('Template not found');
                    return;
                }
                
                // Apply template values to form fields
                Object.keys(template.values).forEach(fieldId => {
                    const element = toolBox.querySelector(`#${fieldId}`);
                    if (element) {
                        if (element.type === 'checkbox') {
                            element.checked = template.values[fieldId];
                        } else {
                            element.value = template.values[fieldId];
                        }
                    }
                });
                
                // Update fiber fields visibility if needed
                updateFiberFieldsVisibility();
                
                const statusDiv = toolBox.querySelector('#validationStatus');
                if (statusDiv) {
                    statusDiv.textContent = `Template "${templateName}" loaded successfully!`;
                    statusDiv.style.color = '#28a745';
                }
            }
            
            function deleteTemplate(templateName) {
                if (!confirm(`Delete template "${templateName}"?`)) return;
                
                const templates = JSON.parse(localStorage.getItem(TEMPLATE_STORAGE_KEY) || '{}');
                delete templates[templateName];
                localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
                
                updateUI(); // Refresh to remove deleted template
            }
            
            function getTemplatesList() {
                const templates = JSON.parse(localStorage.getItem(TEMPLATE_STORAGE_KEY) || '{}');
                return Object.values(templates);
            }

            // Function to load layer domains
            async function loadLayerDomains() {
                try {
                    updateStatus("Loading layer domains...");
                    
                    const vaultLayer = mapView.map.allLayers.find(l => l.layerId === LAYER_CONFIG.vault.id);
                    const spanLayer = mapView.map.allLayers.find(l => l.layerId === LAYER_CONFIG.underground_span.id);
                    const cableLayer = mapView.map.allLayers.find(l => l.layerId === LAYER_CONFIG.fiber_cable.id);
                    
                    if (!vaultLayer || !spanLayer || !cableLayer) {
                        throw new Error("Required layers not found");
                    }
                    
                    // Load all layers
                    await Promise.all([vaultLayer.load(), spanLayer.load(), cableLayer.load()]);
                    
                    // Extract domains from all layers
                    const allLayers = [vaultLayer, spanLayer, cableLayer];
                    
                    for (const layer of allLayers) {
                        if (layer.fields) {
                            layer.fields.forEach(field => {
                                if (field.domain && field.domain.codedValues) {
                                    layerDomains[field.name] = field.domain.codedValues.map(cv => ({
                                        code: cv.code,
                                        name: cv.name
                                    }));
                                    console.log(`Found domain for ${field.name}:`, layerDomains[field.name]);
                                }
                            });
                        }
                    }
                    
                    console.log("All loaded domains:", layerDomains);
                    return true;
                    
                } catch (error) {
                    console.error("Error loading layer domains:", error);
                    // Continue without domains - will show text inputs instead
                    return false;
                }
            }

            function createFieldInput(fieldName, alias, domainName, isRequired = false) {
                const fieldId = fieldName;
                const labelStyle = isRequired ? 'font-weight:bold;color:#d63031;' : 'font-weight:bold;';
                const requiredMark = isRequired ? ' *' : '';
                
                // Check if we have domain values for this field
                if (layerDomains[fieldName] && layerDomains[fieldName].length > 0) {
                    // Create dropdown with actual domain values
                    const options = layerDomains[fieldName].map(domain => 
                        `<option value="${domain.code}">${domain.name} (${domain.code})</option>`
                    ).join('');
                    
                    return `
                        <div style="margin-bottom:8px;">
                            <label style="display:block;${labelStyle}margin-bottom:2px;">${alias}${requiredMark}:</label>
                            <select id="${fieldId}" style="width:100%;padding:4px;" ${isRequired ? 'required' : ''}>
                                <option value="">Select...</option>
                                ${options}
                            </select>
                            <div style="font-size:10px;color:#666;margin-top:1px;">Domain: ${domainName || 'Unknown'}</div>
                        </div>
                    `;
                } else {
                    // Create text input if no domain found
                    return `
                        <div style="margin-bottom:8px;">
                            <label style="display:block;${labelStyle}margin-bottom:2px;">${alias}${requiredMark}:</label>
                            <input type="text" id="${fieldId}" placeholder="Enter ${alias.toLowerCase()}" style="width:100%;padding:4px;" ${isRequired ? 'required' : ''}>
                            <div style="font-size:10px;color:#666;margin-top:1px;">Domain: ${domainName || 'Text input'} ${!layerDomains[fieldName] ? '(domain not found)' : ''}</div>
                        </div>
                    `;
                }
            }

            function createSetupUI() {
                return `
                    <div style="font-weight:bold;margin-bottom:8px;color:#2c5aa0;">📦 Package Creator - Field Setup</div>
                    
                    <div style="margin-bottom:12px;color:#666;font-size:11px;padding:8px;background:#f5f5f5;border-radius:3px;">
                        Configure required fields for all features. Domains loaded from actual layer schemas.
                    </div>

                    <div style="margin-bottom:12px;">
                        <label style="display:block;margin-bottom:4px;font-weight:bold;">Package Options:</label>
                        <div style="margin-bottom:4px;">
                            <label>
                                <input type="checkbox" id="createFiber" checked> Create Fiber Cable
                            </label>
                        </div>
                    </div>

                    <div id="fieldConfiguration">
                        <div style="font-weight:bold;margin-bottom:8px;color:#d63031;">Required Fields (All Features)</div>
                        
                        ${createFieldInput('workflow_stage', 'Workflow Stage', 'WorkflowStage', true)}
                        ${createFieldInput('workflow_status', 'Workflow Status', 'WorkflowStatus', true)}
                        ${createFieldInput('work_type', 'Work Type', 'WorkType', true)}
                        ${createFieldInput('client_code', 'Client Code', 'ClientCode', true)}
                        ${createFieldInput('project_id', 'Project ID', 'Projects', true)}
                        ${createFieldInput('job_number', 'Job Number', null, true)}
                        ${createFieldInput('purchase_order_id', 'Purchase Order ID', null, true)}
                        ${createFieldInput('workorder_id', 'Work Order ID', null, true)}

                        <div id="fiberSpecificFields" style="margin-bottom:12px;">
                            <div style="font-weight:bold;margin-bottom:8px;color:#d63031;">Fiber Cable Required Fields</div>
                            
                            ${createFieldInput('buffer_count', 'Buffer Count', 'BufferCount', true)}
                            ${createFieldInput('fiber_count', 'Fiber Count', 'FiberCount', true)}
                        </div>
                    </div>

                    <div style="display:flex;gap:8px;margin-bottom:8px;">
                        <button id="validateAndProceed" style="flex:1;padding:8px;background:#28a745;color:white;border:none;border-radius:3px;font-weight:bold;">
                            Validate & Start Placement
                        </button>
                    </div>
                    
                    <div style="display:flex;gap:8px;">
                        <button id="reloadDomains" style="flex:1;padding:6px 8px;background:#007bff;color:white;border:none;border-radius:2px;">
                            Reload Domains
                        </button>
                        <button id="closeTool" style="flex:1;padding:6px 8px;background:#d32f2f;color:white;border:radius:2px;">
                            Close Tool
                        </button>
                    </div>
                    
                    <div id="validationStatus" style="margin-top:8px;color:#d63031;font-size:11px;"></div>
                `;
            }

            function createPlacementUI() {
                return `
                    <div style="font-weight:bold;margin-bottom:8px;color:#2c5aa0;">📦 Package Creator - Placement Mode</div>
                    
                    <div style="margin-bottom:8px;color:#666;font-size:11px;background:#e8f5e8;padding:6px;border-radius:3px;">
                        ✅ Fields configured! Click map to place vaults, then press ENTER to create package.
                    </div>

                    <div style="margin-bottom:8px;">
                        <div style="font-size:11px;color:#666;">
                            Creating: ${packageConfig.createFiber ? 'Vaults + Spans + Fiber Cable' : 'Vaults + Spans'}
                        </div>
                    </div>

                    <div style="display:flex;gap:8px;margin-bottom:8px;">
                        <button id="enableTool" style="flex:1;padding:6px 8px;background:#28a745;color:white;border:none;border-radius:2px;">
                            Start Placement
                        </button>
                        <button id="disableTool" style="flex:1;padding:6px 8px;background:#666;color:white;border:none;border-radius:2px;" disabled>
                            Stop Placement
                        </button>
                    </div>
                    
                    <div style="display:flex;gap:8px;margin-bottom:8px;">
                        <button id="cancelPackage" style="flex:1;padding:4px 8px;background:#ff9800;color:white;border:none;border-radius:2px;" disabled>
                            Cancel Current
                        </button>
                        <button id="backToSetup" style="flex:1;padding:4px 8px;background:#6c757d;color:white;border:none;border-radius:2px;">
                            Back to Setup
                        </button>
                    </div>
                    
                    <div style="display:flex;gap:8px;">
                        <button id="closeTool" style="flex:1;padding:4px 8px;background:#d32f2f;color:white;border:none;border-radius:2px;">
                            Close Tool
                        </button>
                    </div>
                    
                    <div id="toolStatus" style="margin-top:8px;color:#3367d6;font-size:11px;"></div>
                `;
            }

            async function updateUI() {
                if (currentStep === 'setup') {
                    // Load domains first, then update UI
                    if (Object.keys(layerDomains).length === 0) {
                        toolBox.innerHTML = `
                            <div style="font-weight:bold;margin-bottom:8px;color:#2c5aa0;">📦 Package Creator - Loading...</div>
                            <div style="color:#666;font-size:11px;">Loading layer domains...</div>
                        `;
                        await loadLayerDomains();
                    }
                    
                    toolBox.innerHTML = createSetupUI();
                    setupEventListeners();
                    updateFiberFieldsVisibility();
                } else {
                    toolBox.innerHTML = createPlacementUI();
                    setupEventListeners();
                }
            }

            function updateFiberFieldsVisibility() {
                const createFiberCheckbox = toolBox.querySelector('#createFiber');
                const fiberFields = toolBox.querySelector('#fiberSpecificFields');
                
                if (createFiberCheckbox && fiberFields) {
                    fiberFields.style.display = createFiberCheckbox.checked ? 'block' : 'none';
                }
            }

            function validateRequiredFields() {
                const requiredFields = [
                    'workflow_stage', 'workflow_status', 'work_type', 'client_code', 
                    'project_id', 'job_number', 'purchase_order_id', 'workorder_id'
                ];

                const createFiber = toolBox.querySelector('#createFiber').checked;
                if (createFiber) {
                    requiredFields.push('buffer_count', 'fiber_count');
                }

                const missing = [];
                const values = {};

                requiredFields.forEach(fieldName => {
                    const element = toolBox.querySelector(`#${fieldName}`);
                    if (element) {
                        const value = element.value.trim();
                        if (!value) {
                            missing.push(element.previousElementSibling?.textContent || fieldName);
                        } else {
                            values[fieldName] = value;
                        }
                    }
                });

                return { valid: missing.length === 0, missing, values };
            }

            function generateBaseAttributes(customValues = {}) {
                const baseAttribs = {
                    workflow_stage: packageConfig.workflow_stage,
                    workflow_status: packageConfig.workflow_status,
                    work_type: packageConfig.work_type,
                    client_code: packageConfig.client_code,
                    project_id: packageConfig.project_id,
                    job_number: packageConfig.job_number,
                    purchase_order_id: packageConfig.purchase_order_id,
                    workorder_id: packageConfig.workorder_id,
                    delete_feature: 'No',
                    construction_status: 'NA'
                };

                // Add optional fields if they have values
                const optionalFields = [
                    'vault_type', 'vault_size', 'vault_material', 'vault_tier_rating', 'physical_status',
                    'installation_method', 'placement_type', 'conduit_diameter', 'conduit_material',
                    'inner_duct', 'conduit_count', 'minimum_depth',
                    'cable_category', 'cable_type', 'sheath_type', 'core_type',
                    'fiber_installation_method', 'fiber_placement_type'
                ];

                optionalFields.forEach(field => {
                    if (packageConfig[field] && packageConfig[field] !== '') {
                        baseAttribs[field] = packageConfig[field];
                    }
                });

                return { ...baseAttribs, ...customValues };
            }

            function setupEventListeners() {
                const $ = (id) => toolBox.querySelector(id);

                // Setup phase listeners
                if (currentStep === 'setup') {
                    const createFiberCheckbox = $('#createFiber');
                    const validateBtn = $('#validateAndProceed');
                    const saveTemplateBtn = $('#saveTemplate');
                    const reloadBtn = $('#reloadDomains');
                    const closeBtn = $('#closeTool');

                    createFiberCheckbox?.addEventListener('change', updateFiberFieldsVisibility);
                    
                    validateBtn?.addEventListener('click', () => {
                        const validation = validateRequiredFields();
                        const statusDiv = $('#validationStatus');
                        
                        if (validation.valid) {
                            packageConfig = {
                                createFiber: createFiberCheckbox.checked,
                                ...validation.values
                            };
                            
                            currentStep = 'placement';
                            updateUI();
                        } else {
                            statusDiv.textContent = `Missing required fields: ${validation.missing.join(', ')}`;
                            statusDiv.style.color = '#d63031';
                        }
                    });

                    saveTemplateBtn?.addEventListener('click', saveTemplate);

                    reloadBtn?.addEventListener('click', async () => {
                        layerDomains = {}; // Clear existing domains
                        await updateUI(); // This will reload domains
                    });

                    closeBtn?.addEventListener('click', () => {
                        toolBox.remove();
                    });
                }

                // Placement phase listeners  
                if (currentStep === 'placement') {
                    const enableBtn = $('#enableTool');
                    const disableBtn = $('#disableTool');
                    const cancelBtn = $('#cancelPackage');
                    const backBtn = $('#backToSetup');
                    const closeBtn = $('#closeTool');

                    enableBtn?.addEventListener('click', enableTool);
                    disableBtn?.addEventListener('click', disableTool);
                    cancelBtn?.addEventListener('click', cancelPackage);
                    backBtn?.addEventListener('click', () => {
                        disableTool();
                        currentStep = 'setup';
                        updateUI();
                    });
                    closeBtn?.addEventListener('click', () => {
                        disableTool();
                        toolBox.remove();
                    });
                }
            }

            // Placement functionality (similar to original, but with proper attributes)
            function updateStatus(message) {
                const status = toolBox.querySelector('#toolStatus');
                if (status) status.textContent = message;
            }

            function calculateGeodeticLength(geometry) {
                try {
                    if (!geometry || !geometry.paths || geometry.paths.length === 0) {
                        return 0;
                    }
                    
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
                                x: path[i+1][0],
                                y: path[i+1][1],
                                spatialReference: geometry.spatialReference
                            };
                            const geodeticDistance = calculateGeodeticDistanceBetweenPoints(point1, point2);
                            totalLength += geodeticDistance;
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

                    const a = Math.sin(deltaLatRad/2) * Math.sin(deltaLatRad/2) + 
                             Math.cos(lat1Rad) * Math.cos(lat2Rad) * 
                             Math.sin(deltaLngRad/2) * Math.sin(deltaLngRad/2);
                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                    const distance = earthRadiusFeet * c;
                    return distance;
                } catch (error) {
                    console.error("Error calculating geodetic distance:", error);
                    return 0;
                }
            }

            function convertMapPointToLatLng(mapPoint) {
                try {
                    const sr = mapPoint.spatialReference;
                    if (!sr) {
                        return convertWebMercatorToLatLng(mapPoint.x, mapPoint.y);
                    }
                    
                    if (sr.wkid === 3857 || sr.wkid === 102100) {
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
                lat = 180/Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI/180)) - Math.PI/2);
                return { lat: lat, lng: lng };
            }

            async function createFeatureWithAttributes(layer, geometry, attributes) {
                try {
                    await layer.load();
                    
                    const newFeature = {
                        geometry: geometry,
                        attributes: attributes
                    };
                    
                    console.log(`Creating feature with attributes:`, attributes);
                    
                    const result = await layer.applyEdits({
                        addFeatures: [newFeature]
                    });
                    
                    console.log(`Feature creation result:`, result);
                    
                    if (result && result.addFeatureResults && result.addFeatureResults.length > 0) {
                        const addResult = result.addFeatureResults[0];
                        
                        if (addResult.success !== false && addResult.objectId) {
                            console.log(`✅ Feature created successfully with ObjectID:`, addResult.objectId);
                            await layer.refresh();
                            return addResult.objectId;
                        } else {
                            console.error(`❌ Feature creation failed:`, addResult);
                            throw new Error(`Feature creation failed: ${addResult.error?.description || JSON.stringify(addResult)}`);
                        }
                    } else {
                        throw new Error(`No valid result returned for feature creation`);
                    }
                } catch (error) {
                    console.error(`Error creating feature:`, error);
                    throw error;
                }
            }

            async function createPackage() {
                try {
                    if (packagePoints.length < 2) {
                        throw new Error("Need at least 2 points to create a package");
                    }

                    updateStatus("Creating package features...");
                    
                    const vaultPoints = [...packagePoints];
                    const createdFeatures = [];

                    // Get layers
                    const vaultLayer = mapView.map.allLayers.find(l => l.layerId === LAYER_CONFIG.vault.id);
                    const spanLayer = mapView.map.allLayers.find(l => l.layerId === LAYER_CONFIG.underground_span.id);
                    const cableLayer = mapView.map.allLayers.find(l => l.layerId === LAYER_CONFIG.fiber_cable.id);

                    if (!vaultLayer || !spanLayer || (!cableLayer && packageConfig.createFiber)) {
                        throw new Error("Required layers not found");
                    }

                    // Create vaults
                    for (let i = 0; i < vaultPoints.length; i++) {
                        const vaultName = `Vault_${Date.now()}_${i + 1}`;
                        const vaultAttribs = generateBaseAttributes({
                            vault_name: vaultName
                        });
                        
                        const vaultId = await createFeatureWithAttributes(vaultLayer, vaultPoints[i], vaultAttribs);
                        if (vaultId) {
                            createdFeatures.push({ type: 'vault', id: vaultId, name: vaultName });
                        }
                        updateStatus(`Creating vaults... ${i + 1}/${vaultPoints.length}`);
                    }

                    // Create spans
                    for (let i = 0; i < vaultPoints.length - 1; i++) {
                        const spanName = `UG_Span_${Date.now()}_${i + 1}_${i + 2}`;
                        const spanGeometry = {
                            type: "polyline",
                            paths: [[[vaultPoints[i].x, vaultPoints[i].y], [vaultPoints[i + 1].x, vaultPoints[i + 1].y]]],
                            spatialReference: vaultPoints[i].spatialReference
                        };
                        const length = calculateGeodeticLength(spanGeometry);
                        
                        const spanAttribs = generateBaseAttributes({
                            calculated_length: length
                        });
                        
                        const spanId = await createFeatureWithAttributes(spanLayer, spanGeometry, spanAttribs);
                        if (spanId) {
                            createdFeatures.push({ type: 'span', id: spanId, name: spanName });
                        }
                        updateStatus(`Creating spans... ${i + 1}/${vaultPoints.length - 1}`);
                    }

                    // Create fiber cable if requested
                    if (packageConfig.createFiber) {
                        const cableName = `Fiber_Cable_${Date.now()}`;
                        const pathCoordinates = vaultPoints.map(point => [point.x, point.y]);
                        const cableGeometry = {
                            type: "polyline",
                            paths: [pathCoordinates],
                            spatialReference: vaultPoints[0].spatialReference
                        };
                        const length = calculateGeodeticLength(cableGeometry);
                        
                        const cableAttribs = generateBaseAttributes({
                            cable_name: cableName,
                            calculated_length: length,
                            buffer_count: parseInt(packageConfig.buffer_count),
                            fiber_count: parseInt(packageConfig.fiber_count)
                        });
                        
                        const cableId = await createFeatureWithAttributes(cableLayer, cableGeometry, cableAttribs);
                        if (cableId) {
                            createdFeatures.push({ type: 'cable', id: cableId, name: cableName });
                        }
                        updateStatus("Creating fiber cable...");
                    }

                    // Success summary
                    const vaultCount = createdFeatures.filter(f => f.type === 'vault').length;
                    const spanCount = createdFeatures.filter(f => f.type === 'span').length;
                    const cableCount = createdFeatures.filter(f => f.type === 'cable').length;
                    
                    let summary = `✅ Package created successfully!\n`;
                    summary += `• ${vaultCount} vaults\n`;
                    summary += `• ${spanCount} underground spans`;
                    if (cableCount > 0) {
                        summary += `\n• ${cableCount} fiber cable`;
                    }
                    
                    updateStatus(summary.replace(/\n/g, ' '));
                    
                    // Force map refresh to show new features
                    console.log("Refreshing map view...");
                    await mapView.goTo(vaultPoints, { duration: 1000 });
                    
                    // Reset for next package
                    packagePoints = [];
                    creatingPackage = false;
                    const cancelBtn = toolBox.querySelector('#cancelPackage');
                    if (cancelBtn) cancelBtn.disabled = true;
                    
                } catch (error) {
                    console.error("Error creating package:", error);
                    updateStatus(`❌ Error creating package: ${error.message}`);
                    packagePoints = [];
                    creatingPackage = false;
                    const cancelBtn = toolBox.querySelector('#cancelPackage');
                    if (cancelBtn) cancelBtn.disabled = true;
                }
            }

            async function handleClick(event) {
                if (!toolActive) return;
                
                event.stopPropagation();
                
                const mapPoint = mapView.toMap({ x: event.x, y: event.y });
                packagePoints.push(mapPoint);
                
                updateStatus(`Vault ${packagePoints.length} placed. ${packagePoints.length >= 2 ? 'Click to add more vaults or press ENTER to create package.' : 'Click to place next vault.'}`);
                
                const cancelBtn = toolBox.querySelector('#cancelPackage');
                if (cancelBtn) {
                    cancelBtn.disabled = false;
                    creatingPackage = true;
                }
            }

            function handleKeyPress(event) {
                if (!toolActive || !creatingPackage) return;
                
                if (event.key === 'Enter' && packagePoints.length >= 2) {
                    createPackage();
                } else if (event.key === 'Escape') {
                    cancelPackage();
                }
            }

            function cancelPackage() {
                packagePoints = [];
                creatingPackage = false;
                const cancelBtn = toolBox.querySelector('#cancelPackage');
                if (cancelBtn) cancelBtn.disabled = true;
                updateStatus("Package cancelled. Click on map to place vaults for new package.");
            }

            function enableTool() {
                toolActive = true;
                clickHandler = mapView.on("click", handleClick);
                document.addEventListener('keydown', handleKeyPress);
                
                const enableBtn = toolBox.querySelector('#enableTool');
                const disableBtn = toolBox.querySelector('#disableTool');
                if (enableBtn) enableBtn.disabled = true;
                if (disableBtn) disableBtn.disabled = false;
                
                mapView.container.style.cursor = "crosshair";
                updateStatus("Tool enabled. Click on map to place vaults. Press ENTER when ready to create package.");
            }

            function disableTool() {
                toolActive = false;
                packagePoints = [];
                creatingPackage = false;
                
                if (clickHandler) clickHandler.remove();
                document.removeEventListener('keydown', handleKeyPress);
                
                const enableBtn = toolBox.querySelector('#enableTool');
                const disableBtn = toolBox.querySelector('#disableTool');
                const cancelBtn = toolBox.querySelector('#cancelPackage');
                
                if (enableBtn) enableBtn.disabled = false;
                if (disableBtn) disableBtn.disabled = true;
                if (cancelBtn) cancelBtn.disabled = true;
                
                mapView.container.style.cursor = "default";
                updateStatus("Tool disabled.");
            }

            // Initialize the tool
            document.body.appendChild(toolBox);
            
            // Expose template functions to global scope for onclick handlers
            window.packageCreatorLoadTemplate = loadTemplate;
            window.packageCreatorDeleteTemplate = deleteTemplate;
            
            updateUI();

            console.log("Enhanced Package Creator Tool loaded!");
            console.log("Layer configuration check:");
            console.log("Looking for vault layer with ID:", LAYER_CONFIG.vault.id);
            console.log("Looking for underground span layer with ID:", LAYER_CONFIG.underground_span.id);
            console.log("Looking for fiber cable layer with ID:", LAYER_CONFIG.fiber_cable.id);
            
            console.log("Available layers in map:");
            mapView.map.allLayers.forEach(layer => {
                console.log(`- Layer: "${layer.title}" (ID: ${layer.layerId}, Type: ${layer.type})`);
            });
            
        } catch (error) {
            console.error("Error creating enhanced package creator tool:", error);
            alert("Error creating tool: " + (error.message || error));
        }
    }

    createEnhancedPackageCreatorTool();
})();
