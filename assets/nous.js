/* ===== 💌 Nous : petit courrier + demandes de date =====
   Espace COMMUN aux profils (Store.all.shared), synchronisé via le coffre.
   Messages : texte, kaomojis, stickers, GIF/image par URL, réaction ❤️.
   Dates : objet/date/heure/lieu/message, accepter/refuser, .ics (iPhone),
   lien Plans, compte à rebours. Rafraîchi ~45 s quand la page est ouverte. */
'use strict';
(function(){

let tab = 'msg';            // 'msg' | 'dates'
let pollTimer = null;
const SEEN_KEY = 'ob.nousSeen';

const KAOMOJIS = ['(｡♥‿♥｡)','(◕‿◕)♡','ʕ•ᴥ•ʔ','(＾▽＾)','(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧','₍ᐢ. .ᐢ₎','(๑˃̵ᴗ˂̵)','(≧◡≦)','( ˘ ³˘)♥','(￣3￣)♡','(っ◔◡◔)っ ♥','･ﾟ✧(=✪ ᆺ ✪=)','(ᵔᴥᵔ)','♡(˃͈ દ ˂͈ ༶ )','(✿◠‿◠)','ლ(╹◡╹ლ)','(⁄ ⁄•⁄ω⁄•⁄ ⁄)','☆ミ(o*･ω･)ﾉ','(￢‿￢ )','(ง •̀_•́)ง','(¬_¬")','(T_T)','(╥﹏╥)','✧･ﾟ: *✧'];
const STICKERS = ['💗','😘','🥺','😹','🐧','🍓','🫶','😴','🏋️','🍕','🌈','⭐','🎀','🦋','🌸','💪','🤍','🔥','🥐','🧸','🐸','👀','💤','🎮'];

const shared = () => Store.all.shared;
const me     = () => ({pid: Store.activeId, nom: Store.active.nom});
const esc2   = s => esc(String(s??''));
const fmtAt  = iso => new Date(iso).toLocaleString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});

/* ---------- badge non-lu sur l'onglet 💌 ---------- */
function updateDot(){
  const seen = localStorage.getItem(SEEN_KEY) || '';
  const unread = shared().messages.some(m => !m.deleted && m.from.pid !== Store.activeId && m.at > seen)
             || shared().dates.some(d => d.from.pid !== Store.activeId && (d.updatedAt||'') > seen);
  const dot = document.getElementById('nousDot');
  if(dot) dot.style.display = unread ? '' : 'none';
}
function markSeen(){ localStorage.setItem(SEEN_KEY, nowIso()); updateDot(); }

/* ---------- messages ---------- */
function renderMsg(){
  const el = document.getElementById('nMsg');
  const msgs = shared().messages.filter(m=>!m.deleted);
  const mine = Store.activeId;

  el.innerHTML = `
    <div class="card">
      <div class="chat" id="chatList">
        ${msgs.length ? msgs.map(m=>{
          const isMine = m.from.pid === mine;
          const reacts = Object.entries(m.reactions||{}).filter(([,v])=>v.length)
                          .map(([e,v])=>e+(v.length>1?v.length:'')).join(' ');
          return `<div class="msg ${isMine?'mine':'theirs'}" data-id="${m.id}">
            <div class="who">${esc2(m.from.nom)}</div>
            ${m.sticker ? `<span class="sticker">${esc2(m.sticker)}</span>` : ''}
            ${m.text ? esc2(m.text).replace(/\n/g,'<br>') : ''}
            ${m.img ? `<img src="${esc2(m.img)}" alt="" loading="lazy" onerror="this.replaceWith('🖼️ image indisponible')">` : ''}
            <div class="when">${fmtAt(m.at)}${isMine?` · <span data-delmsg="${m.id}" style="cursor:pointer">🗑</span>`:''}</div>
            <span class="reacts" data-react="${m.id}">${reacts || '♡'}</span>
          </div>`;
        }).join('') : '<div class="empty">Aucun message — écris le premier 💌</div>'}
      </div>
      <div class="mini-tools">
        <button id="mkKao" title="Kaomojis">(^‿^)</button>
        <button id="mkStk" title="Stickers">🧸</button>
        <button id="mkGif" title="GIF / image par URL">🖼️</button>
      </div>
      <div id="pickzone"></div>
      <div class="composer">
        <textarea id="msgInput" rows="1" placeholder="Écris un petit mot…"></textarea>
        <button class="btn primary" id="msgSend" style="min-height:46px">➤</button>
      </div>
    </div>`;

  const list = el.querySelector('#chatList');
  list.scrollTop = list.scrollHeight;
  // fait défiler la page vers le bas du fil au premier affichage
  requestAnimationFrame(()=>{ list.lastElementChild?.scrollIntoView({block:'nearest'}); });

  const input = el.querySelector('#msgInput');
  input.addEventListener('input', ()=>{ input.style.height='auto'; input.style.height=Math.min(120,input.scrollHeight)+'px'; });

  el.querySelector('#msgSend').addEventListener('click', ()=>{
    const text = input.value.trim();
    if(!text) return;
    pushMessage({text});
    input.value=''; input.style.height='auto';
  });

  // pickers
  const zone = el.querySelector('#pickzone');
  const togglePick = html => { zone.innerHTML = (zone.dataset.cur===html.slice(0,20)) ? '' : html; zone.dataset.cur = zone.innerHTML?html.slice(0,20):''; bindPicks(); };
  el.querySelector('#mkKao').addEventListener('click', ()=>togglePick(
    `<div class="pickpop">${KAOMOJIS.map(k=>`<button data-kao="${esc2(k)}">${esc2(k)}</button>`).join('')}</div>`));
  el.querySelector('#mkStk').addEventListener('click', ()=>togglePick(
    `<div class="pickpop">${STICKERS.map(s=>`<button class="big" data-stk="${s}">${s}</button>`).join('')}</div>`));
  el.querySelector('#mkGif').addEventListener('click', ()=>{
    const url = prompt('Colle l\'adresse du GIF ou de l\'image :\n(astuce : appui long sur un GIF → « Copier l\'adresse »)');
    if(!url) return;
    if(!/^https?:\/\//i.test(url.trim())){ alert('Adresse invalide (elle doit commencer par https://).'); return; }
    pushMessage({img:url.trim(), text:input.value.trim()||undefined});
    input.value='';
  });
  function bindPicks(){
    zone.querySelectorAll('[data-kao]').forEach(b=>b.addEventListener('click', ()=>{
      input.value += (input.value?' ':'') + b.dataset.kao; input.focus();
    }));
    zone.querySelectorAll('[data-stk]').forEach(b=>b.addEventListener('click', ()=>{
      pushMessage({sticker:b.dataset.stk});
      zone.innerHTML=''; zone.dataset.cur='';
    }));
  }

  // réactions ❤️ (tap sur la pastille) + suppression de ses messages
  el.querySelectorAll('[data-react]').forEach(r=>r.addEventListener('click', ()=>{
    const m = shared().messages.find(x=>x.id===r.dataset.react);
    if(!m) return;
    m.reactions = m.reactions || {};
    const arr = m.reactions['❤️'] = m.reactions['❤️'] || [];
    const i = arr.indexOf(Store.activeId);
    i>=0 ? arr.splice(i,1) : arr.push(Store.activeId);
    m.updatedAt = nowIso();
    Store.save(); renderMsg();
  }));
  el.querySelectorAll('[data-delmsg]').forEach(d=>d.addEventListener('click', ()=>{
    if(!confirm('Supprimer ce message ?')) return;
    const m = shared().messages.find(x=>x.id===d.dataset.delmsg);
    if(m){ m.deleted = true; m.updatedAt = nowIso(); Store.save(); renderMsg(); }
  }));
}

function pushMessage(fields){
  shared().messages.push({id:uid(), from:me(), at:nowIso(), updatedAt:nowIso(), ...fields});
  Store.save();
  renderMsg();
}

/* ---------- demandes de date ---------- */
function icsFor(d){
  const dt = (d.date||'').replace(/-/g,'');
  const hm = (d.heure||'19:00').replace(':','');
  const start = `${dt}T${hm}00`;
  const endH = String(Math.min(23,parseInt(d.heure||'19',10)+2)).padStart(2,'0');
  const end = `${dt}T${endH}${(d.heure||'19:00').slice(3,5)}00`;
  const escI = s => String(s??'').replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n');
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//masalle//dates//FR','BEGIN:VEVENT',
    `UID:${d.id}@masalle`,`DTSTAMP:${nowIso().replace(/[-:]/g,'').slice(0,15)}Z`,
    `DTSTART:${start}`,`DTEND:${end}`,
    `SUMMARY:💘 ${escI(d.objet)}`,
    d.lieu?`LOCATION:${escI(d.lieu)}`:'',
    d.message?`DESCRIPTION:${escI(d.message)}`:'',
    'END:VEVENT','END:VCALENDAR'].filter(Boolean).join('\r\n');
}
function downloadIcs(d){
  const blob = new Blob([icsFor(d)], {type:'text/calendar;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `date-${(d.objet||'rdv').toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,30)}.ics`;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function daysUntil(dateStr){
  const today = keyToDate(todayKey());
  const target = keyToDate(dateStr);
  return Math.round((target - today)/864e5);
}

function renderDates(){
  const el = document.getElementById('nDates');
  const mine = Store.activeId;
  const list = shared().dates.filter(d=>!d.deleted)
    .sort((a,b)=>(a.status==='pending'?0:1)-(b.status==='pending'?0:1) || (a.date||'').localeCompare(b.date||''));

  el.innerHTML = `
    <div class="card">
      <button class="btn primary" id="newDate" style="width:100%;font-size:.95rem;padding:13px">💘 Proposer un date</button>
    </div>
    ${list.length ? list.map(d=>{
      const isMine = d.from.pid === mine;
      const dj = d.date ? daysUntil(d.date) : null;
      const cd = (d.status==='accepted' && dj!==null && dj>=0)
        ? `<span class="countdown">${dj===0?'💗 c\'est aujourd\'hui !':'J-'+dj}</span>` : '';
      const stTxt = {pending:'en attente', accepted:'accepté 💚', declined:'refusé'}[d.status];
      const quand = d.date ? new Date(d.date+'T12:00').toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'}) : '?';
      return `<div class="date-card ${d.status}">
        <span class="status ${d.status}">${stTxt}</span>
        <div class="objet">${esc2(d.objet)}</div>
        <div class="meta">proposé par ${esc2(d.from.nom)}</div>
        <div class="quand">📅 ${quand}${d.heure?' · '+esc2(d.heure):''}${cd}</div>
        ${d.lieu?`<div class="meta">📍 ${esc2(d.lieu)}</div>`:''}
        ${d.message?`<div style="font-size:.88rem;margin-top:6px">💬 ${esc2(d.message)}</div>`:''}
        ${d.reply?`<div class="meta" style="margin-top:6px">↩️ ${esc2(d.reply)}</div>`:''}
        <div class="date-actions">
          ${(!isMine && d.status==='pending') ? `
            <button class="btn primary" data-acc="${d.id}">💚 Accepter</button>
            <button class="btn danger" data-dec="${d.id}">Décliner</button>` : ''}
          ${d.status!=='declined' ? `<button class="btn" data-ics="${d.id}">📅 Calendrier</button>` : ''}
          ${d.lieu ? `<a class="btn" style="text-decoration:none;display:inline-flex;align-items:center" target="_blank" rel="noopener"
              href="https://maps.apple.com/?q=${encodeURIComponent(d.lieu)}">🗺 Plans</a>` : ''}
          ${isMine ? `<button class="btn" data-deldate="${d.id}" title="Annuler">🗑</button>` : ''}
        </div>
      </div>`;
    }).join('') : '<div class="empty">Aucune proposition pour l\'instant… lance-toi 💘</div>'}`;

  el.querySelector('#newDate').addEventListener('click', openDateForm);
  el.querySelectorAll('[data-acc]').forEach(b=>b.addEventListener('click', ()=>{
    const d = shared().dates.find(x=>x.id===b.dataset.acc);
    const note = prompt('Un petit mot avec ta réponse ? (optionnel)') || '';
    d.status='accepted'; if(note.trim()) d.reply=note.trim();
    d.updatedAt=nowIso(); Store.save(); renderDates();
  }));
  el.querySelectorAll('[data-dec]').forEach(b=>b.addEventListener('click', ()=>{
    const d = shared().dates.find(x=>x.id===b.dataset.dec);
    const note = prompt('Explique en un mot ? (optionnel, sois gentil·le 🥺)') || '';
    d.status='declined'; if(note.trim()) d.reply=note.trim();
    d.updatedAt=nowIso(); Store.save(); renderDates();
  }));
  el.querySelectorAll('[data-ics]').forEach(b=>b.addEventListener('click', ()=>{
    downloadIcs(shared().dates.find(x=>x.id===b.dataset.ics));
  }));
  el.querySelectorAll('[data-deldate]').forEach(b=>b.addEventListener('click', ()=>{
    if(!confirm('Annuler cette proposition ?')) return;
    const d = shared().dates.find(x=>x.id===b.dataset.deldate);
    d.deleted=true; d.updatedAt=nowIso(); Store.save(); renderDates();
  }));
}

function openDateForm(){
  const bg = document.createElement('div');
  bg.className='modal-bg';
  bg.innerHTML = `
    <div class="modal">
      <h3>💘 Proposer un date</h3>
      <div class="field"><label>Objet *</label><input type="text" id="dObj" placeholder="Resto italien, ciné, balade…" maxlength="60"></div>
      <div class="fieldrow">
        <div class="field"><label>Date *</label><input type="date" id="dDate" min="${todayKey()}" value="${todayKey()}"
             style="background:var(--field);color:var(--text);border:1px solid var(--line2);border-radius:10px;padding:10px;min-height:44px"></div>
        <div class="field"><label>Heure</label><input type="time" id="dHeure" value="19:30"
             style="background:var(--field);color:var(--text);border:1px solid var(--line2);border-radius:10px;padding:10px;min-height:44px"></div>
      </div>
      <div class="field"><label>Lieu (pour le lien Plans)</label><input type="text" id="dLieu" placeholder="Ex : Big Fernand, Orgeval"></div>
      <div class="field"><label>Petit message</label><input type="text" id="dMsg" placeholder="Habille-toi bien 😏" maxlength="140"></div>
      <div class="actions">
        <button class="btn primary" id="dSend">💌 Envoyer la proposition</button>
        <button class="btn" id="dCancel">Annuler</button>
      </div>
    </div>`;
  document.body.appendChild(bg);
  const close=()=>bg.remove();
  bg.addEventListener('click',e=>{ if(e.target===bg) close(); });
  bg.querySelector('#dCancel').addEventListener('click', close);
  bg.querySelector('#dSend').addEventListener('click', ()=>{
    const objet=bg.querySelector('#dObj').value.trim();
    const date=bg.querySelector('#dDate').value;
    if(!objet || !date){ alert('Il faut au moins un objet et une date 😉'); return; }
    shared().dates.push({id:uid(), from:me(), objet, date,
      heure:bg.querySelector('#dHeure').value||'', lieu:bg.querySelector('#dLieu').value.trim(),
      message:bg.querySelector('#dMsg').value.trim(), status:'pending',
      createdAt:nowIso(), updatedAt:nowIso()});
    Store.save();
    close(); renderDates();
    // le message d'accompagnement apparaît aussi dans le fil 💬
    pushMessage({text:`💘 Nouvelle proposition de date : « ${objet} » — va voir l'onglet Nos dates !`});
  });
}

/* ---------- onglets, rafraîchissement, init ---------- */
function render(){
  document.getElementById('nTabMsg').classList.toggle('active', tab==='msg');
  document.getElementById('nTabDates').classList.toggle('active', tab==='dates');
  document.getElementById('nMsg').style.display   = tab==='msg'   ? '' : 'none';
  document.getElementById('nDates').style.display = tab==='dates' ? '' : 'none';
  tab==='msg' ? renderMsg() : renderDates();
  markSeen();
}

async function refresh(){
  if(Sync.cfg) await Sync.pull();
  // (en autoRO, le rafraîchissement périodique global s'en charge déjà)
  render();
}

document.addEventListener('DOMContentLoaded', ()=>{
  document.getElementById('nTabMsg').addEventListener('click', ()=>{ tab='msg'; render(); });
  document.getElementById('nTabDates').addEventListener('click', ()=>{ tab='dates'; render(); });
  document.getElementById('nRefresh').addEventListener('click', refresh);

  document.addEventListener('pageshow', e=>{
    clearInterval(pollTimer); pollTimer=null;
    if(e.detail.page==='nous'){
      refresh();
      pollTimer = setInterval(refresh, 45000);      // sondage tant que la page est ouverte
    }
  });
  document.addEventListener('storechange', ()=>{
    updateDot();
    if(document.getElementById('page-nous').classList.contains('active')) render();
  });
  document.addEventListener('profilechange', updateDot);
  updateDot();
});

})();
