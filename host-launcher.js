javascript:(function(){
    // Prevent double-loading
    if(window.gisToolHost) {
        if(document.getElementById('gisToolLauncher')) return;
        // Host exists but UI was closed, recreate UI
    } else {
        // Initialize the host system
        window.gisToolHost = {
            baseUrl: 'https://cdn.jsdelivr.net/gh/trelewis96/gis-tools@main/',
            loadedTools: new Set(),
            activeTools: new Map(),
            
            async loadTool(toolName) {
                try {
                    console.log(`Loading tool: ${toolName}`);
                    
                    // Check if tool is already loaded
                    if(this.loadedTools.has(toolName)) {
                        console.log(`Tool ${toolName} already loaded`);
                        return;
                    }
                    
                    // Show loading status
                    const statusEl = document.getElementById('toolStatus');
                    if(statusEl) statusEl.textContent = `Loading ${toolName}...`;
                    
                    // Fetch tool code from GitHub
                    const response = await fetch(this.baseUrl + 'tools/' + toolName + '.js');
                    if(!response.ok) throw new Error(`Failed to load tool: ${response.statusText}`);
                    
                    const code = await response.text();
                    
                    // Execute the tool code
                    eval(code);
                    
                    this.loadedTools.add(toolName);
                    console.log(`Tool ${toolName} loaded successfully`);
                    
                    if(statusEl) {
                        statusEl.textContent = `✅ ${toolName} loaded!`;
                        setTimeout(() => statusEl.textContent = '', 2000);
                    }
                    
                } catch(error) {
                    console.error(`Error loading tool ${toolName}:`, error);
                    const statusEl = document.getElementById('toolStatus');
                    if(statusEl) statusEl.textContent = `❌ Error loading ${toolName}`;
                }
            },
            
            async loadSharedUtils() {
                if(this.loadedTools.has('shared-utils')) return;
                
                try {
                    const response = await fetch(this.baseUrl + 'shared/utils.js');
                    if(response.ok) {
                        const code = await response.text();
                        eval(code);
                        this.loadedTools.add('shared-utils');
                    }
                } catch(error) {
                    console.warn('Could not load shared utils:', error);
                }
            },
            
            closeTool(toolName) {
                if(this.activeTools.has(toolName)) {
                    const toolInstance = this.activeTools.get(toolName);
                    if(toolInstance && toolInstance.cleanup) {
                        toolInstance.cleanup();
                    }
                    this.activeTools.delete(toolName);
                }
            },
            
            closeAllTools() {
                for(const [toolName, toolInstance] of this.activeTools) {
                    if(toolInstance && toolInstance.cleanup) {
                        toolInstance.cleanup();
                    }
                }
                this.activeTools.clear();
            }
        };
    }
    
    // Load shared utilities first
    await window.gisToolHost.loadSharedUtils();
    
    // Create launcher UI
    const launcher = document.createElement('div');
    launcher.id = 'gisToolLauncher';
    launcher.style.cssText = `
        position: fixed;
        top: 20px;
        left: 20px;
        z-index: 99999;
        background: #fff;
        border: 2px solid #333;
        border-radius: 8px;
        padding: 15px;
        font-family: Arial, sans-serif;
        font-size: 14px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.3);
        min-width: 200px;
    `;
    
    launcher.innerHTML = `
        <div style="display: flex; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #ddd;">
            <h4 style="margin: 0; color: #333; flex: 1;">🔧 GIS Tools</h4>
            <button id="closeLauncher" style="background: #d32f2f; color: white; border: none; border-radius: 3px; padding: 4px 8px; cursor: pointer; font-size: 12px;">✕</button>
        </div>
        
        <div style="display: grid; gap: 8px; margin-bottom: 12px;">
            <button class="tool-btn" data-tool="snap-move" style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #3367d6; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 13px;">
                📐 <span>Snap Move Tool</span>
            </button>
            
            <button class="tool-btn" data-tool="curve-creator" style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 13px;">
                🎨 <span>Curve Creator</span>
            </button>
            
            <button class="tool-btn" data-tool="attachment-manager" style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #ff9800; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 13px;">
                📎 <span>Attachment Manager</span>
            </button>
        </div>
        
        <div style="border-top: 1px solid #ddd; padding-top: 8px;">
            <div id="toolStatus" style="font-size: 12px; color: #666; min-height: 16px;"></div>
            <button id="closeAllTools" style="width: 100%; padding: 6px; background: #666; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 12px; margin-top: 6px;">
                Close All Tools
            </button>
        </div>
    `;
    
    // Add event listeners
    launcher.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const toolName = e.currentTarget.getAttribute('data-tool');
            await window.gisToolHost.loadTool(toolName);
        });
        
        // Hover effects
        btn.addEventListener('mouseenter', (e) => {
            e.target.style.opacity = '0.9';
            e.target.style.transform = 'translateY(-1px)';
        });
        btn.addEventListener('mouseleave', (e) => {
            e.target.style.opacity = '1';
            e.target.style.transform = 'translateY(0)';
        });
    });
    
    launcher.querySelector('#closeLauncher').onclick = () => {
        launcher.remove();
    };
    
    launcher.querySelector('#closeAllTools').onclick = () => {
        window.gisToolHost.closeAllTools();
        document.getElementById('toolStatus').textContent = 'All tools closed.';
    };
    
    // Add to page
    document.body.appendChild(launcher);
    
    console.log('GIS Tool Host initialized');
})();
