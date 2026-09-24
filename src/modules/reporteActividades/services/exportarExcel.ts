import type { FilaReporteActividad } from '@core/tipos';

const COLUMNAS: Array<[string, keyof FilaReporteActividad]> = [
    ['ID visita', 'id_visita'], ['ID actividad', 'id_actividad'], ['Fecha', 'fecha'],
    ['Mes', 'mes'], ['Educador clínico', 'educador'], ['Correo educador', 'educador_correo'],
    ['Gerencia Marca', 'jefe'], ['Correo gerencia', 'jefe_correo'], ['Cliente', 'cliente'],
    ['Hospital', 'hospital'], ['Sector', 'sector'], ['Actividad', 'tipo'],
    ['Área visitada', 'area_visitada'], ['Contacto', 'contacto_nombre'],
    ['Cargo contacto', 'contacto_cargo'], ['Servicio contacto', 'contacto_servicio'],
    ['Hora inicio', 'hora_inicio'], ['Hora fin', 'hora_fin'], ['Estado visita', 'estado_visita'],
    ['Estado evidencia', 'evidencia_estado'], ['Link evidencia', 'evidencia_url']
];

function escaparHtml(valor: unknown): string {
    return String(valor ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Documento HTML con extensión .xls: Excel lo abre como libro y conserva los enlaces. */
export function libroExcelDeActividades(filas: FilaReporteActividad[]): Blob {
    const encabezados = COLUMNAS.map(([nombre]) => `<th>${escaparHtml(nombre)}</th>`).join('');
    const cuerpo = filas.map(fila => `<tr>${COLUMNAS.map(([, clave]) => {
        const valor = fila[clave];
        if (clave === 'evidencia_url' && typeof valor === 'string' && /^https?:\/\//i.test(valor)) {
            const seguro = escaparHtml(valor);
            return `<td><a href="${seguro}">${seguro}</a></td>`;
        }
        return `<td>${escaparHtml(valor)}</td>`;
    }).join('')}</tr>`).join('');

    const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><table><thead><tr>${encabezados}</tr></thead><tbody>${cuerpo}</tbody></table></body></html>`;
    return new Blob(['\uFEFF', html], { type: 'application/vnd.ms-excel;charset=utf-8' });
}

export function descargarReporteExcel(filas: FilaReporteActividad[], fecha = new Date()): void {
    const dia = fecha.toISOString().slice(0, 10);
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(libroExcelDeActividades(filas));
    enlace.download = `reporte-actividades-${dia}.xls`;
    enlace.click();
    URL.revokeObjectURL(enlace.href);
}
