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
  let fiberSplit=true,currentTmplName=null;
  let pts=[],active=false,waypointMode=false;
  let clickH=null,keyH=null,pickH=null,gl=null;
  let pickMode=false,pickOpts={vault:true,conduit:true,fiber:true};
  let arcMode=false,arcPts=[],arcDensity=50;

  // ── CSS ───────────────────────────────────────────────────────────────
  const styleEl=document.createElement('style');
  styleEl.textContent=`
    #pkgT{position:fixed;top:100px;right:40px;z-index:${Z};width:490px;height:600px;
      min-width:360px;min-height:240px;resize:both;overflow:hidden;
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
    #pkgT input[type=text],#pkgT input[type=number]{width:100%;padding:5px 7px;font-size:11px;
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
    #pkgT .row{display:flex;gap:7px;align-items:center;}#pkgT .row .btn{flex:1;}
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
    #pkgT .bo{background:#fab387;color:#1e1e2e;}
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
    #pkgT .arc-guide{background:#1a1a0a;border:1px solid #fab387;border-radius:4px;
      padding:6px 10px;margin-bottom:8px;font-size:10px;color:#fab387;display:flex;align-items:center;gap:8px;}
    #pkgT .arc-step{display:inline-flex;align-items:center;justify-content:center;
      width:18px;height:18px;border-radius:50%;font-weight:700;font-size:10px;flex-shrink:0;}
    #pkgT .arc-step.done{background:#a6e3a1;color:#1e1e2e;}
    #pkgT .arc-step.cur{background:#fab387;color:#1e1e2e;}
    #pkgT .arc-step.wait{background:#45475a;color:#cdd6f4;}
    #pkgT .arc-density-row{display:flex;align-items:center;gap:6px;margin-top:6px;font-size:10px;color:#a6adc8;}
    #pkgT .arc-density-row input{width:60px;padding:3px 5px;font-size:10px;}
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
    #pkgT .ss-btn{display:flex;align-items:center;justify-content:space-between;
      padding:5px 7px;background:#313244;border:1px solid #45475a;border-radius:4px;
      cursor:pointer;font-size:11px;color:#cdd6f4;min-height:26px;user-select:none;}
    #pkgT .ss-btn:hover{border-color:#89b4fa;}
    #pkgT .ss-btn.open{border-color:#cba6f7;border-radius:4px 4px 0 0;}
    #pkgT .ss-val{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;}
    #pkgT .ss-val.placeholder{color:#585b70;}
    #pkgT .ss-arrow{flex-shrink:0;margin-left:5px;color:#585b70;font-size:9px;transition:transform .15s;}
    #pkgT .ss-btn.open .ss-arrow{transform:rotate(180deg);color:#cba6f7;}
    .ss-drop-portal{position:fixed;z-index:200000;background:#1e1e2e;border:1px solid #cba6f7;
      border-radius:0 0 5px 5px;box-shadow:0 6px 20px rgba(0,0,0,.6);overflow:hidden;}
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
    #pkgT .tog{display:flex;align-items:center;gap:7px;cursor:pointer;user-select:none;}
    #pkgT .tog-track{width:32px;height:17px;background:#45475a;border-radius:9px;position:relative;transition:background .2s;flex-shrink:0;}
    #pkgT .tog-track.on{background:#cba6f7;}
    #pkgT .tog-thumb{position:absolute;top:2px;left:2px;width:13px;height:13px;background:#fff;border-radius:50%;transition:left .2s;}
    #pkgT .tog-track.on .tog-thumb{left:17px;}
    #pkgT .tog-lbl{font-size:10px;color:#a6adc8;}
  `;
  document.head.appendChild(styleEl);

  const box=document.createElement('div');box.id='pkgT';
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
      btn.innerHTML=`<span class="ss-val ${curLabel?'':'placeholder'}">${curLabel||'— select —'}</span><span class="ss-arrow">▾</span>`;
      sel.parentNode.insertBefore(wrap,sel);wrap.appendChild(btn);wrap.appendChild(sel);
      function openDrop(e){
        e.stopPropagation();if(btn.classList.contains('open')){closeAllDrops();return;}closeAllDrops();
        const rect=btn.getBoundingClientRect();
        const portal=document.createElement('div');portal.className='ss-drop-portal';
        portal.style.left=rect.left+'px';portal.style.width=Math.max(rect.width,200)+'px';
        const curVal=sel.value;
        portal.innerHTML=`<div class="ss-search-wrap"><input class="ss-inp" type="text" placeholder="Search…" autocomplete="off"></div>
          <div class="ss-opts">${optData.map(o=>`<div class="ss-opt${o.val===curVal?' selected':''}" data-val="${o.val}">${o.label}</div>`).join('')}<div class="ss-none" style="display:none">No results</div></div>`;
        const spaceBelow=window.innerHeight-rect.bottom;
        if(spaceBelow<200&&rect.top>200){portal.style.bottom=(window.innerHeight-rect.top)+'px';portal.style.borderRadius='5px 5px 0 0';btn.style.borderRadius='0 0 4px 4px';}
        else portal.style.top=rect.bottom+'px';
        document.body.appendChild(portal);activePortal=portal;btn.classList.add('open');
        const inp=portal.querySelector('.ss-inp'),opts=portal.querySelector('.ss-opts'),none=portal.querySelector('.ss-none');
        inp.focus();
        inp.addEventListener('input',()=>{const q=inp.value.toLowerCase();let vis=0;opts.querySelectorAll('.ss-opt').forEach(o=>{const m=!q||o.textContent.toLowerCase().includes(q);o.classList.toggle('ss-hidden',!m);if(m)vis++;});none.style.display=vis?'none':'block';});
        inp.addEventListener('click',e=>e.stopPropagation());
        opts.addEventListener('click',e=>{
          const opt=e.target.closest('.ss-opt');if(!opt)return;
          sel.value=opt.dataset.val;const vs=btn.querySelector('.ss-val');
          vs.textContent=opt.textContent.trim();vs.classList.toggle('placeholder',!opt.dataset.val);
          btn.style.borderRadius='';closeAllDrops();
        });
        portal.addEventListener('click',e=>e.stopPropagation());
      }
      btn.addEventListener('click',openDrop);btn.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')openDrop(e);});
    });
  }

  function mkToggle(id,label,isOn){
    return`<label class="tog" onclick="window.__pkgToggle('${id}')">
      <div class="tog-track ${isOn?'on':''}" id="ttrack_${id}"><div class="tog-thumb"></div></div>
      <span class="tog-lbl">${label}</span></label>`;
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
    if(!vl||!sl||!cl)throw new Error('One or more required layers not found');
    await Promise.all([vl.load(),sl.load(),cl.load()]);
    domains={};
    for(const layer of [vl,sl]){for(const f of(layer.fields||[])){if(f.domain?.codedValues&&!domains[f.name])domains[f.name]=f.domain.codedValues.map(cv=>({code:cv.code,name:cv.name}));}}
    for(const f of(cl.fields||[])){if(f.domain?.codedValues){const vals=f.domain.codedValues.map(cv=>({code:cv.code,name:cv.name}));domains[`cable_${f.name}`]=vals;if(!domains[f.name])domains[f.name]=vals;}}
  }

  // ── Field Builders ────────────────────────────────────────────────────
  function mkSelect(domainKey,domId,cur=''){
    if(!domains[domainKey]?.length)return`<input type="text" id="${domId}" placeholder="—" value="${cur}">`;
    const opts=domains[domainKey].map(d=>`<option value="${d.code}"${String(d.code)===String(cur)?' selected':''}>${d.name}</option>`).join('');
    return`<select id="${domId}" data-ss><option value="">— select —</option>${opts}</select>`;
  }
  function frow(label,html,req=false){return`<div class="frow"><label class="${req?'req':''}">${label}</label>${html}</div>`;}

  // ── Geometry ──────────────────────────────────────────────────────────
  const Geo={
    wm2ll(x,y){const lng=(x/20037508.34)*180;let lat=(y/20037508.34)*180;lat=180/Math.PI*(2*Math.atan(Math.exp(lat*Math.PI/180))-Math.PI/2);return{lat,lng};},
    pt2ll(pt){const sr=pt.spatialReference;if(!sr||sr.wkid===3857||sr.wkid===102100)return this.wm2ll(pt.x,pt.y);if(sr.wkid===4326||sr.wkid===4269)return{lat:pt.y,lng:pt.x};return this.wm2ll(pt.x,pt.y);},
    dist(p1,p2){const R=20902231,a1=this.pt2ll(p1),a2=this.pt2ll(p2),dLat=(a2.lat-a1.lat)*Math.PI/180,dLng=(a2.lng-a1.lng)*Math.PI/180,a=Math.sin(dLat/2)**2+Math.cos(a1.lat*Math.PI/180)*Math.cos(a2.lat*Math.PI/180)*Math.sin(dLng/2)**2;return Math.round(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)));},
    totalLen(points){let t=0;for(let i=1;i<points.length;i++)t+=this.dist(points[i-1],points[i]);return t;}
  };

  // ── Segment Builder ───────────────────────────────────────────────────
  // Groups pts into vault-to-vault segments. Free points and arc waypoints
  // between two vaults become intermediate vertices of a single polyline —
  // they do NOT create separate span features.
  function buildSegments(pts){
    if(pts.length<2)return[];
    const segs=[];
    let cur=[pts[0].pt];
    for(let i=1;i<pts.length;i++){
      cur.push(pts[i].pt);
      // Break into a new segment when we land on a vault (but not the very last point)
      if(!pts[i].noVault && i<pts.length-1){
        segs.push(cur);
        cur=[pts[i].pt]; // vault is shared: end of this seg, start of next
      }
    }
    if(cur.length>=2)segs.push(cur);
    return segs;
  }

  // ── Arc Math ──────────────────────────────────────────────────────────
  function circumcenter(p1,p2,p3){
    const ax=p1.x,ay=p1.y,bx=p2.x,by=p2.y,cx=p3.x,cy=p3.y;
    const D=2*(ax*(by-cy)+bx*(cy-ay)+cx*(ay-by));
    if(Math.abs(D)<1e-6)return null;
    const ux=((ax*ax+ay*ay)*(by-cy)+(bx*bx+by*by)*(cy-ay)+(cx*cx+cy*cy)*(ay-by))/D;
    const uy=((ax*ax+ay*ay)*(cx-bx)+(bx*bx+by*by)*(ax-cx)+(cx*cx+cy*cy)*(bx-ax))/D;
    return{x:ux,y:uy};
  }
  function generateArcWaypoints(p1,pMid,p3,densityFt){
    const sr=p1.spatialReference;
    const cc=circumcenter(p1,pMid,p3);
    if(!cc){
      const total=Math.hypot(p3.x-p1.x,p3.y-p1.y);
      const N=Math.max(1,Math.round(total/(densityFt*0.3048)));
      const res=[];for(let i=1;i<=N;i++){const t=i/N;res.push({x:p1.x+(p3.x-p1.x)*t,y:p1.y+(p3.y-p1.y)*t,spatialReference:sr});}
      return res;
    }
    const R=Math.hypot(p1.x-cc.x,p1.y-cc.y);
    const a1=Math.atan2(p1.y-cc.y,p1.x-cc.x),a3=Math.atan2(p3.y-cc.y,p3.x-cc.x);
    const cross=(pMid.x-p1.x)*(p3.y-p1.y)-(pMid.y-p1.y)*(p3.x-p1.x);
    let sweep=a3-a1;
    if(cross>0&&sweep<0)sweep+=2*Math.PI;
    if(cross<=0&&sweep>0)sweep-=2*Math.PI;
    const N=Math.max(2,Math.round(Math.abs(sweep)*R/(densityFt*0.3048)));
    const res=[];
    for(let i=1;i<=N;i++){const angle=a1+(sweep*i/N);res.push({x:cc.x+R*Math.cos(angle),y:cc.y+R*Math.sin(angle),spatialReference:sr});}
    return res;
  }

  // ── Graphics Layer ────────────────────────────────────────────────────
  async function initGL(){
    if(gl)return;if(!window.require)return;
    await new Promise((res,rej)=>window.require(['esri/layers/GraphicsLayer','esri/Graphic'],(GL,Gr)=>{
      gl=new GL({title:'__pkgCreator__',listMode:'hide'});mv.map.add(gl);window.__pkgGr=Gr;res();},rej)).catch(()=>{});
  }
  function addMarker(pt,idx,isFree=false){
    if(!gl||!window.__pkgGr)return;
    const sym=isFree
      ?{type:'simple-marker',style:'x',color:[137,220,235,0.9],size:'11px',outline:{color:[137,220,235,1],width:2}}
      :{type:'simple-marker',style:'circle',color:[203,166,247,0.92],size:'13px',outline:{color:[255,255,255,0.9],width:2}};
    gl.add(new window.__pkgGr({geometry:pt,symbol:sym,attributes:{_pkg:'vault',idx}}));refreshLine();
  }
  function addArcGuideMarker(pt,stepN){
    if(!gl||!window.__pkgGr)return;
    const sym=stepN===2?{type:'simple-marker',style:'diamond',color:[250,179,135,0.9],size:'14px',outline:{color:'#fff',width:2}}:{type:'simple-marker',style:'circle',color:[166,227,161,0.9],size:'13px',outline:{color:'#fff',width:2}};
    gl.add(new window.__pkgGr({geometry:pt,symbol:sym,attributes:{_pkg:'arc-guide',stepN}}));
    const guides=gl.graphics.filter(g=>g.attributes?._pkg==='arc-guide').toArray();
    gl.removeMany(gl.graphics.filter(g=>g.attributes?._pkg==='arc-preview').toArray());
    if(guides.length>=2){const coords=guides.map(g=>[g.geometry.x,g.geometry.y]);gl.add(new window.__pkgGr({geometry:{type:'polyline',paths:[coords],spatialReference:pt.spatialReference},symbol:{type:'simple-line',color:[250,179,135,0.6],width:1.5,style:'short-dash'},attributes:{_pkg:'arc-preview'}}));}
  }
  function clearArcGuides(){if(gl)gl.removeMany(gl.graphics.filter(g=>['arc-guide','arc-preview'].includes(g.attributes?._pkg)).toArray());}
  function refreshLine(){
    if(!gl||!window.__pkgGr)return;gl.removeMany(gl.graphics.filter(g=>g.attributes?._pkg==='line').toArray());
    if(pts.length<2)return;
    gl.add(new window.__pkgGr({geometry:{type:'polyline',paths:[pts.map(p=>[p.pt.x,p.pt.y])],spatialReference:pts[0].pt.spatialReference},symbol:{type:'simple-line',color:[137,180,250,0.75],width:2,style:'dash'},attributes:{_pkg:'line'}}));
  }
  function removeSnapRing(){if(gl)gl.removeMany(gl.graphics.filter(g=>g.attributes?._pkg==='snap').toArray());}
  function removeLastMarker(){if(!gl)return;const vg=gl.graphics.filter(g=>g.attributes?._pkg==='vault').toArray();if(vg.length)gl.remove(vg[vg.length-1]);refreshLine();}
  function clearGL(){if(gl)gl.removeAll();}

  // ── Snap ──────────────────────────────────────────────────────────────
  async function findSnap(screenEvt){
    for(const p of [...pts].reverse()){const sp=mv.toScreen(p.pt);if(Math.hypot(screenEvt.x-sp.x,screenEvt.y-sp.y)<SNAP_PX)return p.pt;}
    try{
      const vl=mv.map.allLayers.find(l=>l.layerId===LAYERS.vault.id);if(!vl)return null;
      const mapPt=mv.toMap({x:screenEvt.x,y:screenEvt.y}),tol=mv.resolution*SNAP_PX;
      const res=await vl.queryFeatures({geometry:{type:'extent',xmin:mapPt.x-tol,ymin:mapPt.y-tol,xmax:mapPt.x+tol,ymax:mapPt.y+tol,spatialReference:mapPt.spatialReference},returnGeometry:true,outFields:['*'],num:1});
      if(res.features?.length){const geo=res.features[0].geometry;const sp=mv.toScreen(geo);if(Math.hypot(screenEvt.x-sp.x,screenEvt.y-sp.y)<SNAP_PX)return geo;}
    }catch(_){}
    return null;
  }

  // ── Feature Creator ───────────────────────────────────────────────────
  async function createFeat(layer,geometry,attributes){
    await layer.load();
    const result=await layer.applyEdits({addFeatures:[{geometry,attributes}]});
    const r=result?.addFeatureResults?.[0];
    if(!r)throw new Error('No addFeatureResults returned');
    if(r.error)throw new Error(r.error.description||r.error.message||JSON.stringify(r.error));
    if(!r.objectId)throw new Error(`No objectId — got: ${JSON.stringify(r)}`);
    await layer.refresh();return r.objectId;
  }

  // ── Templates ─────────────────────────────────────────────────────────
  const Tmpl={
    all(){return JSON.parse(localStorage.getItem(TMPL_KEY)||'{}');},
    save(name,data){const t=this.all();t[name]={name,created:new Date().toISOString(),data};localStorage.setItem(TMPL_KEY,JSON.stringify(t));},
    del(name){const t=this.all();delete t[name];localStorage.setItem(TMPL_KEY,JSON.stringify(t));}
  };

  // Save current step's DOM state into memory before any navigation or template op
  function saveCurrentStepState(){
    if(step==='setup')saveCfg();
    if(step==='layers'){saveVCfg();saveConduits();saveFibers();}
  }
  function collectAllState(){
    saveCurrentStepState();
    return{cfg,vCfg,conduits,fibers,fiberSplit};
  }
  function doSaveTemplate(name){
    const state=collectAllState();
    Tmpl.save(name,state);currentTmplName=name;render();
    setStatus(`Template "${name}" saved.`,'success');
  }
  // Apply a template to all state vars — always saves current state first
  function applyTemplate(name){
    saveCurrentStepState();
    const t=Tmpl.all()[name];if(!t)return;
    cfg=t.data.cfg||{};vCfg=t.data.vCfg||{};
    conduits=t.data.conduits||[{id:uid()}];fibers=t.data.fibers||[{id:uid()}];
    fiberSplit=t.data.fiberSplit!==undefined?t.data.fiberSplit:true;
    currentTmplName=name;
    render();setStatus(`Template "${name}" loaded.`,'success');
  }

  function tmplCardHTML(t){
    const d=t.data;
    const cdMap={};(d.conduits||[]).forEach(c=>{const dia=domName('conduit_diameter',c.conduit_diameter)||c.conduit_diameter||'?';const mat=domName('conduit_material',c.conduit_material)||'';const key=mat?`${dia} ${mat}`:dia;cdMap[key]=(cdMap[key]||0)+parseInt(c.conduit_count||1);});
    const cdStr=Object.entries(cdMap).map(([k,v])=>`${k} ×${v}`).join(', ')||'None';
    const fbMap={};(d.fibers||[]).forEach(f=>{const fc=domName('fiber_count',f.fiber_count)||f.fiber_count||'?';fbMap[fc]=(fbMap[fc]||0)+1;});
    const fbStr=Object.entries(fbMap).map(([k,v])=>`${k}ct ×${v}`).join(', ')||'None';
    const vs=domName('vault_size',d.vCfg?.vault_size)||d.vCfg?.vault_size||'';
    const vtr=d.vCfg?.vault_tier_rating||'';
    const vaultStr=[vs,vtr&&`Tier ${vtr}`].filter(Boolean).join(' · ')||'No vault config';
    const isCurrent=t.name===currentTmplName;
    return`<div class="tcard">
      <div class="tcard-hdr"><span class="tcard-name">${t.name}${isCurrent?'<span class="current-tmpl-tag">current</span>':''}</span><span class="tcard-date">${new Date(t.created).toLocaleDateString()}</span></div>
      <div class="tcard-row"><span>🔵</span><span>${cdStr}</span></div>
      <div class="tcard-row"><span>🟣</span><span>${fbStr} ${d.fiberSplit===false?'(single span)':'(split per seg)'}</span></div>
      <div class="tcard-row"><span>🏗️</span><span>${vaultStr}</span></div>
      <div class="row" style="margin-top:6px;gap:5px">
        <button class="btn btn-p btn-sm" onclick="window.__pkgLoadTmpl('${t.name}')">Load</button>
        <button class="btn btn-r btn-sm" onclick="window.__pkgDelTmpl('${t.name}')">Delete</button>
      </div>
    </div>`;
  }
  function renderTmplSection(){
    const tmpls=Object.values(Tmpl.all()).sort((a,b)=>new Date(b.created)-new Date(a.created));
    if(!tmpls.length)return`<div class="empty" style="padding:8px">No saved templates.</div>`;
    const recent=tmpls.slice(0,3),rest=tmpls.slice(3);
    return`${recent.map(tmplCardHTML).join('')}${rest.length?`<div id="tmpl-more-x" style="display:none">${rest.map(tmplCardHTML).join('')}</div><button class="btn btn-n btn-sm" style="width:100%;margin-top:2px" onclick="const m=document.getElementById('tmpl-more-x');m.style.display=m.style.display==='none'?'block':'none';this.textContent=m.style.display==='none'?'Show ${rest.length} more…':'Show fewer'">Show ${rest.length} more…</button>`:``}`;
  }

  // ── Pick from Map ─────────────────────────────────────────────────────
  function startPick(){
    if(pickH){pickH.remove();pickH=null;}
    mv.container.style.cursor='crosshair';
    const banner=qs('#pick-active-banner');if(banner)banner.style.display='flex';
    setStatus('Click a feature on the map to copy attributes…','warn');
    pickH=mv.on('click',async evt=>{
      evt.stopPropagation();
      const mapPt=mv.toMap({x:evt.x,y:evt.y}),tol=mv.resolution*SNAP_PX*2;
      const ext={type:'extent',xmin:mapPt.x-tol,ymin:mapPt.y-tol,xmax:mapPt.x+tol,ymax:mapPt.y+tol,spatialReference:mapPt.spatialReference};
      const msgs=[];
      try{
        if(pickOpts.vault){const vl=mv.map.allLayers.find(l=>l.layerId===LAYERS.vault.id);if(vl){const r=await vl.queryFeatures({geometry:ext,returnGeometry:false,outFields:['*'],num:1});if(r.features?.length){const a=r.features[0].attributes;cfg={workflow_stage:a.workflow_stage||cfg.workflow_stage,workflow_status:a.workflow_status||cfg.workflow_status,work_type:a.work_type||cfg.work_type,client_code:a.client_code||cfg.client_code,project_id:a.project_id||cfg.project_id,job_number:a.job_number||cfg.job_number,workorder_id:a.workorder_id||cfg.workorder_id,purchase_order_id:a.purchase_order_id||cfg.purchase_order_id};vCfg={vault_type:a.vault_type||vCfg.vault_type,vault_size:a.vault_size||vCfg.vault_size,vault_material:a.vault_material||vCfg.vault_material,physical_status:a.physical_status||vCfg.physical_status,vault_tier_rating:a.vault_tier_rating||vCfg.vault_tier_rating};msgs.push('✅ Vault');}}}
        if(pickOpts.conduit){const sl=mv.map.allLayers.find(l=>l.layerId===LAYERS.span.id);if(sl){const r=await sl.queryFeatures({geometry:ext,returnGeometry:false,outFields:['*'],num:1});if(r.features?.length){const a=r.features[0].attributes;const newRow={id:uid(),conduit_diameter:a.conduit_diameter||'',conduit_material:a.conduit_material||'',installation_method:a.installation_method||'',placement_type:a.placement_type||'',conduit_count:a.conduit_count||'',inner_duct:a.inner_duct||'',minimum_depth:a.minimum_depth||''};saveConduits();const blank=conduits.length===1&&!Object.entries(conduits[0]).some(([k,v])=>k!=='id'&&v!=='');conduits=blank?[newRow]:[...conduits,newRow];msgs.push(blank?'✅ Conduit filled':'✅ Conduit added');}}}
        if(pickOpts.fiber){const cl=mv.map.allLayers.find(l=>l.layerId===LAYERS.cable.id);if(cl){const r=await cl.queryFeatures({geometry:ext,returnGeometry:false,outFields:['*'],num:1});if(r.features?.length){const a=r.features[0].attributes;const newRow={id:uid(),fiber_count:a.fiber_count||'',buffer_count:a.buffer_count||'',cable_category:a.cable_category||'',cable_type:a.cable_type||'',sheath_type:a.sheath_type||'',core_type:a.core_type||'',installation_method:a.installation_method||'',placement_type:a.placement_type||''};saveFibers();const blank=fibers.length===1&&!Object.entries(fibers[0]).some(([k,v])=>k!=='id'&&v!=='');fibers=blank?[newRow]:[...fibers,newRow];msgs.push(blank?'✅ Fiber filled':'✅ Fiber added');}}}
      }catch(e){msgs.push('⚠️ '+e.message);}
      endPick();render();
      setStatus(msgs.length?msgs.join(' · '):'No features found near click.', msgs.length?'success':'warn');
    });
  }
  function endPick(){if(pickH){pickH.remove();pickH=null;}mv.container.style.cursor='default';pickMode=false;const banner=qs('#pick-active-banner');if(banner)banner.style.display='none';}

  // ── State Collectors ──────────────────────────────────────────────────
  function readConduit(row){const g=(id,fk)=>{const e=box.querySelector(`#${id}`);return e?e.value.trim():(row[fk]||'');};return{conduit_diameter:g(`cd_d_${row.id}`,'conduit_diameter'),conduit_material:g(`cd_m_${row.id}`,'conduit_material'),installation_method:g(`cd_im_${row.id}`,'installation_method'),placement_type:g(`cd_pt_${row.id}`,'placement_type'),conduit_count:g(`cd_cc_${row.id}`,'conduit_count'),inner_duct:g(`cd_id_${row.id}`,'inner_duct'),minimum_depth:g(`cd_md_${row.id}`,'minimum_depth')};}
  function readFiber(row){const g=(id,fk)=>{const e=box.querySelector(`#${id}`);return e?e.value.trim():(row[fk]||'');};return{fiber_count:g(`fb_fc_${row.id}`,'fiber_count'),buffer_count:g(`fb_bc_${row.id}`,'buffer_count'),cable_category:g(`fb_ca_${row.id}`,'cable_category'),cable_type:g(`fb_ct_${row.id}`,'cable_type'),sheath_type:g(`fb_st_${row.id}`,'sheath_type'),core_type:g(`fb_co_${row.id}`,'core_type'),installation_method:g(`fb_im_${row.id}`,'installation_method'),placement_type:g(`fb_pt_${row.id}`,'placement_type')};}
  function saveConduits(){conduits=conduits.map(r=>({...r,...readConduit(r)}));}
  function saveFibers(){fibers=fibers.map(r=>({...r,...readFiber(r)}));}
  function saveVCfg(){vCfg={vault_type:gval('v_vt'),vault_size:gval('v_vs'),vault_material:gval('v_vm'),physical_status:gval('v_ps'),vault_tier_rating:gval('v_vtr')};}
  function saveCfg(){cfg={workflow_stage:gval('f_ws'),workflow_status:gval('f_wst'),work_type:gval('f_wt'),client_code:gval('f_cc'),project_id:gval('f_pi'),job_number:gval('f_jn'),workorder_id:gval('f_wo'),purchase_order_id:gval('f_po')};}
  function validateSetup(){const map={f_ws:'Workflow Stage',f_wst:'Workflow Status',f_wt:'Work Type',f_cc:'Client Code',f_pi:'Project ID',f_jn:'Job Number',f_wo:'Work Order ID',f_po:'Purchase Order ID'};for(const [id,label] of Object.entries(map)){if(!gval(id))return`"${label}" is required`;}return null;}
  function setStatus(msg,type='info'){const e=qs('.sbar');if(!e)return;const c={info:'#a6adc8',success:'#a6e3a1',error:'#f38ba8',warn:'#fab387'};e.style.color=c[type]||c.info;e.textContent=msg;}
  function showErr(sel,msg){const e=qs(sel);if(e){e.textContent=msg;e.style.display='block';}}
  function hideErr(sel){const e=qs(sel);if(e)e.style.display='none';}
  function tabs(){const order=['setup','layers','place','review'],labels=['1 · Setup','2 · Layers','3 · Place','4 · Review'],cur=order.indexOf(step);return order.map((s,i)=>`<div class="${i<cur?'tab done':s===step?'tab active':'tab'}">${i<cur?'✓ ':''}${labels[i]}</div>`).join('');}

  // ── Render: SETUP ─────────────────────────────────────────────────────
  function renderSetup(){
    const tmplCount=Object.keys(Tmpl.all()).length;
    return`
      ${tmplCount?`<div class="sec collapsed"><div class="sec-hdr clickable" onclick="this.closest('.sec').classList.toggle('collapsed')"><span>Saved Templates (${tmplCount})</span><span class="chevron">▼</span></div><div class="sec-body" style="padding:8px">${renderTmplSection()}</div></div>`:``}
      ${pickMode?`<div class="pick-panel">
        <div class="pick-panel-title"><span>🎯 Pick from Map</span><button class="btn btn-r btn-sm" onclick="window.__pkgEndPick()">✕ Cancel</button></div>
        <div class="pick-chk">
          <label><input type="checkbox" id="pick_vault" ${pickOpts.vault?'checked':''} onchange="window.__pkgPickOpt('vault',this.checked)"> 🏗️ Vault — fills Step 1 + vault options</label>
          <label><input type="checkbox" id="pick_conduit" ${pickOpts.conduit?'checked':''} onchange="window.__pkgPickOpt('conduit',this.checked)"> 🔵 Conduit/Span — fills/adds conduit row</label>
          <label><input type="checkbox" id="pick_fiber" ${pickOpts.fiber?'checked':''} onchange="window.__pkgPickOpt('fiber',this.checked)"> 🟣 Fiber Cable — fills/adds fiber row</label>
        </div>
        <div id="pick-active-banner" class="pick-active-banner" style="display:none"><span>🖱️ Click a feature on the map…</span></div>
        <button class="btn btn-b" style="width:100%" onclick="window.__pkgStartPick()">▶ Click Map to Pick</button>
      </div>`:``}
      <div class="sec">
        <div class="sec-hdr"><span>Workflow Fields</span><button class="btn btn-b btn-sm" id="btn-pick-toggle">🎯 Pick from Map</button></div>
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
        ${currentTmplName?`<button class="btn btn-n" id="btn-sv-current">💾 Save to "${currentTmplName}"</button>`:`<button class="btn btn-n" id="btn-sv-current" disabled>💾 Save to Current</button>`}
        <button class="btn btn-n" id="btn-sv-new">💾 Save as New</button>
        <button class="btn btn-p" id="btn-to-layers">Next →</button>
      </div>
      <div id="setup-err" class="errbx" style="display:none"></div>`;
  }

  // ── Render: LAYERS ────────────────────────────────────────────────────
  function renderLayers(){
    const tmplCount=Object.keys(Tmpl.all()).length;
    return`
      <div class="sec collapsed"><div class="sec-hdr clickable" onclick="this.closest('.sec').classList.toggle('collapsed')">
        <span>🏗️ Vault Options <span style="font-weight:400;color:#6c7086;font-size:10px">(optional)</span></span><span class="chevron">▼</span>
      </div><div class="sec-body">
        <div class="grid2">
          ${frow('Vault Type',      mkSelect('vault_type','v_vt',vCfg.vault_type))}
          ${frow('Vault Size',      mkSelect('vault_size','v_vs',vCfg.vault_size))}
          ${frow('Vault Material',  mkSelect('vault_material','v_vm',vCfg.vault_material))}
          ${frow('Physical Status', mkSelect('physical_status','v_ps',vCfg.physical_status))}
        </div>
        ${frow('Vault Tier Rating', mkSelect('vault_tier_rating','v_vtr',vCfg.vault_tier_rating))}
      </div></div>
      <div class="sec"><div class="sec-hdr">
        <span>🔵 Conduit Stack <span class="badge bp" style="margin-left:5px">${conduits.length} row${conduits.length!==1?'s':''}</span></span>
        <button class="btn btn-p btn-sm" id="btn-add-cd">+ Add Row</button>
      </div><div style="overflow-x:auto"><div id="cd-stk">${renderConduitStack()}</div></div>
      <div style="padding:4px 10px 7px;font-size:9px;color:#585b70">Each row creates one span per vault-to-vault segment.</div></div>
      <div class="sec"><div class="sec-hdr">
        <div style="display:flex;align-items:center;gap:8px">
          <span>🟣 Fiber Stack <span class="badge bp" style="margin-left:5px">${fibers.length} row${fibers.length!==1?'s':''}</span></span>
          ${mkToggle('fiberSplit','Split per segment',fiberSplit)}
        </div>
        <button class="btn btn-p btn-sm" id="btn-add-fb">+ Add Row</button>
      </div><div style="overflow-x:auto"><div id="fb-stk">${renderFiberStack()}</div></div>
      <div style="padding:4px 10px 7px;font-size:9px;color:#585b70">${fiberSplit?'One fiber per vault-to-vault segment.':'One fiber spanning all vaults.'}</div></div>
      <div class="row" style="margin-bottom:11px">
        ${currentTmplName?`<button class="btn btn-n" id="btn-sv-current-2">💾 Save to "${currentTmplName}"</button>`:`<button class="btn btn-n" id="btn-sv-current-2" disabled>💾 Save to Current</button>`}
        <button class="btn btn-n" id="btn-sv-new-2">💾 Save as New</button>
      </div>
      ${tmplCount?`<div class="sec collapsed"><div class="sec-hdr clickable" onclick="this.closest('.sec').classList.toggle('collapsed')"><span>Templates (${tmplCount})</span><span class="chevron">▼</span></div><div class="sec-body" style="padding:8px">${renderTmplSection()}</div></div>`:``}
      <div class="row">
        <button class="btn btn-n" id="btn-to-setup">← Back</button>
        <button class="btn btn-p" id="btn-to-place">Next: Placement →</button>
      </div>
      <div id="layers-err" class="errbx" style="display:none"></div>`;
  }

  function renderConduitStack(){
    if(!conduits.length)return`<div class="empty">No rows — click "+ Add Row"</div>`;
    return`<table class="stk"><thead><tr><th>Diameter</th><th>Material</th><th>Method</th><th>Placement</th><th>Count</th><th>Inner&nbsp;Duct</th><th>Depth&nbsp;ft</th><th></th></tr></thead>
    <tbody>${conduits.map(r=>`<tr><td>${mkSelect('conduit_diameter',`cd_d_${r.id}`,r.conduit_diameter)}</td><td>${mkSelect('conduit_material',`cd_m_${r.id}`,r.conduit_material)}</td><td>${mkSelect('installation_method',`cd_im_${r.id}`,r.installation_method)}</td><td>${mkSelect('placement_type',`cd_pt_${r.id}`,r.placement_type)}</td><td><input type="number" id="cd_cc_${r.id}" value="${r.conduit_count||''}" min="1" placeholder="#"></td><td>${mkSelect('inner_duct',`cd_id_${r.id}`,r.inner_duct)}</td><td><input type="number" id="cd_md_${r.id}" value="${r.minimum_depth||''}" min="0" placeholder="ft"></td><td><button class="btn btn-r btn-sm" onclick="window.__pkgDelCd('${r.id}')">✕</button></td></tr>`).join('')}</tbody></table>`;
  }
  function renderFiberStack(){
    if(!fibers.length)return`<div class="empty">No rows — click "+ Add Row"</div>`;
    return`<table class="stk"><thead><tr><th>Fiber&nbsp;Ct</th><th>Buffer&nbsp;Ct</th><th>Category</th><th>Cable Type</th><th>Sheath</th><th>Core</th><th>Method</th><th>Placement</th><th></th></tr></thead>
    <tbody>${fibers.map(r=>`<tr><td>${mkSelect('fiber_count',`fb_fc_${r.id}`,r.fiber_count)}</td><td>${mkSelect('buffer_count',`fb_bc_${r.id}`,r.buffer_count)}</td><td>${mkSelect('cable_category',`fb_ca_${r.id}`,r.cable_category)}</td><td>${mkSelect('cable_type',`fb_ct_${r.id}`,r.cable_type)}</td><td>${mkSelect('sheath_type',`fb_st_${r.id}`,r.sheath_type)}</td><td>${mkSelect('core_type',`fb_co_${r.id}`,r.core_type)}</td><td>${mkSelect('cable_installation_method',`fb_im_${r.id}`,r.installation_method)}</td><td>${mkSelect('cable_placement_type',`fb_pt_${r.id}`,r.placement_type)}</td><td><button class="btn btn-r btn-sm" onclick="window.__pkgDelFb('${r.id}')">✕</button></td></tr>`).join('')}</tbody></table>`;
  }

  // ── Render: PLACE ─────────────────────────────────────────────────────
  function renderPlace(){
    const vaultCt=pts.filter(p=>!p.noVault).length;
    const freeCt=pts.filter(p=>p.noVault).length;
    const segs=buildSegments(pts).length;
    const len=pts.length>1?Geo.totalLen(pts.map(p=>p.pt)):0;
    const arcLabels=['start of curve','midpoint along curve','end of curve'];
    return`
      <div class="sec"><div class="sec-body" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="badge bp">${vaultCt} vault${vaultCt!==1?'s':''}</span>
        ${freeCt?`<span class="badge bb">${freeCt} free point${freeCt!==1?'s':''}</span>`:''}
        <span class="badge bp">${segs} span seg${segs!==1?'s':''}</span>
        ${len?`<span style="margin-left:auto;font-size:10px;color:#a6adc8">~${len.toLocaleString()} ft</span>`:''}
      </div></div>
      ${arcMode?`<div class="arc-guide">
        <span class="arc-step ${arcPts.length>0?'done':'cur'}">1</span>
        <span class="arc-step ${arcPts.length>1?'done':arcPts.length===1?'cur':'wait'}">2</span>
        <span class="arc-step ${arcPts.length>2?'done':arcPts.length===2?'cur':'wait'}">3</span>
        <div>
          <div style="font-weight:700">⌒ Arc Mode — click the <em>${arcLabels[arcPts.length]||'complete'}</em></div>
          <div class="arc-density-row">Spacing: <input type="number" id="arc-density-inp" value="${arcDensity}" min="10" max="500"> ft &nbsp;<button class="btn btn-r btn-sm" onclick="window.__pkgCancelArc()">Cancel Arc</button></div>
        </div>
      </div>`:``}
      <div class="sec"><div class="sec-hdr" style="cursor:default">Placed Points</div>
        <div class="sec-body" style="padding:6px"><div class="plist" id="plist">
          ${pts.length?pts.map((p,i)=>`<div class="pitem">
            <span>${p.noVault?'✕':'📍'} ${p.noVault?'Free Pt':'Vault'} ${i+1}</span>
            <span style="color:#6c7086;font-size:9px">${p.pt.x.toFixed(0)}, ${p.pt.y.toFixed(0)}</span>
            ${i>0?`<span style="color:#585b70;font-size:9px">+${Geo.dist(pts[i-1].pt,p.pt).toLocaleString()} ft</span>`:'<span></span>'}
          </div>`).join(''):`<div class="empty">Enable placement and click the map.</div>`}
        </div></div></div>
      <div class="row" style="margin-bottom:7px">
        <button class="btn btn-g" id="btn-enable" ${active?'disabled':''}>▶ Enable</button>
        <button class="btn btn-n" id="btn-disable" ${!active?'disabled':''}>⏹ Stop</button>
      </div>
      <div class="row" style="margin-bottom:7px">
        <button class="btn btn-n ${waypointMode?'btn-active':''}" id="btn-waypoint" style="flex:1">✕ Free Point: ${waypointMode?'ON':'OFF'}</button>
        <button class="btn btn-n ${arcMode?'btn-arc-on':''}" id="btn-arc" style="flex:1">⌒ Arc${arcMode?' ON':''}</button>
      </div>
      <div class="row" style="margin-bottom:7px">
        <button class="btn btn-o" id="btn-undo" ${!pts.length?'disabled':''}>↩ Undo</button>
        <button class="btn btn-r" id="btn-clear" ${!pts.length?'disabled':''}>✕ Clear</button>
      </div>
      <div class="row">
        <button class="btn btn-n" id="btn-to-layers">← Back</button>
        <button class="btn btn-p" id="btn-to-review" ${pts.length<2?'disabled':''}>Review →</button>
      </div>
      <div class="tip" style="margin-top:8px">
        <kbd>Enter</kbd> review &nbsp;·&nbsp; <kbd>Esc</kbd> undo / cancel arc &nbsp;·&nbsp;
        <kbd>Shift</kbd>+Click = free point &nbsp;·&nbsp;
        Free points are vertices only — spans only break at vaults.
      </div>`;
  }

  // ── Render: REVIEW ────────────────────────────────────────────────────
  function renderReview(){
    const vaultCt=pts.filter(p=>!p.noVault).length;
    const freeCt=pts.filter(p=>p.noVault).length;
    const segments=buildSegments(pts);
    const segCt=segments.length;
    const sCt=segCt*conduits.length;
    const fCt=fiberSplit?segCt*fibers.length:fibers.length;
    const total=vaultCt+sCt+fCt;
    const len=Geo.totalLen(pts.map(p=>p.pt));
    return`
      <div class="sec"><div class="sec-hdr" style="cursor:default">Package Summary — ${total} features</div>
        <div class="sec-body" style="padding:6px"><table class="rvtbl">
          <tr><td>Vaults</td><td><span class="badge bp">${vaultCt}</span></td></tr>
          ${freeCt?`<tr><td>Free Points (vertices)</td><td><span class="badge bb">${freeCt}</span></td></tr>`:''}
          <tr><td>Vault-to-Vault Segments</td><td><span class="badge bp">${segCt}</span></td></tr>
          <tr><td>Spans</td><td><span class="badge bp">${segCt} seg × ${conduits.length} rows = ${sCt}</span></td></tr>
          <tr><td>Fiber Cables</td><td><span class="badge bp">${fiberSplit?`${segCt} seg × ${fibers.length} rows = ${fCt}`:`${fibers.length} (full span)`}</span></td></tr>
          <tr><td>Total Length</td><td>~${len.toLocaleString()} ft</td></tr>
          <tr><td>Project</td><td>${cfg.project_id}</td></tr>
          <tr><td>Job / WO</td><td>${cfg.job_number} / ${cfg.workorder_id}</td></tr>
          <tr><td>Workflow</td><td>${cfg.workflow_stage} · ${cfg.workflow_status}</td></tr>
        </table></div></div>
      <div id="prog-wrap" style="display:none;margin-bottom:8px">
        <div id="prog-lbl" style="font-size:10px;color:#a6adc8;margin-bottom:4px">Creating features…</div>
        <div class="pbwrap"><div class="pbfill" id="pbfill"></div></div>
      </div>
      <div class="row" style="margin-top:4px">
        <button class="btn btn-n" id="btn-to-place">← Back</button>
        <button class="btn btn-g" id="btn-commit">✅ Commit Package</button>
      </div>
      <div id="rv-result"></div>`;
  }

  // ── Main Render ───────────────────────────────────────────────────────
  function render(){
    let body='';
    if(step==='setup') body=renderSetup();
    if(step==='layers')body=renderLayers();
    if(step==='place') body=renderPlace();
    if(step==='review')body=renderReview();
    box.innerHTML=`<div class="hdr"><span style="font-size:15px">📦</span><span class="hdr-title">Package Creator v2</span><button class="hdr-close" id="btn-close">✕</button></div>
      <div class="tabs">${tabs()}</div><div class="body">${body}</div><div class="sbar">Ready.</div>`;
    bind();makeDraggable();initSearchSelects();
  }

  // ── Bind ──────────────────────────────────────────────────────────────
  function bind(){
    const on=(id,ev,fn)=>{const e=qs(`#${id}`);if(e)e.addEventListener(ev,fn);};
    on('btn-close','click',()=>{disableTool();endPick();clearGL();styleEl.remove();document.removeEventListener('click',closeAllDrops);box.remove();});
    if(step==='setup'){
      on('btn-pick-toggle','click',()=>{pickMode=!pickMode;render();});
      on('btn-sv-current','click',()=>{const err=validateSetup();if(err){showErr('#setup-err',err);return;}doSaveTemplate(currentTmplName);});
      on('btn-sv-new','click',()=>{const err=validateSetup();if(err){showErr('#setup-err',err);return;}const name=prompt('Template name:');if(!name)return;doSaveTemplate(name);});
      on('btn-to-layers','click',()=>{const err=validateSetup();if(err){showErr('#setup-err',err);return;}hideErr('#setup-err');saveCfg();step='layers';render();});
    }
    if(step==='layers'){
      // Save step 2 state before going back to step 1
      on('btn-to-setup','click',()=>{saveVCfg();saveConduits();saveFibers();step='setup';render();});
      on('btn-to-place','click',()=>{saveVCfg();saveConduits();saveFibers();step='place';render();initGL();});
      on('btn-add-cd','click',()=>{saveConduits();conduits.push({id:uid()});const el=qs('#cd-stk');if(el){el.innerHTML=renderConduitStack();initSearchSelects(el);}});
      on('btn-add-fb','click',()=>{saveFibers();fibers.push({id:uid()});const el=qs('#fb-stk');if(el){el.innerHTML=renderFiberStack();initSearchSelects(el);}});
      on('btn-sv-current-2','click',()=>{if(!currentTmplName)return;doSaveTemplate(currentTmplName);});
      on('btn-sv-new-2','click',()=>{const name=prompt('Template name:');if(!name)return;doSaveTemplate(name);});
    }
    if(step==='place'){
      on('btn-enable','click',enableTool);on('btn-disable','click',disableTool);
      on('btn-waypoint','click',()=>{arcMode=false;cancelArc();waypointMode=!waypointMode;const btn=qs('#btn-waypoint');if(btn){btn.classList.toggle('btn-active',waypointMode);btn.textContent=`✕ Free Point: ${waypointMode?'ON':'OFF'}`;}});
      on('btn-arc','click',()=>{waypointMode=false;arcMode=!arcMode;arcPts=[];clearArcGuides();if(arcMode)setStatus('Arc Mode: click the start point of the curve.','warn');render();});
      on('btn-to-layers','click',()=>{disableTool();cancelArc();step='layers';render();});
      on('btn-to-review','click',()=>{disableTool();cancelArc();step='review';render();});
      on('btn-undo','click',undoLast);
      on('btn-clear','click',()=>{pts=[];clearGL();waypointMode=false;cancelArc();refreshPlaceUI();});
    }
    if(step==='review'){
      on('btn-to-place','click',()=>{step='place';render();});
      on('btn-commit','click',commitPackage);
    }
  }

  // ── Placement ─────────────────────────────────────────────────────────
  function enableTool(){
    active=true;clickH=mv.on('click',handleClick);keyH=e=>handleKey(e);
    document.addEventListener('keydown',keyH);mv.container.style.cursor='crosshair';
    const en=qs('#btn-enable'),di=qs('#btn-disable');if(en)en.disabled=true;if(di)di.disabled=false;
    setStatus('Placement active — click map to place vaults.');
  }
  function disableTool(){
    active=false;if(clickH){clickH.remove();clickH=null;}if(keyH){document.removeEventListener('keydown',keyH);keyH=null;}
    if(mv?.container)mv.container.style.cursor='default';removeSnapRing();
    const en=qs('#btn-enable'),di=qs('#btn-disable');if(en)en.disabled=false;if(di)di.disabled=true;
    setStatus('Placement stopped.');
  }
  function cancelArc(){arcMode=false;arcPts=[];clearArcGuides();}

  async function handleClick(evt){
    if(!active)return;evt.stopPropagation();
    if(arcMode){
      const dinp=qs('#arc-density-inp');if(dinp)arcDensity=Math.max(10,parseInt(dinp.value)||50);
      const pt=mv.toMap({x:evt.x,y:evt.y});
      arcPts.push(pt);addArcGuideMarker(pt,arcPts.length);
      if(arcPts.length<3){setStatus(`Arc: click the ${['','midpoint along curve','end of curve'][arcPts.length]}…`,'warn');render();return;}
      // All 3 points placed — generate arc
      const waypoints=generateArcWaypoints(arcPts[0],arcPts[1],arcPts[2],arcDensity);
      clearArcGuides();
      for(const wp of waypoints){pts.push({pt:wp,noVault:true});addMarker(wp,pts.length-1,true);}
      cancelArc();refreshPlaceUI();render();
      setStatus(`⌒ Arc complete — ${waypoints.length} free points added.`,'success');
      return;
    }
    const isFree=waypointMode||(evt.native?.shiftKey||false);
    const snap=await findSnap(evt);const pt=snap||mv.toMap({x:evt.x,y:evt.y});
    if(snap){setStatus('Snapped to existing vault.','warn');removeSnapRing();}
    pts.push({pt,noVault:isFree});addMarker(pt,pts.length-1,isFree);
    if(waypointMode){waypointMode=false;const btn=qs('#btn-waypoint');if(btn){btn.classList.remove('btn-active');btn.textContent='✕ Free Point: OFF';}}
    refreshPlaceUI();
    setStatus(`${isFree?'✕ Free point':'📍 Vault'} ${pts.length} placed.${pts.length>=2?' Enter to review.':' Place 1 more.'}`, 'info');
  }

  function handleKey(e){
    if(!active)return;
    if(e.key==='Escape'){
      if(arcMode){cancelArc();render();setStatus('Arc cancelled.');return;}
      undoLast();return;
    }
    if(e.key==='Enter'&&pts.length>=2&&!arcMode){disableTool();step='review';render();}
  }

  function undoLast(){
    if(arcMode&&arcPts.length){
      arcPts.pop();clearArcGuides();arcPts.forEach((p,i)=>addArcGuideMarker(p,i+1));render();
      setStatus(`Arc point removed. ${['Click start of curve.','Click midpoint.','Click end point.'][arcPts.length]}`,'warn');
      return;
    }
    if(!pts.length)return;
    pts.pop();removeLastMarker();refreshPlaceUI();
    setStatus(pts.length?`Point ${pts.length+1} removed.`:'All points cleared.');
  }

  function refreshPlaceUI(){
    const listEl=qs('#plist');
    if(listEl)listEl.innerHTML=pts.length?pts.map((p,i)=>`<div class="pitem">
      <span>${p.noVault?'✕':'📍'} ${p.noVault?'Free Pt':'Vault'} ${i+1}</span>
      <span style="color:#6c7086;font-size:9px">${p.pt.x.toFixed(0)}, ${p.pt.y.toFixed(0)}</span>
      ${i>0?`<span style="color:#585b70;font-size:9px">+${Geo.dist(pts[i-1].pt,p.pt).toLocaleString()} ft</span>`:'<span></span>'}
    </div>`).join(''):`<div class="empty">Enable placement and click the map.</div>`;
    const undo=qs('#btn-undo'),clr=qs('#btn-clear'),rev=qs('#btn-to-review');
    if(undo)undo.disabled=!pts.length;if(clr)clr.disabled=!pts.length;if(rev)rev.disabled=pts.length<2;
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
      const base={workflow_stage:cfg.workflow_stage,workflow_status:cfg.workflow_status,work_type:cfg.work_type,client_code:cfg.client_code,project_id:cfg.project_id,job_number:cfg.job_number,purchase_order_id:cfg.purchase_order_id,workorder_id:cfg.workorder_id,delete_feature:'NO',construction_status:'NA'};
      const vaultOpts=Object.fromEntries(Object.entries(vCfg).filter(([,v])=>v!==''));
      const vaultCount=pts.filter(p=>!p.noVault).length;

      // Build vault-to-vault segments (free points become vertices, not endpoints)
      const segments=buildSegments(pts);
      const segCt=segments.length;
      const fiberFeatureCount=fiberSplit?segCt*fibers.length:fibers.length;
      const total=vaultCount+segCt*conduits.length+fiberFeatureCount;
      let done=0;const tick=msg=>{done++;setP(Math.round(done/total*100),msg);};

      // Create vaults (skip free points)
      for(let i=0;i<pts.length;i++){
        if(pts[i].noVault)continue;
        const name=`Vault_${Date.now()}_${i+1}`;
        try{const id=await createFeat(vl,pts[i].pt,{...base,...vaultOpts,vault_name:name});log.vaults.push(id);}
        catch(e){log.errors.push(`Vault ${i+1}: ${e.message}`);}
        tick(`Creating vaults… ${log.vaults.length}/${vaultCount}`);
      }

      // Create spans — one per conduit row per vault-to-vault segment
      // Each segment is a multi-vertex polyline; free points and arc points are intermediate vertices
      for(let ri=0;ri<conduits.length;ri++){
        const rv=readConduit(conduits[ri]);
        const spanOpts=Object.fromEntries(Object.entries(rv).filter(([,v])=>v!==''));
        if(spanOpts.conduit_count)spanOpts.conduit_count=parseInt(spanOpts.conduit_count);
        if(spanOpts.minimum_depth)spanOpts.minimum_depth=parseInt(spanOpts.minimum_depth);
        for(let si=0;si<segments.length;si++){
          const segPts=segments[si];
          const geom={type:'polyline',paths:[segPts.map(p=>[p.x,p.y])],spatialReference:segPts[0].spatialReference};
          const len=Geo.totalLen(segPts);
          try{const id=await createFeat(sl,geom,{...base,...spanOpts,calculated_length:len});log.spans.push(id);}
          catch(e){log.errors.push(`Span seg ${si+1} row ${ri+1}: ${e.message}`);}
          tick(`Creating spans… row ${ri+1}/${conduits.length}, seg ${si+1}/${segCt}`);
        }
      }

      // Create fiber cables — split at vault boundaries, free points are vertices
      for(let ri=0;ri<fibers.length;ri++){
        const rv=readFiber(fibers[ri]);
        const fibOpts=Object.fromEntries(Object.entries(rv).filter(([,v])=>v!==''));
        if(fibOpts.fiber_count)fibOpts.fiber_count=parseInt(fibOpts.fiber_count);
        if(fibOpts.buffer_count)fibOpts.buffer_count=parseInt(fibOpts.buffer_count);
        if(fiberSplit){
          for(let si=0;si<segments.length;si++){
            const segPts=segments[si];
            const name=`Fiber_${Date.now()}_r${ri+1}_s${si+1}`;
            const geom={type:'polyline',paths:[segPts.map(p=>[p.x,p.y])],spatialReference:segPts[0].spatialReference};
            const len=Geo.totalLen(segPts);
            try{const id=await createFeat(cl,geom,{...base,...fibOpts,cable_name:name,calculated_length:len});log.fibers.push(id);}
            catch(e){log.errors.push(`Fiber seg ${si+1} row ${ri+1}: ${e.message}`);}
            tick(`Creating fiber… row ${ri+1}/${fibers.length}, seg ${si+1}/${segCt}`);
          }
        } else {
          const name=`Fiber_${Date.now()}_r${ri+1}`;
          const geom={type:'polyline',paths:[pts.map(p=>[p.pt.x,p.pt.y])],spatialReference:pts[0].pt.spatialReference};
          try{const id=await createFeat(cl,geom,{...base,...fibOpts,cable_name:name,calculated_length:Geo.totalLen(pts.map(p=>p.pt))});log.fibers.push(id);}
          catch(e){log.errors.push(`Fiber row ${ri+1}: ${e.message}`);}
          tick(`Creating fiber… row ${ri+1}/${fibers.length}`);
        }
      }

      setP(100,'Done!');clearGL();
      const rvRes=qs('#rv-result');
      if(rvRes){
        if(!log.errors.length){
          rvRes.innerHTML=`<div class="okbx">✅ Package created!<br><strong>${log.vaults.length}</strong> vaults · <strong>${log.spans.length}</strong> spans · <strong>${log.fibers.length}</strong> fiber cables</div>
            <div class="row" style="margin-top:8px"><button class="btn btn-p" onclick="window.__pkgNewPkg()">📦 New Package (same config)</button></div>`;
        } else {
          rvRes.innerHTML=`<div class="errbx">⚠️ Partial: ${log.vaults.length+log.spans.length+log.fibers.length} created, ${log.errors.length} failed.<br><br>${log.errors.map(e=>`• ${e}`).join('<br>')}</div>`;
          if(commitBtn)commitBtn.disabled=false;if(backBtn)backBtn.disabled=false;
        }
      }
    }catch(err){
      setP(0,'Error');const rvRes=qs('#rv-result');
      if(rvRes)rvRes.innerHTML=`<div class="errbx">❌ ${err.message}</div>`;
      if(commitBtn)commitBtn.disabled=false;if(backBtn)backBtn.disabled=false;
    }
  }

  // ── Global Callbacks ──────────────────────────────────────────────────
  window.__pkgToggle=id=>{if(id==='fiberSplit'){saveConduits();saveFibers();saveVCfg();fiberSplit=!fiberSplit;const track=box.querySelector('#ttrack_fiberSplit');if(track)track.classList.toggle('on',fiberSplit);const footer=box.querySelector('#sec-fib > div:last-of-type');if(footer)footer.innerHTML=fiberSplit?'One fiber per vault-to-vault segment.':'One fiber spanning all vaults.';}};
  window.__pkgPickOpt=(key,val)=>{pickOpts[key]=val;};
  window.__pkgStartPick=()=>{initGL().then(()=>startPick());};
  window.__pkgEndPick=()=>{endPick();pickMode=false;render();};
  window.__pkgCancelArc=()=>{cancelArc();render();setStatus('Arc cancelled.');};
  window.__pkgLoadTmpl=name=>applyTemplate(name);
  window.__pkgDelTmpl=name=>{if(!confirm(`Delete template "${name}"?`))return;Tmpl.del(name);if(currentTmplName===name)currentTmplName=null;render();};
  window.__pkgDelCd=id=>{saveConduits();conduits=conduits.filter(r=>r.id!==id);const el=qs('#cd-stk');if(el){el.innerHTML=renderConduitStack();initSearchSelects(el);}};
  window.__pkgDelFb=id=>{saveFibers();fibers=fibers.filter(r=>r.id!==id);const el=qs('#fb-stk');if(el){el.innerHTML=renderFiberStack();initSearchSelects(el);}};
  window.__pkgNewPkg=()=>{pts=[];waypointMode=false;cancelArc();clearGL();step='place';render();};

  // ── Init ──────────────────────────────────────────────────────────────
  box.innerHTML=`<div class="hdr"><span style="font-size:15px">📦</span><span class="hdr-title">Package Creator v2</span><button class="hdr-close" id="btn-close-init">✕</button></div>
    <div class="body" style="text-align:center;padding:32px;color:#6c7086"><div style="font-size:28px;margin-bottom:10px">⏳</div>Loading layer domains…</div>`;
  qs('#btn-close-init')?.addEventListener('click',()=>{styleEl.remove();document.removeEventListener('click',closeAllDrops);box.remove();});
  makeDraggable();
  try{await loadDomains();render();setStatus(`Domains loaded — ${Object.keys(domains).length} entries found.`,'success');}
  catch(err){qs('.body').innerHTML=`<div class="errbx" style="margin:16px">❌ ${err.message}</div>`;}
}
main().catch(err=>alert('Package Creator v2 failed: '+err.message));
})();
