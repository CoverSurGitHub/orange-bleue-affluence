/* ===== Section TDEE : besoins énergétiques (formules officielles sourcées) =====
   BMR : Mifflin-St Jeor (Mifflin MD et al., Am J Clin Nutr 1990;51:241-7) —
         équation recommandée par l'Academy of Nutrition and Dietetics.
   Comparaisons : Harris-Benedict révisée (Roza & Shizgal, Am J Clin Nutr 1984),
                  Katch-McArdle (si % de masse grasse connu).
   Protéines : ANSES, RNP adulte = 0,83 g/kg/j ; sportifs : 1,2–2,0 g/kg/j
               (position commune AND/DC/ACSM 2016, Med Sci Sports Exerc).      */
'use strict';
(function(){

const ACT = [
  {f:1.2,   label:'Sédentaire',      desc:'travail assis, pas de sport'},
  {f:1.375, label:'Légèrement actif', desc:'sport léger 1 à 3 j/semaine'},
  {f:1.55,  label:'Modérément actif', desc:'sport 3 à 5 j/semaine'},
  {f:1.725, label:'Très actif',       desc:'sport intense 6 à 7 j/semaine'},
  {f:1.9,   label:'Extrêmement actif',desc:'sport 2×/j ou métier physique'}
];
const OBJ = [
  {id:'maintien', label:'Maintien',        delta:0},
  {id:'perte',    label:'Perte (~0,5 kg/sem)', delta:-500},
  {id:'perteL',   label:'Perte légère',    delta:-300},
  {id:'prise',    label:'Prise (lean bulk)', delta:+300}
];

function bmrMSJ(sexe, kg, cm, age){ return 10*kg + 6.25*cm - 5*age + (sexe==='H' ? 5 : -161); }
function bmrHB(sexe, kg, cm, age){
  return sexe==='H' ? 88.362 + 13.397*kg + 4.799*cm - 5.677*age
                    : 447.593 + 9.247*kg + 3.098*cm - 4.330*age;
}
function bmrKM(kg, pctMG){ return 370 + 21.6 * (kg * (1 - pctMG/100)); }

function lastWeight(){
  const keys = Object.keys(Store.data.weights).sort();
  return keys.length ? Store.data.weights[keys[keys.length-1]].kg : null;
}
function effectiveWeight(t){ return t.poidsManuel || lastWeight(); }

/* cibles exposées à la section Repas */
window.TDEE = {
  targets(t){
    const kg = effectiveWeight(t);
    if(!t || !kg || !t.taille || !t.age || !t.sexe) return null;
    const bmr = bmrMSJ(t.sexe, kg, t.taille, t.age);
    const tdee = bmr * (t.activite || 1.55);
    const obj = OBJ.find(o=>o.id===t.objectif) || OBJ[0];
    return {
      kcal: tdee + obj.delta,
      tdee, bmr,
      protMin: 1.2*kg, protMax: 2.0*kg,      // fourchette sportive (AND/DC/ACSM 2016)
      protRNP: 0.83*kg,                      // ANSES population générale
      objectifLabel: obj.label.toLowerCase()
    };
  }
};

function render(){
  const t = Store.data.tdee || {};
  const kg = effectiveWeight(t);
  const el = document.getElementById('tForm');
  el.innerHTML = `
    <div class="fieldrow">
      <div class="field"><label>Sexe</label>
        <select id="tSexe"><option value="H" ${t.sexe!=='F'?'selected':''}>Homme</option><option value="F" ${t.sexe==='F'?'selected':''}>Femme</option></select></div>
      <div class="field"><label>Âge (ans)</label>
        <input type="number" id="tAge" inputmode="numeric" min="15" max="100" value="${t.age||''}" placeholder="25"></div>
    </div>
    <div class="fieldrow">
      <div class="field"><label>Taille (cm)</label>
        <input type="number" id="tTaille" inputmode="numeric" min="120" max="230" value="${t.taille||''}" placeholder="178"></div>
      <div class="field"><label>Poids (kg) ${!t.poidsManuel && lastWeight() ? '<span class="muted">— dernière pesée</span>':''}</label>
        <input type="number" id="tPoids" inputmode="decimal" step="0.1" min="30" max="300" value="${kg||''}" placeholder="75"></div>
    </div>
    <div class="field"><label>Niveau d'activité</label>
      <select id="tAct">${ACT.map(a=>`<option value="${a.f}" ${t.activite===a.f?'selected':''}>${a.label} — ${a.desc} (×${a.f})</option>`).join('')}</select></div>
    <div class="fieldrow">
      <div class="field"><label>Objectif</label>
        <select id="tObj">${OBJ.map(o=>`<option value="${o.id}" ${t.objectif===o.id?'selected':''}>${o.label}${o.delta?` (${o.delta>0?'+':''}${o.delta} kcal/j)`:''}</option>`).join('')}</select></div>
      <div class="field"><label>% masse grasse <span class="muted">(optionnel)</span></label>
        <input type="number" id="tMG" inputmode="decimal" step="0.5" min="3" max="60" value="${t.pctMG||''}" placeholder="15"></div>
    </div>
    <button class="btn primary" id="tCalc" style="width:100%">Calculer</button>`;

  document.getElementById('tCalc').addEventListener('click', ()=>{
    const read = id => parseFloat(String(document.getElementById(id).value).replace(',','.'));
    const sexe = document.getElementById('tSexe').value;
    const age = read('tAge'), taille = read('tTaille'), poids = read('tPoids');
    const activite = parseFloat(document.getElementById('tAct').value);
    const objectif = document.getElementById('tObj').value;
    const pctMG = read('tMG');
    if(!Number.isFinite(age)||!Number.isFinite(taille)||!Number.isFinite(poids)){ alert('Remplis âge, taille et poids.'); return; }
    Store.data.tdee = {
      sexe, age, taille, activite, objectif,
      poidsManuel: (lastWeight() && Math.abs(poids-lastWeight())<0.05) ? null : poids,
      pctMG: Number.isFinite(pctMG) ? pctMG : null,
      updatedAt: nowIso()
    };
    Store.save();
    renderResults();
  });
  renderResults();
}

function renderResults(){
  const t = Store.data.tdee;
  const out = document.getElementById('tRes');
  if(!t){ out.innerHTML=''; return; }
  const kg = effectiveWeight(t);
  const tg = window.TDEE.targets(t);
  if(!tg){ out.innerHTML=''; return; }
  const r0 = x=>Math.round(x);
  const hb = bmrHB(t.sexe, kg, t.taille, t.age);
  const km = t.pctMG ? bmrKM(kg, t.pctMG) : null;
  const warnBMR = tg.kcal < tg.bmr;

  out.innerHTML = `
    <div class="tiles">
      <div class="tile"><div class="v">${r0(tg.bmr)}</div><div class="l">BMR (kcal/j)</div></div>
      <div class="tile"><div class="v">${r0(tg.tdee)}</div><div class="l">TDEE — maintien</div></div>
      <div class="tile" style="outline:2px solid var(--line)"><div class="v">${r0(tg.kcal)}</div><div class="l">🎯 cible ${esc(tg.objectifLabel)}</div></div>
    </div>
    ${warnBMR?'<div class="small" style="color:var(--warn);margin-bottom:8px">⚠️ Cible sous ton métabolisme de base — déficit trop agressif, à éviter sans suivi médical.</div>':''}
    <div class="card" style="background:var(--card2)">
      <h2>🥩 Protéines par jour (pour ${kg.toFixed(1)} kg)</h2>
      <div class="tiles">
        <div class="tile"><div class="v">${r0(tg.protRNP)} g</div><div class="l">ANSES (population générale)</div></div>
        <div class="tile"><div class="v">${r0(tg.protMin)}–${r0(tg.protMax)} g</div><div class="l">pratique sportive</div></div>
      </div>
    </div>
    <div class="card" style="background:var(--card2)">
      <h2>Comparaison des équations (BMR)</h2>
      <div class="list">
        <div class="li-row"><div class="grow"><div class="name">Mifflin-St Jeor <span class="muted small">(référence)</span></div></div><div class="val">${r0(tg.bmr)} <small>kcal</small></div></div>
        <div class="li-row"><div class="grow"><div class="name">Harris-Benedict révisée</div></div><div class="val">${r0(hb)} <small>kcal</small></div></div>
        ${km?`<div class="li-row"><div class="grow"><div class="name">Katch-McArdle <span class="muted small">(avec ${t.pctMG} % MG)</span></div></div><div class="val">${r0(km)} <small>kcal</small></div></div>`:''}
      </div>
    </div>
    <div class="srcnote">
      Sources : BMR — Mifflin-St Jeor (Mifflin MD et al., <i>Am J Clin Nutr</i> 1990;51:241-247), équation recommandée par
      l'Academy of Nutrition and Dietetics · Harris-Benedict révisée par Roza &amp; Shizgal (<i>Am J Clin Nutr</i> 1984) ·
      Facteurs d'activité : multiplicateurs standards (1,2–1,9) · Protéines : ANSES, RNP adultes 0,83 g/kg/j ;
      sportifs 1,2–2,0 g/kg/j (position commune Academy of Nutrition and Dietetics, Dietitians of Canada, ACSM 2016) ·
      Déficit ~500 kcal/j ≈ −0,5 kg/semaine (repère NIH/NHS).<br>
      ⚕️ Estimations indicatives — ne remplace pas un avis médical ou diététique personnalisé.
    </div>`;
}

document.addEventListener('DOMContentLoaded', ()=>{
  render();
  document.addEventListener('pageshow', e=>{ if(e.detail.page==='tdee') render(); });
  // changement de profil / sync : recharger le formulaire du bon profil
  document.addEventListener('profilechange', ()=>{ if(document.getElementById('page-tdee').classList.contains('active')) render(); });
});

})();
