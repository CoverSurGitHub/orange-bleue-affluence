/* ===== Export IA : rapport Markdown à coller dans ChatGPT / Claude / Gemini =====

   Règles structurantes (ne pas les casser en éditant) :

   1. LISTE BLANCHE. On ne lit QUE `Store.data` (= profil actif), champ par champ.
      Jamais `Store.all`, jamais `shared`, jamais un autre profil, jamais le
      prénom du profil : le texte part chez un tiers.
   2. ZÉRO `await` avant le presse-papiers. Le rapport est recalculé à chaque
      changement de réglage (débounce 60 ms) dans la variable REPORT ; le
      handler de clic ne fait que copier. Sinon iOS Safari consomme
      l'activation utilisateur et `writeText` jette NotAllowedError.
   3. Un jour présent dans `journal` avec `eaten: []` n'est PAS un jour saisi :
      `ensureDay()` en fabrique au simple affichage du calendrier. La
      complétude se calcule sur `eaten.length > 0`, jamais sur `k in journal`.
   4. `eaten[].kcal` est la valeur d'UNE portion : tout total se fait
      `e.kcal * e.count`.
   5. Tombstones `deleted:true` filtrées partout (recettes, aliments, eau).
   6. `journal` est la seule source de vérité des apports : on ne recalcule
      JAMAIS le passé depuis `recipes` (les recettes évoluent).
   7. Aucune macro autre que kcal et protéines : glucides et lipides ne sont
      pas suivis, et les reconstruire depuis CIQUAL donnerait un total faux
      (les produits de marque sont absents de la table).                       */
'use strict';
(function(){

const LS_KEY = 'ob.export.v1';

/* ---- capacités : feature-detection uniquement, jamais de sniff User-Agent ---- */
const SECURE    = window.isSecureContext;
const CAN_COPY  = SECURE && !!(navigator.clipboard && navigator.clipboard.writeText);
const CAN_SHARE = !!navigator.share;
const CAN_DL    = 'download' in document.createElement('a');

/* ---- petits utilitaires ---- */
const p2  = n => String(n).padStart(2,'0');
const keyOf = dt => dt.getFullYear() + '-' + p2(dt.getMonth()+1) + '-' + p2(dt.getDate());
const addK  = (k,n) => { const d = keyToDate(k); d.setDate(d.getDate()+n); return keyOf(d); };
const diffJ = (a,b) => Math.round((keyToDate(b) - keyToDate(a)) / 86400000);
const mondayOf = k => { const d = keyToDate(k); d.setDate(d.getDate() - ((d.getDay()+6)%7)); return keyOf(d); };
const r0 = x => Math.round(x);
const f1 = x => (Math.round(x*10)/10).toFixed(1);
const f2 = x => (Math.round(x*100)/100).toFixed(2);
const sgn = x => (x >= 0 ? '+' : '') + r0(x);
const sgn2 = x => (x >= 0 ? '+' : '') + f2(x);
const num = n => n.toLocaleString('fr-FR');
const fmtLong = new Intl.DateTimeFormat('fr-FR', {day:'numeric', month:'long'});
const dayLong = k => fmtLong.format(keyToDate(k));
const dm = k => k.slice(8,10) + '/' + k.slice(5,7);

/* état, mémorisé hors de Store (donc jamais synchronisé dans le coffre public) */
const DEF = {
  preset:'menus', period:30,
  inc:{profil:true, journal:true, plats:true, poids:true, seances:true, recettes:true, eau:true},
  recMode:'eaten', recPick:[], askOn:true, ask:'', constraints:'', lastExport:null
};
let ST = null;
function loadST(){
  ST = JSON.parse(JSON.stringify(DEF));
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(raw){
      const s = JSON.parse(raw);
      if(s && typeof s === 'object'){
        if(typeof s.preset === 'string') ST.preset = s.preset;
        if(s.period === 7 || s.period === 30 || s.period === 90 || s.period === 'all') ST.period = s.period;
        if(s.inc && typeof s.inc === 'object') for(const k in ST.inc) if(typeof s.inc[k] === 'boolean') ST.inc[k] = s.inc[k];
        if(['eaten','all','pick'].indexOf(s.recMode) >= 0) ST.recMode = s.recMode;
        if(Array.isArray(s.recPick)) ST.recPick = s.recPick.filter(x=>typeof x === 'string');
        if(typeof s.askOn === 'boolean') ST.askOn = s.askOn;
        if(typeof s.ask === 'string') ST.ask = s.ask;
        if(typeof s.constraints === 'string') ST.constraints = s.constraints;
        if(typeof s.lastExport === 'string') ST.lastExport = s.lastExport;
      }
    }
  }catch(e){}
  ST.inc.profil = true;                       // toujours inclus, non négociable
}
function saveST(){ try{ localStorage.setItem(LS_KEY, JSON.stringify(ST)); }catch(e){} }

const PRESETS = {
  menus: {emo:'🍽️', nom:'Ajuster mes menus',
          txt:'propose-moi comment atteindre ma cible calorique sans manger trois fois la même chose'},
  point: {emo:'📈', nom:'Faire le point',
          txt:'fais le point sur ma progression et dis-moi si mon rythme est cohérent avec mon objectif'},
  custom:{emo:'⚙️', nom:'Sur mesure', txt:''}
};

/* ============================================================
   1. LECTURE DES DONNÉES (liste blanche, profil actif seulement)
   ============================================================ */

function windowOf(period){
  const to = todayKey();
  if(period !== 'all') return {from: addK(to, -(Number(period)-1)), to};
  const d = Store.data, ks = [];
  const j = d.journal || {};
  for(const k in j) if(j[k] && Array.isArray(j[k].eaten) && j[k].eaten.length) ks.push(k);
  for(const k in (d.weights || {})) ks.push(k);
  const g = d.gym || {};
  for(const k in g) if(g[k] && g[k].go === true) ks.push(k);
  const wl = (d.water && d.water.log) || {};
  for(const k in wl) if(wl[k] && Array.isArray(wl[k].entries) && wl[k].entries.some(e=>!e.deleted)) ks.push(k);
  ks.sort();
  const first = ks.length ? ks[0] : to;
  return {from: first < to ? first : to, to};
}

/* quantité lisible d'un extra (aligné sur qtyText() de repas.js) */
function extraQty(e){
  if(e.unitLabel){
    const lbl = e.units > 1 ? (e.unitMany || e.unitLabel + 's') : (e.unitOne || e.unitLabel);
    return e.units + ' ' + lbl;
  }
  if(e.ml) return r0(e.ml) + ' ml';
  if(typeof e.qty === 'number') return r0(e.qty) + ' g';
  return '';
}

function collect(w){
  const d = Store.data;
  const inW = k => k >= w.from && k <= w.to;

  /* --- journal : jours réellement saisis --- */
  const jours = [], byRecipe = {};
  let ghosts = 0;
  Object.keys(d.journal || {}).filter(inW).sort().forEach(k=>{
    const j = d.journal[k];
    const eaten = (j && Array.isArray(j.eaten)) ? j.eaten : [];
    if(!eaten.length){ ghosts++; return; }
    let kcal = 0, prot = 0, prises = 0;
    const items = [];
    for(const e of eaten){
      const c  = Number(e.count) || 0;
      const ek = Number(e.kcal)  || 0;
      const ep = Number(e.prot)  || 0;
      kcal += ek*c; prot += ep*c; prises += c;
      items.push({nom: e.nom || '(sans nom)', count: c, type: e.type,
                  recipeId: e.recipeId || null, kcal: ek,
                  qty: e.type === 'food' ? extraQty(e) : ''});
      if(e.type === 'recipe' && e.recipeId){
        const b = byRecipe[e.recipeId] || (byRecipe[e.recipeId] = {n:0, hist:[]});
        b.n += c;
        b.hist.push({k, kcal: ek});
      }
    }
    jours.push({k, kcal, prot, prises, items});
  });

  /* --- pesées --- */
  const pesees = Object.keys(d.weights || {}).filter(inW).sort()
    .map(k=>({k, kg: Number(d.weights[k] && d.weights[k].kg)}))
    .filter(p=>Number.isFinite(p.kg));

  /* --- séances : le store contient aussi des {go:false} --- */
  const seances = Object.keys(d.gym || {})
    .filter(k=>inW(k) && d.gym[k] && d.gym[k].go === true).sort();

  /* --- hydratation : tombstones filtrées, entrées repas incluses (comme l'écran Eau) --- */
  const wl = (d.water && d.water.log) || {};
  const eau = [];
  Object.keys(wl).filter(inW).sort().forEach(k=>{
    const ents = (wl[k] && Array.isArray(wl[k].entries) ? wl[k].entries : []).filter(e=>!e.deleted);
    if(!ents.length) return;
    let tot = 0, repas = 0;
    for(const e of ents){
      const ml = Number(e.ml) || 0;
      tot += ml;
      if(e.src === 'meal') repas += ml;
    }
    eau.push({k, tot, repas});
  });

  const recipes = (d.recipes || []).filter(r=>r && !r.deleted);
  const foods   = (d.foods   || []).filter(f=>f && !f.deleted);

  return {w, jours, ghosts, byRecipe, pesees, seances, eau, recipes, foods,
          nbJours: diffJ(w.from, w.to) + 1};
}

/* totaux d'une recette : identique à recipeTotals() de repas.js */
function recTotals(rec){
  let kcal = 0, prot = 0, poids = 0;
  for(const it of (rec.items || [])){
    const q = Number(it.qty) || 0;
    kcal  += (Number(it.kcal100) || 0) * q / 100;
    prot  += (Number(it.prot100) || 0) * q / 100;
    poids += q;
  }
  return {kcal, prot, poids};
}

/* ============================================================
   2. STATISTIQUES
   ============================================================ */

/* régression linéaire des moindres carrés — pas un delta point-à-point */
function pente(pts){
  const n = pts.length;
  if(n < 2) return null;
  const x0 = keyToDate(pts[0].k).getTime();
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for(const p of pts){
    const x = (keyToDate(p.k).getTime() - x0) / 86400000;
    sx += x; sy += p.kg; sxx += x*x; sxy += x*p.kg;
  }
  const den = n*sxx - sx*sx;
  if(!den) return null;
  return (n*sxy - sx*sy) / den;              // kg par jour
}

/* aberrantes : écart > 2 kg ET vitesse > 1,5 kg/semaine face au VOISINAGE.
   La référence est la MÉDIANE des 4 pesées les plus proches dans le temps, pas
   une pesée unique : une seule saisie fausse contaminerait sinon sa voisine
   légitime, qui serait exclue à son tour (faux positif observé en test). */
function median(a){
  const v = a.slice().sort((x,y)=>x-y), n = v.length;
  if(!n) return null;
  return n % 2 ? v[(n-1)/2] : (v[n/2-1] + v[n/2]) / 2;
}
function aberrantes(pts){
  if(pts.length < 3) return [];
  const out = [];
  for(let i=0; i<pts.length; i++){
    const vois = [];
    for(let j=i-2; j<=i+2; j++) if(j >= 0 && j < pts.length && j !== i) vois.push(pts[j]);
    if(vois.length < 2) continue;
    const ref = median(vois.map(v=>v.kg));
    let near = null;
    for(const v of vois){
      const dj = Math.abs(diffJ(v.k, pts[i].k)) || 1;
      if(!near || dj < near.dj) near = {v, dj};
    }
    const dkg = Math.abs(pts[i].kg - ref);
    if(dkg > 2 && dkg / (near.dj/7) > 1.5) out.push({p: pts[i], ref: near.v, dkg, dj: near.dj});
  }
  return out;
}

function gymStats(){
  if(window.Gym && typeof window.Gym.stats === 'function'){
    try{ return window.Gym.stats(); }catch(e){}
  }
  return null;
}

/* ============================================================
   3. GÉNÉRATEUR DE RAPPORT
   ============================================================ */

function consigneText(tg, demande, contraintes){
  const obj = tg ? tg.objectifLabel : 'non défini (profil TDEE incomplet)';
  const L = [];
  L.push('## 0. Consigne');
  L.push('Tu es diététicien-nutritionniste du sport. Analyse le suivi ci-dessous et propose des ajustements concrets.');
  L.push('');
  L.push('Ma demande : ' + (demande || 'analyse ce suivi et dis-moi quoi ajuster.'));
  L.push('');
  L.push('Contraintes de réponse :');
  L.push('- Réponds en français, 400 mots maximum, sans réécrire mes données.');
  L.push('- Objectif = ' + obj + '. Ne propose jamais de déficit calorique ni de protocole restrictif.');
  L.push('- Ne propose de changement QUE sur les recettes et aliments listés en §9, en les désignant par leur nom exact. Tu peux ajouter un ingrédient, mais dis lequel, en grammes, et ce que ça apporte.');
  L.push('- Format imposé pour chaque proposition, une ligne : `Recette (nom exact) — action — +X g de Y — +A kcal / +B g prot`.');
  L.push("- N'invente aucun chiffre absent du rapport. Si une donnée te manque, pose-moi la question au lieu de la supposer.");
  L.push('- Utilise les cibles du §2 telles quelles. Si tu les juges fausses, dis-le et explique pourquoi — ne les remplace pas en silence.');
  L.push("- Priorité de lecture : la tendance de poids prime sur l'écart calorique calculé, parce que mes quantités sont auto-déclarées.");
  L.push("- Tu peux estimer mon maintien réel en croisant l'apport moyen du §4 et la pente de poids du §6, mais alors annonce-le comme une estimation, et rappelle que le coefficient énergétique d'un kilo pris en prise de masse (muscle, glycogène, eau) est bien plus bas que les 7 700 kcal/kg du tissu adipeux, donc que ce calcul sous-estime le maintien.");
  L.push("- Ces chiffres sont auto-déclarés et partiels : signale-moi ce qui relèverait d'un professionnel de santé. Tu n'en es pas un.");
  if(contraintes && contraintes.trim()){
    L.push('');
    L.push('Mes contraintes : ' + contraintes.trim().replace(/\s*\n\s*/g, ' · '));
  }
  return L.join('\n');
}

function secLire(C){
  const L = [];
  L.push('## 1. Comment lire ces données');
  L.push("- Aujourd'hui = " + todayKey() + '. Période analysée : du ' + C.w.from + ' au ' + C.w.to + ', soit ' + C.nbJours + ' jours.');
  L.push("- Un jour absent du tableau §4 n'a PAS été saisi. Ce n'est PAS un jour à 0 kcal : il est exclu de toutes les moyennes.");
  L.push('- Toutes les moyennes portent sur les jours saisis uniquement ; le nombre de jours (n) est écrit à côté de chacune.');
  L.push('- Unités : kcal, g pour les protéines, kg, ml. Dates ISO AAAA-MM-JJ. Semaines du lundi au dimanche. Décimales avec un point.');
  L.push("- Les kcal et protéines d'une journée sont FIGÉES au moment de la saisie ; les fiches recettes du §9 reflètent leur état ACTUEL. Un écart entre les deux est normal (recette modifiée depuis) — ne le signale pas comme une incohérence et ne recalcule pas l'historique.");
  L.push('- Une recette EST une portion telle que je la saisis ; « ×2 » veut dire deux portions.');
  L.push('- Toutes les valeurs sont arrondies : kcal à l’unité, protéines et kg au dixième.');
  return L.join('\n');
}

function secProfil(C, tg){
  const d = Store.data, t = d.tdee;
  const L = ['## 2. Profil et cibles calculées par l’app'];
  if(!tg){
    L.push("- Cibles non calculables (profil TDEE incomplet dans l'app). N'invente pas de cible calorique ni de besoin protéique chiffré : dis-moi simplement ce qu'il manque.");
    return L.join('\n');
  }
  const ACT = (window.TDEE.ACT || []);
  const act = ACT.find(a=>a.f === (t.activite || 1.55)) || null;
  const OBJ = (window.TDEE.OBJ || []);
  const obj = OBJ.find(o=>o.id === t.objectif) || null;
  const kg  = window.TDEE.effectiveWeight(t);
  /* dernière pesée TOUTES périodes confondues : c'est elle que l'app compare au poids manuel */
  const wk = Object.keys(d.weights || {}).sort();
  const last = wk.length ? {k: wk[wk.length-1], kg: Number(d.weights[wk[wk.length-1]].kg)} : null;

  L.push('- Profil : ' + (t.sexe === 'H' ? 'homme' : 'femme') + ', ' + t.age + ' ans, ' + t.taille + ' cm.');
  const goalW = d.settings && d.settings.objectifPoids;
  L.push('- Objectif : ' + tg.objectifLabel + '. ' +
         (goalW ? 'Poids cible : ' + f1(goalW) + ' kg — aucune échéance renseignée (sans date, ne propose pas de surplus agressif).'
                : 'Aucun poids cible renseigné.'));
  let ligneKg = '- Poids utilisé pour les cibles : ' + f1(kg) + ' kg' + (t.poidsManuel ? ' (saisi manuellement)' : ' (dernière pesée)') + '.';
  if(last) ligneKg += ' Dernière pesée : ' + f1(last.kg) + ' kg le ' + last.k + '.';
  if(last && Math.abs(last.kg - kg) > 1) ligneKg += ' ⚠️ la cible est calculée sur un poids qui n’est plus celui des pesées.';
  L.push(ligneKg);
  L.push('- BMR (Mifflin-St Jeor) : ' + r0(tg.bmr) + ' kcal/j · TDEE (×' + (t.activite || 1.55) + ') : ' + r0(tg.tdee) +
         ' kcal/j · CIBLE : ' + r0(tg.kcal) + ' kcal/j (' + tg.objectifLabel + (obj ? ', delta ' + sgn(obj.delta) : '') + ').');
  L.push('- Protéines — fourchette de l’app : ' + r0(tg.protMin) + '–' + r0(tg.protMax) + ' g/j (1.2–2.0 g/kg) ; repère prise de masse : 1.6–2.2 g/kg = ' +
         r0(1.6*kg) + '–' + r0(2.2*kg) + " g/j (la borne basse de l'app, 1.2 g/kg, est une référence de population générale, pas une cible de prise de masse).");

  const g = gymStats();
  if(act && g){
    let l = '- Activité déclarée : ×' + act.f + ' (' + act.desc + ') ; séances réellement enregistrées : ' + f1(g.avg) + '/semaine sur 8 semaines.';
    if(typeof act.min === 'number' && g.avg < act.min) l += ' Ces deux chiffres ne concordent pas : le TDEE ci-dessus est probablement surestimé.';
    L.push(l);
  }
  if(t.pctMG) L.push('- Masse grasse : ' + t.pctMG + ' % — auto-déclaré, non mesuré : ne l’utilise pas pour recalculer un BMR par Katch-McArdle.');
  return L.join('\n');
}

function secFiab(C, tg, trend){
  const L = ['## 3. Fiabilité et angles morts'];
  L.push('- Journal : ' + C.jours.length + ' jour' + (C.jours.length>1?'s':'') + ' saisi' + (C.jours.length>1?'s':'') + ' sur ' + C.nbJours + ' jours de période.');
  if(C.ghosts) L.push('- ' + C.ghosts + ' jour' + (C.ghosts>1?'s':'') + ' simplement ouvert' + (C.ghosts>1?'s':'') + " dans l'app sans rien saisi : ignoré" + (C.ghosts>1?'s':'') + ', absent' + (C.ghosts>1?'s':'') + ' du §4.');
  L.push('- Pesées : ' + C.pesees.length + ' sur la période. Séances : ' + C.seances.length + ' enregistrée' + (C.seances.length>1?'s':'') + '.');
  if(!trend.ok){
    const et = C.pesees.length >= 2 ? diffJ(C.pesees[0].k, C.pesees[C.pesees.length-1].k) : 0;
    L.push('- Tendance de poids non calculable (il faut au moins 8 pesées étalées sur 14 jours ; il y en a ' + C.pesees.length + ' sur ' + et + ' jours). Maintien observé non calculable.');
  }
  L.push("- Non suivis : glucides, lipides, fibres, micronutriments, charges soulevées, tour de taille, sommeil, horaires des repas, conditions de pesée. Le rapport ne contient QUE des kcal et des protéines — n'invente pas de répartition de macronutriments, et ne cite aucun chiffre de glucides ou de lipides.");
  L.push('- Quantités auto-déclarées : sous-estimation habituelle de 10 à 30 %. Ajuste par paliers de +150 à 200 kcal réévalués à 10-14 jours, jamais sur l’écart calculé seul.');
  return L.join('\n');
}

function secJournal(C, tg, refKg, withWeekly){
  if(!C.jours.length) return '';
  const d = Store.data;
  const wById = {};
  for(const p of C.pesees) wById[p.k] = p.kg;
  const gymSet = {};
  for(const k of C.seances) gymSet[k] = true;

  const L = [];
  let jours = C.jours;
  if(withWeekly){
    /* 4bis d'abord : semaine par semaine, puis les 14 derniers jours en détail */
    const sem = {};
    for(const j of C.jours){
      const m = mondayOf(j.k);
      const s = sem[m] || (sem[m] = {n:0, kcal:0, prot:0, kg:0, nkg:0, seances:0});
      s.n++; s.kcal += j.kcal; s.prot += j.prot;
    }
    for(const p of C.pesees){
      const m = mondayOf(p.k);
      if(sem[m]){ sem[m].kg += p.kg; sem[m].nkg++; }
    }
    for(const k of C.seances){ const m = mondayOf(k); if(sem[m]) sem[m].seances++; }
    L.push('## 4bis. Semaine par semaine (semaines du lundi)');
    L.push('');
    L.push('| semaine du | jours saisis | kcal moy | prot g/kg | séances | poids moyen |');
    L.push('|---|---|---|---|---|---|');
    Object.keys(sem).sort().forEach(m=>{
      const s = sem[m];
      L.push('| ' + m + ' | ' + s.n + ' | ' + r0(s.kcal/s.n) + ' | ' + (refKg ? f1((s.prot/s.n)/refKg) : '—') +
             ' | ' + s.seances + ' | ' + (s.nkg ? f1(s.kg/s.nkg) : '—') + ' |');
    });
    L.push('');
    jours = C.jours.slice(-14);
  }

  L.push('## 4. Énergie et protéines, jour par jour');
  if(withWeekly) L.push('_(les ' + jours.length + ' derniers jours saisis ; les précédents sont résumés en §4bis)_');
  L.push('');
  L.push('| date | kcal | prot g | prot g/kg | prises | séance | poids kg |');
  L.push('|---|---|---|---|---|---|---|');
  for(const j of jours){
    L.push('| ' + j.k + ' | ' + r0(j.kcal) + ' | ' + f1(j.prot) + ' | ' + (refKg ? f1(j.prot/refKg) : '—') +
           ' | ' + j.prises + ' | ' + (gymSet[j.k] ? 'oui' : '—') + ' | ' +
           (wById[j.k] !== undefined ? f1(wById[j.k]) : '—') + ' |');
  }
  L.push('');
  if(refKg) L.push('g/kg calculé sur ' + f1(refKg) + ' kg.');

  const n = C.jours.length;
  if(n < 3){
    L.push('Trop peu de jours saisis pour une moyenne (' + n + ') — lis les lignes brutes, ne calcule pas de moyenne.');
    return L.join('\n');
  }
  const sk = C.jours.reduce((s,j)=>s+j.kcal, 0), sp = C.jours.reduce((s,j)=>s+j.prot, 0);
  const spr = C.jours.reduce((s,j)=>s+j.prises, 0);
  const mk = sk/n, mp = sp/n;
  const mins = Math.min.apply(null, C.jours.map(j=>j.kcal));
  const maxs = Math.max.apply(null, C.jours.map(j=>j.kcal));
  let ligne = 'Moyennes sur ' + n + ' jours saisis : ' + r0(mk) + ' kcal/j';
  if(tg) ligne += ' (écart à la cible : ' + sgn(mk - tg.kcal) + ' kcal, soit ' + sgn((mk - tg.kcal)/tg.kcal*100) + ' %)';
  ligne += ' · ' + r0(mp) + ' g de protéines/j';
  if(refKg) ligne += ' = ' + f1(mp/refKg) + ' g/kg';
  ligne += ' · min ' + r0(mins) + ', max ' + r0(maxs) + ' kcal · ' + f1(spr/n) + ' prises/jour';
  if(refKg){
    const pct = C.jours.filter(j=>j.prot/refKg >= 1.6).length / n * 100;
    ligne += ' · ' + r0(pct) + ' % des jours au-dessus de 1.6 g/kg';
  }
  ligne += '.';
  L.push(ligne);

  /* répartition par catégorie de repas */
  const cats = {}, recCat = {};
  for(const r of C.recipes) recCat[r.id] = r.cat || null;
  const catName = {};
  for(const c of (d.mealCats || [])) catName[c.id] = c.nom;
  for(const j of C.jours){
    for(const it of j.items){
      const cid = it.type === 'recipe' && it.recipeId ? recCat[it.recipeId] : null;
      const nom = (cid && catName[cid]) ? catName[cid] : 'hors catégorie';
      cats[nom] = (cats[nom] || 0) + it.kcal * it.count;
    }
  }
  const parts = Object.keys(cats).map(k=>k + ' ' + r0(cats[k]/n) + ' kcal/j');
  if(parts.length) L.push('Répartition moyenne par catégorie : ' + parts.join(' · ') + '.');
  return L.join('\n');
}

function secPlats(C){
  if(!C.jours.length) return '';
  const L = ['## 5. Composition des journées saisies'];
  const MAX = 21;
  const list = C.jours.slice(-MAX);
  if(C.jours.length > MAX) L.push('_(les ' + MAX + ' derniers jours saisis ; les jours plus anciens ne sont pas détaillés)_');
  L.push('');
  for(const j of list){
    const parts = j.items.map(it=>{
      if(it.type === 'food') return it.nom + (it.qty ? ' (' + it.qty + ')' : '') + (it.count > 1 ? ' ×' + it.count : '');
      return it.nom + ' ×' + it.count;
    });
    L.push('- ' + j.k + ' : ' + parts.join(' · '));
  }
  return L.join('\n');
}

function secPoids(C, trend){
  if(!C.pesees.length) return '';
  const L = ['## 6. Poids'];
  L.push('');
  if(C.pesees.length > 45){
    const sem = {};
    for(const p of C.pesees){ const m = mondayOf(p.k); (sem[m] || (sem[m] = [])).push(p.kg); }
    L.push('| semaine du | kg (moyenne) |');
    L.push('|---|---|');
    Object.keys(sem).sort().forEach(m=>L.push('| ' + m + ' | ' + f1(sem[m].reduce((a,b)=>a+b,0)/sem[m].length) + ' |'));
  } else {
    L.push('| date | kg |');
    L.push('|---|---|');
    for(const p of C.pesees) L.push('| ' + p.k + ' | ' + f1(p.kg) + ' |');
  }
  L.push('');
  if(trend.ok){
    const kgSem = trend.slope * 7;
    const moy = trend.pts.reduce((s,p)=>s+p.kg, 0) / trend.pts.length;
    L.push('Tendance par régression linéaire sur ' + trend.pts.length + ' pesées du ' + trend.pts[0].k + ' au ' + trend.pts[trend.pts.length-1].k +
           ' : ' + sgn2(kgSem) + ' kg/semaine, soit ' + sgn2(kgSem/moy*100) + ' % du poids corporel par semaine.');
    L.push('Repère lean bulk : +0.25 à +0.5 % du poids corporel par semaine = ' + sgn2(moy*0.0025) + ' à ' + sgn2(moy*0.005) + ' kg/semaine à ' + f1(moy) + ' kg.');
  } else {
    L.push('Tendance non calculable (moins de 8 pesées, ou étendue inférieure à 14 jours) — pas de pente dans ce rapport, n’en déduis aucune.');
  }
  if(trend.out.length){
    L.push('');
    for(const o of trend.out){
      L.push('⚠️ ' + o.p.k + ' (' + f1(o.p.kg) + ' kg) : ' + f1(o.dkg) + ' kg d’écart en ' + o.dj + ' jour' + (o.dj>1?'s':'') +
             ' avec la pesée voisine du ' + o.ref.k + ' — invraisemblable, probablement une erreur de saisie. Exclue de la tendance, ne la commente pas.');
    }
  }
  L.push('');
  L.push('Les variations d’un jour à l’autre sont de l’eau, du glycogène et du contenu digestif : non interprétables.');
  L.push('Conditions de pesée inconnues (l’app ne les enregistre pas) : ne suppose ni jeûne ni régularité horaire.');
  return L.join('\n');
}

function secSeances(C){
  if(!C.seances.length) return '';
  const g = gymStats();
  const last = C.seances[C.seances.length-1];
  const L = ['## 7. Séances'];
  let l = C.seances.length + ' séance' + (C.seances.length>1?'s':'') + ' sur la période';
  if(g) l += ' · ' + f1(g.avg) + ' par semaine en moyenne sur 8 semaines · série en cours : ' + g.streak + ' semaine' + (g.streak>1?'s':'');
  const dj = diffJ(last, todayKey());
  l += ' · dernière séance le ' + last + (dj === 0 ? " (aujourd'hui)." : dj === 1 ? ' (hier).' : ' (il y a ' + dj + ' jours).');
  L.push(l);
  L.push('Le suivi n’enregistre QUE la présence : ni exercices, ni charges, ni séries, ni durée. Ne prescris rien en supposant un volume d’entraînement, et ne conclus pas qu’une prise de poids est musculaire — sans charges ni tour de taille, personne ne peut le dire.');
  return L.join('\n');
}

function secEau(C){
  if(!C.eau.length) return '';
  const d = Store.data;
  const mode = (d.water && d.water.fromMeals && d.water.fromMeals.mode) || 'drinks';
  const goal = d.water && d.water.goal && d.water.goal.ml;
  const L = ['## 8. Hydratation'];
  L.push('');
  if(C.eau.length > 21){
    const t = C.eau.reduce((s,e)=>s+e.tot, 0) / C.eau.length;
    const r = C.eau.reduce((s,e)=>s+e.repas, 0) / C.eau.length;
    L.push('Moyennes sur ' + C.eau.length + ' jours avec au moins une entrée : ' + r0(t) + ' ml/j dont ' + r0(r) + ' ml venant des repas' +
           (goal ? ' · objectif ' + goal + ' ml/j (' + r0(t/goal*100) + ' % en moyenne).' : ' · aucun objectif défini.'));
  } else {
    L.push('| date | ml bus | dont repas |' + (goal ? ' % objectif |' : ''));
    L.push('|---|---|---|' + (goal ? '---|' : ''));
    for(const e of C.eau) L.push('| ' + e.k + ' | ' + r0(e.tot) + ' | ' + r0(e.repas) + ' |' + (goal ? ' ' + r0(e.tot/goal*100) + ' % |' : ''));
    L.push('');
    L.push(goal ? 'Objectif : ' + goal + ' ml/j.' : 'Aucun objectif d’hydratation défini dans l’app.');
  }
  const sousEstime = ' Un ingrédient sans teneur en eau officielle compte 0 : la colonne « dont repas » n’est pas de l’eau bue volontairement, et elle sous-estime l’eau réellement apportée par l’alimentation.';
  L.push(mode === 'off'
    ? 'Mode « eau des aliments » de l’app : désactivé — l’eau contenue dans les repas n’est pas comptée, la colonne « dont repas » vaut 0.'
    : mode === 'all'
      ? 'Mode « eau des aliments » de l’app : tous les aliments — chaque ingrédient dont la teneur en eau est connue (table CIQUAL 2020, ANSES) est compté.' + sousEstime
      : 'Mode « eau des aliments » de l’app : boissons uniquement — seuls les ingrédients liquides sont comptés.' + sousEstime);
  return L.join('\n');
}

function secRecettes(C, sel){
  const list = C.recipes.filter(r=>sel.indexOf(r.id) >= 0);
  if(!list.length && !C.foods.length) return '';
  const L = ['## 9. Recettes et aliments'];
  for(const r of list){
    const t = recTotals(r);
    const b = C.byRecipe[r.id];
    L.push('');
    L.push('### ' + r.nom + ' — ' + r0(t.kcal) + ' kcal, ' + f1(t.prot) + ' g prot, ' + r0(t.poids) + ' g au total' +
           (b ? ' · mangée ' + b.n + ' fois sur la période' : ' · non consommée sur la période'));
    const ing = (r.items || []).map(it=>it.nom + ' ' + r0(Number(it.qty) || 0) + ' g');
    L.push(ing.length ? ing.join(' · ') : '_(aucun ingrédient saisi)_');
    /* détecteur de dérive : agrégation par recipeId, jamais par nom */
    if(b && b.hist.length && t.kcal > 0){
      const groupes = {};
      for(const h of b.hist){
        const v = r0(h.kcal);
        (groupes[v] || (groupes[v] = [])).push(h.k);
      }
      const ecarts = Object.keys(groupes).map(Number)
        .filter(v=>Math.abs(v - t.kcal) / t.kcal > 0.10)
        .sort((a,b)=>groupes[a][0].localeCompare(groupes[b][0]));    // ordre chronologique, pas numérique
      if(ecarts.length){
        const nd = ecarts.reduce((n,v)=>n + groupes[v].length, 0);
        let txt;
        if(ecarts.length > 3 || nd > 6){       // au-delà, l'énumération noie l'information
          const mn = Math.min.apply(null, ecarts), mx = Math.max.apply(null, ecarts);
          txt = (mn === mx ? 'à ' + mn + ' kcal' : 'entre ' + mn + ' et ' + mx + ' kcal') + ' sur ' + nd + ' jour' + (nd>1?'s':'');
        } else {
          txt = 'à ' + ecarts.map(v=>v + ' kcal le' + (groupes[v].length>1?'s':'') + ' ' + groupes[v].map(dm).join(', ')).join(' · ');
        }
        L.push('⚠️ modifiée depuis : journalisée ' + txt + ' — vaut ' + r0(t.kcal) + ' kcal aujourd’hui. Les totaux du §4 restent justes (valeurs figées à la saisie) ; c’est cette fiche qui a changé.');
      }
    }
  }
  if(C.foods.length){
    L.push('');
    L.push('Aliments saisis à la main (valeurs non sourcées, à traiter avec prudence) : ' +
           C.foods.map(f=>f.nom + ' ' + r0(Number(f.kcal) || 0) + ' kcal/100 g, ' + f1(Number(f.prot) || 0) + ' g prot').join(' · ') + '.');
  }
  L.push('');
  L.push('Ne propose de modification que sur ces noms exacts.');
  return L.join('\n');
}

function secFin(){
  return ['## 10. Ce que j’attends de toi (rappel)',
          '- Rappel du format : une ligne par proposition, `Recette (nom exact) — action — +X g de Y — +A kcal / +B g prot`.',
          '- Avant de conseiller, pose-moi les 3 questions qui te bloquent le plus.',
          '- Si un chiffre te manque, demande-le : ne le suppose pas. Tu n’es pas un professionnel de santé ; signale-moi ce qui relèverait d’un avis médical.'].join('\n');
}

/* « plats » dépend de « journal » : effectif seulement si le parent est coché,
   mais on n'écrase JAMAIS le réglage mémorisé (le retrouver décoché en revenant
   sur « journal » est exactement le genre de perte de réglage qu'on veut éviter) */
function incOK(k){ return k === 'plats' ? (ST.inc.plats && ST.inc.journal) : ST.inc[k]; }

/* sélection effective des recettes */
function selectedRecipes(C){
  if(ST.recMode === 'all') return C.recipes.map(r=>r.id);
  if(ST.recMode === 'pick') return C.recipes.map(r=>r.id).filter(id=>ST.recPick.indexOf(id) >= 0);
  return C.recipes.map(r=>r.id).filter(id=>!!C.byRecipe[id]);
}

/* mesures de taille par section, pour annoter les cases à cocher */
let SIZES = {};

function buildReport(C){
  const tg = (window.TDEE && Store.data.tdee) ? window.TDEE.targets(Store.data.tdee) : null;
  const refKg = tg ? window.TDEE.effectiveWeight(Store.data.tdee)
                   : (C.pesees.length ? C.pesees[C.pesees.length-1].kg : null);

  const out = aberrantes(C.pesees);
  const clean = C.pesees.filter(p=>!out.some(o=>o.p.k === p.k));
  const etendue = clean.length >= 2 ? diffJ(clean[0].k, clean[clean.length-1].k) : 0;
  const slope = (clean.length >= 8 && etendue >= 14) ? pente(clean) : null;
  const trend = {ok: slope !== null, slope, pts: clean, out};

  const demande = ST.askOn ? ST.ask.trim() : '';
  const withWeekly = C.jours.length > 30;

  const parts = {
    journal:  secJournal(C, tg, refKg, withWeekly),
    plats:    secPlats(C),
    poids:    secPoids(C, trend),
    seances:  secSeances(C),
    eau:      secEau(C),
    recettes: secRecettes(C, selectedRecipes(C))
  };
  SIZES = {};
  for(const k in parts) SIZES[k] = parts[k].length;

  const L = [];
  L.push('# Suivi nutrition & poids — rapport pour analyse IA');
  L.push('Généré le ' + todayKey() + ' · app v' + APP_VERSION + ' · période ' + C.w.from + ' → ' + C.w.to);
  L.push('');
  L.push(consigneText(tg, demande, ST.constraints));
  L.push('');
  L.push(secLire(C));
  L.push('');
  L.push(secProfil(C, tg));
  L.push('');
  L.push(secFiab(C, tg, trend));
  for(const k of ['journal','plats','poids','seances','eau','recettes']){
    if(incOK(k) && parts[k]){ L.push(''); L.push(parts[k]); }
  }
  L.push('');
  L.push(secFin());
  L.push('');
  return L.join('\n');
}

/* Filet : une seule recette malformée (items vide, qty absent, vieux profil sans
   water) suffirait sinon à faire lever une exception — rien ne serait copié, aucun
   repli ne s'ouvrirait, aucun message n'apparaîtrait : un bouton mort. */
function safeBuild(C){
  try{
    return buildReport(C);
  }catch(err){
    return ['# Suivi nutrition & poids — rapport pour analyse IA',
            'Généré le ' + todayKey() + ' · app v' + APP_VERSION,
            '',
            '⚠️ Le générateur a rencontré une erreur et n’a pas pu produire le rapport complet.',
            'Message technique : ' + (err && err.message ? err.message : String(err)),
            '',
            'Dis-le moi et repose ta question autrement — ces données sont incomplètes, ne conclus rien.'].join('\n');
  }
}

/* ============================================================
   4. SORTIE (copie / partage / téléchargement)
   ============================================================ */

function legacyCopy(txt){
  const y = window.scrollY;
  const ta = document.createElement('textarea');
  ta.value = txt;
  ta.readOnly = true;
  ta.setAttribute('aria-hidden', 'true');
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;border:0;padding:0;font-size:16px';
  document.body.appendChild(ta);
  let ok = false;
  try{
    ta.focus();
    ta.setSelectionRange(0, ta.value.length);
    ok = document.execCommand('copy');
  }catch(e){ ok = false; }
  ta.remove();
  window.scrollTo(0, y);
  return ok;
}

function download(txt){
  const blob = new Blob([txt], {type:'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'rapport-nutrition-' + todayKey() + '.md';
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 60000);   // révoquer tout de suite annule le téléchargement sur Safari/Firefox
}

function openRaw(txt){
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.style.zIndex = '95';
  bg.innerHTML =
    '<div class="modal" role="dialog" aria-label="Texte brut du rapport">' +
      '<h3>📄 Texte brut</h3>' +
      '<p class="set-note">Appui long dans le cadre → <b>Tout sélectionner</b> → <b>Copier</b>. Sur ordinateur : clic dans le cadre puis Ctrl/⌘ + A, Ctrl/⌘ + C.</p>' +
      '<textarea id="expRawTa" readonly rows="12" style="width:100%;font-size:16px;font-family:ui-monospace,Menlo,Consolas,monospace"></textarea>' +
      '<div class="actions"><button class="btn primary" id="expRawSel">Tout sélectionner</button><button class="btn" id="expRawClose">Fermer</button></div>' +
    '</div>';
  document.body.appendChild(bg);
  const ta = bg.querySelector('#expRawTa');
  ta.value = txt;
  const close = ()=>bg.remove();
  bg.addEventListener('click', e=>{ if(e.target === bg) close(); });
  bg.querySelector('#expRawClose').addEventListener('click', close);
  bg.querySelector('#expRawSel').addEventListener('click', ()=>{
    ta.focus(); ta.setSelectionRange(0, ta.value.length);
  });
}

/* ============================================================
   5. ÉCRAN
   ============================================================ */

let REPORT = '';
let TMR = null;

function ko(n){ return (Math.round(n/1024*10)/10).toString().replace('.', ',') + ' Ko'; }
function qualif(n){
  if(n < 4000)  return 'très court';
  if(n < 12000) return 'court pour une conversation';
  if(n < 25000) return 'taille confortable';
  return 'long, mais accepté par ChatGPT et Claude';
}
function kcar(n){ return '~' + (Math.round(n/100)/10).toString().replace('.', ',') + ' k car.'; }

function open(){
  loadST();
  let askEdited = false;

  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML =
  '<div class="modal wide" role="dialog" aria-label="Exporter pour une IA">' +
    '<h3>🤖 Exporter pour une IA</h3>' +
    '<div class="small muted" style="margin:-8px 0 12px" id="expLast"></div>' +

    '<div class="exp-grid">' +
    '<div class="exp-left">' +

      '<div class="set-group">' +
        '<h2>📅 Période</h2>' +
        '<span class="seg" id="expPeriod" role="group" aria-label="Période">' +
          '<button class="seg-btn" data-p="7">7 j</button>' +
          '<button class="seg-btn" data-p="30">30 j</button>' +
          '<button class="seg-btn" data-p="90">90 j</button>' +
          '<button class="seg-btn" data-p="all">Tout</button>' +
        '</span>' +
        '<div class="small muted" id="expWin" style="margin-top:8px"></div>' +
      '</div>' +

      '<div class="set-group">' +
        '<h2>🎯 Ce que je veux demander</h2>' +
        '<div class="thm-grid" id="expPresets">' +
          '<button class="thm-card" data-pr="menus"><span class="thm-name">🍽️ Ajuster mes menus</span></button>' +
          '<button class="thm-card" data-pr="point"><span class="thm-name">📈 Faire le point</span></button>' +
          '<button class="thm-card" data-pr="custom" style="grid-column:1/-1"><span class="thm-name">⚙️ Sur mesure</span></button>' +
        '</div>' +
      '</div>' +

      '<div class="set-group">' +
        '<h2><button class="expfold" id="expFold" aria-expanded="false">📦 Contenu <span id="expFoldLbl"></span> <span class="car">▾</span></button></h2>' +
        '<div id="expInc" style="display:none"></div>' +
        '<p class="set-note" style="margin:8px 0 0">L’affluence de la salle n’entre pas dans ce rapport : elle n’a pas de valeur nutritionnelle et pèse plus lourd que tout le reste.</p>' +
      '</div>' +

      '<div class="set-group">' +
        '<h2>💬 Ma demande</h2>' +
        '<label class="li-row" style="cursor:pointer;margin-bottom:8px">' +
          '<input type="checkbox" id="expAskOn" style="min-height:0;width:20px;height:20px">' +
          '<div class="grow"><div class="name">Inclure ma demande</div>' +
          '<div class="sub">le texte que l’IA lira en premier</div></div>' +
        '</label>' +
        '<textarea id="expAsk" rows="3" style="width:100%;font-size:16px" aria-label="Ma demande"></textarea>' +
        '<div id="expChips" style="margin:8px 0 0"></div>' +
        '<div class="field" style="margin-top:10px">' +
          '<label for="expCons">📝 Mes contraintes (allergies, budget, temps de cuisine…)</label>' +
          '<textarea id="expCons" rows="2" style="width:100%;font-size:16px" placeholder="ex : pas de poisson, 20 min de cuisine max, budget serré"></textarea>' +
        '</div>' +
      '</div>' +

    '</div>' +
    '<div class="exp-right">' +
      '<div class="set-group">' +
        '<h2>👁 Aperçu</h2>' +
        '<div class="small muted" id="expSize" style="margin-bottom:8px"></div>' +
        '<div class="exp-prewrap" id="expPreWrap"><pre class="exp-pre" id="expPre" tabindex="0"></pre></div>' +
        '<button class="btn" id="expMore" style="width:100%;margin-top:8px">Voir tout</button>' +
      '</div>' +
    '</div>' +
    '</div>' +

    '<div class="exp-bar' + (CAN_SHARE ? ' has-share' : '') + '">' +
      '<div class="small muted" id="expPriv" style="margin-bottom:8px"></div>' +
      '<button class="btn primary big" id="expCopy">📋 Copier le rapport</button>' +
      '<div style="display:flex;gap:8px;margin-top:8px">' +
        (CAN_SHARE ? '<button class="btn" id="expShare" style="flex:1">📤 Partager</button>' : '') +
        (CAN_DL ? '<button class="btn" id="expDl" style="flex:1">⬇️ Télécharger .md</button>' : '') +
        '<button class="btn" id="expClose" style="flex:1">Fermer</button>' +
      '</div>' +
      '<div style="text-align:center;margin-top:8px">' +
        '<button class="linkbtn small muted" id="expRaw">voir le texte brut</button>' +
      '</div>' +
    '</div>' +
  '</div>';

  document.body.appendChild(bg);

  const $ = s => bg.querySelector(s);
  const close = ()=>{
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', fitPreview);
    bg.remove();
  };
  const onKey = e => { if(e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  bg.addEventListener('click', e=>{ if(e.target === bg) close(); });
  $('#expClose').addEventListener('click', close);

  /* ---- rendu des contrôles ---- */
  function paintPeriod(){
    bg.querySelectorAll('#expPeriod .seg-btn').forEach(b=>{
      b.classList.toggle('active', String(ST.period) === b.dataset.p);
    });
  }
  function paintPresets(){
    bg.querySelectorAll('#expPresets .thm-card').forEach(b=>{
      b.classList.toggle('on', ST.preset === b.dataset.pr);
    });
  }

  const LBL = {
    journal:  ['🍽️', 'Repas jour par jour'],
    plats:    ['↳',  'Composition de chaque journée'],
    poids:    ['⚖️', 'Pesées'],
    seances:  ['💪', 'Séances'],
    recettes: ['📖', 'Recettes (fiches + ingrédients)'],
    eau:      ['💧', 'Hydratation']
  };

  function paintInc(C){
    const dispo = {
      journal:  C.jours.length,
      plats:    C.jours.length,
      poids:    C.pesees.length,
      seances:  C.seances.length,
      recettes: C.recipes.length,
      eau:      C.eau.length
    };
    const sub = {
      journal:  C.jours.length + ' jour' + (C.jours.length>1?'s':'') + ' saisi' + (C.jours.length>1?'s':''),
      plats:    'jusqu’à 21 jours détaillés',
      poids:    C.pesees.length + ' pesée' + (C.pesees.length>1?'s':''),
      seances:  C.seances.length + ' séance' + (C.seances.length>1?'s':''),
      recettes: C.recipes.length + ' recette' + (C.recipes.length>1?'s':''),
      eau:      C.eau.length + ' jour' + (C.eau.length>1?'s':'') + ' avec entrée'
    };
    const notes = {};
    let h = '<label class="li-row" style="opacity:.75">' +
      '<input type="checkbox" checked disabled style="min-height:0;width:20px;height:20px">' +
      '<div class="grow"><div class="name">👤 Profil &amp; cibles (TDEE)</div>' +
      '<div class="sub">toujours inclus — sans les cibles de l’app, l’IA en invente d’autres</div></div></label>';
    for(const k of ['journal','plats','poids','seances','recettes','eau']){
      const off = !dispo[k] || (k === 'plats' && !ST.inc.journal);
      const note = !dispo[k] ? 'aucune donnée sur la période'
                 : (off ? 'décoche « Repas jour par jour » pour l’activer'
                        : sub[k] + ' · ' + kcar(SIZES[k] || 0));
      notes[k] = note;
      h += '<label class="li-row" style="cursor:pointer' + (off ? ';opacity:.5' : '') + '">' +
           '<input type="checkbox" data-inc="' + k + '" style="min-height:0;width:20px;height:20px"' +
           (ST.inc[k] && dispo[k] ? ' checked' : '') + (off ? ' disabled' : '') + '>' +
           '<div class="grow"><div class="name">' + LBL[k][0] + ' ' + LBL[k][1] + '</div>' +
           '<div class="sub" data-note="' + k + '">' + note + '</div></div></label>';
      if(k === 'recettes' && dispo.recettes && ST.inc.recettes){
        const nEat = C.recipes.filter(r=>!!C.byRecipe[r.id]).length;
        h += '<div style="margin:2px 0 8px 30px">' +
             '<span class="seg" id="expRecMode">' +
             '<button class="seg-btn' + (ST.recMode==='eaten'?' active':'') + '" data-rm="eaten">Mangées (' + nEat + ')</button>' +
             '<button class="seg-btn' + (ST.recMode==='all'?' active':'') + '" data-rm="all">Toutes (' + C.recipes.length + ')</button>' +
             '<button class="seg-btn' + (ST.recMode==='pick'?' active':'') + '" data-rm="pick">Je choisis</button>' +
             '</span>';
        if(ST.recMode === 'pick'){
          h += '<div style="margin-top:8px">';
          for(const r of C.recipes){
            const t = recTotals(r);
            h += '<label class="li-row" style="cursor:pointer">' +
                 '<input type="checkbox" data-rec="' + esc(r.id) + '" style="min-height:0;width:20px;height:20px"' +
                 (ST.recPick.indexOf(r.id) >= 0 ? ' checked' : '') + '>' +
                 '<div class="grow"><div class="name">' + esc(r.nom) + '</div>' +
                 '<div class="sub">' + r0(t.kcal) + ' kcal · ' + f1(t.prot) + ' g prot' +
                 (C.byRecipe[r.id] ? ' · mangée ' + C.byRecipe[r.id].n + '×' : '') + '</div></div></label>';
          }
          h += '</div>';
        }
        h += '</div>';
      }
    }
    const sig = JSON.stringify([ST.period, ST.inc, ST.recMode, ST.recPick, C.recipes.map(r=>r.id), dispo]);
    if(sig !== incSig){
      incSig = sig;
      $('#expInc').innerHTML = h;
    } else {
      for(const k in notes){
        const el = $('#expInc [data-note="' + k + '"]');
        if(el) el.textContent = notes[k];
      }
    }
    const n = ['journal','plats','poids','seances','recettes','eau'].filter(k=>incOK(k) && dispo[k]).length + 1;
    $('#expFoldLbl').textContent = '— ' + n + ' élément' + (n>1?'s':'') + ' sur 7 inclus';
  }

  function paintChips(){
    const chips = ['Propose 3 menus', 'Est-ce que je mange assez de protéines ?', 'Que changer pour tenir ma cible ?'];
    $('#expChips').innerHTML = chips.map(c=>'<button class="chip" data-chip="' + esc(c) + '">+ ' + esc(c) + '</button>').join(' ');
  }

  /* ---- recalcul ---- */
  function recompute(){
    TMR = null;
    const C = collect(windowOf(ST.period));
    REPORT = safeBuild(C);
    $('#expPre').textContent = REPORT;
    $('#expSize').textContent = '≈ ' + num(REPORT.length) + ' caractères · ' + qualif(REPORT.length);
    $('#expWin').textContent = 'du ' + dayLong(C.w.from) + ' au ' + dayLong(C.w.to) + ' · ' +
      C.jours.length + ' jour' + (C.jours.length>1?'s':'') + ' de repas saisi' + (C.jours.length>1?'s':'') + ' · ' +
      C.pesees.length + ' pesée' + (C.pesees.length>1?'s':'') + ' · ' +
      C.seances.length + ' séance' + (C.seances.length>1?'s':'');
    paintInc(C);
    paintPeriod();
    paintPresets();
    fitPreview();
    saveST();
  }
  /* colonne d'aperçu (≥1024 px) : hauteur ajustée à la barre d'action réelle */
  function fitPreview(){
    const right = $('.exp-right');
    if(getComputedStyle(right).position !== 'sticky'){ right.style.maxHeight = ''; return; }
    const modal = bg.querySelector('.modal');
    // la colonne démarre sous le titre tant qu'elle n'est pas épinglée : sans ce
    // décalage, son bas passe sous la barre d'action quand la modale n'est pas défilée
    const haut = right.getBoundingClientRect().top - modal.getBoundingClientRect().top - modal.scrollTop;
    right.style.maxHeight = Math.max(220, modal.clientHeight - $('.exp-bar').offsetHeight - haut - 28) + 'px';
  }
  window.addEventListener('resize', fitPreview);

  function schedule(){ if(TMR) clearTimeout(TMR); TMR = setTimeout(recompute, 60); }
  function flush(){ if(TMR){ clearTimeout(TMR); recompute(); } }

  /* ---- écouteurs ---- */
  $('#expPeriod').addEventListener('click', e=>{
    const b = e.target.closest('.seg-btn'); if(!b) return;
    ST.period = b.dataset.p === 'all' ? 'all' : Number(b.dataset.p);
    paintPeriod(); schedule();
  });

  let foldOpen = false;
  let incSig = '';
  $('#expPresets').addEventListener('click', e=>{
    const b = e.target.closest('.thm-card'); if(!b) return;
    ST.preset = b.dataset.pr;
    const p = PRESETS[ST.preset];
    if(p && !askEdited){ ST.ask = p.txt; $('#expAsk').value = p.txt; }
    if(ST.preset === 'custom'){ foldOpen = true; $('#expInc').style.display = ''; $('#expFold').setAttribute('aria-expanded','true'); }
    paintPresets(); schedule();
  });

  $('#expFold').addEventListener('click', ()=>{
    foldOpen = !foldOpen;
    $('#expInc').style.display = foldOpen ? '' : 'none';
    $('#expFold').setAttribute('aria-expanded', String(foldOpen));
  });

  $('#expInc').addEventListener('change', e=>{
    const t = e.target;
    if(t.dataset && t.dataset.inc){
      ST.inc[t.dataset.inc] = t.checked;
      /* toucher une case bascule sur « Sur mesure » SANS réinitialiser les autres réglages */
      if(ST.preset !== 'custom'){ ST.preset = 'custom'; paintPresets(); }
      schedule();
    } else if(t.dataset && t.dataset.rec){
      const id = t.dataset.rec;
      const i = ST.recPick.indexOf(id);
      if(t.checked && i < 0) ST.recPick.push(id);
      if(!t.checked && i >= 0) ST.recPick.splice(i, 1);
      schedule();
    }
  });
  $('#expInc').addEventListener('click', e=>{
    const b = e.target.closest('[data-rm]'); if(!b) return;
    if(ST.recMode !== 'pick' && b.dataset.rm === 'pick' && !ST.recPick.length){
      const C = collect(windowOf(ST.period));
      ST.recPick = C.recipes.filter(r=>!!C.byRecipe[r.id]).map(r=>r.id);   // pré-coché sur « mangées »
    }
    ST.recMode = b.dataset.rm;
    schedule();
  });

  $('#expAskOn').checked = ST.askOn;
  $('#expAskOn').addEventListener('change', e=>{ ST.askOn = e.target.checked; schedule(); });
  $('#expAsk').value = ST.ask || (PRESETS[ST.preset] ? PRESETS[ST.preset].txt : '');
  ST.ask = $('#expAsk').value;
  $('#expAsk').addEventListener('input', e=>{ ST.ask = e.target.value; askEdited = true; schedule(); });
  $('#expCons').value = ST.constraints;
  $('#expCons').addEventListener('input', e=>{ ST.constraints = e.target.value; schedule(); });
  paintChips();
  $('#expChips').addEventListener('click', e=>{
    const b = e.target.closest('[data-chip]'); if(!b) return;
    const cur = $('#expAsk').value.trim();
    const add = b.dataset.chip;
    $('#expAsk').value = cur ? cur.replace(/[.\s]*$/, '') + '. ' + add : add;
    ST.ask = $('#expAsk').value; askEdited = true; ST.askOn = true; $('#expAskOn').checked = true;
    schedule();
  });

  $('#expMore').addEventListener('click', ()=>{
    const w = $('#expPreWrap'), p = $('#expPre');
    const open = w.classList.toggle('open');
    p.classList.toggle('full', open);
    $('#expMore').textContent = open ? 'Replier' : 'Voir tout';
  });

  /* ---- sortie ---- */
  function markExported(){ ST.lastExport = todayKey(); saveST(); paintLast(); }
  function paintLast(){
    $('#expLast').textContent = ST.lastExport
      ? 'Profil actif : ' + Store.active.nom + ' · dernier rapport le ' + dayLong(ST.lastExport)
      : 'Profil actif : ' + Store.active.nom + ' · à coller dans ChatGPT, Claude ou Gemini';
    $('#expPriv').textContent = ST.lastExport ? ''
      : 'Ce texte contient tes données de poids et d’alimentation — il part sur le service que tu choisis.';
  }

  $('#expCopy').addEventListener('click', ()=>{
    flush();                                   // synchrone : l'activation utilisateur est conservée
    const btn = $('#expCopy'), txt = REPORT;
    const ok = ()=>{
      btn.textContent = '✓ Copié';
      setTimeout(()=>{ btn.textContent = '📋 Copier le rapport'; }, 2000);
      toast('📋 Rapport copié (' + ko(txt.length) + ') — colle-le dans ChatGPT');
      markExported();
    };
    if(CAN_COPY){
      navigator.clipboard.writeText(txt).then(ok, ()=>openRaw(txt));
    } else if(legacyCopy(txt)){
      ok();
    } else {
      openRaw(txt);
    }
  });

  if(CAN_SHARE) $('#expShare').addEventListener('click', ()=>{
    flush();
    const b = $('#expShare'), txt = REPORT;
    b.disabled = true;
    navigator.share({text: txt})
      .then(markExported)
      .catch(e=>{ if(e && e.name !== 'AbortError') openRaw(txt); })
      .then(()=>{ b.disabled = false; }, ()=>{ b.disabled = false; });
  });

  if(CAN_DL) $('#expDl').addEventListener('click', ()=>{
    flush();
    download(REPORT);
    toast('⬇️ rapport-nutrition-' + todayKey() + '.md (' + ko(REPORT.length) + ')');
    markExported();
  });

  $('#expRaw').addEventListener('click', ()=>{ flush(); openRaw(REPORT); });

  paintLast();
  recompute();
}

window.ExportIA = {open};

})();
