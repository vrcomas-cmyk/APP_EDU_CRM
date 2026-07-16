// Registro del Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => console.error(err));
    });
}

// 🔗 URL DE GOOGLE APPS SCRIPT
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyRdGq_Tef6GGg8MWr7_VNLS-VLvx439MTWPpmjJQ3kjXk_6OvtrFc19ehh7_GoVBZZ/exec";

// Elementos del DOM
const form = document.getElementById('visita-form');
const listaVisitas = document.getElementById('lista-visitas');
const statusBadge = document.getElementById('online-status');
const btnSync = document.getElementById('btn-sync');

// Eventos de Conexión
window.addEventListener('online', actualizarEstadoConexion);
window.addEventListener('offline', actualizarEstadoConexion);

function actualizarEstadoConexion() {
    if (navigator.onLine) {
        statusBadge.textContent = "Online";
        statusBadge.className = "badge online";
        btnSync.disabled = false;
        // Intentar sincronizar automáticamente al recuperar internet
        sincronizarConGoogleSheets();
        // Intentar descargar catálogos actualizados al recuperar internet
        descargarDatosMaestros();
    } else {
        statusBadge.textContent = "Offline";
        statusBadge.className = "badge offline";
        btnSync.disabled = true;
    }
}

// Inicialización al cargar la página
document.addEventListener('DOMContentLoaded', () => {
    mostrarVisitas();
    actualizarEstadoConexion();
    cargarCatalogosEnUI(); // Cargar catálogos desde la memoria local primero
    
    // Si hay internet, descargar la versión más fresca de la base de datos en segundo plano
    if (navigator.onLine) {
        descargarDatosMaestros();
    }
});

btnSync.addEventListener('click', sincronizarConGoogleSheets);

// --- GUARDAR VISITA LOCALMENTE ---
form.addEventListener('submit', (e) => {
    e.preventDefault();

    // 🔴 CORRECCIÓN: Aquí agregamos los nuevos campos para que se guarden
    const nuevaVisita = {
        id: Date.now(),
        educador: document.getElementById('educador').value,
        educador_correo: document.getElementById('educador-correo').value,
        cliente: document.getElementById('cliente').value,
        sector: document.getElementById('sector').value,
        fecha: document.getElementById('fecha').value,
        actividad: document.getElementById('actividad').value,
        sincronizado: false // Marcamos como NO sincronizado inicialmente
    };

    let visitas = JSON.parse(localStorage.getItem('visitas')) || [];
    visitas.push(nuevaVisita);
    localStorage.setItem('visitas', JSON.stringify(visitas));

    form.reset();
    document.getElementById('educador-correo').value = ''; // Limpiar el campo oculto
    mostrarVisitas();

    // Si hay internet, intentamos subirlo de una vez
    if (navigator.onLine) {
        sincronizarConGoogleSheets();
    }
});

// --- ENVIAR DATOS A GOOGLE SHEETS ---
async function sincronizarConGoogleSheets() {
    let visitas = JSON.parse(localStorage.getItem('visitas')) || [];
    // Filtrar solo las que no se han subido
    let pendientes = visitas.filter(v => !v.sincronizado);

    if (pendientes.length === 0) return;

    btnSync.textContent = "⌛ Enviando...";

    try {
        const respuesta = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors', // Evita problemas de CORS con Google
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visitas: pendientes })
        });

        // Como usamos 'no-cors', asumimos que si no dio error de red, se envió.
        // Marcamos las pendientes como sincronizadas
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

// --- MOSTRAR VISITAS EN PANTALLA ---
function mostrarVisitas() {
    let visitas = JSON.parse(localStorage.getItem('visitas')) || [];
    listaVisitas.innerHTML = '';

    if (visitas.length === 0) {
        listaVisitas.innerHTML = '<p class="empty-state">No hay visitas agendadas.</p>';
        return;
    }

    visitas.sort((a, b) => new Date(b.fecha) - new Date(a.fecha)); // Ordenar de más reciente a más antigua

    visitas.forEach(visita => {
        const div = document.createElement('div');
        div.className = 'visita-item';
        const fechaFormateada = new Date(visita.fecha).toLocaleString();
        
        // Indicador visual de si ya está en la nube o no
        const estadoNube = visita.sincronizado ? '☁️ Guardado en Google' : '⏳ Pendiente de subir';

        // 🔴 CORRECCIÓN: Mostrar los nuevos campos en la tarjeta
        div.innerHTML = `
            <h3>${visita.cliente}</h3>
            <p><strong>Educador:</strong> ${visita.educador || 'No especificado'}</p>
            <p><strong>Sector:</strong> ${visita.sector || 'No especificado'}</p>
            <p><strong>Fecha:</strong> ${fechaFormateada}</p>
            <p><strong>Actividad:</strong> ${visita.actividad || 'Ninguna'}</p>
            <small style="color: ${visita.sincronizado ? 'green' : 'orange'}"><strong>${estadoNube}</strong></small>
        `;
        listaVisitas.appendChild(div);
    });
}

// --- DESCARGAR Y CARGAR CATÁLOGOS (Autocompletado) ---
async function descargarDatosMaestros() {
    try {
        console.log("Descargando catálogos de Sheets...");
        const response = await fetch(GOOGLE_SCRIPT_URL);
        
        if (!response.ok) {
           throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const datos = await response.json();
        
        // Guardar en la memoria offline
        localStorage.setItem('datosPWA', JSON.stringify(datos));
        cargarCatalogosEnUI();
        console.log("Catálogos actualizados y guardados offline.");
    } catch (error) {
        console.error("No se pudieron descargar los catálogos (se usará versión offline)", error);
    }
}

function cargarCatalogosEnUI() {
    const datosGuardados = localStorage.getItem('datosPWA');
    if (!datosGuardados) return; // Si no hay datos, no hacemos nada
    
    const datos = JSON.parse(datosGuardados);
    
    // 1. Llenar Datalist de Clientes
    const listaClientes = document.getElementById('lista-clientes');
    if(listaClientes && datos.clientes){
        listaClientes.innerHTML = '';
        datos.clientes.forEach(cliente => {
            listaClientes.innerHTML += `<option value="${cliente}">`;
        });
    }

    // 2. Llenar Datalist de Sectores
    const listaSectores = document.getElementById('lista-sectores');
    if(listaSectores && datos.sectores) {
        listaSectores.innerHTML = '';
        datos.sectores.forEach(sector => {
            listaSectores.innerHTML += `<option value="${sector}">`;
        });
    }

    // 3. Llenar Datalist de Educadores
    const listaEducadores = document.getElementById('lista-educadores');
    if(listaEducadores && datos.educadores) {
        listaEducadores.innerHTML = '';
        datos.educadores.forEach(edu => {
            // Mostramos el nombre en la lista
            listaEducadores.innerHTML += `<option value="${edu.nombre}">`;
        });
    }
}

// Escuchar cuando se seleccione un educador para asignar su correo oculto
const educadorInput = document.getElementById('educador');
if(educadorInput){
    educadorInput.addEventListener('change', (e) => {
        const nombreSeleccionado = e.target.value;
        const datosGuardados = localStorage.getItem('datosPWA');
        if (datosGuardados) {
            const datos = JSON.parse(datosGuardados);
            if(datos.educadores){
                const educadorEncontrado = datos.educadores.find(edu => edu.nombre === nombreSeleccionado);
                if (educadorEncontrado) {
                    document.getElementById('educador-correo').value = educadorEncontrado.correo;
                } else {
                     document.getElementById('educador-correo').value = ""; // Si borra o escribe algo que no está en la lista
                }
            }
        }
    });
}