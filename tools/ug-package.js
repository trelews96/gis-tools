javascript:(function(){
async function main(){
  const mv=Object.values(window).find(o=>o?.constructor?.name==='MapView');
  if(!mv)return alert('No MapView found');

  const LAYERS={vault:{id:42100},span:{id:42050},cable:{id:41050}};
  const TMPL_KEY='pkgCreator_v2',Z=99999,SNAP_PX=20;
  const uid=()=>Math.random().toString(36).slice(2,8);
  const qs=(sel,ctx=box)=>ctx.querySelector(sel);
  const gval=id=>{const e=box.querySelector('#'+id);return e?e.value.trim():'';};
  const domName=(field,code)=>{if(!code)return'';const d=domains[field];return d?.find(x=>String(x.code)===String(code))?.name||code;};

  let step='setup',domains={},cfg={},vCfg={};
  let conduits=[{id:uid()}],fibers=[{id:uid()}];
  let spanOverride={},fiberOverride={};
  let fiberSplit=true,createConduit=true,createFiber=true,currentTmplName=null;
  let pts=[],active=false,waypointMode=false;
  let clickH=null,keyH=null,moveH=null,pickH=null,gl=null;
  let pickMode=false,pickOpts={vault:true,conduit:true,fiber:true};
  let arcMode=false,arcPts=[],arcDensity=50;
  let snapMode='soft',snapThreshDeg=8;
  let bearingLock=false,lockedBearing=null,pendingPt=null;
  let _snapHoverTimer=null;
  let showVertexHighlight=false,extentWatchH=null;
  let copyGeoMode=false,copyGeoH=null,copyGeoAddVaults=false;
  let traceMode=false,traceSketchVM=null,traceSketchLayer=null;

  window.__pkgCGV=function(){
    copyGeoAddVaults=!copyGeoAddVaults;
    const btn=box.querySelector('#btn-copy-vaults');
    if(btn){btn.classList.toggle('btn-active',copyGeoAddVaults);btn.textContent='Vaults: '+(copyGeoAddVaults?'ON':'OFF');}
  };

  const styleEl=document.createElement('style');
  styleEl.textContent=`
    #pkgT{position:fixed;top:100px;right:40px;z-index:${Z};width:540px;height:640px;
      min-width:380px;min-height:240px;resize:both;overflow:hidden;
      background:#1e1e2e;color:#cdd6f4;border:1px solid #45475a;border-radius:8px;
      box-shadow:0 8px 32px rgba(0,0,0,.55);display:flex;flex-direction:column;
      font-family:'Segoe UI',Arial,sans-serif;font-size:12px;}
    #pkgT::after{content:'';position:absolute;bottom:3px;right:3px;width:9px;height:9px;
      border-right:2px solid #585b70;border-bottom:2px solid #585b70;border-radius:0 0 2px 0;pointer-events:none;}
    #pkgT *{box-sizing:border-box;}
    #pkgT .hdr{background:#181825;padding:9px 14px;display:flex;align-items:center;gap:8px;
      cursor:move;border-bottom:1px solid #313244;flex-shrink:0;user-select:none;}
    #pkgT .hdr-title{font-weight:700;font-size:13px;color:#cba6f7;flex:1;}
    #pkgT .hdr-close{background:none;border:none;color:#f38ba8;cursor:pointer;font-size:17px;padding:0 3px;line-height:1;}
    #pkgT .tabs{display:flex;background:#181825;border-bottom:1px solid #313244;flex-shrink:0;}
    #pkgT .tab{flex:1;padding:6px 2px;text-align:center;font-size:10px;font-weight:600;
      color:#585b70;border-bottom:2px solid transparent;transition:color .15s,border-color .15s;}
    #pkgT .tab.active{color:#cba6f7;border-bottom-color:#cba6f7;}
    #pkgT .tab.done{color:#a6e3a1;}
    #pkgT .body{flex:1;overflow-y:auto;padding:13px;min-height:0;
      scrollbar-width:thin;scrollbar-color:#45475a #1e1e2e;}
    #pkgT .sec{background:#181825;border:1px solid #313244;border-radius:6px;margin-bottom:11px;overflow:hidden;}
    #pkgT .sec-hdr{padding:7px 12px;font-size:11px;font-weight:700;color:#89b4fa;
      display:flex;justify-content:space-between;align-items:center;background:#1e1e2e;border-bottom:1px solid #313244;}
    #pkgT .sec-hdr.clickable{cursor:pointer;}
    #pkgT .sec-body{padding:10px 12px;}
    #pkgT .collapsed>.sec-body{display:none;}
    #pkgT .chevron{transition:transform .2s;display:inline-block;}
    #pkgT .collapsed .chevron{transform:rotate(-90deg);}
    #pkgT .frow{margin-bottom:8px;}
    #pkgT .frow label{display:block;font-size:10px;color:#a6adc8;margin-bottom:3px;font-weight:600;}
    #pkgT .frow label.req::after{content:" *";color:#f38ba8;}
    #pkgT .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 10px;}
    #pkgT input[type=text],#pkgT input[type=number],#pkgT input[type=date]{width:100%;padding:5px 7px;font-size:11px;
      background:#313244;color:#cdd6f4;border:1px solid #45475a;border-radius:4px;outline:none;}
    #pkgT input:focus{border-color:#cba6f7;}
    #pkgT .btn{padding:6px 12px;font-size:11px;font-weight:600;border:none;border-radius:4px;cursor:pointer;transition:opacity .15s,background .15s;}
    #pkgT .btn:hover{opacity:.82;}#pkgT .btn:disabled{opacity:.38;cursor:not-allowed;}
    #pkgT .btn-p{background:#cba6f7;color:#1e1e2e;}#pkgT .btn-g{background:#a6e3a1;color:#1e1e2e;}
    #pkgT .btn-r{background:#f38ba8;color:#1e1e2e;}#pkgT .btn-o{background:#fab387;color:#1e1e2e;}
    #pkgT .btn-n{background:#45475a;color:#cdd6f4;}#pkgT .btn-b{background:#89b4fa;color:#1e1e2e;}
    #pkgT .btn-sm{padding:3px 7px;font-size:10px;}
    #pkgT .btn-active{background:#89b4fa !important;color:#1e1e2e !important;}
    #pkgT .btn-arc-on{background:#fab387 !important;color:#1e1e2e !important;}
    #pkgT .btn-lock-on{background:#a6e3a1 !important;color:#1e1e2e !important;}
    #pkgT .btn-snap-soft{background:#fab387 !important;color:#1e1e2e !important;}
    #pkgT .btn-snap-hard{background:#f9a836 !important;color:#1e1e2e !important;}
    #pkgT .btn-trace-on{background:#fab387 !important;color:#1e1e2e !important;}
    #pkgT .row{display:flex;gap:7px;align-items:center;}#pkgT .row .btn{flex:1;}
    #pkgT .stk{width:100%;border-collapse:collapse;font-size:10px;}
    #pkgT .stk th{background:#313244;color:#89b4fa;padding:4px 5px;text-align:left;font-weight:600;white-space:nowrap;}
    #pkgT .stk td{padding:3px 4px;vertical-align:middle;border-bottom:1px solid #2a2a3e;}
    #pkgT .stk tr:hover td{background:#252538;}
    #pkgT .stk input[type=number]{width:52px;padding:3px 4px;font-size:10px;}
    #pkgT .stk input[type=text]{width:72px;padding:3px 4px;font-size:10px;}
    #pkgT .sbar{background:#181825;border-top:1px solid #313244;padding:6px 14px;
      font-size:10px;color:#a6adc8;flex-shrink:0;min-height:28px;}
    #pkgT .badge{display:inline-block;padding:1px 6px;border-radius:10px;font-size:9px;font-weight:700;}
    #pkgT .bp{background:#cba6f7;color:#1e1e2e;}#pkgT .bg{background:#a6e3a1;color:#1e1e2e;}
    #pkgT .br{background:#f38ba8;color:#1e1e2e;}#pkgT .bb{background:#89b4fa;color:#1e1e2e;}
    #pkgT .bo{background:#fab387;color:#1e1e2e;}
    #pkgT .plist{max-height:120px;overflow-y:auto;background:#0d0d1a;border-radius:4px;padding:5px;}
    #pkgT .pitem{display:flex;justify-content:space-between;align-items:center;padding:2px 5px;border-radius:3px;font-size:10px;cursor:default;}
    #pkgT .pitem:hover{background:#313244;}
    #pkgT .pitem-del{opacity:0;transition:opacity .15s;padding:1px 5px !important;font-size:9px !important;line-height:1.4;flex-shrink:0;}
    #pkgT .pitem:hover .pitem-del{opacity:1;}
    #pkgT .pbwrap{background:#313244;border-radius:4px;height:7px;overflow:hidden;margin-top:5px;}
    #pkgT .pbfill{height:100%;background:linear-gradient(90deg,#cba6f7,#89b4fa);transition:width .25s;border-radius:4px;width:0%;}
    #pkgT .rvtbl{width:100%;font-size:10px;border-collapse:collapse;}
    #pkgT .rvtbl td{padding:4px 7px;border-bottom:1px solid #313244;}
    #pkgT .rvtbl td:first-child{color:#89b4fa;font-weight:600;width:44%;}
    #pkgT .errbx{background:#2d1418;border:1px solid #f38ba8;border-radius:4px;padding:8px;font-size:10px;color:#f38ba8;margin-top:8px;}
    #pkgT .okbx{background:#142d1d;border:1px solid #a6e3a1;border-radius:4px;padding:8px;font-size:10px;color:#a6e3a1;margin-top:8px;}
    #pkgT .tip{background:#0d0d1a;border-radius:4px;padding:7px 9px;font-size:10px;color:#a6adc8;margin-top:6px;}
    #pkgT kbd{background:#313244;padding:1px 4px;border-radius:3px;font-size:10px;border:1px solid #45475a;}
    #pkgT .empty{text-align:center;color:#585b70;font-size:10px;padding:14px;}
    #pkgT .ovr-sec{background:#0d0d1a;border-top:1px solid #313244;padding:8px 12px;}
    #pkgT .ovr-title{font-size:9px;font-weight:700;color:#585b70;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;}
    #pkgT .bearing-bar{background:#0d1a0d;border:1px solid #a6e3a1;border-radius:4px;
      padding:5px 10px;margin-bottom:8px;display:flex;align-items:center;gap:10px;font-size:10px;}
    #pkgT .bearing-val{font-weight:700;font-size:13px;color:#a6e3a1;min-width:50px;}
    #pkgT .bearing-snap-ind{padding:2px 6px;border-radius:3px;font-size:9px;font-weight:700;}
    #pkgT .hk-grid{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font-size:10px;}
    #pkgT .hk-key{color:#cba6f7;font-weight:700;white-space:nowrap;}
    #pkgT .hk-desc{color:#a6adc8;}
    #pkgT .arc-guide{background:#1a1a0a;border:1px solid #fab387;border-radius:4px;
      padding:6px 10px;margin-bottom:8px;font-size:10px;color:#fab387;display:flex;align-items:center;gap:8px;}
    #pkgT .arc-step{display:inline-flex;align-items:center;justify-content:center;
      width:18px;height:18px;border-radius:50%;font-weight:700;font-size:10px;flex-shrink:0;}
    #pkgT .arc-step.done{background:#a6e3a1;color:#1e1e2e;}
    #pkgT .arc-step.cur{background:#fab387;color:#1e1e2e;}
    #pkgT .arc-step.wait{background:#45475a;color:#cdd6f4;}
    #pkgT .arc-density-row{display:flex;align-items:center;gap:6px;margin-top:6px;font-size:10px;color:#a6adc8;}
    #pkgT .arc-density-row input{width:60px;}
    #pkgT .pick-panel{background:#0d1a2e;border:1px solid #89b4fa;border-radius:6px;padding:10px 12px;margin-bottom:11px;}
    #pkgT .pick-panel-title{font-size:11px;font-weight:700;color:#89b4fa;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;}
    #pkgT .pick-chk{display:flex;flex-direction:column;gap:5px;margin-bottom:10px;}
    #pkgT .pick-chk label{display:flex;align-items:center;gap:7px;font-size:11px;color:#cdd6f4;cursor:pointer;}
    #pkgT .pick-chk input[type=checkbox]{width:14px;height:14px;accent-color:#89b4fa;cursor:pointer;}
    #pkgT .pick-active-banner{background:#1a1a2e;border:1px solid #89b4fa;border-radius:4px;
      padding:6px 10px;font-size:10px;color:#89b4fa;display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
    #pkgT .tcard{background:#252538;border:1px solid #313244;border-radius:6px;padding:8px 10px;margin-bottom:7px;}
    #pkgT .tcard:hover{border-color:#585b70;}
    #pkgT .tcard-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;}
    #pkgT .tcard-name{font-weight:700;font-size:11px;color:#cdd6f4;}
    #pkgT .tcard-date{font-size:9px;color:#585b70;}
    #pkgT .tcard-row{display:flex;gap:5px;font-size:9px;color:#a6adc8;margin-bottom:2px;flex-wrap:wrap;}
    #pkgT .current-tmpl-tag{display:inline-block;padding:1px 5px;background:#cba6f7;color:#1e1e2e;border-radius:3px;font-size:9px;font-weight:700;margin-left:5px;}
    #pkgT .ss{position:relative;display:block;width:100%;}
    #pkgT .ss-btn{display:flex;align-items:center;justify-content:space-between;padding:5px 7px;background:#313244;border:1px solid #45475a;border-radius:4px;cursor:pointer;font-size:11px;color:#cdd6f4;min-height:26px;user-select:none;}
    #pkgT .ss-btn:hover{border-color:#89b4fa;}
    #pkgT .ss-btn.open{border-color:#cba6f7;border-radius:4px 4px 0 0;}
    #pkgT .ss-val{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;}
    #pkgT .ss-val.placeholder{color:#585b70;}
    #pkgT .ss-arrow{flex-shrink:0;margin-left:5px;color:#585b70;font-size:9px;transition:transform .15s;}
    #pkgT .ss-btn.open .ss-arrow{transform:rotate(180deg);color:#cba6f7;}
    .ss-drop-portal{position:fixed;z-index:200000;background:#1e1e2e;border:1px solid #cba6f7;border-radius:0 0 5px 5px;box-shadow:0 6px 20px rgba(0,0,0,.6);overflow:hidden;}
    .ss-drop-portal .ss-search-wrap{padding:5px 6px;border-bottom:1px solid #313244;background:#181825;}
    .ss-drop-portal .ss-inp{width:100%;padding:4px 7px;background:#313244;border:1px solid #45475a;color:#cdd6f4;font-size:11px;border-radius:3px;outline:none;font-family:'Segoe UI',Arial,sans-serif;}
    .ss-drop-portal .ss-inp:focus{border-color:#cba6f7;}
    .ss-drop-portal .ss-opts{max-height:160px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:#45475a #1e1e2e;}
    .ss-drop-portal .ss-opt{padding:5px 9px;font-size:11px;cursor:pointer;color:#cdd6f4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .ss-drop-portal .ss-opt:hover{background:#313244;}
    .ss-drop-portal .ss-opt.selected{color:#cba6f7;font-weight:600;background:#252538;}
    .ss-drop-portal .ss-opt.ss-hidden{display:none;}
    .ss-drop-portal .ss-none{padding:8px;font-size:10px;color:#585b70;text-align:center;}
    #pkgT .tog{display:flex;align-items:center;gap:7px;cursor:pointer;user-select:none;}
    #pkgT .tog-track{width:32px;height:17px;background:#45475a;border-radius:9px;position:relative;transition:background .2s;flex-shrink:0;}
    #pkgT .tog-track.on{background:#cba6f7;}
    #pkgT .tog-thumb{position:absolute;top:2px;left:2px;width:13px;height:13px;background:#fff;border-radius:50%;transition:left .2s;}
    #pkgT .tog-track.on .tog-thumb{left:17px;}
    #pkgT .tog-lbl{font-size:10px;color:#a6adc8;}
    #pkgT .trace-sec{background:#0d1a0a;border:1px solid #a6e3a1;border-radius:6px;padding:10px 12px;margin-bottom:11px;}
    #pkgT .trace-sec-title{font-size:11px;font-weight:700;color:#a6e3a1;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;}
    #pkgT .trace-active{background:#1a2e1a;border:1px solid #a6e3a1;border-radius:4px;padding:6px 10px;font-size:10px;color:#a6e3a1;margin-bottom:8px;display:flex;align-items:center;gap:6px;}
    #pkgT .pt-new-vault{color:#cba6f7;}
    #pkgT .pt-exist-vault{color:#fab387;}
    #pkgT .pt-free{color:#89dceb;}
  `;
  document.head.appendChild(styleEl);

  const box=document.createElement('div');
  box.id='pkgT';
  document.body.appendChild(box);
  document.addEventListener('click',closeAllDrops);

  // ── Searchable Select ─────────────────────────────────────────────────
  let activePortal=null;
  function closeAllDrops(){
    if(activePortal){activePortal.remove();activePortal=null;}
    box.querySelectorAll('.ss-btn.open').forEach(b=>{b.classList.remove('open');b.style.borderRadius='';});
  }
  function initSearchSelects(ctx=box){
    ctx.querySelectorAll('select[data-ss]:not([data-ss-init])').forEach(sel=>{
      sel.setAttribute('data-ss-init','1');
      sel.style.cssText='position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;';
      const optData=[...sel.options].map(o=>({val:o.value,label:o.text}));
      const wrap=document.createElement('div');wrap.className='ss';
      const curLabel=optData.find(o=>o.val===sel.value)?.label||'';
      const btn=document.createElement('div');btn.className='ss-btn';btn.tabIndex=0;
      btn.innerHTML='<span class="ss-val '+(curLabel?'':'placeholder')+'">'+(curLabel||'— select —')+'</span><span class="ss-arrow">▾</span>';
      sel.parentNode.insertBefore(wrap,sel);wrap.appendChild(btn);wrap.appendChild(sel);
      function openDrop(e){
        e.stopPropagation();if(btn.classList.contains('open')){closeAllDrops();return;}closeAllDrops();
        const rect=btn.getBoundingClientRect();
        const portal=document.createElement('div');portal.className='ss-drop-portal';
        portal.style.left=rect.left+'px';portal.style.width=Math.max(rect.width,200)+'px';
        const curVal=sel.value;
        portal.innerHTML='<div class="ss-search-wrap"><input class="ss-inp" type="text" placeholder="Search…" autocomplete="off"></div><div class="ss-opts">'+
          optData.map(o=>'<div class="ss-opt'+(o.val===curVal?' selected':'')+'" data-val="'+o.val+'">'+o.label+'</div>').join('')+
          '<div class="ss-none" style="display:none">No results</div></div>';
        const spaceBelow=window.innerHeight-rect.bottom;
        if(spaceBelow<200&&rect.top>200){portal.style.bottom=(window.innerHeight-rect.top)+'px';portal.style.borderRadius='5px 5px 0 0';btn.style.borderRadius='0 0 4px 4px';}
        else portal.style.top=rect.bottom+'px';
        document.body.appendChild(portal);activePortal=portal;btn.classList.add('open');
        const inp=portal.querySelector('.ss-inp'),opts=portal.querySelector('.ss-opts'),none=portal.querySelector('.ss-none');
        inp.focus();
        inp.addEventListener('input',()=>{const q=inp.value.toLowerCase();let vis=0;opts.querySelectorAll('.ss-opt').forEach(o=>{const m=!q||o.textContent.toLowerCase().includes(q);o.classList.toggle('ss-hidden',!m);if(m)vis++;});none.style.display=vis?'none':'block';});
        inp.addEventListener('click',e=>e.stopPropagation());
        opts.addEventListener('click',e=>{const opt=e.target.closest('.ss-opt');if(!opt)return;sel.value=opt.dataset.val;const vs=btn.querySelector('.ss-val');vs.textContent=opt.textContent.trim();vs.classList.toggle('placeholder',!opt.dataset.val);btn.style.borderRadius='';closeAllDrops();});
        portal.addEventListener('click',e=>e.stopPropagation());
      }
      btn.addEventListener('click',openDrop);btn.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')openDrop(e);});
    });
  }
  function mkToggle(id,label,isOn){
    return '<label class="tog" onclick="window.__pkgToggle(\''+id+'\')">'
      +'<div class="tog-track '+(isOn?'on':'')+'" id="ttrack_'+id+'"><div class="tog-thumb"></div></div>'
      +'<span class="tog-lbl">'+label+'</span></label>';
  }

  // ── Drag ──────────────────────────────────────────────────────────────
  function makeDraggable(){
    const hdr=qs('.hdr');if(!hdr)return;let ox,oy,sx,sy;
    hdr.addEventListener('mousedown',e=>{
      if(e.target.closest('.hdr-close'))return;
      ox=box.offsetLeft;oy=box.offsetTop;sx=e.clientX;sy=e.clientY;
      const mm=e2=>{box.style.left=(ox+e2.clientX-sx)+'px';box.style.top=(oy+e2.clientY-sy)+'px';box.style.right='auto';};
      const mu=()=>{document.removeEventListener('mousemove',mm);document.removeEventListener('mouseup',mu);};
      document.addEventListener('mousemove',mm);document.addEventListener('mouseup',mu);
    });
  }

  // ── Domain Loader ─────────────────────────────────────────────────────
  async function loadDomains(){
    const vl=mv.map.allLayers.find(x=>x.layerId===LAYERS.vault.id);
    const sl=mv.map.allLayers.find(x=>x.layerId===LAYERS.span.id);
    const cl=mv.map.allLayers.find(x=>x.layerId===LAYERS.cable.id);
    if(!vl||!sl||!cl) throw new Error('One or more required layers not found');
    await Promise.all([vl.load(),sl.load(),cl.load()]);
    domains={};
    for(const layer of [vl,sl]){
      for(const f of (layer.fields||[])){
        if(f.domain?.codedValues&&!domains[f.name])
          domains[f.name]=f.domain.codedValues.map(cv=>({code:cv.code,name:cv.name}));
      }
    }
    for(const f of (cl.fields||[])){
      if(f.domain?.codedValues){
        const vals=f.domain.codedValues.map(cv=>({code:cv.code,name:cv.name}));
        domains['cable_'+f.name]=vals;
        if(!domains[f.name]) domains[f.name]=vals;
      }
    }
  }

  // ── Field Builders ────────────────────────────────────────────────────
  function mkSelect(domainKey,domId,cur){
    cur=cur||'';
    if(!domains[domainKey]||!domains[domainKey].length)
      return '<input type="text" id="'+domId+'" placeholder="—" value="'+cur+'">';
    const opts=domains[domainKey].map(d=>'<option value="'+d.code+'"'+(String(d.code)===String(cur)?' selected':'')+'>'+d.name+'</option>').join('');
    return '<select id="'+domId+'" data-ss><option value="">— select —</option>'+opts+'</select>';
  }
  function mkDate(domId,cur){cur=cur||'';return '<input type="date" id="'+domId+'" value="'+cur+'">';}
  function mkText(domId,cur,ph){return '<input type="text" id="'+domId+'" value="'+(cur||'')+'" placeholder="'+(ph||'—')+'">';}
  function frow(label,html,req){return '<div class="frow"><label class="'+(req?'req':'')+'">'+(req?label:label)+'</label>'+html+'</div>';}

  // ── Geometry ──────────────────────────────────────────────────────────
  const Geo={
    wm2ll(x,y){const lng=(x/20037508.34)*180;let lat=(y/20037508.34)*180;lat=180/Math.PI*(2*Math.atan(Math.exp(lat*Math.PI/180))-Math.PI/2);return{lat,lng};},
    pt2ll(pt){const sr=pt.spatialReference;if(!sr||sr.wkid===3857||sr.wkid===102100)return this.wm2ll(pt.x,pt.y);if(sr.wkid===4326||sr.wkid===4269)return{lat:pt.y,lng:pt.x};return this.wm2ll(pt.x,pt.y);},
    dist(p1,p2){const R=20902231,a1=this.pt2ll(p1),a2=this.pt2ll(p2),dLat=(a2.lat-a1.lat)*Math.PI/180,dLng=(a2.lng-a1.lng)*Math.PI/180,a=Math.sin(dLat/2)**2+Math.cos(a1.lat*Math.PI/180)*Math.cos(a2.lat*Math.PI/180)*Math.sin(dLng/2)**2;return Math.round(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)));},
    totalLen(points){let t=0;for(let i=1;i<points.length;i++)t+=this.dist(points[i-1],points[i]);return t;},
    bearing(p1,p2){const ll1=this.pt2ll(p1),ll2=this.pt2ll(p2),dLng=(ll2.lng-ll1.lng)*Math.PI/180,lat1=ll1.lat*Math.PI/180,lat2=ll2.lat*Math.PI/180;return(Math.atan2(Math.sin(dLng)*Math.cos(lat2),Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLng))*180/Math.PI+360)%360;},
    projectOnBearing(origin,bearingDeg,rawPt){const bRad=bearingDeg*Math.PI/180,rx=Math.sin(bRad),ry=Math.cos(bRad),dx=rawPt.x-origin.x,dy=rawPt.y-origin.y,t=dx*rx+dy*ry;return{x:origin.x+t*rx,y:origin.y+t*ry,spatialReference:origin.spatialReference};},
    extendAlong(origin,bearingDeg,distM){const bRad=bearingDeg*Math.PI/180;return{x:origin.x+Math.sin(bRad)*distM,y:origin.y+Math.cos(bRad)*distM,spatialReference:origin.spatialReference};}
  };

  // ── Alignment ─────────────────────────────────────────────────────────
  function nearestCleanAngle(bearing){
    const snapped=Math.round(bearing/45)*45%360;
    let diff=Math.abs(bearing-snapped);if(diff>180)diff=360-diff;
    return diff<=snapThreshDeg?snapped:null;
  }
  function resolvePoint(rawPt){
    const origin=pts.length?pts[pts.length-1].pt:null;
    if(!origin) return{commitPt:rawPt,snapPt:null,snapping:false,snapBearing:null,isLocked:false,isSoft:false};
    const rawBearing=Geo.bearing(origin,rawPt);
    if(bearingLock&&lockedBearing!==null){
      const proj=Geo.projectOnBearing(origin,lockedBearing,rawPt);
      return{commitPt:proj,snapPt:proj,snapping:true,snapBearing:lockedBearing,isLocked:true,isSoft:false};
    }
    if(snapMode!=='off'){
      const clean=nearestCleanAngle(rawBearing);
      if(clean!==null){
        const proj=Geo.projectOnBearing(origin,clean,rawPt);
        const isSoft=snapMode==='soft';
        return{commitPt:isSoft?rawPt:proj,snapPt:proj,snapping:true,snapBearing:clean,isLocked:false,isSoft};
      }
    }
    return{commitPt:rawPt,snapPt:null,snapping:false,snapBearing:null,isLocked:false,isSoft:false};
  }

  // ── Segment Builder ───────────────────────────────────────────────────
  // gapBefore  — disconnected copy-geo span: close current segment WITHOUT this
  //              point so no connecting line is drawn across the gap. No length
  //              guard needed — if it's the last point, cur won't reach length 2.
  // existingVault / newVault — shared endpoint: included at end of one seg AND
  //              start of next (connected geometry).
  function buildSegments(ptArr){
    if(ptArr.length<2) return[];
    const segs=[];let cur=[ptArr[0].pt];
    for(let i=1;i<ptArr.length;i++){
      const p=ptArr[i];
      if(p.gapBefore){
        if(cur.length>=2) segs.push(cur);
        cur=[p.pt];
      } else {
        cur.push(p.pt);
        if((!p.noVault||p.existingVault)&&i<ptArr.length-1){
          segs.push(cur);cur=[p.pt];
        }
      }
    }
    if(cur.length>=2) segs.push(cur);
    return segs;
  }

  // ── Arc Math ──────────────────────────────────────────────────────────
  function circumcenter(p1,p2,p3){
    const ax=p1.x,ay=p1.y,bx=p2.x,by=p2.y,cx=p3.x,cy=p3.y;
    const D=2*(ax*(by-cy)+bx*(cy-ay)+cx*(ay-by));
    if(Math.abs(D)<1e-6) return null;
    return{x:((ax*ax+ay*ay)*(by-cy)+(bx*bx+by*by)*(cy-ay)+(cx*cx+cy*cy)*(ay-by))/D,
           y:((ax*ax+ay*ay)*(cx-bx)+(bx*bx+by*by)*(ax-cx)+(cx*cx+cy*cy)*(bx-ax))/D};
  }
  function generateArcWaypoints(p1,pMid,p3,densityFt){
    const sr=p1.spatialReference,cc=circumcenter(p1,pMid,p3);
    if(!cc){
      const N=Math.max(1,Math.round(Math.hypot(p3.x-p1.x,p3.y-p1.y)/(densityFt*0.3048)));
      const res=[];
      for(let i=1;i<=N;i++){const t=i/N;res.push({x:p1.x+(p3.x-p1.x)*t,y:p1.y+(p3.y-p1.y)*t,spatialReference:sr});}
      return res;
    }
    const R=Math.hypot(p1.x-cc.x,p1.y-cc.y);
    const a1=Math.atan2(p1.y-cc.y,p1.x-cc.x),a3=Math.atan2(p3.y-cc.y,p3.x-cc.x);
    const cross=(pMid.x-p1.x)*(p3.y-p1.y)-(pMid.y-p1.y)*(p3.x-p1.x);
    let sweep=a3-a1;
    if(cross>0&&sweep<0) sweep+=2*Math.PI;
    if(cross<=0&&sweep>0) sweep-=2*Math.PI;
    const N=Math.max(2,Math.round(Math.abs(sweep)*R/(densityFt*0.3048)));
    const res=[];
    for(let i=1;i<=N;i++){const ang=a1+(sweep*i/N);res.push({x:cc.x+R*Math.cos(ang),y:cc.y+R*Math.sin(ang),spatialReference:sr});}
    return res;
  }

  // ── Graphics Layer ────────────────────────────────────────────────────
  async function initGL(){
    if(gl) return;
    if(!window.require) return;
    await new Promise((res,rej)=>window.require(['esri/layers/GraphicsLayer','esri/Graphic'],(GL,Gr)=>{
      gl=new GL({title:'__pkgCreator__',listMode:'hide'});mv.map.add(gl);window.__pkgGr=Gr;res();},rej)).catch(()=>{});
  }
  function rmTag(tag){if(gl) gl.removeMany(gl.graphics.filter(g=>g.attributes?._pkg===tag).toArray());}
  function addMarker(pt,idx,isFree,isSpecial){
    if(!gl||!window.__pkgGr) return;
    let sym;
    if(isSpecial){
      sym={type:'simple-marker',style:'diamond',color:[250,179,135,1],size:'18px',outline:{color:[255,255,255,1],width:2.5}};
    } else if(isFree){
      sym={type:'simple-marker',style:'x',color:[137,220,235,1],size:'13px',outline:{color:[137,220,235,1],width:2.5}};
    } else {
      sym={type:'simple-marker',style:'circle',color:[203,166,247,1],size:'16px',outline:{color:[255,255,255,1],width:2.5}};
    }
    gl.add(new window.__pkgGr({geometry:pt,symbol:sym,attributes:{_pkg:'vault',idx:idx}}));
    refreshLine();
  }
  function addArcGuideMarker(pt,stepN){
    if(!gl||!window.__pkgGr) return;
    const sym=stepN===2
      ?{type:'simple-marker',style:'diamond',color:[250,179,135,1],size:'15px',outline:{color:'#fff',width:2.5}}
      :{type:'simple-marker',style:'circle',color:[166,227,161,1],size:'14px',outline:{color:'#fff',width:2.5}};
    gl.add(new window.__pkgGr({geometry:pt,symbol:sym,attributes:{_pkg:'arc-guide',stepN:stepN}}));
    const guides=gl.graphics.filter(g=>g.attributes?._pkg==='arc-guide').toArray();
    rmTag('arc-preview');
    if(guides.length>=2){
      const coords=guides.map(g=>[g.geometry.x,g.geometry.y]);
      gl.add(new window.__pkgGr({geometry:{type:'polyline',paths:[coords],spatialReference:pt.spatialReference},symbol:{type:'simple-line',color:[250,179,135,0.85],width:2,style:'short-dash'},attributes:{_pkg:'arc-preview'}}));
    }
  }
  function clearArcGuides(){rmTag('arc-guide');rmTag('arc-preview');}
  function refreshLine(){
    if(!gl||!window.__pkgGr) return;
    rmTag('line');
    const segs=buildSegments(pts);
    if(!segs.length) return;
    segs.forEach(function(seg){
      gl.add(new window.__pkgGr({
        geometry:{type:'polyline',paths:[seg.map(function(p){return[p.x,p.y];})],spatialReference:seg[0].spatialReference},
        symbol:{type:'simple-line',color:[137,180,250,1],width:3,style:'solid'},
        attributes:{_pkg:'line'}
      }));
    });
  }
  function removeSnapRing(){rmTag('snap');}
  function addSnapRing(pt){
    if(!gl||!window.__pkgGr) return;removeSnapRing();
    gl.add(new window.__pkgGr({geometry:pt,symbol:{type:'simple-marker',style:'circle',color:[250,179,135,0],size:'22px',outline:{color:[250,179,135,1],width:3}},attributes:{_pkg:'snap'}}));
  }
  function addVertexSnapRing(pt){
    if(!gl||!window.__pkgGr) return;removeSnapRing();
    gl.add(new window.__pkgGr({geometry:pt,symbol:{type:'simple-marker',style:'square',color:[137,220,235,0],size:'20px',outline:{color:[137,220,235,1],width:3}},attributes:{_pkg:'snap'}}));
  }
  function removeLastMarker(){
    if(!gl) return;
    const vg=gl.graphics.filter(g=>g.attributes?._pkg==='vault').toArray();
    if(vg.length) gl.remove(vg[vg.length-1]);
    refreshLine();
  }
  function clearGL(){if(gl) gl.removeAll();}

  // ── Preview ───────────────────────────────────────────────────────────
  function updatePreview(rawMapPt){
    if(!gl||!window.__pkgGr) return;
    rmTag('preview-line');rmTag('preview-ghost');rmTag('preview-ray');rmTag('preview-dot');
    const origin=pts.length?pts[pts.length-1].pt:null;
    if(!origin) return;
    const res=resolvePoint(rawMapPt);
    pendingPt=res.commitPt;
    if(bearingLock&&lockedBearing!==null){
      const far=500000,ah=Geo.extendAlong(origin,lockedBearing,far),bh=Geo.extendAlong(origin,(lockedBearing+180)%360,far);
      gl.add(new window.__pkgGr({geometry:{type:'polyline',paths:[[[bh.x,bh.y],[ah.x,ah.y]]],spatialReference:origin.spatialReference},symbol:{type:'simple-line',color:[166,227,161,0.35],width:1,style:'long-dash'},attributes:{_pkg:'preview-ray'}}));
    }
    if(res.isSoft&&res.snapPt){
      gl.add(new window.__pkgGr({geometry:{type:'polyline',paths:[[[origin.x,origin.y],[res.snapPt.x,res.snapPt.y]]],spatialReference:origin.spatialReference},symbol:{type:'simple-line',color:[250,179,135,0.55],width:2,style:'long-dash'},attributes:{_pkg:'preview-ghost'}}));
      gl.add(new window.__pkgGr({geometry:res.snapPt,symbol:{type:'simple-marker',style:'circle',color:[250,179,135,0.3],size:'12px',outline:{color:[250,179,135,0.85],width:2}},attributes:{_pkg:'preview-ghost'}}));
    }
    const isHard=res.snapping&&!res.isSoft;
    const lc=res.isLocked?[166,227,161,1]:isHard?[250,179,135,1]:[137,180,250,0.9];
    gl.add(new window.__pkgGr({geometry:{type:'polyline',paths:[[[origin.x,origin.y],[res.commitPt.x,res.commitPt.y]]],spatialReference:origin.spatialReference},symbol:{type:'simple-line',color:lc,width:isHard?2.5:2,style:isHard||res.isLocked?'solid':'short-dash'},attributes:{_pkg:'preview-line'}}));
    const dc=res.isLocked?[166,227,161,1]:isHard?[250,179,135,1]:[203,166,247,0.9];
    gl.add(new window.__pkgGr({geometry:res.commitPt,symbol:{type:'simple-marker',style:'circle',color:dc,size:'10px',outline:{color:[255,255,255,0.9],width:2}},attributes:{_pkg:'preview-dot'}}));
    updateBearingBar(Geo.bearing(origin,rawMapPt),res);
  }
  function clearPreview(){rmTag('preview-line');rmTag('preview-ghost');rmTag('preview-ray');rmTag('preview-dot');pendingPt=null;}
  function updateBearingBar(rawBearing,res){
    const bar=qs('#bearing-bar');if(!bar) return;
    const val=qs('#bearing-val'),ind=qs('#bearing-snap-ind');
    if(val) val.textContent=rawBearing.toFixed(1)+'°';
    if(ind){
      if(res.isLocked){ind.textContent='🔒 '+lockedBearing.toFixed(0)+'°';ind.style.background='#142d1d';ind.style.color='#a6e3a1';}
      else if(res.snapping&&res.isSoft){ind.textContent='⊕ Guide '+res.snapBearing+'°';ind.style.background='#2d1a0a';ind.style.color='#fab387';}
      else if(res.snapping){ind.textContent='⊕ Snap '+res.snapBearing+'°';ind.style.background='#3d2200';ind.style.color='#f9a836';}
      else{ind.textContent='Free';ind.style.background='#313244';ind.style.color='#585b70';}
    }
  }

  // ── Snap ──────────────────────────────────────────────────────────────
  async function findSnap(screenEvt){
    for(const p of [...pts].reverse()){
      const sp=mv.toScreen(p.pt);
      if(Math.hypot(screenEvt.x-sp.x,screenEvt.y-sp.y)<SNAP_PX) return{pt:p.pt,type:'vault'};
    }
    const mapPt=mv.toMap({x:screenEvt.x,y:screenEvt.y}),tol=mv.resolution*SNAP_PX;
    const ext={type:'extent',xmin:mapPt.x-tol,ymin:mapPt.y-tol,xmax:mapPt.x+tol,ymax:mapPt.y+tol,spatialReference:mapPt.spatialReference};
    try {
      const vl=mv.map.allLayers.find(l=>l.layerId===LAYERS.vault.id);
      if(vl){
        const res=await vl.queryFeatures({geometry:ext,returnGeometry:true,outFields:[],num:1});
        if(res.features&&res.features.length){
          const geo=res.features[0].geometry;
          const sp=mv.toScreen(geo);
          if(Math.hypot(screenEvt.x-sp.x,screenEvt.y-sp.y)<SNAP_PX) return{pt:geo,type:'vault'};
        }
      }
    } catch(e){}
    const lineLayers=[LAYERS.span.id,LAYERS.cable.id].map(id=>mv.map.allLayers.find(l=>l.layerId===id)).filter(Boolean);
    for(const layer of lineLayers){
      try {
        const res=await layer.queryFeatures({geometry:ext,returnGeometry:true,outFields:[],num:10});
        for(const feat of (res.features||[])){
          const geo=feat.geometry;
          if(!geo||!geo.paths) continue;
          for(const path of geo.paths){
            for(const coord of path){
              const vpt={x:coord[0],y:coord[1],spatialReference:geo.spatialReference};
              const sp=mv.toScreen(vpt);
              if(Math.hypot(screenEvt.x-sp.x,screenEvt.y-sp.y)<SNAP_PX) return{pt:vpt,type:'vertex'};
            }
          }
        }
      } catch(e){}
    }
    return null;
  }

  // ── Geometry Engine (lazy load) ───────────────────────────────────────
  async function loadGeometryEngine(){
    if(window.__pkgGE) return window.__pkgGE;
    if(!window.require) throw new Error('JSAPI require not available');
    return new Promise((res,rej)=>window.require(['esri/geometry/geometryEngine'],ge=>{window.__pkgGE=ge;res(ge);},rej));
  }

  // ── Trace Path ────────────────────────────────────────────────────────
  function orderFeaturesAlongLine(features,line){
    const ge=window.__pkgGE;
    return features.map(f=>{
      let dist=0;
      try{
        const geo=f.geometry;
        let pt=null;
        if(geo.type==='point') pt=geo;
        else if(geo.type==='polyline'&&geo.paths?.[0]){
          const mid=Math.floor(geo.paths[0].length/2);
          pt={type:'point',x:geo.paths[0][mid][0],y:geo.paths[0][mid][1],spatialReference:geo.spatialReference};
        }
        if(pt&&line.paths?.[0]){
          const nc=ge.nearestCoordinate(line,pt);
          if(nc?.coordinate&&nc.vertexIndex!==undefined){
            let cum=0;
            for(let i=0;i<nc.vertexIndex;i++){
              const a={type:'point',x:line.paths[0][i][0],y:line.paths[0][i][1],spatialReference:line.spatialReference};
              const b={type:'point',x:line.paths[0][i+1][0],y:line.paths[0][i+1][1],spatialReference:line.spatialReference};
              cum+=ge.distance(a,b,'meters');
            }
            const lv={type:'point',x:line.paths[0][nc.vertexIndex][0],y:line.paths[0][nc.vertexIndex][1],spatialReference:line.spatialReference};
            cum+=ge.distance(lv,nc.coordinate,'meters');
            dist=cum;
          }
        }
      }catch(e){}
      return{f,dist};
    }).sort((a,b)=>a.dist-b.dist).map(x=>x.f);
  }

  function walkSegments(orderedFeatures){
    const result=[];
    let chainTail=null;
    const SNAP_TOL=5;
    for(const feat of orderedFeatures){
      const geo=feat.geometry;
      if(!geo||!geo.paths) continue;
      const coords=[];
      for(const path of geo.paths)
        for(const coord of path) coords.push({x:coord[0],y:coord[1],spatialReference:geo.spatialReference});
      if(coords.length<2) continue;
      if(!chainTail){
        coords.forEach(pt=>result.push(pt));
      } else {
        const dStart=Math.hypot(coords[0].x-chainTail.x,coords[0].y-chainTail.y);
        const dEnd=Math.hypot(coords[coords.length-1].x-chainTail.x,coords[coords.length-1].y-chainTail.y);
        const ordered=dEnd<dStart?[...coords].reverse():coords;
        const skipFirst=Math.hypot(ordered[0].x-chainTail.x,ordered[0].y-chainTail.y)<SNAP_TOL;
        for(let i=skipFirst?1:0;i<ordered.length;i++) result.push(ordered[i]);
      }
      chainTail=result[result.length-1];
    }
    return result;
  }

  async function enableTracePath(){
    if(active) disableTool();
    if(copyGeoMode) disableCopyGeo();
    traceMode=true;
    updateTraceBtn();
    await initGL();
    try { await loadGeometryEngine(); } catch(e){ setStatus('Could not load geometry engine: '+e.message,'error'); disableTracePath(); return; }
    if(!window.require){ setStatus('JSAPI require not available','error'); disableTracePath(); return; }
    window.require(['esri/widgets/Sketch/SketchViewModel','esri/layers/GraphicsLayer'],(SVM,GL)=>{
      traceSketchLayer=new GL({title:'__pkgTrace__',listMode:'hide'});
      mv.map.add(traceSketchLayer);
      traceSketchVM=new SVM({
        view:mv,layer:traceSketchLayer,
        polylineSymbol:{type:'simple-line',color:[166,227,161,1],width:3,style:'dash'}
      });
      traceSketchVM.on('create',async evt=>{
        if(evt.state==='cancel'){disableTracePath();setStatus('Trace cancelled.','info');return;}
        if(evt.state!=='complete') return;
        await processTracedPath(evt.graphic.geometry);
        disableTracePath();
      });
      traceSketchVM.create('polyline');
      mv.container.style.cursor='crosshair';
      setStatus('Sketch trace line — click points along the route, double-click to finish.','warn');
    });
  }

  async function processTracedPath(line){
    setStatus('Querying features along traced path…','info');
    const ge=window.__pkgGE;
    const bufInpEl=qs('#trace-buf');
    const bufFt=bufInpEl?Math.max(1,parseInt(bufInpEl.value)||20):20;
    let bufGeom;
    try { bufGeom=ge.buffer(line,bufFt,'feet'); } catch(e){}
    if(!bufGeom){ setStatus('Could not buffer trace line — try again.','error'); return; }

    const lineLayers=[LAYERS.span.id,LAYERS.cable.id]
      .map(id=>mv.map.allLayers.find(l=>l.layerId===id)).filter(Boolean);
    let lineFeatures=[];
    for(const layer of lineLayers){
      if(lineFeatures.length) break;
      try{
        await layer.load();
        const res=await layer.queryFeatures({geometry:bufGeom,spatialRelationship:'intersects',returnGeometry:true,outFields:[],num:500});
        lineFeatures=res.features||[];
      }catch(e){ console.warn('[PKG Trace] line query:',e); }
    }
    if(!lineFeatures.length){
      setStatus('No span/fiber features found — try widening the buffer or redrawing.','warn');
      return;
    }

    setStatus('Building path from '+lineFeatures.length+' feature(s)…','info');
    const ordered=orderFeaturesAlongLine(lineFeatures,line);
    const chain=walkSegments(ordered);
    if(chain.length<2){ setStatus('Could not build a continuous path.','error'); return; }

    const vaultLayer=mv.map.allLayers.find(l=>l.layerId===LAYERS.vault.id);
    let existingVaultGeos=[];
    if(vaultLayer){
      try{
        await vaultLayer.load();
        const vr=await vaultLayer.queryFeatures({geometry:bufGeom,spatialRelationship:'intersects',returnGeometry:true,outFields:[],num:500});
        existingVaultGeos=(vr.features||[]).map(f=>f.geometry);
      }catch(e){}
    }

    const vaultSnapTol=mv.resolution*SNAP_PX*3;
    const existingVaultIdx=new Set();
    for(const vGeo of existingVaultGeos){
      let minDist=Infinity,minIdx=-1;
      for(let i=0;i<chain.length;i++){
        const d=Math.hypot(chain[i].x-vGeo.x,chain[i].y-vGeo.y);
        if(d<minDist){minDist=d;minIdx=i;}
      }
      if(minIdx>=0&&minDist<vaultSnapTol) existingVaultIdx.add(minIdx);
    }

    pts=[];clearGL();
    for(let i=0;i<chain.length;i++){
      const isExist=existingVaultIdx.has(i);
      const entry=isExist
        ?{pt:chain[i],noVault:true,existingVault:true}
        :{pt:chain[i],noVault:true};
      pts.push(entry);
      addMarker(entry.pt,i,entry.noVault,entry.existingVault);
    }

    const exV=existingVaultIdx.size;
    const segs=buildSegments(pts).length;
    refreshLine();refreshPlaceUI();
    setStatus('✅ Traced: '+chain.length+' pts · '+exV+' existing vault splits · '+(chain.length-exV)+' free pts · '+segs+' segments','success');
  }

  function disableTracePath(){
    traceMode=false;
    if(traceSketchVM){try{traceSketchVM.cancel();traceSketchVM.destroy();}catch(e){} traceSketchVM=null;}
    if(traceSketchLayer){try{mv.map.remove(traceSketchLayer);}catch(e){} traceSketchLayer=null;}
    if(mv?.container) mv.container.style.cursor=active?'crosshair':'default';
    updateTraceBtn();
  }

  function updateTraceBtn(){
    const btn=qs('#btn-trace');if(!btn) return;
    if(traceMode){btn.classList.remove('btn-b');btn.classList.add('btn-trace-on');btn.textContent='⏳ Tracing… (dbl-click to finish)';}
    else{btn.classList.remove('btn-trace-on');btn.classList.add('btn-b');btn.textContent='🔍 Trace Path';}
  }

  // ── Copy Geometry ─────────────────────────────────────────────────────
  function enableCopyGeo(){
    copyGeoMode=true;
    mv.container.style.cursor='copy';
    updateCopyGeoBtn();
    setStatus('Click spans to copy geometry as separate segments.','warn');
    copyGeoH=mv.on('click',async function(evt){
      evt.stopPropagation();
      const mapPt=mv.toMap({x:evt.x,y:evt.y}),tol=mv.resolution*SNAP_PX*4;
      const ext={type:'extent',xmin:mapPt.x-tol,ymin:mapPt.y-tol,xmax:mapPt.x+tol,ymax:mapPt.y+tol,spatialReference:mapPt.spatialReference};
      let bestLayer=null,bestOid=null,bestDist=Infinity;
      for(const lid of [LAYERS.span.id,LAYERS.cable.id]){
        const layer=mv.map.allLayers.find(function(l){return l.layerId===lid;});
        if(!layer) continue;
        try {
          await layer.load();
          const res=await layer.queryFeatures({geometry:ext,returnGeometry:true,outFields:['objectid','OBJECTID'],num:10});
          for(const feat of (res.features||[])){
            const geo=feat.geometry;if(!geo||!geo.paths) continue;
            const oid=feat.attributes.objectid||feat.attributes.OBJECTID;
            for(const path of geo.paths)
              for(const coord of path){
                const d=Math.hypot(coord[0]-mapPt.x,coord[1]-mapPt.y);
                if(d<bestDist){bestDist=d;bestLayer=layer;bestOid=oid;}
              }
          }
        } catch(e){}
      }
      if(!bestLayer||bestOid===null){setStatus('No line feature found near click.','warn');return;}
      let fullGeo=null;
      try {
        const fullRes=await bestLayer.queryFeatures({objectIds:[bestOid],returnGeometry:true,outFields:[]});
        if(fullRes.features&&fullRes.features.length) fullGeo=fullRes.features[0].geometry;
      } catch(e){}
      if(!fullGeo||!fullGeo.paths){setStatus('Could not retrieve full geometry.','warn');return;}
      const allCoords=[];
      for(const path of fullGeo.paths)
        for(const coord of path) allCoords.push({x:coord[0],y:coord[1],spatialReference:fullGeo.spatialReference});
      if(allCoords.length<2){setStatus('Feature has too few vertices.','warn');return;}

      const newEntries=allCoords.map(function(pt){return{pt:pt,noVault:true};});
      if(pts.length>0){
        const last=pts[pts.length-1],first=newEntries[0];
        const d=Math.hypot(first.pt.x-last.pt.x,first.pt.y-last.pt.y);
        const snapTol=mv.resolution*SNAP_PX*2;
        if(d<snapTol){
          pts[pts.length-1].existingVault=true;
          for(const entry of newEntries.slice(1)) pts.push(entry);
        } else {
          newEntries[0].gapBefore=true;
          for(const entry of newEntries) pts.push(entry);
        }
      } else {
        for(const entry of newEntries) pts.push(entry);
      }
      rmTag('vault');rmTag('line');
      pts.forEach(function(p,i){addMarker(p.pt,i,p.noVault,p.existingVault||p.gapBefore);});
      refreshPlaceUI();
      const splits=pts.filter(function(p){return !!p.existingVault||!!p.gapBefore;}).length;
      const segs=buildSegments(pts).length;
      setStatus('Copied '+allCoords.length+' vertices — '+pts.length+' total pts · '+splits+' splits · '+segs+' segments. Click another line or Done.','success');
    });
  }
  function updateCopyGeoBtn(){
    const btn=qs('#btn-copy-geo');if(!btn) return;
    if(copyGeoMode){btn.classList.add('btn-active');btn.textContent='✅ Done Copying';}
    else{btn.classList.remove('btn-active');btn.textContent='📋 Copy Geometry';}
  }
  function disableCopyGeo(){
    copyGeoMode=false;
    if(copyGeoH){copyGeoH.remove();copyGeoH=null;}
    if(mv?.container) mv.container.style.cursor=active?'crosshair':'default';
    updateCopyGeoBtn();
  }

  // ── Vertex Highlights ─────────────────────────────────────────────────
  function clearVertexHighlights(){rmTag('vh');}
  async function drawVertexHighlights(){
    if(!gl||!window.__pkgGr) return;
    clearVertexHighlights();
    const rawExt=mv.extent;if(!rawExt) return;
    const ext={type:'extent',xmin:rawExt.xmin,ymin:rawExt.ymin,xmax:rawExt.xmax,ymax:rawExt.ymax,spatialReference:{wkid:rawExt.spatialReference.wkid||102100}};
    for(const lid of [LAYERS.span.id,LAYERS.cable.id]){
      const layer=mv.map.allLayers.find(function(l){return l.layerId===lid;});
      if(!layer) continue;
      try {
        await layer.load();
        const res=await layer.queryFeatures({geometry:ext,returnGeometry:true,outFields:[],num:500});
        for(const feat of (res.features||[])){
          const geo=feat.geometry;if(!geo||!geo.paths) continue;
          for(const path of geo.paths){
            for(let i=0;i<path.length;i++){
              const coord=path[i],pt={x:coord[0],y:coord[1],spatialReference:geo.spatialReference};
              const isEndpoint=(i===0||i===path.length-1);
              const sym=isEndpoint
                ?{type:'simple-marker',style:'circle',color:[250,179,135,1],size:'11px',outline:{color:[230,100,40,1],width:2}}
                :{type:'simple-marker',style:'diamond',color:[137,180,250,1],size:'10px',outline:{color:[80,130,240,1],width:1.5}};
              gl.add(new window.__pkgGr({geometry:pt,symbol:sym,attributes:{_pkg:'vh'}}));
            }
          }
        }
      } catch(e){}
    }
  }
  function toggleVertexHighlight(){
    showVertexHighlight=!showVertexHighlight;
    const btn=qs('#btn-vh');
    if(btn){btn.classList.toggle('btn-active',showVertexHighlight);btn.textContent='◆ Vertices: '+(showVertexHighlight?'ON':'OFF');}
    if(showVertexHighlight){
      drawVertexHighlights();
      if(!extentWatchH) extentWatchH=mv.watch('extent',function(){if(showVertexHighlight) drawVertexHighlights();});
    } else {
      clearVertexHighlights();
      if(extentWatchH){extentWatchH.remove();extentWatchH=null;}
    }
  }

  function scheduleSnapHover(screenEvt){
    clearTimeout(_snapHoverTimer);
    _snapHoverTimer=setTimeout(async function(){
      if(!active) return;
      const snap=await findSnap(screenEvt);
      if(snap){ if(snap.type==='vertex') addVertexSnapRing(snap.pt); else addSnapRing(snap.pt); }
      else removeSnapRing();
    },80);
  }

  // ── Feature Creator ───────────────────────────────────────────────────
  async function createFeat(layer,geometry,attributes){
    await layer.load();
    const result=await layer.applyEdits({addFeatures:[{geometry:geometry,attributes:attributes}]});
    const r=result&&result.addFeatureResults&&result.addFeatureResults[0];
    if(!r) throw new Error('No addFeatureResults returned');
    if(r.error) throw new Error(r.error.description||r.error.message||JSON.stringify(r.error));
    if(!r.objectId) throw new Error('No objectId returned');
    await layer.refresh();
    return r.objectId;
  }

  // ── Templates ─────────────────────────────────────────────────────────
  const Tmpl={
    all(){return JSON.parse(localStorage.getItem(TMPL_KEY)||'{}');},
    save(name,data){const t=this.all();t[name]={name:name,created:new Date().toISOString(),data:data};localStorage.setItem(TMPL_KEY,JSON.stringify(t));},
    del(name){const t=this.all();delete t[name];localStorage.setItem(TMPL_KEY,JSON.stringify(t));}
  };
  function saveCurrentStepState(){
    if(step==='setup') saveCfg();
    if(step==='layers'){saveVCfg();saveConduits();saveFibers();saveSpanOverride();saveFiberOverride();}
  }
  function collectAllState(){
    saveCurrentStepState();
    return{cfg,vCfg,conduits,fibers,fiberSplit,spanOverride,fiberOverride,createConduit,createFiber};
  }
  function doSaveTemplate(name){const state=collectAllState();Tmpl.save(name,state);currentTmplName=name;render();setStatus('Template "'+name+'" saved.','success');}
  function applyTemplate(name){
    saveCurrentStepState();const t=Tmpl.all()[name];if(!t) return;
    cfg=t.data.cfg||{};vCfg=t.data.vCfg||{};
    conduits=t.data.conduits||[{id:uid()}];fibers=t.data.fibers||[{id:uid()}];
    fiberSplit=t.data.fiberSplit!==undefined?t.data.fiberSplit:true;
    createConduit=t.data.createConduit!==undefined?t.data.createConduit:true;
    createFiber=t.data.createFiber!==undefined?t.data.createFiber:true;
    spanOverride=t.data.spanOverride||{};fiberOverride=t.data.fiberOverride||{};
    currentTmplName=name;render();setStatus('Template "'+name+'" loaded.','success');
  }
  function tmplCardHTML(t){
    const d=t.data;
    const cdMap={};
    (d.conduits||[]).forEach(function(c){const dia=domName('conduit_diameter',c.conduit_diameter)||c.conduit_diameter||'?';const mat=domName('conduit_material',c.conduit_material)||'';const key=mat?dia+' '+mat:dia;cdMap[key]=(cdMap[key]||0)+parseInt(c.conduit_count||1);});
    const cdStr=Object.entries(cdMap).map(function(e){return e[0]+' x'+e[1];}).join(', ')||'None';
    const fbMap={};
    (d.fibers||[]).forEach(function(f){const fc=domName('fiber_count',f.fiber_count)||f.fiber_count||'?';fbMap[fc]=(fbMap[fc]||0)+1;});
    const fbStr=Object.entries(fbMap).map(function(e){return e[0]+'ct x'+e[1];}).join(', ')||'None';
    const vs=domName('vault_size',d.vCfg&&d.vCfg.vault_size)||'';
    const vtr=(d.vCfg&&d.vCfg.vault_tier_rating)||'';
    const vaultStr=[vs,vtr&&('Tier '+vtr)].filter(Boolean).join(' · ')||'No vault config';
    const isCurrent=t.name===currentTmplName;
    return '<div class="tcard">'
      +'<div class="tcard-hdr"><span class="tcard-name">'+t.name+(isCurrent?'<span class="current-tmpl-tag">current</span>':'')+'</span>'
      +'<span class="tcard-date">'+new Date(t.created).toLocaleDateString()+'</span></div>'
      +'<div class="tcard-row"><span>🔵</span><span>'+cdStr+'</span></div>'
      +'<div class="tcard-row"><span>🟣</span><span>'+fbStr+' '+(d.fiberSplit===false?'(single span)':'(split per seg)')+'</span></div>'
      +'<div class="tcard-row"><span>🏗️</span><span>'+vaultStr+'</span></div>'
      +'<div class="row" style="margin-top:6px;gap:5px">'
      +'<button class="btn btn-p btn-sm" onclick="window.__pkgLoadTmpl(\''+t.name+'\')">Load</button>'
      +'<button class="btn btn-r btn-sm" onclick="window.__pkgDelTmpl(\''+t.name+'\')">Delete</button>'
      +'</div></div>';
  }
  function renderTmplSection(){
    const tmpls=Object.values(Tmpl.all()).sort(function(a,b){return new Date(b.created)-new Date(a.created);});
    if(!tmpls.length) return '<div class="empty" style="padding:8px">No saved templates.</div>';
    const recent=tmpls.slice(0,3),rest=tmpls.slice(3);
    return recent.map(tmplCardHTML).join('')+(rest.length
      ?'<div id="tmpl-more-x" style="display:none">'+rest.map(tmplCardHTML).join('')+'</div>'
       +'<button class="btn btn-n btn-sm" style="width:100%;margin-top:2px" onclick="var m=document.getElementById(\'tmpl-more-x\');m.style.display=m.style.display===\'none\'?\'block\':\'none\';this.textContent=m.style.display===\'none\'?\'Show '+rest.length+' more\u2026\':\'Show fewer\'">Show '+rest.length+' more\u2026</button>'
      :'');
  }

  // ── Override attrs ────────────────────────────────────────────────────
  function overrideAttrs(ovr){
    const out={};
    if(ovr.supervisor) out.supervisor=ovr.supervisor;
    if(ovr.crew) out.crew=ovr.crew;
    if(ovr.installation_date){const d=new Date(ovr.installation_date);if(!isNaN(d)) out.installation_date=d.getTime();}
    if(ovr.workflow_status_ovr) out.workflow_status=ovr.workflow_status_ovr;
    return out;
  }

  // ── Pick from Map ─────────────────────────────────────────────────────
  function startPick(){
    if(pickH){pickH.remove();pickH=null;}
    mv.container.style.cursor='crosshair';
    const banner=qs('#pick-active-banner');if(banner) banner.style.display='flex';
    setStatus('Click a feature on the map to copy attributes…','warn');
    pickH=mv.on('click',async function(evt){
      evt.stopPropagation();
      const mapPt=mv.toMap({x:evt.x,y:evt.y}),tol=mv.resolution*SNAP_PX*2;
      const ext={type:'extent',xmin:mapPt.x-tol,ymin:mapPt.y-tol,xmax:mapPt.x+tol,ymax:mapPt.y+tol,spatialReference:mapPt.spatialReference};
      const msgs=[];
      try {
        if(pickOpts.vault){
          const vl=mv.map.allLayers.find(l=>l.layerId===LAYERS.vault.id);
          if(vl){
            const r=await vl.queryFeatures({geometry:ext,returnGeometry:false,outFields:['*'],num:1});
            if(r.features&&r.features.length){
              const a=r.features[0].attributes;
              cfg={workflow_stage:a.workflow_stage||cfg.workflow_stage,workflow_status:a.workflow_status||cfg.workflow_status,work_type:a.work_type||cfg.work_type,client_code:a.client_code||cfg.client_code,project_id:a.project_id||cfg.project_id,job_number:a.job_number||cfg.job_number,workorder_id:a.workorder_id||cfg.workorder_id,purchase_order_id:a.purchase_order_id||cfg.purchase_order_id};
              vCfg={vault_type:a.vault_type||vCfg.vault_type,vault_size:a.vault_size||vCfg.vault_size,vault_material:a.vault_material||vCfg.vault_material,physical_status:a.physical_status||vCfg.physical_status,vault_tier_rating:a.vault_tier_rating||vCfg.vault_tier_rating,supervisor:a.supervisor||vCfg.supervisor,crew:a.crew||vCfg.crew,installation_date:a.installation_date||vCfg.installation_date,workflow_status_ovr:a.workflow_status||vCfg.workflow_status_ovr,vault_name:a.vault_name||vCfg.vault_name||'',assembly_code:a.assembly_code||vCfg.assembly_code||''};
              msgs.push('Vault');
            }
          }
        }
        if(pickOpts.conduit){
          const sl=mv.map.allLayers.find(l=>l.layerId===LAYERS.span.id);
          if(sl){
            const r=await sl.queryFeatures({geometry:ext,returnGeometry:false,outFields:['*'],num:1});
            if(r.features&&r.features.length){
              const a=r.features[0].attributes;
              const newRow={id:uid(),conduit_diameter:a.conduit_diameter||'',conduit_material:a.conduit_material||'',installation_method:a.installation_method||'',placement_type:a.placement_type||'',conduit_count:a.conduit_count||'',inner_duct:a.inner_duct||'',minimum_depth:a.minimum_depth||'',assembly_code:a.assembly_code||''};
              saveConduits();
              const blank=conduits.length===1&&!Object.entries(conduits[0]).some(function(e){return e[0]!=='id'&&e[1]!=='';});
              conduits=blank?[newRow]:conduits.concat([newRow]);
              spanOverride={supervisor:a.supervisor||spanOverride.supervisor,crew:a.crew||spanOverride.crew,installation_date:a.installation_date||spanOverride.installation_date,workflow_status_ovr:a.workflow_status||spanOverride.workflow_status_ovr};
              msgs.push(blank?'Conduit filled':'Conduit added');
            }
          }
        }
        if(pickOpts.fiber){
          const cl=mv.map.allLayers.find(l=>l.layerId===LAYERS.cable.id);
          if(cl){
            const r=await cl.queryFeatures({geometry:ext,returnGeometry:false,outFields:['*'],num:1});
            if(r.features&&r.features.length){
              const a=r.features[0].attributes;
              const newRow={id:uid(),fiber_count:a.fiber_count||'',buffer_count:a.buffer_count||'',cable_category:a.cable_category||'',cable_type:a.cable_type||'',sheath_type:a.sheath_type||'',core_type:a.core_type||'',installation_method:a.installation_method||'',placement_type:a.placement_type||'',assembly_code:a.assembly_code||'',cable_name:a.cable_name||''};
              saveFibers();
              const blank=fibers.length===1&&!Object.entries(fibers[0]).some(function(e){return e[0]!=='id'&&e[1]!=='';});
              fibers=blank?[newRow]:fibers.concat([newRow]);
              fiberOverride={supervisor:a.supervisor||fiberOverride.supervisor,crew:a.crew||fiberOverride.crew,installation_date:a.installation_date||fiberOverride.installation_date,workflow_status_ovr:a.workflow_status||fiberOverride.workflow_status_ovr};
              msgs.push(blank?'Fiber filled':'Fiber added');
            }
          }
        }
      } catch(e){ msgs.push('Error: '+e.message); }
      endPick();render();
      setStatus(msgs.length?msgs.join(' · '):'No features found near click.',msgs.length?'success':'warn');
    });
  }
  function endPick(){if(pickH){pickH.remove();pickH=null;}if(mv?.container) mv.container.style.cursor='default';pickMode=false;const banner=qs('#pick-active-banner');if(banner) banner.style.display='none';}

  // ── State Collectors ──────────────────────────────────────────────────
  function readConduit(row){
    function g(id,fk){const e=box.querySelector('#'+id);return e?e.value.trim():(row[fk]||'');}
    return{
      conduit_diameter:g('cd_d_'+row.id,'conduit_diameter'),
      conduit_material:g('cd_m_'+row.id,'conduit_material'),
      installation_method:g('cd_im_'+row.id,'installation_method'),
      placement_type:g('cd_pt_'+row.id,'placement_type'),
      conduit_count:g('cd_cc_'+row.id,'conduit_count'),
      inner_duct:g('cd_id_'+row.id,'inner_duct'),
      minimum_depth:g('cd_md_'+row.id,'minimum_depth'),
      assembly_code:g('cd_ac_'+row.id,'assembly_code')
    };
  }
  function readFiber(row){
    function g(id,fk){const e=box.querySelector('#'+id);return e?e.value.trim():(row[fk]||'');}
    return{
      fiber_count:g('fb_fc_'+row.id,'fiber_count'),
      buffer_count:g('fb_bc_'+row.id,'buffer_count'),
      cable_category:g('fb_ca_'+row.id,'cable_category'),
      cable_type:g('fb_ct_'+row.id,'cable_type'),
      sheath_type:g('fb_st_'+row.id,'sheath_type'),
      core_type:g('fb_co_'+row.id,'core_type'),
      installation_method:g('fb_im_'+row.id,'installation_method'),
      placement_type:g('fb_pt_'+row.id,'placement_type'),
      assembly_code:g('fb_ac_'+row.id,'assembly_code'),
      cable_name:g('fb_cn_'+row.id,'cable_name')
    };
  }
  function saveConduits(){conduits=conduits.map(function(r){return Object.assign({},r,readConduit(r));});}
  function saveFibers(){fibers=fibers.map(function(r){return Object.assign({},r,readFiber(r));});}
  function saveVCfg(){
    vCfg={
      vault_type:gval('v_vt'),vault_size:gval('v_vs'),vault_material:gval('v_vm'),
      physical_status:gval('v_ps'),vault_tier_rating:gval('v_vtr'),
      supervisor:gval('v_sup'),crew:gval('v_crew'),
      installation_date:gval('v_idate'),workflow_status_ovr:gval('v_wso'),
      vault_name:gval('v_vname'),assembly_code:gval('v_acode')
    };
  }
  function saveSpanOverride(){spanOverride={supervisor:gval('so_sup'),crew:gval('so_crew'),installation_date:gval('so_idate'),workflow_status_ovr:gval('so_wso')};}
  function saveFiberOverride(){fiberOverride={supervisor:gval('fo_sup'),crew:gval('fo_crew'),installation_date:gval('fo_idate'),workflow_status_ovr:gval('fo_wso')};}
  function saveCfg(){cfg={workflow_stage:gval('f_ws'),workflow_status:gval('f_wst'),work_type:gval('f_wt'),client_code:gval('f_cc'),project_id:gval('f_pi'),job_number:gval('f_jn'),workorder_id:gval('f_wo'),purchase_order_id:gval('f_po')};}
  function validateSetup(){
    const map={f_ws:'Workflow Stage',f_wst:'Workflow Status',f_wt:'Work Type',f_cc:'Client Code',f_pi:'Project ID',f_jn:'Job Number',f_wo:'Work Order ID',f_po:'Purchase Order ID'};
    for(const id in map){if(!gval(id)) return '"'+map[id]+'" is required';}
    return null;
  }
  function setStatus(msg,type){const e=qs('.sbar');if(!e) return;const c={info:'#a6adc8',success:'#a6e3a1',error:'#f38ba8',warn:'#fab387'};e.style.color=c[type||'info']||c.info;e.textContent=msg;}
  function showErr(sel,msg){const e=qs(sel);if(e){e.textContent=msg;e.style.display='block';}}
  function hideErr(sel){const e=qs(sel);if(e) e.style.display='none';}
  function tabs(){
    const order=['setup','layers','place','review'],labels=['1 · Setup','2 · Layers','3 · Place','4 · Review'],cur=order.indexOf(step);
    return order.map(function(s,i){return '<div class="'+(i<cur?'tab done':s===step?'tab active':'tab')+'">'+(i<cur?'✓ ':'')+labels[i]+'</div>';}).join('');
  }
  function snapBtnLabel(){return snapMode==='off'?'⊕ Snap: Off':snapMode==='soft'?'⊕ Snap: Soft':'⊕ Snap: Hard';}
  function snapBtnClass(){return snapMode==='off'?'btn btn-n':snapMode==='soft'?'btn btn-snap-soft':'btn btn-snap-hard';}
  function cycleSnap(){snapMode=snapMode==='off'?'soft':snapMode==='soft'?'hard':'off';const btn=qs('#btn-snap');if(btn){btn.className=snapBtnClass();btn.textContent=snapBtnLabel();}setStatus('Snap: '+snapMode,'info');}

  function ovrSection(idPrefix,state){
    return '<div class="ovr-sec">'
      +'<div class="ovr-title">Supervisor / Crew / Date / Status Override</div>'
      +'<div class="grid2">'
      +frow('Supervisor',mkSelect('supervisor',idPrefix+'_sup',state.supervisor||''))
      +frow('Crew',mkSelect('crew',idPrefix+'_crew',state.crew||''))
      +'</div><div class="grid2">'
      +frow('Installation Date',mkDate(idPrefix+'_idate',state.installation_date||''))
      +frow('Workflow Status Override',mkSelect('workflow_status',idPrefix+'_wso',state.workflow_status_ovr||''))
      +'</div></div>';
  }

  // ── Render: SETUP ─────────────────────────────────────────────────────
  function renderSetup(){
    const tmplCount=Object.keys(Tmpl.all()).length;
    return (tmplCount?'<div class="sec collapsed"><div class="sec-hdr clickable" onclick="this.closest(\'.sec\').classList.toggle(\'collapsed\')"><span>Saved Templates ('+tmplCount+')</span><span class="chevron">▼</span></div><div class="sec-body" style="padding:8px">'+renderTmplSection()+'</div></div>':'')
      +(pickMode?'<div class="pick-panel"><div class="pick-panel-title"><span>🎯 Pick from Map</span><button class="btn btn-r btn-sm" onclick="window.__pkgEndPick()">✕ Cancel</button></div>'
        +'<div class="pick-chk">'
        +'<label><input type="checkbox" id="pick_vault" '+(pickOpts.vault?'checked':'')+' onchange="window.__pkgPickOpt(\'vault\',this.checked)"> 🏗️ Vault</label>'
        +'<label><input type="checkbox" id="pick_conduit" '+(pickOpts.conduit?'checked':'')+' onchange="window.__pkgPickOpt(\'conduit\',this.checked)"> 🔵 Conduit/Span</label>'
        +'<label><input type="checkbox" id="pick_fiber" '+(pickOpts.fiber?'checked':'')+' onchange="window.__pkgPickOpt(\'fiber\',this.checked)"> 🟣 Fiber Cable</label>'
        +'</div><div id="pick-active-banner" class="pick-active-banner" style="display:none"><span>🖥️ Click a feature on the map…</span></div>'
        +'<button class="btn btn-b" style="width:100%" onclick="window.__pkgStartPick()">▶ Click Map to Pick</button></div>':'')
      +'<div class="sec"><div class="sec-hdr"><span>Workflow Fields</span><button class="btn btn-b btn-sm" id="btn-pick-toggle">🎯 Pick from Map</button></div>'
      +'<div class="sec-body"><div class="grid2">'
      +frow('Workflow Stage',mkSelect('workflow_stage','f_ws',cfg.workflow_stage),true)
      +frow('Workflow Status',mkSelect('workflow_status','f_wst',cfg.workflow_status),true)
      +frow('Work Type',mkSelect('work_type','f_wt',cfg.work_type),true)
      +frow('Client Code',mkSelect('client_code','f_cc',cfg.client_code),true)
      +'</div>'
      +frow('Project ID',mkSelect('project_id','f_pi',cfg.project_id),true)
      +'<div class="grid2">'
      +frow('Job Number',mkSelect('job_number','f_jn',cfg.job_number),true)
      +frow('Work Order ID',mkSelect('workorder_id','f_wo',cfg.workorder_id),true)
      +'</div>'
      +frow('Purchase Order ID',mkSelect('purchase_order_id','f_po',cfg.purchase_order_id),true)
      +'</div></div>'
      +'<div class="row">'
      +(currentTmplName?'<button class="btn btn-n" id="btn-sv-current">💾 Save to "'+currentTmplName+'"</button>':'<button class="btn btn-n" id="btn-sv-current" disabled>💾 Save to Current</button>')
      +'<button class="btn btn-n" id="btn-sv-new">💾 Save as New</button>'
      +'<button class="btn btn-p" id="btn-to-layers">Next →</button>'
      +'</div>'
      +'<div id="setup-err" class="errbx" style="display:none"></div>';
  }

  // ── Render: LAYERS ────────────────────────────────────────────────────
  function renderLayers(){
    const tmplCount=Object.keys(Tmpl.all()).length;
    return '<div class="sec collapsed"><div class="sec-hdr clickable" onclick="this.closest(\'.sec\').classList.toggle(\'collapsed\')">'
      +'<span>🏗️ Vault Options <span style="font-weight:400;color:#6c7086;font-size:10px">(optional)</span></span><span class="chevron">▼</span>'
      +'</div><div class="sec-body"><div class="grid2">'
      +frow('Vault Type',mkSelect('vault_type','v_vt',vCfg.vault_type))
      +frow('Vault Size',mkSelect('vault_size','v_vs',vCfg.vault_size))
      +frow('Vault Material',mkSelect('vault_material','v_vm',vCfg.vault_material))
      +frow('Physical Status',mkSelect('physical_status','v_ps',vCfg.physical_status))
      +'</div>'
      +frow('Vault Tier Rating',mkSelect('vault_tier_rating','v_vtr',vCfg.vault_tier_rating))
      +'<div class="grid2">'
      +frow('Vault Name Prefix',mkText('v_vname',vCfg.vault_name,'auto-generated if blank'))
      +frow('Assembly Code',mkText('v_acode',vCfg.assembly_code,'—'))
      +'</div>'
      +'<div style="margin-top:8px;padding-top:8px;border-top:1px solid #313244;">'
      +'<div class="ovr-title" style="color:#6c7086;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Supervisor / Crew / Date / Status</div>'
      +'<div class="grid2">'
      +frow('Supervisor',mkSelect('supervisor','v_sup',vCfg.supervisor||''))
      +frow('Crew',mkSelect('crew','v_crew',vCfg.crew||''))
      +'</div><div class="grid2">'
      +frow('Installation Date',mkDate('v_idate',vCfg.installation_date||''))
      +frow('Workflow Status Override',mkSelect('workflow_status','v_wso',vCfg.workflow_status_ovr||''))
      +'</div></div></div></div>'

      +'<div class="sec"><div class="sec-hdr">'
      +'<span>🔵 Conduit Stack <span class="badge bp" style="margin-left:5px">'+conduits.length+' row'+(conduits.length!==1?'s':'')+'</span></span>'
      +'<div style="display:flex;align-items:center;gap:8px">'
      +mkToggle('createConduit','Create',createConduit)
      +'<button class="btn btn-p btn-sm" id="btn-add-cd">+ Add Row</button>'
      +'</div></div>'
      +'<div style="'+(createConduit?'':'opacity:.35;pointer-events:none;')+'overflow-x:auto"><div id="cd-stk">'+renderConduitStack()+'</div></div>'
      +'<div style="padding:4px 10px 4px;font-size:9px;color:#585b70">Each row creates one span per vault-to-vault segment.</div>'
      +ovrSection('so',spanOverride)+'</div>'

      +'<div class="sec"><div class="sec-hdr">'
      +'<div style="display:flex;align-items:center;gap:8px">'
      +'<span>🟣 Fiber Stack <span class="badge bp" style="margin-left:5px">'+fibers.length+' row'+(fibers.length!==1?'s':'')+'</span></span>'
      +mkToggle('createFiber','Create',createFiber)
      +(createFiber?mkToggle('fiberSplit','Split per seg',fiberSplit):'')
      +'</div>'
      +'<button class="btn btn-p btn-sm" id="btn-add-fb">+ Add Row</button>'
      +'</div>'
      +'<div style="'+(createFiber?'':'opacity:.35;pointer-events:none;')+'overflow-x:auto"><div id="fb-stk">'+renderFiberStack()+'</div></div>'
      +'<div style="padding:4px 10px 4px;font-size:9px;color:#585b70">'+(createFiber?(fiberSplit?'One fiber per vault-to-vault segment.':'One fiber spanning all vaults.'):'Fiber creation disabled.')+'</div>'
      +ovrSection('fo',fiberOverride)+'</div>'

      +'<div class="row" style="margin-bottom:11px">'
      +(currentTmplName?'<button class="btn btn-n" id="btn-sv-current-2">💾 Save to "'+currentTmplName+'"</button>':'<button class="btn btn-n" id="btn-sv-current-2" disabled>💾 Save to Current</button>')
      +'<button class="btn btn-n" id="btn-sv-new-2">💾 Save as New</button></div>'
      +(tmplCount?'<div class="sec collapsed"><div class="sec-hdr clickable" onclick="this.closest(\'.sec\').classList.toggle(\'collapsed\')"><span>Templates ('+tmplCount+')</span><span class="chevron">▼</span></div><div class="sec-body" style="padding:8px">'+renderTmplSection()+'</div></div>':'')
      +'<div class="row"><button class="btn btn-n" id="btn-to-setup">← Back</button>'
      +'<button class="btn btn-p" id="btn-to-place">Next: Placement →</button></div>'
      +'<div id="layers-err" class="errbx" style="display:none"></div>';
  }

  function renderConduitStack(){
    if(!conduits.length) return '<div class="empty">No rows — click "+ Add Row"</div>';
    return '<table class="stk"><thead><tr>'
      +'<th>Diameter</th><th>Material</th><th>Method</th><th>Placement</th>'
      +'<th>Count</th><th>Inner&nbsp;Duct</th><th>Depth&nbsp;ft</th><th>Asm.&nbsp;Code</th><th></th>'
      +'</tr></thead><tbody>'
      +conduits.map(function(r){return '<tr>'
        +'<td>'+mkSelect('conduit_diameter','cd_d_'+r.id,r.conduit_diameter)+'</td>'
        +'<td>'+mkSelect('conduit_material','cd_m_'+r.id,r.conduit_material)+'</td>'
        +'<td>'+mkSelect('installation_method','cd_im_'+r.id,r.installation_method)+'</td>'
        +'<td>'+mkSelect('placement_type','cd_pt_'+r.id,r.placement_type)+'</td>'
        +'<td><input type="number" id="cd_cc_'+r.id+'" value="'+(r.conduit_count||'')+'" min="1" placeholder="#"></td>'
        +'<td>'+mkSelect('inner_duct','cd_id_'+r.id,r.inner_duct)+'</td>'
        +'<td><input type="number" id="cd_md_'+r.id+'" value="'+(r.minimum_depth||'')+'" min="0" placeholder="ft"></td>'
        +'<td><input type="text" id="cd_ac_'+r.id+'" value="'+(r.assembly_code||'')+'" placeholder="—"></td>'
        +'<td><button class="btn btn-r btn-sm" onclick="window.__pkgDelCd(\''+r.id+'\')">✕</button></td>'
        +'</tr>';}).join('')+'</tbody></table>';
  }

  function renderFiberStack(){
    if(!fibers.length) return '<div class="empty">No rows — click "+ Add Row"</div>';
    return '<table class="stk"><thead><tr>'
      +'<th>Fiber&nbsp;Ct</th><th>Buffer&nbsp;Ct</th><th>Category</th><th>Cable&nbsp;Type</th>'
      +'<th>Sheath</th><th>Core</th><th>Method</th><th>Placement</th>'
      +'<th>Cable&nbsp;Name</th><th>Asm.&nbsp;Code</th><th></th>'
      +'</tr></thead><tbody>'
      +fibers.map(function(r){return '<tr>'
        +'<td>'+mkSelect('fiber_count','fb_fc_'+r.id,r.fiber_count)+'</td>'
        +'<td>'+mkSelect('buffer_count','fb_bc_'+r.id,r.buffer_count)+'</td>'
        +'<td>'+mkSelect('cable_category','fb_ca_'+r.id,r.cable_category)+'</td>'
        +'<td>'+mkSelect('cable_type','fb_ct_'+r.id,r.cable_type)+'</td>'
        +'<td>'+mkSelect('sheath_type','fb_st_'+r.id,r.sheath_type)+'</td>'
        +'<td>'+mkSelect('core_type','fb_co_'+r.id,r.core_type)+'</td>'
        +'<td>'+mkSelect('cable_installation_method','fb_im_'+r.id,r.installation_method)+'</td>'
        +'<td>'+mkSelect('cable_placement_type','fb_pt_'+r.id,r.placement_type)+'</td>'
        +'<td><input type="text" id="fb_cn_'+r.id+'" value="'+(r.cable_name||'')+'" placeholder="auto"></td>'
        +'<td><input type="text" id="fb_ac_'+r.id+'" value="'+(r.assembly_code||'')+'" placeholder="—"></td>'
        +'<td><button class="btn btn-r btn-sm" onclick="window.__pkgDelFb(\''+r.id+'\')">✕</button></td>'
        +'</tr>';}).join('')+'</tbody></table>';
  }

  // ── Point label / item HTML ───────────────────────────────────────────
  function ptLabel(p){
    if(p.existingVault) return{icon:'🏛️',cls:'pt-exist-vault',text:'Exist. Vault'};
    if(p.gapBefore)     return{icon:'✂️', cls:'pt-exist-vault',text:'Seg. Break'};
    if(p.noVault)       return{icon:'✕', cls:'pt-free',       text:'Free Pt'};
    return                     {icon:'📍',cls:'pt-new-vault',  text:'New Vault'};
  }
  function ptItemHTML(p,i){
    const lbl=ptLabel(p);
    const dist=i>0?'<span style="color:#585b70;font-size:9px">+'+Geo.dist(pts[i-1].pt,p.pt).toLocaleString()+' ft</span>':'<span></span>';
    return '<div class="pitem" data-ptidx="'+i+'">'
      +'<span class="'+lbl.cls+'">'+lbl.icon+' '+lbl.text+' '+(i+1)+'</span>'
      +'<span style="color:#6c7086;font-size:9px">'+p.pt.x.toFixed(0)+', '+p.pt.y.toFixed(0)+'</span>'
      +dist
      +'<button class="btn btn-r btn-sm pitem-del" onclick="window.__pkgDelPt('+i+');event.stopPropagation()">✕</button>'
      +'</div>';
  }
  window.__pkgDelPt=function(idx){
    if(idx<0||idx>=pts.length) return;
    rmTag('hover-hl');
    pts.splice(idx,1);
    rmTag('vault');rmTag('line');
    pts.forEach(function(p,i){addMarker(p.pt,i,p.noVault,p.existingVault||p.gapBefore);});
    if(bearingLock){
      const vaults=pts.filter(function(p){return !p.noVault;});
      if(vaults.length>=2) lockedBearing=Geo.bearing(vaults[vaults.length-2].pt,vaults[vaults.length-1].pt);
      else{bearingLock=false;lockedBearing=null;}
    }
    refreshPlaceUI();
    setStatus('Point '+(idx+1)+' removed.','info');
  };
  window.__pkgHoverPt=function(idx){
    if(!gl||!window.__pkgGr||idx<0||idx>=pts.length) return;
    rmTag('hover-hl');
    const pt=pts[idx].pt;
    gl.add(new window.__pkgGr({geometry:pt,symbol:{type:'simple-marker',style:'circle',
      color:[255,220,0,1],size:'26px',outline:{color:[255,255,255,1],width:4}},
      attributes:{_pkg:'hover-hl'}}));
  };
  window.__pkgUnhoverPt=function(){rmTag('hover-hl');};
  function attachPlistHoverListeners(){
    const plistEl=qs('#plist');if(!plistEl) return;
    plistEl.querySelectorAll('[data-ptidx]').forEach(function(item){
      item.addEventListener('mouseenter',function(){window.__pkgHoverPt(parseInt(item.dataset.ptidx));});
      item.addEventListener('mouseleave',function(){window.__pkgUnhoverPt();});
    });
  }

  // ── Render: PLACE ─────────────────────────────────────────────────────
  function renderPlace(){
    const newVaultCt=pts.filter(function(p){return !p.noVault;}).length;
    const existVaultCt=pts.filter(function(p){return !!p.existingVault;}).length;
    const freeCt=pts.filter(function(p){return p.noVault&&!p.existingVault&&!p.gapBefore;}).length;
    const gapCt=pts.filter(function(p){return !!p.gapBefore;}).length;
    const segs=buildSegments(pts).length;
    const len=pts.length>1?Geo.totalLen(pts.map(function(p){return p.pt;})):0;
    const arcLabels=['start of curve','midpoint along curve','end of curve'];
    const lockLabel=bearingLock&&lockedBearing!==null?' '+lockedBearing.toFixed(0)+'°':'';

    return '<div class="trace-sec">'
      +'<div class="trace-sec-title"><span>🔍 Trace Path</span>'
      +(traceMode?'<button class="btn btn-r btn-sm" onclick="window.__pkgCancelTrace()">✕ Cancel</button>':'')
      +'</div>'
      +(traceMode?'<div class="trace-active"><span style="font-size:14px">✏️</span><span>Sketching — click points, <strong>double-click</strong> to finish</span></div>':'')
      +'<div style="display:flex;gap:7px;align-items:center;'+(traceMode?'opacity:.4;pointer-events:none;':'')+'">'
      +'<button class="btn btn-b" id="btn-trace" style="flex:2">🔍 Trace Path</button>'
      +'<label style="display:flex;align-items:center;gap:4px;font-size:10px;color:#a6adc8;white-space:nowrap;">Buffer<input type="number" id="trace-buf" value="20" min="1" max="1000" style="width:50px">ft</label>'
      +'</div>'
      +'<div style="font-size:9px;color:#585b70;margin-top:5px;">Sketches a line → finds underlying span/fiber → snaps conduit splits to existing vaults.</div>'
      +'</div>'

      +'<div class="sec"><div class="sec-body" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">'
      +'<span class="badge bp">'+newVaultCt+' new vault'+(newVaultCt!==1?'s':'')+'</span>'
      +(existVaultCt?'<span class="badge bo">'+existVaultCt+' exist. split'+(existVaultCt!==1?'s':'')+'</span>':'')
      +(gapCt?'<span class="badge bo">'+gapCt+' seg break'+(gapCt!==1?'s':'')+'</span>':'')
      +(freeCt?'<span class="badge bb">'+freeCt+' free pt'+(freeCt!==1?'s':'')+'</span>':'')
      +'<span class="badge bp">'+segs+' seg'+(segs!==1?'s':'')+'</span>'
      +(len?'<span style="margin-left:auto;font-size:10px;color:#a6adc8">~'+len.toLocaleString()+' ft</span>':'')
      +'</div></div>'

      +(active&&pts.length?'<div class="bearing-bar" id="bearing-bar"><div><div style="font-size:9px;color:#6c7086;margin-bottom:1px">BEARING</div><div class="bearing-val" id="bearing-val">—</div></div><div style="flex:1"><span class="bearing-snap-ind" id="bearing-snap-ind" style="background:#313244;color:#585b70">Free</span></div><div style="font-size:9px;color:#585b70;text-align:right">'+snapBtnLabel()+'<br>'+(bearingLock?'🔒 Lock ON':'Lock OFF')+'</div></div>':'')

      +(arcMode?'<div class="arc-guide">'
        +'<span class="arc-step '+(arcPts.length>0?'done':'cur')+'">1</span>'
        +'<span class="arc-step '+(arcPts.length>1?'done':arcPts.length===1?'cur':'wait')+'">2</span>'
        +'<span class="arc-step '+(arcPts.length>2?'done':arcPts.length===2?'cur':'wait')+'">3</span>'
        +'<div><div style="font-weight:700">⌒ Arc — click the <em>'+(arcLabels[arcPts.length]||'complete')+'</em></div>'
        +'<div class="arc-density-row">Spacing: <input type="number" id="arc-density-inp" value="'+arcDensity+'" min="10" max="500"> ft &nbsp;'
        +'<button class="btn btn-r btn-sm" onclick="window.__pkgCancelArc()">Cancel</button></div></div></div>':'')

      +'<div class="sec"><div class="sec-hdr" style="cursor:default">'
      +'<span>Placed Points</span>'
      +'<span style="font-size:9px;color:#6c7086">'
      +'<span style="color:#cba6f7">■</span> New Vault &nbsp;'
      +'<span style="color:#fab387">◆</span> Exist./Break &nbsp;'
      +'<span style="color:#89dceb">✕</span> Free Pt'
      +'</span>'
      +'</div>'
      +'<div class="sec-body" style="padding:6px"><div class="plist" id="plist">'
      +(pts.length?pts.map(function(p,i){return ptItemHTML(p,i);}).join(''):'<div class="empty">Trace a path or enable placement and click the map.</div>')
      +'</div></div></div>'

      +'<div class="row" style="margin-bottom:6px">'
      +'<button class="btn btn-g" id="btn-enable" '+(active?'disabled':'')+'>▶ Enable</button>'
      +'<button class="btn btn-n" id="btn-disable" '+(!active?'disabled':'')+'>⏹ Stop</button>'
      +'</div>'
      +'<div class="row" style="margin-bottom:5px">'
      +'<button class="btn btn-n '+(waypointMode?'btn-active':'')+'" id="btn-waypoint" style="flex:1">✕ Free Pt'+(waypointMode?' ON':'')+'</button>'
      +'<button class="btn btn-n '+(arcMode?'btn-arc-on':'')+'" id="btn-arc" style="flex:1">⌒ Arc'+(arcMode?' ON':'')+'</button>'
      +'</div>'
      +'<div class="row" style="margin-bottom:5px">'
      +'<button class="'+snapBtnClass()+'" id="btn-snap" style="flex:1">'+snapBtnLabel()+'</button>'
      +'<button class="btn btn-n '+(bearingLock?'btn-lock-on':'')+'" id="btn-lock" style="flex:1" '+(pts.length<2?'disabled':'')+'>🔒 Lock'+lockLabel+'</button>'
      +'</div>'
      +'<div class="row" style="margin-bottom:6px">'
      +'<button class="btn btn-n '+(showVertexHighlight?'btn-active':'')+'" id="btn-vh" style="flex:1">◆ Vertices: '+(showVertexHighlight?'ON':'OFF')+'</button>'
      +'</div>'
      +'<div class="row" style="margin-bottom:6px">'
      +'<button class="btn btn-n '+(copyGeoMode?'btn-active':'')+'" id="btn-copy-geo" style="flex:2">📋 Copy Geometry</button>'
      +'<button class="btn btn-n btn-sm '+(copyGeoAddVaults?'btn-active':'')+'" id="btn-copy-vaults" onclick="window.__pkgCGV()" style="white-space:nowrap">Vaults: '+(copyGeoAddVaults?'ON':'OFF')+'</button>'
      +'</div>'
      +'<div class="row" style="margin-bottom:6px">'
      +'<button class="btn btn-o" id="btn-undo" '+(pts.length?'':'disabled')+'>↩ Undo</button>'
      +'<button class="btn btn-r" id="btn-clear" '+(pts.length?'':'disabled')+'>✕ Clear</button>'
      +'</div>'
      +'<div class="row">'
      +'<button class="btn btn-n" id="btn-to-layers">← Back</button>'
      +'<button class="btn btn-p" id="btn-to-review" '+(pts.length<2?'disabled':'')+'>Review →</button>'
      +'</div>'
      +'<div class="sec collapsed" style="margin-top:8px">'
      +'<div class="sec-hdr clickable" onclick="this.closest(\'.sec\').classList.toggle(\'collapsed\')"><span>⌨️ Keyboard Shortcuts</span><span class="chevron">▼</span></div>'
      +'<div class="sec-body"><div class="hk-grid">'
      +'<span class="hk-key">F</span><span class="hk-desc">Toggle free point mode</span>'
      +'<span class="hk-key">A</span><span class="hk-desc">Toggle arc mode</span>'
      +'<span class="hk-key">S</span><span class="hk-desc">Cycle snap: Off → Soft → Hard</span>'
      +'<span class="hk-key">L</span><span class="hk-desc">Toggle bearing lock</span>'
      +'<span class="hk-key">Z / Esc</span><span class="hk-desc">Undo / cancel arc</span>'
      +'<span class="hk-key">Enter</span><span class="hk-desc">Advance to review</span>'
      +'<span class="hk-key">Shift+Click</span><span class="hk-desc">Place free point</span>'
      +'</div></div></div>';
  }

  // ── Render: REVIEW ────────────────────────────────────────────────────
  function renderReview(){
    const newVaultCt=pts.filter(function(p){return !p.noVault;}).length;
    const existVaultCt=pts.filter(function(p){return !!p.existingVault;}).length;
    const freeCt=pts.filter(function(p){return p.noVault&&!p.existingVault&&!p.gapBefore;}).length;
    const segments=buildSegments(pts),segCt=segments.length;
    const sCt=createConduit?segCt*conduits.length:0;
    const fCt=createFiber?(fiberSplit?segCt*fibers.length:fibers.length):0;
    const total=newVaultCt+sCt+fCt;
    const len=Geo.totalLen(pts.map(function(p){return p.pt;}));
    return '<div class="sec"><div class="sec-hdr" style="cursor:default">Package Summary — '+total+' features</div>'
      +'<div class="sec-body" style="padding:6px"><table class="rvtbl">'
      +'<tr><td>New Vaults</td><td><span class="badge bp">'+newVaultCt+'</span></td></tr>'
      +(existVaultCt?'<tr><td>Existing Vault Splits</td><td><span class="badge bo">'+existVaultCt+'</span></td></tr>':'')
      +(freeCt?'<tr><td>Free Points</td><td><span class="badge bb">'+freeCt+'</span></td></tr>':'')
      +'<tr><td>Segments</td><td><span class="badge bp">'+segCt+'</span></td></tr>'
      +'<tr><td>Spans</td><td><span class="badge '+(createConduit?'bp':'br')+'">'+( createConduit?segCt+' × '+conduits.length+' = '+sCt:'disabled')+'</span></td></tr>'
      +'<tr><td>Fiber Cables</td><td><span class="badge '+(createFiber?'bp':'br')+'">'+( createFiber?(fiberSplit?segCt+' × '+fibers.length+' = '+fCt:fibers.length+' (full span)'):'disabled')+'</span></td></tr>'
      +'<tr><td>Total Length</td><td>~'+len.toLocaleString()+' ft</td></tr>'
      +'<tr><td>Project</td><td>'+cfg.project_id+'</td></tr>'
      +'<tr><td>Job / WO</td><td>'+cfg.job_number+' / '+cfg.workorder_id+'</td></tr>'
      +'<tr><td>Workflow</td><td>'+cfg.workflow_stage+' · '+cfg.workflow_status+'</td></tr>'
      +'</table></div></div>'
      +'<div id="prog-wrap" style="display:none;margin-bottom:8px">'
      +'<div id="prog-lbl" style="font-size:10px;color:#a6adc8;margin-bottom:4px">Creating features…</div>'
      +'<div class="pbwrap"><div class="pbfill" id="pbfill"></div></div></div>'
      +'<div class="row" style="margin-top:4px">'
      +'<button class="btn btn-n" id="btn-to-place">← Back</button>'
      +'<button class="btn btn-g" id="btn-commit">✅ Commit Package</button>'
      +'</div><div id="rv-result"></div>';
  }

  // ── Main Render ───────────────────────────────────────────────────────
  function render(){
    let body='';
    if(step==='setup')  body=renderSetup();
    if(step==='layers') body=renderLayers();
    if(step==='place')  body=renderPlace();
    if(step==='review') body=renderReview();
    box.innerHTML='<div class="hdr"><span style="font-size:15px">📦</span><span class="hdr-title">Package Creator v4</span><button class="hdr-close" id="btn-close">✕</button></div>'
      +'<div class="tabs">'+tabs()+'</div><div class="body">'+body+'</div><div class="sbar">Ready.</div>';
    bind();makeDraggable();initSearchSelects();
    if(step==='place') updateTraceBtn();
  }

  // ── Bind ──────────────────────────────────────────────────────────────
  function bind(){
    function on(id,ev,fn){const e=qs('#'+id);if(e) e.addEventListener(ev,fn);}
    on('btn-close','click',function(){
      disableTool();disableCopyGeo();disableTracePath();endPick();clearGL();
      styleEl.remove();document.removeEventListener('click',closeAllDrops);box.remove();
    });
    if(step==='setup'){
      on('btn-pick-toggle','click',function(){pickMode=!pickMode;render();});
      on('btn-sv-current','click',function(){const err=validateSetup();if(err){showErr('#setup-err',err);return;}doSaveTemplate(currentTmplName);});
      on('btn-sv-new','click',function(){const err=validateSetup();if(err){showErr('#setup-err',err);return;}const name=prompt('Template name:');if(!name)return;doSaveTemplate(name);});
      on('btn-to-layers','click',function(){const err=validateSetup();if(err){showErr('#setup-err',err);return;}hideErr('#setup-err');saveCfg();step='layers';render();});
    }
    if(step==='layers'){
      on('btn-to-setup','click',function(){saveVCfg();saveConduits();saveFibers();saveSpanOverride();saveFiberOverride();step='setup';render();});
      on('btn-to-place','click',function(){saveVCfg();saveConduits();saveFibers();saveSpanOverride();saveFiberOverride();step='place';render();initGL();});
      on('btn-add-cd','click',function(){saveConduits();conduits.push({id:uid()});const el=qs('#cd-stk');if(el){el.innerHTML=renderConduitStack();initSearchSelects(el);}});
      on('btn-add-fb','click',function(){saveFibers();fibers.push({id:uid()});const el=qs('#fb-stk');if(el){el.innerHTML=renderFiberStack();initSearchSelects(el);}});
      on('btn-sv-current-2','click',function(){if(!currentTmplName)return;doSaveTemplate(currentTmplName);});
      on('btn-sv-new-2','click',function(){const name=prompt('Template name:');if(!name)return;doSaveTemplate(name);});
    }
    if(step==='place'){
      on('btn-trace','click',function(){if(traceMode){disableTracePath();return;}initGL().then(function(){enableTracePath();});});
      on('btn-enable','click',function(){disableTracePath();enableTool();});
      on('btn-disable','click',disableTool);
      on('btn-waypoint','click',toggleFreePoint);
      on('btn-arc','click',toggleArc);
      on('btn-snap','click',cycleSnap);
      on('btn-lock','click',toggleBearingLock);
      on('btn-vh','click',function(){initGL().then(function(){toggleVertexHighlight();});});
      on('btn-copy-geo','click',function(){initGL().then(function(){if(copyGeoMode){disableCopyGeo();}else{disableTracePath();enableCopyGeo();}});});
      on('btn-to-layers','click',function(){disableTool();disableTracePath();cancelArc();step='layers';render();});
      on('btn-to-review','click',function(){disableTool();disableTracePath();cancelArc();step='review';render();});
      on('btn-undo','click',undoLast);
      on('btn-clear','click',function(){pts=[];clearGL();waypointMode=false;cancelArc();bearingLock=false;lockedBearing=null;refreshPlaceUI();setStatus('All points cleared.','info');});
      attachPlistHoverListeners();
    }
    if(step==='review'){
      on('btn-to-place','click',function(){step='place';render();});
      on('btn-commit','click',commitPackage);
    }
  }

  // ── Mode Toggles ──────────────────────────────────────────────────────
  function toggleFreePoint(){
    if(arcMode){arcMode=false;cancelArc();}
    waypointMode=!waypointMode;
    const btn=qs('#btn-waypoint');
    if(btn){btn.classList.toggle('btn-active',waypointMode);btn.textContent=waypointMode?'✕ Free Pt ON':'✕ Free Pt';}
    setStatus(waypointMode?'Free point mode ON.':'Free point mode OFF.','info');
  }
  function toggleArc(){waypointMode=false;arcMode=!arcMode;arcPts=[];clearArcGuides();if(arcMode) setStatus('Arc Mode: click the start point.','warn');render();}
  function toggleBearingLock(){
    if(bearingLock){bearingLock=false;lockedBearing=null;setStatus('Bearing lock off.','info');}
    else{
      const vaults=pts.filter(function(p){return !p.noVault;});
      const p1=vaults.length>=2?vaults[vaults.length-2].pt:pts.length>=2?pts[pts.length-2].pt:null;
      const p2=vaults.length>=1?vaults[vaults.length-1].pt:pts.length>=1?pts[pts.length-1].pt:null;
      if(!p1||!p2){setStatus('Need at least 2 points to lock a bearing.','warn');return;}
      lockedBearing=Geo.bearing(p1,p2);bearingLock=true;
      setStatus('🔒 Bearing locked to '+lockedBearing.toFixed(1)+'°','success');
    }
    render();
  }

  // ── Placement ─────────────────────────────────────────────────────────
  function enableTool(){
    active=true;
    clickH=mv.on('click',handleClick);
    moveH=mv.on('pointer-move',function(e){
      if(!active||arcMode||copyGeoMode) return;
      if(!pts.length){clearPreview();return;}
      updatePreview(mv.toMap({x:e.x,y:e.y}));
      scheduleSnapHover(e);
    });
    keyH=handleKey;
    document.addEventListener('keydown',keyH);
    mv.container.style.cursor='crosshair';
    const en=qs('#btn-enable'),di=qs('#btn-disable');
    if(en) en.disabled=true;if(di) di.disabled=false;
    setStatus('Placement active — click map to place vaults.');
    render();
  }
  function disableTool(){
    active=false;
    if(clickH){clickH.remove();clickH=null;}
    if(moveH){moveH.remove();moveH=null;}
    if(keyH){document.removeEventListener('keydown',keyH);keyH=null;}
    if(mv&&mv.container) mv.container.style.cursor='default';
    removeSnapRing();clearPreview();clearVertexHighlights();
    if(extentWatchH){extentWatchH.remove();extentWatchH=null;}showVertexHighlight=false;
    const en=qs('#btn-enable'),di=qs('#btn-disable');
    if(en) en.disabled=false;if(di) di.disabled=true;
    setStatus('Placement stopped.');render();
  }
  function cancelArc(){arcMode=false;arcPts=[];clearArcGuides();}

  async function handleClick(evt){
    if(!active||copyGeoMode||traceMode) return;
    evt.stopPropagation();
    if(arcMode){
      const dinp=qs('#arc-density-inp');if(dinp) arcDensity=Math.max(10,parseInt(dinp.value)||50);
      const pt=mv.toMap({x:evt.x,y:evt.y});
      arcPts.push(pt);addArcGuideMarker(pt,arcPts.length);
      if(arcPts.length<3){setStatus('Arc: click the '+['','midpoint along curve','end of curve'][arcPts.length]+'…','warn');render();return;}
      const wps=generateArcWaypoints(arcPts[0],arcPts[1],arcPts[2],arcDensity);
      clearArcGuides();
      wps.forEach(function(wp){pts.push({pt:wp,noVault:true});addMarker(wp,pts.length-1,true);});
      cancelArc();refreshPlaceUI();render();
      setStatus('⌒ Arc complete — '+wps.length+' free points added.','success');
      return;
    }
    const isFree=waypointMode||(evt.native&&evt.native.shiftKey);
    const snap=await findSnap(evt);
    let finalPt,entry;
    if(snap){
      finalPt=snap.pt;
      removeSnapRing();
      if(snap.type==='vault'){
        // Snapped to an existing layer vault — always a split point, never a new feature
        entry={pt:finalPt,noVault:true,existingVault:true};
        setStatus('🏛️ Snapped to existing vault — conduit/fiber will split here.','warn');
      } else {
        // Snapped to a line vertex — respect current placement mode
        entry={pt:finalPt,noVault:isFree};
        setStatus('🔷 Snapped to line vertex.','warn');
      }
    } else {
      finalPt=pendingPt||resolvePoint(mv.toMap({x:evt.x,y:evt.y})).commitPt;
      entry={pt:finalPt,noVault:isFree};
    }
    pts.push(entry);
    addMarker(finalPt,pts.length-1,entry.noVault,entry.existingVault);
    clearPreview();
    if(bearingLock&&!entry.noVault){
      const vaults=pts.filter(function(p){return !p.noVault;});
      if(vaults.length>=2) lockedBearing=Geo.bearing(vaults[vaults.length-2].pt,vaults[vaults.length-1].pt);
    }
    refreshPlaceUI();
    const typeLabel=entry.existingVault?'🏛️ Exist. vault split':entry.noVault?'✕ Free point':'📍 New vault';
    setStatus(typeLabel+' '+pts.length+' placed.'+(pts.length>=2?' Enter to review.':' Place 1 more.'),'info');
  }

  function handleKey(e){
    if(!active) return;
    if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
    const k=e.key.toUpperCase();
    if(k==='F'){e.preventDefault();toggleFreePoint();return;}
    if(k==='A'){e.preventDefault();toggleArc();return;}
    if(k==='S'){e.preventDefault();cycleSnap();return;}
    if(k==='L'){e.preventDefault();toggleBearingLock();return;}
    if(k==='Z'||e.key==='Escape'){
      e.preventDefault();
      if(copyGeoMode){disableCopyGeo();setStatus('Copy geometry finished.','info');return;}
      if(arcMode){cancelArc();render();setStatus('Arc cancelled.');return;}
      undoLast();return;
    }
    if(e.key==='Enter'&&pts.length>=2&&!arcMode){disableTool();step='review';render();}
  }

  function undoLast(){
    if(arcMode&&arcPts.length){arcPts.pop();clearArcGuides();arcPts.forEach(function(p,i){addArcGuideMarker(p,i+1);});render();setStatus('Arc point removed.','warn');return;}
    if(!pts.length) return;
    pts.pop();removeLastMarker();clearPreview();
    if(bearingLock){
      const vaults=pts.filter(function(p){return !p.noVault;});
      if(vaults.length>=2) lockedBearing=Geo.bearing(vaults[vaults.length-2].pt,vaults[vaults.length-1].pt);
      else{bearingLock=false;lockedBearing=null;}
    }
    refreshPlaceUI();
    setStatus(pts.length?'Point '+(pts.length+1)+' removed.':'All points cleared.');
  }

  function refreshPlaceUI(){
    const listEl=qs('#plist');
    if(listEl){
      listEl.innerHTML=pts.length
        ?pts.map(function(p,i){return ptItemHTML(p,i);}).join('')
        :'<div class="empty">Trace a path or enable placement and click the map.</div>';
    }
    const newV=pts.filter(p=>!p.noVault).length;
    const exV=pts.filter(p=>!!p.existingVault).length;
    const gapV=pts.filter(p=>!!p.gapBefore).length;
    const freeV=pts.filter(p=>p.noVault&&!p.existingVault&&!p.gapBefore).length;
    const segs=buildSegments(pts).length;
    const badgeEl=qs('.sec .sec-body');
    if(badgeEl&&badgeEl.querySelector('.badge')){
      badgeEl.innerHTML=''
        +'<span class="badge bp">'+newV+' new vault'+(newV!==1?'s':'')+'</span>'
        +(exV?'<span class="badge bo">'+exV+' exist. split'+(exV!==1?'s':'')+'</span>':'')
        +(gapV?'<span class="badge bo">'+gapV+' seg break'+(gapV!==1?'s':'')+'</span>':'')
        +(freeV?'<span class="badge bb">'+freeV+' free pt'+(freeV!==1?'s':'')+'</span>':'')
        +'<span class="badge bp">'+segs+' seg'+(segs!==1?'s':'')+'</span>'
        +(pts.length>1?'<span style="margin-left:auto;font-size:10px;color:#a6adc8">~'+Geo.totalLen(pts.map(p=>p.pt)).toLocaleString()+' ft</span>':'');
    }
    const undo=qs('#btn-undo'),clr=qs('#btn-clear'),rev=qs('#btn-to-review'),lock=qs('#btn-lock');
    if(undo) undo.disabled=!pts.length;
    if(clr)  clr.disabled=!pts.length;
    if(rev)  rev.disabled=pts.length<2;
    if(lock) lock.disabled=pts.length<2;
    attachPlistHoverListeners();
  }

  // ── Commit ────────────────────────────────────────────────────────────
  async function commitPackage(){
    // Disable all interaction modes immediately so map clicks don't fire during commit
    disableCopyGeo(); disableTracePath(); endPick(); disableTool();

    const commitBtn=qs('#btn-commit'),backBtn=qs('#btn-to-place');
    if(commitBtn) commitBtn.disabled=true;
    if(backBtn)   backBtn.disabled=true;
    const progWrap=qs('#prog-wrap'),progLbl=qs('#prog-lbl'),pbFill=qs('#pbfill');
    if(progWrap) progWrap.style.display='block';
    function setP(pct,msg){if(pbFill)pbFill.style.width=pct+'%';if(progLbl)progLbl.textContent=msg;setStatus(msg,'info');}
    const log={vaults:[],spans:[],fibers:[],errors:[]};
    try {
      const vl=mv.map.allLayers.find(function(l){return l.layerId===LAYERS.vault.id;});
      const sl=mv.map.allLayers.find(function(l){return l.layerId===LAYERS.span.id;});
      const cl=mv.map.allLayers.find(function(l){return l.layerId===LAYERS.cable.id;});
      if(!vl) throw new Error('Vault layer not found');
      if(createConduit&&!sl) throw new Error('Span layer not found');
      if(createFiber&&fibers.length&&!cl) throw new Error('Fiber cable layer not found');

      const base={workflow_stage:cfg.workflow_stage,workflow_status:cfg.workflow_status,work_type:cfg.work_type,
        client_code:cfg.client_code,project_id:cfg.project_id,job_number:cfg.job_number,
        purchase_order_id:cfg.purchase_order_id,workorder_id:cfg.workorder_id,delete_feature:'NO',construction_status:'NA'};

      // Build vault options — handle vault_name and assembly_code separately
      const vaultOpts={};
      for(const k in vCfg){
        if(vCfg[k]!==''&&k!=='workflow_status_ovr'&&k!=='vault_name') vaultOpts[k]=vCfg[k];
      }
      if(vCfg.workflow_status_ovr) vaultOpts.workflow_status=vCfg.workflow_status_ovr;
      const vaultNamePfx=vCfg.vault_name||null; // user prefix, or auto-generate below

      const spanOvrAttrs=overrideAttrs(spanOverride);
      const fiberOvrAttrs=overrideAttrs(fiberOverride);
      const segments=buildSegments(pts);
      const segCt=segments.length;
      const newVaultPts=pts.filter(function(p){return !p.noVault;});
      const vaultCount=newVaultPts.length;
      const spanTotal=createConduit?segCt*conduits.length:0;
      const fiberTotal=createFiber?(fiberSplit?segCt*fibers.length:fibers.length):0;
      const grandTotal=vaultCount+spanTotal+fiberTotal;
      let done=0;
      function tick(msg){done++;setP(Math.round(done/Math.max(grandTotal,1)*100),msg);}

      // Vaults
      for(let i=0;i<pts.length;i++){
        if(pts[i].noVault) continue;
        const vname=vaultNamePfx
          ?(vaultNamePfx+'_'+(log.vaults.length+1))
          :('Vault_'+Date.now()+'_'+(log.vaults.length+1));
        const attrs=Object.assign({},base,vaultOpts,{vault_name:vname});
        try {
          const id=await createFeat(vl,pts[i].pt,attrs);
          log.vaults.push(id);
        } catch(e) { log.errors.push('Vault '+(i+1)+': '+e.message); }
        tick('Creating vaults… '+log.vaults.length+'/'+vaultCount);
      }

      // Spans
      if(createConduit){
        for(let ri=0;ri<conduits.length;ri++){
          const rv=readConduit(conduits[ri]);
          const spanOpts={};
          for(const k in rv){if(rv[k]!=='') spanOpts[k]=rv[k];}
          if(spanOpts.conduit_count) spanOpts.conduit_count=parseInt(spanOpts.conduit_count);
          if(spanOpts.minimum_depth) spanOpts.minimum_depth=parseInt(spanOpts.minimum_depth);
          for(let si=0;si<segments.length;si++){
            const segPts=segments[si];
            const geom={type:'polyline',paths:[segPts.map(function(p){return[p.x,p.y];})],spatialReference:segPts[0].spatialReference};
            const attrs=Object.assign({},base,spanOpts,spanOvrAttrs,{calculated_length:Geo.totalLen(segPts)});
            try {
              const id=await createFeat(sl,geom,attrs);
              log.spans.push(id);
            } catch(e) { log.errors.push('Span seg '+(si+1)+' row '+(ri+1)+': '+e.message); }
            tick('Creating spans… row '+(ri+1)+'/'+conduits.length+', seg '+(si+1)+'/'+segCt);
          }
        }
      }

      // Fibers
      if(createFiber){
        for(let ri=0;ri<fibers.length;ri++){
          const rv=readFiber(fibers[ri]);
          // Extract cable_name and assembly_code; build fibOpts without cable_name
          // (we compute the final name below with segment suffix if needed)
          const userCableName=rv.cable_name||null;
          const fibOpts={};
          for(const k in rv){if(rv[k]!==''&&k!=='cable_name') fibOpts[k]=rv[k];}
          if(fibOpts.fiber_count)  fibOpts.fiber_count=parseInt(fibOpts.fiber_count);
          if(fibOpts.buffer_count) fibOpts.buffer_count=parseInt(fibOpts.buffer_count);
          if(fiberSplit){
            for(let si=0;si<segments.length;si++){
              const segPts=segments[si];
              const name=userCableName
                ?(userCableName+'_seg'+(si+1))
                :('Fiber_'+Date.now()+'_r'+(ri+1)+'_s'+(si+1));
              const geom={type:'polyline',paths:[segPts.map(function(p){return[p.x,p.y];})],spatialReference:segPts[0].spatialReference};
              const attrs=Object.assign({},base,fibOpts,fiberOvrAttrs,{cable_name:name,calculated_length:Geo.totalLen(segPts)});
              try {
                const id=await createFeat(cl,geom,attrs);
                log.fibers.push(id);
              } catch(e) { log.errors.push('Fiber seg '+(si+1)+' row '+(ri+1)+': '+e.message); }
              tick('Creating fiber… row '+(ri+1)+'/'+fibers.length+', seg '+(si+1)+'/'+segCt);
            }
          } else {
            const name=userCableName||('Fiber_'+Date.now()+'_r'+(ri+1));
            const geom={type:'polyline',paths:[pts.map(function(p){return[p.pt.x,p.pt.y];})],spatialReference:pts[0].pt.spatialReference};
            const attrs=Object.assign({},base,fibOpts,fiberOvrAttrs,{cable_name:name,calculated_length:Geo.totalLen(pts.map(function(p){return p.pt;}))});
            try {
              const id=await createFeat(cl,geom,attrs);
              log.fibers.push(id);
            } catch(e) { log.errors.push('Fiber row '+(ri+1)+': '+e.message); }
            tick('Creating fiber… row '+(ri+1)+'/'+fibers.length);
          }
        }
      }

      setP(100,'Done!');clearGL();
      const rvRes=qs('#rv-result');
      if(rvRes){
        if(!log.errors.length){
          rvRes.innerHTML='<div class="okbx">✅ Package created!<br>'
            +'<strong>'+log.vaults.length+'</strong> vaults &nbsp;·&nbsp; '
            +'<strong>'+log.spans.length+'</strong> spans &nbsp;·&nbsp; '
            +'<strong>'+log.fibers.length+'</strong> fiber cables</div>'
            +'<div class="row" style="margin-top:8px">'
            +'<button class="btn btn-p" onclick="window.__pkgNewPkg()">📦 New Package (same config)</button>'
            +'</div>';
        } else {
          rvRes.innerHTML='<div class="errbx">⚠️ Partial: '+(log.vaults.length+log.spans.length+log.fibers.length)+' created, '+log.errors.length+' failed.<br><br>'+log.errors.map(function(e){return '• '+e;}).join('<br>')+'</div>';
          if(commitBtn) commitBtn.disabled=false;
          if(backBtn)   backBtn.disabled=false;
        }
      }
    } catch(err) {
      setP(0,'Error');
      const rvRes=qs('#rv-result');
      if(rvRes) rvRes.innerHTML='<div class="errbx">❌ '+err.message+'</div>';
      if(commitBtn) commitBtn.disabled=false;
      if(backBtn)   backBtn.disabled=false;
    }
  }

  // ── Global Callbacks ──────────────────────────────────────────────────
  window.__pkgToggle=function(id){
    if(id==='fiberSplit'){saveConduits();saveFibers();saveVCfg();saveSpanOverride();saveFiberOverride();fiberSplit=!fiberSplit;render();}
    if(id==='createConduit'){createConduit=!createConduit;render();}
    if(id==='createFiber'){createFiber=!createFiber;render();}
  };
  window.__pkgPickOpt=function(key,val){pickOpts[key]=val;};
  window.__pkgStartPick=function(){initGL().then(startPick);};
  window.__pkgEndPick=function(){endPick();pickMode=false;render();};
  window.__pkgCancelArc=function(){cancelArc();render();setStatus('Arc cancelled.');};
  window.__pkgCancelTrace=function(){disableTracePath();setStatus('Trace cancelled.','info');render();};
  window.__pkgLoadTmpl=function(name){applyTemplate(name);};
  window.__pkgDelTmpl=function(name){if(!confirm('Delete template "'+name+'"?'))return;Tmpl.del(name);if(currentTmplName===name)currentTmplName=null;render();};
  window.__pkgDelCd=function(id){saveConduits();conduits=conduits.filter(function(r){return r.id!==id;});const el=qs('#cd-stk');if(el){el.innerHTML=renderConduitStack();initSearchSelects(el);}};
  window.__pkgDelFb=function(id){saveFibers();fibers=fibers.filter(function(r){return r.id!==id;});const el=qs('#fb-stk');if(el){el.innerHTML=renderFiberStack();initSearchSelects(el);}};
  window.__pkgNewPkg=function(){pts=[];waypointMode=false;cancelArc();disableTracePath();bearingLock=false;lockedBearing=null;clearGL();step='place';render();};

  // ── Init ──────────────────────────────────────────────────────────────
  box.innerHTML='<div class="hdr"><span style="font-size:15px">📦</span><span class="hdr-title">Package Creator v4</span><button class="hdr-close" id="btn-close-init">✕</button></div>'
    +'<div class="body" style="text-align:center;padding:32px;color:#6c7086"><div style="font-size:28px;margin-bottom:10px">⏳</div>Loading layer domains…</div>';
  qs('#btn-close-init').addEventListener('click',function(){styleEl.remove();document.removeEventListener('click',closeAllDrops);box.remove();});
  makeDraggable();
  try {
    await loadDomains();render();
    setStatus('Domains loaded — '+Object.keys(domains).length+' entries found.','success');
  } catch(err) {
    qs('.body').innerHTML='<div class="errbx" style="margin:16px">❌ '+err.message+'</div>';
  }
}
main().catch(function(err){alert('Package Creator v4 failed: '+err.message);});
})();
