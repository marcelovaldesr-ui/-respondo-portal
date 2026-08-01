/**
 * Reparto en carriles de las citas que se pisan dentro de una misma columna
 * del calendario.
 *
 * Está aquí y no dentro del componente para poder probarlo sin navegador: es
 * la única lógica no trivial de la grilla y un error se ve feo (bloques
 * encimados o toda la columna angosta sin razón).
 *
 * Regla clave: los carriles se cuentan POR GRUPO de citas encadenadas, no para
 * el día entero. Si a las 11 hay dos citas encima, solo esas dos se parten por
 * la mitad; la de las 15:00, que está sola, ocupa el ancho completo.
 */

export type Intervalo = { inicio: string; fin: string };

export type EnCarril<T> = { cita: T; carril: number; carriles: number };

export function repartirEnCarriles<T extends Intervalo>(citas: T[]): EnCarril<T>[] {
  const orden = [...citas].sort((a, b) => a.inicio.localeCompare(b.inicio));
  const salida: EnCarril<T>[] = [];

  let grupo: { cita: T; carril: number }[] = [];
  let finPorCarril: number[] = [];
  let finGrupo = -Infinity;

  const cerrar = () => {
    const carriles = Math.max(1, finPorCarril.length);
    for (const g of grupo) salida.push({ ...g, carriles });
    grupo = [];
    finPorCarril = [];
    finGrupo = -Infinity;
  };

  for (const c of orden) {
    const ini = Date.parse(c.inicio);
    const fin = Date.parse(c.fin);
    // Si empieza cuando ya terminó todo lo del grupo anterior, es un grupo nuevo.
    if (ini >= finGrupo) cerrar();
    let carril = finPorCarril.findIndex((f) => f <= ini);
    if (carril === -1) {
      carril = finPorCarril.length;
      finPorCarril.push(fin);
    } else {
      finPorCarril[carril] = fin;
    }
    grupo.push({ cita: c, carril });
    finGrupo = Math.max(finGrupo, fin);
  }
  cerrar();
  return salida;
}
