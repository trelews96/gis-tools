// tools/remote-qc-workflow.js — Remote QC Workflow Tool v4
(function () {
  try {
    if (window.gisToolHost.activeTools.has('remote-qc-workflow')) return;
    document.getElementById('remoteQcWorkflowToolbox')?.remove();

    const utils = window.gisSharedUtils;
    if (!utils) throw new Error('Shared utilities not loaded');
    const mapView = utils.getMapView();
    const Z = 99999;

    const loadModule = path => new Promise((res, rej) => require([path], res, rej));

    // ── State ─────────────────────────────────────────────────────────
    let mode = 'new_qc';
    let qcQueue = [], currentIndex = 0, currentPhase = 'query';
    let gigTypes = [], workOrderOptions = [], poOptions = [], jobOptions = [];
    let sessionLog = [], sessionStartTime = null;
    let featureStartTime = null, timerInterval = null, highlightHandle = null;
    let spatialMode = 'none';
    let drawnGeometry = null, sketchLayer = null, sketchVM = null, isDrawing = false;

    const selectedWOs = new Set(), woNameMap = new Map();
    const selectedPOs = new Set(), poNameMap = new Map();
    const selectedJobs = new Set(), jobNameMap = new Map();

    let lbImages = [], lbIdx = 0, lbScale = 1, lbPan = { x: 0, y: 0 };
    let lbDragging = false, lbDragStart = { x: 0, y: 0 }, lbPanStart = { x: 0, y: 0 };

    let mkActive = false, mkTool = 'pen', mkColor = '#ff3b3b', mkWidth = 3;
    let mkStrokes = [], mkCurrent = null, mkDrawing = false;
    let mkCanvas = null, mkCtx = null;
    let pendingGigAttachment = null;

    const OPTS_CACHE_KEY = 'rqcw_filter_opts_v1';
    const OPTS_CACHE_TTL = 4 * 60 * 60 * 1000;
    let recentGigTypes = [];
    try { recentGigTypes = JSON.parse(localStorage.getItem('rqcw_recent_gig_types') || '[]'); } catch (_) {}

    // ── CSS ───────────────────────────────────────────────────────────
    const css = document.createElement('style');
    css.textContent = `
      #rqcw*,#rqcw*::before,#rqcw*::after{box-sizing:border-box;margin:0;padding:0}
      #rqcw{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#1e293b}
      #rqcw .btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:7px 13px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;transition:filter .15s,opacity .15s;white-space:nowrap}
      #rqcw .btn:disabled{opacity:.45;cursor:not-allowed}
      #rqcw .btn:not(:disabled):hover{filter:brightness(1.08)}
      #rqcw .btn-primary{background:#2563eb;color:#fff}
      #rqcw .btn-success{background:#16a34a;color:#fff}
      #rqcw .btn-amber{background:#d97706;color:#fff}
      #rqcw .btn-slate{background:#64748b;color:#fff}
      #rqcw .btn-cyan{background:#0891b2;color:#fff}
      #rqcw .btn-violet{background:#7c3aed;color:#fff}
      #rqcw .btn-ghost{background:transparent;color:#64748b;border:1px solid #e2e8f0}
      #rqcw .btn-ghost:not(:disabled):hover{background:#f1f5f9}
      #rqcw .btn-full{width:100%}
      #rqcw .btn-sm{padding:5px 10px;font-size:11px}
      #rqcw .card{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:14px}
      #rqcw .card-inset{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px}
      #rqcw label.field-label{display:block;font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px}
      #rqcw input[type=text],#rqcw input[type=date],#rqcw select,#rqcw textarea{width:100%;padding:7px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;color:#1e293b;background:#fff;outline:none;transition:border-color .15s,box-shadow .15s}
      #rqcw input:focus,#rqcw select:focus,#rqcw textarea:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.12)}
      #rqcw .tab-bar{display:flex;background:#fff;border-bottom:2px solid #e2e8f0}
      #rqcw .tab{flex:1;padding:10px;border:none;background:none;cursor:pointer;font-size:12px;font-weight:600;color:#64748b;border-bottom:2px solid transparent;margin-bottom:-2px;transition:color .15s,border-color .15s}
      #rqcw .tab.active{color:#2563eb;border-bottom-color:#2563eb}
      #rqcw .radio-card{display:flex;align-items:center;gap:10px;padding:10px 12px;border:2px solid #e2e8f0;border-radius:8px;cursor:pointer;transition:border-color .15s,background .15s;margin-bottom:7px}
      #rqcw .radio-card:hover{border-color:#94a3b8;background:#f8fafc}
      #rqcw .radio-card.sel-pass{border-color:#16a34a;background:#f0fdf4}
      #rqcw .radio-card.sel-fail{border-color:#dc2626;background:#fef2f2}
      #rqcw .radio-card.sel-photo{border-color:#d97706;background:#fffbeb}
      #rqcw .radio-card.sel-approve{border-color:#16a34a;background:#f0fdf4}
      #rqcw .radio-card.sel-reopen{border-color:#dc2626;background:#fef2f2}
      #rqcw .radio-card input[type=radio]{accent-color:#2563eb;width:15px;height:15px;flex-shrink:0}
      #rqcw .rc-icon{font-size:20px;flex-shrink:0}
      #rqcw .rc-title{font-size:12px;font-weight:700}
      #rqcw .rc-sub{font-size:10px;color:#64748b;margin-top:1px}
      #rqcw .kbd{display:inline-block;background:rgba(0,0,0,.06);border:1px solid #cbd5e1;border-radius:3px;padding:0 5px;font-size:10px;font-family:monospace}
      #rqcw .pbar-track{height:6px;background:#e2e8f0;border-radius:99px;overflow:hidden}
      #rqcw .pbar-fill{height:100%;background:linear-gradient(90deg,#2563eb,#06b6d4);transition:width .35s ease}
      #rqcw .dropdown-list{position:absolute;top:100%;left:0;right:0;max-height:230px;overflow-y:auto;background:#fff;border:1px solid #cbd5e1;border-top:none;border-radius:0 0 6px 6px;z-index:1100;box-shadow:0 6px 16px rgba(0,0,0,.12)}
      #rqcw .dd-hdr{display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:#f8fafc;border-bottom:1px solid #e2e8f0;position:sticky;top:0}
      #rqcw .dd-hdr-txt{font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.4px}
      #rqcw .dd-hdr-clear{background:none;border:none;font-size:10px;color:#dc2626;cursor:pointer;font-weight:700;padding:0}
      #rqcw .dd-check-row{display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer;font-size:12px;transition:background .1s}
      #rqcw .dd-check-row:hover{background:#f8fafc}
      #rqcw .dd-check-row.is-checked{background:#eff6ff}
      #rqcw .dd-check-row input[type=checkbox]{accent-color:#2563eb;width:13px;height:13px;flex-shrink:0;pointer-events:none}
      #rqcw .multi-pill{display:inline-flex;align-items:center;background:#dbeafe;color:#1d4ed8;border-radius:99px;font-size:10px;font-weight:700;padding:1px 8px;position:absolute;right:28px;top:50%;transform:translateY(-50%);pointer-events:none}
      #rqcw .dd-chevron{position:absolute;right:9px;top:50%;transform:translateY(-50%);color:#94a3b8;font-size:10px;pointer-events:none}
      #rqcw .scroll-box{max-height:175px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:6px;padding:4px}
      #rqcw .check-item{display:flex;align-items:center;gap:8px;padding:5px 6px;cursor:pointer;border-radius:4px;transition:background .1s}
      #rqcw .check-item:hover{background:#f8fafc}
      #rqcw .check-item input{accent-color:#2563eb;width:14px;height:14px;flex-shrink:0}
      #rqcw .attr-grid{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:11px}
      #rqcw .attr-key{color:#64748b;font-weight:600;white-space:nowrap}
      #rqcw .chip-group{display:flex;gap:6px;flex-wrap:wrap}
      #rqcw .chip{display:inline-flex;align-items:center;gap:4px;padding:5px 11px;border:1.5px solid #cbd5e1;border-radius:99px;cursor:pointer;font-size:11px;font-weight:600;color:#64748b;background:#fff;transition:all .15s;user-select:none}
      #rqcw .chip:hover{border-color:#94a3b8;background:#f8fafc}
      #rqcw .chip.active{border-color:#2563eb;background:#eff6ff;color:#2563eb}
      #rqcw .chip.active-green{border-color:#16a34a;background:#f0fdf4;color:#15803d}
      #rqcw .chip input{display:none}
      #rqcw .draw-panel{margin-top:8px;padding:10px 12px;background:#f0f9ff;border:1.5px solid #bae6fd;border-radius:6px}
      #rqcw .draw-hint{font-size:11px;color:#0369a1;margin-top:7px;display:flex;align-items:center;gap:6px;line-height:1.4}
      #rqcw .draw-hint.drawing{color:#dc2626}
      #rqcw .draw-hint.done{color:#16a34a}
      #rqcw .pulse{width:8px;height:8px;border-radius:50%;background:currentColor;flex-shrink:0;animation:qcPulse 1s ease-in-out infinite}
      @keyframes qcPulse{0%,100%{opacity:1}50%{opacity:.25}}
      #rqcw .filter-badge{display:inline-flex;align-items:center;padding:2px 8px;background:#dbeafe;color:#1d4ed8;border-radius:99px;font-size:10px;font-weight:700}
      #rqcw .cache-badge{display:inline-flex;align-items:center;padding:2px 7px;background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;border-radius:99px;font-size:10px;font-weight:600}
      #rqcw .qd-strip{display:flex;gap:4px;margin-top:5px}
      #rqcw .qd-strip .btn{padding:3px 9px;font-size:10px;color:#475569;border-color:#e2e8f0}
      #rqcwHeader{cursor:grab;user-select:none}
      #rqcwHeader.dragging{cursor:grabbing}
      #rqcw #attachmentsBar .btn-attach{background:#f0f9ff;color:#0369a1;border-color:#bae6fd}
      #rqcw #attachmentsBar .btn-attach:hover{background:#e0f2fe}
      #rqcw .attach-badge{background:#dbeafe;color:#1d4ed8;border-radius:99px;padding:1px 8px;font-size:10px;font-weight:700;margin-left:4px}
      #rqcw #btnEndSession{color:#dc2626;border-color:#fecaca}
      #rqcw #btnEndSession:hover{background:#fef2f2}
      #rqcw .mk-pending-pill{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;border-radius:99px;font-size:10px;font-weight:700}
      /* Lightbox */
      #rqcwLightbox{position:fixed;inset:0;z-index:${Z+1000};background:rgba(0,0,0,.92);display:none;flex-direction:column;align-items:center;justify-content:center}
      #rqcwLightbox.open{display:flex}
      #rqcwLightbox .lb-toolbar{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);z-index:4}
      #rqcwLightbox .lb-title{color:#e2e8f0;font-size:12px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 12px}
      #rqcwLightbox .lb-counter{color:#94a3b8;font-size:11px;white-space:nowrap;margin-right:8px}
      #rqcwLightbox .lb-zoom-btns{display:flex;gap:5px;margin-right:8px}
      #rqcwLightbox .lb-zoom-btns button{background:rgba(255,255,255,.15);border:none;color:#fff;padding:4px 11px;border-radius:5px;cursor:pointer;font-size:14px;font-weight:700;transition:background .15s}
      #rqcwLightbox .lb-zoom-btns button:hover{background:rgba(255,255,255,.3)}
      #rqcwLightbox .lb-close{background:rgba(255,255,255,.12);border:none;color:#fff;width:32px;height:32px;border-radius:6px;cursor:pointer;font-size:20px;line-height:1;display:flex;align-items:center;justify-content:center;transition:background .15s}
      #rqcwLightbox .lb-close:hover{background:rgba(220,38,38,.6)}
      #rqcwLightbox .lb-stage{position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden}
      #rqcwLightbox .lb-stage.grab{cursor:grab}
      #rqcwLightbox .lb-stage.grabbing{cursor:grabbing}
      #rqcwLightbox #lbImg{max-width:90vw;max-height:85vh;object-fit:contain;transform-origin:center center;transition:transform .08s ease-out;user-select:none;pointer-events:none;display:none;border-radius:3px}
      #rqcwLightbox .lb-spinner{color:#93c5fd;font-size:13px;position:absolute}
      #rqcwLightbox .lb-nav{position:absolute;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.13);border:none;color:#fff;width:44px;height:44px;border-radius:50%;cursor:pointer;font-size:22px;display:flex;align-items:center;justify-content:center;transition:background .15s;z-index:2}
      #rqcwLightbox .lb-nav:hover{background:rgba(255,255,255,.3)}
      #rqcwLightbox .lb-prev{left:16px}
      #rqcwLightbox .lb-next{right:16px}
      #rqcwLightbox .lb-hint{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.55);color:#94a3b8;font-size:10px;padding:4px 12px;border-radius:99px;white-space:nowrap;pointer-events:none;z-index:3;transition:opacity .2s}
      #rqcwLightbox #lbMkCanvas{position:absolute;display:none;touch-action:none;z-index:3}
      #rqcwLightbox #lbMkTextWrap{position:absolute;display:none;z-index:6}
      #rqcwLightbox #lbMkTextVal{background:rgba(0,0,0,.8);color:#fff;border:2px solid #2563eb;border-radius:5px;padding:5px 9px;font-size:14px;font-weight:700;outline:none;min-width:160px;max-width:280px}
      #rqcwLightbox #lbMkBar{position:absolute;bottom:44px;left:50%;transform:translateX(-50%);background:rgba(8,8,8,.92);border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(10px);border-radius:10px;padding:8px 11px;display:none;align-items:center;gap:7px;z-index:5;white-space:nowrap}
      #rqcwLightbox #lbMkBar.open{display:flex}
      #rqcwLightbox .mk-btn{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.12);color:#fff;width:30px;height:30px;border-radius:5px;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0;user-select:none}
      #rqcwLightbox .mk-btn:hover{background:rgba(255,255,255,.22)}
      #rqcwLightbox .mk-btn.sel{background:#2563eb;border-color:#2563eb}
      #rqcwLightbox .mk-dot{width:20px;height:20px;border-radius:50%;cursor:pointer;flex-shrink:0;border:2.5px solid rgba(255,255,255,.25);transition:all .15s}
      #rqcwLightbox .mk-dot:hover{border-color:rgba(255,255,255,.7)}
      #rqcwLightbox .mk-dot.sel{border-color:#fff;box-shadow:0 0 0 2px #2563eb}
      #rqcwLightbox .mk-sep{width:1px;height:22px;background:rgba(255,255,255,.18);flex-shrink:0}
      #rqcwLightbox .mk-lw{width:58px;accent-color:#2563eb;cursor:pointer}
      #rqcwLightbox .mk-queue{background:#16a34a;border:none;color:#fff;padding:5px 11px;border-radius:5px;cursor:pointer;font-size:11px;font-weight:700;white-space:nowrap;transition:background .15s}
      #rqcwLightbox .mk-queue:hover:not(:disabled){background:#15803d}
      #rqcwLightbox .mk-queue:disabled{opacity:.45;cursor:not-allowed}
      #rqcwLightbox .mk-queued-badge{position:absolute;top:58px;right:16px;background:#15803d;color:#fff;font-size:10px;font-weight:700;padding:4px 10px;border-radius:5px;pointer-events:none;z-index:5;display:none}
      #rqcwLightbox #lbMkToggle.on{background:rgba(37,99,235,.85) !important}
      /* Photo Transfer Panel */
      #rqcwPhotoPanel{position:fixed;inset:0;z-index:${Z+2000};background:rgba(0,0,0,.88);display:none;align-items:center;justify-content:center;padding:20px}
      #rqcwPhotoPanel.open{display:flex}
      #rqcwPhotoPanel .pp-wrap{background:#0f172a;border-radius:12px;width:100%;max-width:880px;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.6)}
      #rqcwPhotoPanel .pp-hdr{background:linear-gradient(135deg,#1e3a5f,#2563eb);padding:14px 18px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
      #rqcwPhotoPanel .pp-body{flex:1;overflow-y:auto;padding:16px;display:grid;grid-template-columns:1fr 1fr;gap:14px}
      #rqcwPhotoPanel .pp-col-hdr{font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between}
      #rqcwPhotoPanel .pp-col-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700}
      #rqcwPhotoPanel .pp-grid{display:flex;flex-direction:column;gap:8px}
      #rqcwPhotoPanel .pp-item{display:flex;gap:10px;padding:10px;background:#1e293b;border:2px solid #334155;border-radius:8px;cursor:pointer;transition:border-color .15s,background .15s;align-items:center}
      #rqcwPhotoPanel .pp-item:hover{border-color:#475569}
      #rqcwPhotoPanel .pp-item.sel-t{border-color:#2563eb;background:rgba(37,99,235,.12)}
      #rqcwPhotoPanel .pp-item.sel-d{border-color:#dc2626;background:rgba(220,38,38,.12)}
      #rqcwPhotoPanel .pp-thumb{width:72px;height:72px;object-fit:cover;border-radius:5px;flex-shrink:0;background:#0f172a}
      #rqcwPhotoPanel .pp-thumb-ph{width:72px;height:72px;border-radius:5px;flex-shrink:0;background:#1e293b;display:none;align-items:center;justify-content:center;font-size:24px;color:#334155}
      #rqcwPhotoPanel .pp-info{flex:1;overflow:hidden;min-width:0}
      #rqcwPhotoPanel .pp-name{font-size:11px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #rqcwPhotoPanel .pp-size{font-size:10px;color:#475569;margin-top:2px}
      #rqcwPhotoPanel .pp-cb{width:16px;height:16px;flex-shrink:0;cursor:pointer}
      #rqcwPhotoPanel .pp-cb-t{accent-color:#2563eb}
      #rqcwPhotoPanel .pp-cb-d{accent-color:#dc2626}
      #rqcwPhotoPanel .pp-empty{color:#475569;font-size:11px;padding:24px 10px;text-align:center;line-height:1.6}
      #rqcwPhotoPanel .pp-excluded{font-size:10px;color:#475569;margin-top:8px;padding:6px 8px;background:#0f172a;border-radius:4px;font-style:italic}
      #rqcwPhotoPanel .pp-footer{padding:12px 16px;background:#070d19;border-top:1px solid #1e293b;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-shrink:0}
      #rqcwPhotoPanel .pp-summary{font-size:11px;color:#64748b;flex:1}
      #rqcwPhotoPanel .pp-summary strong{color:#e2e8f0}
      #rqcwPhotoPanel .pp-prog{height:4px;background:#1e293b;border-radius:99px;overflow:hidden;margin-top:6px;display:none}
      #rqcwPhotoPanel .pp-prog-fill{height:100%;background:linear-gradient(90deg,#2563eb,#06b6d4);transition:width .25s ease;width:0%}
      #rqcwPhotoPanel .pp-btn-cancel{background:transparent;border:1px solid #334155;color:#94a3b8;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap}
      #rqcwPhotoPanel .pp-btn-cancel:hover{border-color:#475569;color:#e2e8f0}
      #rqcwPhotoPanel .pp-btn-confirm{background:#16a34a;border:none;color:#fff;padding:8px 18px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;white-space:nowrap;transition:background .15s}
      #rqcwPhotoPanel .pp-btn-confirm:hover:not(:disabled){background:#15803d}
      #rqcwPhotoPanel .pp-btn-confirm:disabled{opacity:.5;cursor:not-allowed}
    `;
    document.head.appendChild(css);

    // ── Toolbox ───────────────────────────────────────────────────────
    const box = document.createElement('div');
    box.id = 'rqcw';
    box.style.cssText = `position:fixed;top:70px;right:20px;z-index:${Z};width:468px;max-height:90vh;overflow-y:auto;background:#f8fafc;border:1px solid #cbd5e1;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.22);`;

    box.innerHTML = `
      <div id="rqcwHeader" style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);padding:14px 16px;border-radius:12px 12px 0 0;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10;">
        <div><div style="color:#fff;font-weight:700;font-size:15px;letter-spacing:-.2px;">🔍 Remote QC Workflow</div>
          <div id="hdrSub" style="color:#93c5fd;font-size:11px;margin-top:2px;">Initializing…</div></div>
        <div style="display:flex;gap:6px;align-items:center;">
          <button id="btnHome" title="Back to filters" style="background:rgba(255,255,255,.15);border:none;color:#fff;width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;" onmouseover="this.style.background='rgba(255,255,255,.28)'" onmouseout="this.style.background='rgba(255,255,255,.15)'">🏠</button>
          <button id="btnClose" style="background:rgba(255,255,255,.15);border:none;color:#fff;width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;">×</button>
        </div>
      </div>
      <div class="tab-bar">
        <button class="tab active" id="tabNew">New Feature QC</button>
        <button class="tab" id="tabClear">Review Cleared GIGs</button>
      </div>
      <div style="padding:14px;display:flex;flex-direction:column;gap:10px;">

        <!-- QUERY PHASE -->
        <div id="phaseQuery">
          <div class="card" style="margin-bottom:10px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
              <div style="display:flex;align-items:center;gap:8px;">
                <span id="filterTitle" style="font-weight:700;font-size:13px;">Filter Criteria</span>
                <span id="filterBadge" class="filter-badge" style="display:none;"></span>
                <span id="cacheBadge"  class="cache-badge"  style="display:none;"></span>
              </div>
              <div style="display:flex;gap:5px;">
                <button class="btn btn-ghost btn-sm" id="btnRefreshOpts" disabled>↺</button>
                <button class="btn btn-ghost btn-sm" id="btnClearFilters">✕ Clear All</button>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 12px;">
              <div style="margin-bottom:10px;"><label class="field-label">Work Order</label>
                <div style="position:relative;"><input type="text" id="woSearch" placeholder="Loading…" autocomplete="off" disabled><span class="dd-chevron">▾</span><span id="woPill" class="multi-pill" style="display:none;"></span><div id="woDrop" class="dropdown-list" style="display:none;"></div></div></div>
              <div style="margin-bottom:10px;"><label class="field-label">Purchase Order</label>
                <div style="position:relative;"><input type="text" id="poSearch" placeholder="Loading…" autocomplete="off" disabled><span class="dd-chevron">▾</span><span id="poPill" class="multi-pill" style="display:none;"></span><div id="poDrop" class="dropdown-list" style="display:none;"></div></div></div>
            </div>
            <div style="margin-bottom:10px;"><label class="field-label">Job Number</label>
              <div style="position:relative;"><input type="text" id="jobSearch" placeholder="Loading…" autocomplete="off" disabled><span class="dd-chevron">▾</span><span id="jobPill" class="multi-pill" style="display:none;"></span><div id="jobDrop" class="dropdown-list" style="display:none;"></div></div></div>
            <div id="gigTypeWrap" style="margin-bottom:10px;display:none;"><label class="field-label">GIG Type</label><select id="gigTypeFilter"><option value="">All Types</option></select></div>
            <div style="margin-bottom:10px;">
              <label class="field-label" id="dateLabel">Installation Date Range</label>
              <div style="display:grid;grid-template-columns:1fr 14px 1fr;gap:4px;align-items:center;">
                <input type="date" id="dateFrom"><span style="text-align:center;color:#94a3b8;font-size:11px;">–</span><input type="date" id="dateTo">
              </div>
              <div class="qd-strip">
                <button class="btn btn-ghost" data-days="7">Last 7 days</button>
                <button class="btn btn-ghost" data-days="30">30 days</button>
                <button class="btn btn-ghost" data-days="90">90 days</button>
                <button class="btn btn-ghost" id="qdClear" style="color:#dc2626;margin-left:auto;">✕</button>
              </div>
            </div>
            <div style="margin-bottom:12px;"><label class="field-label">Sort Order</label>
              <select id="sortOrder"><option value="desc">Newest First</option><option value="asc">Oldest First</option></select></div>
            <div style="margin-bottom:12px;">
              <label class="field-label">Spatial Filter</label>
              <div class="chip-group">
                <label class="chip active" id="spAll"><input type="radio" name="sp" value="none" checked> 🌐 All Features</label>
                <label class="chip" id="spScreen"><input type="radio" name="sp" value="screen"> 📺 Current Screen</label>
                <label class="chip" id="spDraw"><input type="radio" name="sp" value="draw"> ✏️ Draw Area</label>
              </div>
              <div id="drawPanel" class="draw-panel" style="display:none;">
                <div style="display:flex;gap:6px;">
                  <button id="btnDrawPoly" class="btn btn-cyan btn-sm" style="flex:1;">⬡ Polygon</button>
                  <button id="btnDrawFree" class="btn btn-violet btn-sm" style="flex:1;">〰 Freehand</button>
                  <button id="btnClearDraw" class="btn btn-ghost btn-sm">✕</button>
                </div>
                <div id="drawHint" class="draw-hint">Select a tool above to start drawing</div>
              </div>
            </div>
            <div style="display:flex;gap:8px;">
              <button id="btnQuery" class="btn btn-primary btn-full" disabled>🔍 Query Features</button>
              <button id="btnRefresh" class="btn btn-slate" style="padding:7px 14px;" disabled>↺</button>
            </div>
          </div>
          <div id="queryResults" class="card" style="display:none;border-color:#bfdbfe;background:#eff6ff;">
            <div style="font-weight:700;font-size:12px;color:#1d4ed8;margin-bottom:8px;">Query Results</div>
            <div id="resultsContent"></div>
            <button id="btnStart" class="btn btn-success btn-full" style="margin-top:10px;">Start Review →</button>
          </div>
        </div>

        <!-- REVIEW PHASE -->
        <div id="phaseReview" style="display:none;">
          <div class="card-inset" style="margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
              <span style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:.4px;">PROGRESS</span>
              <span id="progressText" style="font-size:11px;font-weight:700;color:#2563eb;">0 / 0</span>
            </div>
            <div class="pbar-track"><div id="progressBar" class="pbar-fill" style="width:0%;"></div></div>
            <div style="display:flex;justify-content:space-between;margin-top:5px;">
              <span id="progressStats" style="font-size:10px;color:#94a3b8;"></span>
              <span style="font-size:10px;color:#64748b;">⏱ <span id="featureTimer" style="font-weight:700;">0:00</span></span>
            </div>
          </div>
          <div class="card" style="margin-bottom:10px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
              <span id="featureCardLabel" style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.4px;">Current Feature</span>
              <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
                <span id="mkPendingPill" class="mk-pending-pill" style="display:none;">📎 Markup queued</span>
                <div id="attachmentsBar" style="display:none;">
                  <button id="btnAttachments" class="btn btn-ghost btn-sm btn-attach">🔍 Attachments <span id="attachCount" class="attach-badge"></span></button>
                </div>
                <button id="btnZoom" class="btn btn-cyan btn-sm">📍 Zoom</button>
              </div>
            </div>
            <div id="featureInfo" class="attr-grid"></div>
            <div id="gigCommentsBanner" style="display:none;margin-top:10px;padding:8px 10px;background:#faf5ff;border:1px solid #ddd6fe;border-radius:6px;">
              <div style="font-size:10px;font-weight:700;color:#6b21a8;margin-bottom:3px;text-transform:uppercase;letter-spacing:.4px;">Existing GIG Comments</div>
              <div id="gigCommentsText" style="font-size:11px;color:#4c1d95;line-height:1.5;"></div>
            </div>
          </div>
          <div class="card" style="margin-bottom:10px;">
            <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:10px;">QC Decision</div>
            <div id="newQcOpts">
              <label class="radio-card" id="rcPass"><input type="radio" name="qcDec" value="pass" id="radPass"><span class="rc-icon">✅</span><div style="flex:1;"><div class="rc-title" style="color:#15803d;">Pass</div><div class="rc-sub">Feature meets QC requirements</div></div><span class="kbd">P</span></label>
              <label class="radio-card" id="rcFail"><input type="radio" name="qcDec" value="fail" id="radFail"><span class="rc-icon">❌</span><div style="flex:1;"><div class="rc-title" style="color:#b91c1c;">Fail</div><div class="rc-sub">Issues requiring correction</div></div><span class="kbd">F</span></label>
              <label class="radio-card" id="rcPhoto"><input type="radio" name="qcDec" value="missing_photo" id="radPhoto"><span class="rc-icon">📷</span><div style="flex:1;"><div class="rc-title" style="color:#92400e;">Missing Photo</div><div class="rc-sub">Photo required but not attached</div></div><span class="kbd">M</span></label>
            </div>
            <div id="clearOpts" style="display:none;">
              <label class="radio-card" id="rcApprove"><input type="radio" name="clrDec" value="approve" id="radApprove"><span class="rc-icon">✅</span><div style="flex:1;"><div class="rc-title" style="color:#15803d;">Approve</div><div class="rc-sub">Fix verified — APPROVED + feature → QCCMPLT</div></div><span class="kbd">A</span></label>
              <label class="radio-card" id="rcReopen"><input type="radio" name="clrDec" value="reopen" id="radReopen"><span class="rc-icon">↩️</span><div style="flex:1;"><div class="rc-title" style="color:#b91c1c;">Re-open</div><div class="rc-sub">Fix insufficient — return to OPEN</div></div><span class="kbd">R</span></label>
            </div>
            <div id="photoSkipWrap" style="display:none;margin-top:10px;padding:10px 12px;background:#fffbeb;border:1.5px solid #fcd34d;border-radius:8px;">
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
                <input type="checkbox" id="chkSkipPhotos" style="accent-color:#d97706;width:15px;height:15px;flex-shrink:0;">
                <div>
                  <div style="font-size:12px;font-weight:700;color:#92400e;">Skip photo transfer</div>
                  <div style="font-size:10px;color:#b45309;margin-top:1px;">Approve without reviewing or transferring photos</div>
                </div>
              </label>
            </div>
            <div id="issueSection" style="display:none;margin-top:10px;">
              <label class="field-label">Issue Type(s) <span style="color:#dc2626;">*</span></label>
              <input type="text" id="issueSearch" placeholder="Search issue types…" style="margin-bottom:6px;">
              <div class="scroll-box" id="issueList"></div>
              <div style="font-size:10px;color:#94a3b8;margin-top:3px;">Select all that apply</div>
            </div>
            <div style="margin-top:12px;">
              <label class="field-label">Notes <span style="font-size:9px;color:#94a3b8;font-weight:400;text-transform:none;letter-spacing:0;">— saved to GIG <code style="font-size:9px;">comments</code> field</span></label>
              <textarea id="qcNotes" rows="2" placeholder="Additional comments…" style="resize:vertical;"></textarea>
            </div>
            <div style="display:flex;gap:8px;margin-top:12px;">
              <button id="btnSubmit" class="btn btn-success" style="flex:1;">Submit <span class="kbd" style="filter:invert(1);">↵</span></button>
              <button id="btnSkip" class="btn btn-amber" style="padding:7px 14px;">Skip <span class="kbd" style="filter:invert(1);">→</span></button>
            </div>
            <button id="btnPrev" class="btn btn-ghost btn-full" style="margin-top:6px;">← Previous <span class="kbd">←</span></button>
            <button id="btnEndSession" class="btn btn-ghost btn-full" style="margin-top:6px;color:#dc2626;border-color:#fecaca;">⏹ End Session Early</button>
          </div>
        </div>

        <!-- COMPLETE PHASE -->
        <div id="phaseComplete" style="display:none;">
          <div style="text-align:center;padding:18px 0 10px;">
            <div style="font-size:42px;">🎉</div>
            <div style="font-weight:700;font-size:15px;color:#15803d;margin-top:8px;">Session Complete</div>
            <div style="color:#64748b;font-size:12px;margin-top:3px;">All features reviewed</div>
          </div>
          <div id="sessionSummary" class="card" style="margin-bottom:10px;"></div>
          <div style="display:flex;gap:8px;">
            <button id="btnExport" class="btn btn-cyan" style="flex:1;">📄 Export Report</button>
            <button id="btnStartOver" class="btn btn-success" style="flex:1;">↺ New Session</button>
          </div>
        </div>

      </div>
      <div style="background:#fff;border-top:1px solid #e2e8f0;padding:7px 14px;border-radius:0 0 12px 12px;display:flex;align-items:center;gap:7px;position:sticky;bottom:0;">
        <div id="statusDot" style="width:7px;height:7px;border-radius:50%;background:#94a3b8;flex-shrink:0;transition:background .3s;"></div>
        <div id="statusMsg" style="font-size:11px;color:#64748b;flex:1;"></div>
      </div>
    `;
    document.body.appendChild(box);

    // ── Lightbox ──────────────────────────────────────────────────────
    const lb = document.createElement('div');
    lb.id = 'rqcwLightbox';
    lb.innerHTML = `
      <div class="lb-toolbar">
        <span id="lbCounter" class="lb-counter"></span>
        <span id="lbTitle" class="lb-title"></span>
        <div class="lb-zoom-btns">
          <button id="lbZoomIn">＋</button><button id="lbZoomOut">－</button>
          <button id="lbReset" style="font-size:11px;padding:4px 9px;">1:1</button>
          <button id="lbMkToggle" title="Markup tools (M)" style="background:rgba(255,255,255,.15);border:none;color:#fff;padding:4px 11px;border-radius:5px;cursor:pointer;font-size:14px;font-weight:700;">✏️</button>
        </div>
        <button class="lb-close" id="lbClose">×</button>
      </div>
      <div class="lb-stage grab" id="lbStage">
        <span class="lb-spinner" id="lbLoading">Loading…</span>
        <img id="lbImg" alt="Attachment">
        <canvas id="lbMkCanvas"></canvas>
        <div id="lbMkTextWrap"><input id="lbMkTextVal" type="text" placeholder="Type callout…"></div>
        <button class="lb-nav lb-prev" id="lbPrev">‹</button>
        <button class="lb-nav lb-next" id="lbNext">›</button>
      </div>
      <div id="lbMkBar">
        <button class="mk-btn sel" id="mkPen" title="Pen (P)">✏️</button>
        <button class="mk-btn" id="mkCircle" title="Circle (C)">⭕</button>
        <button class="mk-btn" id="mkArrow" title="Arrow (A)" style="font-size:16px;">↗</button>
        <button class="mk-btn" id="mkText" title="Text (T)" style="font-weight:700;font-size:14px;">T</button>
        <div class="mk-sep"></div>
        <input type="range" class="mk-lw" id="mkWidth" min="2" max="12" value="3">
        <div class="mk-sep"></div>
        <div class="mk-dot sel" data-c="#ff3b3b" style="background:#ff3b3b;"></div>
        <div class="mk-dot" data-c="#ffcc00" style="background:#ffcc00;"></div>
        <div class="mk-dot" data-c="#00cc55" style="background:#00cc55;"></div>
        <div class="mk-dot" data-c="#3b9fff" style="background:#3b9fff;"></div>
        <div class="mk-dot" data-c="#ffffff" style="background:#fff;"></div>
        <div class="mk-sep"></div>
        <button class="mk-btn" id="mkUndo" title="Undo (Ctrl+Z)">↩</button>
        <button class="mk-btn" id="mkClear" title="Clear all">🗑</button>
        <div class="mk-sep"></div>
        <button class="mk-queue" id="mkQueue" disabled>📎 Queue for GIG</button>
      </div>
      <div id="lbMkQueuedBadge" class="mk-queued-badge">✓ Markup queued for GIG</div>
      <div class="lb-hint" id="lbHint">Scroll to zoom · Drag to pan · ← → to navigate</div>
    `;
    document.body.appendChild(lb);

    // ── Photo Transfer Panel ──────────────────────────────────────────
    const pp = document.createElement('div');
    pp.id = 'rqcwPhotoPanel';
    pp.innerHTML = `
      <div class="pp-wrap">
        <div class="pp-hdr">
          <div>
            <div style="color:#fff;font-weight:700;font-size:15px;">📸 Photo Transfer Review</div>
            <div id="ppGigId" style="color:#93c5fd;font-size:11px;margin-top:2px;"></div>
          </div>
          <button id="ppClose" style="background:rgba(255,255,255,.15);border:none;color:#fff;width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;">×</button>
        </div>
        <div class="pp-body">
          <div>
            <div class="pp-col-hdr">
              <span>GIG Fix Photos</span>
              <span class="pp-col-badge" style="background:#dbeafe;color:#1d4ed8;">✓ = Transfer →</span>
            </div>
            <div id="ppLeft" class="pp-grid"></div>
          </div>
          <div>
            <div class="pp-col-hdr">
              <span>Original Feature Photos</span>
              <span class="pp-col-badge" style="background:#fee2e2;color:#b91c1c;">✓ = Delete</span>
            </div>
            <div id="ppRight" class="pp-grid"></div>
          </div>
        </div>
        <div class="pp-footer">
          <div style="flex:1;">
            <div id="ppSummary" class="pp-summary"></div>
            <div id="ppProg" class="pp-prog"><div id="ppProgFill" class="pp-prog-fill"></div></div>
          </div>
          <button id="ppCancel" class="pp-btn-cancel">Cancel</button>
          <button id="ppConfirm" class="pp-btn-confirm">Confirm Transfer &amp; Approve →</button>
        </div>
      </div>
    `;
    document.body.appendChild(pp);

    const $   = sel => box.querySelector(sel);
    const $lb = sel => lb.querySelector(sel);
    const $pp = sel => pp.querySelector(sel);

    // ── Drag-to-move ──────────────────────────────────────────────────
    {
      const hdr = $('#rqcwHeader');
      let drag = false, ox = 0, oy = 0;
      hdr.addEventListener('mousedown', e => {
        if (['btnHome','btnClose'].includes(e.target.id)) return;
        drag=true; const r=box.getBoundingClientRect(); ox=e.clientX-r.left; oy=e.clientY-r.top;
        box.style.right='auto'; box.style.left=r.left+'px'; box.style.top=r.top+'px';
        hdr.classList.add('dragging'); e.preventDefault();
      });
      document.addEventListener('mousemove', e => { if(!drag)return; box.style.left=Math.max(0,Math.min(e.clientX-ox,window.innerWidth-box.offsetWidth))+'px'; box.style.top=Math.max(0,Math.min(e.clientY-oy,window.innerHeight-box.offsetHeight))+'px'; });
      document.addEventListener('mouseup', () => { if(!drag)return; drag=false; hdr.classList.remove('dragging'); });
    }

    // ── Helpers ───────────────────────────────────────────────────────
    function setStatus(msg, type='idle') {
      $('#statusMsg').textContent=msg;
      $('#statusDot').style.background={idle:'#94a3b8',busy:'#f59e0b',ok:'#16a34a',error:'#dc2626'}[type]??'#94a3b8';
    }
    function setPhase(ph) {
      currentPhase=ph;
      $('#phaseQuery').style.display=ph==='query'?'block':'none';
      $('#phaseReview').style.display=ph==='review'?'block':'none';
      $('#phaseComplete').style.display=ph==='complete'?'block':'none';
    }
    function updateFilterBadge() {
      let n=0; if(selectedWOs.size)n++; if(selectedPOs.size)n++; if(selectedJobs.size)n++;
      if($('#gigTypeFilter').value)n++; if($('#dateFrom').value||$('#dateTo').value)n++; if(spatialMode!=='none')n++;
      const b=$('#filterBadge'); b.style.display=n?'inline-flex':'none'; b.textContent=n+(n===1?' filter':' filters');
    }
    function formatBytes(b) { if(!b)return''; if(b<1024)return b+' B'; if(b<1048576)return Math.round(b/1024)+' KB'; return(b/1048576).toFixed(1)+' MB'; }

    // Returns the correct REST endpoint URL for a layer, ensuring the layer
    // index is appended. This is needed because layer.url may point to the
    // FeatureServer root when the layer was added from a service definition.
    function layerEndpointUrl(lyr) {
      const base = lyr.url?.replace(/\/+$/, '');
      if (!base) return null;
      return base.endsWith('/' + lyr.layerId) ? base : `${base}/${lyr.layerId}`;
    }

    // ── Mode ──────────────────────────────────────────────────────────
    function applyMode(m) {
      mode=m;
      $('#tabNew').classList.toggle('active',m==='new_qc'); $('#tabClear').classList.toggle('active',m==='clear_review');
      $('#gigTypeWrap').style.display=m==='clear_review'?'block':'none';
      $('#dateLabel').textContent=m==='clear_review'?'GIG Date Range':'Installation Date Range';
      $('#filterTitle').textContent=m==='clear_review'?'Filter Cleared GIGs':'Filter Criteria';
      resetSession(false);
    }
    $('#tabNew').onclick=()=>applyMode('new_qc'); $('#tabClear').onclick=()=>applyMode('clear_review');

    // ── Init / cache ──────────────────────────────────────────────────
    async function init() { setStatus('Initializing…','busy'); try{await loadCachedOrFetch();}catch(e){setStatus('Init error: '+e.message,'error');console.error(e);} }

    async function loadCachedOrFetch(forceRefresh=false) {
      if(!forceRefresh){
        try{
          const raw=localStorage.getItem(OPTS_CACHE_KEY);
          if(raw){const c=JSON.parse(raw);if((Date.now()-c.ts)<OPTS_CACHE_TTL){applyFilterOptions(c);const age=Math.round((Date.now()-c.ts)/60000);$('#cacheBadge').style.display='inline-flex';$('#cacheBadge').textContent=`⚡ cached ${age<2?'just now':age<60?age+'m ago':Math.round(age/60)+'h ago'}`;setStatus('Ready — configure filters and query.','ok');$('#hdrSub').textContent='Configure filters to begin';return;}}
        }catch(_){}
      }
      $('#cacheBadge').style.display='none'; setStatus('Loading filter options…','busy');
      const data=await fetchFilterOptions();
      try{localStorage.setItem(OPTS_CACHE_KEY,JSON.stringify({ts:Date.now(),...data}));}catch(_){}
      applyFilterOptions(data); setStatus('Ready — configure filters and query.','ok'); $('#hdrSub').textContent='Configure filters to begin';
    }

    function applyFilterOptions(data) {
      gigTypes=data.gigTypes||[];
      const sel=$('#gigTypeFilter'); sel.innerHTML='<option value="">All Types</option>';
      gigTypes.forEach(gt=>{const o=document.createElement('option');o.value=gt.code;o.textContent=gt.name;sel.appendChild(o);});
      workOrderOptions=data.wo||[]; poOptions=data.po||[]; jobOptions=data.job||[];
      ['#woSearch','#poSearch','#jobSearch'].forEach(s=>{$(s).disabled=false;$(s).placeholder='Search…';});
      setupMultiDropdown('#woSearch','#woDrop','#woPill',workOrderOptions,selectedWOs,woNameMap);
      setupMultiDropdown('#poSearch','#poDrop','#poPill',poOptions,selectedPOs,poNameMap);
      setupMultiDropdown('#jobSearch','#jobDrop','#jobPill',jobOptions,selectedJobs,jobNameMap);
      $('#btnQuery').disabled=false; $('#btnRefreshOpts').disabled=false;
    }

    const woAcc=new Map(),poAcc=new Map(),jobAcc=new Map();
    async function fetchFilterOptions() {
      const [gigTypesData]=await Promise.all([
        (async()=>{const lyr=mapView.map.allLayers.find(l=>l.layerId===22100);if(!lyr)throw new Error('GIG layer (22100) not found');await lyr.load();const fld=lyr.fields.find(f=>f.name.toLowerCase()==='gig_type');if(!fld?.domain?.codedValues)throw new Error('gig_type domain not found');return fld.domain.codedValues.map(cv=>({code:cv.code,name:cv.name}));})(),
        (async()=>{const layers=mapView.map.allLayers.filter(l=>l.type==='feature'&&l.visible);await Promise.all(layers.items.map(async lyr=>{try{if(lyr===sketchLayer)return;await lyr.load();await Promise.all([{name:'workorder_id',map:woAcc},{name:'purchase_order_id',map:poAcc},{name:'job_number',map:jobAcc}].map(async({name,map})=>{const fld=lyr.fields.find(f=>f.name.toLowerCase()===name);if(!fld)return;const dom=new Map();if(fld.domain?.type==='coded-value')fld.domain.codedValues.forEach(cv=>dom.set(cv.code,cv.name));const q=lyr.createQuery();q.where='1=1';q.returnDistinctValues=true;q.outFields=[fld.name];q.returnGeometry=false;const res=await lyr.queryFeatures(q);res.features.forEach(f=>{const c=f.attributes[fld.name];if(c==null||c==='')return;map.set(c,dom.get(c)??c);});}));}catch(_){}}));})()])
      ;
      const toSorted=m=>Array.from(m.entries()).map(([code,name])=>({code,name})).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
      return{gigTypes:gigTypesData,wo:toSorted(woAcc),po:toSorted(poAcc),job:toSorted(jobAcc)};
    }

    // ── Multi-select dropdowns ────────────────────────────────────────
    function setupMultiDropdown(inputSel,dropSel,pillSel,options,selectedSet,nameMap) {
      const inp=$(inputSel),dd=$(dropSel),pill=$(pillSel);
      const syncDisplay=()=>{if(selectedSet.size===0){inp.value='';pill.style.display='none';}else if(selectedSet.size===1){inp.value=nameMap.get([...selectedSet][0])||'';pill.style.display='none';}else{inp.value='';pill.textContent=selectedSet.size+' selected';pill.style.display='inline-flex';}};
      const render=(filter='')=>{
        dd.innerHTML='';const lc=filter.toLowerCase();
        const hdr=document.createElement('div');hdr.className='dd-hdr';hdr.innerHTML=`<span class="dd-hdr-txt">${selectedSet.size?selectedSet.size+' selected':'None selected'}</span><button class="dd-hdr-clear">Clear all</button>`;
        hdr.querySelector('.dd-hdr-clear').onmousedown=e=>{e.preventDefault();selectedSet.clear();syncDisplay();updateFilterBadge();render(inp.value);};dd.appendChild(hdr);
        const hits=options.filter(o=>!lc||String(o.name).toLowerCase().includes(lc)||String(o.code).toLowerCase().includes(lc)).slice(0,80);
        if(!hits.length){const none=document.createElement('div');none.className='dd-item';none.style.color='#94a3b8';none.textContent='No matches';dd.appendChild(none);}
        else hits.forEach(o=>{const d=document.createElement('div');d.className='dd-check-row'+(selectedSet.has(o.code)?' is-checked':'');const cb=document.createElement('input');cb.type='checkbox';cb.checked=selectedSet.has(o.code);const lbl=document.createElement('span');lbl.textContent=o.name;d.appendChild(cb);d.appendChild(lbl);d.onmousedown=e=>{e.preventDefault();if(selectedSet.has(o.code))selectedSet.delete(o.code);else{selectedSet.add(o.code);nameMap.set(o.code,o.name);}syncDisplay();updateFilterBadge();render(inp.value);};dd.appendChild(d);});
      };
      inp.onfocus=()=>{inp.value='';pill.style.display='none';render('');dd.style.display='block';};
      inp.oninput=()=>{render(inp.value);dd.style.display='block';};
      inp.onblur=()=>setTimeout(()=>{dd.style.display='none';syncDisplay();},160);
      syncDisplay();
    }
    function refreshMultiDisplays() {
      [['#woSearch','#woPill',selectedWOs,woNameMap],['#poSearch','#poPill',selectedPOs,poNameMap],['#jobSearch','#jobPill',selectedJobs,jobNameMap]].forEach(([iS,pS,set,map])=>{const inp=$(iS),pill=$(pS);if(!inp)return;if(set.size===0){inp.value='';pill.style.display='none';}else if(set.size===1){inp.value=map.get([...set][0])||'';pill.style.display='none';}else{inp.value='';pill.textContent=set.size+' selected';pill.style.display='inline-flex';}});
    }

    // ── Date / filters ────────────────────────────────────────────────
    box.querySelectorAll('.qd-strip [data-days]').forEach(btn=>{btn.onclick=()=>{const d=parseInt(btn.dataset.days),to=new Date(),fr=new Date();fr.setDate(fr.getDate()-d);$('#dateTo').value=to.toISOString().split('T')[0];$('#dateFrom').value=fr.toISOString().split('T')[0];updateFilterBadge();};});
    $('#qdClear').onclick=()=>{$('#dateFrom').value='';$('#dateTo').value='';updateFilterBadge();};
    ['#dateFrom','#dateTo'].forEach(s=>$(s).onchange=updateFilterBadge);
    $('#gigTypeFilter').onchange=updateFilterBadge;

    // ── Spatial ───────────────────────────────────────────────────────
    function setSpatialMode(m){spatialMode=m;$('#spAll').className='chip'+(m==='none'?' active':'');$('#spScreen').className='chip'+(m==='screen'?' active':'');$('#spDraw').className='chip'+(m==='draw'?' active':'')+(m==='drawn'?' active-green':'');$('#drawPanel').style.display=(m==='draw'||m==='drawn')?'block':'none';updateFilterBadge();}
    box.querySelectorAll("input[name='sp']").forEach(radio=>{radio.closest('label').onclick=()=>{const v=radio.value;if(v==='draw'){setSpatialMode('draw');initSketch().catch(e=>setStatus('Sketch error: '+e.message,'error'));}else{if(sketchVM&&isDrawing)sketchVM.cancel();setSpatialMode(v);}};});
    function setDrawHint(state,msg){const el=$('#drawHint');el.className='draw-hint'+(state?' '+state:'');el.innerHTML=state==='drawing'?`<span class="pulse"></span>${msg}`:msg;}
    $('#btnDrawPoly').onclick=()=>startDraw('polygon','click');
    $('#btnDrawFree').onclick=()=>startDraw('polygon','freehand');
    $('#btnClearDraw').onclick=()=>{clearSketchGraphics();setSpatialMode('draw');setDrawHint('','Select a tool above to start drawing');};

    async function initSketch(){
      if(sketchVM)return; setStatus('Loading sketch tools…','busy');
      const [GL,SVM]=await Promise.all([loadModule('esri/layers/GraphicsLayer'),loadModule('esri/widgets/Sketch/SketchViewModel')]);
      sketchLayer=new GL({listMode:'hide',title:'QC Selection Area'});mapView.map.add(sketchLayer);
      sketchVM=new SVM({view:mapView,layer:sketchLayer,updateOnGraphicClick:false,polygonSymbol:{type:'simple-fill',color:[37,99,235,0.07],outline:{type:'simple-line',color:[37,99,235,0.85],width:2,style:'dash'}}});
      sketchVM.on('create',async e=>{
        if(e.state==='start'){isDrawing=true;setDrawHint('drawing','Drawing…');}
        else if(e.state==='complete'){isDrawing=false;let geom=e.graphic.geometry;if(geom&&mapView.spatialReference&&!geom.spatialReference?.wkid)geom=Object.assign(Object.create(Object.getPrototypeOf(geom)),geom,{spatialReference:mapView.spatialReference});try{const ge=await loadModule('esri/geometry/geometryEngine');const s=ge.simplify(geom);if(s)geom=s;}catch(_){}drawnGeometry=geom;setSpatialMode('drawn');setDrawHint('done','✓ Area selected — run query to apply');setStatus('Drawn area ready','ok');}
        else if(e.state==='cancel'){isDrawing=false;setDrawHint('','Drawing cancelled — select a tool to try again');}
      });
      setStatus('Sketch ready','ok');setDrawHint('','Select a tool above to start drawing');
    }
    function startDraw(tool,drawMode){if(!sketchVM){initSketch().then(()=>sketchVM.create(tool,{mode:drawMode})).catch(console.error);return;}if(isDrawing)sketchVM.cancel();clearSketchGraphics();sketchVM.create(tool,{mode:drawMode});setDrawHint('drawing',drawMode==='freehand'?'Hold and drag to draw a freehand area':'Click to place vertices — double-click to finish');}
    function clearSketchGraphics(){if(sketchLayer)sketchLayer.removeAll();drawnGeometry=null;}
    function applySpatialFilter(q){if(spatialMode==='screen'){q.geometry=mapView.extent;q.spatialRelationship='intersects';}else if(spatialMode==='drawn'&&drawnGeometry){q.geometry=drawnGeometry;q.spatialRelationship='intersects';}}
    function getCandidateLayers(){const s=spatialMode==='screen'||spatialMode==='drawn';return s?mapView.map.allLayers.filter(l=>l.type==='feature'):mapView.map.allLayers.filter(l=>l.type==='feature'&&l.visible);}
    function inClause(field,set){if(!set.size)return null;const v=[...set].map(c=>`'${String(c).replace(/'/g,"''")}'`).join(',');return set.size===1?`${field} = ${v}`:`${field} IN (${v})`;}

    // ── Queries ───────────────────────────────────────────────────────
    async function runQuery(){
      try{setStatus('Querying…','busy');$('#btnQuery').disabled=true;if(sketchVM&&isDrawing){sketchVM.cancel();isDrawing=false;}mode==='new_qc'?await queryNewFeatures():await queryClearedGigs();$('#btnRefresh').disabled=false;}
      catch(e){setStatus('Query error: '+e.message,'error');alert('Query error:\n'+e.message);}
      finally{$('#btnQuery').disabled=false;}
    }
    async function queryNewFeatures(){
      const clauses=["workflow_stage = 'OSP_CONST'","workflow_status = 'CMPLT'"];
      [inClause('workorder_id',selectedWOs),inClause('purchase_order_id',selectedPOs),inClause('job_number',selectedJobs)].forEach(c=>c&&clauses.push(c));
      const df=$('#dateFrom').value,dt=$('#dateTo').value;if(df)clauses.push(`installation_date >= ${new Date(df).getTime()}`);if(dt)clauses.push(`installation_date <= ${new Date(dt+'T23:59:59').getTime()}`);
      const where=clauses.join(' AND '),sort=$('#sortOrder').value;
      qcQueue=[];const counts={},errs=[];
      for(const lyr of getCandidateLayers().items){
        try{if(lyr===sketchLayer)continue;await lyr.load();if(!['workflow_stage','workflow_status','gis_id'].every(fn=>lyr.fields.some(f=>f.name.toLowerCase()===fn)))continue;const q=lyr.createQuery();q.where=where;q.outFields=['*'];q.returnGeometry=true;applySpatialFilter(q);try{q.orderByFields=[`installation_date ${sort.toUpperCase()}`];}catch(_){}const res=await lyr.queryFeatures(q);if(res.features.length){counts[lyr.title]=res.features.length;res.features.forEach(f=>{const gisId=f.attributes.gis_id||f.attributes.GIS_ID||f.attributes.gisid||'Unknown';qcQueue.push({layer:lyr,feature:f,gisId,type:'new_qc'});});}}catch(_){errs.push(lyr.title);}
      }
      qcQueue.sort((a,b)=>{const da=a.feature.attributes.installation_date||0,db=b.feature.attributes.installation_date||0;return sort==='desc'?db-da:da-db;});showQueryResults(counts,errs);
    }
    async function queryClearedGigs(){
      const gigLyr=mapView.map.allLayers.find(l=>l.layerId===22100);if(!gigLyr)throw new Error('GIG layer (22100) not found');await gigLyr.load();
      const clauses=["gig_status = 'CLEAR'"];
      [inClause('workorder_id',selectedWOs),inClause('purchase_order_id',selectedPOs),inClause('job_number',selectedJobs)].forEach(c=>c&&clauses.push(c));
      const gt=$('#gigTypeFilter').value;if(gt)clauses.push(`gig_type = '${gt.replace(/'/g,"''")}'`);
      const df=$('#dateFrom').value,dt=$('#dateTo').value;if(df)clauses.push(`created_date >= ${new Date(df).getTime()}`);if(dt)clauses.push(`created_date <= ${new Date(dt+'T23:59:59').getTime()}`);
      const sort=$('#sortOrder').value,q=gigLyr.createQuery();q.where=clauses.join(' AND ');q.outFields=['*'];q.returnGeometry=true;applySpatialFilter(q);try{q.orderByFields=[`created_date ${sort.toUpperCase()}`];}catch(_){}
      const res=await gigLyr.queryFeatures(q);
      qcQueue=res.features.map(f=>{const a=f.attributes;return{layer:gigLyr,feature:f,gisId:a.billing_area_code||'Unknown',gigTypeName:gigTypes.find(gt=>gt.code==a.gig_type)?.name??(a.gig_type||'Unknown'),type:'clear_review'};});
      showQueryResults(qcQueue.length?{[gigLyr.title]:qcQueue.length}:{},[]);
    }
    function showQueryResults(counts,errs){
      const cont=$('#resultsContent'),res=$('#queryResults');
      if(!qcQueue.length){cont.innerHTML=`<div style="text-align:center;padding:10px;color:#64748b;">No features found — try adjusting your filters.</div>${errs.length?`<div style="font-size:11px;color:#dc2626;margin-top:6px;">⚠ ${errs.length} layer(s) had errors: ${errs.join(', ')}</div>`:''}`;res.style.display='block';$('#btnStart').style.display='none';setStatus('No features found','idle');return;}
      const sn=spatialMode==='screen'?' <span style="font-size:10px;color:#0891b2;">📺 screen</span>':spatialMode==='drawn'?' <span style="font-size:10px;color:#2563eb;">✏️ drawn area</span>':'';
      const total=qcQueue.length,multiLayer=Object.keys(counts).length>1;
      let rows='';
      Object.entries(counts).forEach(([n,c])=>{
        rows+=`<label style="display:flex;align-items:center;gap:9px;padding:6px 2px;border-bottom:1px solid #e8f0fe;cursor:pointer;user-select:none;">
          <input type="checkbox" class="layer-include" data-layer="${n.replace(/"/g,'&quot;')}" checked
            style="accent-color:#2563eb;width:14px;height:14px;flex-shrink:0;cursor:pointer;">
          <span style="flex:1;font-size:11px;">${n}</span>
          <strong style="font-size:12px;color:#1d4ed8;">${c}</strong>
        </label>`;
      });
      cont.innerHTML=`
        <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px;">
          <div id="qrHeadline" style="font-weight:700;font-size:13px;color:#1d4ed8;">${total} feature${total!==1?'s':''} ready${sn}</div>
          ${multiLayer?`<button id="qrToggleAll" style="background:none;border:none;font-size:10px;color:#2563eb;cursor:pointer;font-weight:700;padding:0;">Deselect all</button>`:''}
        </div>
        <div>${rows}</div>
        ${errs.length?`<div style="font-size:10px;color:#92400e;margin-top:6px;padding:4px 8px;background:#fffbeb;border-radius:4px;">⚠ ${errs.length} layer(s) skipped</div>`:''}
      `;
      res.style.display='block';$('#btnStart').style.display='block';
      setStatus(`${total} feature${total!==1?'s':''} ready`,'ok');

      const syncBtn=()=>{
        const checks=[...cont.querySelectorAll('.layer-include')];
        const checkedNames=new Set(checks.filter(cb=>cb.checked).map(cb=>cb.dataset.layer));
        const sel=qcQueue.filter(item=>checkedNames.has(item.layer.title)).length;
        const none=!checkedNames.size,all=checks.length===checkedNames.size;
        const hl=$('#qrHeadline');
        if(hl)hl.innerHTML=all?`${total} feature${total!==1?'s':''} ready${sn}`:`<span style="color:#2563eb;">${sel}</span> <span style="color:#94a3b8;font-size:11px;">of ${total} selected</span>${sn}`;
        const btn=$('#btnStart');
        btn.disabled=none;
        btn.textContent=none?'Select at least one layer →':all?'Start Review →':`Start Review → (${sel})`;
        const tog=$('#qrToggleAll');
        if(tog)tog.textContent=all?'Deselect all':'Select all';
      };
      cont.querySelectorAll('.layer-include').forEach(cb=>cb.addEventListener('change',syncBtn));
      const tog=$('#qrToggleAll');
      if(tog)tog.onclick=()=>{const cbs=[...cont.querySelectorAll('.layer-include')],all=cbs.every(cb=>cb.checked);cbs.forEach(cb=>cb.checked=!all);syncBtn();};
    }

    // ── Review session ────────────────────────────────────────────────
    function startReview(){
      if(!qcQueue.length){alert('No features to review');return;}
      // Filter out layers the user unchecked in the results panel
      const checks=[...(($('#resultsContent')?.querySelectorAll('.layer-include'))??[])];
      if(checks.length){
        const excluded=new Set(checks.filter(cb=>!cb.checked).map(cb=>cb.dataset.layer));
        if(excluded.size){qcQueue=qcQueue.filter(item=>!excluded.has(item.layer.title));if(!qcQueue.length){alert('No features remain after exclusions.');return;}}
      }
      currentIndex=0;sessionLog=[];sessionStartTime=new Date();setPhase('review');wireDecisionForm();showFeature();
    }

    function wireDecisionForm(){
      const isNew=mode==='new_qc';
      $('#newQcOpts').style.display=isNew?'block':'none';$('#clearOpts').style.display=isNew?'none':'block';
      $('#photoSkipWrap').style.display=isNew?'none':'block';
      $('#chkSkipPhotos').checked=false;
      $('#featureCardLabel').textContent=isNew?'Current Feature':'Cleared GIG';
      if(isNew){
        const sync=()=>{const v=box.querySelector("input[name='qcDec']:checked")?.value;$('#rcPass').className='radio-card'+(v==='pass'?' sel-pass':'');$('#rcFail').className='radio-card'+(v==='fail'?' sel-fail':'');$('#rcPhoto').className='radio-card'+(v==='missing_photo'?' sel-photo':'');$('#issueSection').style.display=v==='fail'?'block':'none';};
        ['#radPass','#radFail','#radPhoto'].forEach(s=>$(s).onchange=sync);setupIssueTypes();
      }else{
        const sync=()=>{const v=box.querySelector("input[name='clrDec']:checked")?.value;$('#rcApprove').className='radio-card'+(v==='approve'?' sel-approve':'');$('#rcReopen').className='radio-card'+(v==='reopen'?' sel-reopen':'');};
        $('#radApprove').onchange=sync;$('#radReopen').onchange=sync;
      }
    }

    function setupIssueTypes(){
      const inp=$('#issueSearch'),list=$('#issueList');
      const makeItem=gt=>{const lbl=document.createElement('label');lbl.className='check-item';lbl.innerHTML=`<input type="checkbox" class="issueCheck" data-code="${gt.code}" data-name="${gt.name}"><span style="font-size:11px;">${gt.name}</span>`;list.appendChild(lbl);};
      const makeSep=(label,color='#94a3b8',border=false)=>{const d=document.createElement('div');d.style.cssText=`font-size:10px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:.4px;padding:5px 6px 3px;${border?'border-top:1px solid #f1f5f9;margin-top:3px;':''}`;d.textContent=label;list.appendChild(d);};
      const render=(filter='')=>{list.innerHTML='';const lc=filter.toLowerCase();const hits=gigTypes.filter(gt=>gt.name.toLowerCase().includes(lc)||String(gt.code).toLowerCase().includes(lc));if(!hits.length){list.innerHTML='<div style="padding:8px;color:#94a3b8;font-size:11px;text-align:center;">No matches</div>';return;}if(!lc&&recentGigTypes.length){const rc=new Set(recentGigTypes.map(r=>String(r.code)));const recent=hits.filter(gt=>rc.has(String(gt.code))),rest=hits.filter(gt=>!rc.has(String(gt.code)));if(recent.length){makeSep('★ Recently Used','#0891b2');recent.forEach(makeItem);}if(rest.length){makeSep('All Types','#94a3b8',recent.length>0);rest.forEach(makeItem);}}else hits.forEach(makeItem);};
      render();inp.oninput=()=>render(inp.value);
    }

    function showFeature(){
      if(currentIndex>=qcQueue.length){completeSession();return;}
      const item=qcQueue[currentIndex];
      const pct=((currentIndex+1)/qcQueue.length)*100;
      $('#progressBar').style.width=pct+'%';$('#progressText').textContent=`${currentIndex+1} / ${qcQueue.length}`;
      const rev=sessionLog.filter(e=>e.action==='qc_review'&&e.success),pc=rev.filter(e=>e.decision==='Pass'||e.decision==='Approve').length,sk=sessionLog.filter(e=>e.action==='skip').length;
      $('#progressStats').textContent=rev.length?`${pc} ✓  ${rev.length-pc} ✗${sk?'  '+sk+' skipped':''}` : '';
      $('#hdrSub').textContent=mode==='new_qc'?`New QC · ${item.layer.title}`:`Clear Review · GIS ${item.gisId}`;
      renderFeatureInfo(item);resetForm();startTimer();
      $('#btnPrev').disabled=currentIndex===0;
      showPopup(item).then(()=>loadAttachments(item)).catch(()=>{});
      setStatus(`Reviewing ${currentIndex+1} of ${qcQueue.length}`,'busy');
    }

    function renderFeatureInfo(item){
      const a=item.feature.attributes,isNew=item.type==='new_qc',rows=[];
      if(isNew){rows.push(['GIS ID',item.gisId],['Layer',item.layer.title],['Work Order',a.workorder_id||'N/A']);if(a.job_number)rows.push(['Job Number',a.job_number]);if(a.purchase_order_id)rows.push(['Purchase Order',a.purchase_order_id]);if(a.installation_date)rows.push(['Install Date',new Date(a.installation_date).toLocaleDateString()]);if(a.supervisor)rows.push(['Supervisor',a.supervisor]);if(a.crew)rows.push(['Crew',a.crew]);}
      else{rows.push(['Origin GlobalID',item.gisId],['GIG Type',item.gigTypeName],['Work Order',a.workorder_id||'N/A']);if(a.job_number)rows.push(['Job Number',a.job_number]);if(a.purchase_order_id)rows.push(['Purchase Order',a.purchase_order_id]);if(a.created_date)rows.push(['Created',new Date(a.created_date).toLocaleDateString()]);rows.push(['GIG Status',a.gig_status||'N/A']);}
      $('#featureInfo').innerHTML=rows.map(([k,v])=>`<span class="attr-key">${k}:</span><span class="attr-val">${v}</span>`).join('');
      const banner=$('#gigCommentsBanner');if(!isNew&&a.comments){banner.style.display='block';$('#gigCommentsText').textContent=a.comments;}else banner.style.display='none';
    }

    function resetForm(){
      box.querySelectorAll("input[name='qcDec'],input[name='clrDec']").forEach(r=>r.checked=false);
      box.querySelectorAll('.radio-card').forEach(rc=>rc.className='radio-card');
      $('#issueSection').style.display='none';$('#qcNotes').value='';$('#attachmentsBar').style.display='none';
      $('#chkSkipPhotos').checked=false;
      pendingGigAttachment=null;$('#mkPendingPill').style.display='none';
    }

    const startTimer=()=>{stopTimer();featureStartTime=new Date();timerInterval=setInterval(()=>{const s=Math.floor((new Date()-featureStartTime)/1000);$('#featureTimer').textContent=`${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;},1000);};
    const stopTimer=()=>{if(timerInterval){clearInterval(timerInterval);timerInterval=null;}};
    const elapsed=()=>featureStartTime?Math.floor((new Date()-featureStartTime)/1000):0;

    // ── Map helpers ───────────────────────────────────────────────────
    const zoomToFeature=()=>mapView.goTo({target:qcQueue[currentIndex].feature.geometry,scale:Math.min(mapView.scale,2000)}).catch(console.error);
    async function showPopup(item){try{if(highlightHandle){highlightHandle.remove();highlightHandle=null;}const oid=item.feature.attributes[item.layer.objectIdField];const qr=await item.layer.queryFeatures({where:`${item.layer.objectIdField} = ${oid}`,outFields:['*'],returnGeometry:true});const feat=qr.features[0]||item.feature;mapView.whenLayerView(item.layer).then(lv=>{highlightHandle=lv.highlight(oid);}).catch(()=>{});mapView.popup.open({features:[feat],location:popupLoc(feat.geometry),updateLocationEnabled:false});}catch(e){console.error('Popup:',e);}}
    function popupLoc(g){try{if(g.type==='point')return g;if(g.type==='polyline'&&g.paths?.[0]){const p=g.paths[0],m=Math.floor(p.length/2);return{type:'point',x:p[m][0],y:p[m][1],spatialReference:g.spatialReference};}return g.centroid||g.extent?.center||g;}catch(_){return g;}}
    function gigLayerRef(){const l=mapView.map.allLayers.find(l=>l.layerId===22100);if(!l)throw new Error('GIG layer (22100) not found');return l;}
    function gigPointGeom(g){if(g.type==='point')return g;if(g.type==='polyline'&&g.paths?.[0]?.length>1){const path=g.paths[0];let total=0;const segs=path.slice(0,-1).map((pt,i)=>{const dx=path[i+1][0]-pt[0],dy=path[i+1][1]-pt[1],len=Math.sqrt(dx*dx+dy*dy);total+=len;return{x1:pt[0],y1:pt[1],x2:path[i+1][0],y2:path[i+1][1],len,cum:total};});let prev=0,target=total/2;for(const s of segs){if(s.cum>=target){const t=(target-prev)/s.len;return{type:'point',x:s.x1+(s.x2-s.x1)*t,y:s.y1+(s.y2-s.y1)*t,spatialReference:g.spatialReference};}prev=s.cum;}}if(g.type==='polygon')return g.centroid||g.extent?.center;return g.extent?.center||g;}
    function buildGigAttrs(src,gigType,gigStatus,comments){const a=src.attributes;return{billing_area_code:a.globalid,client_code:a.client_code,project_id:a.project_id,job_number:a.job_number,purchase_order_id:a.purchase_order_id,workorder_id:a.workorder_id,workflow_stage:a.workflow_stage,workflow_status:a.workflow_status,supervisor:a.supervisor,crew:a.crew,construction_subcontractor:a.construction_subcontractor,gig_type:gigType,gig_status:gigStatus,comments:comments||null};}

    // ── Attachments ───────────────────────────────────────────────────
    async function loadAttachments(item){
      $('#attachmentsBar').style.display='none';
      try{const lyr=item.layer;await lyr.load();if(!lyr.capabilities?.operations?.supportsQueryAttachments&&!lyr.hasAttachments)return;const oid=item.feature.attributes[lyr.objectIdField];const res=await lyr.queryAttachments({objectIds:[oid]});const atts=(res[oid]||[]).filter(a=>a.contentType?.startsWith('image/'));if(!atts.length)return;$('#attachmentsBar').style.display='block';$('#attachCount').textContent=atts.length;$('#btnAttachments').onclick=()=>openLightbox(atts);}catch(e){console.warn('Attachments:',e);}
    }

    // ── Lightbox ──────────────────────────────────────────────────────
    function applyLbTransform(){$lb('#lbImg').style.transform=`translate(${lbPan.x}px,${lbPan.y}px) scale(${lbScale})`;}
    function openLightbox(atts){lbImages=atts;lbIdx=0;lbScale=1;lbPan={x:0,y:0};lb.classList.add('open');showLbImage();}
    function closeLightbox(){if(mkActive)deactivateMarkup();lb.classList.remove('open');$lb('#lbImg').src='';}
    function showLbImage(){
      const img=$lb('#lbImg'),att=lbImages[lbIdx];lbScale=1;lbPan={x:0,y:0};applyLbTransform();img.style.display='none';$lb('#lbLoading').style.display='block';
      img.onload=()=>{$lb('#lbLoading').style.display='none';img.style.display='block';if(mkActive)resizeMkCanvas();};img.onerror=()=>{$lb('#lbLoading').textContent='⚠ Could not load image';};img.src=att.url;
      $lb('#lbCounter').textContent=`${lbIdx+1} / ${lbImages.length}`;$lb('#lbTitle').textContent=att.name||'';
      $lb('#lbPrev').style.display=lbImages.length>1?'flex':'none';$lb('#lbNext').style.display=lbImages.length>1?'flex':'none';
      mkStrokes=[];mkCurrent=null;if(mkCtx)mkCtx.clearRect(0,0,mkCanvas?.width||0,mkCanvas?.height||0);resetMkQueueBtn();
    }
    function lbZoom(f){lbScale=Math.min(10,Math.max(0.25,lbScale*f));applyLbTransform();}
    const lbStage=$lb('#lbStage');
    lbStage.addEventListener('wheel',e=>{if(mkActive)return;e.preventDefault();lbZoom(e.deltaY<0?1.15:0.87);},{passive:false});
    lbStage.addEventListener('mousedown',e=>{if(mkActive||e.button!==0)return;lbDragging=true;lbDragStart={x:e.clientX,y:e.clientY};lbPanStart={...lbPan};lbStage.classList.replace('grab','grabbing');e.preventDefault();});
    document.addEventListener('mousemove',e=>{if(!lbDragging)return;lbPan={x:lbPanStart.x+(e.clientX-lbDragStart.x),y:lbPanStart.y+(e.clientY-lbDragStart.y)};applyLbTransform();});
    document.addEventListener('mouseup',()=>{if(!lbDragging)return;lbDragging=false;lbStage.classList.replace('grabbing','grab');});
    let lbLastDist=null;
    lbStage.addEventListener('touchstart',e=>{if(e.touches.length===2)lbLastDist=null;},{passive:true});
    lbStage.addEventListener('touchmove',e=>{if(mkActive||e.touches.length!==2)return;e.preventDefault();const dx=e.touches[0].clientX-e.touches[1].clientX,dy=e.touches[0].clientY-e.touches[1].clientY,dist=Math.sqrt(dx*dx+dy*dy);if(lbLastDist!==null)lbZoom(dist/lbLastDist);lbLastDist=dist;},{passive:false});
    $lb('#lbClose').onclick=closeLightbox;$lb('#lbZoomIn').onclick=()=>lbZoom(1.3);$lb('#lbZoomOut').onclick=()=>lbZoom(0.77);$lb('#lbReset').onclick=()=>{lbScale=1;lbPan={x:0,y:0};applyLbTransform();};$lb('#lbPrev').onclick=()=>{lbIdx=(lbIdx-1+lbImages.length)%lbImages.length;showLbImage();};$lb('#lbNext').onclick=()=>{lbIdx=(lbIdx+1)%lbImages.length;showLbImage();};

    // ── Markup ────────────────────────────────────────────────────────
    mkCanvas=$lb('#lbMkCanvas');mkCtx=mkCanvas.getContext('2d');
    function activateMarkup(){mkActive=true;lbScale=1;lbPan={x:0,y:0};applyLbTransform();resizeMkCanvas();mkCanvas.style.display='block';$lb('#lbMkBar').classList.add('open');$lb('#lbMkToggle').classList.add('on');$lb('#lbHint').style.opacity='0';lbStage.style.cursor='crosshair';}
    function deactivateMarkup(){mkActive=false;mkCanvas.style.display='none';$lb('#lbMkBar').classList.remove('open');$lb('#lbMkToggle').classList.remove('on');$lb('#lbMkTextWrap').style.display='none';$lb('#lbHint').style.opacity='1';lbStage.style.cursor='';}
    $lb('#lbMkToggle').onclick=()=>mkActive?deactivateMarkup():activateMarkup();
    function resizeMkCanvas(){const img=$lb('#lbImg');if(!img||img.style.display==='none')return;const stR=lbStage.getBoundingClientRect(),imgR=img.getBoundingClientRect();const w=Math.round(imgR.width),h=Math.round(imgR.height);if(!w||!h)return;mkCanvas.width=w;mkCanvas.height=h;mkCanvas.style.width=w+'px';mkCanvas.style.height=h+'px';mkCanvas.style.left=Math.round(imgR.left-stR.left)+'px';mkCanvas.style.top=Math.round(imgR.top-stR.top)+'px';redrawMk();}
    function mkCanvasPos(e){const r=mkCanvas.getBoundingClientRect(),src=e.touches?e.touches[0]:e;return{x:src.clientX-r.left,y:src.clientY-r.top};}
    mkCanvas.addEventListener('mousedown',onMkDown);mkCanvas.addEventListener('mousemove',onMkMove);mkCanvas.addEventListener('mouseup',onMkUp);mkCanvas.addEventListener('mouseleave',onMkUp);
    mkCanvas.addEventListener('touchstart',e=>{e.preventDefault();onMkDown(e.touches[0]);},{passive:false});
    mkCanvas.addEventListener('touchmove',e=>{e.preventDefault();onMkMove(e.touches[0]);},{passive:false});
    mkCanvas.addEventListener('touchend',e=>{e.preventDefault();onMkUp();},{passive:false});
    function onMkDown(e){if(!mkActive)return;const pos=mkCanvasPos(e);if(mkTool==='text'){const stR=lbStage.getBoundingClientRect(),mkR=mkCanvas.getBoundingClientRect(),tw=$lb('#lbMkTextWrap');tw.style.left=Math.min(mkR.left-stR.left+pos.x,stR.width-200)+'px';tw.style.top=Math.max(mkR.top-stR.top+pos.y-44,4)+'px';tw.style.display='block';tw.dataset.x=pos.x;tw.dataset.y=pos.y;setTimeout(()=>$lb('#lbMkTextVal').focus(),0);return;}mkDrawing=true;if(mkTool==='pen')mkCurrent={type:'pen',color:mkColor,width:mkWidth,points:[pos]};else mkCurrent={type:mkTool,color:mkColor,width:mkWidth,x1:pos.x,y1:pos.y,x2:pos.x,y2:pos.y};}
    function onMkMove(e){if(!mkActive||!mkDrawing||!mkCurrent)return;const pos=mkCanvasPos(e);if(mkTool==='pen')mkCurrent.points.push(pos);else{mkCurrent.x2=pos.x;mkCurrent.y2=pos.y;}redrawMk();}
    function onMkUp(){if(!mkDrawing||!mkCurrent)return;mkDrawing=false;const ok=mkTool==='pen'?mkCurrent.points.length>=2:Math.hypot(mkCurrent.x2-mkCurrent.x1,mkCurrent.y2-mkCurrent.y1)>4;if(ok){mkStrokes.push(mkCurrent);redrawMk();updateMkQueueBtn();}mkCurrent=null;}
    $lb('#lbMkTextVal').addEventListener('keydown',e=>{if(e.key==='Enter')commitMkText();if(e.key==='Escape'){$lb('#lbMkTextWrap').style.display='none';}e.stopPropagation();});
    $lb('#lbMkTextVal').addEventListener('blur',()=>setTimeout(commitMkText,150));
    function commitMkText(){const tw=$lb('#lbMkTextWrap');if(tw.style.display==='none')return;const txt=$lb('#lbMkTextVal').value.trim();if(txt){mkStrokes.push({type:'text',color:mkColor,width:mkWidth,x:parseFloat(tw.dataset.x),y:parseFloat(tw.dataset.y),text:txt});redrawMk();updateMkQueueBtn();}tw.style.display='none';}
    function redrawMk(){mkCtx.clearRect(0,0,mkCanvas.width,mkCanvas.height);mkStrokes.forEach(drawMkStroke);if(mkCurrent)drawMkStroke(mkCurrent);}
    function drawMkStroke(s){const ctx=mkCtx;ctx.save();ctx.strokeStyle=s.color;ctx.fillStyle=s.color;ctx.lineWidth=s.width;ctx.lineCap='round';ctx.lineJoin='round';switch(s.type){case'pen':if(s.points.length<2){ctx.beginPath();ctx.arc(s.points[0].x,s.points[0].y,s.width/2,0,Math.PI*2);ctx.fill();}else{ctx.beginPath();ctx.moveTo(s.points[0].x,s.points[0].y);for(let i=1;i<s.points.length-1;i++){const mx=(s.points[i].x+s.points[i+1].x)/2,my=(s.points[i].y+s.points[i+1].y)/2;ctx.quadraticCurveTo(s.points[i].x,s.points[i].y,mx,my);}ctx.lineTo(s.points[s.points.length-1].x,s.points[s.points.length-1].y);ctx.stroke();}break;case'circle':{const rx=Math.abs(s.x2-s.x1)/2,ry=Math.abs(s.y2-s.y1)/2,cx=(s.x1+s.x2)/2,cy=(s.y1+s.y2)/2;ctx.beginPath();ctx.ellipse(cx,cy,Math.max(rx,1),Math.max(ry,1),0,0,Math.PI*2);ctx.stroke();break;}case'arrow':{const hl=Math.max(12,s.width*4),ang=Math.atan2(s.y2-s.y1,s.x2-s.x1);ctx.beginPath();ctx.moveTo(s.x1,s.y1);ctx.lineTo(s.x2,s.y2);ctx.stroke();ctx.beginPath();ctx.moveTo(s.x2,s.y2);ctx.lineTo(s.x2-hl*Math.cos(ang-Math.PI/6),s.y2-hl*Math.sin(ang-Math.PI/6));ctx.lineTo(s.x2-hl*Math.cos(ang+Math.PI/6),s.y2-hl*Math.sin(ang+Math.PI/6));ctx.closePath();ctx.fill();break;}case'text':{const fs=Math.max(14,s.width*5);ctx.font=`bold ${fs}px sans-serif`;ctx.strokeStyle='rgba(0,0,0,.65)';ctx.lineWidth=s.width*2.5;ctx.strokeText(s.text,s.x,s.y);ctx.fillStyle=s.color;ctx.fillText(s.text,s.x,s.y);break;}}ctx.restore();}
    function setMkTool(t){mkTool=t;['mkPen','mkCircle','mkArrow','mkText'].forEach(id=>$lb('#'+id).classList.toggle('sel',id==='mk'+t.charAt(0).toUpperCase()+t.slice(1)));mkCanvas.style.cursor=t==='text'?'text':'crosshair';}
    $lb('#mkPen').onclick=()=>setMkTool('pen');$lb('#mkCircle').onclick=()=>setMkTool('circle');$lb('#mkArrow').onclick=()=>setMkTool('arrow');$lb('#mkText').onclick=()=>setMkTool('text');$lb('#mkWidth').oninput=e=>{mkWidth=parseInt(e.target.value);};
    lb.querySelectorAll('.mk-dot').forEach(d=>{d.onclick=()=>{mkColor=d.dataset.c;lb.querySelectorAll('.mk-dot').forEach(x=>x.classList.remove('sel'));d.classList.add('sel');};});
    $lb('#mkUndo').onclick=()=>{if(mkStrokes.length){mkStrokes.pop();redrawMk();updateMkQueueBtn();}};$lb('#mkClear').onclick=()=>{mkStrokes=[];mkCurrent=null;redrawMk();updateMkQueueBtn();};
    function updateMkQueueBtn(){const btn=$lb('#mkQueue');btn.disabled=mkStrokes.length===0;if(mkStrokes.length&&pendingGigAttachment){btn.textContent='↺ Re-queue';btn.style.background='#0891b2';}else if(mkStrokes.length){btn.textContent='📎 Queue for GIG';btn.style.background='';}}
    function resetMkQueueBtn(){$lb('#mkQueue').disabled=true;$lb('#mkQueue').textContent='📎 Queue for GIG';$lb('#mkQueue').style.background='';$lb('#lbMkQueuedBadge').style.display='none';}
    $lb('#mkQueue').onclick=async()=>{
      // Flush any pending text input before capturing — the blur handler is
      // delayed 150ms so it won't have run yet if the user clicked Queue directly
      // from the text field. commitMkText() is a no-op if no text is pending.
      commitMkText();
      const btn=$lb('#mkQueue');btn.disabled=true;btn.textContent='Capturing…';try{const img=$lb('#lbImg'),w=img.naturalWidth||mkCanvas.width,h=img.naturalHeight||mkCanvas.height,off=document.createElement('canvas');off.width=w;off.height=h;const ctx=off.getContext('2d');try{ctx.drawImage(img,0,0,w,h);}catch(_){ctx.fillStyle='#1e293b';ctx.fillRect(0,0,w,h);}ctx.save();ctx.scale(w/mkCanvas.width,h/mkCanvas.height);ctx.drawImage(mkCanvas,0,0);ctx.restore();const blob=await new Promise(res=>off.toBlob(res,'image/png'));const origName=lbImages[lbIdx]?.name||'attachment';pendingGigAttachment={blob,filename:`markup_${origName.replace(/\.[^.]+$/,'')}_${Date.now()}.png`};$lb('#lbMkQueuedBadge').style.display='block';btn.textContent='✓ Queued!';btn.style.background='#15803d';btn.disabled=false;$('#mkPendingPill').style.display='inline-flex';setStatus('Markup queued — will attach to GIG on submit','ok');}catch(e){console.error('Markup capture:',e);btn.textContent='📎 Queue for GIG';btn.disabled=false;setStatus('Markup capture failed: '+e.message,'error');}};

    // ── REST helpers — all via esri/request so auth is handled automatically ──
    //
    // No manual token fetching anywhere below. esri/request uses the same
    // IdentityManager credential store as applyEdits / queryFeatures, so
    // tokens are injected, refreshed, and proxied transparently.

    async function esriPost(url, formData) {
      // Central wrapper: loads esri/request once (AMD caches it) and posts
      // multipart form data. We use responseType:'text' and parse manually so
      // esri/request handles auth (token injection, refresh, proxy) without also
      // applying its ArcGIS JSON error-detection to addAttachment / deleteAttachments
      // responses, which use non-standard shapes that can trigger false throws.
      const esriRequest = await loadModule('esri/request');
      const result = await esriRequest(url, {
        method: 'post',
        body: formData,
        responseType: 'text'
      });
      try { return JSON.parse(result.data); } catch (_) { return result.data; }
    }

    async function uploadPendingAttachment(objectId, layerUrl) {
      if (!pendingGigAttachment) return;

      if (!layerUrl) {
        setStatus('⚠ GIG created but markup upload skipped — layer URL unavailable', 'error');
        return;
      }

      const uploadUrl = `${layerUrl}/${objectId}/addAttachment`;
      try {
        const fd = new FormData();
        fd.append('attachment', pendingGigAttachment.blob, pendingGigAttachment.filename);
        fd.append('f', 'json');

        const data = await esriPost(uploadUrl, fd);
        console.debug('[rqcw] addAttachment response:', data);

        console.debug('[rqcw] addAttachment response:', data);

        // Only treat as failure on an explicit server-side error or a definite
        // success:false — a missing/undefined success field still means success.
        if (data?.error?.code) throw new Error(data.error.message || `Server error ${data.error.code}`);
        const r = data?.addAttachmentResult;
        if (r?.success === false && !r?.objectId) {
          throw new Error(r?.error?.description || r?.error?.message || 'Upload rejected by server');
        }

        pendingGigAttachment = null;
        $('#mkPendingPill').style.display = 'none';
        setStatus('Markup attached to GIG ✓', 'ok');
      } catch (e) {
        console.warn('Markup upload failed:', e);
        setStatus('⚠ GIG created but markup upload failed: ' + e.message, 'error');
      }
    }

    // ── Photo Transfer Panel ──────────────────────────────────────────

    async function findOriginatingFeature(globalId) {
      const layers = mapView.map.allLayers.filter(l => l.type === 'feature' && l.visible);
      for (const lyr of layers.items) {
        try {
          if (lyr === sketchLayer) continue;
          await lyr.load();
          if (!lyr.globalIdField) continue;
          const q = lyr.createQuery();
          q.where = `${lyr.globalIdField} = '${globalId}'`;
          q.outFields = ['*']; q.returnGeometry = false;
          const res = await lyr.queryFeatures(q);
          if (!res.features.length) continue;
          const objectId = res.features[0].attributes[lyr.objectIdField];
          const supportsAttachments = !!(lyr.capabilities?.operations?.supportsQueryAttachments || lyr.hasAttachments);
          // Use layerEndpointUrl to guarantee the REST URL includes the layer index
          return { layer: lyr, layerUrl: layerEndpointUrl(lyr), objectId, globalId, supportsAttachments };
        } catch (_) {}
      }
      return null;
    }

    // Deletes attachment IDs from a feature via the REST API, routed through
    // esri/request so the current user's auth session is used automatically.
    async function restDeleteAttachments(layerUrl, objectId, ids) {
      if (!ids.length) return;
      const fd = new FormData();
      fd.append('attachmentIds', ids.join(','));
      fd.append('f', 'json');
      const data = await esriPost(`${layerUrl}/${objectId}/deleteAttachments`, fd);
      if (data?.error?.code) throw new Error(data.error.message || 'Delete failed');
      const failed = (data?.deleteAttachmentResults || []).filter(r => r.success === false);
      if (failed.length) throw new Error(`${failed.length} attachment(s) failed to delete`);
    }

    // Downloads GIG photos, deletes selected originals, uploads to original feature.
    // All network calls go through esri/request — no manual token handling needed.
    async function executePhotoTransfer(gigLayerUrl, gigOid, origInfo, toTransfer, toDeleteIds, progressCb) {
      const esriRequest = await loadModule('esri/request');
      const steps = toTransfer.length + (toDeleteIds.length ? 1 : 0) + toTransfer.length;
      let done = 0;
      const tick = () => { done++; progressCb(Math.min(99, Math.round(done / steps * 100))); };

      // Step 1: Download GIG fix photos as blobs via esri/request.
      // responseType 'blob' lets esri/request handle auth (token, proxy) for the download.
      const blobs = [];
      for (const att of toTransfer) {
        const result = await esriRequest(att.url, { responseType: 'blob' });
        if (!result?.data) throw new Error(`Download failed for "${att.name}" — empty response`);
        blobs.push({ blob: result.data, filename: att.name });
        tick();
      }

      // Step 2: Delete selected original feature photos.
      if (toDeleteIds.length && origInfo?.supportsAttachments) {
        await restDeleteAttachments(origInfo.layerUrl, origInfo.objectId, toDeleteIds);
        tick();
      }

      // Step 3: Upload downloaded blobs to the original feature via esri/request.
      if (origInfo?.supportsAttachments) {
        for (const { blob, filename } of blobs) {
          const fd = new FormData();
          fd.append('attachment', blob, filename);
          fd.append('f', 'json');
          const data = await esriPost(`${origInfo.layerUrl}/${origInfo.objectId}/addAttachment`, fd);
          if (data?.error?.code) throw new Error(data.error.message || `Upload failed for "${filename}"`);
          const r = data?.addAttachmentResult;
          if (r?.success === false && !r?.objectId) throw new Error(r?.error?.description || `Upload failed for "${filename}"`);
          tick();
        }
      }
      progressCb(100);
    }

    function buildPPItem(att, type) {
      const isTransfer = type === 'transfer';
      const wrap = document.createElement('div');
      wrap.className = 'pp-item ' + (isTransfer ? 'sel-t' : 'sel-d');

      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = true;
      cb.className = 'pp-cb ' + (isTransfer ? 'pp-cb-t' : 'pp-cb-d');
      cb.dataset.id = String(att.id);

      const img = document.createElement('img');
      img.className = 'pp-thumb'; img.loading = 'lazy';
      img.src = att.url;

      const ph = document.createElement('div');
      ph.className = 'pp-thumb-ph'; ph.textContent = '🖼';
      img.onerror = () => { img.style.display = 'none'; ph.style.display = 'flex'; };

      const info = document.createElement('div'); info.className = 'pp-info';
      const name = document.createElement('div'); name.className = 'pp-name'; name.textContent = att.name || 'Unknown'; name.title = att.name || '';
      const size = document.createElement('div'); size.className = 'pp-size'; size.textContent = formatBytes(att.size);
      info.append(name, size);

      wrap.append(cb, img, ph, info);
      wrap.addEventListener('click', e => {
        if (e.target !== cb) cb.checked = !cb.checked;
        wrap.classList.toggle('sel-t', isTransfer && cb.checked);
        wrap.classList.toggle('sel-d', !isTransfer && cb.checked);
        if (!cb.checked) wrap.classList.remove('sel-t', 'sel-d');
        wrap.dispatchEvent(new Event('change', { bubbles: true }));
      });
      return wrap;
    }

    function openPhotoTransferPanel(item, notes, gigAtts, gigOid, gigLayerUrl, origInfo, origAtts) {
      const transferable = gigAtts.filter(a => a.contentType?.startsWith('image/') && !a.name?.startsWith('markup_'));
      const markupCount  = gigAtts.filter(a => a.name?.startsWith('markup_')).length;

      $pp('#ppGigId').textContent = `GIG ${item.gisId} · ${item.gigTypeName || ''}`;

      const left = $pp('#ppLeft'); left.innerHTML = '';
      if (!transferable.length) {
        left.innerHTML = '<div class="pp-empty">No transferable photos on this GIG</div>';
      } else {
        transferable.forEach(att => left.appendChild(buildPPItem(att, 'transfer')));
        if (markupCount) { const n = document.createElement('div'); n.className = 'pp-excluded'; n.textContent = `${markupCount} QC markup file${markupCount > 1 ? 's' : ''} excluded`; left.appendChild(n); }
      }

      const right = $pp('#ppRight'); right.innerHTML = '';
      if (!origInfo) {
        right.innerHTML = '<div class="pp-empty">⚠ Originating feature not found — photos cannot be deleted or uploaded</div>';
      } else if (!origInfo.supportsAttachments) {
        right.innerHTML = '<div class="pp-empty">This layer does not support attachment operations — photos will be added only</div>';
      } else if (!origAtts.length) {
        right.innerHTML = '<div class="pp-empty">No existing photos on the original feature</div>';
      } else {
        origAtts.forEach(att => right.appendChild(buildPPItem(att, 'delete')));
      }

      const summaryEl = $pp('#ppSummary');
      const updateSummary = () => {
        const t = left.querySelectorAll('input[type=checkbox]:checked').length;
        const d = right.querySelectorAll('input[type=checkbox]:checked').length;
        summaryEl.innerHTML = `Transferring <strong>${t}</strong> · Deleting <strong>${d}</strong>`;
      };
      updateSummary();
      left.addEventListener('change', updateSummary);
      right.addEventListener('change', updateSummary);

      const prog = $pp('#ppProg'), progFill = $pp('#ppProgFill'), confirmBtn = $pp('#ppConfirm');
      prog.style.display = 'none'; progFill.style.width = '0%';
      confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm Transfer & Approve →';

      confirmBtn.onclick = async () => {
        const selTransferIds = [...left.querySelectorAll('input[type=checkbox]:checked')].map(cb => cb.dataset.id);
        const selDeleteIds   = [...right.querySelectorAll('input[type=checkbox]:checked')].map(cb => parseInt(cb.dataset.id));
        const toTransfer = transferable.filter(a => selTransferIds.includes(String(a.id)));

        if (!toTransfer.length && !selDeleteIds.length) {
          if (!confirm('No photos selected for transfer or deletion.\n\nApprove this GIG without any photo changes?')) return;
        }

        confirmBtn.disabled = true; confirmBtn.textContent = 'Processing…';
        prog.style.display = 'block';

        try {
          await executePhotoTransfer(gigLayerUrl, gigOid, origInfo, toTransfer, selDeleteIds, pct => { progFill.style.width = pct + '%'; });
          closePP();
          await doApproveGig(item, notes);
        } catch (e) {
          confirmBtn.disabled = false; confirmBtn.textContent = '↺ Retry Transfer & Approve';
          prog.style.display = 'none'; progFill.style.width = '0%';
          setStatus('Transfer failed: ' + e.message, 'error');
          alert('Photo transfer failed:\n\n' + e.message + '\n\nThe GIG has not been updated. Correct the issue above and retry, or cancel.');
        }
      };

      pp.classList.add('open');
    }

    function closePP() { pp.classList.remove('open'); $('#btnSubmit').disabled = false; setStatus('Ready','idle'); }
    $pp('#ppClose').onclick = closePP;
    $pp('#ppCancel').onclick = closePP;

    async function doApproveGig(item, notes) {
      try {
        setStatus('Saving…','busy'); $('#btnSubmit').disabled = true;
        const gl = gigLayerRef(); await gl.load();
        const oid = item.feature.attributes[gl.objectIdField];
        const gigAttrs = { [gl.objectIdField]: oid, gig_status: 'APPROVED' };
        if (notes) gigAttrs.comments = notes;
        const gigRes = await gl.applyEdits({ updateFeatures: [{ attributes: gigAttrs }] });
        const gr = gigRes.updateFeatureResults?.[0];
        if (!(gr?.success === true || (gr?.success === undefined && gr?.error === null))) throw new Error(gr?.error?.message || 'GIG update failed');
        await updateOriginatingFeature(item.gisId, 'QCCMPLT');
        if (pendingGigAttachment) await uploadPendingAttachment(oid, layerEndpointUrl(gl));
        sessionLog.push({ timestamp: new Date(), action: 'qc_review', layerName: 'GIG Layer (22100)', gisId: item.gisId, decision: 'Approve', gigPointsCreated: 0, notes, timeSpent: elapsed(), success: true });
        setStatus('GIG approved','ok');
        stopTimer(); currentIndex++; setTimeout(showFeature, 600);
      } catch (e) {
        setStatus('Error: ' + e.message, 'error'); alert('Error:\n' + e.message); console.error(e);
        $('#btnSubmit').disabled = false;
      }
    }

    // ── Submit — New QC ───────────────────────────────────────────────
    async function submitNewQc(){
      const item=qcQueue[currentIndex],dec=box.querySelector("input[name='qcDec']:checked");
      if(!dec){alert('Please select Pass, Fail, or Missing Photo');return;}
      const dv=dec.value,notes=$('#qcNotes').value.trim();
      let issues=[];
      if(dv==='fail'){const checked=box.querySelectorAll('.issueCheck:checked');if(!checked.length){alert('Please select at least one issue type');return;}issues=Array.from(checked).map(cb=>({code:cb.dataset.code,name:cb.dataset.name}));}
      try{
        setStatus('Saving…','busy');$('#btnSubmit').disabled=true;
        const cfg={pass:{gigStatus:'PASS',wfStatus:'QCCMPLT',pts:[{type:null,status:'PASS'}],update:true},fail:{gigStatus:'OPEN',wfStatus:'QCINPROG',pts:issues.map(it=>({type:it.code,status:'OPEN'})),update:true},missing_photo:{gigStatus:'MISSING_PHOTO',wfStatus:'QCINPROG',pts:[{type:null,status:'MISSING_PHOTO'}],update:true}}[dv];
        const gl=gigLayerRef();await gl.load();const geom=gigPointGeom(item.feature.geometry);
        const addRes=await gl.applyEdits({addFeatures:cfg.pts.map(gp=>({geometry:geom,attributes:buildGigAttrs(item.feature,gp.type,gp.status,notes)}))});
        const okResults=(addRes.addFeatureResults||[]).filter(r=>r.success===true||(r.success===undefined&&r.error===null&&(r.objectId||r.globalId)));
        if(okResults.length<cfg.pts.length){const e=(addRes.addFeatureResults||[]).filter(r=>!(r.success===true||(r.success===undefined&&r.error===null))).map(r=>r.error?.message||'Unknown').join(', ');throw new Error('GIG creation failed: '+e);}
        if(cfg.update){const oid=item.feature.attributes[item.layer.objectIdField];const up=await item.layer.applyEdits({updateFeatures:[{attributes:{[item.layer.objectIdField]:oid,workflow_status:cfg.wfStatus}}]});const ur=up.updateFeatureResults?.[0];if(!(ur?.success===true||(ur?.success===undefined&&ur?.error===null)))throw new Error(ur?.error?.message||'Feature update failed');}
        // Use layerEndpointUrl to ensure the REST URL includes the layer index
        if(pendingGigAttachment&&okResults[0]?.objectId) await uploadPendingAttachment(okResults[0].objectId, layerEndpointUrl(gl));
        const label={pass:'Pass',fail:'Fail',missing_photo:'Missing Photo'}[dv];
        sessionLog.push({timestamp:new Date(),action:'qc_review',layerName:item.layer.title,gisId:item.gisId,decision:label,gigPointsCreated:okResults.length,issueTypes:issues,notes,timeSpent:elapsed(),success:true});
        if(issues.length){const seen=new Set(issues.map(i=>String(i.code)));recentGigTypes=[...issues,...recentGigTypes.filter(r=>!seen.has(String(r.code)))].slice(0,10);try{localStorage.setItem('rqcw_recent_gig_types',JSON.stringify(recentGigTypes));}catch(_){}}
        setStatus(`${label} submitted · ${okResults.length} GIG point(s) created`,'ok');
        stopTimer();currentIndex++;setTimeout(showFeature,600);
      }catch(e){setStatus('Error: '+e.message,'error');alert('Error submitting QC:\n'+e.message+'\n\nNo changes saved.');sessionLog.push({timestamp:new Date(),action:'qc_review',layerName:item.layer.title,gisId:item.gisId,success:false,error:e.message});console.error(e);}
      finally{$('#btnSubmit').disabled=false;}
    }

    // ── Submit — Clear Review ─────────────────────────────────────────
    async function submitClearReview() {
      const item = qcQueue[currentIndex];
      const dec  = box.querySelector("input[name='clrDec']:checked");
      if (!dec) { alert('Please select Approve or Re-open'); return; }
      const dv = dec.value, notes = $('#qcNotes').value.trim();

      if (dv === 'reopen') {
        try {
          setStatus('Saving…','busy'); $('#btnSubmit').disabled = true;
          const gl = gigLayerRef(); await gl.load();
          const oid = item.feature.attributes[gl.objectIdField];
          const attrs = { [gl.objectIdField]: oid, gig_status: 'OPEN' };
          if (notes) attrs.comments = notes;
          const res = await gl.applyEdits({ updateFeatures: [{ attributes: attrs }] });
          const r = res.updateFeatureResults?.[0];
          if (!(r?.success === true || (r?.success === undefined && r?.error === null))) throw new Error(r?.error?.message || 'GIG update failed');
          sessionLog.push({ timestamp: new Date(), action: 'qc_review', layerName: 'GIG Layer (22100)', gisId: item.gisId, decision: 'Re-open', gigPointsCreated: 0, notes, timeSpent: elapsed(), success: true });
          setStatus('GIG re-opened','ok');
          stopTimer(); currentIndex++; setTimeout(showFeature, 600);
        } catch (e) { setStatus('Error: '+e.message,'error'); alert('Error:\n'+e.message); console.error(e); }
        finally { $('#btnSubmit').disabled = false; }
        return;
      }

      const skipPhotos = $('#chkSkipPhotos').checked;
      if (skipPhotos) { doApproveGig(item, notes); return; }

      try {
        setStatus('Fetching GIG photos…','busy'); $('#btnSubmit').disabled = true;
        const gl = gigLayerRef(); await gl.load();
        const gigOid = item.feature.attributes[gl.objectIdField];
        const gigAttRes = await gl.queryAttachments({ objectIds: [gigOid] });
        const gigAtts = (gigAttRes[gigOid] || []).filter(a => a.contentType?.startsWith('image/'));
        const transferable = gigAtts.filter(a => !a.name?.startsWith('markup_'));

        if (!transferable.length) {
          $('#btnSubmit').disabled = false;
          doApproveGig(item, notes);
          return;
        }

        const origInfo = await findOriginatingFeature(item.gisId);
        if (!origInfo) {
          setStatus('⚠ Originating feature not found — photo transfer skipped','idle');
          $('#btnSubmit').disabled = false;
          doApproveGig(item, notes);
          return;
        }

        let origAtts = [];
        if (origInfo.supportsAttachments) {
          try {
            await origInfo.layer.load();
            const origAttRes = await origInfo.layer.queryAttachments({ objectIds: [origInfo.objectId] });
            origAtts = (origAttRes[origInfo.objectId] || []).filter(a => a.contentType?.startsWith('image/'));
          } catch (_) {}
        }

        setStatus('Ready','idle');
        openPhotoTransferPanel(item, notes, gigAtts, gigOid, layerEndpointUrl(gl), origInfo, origAtts);

      } catch (e) {
        setStatus('Error: '+e.message,'error');
        alert('Error loading photos:\n'+e.message);
        $('#btnSubmit').disabled = false;
      }
    }

    async function updateOriginatingFeature(globalId, newStatus) {
      const layers = mapView.map.allLayers.filter(l => l.type === 'feature' && l.visible);
      for (const lyr of layers.items) {
        try {
          if (lyr === sketchLayer) continue; await lyr.load(); if (!lyr.globalIdField) continue;
          const q = lyr.createQuery(); q.where = `${lyr.globalIdField} = '${globalId}'`; q.outFields = [lyr.objectIdField]; q.returnGeometry = false;
          const res = await lyr.queryFeatures(q); if (!res.features.length) continue;
          const oid = res.features[0].attributes[lyr.objectIdField];
          const up = await lyr.applyEdits({ updateFeatures: [{ attributes: { [lyr.objectIdField]: oid, workflow_status: newStatus } }] });
          const ur = up.updateFeatureResults?.[0];
          if (!(ur?.success === true || (ur?.success === undefined && ur?.error === null))) throw new Error(ur?.error?.message || 'Update failed');
          return;
        } catch (e) { throw e; }
      }
      setStatus(`⚠ Originating feature "${globalId}" not found`,'error');
    }

    const skipFeature=()=>{sessionLog.push({timestamp:new Date(),action:'skip',layerName:qcQueue[currentIndex].layer.title,gisId:qcQueue[currentIndex].gisId,timeSpent:elapsed(),success:true});stopTimer();currentIndex++;showFeature();};
    const prevFeature=()=>{if(currentIndex>0){stopTimer();currentIndex--;showFeature();}};

    // ── Home & End Session ────────────────────────────────────────────
    function goHome(){if(currentPhase==='review'){const r=sessionLog.filter(e=>e.action==='qc_review').length;if(!confirm(r>0?`Return to filters? You've reviewed ${r} feature(s) — session data will be lost.`:'Return to filter screen?'))return;}stopTimer();if(highlightHandle){highlightHandle.remove();highlightHandle=null;}mapView.popup?.close();qcQueue=[];sessionLog=[];sessionStartTime=null;currentIndex=0;pendingGigAttachment=null;setPhase('query');$('#queryResults').style.display='none';$('#btnRefresh').disabled=true;$('#hdrSub').textContent='Configure filters to begin';setStatus('Ready — configure filters and query.','ok');}
    function endSessionEarly(){const r=sessionLog.filter(e=>e.action==='qc_review').length;if(!r){alert('No features reviewed yet — nothing to summarize.');return;}if(confirm(`End session now? You've reviewed ${r} of ${qcQueue.length} features.`))completeSession();}

    // ── Complete ──────────────────────────────────────────────────────
    function completeSession(){stopTimer();if(highlightHandle){highlightHandle.remove();highlightHandle=null;}mapView.popup?.close();renderSummary();setPhase('complete');setStatus('Session complete!','ok');}
    function renderSummary(){const rev=sessionLog.filter(e=>e.action==='qc_review'),pass=rev.filter(e=>e.decision==='Pass'||e.decision==='Approve').length,fail=rev.filter(e=>e.decision==='Fail'||e.decision==='Re-open').length,photo=rev.filter(e=>e.decision==='Missing Photo').length,skip=sessionLog.filter(e=>e.action==='skip').length,errs=sessionLog.filter(e=>!e.success).length,gigs=rev.filter(e=>e.success).reduce((s,e)=>s+(e.gigPointsCreated||0),0),rate=rev.length?Math.round((pass/rev.length)*100):0,dur=sessionStartTime?Math.floor((new Date()-sessionStartTime)/1000):0;const row=(l,v,c='#1e293b')=>`<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f1f5f9;"><span style="font-size:11px;color:#64748b;">${l}</span><span style="font-size:12px;font-weight:700;color:${c};">${v}</span></div>`;$('#sessionSummary').innerHTML=`<div style="font-weight:700;font-size:13px;margin-bottom:10px;">Session Summary</div>${row('Total Reviewed',rev.length)}${row('Passed / Approved',pass,'#16a34a')}${row('Failed / Re-opened',fail,'#dc2626')}${photo?row('Missing Photo',photo,'#d97706'):''}${skip?row('Skipped',skip):''}${errs?row('Errors',errs,'#dc2626'):''}${row('Pass Rate',rate+'%',rate>=80?'#16a34a':'#dc2626')}${gigs?row('GIG Points Created',gigs,'#0891b2'):''}${row('Session Duration',`${Math.floor(dur/60)}m ${dur%60}s`)}`;}

    function exportReport(){if(!sessionLog.length){alert('No data to export');return;}const now=new Date(),dur=sessionStartTime?Math.floor((now-sessionStartTime)/1000):0,rev=sessionLog.filter(e=>e.action==='qc_review'),pass=rev.filter(e=>e.decision==='Pass'||e.decision==='Approve').length,fail=rev.filter(e=>e.decision==='Fail'||e.decision==='Re-open').length,photo=rev.filter(e=>e.decision==='Missing Photo').length,skip=sessionLog.filter(e=>e.action==='skip').length,errs=sessionLog.filter(e=>!e.success).length,gigs=rev.filter(e=>e.success).reduce((s,e)=>s+(e.gigPointsCreated||0),0),rate=rev.length?Math.round((pass/rev.length)*100):0,hr='='.repeat(80);let r=`${hr}\nREMOTE QC WORKFLOW — SESSION REPORT\nMode: ${mode==='new_qc'?'New Feature QC':'Clear GIG Review'}\n${hr}\n\nStart: ${sessionStartTime?.toLocaleString()??'N/A'}\nEnd: ${now.toLocaleString()}\nDuration: ${Math.floor(dur/60)}m ${dur%60}s\n\nSUMMARY\n${'-'.repeat(40)}\nTotal: ${rev.length}\nPassed/Approved: ${pass}\nFailed/Re-opened: ${fail}\n`;if(photo)r+=`Missing Photo: ${photo}\n`;if(skip)r+=`Skipped: ${skip}\n`;if(errs)r+=`Errors: ${errs}\n`;r+=`Pass Rate: ${rate}%\n`;if(gigs)r+=`GIG Points Created: ${gigs}\n`;r+=`\nDETAILED LOG\n${hr}\n\n`;sessionLog.forEach((e,i)=>{r+=`[${i+1}] ${e.timestamp.toLocaleTimeString()} | GIS: ${e.gisId} | ${e.layerName}\n    Action: ${e.action.toUpperCase()}`;if(e.action==='qc_review')r+=` | ${e.decision} | ${e.success?'OK':'ERROR'}`;r+='\n';if(e.gigPointsCreated)r+=`    GIG Points: ${e.gigPointsCreated}\n`;if(e.issueTypes?.length)r+=`    Issues: ${e.issueTypes.map(it=>it.name).join(', ')}\n`;if(e.notes)r+=`    Notes: ${e.notes}\n`;if(e.timeSpent!=null)r+=`    Time: ${Math.floor(e.timeSpent/60)}:${(e.timeSpent%60).toString().padStart(2,'0')}\n`;if(e.error)r+=`    Error: ${e.error}\n`;r+='\n';});r+=`${hr}\nEND OF REPORT\n${hr}\n`;const url=URL.createObjectURL(new Blob([r],{type:'text/plain'}));const a=Object.assign(document.createElement('a'),{href:url,download:`qc-report-${now.toISOString().split('T')[0]}.txt`});document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);setStatus('Report exported','ok');}

    function resetSession(clearForm=true){currentIndex=0;qcQueue=[];sessionLog=[];sessionStartTime=null;pendingGigAttachment=null;stopTimer();if(highlightHandle){highlightHandle.remove();highlightHandle=null;}mapView.popup?.close();if(clearForm){['#dateFrom','#dateTo'].forEach(s=>$(s).value='');selectedWOs.clear();selectedPOs.clear();selectedJobs.clear();refreshMultiDisplays();$('#sortOrder').value='desc';$('#gigTypeFilter').value='';$('#queryResults').style.display='none';$('#btnRefresh').disabled=true;setSpatialMode('none');clearSketchGraphics();setDrawHint('','Select a tool above to start drawing');}setPhase('query');updateFilterBadge();setStatus('Ready','idle');}

    // ── Keyboard shortcuts ────────────────────────────────────────────
    function onKey(e){
      if(lb.classList.contains('open')){if(e.key==='Escape'){closeLightbox();return;}if(e.key==='m'||e.key==='M'){$lb('#lbMkToggle').click();return;}if(mkActive){if(e.key==='p'||e.key==='P'){setMkTool('pen');return;}if(e.key==='c'||e.key==='C'){setMkTool('circle');return;}if(e.key==='a'||e.key==='A'){setMkTool('arrow');return;}if(e.key==='t'||e.key==='T'){setMkTool('text');return;}if((e.ctrlKey||e.metaKey)&&e.key==='z'){$lb('#mkUndo').click();return;}return;}if(e.key==='ArrowLeft'){$lb('#lbPrev').click();return;}if(e.key==='ArrowRight'){$lb('#lbNext').click();return;}if(e.key==='+'||e.key==='='){lbZoom(1.3);return;}if(e.key==='-'){lbZoom(0.77);return;}if(e.key==='0'){lbScale=1;lbPan={x:0,y:0};applyLbTransform();return;}}
      if(currentPhase!=='review')return;if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;
      if(mode==='new_qc'){if(e.key==='p'||e.key==='P'){$('#radPass').click();$('#radPass').dispatchEvent(new Event('change'));}if(e.key==='f'||e.key==='F'){$('#radFail').click();$('#radFail').dispatchEvent(new Event('change'));}if(e.key==='m'||e.key==='M'){$('#radPhoto').click();$('#radPhoto').dispatchEvent(new Event('change'));}}else{if(e.key==='a'||e.key==='A'){$('#radApprove').click();$('#radApprove').dispatchEvent(new Event('change'));}if(e.key==='r'||e.key==='R'){$('#radReopen').click();$('#radReopen').dispatchEvent(new Event('change'));}}
      if(e.key==='Enter')$('#btnSubmit').click();if(e.key==='ArrowRight')skipFeature();if(e.key==='ArrowLeft')prevFeature();
    }
    document.addEventListener('keydown',onKey);

    // ── Wire events ───────────────────────────────────────────────────
    $('#btnQuery').onclick=runQuery;$('#btnRefresh').onclick=runQuery;$('#btnStart').onclick=startReview;$('#btnZoom').onclick=zoomToFeature;
    $('#btnSubmit').onclick=()=>mode==='new_qc'?submitNewQc():submitClearReview();
    $('#btnSkip').onclick=skipFeature;$('#btnPrev').onclick=prevFeature;$('#btnEndSession').onclick=endSessionEarly;$('#btnHome').onclick=goHome;$('#btnExport').onclick=exportReport;$('#btnStartOver').onclick=()=>resetSession(true);
    $('#btnRefreshOpts').onclick=async()=>{const btn=$('#btnRefreshOpts');btn.disabled=true;$('#cacheBadge').style.display='none';try{await loadCachedOrFetch(true);setStatus('Filter options refreshed','ok');}catch(e){setStatus('Refresh error: '+e.message,'error');}finally{btn.disabled=false;}};
    $('#btnClearFilters').onclick=()=>{['#dateFrom','#dateTo'].forEach(s=>$(s).value='');selectedWOs.clear();selectedPOs.clear();selectedJobs.clear();refreshMultiDisplays();$('#gigTypeFilter').value='';$('#sortOrder').value='desc';setSpatialMode('none');clearSketchGraphics();$('#queryResults').style.display='none';updateFilterBadge();};
    $('#btnClose').onclick=()=>window.gisToolHost.closeTool('remote-qc-workflow');

    // ── Cleanup & register ────────────────────────────────────────────
    function cleanup(){stopTimer();document.removeEventListener('keydown',onKey);if(highlightHandle)highlightHandle.remove();if(sketchVM){try{sketchVM.cancel();sketchVM.destroy();}catch(_){}}if(sketchLayer){try{mapView.map.remove(sketchLayer);}catch(_){}}mapView.popup?.close();css.remove();box.remove();lb.remove();pp.remove();}

    init();setPhase('query');
    window.gisToolHost.activeTools.set('remote-qc-workflow',{cleanup,toolBox:box});

  } catch(e){
    alert('Error creating Remote QC Workflow Tool: '+(e.message||e));
    console.error(e);
  }
})();
