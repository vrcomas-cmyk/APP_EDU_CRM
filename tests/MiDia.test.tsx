/**
 * @vitest-environment happy-dom
 *
 * Mi día: las visitas de hoy, lo pendiente resumido y —con equipo— el avance por educador,
 * en una sola ventana. No repite la lógica del calendario ni del tablero: la ejercita.
 */

import { test, describe, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { cleanup, render, screen } from '@testing-library/react';

import { MiDia } from '@modules/midia/components/MiDia';
import { guardarVisitas, guardarCatalogo } from '../js/storage.js';
import { olvidarPerfil } from '../js/permisos.js';
import { claveHoy } from '@core/puente';

function montar() {
    return render(<MiDia onAbrirVisita={() => {}} />);
}

beforeEach(() => {
    localStorage.clear();
    olvidarPerfil();
    guardarCatalogo({ clientes: ['Cliente Uno'], sectores: ['GASAS'] });
});

afterEach(cleanup);

describe('Mi día', () => {
    test('sin visitas hoy, lo dice en vez de una lista vacía', async () => {
        montar();
        assert.ok(screen.getByText('Sin visitas agendadas para hoy.'));
    });

    test('las visitas de hoy aparecen; las de otro día no', async () => {
        // Sin sesión, `alcance()` queda vacío y `visiblePara` no muestra nada de nadie: hay
        // que verlo con una identidad, igual que lo vería un educador de verdad.
        localStorage.setItem('sesion', JSON.stringify({
            correo: 'ana@x.com', nombre: 'Ana López', id_token: 'x', expira: Date.now() + 3600e3
        }));

        guardarVisitas([
            {
                id: 'v-1', educador_correo: 'ana@x.com', cliente: 'Cliente Uno',
                dia: claveHoy(), hora_inicio: '09:00', hora_fin: '10:00', estado: 'programada', sectores: []
            },
            {
                id: 'v-2', educador_correo: 'ana@x.com', cliente: 'Cliente Otro',
                dia: '2020-01-01', hora_inicio: '09:00', hora_fin: '10:00', estado: 'programada', sectores: []
            }
        ]);
        montar();

        assert.ok(screen.getByText('Cliente Uno'));
        assert.equal(screen.queryByText('Cliente Otro'), null);
    });

    test('sin equipo, no ofrece la tabla de avance por educador', async () => {
        montar();
        assert.equal(screen.queryByText('Avance por educador'), null);
    });
});
