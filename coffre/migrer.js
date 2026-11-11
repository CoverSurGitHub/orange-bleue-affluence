/* Copie le coffre actuel de GitHub (branche data) dans la base D1 du coffre.
   Usage : node migrer.js > migration.sql
           npx wrangler d1 execute coffre-salle --remote --file=migration.sql
   À ne lancer qu'une fois, sur une base vide : l'INSERT OR IGNORE ne remplace
   jamais un coffre déjà présent. */
const https = require('https');
const URL = 'https://raw.githubusercontent.com/CoverSurGitHub/orange-bleue-affluence/data/data/perso.json?_=' + Date.now();

https.get(URL, res => {
  let d = '';
  res.setEncoding('utf8');
  res.on('data', c => d += c);
  res.on('end', () => {
    const j = JSON.parse(d);                                   // échoue bruyamment si ce n'est pas du JSON
    if(j.schemaVersion !== 2 || !j.profiles) throw new Error('coffre GitHub inattendu');
    const b64 = Buffer.from(JSON.stringify(j), 'utf8').toString('base64');
    const iso = new Date().toISOString();
    process.stdout.write([
      'CREATE TABLE IF NOT EXISTS coffre (id INTEGER PRIMARY KEY, sha TEXT NOT NULL, content TEXT NOT NULL, maj TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS historique (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, content TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS reglages (cle TEXT PRIMARY KEY, valeur TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS essais (ip TEXT NOT NULL, heure TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (ip, heure));',
      `INSERT OR IGNORE INTO coffre (id, sha, content, maj) VALUES (1, 'migration-github', '${b64}', '${iso}');`,
      `INSERT INTO historique (at, content) VALUES ('${iso}', '${b64}');`,
      ''
    ].join('\n'));
    const profils = Object.values(j.profiles).map(p => p.nom + ' (' + Object.keys(p.data.weights || {}).length + ' pesées)');
    process.stderr.write('coffre GitHub du ' + j.updatedAt + ' : ' + profils.join(', ') + ' · ' + b64.length + ' caractères\n');
  });
}).on('error', e => { throw e; });
