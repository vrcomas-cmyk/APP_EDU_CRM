/**
 * El histórico se pide una vez por persona y sesión: sin duplicar la petición en curso (StrictMode),
 * sin repetirla en cada visita, y sin guardar un fallo.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    actividades: vi.fn(),
    plan: vi.fn(),
    correo: { valor: 'ana@x.com' }
}));

vi.mock('@core/puente', () => ({
    leerHistoricoActividades: mocks.actividades,
    leerHistoricoPlanTrabajo: mocks.plan,
    sesionActual: () => ({ correo: mocks.correo.valor })
}));

import { cargarHistorico, olvidarHistorico } from '../src/modules/historico/services/cacheHistorico';

const ok = (filas: unknown[] = []) => ({ status: 'ok', filas });

beforeEach(() => {
    olvidarHistorico();
    mocks.actividades.mockReset().mockResolvedValue(ok([{ a: 1 }]));
    mocks.plan.mockReset().mockResolvedValue(ok([{ p: 1 }]));
    mocks.correo.valor = 'ana@x.com';
});

describe('cargarHistorico', () => {
    test('dos llamadas simultáneas comparten la misma petición (StrictMode)', async () => {
        const [a, b] = await Promise.all([cargarHistorico(), cargarHistorico()]);

        expect(mocks.actividades).toHaveBeenCalledTimes(1);
        expect(mocks.plan).toHaveBeenCalledTimes(1);
        expect(a).toBe(b);
    });

    test('volver a la pantalla no vuelve a pedir nada', async () => {
        await cargarHistorico();
        const segunda = await cargarHistorico();

        expect(mocks.actividades).toHaveBeenCalledTimes(1);
        expect(mocks.plan).toHaveBeenCalledTimes(1);
        expect(segunda[0].filas).toEqual([{ a: 1 }]);
    });

    test('una respuesta con error del servidor NO se guarda: se reintenta', async () => {
        mocks.actividades.mockResolvedValueOnce({ status: 'error', message: 'sin permiso', filas: [] });
        const primera = await cargarHistorico();
        expect(primera[0].status).toBe('error');

        const segunda = await cargarHistorico();
        expect(mocks.actividades).toHaveBeenCalledTimes(2);
        expect(segunda[0].status).toBe('ok');
    });

    test('un fallo de red NO se guarda: se reintenta', async () => {
        mocks.plan.mockRejectedValueOnce(new Error('sin red'));
        await expect(cargarHistorico()).rejects.toThrow('sin red');

        const segunda = await cargarHistorico();
        expect(mocks.plan).toHaveBeenCalledTimes(2);
        expect(segunda[1].status).toBe('ok');
    });

    test('otra persona en el mismo navegador no ve el histórico de la anterior', async () => {
        await cargarHistorico();
        mocks.correo.valor = 'beto@x.com';
        await cargarHistorico();

        expect(mocks.actividades).toHaveBeenCalledTimes(2);
    });

    test('olvidarHistorico fuerza una recarga', async () => {
        await cargarHistorico();
        olvidarHistorico();
        await cargarHistorico();

        expect(mocks.actividades).toHaveBeenCalledTimes(2);
    });
});
