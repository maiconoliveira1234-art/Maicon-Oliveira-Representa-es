import { createClient } from 'npm:@supabase/supabase-js@2.101.1';
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@6.1.0';
import { localDay, cycle, eventBody, eventId, TIME_ZONE } from './model.ts';
const PROJECT = Deno.env.get('SUPABASE_URL')!;
const APP = 'https://maicon-oliveira-representa-es.vercel.app';
const OWNER = 'maicon.oliveira1234@gmail.com';
const CLIENT = Deno.env.get('GOOGLE_CLIENT_ID')!;
const SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;
const CALLBACK = PROJECT+'/functions/v1/google-calendar/callback';
const SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const db = createClient(PROJECT,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const headers = {'Access-Control-Allow-Origin':APP,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
function json(body: unknown, status=200) { return new Response(JSON.stringify(body),{status,headers:{...headers,'Content-Type':'application/json'}}); }
function back(result: string) { return new Response(null,{status:302,headers:{...headers,Location:APP+'/agenda?google_calendar='+result,'Set-Cookie':'gc_state=; Path=/functions/v1/google-calendar; Max-Age=0; HttpOnly; Secure; SameSite=Lax'}}); }
function check<T extends {error:unknown}>(r:T):T { if(r.error) throw new Error('database'); return r; }
function b64(v: Uint8Array) { return btoa(String.fromCharCode(...v)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function bytes(s:string) { return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)); }
async function cryptKey() { return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(SECRET)), 'AES-GCM',false,['encrypt','decrypt']); }
async function encrypt(token:string) {const iv=crypto.getRandomValues(new Uint8Array(12));return b64(iv)+'.'+b64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await cryptKey(),new TextEncoder().encode(token))));}
async function decrypt(token:string) {const [iv,data]=token.split('.');return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv)},await cryptKey(),bytes(data)));}
async function token(params:Record<string,string>) {
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({...params,client_id:CLIENT,client_secret:SECRET}),signal:AbortSignal.timeout(15000)});
 const data=await r.json();if(!r.ok) throw new Error(data.error==='invalid_grant'?'reconnect':'google_auth');return data;
}
async function google(path:string,access:string,method='GET',body?:unknown) {
 const r=await fetch('https://www.googleapis.com/calendar/v3/'+path,{method,headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 if(r.status===409) return {conflict:true};
 if(!r.ok) throw new Error('calendar_'+r.status);
 return r.status===204?{}:await r.json();
}
async function sync() {
 const now=new Date();const day=localDay(now);
 const locked=check(await db.from('google_calendar_connection').update({lock_until:new Date(now.getTime()+10*60000).toISOString()}).eq('id',true).lt('lock_until',now.toISOString()).select()).data;
 if(!locked?.length) return {status:'busy'};
 const conn=locked[0];
 try {
  if(!conn.refresh_token||!conn.calendar_id) return {status:'not_connected'};
  if(conn.last_sync_date===day) return {status:'already_sent',count:conn.last_count};
  const {access_token}=await token({grant_type:'refresh_token',refresh_token:await decrypt(conn.refresh_token)});
  const {week,weekday}=cycle(day);
  const visits=check(await db.from('agenda_visitas').select('id,cliente_id,cliente_nome,horario_inicio,horario_fim,clientes!inner(ativo,cliente)').eq('semana',week).eq('dia_semana',weekday).eq('clientes.ativo',true).neq('status','cancelada')).data||[];
  const extras=check(await db.from('agenda_pendencias').select('id,cliente_id,horario_inicio,horario_fim,dia_inteiro,clientes!inner(ativo,cliente)').eq('tipo','VISITA_EXTRA').eq('data_prevista',day).eq('clientes.ativo',true).in('status',['PENDENTE','EM_ANDAMENTO'])).data||[];
  const items=new Map<string,{name:string,start:string|null,end:string|null,allDay?:boolean}>();
  for(const v of visits) {const c=v.clientes as unknown as {cliente:string}; items.set(v.cliente_id||v.id,{name:c.cliente||v.cliente_nome,start:v.horario_inicio,end:v.horario_fim});}
  for(const v of extras) {const c=v.clientes as unknown as {cliente:string};items.set(v.cliente_id||v.id,{name:c.cliente,start:v.horario_inicio,end:v.horario_fim,allDay:v.dia_inteiro});}
  let count=0;
  for(const [key,item] of items) {
   if(Date.now()-now.getTime()>100000) throw new Error("sync_timeout");
   if(!item.name?.trim()) throw new Error('missing_client_name');
   const id=await eventId(day,key);
   const body=eventBody(day,item.name,item.start,item.end,item.allDay);
   const path='calendars/'+encodeURIComponent(conn.calendar_id)+'/events';
   const created=await google(path,access_token,'POST',{id,...body});
   if(created.conflict) await google(path+'/'+id,access_token,'PUT',body);
   count++;
  }
  check(await db.from('google_calendar_connection').update({last_sync_date:day,last_sync_at:new Date().toISOString(),last_count:count,last_error:null}).eq('id',true));
  return {status:'sent',count,day};
 } catch(e) {
  const code=e instanceof Error && /^(reconnect|google_auth|calendar_\d+|missing_client_name)$/.test(e.message)?e.message:'sync_failed';
  check(await db.from('google_calendar_connection').update({last_error:code}).eq('id',true));
  throw new Error(code);
 } finally {check(await db.from('google_calendar_connection').update({lock_until:'1970-01-01T00:00:00Z'}).eq('id',true));}
}
Deno.serve(async(req:Request)=>{
 const path=new URL(req.url).pathname.split('/').pop();
 try {
  if(req.method==='OPTIONS') return new Response(null,{headers:{...headers,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'content-type'}});
  if(!CLIENT||!SECRET) return json({error:'configuration_missing',missing:[!CLIENT?'GOOGLE_CLIENT_ID':null,!SECRET?'GOOGLE_CLIENT_SECRET':null].filter(Boolean)},503);
  if(path==='status' && req.method==='GET') {
   const r=check(await db.from('google_calendar_connection').select('calendar_id,last_sync_at,last_error').eq('id',true).single()).data;
   return json({connected:!!r.calendar_id,lastSync:r.last_sync_at,error:r.last_error? 'Não foi possível sincronizar. Reconecte ou contate o responsável.':null});
  }
  if(path==='authorize' && req.method==='GET') {
   check(await db.from('google_calendar_states').delete().lt('expires_at',new Date().toISOString()));
   const state=b64(crypto.getRandomValues(new Uint8Array(32))), verifier=b64(crypto.getRandomValues(new Uint8Array(32)));
   check(await db.from('google_calendar_states').insert({state,verifier,expires_at:new Date(Date.now()+600000).toISOString()}));
   const challenge=b64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
   const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
   url.search=new URLSearchParams({client_id:CLIENT,redirect_uri:CALLBACK,response_type:'code',scope:'openid email '+SCOPE,access_type:'offline',prompt:'consent',login_hint:OWNER,state,code_challenge:challenge,code_challenge_method:'S256'}).toString();
   return new Response(null,{status:302,headers:{...headers,Location:url.toString(),'Set-Cookie':`gc_state=${state}; Path=/functions/v1/google-calendar; Max-Age=600; HttpOnly; Secure; SameSite=Lax`}});
  }
  if(path==='callback' && req.method==='GET') {
   const u=new URL(req.url),state=u.searchParams.get('state');
   const cookie=req.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('gc_state='))?.slice(9);
   if(!state||state!==cookie) return back('invalid_state');
   const r=check(await db.from('google_calendar_states').delete().eq('state',state).gt('expires_at',new Date().toISOString()).select()).data;
   if(!r?.length) return back('expired');
   const code=u.searchParams.get('code');if(!code) return back('cancelled');
   const t=await token({grant_type:'authorization_code',code,redirect_uri:CALLBACK,code_verifier:r[0].verifier});
   const {payload}=await jwtVerify(t.id_token,jwks,{issuer:['https://accounts.google.com','accounts.google.com'],audience:CLIENT});
   if(payload.email!==OWNER||payload.email_verified!==true) return back('wrong_account');
   if(!t.scope?.split(' ').includes(SCOPE)||!t.refresh_token) return back('permission_missing');
   const lockTime=new Date();
   const rows=check(await db.from('google_calendar_connection').update({lock_until:new Date(lockTime.getTime()+600000).toISOString()}).eq('id',true).lt('lock_until',lockTime.toISOString()).select()).data;
   if(!rows?.length) return back('busy');
   const conn=rows[0];
   try {
   if(conn.google_sub && conn.google_sub!==payload.sub) return back('wrong_account');
   // Reuse our dedicated calendar across reconnections.
   const calendarId=conn.calendar_id||(await google('calendars',t.access_token,'POST',{summary:'Pro Max',timeZone:TIME_ZONE})).id;
   check(await db.from('google_calendar_connection').update({refresh_token:await encrypt(t.refresh_token),google_sub:payload.sub,calendar_id:calendarId,last_error:null}).eq('id',true));
   } finally {check(await db.from('google_calendar_connection').update({lock_until:'1970-01-01T00:00:00Z'}).eq('id',true));}
   try {const result=await sync();return back(result.status==='busy'?'connected':result.status==='sent'&&result.count===0?'empty':'sent');}catch{return back('sync_failed');}
  }
  if(path==='sync' && req.method==='POST') {
   const bearer=req.headers.get('authorization')?.replace(/^Bearer /,'');
   if(!bearer) return json({error:'unauthorized'},401);
   const conn=check(await db.from('google_calendar_connection').select('cron_secret').eq('id',true).single()).data;
   if(bearer!==conn.cron_secret) return json({error:'unauthorized'},401);
   return json(await sync());
  }
  return json({error:'not_found'},404);
 } catch {return path==='callback'?back('connection_failed'):json({error:'operation_failed'},500);}
});
