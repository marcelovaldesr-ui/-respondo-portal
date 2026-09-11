/**
 * La cola de seguimientos no se atasca (auditoría 11-sep-2026).
 *
 * Filas que no pueden salir y quedan pendientes (tope del cliente, texto libre
 * con la ventana de 24 h cerrada) no deben tapar a las que sí pueden salir.
 * Usa un Supabase falso: no toca la base.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { procesarSeguimientos } from "../lib/seguimientos.ts";
function fakeSupa(rows){
  const upd=[];
  const q=(tabla)=>{ const st={tabla,filters:[],op:"select",lim:null,payload:null};
    const b={select(){return b},is(){return b},lte(){return b},order(){return b},limit(n){st.lim=n;return b},in(){return b},gte(){return b},eq(k,v){st.filters.push([k,v]);return b},contains(){return b},
      update(p){st.op="update";st.payload=p;return b}, insert(){st.op="insert";return Promise.resolve({})},
      maybeSingle(){ if(tabla==="ed_empleados") return Promise.resolve({data:{cliente_id:"c1"}}); if(tabla==="ed_contactos") return Promise.resolve({data:{etiquetas:[]}}); return Promise.resolve({data:null})},
      then(res,rej){ if(st.op==="update"){upd.push(st);return Promise.resolve({}).then(res,rej)}
        if(tabla==="ed_seguimientos"&&st.lim) return Promise.resolve({data:rows.slice(0,st.lim)}).then(res,rej);
        if(tabla==="ed_empleados") return Promise.resolve({data:[{id:"e1",cliente_id:"c1"},{id:"e2",cliente_id:"c2"}]}).then(res,rej);
        return Promise.resolve({data:[]}).then(res,rej);} };
    return b; };
  return {from:q, upd};
}
test("filas pospuestas no tapan a una que sí puede salir", async()=>{
  const rows=[];
  for(let i=0;i<12;i++) rows.push({id:"pospuesto"+i,empleado_id:"e1",chat_id:"x"+i,tipo:"cliente_inactivo",variables:{texto:"hola"},intento:0,max_intentos:1});
  rows.push({id:"sale000001",empleado_id:"e2",chat_id:"y",tipo:"recordatorio_cita",variables:{texto:"recordatorio",params:["a"]},plantilla_meta:"cita_recordatorio",intento:0,max_intentos:1});
  const supa=fakeSupa(rows);
  const ahora=new Date("2026-09-11T15:00:00Z"); // 12:00 Chile
  const r=await procesarSeguimientos({supa,ahora,enviar:async(emp)=> emp==="e1"?{ok:false,omitido:true,error:"ventana"}:{ok:true,waId:"w"}});
  assert.equal(r.enviados,1, r.detalle.join("\n"));
});
test("la tanda sigue topada en 10 intentos reales", async()=>{
  const rows=[]; for(let i=0;i<30;i++) rows.push({id:"ok"+String(i).padStart(8,"0"),empleado_id:"e2",chat_id:"z"+i,tipo:"t",variables:{texto:"t"},intento:0,max_intentos:1});
  const r=await procesarSeguimientos({supa:fakeSupa(rows),ahora:new Date("2026-09-11T15:00:00Z"),enviar:async()=>({ok:true})});
  assert.equal(r.enviados,10);
});
