# Le relais, pas à pas

Le but : ne plus jamais coller de jeton GitHub sur un téléphone ou un PC. Le
jeton vit une seule fois, chez Cloudflare. Sur les appareils, on tape juste un
code.

Tout est gratuit et il n'y a pas de carte bancaire à donner. Compte un quart
d'heure la première fois, puis plus jamais rien.

---

## Étape 0 : un vrai jeton GitHub

C'est la seule fois où tu en manipules un. Ne le colle nulle part d'autre que
Cloudflare, à l'étape 3.

1. Va sur <https://github.com/settings/personal-access-tokens>, puis
   **Generate new token**.
2. **Token name** : ce que tu veux, par exemple `relais-salle`. C'est juste une
   étiquette pour t'y retrouver, ce n'est pas un mot de passe.
3. **Expiration** : prends **No expiration** si l'option est proposée, sinon la
   durée la plus longue.
4. **Resource owner** : `CoverSurGitHub`.
5. **Repository access** : *Only select repositories*, puis coche
   `orange-bleue-affluence`.
6. **Repository permissions** : cherche **Contents** et mets-le sur
   **Read and write**. Ne touche à rien d'autre. GitHub ajoute tout seul
   *Metadata : Read-only*, c'est normal.
7. **Generate token**.

Sur la page qui s'affiche ensuite, une longue chaîne apparaît, elle commence par
`github_pat_` et fait environ 93 caractères. **Utilise le petit bouton de copie
à droite de la chaîne**, ne la sélectionne pas à la souris : c'est comme ça
qu'on en perd un morceau, et GitHub répond alors « 401 ».

Cette chaîne ne sera plus jamais réaffichée. Garde-la dans le presse-papiers le
temps des deux étapes suivantes, ou dans un gestionnaire de mots de passe.

---

## Étape 1 : créer le worker

1. Va sur <https://dash.cloudflare.com>, crée un compte si tu n'en as pas.
2. Dans le menu de gauche, **Workers & Pages**, puis **Create**.
3. Choisis de partir d'un worker « Hello World » et donne-lui un nom, par
   exemple `coffre-salle`. Ce nom se retrouvera dans l'adresse.
4. Déploie-le tel quel. Cloudflare te donne alors une adresse du type
   `https://coffre-salle.ton-compte.workers.dev`. Note-la, c'est celle que tu
   colleras dans l'app.

## Étape 2 : mettre le vrai code

1. Ouvre l'éditeur de code du worker (bouton **Edit code**, ou l'onglet du même
   genre selon la version du tableau de bord).
2. Sélectionne tout le contenu de l'éditeur et remplace-le par le contenu du
   fichier [`worker.js`](worker.js) de ce dossier.
3. Déploie (**Deploy**).

## Étape 3 : les deux secrets

1. Reviens sur la page du worker, onglet **Settings**, section
   **Variables and Secrets** (ou « Variables » selon la version).
2. Ajoute une variable nommée exactement `GH_TOKEN`, de type **Secret**, et
   colle dedans le jeton de l'étape 0.
3. Ajoute une deuxième variable nommée exactement `CODE`, de type **Secret**,
   et mets dedans le code que tu veux taper dans l'app. Par exemple
   `fatenlabest`. Évite juste quelque chose de devinable en trois essais.
4. Enregistre, puis **redéploie le worker**. Tant qu'il n'est pas redéployé, il
   ne voit pas les nouvelles variables et répondra « 500 ».

## Étape 4 : brancher l'app

Sur chaque appareil, dans **⚙️ Réglages**, bloc **☁️ Synchronisation** :

1. Choisis l'onglet **🔑 Code**.
2. **Adresse du relais** : l'adresse de l'étape 1, sans barre oblique à la fin.
3. **Code** : celui de l'étape 3.
4. **Activer l'écriture**. L'état doit passer à *écriture activée (relais)*.

C'est tout. Aucun jeton sur l'appareil, et le code se retape en trois secondes
sur un nouveau téléphone.

---

## Si ça coince

L'app explique chaque erreur, mais voilà la traduction rapide.

| Message | Cause |
|---|---|
| Code refusé (401) | le code tapé n'est pas celui de la variable `CODE` |
| Relais mal configuré (500) | `GH_TOKEN` ou `CODE` manque, ou le worker n'a pas été redéployé après leur ajout |
| Relais injoignable | adresse mal saisie, ou barre oblique en trop à la fin |
| Refusé (403) | l'adresse contient quelque chose après le nom du worker |

Si GitHub lui-même refuse, l'erreur remonte telle quelle. Un 404 veut dire que
le jeton n'a pas accès au dépôt : reprends l'étape 0, points 4 à 6.

## Ce que le relais accepte et refuse

Il ne sert qu'un seul fichier, `data/perso.json`, et il impose lui-même la
branche `data`. Même quelqu'un qui connaîtrait le code ne peut donc pas écrire
sur `main`, donc pas injecter de code dans le site. Il ne recopie du corps de la
requête que trois champs (`message`, `content`, `sha`) et refuse tout ce qui
dépasse 4 Mo.

Ce qu'il ne fait pas : empêcher quelqu'un qui connaît le code **et** l'adresse
de modifier les données. Si ça arrive, rien n'est perdu, chaque écriture est un
commit sur la branche `data` et l'historique GitHub permet de revenir en
arrière.

## Changer le code, ou tout couper

Pour changer le code : modifie la variable `CODE` dans Cloudflare, redéploie, et
retape le nouveau code sur chaque appareil.

Pour tout couper d'un coup : supprime le worker chez Cloudflare, ou révoque le
jeton sur GitHub. Les deux arrêtent l'écriture immédiatement, partout. Les
données restent lisibles, le site continue de fonctionner en consultation.
