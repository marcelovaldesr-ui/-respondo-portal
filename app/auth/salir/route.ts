import { NextResponse, type NextRequest } from "next/server";
import { supabaseServidor } from "@/lib/supabaseAuth";

export async function POST(request: NextRequest) {
  const supa = await supabaseServidor();
  await supa.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
