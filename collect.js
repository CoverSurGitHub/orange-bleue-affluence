// Capteur d'affluence L'Orange Bleue Orgeval.
// Récupère le nombre de visiteurs EN DIRECT et l'ajoute à data.csv.
// Aucune dépendance : Node 18+ (fetch intégré). Lancé toutes les 5 min par GitHub Actions.

const fs = require('fs');
const path = require('path');

const STUDIO_ID = process.env.STUDIO_ID || '1556401300'; // Orgeval
const BASE = 'https://monespace.lorangebleue.fr/nox/public/v1';
const HEADERS = { 'X-Nox-Client-Type': 'WEB', 'X-Tenant': 'lob' };
const DATA_FILE = path.join(__dirname, 'data.csv');

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
  return res.json();
}

async function main() {
  const live = await getJson(`${BASE}/studios/${STUDIO_ID}/utilization/v2/active-checkin`);
  const count = Number(live.value);
  if (!Number.isFinite(count)) throw new Error(`Valeur inattendue: ${JSON.stringify(live)}`);

  const nowUtc = new Date().toISOString(); // UTC, non ambigu ; le dashboard convertit en heure de Paris

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, 'timestamp_utc,count\n');
  }
  fs.appendFileSync(DATA_FILE, `${nowUtc},${count}\n`);

  console.log(`[${nowUtc}] ${count} visiteur(s) — ajouté à data.csv`);
}

main().catch((err) => {
  console.error('Échec de la collecte:', err.message);
  process.exit(1);
});
