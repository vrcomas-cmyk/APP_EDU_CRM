// Registrar el Service Worker para soporte Offline
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker registrado con éxito', reg.scope))
            .catch(err => console.error('Error al registrar el Service Worker', err));
    });
}

// Elementos del DOM
const form = document.getElementById('visita-form');
const listaVisitas = document.getElementById('lista-visitas');
const statusBadge = document.getElementById('online-status');

// Detectar estado de la conexión
window.addEventListener('online', actualizarEstadoConexion);
window.addEventListener('offline', actualizarEstadoConexion);

function actualizarEstadoConexion() {
    if (navigator.onLine) {
        statusBadge.textContent = "Online";
        statusBadge.className = "badge online";
    } else {
        statusBadge.textContent = "Offline";
        statusBadge.className = "badge offline";
    }
}

// Cargar visitas al iniciar
document.addEventListener('DOMContentLoaded', () => {
    mostrarVisitas();
    actualizarEstadoConexion();
});

// Manejar el envío del formulario
form.addEventListener('submit', (e) => {
    e.preventDefault();

    const nuevaVisita = {
        id: Date.now(),
        cliente: document.getElementById('cliente').value,
        fecha: document.getElementById('fecha').value,
        actividad: document.getElementById('actividad').value
    };

    // Guardar en LocalStorage
    let visitas = JSON.parse(localStorage.getItem('visitas')) || [];
    visitas.push(nuevaVisita);
    localStorage.setItem('visitas', JSON.stringify(visitas));

    form.reset();
    mostrarVisitas();
});

// Función para pintar las visitas en pantalla
function mostrarVisitas() {
    let visitas = JSON.parse(localStorage.getItem('visitas')) || [];
    listaVisitas.innerHTML = '';

    if (visitas.length === 0) {
        listaVisitas.innerHTML = '<p class="empty-state">No hay visitas agendadas.</p>';
        return;
    }

    // Ordenar por fecha más reciente
    visitas.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

    visitas.forEach(visita => {
        const div = document.createElement('div');
        div.className = 'visita-item';
        
        // Formatear fecha legible
        const fechaFormateada = new Date(visita.fecha).toLocaleString();

        div.innerHTML = `
            <h3>${visita.cliente}</h3>
            <p><strong>Fecha:</strong> ${fechaFormateada}</p>
            <p><strong>Actividad:</strong> ${visita.actividad || 'Ninguna'}</p>
        `;
        listaVisitas.appendChild(div);
    });
}