const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
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
const CLIENT_TIMEOUT = 20_000;
const CALL_TIMEOUT = 60_000;
// Messages, files and WebRTC signalling exist only in RAM. A server restart clears them.
const messages = [];
const uploads = new Map();
const clients = new Map();       // client id -> { participantId, lastSeen }
const participants = new Map();  // participant id -> { name, lastSeen }
const callPeers = new Map();     // call id -> { a, b, lastSeen }
let callEvents = [];
let nextCallEventId = 1;
let conversationRevision = 0;
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };
function clearConversation() { messages.length = 0; uploads.clear(); conversationRevision++; }
function removeMessage(id) {
  const index = messages.findIndex(m => m.id === id);
  if (index < 0) return false;
  const [item] = messages.splice(index, 1);
  if (item.attachment) uploads.delete(item.attachment.id);
  return true;
}
function pushCallEvent(callId, from, to, type, data = null) {
  callEvents.push({ id: nextCallEventId++, callId, from, to, type, data, createdAt: Date.now() });
  if (callEvents.length > 400) callEvents = callEvents.slice(-300);
}
function cleanup() {
  const now = Date.now();
  for (const [id, client] of clients) if (now - client.lastSeen > CLIENT_TIMEOUT) clients.delete(id);
  const active = new Set([...clients.values()].map(c => c.participantId));
  for (const id of participants.keys()) if (!active.has(id)) participants.delete(id);
  for (const [id, call] of callPeers) {
    const aOnline = participants.has(call.a), bOnline = participants.has(call.b);
    if (now - call.lastSeen > CALL_TIMEOUT || !aOnline || !bOnline) {
      const gone = !aOnline ? call.a : call.b;
      const other = gone === call.a ? call.b : call.a;
      if (now - call.lastSeen <= CALL_TIMEOUT && participants.has(other)) pushCallEvent(id, gone, other, 'hangup');
      callPeers.delete(id);
    }
  }
  callEvents = callEvents.filter(e => now - e.createdAt <= CALL_TIMEOUT);
}
function touchClient(req) {
  cleanup();
  const clientId = String(req.headers['x-ussl-client'] || '').slice(0, 80);
  const participantId = String(req.headers['x-ussl-participant'] || '').slice(0, 80);
  if (clientId && participantId) {
    const now = Date.now();
    clients.set(clientId, { participantId, lastSeen: now });
    participants.set(participantId, { name: String(req.headers['x-ussl-name'] || '').slice(0, 40), lastSeen: now });
  }
  return participantId;
}
function endClient(req) {
  const clientId = String(req.headers['x-ussl-client'] || '').slice(0, 80);
  const participantId = String(req.headers['x-ussl-participant'] || '').slice(0, 80);
  clients.delete(clientId);
  if (![...clients.values()].some(c => c.participantId === participantId)) {
    participants.delete(participantId);
    for (const [callId, call] of callPeers) {
      if (call.a === participantId || call.b === participantId) {
        const other = call.a === participantId ? call.b : call.a;
        pushCallEvent(callId, participantId, other, 'hangup');
        callPeers.delete(callId);
      }
    }
  }
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
      const participantId = touchClient(req);
      if (req.method==='GET' && url.pathname==='/api/messages') return json(res,200,{messages:messages.slice(0,500),revision:conversationRevision});
      if (req.method==='POST' && url.pathname==='/api/messages/read') {
        const data=JSON.parse((await body(req,32000)).toString('utf8'));
        const ids=new Set(Array.isArray(data.ids)?data.ids.filter(id=>typeof id==='string').slice(0,500):[]);
        let deleted=0;
        for (const m of [...messages]) if (ids.has(m.id) && m.senderId!==participantId) { removeMessage(m.id); deleted++; }
        return json(res,200,{ok:true,deleted});
      }
      if (req.method==='DELETE' && url.pathname==='/api/messages') { clearConversation(); return json(res,200,{ok:true,revision:conversationRevision}); }
      if (req.method==='POST' && url.pathname==='/api/session/end') { endClient(req); return json(res,200,{ok:true}); }
      if (req.method==='POST' && url.pathname==='/api/messages') {
        const data=JSON.parse((await body(req,32000)).toString('utf8'));
        const text=String(data.text||'').trim().slice(0,4000), attachment=data.attachment;
        if (!text && !attachment) return json(res,400,{error:'Message vide.'});
        if (messages.length>=MAX_MESSAGES) return json(res,429,{error:'La file temporaire est pleine. L’autre personne doit ouvrir la conversation pour lire les messages en attente.'});
        if (attachment && (!/^[a-f0-9]{32}$/.test(attachment.id||'') || !uploads.has(attachment.id))) return json(res,400,{error:'Pièce jointe introuvable.'});
        const message={id:crypto.randomBytes(16).toString('hex'),senderId:participantId,name:String(data.name||'').trim().slice(0,40)||'Moi',text,attachment:attachment?{id:attachment.id,name:cleanName(attachment.name),size:Number(attachment.size)||0,type:String(attachment.type||'application/octet-stream').slice(0,100)}:null,createdAt:Date.now()};
        messages.push(message); return json(res,201,{message});
      }
      const del=url.pathname.match(/^\/api\/messages\/([a-f0-9]{32})$/);
      if (req.method==='DELETE' && del) { if(!removeMessage(del[1]))return json(res,404,{error:'Message introuvable.'}); return json(res,200,{ok:true}); }
      if (req.method==='POST' && url.pathname==='/api/upload') {
        const size=Number(req.headers['content-length']||0); if(size<=0||size>=MAX_FILE)return json(res,413,{error:'Chaque fichier doit peser moins de 10 Mo.'});
        const storedBytes=[...uploads.values()].reduce((sum,bytes)=>sum+bytes.length,0);
        if(storedBytes+size>MAX_UPLOAD_MEMORY)return json(res,413,{error:'La conversation temporaire a atteint sa limite de pièces jointes. L’autre personne doit lire les messages ou supprimer la conversation.'});
        const bytes=await body(req,MAX_FILE-1); if(!bytes.length)return json(res,400,{error:'Fichier vide.'});
        const id=crypto.randomBytes(16).toString('hex'); uploads.set(id,bytes);
        let rawName=String(req.headers['x-file-name']||'fichier');try{rawName=decodeURIComponent(rawName)}catch{}
        return json(res,201,{attachment:{id,name:cleanName(rawName),size:bytes.length,type:String(req.headers['content-type']||'application/octet-stream').slice(0,100)}});
      }
      const file=url.pathname.match(/^\/api\/files\/([a-f0-9]{32})$/);
      if(req.method==='GET'&&file){const bytes=uploads.get(file[1]);if(!bytes)return json(res,404,{error:'Fichier introuvable.'});const meta=messages.find(m=>m.attachment&&m.attachment.id===file[1]);if(!meta)return json(res,404,{error:'Fichier supprimé.'});res.writeHead(200,{'content-type':meta.attachment.type,'content-length':bytes.length,'content-disposition':`inline; filename="${cleanName(meta.attachment.name)}"`,'cache-control':'no-store','x-content-type-options':'nosniff'});return res.end(bytes);}
      if (url.pathname==='/api/calls' && req.method==='GET') {
        const after=Number(url.searchParams.get('after')||0);
        return json(res,200,{events:callEvents.filter(e=>e.id>after&&e.to===participantId&&Date.now()-e.createdAt<=CALL_TIMEOUT)});
      }
      if (url.pathname==='/api/calls' && req.method==='POST') {
        const data=JSON.parse((await body(req,512*1024)).toString('utf8'));
        const callId=String(data.callId||'');
        const type=String(data.type||'');
        const allowed=['invite','accept','reject','offer','answer','candidate','hangup'];
        if(!/^[a-zA-Z0-9-]{1,80}$/.test(callId)||!allowed.includes(type))return json(res,400,{error:'Signal d’appel invalide.'});
        let peer;
        if(type==='invite') {
          peer=[...participants.entries()].find(([id,p])=>id!==participantId&&Date.now()-p.lastSeen<CLIENT_TIMEOUT);
          if(!peer)return json(res,409,{error:'L’autre personne n’est pas connectée pour le moment.'});
          callPeers.set(callId,{a:participantId,b:peer[0],lastSeen:Date.now()});
        } else {
          const call=callPeers.get(callId);
          if(!call||![call.a,call.b].includes(participantId))return json(res,404,{error:'Cet appel n’est plus disponible.'});
          peer=[call.a===participantId?call.b:call.a,participants.get(call.a===participantId?call.b:call.a)];
          call.lastSeen=Date.now();
        }
        pushCallEvent(callId,participantId,peer[0],type,data.data||null);
        return json(res,201,{ok:true});
      }
      if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{ok:true});
      return json(res,404,{error:'Route inconnue.'});
    }
    if (req.method!=='GET' && req.method!=='HEAD') return json(res,405,{error:'Méthode non autorisée.'});
    let rel=decodeURIComponent(url.pathname); if(rel==='/'||rel==='/index.html')rel='/index.html';
    const file=path.resolve(ROOT,'.'+rel); if(!file.startsWith(ROOT+path.sep))return json(res,404,{error:'Introuvable.'});
    fs.stat(file,(err,st)=>{if(err||!st.isFile())return json(res,404,{error:'Introuvable.'});const type=MIME[path.extname(file)]||'application/octet-stream';res.writeHead(200,{'content-type':type,'content-length':st.size,'x-content-type-options':'nosniff','cache-control':'no-cache'});if(req.method==='HEAD')return res.end();fs.createReadStream(file).pipe(res);});
  } catch(e) { if(!res.headersSent)json(res,e.status||400,{error:e.status===413?'Fichier trop volumineux.':'Requête invalide.'}); }
});
server.listen(PORT,'0.0.0.0',()=>console.log(`USSL prêt sur le port ${PORT}`));
setInterval(cleanup,5_000).unref();
