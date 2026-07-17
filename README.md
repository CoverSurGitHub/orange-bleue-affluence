# Affluence — L'Orange Bleue Orgeval

Capte le **nombre de visiteurs en direct** de la salle toutes les 5 minutes et affiche la
courbe de toute la journée (ce que l'appli officielle ne montre pas).

Utilise l'API publique du portail L'Orange Bleue (aucun login requis).

## Fichiers

| Fichier | Rôle |
|---|---|
| `collect.js` | Récupère le nombre live et l'ajoute à `data.csv` |
| `index.html` | Dashboard (autonome, aucune librairie externe) |
| `data.csv` | Historique : `timestamp_utc,count` |
| `server.js` | Serveur local pour tester (`node server.js` → http://localhost:8123) |
| `.github/workflows/collect.yml` | Cron GitHub Actions toutes les 5 min |

## Tester en local

```bash
node collect.js     # ajoute une mesure
node server.js      # puis ouvrir http://localhost:8123
```

## Déploiement gratuit 24/7 (GitHub)

1. Créer un repo GitHub (public) et y pousser ce dossier.
2. **Settings → Actions → General → Workflow permissions** : cocher *Read and write permissions*.
3. **Settings → Pages** : *Deploy from a branch* → branche `main`, dossier `/ (root)`.
4. **Actions → Collecte affluence → Run workflow** pour un premier test.

Le cron tourne ensuite tout seul, PC éteint. Dashboard :
`https://<ton-user>.github.io/<ton-repo>/`

## Changer de salle

Trouver l'`id` d'une autre salle :
```bash
curl -s -H "X-Nox-Client-Type: WEB" -H "X-Tenant: lob" \
  https://monespace.lorangebleue.fr/nox/public/v1/studios | grep -o '"id":[0-9]*,"zoneId":"[^"]*","name":"[^"]*"'
```
Puis mettre `STUDIO_ID` (variable d'env) ou éditer la valeur par défaut dans `collect.js`.
Orgeval = `1556401300`.
