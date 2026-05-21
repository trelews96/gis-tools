// tools/splice-pdf-generator.js
// Splice Closure PDF Report Generator

(function() {
    try {
        // Check if tool is already active
        if (window.gisToolHost && window.gisToolHost.activeTools.has('splice-pdf-generator')) {
            console.log('Splice PDF Generator already active');
            return;
        }
        
        // Use shared utilities
        const utils = window.gisSharedUtils;
        if (!utils) {
            throw new Error('Shared utilities not loaded');
        }
        
        const mapView = utils.getMapView();
        
        // ==================== CONFIGURATION ====================
        
        const CONFIG = {
            FIBER_SEARCH_DISTANCE: 10, // meters
            ENABLE_REVERSE_GEOCODING: true,
            ENABLE_FIBER_COUNT_CALC: true,
            ENABLE_RELATED_TABLES: true,
            COMPANY_NAME: 'Charter Spectrum RDOF',
            REPORT_TITLE: 'Splice Closure Production Report'
        };
        
        // Field mapping
        const FIELD_MAP = {
            job_number: 'job_number',
            workorder_id: 'workorder_id',
            workflow_status: 'workflow_status',
            installation_date: 'installation_date',
            physical_status: 'physical_status',
            placement_type: 'placement_type',
            splice_enclosure_type: 'splice_enclosure_type',
            splice_closure_material: 'splice_closure_material',
            port_count: 'port_count',
            drop_count: 'drop_count',
            measured_light_Level: 'measured_light_Level',
            construction_subcontractor: 'construction_subcontractor',
            creator: 'creator',
            last_editior: 'last_editior',
            labor_code: 'labor_code'
        };
        
        // Auto-detect layers from map
        let SPLICE_CLOSURE_LAYER = null;
        let FIBER_CABLE_LAYER = null;
        
        mapView.map.allLayers.forEach(layer => {
            if (layer.type === "feature" && layer.title) {
                const title = layer.title.toLowerCase();
                
                // Look for splice closure layer
                if (title.includes('splice') && title.includes('closure')) {
                    SPLICE_CLOSURE_LAYER = layer;
                    console.log('Found Splice Closure Layer:', layer.title, layer.url);
                }
                
                // Look for fiber cable layer
                if (title.includes('fiber') && title.includes('cable')) {
                    FIBER_CABLE_LAYER = layer;
                    console.log('Found Fiber Cable Layer:', layer.title, layer.url);
                }
            }
        });
        
        if (!SPLICE_CLOSURE_LAYER) {
            throw new Error('Could not find Splice Closure layer in map. Please ensure it is loaded.');
        }
        
        // ==================== UTILITY FUNCTIONS ====================
        
        const pdfUtils = {
            formatDate(dateValue) {
                if (!dateValue) return 'N/A';
                const date = new Date(dateValue);
                if (isNaN(date.getTime())) return 'N/A';
                return date.toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                });
            },
            
            formatDateTime(dateValue) {
                if (!dateValue) return 'N/A';
                const date = new Date(dateValue);
                if (isNaN(date.getTime())) return 'N/A';
                return date.toLocaleString('en-US', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            },
            
            showLoading(message = 'Generating PDF Report...') {
                const overlay = document.createElement('div');
                overlay.id = 'pdf-loading-overlay';
                overlay.style.cssText = `
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0,0,0,0.7);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 999999;
                `;
                
                overlay.innerHTML = `
                    <div style="background: white; padding: 30px 40px; border-radius: 8px; text-align: center; max-width: 400px;">
                        <div style="font-size: 48px; margin-bottom: 15px;">📄</div>
                        <div style="font-size: 18px; font-weight: 600; color: #1f2937; margin-bottom: 10px;">${message}</div>
                        <div style="font-size: 14px; color: #6b7280;">Please wait...</div>
                        <div id="pdf-progress" style="margin-top: 15px; font-size: 13px; color: #3b82f6;"></div>
                    </div>
                `;
                
                document.body.appendChild(overlay);
                return overlay;
            },
            
            updateProgress(message) {
                const progressDiv = document.getElementById('pdf-progress');
                if (progressDiv) {
                    progressDiv.textContent = message;
                }
            },
            
            hideLoading() {
                const overlay = document.getElementById('pdf-loading-overlay');
                if (overlay) {
                    overlay.remove();
                }
            },
            
            showError(message) {
                alert('PDF Generation Error: ' + message);
                console.error('PDF Error:', message);
            }
        };
        
        // ==================== DATA FETCHING ====================
        
        const dataFetcher = {
            async fetchFeatureData(objectId) {
                const layer = SPLICE_CLOSURE_LAYER;
                
                const queryResult = await layer.queryFeatures({
                    where: `OBJECTID = ${objectId}`,
                    outFields: '*',
                    returnGeometry: true
                });
                
                if (queryResult.features && queryResult.features.length > 0) {
                    return queryResult.features[0];
                }
                throw new Error('Feature not found');
            },
            
            async fetchAttachments(objectId) {
                const layer = SPLICE_CLOSURE_LAYER;
                
                try {
                    const attachmentQuery = await layer.queryAttachments({
                        objectIds: [objectId],
                        returnMetadata: true
                    });
                    
                    return attachmentQuery[objectId] || [];
                } catch (error) {
                    console.warn('Could not fetch attachments:', error);
                    return [];
                }
            },
            
            async getAttachmentAsBase64(objectId, attachmentId) {
                const layer = SPLICE_CLOSURE_LAYER;
                const attachmentUrl = `${layer.url}/${objectId}/attachments/${attachmentId}`;
                
                try {
                    const response = await fetch(attachmentUrl);
                    const blob = await response.blob();
                    
                    return new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                } catch (error) {
                    console.warn(`Could not load attachment ${attachmentId}:`, error);
                    return null;
                }
            },
            
            async reverseGeocode(latitude, longitude) {
                if (!CONFIG.ENABLE_REVERSE_GEOCODING) {
                    return null;
                }
                
                try {
                    pdfUtils.updateProgress('Looking up address...');
                    
                    const url = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode';
                    const params = new URLSearchParams({
                        location: `${longitude},${latitude}`,
                        f: 'json'
                    });
                    
                    const response = await fetch(`${url}?${params}`);
                    const data = await response.json();
                    
                    if (data.address) {
                        return {
                            address: data.address.Address || '',
                            city: data.address.City || '',
                            state: data.address.Region || '',
                            zip: data.address.Postal || ''
                        };
                    }
                } catch (error) {
                    console.warn('Reverse geocoding failed:', error);
                }
                
                return null;
            },
            
            async getNearbyFiberCables(geometry) {
                if (!CONFIG.ENABLE_FIBER_COUNT_CALC || !FIBER_CABLE_LAYER) {
                    return null;
                }
                
                try {
                    pdfUtils.updateProgress('Calculating fiber counts...');
                    
                    // Create buffer around point
                    const queryGeometry = {
                        type: 'point',
                        x: geometry.x,
                        y: geometry.y,
                        spatialReference: geometry.spatialReference
                    };
                    
                    const queryResult = await FIBER_CABLE_LAYER.queryFeatures({
                        geometry: queryGeometry,
                        distance: CONFIG.FIBER_SEARCH_DISTANCE,
                        units: 'meters',
                        spatialRelationship: 'intersects',
                        outFields: ['fiber_count'],
                        returnGeometry: false
                    });
                    
                    if (queryResult.features && queryResult.features.length > 0) {
                        // Group by fiber count
                        const fiberCountMap = {};
                        queryResult.features.forEach(feature => {
                            const count = feature.attributes.fiber_count;
                            if (count) {
                                fiberCountMap[count] = (fiberCountMap[count] || 0) + 1;
                            }
                        });
                        
                        // Divide each count by 2 to get individual fibers
                        const individualFibers = {};
                        for (const [count, total] of Object.entries(fiberCountMap)) {
                            individualFibers[count] = Math.floor(total / 2);
                        }
                        
                        return individualFibers;
                    }
                } catch (error) {
                    console.warn('Fiber cable query failed:', error);
                }
                
                return null;
            },
            
            async getRelatedBillingCodes(objectId) {
                if (!CONFIG.ENABLE_RELATED_TABLES) {
                    return [];
                }
                
                try {
                    const layer = SPLICE_CLOSURE_LAYER;
                    
                    // Try to find billing code relationship
                    // You may need to update relationshipId based on your schema
                    const relationshipId = 0;
                    
                    const queryUrl = `${layer.url}/${objectId}/queryRelatedRecords`;
                    const params = new URLSearchParams({
                        relationshipId: relationshipId,
                        outFields: '*',
                        f: 'json'
                    });
                    
                    const response = await fetch(`${queryUrl}?${params}`);
                    const data = await response.json();
                    
                    if (data.relatedRecordGroups && data.relatedRecordGroups.length > 0) {
                        const records = data.relatedRecordGroups[0].relatedRecords || [];
                        return records.map(r => r.attributes[FIELD_MAP.labor_code] || 'Unknown');
                    }
                } catch (error) {
                    console.warn('Related records query failed:', error);
                }
                
                return [];
            }
        };
        
        // ==================== PDF GENERATION ====================
        
        const pdfGenerator = {
            async loadJsPDF() {
                if (window.jspdf && window.jspdf.jsPDF) {
                    return window.jspdf.jsPDF;
                }
                
                return new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
                    script.onload = () => {
                        console.log('✅ jsPDF library loaded');
                        resolve(window.jspdf.jsPDF);
                    };
                    script.onerror = () => reject(new Error('Failed to load jsPDF library'));
                    document.head.appendChild(script);
                });
            },
            
            async generatePDF(feature, attachments, enrichedData) {
                const jsPDF = await this.loadJsPDF();
                const doc = new jsPDF({
                    orientation: 'portrait',
                    unit: 'mm',
                    format: 'a4'
                });
                
                const attrs = feature.attributes;
                const geom = feature.geometry;
                
                let yPosition = 20;
                const pageWidth = doc.internal.pageSize.getWidth();
                const pageHeight = doc.internal.pageSize.getHeight();
                const margin = 20;
                
                // Helper functions
                const addSection = (title, startY) => {
                    doc.setFontSize(14);
                    doc.setFont(undefined, 'bold');
                    doc.setTextColor(30, 58, 138);
                    doc.text(title, margin, startY);
                    
                    doc.setDrawColor(59, 130, 246);
                    doc.setLineWidth(0.5);
                    doc.line(margin, startY + 2, pageWidth - margin, startY + 2);
                    
                    return startY + 8;
                };
                
                const addInfoGrid = (items, startY) => {
                    const colWidth = (pageWidth - 2 * margin) / 2;
                    let y = startY;
                    let col = 0;
                    
                    doc.setFont(undefined, 'normal');
                    
                    items.forEach((item) => {
                        const xPos = margin + (col * colWidth);
                        
                        // Label
                        doc.setFontSize(8);
                        doc.setTextColor(100, 100, 100);
                        doc.text(item.label.toUpperCase(), xPos, y);
                        
                        // Value
                        doc.setFontSize(9);
                        doc.setTextColor(0, 0, 0);
                        doc.setFont(undefined, 'bold');
                        const valueLines = doc.splitTextToSize(String(item.value || 'N/A'), colWidth - 5);
                        doc.text(valueLines, xPos, y + 4);
                        doc.setFont(undefined, 'normal');
                        
                        col++;
                        if (col >= 2) {
                            col = 0;
                            y += 12;
                        }
                    });
                    
                    if (items.length % 2 !== 0) {
                        y += 12;
                    }
                    
                    return y;
                };
                
                const checkPageBreak = (requiredSpace) => {
                    if (yPosition + requiredSpace > pageHeight - 20) {
                        doc.addPage();
                        return 20;
                    }
                    return yPosition;
                };
                
                // ==================== HEADER ====================
                doc.setFillColor(30, 58, 138);
                doc.rect(0, 0, pageWidth, 50, 'F');
                
                doc.setTextColor(255, 255, 255);
                doc.setFontSize(22);
                doc.setFont(undefined, 'bold');
                doc.text(CONFIG.REPORT_TITLE, margin, 20);
                
                doc.setFontSize(12);
                doc.setFont(undefined, 'normal');
                doc.text(CONFIG.COMPANY_NAME, margin, 28);
                
                // Header metadata
                doc.setFontSize(9);
                const metaY = 38;
                doc.text(`Job: ${attrs[FIELD_MAP.job_number] || 'N/A'}`, margin, metaY);
                doc.text(`Status: ${attrs[FIELD_MAP.workflow_status] || 'N/A'}`, margin + 70, metaY);
                doc.text(`Date: ${pdfUtils.formatDate(attrs[FIELD_MAP.installation_date])}`, margin + 140, metaY);
                
                doc.setTextColor(0, 0, 0);
                yPosition = 60;
                
                // ==================== LOCATION INFORMATION ====================
                yPosition = addSection('📍 Location Information', yPosition);
                
                const locationData = [];
                
                if (enrichedData.address) {
                    locationData.push(
                        { label: 'Address', value: enrichedData.address.address },
                        { label: 'City, State, ZIP', value: `${enrichedData.address.city}, ${enrichedData.address.state} ${enrichedData.address.zip}` }
                    );
                } else {
                    locationData.push(
                        { label: 'Address', value: 'Generated from coordinates' },
                        { label: 'City, State, ZIP', value: 'See coordinates below' }
                    );
                }
                
                locationData.push(
                    { label: 'Coordinates', value: geom ? `${geom.y?.toFixed(6)}, ${geom.x?.toFixed(6)}` : 'N/A' },
                    { label: 'Installation Type', value: attrs[FIELD_MAP.placement_type] || 'N/A' }
                );
                
                yPosition = addInfoGrid(locationData, yPosition);
                yPosition += 10;
                
                // ==================== CLOSURE DATA ====================
                yPosition = checkPageBreak(60);
                yPosition = addSection('🔌 Closure Data', yPosition);
                
                const closureData = [
                    { label: 'Closure Condition', value: attrs[FIELD_MAP.physical_status] || 'N/A' },
                    { label: 'Splice Location Type', value: attrs[FIELD_MAP.splice_enclosure_type] || 'N/A' },
                    { label: 'Closure Type', value: attrs[FIELD_MAP.splice_closure_material] || 'N/A' },
                    { label: 'Work Order ID', value: attrs[FIELD_MAP.workorder_id] || 'N/A' }
                ];
                
                yPosition = addInfoGrid(closureData, yPosition);
                yPosition += 10;
                
                // ==================== FIBER INFORMATION ====================
                if (enrichedData.fiberCounts) {
                    yPosition = checkPageBreak(60);
                    yPosition = addSection('📡 Fiber Cable Information', yPosition);
                    
                    doc.setFontSize(10);
                    doc.setTextColor(0, 0, 0);
                    doc.text('Nearby Fiber Cables (within ' + CONFIG.FIBER_SEARCH_DISTANCE + 'm):', margin, yPosition);
                    yPosition += 6;
                    
                    doc.setFontSize(9);
                    for (const [count, quantity] of Object.entries(enrichedData.fiberCounts)) {
                        doc.text(`• ${quantity} individual ${count}-count fiber cable(s)`, margin + 5, yPosition);
                        yPosition += 5;
                    }
                    
                    yPosition += 10;
                }
                
                // ==================== PORT INFORMATION ====================
                yPosition = checkPageBreak(60);
                yPosition = addSection('🔧 Port & Connection Data', yPosition);
                
                const portData = [
                    { label: 'Number of Ports', value: attrs[FIELD_MAP.port_count] || 'N/A' },
                    { label: 'Drops Connected', value: attrs[FIELD_MAP.drop_count] || 'N/A' }
                ];
                
                // Parse measured light levels (comma separated)
                const lightLevels = attrs[FIELD_MAP.measured_light_Level];
                if (lightLevels) {
                    const levels = lightLevels.split(',').map(l => l.trim()).filter(l => l);
                    levels.forEach((level, index) => {
                        portData.push({
                            label: `Light Level #${index + 1}`,
                            value: `${level} dBm`
                        });
                    });
                }
                
                yPosition = addInfoGrid(portData, yPosition);
                yPosition += 10;
                
                // ==================== WORK SUMMARY ====================
                yPosition = checkPageBreak(60);
                yPosition = addSection('👷 Work Summary', yPosition);
                
                const workData = [
                    { label: 'Subcontractor', value: attrs[FIELD_MAP.construction_subcontractor] || 'N/A' },
                    { label: 'Created By', value: attrs[FIELD_MAP.creator] || 'N/A' },
                    { label: 'Last Edited By', value: attrs[FIELD_MAP.last_editior] || 'N/A' },
                    { label: 'Installation Date', value: pdfUtils.formatDate(attrs[FIELD_MAP.installation_date]) }
                ];
                
                yPosition = addInfoGrid(workData, yPosition);
                yPosition += 10;
                
                // Billing codes from related table
                if (enrichedData.billingCodes && enrichedData.billingCodes.length > 0) {
                    yPosition = checkPageBreak(40);
                    
                    doc.setFontSize(10);
                    doc.setFont(undefined, 'bold');
                    doc.setTextColor(0, 0, 0);
                    doc.text('Billing Codes:', margin, yPosition);
                    yPosition += 6;
                    
                    doc.setFontSize(9);
                    doc.setFont(undefined, 'normal');
                    enrichedData.billingCodes.forEach(code => {
                        doc.text(`• ${code}`, margin + 5, yPosition);
                        yPosition += 5;
                    });
                    
                    yPosition += 5;
                }
                
                // ==================== PHOTOS ====================
                if (attachments.length > 0) {
                    doc.addPage();
                    yPosition = 20;
                    yPosition = addSection('📷 Installation Photos', yPosition);
                    
                    for (let i = 0; i < attachments.length; i++) {
                        const attachment = attachments[i];
                        
                        if (i > 0 && i % 2 === 0) {
                            doc.addPage();
                            yPosition = 20;
                        }
                        
                        try {
                            pdfUtils.updateProgress(`Adding photo ${i + 1} of ${attachments.length}...`);
                            
                            const imgData = await dataFetcher.getAttachmentAsBase64(
                                attrs.OBJECTID,
                                attachment.id
                            );
                            
                            if (imgData) {
                                const imgHeight = 80;
                                const imgWidth = pageWidth - 2 * margin;
                                const photoY = i % 2 === 0 ? yPosition : yPosition + imgHeight + 15;
                                
                                doc.setFontSize(8);
                                doc.setTextColor(100, 100, 100);
                                doc.text(attachment.name, margin, photoY);
                                
                                doc.addImage(imgData, 'JPEG', margin, photoY + 3, imgWidth, imgHeight);
                                
                                if (i % 2 === 1) {
                                    yPosition = photoY + imgHeight + 15;
                                }
                            }
                        } catch (error) {
                            console.error(`Error adding photo ${attachment.name}:`, error);
                        }
                    }
                }
                
                // ==================== FOOTER ====================
                const pageCount = doc.internal.getNumberOfPages();
                for (let i = 1; i <= pageCount; i++) {
                    doc.setPage(i);
                    doc.setFontSize(8);
                    doc.setTextColor(150, 150, 150);
                    doc.text(
                        `Page ${i} of ${pageCount} | Generated: ${new Date().toLocaleString()}`,
                        pageWidth / 2,
                        pageHeight - 10,
                        { align: 'center' }
                    );
                }
                
                // ==================== SAVE ====================
                const filename = `SpliceClosure_${attrs[FIELD_MAP.job_number] || 'Report'}_${new Date().getTime()}.pdf`;
                doc.save(filename);
                
                return filename;
            }
        };
        
        // ==================== MAIN GENERATOR ====================
        
        async function generateReport(objectId) {
            const overlay = pdfUtils.showLoading();
            
            try {
                pdfUtils.updateProgress('Fetching feature data...');
                const feature = await dataFetcher.fetchFeatureData(objectId);
                
                pdfUtils.updateProgress('Fetching attachments...');
                const attachments = await dataFetcher.fetchAttachments(objectId);
                
                // Enrich data with additional information
                const enrichedData = {};
                
                // Reverse geocode for address
                if (feature.geometry && feature.geometry.x && feature.geometry.y) {
                    enrichedData.address = await dataFetcher.reverseGeocode(
                        feature.geometry.y,
                        feature.geometry.x
                    );
                }
                
                // Get nearby fiber cables
                if (feature.geometry) {
                    enrichedData.fiberCounts = await dataFetcher.getNearbyFiberCables(feature.geometry);
                }
                
                // Get billing codes from related table
                try {
                    enrichedData.billingCodes = await dataFetcher.getRelatedBillingCodes(objectId);
                } catch (error) {
                    console.warn('Could not fetch billing codes:', error);
                }
                
                pdfUtils.updateProgress('Generating PDF...');
                const filename = await pdfGenerator.generatePDF(feature, attachments, enrichedData);
                
                pdfUtils.hideLoading();
                
                console.log('✅ PDF generated successfully:', filename);
                alert(`PDF report generated successfully!\n\nFile: ${filename}`);
                
            } catch (error) {
                pdfUtils.hideLoading();
                pdfUtils.showError(error.message);
                console.error('PDF Generation Error:', error);
            }
        }
        
        // ==================== GLOBAL FUNCTION ====================
        
        // Make generateReport available globally
        window.generateSpliceClosurePDF = generateReport;
        
        // Register tool with host (no UI needed - called from popup)
        if (window.gisToolHost) {
            window.gisToolHost.activeTools.set('splice-pdf-generator', {
                cleanup: () => {
                    delete window.generateSpliceClosurePDF;
                    console.log('Splice PDF Generator cleaned up');
                }
            });
        }
        
        console.log('✅ Splice Closure PDF Generator loaded');
        console.log('📝 Layers detected:');
        console.log('  - Splice Closure:', SPLICE_CLOSURE_LAYER ? SPLICE_CLOSURE_LAYER.title : 'Not found');
        console.log('  - Fiber Cable:', FIBER_CABLE_LAYER ? FIBER_CABLE_LAYER.title : 'Not found (fiber count calc disabled)');
        console.log('');
        console.log('Usage: window.generateSpliceClosurePDF(objectId)');
        console.log('Or use the Arcade button in splice closure popups');
        
    } catch (error) {
        console.error('Error loading Splice PDF Generator:', error);
        alert("Error loading Splice PDF Generator: " + (error.message || error));
    }
})();
