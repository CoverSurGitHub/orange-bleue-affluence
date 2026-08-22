/* ===== Mes séances : suivi de présence à la salle =====
   Bouton du jour + calendrier mensuel cliquable + vue annuelle (régularité). */
'use strict';
(function(){

let view = null;   // {y, m} mois affiché (m = 1..12)

const went   = k => !!(Store.data.gym[k] && Store.data.gym[k].go);
const dayKeyOf = (y,m,d) => `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
const addDays = (dt,n) => { const x=new Date(dt); x.setDate(x.getDate()+n); return x; };
const keyOfDate = dt => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;

function toggle(k){
  if(k > todayKey()) return;                       // pas de séance dans le futur
  const on = !went(k);
  Store.data.gym[k] = {go: on, updatedAt: nowIso()};
  Store.save();
  render();
  if(on && k === todayKey()){
    // petit burst de fierté sur le bouton (coupé par prefers-reduced-motion via CSS)
    const btn = document.getElementById('gToday');
    const b = document.createElement('span');
    b.className = 'burst'; b.textContent = '💪✨'; b.setAttribute('aria-hidden','true');
    btn.appendChild(b); setTimeout(()=>b.remove(), 750);
    const st = stats();
    toast('💪 Séance notée — ' + st.thisWeek + ' cette semaine, ' + st.streak + ' semaine' + (st.streak>1?'s':'') + ' d’affilée');
  } else if(on){
    toast('💪 Séance du ' + labelForKey(k, false) + ' notée');
  }
}

/* ---- statistiques ---- */
function stats(){
  const days = Object.keys(Store.data.gym).filter(went).sort();
  const today = todayKey();
  const [ty] = today.split('-').map(Number);

  // lundi de la semaine en cours
  const now = keyToDate(today);
  const monday = addDays(now, -(((now.getDay()+6)%7)));
  const weekStart = keyOfDate(monday);

  const thisWeek  = days.filter(d => d >= weekStart && d <= today).length;
  const thisMonth = days.filter(d => d.startsWith(today.slice(0,7))).length;
  const thisYear  = days.filter(d => d.startsWith(String(ty))).length;

  // moyenne hebdo sur les 8 dernières semaines (arrondie au dixième)
  const from = keyOfDate(addDays(monday, -7*7));
  const last8 = days.filter(d => d >= from && d <= today).length;
  const avg = Math.round(last8/8*10)/10;

  // série : semaines consécutives avec au moins une séance (en remontant)
  let streak = 0;
  for(let w=0; w<520; w++){
    const s = keyOfDate(addDays(monday, -7*w));
    const e = keyOfDate(addDays(monday, -7*w+6));
    const hit = days.some(d => d>=s && d<=e);
    if(hit) streak++;
    else if(w>0) break;                            // semaine en cours encore vide = tolérée
    else if(w===0) continue;
  }
  return {thisWeek, thisMonth, thisYear, avg, streak, total:days.length};
}

/* ---- rendu ---- */
function render(){
  const today = todayKey();
  const st = stats();

  // bouton du jour
  const btn = document.getElementById('gToday');
  const done = went(today);
  btn.classList.toggle('done', done);
  btn.setAttribute('aria-pressed', done);
  btn.textContent = done ? '✅ Séance faite aujourd’hui — retirer ?' : '💪 J’y suis allé aujourd’hui';

  // tuiles
  document.getElementById('gTiles').innerHTML = `
    <div class="tile"><div class="v">${st.thisWeek}</div><div class="l">cette semaine</div></div>
    <div class="tile"><div class="v">${st.thisMonth}</div><div class="l">ce mois</div></div>
    <div class="tile"><div class="v">${st.avg}</div><div class="l">moy. / semaine</div></div>
    <div class="tile"><div class="v">${st.streak}</div><div class="l">semaines d'affilée</div></div>`;

  // calendrier du mois
  const {y, m} = view;
  document.getElementById('gMonthLabel').textContent =
    new Intl.DateTimeFormat('fr-FR',{month:'long',year:'numeric'}).format(new Date(y, m-1, 1));
  const firstDow = (new Date(y, m-1, 1).getDay()+6)%7;
  const nDays = new Date(y, m, 0).getDate();
  let cells = ['L','M','M','J','V','S','D'].map(d=>`<div class="cal-dow">${d}</div>`).join('');
  for(let i=0;i<firstDow;i++) cells += '<span class="cal-day empty" aria-hidden="true"></span>';
  for(let d=1; d<=nDays; d++){
    const k = dayKeyOf(y,m,d);
    const cls = ['cal-day'];
    if(k > today) cls.push('future');
    if(went(k)) cls.push('gym');
    if(k === today) cls.push('today');
    cells += `<button type="button" class="${cls.join(' ')}" data-k="${k>today?'':k}" ${k>today?'disabled':''} aria-label="${labelForKey(k)}${went(k)?' — séance faite':''}" aria-pressed="${went(k)}">${d}</button>`;
  }
  const grid = document.getElementById('gGrid');
  grid.innerHTML = cells;

  // vue annuelle (colonnes = semaines, lignes = jours) — régularité d'un coup d'œil
  renderHeat(y);
  document.getElementById('gYearLabel').textContent = 'Régularité ' + y;
  document.getElementById('gYearCount').textContent =
    Object.keys(Store.data.gym).filter(k=>went(k) && k.startsWith(String(y))).length + ' séance(s)';
}

function renderHeat(year){
  const today = todayKey();
  const jan1 = new Date(year, 0, 1);
  const start = addDays(jan1, -(((jan1.getDay()+6)%7)));   // lundi de la 1re semaine
  const end   = new Date(year, 11, 31);
  let html = '', months = '', lastMonth = -1;
  for(let dt = new Date(start); dt <= end; dt = addDays(dt,1)){
    const k = keyOfDate(dt);
    const inYear = dt.getFullYear() === year;
    const cls = ['', inYear ? (went(k)?'on':'') : 'pad', k===today?'tdy':''].filter(Boolean).join(' ');
    html += `<i class="${cls}" title="${inYear?k+(went(k)?' · séance ✅':''):''}"></i>`;
    // étiquette de mois au début de chaque colonne (lundi)
    if((dt.getDay()+6)%7 === 0){
      const mo = dt.getMonth();
      months += `<span style="width:10px">${inYear && mo!==lastMonth ? ['J','F','M','A','M','J','J','A','S','O','N','D'][mo] : ''}</span>`;
      if(inYear) lastMonth = mo;
    }
  }
  const wrap = document.getElementById('gHeat');
  wrap.previousElementSibling?.classList.contains('heat-months') && wrap.previousElementSibling.remove();
  wrap.innerHTML = html;
  wrap.insertAdjacentHTML('beforebegin', `<div class="heat-months">${months}</div>`);
}

/* ---- init ---- */
document.addEventListener('DOMContentLoaded', ()=>{
  const [y,m] = todayKey().split('-').map(Number);
  view = {y, m};

  document.getElementById('gToday').addEventListener('click', ()=>toggle(todayKey()));
  document.getElementById('gGrid').addEventListener('click', e=>{
    const cell = e.target.closest('.cal-day');
    if(cell && cell.dataset.k) toggle(cell.dataset.k);
  });
  document.getElementById('gPrev').addEventListener('click', ()=>{
    view.m--; if(view.m<1){ view.m=12; view.y--; } render();
  });
  document.getElementById('gNext').addEventListener('click', ()=>{
    view.m++; if(view.m>12){ view.m=1; view.y++; } render();
  });

  document.addEventListener('pageshow', e=>{ if(e.detail.page==='salle') render(); });
  document.addEventListener('storechange', ()=>{ if(document.getElementById('page-salle').classList.contains('active')) render(); });
  document.addEventListener('profilechange', ()=>{ if(document.getElementById('page-salle').classList.contains('active')) render(); });
  render();
});

})();
