/**
 * Posición fraccionaria al soltar una tarjeta en el índice `index` de una columna: queda entre sus
 * vecinas sin renumerar las demás. `positions` = posiciones de la columna destino (sin la tarjeta
 * movida), en orden ascendente.
 */
export function positionAt(positions: number[], index: number): number {
  const i = Math.max(0, Math.min(index, positions.length));
  const prev = positions[i - 1];
  const next = positions[i];
  if (prev === undefined && next === undefined) return 1000;
  if (prev === undefined) return next! - 1000;
  if (next === undefined) return prev + 1000;
  return (prev + next) / 2;
}
