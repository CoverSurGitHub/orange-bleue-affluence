// Avant chaque déploiement : node bump.js
// Donne une nouvelle URL aux assets (?v=…) pour que les appareils (surtout iOS,
// qui garde les fichiers bien plus longtemps que les 10 min annoncées par Pages)
// récupèrent le nouveau code immédiatement au lieu de rester bloqués dessus.
const fs = require('fs');
const v = Date.now().toString(36);
let h = fs.readFileSync('index.html', 'utf8');
h = h.replace(/(assets\/[a-z-]+\.(?:js|css))(\?v=[a-z0-9]+)?/g, `$1?v=${v}`);
fs.writeFileSync('index.html', h);
let a = fs.readFileSync('assets/app.js', 'utf8');
a = a.replace(/const APP_VERSION = '[^']*'/, `const APP_VERSION = '${v}'`);
fs.writeFileSync('assets/app.js', a);
console.log('version →', v);
