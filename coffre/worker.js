/* ===== Coffre « Ma salle & moi » : un mot de passe, aucun jeton =====

   Pourquoi : écrire dans GitHub depuis le site demandait un jeton, et un jeton
   expire (30 jours par défaut). Le 7 novembre 2026 il a expiré, plus aucun
   appareil ne pouvait enregistrer. Ici, les données vivent dans une base D1
   chez Cloudflare (gratuite), et la seule chose à connaître est un mot de passe,
   qui n'expire jamais.

   Le mot de passe n'est écrit nulle part dans ce code : le PREMIER appareil qui
   se connecte le choisit, et seule son empreinte (SHA-256 salé) est gardée.

   L'API imite l'API Contents de GitHub pour un seul fichier, pour que la couche
   de synchro de l'app (fusion entrée par entrée, conflits 409, envoi keepalive)
   n'ait rien à changer :
     GET  /data/perso.json   → {sha, content (base64), encoding}   public
     PUT  /data/perso.json   → {content:{sha}} ; 409 si le sha ne colle pas
     GET  /coffre.json       → le JSON en clair, pour la consultation seule
     GET  /etat              → {motDePasse: true|false}
     POST /connexion         → vérifie le mot de passe, ou le définit s'il n'y en a pas

   Lecture publique, écriture protégée : c'est le modèle accepté depuis le début
   (« je m'en fous c'est mon poids »), et il garde la consultation seule pour
   les proches sans rien à configurer.                                         */

const ORIGINES = [
  'https://coversurgithub.github.io',
  'http://localhost:8123',
];
const FICHIER = '/data/perso.json';
const MAX_OCTETS = 2 * 1024 * 1024;
const ESSAIS_PAR_HEURE = 20;        // au-delà, 429 : un mot de passe simple ne se devine pas à ce rythme
const VERSIONS_GARDEES = 60;        // historique, pour revenir en arrière en cas de problème

export default {
  async fetch(request, env) {
    const origine = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ORIGINES.includes(origine) ? origine : ORIGINES[0],
      'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Code',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
      status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      await preparer(env.DB);
      const url = new URL(request.url);
      const chemin = url.pathname.replace(/\/+$/, '') || '/';

      /* ---- lecture publique ---- */
      if (request.method === 'GET' && chemin === FICHIER) {
        const row = await env.DB.prepare('SELECT sha, content FROM coffre WHERE id = 1').first();
        if (!row) return json({ message: 'Not Found' }, 404);
        return json({ sha: row.sha, content: row.content, encoding: 'base64' });
      }
      if (request.method === 'GET' && chemin === '/coffre.json') {
        const row = await env.DB.prepare('SELECT content FROM coffre WHERE id = 1').first();
        if (!row) return json({ message: 'Not Found' }, 404);
        return new Response(decoder(row.content), {
          headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      }
      if (request.method === 'GET' && chemin === '/etat') {
        return json({ motDePasse: !!(await lireEmpreinte(env.DB)) });
      }

      /* ---- tout le reste exige le mot de passe ---- */
      const ip = request.headers.get('CF-Connecting-IP') || 'local';
      if (await tropDEssais(env.DB, ip)) {
        return json({ message: 'Trop d\'essais. Réessaie dans une heure.' }, 429);
      }
      const code = request.headers.get('X-Code') || '';
      const empreinte = await lireEmpreinte(env.DB);

      if (request.method === 'POST' && chemin === '/connexion') {
        if (!empreinte) {
          if (code.length < 4) return json({ message: 'Choisis un mot de passe d\'au moins 4 caractères.' }, 400);
          const sel = crypto.randomUUID();
          await env.DB.prepare('INSERT OR IGNORE INTO reglages (cle, valeur) VALUES (?, ?)')
            .bind('mdp', JSON.stringify({ sel, h: await hacher(sel, code) })).run();
          // INSERT OR IGNORE : si deux appareils le définissent au même instant, le premier gagne
          const fixe = await lireEmpreinte(env.DB);
          if (fixe.h !== await hacher(fixe.sel, code)) return json({ message: 'Mot de passe incorrect.' }, 401);
          return json({ ok: true, nouveau: true }, 201);
        }
        if (!(await verifier(empreinte, code))) { await noterEchec(env.DB, ip); return json({ message: 'Mot de passe incorrect.' }, 401); }
        return json({ ok: true, nouveau: false });
      }

      if (request.method === 'PUT' && chemin === FICHIER) {
        if (!empreinte) return json({ message: 'Aucun mot de passe défini : connecte-toi d\'abord.' }, 401);
        if (!(await verifier(empreinte, code))) { await noterEchec(env.DB, ip); return json({ message: 'Mot de passe incorrect.' }, 401); }
        const brut = await request.text();
        if (brut.length > MAX_OCTETS) return json({ message: 'Contenu trop volumineux.' }, 413);
        let recu;
        try { recu = JSON.parse(brut); } catch (e) { return json({ message: 'JSON invalide.' }, 400); }
        if (typeof recu.content !== 'string' || !recu.content) return json({ message: 'Champ « content » manquant.' }, 400);
        try { JSON.parse(decoder(recu.content)); } catch (e) { return json({ message: 'Le contenu n\'est pas un coffre valide.' }, 400); }

        const actuel = await env.DB.prepare('SELECT sha, content FROM coffre WHERE id = 1').first();
        // même règle que GitHub : on n'écrase que la version qu'on a lue
        if (actuel && recu.sha !== actuel.sha) return json({ message: 'does not match' }, 409);
        if (!actuel && recu.sha) return json({ message: 'does not match' }, 409);

        const sha = crypto.randomUUID().replace(/-/g, '');
        const maintenant = new Date().toISOString();
        const ecriture = actuel
          ? env.DB.prepare('UPDATE coffre SET sha = ?, content = ?, maj = ? WHERE id = 1 AND sha = ?')
              .bind(sha, recu.content, maintenant, actuel.sha)
          : env.DB.prepare('INSERT OR IGNORE INTO coffre (id, sha, content, maj) VALUES (1, ?, ?, ?)')
              .bind(sha, recu.content, maintenant);
        const res = await ecriture.run();
        if (!res.meta || res.meta.changes !== 1) return json({ message: 'does not match' }, 409);

        await env.DB.batch([
          env.DB.prepare('INSERT INTO historique (at, content) VALUES (?, ?)').bind(maintenant, recu.content),
          env.DB.prepare('DELETE FROM historique WHERE id NOT IN (SELECT id FROM historique ORDER BY id DESC LIMIT ?)')
            .bind(VERSIONS_GARDEES),
        ]);
        return json({ content: { sha } });
      }

      return json({ message: 'Chemin non autorisé.' }, 404);
    } catch (e) {
      return json({ message: 'Erreur du coffre : ' + (e && e.message ? e.message : String(e)) }, 500);
    }
  },
};

/* ---- base ---- */
let pret = false;
async function preparer(db) {
  if (pret) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS coffre (id INTEGER PRIMARY KEY, sha TEXT NOT NULL, content TEXT NOT NULL, maj TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS historique (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, content TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS reglages (cle TEXT PRIMARY KEY, valeur TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS essais (ip TEXT NOT NULL, heure TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (ip, heure))'),
  ]);
  pret = true;
}

/* ---- mot de passe ---- */
async function lireEmpreinte(db) {
  const row = await db.prepare('SELECT valeur FROM reglages WHERE cle = ?').bind('mdp').first();
  return row ? JSON.parse(row.valeur) : null;
}
async function hacher(sel, code) {
  const octets = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sel + ':' + code));
  return [...new Uint8Array(octets)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function verifier(empreinte, code) {
  const a = await hacher(empreinte.sel, code), b = empreinte.h;
  if (a.length !== b.length) return false;
  let diff = 0;                                   // comparaison à durée constante
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---- limitation des essais ---- */
const heureCourante = () => new Date().toISOString().slice(0, 13);
async function tropDEssais(db, ip) {
  const row = await db.prepare('SELECT n FROM essais WHERE ip = ? AND heure = ?').bind(ip, heureCourante()).first();
  return !!row && row.n >= ESSAIS_PAR_HEURE;
}
async function noterEchec(db, ip) {
  await db.batch([
    db.prepare('INSERT INTO essais (ip, heure, n) VALUES (?, ?, 1) ON CONFLICT (ip, heure) DO UPDATE SET n = n + 1')
      .bind(ip, heureCourante()),
    db.prepare('DELETE FROM essais WHERE heure < ?').bind(new Date(Date.now() - 86400000).toISOString().slice(0, 13)),
  ]);
}

/* base64 (UTF-8) → texte */
function decoder(b64) {
  const bin = atob(String(b64).replace(/\s+/g, ''));
  const octets = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) octets[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(octets);
}
