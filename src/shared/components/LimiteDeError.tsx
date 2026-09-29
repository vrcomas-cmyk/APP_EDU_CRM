/**
 * Límite de error: si algo lanza al pintarse, se muestra un aviso en su lugar en vez de dejar
 * que React desmonte todo el árbol (el drawer o la vista entera "desaparecía" sin decir por qué).
 *
 * Cambiar `reiniciarCon` (p. ej. el módulo activo) borra el error y vuelve a intentar.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
    children: ReactNode;
    /** Cuando cambia, el límite olvida el error previo y reintenta pintar. */
    reiniciarCon?: unknown;
    /** Contexto para el mensaje: "esta pantalla", "el registro"… */
    donde?: string;
    /** Si se da, el aviso ofrece cerrar (p. ej. el drawer). */
    onCerrar?: () => void;
    /** "capa": el aviso se pinta como una hoja lateral visible (drawer/modal), no en el flujo. */
    variante?: 'vista' | 'capa';
}

interface Estado { error: Error | null; }

export class LimiteDeError extends Component<Props, Estado> {
    override state: Estado = { error: null };

    static getDerivedStateFromError(error: Error): Estado {
        return { error };
    }

    override componentDidCatch(error: Error, info: ErrorInfo): void {
        console.error(`Falló al pintar ${this.props.donde ?? 'la pantalla'}:`, error, info.componentStack);
    }

    override componentDidUpdate(previas: Props): void {
        if (this.state.error && previas.reiniciarCon !== this.props.reiniciarCon) {
            this.setState({ error: null });
        }
    }

    override render(): ReactNode {
        if (!this.state.error) return this.props.children;

        const contenido = (
            <div className="vista" role="alert">
                <p className="vacio-titulo">No se pudo mostrar {this.props.donde ?? 'esta pantalla'}</p>
                <p className="ayuda">Ocurrió un error inesperado. Tus datos no se perdieron.</p>
                <p className="ayuda mono">{this.state.error.message}</p>
                <div>
                    <button type="button" className="btn" onClick={() => this.setState({ error: null })}>
                        Reintentar
                    </button>
                    {this.props.onCerrar && (
                        <button type="button" className="btn-txt" onClick={this.props.onCerrar}>
                            Cerrar
                        </button>
                    )}
                </div>
            </div>
        );

        if (this.props.variante !== 'capa') return contenido;

        // Como capa: sobre todo lo demás y con su velo, para que un fallo del drawer se VEA. Suelto
        // en el flujo caía al final de la página, fuera de pantalla, y parecía que "no abrió nada".
        return (
            <div className="drawer-raiz">
                <div className="scrim" onClick={this.props.onCerrar} />
                <aside className="drawer" role="dialog" aria-modal="true" aria-label="Error">
                    <div className="drawer-body">{contenido}</div>
                </aside>
            </div>
        );
    }
}
