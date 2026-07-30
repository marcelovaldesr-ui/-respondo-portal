import { db } from "../lib/db";
import { programarSeguimiento, procesarSeguimientos, empleadoParaEntrante, enHorarioHabil } from "../lib/seguimientos";
import { manejarEntranteWaha } from "../lib/inboundWaha";
const CID="33333333-3333-3333-3333-333333333333";
const TINO="a3333333-0000-0000-0000-000000000001";
const BETO="a3333333-0000-0000-0000-000000000002";
const CHAT="569SEGTEST01";
async function main(){
  const supa=db();
  // limpieza previa
  await supa.from("ed_seguimientos").delete().eq("chat_id",CHAT);
  await supa.from("ed_mensajes").delete().eq("chat_id",CHAT);
  await supa.from("ed_chat_estado").delete().eq("chat_id",CHAT);
  await supa.from("ed_contactos").delete().eq("cliente_id",CID).eq("chat_id",CHAT);

  console.log("horario hábil ahora:", enHorarioHabil());

  // S1: programar seguimiento de BETO vencido hace 1 min
  const p=await programarSeguimiento({empleadoId:BETO,chatId:CHAT,tipo:"cotizacion_sin_respuesta",
    texto:"¡Hola! Te escribo de Impresora Color 😊 ¿Quedó alguna duda con la cotización de las tarjetas que te enviamos?",
    programadoPara:new Date(Date.now()-60000)});
  console.log("S1 programar:", p);

  // S2: correr el motor con transporte mock
  const sent:{emp:string,chat:string,texto:string}[]=[];
  const r=await procesarSeguimientos({enviar:async(e,c,t)=>{sent.push({emp:e,chat:c,texto:t});return{ok:true,waId:"wamid.SEG-"+Math.random().toString(36).slice(2)}}});
  console.log("S2 procesar:", JSON.stringify(r));
  console.log("   enviado por:", sent[0]?.emp===BETO?"BETO ✓":sent[0]?.emp, "| texto:", sent[0]?.texto.slice(0,50));

  // S3: idempotencia — segunda corrida no reenvía
  const r2=await procesarSeguimientos({enviar:async()=>({ok:true})});
  console.log("S3 re-corrida:", JSON.stringify(r2.detalle));

  // S4: ruteo — el chat ahora pertenece a BETO
  const emp=await empleadoParaEntrante(CID,CHAT,TINO,supa);
  console.log("S4 ruteo respuesta →", emp===BETO?"BETO ✓":emp===TINO?"TINO ✗":emp);

  // S5: respuesta_recibida quedó marcada → siguiente entrante vuelve a Tino
  const emp2=await empleadoParaEntrante(CID,CHAT,TINO,supa);
  console.log("S5 tras marcar respuesta →", emp2===TINO?"TINO ✓ (correcto: conversación liberada)":emp2);

  // S6: flujo completo por el inbound real (nuevo seguimiento + entrante WAHA) con cerebro real
  await supa.from("ed_seguimientos").delete().eq("chat_id",CHAT);
  await programarSeguimiento({empleadoId:BETO,chatId:CHAT,tipo:"cotizacion_sin_respuesta",
    texto:"¿Quedó alguna duda con la cotización?",programadoPara:new Date(Date.now()-60000)});
  await procesarSeguimientos({enviar:async()=>({ok:true,waId:"wamid.SEG2"})});
  const sent2:string[]=[];
  const res=await manejarEntranteWaha({event:"message",session:"default",payload:{
    id:"SEGREPLY1",from:CHAT+"@c.us",fromMe:false,body:"si, queria saber si pueden hacerlas para el viernes",timestamp:Math.floor(Date.now()/1000)}},
    {enviar:async(_c,t)=>{sent2.push(t);return{ok:true,waId:"wamid.BR-"+Math.random().toString(36).slice(2)}}});
  console.log("S6 inbound:", JSON.stringify(res));
  const {data:msgs}=await supa.from("ed_mensajes").select("empleado_id,rol,texto").eq("chat_id",CHAT).order("creado_en");
  console.log("   respuesta del cerebro:", sent2[0]?.slice(0,80)||"(nada)");
  console.log("   hilo completo bajo BETO:", (msgs??[]).every(m=>m.empleado_id===BETO)?"SÍ ✓":"NO ✗");

  // limpieza final
  await supa.from("ed_seguimientos").delete().eq("chat_id",CHAT);
  await supa.from("ed_mensajes").delete().eq("chat_id",CHAT);
  await supa.from("ed_chat_estado").delete().eq("chat_id",CHAT);
  await supa.from("ed_contactos").delete().eq("cliente_id",CID).eq("chat_id",CHAT);
  console.log("\n✅ MOTOR DE SEGUIMIENTOS: pruebas S1-S6 completas");
}
main().catch(e=>{console.error("FATAL",e);process.exit(1)});
