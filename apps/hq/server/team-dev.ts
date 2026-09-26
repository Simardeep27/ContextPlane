// Local verification of the same handler deployed as a Vercel Function. No simulation or API startup.
import { createServer } from 'node:http';
import { createTeamHandler } from './team.ts';
import { createOptimizeHandler } from './optimize.ts';
const team = createTeamHandler(process.env); const optimize = createOptimizeHandler();
const port = Number(process.env.PORT ?? 8788);
createServer(async (req,res) => {
  const route = req.url?.split('?')[0]; const handle = route === '/api/team' ? team : route === '/api/optimize' ? optimize : null;
  if (!handle) { res.writeHead(404).end(); return; }
  const headers = new Headers();
  for (const [k,v] of Object.entries(req.headers)) if (v) headers.set(k,Array.isArray(v) ? v.join(',') : v);
  try {
    const request = new Request(`http://${req.headers.host}${req.url}`,{ method:req.method,headers,
      ...(req.method !== 'GET' && req.method !== 'HEAD' ? {body:req as never,duplex:'half'} : {}) });
    const response = await handle(request);
    res.writeHead(response.status,Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500).end(); }
}).listen(port,'127.0.0.1',() => console.log(`Team reader listening on 127.0.0.1:${port}`));
