/* ===== Section Repas : bibliothèque de plats + compteur du jour =====
   Un seul écran : jauges d'objectif en haut, catégories (Repas/Collations…)
   contenant des plats préparés. Un tap sur ➕ = je l'ai mangé (compteur ×N).
   Les valeurs sont FIGÉES au moment du tap : modifier une recette ensuite
   ne réécrit pas l'historique des jours passés.                            */
'use strict';
(function(){

let cal = null;
let day = null;             // jour affiché
let CIQUAL = null;
let ciqualPromise = null;

/* ---- utilitaires nutrition ---- */
const kcalOf = it => it.kcal100 * it.qty / 100;
const protOf = it => it.prot100 * it.qty / 100;
const r0 = x => Math.round(x);
const r1 = x => Math.round(x*10)/10;
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();

function loadCiqual(){
  if(CIQUAL) return Promise.resolve(CIQUAL);
  if(!ciqualPromise){
    ciqualPromise = fetch('data/ciqual.min.json').then(r=>{
      if(!r.ok) throw new Error('HTTP '+r.status);
      return r.json();
    }).then(j=>{ CIQUAL=j; return j; })
      .catch(e=>{ ciqualPromise=null; throw e; });
  }
  return ciqualPromise;
}

function searchFoods(q){
  const terms = norm(q).split(/\s+/).filter(Boolean);
  if(!terms.length) return [];
  const match = name => { const n=norm(name); return terms.every(t=>n.includes(t)); };
  const out = [];
  for(const f of Store.data.foods){
    if(f.deleted || !match(f.nom)) continue;
    out.push({type:'perso', nom:f.nom, kcal100:f.kcal, prot100:f.prot, defQty:100});
  }
  if(CIQUAL){
    for(const f of CIQUAL.foods){
      if(!match(f[0])) continue;
      out.push({type:'ciqual', nom:f[0], kcal100:f[1], prot100:f[2]??0, defQty:100});
      if(out.length>60) break;
    }
  }
  out.sort((a,b)=>a.nom.length-b.nom.length);
  return out.slice(0,30);
}

function recipeTotals(rec){
  let kcal=0, prot=0, weight=0;
  for(const it of rec.items){ kcal+=kcalOf(it); prot+=protOf(it); weight+=it.qty; }
  return {kcal, prot, weight};
}

/* ---- aliments comptés à l'unité (exception : les œufs) ----
   Poids comestibles moyens (œuf moyen sans coquille ~50 g, jaune ~17 g, blanc ~33 g). */
function unitInfo(nom){
  if(!/(oeuf|œuf)/i.test(nom)) return null;
  if(/jaune/i.test(nom)) return {one:"jaune d'œuf", many:"jaunes d'œuf", de:"de jaunes d'œuf", g:17};
  if(/blanc/i.test(nom)) return {one:"blanc d'œuf", many:"blancs d'œuf", de:"de blancs d'œuf", g:33};
  return {one:'œuf', many:'œufs', de:"d'œufs", g:50};
}
function askQty(nom, defUnits, defGrams){
  const u = unitInfo(nom);
  if(u){
    const v = prompt(`Nombre ${u.de} — ${nom}\n(1 ${u.one} ≈ ${u.g} g · ou tape des grammes, ex : 160g)`, defUnits ?? 3);
    if(v===null) return null;
    const s = String(v).trim().replace(',','.');
    if(/g\s*$/i.test(s)){
      const g = parseFloat(s);
      if(!Number.isFinite(g)||g<=0){ alert('Quantité invalide.'); return null; }
      return {qty:g};
    }
    const n = parseFloat(s);
    if(!Number.isFinite(n)||n<=0||n>50){ alert('Nombre invalide.'); return null; }
    return {qty:n*u.g, units:n, unitG:u.g, unitOne:u.one, unitMany:u.many, unitLabel:u.one};
  }
  const v = prompt(`Quantité en grammes de « ${nom} » :`, defGrams ?? 100);
  if(v===null) return null;
  const g = parseFloat(String(v).replace(',','.'));
  if(!Number.isFinite(g)||g<=0){ alert('Quantité invalide.'); return null; }
  return {qty:g};
}
function qtyChip(it){
  if(!it.unitLabel) return `⚖ ${r0(it.qty)} g ✎`;
  const lbl = it.units>1 ? (it.unitMany || it.unitLabel+'s') : (it.unitOne || it.unitLabel);
  return `🥚 ${it.units} ${esc(lbl)} (${r0(it.qty)} g) ✎`;
}

/* ---- journée : liste de ce qui a été mangé ---- */
function ensureDay(k){
  const j = Store.data.journal[k];
  if(!j || !Array.isArray(j.eaten)){
    Store.data.journal[k] = {eaten: [], updatedAt: nowIso()};
  }
  return Store.data.journal[k];
}
function touchDay(){ Store.data.journal[day].updatedAt = nowIso(); Store.save(); }
function dayTotals(j){
  let kcal=0, prot=0;
  for(const e of j.eaten){ kcal += e.kcal * e.count; prot += e.prot * e.count; }
  return {kcal, prot};
}
/* nb de fois où un plat a été mangé ce jour */
function eatenCount(j, recipeId){
  const e = j.eaten.find(x=>x.type==='recipe' && x.recipeId===recipeId);
  return e ? e.count : 0;
}
function bumpRecipe(j, rec, delta){
  let e = j.eaten.find(x=>x.type==='recipe' && x.recipeId===rec.id);
  if(!e && delta>0){
    const t = recipeTotals(rec);                       // snapshot au moment du tap
    e = {id:uid(), type:'recipe', recipeId:rec.id, nom:rec.nom, kcal:t.kcal, prot:t.prot, count:0};
    j.eaten.push(e);
  }
  if(!e) return;
  e.count += delta;
  if(e.count<=0) j.eaten = j.eaten.filter(x=>x!==e);
  touchDay(); render();
}

/* ---- recherche + quantité (pour ingrédients et extras) ---- */
function foodPicker(title, onPick){
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `
    <div class="modal">
      <h3>${esc(title)}</h3>
      <div class="foodsearch">
        <input type="search" id="fpQ" placeholder="Rechercher (ex : riz cuit, poulet…)" autocomplete="off">
        <div class="fs-res" id="fpRes" style="display:none"></div>
      </div>
      <div id="fpStatus" class="small muted" style="margin-top:8px">Base CIQUAL (ANSES) : chargement…</div>
      <div class="actions">
        <button class="btn" id="fpNew">+ Aliment perso</button>
        <button class="btn" id="fpCancel">Annuler</button>
      </div>
    </div>`;
  document.body.appendChild(bg);
  const close = ()=>bg.remove();
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  bg.querySelector('#fpCancel').addEventListener('click', close);
  const q = bg.querySelector('#fpQ'), res = bg.querySelector('#fpRes'), status = bg.querySelector('#fpStatus');

  loadCiqual().then(c=>{ status.textContent = `Base CIQUAL 2020 (ANSES) : ${c.foods.length} aliments · + tes aliments perso`; runSearch(); })
              .catch(()=>{ status.textContent = '⚠️ Base CIQUAL indisponible hors-ligne — recherche limitée à tes aliments perso.'; });

  function runSearch(){
    const list = searchFoods(q.value);
    if(!q.value.trim() || !list.length){ res.style.display='none'; return; }
    res.innerHTML = list.map((f,i)=>`
      <div class="fs-item" data-i="${i}">
        <div>${f.type==='perso'?'⭐ ':''}${esc(f.nom)}</div>
        <div class="sub">${r0(f.kcal100)} kcal · ${r1(f.prot100)} g prot <span class="muted">/100 g</span></div>
      </div>`).join('');
    res.style.display='block';
    res.querySelectorAll('.fs-item').forEach(el=>el.addEventListener('click', ()=>{
      const f = list[+el.dataset.i];
      const a = askQty(f.nom, null, f.defQty ? r0(f.defQty) : 100);
      if(!a) return;
      onPick({id:uid(), nom:f.nom, kcal100:f.kcal100, prot100:f.prot100, ...a});
      close();
    }));
  }
  q.addEventListener('input', runSearch);
  q.focus();

  bg.querySelector('#fpNew').addEventListener('click', ()=>{
    const nom = prompt('Nom de l\'aliment :'); if(!nom) return;
    const kcal = parseFloat(String(prompt('kcal pour 100 g :')||'').replace(',','.'));
    const prot = parseFloat(String(prompt('Protéines (g) pour 100 g :')||'').replace(',','.'));
    if(!Number.isFinite(kcal)||!Number.isFinite(prot)||kcal<0||prot<0){ alert('Valeurs invalides.'); return; }
    Store.data.foods.push({id:uid(), nom:nom.trim(), kcal, prot, updatedAt:nowIso()});
    Store.save();
    q.value = nom; runSearch();
  });
}

/* ---- éditeur de plat (recette) ---- */
function editRecipe(id, presetCat){
  let rec = id ? Store.data.recipes.find(r=>r.id===id)
              : {id:uid(), nom:'', cat:presetCat||null, items:[], updatedAt:nowIso()};
  const isNew = !id;
  const bg = document.createElement('div');
  bg.className='modal-bg';
  document.body.appendChild(bg);
  const close = ()=>bg.remove();

  function draw(){
    const t = recipeTotals(rec);
    bg.innerHTML = `
      <div class="modal">
        <h3>${isNew?'Nouveau plat':'Modifier le plat'}</h3>
        <div class="fieldrow">
          <div class="field" style="flex:2"><label>Nom</label><input type="text" id="rcNom" value="${esc(rec.nom)}" placeholder="Pâtes bolognaises"></div>
          <div class="field"><label>Catégorie</label>
            <select id="rcCat">${Store.data.mealCats.map(c=>`<option value="${c.id}" ${rec.cat===c.id?'selected':''}>${esc(c.nom)}</option>`).join('')}</select>
          </div>
        </div>
        <div class="list">
          ${rec.items.map(it=>`
            <div class="li-row">
              <div class="grow" data-q="${it.id}"><div class="name">${esc(it.nom)}</div>
                <span class="chip">${qtyChip(it)}</span></div>
              <div class="val">${r0(kcalOf(it))} <small>kcal</small></div>
              <button class="li-x" data-x="${it.id}">✕</button>
            </div>`).join('')}
        </div>
        <button class="btn" id="rcAdd" style="width:100%;margin-top:8px">+ Ingrédient</button>
        <div class="tiles" style="margin-top:10px">
          <div class="tile"><div class="v">${r0(t.kcal)}</div><div class="l">kcal</div></div>
          <div class="tile"><div class="v">${r1(t.prot)}</div><div class="l">g prot</div></div>
          <div class="tile"><div class="v">${r0(t.weight)}</div><div class="l">g au total</div></div>
        </div>
        <div class="actions">
          <button class="btn primary" id="rcSave">Enregistrer</button>
          ${!isNew?'<button class="btn danger" id="rcDel">🗑</button>':''}
          <button class="btn" id="rcCancel">Annuler</button>
        </div>
      </div>`;
    bg.querySelector('#rcNom').addEventListener('input', e=>rec.nom=e.target.value);
    bg.querySelector('#rcCat').addEventListener('change', e=>rec.cat=e.target.value);
    bg.querySelector('#rcAdd').addEventListener('click', ()=>{
      foodPicker('Ajouter un ingrédient', item=>{ rec.items.push(item); draw(); });
    });
    bg.querySelectorAll('[data-x]').forEach(b=>b.addEventListener('click', ()=>{ rec.items=rec.items.filter(i=>i.id!==b.dataset.x); draw(); }));
    bg.querySelectorAll('[data-q]').forEach(d=>d.addEventListener('click', ()=>{
      const it = rec.items.find(i=>i.id===d.dataset.q);
      const a = askQty(it.nom, it.units, r0(it.qty));
      if(!a) return;
      it.qty=a.qty; it.units=a.units; it.unitG=a.unitG; it.unitOne=a.unitOne; it.unitMany=a.unitMany; it.unitLabel=a.unitLabel;
      draw();
    }));
    bg.querySelector('#rcSave').addEventListener('click', ()=>{
      if(!rec.nom.trim()){ alert('Donne un nom au plat.'); return; }
      if(!rec.items.length){ alert('Ajoute au moins un ingrédient.'); return; }
      if(!rec.cat) rec.cat = Store.data.mealCats[0].id;
      rec.updatedAt = nowIso();
      if(isNew) Store.data.recipes.push(rec);
      Store.save(); close(); render();
    });
    const del = bg.querySelector('#rcDel');
    if(del) del.addEventListener('click', ()=>{
      if(!confirm(`Supprimer « ${rec.nom} » de ta bibliothèque ?\n(Les jours où tu l'as mangé gardent leurs valeurs.)`)) return;
      rec.deleted = true; rec.updatedAt = nowIso();
      Store.save(); close(); render();
    });
    bg.querySelector('#rcCancel').addEventListener('click', close);
  }
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  draw();
}

/* ---- rendu principal ---- */
function render(){
  const j = ensureDay(day);
  const el = document.getElementById('rMain');
  const tdee = Store.data.tdee;
  const targets = (window.TDEE && tdee) ? window.TDEE.targets(tdee) : null;
  const tot = dayTotals(j);
  const isToday = day === todayKey();

  /* jauges */
  let gauges;
  if(targets){
    const pk = Math.min(100, tot.kcal/targets.kcal*100);
    const rest = targets.kcal - tot.kcal;
    /* Barre protéines : remplie par rapport au besoin MAX, repère (tick) au niveau du min.
       Bleu = sous le min · vert = dans la zone min–max · orange = au-delà du max. */
    const underMin = tot.prot < targets.protMin;
    const overMax  = tot.prot > targets.protMax;
    const pp = Math.min(100, tot.prot/targets.protMax*100);
    const minPos = targets.protMin/targets.protMax*100;
    const protColor = underMin ? 'var(--line)' : overMax ? 'var(--warn)' : 'var(--good)';
    const protMsg = underMin ? 'encore '+r1(targets.protMin-tot.prot)+' g pour le min'
                  : overMax  ? '⚠️ +'+r1(tot.prot-targets.protMax)+' g au-delà du repère'
                  : 'dans la zone 👌';
    gauges = `
      <div class="card" style="position:sticky;top:0;z-index:10">
        <div class="gauge"><i style="width:${pk}%" class="${tot.kcal>targets.kcal?'over':''}"></i></div>
        <div class="gauge-l"><span>🔥 <b style="color:var(--text)">${r0(tot.kcal)}</b> / ${r0(targets.kcal)} kcal</span>
          <span>${rest>=0 ? r0(rest)+' restantes' : '⚠️ +'+r0(-rest)+' au-dessus'}</span></div>
        <div class="gauge" style="margin-top:8px">
          <i style="width:${pp}%;background:${protColor}"></i>
          <span class="tick" style="left:${minPos}%"></span>
        </div>
        <div class="gauge-l"><span>🥩 <b style="color:var(--text)">${r1(tot.prot)}</b> / ${r0(targets.protMax)} g prot · min ${r0(targets.protMin)} ${underMin?'':'✅'}</span>
          <span class="muted">${protMsg}</span></div>
      </div>`;
  } else {
    gauges = `<div class="card"><div class="small muted">💡 Configure ton TDEE (onglet 🔥) pour voir tes jauges d'objectif kcal/protéines.</div>
      <div class="gauge-l" style="margin-top:6px"><span>🔥 <b style="color:var(--text)">${r0(tot.kcal)}</b> kcal</span>
      <span>🥩 <b style="color:var(--text)">${r1(tot.prot)}</b> g prot</span></div></div>`;
  }

  /* extras du jour (aliments ponctuels) */
  const extras = j.eaten.filter(e=>e.type==='food');
  const extrasHtml = extras.length ? `
    <div class="card">
      <h2>🍴 Extras ${isToday?"d'aujourd'hui":'du '+esc(labelForKey(day,false))}</h2>
      <div class="list">
        ${extras.map(e=>`
          <div class="li-row">
            <div class="grow"><div class="name">${esc(e.nom)}</div>
              <div class="sub">${e.count>1?'×'+e.count+' · ':''}${r0(e.qty)} g</div></div>
            <div class="val">${r0(e.kcal*e.count)} <small>kcal</small><br><span class="small" style="font-weight:400">${r1(e.prot*e.count)} g prot</span></div>
            <button class="li-x" data-delextra="${e.id}">✕</button>
          </div>`).join('')}
      </div>
    </div>` : '';

  /* bibliothèque par catégories */
  const recipes = Store.data.recipes.filter(r=>!r.deleted);
  const catsHtml = Store.data.mealCats.map(c=>{
    const meals = recipes.filter(r=>r.cat===c.id || (!r.cat && c===Store.data.mealCats[0]));
    return `
    <div class="card">
      <div class="row" style="margin-bottom:6px">
        <h2 style="margin:0" data-rencat="${c.id}" title="Renommer">${esc(c.nom)} <span class="muted small">✎</span></h2>
        <button class="li-x" data-delcat="${c.id}" title="Supprimer la catégorie">🗑</button>
      </div>
      <div class="list">
        ${meals.length ? meals.map(rec=>{
          const t = recipeTotals(rec);
          const n = eatenCount(j, rec.id);
          return `
          <div class="li-row" ${n?'style="outline:1.5px solid var(--line)"':''}>
            <div class="grow" data-edit="${rec.id}" title="Modifier">
              <div class="name">${esc(rec.nom)}</div>
              <div class="sub">${r0(t.kcal)} kcal · ${r1(t.prot)} g prot</div>
            </div>
            ${n?`<button class="btn" data-minus="${rec.id}" style="min-width:44px;padding:6px">−</button>
                 <b style="min-width:26px;text-align:center">×${n}</b>`:''}
            <button class="btn ${n?'':'primary'}" data-plus="${rec.id}" style="min-width:48px;padding:6px 10px">＋</button>
          </div>`; }).join('')
        : '<div class="small muted" style="padding:6px 2px">Aucun plat — crée le premier 👇</div>'}
      </div>
      <button class="btn" data-newmeal="${c.id}" style="width:100%;margin-top:8px">+ Nouveau plat</button>
    </div>`;
  }).join('');

  el.innerHTML = gauges + extrasHtml + catsHtml + `
    <div style="display:flex;gap:8px">
      <button class="btn" id="rAddCat" style="flex:1">+ Catégorie</button>
      <button class="btn" id="rAddExtra" style="flex:1">🍴 + Extra (aliment ponctuel)</button>
    </div>`;

  /* listeners */
  el.querySelectorAll('[data-plus]').forEach(b=>b.addEventListener('click', ()=>{
    bumpRecipe(j, Store.data.recipes.find(r=>r.id===b.dataset.plus), +1);
  }));
  el.querySelectorAll('[data-minus]').forEach(b=>b.addEventListener('click', ()=>{
    bumpRecipe(j, Store.data.recipes.find(r=>r.id===b.dataset.minus), -1);
  }));
  el.querySelectorAll('[data-edit]').forEach(d=>d.addEventListener('click', ()=>editRecipe(d.dataset.edit)));
  el.querySelectorAll('[data-newmeal]').forEach(b=>b.addEventListener('click', ()=>editRecipe(null, b.dataset.newmeal)));
  el.querySelectorAll('[data-delextra]').forEach(b=>b.addEventListener('click', ()=>{
    j.eaten = j.eaten.filter(e=>e.id!==b.dataset.delextra);
    touchDay(); render();
  }));
  el.querySelectorAll('[data-rencat]').forEach(h=>h.addEventListener('click', ()=>{
    const c = Store.data.mealCats.find(x=>x.id===h.dataset.rencat);
    const v = prompt('Nom de la catégorie :', c.nom);
    if(v && v.trim()){ c.nom=v.trim(); Store.data.mealCatsUpdatedAt=nowIso(); Store.save(); render(); }
  }));
  el.querySelectorAll('[data-delcat]').forEach(b=>b.addEventListener('click', ()=>{
    const c = Store.data.mealCats.find(x=>x.id===b.dataset.delcat);
    const used = Store.data.recipes.some(r=>!r.deleted && r.cat===c.id);
    if(used){ alert('Cette catégorie contient des plats — déplace-les ou supprime-les d\'abord.'); return; }
    if(Store.data.mealCats.length<=1){ alert('Il faut au moins une catégorie.'); return; }
    if(!confirm(`Supprimer la catégorie « ${c.nom} » ?`)) return;
    Store.data.mealCats = Store.data.mealCats.filter(x=>x.id!==c.id);
    Store.data.mealCatsUpdatedAt = nowIso(); Store.save(); render();
  }));
  el.querySelector('#rAddCat').addEventListener('click', ()=>{
    const v = prompt('Nom de la nouvelle catégorie (ex : Petit-déj) :');
    if(v && v.trim()){
      Store.data.mealCats.push({id:uid(), nom:v.trim()});
      Store.data.mealCatsUpdatedAt = nowIso(); Store.save(); render();
    }
  });
  el.querySelector('#rAddExtra').addEventListener('click', ()=>{
    foodPicker('Extra — aliment ponctuel', item=>{
      j.eaten.push({id:item.id, type:'food', nom:item.nom, qty:item.qty,
        units:item.units, unitLabel:item.unitLabel, unitOne:item.unitOne, unitMany:item.unitMany,
        kcal:item.kcal100*item.qty/100, prot:item.prot100*item.qty/100, count:1});
      touchDay(); render();
    });
  });
  cal.refresh();
}

/* ---- init ---- */
document.addEventListener('DOMContentLoaded', ()=>{
  day = todayKey();
  cal = createCalendar({
    button: document.getElementById('rDayBtn'),
    label:  document.getElementById('rDayLabel'),
    popup:  document.getElementById('rDayCal'),
    isSelectable: () => true,
    isMarked: k => { const jd=Store.data.journal[k]; return !!jd && Array.isArray(jd.eaten) && jd.eaten.length>0; },
    onSelect: k => { day = k; render(); }
  });
  cal.setSelected(day);

  document.addEventListener('pageshow', e=>{ if(e.detail.page==='repas'){ loadCiqual().catch(()=>{}); render(); } });
  document.addEventListener('storechange', ()=>{ if(document.getElementById('page-repas').classList.contains('active')) render(); });
  render();
});

})();
