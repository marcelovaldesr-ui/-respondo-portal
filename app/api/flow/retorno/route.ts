import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * PANTALLA DE RETORNO PARA EL NAVEGADOR DEL PAGADOR (`urlReturn`).
 *
 * ⚠️ ZERO-TRUST: Esta ruta NO confirma el pago en la base de datos.
 * La única confirmación autoritativa ocurre en `/api/flow/confirmacion`.
 *
 * Esta vista solo le entrega al cliente una experiencia visual limpia y un enlace
 * directo para regresar a la conversación de WhatsApp con el negocio.
 */
async function renderHtmlRetorno(token: string) {
  let titulo = "Pago Procesado";
  let mensaje = "Tu pago ha sido registrado. Estamos confirmando la transacción con tu banco.";
  let color = "#16a34a"; // verde
  let icono = "✅";

  if (token) {
    try {
      const { data: pago } = await db()
        .from("ed_pagos")
        .select("estado, monto, concepto, chat_id, ed_clientes(nombre)")
        .eq("proveedor_token", token)
        .maybeSingle();

      if (pago) {
        const nombreNegocio = (pago.ed_clientes as { nombre?: string } | null)?.nombre ?? "el negocio";
        if (pago.estado === "pagado") {
          titulo = "¡Pago Confirmado!";
          mensaje = `Recibimos tu pago de $${pago.monto.toLocaleString("es-CL")} por concepto de ${pago.concepto} en ${nombreNegocio}. Ya puedes volver a WhatsApp.`;
        } else if (pago.estado === "rechazado") {
          titulo = "Pago No Completado";
          mensaje = "La transacción no pudo ser autorizada por tu medio de pago. Puedes intentar nuevamente desde la conversación.";
          color = "#dc2626"; // rojo
          icono = "❌";
        }
      }
    } catch {
      // Best-effort
    }
  }

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${titulo} - Respondo</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #f8fafc;
      color: #0f172a;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 1rem;
    }
    .card {
      background: white;
      border-radius: 1rem;
      padding: 2.5rem 2rem;
      max-width: 420px;
      width: 100%;
      text-align: center;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01);
      border: 1px solid #e2e8f0;
    }
    .icon {
      font-size: 3.5rem;
      margin-bottom: 1rem;
      color: ${color};
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 0.75rem 0;
    }
    p {
      color: #64748b;
      font-size: 0.95rem;
      line-height: 1.5;
      margin: 0 0 1.75rem 0;
    }
    .btn {
      display: inline-block;
      background-color: #0f172a;
      color: white;
      text-decoration: none;
      font-weight: 600;
      font-size: 0.95rem;
      padding: 0.75rem 1.5rem;
      border-radius: 0.5rem;
      transition: background-color 0.15s ease;
    }
    .btn:hover {
      background-color: #1e293b;
    }
    .footer {
      margin-top: 1.5rem;
      font-size: 0.75rem;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icono}</div>
    <h1>${titulo}</h1>
    <p>${mensaje}</p>
    <a href="https://wa.me/" class="btn" onclick="window.close();">Volver a WhatsApp</a>
    <div class="footer">Transacción segura procesada por Respondo & Flow.cl</div>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const token = (url.searchParams.get("token") ?? "").trim();
  return renderHtmlRetorno(token);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let token = "";
  try {
    const formData = await req.formData().catch(() => null);
    if (formData) {
      token = String(formData.get("token") ?? "").trim();
    }
  } catch {
    // ignore
  }
  if (!token) {
    const url = new URL(req.url);
    token = (url.searchParams.get("token") ?? "").trim();
  }
  return renderHtmlRetorno(token);
}
