import { getPurchaseCycle } from './purchaseCycle';
import type { HistVenda } from '../types';

export type SchedulableVisit = {
 id:string; cliente_id?:string; semana:number; dia_semana:string; status?:string;
 latitude?:number|null; longitude?:number|null; bairro?:string; cidade?:string;
 horario_inicio?:string; horario_fim?:string; ordem_visita?:number;
};
const slots = [...Array.from({length:6},(_,i)=>480+i*40), ...Array.from({length:5},(_,i)=>810+i*40)];
const clock=(m:number)=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
function distance(a:SchedulableVisit,b:SchedulableVisit) {
 const valid=(v:SchedulableVisit)=>v.latitude!=null&&v.longitude!=null&&Number.isFinite(Number(v.latitude))&&Number.isFinite(Number(v.longitude));
 if(!valid(a)||!valid(b)) return a.bairro && a.bairro===b.bairro && a.cidade===b.cidade ? 0 : Infinity;
 const rad=Math.PI/180, dlat=(Number(a.latitude)-Number(b.latitude))*rad, dlng=(Number(a.longitude)-Number(b.longitude))*rad;
 return 6371*2*Math.asin(Math.min(1,Math.sqrt(Math.sin(dlat/2)**2+Math.cos(Number(a.latitude)*rad)*Math.cos(Number(b.latitude)*rad)*Math.sin(dlng/2)**2)));
}
/** Same daily projection in CRM and Calendar. Never invent capacity beyond 17h. */
export function scheduleVisits<T extends SchedulableVisit>(visits:T[], history:HistVenda[], date:Date):Array<T & {horario_inicio:string;horario_fim:string;ordem_visita:number;sem_horario:boolean}> {
 const sales=new Map<string,HistVenda[]>();
 for(const h of history) {if(!sales.has(h.cliente_id)) sales.set(h.cliente_id,[]);sales.get(h.cliente_id)!.push(h);}
 const gaps=new Map<string,number>();
 for(const v of visits) if(v.cliente_id&&!gaps.has(v.cliente_id)) gaps.set(v.cliente_id,getPurchaseCycle(sales.get(v.cliente_id)||[],date).gap ?? -Infinity);
 const groups=new Map<string,T[]>();
 for(const v of visits) {if(v.status==='cancelada') continue;const key=`${v.semana}:${v.dia_semana}`;if(!groups.has(key)) groups.set(key,[]);groups.get(key)!.push(v);}
 const result:Array<T & {horario_inicio:string;horario_fim:string;ordem_visita:number;sem_horario:boolean}>=[];
 for(const group of groups.values()) {
  const remaining=[...group];let previous:T|undefined;let index=0;
  while(remaining.length) {
   remaining.sort((a,b)=>{
    const ga=gaps.get(a.cliente_id||'')??-Infinity,gb=gaps.get(b.cliente_id||'')??-Infinity;
    if(ga!==gb) return ga>gb?-1:1;
    if(previous) {const da=distance(previous,a),db=distance(previous,b);if(da!==db) return da<db?-1:1;}
    return (a.ordem_visita??0)-(b.ordem_visita??0)||a.id.localeCompare(b.id);
   });
   const v=remaining.shift()!,start=slots[index];
   result.push({...v,horario_inicio:start===undefined?'':clock(start),horario_fim:start===undefined?'':clock(start+40),ordem_visita:index+1,sem_horario:start===undefined});
   previous=v;index++;
  }
 }
 return result;
}
