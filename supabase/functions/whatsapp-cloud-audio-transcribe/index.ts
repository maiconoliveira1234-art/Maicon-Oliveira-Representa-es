import { createClient } from "npm:@supabase/supabase-js@2.101.1";
import { GoogleGenAI } from "npm:@google/genai";

const url = Deno.env.get("SUPABASE_URL") || "";
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const gemini = Deno.env.get("GEMINI_API_KEY") || "";
// The secret was registered as EASYCOEXISTENCE_ACCCESS_TOKEN (three C); accept it until it is renamed.
const mediaToken = (Deno.env.get("EASYCOEXISTENCE_ACCESS_TOKEN") ||
  Deno.env.get("EASYCOEXISTENCE_ACCCESS_TOKEN") ||
  Deno.env.get("META_WHATSAPP_ACCESS_TOKEN") ||
  Deno.env.get("WHATSAPP_CLOUD_ACCESS_TOKEN") ||
  Deno.env.get("META_ACCESS_TOKEN") || "").trim();
const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (body: unknown, status=200) =>
  new Response(JSON.stringify(body), {status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_BYTES=16*1024*1024;

async function markError(id:string, description:string, retryable=false) {
  await db.from("whatsapp_mensagens").update({
    audio_status:retryable?"pendente":"erro",
    transcricao_erro:description.slice(0,350)
  }).eq("id",id);
}
Deno.serve(async(req)=>{
  if(req.method!=="POST")return json({error:"method_not_allowed"},405);
  if(!service || req.headers.get("authorization")!==`Bearer ${service}`)
    return json({error:"unauthorized"},401);
  const body=await req.json().catch(()=>({}));
  const messageId=String(body.message_id||"");
  if(!UUID.test(messageId))return json({error:"invalid_id"},400);
  const {data:message,error:lookupError}=await db.from("whatsapp_mensagens")
    .select("id,contato_map_id,cliente_id,tipo_mensagem,app_package,audio_arquivo_nome,audio_status,transcricao_audio")
    .eq("id",messageId).maybeSingle();
  if(lookupError)return json({error:"lookup_failed"},500);
  if(!message || message.tipo_mensagem!=="audio" || message.app_package!=="easycoexistence.cloud_api")
    return json({error:"audio_not_found"},404);
  if(message.transcricao_audio)return json({ok:true,already_transcribed:true});
  const mediaId=String(message.audio_arquivo_nome||"").replace(/^meta-media:/,"");
  if(!/^\d{8,32}$/.test(mediaId)) {
    await markError(messageId,"Identificador de mídia Meta inválido.");
    return json({error:"invalid_media_id"},422);
  }
  if(!mediaToken || !gemini){
    const missing=!mediaToken?"Credencial da Meta para download de mídia não configurada.":"Credencial de transcrição não configurada.";
    await markError(messageId,missing);
    return json({error:"not_configured",detail:missing},503);
  }
  const {data:claimed,error:claimError}=await db.from("whatsapp_mensagens")
    .update({audio_status:"transcrevendo",transcricao_erro:null})
    .eq("id",messageId).in("audio_status",["pendente","erro"])
    .select("id").maybeSingle();
  if(claimError)return json({error:"claim_failed"},500);
  if(!claimed)return json({ok:true,already_processing:true});
  let uploadedName="";
  try {
    const authHeader={Authorization:`Bearer ${mediaToken}`};
    const meta=await fetch(`https://graph.facebook.com/v25.0/${mediaId}`,{headers:authHeader});
    if(!meta.ok)throw new Error(`media_lookup_http_${meta.status}`);
    const info=await meta.json();
    const mediaUrl=new URL(String(info.url||""));
    if(mediaUrl.protocol!=="https:" ||
      !/(^|\.)(?:fbsbx\.com|fbcdn\.net|facebook\.com)$/.test(mediaUrl.hostname))
      throw new Error("untrusted_media_host");
    if(Number(info.file_size)>MAX_BYTES)throw new Error("audio_too_large");
    const audioResponse=await fetch(mediaUrl,{headers:authHeader});
    if(!audioResponse.ok)throw new Error(`media_download_http_${audioResponse.status}`);
    const bytes=await audioResponse.arrayBuffer();
    if(bytes.byteLength===0 || bytes.byteLength>MAX_BYTES)throw new Error("invalid_audio_length");
    const mime=String(info.mime_type||audioResponse.headers.get("content-type")||"audio/ogg")
      .split(";")[0].trim().toLowerCase();
    const normalizedMime=mime==="audio/opus"?"audio/ogg":mime==="application/ogg"?"audio/ogg":mime;
    if(!/^audio\/(ogg|mp4|mpeg|aac|wav|webm|amr|3gpp|x-wav)$/.test(normalizedMime))
      throw new Error("unsupported_mime");
    const file = new File([bytes],`whatsapp-voice-${messageId}.ogg`,{type:normalizedMime});
    const ai=new GoogleGenAI({apiKey:gemini,httpOptions:{apiVersion:"v1beta"}});
    const uploaded=await ai.files.upload({file,config:{mime_type:normalizedMime}} as any);
    uploadedName=String((uploaded as any).name||"");
    // gemini-3.5-transcribe is served by generateContent on v1beta only (the SDK default v1 and the
    // interactions endpoint return 404). If it returns nothing, fall back to a general audio model.
    const prompt="Transcreva fielmente este áudio em português do Brasil. Vocabulário provável: Adimax, Fórmula Natural, Magnus, Origens, Fresh Meat, pet shop, agropecuária. Responda somente com a transcrição, sem comentários.";
    let transcript="";
    let usedModel="";
    let lastDetail="";
    for(const model of ["gemini-3.5-transcribe","gemini-3.5-flash"]){
      try {
        const result=await ai.models.generateContent({
          model,
          contents:[{role:"user",parts:[
            {fileData:{fileUri:(uploaded as any).uri,mimeType:(uploaded as any).mimeType||normalizedMime}},
            {text:prompt}
          ]}]
        } as any);
        transcript=String((result as any).text||"").trim();
        if(transcript){usedModel=model;break;}
        lastDetail=`empty_transcription_${model}_${String((result as any).candidates?.[0]?.finishReason||"")}`;
      } catch(modelError) {
        lastDetail=`${model}: ${modelError instanceof Error?modelError.message:String(modelError)}`.slice(0,200);
      }
    }
    if(!transcript)throw new Error(lastDetail||"empty_transcription");
    const now=new Date().toISOString();
    const {error:writeError}=await db.from("whatsapp_mensagens")
      .update({mensagem:`🎤 ${transcript}`,transcricao_audio:transcript,
        transcricao_modelo:usedModel,transcricao_gerada_em:now,
        audio_status:"transcrito",transcricao_erro:null,audio_tamanho_bytes:bytes.byteLength})
      .eq("id",messageId);
    if(writeError)throw new Error(`transcription_save_failed_${writeError.code}`);
    console.info("cloud audio transcribed",messageId);
    return json({ok:true,transcrito:true});
  }catch(error){
    const detail=error instanceof Error?error.message:String(error);
    console.error("cloud audio transcription failed",messageId,detail);
    await markError(messageId,`Falha ao transcrever: ${detail}`);
    return json({error:"transcription_failed",reason:detail},502);
  }finally {
    if(uploadedName){
      try {await new GoogleGenAI({apiKey:gemini,httpOptions:{apiVersion:"v1beta"}}).files.delete({name:uploadedName} as any);}
      catch {console.warn("temporary gemini audio cleanup failed")}
    }
  }
});
