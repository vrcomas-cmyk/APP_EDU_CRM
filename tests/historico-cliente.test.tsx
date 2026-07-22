/**
 * @vitest-environment happy-dom
 *
 * El histórico del cliente al agendar: lo que ya se dijo de ese hospital en visitas
 * anteriores, para no perder el hilo entre una visita y la siguiente (posiblemente de otro
 * educador).
 */

import { test, describe, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { cleanup, render, screen } from '@testing-library/react';

import { HistoricoCliente } from '@modules/visitas/components/HistoricoCliente';
import { comentar } from '../js/comentarios.js';
import { olvidarPerfil } from '../js/permisos.js';
import type { Visita } from '@core/tipos';

function conPermisoDeComentar() {
    localStorage.setItem('sesion', JSON.stringify({
        correo: 'ana@x.com', nombre: 'Ana López', id_token: 'x', expira: Date.now() + 3600e3
    }));
    localStorage.setItem('pdt_perfil_cache', JSON.stringify({
        correo: 'ana@x.com', nombre: 'Ana López', rol: 'educador', es_admin: false,
        permisos: ['comentarios.leer', 'comentarios.crear'],
        alcance: ['ana@x.com'], invitado: true, invitacion_estado: 'aceptada', origen: 'prueba'
    }));
}

const visita = (campos: Partial<Visita> = {}): Visita => ({
    id: 'v-actual', hospital: 'Hospital Español', cliente: 'Cliente Uno',
    educador: 'Ana López', educador_correo: 'ana@x.com',
    dia: '2026-07-15', hora_inicio: '09:00', hora_fin: '10:00',
    estado: 'programada', reagendas: [], sectores: [], sincronizado: false,
    ...campos
});

beforeEach(() => {
    localStorage.clear();
    olvidarPerfil();
});

afterEach(cleanup);

describe('HistoricoCliente', () => {
    test('sin comentarios previos del hospital, no muestra nada', () => {
        conPermisoDeComentar();
        render(<HistoricoCliente visita={visita()} />);

        assert.equal(document.querySelector('.historico-cliente'), null);
    });

    test('con comentarios previos del mismo hospital, los muestra', () => {
        conPermisoDeComentar();
        comentar({
            ambito: 'visita', idAmbito: 'v-anterior', texto: 'Piden reforzar gasas y apósitos.',
            visita: { id: 'v-anterior', hospital: 'Hospital Español', cliente: 'Cliente Uno' }
        });

        render(<HistoricoCliente visita={visita()} />);

        assert.ok(screen.getByText(/Lo ya dicho de Hospital Español/));
        assert.ok(document.querySelector('.historico-cliente')?.textContent?.includes('reforzar gasas'));
    });

    test('no incluye comentarios de un hospital distinto', () => {
        conPermisoDeComentar();
        comentar({
            ambito: 'visita', idAmbito: 'v-otro', texto: 'Esto es de otro hospital.',
            visita: { id: 'v-otro', hospital: 'Hospital San José', cliente: 'Cliente Dos' }
        });

        render(<HistoricoCliente visita={visita()} />);

        assert.equal(document.querySelector('.historico-cliente'), null);
    });

    test('no incluye el comentario de la visita en curso', () => {
        conPermisoDeComentar();
        // Un comentario que ya se hizo dentro de ESTA MISMA visita no es "antecedente": es lo
        // que ya se ve en el hilo de la visita, mostrarlo aquí también sería redundante.
        comentar({
            ambito: 'visita', idAmbito: 'v-actual', texto: 'Comentario de esta misma visita.',
            visita: { id: 'v-actual', hospital: 'Hospital Español', cliente: 'Cliente Uno' }
        });

        render(<HistoricoCliente visita={visita()} />);

        assert.equal(document.querySelector('.historico-cliente'), null);
    });

    test('con Zona y Ejecutivo ya resueltos, se repiten en el resumen', () => {
        // Zona · Ejecutivo se resuelven arriba al elegir el Cliente; repetirlos aquí evita que
        // quien revisa el histórico tenga que subir la mirada para confirmarlos.
        conPermisoDeComentar();
        comentar({
            ambito: 'visita', idAmbito: 'v-anterior', texto: 'Piden reforzar gasas y apósitos.',
            visita: { id: 'v-anterior', hospital: 'Hospital Español', cliente: 'Cliente Uno' }
        });

        render(<HistoricoCliente visita={visita({ zona: '801', ejecutivo: 'Sandra Carbajal' })} />);

        const resumen = document.querySelector('.historico-cliente summary')!;
        assert.match(resumen.textContent!, /801/);
        assert.match(resumen.textContent!, /Sandra Carbajal/);
    });

    test('sin hospital todavía capturado, no muestra nada', () => {
        conPermisoDeComentar();
        comentar({
            ambito: 'visita', idAmbito: 'v-anterior', texto: 'Algo dicho antes.',
            visita: { id: 'v-anterior', hospital: 'Hospital Español', cliente: 'Cliente Uno' }
        });

        render(<HistoricoCliente visita={visita({ hospital: '' })} />);

        assert.equal(document.querySelector('.historico-cliente'), null);
    });
});
