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
        await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visitas: pendientes })
        });

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
        listaVisitas.innerHTML = '<p class="empty-state">No hay visitas agendadas.</p>';
        return;
    }

    visitas.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    visitas.forEach(visita => {
        const div = document.createElement('div');
        div.className = 'visita-item';
        const fechaFormateada = new Date(visita.fecha).toLocaleString();
        const estadoNube = visita.sincronizado ? '☁️ Guardado en Google' : '⏳ Pendiente';

        div.innerHTML = `
            <h3>${visita.cliente}</h3>
            <p><strong>Sector:</strong> ${visita.sector || 'N/A'}</p>
            <p><strong>Actividad:</strong> ${visita.actividad || 'Ninguna'}</p>
            <p style="font-size: 0.8rem; color: #666;">${fechaFormateada} | ${visita.educador || 'Sin educador'}</p>
            <small style="color: ${visita.sincronizado ? 'green' : 'orange'}"><strong>${estadoNube}</strong></small>
        `;
        listaVisitas.appendChild(div);
    });
}

// --- 🔍 DIAGNÓSTICO Y DESCARGA DE CATÁLOGOS ---
async function descargarDatosMaestros() {
    try {
        console.log("Intentando descargar catálogos de Google Sheets...");
        const response = await fetch(GOOGLE_SCRIPT_URL);
        const datos = await response.json();
        
        console.log("✅ Catálogos recibidos:", datos); // Te dirá qué llegó
        localStorage.setItem('datosPWA', JSON.stringify(datos));
        cargarCatalogosEnUI();
    } catch (error) {
        console.error("❌ Error descargando catálogos:", error);
        alert("Aviso: No se pudieron descargar las listas actualizadas. Verifica la URL o los permisos en Apps Script.");
    }
}

function cargarCatalogosEnUI() {
    const datosGuardados = localStorage.getItem('datosPWA');
    if (!datosGuardados) return; 
    
    const datos = JSON.parse(datosGuardados);
    
    const listaClientes = document.getElementById('lista-clientes');
    if(listaClientes && datos.clientes) {
        listaClientes.innerHTML = '';
        datos.clientes.forEach(c => listaClientes.innerHTML += `<option value="${c}">`);
    }

    const listaSectores = document.getElementById('lista-sectores');
    if(listaSectores && datos.sectores) {
        listaSectores.innerHTML = '';
        datos.sectores.forEach(s => listaSectores.innerHTML += `<option value="${s}">`);
    }

    const listaEducadores = document.getElementById('lista-educadores');
    if(listaEducadores && datos.educadores) {
        listaEducadores.innerHTML = '';
        datos.educadores.forEach(edu => listaEducadores.innerHTML += `<option value="${edu.nombre}">`);
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