/* ===== Section TDEE : besoins énergétiques =====

   Toutes les valeurs viennent d'organismes officiels ou de la littérature
   scientifique de référence (voir la note de sources affichée sous les résultats).

   1. MÉTABOLISME DE BASE : équations de Henry (2005), dites « Oxford », avec poids
      ET taille. Retenues par le SACN (Royaume-Uni, 2011) puis par l'EFSA (Union
      européenne, 2013) parce qu'elles prédisent le mieux le métabolisme mesuré.
      Coefficients : SACN 2011, tableau 18. Mifflin-St Jeor reste affichée en
      comparaison (référence de l'Academy of Nutrition and Dietetics).

   2. NIVEAU D'ACTIVITÉ (PAL) : échelle de l'EFSA 2013, 1,4 / 1,6 / 1,8 / 2,0.
      L'ancienne échelle de l'app (1,2 à 1,9) venait des manuels de musculation :
      1,2 y voulait dire « sédentaire », alors que l'EFSA rappelle que 1,17 à 1,27
      sont les valeurs de personnes en fauteuil, sans marcher, mesurées en
      chambre calorimétrique. Le plancher d'une vie ordinaire est 1,35 à 1,4.

   3. OBJECTIF : en pourcentage du maintien, plus un montant fixe.
      Perte : HAS 2011, baisse de 15 à 30 % des apports, jamais sous 1 200 kcal/j
      (en dessous : risque de dénutrition et de carences).
      Prise : Iraki et al. 2019, +5 à +20 % selon le niveau, pour viser +0,25 à
      +0,5 % du poids par semaine.

   4. POIDS : la dernière pesée fait foi. Un poids tapé à la main ne sert plus que
      si aucune pesée n'existe : avant, il restait figé indéfiniment et pouvait
      calculer la cible sur un poids vieux de plusieurs semaines.            */
'use strict';
(function(){

const MJ_EN_KCAL = 239.0057;        // 1 kcal = 4,184 kJ
const PLANCHER   = 1200;            // HAS 2011 : seuil des régimes « hypocaloriques équilibrés »
const KCAL_PAR_KG_GRAS = 7700;      // ordre de grandeur classique pour une perte (tissu adipeux)

/* Henry 2005, poids (kg) + taille (m), résultat en MJ/j — SACN 2011, tableau 18 */
const HENRY = {
  H: [ {max:18,  w:0.0651, h:1.11, c: 1.25 },
       {max:30,  w:0.0600, h:1.31, c: 0.473},
       {max:60,  w:0.0476, h:2.26, c:-0.574},
       {max:999, w:0.0478, h:2.26, c:-1.070} ],
  F: [ {max:18,  w:0.0393, h:1.04, c: 1.93 },
       {max:30,  w:0.0433, h:2.57, c:-1.180},
       {max:60,  w:0.0342, h:2.10, c:-0.0486},
       {max:999, w:0.0356, h:1.76, c: 0.0448} ]
};

/* Échelle EFSA 2013. `min` = séances de sport par semaine en dessous desquelles le
   niveau déclaré devient douteux ; utilisé uniquement par l'export IA. */
const ACT = [
  {f:1.4, label:'Peu actif',        min:0,
   desc:'études ou travail assis, peu de marche, pas de sport régulier'},
  {f:1.6, label:'Modérément actif', min:0,
   desc:'assis la journée, mais 3 à 4 séances de sport par semaine ou une bonne marche chaque jour'},
  {f:1.8, label:'Actif',            min:4,
   desc:'debout une bonne partie de la journée, ou sport presque tous les jours'},
  {f:2.0, label:'Très actif',       min:6,
   desc:'métier physique, ou entraînement intense tous les jours'}
];
/* anciennes valeurs (échelle des manuels de musculation) → niveau EFSA le plus proche */
const ACT_ANCIEN = {1.2:1.4, 1.375:1.6, 1.55:1.6, 1.725:1.8, 1.9:2.0};

const OBJ = [
  {id:'maintien', label:'Maintien',       pct:0},
  {id:'perteL',   label:'Perte douce',    pct:-15},
  {id:'perte',    label:'Perte',          pct:-25},
  {id:'priseL',   label:'Prise lente',    pct:5},
  {id:'prise',    label:'Prise de masse', pct:10}
];

function bmrHenry(sexe, kg, cm, age){
  const bande = HENRY[sexe === 'F' ? 'F' : 'H'].find(b => age < b.max);
  return (bande.w * kg + bande.h * cm / 100 + bande.c) * MJ_EN_KCAL;
}
function bmrMSJ(sexe, kg, cm, age){ return 10*kg + 6.25*cm - 5*age + (sexe==='H' ? 5 : -161); }
function bmrKM(kg, pctMG){ return 370 + 21.6 * (kg * (1 - pctMG/100)); }

function derniereKey(){
  const keys = Object.keys(Store.data.weights || {}).sort();
  return keys.length ? keys[keys.length-1] : null;
}
function lastWeight(){
  const k = derniereKey();
  return k ? Store.data.weights[k].kg : null;
}
/* La pesée la plus récente gagne toujours ; le poids saisi à la main ne sert
   qu'à un profil qui n'a encore aucune pesée. */
function effectiveWeight(t){ return lastWeight() || (t && t.poidsManuel) || null; }
function weightInfo(t){
  const k = derniereKey();
  if(k) return {kg: Store.data.weights[k].kg, source:'pesee', date:k};
  if(t && t.poidsManuel) return {kg: t.poidsManuel, source:'manuel', date:null};
  return null;
}

function palOf(t){
  const v = t && t.activite;
  if(ACT.some(a => a.f === v)) return {f:v, ancien:false};
  if(ACT_ANCIEN[v] !== undefined) return {f:ACT_ANCIEN[v], ancien:true};
  return {f:1.6, ancien:false};
}
function objOf(t){ return OBJ.find(o => o.id === (t && t.objectif)) || OBJ[0]; }

/* cibles exposées à la section Repas et à l'export IA */
window.TDEE = {
  targets(t){
    const kg = effectiveWeight(t);
    if(!t || !kg || !t.taille || !t.age || !t.sexe) return null;
    const bmr = bmrHenry(t.sexe, kg, t.taille, t.age);
    const pal = palOf(t);
    // EFSA 2013 : +1 % du PAL pour couvrir la croissance avant 18 ans
    const tdee = bmr * pal.f * (t.age < 18 ? 1.01 : 1);
    const obj = objOf(t);
    let kcal = tdee * (1 + obj.pct/100);
    let plancher = false;
    if(obj.pct < 0){
      const mini = Math.min(PLANCHER, tdee);   // ne jamais « perdre » au-dessus du maintien
      if(kcal < mini){ kcal = mini; plancher = true; }
    }
    return {
      kcal, tdee, bmr,
      bmrMSJ: bmrMSJ(t.sexe, kg, t.taille, t.age),
      pal: pal.f, palAncien: pal.ancien,
      ecart: kcal - tdee, pct: obj.pct, plancher,
      kg,
      protMin: 1.2*kg, protMax: 2.0*kg,      // fourchette sportive (AND/DC/ACSM 2016)
      protRNP: 0.83*kg,                      // ANSES / EFSA, population générale
      objectifLabel: obj.label.toLowerCase()
    };
  },
  /* exposés en lecture seule pour l'export IA (assets/export.js) */
  ACT, OBJ, effectiveWeight, lastWeight, weightInfo, palOf
};

const fmtCourt = new Intl.DateTimeFormat('fr-FR', {day:'numeric', month:'short'});
const r0 = x => Math.round(x);
const r1fr = x => (Math.round(x*10)/10).toLocaleString('fr-FR');
const r2fr = x => (Math.round(x*100)/100).toLocaleString('fr-FR');

function render(){
  const t = Store.data.tdee || {};
  const wi = weightInfo(t);
  const pal = palOf(t);
  const el = document.getElementById('tForm');
  const champPoids = (wi && wi.source === 'pesee')
    ? `<div class="field"><label>Poids</label>
         <div style="padding:10px 0 4px"><b>${r1fr(wi.kg)} kg</b>
         <span class="small muted">· pesée du ${esc(fmtCourt.format(keyToDate(wi.date)))}</span></div>
         <div class="small muted">Suit automatiquement ta dernière pesée (⚖️ Poids).</div></div>`
    : `<div class="field"><label>Poids (kg)</label>
         <input type="number" id="tPoids" inputmode="decimal" step="0.1" min="30" max="300" value="${t.poidsManuel||''}" placeholder="75"></div>`;
  el.innerHTML = `
    <div class="fieldrow">
      <div class="field"><label for="tSexe">Sexe</label>
        <select id="tSexe"><option value="H" ${t.sexe!=='F'?'selected':''}>Homme</option><option value="F" ${t.sexe==='F'?'selected':''}>Femme</option></select></div>
      <div class="field"><label for="tAge">Âge (ans)</label>
        <input type="number" id="tAge" inputmode="numeric" min="15" max="100" value="${t.age||''}" placeholder="25"></div>
    </div>
    <div class="fieldrow">
      <div class="field"><label for="tTaille">Taille (cm)</label>
        <input type="number" id="tTaille" inputmode="numeric" min="120" max="230" value="${t.taille||''}" placeholder="178"></div>
      ${champPoids}
    </div>
    <div class="field"><label for="tAct">Niveau d'activité</label>
      <select id="tAct">${ACT.map(a=>`<option value="${a.f}" ${pal.f===a.f?'selected':''}>${a.label} (${String(a.f).replace('.',',')})</option>`).join('')}</select>
      <div class="small muted" id="tActDesc" style="margin-top:6px"></div></div>
    <div class="field"><label for="tObj">Objectif</label>
        <select id="tObj">${OBJ.map(o=>`<option value="${o.id}" ${objOf(t).id===o.id?'selected':''}>${o.label}${o.pct?` (${o.pct>0?'+':'−'}${Math.abs(o.pct)} %)`:''}</option>`).join('')}</select></div>
    <div class="field"><label for="tMG">% masse grasse <span class="muted">(optionnel, seulement pour la comparaison)</span></label>
      <input type="number" id="tMG" inputmode="decimal" step="0.5" min="3" max="60" value="${t.pctMG||''}" placeholder="15"></div>
    <button class="btn primary" id="tCalc" style="width:100%">Calculer</button>`;

  const actSel = document.getElementById('tAct');
  const majDesc = ()=>{
    const a = ACT.find(x => x.f === parseFloat(actSel.value));
    document.getElementById('tActDesc').textContent = a ? a.desc : '';
  };
  actSel.addEventListener('change', majDesc);
  majDesc();

  document.getElementById('tCalc').addEventListener('click', ()=>{
    const read = id => { const e = document.getElementById(id); return e ? parseFloat(String(e.value).replace(',','.')) : NaN; };
    const sexe = document.getElementById('tSexe').value;
    const age = read('tAge'), taille = read('tTaille');
    const pese = lastWeight();
    const poids = pese || read('tPoids');
    const activite = parseFloat(actSel.value);
    const objectif = document.getElementById('tObj').value;
    const pctMG = read('tMG');
    if(!Number.isFinite(age)||!Number.isFinite(taille)||!Number.isFinite(poids)){ alert('Remplis âge, taille et poids.'); return; }
    Store.data.tdee = {
      sexe, age, taille, activite, objectif,
      poidsManuel: pese ? null : poids,
      pctMG: Number.isFinite(pctMG) ? pctMG : null,
      updatedAt: nowIso()
    };
    Store.save();
    render();
    toast('🔥 Besoins recalculés — cible reliée aux jauges Repas');
  });
  renderResults();
}

function renderResults(){
  const t = Store.data.tdee;
  const out = document.getElementById('tRes');
  const hint = '<div class="card"><div class="empty"><span class="emo">🔥</span><b>Pas encore de calcul.</b><br>' +
               'Remplis le formulaire puis appuie sur Calculer — la cible kcal alimente les jauges de la section Repas.</div></div>';
  if(!t){ out.innerHTML = hint; return; }
  const tg = window.TDEE.targets(t);
  if(!tg){ out.innerHTML = hint; return; }
  const kg = tg.kg;
  const km = t.pctMG ? bmrKM(kg, t.pctMG) : null;
  const imc = kg / Math.pow(t.taille/100, 2);
  const enPerte = tg.pct < 0, enPrise = tg.pct > 0;

  const alertes = [];
  if(tg.palAncien) alertes.push('ℹ️ Le niveau d\'activité suit maintenant l\'échelle officielle de l\'EFSA. Ton ancien choix a été converti : vérifie qu\'il te correspond, puis appuie sur Calculer.');
  if(tg.plancher) alertes.push('⚠️ Cible relevée à ' + r0(tg.kcal) + ' kcal/j : sous 1 200 kcal/j, la HAS signale un risque de dénutrition et de carences. Aller plus vite demande un suivi médical.');
  if(enPerte && imc < 18.5) alertes.push('⚠️ Ton IMC (' + r1fr(imc) + ') est déjà sous 18,5 : une perte de poids n\'est pas recommandée sans avis médical.');
  if(tg.kcal < tg.bmr) alertes.push('⚠️ Cible sous ton métabolisme de base : à éviter sans suivi médical.');

  let rythme = '';
  if(enPerte){
    const kgMois = -tg.ecart * 30 / KCAL_PAR_KG_GRAS;
    rythme = 'Rythme attendu : environ <b>' + r1fr(kgMois) + ' kg par mois</b> (' + r0(-tg.ecart) + ' kcal de moins par jour). La HAS juge réaliste 1 à 2 kg par mois.';
  } else if(enPrise){
    rythme = 'Repère de prise : <b>+' + r2fr(kg*0.0025) + ' à +' + r2fr(kg*0.005) + ' kg par semaine</b> (0,25 à 0,5 % du poids). '
           + 'Plus rapide, c\'est surtout du gras : baisse alors d\'un cran. Plus lent sur 2 à 3 semaines, monte d\'un cran.';
  } else {
    rythme = 'Au maintien, ton poids moyen sur 2 à 3 semaines doit rester stable. S\'il bouge, ajuste le niveau d\'activité.';
  }

  out.innerHTML = `
    <div class="tiles">
      <div class="tile"><div class="v">${r0(tg.bmr)}</div><div class="l">métabolisme de base (kcal/j)</div></div>
      <div class="tile"><div class="v">${r0(tg.tdee)}</div><div class="l">maintien · PAL ${String(tg.pal).replace('.',',')}</div></div>
      <div class="tile" style="outline:2px solid var(--line)"><div class="v">${r0(tg.kcal)}</div><div class="l">🎯 cible ${esc(tg.objectifLabel)}${tg.pct ? ' (' + (tg.ecart>0?'+':'−') + r0(Math.abs(tg.ecart)) + ')' : ''}</div></div>
    </div>
    ${alertes.map(a=>`<div class="small" style="color:var(--warn);margin-bottom:8px">${a}</div>`).join('')}
    <div class="small" style="margin:0 2px 12px;line-height:1.5">${rythme}</div>
    <div class="card" style="background:var(--card2)">
      <h2>🥩 Protéines par jour (pour ${r1fr(kg)} kg)</h2>
      <div class="tiles">
        <div class="tile"><div class="v">${r0(tg.protRNP)} g</div><div class="l">ANSES (population générale)</div></div>
        <div class="tile"><div class="v">${r0(tg.protMin)}–${r0(tg.protMax)} g</div><div class="l">pratique sportive</div></div>
        ${enPrise ? `<div class="tile"><div class="v">${r0(1.6*kg)}–${r0(2.2*kg)} g</div><div class="l">prise de masse</div></div>` : ''}
      </div>
    </div>
    <div class="card" style="background:var(--card2)">
      <h2>Comparaison des équations</h2>
      <div class="list">
        <div class="li-row"><div class="grow"><div class="name">Henry (Oxford) <span class="muted small">(référence EFSA, utilisée)</span></div></div><div class="val">${r0(tg.bmr)} <small>kcal</small></div></div>
        <div class="li-row"><div class="grow"><div class="name">Mifflin-St Jeor</div></div><div class="val">${r0(tg.bmrMSJ)} <small>kcal</small></div></div>
        ${km?`<div class="li-row"><div class="grow"><div class="name">Katch-McArdle <span class="muted small">(avec ${t.pctMG} % MG)</span></div></div><div class="val">${r0(km)} <small>kcal</small></div></div>`:''}
      </div>
      <p class="set-note" style="margin:10px 0 0">Quelques pourcents d'écart entre équations sont normaux : l'EFSA rappelle
      qu'aucune ne prédit exactement le métabolisme d'une personne. Le vrai juge, c'est ta courbe de poids sur 2 à 3 semaines.</p>
    </div>
    <div class="card" style="background:var(--card2)">
      <button class="btn" id="tExport" style="width:100%">📤 Demander un avis à une IA</button>
      <p class="set-note" style="margin:8px 0 0">Un rapport texte (repas, poids, séances, recettes) à coller dans
      ChatGPT, Claude ou Gemini pour qu'il ajuste tes menus.</p>
    </div>
    <div class="srcnote">
      Sources : métabolisme de base, équations de Henry (<i>Public Health Nutrition</i> 2005;8(7A):1133-52), retenues par
      le SACN (<i>Dietary Reference Values for Energy</i>, 2011, tableau 18) et l'EFSA (<i>Dietary Reference Values for energy</i>,
      EFSA Journal 2013;11(1):3005) · Comparaison : Mifflin-St Jeor (<i>Am J Clin Nutr</i> 1990;51:241-7) ·
      Niveaux d'activité 1,4 à 2,0 : EFSA 2013 · Perte de poids : HAS, <i>Surpoids et obésité de l'adulte</i>, 2011
      (baisse de 15 à 30 % des apports, 1 à 2 kg par mois, pas sous 1 200 kcal/j) · Prise de masse : Iraki et al.,
      <i>Sports</i> 2019;7(7):154 (+5 à +20 % du maintien, 0,25 à 0,5 % du poids par semaine, 1,6 à 2,2 g de protéines/kg) ·
      Protéines : ANSES et EFSA, 0,83 g/kg/j ; sportifs 1,2 à 2,0 g/kg/j (position commune Academy of Nutrition and
      Dietetics, Dietitians of Canada, ACSM 2016).<br>
      ⚕️ Estimations indicatives : elles ne remplacent pas un avis médical ou diététique personnalisé.
    </div>`;
  const be = document.getElementById('tExport');
  if(be) be.addEventListener('click', ()=>window.ExportIA.open());
}

document.addEventListener('DOMContentLoaded', ()=>{
  render();
  document.addEventListener('pageshow', e=>{ if(e.detail.page==='tdee') render(); });
  // changement de profil / sync : recharger le formulaire du bon profil
  document.addEventListener('profilechange', ()=>{ if(document.getElementById('page-tdee').classList.contains('active')) render(); });
  document.addEventListener('storechange', ()=>{ if(document.getElementById('page-tdee').classList.contains('active')) renderResults(); });
});

})();
