import { env } from 'cloudflare:workers';
export async function GET() {
  try {
    if(!env.DB) throw new Error('Missing binding');
    await env.DB.prepare('SELECT 1 FROM dataset LIMIT 1').all();
    return Response.json({status:'ok',database:'connected',dataSource:'demo'});
  } catch {return Response.json({status:'unavailable',database:'disconnected'},{status:503});}
}
