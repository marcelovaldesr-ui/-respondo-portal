"use client";

import { useRef, type FormEvent, type ReactNode } from "react";
import { desvincularPushDeEsteNavegador } from "@/components/pwa/desvincularPush";

/**
 * Formulario de «Cerrar sesión» que primero da de baja los avisos de este
 * navegador (Fase 1). Sigue siendo un <form method="post">: sin JavaScript
 * funciona igual y el servidor borra la suscripción por la huella de la cookie.
 */
export default function FormularioSalir({ className, children }: { className?: string; children: ReactNode }) {
  const enviando = useRef(false);
  const alEnviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (enviando.current) return;
    enviando.current = true;
    const form = e.currentTarget;
    await desvincularPushDeEsteNavegador();
    form.submit(); // submit() no vuelve a disparar onSubmit
  };
  return (
    <form action="/auth/salir" method="post" className={className} onSubmit={alEnviar}>
      {children}
    </form>
  );
}
