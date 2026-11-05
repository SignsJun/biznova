import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { aggregateDashboard, parseFilters } from '../lib/dashboard-data.ts';
import { openDatabase, readRecords } from './database.mjs';
import { handleStudioRequest } from './studio-routes.mjs';
import { loadLocalEnv } from './load-local-env.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.woff2':'font/woff2', '.ico':'image/x-icon' };

export function createLocalServer({ databasePath = join(root,'data','biznova.sqlite'), staticDirectory = join(root,'.local','dist') } = {}) {
  const db = openDatabase(databasePath);
  const staticRoot = resolve(staticDirectory);
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Cache-Control','no-store');
    const send = (status, body, contentType='application/json; charset=utf-8') => {
      response.writeHead(status,{'Content-Type':contentType});
      response.end(request.method==='HEAD'?undefined:(typeof body==='string'?body:JSON.stringify(body)));
    };
    if (await handleStudioRequest(request, response, { db })) return;
    if (!['GET','HEAD'].includes(request.method)) {
      response.setHeader('Allow','GET, HEAD'); return send(405,{error:'Method not allowed.'});
    }
    let url;
    try { url = new URL(request.url, 'http://localhost'); } catch { return send(400,{error:'Invalid URL.'}); }
    try {
      if (url.pathname==='/api/health') {
        db.prepare('SELECT 1 FROM dataset LIMIT 1').get();
        return send(200,{status:'ok',database:'connected',dataSource:'demo',runtime:'local-node'});
      }
      if (url.pathname==='/api/dashboard'||url.pathname==='/api/dashboard/export') {
        let filters;
        try { filters=parseFilters(url.searchParams); } catch(error) { return send(400,{error:error.message}); }
        const records=readRecords(db), data=aggregateDashboard(records.products,records.ads,filters);
        if (url.pathname.endsWith('/export')) {
          const csv=['Date,Revenue (USD),Orders,Platform,Data source',...data.calendar.map(d=>`${d.date},${d.revenue.toFixed(2)},${d.orders},${filters.platform},Demo`)].join('\r\n');
          response.setHeader('Content-Disposition',`attachment; filename="biznova-${filters.from}-${filters.to}-${filters.platform}.csv"`);
          return send(200,csv,'text/csv; charset=utf-8');
        }
        return send(200,data);
      }
      if (url.pathname.startsWith('/api/')) return send(404,{error:'API route not found.'});
      let decoded;
      try { decoded=decodeURIComponent(url.pathname); } catch { return send(400,{error:'Invalid path.'}); }
      const filename=resolve(staticRoot, decoded==='/'?'index.html':`.${decoded}`);
      if (!filename.startsWith(staticRoot+sep)) return send(404,{error:'File not found.'});
      let info;
      try { info=await stat(filename); } catch { return send(404,{error:'File not found.'}); }
      if (!info.isFile()) return send(404,{error:'File not found.'});
      response.writeHead(200,{'Content-Type':mime[extname(filename)]||'application/octet-stream','Content-Length':info.size});
      if (request.method==='HEAD') return response.end();
      await pipeline(createReadStream(filename),response);
    } catch(error) {
      console.error('Local request failed:',error);
      if (!response.headersSent) send(503,{error:'Unable to load local data. Please restart the server.'});
      else response.destroy();
    }
  });
  server.on('close',()=>db.close());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  loadLocalEnv(root);
  if (!existsSync(join(root,'.local','dist','index.html'))) {
    console.error('Frontend build missing. Run npm run local first.'); process.exit(1);
  }
  const port=Number(process.env.PORT||3000);
  if (!Number.isInteger(port)||port<1||port>65535) { console.error('PORT must be between 1 and 65535.'); process.exit(1); }
  const databasePath=join(resolve(process.env.BIZNOVA_DATA_DIR||join(root,'data')),'biznova.sqlite');
  const server=createLocalServer({databasePath});
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} is in use. Try PORT=3001 npm run local:start.`:error.message);process.exitCode=1;server.close();});
  server.listen(port,'127.0.0.1',()=>{
    console.log(`\nBizNova is running at http://127.0.0.1:${port}`);
    console.log(`SQLite database: ${databasePath}`);
    console.log('Local frontend + API + database. No cloud account or sign-in required.');
    console.log('Press Ctrl+C to stop.\n');
  });
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>server.close());
}
