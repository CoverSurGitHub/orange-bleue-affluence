/* ===== Section Hydratation : objectif du jour + ajout en un tap =====
   Modèle (par profil) : Store.data.water = {
     goal:{ml,updatedAt}, containers:[{id,nom,ml,emo,fav,ordre,updatedAt,deleted?}],
     log:{ "YYYY-MM-DD": {entries:[{id,ml,at,cNom,cEmo,updatedAt,deleted?}], updatedAt} } }
   Règles héritées du reste de l'app :
   - re-résoudre les objets du store AU MOMENT du clic (jamais de référence gardée) ;
   - suppressions par tombstone (deleted:true + updatedAt) → synchronisables ;
   - modifier un contenant ne réécrit jamais les consommations passées (copie
     du nom/emoji dans chaque entrée au moment de l'ajout).                    */
'use strict';
(function(){

let cal = null;
let day = null;
let followToday = true;   // tant que l'utilisateur n'a pas choisi un autre jour,
                          // la page suit le jour réel (gère minuit / retour de veille)

const water = () => Store.data.water;
const goalMl = () => (water().goal && water().goal.ml) || 2000;
const containers = () => water().containers.filter(c=>!c.deleted)
  .sort((a,b)=>(b.fav?1:0)-(a.fav?1:0) || (a.ordre||99)-(b.ordre||99) || a.nom.localeCompare(b.nom));

function wday(k){
  const log = water().log;
  if(!log[k] || !Array.isArray(log[k].entries)) log[k] = {entries:[], updatedAt: nowIso()};
  return log[k];
}
function totalOf(k){
  const d = water().log[k];
  return d ? d.entries.filter(e=>!e.deleted).reduce((s,e)=>s+e.ml,0) : 0;
}
function fmtMl(ml){
  return ml >= 1000 ? (Math.round(ml/10)/100).toLocaleString('fr-FR') + ' L' : ml + ' ml';
}
function syncDay(){
  if(followToday && day !== todayKey()){ day = todayKey(); cal.setSelected(day); }
}

/* ---- actions ---- */
function drink(ml, cNom, cEmo){
  syncDay();
  const k = day;
  const e = {id:uid(), ml, at:nowIso(), cNom:cNom||null, cEmo:cEmo||null, updatedAt:nowIso()};
  wday(k).entries.push(e);
  wday(k).updatedAt = nowIso();
  Store.save();
  render();
  const tot = totalOf(k), goal = goalMl();
  const done = tot >= goal;
  toast(`${cEmo||'💧'} +${fmtMl(ml)} — ${done ? 'objectif atteint 🎉' : fmtMl(Math.max(0, goal-tot)) + ' restants'}`, {
    action:{label:'Annuler', fn:()=>removeEntry(k, e.id, true)}
  });
}
function removeEntry(k, id, silent){
  const d = water().log[k];
  if(!d) return;
  const e = d.entries.find(x=>x.id===id);
  if(!e) return;
  e.deleted = true; e.updatedAt = nowIso();
  d.updatedAt = nowIso();
  Store.save();
  render();
  if(!silent) toast('💧 Consommation retirée');
}

/* ===== API pour la section Repas =====
   Les entrées créées ici portent src:'meal' + ref = id de l'entrée du journal.
   Elles restent des entrées d'eau NORMALES : visibles et supprimables à la main.
   Toutes les fonctions sont défensives : si l'utilisateur a déjà supprimé
   l'entrée liée, retirer une portion ne casse rien et ne crée pas de négatif. */
window.Water = {
  mode(){
    const w = Store.data.water;
    return (w && w.fromMeals && w.fromMeals.mode) || 'drinks';
  },
  /* ajoute la part d'eau d'une portion de repas au jour donné */
  addFromMeal(dayKey, ref, ml, label, emo){
    ml = Math.round(ml);
    if(!dayKey || !ref || !Number.isFinite(ml) || ml <= 0) return null;
    const d = wday(dayKey);
    const e = {id:uid(), ml, at:nowIso(), cNom:label||'Repas', cEmo:emo||'🍽️',
               src:'meal', ref, updatedAt:nowIso()};
    d.entries.push(e); d.updatedAt = nowIso();
    return e;                                   // Store.save() est fait par l'appelant
  },
  /* retire UNE portion liée (la plus récente encore présente) */
  removeOne(dayKey, ref){
    const d = Store.data.water.log[dayKey];
    if(!d || !Array.isArray(d.entries)) return 0;
    const liees = d.entries.filter(x=>x.src==='meal' && x.ref===ref && !x.deleted);
    if(!liees.length) return 0;                 // déjà supprimée à la main : on n'insiste pas
    const e = liees[liees.length-1];
    e.deleted = true; e.updatedAt = nowIso(); d.updatedAt = nowIso();
    return e.ml;
  },
  /* retire toutes les portions liées (plat entièrement retiré du jour) */
  removeAll(dayKey, ref){
    const d = Store.data.water.log[dayKey];
    if(!d || !Array.isArray(d.entries)) return 0;
    let n = 0;
    for(const e of d.entries){
      if(e.src==='meal' && e.ref===ref && !e.deleted){ e.deleted = true; e.updatedAt = nowIso(); n += e.ml; }
    }
    if(n) d.updatedAt = nowIso();
    return n;
  },
  /* rafraîchit l'écran Eau s'il est visible (après une action venue de Repas) */
  refresh(){ if(document.getElementById('page-eau').classList.contains('active')) render(); }
};

/* ---- verre SVG (remplissage proportionnel, doublé en texte) ---- */
function glassSvg(pct){
  const p = Math.max(0, Math.min(1, pct));
  // intérieur du verre : trapèze entre y=14 (haut) et y=104 (fond)
  const topY = 104 - 90*p;
  const xAt = y => 21 + (y-14)*(29-21)/90;        // bord gauche du trapèze à la hauteur y
  const xl = xAt(topY), xr = 100 - xl;
  const wave = p>0 && p<1
    ? `M${xl},${topY+2} Q ${(xl+xr)/2},${topY-4} ${xr},${topY+2} L${xr},${topY+2}`
    : '';
  return `
  <svg class="wv" width="104" height="128" viewBox="0 0 100 122" aria-hidden="true">
    <defs>
      <clipPath id="wclip"><path d="M20 12 L80 12 L71 106 Q70 112 64 112 L36 112 Q30 112 29 106 Z"/></clipPath>
    </defs>
    <g clip-path="url(#wclip)">
      <rect x="0" y="${topY}" width="100" height="${122-topY}" fill="var(--water)" opacity=".9"/>
      ${wave ? `<path d="${wave}" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2.2" stroke-linecap="round"/>` : ''}
      ${p>0 ? `<circle cx="40" cy="${Math.min(108, topY+16)}" r="2.6" fill="rgba(255,255,255,.4)"/>
               <circle cx="58" cy="${Math.min(104, topY+26)}" r="1.8" fill="rgba(255,255,255,.3)"/>` : ''}
    </g>
    <path d="M20 12 L80 12 L71 106 Q70 112 64 112 L36 112 Q30 112 29 106 Z"
          fill="none" stroke="currentColor" stroke-width="3.4" stroke-linejoin="round" opacity=".8"/>
  </svg>`;
}

/* ---- rendu ---- */
function render(){
  syncDay();
  const k = day;
  const isToday = k === todayKey();
  const d = water().log[k];
  const entries = d ? d.entries.filter(e=>!e.deleted) : [];
  const tot = totalOf(k);
  const mealMl = entries.filter(e=>e.src==='meal').reduce((s,e)=>s+e.ml,0);
  const mode = window.Water.mode();
  const goal = goalMl();
  const pct = tot/goal;
  const done = tot >= goal;

  /* --- colonne principale : verre + ajout rapide + historique du jour --- */
  const mainEl = document.getElementById('wMain');
  const chips = containers();
  mainEl.innerHTML = `
    <div class="card">
      <div class="water-hero" role="img"
           aria-label="${isToday?"Aujourd'hui":esc(labelForKey(k))} : ${tot} millilitres sur ${goal}, soit ${Math.round(pct*100)} pour cent${done?', objectif atteint':''}">
        <div class="wglass" style="color:var(--muted)">${glassSvg(pct)}</div>
        <div class="water-nums">
          <div class="big">${fmtMl(tot)} <small>/ ${fmtMl(goal)}</small></div>
          <div class="sub">${Math.round(pct*100)} % ${isToday ? "aujourd'hui" : 'le ' + esc(labelForKey(k, false))}</div>
          ${done
            ? `<span class="okbadge">🎉 Objectif atteint${tot>goal ? ' · +'+fmtMl(tot-goal) : ''}</span>`
            : `<div class="sub">reste <b>${fmtMl(goal-tot)}</b></div>`}
          <div class="sub" style="margin-top:6px">
            <button class="chip" id="wGoalBtn" title="Modifier l'objectif">🎯 objectif ${fmtMl(goal)} ✎</button>
          </div>
        </div>
      </div>

      <div class="wq" role="group" aria-label="Ajouter une consommation">
        ${chips.map(c=>`
          <button class="wchip" data-drink="${c.id}" aria-label="Ajouter ${c.nom}, ${c.ml} millilitres">
            <span class="e" aria-hidden="true">${esc(c.emo||'💧')}</span>
            <span class="n">${esc(c.nom)}</span>
            <span class="m">${fmtMl(c.ml)}</span>
          </button>`).join('')}
        <button class="wchip" id="wCustom" aria-label="Ajouter une quantité libre">
          <span class="e" aria-hidden="true">➕</span>
          <span class="n">Autre</span>
          <span class="m">quantité libre</span>
        </button>
      </div>
      <button class="btn ghost" id="wManage" style="width:100%;margin-top:10px">⚙️ Gérer mes contenants</button>
    </div>

    <div class="card">
      <h2>Consommations ${isToday ? "d'aujourd'hui" : 'du ' + esc(labelForKey(k, false))}
        ${mealMl ? '<span class="h2sub">— dont ' + fmtMl(mealMl) + ' via les repas</span>' : ''}</h2>
      ${entries.length ? `<div class="list">
        ${entries.slice().reverse().map(e=>`
          <div class="li-row">
            <div class="grow">
              <div class="name">${esc(e.cEmo||'💧')} ${esc(e.cNom||'Eau')}${e.src==='meal'?' <span class="chip" style="margin:0 0 0 4px;cursor:default">repas</span>':''}</div>
              <div class="sub">${fmtTime.format(new Date(e.at))}</div>
            </div>
            <div class="val">${fmtMl(e.ml)}</div>
            <button class="li-x" data-del="${e.id}" aria-label="Supprimer cette consommation">✕</button>
          </div>`).join('')}
      </div>`
      : `<div class="empty"><span class="emo">💧</span><b>Rien d'enregistré ${isToday?"aujourd'hui":'ce jour-là'}.</b><br>
         ${isToday ? "Un tap sur un contenant ci-dessus et c’est noté." : 'Tape un contenant pour compléter ce jour.'}</div>`}
    </div>`;

  /* --- colonne latérale : 7 derniers jours --- */
  const sideEl = document.getElementById('wSide');
  const days7 = [];
  for(let i=6;i>=0;i--){
    const dt = keyToDate(todayKey()); dt.setDate(dt.getDate()-i);
    const kk = fmtDayKey.format(dt);
    days7.push({k:kk, tot:totalOf(kk), dow:'LMMJVSD'[(dt.getDay()+6)%7]});
  }
  const maxT = Math.max(goal, ...days7.map(x=>x.tot));
  const okDays = days7.filter(x=>x.tot>=goal).length;
  sideEl.innerHTML = `
    <div class="card">
      <h2>7 derniers jours <span class="h2sub">— ${okDays}/7 objectifs atteints</span></h2>
      <div class="w7" role="img" aria-label="Hydratation des 7 derniers jours : ${days7.map(x=>x.dow+' '+x.tot+' ml').join(', ')}">
        ${days7.map(x=>`
          <div class="wd">
            <div class="bar ${x.tot>=goal?'ok':''}" title="${esc(labelForKey(x.k,false))} : ${fmtMl(x.tot)}">
              <i style="height:${Math.round(Math.min(1, x.tot/maxT)*100)}%"></i>
            </div>
            <span class="dl ${x.k===todayKey()?'t':''}">${x.dow}</span>
          </div>`).join('')}
      </div>
      <div class="small muted" style="margin-top:8px">La ligne d'objectif : ${fmtMl(goal)} par jour. Un jour vert = objectif atteint.</div>
    </div>

    <div class="card">
      <h2>🍽️ Eau des repas</h2>
      <p class="set-note" style="margin:0 0 10px">Quand tu coches un plat dans <b>Repas</b>, son eau peut être
      comptée ici automatiquement. Chaque ajout reste visible et supprimable dans la liste.</p>
      <div class="seg" role="group" aria-label="Compter l'eau des repas" style="width:100%">
        <button class="seg-btn ${mode==='off'?'active':''}" data-wm="off" style="flex:1">Aucune</button>
        <button class="seg-btn ${mode==='drinks'?'active':''}" data-wm="drinks" style="flex:1">Boissons</button>
        <button class="seg-btn ${mode==='all'?'active':''}" data-wm="all" style="flex:1">Tout</button>
      </div>
      <div class="small muted" style="margin-top:8px">${
        mode==='off'   ? 'Rien n’est ajouté depuis les repas.' :
        mode==='drinks'? 'Seuls les <b>ingrédients liquides</b> comptent (eau, lait, jus…) — idéal pour les smoothies.' :
        '<b>Tous les aliments</b> comptent, via leur teneur en eau officielle CIQUAL (apport hydrique total : le riz cuit est à ~64 % d’eau).'
      }</div>
    </div>`;

  /* --- listeners (re-résolution au clic) --- */
  mainEl.querySelectorAll('[data-drink]').forEach(b=>b.addEventListener('click', ()=>{
    const c = water().containers.find(x=>x.id===b.dataset.drink && !x.deleted);
    if(c) drink(c.ml, c.nom, c.emo);
  }));
  mainEl.querySelector('#wCustom').addEventListener('click', ()=>{
    const v = prompt('Quantité en ml :', 300);
    if(v===null) return;
    const ml = parseInt(String(v).replace(',','.'), 10);
    if(!Number.isFinite(ml) || ml<=0 || ml>5000){ alert('Quantité invalide (1 à 5000 ml).'); return; }
    drink(ml, null, null);
  });
  sideEl.querySelectorAll('[data-wm]').forEach(b=>b.addEventListener('click', ()=>{
    Store.data.water.fromMeals = {mode:b.dataset.wm, updatedAt:nowIso()};
    Store.save(); render();
    toast(b.dataset.wm==='off' ? '🍽️ Eau des repas désactivée'
        : b.dataset.wm==='drinks' ? '🍽️ Seules les boissons des repas comptent'
        : '🍽️ Tous les aliments comptent (teneur CIQUAL)');
  }));
  mainEl.querySelector('#wGoalBtn').addEventListener('click', editGoal);
  mainEl.querySelector('#wManage').addEventListener('click', openContainers);
  mainEl.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click', ()=>{
    removeEntry(day, b.dataset.del);
  }));

  cal.refresh();
}

function editGoal(){
  const v = prompt('Objectif d\'eau par jour, en ml :\n(valeur de départ proposée : 2000 — ajuste-la librement)', goalMl());
  if(v===null) return;
  const ml = parseInt(String(v).replace(',','.'), 10);
  if(!Number.isFinite(ml) || ml<250 || ml>8000){ alert('Objectif invalide (250 à 8000 ml).'); return; }
  water().goal = {ml, updatedAt: nowIso()};
  Store.save();
  render();
  toast('🎯 Objectif : ' + fmtMl(ml) + ' par jour');
}

/* ---- gestion des contenants ---- */
function openContainers(){
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  document.body.appendChild(bg);
  const close = ()=>bg.remove();
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });

  function draw(){
    const list = containers();
    bg.innerHTML = `
      <div class="modal" role="dialog" aria-label="Mes contenants">
        <h3>⚙️ Mes contenants</h3>
        <p class="set-note">Un contenant = un tap pour l'ajouter. Les ⭐ favoris passent devant.
        Modifier un contenant ne change jamais les consommations déjà enregistrées.</p>
        ${list.length ? `<div class="list">
          ${list.map(c=>`
            <div class="li-row">
              <button class="li-x" data-fav="${c.id}" title="${c.fav?'Retirer des favoris':'Mettre en favori'}"
                      aria-label="${c.fav?'Retirer des favoris':'Mettre en favori'}" aria-pressed="${!!c.fav}">${c.fav?'⭐':'☆'}</button>
              <div class="grow" data-edit="${c.id}" role="button" tabindex="0" title="Modifier">
                <div class="name">${esc(c.emo||'💧')} ${esc(c.nom)}</div>
                <div class="sub">${fmtMl(c.ml)}</div>
              </div>
              <button class="li-x" data-del="${c.id}" title="Supprimer" aria-label="Supprimer ${esc(c.nom)}">🗑</button>
            </div>`).join('')}
        </div>` : `<div class="empty"><span class="emo">🥛</span><b>Aucun contenant.</b><br>Crée le premier ci-dessous.</div>`}
        <div class="actions">
          <button class="btn primary" id="wcNew">＋ Nouveau contenant</button>
          <button class="btn" id="wcClose">Fermer</button>
        </div>
      </div>`;

    bg.querySelector('#wcClose').addEventListener('click', close);
    bg.querySelector('#wcNew').addEventListener('click', ()=>editContainer(null));
    bg.querySelectorAll('[data-fav]').forEach(b=>b.addEventListener('click', ()=>{
      const c = water().containers.find(x=>x.id===b.dataset.fav);
      if(!c) return;
      c.fav = !c.fav; c.updatedAt = nowIso();
      Store.save(); draw();
    }));
    bg.querySelectorAll('[data-edit]').forEach(el=>{
      const go = ()=>editContainer(el.dataset.edit);
      el.addEventListener('click', go);
      el.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); go(); } });
    });
    bg.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click', ()=>{
      const c = water().containers.find(x=>x.id===b.dataset.del);
      if(!c) return;
      if(!confirm(`Supprimer « ${c.nom} » ?\nLes consommations déjà enregistrées avec lui sont conservées.`)) return;
      c.deleted = true; c.updatedAt = nowIso();
      Store.save(); draw(); render();
    }));
  }

  function editContainer(id){
    const src = id ? water().containers.find(x=>x.id===id) : null;
    const nom = prompt('Nom du contenant :', src ? src.nom : 'Gourde');
    if(nom===null || !nom.trim()) return;
    const mlv = prompt('Capacité en ml :', src ? src.ml : 500);
    if(mlv===null) return;
    const ml = parseInt(String(mlv).replace(',','.'), 10);
    if(!Number.isFinite(ml) || ml<=0 || ml>5000){ alert('Capacité invalide (1 à 5000 ml).'); return; }
    const emo = prompt('Emoji (optionnel) :', src ? (src.emo||'💧') : '💧') || '💧';
    if(src){
      src.nom = nom.trim(); src.ml = ml; src.emo = emo.trim().slice(0, 4) || '💧';
      src.updatedAt = nowIso();
    } else {
      const maxOrdre = Math.max(0, ...water().containers.map(c=>c.ordre||0));
      water().containers.push({id:uid(), nom:nom.trim(), ml, emo:emo.trim().slice(0,4)||'💧',
                              fav:false, ordre:maxOrdre+1, updatedAt:nowIso()});
    }
    Store.save(); draw(); render();
  }

  draw();
}

/* ---- init ---- */
document.addEventListener('DOMContentLoaded', ()=>{
  day = todayKey();
  cal = createCalendar({
    button: document.getElementById('wDayBtn'),
    label:  document.getElementById('wDayLabel'),
    popup:  document.getElementById('wDayCal'),
    isSelectable: k => k <= todayKey(),                 // pas d'eau bue dans le futur
    isMarked:     k => totalOf(k) > 0,
    onSelect: k => { day = k; followToday = (k === todayKey()); render(); }
  });
  cal.setSelected(day);

  document.addEventListener('pageshow', e=>{ if(e.detail.page==='eau') render(); });
  document.addEventListener('storechange', ()=>{ if(document.getElementById('page-eau').classList.contains('active')) render(); });
  document.addEventListener('profilechange', ()=>{ if(document.getElementById('page-eau').classList.contains('active')) render(); });
  render();
});

})();
