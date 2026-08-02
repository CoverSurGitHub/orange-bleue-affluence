/* ===== Section Repas : aliments (CIQUAL) / recettes / journal ===== */
'use strict';
(function(){

let cal = null;
let day = null;             // jour affiché du journal
let TAB = 'journal';        // journal | recettes
let CIQUAL = null;          // {foods:[[nom,kcal,prot,glu,lip]...]} chargé à la demande
let ciqualPromise = null;

/* ---- utilitaires nutrition (aucun arrondi interne, arrondi à l'affichage) ---- */
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

/* ---- recherche unifiée : CIQUAL + aliments perso + recettes ---- */
function searchFoods(q){
  const terms = norm(q).split(/\s+/).filter(Boolean);
  if(!terms.length) return [];
  const match = name => { const n=norm(name); return terms.every(t=>n.includes(t)); };
  const out = [];
  for(const rec of Store.data.recipes){
    if(rec.deleted || !match(rec.nom)) continue;
    const tot = recipeTotals(rec);
    if(tot.weight>0) out.push({type:'recette', nom:rec.nom, kcal100:tot.kcal/tot.weight*100, prot100:tot.prot/tot.weight*100, defQty:tot.weight});
  }
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
  // pertinence simple : les noms les plus courts (plus génériques) d'abord
  out.sort((a,b)=>a.nom.length-b.nom.length);
  return out.slice(0,30);
}

function recipeTotals(rec){
  let kcal=0, prot=0, weight=0;
  for(const it of rec.items){ kcal+=kcalOf(it); prot+=protOf(it); weight+=it.qty; }
  return {kcal, prot, weight};
}

/* ---- journal ---- */
function ensureDay(k){
  if(!Store.data.journal[k]){
    Store.data.journal[k] = {
      cats: Store.data.catTemplate.map(c=>({id:uid(), nom:c.nom, items:[]})),
      updatedAt: nowIso()
    };
  }
  return Store.data.journal[k];
}
function touchDay(){ Store.data.journal[day].updatedAt = nowIso(); Store.save(); }

/* ---- composant recherche + choix quantité (réutilisé journal & recettes) ---- */
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

  loadCiqual().then(c=>{ status.textContent = `Base CIQUAL 2020 (ANSES) : ${c.foods.length} aliments · + tes recettes et aliments perso`; runSearch(); })
              .catch(()=>{ status.textContent = '⚠️ Base CIQUAL indisponible hors-ligne — recherche limitée à tes aliments perso et recettes.'; });

  function runSearch(){
    const list = searchFoods(q.value);
    if(!q.value.trim() || !list.length){ res.style.display='none'; return; }
    res.innerHTML = list.map((f,i)=>`
      <div class="fs-item" data-i="${i}">
        <div>${f.type==='recette'?'📖 ':f.type==='perso'?'⭐ ':''}${esc(f.nom)}</div>
        <div class="sub">${r0(f.kcal100)} kcal · ${r1(f.prot100)} g prot <span class="muted">/100 g${f.type==='recette'?' de recette':''}</span></div>
      </div>`).join('');
    res.style.display='block';
    res.querySelectorAll('.fs-item').forEach(el=>el.addEventListener('click', ()=>{
      const f = list[+el.dataset.i];
      const v = prompt(`Quantité en grammes de « ${f.nom} » :`, f.defQty ? r0(f.defQty) : 100);
      if(v===null) return;
      const qty = parseFloat(String(v).replace(',','.'));
      if(!Number.isFinite(qty) || qty<=0){ alert('Quantité invalide.'); return; }
      onPick({id:uid(), nom:f.nom, kcal100:f.kcal100, prot100:f.prot100, qty});
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

/* ---- rendu journal ---- */
function renderJournal(){
  const j = ensureDay(day);
  const el = document.getElementById('rJournal');
  const tdee = Store.data.tdee;
  const targets = (window.TDEE && tdee) ? window.TDEE.targets(tdee) : null;

  let dayKcal=0, dayProt=0;
  for(const c of j.cats) for(const it of c.items){ dayKcal+=kcalOf(it); dayProt+=protOf(it); }

  let gauges = '';
  if(targets){
    const pk = Math.min(100, dayKcal/targets.kcal*100);
    const pp = Math.min(100, dayProt/targets.protMax*100);
    gauges = `
      <div class="card" style="background:var(--card2)">
        <div class="gauge"><i style="width:${pk}%" class="${dayKcal>targets.kcal?'over':''}"></i></div>
        <div class="gauge-l"><span>🔥 ${r0(dayKcal)} / ${r0(targets.kcal)} kcal (objectif ${esc(targets.objectifLabel)})</span><span>${r0(targets.kcal-dayKcal)} restantes</span></div>
        <div class="gauge" style="margin-top:8px"><i style="width:${pp}%" style2=""></i></div>
        <div class="gauge-l"><span>🥩 ${r1(dayProt)} g / ${r0(targets.protMin)}–${r0(targets.protMax)} g protéines</span></div>
      </div>`;
  } else {
    gauges = `<div class="small muted" style="margin-bottom:10px">💡 Configure ton TDEE (onglet 🔥) pour voir tes jauges kcal/protéines du jour.</div>`;
  }

  el.innerHTML = gauges + j.cats.map(c=>{
    const ck = c.items.reduce((s,it)=>s+kcalOf(it),0);
    const cp = c.items.reduce((s,it)=>s+protOf(it),0);
    return `
    <div class="card">
      <div class="row" style="margin-bottom:6px">
        <h2 style="margin:0" data-ren="${c.id}" title="Renommer">${esc(c.nom)} <span class="muted small">✎</span></h2>
        <div class="small muted"><b style="color:var(--text)">${r0(ck)}</b> kcal · <b style="color:var(--text)">${r1(cp)}</b> g prot</div>
      </div>
      <div class="list">
        ${c.items.map(it=>`
          <div class="li-row">
            <div class="grow" data-qty="${c.id}:${it.id}" title="Modifier la quantité">
              <div class="name">${esc(it.nom)}</div>
              <span class="chip">⚖ ${r0(it.qty)} g ✎</span>
              <span class="sub"> · ${r0(it.kcal100)} kcal/100g</span>
            </div>
            <div class="val">${r0(kcalOf(it))} <small>kcal</small><br><span class="small" style="font-weight:400">${r1(protOf(it))} g prot</span></div>
            <button class="li-x" data-del="${c.id}:${it.id}">✕</button>
          </div>`).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn" data-add="${c.id}" style="flex:1">+ Ajouter</button>
        <button class="li-x" data-delcat="${c.id}" title="Supprimer la catégorie">🗑</button>
      </div>
    </div>`;
  }).join('') + `
    <div style="display:flex;gap:8px">
      <button class="btn" id="rAddCat" style="flex:1">+ Catégorie</button>
      <button class="btn" id="rSaveTpl" title="Les jours suivants utiliseront ces catégories">📌 Modèle par défaut</button>
    </div>`;

  // listeners
  el.querySelectorAll('[data-add]').forEach(b=>b.addEventListener('click', ()=>{
    const cat = j.cats.find(c=>c.id===b.dataset.add);
    foodPicker('Ajouter à « '+cat.nom+' »', item=>{ cat.items.push(item); touchDay(); renderJournal(); });
  }));
  el.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click', ()=>{
    const [cid,iid] = b.dataset.del.split(':');
    const cat = j.cats.find(c=>c.id===cid);
    cat.items = cat.items.filter(i=>i.id!==iid);
    touchDay(); renderJournal();
  }));
  el.querySelectorAll('[data-qty]').forEach(d=>d.addEventListener('click', ()=>{
    const [cid,iid] = d.dataset.qty.split(':');
    const it = j.cats.find(c=>c.id===cid).items.find(i=>i.id===iid);
    const v = prompt(`Quantité en g de « ${it.nom} » :`, r0(it.qty));
    if(v===null) return;
    const qty = parseFloat(String(v).replace(',','.'));
    if(!Number.isFinite(qty)||qty<=0){ alert('Quantité invalide.'); return; }
    it.qty = qty; touchDay(); renderJournal();
  }));
  el.querySelectorAll('[data-ren]').forEach(h=>h.addEventListener('click', ()=>{
    const cat = j.cats.find(c=>c.id===h.dataset.ren);
    const v = prompt('Nom de la catégorie :', cat.nom);
    if(v && v.trim()){ cat.nom = v.trim(); touchDay(); renderJournal(); }
  }));
  el.querySelectorAll('[data-delcat]').forEach(b=>b.addEventListener('click', ()=>{
    const cat = j.cats.find(c=>c.id===b.dataset.delcat);
    if(cat.items.length && !confirm(`Supprimer « ${cat.nom} » et ses ${cat.items.length} aliment(s) ?`)) return;
    j.cats = j.cats.filter(c=>c.id!==cat.id);
    touchDay(); renderJournal();
  }));
  el.querySelector('#rAddCat').addEventListener('click', ()=>{
    const v = prompt('Nom de la nouvelle catégorie (ex : Collation 3) :');
    if(v && v.trim()){ j.cats.push({id:uid(), nom:v.trim(), items:[]}); touchDay(); renderJournal(); }
  });
  el.querySelector('#rSaveTpl').addEventListener('click', ()=>{
    Store.data.catTemplate = j.cats.map(c=>({id:uid(), nom:c.nom}));
    Store.data.catTemplateUpdatedAt = nowIso();
    Store.save();
    alert('Ces catégories seront proposées par défaut pour les nouveaux jours ✔');
  });
  cal.refresh();
}

/* ---- rendu recettes ---- */
function renderRecettes(){
  const el = document.getElementById('rRecettes');
  const recipes = Store.data.recipes.filter(r=>!r.deleted);
  const foods = Store.data.foods.filter(f=>!f.deleted);
  el.innerHTML = `
    <div class="card">
      <div class="row"><h2 style="margin:0">📖 Mes recettes</h2>
        <button class="btn primary" id="rcNew">+ Recette</button></div>
      <div class="list">
        ${recipes.length ? recipes.map(rec=>{
          const t = recipeTotals(rec);
          return `<div class="li-row">
            <div class="grow" data-edit="${rec.id}">
              <div class="name">${esc(rec.nom)}</div>
              <div class="sub">${rec.items.length} ingrédient(s) · ${r0(t.weight)} g au total</div>
            </div>
            <div class="val">${r0(t.kcal)} <small>kcal</small><br><span class="small" style="font-weight:400">${r1(t.prot)} g prot</span></div>
            <button class="li-x" data-delrec="${rec.id}">✕</button>
          </div>`; }).join('') : '<div class="empty small">Aucune recette. Crée ta première (ex : Pâtes bolognaises) !</div>'}
      </div>
    </div>
    <div class="card">
      <div class="row"><h2 style="margin:0">⭐ Mes aliments perso</h2></div>
      <div class="list">
        ${foods.length ? foods.map(f=>`
          <div class="li-row">
            <div class="grow"><div class="name">${esc(f.nom)}</div>
              <div class="sub">${r0(f.kcal)} kcal · ${r1(f.prot)} g prot /100 g</div></div>
            <button class="li-x" data-delfood="${f.id}">✕</button>
          </div>`).join('') : '<div class="empty small">Aucun aliment perso (la base CIQUAL couvre déjà ~2300 aliments).</div>'}
      </div>
    </div>`;
  el.querySelector('#rcNew').addEventListener('click', ()=>editRecipe(null));
  el.querySelectorAll('[data-edit]').forEach(d=>d.addEventListener('click', ()=>editRecipe(d.dataset.edit)));
  el.querySelectorAll('[data-delrec]').forEach(b=>b.addEventListener('click', ()=>{
    const rec = Store.data.recipes.find(r=>r.id===b.dataset.delrec);
    if(!confirm(`Supprimer la recette « ${rec.nom} » ?`)) return;
    rec.deleted = true; rec.updatedAt = nowIso(); Store.save(); renderRecettes();
  }));
  el.querySelectorAll('[data-delfood]').forEach(b=>b.addEventListener('click', ()=>{
    const f = Store.data.foods.find(x=>x.id===b.dataset.delfood);
    if(!confirm(`Supprimer « ${f.nom} » ?`)) return;
    f.deleted = true; f.updatedAt = nowIso(); Store.save(); renderRecettes();
  }));
}

function editRecipe(id){
  let rec = id ? Store.data.recipes.find(r=>r.id===id) : {id:uid(), nom:'', items:[], updatedAt:nowIso()};
  const isNew = !id;
  const bg = document.createElement('div');
  bg.className='modal-bg';
  document.body.appendChild(bg);
  const close = ()=>bg.remove();

  function draw(){
    const t = recipeTotals(rec);
    bg.innerHTML = `
      <div class="modal">
        <h3>${isNew?'Nouvelle recette':'Modifier la recette'}</h3>
        <div class="field"><label>Nom</label><input type="text" id="rcNom" value="${esc(rec.nom)}" placeholder="Pâtes bolognaises"></div>
        <div class="list">
          ${rec.items.map(it=>`
            <div class="li-row">
              <div class="grow" data-q="${it.id}"><div class="name">${esc(it.nom)}</div>
                <span class="chip">⚖ ${r0(it.qty)} g ✎</span></div>
              <div class="val">${r0(kcalOf(it))} <small>kcal</small></div>
              <button class="li-x" data-x="${it.id}">✕</button>
            </div>`).join('')}
        </div>
        <button class="btn" id="rcAdd" style="width:100%;margin-top:8px">+ Ingrédient</button>
        <div class="tiles" style="margin-top:10px">
          <div class="tile"><div class="v">${r0(t.kcal)}</div><div class="l">kcal total</div></div>
          <div class="tile"><div class="v">${r1(t.prot)}</div><div class="l">g prot total</div></div>
          <div class="tile"><div class="v">${t.weight?r0(t.kcal/t.weight*100):0}</div><div class="l">kcal /100 g</div></div>
        </div>
        <div class="actions">
          <button class="btn primary" id="rcSave">Enregistrer</button>
          <button class="btn" id="rcCancel">Annuler</button>
        </div>
      </div>`;
    bg.querySelector('#rcNom').addEventListener('input', e=>rec.nom=e.target.value);
    bg.querySelector('#rcAdd').addEventListener('click', ()=>{
      foodPicker('Ajouter un ingrédient', item=>{ rec.items.push(item); draw(); });
    });
    bg.querySelectorAll('[data-x]').forEach(b=>b.addEventListener('click', ()=>{ rec.items=rec.items.filter(i=>i.id!==b.dataset.x); draw(); }));
    bg.querySelectorAll('[data-q]').forEach(d=>d.addEventListener('click', ()=>{
      const it = rec.items.find(i=>i.id===d.dataset.q);
      const v = prompt(`Quantité en g de « ${it.nom} » :`, r0(it.qty));
      if(v===null) return;
      const qty = parseFloat(String(v).replace(',','.'));
      if(Number.isFinite(qty)&&qty>0){ it.qty=qty; draw(); }
    }));
    bg.querySelector('#rcSave').addEventListener('click', ()=>{
      if(!rec.nom.trim()){ alert('Donne un nom à la recette.'); return; }
      if(!rec.items.length){ alert('Ajoute au moins un ingrédient.'); return; }
      rec.updatedAt = nowIso();
      if(isNew) Store.data.recipes.push(rec);
      Store.save(); close(); renderRecettes();
    });
    bg.querySelector('#rcCancel').addEventListener('click', close);
  }
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  draw();
}

/* ---- init ---- */
function setTab(t){
  TAB = t;
  document.getElementById('rTabJournal').classList.toggle('active', t==='journal');
  document.getElementById('rTabRecettes').classList.toggle('active', t==='recettes');
  document.getElementById('rJournal').style.display = t==='journal' ? '' : 'none';
  document.getElementById('rRecettes').style.display = t==='recettes' ? '' : 'none';
  document.getElementById('rCalWrap').style.display = t==='journal' ? '' : 'none';
  t==='journal' ? renderJournal() : renderRecettes();
}

document.addEventListener('DOMContentLoaded', ()=>{
  day = todayKey();
  cal = createCalendar({
    button: document.getElementById('rDayBtn'),
    label:  document.getElementById('rDayLabel'),
    popup:  document.getElementById('rDayCal'),
    isSelectable: () => true,                                   // planifier demain = autorisé
    isMarked: k => { const jd=Store.data.journal[k]; return !!jd && jd.cats.some(c=>c.items.length); },
    onSelect: k => { day = k; renderJournal(); }
  });
  cal.setSelected(day);

  document.getElementById('rTabJournal').addEventListener('click', ()=>setTab('journal'));
  document.getElementById('rTabRecettes').addEventListener('click', ()=>setTab('recettes'));
  document.addEventListener('pageshow', e=>{ if(e.detail.page==='repas'){ loadCiqual().catch(()=>{}); TAB==='journal'?renderJournal():renderRecettes(); } });
  document.addEventListener('storechange', ()=>{ if(document.getElementById('page-repas').classList.contains('active')) TAB==='journal'?renderJournal():renderRecettes(); });
  renderJournal();
});

})();
