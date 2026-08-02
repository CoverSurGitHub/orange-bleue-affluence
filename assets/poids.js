/* ===== Section Poids : pesées + évolution ===== */
'use strict';
(function(){

let cal = null;          // calendrier de saisie
let period = 30;         // 30 | 90 | 0 (tout)
let HIT = [];

const entries = () => Object.entries(Store.data.weights)
  .map(([k,v])=>({day:k, kg:v.kg}))
  .sort((a,b)=>a.day.localeCompare(b.day));

function daysBetween(a,b){ return Math.round((keyToDate(b)-keyToDate(a))/864e5); }

/* moyenne mobile 7 j : moyenne des pesées existantes dans la fenêtre [j-6 ; j] */
function movingAvg(list){
  return list.map((e,i)=>{
    const from = keyToDate(e.day).getTime() - 6*864e5;
    const win = list.filter(x=>{ const t=keyToDate(x.day).getTime(); return t>=from && t<=keyToDate(e.day).getTime(); });
    return { day:e.day, kg: win.reduce((s,x)=>s+x.kg,0)/win.length };
  });
}

function save(){
  const inp = document.getElementById('pKg');
  const kg = parseFloat(String(inp.value).replace(',','.'));
  if(!Number.isFinite(kg) || kg<=0 || kg>400){ alert('Poids invalide.'); return; }
  const day = cal.selected || todayKey();
  const existing = Store.data.weights[day];
  if(existing && existing.kg !== kg){
    if(!confirm(`Une pesée existe déjà le ${labelForKey(day)} (${existing.kg} kg).\nLa remplacer par ${kg} kg ?`)) return;
  }
  Store.data.weights[day] = {kg: Math.round(kg*10)/10, updatedAt: nowIso()};
  Store.save();
  inp.value = '';
  inp.blur();
  render();
}

function removeEntry(day){
  if(!confirm(`Supprimer la pesée du ${labelForKey(day)} ?`)) return;
  delete Store.data.weights[day];
  Store.save();
  render();
}

function setGoal(){
  const cur = Store.data.settings.objectifPoids;
  const v = prompt('Objectif de poids en kg (laisser vide pour retirer) :', cur ?? '');
  if(v === null) return;
  const kg = parseFloat(String(v).replace(',','.'));
  if(v.trim()==='' || !Number.isFinite(kg)){ delete Store.data.settings.objectifPoids; }
  else { Store.data.settings.objectifPoids = Math.round(kg*10)/10; }
  Store.save();
  render();
}

function render(){
  const all = entries();
  const tiles = document.getElementById('pTiles');
  const goal = Store.data.settings.objectifPoids;

  if(!all.length){
    tiles.innerHTML = '';
    document.getElementById('pEmpty').style.display = 'block';
    document.getElementById('pChart').style.display = 'none';
    document.getElementById('pList').innerHTML = '';
    return;
  }
  document.getElementById('pEmpty').style.display = 'none';
  document.getElementById('pChart').style.display = 'block';

  const last = all[all.length-1];
  const first = all[0];
  const at = (daysAgo) => {
    const limit = keyToDate(last.day).getTime() - daysAgo*864e5;
    const older = all.filter(e=>keyToDate(e.day).getTime() <= limit);
    return older.length ? older[older.length-1] : null;
  };
  const d7 = at(7), d30 = at(30);
  const delta = (ref) => ref ? Math.round((last.kg-ref.kg)*10)/10 : null;
  const fmtD = v => v===null ? '—' : (v>0?'+':'')+v.toFixed(1);
  const cls = v => {
    if(v===null||v===0) return 'flat';
    if(goal===undefined) return 'flat';
    return ((goal < last.kg) === (v<0)) ? 'down' : 'up';   // vert si on va vers l'objectif
  };
  tiles.innerHTML = `
    <div class="tile"><div class="v">${last.kg.toFixed(1)}</div><div class="l">kg — ${esc(labelForKey(last.day,false))}</div></div>
    <div class="tile"><div class="v ${cls(delta(d7))}">${fmtD(delta(d7))}</div><div class="l">7 jours</div></div>
    <div class="tile"><div class="v ${cls(delta(d30))}">${fmtD(delta(d30))}</div><div class="l">30 jours</div></div>
    <div class="tile"><div class="v ${cls(delta(first))}">${fmtD(delta(first))}</div><div class="l">depuis le début</div></div>
    ${goal!==undefined?`<div class="tile"><div class="v">${goal.toFixed(1)}</div><div class="l">objectif (${fmtD(Math.round((goal-last.kg)*10)/10)} kg)</div></div>`:''}
  `;

  // filtre période
  let list = all;
  if(period > 0){
    const from = keyToDate(last.day).getTime() - period*864e5;
    list = all.filter(e=>keyToDate(e.day).getTime() >= from);
  }
  drawChart(list, movingAvg(list), goal);
  renderList(all);
  cal.refresh();
}

function drawChart(list, avg, goal){
  const canvas = document.getElementById('pChart');
  canvas.style.width = '100%';
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 320, H = canvas.clientHeight || 300;
  canvas.width = W*dpr; canvas.height = H*dpr;
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,W,H);
  HIT = [];
  if(!list.length) return;

  const padL=40, padR=14, padT=16, padB=24;
  const x0=padL, x1=W-padR, y0=H-padB, y1=padT;
  const t0 = keyToDate(list[0].day).getTime(), t1 = keyToDate(list[list.length-1].day).getTime();
  const span = Math.max(t1-t0, 864e5);
  const vals = list.map(e=>e.kg).concat(goal!==undefined?[goal]:[]);
  let vMin = Math.min(...vals), vMax = Math.max(...vals);
  const pad = Math.max(0.5, (vMax-vMin)*0.15);
  vMin -= pad; vMax += pad;
  const sx = t => x0 + (x1-x0)*(t-t0)/span;
  const sy = v => y0 + (y1-y0)*(v-vMin)/(vMax-vMin);

  // grille Y
  ctx.strokeStyle='#2b2e5e'; ctx.fillStyle='#9aa0c7'; ctx.font='11px system-ui'; ctx.lineWidth=1;
  const range=vMax-vMin, yStep = range<=3?0.5:range<=8?1:range<=20?2:5;
  for(let v=Math.ceil(vMin/yStep)*yStep; v<=vMax; v+=yStep){
    const y=sy(v); ctx.beginPath(); ctx.moveTo(x0,y); ctx.lineTo(x1,y); ctx.stroke();
    ctx.fillText(v.toFixed(yStep<1?1:0), 4, y+4);
  }
  // labels X (5 repères max)
  ctx.textAlign='center';
  const nT=Math.min(5, list.length);
  for(let i=0;i<nT;i++){
    const t=t0+span*i/(nT-1||1);
    ctx.fillText(fmtDayShort.format(new Date(t)), sx(t), H-8);
  }
  ctx.textAlign='left';

  // ligne objectif
  if(goal!==undefined){
    ctx.strokeStyle='rgba(255,122,26,.5)'; ctx.setLineDash([5,5]);
    ctx.beginPath(); ctx.moveTo(x0,sy(goal)); ctx.lineTo(x1,sy(goal)); ctx.stroke();
    ctx.setLineDash([]);
  }

  // moyenne mobile 7 j (lissée, en arrière-plan)
  if(avg.length>1){
    ctx.beginPath();
    avg.forEach((e,i)=>{ const X=sx(keyToDate(e.day).getTime()),Y=sy(e.kg); i?ctx.lineTo(X,Y):ctx.moveTo(X,Y); });
    ctx.strokeStyle='rgba(55,201,120,.8)'; ctx.lineWidth=2.5; ctx.stroke();
  }

  // pesées brutes
  ctx.beginPath();
  list.forEach((e,i)=>{ const X=sx(keyToDate(e.day).getTime()),Y=sy(e.kg); i?ctx.lineTo(X,Y):ctx.moveTo(X,Y); });
  ctx.strokeStyle='rgba(83,133,237,.65)'; ctx.lineWidth=1.5; ctx.stroke();
  list.forEach((e,i)=>{
    const X=sx(keyToDate(e.day).getTime()), Y=sy(e.kg);
    ctx.fillStyle = i===list.length-1 ? '#ff7a1a' : '#5385ed';
    ctx.beginPath(); ctx.arc(X,Y,i===list.length-1?4.5:3,0,7); ctx.fill();
    HIT.push({x:X,y:Y,kg:e.kg,day:e.day});
  });
}

function renderList(all){
  const el = document.getElementById('pList');
  const recent = all.slice(-14).reverse();
  el.innerHTML = recent.map(e=>`
    <div class="li-row">
      <div class="grow">
        <div class="name">${esc(labelForKey(e.day))}</div>
      </div>
      <div class="val">${e.kg.toFixed(1)} <small>kg</small></div>
      <button class="li-x" data-del="${e.day}" title="Supprimer">✕</button>
    </div>`).join('');
  el.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click', ()=>removeEntry(b.dataset.del)));
}

function showTip(clientX, clientY){
  if(!HIT.length) return;
  const canvas = document.getElementById('pChart');
  const r = canvas.getBoundingClientRect();
  const px=clientX-r.left, py=clientY-r.top;
  let best=null,bd=Infinity;
  for(const h of HIT){ const d=Math.hypot(h.x-px,h.y-py); if(d<bd){bd=d;best=h;} }
  if(!best) return;
  const tip = document.getElementById('pTip');
  tip.innerHTML = esc(labelForKey(best.day,false)) + ' · <b>' + best.kg.toFixed(1) + '</b> kg';
  tip.style.left = best.x+'px'; tip.style.top = best.y+'px'; tip.style.display='block';
}

document.addEventListener('DOMContentLoaded', ()=>{
  cal = createCalendar({
    button: document.getElementById('pDayBtn'),
    label:  document.getElementById('pDayLabel'),
    popup:  document.getElementById('pDayCal'),
    isSelectable: k => k <= todayKey(),                    // pas de pesée dans le futur
    isMarked:     k => !!Store.data.weights[k],
    onSelect: () => {
      const e = Store.data.weights[cal.selected];
      if(e) document.getElementById('pKg').value = e.kg;   // pré-remplit si pesée existante
    }
  });
  cal.setSelected(todayKey());                             // date du jour pré-sélectionnée

  document.getElementById('pSave').addEventListener('click', save);
  document.getElementById('pKg').addEventListener('keydown', e=>{ if(e.key==='Enter') save(); });
  document.getElementById('pGoal').addEventListener('click', setGoal);
  document.querySelectorAll('#pPeriod .seg-btn').forEach(b=>{
    b.addEventListener('click', ()=>{
      period = +b.dataset.p;
      document.querySelectorAll('#pPeriod .seg-btn').forEach(x=>x.classList.toggle('active', x===b));
      render();
    });
  });
  const wrap = document.getElementById('pChartWrap');
  wrap.addEventListener('pointerdown', e=>showTip(e.clientX,e.clientY));
  wrap.addEventListener('pointermove', e=>{ if(e.pointerType==='mouse') showTip(e.clientX,e.clientY); });
  wrap.addEventListener('pointerleave', e=>{ if(e.pointerType==='mouse') document.getElementById('pTip').style.display='none'; });

  document.addEventListener('pageshow', e=>{ if(e.detail.page==='poids') render(); });
  document.addEventListener('storechange', ()=>{ if(document.getElementById('page-poids').classList.contains('active')) render(); });
  render();
});

})();
