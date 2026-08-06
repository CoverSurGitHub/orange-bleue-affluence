/* ===== Section Salle : affluence (fonctionnalités portées de la v1) ===== */
'use strict';
(function(){

const OPEN_HOUR = 6, CLOSE_HOUR = 23;
const PX_PER_MIN = 5;
const WD_SHORT = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
const PALETTE = ['#5385ed','#ff7a1a','#37c978','#e34cc0','#ffd23f','#2ec5c5','#f2545b','#9b7bff','#a0a7c9','#7ad151'];

let ROWS = [];
let TAB = 'measured';   // measured | compare
let GRAN = 'hours';
let CMP = 'days';
let HIT = [];
let HIDDEN = new Set();
let dayCal = null;

function partsInTZ(date){
  const p = {};
  for(const {type,value} of new Intl.DateTimeFormat('en-GB',{timeZone:TZ,hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(date)){
    p[type]=value;
  }
  return {h:+p.hour, m:+p.minute};
}
function wdFromDayKey(dk){ const [y,m,d]=dk.split('-').map(Number); return (new Date(Date.UTC(y,m-1,d)).getUTCDay()+6)%7; }
function isoWeek(dk){
  const [y,m,d]=dk.split('-').map(Number);
  const dt=new Date(Date.UTC(y,m-1,d));
  const day=(dt.getUTCDay()+6)%7; dt.setUTCDate(dt.getUTCDate()-day+3);
  const firstThu=new Date(Date.UTC(dt.getUTCFullYear(),0,4));
  const fd=(firstThu.getUTCDay()+6)%7; firstThu.setUTCDate(firstThu.getUTCDate()-fd+3);
  return dt.getUTCFullYear()+'-S'+String(1+Math.round((dt-firstThu)/(7*864e5))).padStart(2,'0');
}
function fmtHM(m){ const h=Math.floor(m/60), mm=m%60; return h+'h'+(mm?String(mm).padStart(2,'0'):''); }
function niceStep(max){ return max<=10?2:max<=25?5:max<=60?10:20; }
function hideTip(){ const t=document.getElementById('sTip'); if(t) t.style.display='none'; }

async function load(){
  try{
    // Les mesures vivent sur la branche `data` (voir DATA_BRANCH dans app.js) :
    // ainsi les relevés toutes les 10 min ne relancent plus la publication du site.
    const res = await fetch(DATA_URL('data.csv'), {cache:'no-store'});
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/).slice(1);
    ROWS = lines.filter(Boolean).map(l => {
      const [ts, c] = l.split(',');
      const t = new Date(ts);
      const {h,m} = partsInTZ(t);
      const dayKey = fmtDayKey.format(t);
      return { t, count:+c, dayKey, minOfDay:h*60+m, hhmm:fmtTime.format(t), wd:wdFromDayKey(dayKey), weekKey:isoWeek(dayKey) };
    }).filter(r => Number.isFinite(r.count));
  }catch(e){ ROWS = []; }
  if(ROWS.length){
    const days = [...new Set(ROWS.map(r=>r.dayKey))].sort();
    if(!dayCal.selected || !days.includes(dayCal.selected)) dayCal.setSelected(days[days.length-1]);
  }
  buildCompareSelectors();
  render();
  document.getElementById('sLastUpd').textContent = 'MàJ ' + new Date().toLocaleTimeString('fr-FR');
}

function buildCompareSelectors(){
  const weeks = [...new Set(ROWS.map(r=>r.weekKey))].sort().reverse();
  const wSel = document.getElementById('sWeekSel'); const wPrev = wSel.value;
  wSel.innerHTML='';
  for(const wk of weeks){ const o=document.createElement('option'); o.value=wk; o.textContent='Semaine '+wk.split('-S')[1]+' ('+wk.split('-')[0]+')'; wSel.appendChild(o); }
  if(weeks.includes(wPrev)) wSel.value=wPrev;

  const wds = [...new Set(ROWS.map(r=>r.wd))].sort((a,b)=>a-b);
  const dSel = document.getElementById('sCmpWd'); const dPrev = dSel.value;
  dSel.innerHTML='';
  const WD_LONG = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
  for(const wd of wds){ const o=document.createElement('option'); o.value=wd; o.textContent=WD_LONG[wd]; dSel.appendChild(o); }
  if([...dSel.options].some(o=>o.value===dPrev)) dSel.value=dPrev;
}

function setTab(t){
  TAB = t;
  document.getElementById('sTabMeasured').classList.toggle('active', t==='measured');
  document.getElementById('sTabCompare').classList.toggle('active', t==='compare');
  document.getElementById('sCalWrap').style.display = t==='measured' ? '' : 'none';
  document.getElementById('sGranWrap').style.display = t==='measured' ? '' : 'none';
  document.getElementById('sNwrap').style.display = t==='measured' ? '' : 'none';
  document.getElementById('sCmpType').style.display = t==='compare' ? '' : 'none';
  document.getElementById('sCmpNote').style.display = t==='compare' ? '' : 'none';
  if(t!=='measured') dayCal.close();
  hideTip(); HIDDEN.clear();
  updateCmpSelectors();
  render();
}
function updateCmpSelectors(){
  document.getElementById('sWeekSel').style.display = (TAB==='compare' && CMP==='days') ? '' : 'none';
  document.getElementById('sCmpWd').style.display   = (TAB==='compare' && CMP==='weekday') ? '' : 'none';
}
function setGran(g){
  GRAN = g;
  document.getElementById('sGranH').classList.toggle('active', g==='hours');
  document.getElementById('sGranM').classList.toggle('active', g==='min');
  hideTip(); render();
}

function render(){
  const last = ROWS[ROWS.length-1];
  document.getElementById('sLiveNum').textContent = last ? last.count : '–';
  document.getElementById('sLiveWhen').textContent = last ? ('En direct · ' + last.hhmm) : '—';

  if(TAB === 'compare'){ renderCompare(); return; }
  document.getElementById('sLegend').style.display = 'none';

  const day = dayCal.selected || (ROWS.length ? ROWS[ROWS.length-1].dayKey : null);
  const pts = ROWS.filter(r => r.dayKey === day).sort((a,b)=>a.minOfDay-b.minOfDay);
  const empty = document.getElementById('sEmpty');
  const canvas = document.getElementById('sChart');
  if(!pts.length){
    empty.textContent = 'Pas encore de données pour ce jour.';
    empty.style.display='block'; canvas.style.display='none';
    ['sAvg','sMax','sN','sPeak'].forEach(id=>document.getElementById(id).textContent='–');
    document.getElementById('sPeakWhen').textContent='';
    return;
  }
  empty.style.display='none'; canvas.style.display='block';

  const counts = pts.map(p=>p.count);
  const max = Math.max(...counts);
  const avg = Math.round(counts.reduce((a,b)=>a+b,0)/counts.length);
  const peak = pts[counts.indexOf(max)];
  document.getElementById('sAvg').textContent = avg;
  document.getElementById('sMax').textContent = max;
  document.getElementById('sN').textContent = pts.length;
  document.getElementById('sPeak').textContent = max;
  document.getElementById('sPeakWhen').textContent = 'vers ' + peak.hhmm;

  drawDay(canvas, pts, max);
}

function drawDay(canvas, pts, maxCount){
  const lastP = pts[pts.length-1];
  const containerW = document.getElementById('sChartWrap').clientWidth || 320;
  let minX, maxX, W;
  if(GRAN === 'min'){
    minX = Math.max(OPEN_HOUR*60, pts[0].minOfDay - 10);
    maxX = Math.min(CLOSE_HOUR*60, lastP.minOfDay + 10);
    if(maxX - minX < 30) maxX = minX + 30;
    W = Math.max(containerW, Math.round((maxX - minX) * PX_PER_MIN));
  } else {
    minX = OPEN_HOUR*60; maxX = CLOSE_HOUR*60; W = containerW;
  }
  const H = canvas.clientHeight || 300;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = W + 'px';
  canvas.width = W*dpr; canvas.height = H*dpr;
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,W,H);

  const padL=32, padR=14, padT=14, padB=24;
  const x0=padL, x1=W-padR, y0=H-padB, y1=padT;
  const yMax = Math.max(5, Math.ceil(maxCount*1.15));
  const sx = m => x0 + (x1-x0)*(m-minX)/(maxX-minX);
  const sy = c => y0 + (y1-y0)*(c/yMax);

  ctx.strokeStyle = '#2b2e5e'; ctx.fillStyle = '#9aa0c7'; ctx.font = '11px system-ui'; ctx.lineWidth=1;
  for(let v=0; v<=yMax; v+=niceStep(yMax)){
    const y=sy(v); ctx.beginPath(); ctx.moveTo(x0,y); ctx.lineTo(x1,y); ctx.stroke();
    ctx.fillText(String(v), 6, y+4);
  }
  ctx.textAlign='center';
  const step = GRAN==='min' ? 30 : 180;
  for(let m=Math.ceil(minX/step)*step; m<=maxX; m+=step){ ctx.fillText(fmtHM(m), sx(m), H-8); }
  ctx.textAlign='left';

  ctx.beginPath();
  pts.forEach((p,i)=>{ const X=sx(p.minOfDay),Y=sy(p.count); i?ctx.lineTo(X,Y):ctx.moveTo(X,Y); });
  ctx.lineTo(sx(lastP.minOfDay), y0); ctx.lineTo(sx(pts[0].minOfDay), y0); ctx.closePath();
  const grad = ctx.createLinearGradient(0,y1,0,y0);
  grad.addColorStop(0,'rgba(83,133,237,.45)'); grad.addColorStop(1,'rgba(83,133,237,0)');
  ctx.fillStyle=grad; ctx.fill();

  ctx.beginPath();
  pts.forEach((p,i)=>{ const X=sx(p.minOfDay),Y=sy(p.count); i?ctx.lineTo(X,Y):ctx.moveTo(X,Y); });
  ctx.strokeStyle='#5385ed'; ctx.lineWidth=2; ctx.stroke();

  HIT = [];
  const rPt = GRAN==='min' ? 3.2 : (pts.length>120 ? 1.6 : 2.6);
  pts.forEach((p,i)=>{
    const X=sx(p.minOfDay), Y=sy(p.count);
    const isLast = i===pts.length-1;
    ctx.fillStyle = isLast ? '#ff7a1a' : '#a9c1f5';
    ctx.beginPath(); ctx.arc(X, Y, isLast?4:rPt, 0, 7); ctx.fill();
    HIT.push({x:X, y:Y, count:p.count, hhmm:p.hhmm});
  });
}

function xHourTicks(xMin,xMax,stepH){
  const t=[]; const step=stepH*60;
  for(let m=Math.ceil(xMin/step)*step;m<=xMax;m+=step) t.push({x:m, label:fmtHM(m)});
  return t;
}

function renderCompare(){
  const empty = document.getElementById('sEmpty');
  const canvas = document.getElementById('sChart');
  const legend = document.getElementById('sLegend');

  let series, xMin, xMax, xTicks, seps=[];
  if(CMP === 'weeks'){
    xMin = OPEN_HOUR*60; xMax = 6*1440 + CLOSE_HOUR*60;
    xTicks = WD_SHORT.map((lab,i)=>({x:i*1440 + (OPEN_HOUR+(CLOSE_HOUR-OPEN_HOUR)/2)*60, label:lab}));
    for(let i=1;i<7;i++) seps.push(i*1440);
    const weeks = [...new Set(ROWS.map(r=>r.weekKey))].sort();
    series = weeks.map((wk,i)=>({
      label:'Sem. '+wk.split('-S')[1], color:PALETTE[i%PALETTE.length],
      pts: ROWS.filter(r=>r.weekKey===wk).sort((a,b)=>(a.wd-b.wd)||(a.minOfDay-b.minOfDay))
              .map(r=>({x:r.wd*1440+r.minOfDay, val:r.count, hhmm:WD_SHORT[r.wd]+' '+r.hhmm}))
    }));
  } else if(CMP === 'weekday'){
    xMin = OPEN_HOUR*60; xMax = CLOSE_HOUR*60;
    xTicks = xHourTicks(xMin,xMax,3);
    const wd = +document.getElementById('sCmpWd').value;
    const rows = ROWS.filter(r=>r.wd===wd);
    const weeks = [...new Set(rows.map(r=>r.weekKey))].sort();
    series = weeks.map((wk,i)=>({
      label:'Sem. '+wk.split('-S')[1], color:PALETTE[i%PALETTE.length],
      pts: rows.filter(r=>r.weekKey===wk).sort((a,b)=>a.minOfDay-b.minOfDay)
              .map(r=>({x:r.minOfDay, val:r.count, hhmm:r.hhmm}))
    }));
  } else {
    xMin = OPEN_HOUR*60; xMax = CLOSE_HOUR*60;
    xTicks = xHourTicks(xMin,xMax,3);
    const wk = document.getElementById('sWeekSel').value;
    const rows = ROWS.filter(r=>r.weekKey===wk);
    const wds = [...new Set(rows.map(r=>r.wd))].sort((a,b)=>a-b);
    series = wds.map(wd=>({
      label:WD_SHORT[wd], color:PALETTE[wd],
      pts: rows.filter(r=>r.wd===wd).sort((a,b)=>a.minOfDay-b.minOfDay)
              .map(r=>({x:r.minOfDay, val:r.count, hhmm:r.hhmm}))
    }));
  }

  series = series.filter(s=>s.pts.length);
  if(!series.length){
    empty.textContent = 'Pas encore assez de données pour cette comparaison.';
    empty.style.display='block'; canvas.style.display='none'; legend.style.display='none';
    ['sAvg','sMax','sPeak'].forEach(id=>document.getElementById(id).textContent='–');
    document.getElementById('sPeakWhen').textContent='';
    return;
  }
  empty.style.display='none'; canvas.style.display='block';

  const visible = series.filter(s=>!HIDDEN.has(s.label));
  const allVals = visible.flatMap(s=>s.pts.map(p=>p.val));
  const max = allVals.length?Math.max(...allVals):0;
  const avg = allVals.length?Math.round(allVals.reduce((a,b)=>a+b,0)/allVals.length):0;
  document.getElementById('sAvg').textContent = avg;
  document.getElementById('sMax').textContent = max;
  document.getElementById('sPeak').textContent = max;
  document.getElementById('sPeakWhen').textContent = visible.length+' courbe'+(visible.length>1?'s':'');

  drawMulti(canvas, series, xMin, xMax, xTicks, seps);
  renderLegend(series);
}

function drawMulti(canvas, series, xMin, xMax, xTicks, seps){
  HIT = []; hideTip();
  canvas.style.width = '100%';
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 320, H = canvas.clientHeight || 300;
  canvas.width = W*dpr; canvas.height = H*dpr;
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,W,H);

  const padL=30, padR=10, padT=14, padB=24;
  const x0=padL, x1=W-padR, y0=H-padB, y1=padT;
  const visible = series.filter(s=>!HIDDEN.has(s.label));
  const maxVal = Math.max(5, ...visible.flatMap(s=>s.pts.map(p=>p.val)));
  const yMax = Math.ceil(maxVal*1.15);
  const sx = x => x0 + (x1-x0)*(x-xMin)/(xMax-xMin);
  const sy = v => y0 + (y1-y0)*(v/yMax);

  ctx.strokeStyle='#2b2e5e'; ctx.fillStyle='#9aa0c7'; ctx.font='11px system-ui'; ctx.lineWidth=1;
  for(let v=0; v<=yMax; v+=niceStep(yMax)){ const y=sy(v); ctx.beginPath(); ctx.moveTo(x0,y); ctx.lineTo(x1,y); ctx.stroke(); ctx.fillText(String(v),4,y+4); }
  ctx.strokeStyle='#3a3e73';
  for(const s of seps){ const x=sx(s); ctx.beginPath(); ctx.moveTo(x,y1); ctx.lineTo(x,y0); ctx.stroke(); }
  ctx.textAlign='center'; ctx.fillStyle='#9aa0c7';
  for(const t of xTicks){ ctx.fillText(t.label, sx(t.x), H-8); }
  ctx.textAlign='left';

  for(const s of series){
    if(HIDDEN.has(s.label)) continue;
    ctx.beginPath();
    s.pts.forEach((p,i)=>{ const X=sx(p.x),Y=sy(p.val); i?ctx.lineTo(X,Y):ctx.moveTo(X,Y); });
    ctx.strokeStyle=s.color; ctx.lineWidth=2; ctx.stroke();
    const rPt = s.pts.length>120 ? 1.5 : 2.4;
    for(const p of s.pts){ const X=sx(p.x),Y=sy(p.val); ctx.fillStyle=s.color; ctx.beginPath(); ctx.arc(X,Y,rPt,0,7); ctx.fill();
      HIT.push({x:X,y:Y,count:p.val,hhmm:p.hhmm,serie:s.label}); }
  }
}

function renderLegend(series){
  const el = document.getElementById('sLegend');
  el.innerHTML=''; el.style.display='flex';
  for(const s of series){
    const li=document.createElement('span');
    li.className='li'+(HIDDEN.has(s.label)?' off':'');
    li.innerHTML='<span class="sw" style="background:'+s.color+'"></span>'+esc(s.label);
    li.addEventListener('click',()=>{ HIDDEN.has(s.label)?HIDDEN.delete(s.label):HIDDEN.add(s.label); render(); });
    el.appendChild(li);
  }
}

function showTipAt(clientX, clientY){
  if(!HIT.length){ hideTip(); return; }
  const canvas = document.getElementById('sChart');
  const r = canvas.getBoundingClientRect();
  const px = clientX - r.left, py = clientY - r.top;
  let best=null, bd=Infinity;
  for(const h of HIT){
    const d = (TAB==='compare') ? Math.hypot(h.x-px, h.y-py) : Math.abs(h.x-px);
    if(d<bd){ bd=d; best=h; }
  }
  if(!best) return;
  const tip = document.getElementById('sTip');
  const who = best.serie ? '<span style="opacity:.7">'+esc(best.serie)+'</span> · ' : '';
  tip.innerHTML = who + best.hhmm + ' · <b>' + best.count + '</b> visiteur' + (best.count>1?'s':'');
  tip.style.left = best.x + 'px';
  tip.style.top  = best.y + 'px';
  tip.style.display = 'block';
}

/* ---- init ---- */
document.addEventListener('DOMContentLoaded', ()=>{
  const dataDays = () => new Set(ROWS.map(r=>r.dayKey));
  dayCal = createCalendar({
    button: document.getElementById('sDayBtn'),
    label:  document.getElementById('sDayLabel'),
    popup:  document.getElementById('sDayCal'),
    isSelectable: k => dataDays().has(k),
    isMarked:     k => dataDays().has(k),
    onSelect: () => render()
  });

  document.getElementById('sTabMeasured').addEventListener('click', ()=>setTab('measured'));
  document.getElementById('sTabCompare').addEventListener('click', ()=>setTab('compare'));
  document.getElementById('sGranH').addEventListener('click', ()=>setGran('hours'));
  document.getElementById('sGranM').addEventListener('click', ()=>setGran('min'));
  document.getElementById('sCmpType').addEventListener('change', e=>{ CMP=e.target.value; HIDDEN.clear(); hideTip(); updateCmpSelectors(); render(); });
  document.getElementById('sWeekSel').addEventListener('change', render);
  document.getElementById('sCmpWd').addEventListener('change', render);
  document.getElementById('sRefresh').addEventListener('click', load);

  const wrap = document.getElementById('sChartWrap');
  wrap.addEventListener('pointermove', e => { if(e.pointerType==='mouse') showTipAt(e.clientX, e.clientY); });
  wrap.addEventListener('pointerdown', e => showTipAt(e.clientX, e.clientY));
  wrap.addEventListener('pointerleave', e => { if(e.pointerType==='mouse') hideTip(); });

  load();
  setInterval(load, 60000);
});

})();
