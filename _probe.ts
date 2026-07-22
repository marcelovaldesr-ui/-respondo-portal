import * as ev from "./lib/evolution";
import * as rb from "./lib/responderBot";
console.log("evolution exports:", Object.keys(ev).sort().join(", "));
console.log("responderBot exports:", Object.keys(rb).sort().join(", "));
const r = ev.parsearEvolution({event:"messages.upsert", instance:"impresora-color", data:{key:{remoteJid:"56999@s.whatsapp.net",fromMe:false}, pushName:"Juan", message:{conversation:"hola"}}});
console.log("parse OK:", JSON.stringify(r));
console.log("grupo:", ev.parsearEvolution({event:"messages.upsert",instance:"x",data:{key:{remoteJid:"1@g.us"}}}));
console.log("fromMe:", ev.parsearEvolution({data:{key:{remoteJid:"5@s.whatsapp.net",fromMe:true},message:{conversation:"yo"}}}));
