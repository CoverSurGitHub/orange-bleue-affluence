/* ===== Noyau : navigation, calendrier commun, store, sync ===== */
'use strict';

const APP_VERSION = 'mt4wyzlx';   // bumpé à chaque déploiement (voir bump.js)

/* Les DONNÉES (mesures d'affluence + coffre perso) vivent sur la branche `data`,
   séparée du code. Raison : chaque commit sur `main` relance une build GitHub
   Pages qui annule la précédente ; avec un relevé toutes les 10 min, le site ne
   se republiait plus et les appareils restaient bloqués sur du code périmé. */
const DATA_REPO   = 'CoverSurGitHub/orange-bleue-affluence';
const DATA_BRANCH = 'data';
const DATA_URL = f => `https://raw.githubusercontent.com/${DATA_REPO}/${DATA_BRANCH}/${f}?_=${Date.now()}`;
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
/* couleur du thème courant, pour les canvas (grille, labels…) */
function cssVar(name){ return getComputedStyle(document.body).getPropertyValue(name).trim(); }
/* petit toast de confirmation, avec action optionnelle (ex : Annuler) */
function toast(msg, opts={}){
  const zone = document.getElementById('toasts');
  if(!zone) return ()=>{};
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = '<span>'+msg+'</span>' + (opts.action ? '<button type="button">'+esc(opts.action.label)+'</button>' : '');
  if(opts.action) el.querySelector('button').addEventListener('click', ()=>{ opts.action.fn(); kill(); });
  zone.appendChild(el);
  while(zone.children.length > 3) zone.firstChild.remove();
  const t = setTimeout(kill, opts.ms || 2600);
  function kill(){ clearTimeout(t); el.classList.add('out'); setTimeout(()=>el.remove(), 230); }
  return kill;
}

/* ===== Navigation entre pages ===== */
const PAGES = ['salle','poids','repas','eau','tdee'];
function showPage(name){
  for(const p of PAGES){
    document.getElementById('page-'+p).classList.toggle('active', p===name);
    const nb = document.getElementById('nav-'+p);
    nb.classList.toggle('active', p===name);
    if(p===name) nb.setAttribute('aria-current','page'); else nb.removeAttribute('aria-current');
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
    for(let i=0;i<firstDow;i++) cells += '<span class="cal-day empty" aria-hidden="true"></span>';
    for(let d=1; d<=nDays; d++){
      const key = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const selectable = opts.isSelectable ? opts.isSelectable(key) : true;
      const marked = opts.isMarked ? opts.isMarked(key) : false;
      const cls = ['cal-day'];
      if(!selectable) cls.push('off');
      if(marked) cls.push('mark');
      if(key===state.selected) cls.push('selected');
      if(key===today) cls.push('today');
      cells += `<button type="button" class="${cls.join(' ')}" data-day="${selectable?key:''}" ${selectable?'':'disabled'} aria-label="${labelForKey(key)}${marked?' — données présentes':''}">${d}${marked?'<span class="dot2"></span>':''}</button>`;
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

function defaultContainers(){
  // ids stables : créés à l'identique sur chaque appareil → fusion sans doublon
  return [
    {id:'wc-verre',  nom:'Verre',  ml:250,  emo:'🥛', fav:true,  ordre:1, updatedAt:null},
    {id:'wc-tasse',  nom:'Tasse',  ml:200,  emo:'☕', fav:false, ordre:2, updatedAt:null},
    {id:'wc-shaker', nom:'Shaker', ml:500,  emo:'🥤', fav:true,  ordre:3, updatedAt:null},
    {id:'wc-gourde', nom:'Gourde', ml:750,  emo:'🍶', fav:true,  ordre:4, updatedAt:null},
    {id:'wc-carafe', nom:'Carafe', ml:1000, emo:'🫗', fav:false, ordre:5, updatedAt:null},
  ];
}
function blankWater(){
  // objectif par défaut 2 L — simple valeur de départ, modifiable, pas une prescription
  // fromMeals : 'off' | 'drinks' (défaut : ingrédients liquides seulement) | 'all'
  return { goal:{ml:2000, updatedAt:null}, fromMeals:{mode:'drinks', updatedAt:null},
           containers:defaultContainers(), log:{} };
}
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
    water: blankWater(),  // hydratation : objectif + contenants + consommations par jour
    settings: {}
  };
}
function blankShared(){
  return { messages: [], dates: [] };   // espace commun à tous les profils (💌 Nous)
}
/* Un ancien enregistrement v1 (données à plat) devient un profil. */
function wrapV1(v1, nom){
  const d = blankProfileData();
  for(const k of Object.keys(d)) if(v1[k] !== undefined) d[k] = v1[k];
  return {schemaVersion:2, updatedAt: v1.updatedAt || nowIso(), shared: blankShared(),
          profiles:{ p1: {id:'p1', nom: nom||'Moi', createdAt: v1.updatedAt || nowIso(), updatedAt: v1.updatedAt || nowIso(), data:d} }};
}
/* Toute adoption d'un conteneur (chargement local, consultation, rechargement
   depuis le coffre) DOIT passer ici : complète les champs apparus depuis
   (water, mealCats…) sans jamais recréer ce qui a été supprimé (tombstones). */
function normalizeAll(all){
  if(!all.profiles || !Object.keys(all.profiles).length) return emptyContainer();
  for(const p of Object.values(all.profiles)){
    p.data = Object.assign(blankProfileData(), p.data || {});
    if(!p.data.water || typeof p.data.water !== 'object' || Array.isArray(p.data.water)) p.data.water = blankWater();
    else p.data.water = Object.assign({goal:null, fromMeals:null, containers:[], log:{}}, p.data.water);
    if(!p.data.water.fromMeals) p.data.water.fromMeals = {mode:'drinks', updatedAt:null};
  }
  all.shared = Object.assign(blankShared(), all.shared || {});
  return all;
}
function emptyContainer(){
  const id = 'p1';
  return {schemaVersion:2, updatedAt: nowIso(), shared: blankShared(),
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
    this.all = normalizeAll(this.all);
    // fige la migration tout de suite (évite de la refaire à chaque ouverture)
    if(wasV1) localStorage.setItem(STORE_KEY, JSON.stringify(this.all));
    return this.data;
  },
  save(){
    if(Sync.cfg) Sync.autoRO = false;      // un jeton d'écriture prime toujours sur la consultation
    if(Sync.autoRO){
      alert('👁 Mode consultation : tu regardes les données publiées, les modifications ne sont pas enregistrées.\n(Pour tenir ton propre suivi sur cet appareil : ⚙️ Réglages → « Mon propre suivi ».)');
      fetch(DATA_URL(Sync.FILE), {cache:'no-store'}).then(r=>r.ok?r.json():null).then(d=>{
        if(d){ this.all = normalizeAll((d.schemaVersion===2) ? d : wrapV1(d)); document.dispatchEvent(new CustomEvent('storechange')); }
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
  lastSyncAt: null,
  _timer: null,
  _sha: null,
  _pulling: null,             // promesse en cours (évite les pulls concurrents)
  _lastPull: 0,

  setStatus(s, err){
    this.status = s; this.lastError = err || null;
    const el = document.getElementById('syncBadge');
    if(!el) return;
    const ic = this.autoRO ? '👁' : '☁️';
    if(s === 'off'){
      // Silence = piège : l'utilisateur croit être synchronisé alors que tout reste local.
      el.textContent = '📵';
      el.title = 'Cet appareil n\'est PAS synchronisé — données locales uniquement. ⚙️ Réglages pour activer.';
      el.style.cursor = 'pointer';
      return;
    }
    if(this.dirty && s !== 'syncing'){       // des modifs attendent d'être envoyées
      el.textContent = ic + '↑';
      el.title = 'Modifications en attente d\'envoi' + (err ? ' — ' + err : '');
      return;
    }
    el.textContent = s==='ok' ? ic+'✓' : s==='syncing' ? ic+'…' : ic+'⚠️';
    el.title = s==='error' ? ('Sync : ' + (err||'erreur'))
             : (this.autoRO?'Consultation seule · ':'') + 'synchronisé' +
               (this.lastSyncAt ? ' à ' + new Date(this.lastSyncAt).toLocaleTimeString('fr-FR') : '');
  },
  /* "sale" = des changements locaux ne sont pas encore confirmés côté serveur.
     Persisté : si l'app est fermée avant l'envoi, on réessaiera à la réouverture. */
  get dirty(){ return localStorage.getItem('ob.dirty') === '1'; },
  set dirty(v){ v ? localStorage.setItem('ob.dirty','1') : localStorage.removeItem('ob.dirty'); },

  api(path, init={}){
    const c = this.cfg;
    const isRead = !init.method || init.method === 'GET';
    // ⚠️ l'API GitHub répond Cache-Control: max-age=60 → sans ça, on relit une copie périmée
    // `ref` cible la branche de données (le code reste sur main).
    const q = isRead ? `?ref=${DATA_BRANCH}&_=${Date.now()}` : '';
    return fetch(`https://api.github.com/repos/${c.owner}/${c.repo}/contents/${path}${q}`, {
      cache: 'no-store',
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
    // ⚠️ une date manquante vaut "" : sans ça, la comparaison est toujours fausse
    // et la version locale gagnerait indéfiniment (donnée figée pour toujours).
    const ts = x => (x && x.updatedAt) || '';
    const newer = (a,b) => (!a ? b : !b ? a : (ts(a) >= ts(b) ? a : b));
    for(const k of Object.keys(remote.weights||{})) out.weights[k] = newer(out.weights[k], remote.weights[k]);
    for(const k of Object.keys(remote.gym||{}))     out.gym[k]     = newer(out.gym[k],     remote.gym[k]);
    for(const k of Object.keys(remote.journal||{})) out.journal[k] = newer(out.journal[k], remote.journal[k]);
    for(const coll of ['foods','recipes']){
      const byId = Object.fromEntries((out[coll]||[]).map(x=>[x.id,x]));
      for(const r of (remote[coll]||[])){
        if(!byId[r.id] || ts(r) > ts(byId[r.id])) byId[r.id] = r;
      }
      out[coll] = Object.values(byId);
    }
    out.tdee = newer(out.tdee, remote.tdee);
    // hydratation : objectif LWW · contenants par id · consommations par ID à
    // l'intérieur de chaque jour (deux appareils peuvent en créer le même jour)
    {
      const rw = remote.water || {};
      const w = Object.assign({goal:null, fromMeals:null, containers:[], log:{}}, out.water || {});
      w.goal = newer(w.goal, rw.goal || null);
      w.fromMeals = newer(w.fromMeals, rw.fromMeals || null) || {mode:'drinks', updatedAt:null};
      const cById = Object.fromEntries((w.containers||[]).map(c=>[c.id,c]));
      for(const rc of (rw.containers||[])){
        if(!cById[rc.id] || ts(rc) > ts(cById[rc.id])) cById[rc.id] = rc;
      }
      w.containers = Object.values(cById);
      for(const [dayK, rday] of Object.entries(rw.log||{})){
        const lday = w.log[dayK];
        if(!lday){ w.log[dayK] = rday; continue; }
        const eById = Object.fromEntries((lday.entries||[]).map(e=>[e.id,e]));
        for(const re of (rday.entries||[])){
          if(!eById[re.id] || ts(re) > ts(eById[re.id])) eById[re.id] = re;
        }
        w.log[dayK] = {
          entries: Object.values(eById).sort((x,y)=>(x.at||'').localeCompare(y.at||'')),
          updatedAt: (rday.updatedAt||'') > (lday.updatedAt||'') ? rday.updatedAt : lday.updatedAt
        };
      }
      out.water = w;
    }
    if(remote.mealCatsUpdatedAt && (!out.mealCatsUpdatedAt || remote.mealCatsUpdatedAt > out.mealCatsUpdatedAt)){
      out.mealCats = remote.mealCats; out.mealCatsUpdatedAt = remote.mealCatsUpdatedAt;
    }
    out.settings = {...(remote.settings||{}), ...(out.settings||{})};
    return out;
  },
  // fusion de l'espace partagé (messages + dates)
  mergeShared(local, remote){
    const out = Object.assign(blankShared(), JSON.parse(JSON.stringify(local||{})));
    // messages : union par id ; si présent des deux côtés, le plus récemment modifié gagne
    const byId = Object.fromEntries((out.messages||[]).map(m=>[m.id,m]));
    for(const rm of (remote.messages||[])){
      if(!byId[rm.id] || (rm.updatedAt||rm.at) > (byId[rm.id].updatedAt||byId[rm.id].at)) byId[rm.id] = rm;
    }
    out.messages = Object.values(byId).sort((a,b)=>(a.at||'').localeCompare(b.at||'')).slice(-500);
    // dates : union par id, last-write-wins
    const dById = Object.fromEntries((out.dates||[]).map(d=>[d.id,d]));
    for(const rd of (remote.dates||[])){
      if(!dById[rd.id] || (rd.updatedAt||'') > (dById[rd.id].updatedAt||'')) dById[rd.id] = rd;
    }
    out.dates = Object.values(dById);
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
    out.shared = this.mergeShared(out.shared, remote.shared || {});
    return out;
  },
  async pull(opts={}){
    if(!this.cfg) return;
    // Ne jamais remplacer les données sous les pieds d'une saisie en cours :
    // une fenêtre ouverte (recette, date, réglages…) serait détachée du store.
    if(!opts.force && document.querySelector('.modal-bg')) return;
    if(this._pulling) return this._pulling;          // un seul pull à la fois
    this._pulling = (async ()=>{
      this.setStatus('syncing');
      try{
        const res = await this.api(this.FILE);
        if(res.status === 404){ this._sha = null; this._lastPull = Date.now(); this.setStatus('ok'); return; }
        if(!res.ok) throw new Error('HTTP ' + res.status);
        const j = await res.json();
        this._sha = j.sha;
        const remote = JSON.parse(decodeURIComponent(escape(atob(j.content.replace(/\n/g,'')))));
        Store.all = normalizeAll(this.merge(Store.all, remote));
        localStorage.setItem(STORE_KEY, JSON.stringify(Store.all));
        this._lastPull = Date.now(); this.lastSyncAt = Date.now();
        document.dispatchEvent(new CustomEvent('profilechange'));
        document.dispatchEvent(new CustomEvent('storechange'));
        this.setStatus('ok');
      }catch(e){ this.setStatus('error', e.message); }
      finally{ this._pulling = null; }
    })();
    return this._pulling;
  },
  /* Synchronisation complète : on récupère puis on renvoie ce qui attend. */
  async syncNow(force){
    if(!this.cfg) return;
    if(!force && Date.now() - this._lastPull < 4000) { if(this.dirty) await this.push(); return; }
    await this.pull({force});
    if(this.dirty) await this.push();
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
    const adopt = c => { Store.all = normalizeAll((c.schemaVersion===2) ? c : wrapV1(c)); };
    try{
      const res = await fetch(DATA_URL(this.FILE), {cache:'no-store'});
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
          const r = await fetch(DATA_URL(this.FILE), {cache:'no-store'});
          if(r.ok){ adopt(await r.json());
            document.dispatchEvent(new CustomEvent('profilechange'));
            document.dispatchEvent(new CustomEvent('storechange')); }
        }catch(e){}
      }, 5*60*1000);
    }catch(e){}
  },
  schedulePush(){
    this.dirty = true;                     // marqué AVANT l'envoi : survit à une fermeture
    if(!this.cfg){ this.setStatus(this.status); return; }
    clearTimeout(this._timer);
    this._timer = setTimeout(()=>this.push(), 1200);
    this.setStatus('syncing');
  },
  async push(attempt=0){
    if(!this.cfg || !this.dirty) return;
    clearTimeout(this._timer);
    this.setStatus('syncing');
    try{
      const payload = JSON.stringify(Store.all);
      const body = {
        message: 'perso: ' + nowIso(),
        content: btoa(unescape(encodeURIComponent(payload))),
        branch: DATA_BRANCH,
      };
      if(this._sha) body.sha = this._sha;
      const res = await this.api(this.FILE, {method:'PUT', body: JSON.stringify(body)});
      if(res.status === 409 || res.status === 422){
        if(attempt >= 3) throw new Error('conflit non résolu');
        await this.pull();                      // récupère + fusionne + nouveau sha
        return this.push(attempt+1);
      }
      if(!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      this._sha = j.content.sha;
      this.dirty = false;                       // confirmé côté serveur
      this.lastSyncAt = Date.now();
      this.setStatus('ok');
    }catch(e){
      this.setStatus('error', e.message);       // reste "dirty" → réessai auto plus tard
      if(attempt < 3) setTimeout(()=>this.push(attempt+1), 5000 * (attempt+1));
    }
  },
  /* Dernière chance : l'app passe en arrière-plan ou se ferme.
     `keepalive` laisse la requête se terminer même après la fermeture de l'onglet. */
  flush(){
    if(!this.cfg || !this.dirty || !this._sha) return;
    clearTimeout(this._timer);
    try{
      const payload = JSON.stringify(Store.all);
      if(payload.length > 55000) { this.push(); return; }   // trop gros pour keepalive
      const c = this.cfg;
      fetch(`https://api.github.com/repos/${c.owner}/${c.repo}/contents/${this.FILE}`, {
        method:'PUT', keepalive:true,
        headers:{'Accept':'application/vnd.github+json','Authorization':'Bearer '+c.token,'X-GitHub-Api-Version':'2022-11-28'},
        body: JSON.stringify({message:'perso: '+nowIso(),
          content: btoa(unescape(encodeURIComponent(payload))), sha:this._sha, branch:DATA_BRANCH})
      }).then(r=>{ if(r.ok) this.dirty = false; }).catch(()=>{});
    }catch(e){}
  },
  /* Réveils : reprise d'onglet, retour de veille, intervalle régulier. */
  installLifecycle(){
    // `wake` ne force pas : si une fenêtre d'édition est ouverte, on ne touche à rien.
    const wake = ()=>{ if(document.visibilityState === 'visible') this.syncNow(); };
    document.addEventListener('visibilitychange', ()=>{
      if(document.visibilityState === 'hidden') this.flush(); else wake();
    });
    window.addEventListener('pageshow', e=>{ if(e.persisted) wake(); });   // retour bfcache (iOS)
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    window.addEventListener('pagehide', ()=>this.flush());
    setInterval(wake, 45000);                    // filet régulier tant que l'app est ouverte
  }
};

/* ===== Apparence (par profil : thème, accent, bulles, compagnon) ===== */
const THEMES = [
  {id:'nuit', nom:'Nuit',          emo:'🌙', mini:['#0e0f22','#191b3d','#5d8bf4','#ff8a3d']},
  {id:'aero', nom:'Frutiger Aero', emo:'🫧', mini:['#5db3e6','#e8f7ff','#0a86c9','#ff8a00']},
  {id:'rose', nom:'Rose bonbon',   emo:'🍓', mini:['#ffd3e8','#fff6fa','#f4569d','#22a566']},
  {id:'neon', nom:'Néon pixel',    emo:'🌌', mini:['#12041f','#1c0b31','#00ffa3','#ff4dd8']},
];
const PETS = ['🐧','🐸','🐱','🐰','🍓','⭐','🫧','🦆','🐢','🌸'];

function appearance(){ return (Store.data.settings && Store.data.settings.appearance) || {}; }

function applyAppearance(){
  const a = appearance();
  document.body.dataset.theme = a.theme || 'nuit';
  const root = document.documentElement;
  if(a.accent) root.style.setProperty('--line', a.accent);
  else root.style.removeProperty('--line');

  // la barre système (mobile) suit le thème
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute('content', cssVar('--navbg') || '#0e0f22');

  // bulles flottantes
  let b = document.getElementById('bubbles');
  if(a.bubbles){
    if(!b){
      b = document.createElement('div'); b.id = 'bubbles'; b.setAttribute('aria-hidden','true');
      let h = '';
      for(let i=0;i<12;i++){
        const s = 8+Math.random()*26, l = Math.random()*100, d = 8+Math.random()*9, dl = Math.random()*9;
        h += `<i style="left:${l}%;width:${s}px;height:${s}px;animation-duration:${d}s;animation-delay:-${dl}s"></i>`;
      }
      b.innerHTML = h;
      document.body.appendChild(b);
    }
  } else if(b) b.remove();

  // compagnon (bouton accessible : un tap = un cœur)
  let p = document.getElementById('pet');
  if(a.pet){
    if(!p){
      p = document.createElement('button'); p.id = 'pet'; p.type = 'button';
      p.setAttribute('aria-label','Compagnon — envoyer un cœur');
      p.innerHTML = '<span aria-hidden="true"></span>';
      p.addEventListener('click', ()=>{
        const h = document.createElement('span');
        h.className = 'heart'; h.textContent = '💗';
        p.appendChild(h); setTimeout(()=>h.remove(), 950);
      });
      document.body.appendChild(p);
    }
    p.querySelector('span:not(.heart)').textContent = a.pet;
  } else if(p) p.remove();
}

function setAppearance(patch){
  if(!Store.data.settings) Store.data.settings = {};
  Store.data.settings.appearance = {...appearance(), ...patch};
  Store.save();
  applyAppearance();
}

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
      <div class="modal" role="dialog" aria-label="Profils">
        <h3>👤 Profils</h3>
        <p class="set-note">Chaque profil a ses propres pesées, repas, séances, hydratation et TDEE.
        Le profil choisi est propre à <b>cet appareil</b> : chacun garde le sien, même coffre partagé.</p>
        <div class="list">
          ${list.map(p=>{
            const d = p.data;
            const w = Object.keys(d.weights).length, g = Object.keys(d.gym).length;
            return `<div class="prof-row ${p.id===activeId?'on':''}">
              <div class="grow" data-pick="${p.id}" role="button" tabindex="0">
                <div class="nom">${p.id===activeId?'✅ ':''}${esc(p.nom)}</div>
                <div class="sub">${w} pesée(s) · ${g} séance(s) · ${d.recipes.filter(r=>!r.deleted).length} plat(s)${d.tdee?' · TDEE ✓':''}</div>
              </div>
              <button class="li-x" data-ren="${p.id}" title="Renommer" aria-label="Renommer ${esc(p.nom)}">✎</button>
              ${list.length>1?`<button class="li-x" data-del="${p.id}" title="Supprimer" aria-label="Supprimer ${esc(p.nom)}">🗑</button>`:''}
            </div>`;
          }).join('')}
        </div>
        <div class="actions">
          <button class="btn primary" id="pfNew">＋ Nouveau profil</button>
          <button class="btn" id="pfClose">Fermer</button>
        </div>
      </div>`;

    bg.querySelectorAll('[data-pick]').forEach(el=>{
      const pick = ()=>{ Store.setActive(el.dataset.pick); close(); toast('👤 Profil « '+esc(Store.active.nom)+' »'); };
      el.addEventListener('click', pick);
      el.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); pick(); } });
    });
    bg.querySelectorAll('[data-ren]').forEach(b=>b.addEventListener('click', ()=>{
      const p = Store.all.profiles[b.dataset.ren];
      const v = prompt('Nom du profil :', p.nom);
      if(v && v.trim()){ Store.renameProfile(p.id, v); draw(); }
    }));
    bg.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click', ()=>{
      const p = Store.all.profiles[b.dataset.del];
      if(!confirm(`Supprimer le profil « ${p.nom} » et toutes ses données (pesées, repas, séances, hydratation) ?\nCette action est définitive.`)) return;
      Store.deleteProfile(p.id); draw();
    }));
    bg.querySelector('#pfNew').addEventListener('click', ()=>{
      const v = prompt('Nom du nouveau profil :');
      if(v && v.trim()){ Store.addProfile(v); close(); }
    });
    bg.querySelector('#pfClose').addEventListener('click', close);
  }
  draw();
}

/* ===== Réglages (modale, groupes clairs) ===== */
function openSettings(){
  const c = Sync.cfg || {owner:'CoverSurGitHub', repo:'orange-bleue-affluence', token:''};
  const ap = appearance();
  const goalW = Store.data.settings.objectifPoids;
  const goalMl = (Store.data.water && Store.data.water.goal && Store.data.water.goal.ml) || '';
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `
    <div class="modal" role="dialog" aria-label="Réglages">
      <h3>⚙️ Réglages <span class="small muted" style="font-weight:400">v${APP_VERSION}</span></h3>

      <div class="set-group">
        <h2>👤 Profil</h2>
        <div class="row" style="margin:0">
          <div><b>${esc(Store.active.nom)}</b><div class="small muted">profil actif sur cet appareil</div></div>
          <button class="btn" id="setProfiles">Gérer les profils</button>
        </div>
      </div>

      <div class="set-group">
        <h2>🎯 Objectifs</h2>
        <div class="fieldrow">
          <div class="field"><label for="setGoalW">Poids cible (kg)</label>
            <input type="number" id="setGoalW" inputmode="decimal" step="0.1" min="20" max="400" value="${goalW ?? ''}" placeholder="—"></div>
          <div class="field"><label for="setGoalMl">Eau par jour (ml)</label>
            <input type="number" id="setGoalMl" inputmode="numeric" step="50" min="250" max="8000" value="${goalMl}" placeholder="2000"></div>
        </div>
        <button class="btn" id="setGoalSave" style="width:100%">Enregistrer les objectifs</button>
      </div>

      <div class="set-group">
        <h2>🎨 Apparence <span class="h2sub">— suit le profil « ${esc(Store.active.nom)} »</span></h2>
        <div class="thm-grid" role="group" aria-label="Thème">
          ${THEMES.map(t=>`
            <button type="button" class="thm-card ${(ap.theme||'nuit')===t.id?'on':''}" data-thm="${t.id}" aria-pressed="${(ap.theme||'nuit')===t.id}">
              <span class="thm-mini" style="background:${t.mini[0]}" aria-hidden="true">
                <i style="width:26px;height:16px;background:${t.mini[1]};border-radius:4px"></i>
                <i style="width:12px;height:12px;background:${t.mini[2]}"></i>
                <i style="width:8px;height:8px;background:${t.mini[3]}"></i>
              </span>
              <span class="thm-name">${t.emo} ${t.nom}</span>
            </button>`).join('')}
        </div>
        <div class="fieldrow" style="margin-top:10px">
          <div class="field"><label for="apAccent">Couleur d'accent</label>
            <div style="display:flex;gap:6px;align-items:center">
              <input type="color" id="apAccent" value="${esc(ap.accent||'#5d8bf4')}" aria-label="Couleur d'accent"
                     style="min-height:44px;width:64px;padding:2px;background:var(--field);border:1px solid var(--line2);border-radius:10px">
              <button class="btn" id="apAccentReset" title="Revenir à la couleur du thème">↺</button>
            </div>
          </div>
          <div class="field"><label for="apPet">Compagnon</label>
            <select id="apPet">
              <option value="">— aucun —</option>
              ${PETS.map(p=>`<option value="${p}" ${ap.pet===p?'selected':''}>${p}</option>`).join('')}
            </select>
          </div>
        </div>
        <label class="small" style="display:flex;align-items:center;gap:8px;margin-top:4px;cursor:pointer">
          <input type="checkbox" id="apBubbles" ${ap.bubbles?'checked':''} style="min-height:0;width:20px;height:20px">
          🫧 Bulles flottantes
        </label>
      </div>

      <div class="set-group">
        <h2>☁️ Synchronisation</h2>
        <p class="set-note">Avec un jeton : tes données s'enregistrent dans le coffre et se retrouvent sur tous tes appareils.
        Sans jeton : consultation seule ou données locales. ⚠️ Le coffre vit dans un dépôt public.
        État : <b>${Sync.cfg ? 'écriture activée' : (Sync.autoRO ? 'consultation seule' : 'locale')}</b></p>
        <div class="fieldrow">
          <div class="field"><label for="syncOwner">Propriétaire</label><input id="syncOwner" type="text" value="${esc(c.owner)}" autocapitalize="off"></div>
          <div class="field"><label for="syncRepo">Dépôt</label><input id="syncRepo" type="text" value="${esc(c.repo)}" autocapitalize="off"></div>
        </div>
        <div class="field"><label for="syncToken">Jeton (fine-grained, Contents RW sur ce dépôt)</label>
          <input id="syncToken" type="password" value="${esc(c.token)}" placeholder="github_pat_…" autocomplete="off"></div>
        <div class="actions" style="margin-top:4px">
          <button class="btn primary" id="syncSave">Activer l'écriture</button>
          <button class="btn" id="syncNow">🔄 Synchroniser</button>
        </div>
        <div class="small muted" id="syncInfo" style="margin-top:8px" aria-live="polite"></div>
      </div>

      <div class="set-group">
        <h2>💾 Sauvegarde</h2>
        <div style="display:flex;gap:8px">
          <button class="btn" id="expBtn" style="flex:1">⬇️ Exporter (JSON)</button>
          <button class="btn" id="impBtn" style="flex:1">⬆️ Importer</button>
          <input type="file" id="impFile" accept=".json" style="display:none" aria-hidden="true">
        </div>
      </div>

      ${Sync.autoRO ? `<div class="set-group">
        <h2>👁 Consultation seule</h2>
        <p class="set-note">Cet appareil affiche les données publiées par le propriétaire, sans pouvoir les modifier.</p>
        <button class="btn" id="optOut" style="width:100%">✍️ Tenir mon propre suivi sur cet appareil</button>
      </div>` : ''}

      <div class="set-group set-danger">
        <h2>⚠️ Zone sensible</h2>
        <button class="btn" id="syncForce" style="width:100%">⬇️ Tout recharger depuis le coffre</button>
        <p class="set-note" style="margin:6px 0 10px">Si cet appareil reste bloqué sur une vieille version : ses données
        locales sont remplacées par celles du coffre.</p>
        ${Sync.cfg ? '<button class="btn danger" id="syncOff" style="width:100%">Désactiver la synchronisation sur cet appareil</button>' : ''}
      </div>

      <div class="actions"><button class="btn" id="setClose">Fermer</button></div>
    </div>`;
  document.body.appendChild(bg);
  const close = ()=>bg.remove();
  bg.addEventListener('click', e=>{ if(e.target===bg) close(); });
  bg.querySelector('#setClose').addEventListener('click', close);
  bg.querySelector('#setProfiles').addEventListener('click', ()=>{ close(); openProfiles(); });

  /* --- objectifs --- */
  bg.querySelector('#setGoalSave').addEventListener('click', ()=>{
    const vw = parseFloat(String(bg.querySelector('#setGoalW').value).replace(',','.'));
    if(Number.isFinite(vw) && vw>0) Store.data.settings.objectifPoids = Math.round(vw*10)/10;
    else delete Store.data.settings.objectifPoids;
    const vm = parseInt(bg.querySelector('#setGoalMl').value, 10);
    if(Number.isFinite(vm) && vm>=250) Store.data.water.goal = {ml:vm, updatedAt:nowIso()};
    Store.save();
    toast('🎯 Objectifs enregistrés');
    close();
  });

  /* --- synchronisation --- */
  bg.querySelector('#syncSave').addEventListener('click', async ()=>{
    const owner = bg.querySelector('#syncOwner').value.trim();
    const repo  = bg.querySelector('#syncRepo').value.trim();
    const token = bg.querySelector('#syncToken').value.trim();
    if(!owner || !repo || !token){ alert('Remplis les 3 champs.'); return; }
    Sync.cfg = {owner, repo, token};
    Sync.autoRO = false;
    localStorage.setItem('ob.optOutRO','1');
    await Sync.pull({force:true});
    if(Sync.status === 'error'){ alert('Échec de connexion : ' + Sync.lastError + '\nVérifie le jeton et le nom du dépôt.'); Sync.cfg = null; }
    else { Sync.schedulePush(); toast('☁️ Écriture activée — données synchronisées'); close(); }
  });
  const offBtn = bg.querySelector('#syncOff');
  if(offBtn) offBtn.addEventListener('click', ()=>{
    if(!confirm('Désactiver la synchronisation sur CET appareil ?\nTes données restent locales et dans le coffre, mais ne circulent plus.')) return;
    Sync.cfg = null; Sync.setStatus('off'); close();
  });
  const info = bg.querySelector('#syncInfo');
  const paintInfo = async ()=>{
    if(!info) return;
    if(!Sync.cfg){
      info.innerHTML = '<b style="color:var(--warn)">📵 Cet appareil n\'est pas synchronisé.</b> '
        + 'Tes saisies restent ici. Colle le jeton ci-dessus pour le relier au coffre.';
      return;
    }
    let distant = '…';
    try{
      const r = await Sync.api(Sync.FILE);
      if(r.ok){
        const j = await r.json();
        const cc = JSON.parse(decodeURIComponent(escape(atob(j.content.replace(/\n/g,'')))));
        distant = cc.updatedAt ? new Date(cc.updatedAt).toLocaleString('fr-FR') : 'inconnu';
      } else distant = 'HTTP ' + r.status;
    }catch(e){ distant = 'injoignable'; }
    info.innerHTML =
      (Sync.dirty ? '⏳ <b>Modifications en attente d\'envoi.</b><br>' : '✅ Tout est enregistré.<br>')
      + 'Cet appareil : <b>' + (Store.all.updatedAt ? new Date(Store.all.updatedAt).toLocaleString('fr-FR') : '—') + '</b><br>'
      + 'Le coffre : <b>' + esc(distant) + '</b>'
      + (Sync.lastError ? '<br><span style="color:var(--bad)">Erreur : '+esc(Sync.lastError)+'</span>' : '');
  };
  paintInfo();
  const forceBtn = bg.querySelector('#syncForce');
  forceBtn.addEventListener('click', async ()=>{
    if(!Sync.cfg){ alert('Active d\'abord la synchronisation (jeton).'); return; }
    if(!confirm('Remplacer TOUTES les données de cet appareil par celles du coffre ?\n\n'
      + 'À faire seulement si cet appareil affiche une version périmée.\n'
      + 'Ce qui n\'a pas encore été envoyé depuis CET appareil sera perdu.')) return;
    forceBtn.disabled = true; forceBtn.textContent = '…';
    try{
      const r = await Sync.api(Sync.FILE);
      if(!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const cc = JSON.parse(decodeURIComponent(escape(atob(j.content.replace(/\n/g,'')))));
      Store.all = normalizeAll((cc.schemaVersion === 2) ? cc : wrapV1(cc));
      Sync._sha = j.sha; Sync.dirty = false;
      localStorage.setItem(STORE_KEY, JSON.stringify(Store.all));
      document.dispatchEvent(new CustomEvent('profilechange'));
      document.dispatchEvent(new CustomEvent('storechange'));
      Sync.setStatus('ok');
      toast('⬇️ Rechargé depuis le coffre');
      close();
    }catch(e){ alert('Échec : ' + e.message); }
    forceBtn.disabled = false; forceBtn.textContent = '⬇️ Tout recharger depuis le coffre';
  });
  const syncBtn = bg.querySelector('#syncNow');
  syncBtn.addEventListener('click', async ()=>{
    syncBtn.disabled = true; syncBtn.textContent = '…';
    await Sync.syncNow(true);
    syncBtn.disabled = false; syncBtn.textContent = '🔄 Synchroniser';
    paintInfo();
    if(!Sync.dirty && !Sync.lastError) toast('☁️ Synchronisé');
  });

  /* --- apparence --- */
  bg.querySelectorAll('[data-thm]').forEach(b=>b.addEventListener('click', ()=>{
    setAppearance({theme:b.dataset.thm});
    bg.querySelectorAll('[data-thm]').forEach(x=>{
      const on = x===b;
      x.classList.toggle('on', on);
      x.setAttribute('aria-pressed', on);
    });
  }));
  bg.querySelector('#apAccent').addEventListener('change', e=>setAppearance({accent:e.target.value}));
  bg.querySelector('#apAccentReset').addEventListener('click', ()=>{
    setAppearance({accent:null}); bg.querySelector('#apAccent').value = '#5d8bf4';
  });
  bg.querySelector('#apPet').addEventListener('change', e=>setAppearance({pet:e.target.value||null}));
  bg.querySelector('#apBubbles').addEventListener('change', e=>setAppearance({bubbles:e.target.checked}));

  /* --- consultation seule --- */
  const optOut = bg.querySelector('#optOut');
  if(optOut) optOut.addEventListener('click', ()=>{
    if(!confirm('Cet appareil quittera la consultation et tiendra un suivi local vierge. Continuer ?')) return;
    localStorage.setItem('ob.optOutRO','1');
    localStorage.removeItem(STORE_KEY);
    location.reload();
  });

  /* --- sauvegarde --- */
  bg.querySelector('#expBtn').addEventListener('click', ()=>{
    const blob = new Blob([JSON.stringify(Store.all, null, 1)], {type:'application/json'});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'perso-' + todayKey() + '.json';
    link.click();
  });
  bg.querySelector('#impBtn').addEventListener('click', ()=>bg.querySelector('#impFile').click());
  bg.querySelector('#impFile').addEventListener('change', e=>{
    const f = e.target.files[0]; if(!f) return;
    const r = new FileReader();
    r.onload = ()=>{
      try{
        const imported = JSON.parse(r.result);
        if(imported.schemaVersion !== 1 && imported.schemaVersion !== 2) throw new Error('format inconnu');
        Store.all = normalizeAll(Sync.merge(Store.all, imported));
        Store.save();
        document.dispatchEvent(new CustomEvent('profilechange'));
        toast('⬆️ Import fusionné');
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
  const badge = document.getElementById('syncBadge');
  badge.addEventListener('click', openSettings);
  badge.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); openSettings(); } });
  document.getElementById('btnProfile').addEventListener('click', openProfiles);
  document.addEventListener('profilechange', refreshProfileButton);
  document.addEventListener('profilechange', applyAppearance);
  document.addEventListener('storechange', applyAppearance);
  refreshProfileButton();
  applyAppearance();
  const wanted = localStorage.getItem('ob.lastPage');
  showPage(PAGES.includes(wanted) ? wanted : 'salle');
  if(Sync.cfg){
    Sync.installLifecycle();
    Sync.syncNow(true);          // récupère, puis renvoie ce qui restait en attente
  } else {
    Sync.tryAutoRO();
  }
});
