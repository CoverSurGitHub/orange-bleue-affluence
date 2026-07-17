// Petit serveur statique pour visualiser le dashboard en local : `node server.js` puis http://localhost:8123
const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = process.env.PORT || 8123;
const types = { '.html':'text/html', '.csv':'text/csv', '.js':'text/javascript', '.json':'application/json' };
http.createServer((req, res) => {
  let f = decodeURIComponent(req.url.split('?')[0]);
  if (f === '/') f = '/index.html';
  const fp = path.join(__dirname, f);
  if (!fp.startsWith(__dirname) || !fs.existsSync(fp)) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(fp)] || 'text/plain', 'Cache-Control': 'no-store' });
  fs.createReadStream(fp).pipe(res);
}).listen(PORT, () => console.log(`Dashboard local : http://localhost:${PORT}`));
