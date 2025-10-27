// Variables globales
let currentUser = null;
let historyData = [];
let currentAction = null;
let currentRecord = null;

// Inicializar la aplicación
document.addEventListener('DOMContentLoaded', function() {
    initializeHistory();
});

// Inicializar historial
function initializeHistory() {
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
    
    // Verificar estado de base de datos
    checkDatabaseStatus();
    
    // Cargar historial inicial
    loadHistory();
}

// Configurar interfaz de usuario
function setupUserInterface() {
    const userNameElement = document.getElementById('user-name');
    if (userNameElement && currentUser) {
        userNameElement.textContent = currentUser.name;
    }
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

// Verificar estado de base de datos
async function checkDatabaseStatus() {
    try {
        const response = await fetch('/database_status');
        const result = await response.json();
        
        const statusElement = document.getElementById('db-status');
        const statusText = document.getElementById('db-status-text');
        
        if (result.success && result.db_connected) {
            statusElement.className = 'db-status connected';
            statusText.textContent = 'PostgreSQL';
        } else {
            statusElement.className = 'db-status disconnected';
            statusText.textContent = 'SQLite Local';
        }
        
    } catch (error) {
        console.error('Error verificando estado de BD:', error);
        const statusElement = document.getElementById('db-status');
        const statusText = document.getElementById('db-status-text');
        statusElement.className = 'db-status error';
        statusText.textContent = 'Error';
    }
}

// Cargar historial
async function loadHistory() {
    try {
        showLoading();
        
        // Obtener filtros
        const filters = getFilters();
        
        // Construir URL con parámetros
        const params = new URLSearchParams();
        if (filters.user) params.append('user_name', filters.user);
        if (filters.type) params.append('analysis_type', filters.type);
        params.append('limit', filters.limit);
        
        const response = await fetch(`/get_analysis_history?${params}`);
        const result = await response.json();
        
        hideLoading();
        
        if (result.success) {
            historyData = result.history;
            displayHistory(historyData);
            updateStatistics(result);
            
            if (historyData.length === 0) {
                showNoResults();
            } else {
                hideNoResults();
            }
            
        } else {
            throw new Error(result.error || 'Error cargando historial');
        }
        
    } catch (error) {
        console.error('Error cargando historial:', error);
        hideLoading();
        showNotification('Error cargando historial: ' + error.message, 'error');
        showNoResults();
    }
}

// Obtener filtros actuales
function getFilters() {
    return {
        user: document.getElementById('filter-user').value,
        type: document.getElementById('filter-type').value,
        limit: parseInt(document.getElementById('filter-limit').value)
    };
}

// Mostrar historial en tabla
function displayHistory(data) {
    const tbody = document.getElementById('history-tbody');
    if (!tbody) return;
    
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8">No hay registros para mostrar</td></tr>';
        return;
    }
    
    const rows = data.map(record => {
        const date = formatDateTime(record.timestamp);
        const syncStatus = record.synced ? 
            '<span class="status-badge synced"><i class="fas fa-check"></i> Sincronizado</span>' :
            '<span class="status-badge pending"><i class="fas fa-clock"></i> Pendiente</span>';
        
        const typeNames = {
            'qc_recepcion': 'QC Recepción',
            'packing_qc': 'Packing QC',
            'contramuestra': 'Contramuestra'
        };
        
        return `
            <tr>
                <td>${date}</td>
                <td>${record.user_name}</td>
                <td>${typeNames[record.analysis_type] || record.analysis_type}</td>
                <td>${record.lote}</td>
                <td>${record.distribucion}</td>
                <td class="text-center">
                    <span class="detections-badge">${record.total_detections}</span>
                </td>
                <td>${syncStatus}</td>
                <td class="actions">
                    <button class="btn-icon" onclick="viewDetails(${record.id})" title="Ver detalles">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="btn-icon" onclick="downloadRecord(${record.id})" title="Descargar">
                        <i class="fas fa-download"></i>
                    </button>
                    ${!record.synced ? `
                    <button class="btn-icon upload" onclick="uploadAnalysis(${record.id})" title="Subir a PostgreSQL">
                        <i class="fas fa-upload"></i>
                    </button>
                    ` : ''}
                </td>
            </tr>
        `;
    }).join('');
    
    tbody.innerHTML = rows;
}

// Actualizar estadísticas
function updateStatistics(result) {
    document.getElementById('total-records').textContent = result.count || 0;
    
    if (result.history) {
        const synced = result.history.filter(r => r.synced).length;
        const pending = result.history.filter(r => !r.synced).length;
        
        document.getElementById('synced-records').textContent = synced;
        document.getElementById('pending-records').textContent = pending;
    }
    
    document.getElementById('stats-section').style.display = 'block';
}

// Ver detalles de un registro
async function viewDetails(recordId) {
    try {
        const record = historyData.find(r => r.id === recordId);
        if (!record) {
            showNotification('Registro no encontrado', 'error');
            return;
        }
        
        currentRecord = record;
        
        // Crear contenido de detalles
        const detailsContent = document.getElementById('details-content');
        detailsContent.innerHTML = `
            <div class="detail-item">
                <label>ID:</label>
                <span>${record.id}</span>
            </div>
            <div class="detail-item">
                <label>Fecha/Hora:</label>
                <span>${formatDateTime(record.timestamp)}</span>
            </div>
            <div class="detail-item">
                <label>Usuario:</label>
                <span>${record.user_name}</span>
            </div>
            <div class="detail-item">
                <label>Tipo de Análisis:</label>
                <span>${getAnalysisTypeName(record.analysis_type)}</span>
            </div>
            <div class="detail-item">
                <label>Perfil:</label>
                <span>${getProfileName(record.profile)}</span>
            </div>
            <div class="detail-item">
                <label>Distribución:</label>
                <span>${record.distribucion}</span>
            </div>
            <div class="detail-item">
                <label>Guía SII:</label>
                <span>${record.guia_sii}</span>
            </div>
            <div class="detail-item">
                <label>Lote:</label>
                <span>${record.lote}</span>
            </div>
            <div class="detail-item">
                <label>Número de Frutos:</label>
                <span>${record.num_frutos}</span>
            </div>
            <div class="detail-item">
                <label>Total de Detecciones:</label>
                <span class="detections-badge">${record.total_detections}</span>
            </div>
            <div class="detail-item">
                <label>Zonas Analizadas:</label>
                <span>${record.zones_analyzed}</span>
            </div>
            <div class="detail-item">
                <label>Estado de Sincronización:</label>
                <span class="status-badge ${record.synced ? 'synced' : 'pending'}">
                    <i class="fas fa-${record.synced ? 'check' : 'clock'}"></i>
                    ${record.synced ? 'Sincronizado' : 'Pendiente'}
                </span>
            </div>
        `;
        
        // Agregar detalles de resultados por zona
        if (record.results && Object.keys(record.results).length > 0) {
            const resultsHTML = `
                <div class="detail-item full-width">
                    <label>Resultados por Zona:</label>
                    <div class="results-grid">
                        ${Object.entries(record.results).map(([zone, count]) => `
                            <div class="result-item">
                                <span class="zone-name">${zone}</span>
                                <span class="zone-count">${count}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
            detailsContent.insertAdjacentHTML('beforeend', resultsHTML);
        }
        
        // Mostrar imagen si existe
        const imageContainer = document.getElementById('details-image-container');
        const detailsImage = document.getElementById('details-image');
        
        if (record.processed_image_path) {
            detailsImage.src = record.processed_image_path;
            imageContainer.style.display = 'block';
        } else {
            imageContainer.style.display = 'none';
        }
        
        // Mostrar modal
        document.getElementById('details-modal').style.display = 'flex';
        document.body.style.overflow = 'hidden';
        
    } catch (error) {
        console.error('Error mostrando detalles:', error);
        showNotification('Error mostrando detalles: ' + error.message, 'error');
    }
}

// Descargar registro individual
function downloadRecord(recordId) {
    try {
        const record = historyData.find(r => r.id === recordId);
        if (!record) {
            showNotification('Registro no encontrado', 'error');
            return;
        }
        
        // Crear datos para Excel
        const worksheetData = [];
        
        // Información general
        worksheetData.push(['REPORTE DE ANÁLISIS RANCOQC']);
        worksheetData.push(['']);
        worksheetData.push(['INFORMACIÓN GENERAL']);
        worksheetData.push(['ID:', record.id]);
        worksheetData.push(['Usuario:', record.user_name]);
        worksheetData.push(['Fecha y Hora:', formatDateTime(record.timestamp)]);
        worksheetData.push(['Tipo de Análisis:', getAnalysisTypeName(record.analysis_type)]);
        worksheetData.push(['Perfil:', getProfileName(record.profile)]);
        worksheetData.push(['']);
        
        // Datos de la muestra
        worksheetData.push(['DATOS DE LA MUESTRA']);
        worksheetData.push(['Distribución:', record.distribucion]);
        worksheetData.push(['Guía SII:', record.guia_sii]);
        worksheetData.push(['Lote:', record.lote]);
        worksheetData.push(['Número de Frutos:', record.num_frutos]);
        worksheetData.push(['']);
        
        // Resultados
        worksheetData.push(['RESULTADOS DEL ANÁLISIS']);
        worksheetData.push(['Total de Detecciones:', record.total_detections]);
        worksheetData.push(['Zonas Analizadas:', record.zones_analyzed]);
        worksheetData.push(['']);
        
        // Detalle por zona
        if (record.results && Object.keys(record.results).length > 0) {
            worksheetData.push(['DETALLE POR ZONA']);
            worksheetData.push(['Zona/Defecto', 'Cantidad', 'Porcentaje']);
            
            const total = record.total_detections || 1;
            Object.entries(record.results).forEach(([zone, count]) => {
                const percentage = ((count / total) * 100).toFixed(2);
                worksheetData.push([zone, count, `${percentage}%`]);
            });
        }
        
        // Crear CSV
        const csvContent = worksheetData.map(row => 
            row.map(cell => `"${cell}"`).join(',')
        ).join('\n');
        
        // Descargar
        const blob = new Blob(['\ufeff' + csvContent], { 
            type: 'text/csv;charset=utf-8;' 
        });
        
        const link = document.createElement('a');
        const filename = `RancoQC_${record.lote}_${record.id}_${new Date().toISOString().slice(0, 10)}.csv`;
        
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        showNotification('Reporte descargado: ' + filename, 'success');
        
    } catch (error) {
        console.error('Error descargando registro:', error);
        showNotification('Error al descargar el registro', 'error');
    }
}

// Sincronizar datos pendientes
async function syncPendingData() {
    try {
        const syncBtn = document.getElementById('sync-btn');
        const originalText = syncBtn.innerHTML;
        
        // Mostrar loading en botón
        syncBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sincronizando...';
        syncBtn.disabled = true;
        
        const response = await fetch('/sync_pending_data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_name: currentUser.name })
        });
        
        const result = await response.json();
        
        syncBtn.innerHTML = originalText;
        syncBtn.disabled = false;
        
        if (result.success) {
            const syncResult = result.sync_result;
            const message = `Sincronización completada: ${syncResult.synced} registros sincronizados`;
            
            if (syncResult.errors > 0) {
                showNotification(`${message}, ${syncResult.errors} errores`, 'warning');
            } else {
                showNotification(message, 'success');
            }
            
            // Recargar historial
            await loadHistory();
            
        } else {
            throw new Error(result.error || 'Error en sincronización');
        }
        
    } catch (error) {
        console.error('Error sincronizando:', error);
        showNotification('Error en sincronización: ' + error.message, 'error');
        
        const syncBtn = document.getElementById('sync-btn');
        syncBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Sincronizar';
        syncBtn.disabled = false;
    }
}

// Exportar historial completo a Excel
function exportHistoryToExcel() {
    try {
        if (historyData.length === 0) {
            showNotification('No hay datos para exportar', 'warning');
            return;
        }
        
        // Crear datos para Excel
        const worksheetData = [];
        
        // Encabezado
        worksheetData.push(['HISTORIAL DE ANÁLISIS RANCOQC']);
        worksheetData.push(['Fecha de Exportación:', new Date().toLocaleString('es-CL')]);
        worksheetData.push(['Usuario:', currentUser.name]);
        worksheetData.push(['Total de Registros:', historyData.length]);
        worksheetData.push(['']);
        
        // Columnas
        worksheetData.push([
            'ID', 'Fecha/Hora', 'Usuario', 'Tipo', 'Perfil', 'Distribución', 
            'Guía SII', 'Lote', 'Núm. Frutos', 'Detecciones', 'Zonas', 'Estado'
        ]);
        
        // Datos
        historyData.forEach(record => {
            worksheetData.push([
                record.id,
                formatDateTime(record.timestamp),
                record.user_name,
                getAnalysisTypeName(record.analysis_type),
                getProfileName(record.profile),
                record.distribucion,
                record.guia_sii,
                record.lote,
                record.num_frutos,
                record.total_detections,
                record.zones_analyzed,
                record.synced ? 'Sincronizado' : 'Pendiente'
            ]);
        });
        
        // Crear CSV
        const csvContent = worksheetData.map(row => 
            row.map(cell => `"${cell}"`).join(',')
        ).join('\n');
        
        // Descargar
        const blob = new Blob(['\ufeff' + csvContent], { 
            type: 'text/csv;charset=utf-8;' 
        });
        
        const link = document.createElement('a');
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
        const filename = `RancoQC_Historial_${timestamp}.csv`;
        
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        showNotification('Historial exportado: ' + filename, 'success');
        
    } catch (error) {
        console.error('Error exportando historial:', error);
        showNotification('Error al exportar historial', 'error');
    }
}

// Limpiar caché sincronizado
function clearSyncedCache() {
    currentAction = 'clear_cache';
    showConfirmModal(
        '¿Deseas limpiar el caché local sincronizado? Solo se eliminarán los registros que ya fueron enviados a PostgreSQL.',
        'Limpiar Caché'
    );
}

// Ejecutar acción confirmada
async function confirmAction() {
    if (currentAction === 'clear_cache') {
        await executeCleanCache();
    }
    
    closeConfirmModal();
}

// Ejecutar limpieza de caché
async function executeCleanCache() {
    try {
        const response = await fetch('/clear_local_cache', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification(result.message, 'success');
            await loadHistory();
        } else {
            throw new Error(result.error || 'Error limpiando caché');
        }
        
    } catch (error) {
        console.error('Error limpiando caché:', error);
        showNotification('Error limpiando caché: ' + error.message, 'error');
    }
}

// Subir análisis específico a PostgreSQL
async function uploadAnalysis(recordId) {
    try {
        const record = historyData.find(r => r.id === recordId);
        if (!record) {
            showNotification('Registro no encontrado', 'error');
            return;
        }
        
        if (record.synced) {
            showNotification('Este análisis ya está sincronizado', 'info');
            return;
        }
        
        showNotification('Subiendo análisis a PostgreSQL...', 'info');
        
        // Preparar datos para enviar
        const uploadPayload = {
            analysis_data: {
                source_type: "historical_upload",
                confidence_used: 0.8
            },
            form_data: {
                user: record.user_name,
                profile: record.profile,
                distribucion: record.distribucion,
                analysis_type: record.analysis_type,
                guia_sii: record.guia_sii,
                lote: record.lote,
                num_frutos: record.num_frutos,
                num_proceso: null,
                id_caja: null
            },
            results_data: {
                results: record.results || {},
                total_cherries: record.total_detections || 0,
                confidence_used: 0.8,
                zones_loaded: record.zones_analyzed || 0,
                processed_image: record.processed_image_path || null,
                detections_by_zone: {},
                image_size: null,
                zones_available: Object.keys(record.results || {})
            }
        };
        
        // Enviar al endpoint de forzar subida
        const response = await fetch('/force_upload_analysis', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(uploadPayload)
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification(`Análisis subido exitosamente a PostgreSQL (ID: ${result.analysis_id})`, 'success');
            
            // Recargar historial para actualizar estado
            await loadHistory();
        } else {
            throw new Error(result.error || 'Error desconocido en la subida');
        }
        
    } catch (error) {
        console.error('Error subiendo análisis:', error);
        showNotification('Error subiendo análisis: ' + error.message, 'error');
    }
}

// Descargar reporte del análisis actual
function downloadAnalysisReport() {
    if (currentRecord) {
        downloadRecord(currentRecord.id);
        closeDetailsModal();
    }
}

// Funciones de modal
function closeDetailsModal() {
    document.getElementById('details-modal').style.display = 'none';
    document.body.style.overflow = 'auto';
    currentRecord = null;
}

function showConfirmModal(message, actionText) {
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-action-btn').textContent = actionText;
    document.getElementById('confirm-modal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeConfirmModal() {
    document.getElementById('confirm-modal').style.display = 'none';
    document.body.style.overflow = 'auto';
    currentAction = null;
}

// Funciones de interfaz
function showLoading() {
    document.getElementById('history-loading').style.display = 'flex';
    document.getElementById('history-table-container').style.display = 'none';
    document.getElementById('no-results').style.display = 'none';
}

function hideLoading() {
    document.getElementById('history-loading').style.display = 'none';
    document.getElementById('history-table-container').style.display = 'block';
}

function showNoResults() {
    document.getElementById('no-results').style.display = 'flex';
    document.getElementById('history-table-container').style.display = 'none';
}

function hideNoResults() {
    document.getElementById('no-results').style.display = 'none';
    document.getElementById('history-table-container').style.display = 'block';
}

// Funciones de utilidad
function formatDateTime(isoString) {
    if (!isoString) return '-';
    
    const date = new Date(isoString);
    return date.toLocaleString('es-CL', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getAnalysisTypeName(type) {
    const names = {
        'qc_recepcion': 'QC Recepción',
        'packing_qc': 'Packing QC',
        'contramuestra': 'Contramuestra'
    };
    return names[type] || type;
}

function getProfileName(profile) {
    const names = {
        'qc_recepcion': 'QC Recepción',
        'packing_qc': 'Packing QC',
        'contramuestra': 'Contramuestra'
    };
    return names[profile] || profile;
}

function getCurrentUser() {
    const userData = localStorage.getItem('rancoqc_user');
    return userData ? JSON.parse(userData) : null;
}

function goBack() {
    window.history.back();
}

function showNotification(message, type = 'info') {
    // Crear elemento de notificación
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-triangle' : type === 'warning' ? 'exclamation-triangle' : 'info-circle'}"></i>
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
            .notification.warning { background: #fef3c7; border-left: 4px solid #f59e0b; }
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
            
            /* Estilos específicos para historial */
            .db-status {
                display: flex;
                align-items: center;
                gap: 5px;
                padding: 5px 10px;
                border-radius: 4px;
                font-size: 0.8em;
                font-weight: 500;
            }
            .db-status.connected {
                background: #d1fae5;
                color: #065f46;
            }
            .db-status.disconnected {
                background: #fef3c7;
                color: #92400e;
            }
            .db-status.error {
                background: #fef2f2;
                color: #991b1b;
            }
            
            .status-badge {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 0.75em;
                font-weight: 500;
            }
            .status-badge.synced {
                background: #d1fae5;
                color: #065f46;
            }
            .status-badge.pending {
                background: #fef3c7;
                color: #92400e;
            }
            
            .detections-badge {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 24px;
                height: 24px;
                background: #3b82f6;
                color: white;
                border-radius: 12px;
                font-size: 0.75em;
                font-weight: 600;
            }
            
            .filters-section {
                background: #f9fafb;
                padding: 20px;
                border-radius: 8px;
                margin-bottom: 20px;
            }
            
            .form-group-inline {
                display: flex;
                gap: 15px;
                align-items: end;
                flex-wrap: wrap;
            }
            
            .stats-section {
                margin-bottom: 20px;
            }
            
            .stats-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 15px;
            }
            
            .stat-card {
                background: white;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                display: flex;
                align-items: center;
                gap: 15px;
            }
            
            .stat-icon {
                width: 48px;
                height: 48px;
                border-radius: 8px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 1.5em;
            }
            
            .stat-card:nth-child(1) .stat-icon { background: #dbeafe; color: #3b82f6; }
            .stat-card:nth-child(2) .stat-icon { background: #d1fae5; color: #10b981; }
            .stat-card:nth-child(3) .stat-icon { background: #fef3c7; color: #f59e0b; }
            
            .stat-info h3 {
                margin: 0;
                font-size: 1.8em;
                font-weight: 700;
                color: #1f2937;
            }
            
            .stat-info p {
                margin: 0;
                font-size: 0.875em;
                color: #6b7280;
            }
            
            .history-table-container {
                background: white;
                border-radius: 8px;
                overflow: hidden;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            
            .history-table {
                width: 100%;
                border-collapse: collapse;
            }
            
            .history-table th,
            .history-table td {
                padding: 12px;
                text-align: left;
                border-bottom: 1px solid #e5e7eb;
            }
            
            .history-table th {
                background: #f9fafb;
                font-weight: 600;
                color: #374151;
            }
            
            .history-table .text-center {
                text-align: center;
            }
            
            .history-table .actions {
                display: flex;
                gap: 8px;
                justify-content: center;
            }
            
            .details-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 15px;
                margin-bottom: 20px;
            }
            
            .detail-item {
                display: flex;
                flex-direction: column;
                gap: 5px;
            }
            
            .detail-item.full-width {
                grid-column: 1 / -1;
            }
            
            .detail-item label {
                font-weight: 600;
                color: #374151;
                font-size: 0.875em;
            }
            
            .detail-item span {
                color: #6b7280;
            }
            
            .results-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
                gap: 10px;
                margin-top: 10px;
            }
            
            .result-item {
                background: #f9fafb;
                padding: 10px;
                border-radius: 6px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            
            .zone-name {
                font-size: 0.875em;
                color: #374151;
            }
            
            .zone-count {
                font-weight: 600;
                color: #3b82f6;
            }
            
            .details-image {
                text-align: center;
            }
            
            .details-image img {
                max-width: 100%;
                height: auto;
                border-radius: 8px;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            }
            
            /* Estilos para botones de acción */
            .btn-icon {
                background: #f3f4f6;
                border: none;
                border-radius: 6px;
                padding: 8px;
                cursor: pointer;
                transition: all 0.2s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                width: 32px;
                height: 32px;
            }
            
            .btn-icon:hover {
                background: #e5e7eb;
                transform: scale(1.05);
            }
            
            .btn-icon.upload {
                background: #dbeafe;
                color: #3b82f6;
            }
            
            .btn-icon.upload:hover {
                background: #bfdbfe;
                color: #2563eb;
            }
            
            .btn-primary, .btn-secondary {
                padding: 10px 16px;
                border: none;
                border-radius: 6px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s ease;
                display: inline-flex;
                align-items: center;
                gap: 8px;
            }
            
            .btn-primary {
                background: #3b82f6;
                color: white;
            }
            
            .btn-primary:hover {
                background: #2563eb;
            }
            
            .btn-secondary {
                background: #f3f4f6;
                color: #374151;
            }
            
            .btn-secondary:hover {
                background: #e5e7eb;
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
