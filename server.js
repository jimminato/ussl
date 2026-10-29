const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
// Charge les variables du fichier .env pour le démarrage local sans Docker.
// Les variables déjà définies dans l'environnement du système restent prioritaires.
function loadLocalEnv(file) {
  let contents;
  try { contents = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); } catch { return; }
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '').trimEnd();
    process.env[match[1]] = value;
  }
}
loadLocalEnv(path.join(ROOT, '.env'));
const PORT = Number(process.env.PORT || 3000);
const SECRET = process.env.USSL_SECRET || '';
const MAX_FILE = 10 * 1024 * 1024;
const MAX_UPLOAD_MEMORY = 50 * 1024 * 1024;
const MAX_MESSAGES = 5000;
// Conversation et pièces jointes gardées uniquement en mémoire vive.
const messages = [];
const uploads = new Map();
const clients = new Map();
const CLIENT_TIMEOUT = 20_000;
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };
function clearConversation() { messages.length = 0; uploads.clear(); }
function cleanExpiredClients() {
  const now = Date.now();
  let expired = false;
  for (const [id, lastSeen] of clients) {
    if (now - lastSeen > CLIENT_TIMEOUT) { clients.delete(id); expired = true; }
  }
  // Une session qui disparaît efface aussi les données partagées, même si son
  // navigateur a été fermé brutalement et n'a pas pu envoyer son signal de sortie.
  if (expired) clearConversation();
}
function touchClient(req) {
  cleanExpiredClients();
  const id = String(req.headers['x-ussl-client'] || '').slice(0, 80);
  if (id) clients.set(id, Date.now());
}
function removeMessage(id) {
  const index = messages.findIndex(m => m.id === id);
  if (index < 0) return false;
  const [item] = messages.splice(index, 1);
  if (item.attachment) uploads.delete(item.attachment.id);
  return true;
}
function json(res, status, obj) { res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'}); res.end(JSON.stringify(obj)); }
function authorized(req) {
  const supplied = Buffer.from(String(req.headers['x-ussl-key'] || ''));
  const expected = Buffer.from(SECRET);
  return expected.length >= 16 && supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}
function body(req, limit) { return new Promise((resolve,reject)=>{let chunks=[],size=0;req.on('data',c=>{size+=c.length;if(size>limit){reject(Object.assign(new Error('Trop volumineux'),{status:413}));req.destroy();}else chunks.push(c);});req.on('end',()=>resolve(Buffer.concat(chunks)));req.on('error',reject);}); }
function cleanName(s) { return path.basename(String(s||'fichier').replace(/[\r\n"\\]/g,'_')).slice(0,120) || 'fichier'; }
const server = http.createServer(async (req,res)=>{
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      if (!SECRET || SECRET.length < 16) return json(res,503,{error:'Le serveur doit être configuré avec un USSL_SECRET de 16 caractères minimum.'});
      if (!authorized(req)) return json(res,401,{error:'Code d’accès invalide.'});
      touchClient(req);
      if (req.method==='GET' && url.pathname==='/api/messages') {
        return json(res,200,{messages:messages.slice(-500)});
      }
      if (req.method==='DELETE' && url.pathname==='/api/messages') { clearConversation(); return json(res,200,{ok:true}); }
      if (req.method==='POST' && url.pathname==='/api/session/end') { clearConversation(); clients.clear(); return json(res,200,{ok:true}); }
      if (req.method==='POST' && url.pathname==='/api/messages') {
        const data=JSON.parse((await body(req,32000)).toString('utf8'));
        const text=String(data.text||'').trim().slice(0,4000), attachment=data.attachment;
        if (!text && !attachment) return json(res,400,{error:'Message vide.'});
        if (attachment && (!/^[a-f0-9]{32}$/.test(attachment.id||'') || !uploads.has(attachment.id))) return json(res,400,{error:'Pièce jointe introuvable.'});
        const message={id:crypto.randomBytes(16).toString('hex'),name:String(data.name||'').trim().slice(0,40)||'Moi',text,attachment:attachment?{id:attachment.id,name:cleanName(attachment.name),size:Number(attachment.size)||0,type:String(attachment.type||'application/octet-stream').slice(0,100)}:null,createdAt:Date.now()};
        messages.push(message); if(messages.length>MAX_MESSAGES) removeMessage(messages[0].id); return json(res,201,{message});
      }
      const del=url.pathname.match(/^\/api\/messages\/([a-f0-9]{32})$/);
      if (req.method==='DELETE' && del) { if(!removeMessage(del[1]))return json(res,404,{error:'Message introuvable.'}); return json(res,200,{ok:true}); }
      if (req.method==='POST' && url.pathname==='/api/upload') {
        const size=Number(req.headers['content-length']||0); if(size<=0||size>=MAX_FILE)return json(res,413,{error:'Chaque fichier doit peser moins de 10 Mo.'});
        const storedBytes=[...uploads.values()].reduce((sum,bytes)=>sum+bytes.length,0);
        if(storedBytes+size>MAX_UPLOAD_MEMORY)return json(res,413,{error:'La conversation temporaire a atteint sa limite de pièces jointes. Supprimez la conversation pour continuer.'});
        const bytes=await body(req,MAX_FILE-1); if(!bytes.length)return json(res,400,{error:'Fichier vide.'});
        const id=crypto.randomBytes(16).toString('hex'); uploads.set(id, bytes);
        let rawName=String(req.headers['x-file-name']||'fichier');try{rawName=decodeURIComponent(rawName)}catch{}
        return json(res,201,{attachment:{id,name:cleanName(rawName),size:bytes.length,type:String(req.headers['content-type']||'application/octet-stream').slice(0,100)}});
      }
      const file=url.pathname.match(/^\/api\/files\/([a-f0-9]{32})$/);
      if(req.method==='GET'&&file){const bytes=uploads.get(file[1]);if(!bytes)return json(res,404,{error:'Fichier introuvable.'});const meta=messages.find(m=>m.attachment&&m.attachment.id===file[1]);if(!meta)return json(res,404,{error:'Fichier supprimé.'});res.writeHead(200,{'content-type':meta.attachment.type,'content-length':bytes.length,'content-disposition':`inline; filename="${cleanName(meta.attachment.name)}"`,'cache-control':'no-store','x-content-type-options':'nosniff'});return res.end(bytes);}
      if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{ok:true});
      return json(res,404,{error:'Route inconnue.'});
    }
    if (req.method!=='GET' && req.method!=='HEAD') return json(res,405,{error:'Méthode non autorisée.'});
    let rel=decodeURIComponent(url.pathname); if(rel==='/'||rel==='/index.html')rel='/index.html';
    const file=path.resolve(ROOT,'.'+rel); if(!file.startsWith(ROOT+path.sep))return json(res,404,{error:'Introuvable.'});
    fs.stat(file,(err,st)=>{if(err||!st.isFile())return json(res,404,{error:'Introuvable.'});const type=MIME[path.extname(file)]||'application/octet-stream';res.writeHead(200,{'content-type':type,'content-length':st.size,'x-content-type-options':'nosniff','cache-control':path.basename(file)==='service-worker.js'?'no-cache':'public, max-age=3600'});if(req.method==='HEAD')return res.end();fs.createReadStream(file).pipe(res);});
  } catch(e) { if(!res.headersSent)json(res,e.status||400,{error:e.status===413?'Fichier trop volumineux.':'Requête invalide.'}); }
});
server.listen(PORT,'0.0.0.0',()=>console.log(`USSL prêt sur le port ${PORT}`));
setInterval(cleanExpiredClients, 5_000).unref();
