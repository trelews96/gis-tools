javascript:(function(){
async function main(){
  const mv=Object.values(window).find(o=>o?.constructor?.name==='MapView');
  if(!mv)return alert('No MapView found');

  const LAYERS={vault:{id:42100},span:{id:42050},cable:{id:41050}};
  const TMPL_KEY='pkgCreator_v2',Z=99999,SNAP_PX=20;
  const uid=()=>Math.random().toString(36).slice(2,8);
  const qs=(sel,ctx=box)=>ctx.querySelector(sel);
  const gval=id=>{const e=box.querySelector(`#${id}`);return e?e.value.trim():'';};
  const domName=(field,code)=>{if(!code)return'';const d=domains[field];return d?.find(x=>String(x.code)===String(code))?.name||code;};

  let step='setup',domains={},cfg={},vCfg={};
  let conduits=[{id:uid()}],fibers=[{id:uid()}];
  let pts=[]; // {pt:MapPoint, noVault:bool}[]
  let active=false,clickH=null,keyH=null,gl=null,waypointMode=false;

  // ── CSS ───────────────────────────────────────────────────────────────
  const styleEl=document.createElement('style');
  styleEl.textContent=`
    #pkgT{position:fixed;top:100px;right:40px;z-index:${Z};
      width:490px;height:600px;min-width:360px;min-height:240px;
      resize:both;overflow:hidden;
      background:#1e1e2e;color:#cdd6f4;border:1px solid #45475a;border-radius:8px;
      box-shadow:0 8px 32px rgba(0,0,0,.55);display:flex;flex-direction:column;
      font-family:'Segoe UI',Arial,sans-serif;font-size:12px;}
    #pkgT::after{content:'';position:absolute;bottom:3px;right:3px;width:9px;height:9px;
      border-right:2px solid #585b70;border-bottom:2px solid #585b70;
      border-radius:0 0 2px 0;pointer-events:none;}
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
      display:flex;justify-content:space-between;align-items:center;background:#1e1e2e;
      border-bottom:1px solid #313244;}
    #pkgT .sec-hdr.clickable{cursor:pointer;}
    #pkgT .sec-body{padding:10px 12px;}
    #pkgT .collapsed>.sec-body{display:none;}
    #pkgT .chevron{transition:transform .2s;display:inline-block;}
    #pkgT .collapsed .chevron{transform:rotate(-90deg);}
    #pkgT .frow{margin-bottom:8px;}
    #pkgT .frow label{display:block;font-size:10px;color:#a6adc8;margin-bottom:3px;font-weight:600;}
    #pkgT .frow label.req::after{content:" *";color:#f38ba8;}
    #pkgT .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 10px;}
    #pkgT input[type=text],#pkgT input[type=number]{
      width:100%;padding:5px 7px;font-size:11px;background:#313244;color:#cdd6f4;
      border:1px solid #45475a;border-radius:4px;outline:none;}
    #pkgT input:focus{border-color:#cba6f7;}
    #pkgT .btn{padding:6px 12px;font-size:11px;font-weight:600;border:none;border-radius:4px;cursor:pointer;transition:opacity .15s,background .15s;}
    #pkgT .btn:hover{opacity:.82;}
    #pkgT .btn:disabled{opacity:.38;cursor:not-allowed;}
    #pkgT .btn-p{background:#cba6f7;color:#1e1e2e;}
    #pkgT .btn-g{background:#a6e3a1;color:#1e1e2e;}
    #pkgT .btn-r{background:#f38ba8;color:#1e1e2e;}
    #pkgT .btn-o{background:#fab387;color:#1e1e2e;}
    #pkgT .btn-n{background:#45475a;color:#cdd6f4;}
    #pkgT .btn-b{background:#89b4fa;color:#1e1e2e;}
    #pkgT .btn-sm{padding:3px 7px;font-size:10px;}
    #pkgT .row{display:flex;gap:7px;}
    #pkgT .row .btn{flex:1;}
    #pkgT .stk{width:100%;border-collapse:collapse;font-size:10px;}
    #pkgT .stk th{background:#313244;color:#89b4fa;padding:4px 5px;text-align:left;font-weight:600;white-space:nowrap;}
    #pkgT .stk td{padding:3px 4px;vertical-align:middle;border-bottom:1px solid #2a2a3e;}
    #pkgT .stk tr:hover td{background:#252538;}
    #pkgT .stk input[type=number]{width:52px;padding:3px 4px;font-size:10px;}
    #pkgT .sbar{background:#181825;border-top:1px solid #313244;padding:6px 14px;
      font-size:10px;color:#a6adc8;flex-shrink:0;min-height:28px;}
    #pkgT .badge{display:inline-block;padding:1px 6px;border-radius:10px;font-size:9px;font-weight:700;}
    #pkgT .bp{background:#cba6f7;color:#1e1e2e;}#pkgT .bg{background:#a6e3a1;color:#1e1e2e;}
    #pkgT .br{background:#f38ba8;color:#1e1e2e;}#pkgT .bb{background:#89b4fa;color:#1e1e2e;}
    #pkgT .plist{max-height:130px;overflow-y:auto;background:#0d0d1a;border-radius:4px;padding:5px;}
    #pkgT .pitem{display:flex;justify-content:space-between;align-items:center;padding:2px 5px;border-radius:3px;font-size:10px;}
    #pkgT .pitem:hover{background:#313244;}
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
    #pkgT .wp-on{background:#89b4fa !important;color:#1e1e2e !important;}
    /* Template cards */
    #pkgT .tcard{background:#252538;border:1px solid #313244;border-radius:6px;
      padding:8px 10px;margin-bottom:7px;}
    #pkgT .tcard:hover{border-color:#585b70;}
    #pkgT .tcard-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;}
    #pkgT .tcard-name{font-weight:700;font-size:11px;color:#cdd6f4;}
    #pkgT .tcard-date{font-size:9px;color:#585b70;}
    #pkgT .tcard-row{display:flex;gap:5px;align-items:baseline;font-size:9px;color:#a6adc8;margin-bottom:2px;flex-wrap:wrap;}
    #pkgT .tcard-icon{flex-shrink:0;}
    /* Searchable select */
    #pkgT .ss{position:relative;display:block;width:100%;}
    #pkgT .ss-btn{display:flex;align-items:center;justify-content:space-between;
      padding:5px 7px;background:#313244;border:1px solid #45475a;border-radius:4px;
      cursor:pointer;font-size:11px;color:#cdd6f4;min-height:26px;user-select:none;}
    #pkgT .ss-btn:hover{border-color:#89b4fa;}
    #pkgT .ss-btn.open{border-color:#cba6f7;border-radius:4px 4px 0 0;}
    #pkgT .ss-val{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;color:#cdd6f4;}
    #pkgT .ss-val.placeholder{color:#585b70;}
    #pkgT .ss-arrow{flex-shrink:0;margin-left:5px;color:#585b70;font-size:9px;transition:transform .15s;}
    #pkgT .ss-btn.open .ss-arrow{transform:rotate(180deg);color:#cba6f7;}
    .ss-drop-portal{position:fixed;z-index:200000;
      background:#1e1e2e;border:1px solid #cba6f7;border-radius:0 0 5px 5px;
      box-shadow:0 6px 20px rgba(0,0,0,.6);overflow:hidden;}
    .ss-drop-portal .ss-search-wrap{padding:5px 6px;border-bottom:1px solid #313244;background:#181825;}
    .ss-drop-portal .ss-inp{width:100%;padding:4px 7px;background:#313244;border:1px solid #45475a;
      color:#cdd6f4;font-size:11px;border-radius:3px;outline:none;font-family:'Segoe UI',Arial,sans-serif;}
    .ss-drop-portal .ss-inp:focus{border-color:#cba6f7;}
    .ss-drop-portal .ss-opts{max-height:160px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:#45475a #1e1e2e;}
    .ss-drop-portal .ss-opt{padding:5px 9px;font-size:11px;cursor:pointer;color:#cdd6f4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .ss-drop-portal .ss-opt:hover{background:#313244;}
    .ss-drop-portal .ss-opt.selected{color:#cba6f7;font-weight:600;background:#252538;}
    .ss-drop-portal .ss-opt.ss-hidden{display:none;}
    .ss-drop-portal .ss-none{padding:8px;font-size:10px;color:#585b70;text-align:center;}
  `;
  document.head.appendChild(styleEl);

  // ── Container ─────────────────────────────────────────────────────────
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
      const wrap=document.createElement('div');
      wrap.className='ss';
      const curLabel=optData.find(o=>o.val===sel.value)?.label||'';
      const btn=document.createElement('div');
      btn.className='ss-btn';
      btn.tabIndex=0;
      btn.innerHTML=`<span class="ss-val ${curLabel?'':'placeholder'}">${curLabel||'— select —'}</span><span class="ss-arrow">▾</span>`;
      sel.parentNode.insertBefore(wrap,sel);
      wrap.appendChild(btn);wrap.appendChild(sel);
      function openDrop(e){
        e.stopPropagation();
        if(btn.classList.contains('open')){closeAllDrops();return;}
        closeAllDrops();
        const rect=btn.getBoundingClientRect();
        const portal=document.createElement('div');
        portal.className='ss-drop-portal';
        portal.style.left=rect.left+'px';
        portal.style.width=Math.max(rect.width,200)+'px';
        const curVal=sel.value;
        portal.innerHTML=`<div class="ss-search-wrap"><input class="ss-inp" type="text" placeholder="Search…" autocomplete="off"></div>
          <div class="ss-opts">${optData.map(o=>`<div class="ss-opt${o.val===curVal?' selected':''}" data-val="${o.val}">${o.label}</div>`).join('')}<div class="ss-none" style="display:none">No results</div></div>`;
        const spaceBelow=window.innerHeight-rect.bottom;
        if(spaceBelow<200&&rect.top>200){
          portal.style.bottom=(window.innerHeight-rect.top)+'px';
          portal.style.borderRadius='5px 5px 0 0';
          btn.style.borderRadius='0 0 4px 4px';
        } else {
          portal.style.top=rect.bottom+'px';
        }
        document.body.appendChild(portal);activePortal=portal;btn.classList.add('open');
        const inp=portal.querySelector('.ss-inp'),opts=portal.querySelector('.ss-opts'),none=portal.querySelector('.ss-none');
        inp.focus();
        inp.addEventListener('input',()=>{
          const q=inp.value.toLowerCase();let vis=0;
          opts.querySelectorAll('.ss-opt').forEach(o=>{const m=!q||o.textContent.toLowerCase().includes(q);o.classList.toggle('ss-hidden',!m);if(m)vis++;});
          none.style.display=vis?'none':'block';
        });
        inp.addEventListener('click',e=>e.stopPropagation());
        opts.addEventListener('click',e=>{
          const opt=e.target.closest('.ss-opt');if(!opt)return;
          sel.value=opt.dataset.val;
          const vs=btn.querySelector('.ss-val');
          vs.textContent=opt.textContent.trim();vs.classList.toggle('placeholder',!opt.dataset.val);
          btn.style.borderRadius='';closeAllDrops();
        });
        portal.addEventListener('click',e=>e.stopPropagation());
      }
      btn.addEventListener('click',openDrop);
      btn.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')openDrop(e);});
    });
  }

  // ── Drag ──────────────────────────────────────────────────────────────
  function makeDraggable(){
    const hdr=qs('.hdr');if(!hdr)return;
    let ox,oy,sx,sy;
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
    if(!vl||!sl||!cl)throw new Error('One or more required layers not found');
    await Promise.all([vl.load(),sl.load(),cl.load()]);
    domains={};
    // Load vault + span first
    for(const layer of [vl,sl]){
      for(const f of(layer.fields||[])){
        if(f.domain?.codedValues&&!domains[f.name])
          domains[f.name]=f.domain.codedValues.map(cv=>({code:cv.code,name:cv.name}));
      }
    }
    // Load cable — always prefix with cable_, also fill in new keys without prefix
    for(const f of(cl.fields||[])){
      if(f.domain?.codedValues){
        const vals=f.domain.codedValues.map(cv=>({code:cv.code,name:cv.name}));
        domains[`cable_${f.name}`]=vals;
        if(!domains[f.name])domains[f.name]=vals;
      }
    }
  }

  // ── Field Builders ────────────────────────────────────────────────────
  function mkSelect(domainKey,domId,cur=''){
    if(!domains[domainKey]?.length)
      return`<input type="text" id="${domId}" placeholder="—" value="${cur}">`;
    const opts=domains[domainKey].map(d=>
      `<option value="${d.code}"${String(d.code)===String(cur)?' selected':''}>${d.name}</option>`
    ).join('');
    return`<select id="${domId}" data-ss><option value="">— select —</option>${opts}</select>`;
  }
  function mkText(domId,ph='',cur=''){return`<input type="text" id="${domId}" placeholder="${ph}" value="${cur}">`;}
  function mkNum(domId,ph='',cur=''){return`<input type="number" id="${domId}" placeholder="${ph}" value="${cur}" min="0">`;}
  function frow(label,html,req=false){return`<div class="frow"><label class="${req?'req':''}">${label}</label>${html}</div>`;}

  // ── Geometry ──────────────────────────────────────────────────────────
  const Geo={
    wm2ll(x,y){const lng=(x/20037508.34)*180;let lat=(y/20037508.34)*180;lat=180/Math.PI*(2*Math.atan(Math.exp(lat*Math.PI/180))-Math.PI/2);return{lat,lng};},
    pt2ll(pt){const sr=pt.spatialReference;if(!sr||sr.wkid===3857||sr.wkid===102100)return this.wm2ll(pt.x,pt.y);if(sr.wkid===4326||sr.wkid===4269)return{lat:pt.y,lng:pt.x};return this.wm2ll(pt.x,pt.y);},
    dist(p1,p2){const R=20902231,a1=this.pt2ll(p1),a2=this.pt2ll(p2),dLat=(a2.lat-a1.lat)*Math.PI/180,dLng=(a2.lng-a1.lng)*Math.PI/180,a=Math.sin(dLat/2)**2+Math.cos(a1.lat*Math.PI/180)*Math.cos(a2.lat*Math.PI/180)*Math.sin(dLng/2)**2;return Math.round(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)));},
    totalLen(points){let t=0;for(let i=1;i<points.length;i++)t+=this.dist(points[i-1],points[i]);return t;}
  };

  // ── Graphics Layer ────────────────────────────────────────────────────
  async function initGL(){
    if(gl)return;
    if(!window.require)return;
    await new Promise((res,rej)=>window.require(['esri/layers/GraphicsLayer','esri/Graphic'],(GL,Gr)=>{
      gl=new GL({title:'__pkgCreator__',listMode:'hide'});mv.map.add(gl);window.__pkgGr=Gr;res();
    },rej)).catch(()=>{});
  }
  function addMarker(pt,idx,isWaypoint=false){
    if(!gl||!window.__pkgGr)return;
    const sym=isWaypoint
      ?{type:'simple-marker',style:'diamond',color:[137,220,235,0.7],size:'12px',outline:{color:[137,220,235,1],width:2}}
      :{type:'simple-marker',style:'circle',color:[203,166,247,0.92],size:'13px',outline:{color:[255,255,255,0.9],width:2}};
    gl.add(new window.__pkgGr({geometry:pt,symbol:sym,attributes:{_pkg:'vault',idx}}));
    refreshLine();
  }
  function refreshLine(){
    if(!gl||!window.__pkgGr)return;
    gl.removeMany(gl.graphics.filter(g=>g.attributes?._pkg==='line').toArray());
    if(pts.length<2)return;
    gl.add(new window.__pkgGr({
      geometry:{type:'polyline',paths:[pts.map(p=>[p.pt.x,p.pt.y])],spatialReference:pts[0].pt.spatialReference},
      symbol:{type:'simple-line',color:[137,180,250,0.75],width:2,style:'dash'},
      attributes:{_pkg:'line'}
    }));
  }
  function removeSnapRing(){if(gl)gl.removeMany(gl.graphics.filter(g=>g.attributes?._pkg==='snap').toArray());}
  function addSnapRing(pt){
    if(!gl||!window.__pkgGr)return;removeSnapRing();
    gl.add(new window.__pkgGr({geometry:pt,symbol:{type:'simple-marker',style:'circle',color:[250,179,135,0],size:'20px',outline:{color:[250,179,135,0.9],width:2.5}},attributes:{_pkg:'snap'}}));
  }
  function removeLastMarker(){
    if(!gl)return;
    const vg=gl.graphics.filter(g=>g.attributes?._pkg==='vault').toArray();
    if(vg.length)gl.remove(vg[vg.length-1]);
    refreshLine();
  }
  function clearGL(){if(gl)gl.removeAll();}

  // ── Snap ──────────────────────────────────────────────────────────────
  async function findSnap(screenEvt){
    for(const p of [...pts].reverse()){
      const sp=mv.toScreen(p.pt);
      if(Math.hypot(screenEvt.x-sp.x,screenEvt.y-sp.y)<SNAP_PX)return p.pt;
    }
    try{
      const vl=mv.map.allLayers.find(l=>l.layerId===LAYERS.vault.id);if(!vl)return null;
      const mapPt=mv.toMap({x:screenEvt.x,y:screenEvt.y}),tol=mv.resolution*SNAP_PX;
      const res=await vl.queryFeatures({
        geometry:{type:'extent',xmin:mapPt.x-tol,ymin:mapPt.y-tol,xmax:mapPt.x+tol,ymax:mapPt.y+tol,spatialReference:mapPt.spatialReference},
        returnGeometry:true,outFields:['*'],num:1
      });
      if(res.features?.length){
        const geo=res.features[0].geometry;
        const sp=mv.toScreen(geo);
        if(Math.hypot(screenEvt.x-sp.x,screenEvt.y-sp.y)<SNAP_PX)return geo;
      }
    }catch(_){}
    return null;
  }

  // ── Feature Creator (same applyEdits approach as original working tool) ─
  async function createFeat(layer,geometry,attributes){
    await layer.load();
    console.log('[PKG] Creating on:',layer.title,'attrs:',JSON.stringify(attributes));
    const result=await layer.applyEdits({addFeatures:[{geometry,attributes}]});
    console.log('[PKG] applyEdits result:',JSON.stringify(result?.addFeatureResults?.[0]));
    const r=result?.addFeatureResults?.[0];
    if(!r) throw new Error('No addFeatureResults returned');
    if(r.error) throw new Error(`Server error: ${r.error.description||r.error.message||JSON.stringify(r.error)}`);
    if(!r.objectId) throw new Error(`No objectId returned — got: ${JSON.stringify(r)}`);
    console.log('[PKG] ✅ objectId:',r.objectId);
    await layer.refresh();
    return r.objectId;
  }

  // ── Templates ─────────────────────────────────────────────────────────
  const Tmpl={
    all(){return JSON.parse(localStorage.getItem(TMPL_KEY)||'{}');},
    save(name,data){const t=this.all();t[name]={name,created:new Date().toISOString(),data};localStorage.setItem(TMPL_KEY,JSON.stringify(t));},
    del(name){const t=this.all();delete t[name];localStorage.setItem(TMPL_KEY,JSON.stringify(t));}
  };

  function tmplCardHTML(t){
    const d=t.data;
    // Conduit summary: group by diameter
    const cdMap={};
    (d.conduits||[]).forEach(c=>{
      const dia=domName('conduit_diameter',c.conduit_diameter)||c.conduit_diameter||'?';
      const mat=domName('conduit_material',c.conduit_material)||'';
      const key=mat?`${dia} ${mat}`:dia;
      cdMap[key]=(cdMap[key]||0)+parseInt(c.conduit_count||1);
    });
    const cdStr=Object.entries(cdMap).map(([k,v])=>`${k} ×${v}`).join(', ')||'None';
    // Fiber summary
    const fbMap={};
    (d.fibers||[]).forEach(f=>{
      const fc=domName('cable_fiber_count',f.fiber_count)||f.fiber_count||'?';
      const key=`${fc}ct`;
      fbMap[key]=(fbMap[key]||0)+1;
    });
    const fbStr=Object.entries(fbMap).map(([k,v])=>`${k} ×${v}`).join(', ')||'None';
    // Vault summary
    const vs=domName('vault_size',d.vCfg?.vault_size)||d.vCfg?.vault_size||'';
    const vtr=d.vCfg?.vault_tier_rating||'';
    const vaultStr=[vs,vtr&&`Tier ${vtr}`].filter(Boolean).join(' · ')||'No vault config';
    return`<div class="tcard">
      <div class="tcard-hdr">
        <span class="tcard-name">${t.name}</span>
        <span class="tcard-date">${new Date(t.created).toLocaleDateString()}</span>
      </div>
      <div class="tcard-row"><span class="tcard-icon">🔵</span><span>${cdStr}</span></div>
      <div class="tcard-row"><span class="tcard-icon">🟣</span><span>${fbStr}</span></div>
      <div class="tcard-row"><span class="tcard-icon">🏗️</span><span>${vaultStr}</span></div>
      <div class="row" style="margin-top:6px;gap:5px">
        <button class="btn btn-p btn-sm" onclick="window.__pkgLoadTmpl('${t.name}')">Load</button>
        <button class="btn btn-r btn-sm" onclick="window.__pkgDelTmpl('${t.name}')">Delete</button>
      </div>
    </div>`;
  }

  // ── State Collectors ──────────────────────────────────────────────────
  function readConduit(row){
    const g=(id,fk)=>{const e=box.querySelector(`#${id}`);return e?e.value.trim():(row[fk]||'');};
    return{conduit_diameter:g(`cd_d_${row.id}`,'conduit_diameter'),conduit_material:g(`cd_m_${row.id}`,'conduit_material'),
      installation_method:g(`cd_im_${row.id}`,'installation_method'),placement_type:g(`cd_pt_${row.id}`,'placement_type'),
      conduit_count:g(`cd_cc_${row.id}`,'conduit_count'),inner_duct:g(`cd_id_${row.id}`,'inner_duct'),
      minimum_depth:g(`cd_md_${row.id}`,'minimum_depth')};
  }
  function readFiber(row){
    const g=(id,fk)=>{const e=box.querySelector(`#${id}`);return e?e.value.trim():(row[fk]||'');};
    return{fiber_count:g(`fb_fc_${row.id}`,'fiber_count'),buffer_count:g(`fb_bc_${row.id}`,'buffer_count'),
      cable_category:g(`fb_ca_${row.id}`,'cable_category'),cable_type:g(`fb_ct_${row.id}`,'cable_type'),
      sheath_type:g(`fb_st_${row.id}`,'sheath_type'),core_type:g(`fb_co_${row.id}`,'core_type'),
      installation_method:g(`fb_im_${row.id}`,'installation_method'),placement_type:g(`fb_pt_${row.id}`,'placement_type')};
  }
  function saveConduits(){conduits=conduits.map(r=>({...r,...readConduit(r)}));}
  function saveFibers(){fibers=fibers.map(r=>({...r,...readFiber(r)}));}
  function saveVCfg(){vCfg={vault_type:gval('v_vt'),vault_size:gval('v_vs'),vault_material:gval('v_vm'),physical_status:gval('v_ps'),vault_tier_rating:gval('v_vtr')};}
  function saveCfg(){cfg={workflow_stage:gval('f_ws'),workflow_status:gval('f_wst'),work_type:gval('f_wt'),client_code:gval('f_cc'),project_id:gval('f_pi'),job_number:gval('f_jn'),workorder_id:gval('f_wo'),purchase_order_id:gval('f_po')};}

  // ── Validation ────────────────────────────────────────────────────────
  function validateSetup(){
    const map={f_ws:'Workflow Stage',f_wst:'Workflow Status',f_wt:'Work Type',f_cc:'Client Code',f_pi:'Project ID',f_jn:'Job Number',f_wo:'Work Order ID',f_po:'Purchase Order ID'};
    for(const [id,label] of Object.entries(map)){if(!gval(id))return`"${label}" is required`;}
    return null;
  }

  // ── Status ────────────────────────────────────────────────────────────
  function setStatus(msg,type='info'){
    const e=qs('.sbar');if(!e)return;
    const c={info:'#a6adc8',success:'#a6e3a1',error:'#f38ba8',warn:'#fab387'};
    e.style.color=c[type]||c.info;e.textContent=msg;
  }
  function showErr(sel,msg){const e=qs(sel);if(e){e.textContent=msg;e.style.display='block';}}
  function hideErr(sel){const e=qs(sel);if(e)e.style.display='none';}

  // ── Tabs ──────────────────────────────────────────────────────────────
  function tabs(){
    const order=['setup','layers','place','review'],labels=['1 · Setup','2 · Layers','3 · Place','4 · Review'],cur=order.indexOf(step);
    return order.map((s,i)=>`<div class="${i<cur?'tab done':s===step?'tab active':'tab'}">${i<cur?'✓ ':''}${labels[i]}</div>`).join('');
  }

  // ── Render: SETUP ─────────────────────────────────────────────────────
  function renderSetup(){
    const tmpls=Object.values(Tmpl.all()).sort((a,b)=>new Date(b.created)-new Date(a.created));
    const recent=tmpls.slice(0,3),rest=tmpls.slice(3);
    return`
      ${tmpls.length?`
      <div class="sec ${rest.length?'':'collapsed'}" id="sec-tmpl">
        <div class="sec-hdr clickable" onclick="this.closest('.sec').classList.toggle('collapsed')">
          <span>Saved Templates (${tmpls.length})</span><span class="chevron">▼</span>
        </div>
        <div class="sec-body">
          ${recent.map(tmplCardHTML).join('')}
          ${rest.length?`
            <div id="tmpl-more" style="display:none">${rest.map(tmplCardHTML).join('')}</div>
            <button class="btn btn-n btn-sm" style="width:100%;margin-top:2px" 
              onclick="const m=document.getElementById('tmpl-more');m.style.display=m.style.display==='none'?'block':'none';this.textContent=m.style.display==='none'?'Show ${rest.length} more…':'Show fewer'">
              Show ${rest.length} more…
            </button>`:``}
        </div>
      </div>`:``}
      <div class="sec">
        <div class="sec-hdr">Workflow Fields — Applied to All Features</div>
        <div class="sec-body">
          <div class="grid2">
            ${frow('Workflow Stage', mkSelect('workflow_stage','f_ws',cfg.workflow_stage),true)}
            ${frow('Workflow Status',mkSelect('workflow_status','f_wst',cfg.workflow_status),true)}
            ${frow('Work Type',      mkSelect('work_type','f_wt',cfg.work_type),true)}
            ${frow('Client Code',    mkSelect('client_code','f_cc',cfg.client_code),true)}
          </div>
          ${frow('Project ID',       mkSelect('project_id','f_pi',cfg.project_id),true)}
          <div class="grid2">
            ${frow('Job Number',     mkSelect('job_number','f_jn',cfg.job_number),true)}
            ${frow('Work Order ID',  mkSelect('workorder_id','f_wo',cfg.workorder_id),true)}
          </div>
          ${frow('Purchase Order ID',mkSelect('purchase_order_id','f_po',cfg.purchase_order_id),true)}
        </div>
      </div>
      <div class="row">
        <button class="btn btn-n" id="btn-sv-tmpl">💾 Save Template</button>
        <button class="btn btn-p" id="btn-to-layers">Next: Configure Layers →</button>
      </div>
      <div id="setup-err" class="errbx" style="display:none"></div>
    `;
  }

  // ── Render: LAYERS ────────────────────────────────────────────────────
  function renderLayers(){
    return`
      <div class="sec collapsed" id="sec-vault">
        <div class="sec-hdr clickable" onclick="this.closest('.sec').classList.toggle('collapsed')">
          <span>🏗️ Vault Options <span style="font-weight:400;color:#6c7086;font-size:10px">(optional)</span></span>
          <span class="chevron">▼</span>
        </div>
        <div class="sec-body">
          <div class="grid2">
            ${frow('Vault Type',      mkSelect('vault_type','v_vt',vCfg.vault_type))}
            ${frow('Vault Size',      mkSelect('vault_size','v_vs',vCfg.vault_size))}
            ${frow('Vault Material',  mkSelect('vault_material','v_vm',vCfg.vault_material))}
            ${frow('Physical Status', mkSelect('physical_status','v_ps',vCfg.physical_status))}
          </div>
          ${frow('Vault Tier Rating', mkSelect('vault_tier_rating','v_vtr',vCfg.vault_tier_rating))}
          <div class="tip">💡 All vaults in this package share these attributes.</div>
        </div>
      </div>
      <div class="sec" id="sec-cond">
        <div class="sec-hdr">
          <span>🔵 Conduit Stack <span class="badge bp" style="margin-left:5px">${conduits.length} row${conduits.length!==1?'s':''}</span></span>
          <button class="btn btn-p btn-sm" id="btn-add-cd">+ Add Row</button>
        </div>
        <div style="overflow-x:auto"><div id="cd-stk">${renderConduitStack()}</div></div>
        <div style="padding:4px 10px 7px;font-size:9px;color:#585b70">Each row = one set of span features per vault segment.</div>
      </div>
      <div class="sec" id="sec-fib">
        <div class="sec-hdr">
          <span>🟣 Fiber Cable Stack <span class="badge bp" style="margin-left:5px">${fibers.length} row${fibers.length!==1?'s':''}</span></span>
          <button class="btn btn-p btn-sm" id="btn-add-fb">+ Add Row</button>
        </div>
        <div style="overflow-x:auto"><div id="fb-stk">${renderFiberStack()}</div></div>
        <div style="padding:4px 10px 7px;font-size:9px;color:#585b70">Each row = one fiber cable spanning all vaults.</div>
      </div>
      <div class="row">
        <button class="btn btn-n" id="btn-to-setup">← Back</button>
        <button class="btn btn-p" id="btn-to-place">Next: Placement →</button>
      </div>
      <div id="layers-err" class="errbx" style="display:none"></div>
    `;
  }

  function renderConduitStack(){
    if(!conduits.length)return`<div class="empty">No rows — click "+ Add Row"</div>`;
    return`<table class="stk"><thead><tr>
      <th>Diameter</th><th>Material</th><th>Method</th><th>Placement</th>
      <th>Count</th><th>Inner&nbsp;Duct</th><th>Depth&nbsp;ft</th><th></th>
    </tr></thead><tbody>${conduits.map(r=>`<tr data-id="${r.id}">
      <td>${mkSelect('conduit_diameter',`cd_d_${r.id}`,r.conduit_diameter)}</td>
      <td>${mkSelect('conduit_material',`cd_m_${r.id}`,r.conduit_material)}</td>
      <td>${mkSelect('installation_method',`cd_im_${r.id}`,r.installation_method)}</td>
      <td>${mkSelect('placement_type',`cd_pt_${r.id}`,r.placement_type)}</td>
      <td><input type="number" id="cd_cc_${r.id}" value="${r.conduit_count||''}" min="1" placeholder="#"></td>
      <td>${mkSelect('inner_duct',`cd_id_${r.id}`,r.inner_duct)}</td>
      <td><input type="number" id="cd_md_${r.id}" value="${r.minimum_depth||''}" min="0" placeholder="ft"></td>
      <td><button class="btn btn-r btn-sm" onclick="window.__pkgDelCd('${r.id}')">✕</button></td>
    </tr>`).join('')}</tbody></table>`;
  }

  function renderFiberStack(){
    if(!fibers.length)return`<div class="empty">No rows — click "+ Add Row"</div>`;
    return`<table class="stk"><thead><tr>
      <th>Fiber&nbsp;Ct</th><th>Buffer&nbsp;Ct</th><th>Category</th><th>Cable Type</th>
      <th>Sheath</th><th>Core</th><th>Method</th><th>Placement</th><th></th>
    </tr></thead><tbody>${fibers.map(r=>`<tr data-id="${r.id}">
      <td>${mkSelect('fiber_count',`fb_fc_${r.id}`,r.fiber_count)}</td>
      <td>${mkSelect('buffer_count',`fb_bc_${r.id}`,r.buffer_count)}</td>
      <td>${mkSelect('cable_category',`fb_ca_${r.id}`,r.cable_category)}</td>
      <td>${mkSelect('cable_type',`fb_ct_${r.id}`,r.cable_type)}</td>
      <td>${mkSelect('sheath_type',`fb_st_${r.id}`,r.sheath_type)}</td>
      <td>${mkSelect('core_type',`fb_co_${r.id}`,r.core_type)}</td>
      <td>${mkSelect('cable_installation_method',`fb_im_${r.id}`,r.installation_method)}</td>
      <td>${mkSelect('cable_placement_type',`fb_pt_${r.id}`,r.placement_type)}</td>
      <td><button class="btn btn-r btn-sm" onclick="window.__pkgDelFb('${r.id}')">✕</button></td>
    </tr>`).join('')}</tbody></table>`;
  }

  // ── Render: PLACE ─────────────────────────────────────────────────────
  function renderPlace(){
    const vaultCt=pts.filter(p=>!p.noVault).length;
    const wayCt=pts.filter(p=>p.noVault).length;
    const len=pts.length>1?Geo.totalLen(pts.map(p=>p.pt)):0;
    return`
      <div class="sec">
        <div class="sec-body" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="badge bp">${vaultCt} vault${vaultCt!==1?'s':''}</span>
          ${wayCt?`<span class="badge bb">${wayCt} waypoint${wayCt!==1?'s':''}</span>`:''}
          <span class="badge bp">${conduits.length} conduit row${conduits.length!==1?'s':''}</span>
          <span class="badge bp">${fibers.length} fiber row${fibers.length!==1?'s':''}</span>
          ${len?`<span style="margin-left:auto;font-size:10px;color:#a6adc8">~${len.toLocaleString()} ft</span>`:''}
        </div>
      </div>
      <div class="sec">
        <div class="sec-hdr" style="cursor:default">Placed Points</div>
        <div class="sec-body" style="padding:6px">
          <div class="plist" id="plist">
            ${pts.length
              ?pts.map((p,i)=>`<div class="pitem">
                  <span>${p.noVault?'🔗 Waypoint':'📍 Vault'} ${i+1}</span>
                  <span style="color:#6c7086;font-size:9px">${p.pt.x.toFixed(0)}, ${p.pt.y.toFixed(0)}</span>
                  ${i>0?`<span style="color:#585b70;font-size:9px">+${Geo.dist(pts[i-1].pt,p.pt).toLocaleString()} ft</span>`:'<span></span>'}
                </div>`).join('')
              :`<div class="empty">Enable placement and click the map to add vaults.</div>`}
          </div>
        </div>
      </div>
      <div class="row" style="margin-bottom:7px">
        <button class="btn btn-g" id="btn-enable" ${active?'disabled':''}>▶ Enable Placement</button>
        <button class="btn btn-n" id="btn-disable" ${!active?'disabled':''}>⏹ Stop</button>
      </div>
      <div class="row" style="margin-bottom:7px">
        <button class="btn btn-n ${waypointMode?'wp-on':''}" id="btn-waypoint">
          🔗 Waypoint Mode: ${waypointMode?'ON':'OFF'}
        </button>
      </div>
      <div class="row" style="margin-bottom:7px">
        <button class="btn btn-o" id="btn-undo"  ${!pts.length?'disabled':''}>↩ Undo Last</button>
        <button class="btn btn-r" id="btn-clear" ${!pts.length?'disabled':''}>✕ Clear All</button>
      </div>
      <div class="row">
        <button class="btn btn-n" id="btn-to-layers">← Back</button>
        <button class="btn btn-p" id="btn-to-review" ${pts.length<2?'disabled':''}>Review Package →</button>
      </div>
      <div class="tip" style="margin-top:8px">
        <kbd>Enter</kbd> review &nbsp;·&nbsp; <kbd>Esc</kbd> undo &nbsp;·&nbsp;
        <kbd>Shift</kbd>+Click = waypoint (no vault) &nbsp;·&nbsp; 🟠 ring = snap to existing
      </div>
    `;
  }

  // ── Render: REVIEW ────────────────────────────────────────────────────
  function renderReview(){
    const vaultCt=pts.filter(p=>!p.noVault).length;
    const wayCt=pts.filter(p=>p.noVault).length;
    const sCt=(pts.length-1)*conduits.length,fCt=fibers.length;
    const total=vaultCt+sCt+fCt,len=Geo.totalLen(pts.map(p=>p.pt));
    return`
      <div class="sec">
        <div class="sec-hdr" style="cursor:default">Package Summary — ${total} features</div>
        <div class="sec-body" style="padding:6px">
          <table class="rvtbl">
            <tr><td>Vaults to Create</td><td><span class="badge bp">${vaultCt}</span></td></tr>
            ${wayCt?`<tr><td>Waypoints (no vault)</td><td><span class="badge bb">${wayCt}</span></td></tr>`:''}
            <tr><td>Underground Spans</td><td><span class="badge bp">${pts.length-1} seg × ${conduits.length} rows = ${sCt}</span></td></tr>
            <tr><td>Fiber Cables</td><td><span class="badge bp">${fCt}</span></td></tr>
            <tr><td>Total Length</td><td>~${len.toLocaleString()} ft</td></tr>
            <tr><td>Project ID</td><td>${cfg.project_id}</td></tr>
            <tr><td>Job Number</td><td>${cfg.job_number}</td></tr>
            <tr><td>Work Order</td><td>${cfg.workorder_id}</td></tr>
            <tr><td>Workflow Stage</td><td>${cfg.workflow_stage}</td></tr>
            <tr><td>Work Type</td><td>${cfg.work_type}</td></tr>
          </table>
        </div>
      </div>
      ${conduits.length?`<div class="sec collapsed" id="sec-rv-cd">
        <div class="sec-hdr clickable" onclick="this.closest('.sec').classList.toggle('collapsed')">
          <span>Conduit Rows Detail</span><span class="chevron">▼</span>
        </div>
        <div class="sec-body" style="font-size:10px">
          ${conduits.map((r,i)=>{const v=readConduit(r);return`<div style="margin-bottom:5px;padding:5px;background:#0d0d1a;border-radius:3px">
            <strong>Row ${i+1}:</strong> Dia: ${v.conduit_diameter||'—'} · Mat: ${v.conduit_material||'—'} · Count: ${v.conduit_count||'—'} · Method: ${v.installation_method||'—'} · Depth: ${v.minimum_depth||'—'} ft
          </div>`;}).join('')}
        </div>
      </div>`:''}
      ${fibers.length?`<div class="sec collapsed" id="sec-rv-fb">
        <div class="sec-hdr clickable" onclick="this.closest('.sec').classList.toggle('collapsed')">
          <span>Fiber Rows Detail</span><span class="chevron">▼</span>
        </div>
        <div class="sec-body" style="font-size:10px">
          ${fibers.map((r,i)=>{const v=readFiber(r);return`<div style="margin-bottom:5px;padding:5px;background:#0d0d1a;border-radius:3px">
            <strong>Row ${i+1}:</strong> Fibers: ${v.fiber_count||'—'} · Buffers: ${v.buffer_count||'—'} · Cat: ${v.cable_category||'—'} · Type: ${v.cable_type||'—'} · Method: ${v.installation_method||'—'}
          </div>`;}).join('')}
        </div>
      </div>`:''}
      <div id="prog-wrap" style="display:none;margin-bottom:8px">
        <div id="prog-lbl" style="font-size:10px;color:#a6adc8;margin-bottom:4px">Creating features…</div>
        <div class="pbwrap"><div class="pbfill" id="pbfill"></div></div>
      </div>
      <div class="row" style="margin-top:4px">
        <button class="btn btn-n" id="btn-to-place">← Back</button>
        <button class="btn btn-g" id="btn-commit">✅ Commit Package</button>
      </div>
      <div id="rv-result"></div>
    `;
  }

  // ── Main Render ───────────────────────────────────────────────────────
  function render(){
    let body='';
    if(step==='setup') body=renderSetup();
    if(step==='layers')body=renderLayers();
    if(step==='place') body=renderPlace();
    if(step==='review')body=renderReview();
    box.innerHTML=`
      <div class="hdr">
        <span style="font-size:15px">📦</span>
        <span class="hdr-title">Package Creator v2</span>
        <button class="hdr-close" id="btn-close">✕</button>
      </div>
      <div class="tabs">${tabs()}</div>
      <div class="body">${body}</div>
      <div class="sbar">Ready.</div>
    `;
    bind();makeDraggable();initSearchSelects();
  }

  // ── Bind ──────────────────────────────────────────────────────────────
  function bind(){
    const on=(id,ev,fn)=>{const e=qs(`#${id}`);if(e)e.addEventListener(ev,fn);};
    on('btn-close','click',()=>{disableTool();clearGL();styleEl.remove();document.removeEventListener('click',closeAllDrops);box.remove();});
    if(step==='setup'){
      on('btn-to-layers','click',()=>{const err=validateSetup();if(err){showErr('#setup-err',err);return;}hideErr('#setup-err');saveCfg();step='layers';render();});
      on('btn-sv-tmpl','click',()=>{const err=validateSetup();if(err){showErr('#setup-err',err);return;}saveCfg();const name=prompt('Template name:');if(!name)return;Tmpl.save(name,{cfg,vCfg,conduits,fibers});render();setStatus(`Template "${name}" saved.`,'success');});
    }
    if(step==='layers'){
      on('btn-to-setup','click',()=>{step='setup';render();});
      on('btn-to-place','click',()=>{saveVCfg();saveConduits();saveFibers();step='place';render();initGL();});
      on('btn-add-cd','click',()=>{saveConduits();conduits.push({id:uid()});const el=qs('#cd-stk');if(el){el.innerHTML=renderConduitStack();initSearchSelects(el);}});
      on('btn-add-fb','click',()=>{saveFibers();fibers.push({id:uid()});const el=qs('#fb-stk');if(el){el.innerHTML=renderFiberStack();initSearchSelects(el);}});
    }
    if(step==='place'){
      on('btn-enable','click',enableTool);
      on('btn-disable','click',disableTool);
      on('btn-waypoint','click',()=>{waypointMode=!waypointMode;const btn=qs('#btn-waypoint');if(btn){btn.classList.toggle('wp-on',waypointMode);btn.textContent=`🔗 Waypoint Mode: ${waypointMode?'ON':'OFF'}`;}});
      on('btn-to-layers','click',()=>{disableTool();step='layers';render();});
      on('btn-to-review','click',()=>{disableTool();step='review';render();});
      on('btn-undo','click',undoLast);
      on('btn-clear','click',()=>{pts=[];clearGL();waypointMode=false;refreshPlaceUI();});
    }
    if(step==='review'){
      on('btn-to-place','click',()=>{step='place';render();});
      on('btn-commit','click',commitPackage);
    }
  }

  // ── Placement ─────────────────────────────────────────────────────────
  function enableTool(){
    active=true;
    clickH=mv.on('click',handleClick);
    keyH=e=>handleKey(e);
    document.addEventListener('keydown',keyH);
    mv.container.style.cursor='crosshair';
    const en=qs('#btn-enable'),di=qs('#btn-disable');
    if(en)en.disabled=true;if(di)di.disabled=false;
    setStatus('Placement active — click map to place vaults.');
  }
  function disableTool(){
    active=false;
    if(clickH){clickH.remove();clickH=null;}
    if(keyH){document.removeEventListener('keydown',keyH);keyH=null;}
    if(mv?.container)mv.container.style.cursor='default';
    removeSnapRing();
    const en=qs('#btn-enable'),di=qs('#btn-disable');
    if(en)en.disabled=false;if(di)di.disabled=true;
    setStatus('Placement stopped.');
  }
  async function handleClick(evt){
    if(!active)return;
    evt.stopPropagation();
    const isWaypoint=waypointMode||(evt.native?.shiftKey||false);
    const snap=await findSnap(evt);
    const pt=snap||mv.toMap({x:evt.x,y:evt.y});
    if(snap){setStatus('Snapped to existing vault.','warn');removeSnapRing();}
    pts.push({pt,noVault:isWaypoint});
    addMarker(pt,pts.length-1,isWaypoint);
    if(waypointMode){waypointMode=false;const btn=qs('#btn-waypoint');if(btn){btn.classList.remove('wp-on');btn.textContent='🔗 Waypoint Mode: OFF';}}
    refreshPlaceUI();
    setStatus(`${isWaypoint?'🔗 Waypoint':'📍 Vault'} ${pts.length} placed.${pts.length>=2?' Enter to review, or keep placing.':' Place at least 1 more.'}`, 'info');
  }
  function handleKey(e){
    if(!active)return;
    if(e.key==='Enter'&&pts.length>=2){disableTool();step='review';render();}
    else if(e.key==='Escape')undoLast();
  }
  function undoLast(){
    if(!pts.length)return;
    pts.pop();removeLastMarker();refreshPlaceUI();
    setStatus(pts.length?`Point ${pts.length+1} removed.`:'All points cleared.');
  }
  function refreshPlaceUI(){
    const listEl=qs('#plist');
    if(listEl){
      listEl.innerHTML=pts.length
        ?pts.map((p,i)=>`<div class="pitem">
            <span>${p.noVault?'🔗 Waypoint':'📍 Vault'} ${i+1}</span>
            <span style="color:#6c7086;font-size:9px">${p.pt.x.toFixed(0)}, ${p.pt.y.toFixed(0)}</span>
            ${i>0?`<span style="color:#585b70;font-size:9px">+${Geo.dist(pts[i-1].pt,p.pt).toLocaleString()} ft</span>`:'<span></span>'}
          </div>`).join('')
        :`<div class="empty">Enable placement and click the map to add vaults.</div>`;
    }
    const undo=qs('#btn-undo'),clr=qs('#btn-clear'),rev=qs('#btn-to-review');
    if(undo)undo.disabled=!pts.length;
    if(clr)clr.disabled=!pts.length;
    if(rev)rev.disabled=pts.length<2;
  }

  // ── Commit ────────────────────────────────────────────────────────────
  async function commitPackage(){
    const commitBtn=qs('#btn-commit'),backBtn=qs('#btn-to-place');
    if(commitBtn)commitBtn.disabled=true;if(backBtn)backBtn.disabled=true;
    const progWrap=qs('#prog-wrap'),progLbl=qs('#prog-lbl'),pbFill=qs('#pbfill');
    if(progWrap)progWrap.style.display='block';
    const setP=(pct,msg)=>{if(pbFill)pbFill.style.width=pct+'%';if(progLbl)progLbl.textContent=msg;setStatus(msg,'info');};
    const log={vaults:[],spans:[],fibers:[],errors:[]};
    try{
      const vl=mv.map.allLayers.find(l=>l.layerId===LAYERS.vault.id);
      const sl=mv.map.allLayers.find(l=>l.layerId===LAYERS.span.id);
      const cl=mv.map.allLayers.find(l=>l.layerId===LAYERS.cable.id);
      if(!vl||!sl)throw new Error('Vault or Span layer not found');
      if(fibers.length&&!cl)throw new Error('Fiber cable layer not found');
      const base={
        workflow_stage:cfg.workflow_stage,workflow_status:cfg.workflow_status,
        work_type:cfg.work_type,client_code:cfg.client_code,
        project_id:cfg.project_id,job_number:cfg.job_number,
        purchase_order_id:cfg.purchase_order_id,workorder_id:cfg.workorder_id,
        delete_feature:'NO',construction_status:'NA'
      };
      const vaultOpts=Object.fromEntries(Object.entries(vCfg).filter(([,v])=>v!==''));
      const vaultCount=pts.filter(p=>!p.noVault).length;
      const total=vaultCount+(pts.length-1)*conduits.length+fibers.length;
      let done=0;
      const tick=msg=>{done++;setP(Math.round(done/total*100),msg);};

      // Vaults (skip waypoints)
      for(let i=0;i<pts.length;i++){
        if(pts[i].noVault){setP(Math.round(done/total*100),`Skipping waypoint ${i+1}`);continue;}
        const name=`Vault_${Date.now()}_${i+1}`;
        try{const id=await createFeat(vl,pts[i].pt,{...base,...vaultOpts,vault_name:name});log.vaults.push(id);}
        catch(e){log.errors.push(`Vault ${i+1}: ${e.message}`);}
        tick(`Creating vaults… ${log.vaults.length}/${vaultCount}`);
      }

      // Spans (per conduit row × per segment — waypoints are path vertices, no special handling)
      for(let ri=0;ri<conduits.length;ri++){
        const rv=readConduit(conduits[ri]);
        const spanOpts=Object.fromEntries(Object.entries(rv).filter(([,v])=>v!==''));
        if(spanOpts.conduit_count)spanOpts.conduit_count=parseInt(spanOpts.conduit_count);
        if(spanOpts.minimum_depth)spanOpts.minimum_depth=parseInt(spanOpts.minimum_depth);
        for(let i=0;i<pts.length-1;i++){
          const p1=pts[i].pt,p2=pts[i+1].pt;
          const geom={type:'polyline',paths:[[[p1.x,p1.y],[p2.x,p2.y]]],spatialReference:p1.spatialReference};
          try{const id=await createFeat(sl,geom,{...base,...spanOpts,calculated_length:Geo.dist(p1,p2)});log.spans.push(id);}
          catch(e){log.errors.push(`Span seg ${i+1} row ${ri+1}: ${e.message}`);}
          tick(`Creating spans… row ${ri+1}/${conduits.length}, seg ${i+1}/${pts.length-1}`);
        }
      }

      // Fiber cables
      for(let ri=0;ri<fibers.length;ri++){
        const rv=readFiber(fibers[ri]);
        const fibOpts=Object.fromEntries(Object.entries(rv).filter(([,v])=>v!==''));
        if(fibOpts.fiber_count)fibOpts.fiber_count=parseInt(fibOpts.fiber_count);
        if(fibOpts.buffer_count)fibOpts.buffer_count=parseInt(fibOpts.buffer_count);
        const name=`Fiber_${Date.now()}_${ri+1}`;
        const geom={type:'polyline',paths:[pts.map(p=>[p.pt.x,p.pt.y])],spatialReference:pts[0].pt.spatialReference};
        try{const id=await createFeat(cl,geom,{...base,...fibOpts,cable_name:name,calculated_length:Geo.totalLen(pts.map(p=>p.pt))});log.fibers.push(id);}
        catch(e){log.errors.push(`Fiber row ${ri+1}: ${e.message}`);}
        tick(`Creating fiber cables… ${ri+1}/${fibers.length}`);
      }

      setP(100,'Done!');clearGL();
      const rvRes=qs('#rv-result');
      if(rvRes){
        if(!log.errors.length){
          rvRes.innerHTML=`<div class="okbx">✅ Package created!<br>
            <strong>${log.vaults.length}</strong> vaults &nbsp;·&nbsp;
            <strong>${log.spans.length}</strong> spans &nbsp;·&nbsp;
            <strong>${log.fibers.length}</strong> fiber cables</div>
            <div class="row" style="margin-top:8px">
              <button class="btn btn-p" onclick="window.__pkgNewPkg()">📦 New Package (same config)</button>
            </div>`;
        } else {
          rvRes.innerHTML=`<div class="errbx">⚠️ Partial: ${log.vaults.length+log.spans.length+log.fibers.length} created, ${log.errors.length} failed.<br><br>${log.errors.map(e=>`• ${e}`).join('<br>')}</div>`;
          if(commitBtn)commitBtn.disabled=false;if(backBtn)backBtn.disabled=false;
        }
      }
    }catch(err){
      setP(0,'Error');
      const rvRes=qs('#rv-result');
      if(rvRes)rvRes.innerHTML=`<div class="errbx">❌ ${err.message}</div>`;
      if(commitBtn)commitBtn.disabled=false;if(backBtn)backBtn.disabled=false;
    }
  }

  // ── Global Callbacks ──────────────────────────────────────────────────
  window.__pkgLoadTmpl=name=>{
    const t=Tmpl.all()[name];if(!t)return;
    cfg=t.data.cfg||{};vCfg=t.data.vCfg||{};
    conduits=t.data.conduits||[{id:uid()}];fibers=t.data.fibers||[{id:uid()}];
    step='setup';render();setStatus(`Template "${name}" loaded.`,'success');
  };
  window.__pkgDelTmpl=name=>{if(!confirm(`Delete template "${name}"?`))return;Tmpl.del(name);render();};
  window.__pkgDelCd=id=>{saveConduits();conduits=conduits.filter(r=>r.id!==id);const el=qs('#cd-stk');if(el){el.innerHTML=renderConduitStack();initSearchSelects(el);}};
  window.__pkgDelFb=id=>{saveFibers();fibers=fibers.filter(r=>r.id!==id);const el=qs('#fb-stk');if(el){el.innerHTML=renderFiberStack();initSearchSelects(el);}};
  window.__pkgNewPkg=()=>{pts=[];waypointMode=false;clearGL();step='place';render();};

  // ── Init ──────────────────────────────────────────────────────────────
  box.innerHTML=`
    <div class="hdr"><span style="font-size:15px">📦</span>
      <span class="hdr-title">Package Creator v2</span>
      <button class="hdr-close" id="btn-close-init">✕</button>
    </div>
    <div class="body" style="text-align:center;padding:32px;color:#6c7086">
      <div style="font-size:28px;margin-bottom:10px">⏳</div>Loading layer domains…
    </div>
  `;
  qs('#btn-close-init')?.addEventListener('click',()=>{styleEl.remove();document.removeEventListener('click',closeAllDrops);box.remove();});
  makeDraggable();
  try{
    await loadDomains();
    render();
    setStatus(`Domains loaded — ${Object.keys(domains).length} entries found.`,'success');
  }catch(err){
    qs('.body').innerHTML=`<div class="errbx" style="margin:16px">❌ ${err.message}</div>`;
  }
}
main().catch(err=>alert('Package Creator v2 failed: '+err.message));
})();
