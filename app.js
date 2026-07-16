// Registro del Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => console.error(err));
    });
}

// 🔗 URL DE GOOGLE APPS SCRIPT
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyRdGq_Tef6GGg8MWr7_VNLS-VLvx439MTWPpmjJQ3kjXk_6OvtrFc19ehh7_GoVBZZ/exec";

const form = document.getElementById('visita-form');
const listaVisitas = document.getElementById('lista-visitas');
const statusBadge = document.getElementById('online-status');
const btnSync = document.getElementById('btn-sync');
const sectoresContainer = document.getElementById('sectores-container');
const btnAddSector = document.getElementById('btn-add-sector');

window.addEventListener('online', actualizarEstadoConexion);
window.addEventListener('offline', actualizarEstadoConexion);

function actualizarEstadoConexion() {
    if (navigator.onLine) {
        statusBadge.textContent = "Online";
        statusBadge.className = "badge online";
        btnSync.disabled = false;
        sincronizarConGoogleSheets();
        descargarDatosMaestros();
    } else {
        statusBadge.textContent = "Offline";
        statusBadge.className = "badge offline";
        btnSync.disabled = true;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    mostrarVisitas();
    actualizarEstadoConexion();
    cargarCatalogosEnUI(); 
    if (navigator.onLine) descargarDatosMaestros();
});

btnSync.addEventListener('click', sincronizarConGoogleSheets);

// --- ➕ LÓGICA PARA AÑADIR MÚLTIPLES SECTORES ---
btnAddSector.addEventListener('click', () => {
    const nuevoBloque = document.createElement('div');
    nuevoBloque.className = 'sector-block form-group';
    nuevoBloque.style.cssText = 'border-left: 4px solid var(--primary); padding-left: 10px; margin-bottom: 15px; margin-top: 15px;';
    
    nuevoBloque.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <label>Siguiente Sector:</label>
            <button type="button" class="btn-remove-sector" style="background: #f44336; color: white; border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer;">X Quitar</button>
        </div>
        <input type="text" class="sector-input" list="lista-sectores" required placeholder="Escribe el sector...">
        
        <label style="margin-top: 10px; display: block;">Actividad para este sector:</label>
        <textarea class="actividad-input" required placeholder="Detalles de la revisión..."></textarea>
    `;
    sectoresContainer.appendChild(nuevoBloque);

    // Evento para eliminar el bloque si se equivocan
    nuevoBloque.querySelector('.btn-remove-sector').addEventListener('click', () => {
        nuevoBloque.remove();
    });
});

// --- 💾 GUARDAR VISITA (UNA FILA POR CADA SECTOR) ---
form.addEventListener('submit', (e) => {
    e.preventDefault();

    let visitas = JSON.parse(localStorage.getItem('visitas')) || [];
    const baseId = Date.now();
    
    const educador = document.getElementById('educador').value;
    const correo = document.getElementById('educador-correo').value;
    const cliente = document.getElementById('cliente').value;
    const fecha = document.getElementById('fecha').value;

    const bloquesSectores = document.querySelectorAll('.sector-block');

    // Generar un registro por cada sector agregado
    bloquesSectores.forEach((bloque, index) => {
        const sectorValor = bloque.querySelector('.sector-input').value;
        const actividadValor = bloque.querySelector('.actividad-input').value;

        const nuevaVisita = {
            id: baseId + index, // ID único para cada fila
            educador: educador,
            educador_correo: correo,
            cliente: cliente,
            sector: sectorValor,
            fecha: fecha,
            actividad: actividadValor,
            sincronizado: false
        };
        visitas.push(nuevaVisita);
    });

    localStorage.setItem('visitas', JSON.stringify(visitas));
    
    // Limpiar formulario y reiniciar al estado de 1 solo sector
    form.reset();
    document.getElementById('educador-correo').value = '';
    sectoresContainer.innerHTML = `
        <div class="sector-block form-group" style="border-left: 4px solid var(--primary); padding-left: 10px; margin-bottom: 15px;">
            <label>Sector a revisar:</label>
            <input type="text" class="sector-input" list="lista-sectores" required placeholder="Escribe el sector...">
            <label style="margin-top: 10px; display: block;">Actividad para este sector:</label>
            <textarea class="actividad-input" required placeholder="Detalles de la revisión..."></textarea>
        </div>
    `;
    
    mostrarVisitas();
    if (navigator.onLine) sincronizarConGoogleSheets();
});

// --- ENVIAR DATOS A GOOGLE SHEETS ---
async function sincronizarConGoogleSheets() {
    let visitas = JSON.parse(localStorage.getItem('visitas')) || [];
    let pendientes = visitas.filter(v => !v.sincronizado);
    if (pendientes.length === 0) return;

    btnSync.textContent = "⌛ Enviando...";

    try {
        // Content-Type text/plain evita el preflight OPTIONS (Apps Script no lo soporta)
        // y a diferencia de no-cors, la respuesta deja de ser opaca: sí podemos confirmar éxito.
        const response = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ visitas: pendientes })
        });

        if (!response.ok) {
            throw new Error(`Respuesta del servidor: ${response.status}`);
        }

        const resultado = await response.json().catch(() => null);
        if (resultado && resultado.status === 'error') {
            throw new Error(resultado.message || 'Apps Script reportó un error');
        }

        visitas = visitas.map(v => {
            if (!v.sincronizado) v.sincronizado = true;
            return v;
        });

        localStorage.setItem('visitas', JSON.stringify(visitas));
        btnSync.textContent = "✅ ¡Al día!";
        setTimeout(() => btnSync.textContent = "🔄 Sincronizar", 2000);
        mostrarVisitas();
    } catch (error) {
        console.error("Error al sincronizar:", error);
        btnSync.textContent = "❌ Error";
        setTimeout(() => btnSync.textContent = "🔄 Sincronizar", 2000);
    }
}

// --- MOSTRAR VISITAS ---
function mostrarVisitas() {
    let visitas = JSON.parse(localStorage.getItem('visitas')) || [];
    listaVisitas.innerHTML = '';

    if (visitas.length === 0) {
        const p = document.createElement('p');
        p.className = 'empty-state';
        p.textContent = 'No hay visitas agendadas.';
        listaVisitas.appendChild(p);
        return;
    }

    visitas.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    visitas.forEach(visita => {
        const div = document.createElement('div');
        div.className = 'visita-item';
        const fechaFormateada = new Date(visita.fecha).toLocaleString();
        const estadoNube = visita.sincronizado ? '☁️ Guardado en Google' : '⏳ Pendiente';

        const h3 = document.createElement('h3');
        h3.textContent = visita.cliente;

        const pSector = document.createElement('p');
        pSector.innerHTML = '<strong>Sector:</strong> ';
        pSector.appendChild(document.createTextNode(visita.sector || 'N/A'));

        const pActividad = document.createElement('p');
        pActividad.innerHTML = '<strong>Actividad:</strong> ';
        pActividad.appendChild(document.createTextNode(visita.actividad || 'Ninguna'));

        const pMeta = document.createElement('p');
        pMeta.style.cssText = 'font-size: 0.8rem; color: #666;';
        pMeta.textContent = `${fechaFormateada} | ${visita.educador || 'Sin educador'}`;

        const small = document.createElement('small');
        small.style.color = visita.sincronizado ? 'green' : 'orange';
        const strong = document.createElement('strong');
        strong.textContent = estadoNube;
        small.appendChild(strong);

        div.append(h3, pSector, pActividad, pMeta, small);
        listaVisitas.appendChild(div);
    });
}

// --- 🔍 DIAGNÓSTICO Y DESCARGA DE CATÁLOGOS ---
async function descargarDatosMaestros() {
    try {
        console.log("Intentando descargar catálogos de Google Sheets...");
        
        // Un fetch limpio, Google maneja la redirección (302) solo si los permisos están en "Cualquier persona"
        const response = await fetch(GOOGLE_SCRIPT_URL);
        
        if (!response.ok) {
            throw new Error('Error en la respuesta del servidor');
        }
        
        const datos = await response.json();
        
        console.log("✅ Catálogos recibidos:", datos);
        localStorage.setItem('datosPWA', JSON.stringify(datos));
        cargarCatalogosEnUI();
    } catch (error) {
        console.error("❌ Error descargando catálogos:", error);
    }
}

function cargarCatalogosEnUI() {
    const datosGuardados = localStorage.getItem('datosPWA');
    if (!datosGuardados) return; 
    
    const datos = JSON.parse(datosGuardados);
    
    const listaClientes = document.getElementById('lista-clientes');
    if(listaClientes && datos.clientes) {
        listaClientes.innerHTML = '';
        datos.clientes.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            listaClientes.appendChild(opt);
        });
    }

    const listaSectores = document.getElementById('lista-sectores');
    if(listaSectores && datos.sectores) {
        listaSectores.innerHTML = '';
        datos.sectores.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s;
            listaSectores.appendChild(opt);
        });
    }

    const listaEducadores = document.getElementById('lista-educadores');
    if(listaEducadores && datos.educadores) {
        listaEducadores.innerHTML = '';
        datos.educadores.forEach(edu => {
            const opt = document.createElement('option');
            opt.value = edu.nombre;
            listaEducadores.appendChild(opt);
        });
    }
}

// Escuchar cambios para el correo del educador
const educadorInput = document.getElementById('educador');
if(educadorInput){
    educadorInput.addEventListener('change', (e) => {
        const nombreSeleccionado = e.target.value;
        const datosGuardados = localStorage.getItem('datosPWA');
        if (datosGuardados) {
            const datos = JSON.parse(datosGuardados);
            if(datos.educadores){
                const educador = datos.educadores.find(edu => edu.nombre === nombreSeleccionado);
                document.getElementById('educador-correo').value = educador ? educador.correo : "";
            }
        }
    });
}