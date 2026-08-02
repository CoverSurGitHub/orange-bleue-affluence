# Ma salle & moi — Orgeval

App perso mobile-first hébergée sur GitHub Pages :
**https://coversurgithub.github.io/orange-bleue-affluence/**

## 4 sections

| Section | Contenu |
|---|---|
| 🏋️ **Salle** | Affluence L'Orange Bleue Orgeval en direct + historique (capté toutes les 10 min). Onglets Mesuré (courbe du jour, Heures/Minutes, points cliquables, calendrier) et Comparer (jours/semaines superposés). |
| ⚖️ **Poids** | Pesées quotidiennes (date du jour pré-sélectionnée), courbe + moyenne mobile 7 j, deltas, objectif. |
| 🍽️ **Repas** | Journal par catégories personnalisables, recettes, base **CIQUAL 2020 (ANSES)** embarquée (~2300 aliments, kcal + protéines officiels). |
| 🔥 **TDEE** | Besoins énergétiques : Mifflin-St Jeor (référence), comparaison Harris-Benedict / Katch-McArdle, repères protéines sourcés (ANSES / AND-DC-ACSM), cible kcal reliée au journal Repas. |

## Architecture

```
index.html            structure + boot
assets/styles.css     styles mobile-first (nav bas mobile / haut desktop)
assets/app.js         noyau : navigation, calendrier commun, store localStorage, sync GitHub privé
assets/salle.js       affluence (data.csv)
assets/poids.js       pesées
assets/repas.js       aliments/recettes/journal
assets/tdee.js        calculateur TDEE
data/ciqual.min.json  table CIQUAL 2020 compacte (ANSES, via data.gouv.fr)
data.csv              mesures d'affluence (commis toutes les 10 min par Actions)
server.js             serveur local de test → http://localhost:8123
```

## Collecte d'affluence (ne pas casser)

- `collect.js` interroge l'API publique L'Orange Bleue (studio Orgeval `1556401300`,
  headers `X-Nox-Client-Type: WEB` + `X-Tenant: lob`) et ajoute une ligne à `data.csv`.
- Déclenché toutes les 10 min par **cron-job.org** (POST `workflow_dispatch`) —
  le cron GitHub natif (`2-59/5 * * * *`) reste en filet de secours.
- ⚠️ Toujours `git pull --rebase --autostash` avant de pousser (le bot commite souvent).

## Données perso & synchronisation

- Stockage primaire : `localStorage` (clé `ob.perso.v1`, schéma versionné).
- Sync optionnelle multi-appareils : dépôt GitHub **privé** dédié via l'API Contents
  (fichier `data.json`), jeton fine-grained (Contents RW sur ce seul dépôt) à coller
  dans ⚙️ Réglages sur chaque appareil. Fusion last-write-wins par entrée, gestion 409.
- Export/import JSON de secours dans ⚙️ Réglages.

## Sources scientifiques (obligatoire : officielles uniquement)

- Aliments : table CIQUAL 2020, ANSES (data.gouv.fr) — énergie règl. UE 1169/2011, protéines N×6,25.
- BMR : Mifflin-St Jeor (Am J Clin Nutr 1990) ; Harris-Benedict révisée (Roza & Shizgal 1984) ; Katch-McArdle.
- Protéines : ANSES RNP 0,83 g/kg/j ; sportifs 1,2–2,0 g/kg/j (position AND/DC/ACSM 2016).

## Regénérer la base CIQUAL

Télécharger le zip XML CIQUAL sur data.gouv.fr, puis extraire les constituants
328 (kcal UE), 25003/25000 (protéines), 31000 (glucides), 40000 (lipides)
vers `data/ciqual.min.json` (format : `{foods:[[nom,kcal,prot,glu,lip],…]}`).
