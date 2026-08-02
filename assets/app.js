/* ===== Noyau : navigation, calendrier commun, store, sync ===== */
'use strict';

const TZ = 'Europe/Paris';
const fmtDayKey  = new Intl.DateTimeFormat('fr-CA', {timeZone:TZ, year:'numeric', month:'2-digit', day:'2-digit'});
const fmtTime    = new Intl.DateTimeFormat('fr-FR', {timeZone:TZ, hour:'2-digit', minute:'2-digit'});
const fmtDayLong = new Intl.DateTimeFormat('fr-FR', {timeZone:TZ, weekday:'long', day:'numeric', month:'long'});
const fmtDayShort= new Intl.DateTimeFormat('fr-FR', {timeZone:TZ, day:'numeric', month:'short'});

function todayKey(){ return fmtDayKey.format(new Date()); }
function keyToDate(k){ const [y,m,d]=k.split('-').map(Number); return new Date(y, m-1, d); }
function labelForKey(k, long=true){ return (long?fmtDayLong:fmtDayShort).format(keyToDate(k)); }
function esc(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function nowIso(){ return new Date().toISOString(); }

/* ===== Navigation entre pages ===== */
const PAGES = ['salle','poids','repas','tdee'];
function showPage(name){
  for(const p of PAGES){
    document.getElementById('page-'+p).classList.toggle('active', p===name);
    document.getElementById('nav-'+p).classList.toggle('active', p===name);
  }
  localStorage.setItem('ob.lastPage', name);
  document.dispatchEvent(new CustomEvent('pageshow', {detail:{page:name}}));
}

/* ===== Calendrier commun (bug ‹ › corrigé par délégation d'événements) =====
   Le popup est un élément persistant ; son innerHTML change mais les listeners
   sont attachés UNE FOIS sur le conteneur (délégation), donc plus aucun souci
   de nœud détaché. Le handler "clic extérieur" ignore les cibles déconnectées. */
function createCalendar(opts){
  // opts: {button, label, popup, isSelectable(dayKey), isMarked(dayKey), maxKey?, onSelect(dayKey)}
  const state = { view:null, selected:null, open:false };

  function setSelected(k, fire){
    state.selected = k;
    if(opts.label) opts.label.textContent = k ? labelForKey(k) : '–';
    if(fire && opts.onSelect) opts.onSelect(k);
  }
  function open(){
    const base = state.selected || todayKey();
    const [y,m] = base.split('-').map(Number);
    state.view = {y, m};
    state.open = true;
    opts.popup.style.display = 'block';
    render();
  }
  function close(){ state.open = false; opts.popup.style.display = 'none'; }
  function render(){
    const {y, m} = state.view;
    const today = todayKey();
    const monthLabel = new Intl.DateTimeFormat('fr-FR',{month:'long',year:'numeric'}).format(new Date(y, m-1, 1));
    const firstDow = (new Date(y, m-1, 1).getDay()+6)%7;
    const nDays = new Date(y, m, 0).getDate();
    let cells = '';
    for(let i=0;i<firstDow;i++) cells += '<div class="cal-day empty"></div>';
    for(let d=1; d<=nDays; d++){
      const key = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const selectable = opts.isSelectable ? opts.isSelectable(key) : true;
      const marked = opts.isMarked ? opts.isMarked(key) : false;
      const cls = ['cal-day'];
      if(!selectable) cls.push('off');
      if(marked) cls.push('mark');
      if(key===state.selected) cls.push('selected');
      if(key===today) cls.push('today');
      cells += `<div class="${cls.join(' ')}" data-day="${selectable?key:''}">${d}${marked?'<span class="dot2"></span>':''}</div>`;
    }
    opts.popup.innerHTML = `
      <div class="cal-head">
        <button class="cal-nav" data-nav="-1" type="button">‹</button>
        <b>${monthLabel}</b>
        <button class="cal-nav" data-nav="1" type="button">›</button>
      </div>
      <div class="cal-grid">
        ${['L','M','M','J','V','S','D'].map(d=>`<div class="cal-dow">${d}</div>`).join('')}
        ${cells}
      </div>`;
  }

  // Délégation : listeners posés une seule fois sur le popup persistant
  opts.popup.addEventListener('click', e=>{
    const nav = e.target.closest('[data-nav]');
    if(nav){
      e.stopPropagation();
      state.view.m += +nav.dataset.nav;
      if(state.view.m<1){ state.view.m=12; state.view.y--; }
      if(state.view.m>12){ state.view.m=1; state.view.y++; }
      render();
      return;
    }
    const day = e.target.closest('.cal-day');
    if(day && day.dataset.day){
      setSelected(day.dataset.day, true);
      close();
    }
  });
  opts.button.addEventListener('click', e=>{
    e.stopPropagation();
    state.open ? close() : open();
  });
  document.addEventListener('click', e=>{
    if(!state.open) return;
    if(!e.target.isConnected) return;             // nœud détaché (re-render) → ignorer
    if(opts.popup.contains(e.target) || opts.button.contains(e.target)) return;
    close();
  });

  return {
    get selected(){ return state.selected; },
    setSelected: k => setSelected(k, false),
    refresh: () => { if(state.open) render(); },
    close
  };
}

/* ===== Store perso (localStorage, versionné) ===== */
const STORE_KEY = 'ob.perso.v1';
const Store = {
  data: null,
  load(){
    try{ this.data = JSON.parse(localStorage.getItem(STORE_KEY)) || null; }catch(e){ this.data = null; }
    if(!this.data || this.data.schemaVersion !== 1){
      this.data = {
        schemaVersion: 1,
        updatedAt: nowIso(),
        weights: {},          // "YYYY-MM-DD" -> {kg, updatedAt}
        foods: [],            // aliments perso {id, nom, kcal, prot, updatedAt, deleted?}
        recipes: [],          // {id, nom, items:[{ref, qty}], updatedAt, deleted?}
        journal: {},          // "YYYY-MM-DD" -> {cats:[{id,nom,items:[...]}], updatedAt}
        catTemplate: [
          {id:'c1', nom:'Repas 1'}, {id:'c2', nom:'Repas 2'},
          {id:'c3', nom:'Collation 1'}, {id:'c4', nom:'Collation 2'}
        ],
        tdee: null,           // {sexe, age, taille, poidsManuel, activite, objectif, pctMG, updatedAt}
        settings: {}          // {objectifPoids}
      };
    }
    return this.data;
  },
  save(){
    this.data.updatedAt = nowIso();
    localStorage.setItem(STORE_KEY, JSON.stringify(this.data));
    document.dispatchEvent(new CustomEvent('storechange'));
    Sync.schedulePush();
  }
};

/* ===== Sync GitHub privé (API Contents, merge last-write-wins) ===== */
const Sync = {
  cfgKey: 'ob.sync.cfg',      // {token, owner, repo} — JAMAIS synchronisé
  get cfg(){ try{ return JSON.parse(localStorage.getItem(this.cfgKey)); }catch(e){ return null; } },
  set cfg(v){ v ? localStorage.setItem(this.cfgKey, JSON.stringify(v)) : localStorage.removeItem(this.cfgKey); },
  status: 'off',              // off | ok | syncing | error
  lastError: null,
  _timer: null,
  _sha: null,

  setStatus(s, err){
    this.status = s; this.lastError = err || null;
    const el = document.getElementById('syncBadge');
    if(el){
      el.textContent = s==='off' ? '' : (s==='ok' ? '☁️✓' : s==='syncing' ? '☁️…' : '☁️⚠️');
      el.title = s==='error' ? ('Sync : ' + (err||'erreur')) : 'Synchronisation ' + s;
    }
  },
  api(path, init={}){
    const c = this.cfg;
    return fetch(`https://api.github.com/repos/${c.owner}/${c.repo}/contents/${path}`, {
      ...init,
      headers: {
        'Accept':'application/vnd.github+json',
        'Authorization':'Bearer ' + c.token,
        'X-GitHub-Api-Version':'2022-11-28',
        ...(init.headers||{})
      }
    });
  },
  // fusion entrée par entrée : la plus récente (updatedAt) gagne
  merge(local, remote){
    if(!remote || remote.schemaVersion !== 1) return local;
    const out = JSON.parse(JSON.stringify(local));
    const newer = (a,b) => (!a ? b : !b ? a : (a.updatedAt > b.updatedAt ? a : b));
    for(const k of Object.keys(remote.weights||{})) out.weights[k] = newer(out.weights[k], remote.weights[k]);
    for(const k of Object.keys(remote.journal||{})) out.journal[k] = newer(out.journal[k], remote.journal[k]);
    for(const coll of ['foods','recipes']){
      const byId = Object.fromEntries(out[coll].map(x=>[x.id,x]));
      for(const r of (remote[coll]||[])){
        if(!byId[r.id] || r.updatedAt > byId[r.id].updatedAt) byId[r.id] = r;
      }
      out[coll] = Object.values(byId);
    }
    out.tdee = newer(out.tdee, remote.tdee);
    if(remote.catTemplateUpdatedAt && (!out.catTemplateUpdatedAt || remote.catTemplateUpdatedAt > out.catTemplateUpdatedAt)){
      out.catTemplate = remote.catTemplate; out.catTemplateUpdatedAt = remote.catTemplateUpdatedAt;
    }
    out.settings = {...(remote.settings||{}), ...(out.settings||{})};
    return out;
  },
  async pull(){
    if(!this.cfg) return;
    this.setStatus('syncing');
    try{
      const res = await this.api('data.json');
      if(res.status === 404){ this._sha = null; this.setStatus('ok'); return; } // pas encore de fichier
      if(!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      this._sha = j.sha;
      const remote = JSON.parse(decodeURIComponent(escape(atob(j.content.replace(/\n/g,'')))));
      Store.data = this.merge(Store.data, remote);
      localStorage.setItem(STORE_KEY, JSON.stringify(Store.data));
      document.dispatchEvent(new CustomEvent('storechange'));
      this.setStatus('ok');
    }catch(e){ this.setStatus('error', e.message); }
  },
  schedulePush(){
    if(!this.cfg) return;
    clearTimeout(this._timer);
    this._timer = setTimeout(()=>this.push(), 2500);
  },
  async push(attempt=0){
    if(!this.cfg) return;
    this.setStatus('syncing');
    try{
      const body = {
        message: 'perso: ' + nowIso(),
        content: btoa(unescape(encodeURIComponent(JSON.stringify(Store.data)))),
      };
      if(this._sha) body.sha = this._sha;
      const res = await this.api('data.json', {method:'PUT', body: JSON.stringify(body)});
      if(res.status === 409 || res.status === 422){
        if(attempt >= 2) throw new Error('conflit non résolu');
        await this.pull();                      // récupère + merge + nouveau sha
        return this.push(attempt+1);
      }
      if(!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      this._sha = j.content.sha;
      this.setStatus('ok');
    }catch(e){ this.setStatus('error', e.message); }
  }
};

/* ===== Réglages (modale) ===== */
function openSettings(){
  const c = Sync.cfg || {owner:'', repo:'', token:''};
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `
    <div class="modal">
      <h3>⚙️ Réglages</h3>
      <div class="card" style="background:var(--card2)">
        <h2>Synchronisation privée (GitHub)</h2>
        <p class="small muted" style="margin:0 0 10px">Tes pesées et repas sont stockés sur CET appareil.
        Pour les retrouver sur PC ET mobile, crée un dépôt GitHub <b>privé</b> et colle ici un jeton d'accès.
        État actuel : <b>${Sync.cfg ? 'configurée' : 'non configurée'}</b>${Sync.lastError ? ' — erreur : '+esc(Sync.lastError) : ''}</p>
        <div class="field"><label>Propriétaire (ton pseudo GitHub)</label><input id="syncOwner" type="text" value="${esc(c.owner)}" placeholder="CoverSurGitHub" autocapitalize="off"></div>
        <div class="field"><label>Nom du dépôt privé</label><input id="syncRepo" type="text" value="${esc(c.repo)}" placeholder="perso-data" autocapitalize="off"></div>
        <div class="field"><label>Jeton (fine-grained, Contents RW sur ce seul dépôt)</label><input id="syncToken" type="password" value="${esc(c.token)}" placeholder="github_pat_…"></div>
        <div class="actions" style="display:flex;gap:8px">
          <button class="btn primary" id="syncSave">Activer la sync</button>
          <button class="btn danger" id="syncOff">Désactiver</button>
        </div>
      </div>
      <div class="card" style="background:var(--card2)">
        <h2>Sauvegarde manuelle</h2>
        <div style="display:flex;gap:8px">
          <button class="btn" id="expBtn">⬇️ Exporter (JSON)</button>
          <button class="btn" id="impBtn">⬆️ Importer</button>
          <input type="file" id="impFile" accept=".json" style="display:none">
        </div>
      </div>
      <div class="actions"><button class="btn" id="setClose">Fermer</button></div>
    </div>`;
  document.body.appendChild(bg);
  const close = ()=>bg.remove();
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  bg.querySelector('#setClose').addEventListener('click', close);
  bg.querySelector('#syncSave').addEventListener('click', async ()=>{
    const owner = bg.querySelector('#syncOwner').value.trim();
    const repo  = bg.querySelector('#syncRepo').value.trim();
    const token = bg.querySelector('#syncToken').value.trim();
    if(!owner || !repo || !token){ alert('Remplis les 3 champs.'); return; }
    Sync.cfg = {owner, repo, token};
    await Sync.pull();
    if(Sync.status === 'error'){ alert('Échec de connexion : ' + Sync.lastError + '\nVérifie le jeton et le nom du dépôt.'); }
    else { Sync.schedulePush(); alert('Sync activée ✔'); close(); }
  });
  bg.querySelector('#syncOff').addEventListener('click', ()=>{ Sync.cfg = null; Sync.setStatus('off'); close(); });
  bg.querySelector('#expBtn').addEventListener('click', ()=>{
    const blob = new Blob([JSON.stringify(Store.data, null, 1)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'perso-' + todayKey() + '.json';
    a.click();
  });
  bg.querySelector('#impBtn').addEventListener('click', ()=>bg.querySelector('#impFile').click());
  bg.querySelector('#impFile').addEventListener('change', e=>{
    const f = e.target.files[0]; if(!f) return;
    const r = new FileReader();
    r.onload = ()=>{
      try{
        const imported = JSON.parse(r.result);
        if(imported.schemaVersion !== 1) throw new Error('format inconnu');
        Store.data = Sync.merge(Store.data, imported);
        Store.save();
        alert('Import fusionné ✔');
        close();
      }catch(err){ alert('Fichier invalide : ' + err.message); }
    };
    r.readAsText(f);
  });
}

/* ===== Boot ===== */
document.addEventListener('DOMContentLoaded', ()=>{
  Store.load();
  for(const p of PAGES){
    document.getElementById('nav-'+p).addEventListener('click', ()=>showPage(p));
  }
  document.getElementById('btnSettings').addEventListener('click', openSettings);
  showPage(localStorage.getItem('ob.lastPage') || 'salle');
  if(Sync.cfg) Sync.pull();
});
