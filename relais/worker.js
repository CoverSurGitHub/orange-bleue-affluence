/* ===== Relais d'écriture pour « Ma salle & moi » =====

   Pourquoi ce fichier existe : GitHub Pages est un hébergement statique, donc
   pour écrire dans le coffre il faut un jeton. Mettre ce jeton dans le code du
   site ne marche pas : le scanner de secrets de GitHub détecte tout jeton publié
   dans un dépôt public et le révoque automatiquement en quelques minutes.

   Ce relais tourne chez Cloudflare (gratuit). Il garde le jeton de son côté, et
   n'accepte les requêtes que si elles portent le bon code. L'app ne connaît donc
   que ce code, qui ne donne aucun pouvoir sur le compte GitHub : au pire il
   permet d'écrire dans un seul fichier, sur une seule branche, et chaque
   écriture est un commit, donc tout est récupérable.

   Deux variables d'environnement à définir dans Cloudflare, en « Secret » :
     GH_TOKEN  le jeton GitHub fine-grained, Contents Read and write
     CODE      le code partagé que tu tapes dans l'app

   Le relais n'est volontairement PAS un proxy générique vers GitHub : il ne sert
   qu'un seul fichier, il impose lui-même la branche, et il ne recopie du corps
   de la requête que les trois champs attendus. Sans ça, un code volé
   permettrait d'écrire sur `main`, donc d'injecter du code dans le site.       */

const REPO    = 'CoverSurGitHub/orange-bleue-affluence';
const FICHIER = 'data/perso.json';
const BRANCHE = 'data';
const MAX     = 4 * 1024 * 1024;        // garde-fou : le coffre fait quelques dizaines de Ko

const ORIGINES = [
  'https://coversurgithub.github.io',
  'http://localhost:8123',             // serveur de test local (node server.js)
];

export default {
  async fetch(request, env) {
    const origine = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ORIGINES.includes(origine) ? origine : ORIGINES[0],
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Code',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    const repondre = (obj, status) => new Response(JSON.stringify(obj), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (!env.GH_TOKEN || !env.CODE) {
      return repondre({ message: 'Relais mal configuré : les variables GH_TOKEN et CODE ne sont pas définies.' }, 500);
    }

    // Code partagé. La comparaison passe par un condensé pour ne rien laisser
    // deviner, ni par la durée de la comparaison ni par la longueur du code.
    if (!(await memeSecret(request.headers.get('X-Code') || '', env.CODE))) {
      return repondre({ message: 'Code incorrect.' }, 401);
    }

    const url = new URL(request.url);
    if (!url.pathname.endsWith('/' + FICHIER)) {
      return repondre({ message: 'Ce relais ne sert que ' + FICHIER + '.' }, 403);
    }
    if (request.method !== 'GET' && request.method !== 'PUT') {
      return repondre({ message: 'Méthode non autorisée.' }, 405);
    }

    let corps;
    if (request.method === 'PUT') {
      const brut = await request.text();
      if (brut.length > MAX) return repondre({ message: 'Contenu trop volumineux.' }, 413);
      let recu;
      try { recu = JSON.parse(brut); } catch (e) { return repondre({ message: 'JSON invalide.' }, 400); }
      if (typeof recu.content !== 'string' || !recu.content) {
        return repondre({ message: 'Champ « content » manquant.' }, 400);
      }
      // On ne laisse JAMAIS le client choisir la branche ni le chemin.
      corps = JSON.stringify({
        message: typeof recu.message === 'string' ? recu.message.slice(0, 200) : 'perso',
        content: recu.content,
        branch: BRANCHE,
        ...(typeof recu.sha === 'string' && recu.sha ? { sha: recu.sha } : {}),
      });
    }

    const cible = 'https://api.github.com/repos/' + REPO + '/contents/' + FICHIER
                + (request.method === 'GET' ? '?ref=' + BRANCHE + '&_=' + Date.now() : '');

    let amont;
    try {
      amont = await fetch(cible, {
        method: request.method,
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': 'Bearer ' + env.GH_TOKEN,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'ma-salle-et-moi-relais',
          ...(corps ? { 'Content-Type': 'application/json' } : {}),
        },
        body: corps,
      });
    } catch (e) {
      return repondre({ message: 'GitHub injoignable depuis le relais.' }, 502);
    }

    // Le statut de GitHub est renvoyé tel quel : l'app sait déjà quoi faire d'un
    // 404 (fichier absent au premier envoi) ou d'un 409 (conflit à refusionner).
    return new Response(await amont.text(), {
      status: amont.status,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  },
};

/* Comparaison de deux secrets sans fuite par la durée ni par la longueur. */
async function memeSecret(a, b) {
  const condense = async (s) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const [x, y] = await Promise.all([condense(a), condense(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
