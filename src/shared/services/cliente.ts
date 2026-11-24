/**
 * El cliente se guarda como un solo texto («N° Cliente y Razón Social», p. ej. «100657 FUCAM»).
 * Para mostrarlo grande hay que separar el número de la razón social; sin número, todo es nombre.
 */
export function partirCliente(cliente?: string | null): { numero: string; nombre: string } {
    const texto = String(cliente || '').trim();
    const m = /^(\d+)[\s\-–:.]*(.*)$/.exec(texto);
    return m ? { numero: m[1] ?? '', nombre: (m[2] ?? '').trim() } : { numero: '', nombre: texto };
}
