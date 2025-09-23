function highlightFeature(feature, color = [255, 255, 0, 0.8], showPopup = false) {
    try {
        console.log('highlightFeature called with:', feature, color, 'showPopup:', showPopup);
        
        // Validate feature structure
        if (!feature) {
            console.error('No feature provided to highlightFeature');
            return;
        }
        
        if (!feature.geometry) {
            console.error('Feature missing geometry:', feature);
            return;
        }
        
        if (!feature.attributes) {
            console.error('Feature missing attributes:', feature);
            return;
        }
        
        clearHighlight();
        
        console.log('Feature geometry type:', feature.geometry.type);
        
        let symbol;
        if (feature.geometry.type === "point") {
            symbol = {
                type: "simple-marker",
                color: color,
                size: 20,
                outline: {
                    color: [255, 255, 255, 1],
                    width: 4
                }
            };
        } else if (feature.geometry.type === "polyline") {
            symbol = {
                type: "simple-line",
                color: color,
                width: 8,
                style: "solid"
            };
        } else if (feature.geometry.type === "polygon") {
            symbol = {
                type: "simple-fill",
                color: color,
                outline: {
                    color: [255, 255, 255, 1],
                    width: 4
                }
            };
        }
        
        console.log('Created symbol:', symbol);
        
        currentHighlight = {
            geometry: feature.geometry,
            symbol: symbol
        };
        
        console.log('Adding highlight graphic to map');
        mapView.graphics.add(currentHighlight);
        
        // Add a pulsing effect by creating a second, larger graphic
        let pulseSymbol;
        if (feature.geometry.type === "point") {
            pulseSymbol = {
                type: "simple-marker",
                color: [color[0], color[1], color[2], 0.3],
                size: 30,
                outline: {
                    color: [255, 255, 255, 0.8],
                    width: 2
                }
            };
        } else if (feature.geometry.type === "polyline") {
            pulseSymbol = {
                type: "simple-line",
                color: [color[0], color[1], color[2], 0.5],
                width: 12,
                style: "solid"
            };
        } else if (feature.geometry.type === "polygon") {
            pulseSymbol = {
                type: "simple-fill",
                color: [color[0], color[1], color[2], 0.3],
                outline: {
                    color: [255, 255, 255, 0.8],
                    width: 6
                }
            };
        }
        
        const pulseGraphic = {
            geometry: feature.geometry,
            symbol: pulseSymbol
        };
        
        console.log('Adding pulse graphic to map');
        mapView.graphics.add(pulseGraphic);
        
        // Store both graphics for cleanup
        currentHighlight.pulseGraphic = pulseGraphic;
        
        console.log('Zooming to feature');
        // Zoom to feature with padding
        mapView.goTo({
            target: feature.geometry,
            scale: Math.min(mapView.scale, 2000) // Don't zoom out if already closer
        }, {duration: 800}).then(() => {
            console.log('Zoom completed');
            
            // Show popup after zoom completes if requested
            if (showPopup && mapView.popup) {
                console.log('Triggering popup for feature');
                
                // Create a graphic for the popup with full feature information
                const popupGraphic = {
                    geometry: feature.geometry,
                    attributes: feature.attributes,
                    // Include layer reference if available for proper field aliases and popup configuration
                    layer: feature.layer
                };
                
                // Set the popup content and location
                mapView.popup.open({
                    features: [popupGraphic],
                    location: getPopupLocation(feature.geometry)
                });
                
                console.log('Popup opened for feature');
            }
        }).catch(err => {
            console.error('Zoom failed:', err);
            
            // Still try to show popup even if zoom fails
            if (showPopup && mapView.popup) {
                console.log('Zoom failed, but still showing popup');
                
                const popupGraphic = {
                    geometry: feature.geometry,
                    attributes: feature.attributes,
                    layer: feature.layer
                };
                
                mapView.popup.open({
                    features: [popupGraphic],
                    location: getPopupLocation(feature.geometry)
                });
            }
        });
        
        console.log('Highlighting completed successfully');
    } catch (error) {
        console.error('Error in highlightFeature:', error);
        updateStatus('Error highlighting feature: ' + error.message);
    }
}

// Helper function to get appropriate popup location based on geometry type
function getPopupLocation(geometry) {
    try {
        if (geometry.type === "point") {
            return geometry;
        } else if (geometry.type === "polyline") {
            // Use the midpoint of the polyline
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
            // Use the centroid of the polygon
            if (geometry.centroid) {
                return geometry.centroid;
            } else if (geometry.rings && geometry.rings[0] && geometry.rings[0].length > 0) {
                // Calculate simple centroid if not available
                const ring = geometry.rings[0];
                let sumX = 0, sumY = 0;
                for (let i = 0; i < ring.length - 1; i++) { // -1 to exclude closing point
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
        
        // Fallback to geometry extent center if available
        if (geometry.extent && geometry.extent.center) {
            return geometry.extent.center;
        }
        
        // Final fallback - return the geometry itself
        return geometry;
    } catch (error) {
        console.error('Error calculating popup location:', error);
        return geometry; // Fallback to original geometry
    }
}
