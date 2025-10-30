// Importar funciones del login
if (typeof window.RancoQC === 'undefined') {
    window.RancoQC = {};
}

// Variables globales
let currentUser = null;
let currentModule = 'packing-qc';

// Inicializar la aplicación
document.addEventListener('DOMContentLoaded', function() {
    initializeDashboard();
});

// Inicializar dashboard
function initializeDashboard() {
    // Verificar autenticación
    currentUser = getCurrentUser();
    if (!currentUser) {
        window.location.href = 'login.html';
        return;
    }
    
    // Configurar interfaz
    setupUserInterface();
    updateTime();
    setInterval(updateTime, 1000);
    
    // Mostrar mensaje de bienvenida
    showWelcomeMessage();
    
    // Configurar permisos de usuario
    setupUserPermissions();
    
    // Cargar actividad reciente
    loadRecentActivity();
    
    // Configurar eventos
    setupEventListeners();
}

// Configurar interfaz de usuario
function setupUserInterface() {
    const userNameElement = document.getElementById('user-name');
    const userFacilityElement = document.getElementById('user-facility');
    const moduleNameElement = document.querySelector('.module-name');
    
    if (userNameElement) userNameElement.textContent = currentUser.name;
    if (userFacilityElement) userFacilityElement.textContent = currentUser.facility;
    if (moduleNameElement) moduleNameElement.textContent = currentUser.module;
}

// Actualizar hora
function updateTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('es-CL', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
    });
    const timeElement = document.getElementById('current-time');
    if (timeElement) {
        timeElement.textContent = timeString;
    }
}

// Mostrar mensaje de bienvenida
function showWelcomeMessage() {
    const successMessage = document.getElementById('success-message');
    if (successMessage) {
        successMessage.style.display = 'block';
        setTimeout(() => {
            successMessage.style.display = 'none';
        }, 3000);
    }
}

// Configurar permisos de usuario
function setupUserPermissions() {
    const createUserBtn = document.getElementById('create-user-btn');
    
    if (currentUser.role === 'admin') {
        if (createUserBtn) {
            createUserBtn.style.display = 'flex';
        }
        
        // Mostrar todas las opciones administrativas
        const adminElements = document.querySelectorAll('.admin-only');
        adminElements.forEach(element => {
            element.style.display = 'flex';
        });
    } else {
        // Ocultar opciones administrativas para usuarios control
        const adminElements = document.querySelectorAll('.admin-only');
        adminElements.forEach(element => {
            element.style.display = 'none';
        });
    }
}

// Cargar actividad reciente
function loadRecentActivity() {
    // En un entorno real, esto vendría de una API
    const activities = [
        {
            icon: 'fas fa-camera',
            title: 'Análisis completado',
            details: 'Lote: 1131R000848 - 25 cerezas detectadas',
            time: 'Hace 2 horas',
            status: 'success'
        },
        {
            icon: 'fas fa-upload',
            title: 'Datos subidos a SDT',
            details: 'Guía SII: 455R000851',
            time: 'Hace 4 horas',
            status: 'success'
        },
        {
            icon: 'fas fa-save',
            title: 'Análisis guardado',
            details: 'Pendiente de subir - Lote: 371',
            time: 'Ayer',
            status: 'pending'
        }
    ];
    
    const activityList = document.getElementById('activity-list');
    if (activityList) {
        activityList.innerHTML = activities.map(activity => `
            <div class="activity-item">
                <div class="activity-icon">
                    <i class="${activity.icon}"></i>
                </div>
                <div class="activity-info">
                    <div class="activity-title">${activity.title}</div>
                    <div class="activity-details">${activity.details}</div>
                    <div class="activity-time">${activity.time}</div>
                </div>
                <div class="activity-status ${activity.status}">
                    <i class="fas fa-${activity.status === 'success' ? 'check-circle' : 'clock'}"></i>
                </div>
            </div>
        `).join('');
    }
}

// Configurar event listeners
function setupEventListeners() {
    // Cerrar modal al hacer clic fuera
    document.addEventListener('click', function(e) {
        const modal = document.getElementById('module-modal');
        if (e.target === modal) {
            closeModal();
        }
    });
    
    // Tecla ESC para cerrar modal
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeModal();
        }
    });
}

// Seleccionar módulo
function selectModule(moduleType) {
    currentModule = moduleType;
    
    // Actualizar interfaz
    const moduleNameElement = document.querySelector('.module-name');
    const moduleNames = {
        'qc-recepcion': 'QC Recepción',
        'packing-qc': 'Packing QC',
        'contramuestras': 'Contramuestras'
    };
    
    if (moduleNameElement) {
        moduleNameElement.textContent = moduleNames[moduleType] || 'Módulo';
    }
    
    // Mostrar modal de selección de análisis
    showModuleModal();
}

// Mostrar modal de módulo
function showModuleModal() {
    const modal = document.getElementById('module-modal');
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
}

// Cerrar modal
function closeModal() {
    const modal = document.getElementById('module-modal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
}

// Iniciar análisis
function startAnalysis(analysisType) {
    closeModal();
    
    // Guardar tipo de análisis en localStorage
    localStorage.setItem('rancoqc_analysis_type', analysisType);
    localStorage.setItem('rancoqc_current_module', currentModule);
    
    // Redirigir a la página de análisis
    window.location.href = 'analysis.html';
}

// Nuevo análisis
function newAnalysis() {
    // Mostrar modal de selección
    showModuleModal();
}

// Ir al historial
function goToHistory() {
    window.location.href = 'history.html';
}

// Ir a inicio
function goHome() {
    // Ya estamos en home, solo actualizar estado activo
    updateFooterActiveState('home');
}

// Ver reportes
function viewReports() {
    window.location.href = 'reports.html';
}

// Crear usuario (solo admin)
function createUser() {
    if (currentUser.role !== 'admin') {
        showNotification('No tienes permisos para crear usuarios', 'error');
        return;
    }
    
    window.location.href = 'crear_usuario.html';
}

// Mostrar configuración
function showSettings() {
    window.location.href = 'settings.html';
}

// Actualizar estado activo del footer
function updateFooterActiveState(activeButton) {
    const footerButtons = document.querySelectorAll('.footer-btn');
    footerButtons.forEach(btn => btn.classList.remove('active'));
    
    const activeBtn = document.querySelector(`.footer-btn[onclick*="${activeButton}"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }
}

// Cerrar sesión
function logout() {
    if (confirm('¿Estás seguro de que deseas cerrar sesión?')) {
        localStorage.removeItem('rancoqc_user');
        localStorage.removeItem('rancoqc_analysis_type');
        localStorage.removeItem('rancoqc_current_module');
        window.location.href = 'login.html';
    }
}

// Obtener usuario actual
function getCurrentUser() {
    const userData = localStorage.getItem('rancoqc_user');
    return userData ? JSON.parse(userData) : null;
}

// Mostrar notificación
function showNotification(message, type = 'info') {
    // Crear elemento de notificación
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-triangle' : 'info-circle'}"></i>
            <span>${message}</span>
            <button onclick="this.parentElement.parentElement.remove()" class="notification-close">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
    
    // Agregar estilos si no existen
    if (!document.querySelector('#notification-styles')) {
        const styles = document.createElement('style');
        styles.id = 'notification-styles';
        styles.textContent = `
            .notification {
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 1000;
                max-width: 400px;
                border-radius: 8px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.2);
                animation: slideInRight 0.3s ease-out;
            }
            .notification.success { background: #d1fae5; border-left: 4px solid #10b981; }
            .notification.error { background: #fef2f2; border-left: 4px solid #ef4444; }
            .notification.info { background: #dbeafe; border-left: 4px solid #3b82f6; }
            .notification-content {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 15px 20px;
                color: #374151;
            }
            .notification-close {
                background: none;
                border: none;
                cursor: pointer;
                color: #6b7280;
                margin-left: auto;
            }
            @keyframes slideInRight {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(styles);
    }
    
    // Agregar al DOM
    document.body.appendChild(notification);
    
    // Auto-remover después de 5 segundos
    setTimeout(() => {
        if (notification.parentElement) {
            notification.remove();
        }
    }, 5000);
}

// Funciones de utilidad
window.DashboardUtils = {
    selectModule,
    newAnalysis,
    goToHistory,
    goHome,
    viewReports,
    createUser,
    showSettings,
    logout,
    closeModal,
    startAnalysis,
    showNotification
};

// Hacer funciones globales para uso en HTML
window.selectModule = selectModule;
window.newAnalysis = newAnalysis;
window.goToHistory = goToHistory;
window.goHome = goHome;
window.viewReports = viewReports;
window.createUser = createUser;
window.showSettings = showSettings;
window.logout = logout;
window.closeModal = closeModal;
window.startAnalysis = startAnalysis;

// Manejar errores globales
window.addEventListener('error', function(e) {
    console.error('Error en dashboard:', e.error);
    showNotification('Ha ocurrido un error inesperado', 'error');
});

// Manejar pérdida de conexión
window.addEventListener('offline', function() {
    showNotification('Sin conexión a internet', 'error');
});

window.addEventListener('online', function() {
    showNotification('Conexión restaurada', 'success');
});

// Prevenir navegación accidental
window.addEventListener('beforeunload', function(e) {
    // Solo mostrar advertencia si hay datos no guardados
    const hasUnsavedData = localStorage.getItem('rancoqc_unsaved_data');
    if (hasUnsavedData) {
        e.preventDefault();
        e.returnValue = '¿Estás seguro de que deseas salir? Hay datos sin guardar.';
        return e.returnValue;
    }
});

// Funciones para animaciones y efectos visuales
function animateCards() {
    const cards = document.querySelectorAll('.module-card, .action-btn');
    cards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        
        setTimeout(() => {
            card.style.transition = 'all 0.5s ease-out';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, index * 100);
    });
}

// Ejecutar animaciones cuando la página esté lista
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(animateCards, 500);
});

// Funciones para manejo de datos offline
function saveDataOffline(key, data) {
    try {
        localStorage.setItem(`rancoqc_offline_${key}`, JSON.stringify({
            data: data,
            timestamp: new Date().toISOString(),
            synced: false
        }));
        return true;
    } catch (error) {
        console.error('Error guardando datos offline:', error);
        return false;
    }
}

function getOfflineData(key) {
    try {
        const stored = localStorage.getItem(`rancoqc_offline_${key}`);
        return stored ? JSON.parse(stored) : null;
    } catch (error) {
        console.error('Error obteniendo datos offline:', error);
        return null;
    }
}

function syncOfflineData() {
    // En un entorno real, esto sincronizaría con el servidor
    const keys = Object.keys(localStorage).filter(key => key.startsWith('rancoqc_offline_'));
    
    keys.forEach(key => {
        const data = getOfflineData(key.replace('rancoqc_offline_', ''));
        if (data && !data.synced) {
            // Simular sincronización
            console.log('Sincronizando:', key, data);
            // Marcar como sincronizado
            data.synced = true;
            localStorage.setItem(key, JSON.stringify(data));
        }
    });
    
    if (keys.length > 0) {
        showNotification(`${keys.length} elementos sincronizados`, 'success');
    }
}

// Sincronizar datos cuando se restaure la conexión
window.addEventListener('online', function() {
    setTimeout(syncOfflineData, 1000);
});

// Exportar funciones para uso en otras páginas
window.RancoQC = {
    ...window.RancoQC,
    getCurrentUser,
    showNotification,
    saveDataOffline,
    getOfflineData,
    syncOfflineData
};
