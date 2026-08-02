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

/* ===== Store multi-profils (localStorage, versionné) =====
   v2 : un conteneur { profiles: {id: {nom, data}} }. `Store.data` pointe vers
   les données du profil ACTIF, pour que tout le reste du code reste inchangé.
   Le profil actif est propre à chaque appareil (jamais synchronisé) : chacun
   peut donc rester sur le sien même si le coffre est partagé.               */
const STORE_KEY  = 'ob.perso.v1';     // conteneur (nom conservé pour la migration)
const ACTIVE_KEY = 'ob.activeProfile';

function blankProfileData(){
  return {
    weights: {},          // "YYYY-MM-DD" -> {kg, updatedAt}
    gym: {},              // "YYYY-MM-DD" -> {go, updatedAt}
    foods: [],            // aliments perso
    recipes: [],          // plats
    journal: {},          // "YYYY-MM-DD" -> {eaten:[…], updatedAt}
    mealCats: [ {id:'mc1', nom:'Repas'}, {id:'mc2', nom:'Collations'} ],
    mealCatsUpdatedAt: null,
    tdee: null,
    settings: {}
  };
}
/* Un ancien enregistrement v1 (données à plat) devient un profil. */
function wrapV1(v1, nom){
  const d = blankProfileData();
  for(const k of Object.keys(d)) if(v1[k] !== undefined) d[k] = v1[k];
  return {schemaVersion:2, updatedAt: v1.updatedAt || nowIso(),
          profiles:{ p1: {id:'p1', nom: nom||'Moi', createdAt: v1.updatedAt || nowIso(), updatedAt: v1.updatedAt || nowIso(), data:d} }};
}
function emptyContainer(){
  const id = 'p1';
  return {schemaVersion:2, updatedAt: nowIso(),
          profiles:{ [id]: {id, nom:'Moi', createdAt: nowIso(), updatedAt: nowIso(), data: blankProfileData()} }};
}

const Store = {
  all: null,                                  // conteneur complet
  get data(){ return this.active.data; },     // profil actif → tout le code existant marche
  get activeId(){
    const want = localStorage.getItem(ACTIVE_KEY);
    if(want && this.all.profiles[want] && !this.all.profiles[want].deleted) return want;
    return this.list()[0].id;
  },
  get active(){ return this.all.profiles[this.activeId]; },
  list(){
    const l = Object.values(this.all.profiles).filter(p=>!p.deleted);
    return l.length ? l.sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||'')) : [this.ensureOne()];
  },
  ensureOne(){
    const p = {id:uid(), nom:'Moi', createdAt:nowIso(), updatedAt:nowIso(), data:blankProfileData()};
    this.all.profiles[p.id] = p;
    return p;
  },
  setActive(id){
    if(!this.all.profiles[id]) return;
    localStorage.setItem(ACTIVE_KEY, id);
    document.dispatchEvent(new CustomEvent('profilechange'));
    document.dispatchEvent(new CustomEvent('storechange'));
  },
  addProfile(nom){
    const p = {id:uid(), nom:nom.trim()||'Nouveau', createdAt:nowIso(), updatedAt:nowIso(), data:blankProfileData()};
    this.all.profiles[p.id] = p;
    this.save();
    this.setActive(p.id);
    return p;
  },
  renameProfile(id, nom){
    const p = this.all.profiles[id]; if(!p) return;
    p.nom = nom.trim() || p.nom; p.updatedAt = nowIso();
    this.save();
    document.dispatchEvent(new CustomEvent('profilechange'));
  },
  deleteProfile(id){
    if(this.list().length <= 1) return false;          // toujours au moins un profil
    const p = this.all.profiles[id]; if(!p) return false;
    p.deleted = true; p.updatedAt = nowIso();
    if(this.activeId === id) localStorage.setItem(ACTIVE_KEY, this.list()[0].id);
    this.save();
    document.dispatchEvent(new CustomEvent('profilechange'));
    return true;
  },

  load(){
    let raw = null;
    try{ raw = JSON.parse(localStorage.getItem(STORE_KEY)); }catch(e){ raw = null; }
    const wasV1 = !!(raw && raw.schemaVersion === 1);
    if(raw && raw.schemaVersion === 2)      this.all = raw;
    else if(wasV1)                          this.all = wrapV1(raw);       // migration douce
    else                                     this.all = emptyContainer();
    // normalisations défensives
    if(!this.all.profiles || !Object.keys(this.all.profiles).length) this.all = emptyContainer();
    for(const p of Object.values(this.all.profiles)){
      p.data = Object.assign(blankProfileData(), p.data || {});
    }
    // fige la migration tout de suite (évite de la refaire à chaque ouverture)
    if(wasV1) localStorage.setItem(STORE_KEY, JSON.stringify(this.all));
    return this.data;
  },
  save(){
    if(Sync.autoRO){
      alert('👁 Mode consultation : tu regardes les données publiées, les modifications ne sont pas enregistrées.\n(Pour tenir ton propre suivi sur cet appareil : ⚙️ Réglages → « Mon propre suivi ».)');
      fetch(Sync.FILE + '?_=' + Date.now()).then(r=>r.ok?r.json():null).then(d=>{
        if(d){ this.all = (d.schemaVersion===2) ? d : wrapV1(d); document.dispatchEvent(new CustomEvent('storechange')); }
      }).catch(()=>{});
      return;
    }
    this.active.updatedAt = nowIso();
    this.all.updatedAt = nowIso();
    localStorage.setItem(STORE_KEY, JSON.stringify(this.all));
    document.dispatchEvent(new CustomEvent('storechange'));
    Sync.schedulePush();
  }
};

/* ===== Sync via le repo public (API Contents, merge last-write-wins) =====
   - Avec jeton (le propriétaire) : lecture + écriture de data/perso.json.
   - Sans jeton (visiteur/consultation) : si data/perso.json existe sur le site,
     l'app passe automatiquement en lecture seule sur ces données.            */
const Sync = {
  cfgKey: 'ob.sync.cfg',      // {token, owner, repo} — jamais synchronisé
  FILE: 'data/perso.json',
  get cfg(){ try{ return JSON.parse(localStorage.getItem(this.cfgKey)); }catch(e){ return null; } },
  set cfg(v){ v ? localStorage.setItem(this.cfgKey, JSON.stringify(v)) : localStorage.removeItem(this.cfgKey); },
  status: 'off',              // off | ok | syncing | error
  lastError: null,
  autoRO: false,              // consultation automatique (sans jeton)
  _timer: null,
  _sha: null,

  setStatus(s, err){
    this.status = s; this.lastError = err || null;
    const el = document.getElementById('syncBadge');
    if(el){
      const ic = this.autoRO ? '👁' : '☁️';
      el.textContent = s==='off' ? '' : (s==='ok' ? ic+'✓' : s==='syncing' ? ic+'…' : ic+'⚠️');
      el.title = s==='error' ? ('Sync : ' + (err||'erreur')) : (this.autoRO?'Consultation seule · ':'') + 'synchronisation ' + s;
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
  // fusion des DONNÉES d'un profil, entrée par entrée : la plus récente gagne
  mergeData(local, remote){
    const out = Object.assign(blankProfileData(), JSON.parse(JSON.stringify(local||{})));
    const newer = (a,b) => (!a ? b : !b ? a : (a.updatedAt > b.updatedAt ? a : b));
    for(const k of Object.keys(remote.weights||{})) out.weights[k] = newer(out.weights[k], remote.weights[k]);
    for(const k of Object.keys(remote.gym||{}))     out.gym[k]     = newer(out.gym[k],     remote.gym[k]);
    for(const k of Object.keys(remote.journal||{})) out.journal[k] = newer(out.journal[k], remote.journal[k]);
    for(const coll of ['foods','recipes']){
      const byId = Object.fromEntries((out[coll]||[]).map(x=>[x.id,x]));
      for(const r of (remote[coll]||[])){
        if(!byId[r.id] || r.updatedAt > byId[r.id].updatedAt) byId[r.id] = r;
      }
      out[coll] = Object.values(byId);
    }
    out.tdee = newer(out.tdee, remote.tdee);
    if(remote.mealCatsUpdatedAt && (!out.mealCatsUpdatedAt || remote.mealCatsUpdatedAt > out.mealCatsUpdatedAt)){
      out.mealCats = remote.mealCats; out.mealCatsUpdatedAt = remote.mealCatsUpdatedAt;
    }
    out.settings = {...(remote.settings||{}), ...(out.settings||{})};
    return out;
  },
  // fusion des conteneurs : profil par profil (les profils absents sont ajoutés)
  merge(local, remote){
    if(!remote) return local;
    if(remote.schemaVersion === 1) remote = wrapV1(remote);   // ancien format distant
    if(remote.schemaVersion !== 2) return local;
    const out = JSON.parse(JSON.stringify(local));
    for(const [id, rp] of Object.entries(remote.profiles||{})){
      const lp = out.profiles[id];
      if(!lp){ out.profiles[id] = rp; continue; }             // profil créé sur un autre appareil
      out.profiles[id] = {
        ...lp,
        nom:      (rp.updatedAt||'') > (lp.updatedAt||'') ? rp.nom : lp.nom,
        deleted:  lp.deleted || rp.deleted || undefined,
        updatedAt:(rp.updatedAt||'') > (lp.updatedAt||'') ? rp.updatedAt : lp.updatedAt,
        data:     this.mergeData(lp.data, rp.data||{})
      };
    }
    return out;
  },
  async pull(){
    if(!this.cfg) return;
    this.setStatus('syncing');
    try{
      const res = await this.api(this.FILE);
      if(res.status === 404){ this._sha = null; this.setStatus('ok'); return; } // pas encore de fichier
      if(!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      this._sha = j.sha;
      const remote = JSON.parse(decodeURIComponent(escape(atob(j.content.replace(/\n/g,'')))));
      Store.all = this.merge(Store.all, remote);
      localStorage.setItem(STORE_KEY, JSON.stringify(Store.all));
      document.dispatchEvent(new CustomEvent('profilechange'));
      document.dispatchEvent(new CustomEvent('storechange'));
      this.setStatus('ok');
    }catch(e){ this.setStatus('error', e.message); }
  },
  /* Consultation automatique (visiteur sans jeton) : lit le fichier publié sur le site.
     Ne s'active QUE si cet appareil n'a aucune donnée locale (pour ne rien écraser). */
  async tryAutoRO(){
    if(localStorage.getItem('ob.optOutRO')) return;   // cet appareil tient son propre suivi
    const empty = Store.list().every(p=>{
      const d = p.data;
      return !Object.keys(d.weights).length && !Object.keys(d.gym).length && !d.recipes.length
          && !d.foods.length && !d.tdee
          && !Object.values(d.journal).some(j=>(j.eaten||[]).length);
    });
    if(!empty) return;
    const adopt = c => { Store.all = (c.schemaVersion===2) ? c : wrapV1(c); };
    try{
      const res = await fetch(this.FILE + '?_=' + Date.now());
      if(!res.ok) return;
      const remote = await res.json();
      if(remote.schemaVersion !== 1 && remote.schemaVersion !== 2) return;
      adopt(remote);                       // en mémoire uniquement (pas de persistance locale)
      this.autoRO = true;
      document.dispatchEvent(new CustomEvent('profilechange'));
      document.dispatchEvent(new CustomEvent('storechange'));
      this.setStatus('ok');
      setInterval(async ()=>{
        try{
          const r = await fetch(this.FILE + '?_=' + Date.now());
          if(r.ok){ adopt(await r.json());
            document.dispatchEvent(new CustomEvent('profilechange'));
            document.dispatchEvent(new CustomEvent('storechange')); }
        }catch(e){}
      }, 5*60*1000);
    }catch(e){}
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
        content: btoa(unescape(encodeURIComponent(JSON.stringify(Store.all)))),
      };
      if(this._sha) body.sha = this._sha;
      const res = await this.api(this.FILE, {method:'PUT', body: JSON.stringify(body)});
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

/* ===== Profils : bascule et gestion ===== */
function refreshProfileButton(){
  const el = document.getElementById('profName');
  if(el) el.textContent = Store.active ? Store.active.nom : '–';
}

function openProfiles(){
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  document.body.appendChild(bg);
  const close = ()=>bg.remove();
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });

  function draw(){
    const list = Store.list();
    const activeId = Store.activeId;
    bg.innerHTML = `
      <div class="modal">
        <h3>👤 Profils</h3>
        <p class="small muted" style="margin:0 0 12px">Chaque profil a ses propres pesées, repas, séances et TDEE.
        Le profil choisi est propre à <b>cet appareil</b> : Faten peut rester sur le sien pendant que tu restes sur le tien.</p>
        <div class="list">
          ${list.map(p=>{
            const d = p.data;
            const w = Object.keys(d.weights).length, g = Object.keys(d.gym).length;
            return `<div class="prof-row ${p.id===activeId?'on':''}">
              <div class="grow" data-pick="${p.id}">
                <div class="nom">${p.id===activeId?'✅ ':''}${esc(p.nom)}</div>
                <div class="sub">${w} pesée(s) · ${g} séance(s) · ${d.recipes.filter(r=>!r.deleted).length} plat(s)${d.tdee?' · TDEE ✓':''}</div>
              </div>
              <button class="li-x" data-ren="${p.id}" title="Renommer">✎</button>
              ${list.length>1?`<button class="li-x" data-del="${p.id}" title="Supprimer">🗑</button>`:''}
            </div>`;
          }).join('')}
        </div>
        <div class="actions">
          <button class="btn primary" id="pfNew">＋ Nouveau profil</button>
          <button class="btn" id="pfClose">Fermer</button>
        </div>
      </div>`;

    bg.querySelectorAll('[data-pick]').forEach(el=>el.addEventListener('click', ()=>{
      Store.setActive(el.dataset.pick);
      close();
    }));
    bg.querySelectorAll('[data-ren]').forEach(b=>b.addEventListener('click', ()=>{
      const p = Store.all.profiles[b.dataset.ren];
      const v = prompt('Nom du profil :', p.nom);
      if(v && v.trim()){ Store.renameProfile(p.id, v); draw(); }
    }));
    bg.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click', ()=>{
      const p = Store.all.profiles[b.dataset.del];
      if(!confirm(`Supprimer le profil « ${p.nom} » et toutes ses données (pesées, repas, séances) ?\nCette action est définitive.`)) return;
      Store.deleteProfile(p.id); draw();
    }));
    bg.querySelector('#pfNew').addEventListener('click', ()=>{
      const v = prompt('Nom du nouveau profil (ex : Faten) :');
      if(v && v.trim()){ Store.addProfile(v); close(); }
    });
    bg.querySelector('#pfClose').addEventListener('click', close);
  }
  draw();
}

/* ===== Réglages (modale) ===== */
function openSettings(){
  const c = Sync.cfg || {owner:'CoverSurGitHub', repo:'orange-bleue-affluence', token:''};
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `
    <div class="modal">
      <h3>⚙️ Réglages</h3>
      <div class="card" style="background:var(--card2)">
        <h2>Synchronisation (propriétaire)</h2>
        <p class="small muted" style="margin:0 0 10px">Colle ton jeton GitHub pour enregistrer tes données
        dans le dépôt public — elles se synchronisent alors entre ton PC et ton téléphone.
        Sans jeton, l'app affiche les données publiées en <b>consultation seule</b> (parfait pour un proche : il n'a rien à configurer).
        ⚠️ Les données sont publiques (repo public).
        État : <b>${Sync.cfg ? 'écriture activée' : (Sync.autoRO ? 'consultation seule' : 'locale')}</b>${Sync.lastError ? ' — erreur : '+esc(Sync.lastError) : ''}</p>
        <div class="fieldrow">
          <div class="field"><label>Propriétaire</label><input id="syncOwner" type="text" value="${esc(c.owner)}" autocapitalize="off"></div>
          <div class="field"><label>Dépôt</label><input id="syncRepo" type="text" value="${esc(c.repo)}" autocapitalize="off"></div>
        </div>
        <div class="field"><label>Jeton (fine-grained, Contents RW sur ce dépôt)</label><input id="syncToken" type="password" value="${esc(c.token)}" placeholder="github_pat_…"></div>
        <div class="actions" style="display:flex;gap:8px">
          <button class="btn primary" id="syncSave">Activer l'écriture</button>
          <button class="btn danger" id="syncOff">Désactiver</button>
        </div>
      </div>
      ${Sync.autoRO ? `<div class="card" style="background:var(--card2)">
        <h2>👁 Tu es en consultation seule</h2>
        <p class="small muted" style="margin:0 0 10px">Cet appareil affiche les données publiées par le propriétaire.
        Si tu veux tenir TON propre suivi ici (il restera local à cet appareil) :</p>
        <button class="btn" id="optOut">✍️ Mon propre suivi sur cet appareil</button>
      </div>` : ''}
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
    Sync.autoRO = false;
    localStorage.setItem('ob.optOutRO','1');        // cet appareil devient un appareil "propriétaire"
    await Sync.pull();
    if(Sync.status === 'error'){ alert('Échec de connexion : ' + Sync.lastError + '\nVérifie le jeton et le nom du dépôt.'); Sync.cfg = null; }
    else { Sync.schedulePush(); alert('Écriture activée ✔ Tes données seront synchronisées.'); close(); }
  });
  bg.querySelector('#syncOff').addEventListener('click', ()=>{ Sync.cfg = null; Sync.setStatus('off'); close(); });
  const optOut = bg.querySelector('#optOut');
  if(optOut) optOut.addEventListener('click', ()=>{
    if(!confirm('Cet appareil quittera la consultation et tiendra un suivi local vierge. Continuer ?')) return;
    localStorage.setItem('ob.optOutRO','1');
    localStorage.removeItem(STORE_KEY);
    location.reload();
  });
  bg.querySelector('#expBtn').addEventListener('click', ()=>{
    const blob = new Blob([JSON.stringify(Store.all, null, 1)], {type:'application/json'});
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
        if(imported.schemaVersion !== 1 && imported.schemaVersion !== 2) throw new Error('format inconnu');
        Store.all = Sync.merge(Store.all, imported);
        Store.save();
        document.dispatchEvent(new CustomEvent('profilechange'));
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
  document.getElementById('btnProfile').addEventListener('click', openProfiles);
  document.addEventListener('profilechange', refreshProfileButton);
  refreshProfileButton();
  showPage(localStorage.getItem('ob.lastPage') || 'salle');
  if(Sync.cfg) Sync.pull();
  else Sync.tryAutoRO();
});
