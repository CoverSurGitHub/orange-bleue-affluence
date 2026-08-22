# Ma salle & moi — documentation complète

Application web personnelle, **mobile-first**, sans backend ni compte à créer.
Elle réunit le suivi de la salle de sport, le suivi corporel/nutritionnel et un
espace de couple.

| | |
|---|---|
| **En ligne** | https://coversurgithub.github.io/orange-bleue-affluence/ |
| **Dépôt** | `CoverSurGitHub/orange-bleue-affluence` (public) |
| **Version** | `mshugh6g` (affichée dans ⚙️ Réglages) |
| **Stack** | HTML/CSS/JS natifs — **zéro dépendance, zéro CDN**, tout auto-hébergé |
| **Hébergement** | GitHub Pages (gratuit) |
| **Données** | `localStorage` + coffre synchronisé sur la branche `data` du dépôt |

---

## 1. Point de départ

L'application L'Orange Bleue affiche le nombre de personnes présentes **à
l'instant présent**, sans historique. Impossible de savoir si 19 h est chargé,
ou quel jour est le plus calme.

Le projet est né de là, puis s'est étendu au suivi perso (poids, repas, besoins
caloriques), aux profils multiples, et à un espace partagé à deux.

---

## 2. Les 5 sections

### 🏋️ Salle — affluence + assiduité

**Affluence en direct et historique.** Un capteur interroge l'API publique de
L'Orange Bleue toutes les 10 minutes et archive chaque relevé.

- **Onglet 📏 Mesuré** — courbe du jour choisi
  - bascule **Heures** (vue d'ensemble) / **Minutes** (graphe élargi, défilement horizontal, points bien espacés)
  - **un point par mesure** ; tap/clic → bulle avec **l'heure exacte et le nombre de visiteurs**
  - sélection du jour par **calendrier** (les jours avec données sont mis en évidence)
- **Onglet 🔀 Comparer** — courbes superposées, légende cliquable pour masquer/afficher
  - *Jours d'une semaine* — les 7 jours d'une semaine, une couleur chacun
  - *Même jour, plusieurs semaines* — tous les vendredis entre eux, par exemple
  - *Semaines entières* — axe lundi→dimanche, une courbe par semaine
- **📆 Mes séances** — assiduité personnelle
  - gros bouton **« J'y suis allé aujourd'hui »** (re-tap pour annuler)
  - calendrier mensuel : tape n'importe quel jour passé pour le marquer/démarquer
  - **vue « Régularité »** annuelle façon heatmap (une colonne = une semaine)
  - compteurs : cette semaine · ce mois · moyenne/semaine (sur 8 semaines) · **semaines d'affilée**

> Le « semaines d'affilée » plutôt que « jours d'affilée » est volontaire : les
> jours de repos font partie d'un bon entraînement.

### ⚖️ Poids

- Saisie d'une pesée, **date du jour pré-sélectionnée** mais modifiable (calendrier)
- Courbe avec **moyenne mobile 7 jours** (lisse les variations d'eau/sel)
- Écarts 7 j / 30 j, poids de départ, objectif optionnel affiché sur le graphe
- Liste des dernières pesées, suppression possible

### 🍽️ Repas — bibliothèque de plats

Conçu pour **ne rien avoir à ressaisir chaque jour**.

- **Jauges d'objectif collées en haut** de l'écran
  - 🔥 **kcal** consommées / cible, avec le restant (ou le dépassement)
  - 🥩 **protéines** : la barre se remplit par rapport au **besoin maximum**, un
    **repère** marque le minimum, et trois couleurs — bleu (sous le minimum),
    vert (dans la zone), orange (au-delà du maximum conseillé)
- **Catégories personnalisables** (Repas, Collations… renommables, ajoutables)
  contenant tes **plats** préparés à l'avance
- **Un tap sur ＋ = « je l'ai mangé »** → la jauge avance. Re-tap = ×2. Bouton − pour retirer.
- **🍴 Extra** pour un aliment ponctuel hors recette
- **Historique par date** : les valeurs sont **figées au moment du tap**, donc
  modifier une recette ne réécrit jamais les journées passées — *sauf le jour
  affiché, qui se met à jour immédiatement* (le comportement attendu quand on
  ajuste ce qu'on est en train de manger)

**Saisie des quantités — intelligente selon l'aliment :**

| Type | Saisie | Exemple |
|---|---|---|
| Par défaut | grammes | `⚖ 150 g` |
| **Œufs** | à l'unité | `🥚 3 œufs (150 g)` — entier ≈50 g, jaune ≈17 g, blanc ≈33 g |
| **Fruits unitaires** | à l'unité | `🍌 2 bananes (220 g)` — banane, pomme, poire, orange, clémentine, kiwi, pêche, nectarine, abricot, prune, fraise, cerise, tomate, avocat, datte, figue, mangue |
| **Liquides** | millilitres | `🥛 250 ml (258 g)` — converti par densité : lait 1,03 · huile 0,92 · sirop 1,32 · autres 1,00 |

Garde-fous : *jus d'orange* → ml (pas « nombre d'oranges »), *pomme de terre* →
grammes (pas une pomme), compotes/confitures/fruits secs/poudres → grammes.
**Partout**, taper `160g` force les grammes.

Chaque ingrédient affiche **kcal ET protéines**, et la puce de quantité est
cliquable pour modifier (`⚖ 150 g ✎`).

### 🔥 TDEE — besoins énergétiques

Calcul rigoureux, basé uniquement sur des sources officielles.

- **Métabolisme de base (BMR)** : **Mifflin-St Jeor** (référence utilisée par l'app)
  - comparaison affichée avec **Harris-Benedict révisée** et **Katch-McArdle** (si % de masse grasse renseigné)
  - un écart faible entre les formules = estimation fiable
- **Facteur d'activité**

  | Facteur | Niveau | Description |
  |---|---|---|
  | ×1,2 | Sédentaire | travail assis, pas de sport |
  | ×1,375 | Légèrement actif | sport léger 1 à 3 j/semaine |
  | ×1,55 | Modérément actif | sport 3 à 5 j/semaine |
  | ×1,725 | Très actif | sport intense 6 à 7 j/semaine |
  | ×1,9 | Extrêmement actif | sport 2×/j ou métier physique |

- **Objectif** : Maintien · Perte (−500 kcal ≈ 0,5 kg/sem) · Perte légère (−300) · Prise / lean bulk (+300)
- **Repères protéines** : minimum **1,2 g/kg**, maximum conseillé **2,0 g/kg**
- Le poids est repris automatiquement de la dernière pesée (modifiable)
- ⚠️ Avertissement si la cible passe **sous le métabolisme de base**

> Le BMR n'est pas un objectif à manger : c'est le plancher physiologique, le
> point de départ du calcul.

### 💌 Nous — espace de couple

Espace **commun** aux profils (hors données perso), synchronisé.

- **💬 Messages** — bulles de chat, **kaomojis** `(｡♥‿♥｡)`, **stickers**,
  **GIF/images par URL collée**, **réaction ❤️**, suppression de ses propres
  messages, **pastille non-lu** sur l'onglet
- **💘 Nos dates** — proposer un rendez-vous
  - champs : **objet, date, heure, lieu, petit message**
  - l'autre **accepte 💚 ou décline**, avec un mot en retour
  - une fois accepté : **compte à rebours** J-7 … J-1 … « 💗 c'est aujourd'hui ! »
  - **📅 Calendrier** → fichier `.ics` qui s'ouvre dans le Calendrier iPhone
  - **🗺 Plans** → ouvre le lieu dans Apple Plans
  - la proposition s'annonce automatiquement dans le fil de messages

> Rafraîchi ~45 s quand la page est ouverte. C'est un **courrier privé**, pas
> une messagerie temps réel (voir §6).

---

## 3. Profils multiples

Plusieurs personnes peuvent utiliser la même app et le même coffre.

- Bouton **👤 [nom] ▾** dans l'en-tête : créer, renommer, supprimer, basculer
- **Chaque profil a ses propres** pesées, repas, plats, séances, TDEE et thème
- Le **profil sélectionné est propre à chaque appareil** (jamais synchronisé) :
  chacun reste sur le sien, même coffre partagé
- Minimum un profil ; la suppression demande confirmation
- La section 💌 Nous est **commune** à tous les profils

---

## 4. Personnalisation (⚙️ Réglages → Apparence)

Réglages **par profil** — ils suivent la personne sur tous ses appareils.

| Thème | Ambiance |
|---|---|
| 🌙 **Nuit** | sombre, bleu — par défaut |
| 🫧 **Frutiger Aero** | ciel dégradé, cartes en verre dépoli, boutons glossy |
| 🍓 **Rose bonbon** | pastel, bordures pointillées, ♡ sur les titres (vibe Neocities) |
| 🌌 **Néon pixel** | nuit arcade, textes qui glowent |

- **Couleur d'accent** libre (pipette)
- **🫧 Bulles flottantes** animées (option)
- **Compagnon** : 🐧🐸🐱🐰🍓⭐🫧🦆🐢🌸 qui se dandine au-dessus de la barre —
  **tape dessus, il envoie des cœurs** 💗
- **Curseur animé** (pingouin à la corde à sauter) sur les appareils à souris —
  auto-hébergé, désactivé sur mobile (pas de curseur sur écran tactile)

---

## 5. Collecte d'affluence

```
collect.js  →  API publique L'Orange Bleue  →  data.csv (branche data)
```

- **Endpoint live** : `GET /nox/public/v1/studios/1556401300/utilization/v2/active-checkin` → `{"value":16}`
- **Base** : `https://monespace.lorangebleue.fr/nox/public/v1`
- **En-têtes requis** : `X-Nox-Client-Type: WEB` et `X-Tenant: lob`
  *(attention : `lob`, pas `l-orange-bleue` qui ne renvoie qu'une salle de démo)*
- **Salle Orgeval** : `id = 1556401300`
- **Aucune authentification** — API entièrement publique
- **Déclenchement** : **cron-job.org** toutes les 10 min (POST `workflow_dispatch`),
  le cron GitHub natif (`2-59/5 * * * *`) restant en filet de secours

> **Pourquoi un déclencheur externe ?** Le planificateur GitHub est « best-effort » :
> retards de 5 à 60 min, runs abandonnés, et sur un dépôt neuf le premier run
> peut ne jamais partir. Constaté en vrai : aucun déclenchement après 1 h 30.
> cron-job.org tire à la minute près.

**Horodatage** : chaque mesure porte l'heure **réelle du relevé**, pas l'heure
prévue. Un retard crée un **trou** dans la courbe, jamais une heure fausse.

Historique actuel : **3 113 mesures** depuis le 17 juillet 2026.

Endpoints connexes (non utilisés dans l'app, mais disponibles) :
`utilization/v2/today` (taux horaire du jour), `utilization/v2/historic/week`
(semaine type, en pourcentages écrasés — jugée trop imprécise et retirée de
l'interface), `utilization/v2/indicator/limits` (seuils faible/normal/forte).

---

## 6. Synchronisation

### Principe

Pas de backend. Le dépôt GitHub **sert de coffre** via l'API Contents.

| | |
|---|---|
| **Fichier** | `data/perso.json` sur la branche **`data`** |
| **Écriture** | jeton GitHub *fine-grained* (Contents RW), collé dans ⚙️ Réglages |
| **Lecture sans jeton** | consultation seule automatique (un proche ouvre l'URL, rien à configurer) |
| **Fusion** | *last-write-wins* **par entrée**, profil par profil |

Les données sont **publiques** (dépôt public) — choix assumé : il n'y a qu'un
poids et des repas.

### Ce qui rend la sync fiable

- **Anti-cache** : l'API GitHub répond `Cache-Control: max-age=60` → toutes les
  lectures forcent `no-store` + paramètre anti-cache (sinon : copie périmée)
- **Réveils** : synchro au retour au premier plan, au focus, au retour du
  réseau, au retour de veille (bfcache iOS), et toutes les 45 s
- **Drapeau `ob.dirty` persistant** : posé **avant** l'envoi, levé seulement sur
  confirmation du serveur → une modif survit à la fermeture de l'app, réessais
  automatiques avec backoff
- **Envoi de dernière chance** (`fetch keepalive`) quand l'app passe en arrière-plan
- **Conflits 409** : pull + fusion + renvoi, jusqu'à 3 tentatives
- **Aucune synchro pendant qu'une fenêtre d'édition est ouverte**

### Indicateur (à côté du titre, cliquable)

| Badge | Sens |
|---|---|
| ☁️✓ | tout est enregistré dans le coffre |
| ☁️↑ | modifications **en attente d'envoi** |
| ☁️… | synchro en cours |
| ☁️⚠️ | erreur (détail dans ⚙️ Réglages) |
| 👁 | consultation seule |
| 📵 | **cet appareil n'est pas synchronisé** — données locales uniquement |

### Latence — honnêtement

Ce n'est **pas** du temps réel. Compte de quelques secondes à ~45 s pour qu'un
changement apparaisse sur l'autre appareil ouvert (ou immédiatement au retour
sur l'app / bouton 🔄). Suffisant pour du poids, des repas et des petits mots.

---

## 7. Architecture technique

```
index.html               structure + chargement (assets versionnés ?v=…)
assets/styles.css        styles mobile-first + 4 thèmes (variables CSS)
assets/cursor.css        curseur animé auto-hébergé (data: URI, @media pointer:fine)
assets/app.js            NOYAU : navigation, calendrier commun, Store, Sync, profils, apparence
assets/salle.js          affluence (courbes, comparaisons)
assets/gym.js            séances (calendrier + heatmap annuelle)
assets/poids.js          pesées
assets/repas.js          plats, journal, base CIQUAL, saisies unités/ml
assets/tdee.js           calculateur TDEE
assets/nous.js           messages + demandes de date
data/ciqual.min.json     2 298 aliments (ANSES CIQUAL 2020)
collect.js               capteur d'affluence
bump.js                  incrémente la version des assets avant déploiement
server.js                serveur local de test → http://localhost:8123
```

### Modèle de données (`schemaVersion: 2`)

```jsonc
{
  "schemaVersion": 2,
  "updatedAt": "…",
  "profiles": {
    "<id>": {
      "id", "nom", "createdAt", "updatedAt", "deleted?",
      "data": {
        "weights":  { "2026-08-06": { "kg": 57.3, "updatedAt": "…" } },
        "gym":      { "2026-08-06": { "go": true, "updatedAt": "…" } },
        "foods":    [ /* aliments perso */ ],
        "recipes":  [ /* plats : {id,nom,cat,items[],updatedAt} */ ],
        "journal":  { "2026-08-06": { "eaten": [ /* … */ ], "updatedAt": "…" } },
        "mealCats": [ {"id":"mc1","nom":"Repas"} ],
        "tdee":     { "sexe","age","taille","activite","objectif","poidsManuel","pctMG" },
        "settings": { "objectifPoids", "appearance": {"theme","accent","pet","bubbles"} }
      }
    }
  },
  "shared": { "messages": [ /* … */ ], "dates": [ /* … */ ] }
}
```

**Astuce clé** : `Store.data` est un **getter** vers le profil actif — tout le
code des sections fonctionne sans savoir que les profils existent.

### Clés `localStorage`

| Clé | Rôle | Synchronisée |
|---|---|---|
| `ob.perso.v1` | le conteneur complet | ✔ (via le coffre) |
| `ob.activeProfile` | profil sélectionné | ✘ *(propre à l'appareil)* |
| `ob.sync.cfg` | jeton + dépôt | ✘ **jamais** |
| `ob.dirty` | modifications en attente | ✘ |
| `ob.nousSeen` | dernier passage sur 💌 Nous | ✘ |
| `ob.optOutRO` | cet appareil tient son propre suivi | ✘ |
| `ob.lastPage` | dernière section ouverte | ✘ |

---

## 8. Sources scientifiques

Règle du projet : **sources officielles uniquement**.

- **Aliments** — table **CIQUAL 2020, ANSES** (via data.gouv.fr)
  énergie selon règlement UE 1169/2011, protéines N×6,25
- **BMR** — Mifflin-St Jeor (*Am J Clin Nutr*, 1990) ; Harris-Benedict révisée
  (Roza & Shizgal, 1984) ; Katch-McArdle
- **Protéines** — ANSES : RNP 0,83 g/kg/j ; sportifs 1,2–2,0 g/kg/j
  (position commune **AND / DC / ACSM**, 2016)
- **Poids unitaires** (œufs, fruits) — poids comestibles moyens, ajustables à la main

### Regénérer la base CIQUAL

Télécharger le zip XML CIQUAL sur data.gouv.fr, puis extraire les constituants
328 (kcal UE), 25003/25000 (protéines), 31000 (glucides), 40000 (lipides)
vers `data/ciqual.min.json` — format : `{foods:[[nom,kcal,prot,glu,lip],…]}`.

---

## 9. Déployer une modification

```bash
node bump.js                        # nouvelle version des assets (anti-cache appareils)
git add -A && git commit -m "…"
git pull --rebase --autostash origin main
git push
```

Puis vérifier la mise en ligne :

```bash
curl -s "https://coversurgithub.github.io/orange-bleue-affluence/?cb=$(date +%s)" | grep -o 'v=[a-z0-9]*' | head -1
```

### ⚠️ Règle d'or : `main` = code, `data` = données

Le capteur commite **139 fois par jour**. Chaque commit sur `main` déclenche une
republication GitHub Pages **qui annule la précédente** — pendant des heures,
plus aucune version ne sortait et les appareils restaient bloqués sur du vieux
code. D'où la séparation :

| Branche | Contenu | Déclenche une publication |
|---|---|---|
| `main` | le code de l'app | ✔ (rarement, seulement quand on déploie) |
| `data` | `data.csv` + `data/perso.json` | ✘ |

**Ne jamais faire commiter le capteur ou le coffre sur `main`.**

---

## 10. Pièges rencontrés (et pourquoi le code est écrit ainsi)

| Symptôme | Cause réelle | Parade |
|---|---|---|
| « Le site ne se met plus à jour » | builds Pages annulées par les commits du capteur | données sur la branche `data` |
| « Ma modif de recette a disparu » | une synchro remplaçait `Store.all` (clone profond) → l'éditeur ouvert mutait un **objet orphelin** | éditer une **copie**, réécrire **par id**, re-résoudre au clic, pas de pull pendant une fenêtre ouverte |
| « Des fois ça synchro, des fois non » | cache HTTP de l'API GitHub (60 s) | `no-store` + anti-cache |
| Une donnée reste figée pour toujours | comparaison avec une date manquante → toujours fausse → le local gagne indéfiniment | date absente traitée comme `""` |
| Sauvegardes silencieusement refusées | `autoRO` restait actif après la pose du jeton | un jeton d'écriture prime toujours |
| L'utilisateur croit être synchronisé | badge **vide** quand la sync n'est pas configurée | badge **📵** explicite et cliquable |
| Le cron ne part jamais | planificateur GitHub best-effort | déclencheur externe cron-job.org |
| Le calendrier ne changeait pas de mois | listeners posés sur des nœuds recréés à chaque rendu | délégation d'événements sur le conteneur persistant |

> **Règle générale retenue** : ne jamais garder une référence vers le store
> entre l'affichage et l'action — toujours re-résoudre au moment du clic.

---

## 11. Dépannage

**Un appareil affiche une version périmée**
1. ⚙️ Réglages → vérifier le **numéro de version** en haut
2. Fermer complètement l'app et rouvrir (iOS garde les fichiers en cache)

**Un appareil n'a pas les bonnes données**
1. ⚙️ Réglages → comparer **« Cet appareil »** et **« Le coffre »**
2. Si l'appareil est en retard → **⬇️ Tout recharger depuis le coffre**
3. Si le badge affiche **☁️↑**, une modif n'est pas partie → **🔄 Synchroniser**

**Repartir de zéro sur un appareil** : ⚙️ Réglages → Export JSON (sécurité), puis
effacer les données du site, recoller le jeton, laisser le coffre se recharger.

**Partager l'app avec quelqu'un** : lui envoyer l'URL, c'est tout. Sans jeton,
il verra les données publiées en **consultation seule** (badge 👁), sans rien
pouvoir modifier.

---

## 12. Idées non réalisées

- Vrai temps réel pour le chat (nécessiterait un backend type Supabase/Firebase)
- Notifications push (impossible sans backend)
- Badges d'assiduité en pixel art, compteur « ensemble depuis »
- Mini-blog partagé façon Neocities
- Corrélation entre séances, poids et apports
