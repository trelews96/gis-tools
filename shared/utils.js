// shared/utils.js - Common utilities for all GIS tools
// This file is loaded first by the host launcher

window.gisSharedUtils = {
    // Common layer configuration
    LAYER_CONFIG: {
        points: [
            {id: 42100, name: "Vault"},
            {id: 41150, name: "Splice Closure"}, 
            {id: 41100, name: "Fiber Equipment"}
        ],
        lines: [
            {id: 41050, name: "Fiber Cable"},
            {id: 42050, name: "Underground Span"}, 
            {id: 43050, name: "Aerial Span"}
        ]
    },
    
    // Common tolerances
    SNAP_TOLERANCE: 15,
    POINT_SNAP_TOLERANCE: 25,
    
    // Get MapView reference
    getMapView() {
        const mapView = Object.values(window).find(o => 
            o && o.constructor && o.constructor.name === "MapView"
        );
        if (!mapView) {
            throw new Error("No MapView found. Make sure you're in ArcGIS Map Viewer.");
        }
        return mapView;
    },
    
    // Distance calculation
    calculateDistance(point1, point2) {
        const dx = point1.x - point2.x;
        const dy = point1.y - point2.y;
        return Math.sqrt(dx * dx + dy * dy);
    },
    
    // Geodetic length calculation
    calculateGeodeticLength(geometry) {
        try {
            if (!geometry || !geometry.paths || geometry.paths.length === 0) return 0;
            
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
                        x: path[i + 1][0], 
                        y: path[i + 1][1],
                        spatialReference: geometry.spatialReference
                    };
                    totalLength += this.calculateGeodeticDistanceBetweenPoints(point1, point2);
                }
            }
            return Math.round(totalLength);
        } catch (error) {
            console.warn('Error calculating geodetic length:', error);
            return 0;
        }
    },
    
    // Geodetic distance between two points
    calculateGeodeticDistanceBetweenPoints(point1, point2) {
        try {
            const latLng1 = this.convertMapPointToLatLng(point1);
            const latLng2 = this.convertMapPointToLatLng(point2);
            
            const earthRadiusFeet = 20902231.0;
            const lat1Rad = latLng1.lat * Math.PI / 180;
            const lat2Rad = latLng2.lat * Math.PI / 180;
            const deltaLatRad = (latLng2.lat - latLng1.lat) * Math.PI / 180;
            const deltaLngRad = (latLng2.lng - latLng1.lng) * Math.PI / 180;
            
            const a = Math.sin(deltaLatRad / 2) * Math.sin(deltaLatRad / 2) +
                     Math.cos(lat1Rad) * Math.cos(lat2Rad) *
                     Math.sin(deltaLngRad / 2) * Math.sin(deltaLngRad / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            
            return earthRadiusFeet * c;
        } catch (error) {
            console.warn('Error calculating geodetic distance:', error);
            return 0;
        }
    },
    
    // Coordinate conversion
    convertMapPointToLatLng(mapPoint) {
        try {
            const sr = mapPoint.spatialReference;
            if (!sr || sr.wkid === 3857 || sr.wkid === 102100) {
                return this.convertWebMercatorToLatLng(mapPoint.x, mapPoint.y);
            } else if (sr.wkid === 4326 || sr.wkid === 4269) {
                return {lat: mapPoint.y, lng: mapPoint.x};
            } else {
                return this.convertWebMercatorToLatLng(mapPoint.x, mapPoint.y);
            }
        } catch (error) {
            console.warn('Error converting map point:', error);
            return {lat: 0, lng: 0};
        }
    },
    
    // Web Mercator to Lat/Lng conversion
    convertWebMercatorToLatLng(x, y) {
        const lng = (x / 20037508.34) * 180;
        let lat = (y / 20037508.34) * 180;
        lat = 180 / Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
        return {lat: lat, lng: lng};
    },
    
    // Common UI styling
    getToolboxStyle(zIndex = 99999) {
        return `
            position: fixed;
            top: 120px;
            right: 40px;
            z-index: ${zIndex};
            background: #fff;
            border: 1px solid #333;
            padding: 12px;
            max-width: 320px;
            font: 12px/1.3 Arial, sans-serif;
            box-shadow: 0 4px 16px rgba(0,0,0,.2);
            border-radius: 4px;
        `;
    },
    
    // Find layer by ID
    findLayerById(layerId) {
        const mapView = this.getMapView();
        return mapView.map.allLayers.find(l => l.layerId === layerId);
    },
    
    // Create status message element
    createStatusElement() {
        const status = document.createElement('div');
        status.style.cssText = `
            margin-top: 8px;
            color: #3367d6;
            font-size: 11px;
            min-height: 16px;
        `;
        return status;
    },
    
    // Show temporary status message
    showStatus(element, message, duration = 3000, isError = false) {
        element.textContent = message;
        element.style.color = isError ? '#d32f2f' : '#3367d6';
        
        if (duration > 0) {
            setTimeout(() => {
                element.textContent = '';
                element.style.color = '#3367d6';
            }, duration);
        }
    },
    
    // Debounce function for performance
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },
    
    // Error handler
    handleError(error, context = 'Operation') {
        console.error(`${context} error:`, error);
        return `❌ ${context} failed: ${error.message || error}`;
    }
};

console.log('GIS Shared Utils loaded');
