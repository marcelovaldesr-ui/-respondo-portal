import "./_env";
import { db } from "../lib/db";

const TINO = "a3333333-0000-0000-0000-000000000001";

async function main() {
  const supa = db();
  const { data, error } = await supa
    .from("ed_mensajes")
    .select("chat_id, texto, creado_en")
    .eq("empleado_id", TINO)
    .eq("rol", "humano")
    .order("creado_en", { ascending: false })
    .limit(200);
  if (error) {
    console.error("ERROR:", error);
    process.exit(1);
  }
  console.log(`Total mensajes humanos (Cecilia) encontrados: ${data?.length ?? 0}\n`);
  for (const m of data ?? []) {
    console.log(`[${m.chat_id}] ${m.creado_en}\n  "${m.texto}"\n`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
