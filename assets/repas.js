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

let EAU_PAR_NOM = null;      // nom exact CIQUAL → eau (g/100 g), null si non renseignée
function loadCiqual(){
  if(CIQUAL) return Promise.resolve(CIQUAL);
  if(!ciqualPromise){
    ciqualPromise = fetch('data/ciqual.min.json').then(r=>{
      if(!r.ok) throw new Error('HTTP '+r.status);
      return r.json();
    }).then(j=>{
      CIQUAL=j;
      // colonne 5 = eau_g (base enrichie) ; absente sur une ancienne version du fichier
      EAU_PAR_NOM = Object.create(null);
      for(const f of j.foods) if(typeof f[5] === 'number') EAU_PAR_NOM[f[0]] = f[5];
      return j;
    }).catch(e=>{ ciqualPromise=null; throw e; });
  }
  return ciqualPromise;
}

/* ===== Eau apportée par les aliments =====
   Teneur officielle CIQUAL (constituant 400, g/100 g ≈ ml, densité 1).
   - eau100 est mémorisé sur les ingrédients ajoutés depuis la refonte ;
   - pour les recettes plus anciennes, on retrouve la valeur par le nom exact ;
   - sans donnée officielle : 0 (jamais d'estimation inventée).
   Le mode 'drinks' ne retient que les ingrédients liquides (cas du smoothie). */
function eau100Of(it){
  if(typeof it.eau100 === 'number') return it.eau100;
  if(EAU_PAR_NOM && typeof EAU_PAR_NOM[it.nom] === 'number') return EAU_PAR_NOM[it.nom];
  return null;
}
function waterOfItem(it, mode){
  if(mode === 'off') return 0;
  if(mode === 'drinks' && !liquidInfo(it.nom)) return 0;
  const e100 = eau100Of(it);
  if(e100 === null) return 0;
  return e100 * it.qty / 100;                 // qty en g → g d'eau ≈ ml
}
function waterOfItems(items, mode){
  return (items||[]).reduce((s,it)=>s + waterOfItem(it, mode), 0);
}
/* ingrédients liquides sans teneur officielle : signalés à l'utilisateur */
function itemsSansEau(items, mode){
  if(mode === 'off') return [];
  return (items||[]).filter(it=>(mode==='all' || liquidInfo(it.nom)) && eau100Of(it) === null);
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
      out.push({type:'ciqual', nom:f[0], kcal100:f[1], prot100:f[2]??0,
                eau100: typeof f[5]==='number' ? f[5] : undefined, defQty:100});
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
/* Poids comestibles moyens indicatifs (fruit moyen, sans peau/noyau) —
   modifiables au cas par cas en tapant des grammes (ex : « 160g »). */
const UNIT_FRUITS = [
  [/\bbanane/,               'banane','bananes','de bananes',110,'🍌'],
  [/\bpomme\b/,              'pomme','pommes','de pommes',150,'🍎'],
  [/\bpoire\b/,              'poire','poires','de poires',140,'🍐'],
  [/\borange\b/,             'orange','oranges',"d'oranges",130,'🍊'],
  [/clementine|mandarine/,   'clémentine','clémentines','de clémentines',50,'🍊'],
  [/\bkiwi/,                 'kiwi','kiwis','de kiwis',75,'🥝'],
  [/\bpeche\b/,              'pêche','pêches','de pêches',130,'🍑'],
  [/nectarine|brugnon/,      'nectarine','nectarines','de nectarines',130,'🍑'],
  [/\babricot/,              'abricot','abricots',"d'abricots",45,'🍑'],
  [/\bprune\b/,              'prune','prunes','de prunes',30,'🍇'],
  [/\bfraise/,               'fraise','fraises','de fraises',12,'🍓'],
  [/\bcerise\b/,             'cerise','cerises','de cerises',8,'🍒'],
  [/\btomate\b/,             'tomate','tomates','de tomates',120,'🍅'],
  [/\bavocat/,               'avocat','avocats',"d'avocats",140,'🥑'],
  [/\bdatte/,                'datte','dattes','de dattes',8,'🌴'],
  [/\bfigue/,                'figue','figues','de figues',50,'🍇'],
  [/\bmangue/,               'mangue','mangues','de mangues',200,'🥭'],
];
// produits dérivés à laisser en grammes/ml (jus, compotes, gâteaux, séchés…)
const UNIT_EXCLUDE = /jus|boisson|nectar|sirop|compote|confiture|puree|tarte|gateau|cake|yaourt|sorbet|glace|sech|chips|farine|poudre|coulis|liqueur|eau.de.vie|\bvin\b|muffin|biscuit|pomme de terre|pommes de terre/;

function unitInfo(nom){
  const n = ' ' + norm(nom) + ' ';
  if(/(oeuf|œuf)/.test(n)){
    if(/jaune/.test(n)) return {one:"jaune d'œuf", many:"jaunes d'œuf", de:"de jaunes d'œuf", g:17, emo:'🥚', defN:3};
    if(/blanc/.test(n)) return {one:"blanc d'œuf", many:"blancs d'œuf", de:"de blancs d'œuf", g:33, emo:'🥚', defN:3};
    return {one:'œuf', many:'œufs', de:"d'œufs", g:50, emo:'🥚', defN:3};
  }
  if(UNIT_EXCLUDE.test(n)) return null;
  for(const [re,one,many,de,g,emo] of UNIT_FRUITS){
    if(re.test(n)) return {one, many, de, g, emo, defN:1};
  }
  return null;
}

/* ---- liquides : saisie en ml, convertis en g via la densité ----
   (la table CIQUAL est exprimée pour 100 g). Densités usuelles :
   lait ~1,03 g/ml · huile ~0,92 · sirop ~1,32 · autres boissons ~1,00.
   Exclusions : poudres et concentrés (solides ou densité atypique). */
function liquidInfo(nom){
  const n = ' ' + norm(nom) + ' ';
  if(/poudre|concentre|lyophilis/.test(n)) return null;
  const LIQ = /\blait\b|\bboisson|\bjus\b|\bjus,|soda|\bcola\b|\beau\b|\bcafe\b|\bthe\b|infusion|tisane|\bhuile\b|vinaigre|\bsirop\b|\bbiere\b|\bvin\b|\bcidre\b|smoothie|\bnectar\b|limonade|creme liquide|chicoree|cappuccino|chocolat chaud|yaourt a boire|milkshake|cocktail|champagne|\bkefir\b|\bsoupe\b|\bpotage\b|\bbouillon\b/;
  if(!LIQ.test(n)) return null;
  let d = 1.0;
  if(/\bhuile\b/.test(n)) d = 0.92;
  else if(/\bsirop\b/.test(n)) d = 1.32;
  else if(/\blait\b|cappuccino|chocolat chaud|yaourt a boire|milkshake|\bkefir\b/.test(n)) d = 1.03;
  return {density: d};
}
function askQty(nom, prev){
  const u = unitInfo(nom);
  if(u){
    const v = prompt(`Nombre ${u.de} — ${nom}\n(1 ${u.one} ≈ ${u.g} g · ou tape des grammes, ex : 160g)`, (prev && prev.units) ?? u.defN);
    if(v===null) return null;
    const s = String(v).trim().replace(',','.');
    if(/g\s*$/i.test(s)){
      const g = parseFloat(s);
      if(!Number.isFinite(g)||g<=0){ alert('Quantité invalide.'); return null; }
      return {qty:g};
    }
    const n = parseFloat(s);
    if(!Number.isFinite(n)||n<=0||n>50){ alert('Nombre invalide.'); return null; }
    return {qty:n*u.g, units:n, unitG:u.g, unitOne:u.one, unitMany:u.many, unitLabel:u.one, unitEmo:u.emo};
  }
  const L = liquidInfo(nom);
  if(L){
    const v = prompt(`Quantité en ml — ${nom}\n(ou tape des grammes, ex : 100g)`, (prev && prev.ml) ?? 250);
    if(v===null) return null;
    const s = String(v).trim().replace(',','.');
    if(/g\s*$/i.test(s)){
      const g = parseFloat(s);
      if(!Number.isFinite(g)||g<=0){ alert('Quantité invalide.'); return null; }
      return {qty:g};
    }
    const ml = parseFloat(s);
    if(!Number.isFinite(ml)||ml<=0){ alert('Quantité invalide.'); return null; }
    return {qty: ml*L.density, ml, density:L.density};
  }
  const v = prompt(`Quantité en grammes de « ${nom} » :`, (prev && r0(prev.qty)) ?? 100);
  if(v===null) return null;
  const g = parseFloat(String(v).replace(',','.'));
  if(!Number.isFinite(g)||g<=0){ alert('Quantité invalide.'); return null; }
  return {qty:g};
}
function qtyChip(it){
  if(it.unitLabel){
    const lbl = it.units>1 ? (it.unitMany || it.unitLabel+'s') : (it.unitOne || it.unitLabel);
    return `${it.unitEmo||'🥚'} ${it.units} ${esc(lbl)} (${r0(it.qty)} g) ✎`;
  }
  if(it.ml) return `🥛 ${r0(it.ml)} ml${r0(it.ml)!==r0(it.qty)?' ('+r0(it.qty)+' g)':''} ✎`;
  return `⚖ ${r0(it.qty)} g ✎`;
}
/* texte court de quantité (extras du jour) */
function qtyText(e){
  if(e.unitLabel){ const lbl = e.units>1 ? (e.unitMany||e.unitLabel+'s') : (e.unitOne||e.unitLabel); return `${e.units} ${lbl}`; }
  if(e.ml) return `${r0(e.ml)} ml`;
  return `${r0(e.qty)} g`;
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
/* ⚠️ Toujours re-résoudre depuis le store au moment de l'action : une synchro
   peut avoir remplacé les objets entre l'affichage et le clic. */
async function bumpRecipe(recipeId, delta){
  // La base porte la teneur en eau : on l'attend avant de compter, puis on
  // re-résout TOUT depuis le store (une synchro a pu passer pendant l'attente).
  if(delta > 0 && !CIQUAL && window.Water.mode() !== 'off'){
    try{ await loadCiqual(); }catch(e){}
  }
  const j = ensureDay(day);
  const rec = Store.data.recipes.find(r=>r.id===recipeId);
  if(!rec) return;
  let e = j.eaten.find(x=>x.type==='recipe' && x.recipeId===rec.id);
  if(!e && delta>0){
    const t = recipeTotals(rec);                       // snapshot au moment du tap
    // l'eau est figée elle aussi : modifier la recette ensuite ne réécrit pas le passé
    e = {id:uid(), type:'recipe', recipeId:rec.id, nom:rec.nom, kcal:t.kcal, prot:t.prot,
         eauMl: Math.round(waterOfItems(rec.items, window.Water.mode())), count:0};
    j.eaten.push(e);
  }
  if(!e) return;
  e.count += delta;
  const left = e.count;

  // --- eau liée : une entrée d'hydratation par portion ---
  let eauMsg = '';
  const mode = window.Water.mode();
  if(delta > 0 && mode !== 'off'){
    // recalcul si la portion précédente datait d'un autre mode (ou d'avant la fonctionnalité)
    const ml = Math.round(waterOfItems(rec.items, mode));
    if(ml > 0){
      window.Water.addFromMeal(day, e.id, ml, rec.nom, '🍽️');
      eauMsg = ' · 💧 +' + ml + ' ml';
    }
  } else if(delta < 0){
    const rendu = left <= 0 ? window.Water.removeAll(day, e.id) : window.Water.removeOne(day, e.id);
    if(rendu > 0) eauMsg = ' · 💧 −' + rendu + ' ml';
  }

  if(e.count<=0) j.eaten = j.eaten.filter(x=>x!==e);
  touchDay(); render();
  window.Water.refresh();
  const tot = dayTotals(ensureDay(day));
  if(delta > 0) toast('🍽️ ' + esc(rec.nom) + ' ×' + left + ' — ' + Math.round(tot.kcal) + ' kcal' + eauMsg);
  else toast((left > 0 ? '➖ ' + esc(rec.nom) + ' ×' + left : '➖ ' + esc(rec.nom) + ' retiré') + eauMsg);
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
      const a = askQty(f.nom, null);
      if(!a) return;
      onPick({id:uid(), nom:f.nom, kcal100:f.kcal100, prot100:f.prot100,
              ...(typeof f.eau100 === 'number' ? {eau100:f.eau100} : {}), ...a});
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
  // On édite une COPIE : une synchro peut remplacer les objets du store pendant
  // que la fenêtre est ouverte. À l'enregistrement, on réécrit par identifiant.
  const src = id ? Store.data.recipes.find(r=>r.id===id) : null;
  let rec = src ? JSON.parse(JSON.stringify(src))
               : {id:uid(), nom:'', cat:presetCat||null, items:[], updatedAt:nowIso()};
  const isNew = !id;
  const bg = document.createElement('div');
  bg.className='modal-bg';
  document.body.appendChild(bg);
  const close = ()=>bg.remove();

  function draw(){
    const t = recipeTotals(rec);
    const wMode = window.Water.mode();
    const wMl = waterOfItems(rec.items, wMode);
    const sansEau = itemsSansEau(rec.items, wMode);
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
              <div class="val">${r0(kcalOf(it))} <small>kcal</small><br><span class="small" style="font-weight:400">${r1(protOf(it))} g prot</span></div>
              <button class="li-x" data-x="${it.id}">✕</button>
            </div>`).join('')}
        </div>
        <button class="btn" id="rcAdd" style="width:100%;margin-top:8px">+ Ingrédient</button>
        <div class="tiles" style="margin-top:10px">
          <div class="tile"><div class="v">${r0(t.kcal)}</div><div class="l">kcal</div></div>
          <div class="tile"><div class="v">${r1(t.prot)}</div><div class="l">g prot</div></div>
          <div class="tile"><div class="v">${r0(t.weight)}</div><div class="l">g au total</div></div>
          ${wMode!=='off' ? `<div class="tile"><div class="v">${r0(wMl)}</div><div class="l">ml d'eau 💧</div></div>` : ''}
        </div>
        ${sansEau.length ? `<div class="small muted" style="margin-top:6px">💧 Sans teneur en eau officielle (comptés 0) :
          ${sansEau.map(i=>esc(i.nom)).join(', ')}</div>` : ''}
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
      const a = askQty(it.nom, it);
      if(!a) return;
      // remplace toutes les infos de quantité (unités / ml / grammes)
      delete it.units; delete it.unitG; delete it.unitOne; delete it.unitMany; delete it.unitLabel; delete it.unitEmo; delete it.ml; delete it.density;
      Object.assign(it, a);
      draw();
    }));
    bg.querySelector('#rcSave').addEventListener('click', ()=>{
      if(!rec.nom.trim()){ alert('Donne un nom au plat.'); return; }
      if(!rec.items.length){ alert('Ajoute au moins un ingrédient.'); return; }
      if(!rec.cat) rec.cat = Store.data.mealCats[0].id;
      rec.updatedAt = nowIso();
      // réécriture par identifiant dans le store VIVANT (et non via la référence gardée)
      const list = Store.data.recipes;
      const i = list.findIndex(r=>r.id===rec.id);
      if(i >= 0) list[i] = rec; else list.push(rec);
      // Le jour AFFICHÉ reflète immédiatement les nouvelles valeurs du plat ;
      // les autres jours (historique) restent figés sur leurs valeurs d'époque.
      const j = Store.data.journal[day];
      if(j && Array.isArray(j.eaten)){
        const t = recipeTotals(rec);
        let touched = false;
        for(const e of j.eaten){
          if(e.type==='recipe' && e.recipeId===rec.id){
            e.nom = rec.nom; e.kcal = t.kcal; e.prot = t.prot; touched = true;
          }
        }
        if(touched) j.updatedAt = nowIso();
      }
      Store.save(); close(); render();
    });
    const del = bg.querySelector('#rcDel');
    if(del) del.addEventListener('click', ()=>{
      if(!confirm(`Supprimer « ${rec.nom} » de ta bibliothèque ?\n(Les jours où tu l'as mangé gardent leurs valeurs.)`)) return;
      const live = Store.data.recipes.find(r=>r.id===rec.id);
      if(live){ live.deleted = true; live.updatedAt = nowIso(); }
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
  const side = document.getElementById('rSide');
  const lib  = document.getElementById('rLib');
  const page = document.getElementById('page-repas');
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
              <div class="sub">${e.count>1?'×'+e.count+' · ':''}${esc(qtyText(e))}</div></div>
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
          <div class="li-row ${n?'sel':''}">
            <div class="grow" data-edit="${rec.id}" title="Modifier">
              <div class="name">${esc(rec.nom)}</div>
              <div class="sub">${r0(t.kcal)} kcal · ${r1(t.prot)} g prot${
                (()=>{ const m=window.Water.mode(); if(m==='off') return '';
                       const ml=r0(waterOfItems(rec.items,m)); return ml>0 ? ' · 💧 '+ml+' ml' : ''; })()
              }</div>
            </div>
            ${n?`<button class="btn" data-minus="${rec.id}" style="min-width:44px;padding:6px" aria-label="Retirer une portion de ${esc(rec.nom)}">−</button>
                 <b style="min-width:26px;text-align:center" aria-label="${n} portion(s)">×${n}</b>`:''}
            <button class="btn ${n?'':'primary'}" data-plus="${rec.id}" style="min-width:48px;padding:6px 10px" aria-label="Ajouter une portion de ${esc(rec.nom)}">＋</button>
          </div>`; }).join('')
        : '<div class="empty" style="padding:14px 4px"><span class="emo">🍳</span>Aucun plat ici — crée le premier ci-dessous.</div>'}
      </div>
      <button class="btn" data-newmeal="${c.id}" style="width:100%;margin-top:8px">+ Nouveau plat</button>
    </div>`;
  }).join('');

  side.innerHTML = gauges + extrasHtml;
  lib.innerHTML = catsHtml + `
    <div style="display:flex;gap:8px">
      <button class="btn ghost" id="rAddCat" style="flex:1">+ Catégorie</button>
      <button class="btn ghost" id="rAddExtra" style="flex:1">🍴 + Extra (aliment ponctuel)</button>
    </div>`;

  /* listeners (sur toute la page : jauges à gauche, bibliothèque à droite) */
  const el = page;
  el.querySelectorAll('[data-plus]').forEach(b=>b.addEventListener('click', ()=>bumpRecipe(b.dataset.plus, +1)));
  el.querySelectorAll('[data-minus]').forEach(b=>b.addEventListener('click', ()=>bumpRecipe(b.dataset.minus, -1)));
  el.querySelectorAll('[data-edit]').forEach(d=>d.addEventListener('click', ()=>editRecipe(d.dataset.edit)));
  el.querySelectorAll('[data-newmeal]').forEach(b=>b.addEventListener('click', ()=>editRecipe(null, b.dataset.newmeal)));
  el.querySelectorAll('[data-delextra]').forEach(b=>b.addEventListener('click', ()=>{
    const jd = ensureDay(day);                       // re-résolu au clic
    const rendu = window.Water.removeAll(day, b.dataset.delextra);
    jd.eaten = jd.eaten.filter(e=>e.id!==b.dataset.delextra);
    touchDay(); render(); window.Water.refresh();
    toast('🗑 Extra retiré' + (rendu>0 ? ' · 💧 −' + rendu + ' ml' : ''));
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
      const mlEau = Math.round(waterOfItem(item, window.Water.mode()));
      ensureDay(day).eaten.push({id:item.id, type:'food', nom:item.nom, qty:item.qty,
        units:item.units, unitLabel:item.unitLabel, unitOne:item.unitOne, unitMany:item.unitMany,
        unitEmo:item.unitEmo, ml:item.ml, eau100:item.eau100, eauMl:mlEau,
        kcal:item.kcal100*item.qty/100, prot:item.prot100*item.qty/100, count:1});
      if(mlEau > 0) window.Water.addFromMeal(day, item.id, mlEau, item.nom, '🥤');
      touchDay(); render(); window.Water.refresh();
      if(mlEau > 0) toast('🍴 ' + esc(item.nom) + ' · 💧 +' + mlEau + ' ml');
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

  document.addEventListener('pageshow', e=>{
    if(e.detail.page!=='repas') return;
    render();                                   // affichage immédiat
    // la teneur en eau des recettes déjà créées vient de la base : re-rendre une
    // fois qu'elle est chargée, sinon la ligne 💧 resterait absente au 1er affichage
    loadCiqual().then(()=>{
      if(document.getElementById('page-repas').classList.contains('active')) render();
    }).catch(()=>{});
  });
  document.addEventListener('storechange', ()=>{ if(document.getElementById('page-repas').classList.contains('active')) render(); });
  render();
  // Au démarrage, app.js a déjà émis 'pageshow' avant que ce listener existe :
  // si Repas est la page ouverte, on précharge la base et on re-rend pour que
  // la teneur en eau des recettes apparaisse sans attendre un changement d'onglet.
  if(document.getElementById('page-repas').classList.contains('active')){
    loadCiqual().then(()=>{
      if(document.getElementById('page-repas').classList.contains('active')) render();
    }).catch(()=>{});
  }
});

})();
