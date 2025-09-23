async function generateDailyTrackingLink(fiberCableFeature) {
    const baseUrl = 'https://dycom.outsystemsenterprise.com/ECCGISHub/DailyTracking?';
    
    // Get globalid - ensure it's properly formatted with braces
    let globalId = fiberCableFeature.attributes.globalid || 
                   fiberCableFeature.attributes.GlobalID || 
                   fiberCableFeature.attributes.GLOBALID;
    
    // Ensure globalid has proper GUID format with braces
    if (globalId && !globalId.startsWith('{')) {
        globalId = `{${globalId}}`;
    }
    if (globalId && !globalId.endsWith('}')) {
        globalId = `${globalId}}`;
    }
    
    // Get featureclass_type
    const featureclassType = fiberCableFeature.attributes.featureclass_type || 
                           fiberCableFeature.attributes.FeatureClass_Type ||
                           fiberCableFeature.attributes.FEATURECLASS_TYPE ||
                           'fiber_cable';
    
    console.log('Feature class type:', featureclassType);
    console.log('Fiber cable globalid:', globalId);
    
    // Now we need to query the related daily tracking table to get the rel_fiber_cable_guid
    let rfgValue = '';
    
    try {
        // Find the daily tracking layer with layer ID 90100
        const allFL = mapView.map.allLayers.filter(l => l.type === "feature");
        const dailyTrackingLayer = allFL.find(l => l.layerId === 90100);
        
        if (dailyTrackingLayer) {
            await dailyTrackingLayer.load();
            console.log('Found daily tracking layer:', dailyTrackingLayer.title);
            
            // Query the daily tracking table for records where rel_fiber_cable_guid matches the fiber cable's globalid
            // Remove the braces from globalid for the query
            const fiberGlobalIdForQuery = globalId.replace(/[{}]/g, '');
            
            const relatedQuery = await dailyTrackingLayer.queryFeatures({
                where: `rel_fiber_cable_guid = '${fiberGlobalIdForQuery}'`,
                outFields: ['*'],
                returnGeometry: false
            });
            
            console.log(`Querying daily tracking with: rel_fiber_cable_guid = '${fiberGlobalIdForQuery}'`);
            console.log('Found related records:', relatedQuery.features.length);
            
            if (relatedQuery.features.length > 0) {
                const relatedFeature = relatedQuery.features[0];
                console.log('Related record attributes:', Object.keys(relatedFeature.attributes));
                
                // The rfg value should be the globalid of the related daily tracking record
                rfgValue = relatedFeature.attributes.globalid || 
                          relatedFeature.attributes.GlobalID || 
                          relatedFeature.attributes.GLOBALID;
                
                console.log('Found RFG value from daily tracking record globalid:', rfgValue);
            } else {
                console.log('No related records found in daily tracking table for globalid:', fiberGlobalIdForQuery);
                
                // Try alternative query in case the field stores GUIDs with braces
                const alternativeQuery = await dailyTrackingLayer.queryFeatures({
                    where: `rel_fiber_cable_guid = '${globalId}'`,
                    outFields: ['*'],
                    returnGeometry: false
                });
                
                console.log('Alternative query with braces found:', alternativeQuery.features.length);
                
                if (alternativeQuery.features.length > 0) {
                    const relatedFeature = alternativeQuery.features[0];
                    rfgValue = relatedFeature.attributes.globalid || 
                              relatedFeature.attributes.GlobalID || 
                              relatedFeature.attributes.GLOBALID;
                    console.log('Found RFG value from alternative query:', rfgValue);
                }
            }
        } else {
            console.log('Daily tracking layer (90100) not found');
            console.log('Available layers:', allFL.map(l => `${l.layerId}: ${l.title}`));
        }
        
    } catch (error) {
        console.log('Error querying related table:', error);
    }
    
    // Ensure rfgValue has proper GUID format with braces
    if (rfgValue && !rfgValue.startsWith('{')) {
        rfgValue = `{${rfgValue}}`;
    }
    if (rfgValue && !rfgValue.endsWith('}')) {
        rfgValue = `${rfgValue}}`;
    }
    
    // Get service URL and fix the encoding issue
    let serviceLayerUrl = '';
    if (fiberCableFeature.layer && fiberCableFeature.layer.url) {
        serviceLayerUrl = fiberCableFeature.layer.url;
        
        // The working URL uses layer 90100, but your code shows 41050
        // We need to determine the correct layer ID for the Daily Tracking system
        // Based on the working example, it might be a different layer ID than what's in the feature layer
        
        // Check if the URL already ends with a layer ID (number)
        const urlParts = serviceLayerUrl.split('/');
        const lastPart = urlParts[urlParts.length - 1];
        
        // Replace the current layer ID with the one used in the working URL
        if (!isNaN(parseInt(lastPart))) {
            // Remove the current layer ID and replace with 90100
            urlParts[urlParts.length - 1] = '90100';
            serviceLayerUrl = urlParts.join('/');
        } else {
            // Add the layer ID if it's missing
            serviceLayerUrl = `${serviceLayerUrl}/90100`;
        }
    }
    
    // Build parameters in the same order as the working example
    const dtg = `dtg=${globalId}`;
    const rfg = `rfg=${rfgValue}`;
    // DON'T encode the service URL - the working URL doesn't have encoding
    const serviceUrl = `serviceUrl=${serviceLayerUrl}`;
    
    // Construct final URL matching the working pattern exactly
    const finalUrl = `${baseUrl}${dtg}&${rfg}&${serviceUrl}`;
    
    // Debug logging to help troubleshoot
    console.log('Link Generation Debug Info:');
    console.log('Global ID:', globalId);
    console.log('Feature Class Type:', featureclassType);
    console.log('RFG Value:', rfgValue);
    console.log('Service Layer URL:', serviceLayerUrl);
    console.log('Generated URL:', finalUrl);
    
    return finalUrl;
}
