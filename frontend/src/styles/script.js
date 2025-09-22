let currentResults = {};
let availableZones = [];
let selectedFile = null;
let confirmCallback = null;

// Inicialización
document.addEventListener('DOMContentLoaded', function() {
    updateTime();
    setInterval(updateTime, 1000);
    loadAvailableZones();
    setupEventListeners();
});

function updateTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('es-CL', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    document.getElementById('current-time').textContent = timeString;
}

function setupEventListeners() {
    // Event listeners para ambos inputs de archivo
    document.getElementById('file-input').addEventListener('change', handleImageSelect);
    document.getElementById('camera-input').addEventListener('change', handleImageSelect);
    
    // Validación de formulario en tiempo real
    const inputs = document.querySelectorAll('input, select');
    inputs.forEach(input => {
        input.addEventListener('blur', validateField);
        input.addEventListener('input', clearFieldError);
    });
}

async function loadAvailableZones() {
    try {
        const response = await fetch('/get_zones');
        const data = await response.json();
        availableZones = data.zones || [];
        
        console.log('📍 Zonas cargadas:', data);
        
        // Llenar select de defectos en modal
        const defectSelect = document.getElementById('defect-type');
        defectSelect.innerHTML = '<option value="">Seleccionar...</option>';
        
        availableZones.forEach(zone => {
            const option = document.createElement('option');
            option.value = zone;
            option.textContent = zone;
            defectSelect.appendChild(option);
        });
        
        showNotification(`Zonas cargadas: ${availableZones.length}`, 'success');
        
    } catch (error) {
        console.error('Error cargando zonas:', error);
        showNotification('Error cargando zonas disponibles', 'error');
    }
}

function handleImageSelect(event) {
    const file = event.target.files[0];
    if (file) {
        selectedFile = file;
        
        // Validar tipo de archivo
        if (!file.type.startsWith('image/')) {
            showNotification('Por favor seleccione un archivo de imagen válido', 'error');
            return;
        }
        
        // Validar tamaño (máximo 10MB)
        if (file.size > 10 * 1024 * 1024) {
            showNotification('La imagen es demasiado grande. Máximo 10MB.', 'error');
            return;
        }
        
        // Mostrar preview de la imagen original
        const reader = new FileReader();
        reader.onload = function(e) {
            const captureArea = document.getElementById('capture-area');
            const preview = document.getElementById('camera-preview');
            
            preview.innerHTML = `
                <div class="original-image-container">
                    <h4>Imagen Original</h4>
                    <img src="${e.target.result}" alt="Preview" class="image-preview image-selected">
                    <div class="image-info">${file.name} (${formatFileSize(file.size)})</div>
                </div>
            `;
            
            captureArea.classList.add('has-image');
        };
        reader.readAsDataURL(file);
        
        // Habilitar botón de análisis
        const analyzeBtn = document.getElementById('analyze-btn');
        analyzeBtn.disabled = false;
        analyzeBtn.innerHTML = '<i class="fas fa-search"></i> Analizar imagen';
        
        showNotification('Imagen cargada correctamente', 'success');
    }
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function validateField(event) {
    const field = event.target;
    const formGroup = field.closest('.form-group');
    
    if (field.value.trim() === '') {
        formGroup.classList.add('error');
        formGroup.classList.remove('success');
    } else {
        formGroup.classList.remove('error');
        formGroup.classList.add('success');
    }
}

function clearFieldError(event) {
    const field = event.target;
    const formGroup = field.closest('.form-group');
    formGroup.classList.remove('error');
}

function validateForm() {
    const requiredFields = ['distribucion', 'guia-sii', 'lote', 'num-frutos'];
    let isValid = true;
    
    requiredFields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        const formGroup = field.closest('.form-group');
        
        if (field.value.trim() === '') {
            formGroup.classList.add('error');
            isValid = false;
        } else {
            formGroup.classList.remove('error');
            formGroup.classList.add('success');
        }
    });
    
    return isValid;
}

async function analyzeImage() {
    // Validar formulario
    if (!validateForm()) {
        showNotification('Por favor complete todos los campos requeridos', 'error');
        return;
    }

    if (!selectedFile) {
        showNotification('Por favor seleccione una imagen', 'error');
        return;
    }

    // Mostrar loading
    showLoading(true, 'Procesando imagen con modelo YOLO (confianza 80%)...');

    try {
        const formData = new FormData();
        formData.append('image', selectedFile);

        // Agregar confianza fija 0.8
        formData.append('confidence', "0.8");

        // Agregar datos del formulario
        formData.append('distribucion', document.getElementById('distribucion').value);
        formData.append('guia_sii', document.getElementById('guia-sii').value);
        formData.append('lote', document.getElementById('lote').value);
        formData.append('num_frutos', document.getElementById('num-frutos').value);

        console.log('📤 Enviando imagen con confianza = 0.8');

        const response = await fetch('/analyze_cherries', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        console.log('📥 Respuesta del servidor:', data);

        if (data.success) {
            currentResults = data.results;
            displayResults(data);
            showSection('results-section');
            showNotification(`Análisis completado: ${data.total_cherries} cerezas detectadas (conf: ${data.confidence_used})`, 'success');
        } else {
            showNotification('Error en el análisis: ' + data.error, 'error');
        }

    } catch (error) {
        console.error('❌ Error:', error);
        showNotification('Error de conexión. Verifique su conexión a internet.', 'error');
    } finally {
        showLoading(false);
    }
}

function displayResults(data) {
    // Actualizar información general
    document.getElementById('total-cherries').textContent = data.total_cherries || 0;
    document.getElementById('analysis-timestamp').textContent = data.timestamp || new Date().toLocaleString();
    document.getElementById('zones-analyzed').textContent = data.zones_loaded || 0;
    
    // Mostrar lista de defectos
    const defectsList = document.getElementById('defects-list');
    defectsList.innerHTML = '';
    
    // Crear contenedor para imagen procesada
    if (data.processed_image) {
        const imageContainer = document.createElement('div');
        imageContainer.className = 'analyzed-image-container';
        imageContainer.innerHTML = `
            <h3><i class="fas fa-search"></i> Imagen Analizada</h3>
            <div class="image-analysis-info">
                <span><i class="fas fa-image"></i> Tamaño: ${data.image_size || 'N/A'}</span>
                <span><i class="fas fa-bullseye"></i> Detecciones: ${data.total_cherries}</span>
                <span><i class="fas fa-map-marked-alt"></i> Zonas: ${data.zones_loaded}</span>
            </div>
            <div class="analyzed-image-wrapper">
                <img src="${data.processed_image}?t=${Date.now()}" 
                     alt="Resultado análisis" 
                     class="analyzed-image"
                     onload="this.classList.add('loaded')" />
                <div class="image-overlay">
                    <button class="btn btn-secondary" onclick="downloadImage('${data.processed_image}')">
                        <i class="fas fa-download"></i> Descargar
                    </button>
                    <button class="btn btn-primary" onclick="viewFullscreen('${data.processed_image}')">
                        <i class="fas fa-expand"></i> Ver completa
                    </button>
                </div>
            </div>
        `;
        defectsList.appendChild(imageContainer);
    }
    
    // Mostrar resultados por zona
    const resultsContainer = document.createElement('div');
    resultsContainer.className = 'zone-results-container';
    
    if (Object.keys(data.results).length === 0) {
        resultsContainer.innerHTML = `
            <div class="zone-result-item no-defects">
                <div class="zone-info">
                    <i class="fas fa-check-circle"></i>
                    <span class="zone-name">No se detectaron defectos</span>
                </div>
                <span class="zone-count success">0</span>
            </div>
        `;
    } else {
        resultsContainer.innerHTML = '<h3><i class="fas fa-list"></i> Detecciones por Zona</h3>';
        
        Object.entries(data.results).forEach(([defect, count]) => {
            const resultItem = document.createElement('div');
            resultItem.className = 'zone-result-item';
            resultItem.innerHTML = `
                <div class="zone-info">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span class="zone-name">${defect}</span>
                </div>
                <div class="zone-actions">
                    <span class="zone-count" id="count-${defect.replace(/\\s+/g, '-')}">${count}</span>
                    <button class="btn btn-edit btn-small" onclick="editDefectCount('${defect}')" title="Editar cantidad">
                        <i class="fas fa-edit"></i>
                    </button>
                </div>
            `;
            resultsContainer.appendChild(resultItem);
        });
    }
    
    defectsList.appendChild(resultsContainer);
    
    // Log para debugging
    if (data.detections_by_zone) {
        console.log('🔍 Detecciones por zona:', data.detections_by_zone);
    }
}

function downloadImage(imageUrl) {
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `analisis_${new Date().getTime()}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showNotification('Descarga iniciada', 'success');
}

function viewFullscreen(imageUrl) {
    const modal = document.createElement('div');
    modal.className = 'fullscreen-modal';
    modal.innerHTML = `
        <div class="fullscreen-content">
            <button class="close-fullscreen" onclick="this.parentElement.parentElement.remove()">
                <i class="fas fa-times"></i>
            </button>
            <img src="${imageUrl}" alt="Imagen completa" class="fullscreen-image">
        </div>
    `;
    
    // Agregar estilos para modal fullscreen
    if (!document.querySelector('.fullscreen-styles')) {
        const style = document.createElement('style');
        style.className = 'fullscreen-styles';
        style.textContent = `
            .fullscreen-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.9);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 2000;
            }
            .fullscreen-content {
                position: relative;
                max-width: 95%;
                max-height: 95%;
            }
            .fullscreen-image {
                max-width: 100%;
                max-height: 100%;
                object-fit: contain;
            }
            .close-fullscreen {
                position: absolute;
                top: -40px;
                right: 0;
                background: rgba(255,255,255,0.2);
                border: none;
                color: white;
                font-size: 24px;
                padding: 10px;
                cursor: pointer;
                border-radius: 50%;
            }
        `;
        document.head.appendChild(style);
    }
    
    document.body.appendChild(modal);
    
    // Cerrar con ESC o click fuera
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
    
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            modal.remove();
        }
    });
}

function editDefectCount(defectName) {
    const currentCount = currentResults[defectName] || 0;
    const newCount = prompt(`Editar cantidad para "${defectName}":`, currentCount);
    
    if (newCount !== null && !isNaN(newCount) && parseInt(newCount) >= 0) {
        const count = parseInt(newCount);
        
        if (count === 0) {
            delete currentResults[defectName];
        } else {
            currentResults[defectName] = count;
        }
        
        // Actualizar display
        const mockData = {
            results: currentResults,
            total_cherries: Object.values(currentResults).reduce((sum, val) => sum + val, 0),
            timestamp: new Date().toLocaleString(),
            zones_loaded: availableZones.length,
            processed_image: document.querySelector('.analyzed-image')?.src || null
        };
        
        displayResults(mockData);
        showNotification('Cantidad actualizada correctamente', 'success');
    }
}

function showSection(sectionId) {
    // Ocultar todas las secciones
    const sections = ['form-section', 'results-section', 'loading', 'success-message'];
    sections.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.style.display = 'none';
        }
    });
    
    // Mostrar sección solicitada
    const targetSection = document.getElementById(sectionId);
    if (targetSection) {
        targetSection.style.display = 'block';
        targetSection.classList.add('fade-in');
        
        // Scroll al top de la sección
        targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function showLoading(show, message = 'Analizando imagen...') {
    const loading = document.getElementById('loading');
    const status = document.getElementById('loading-status');
    
    if (show) {
        if (status) status.textContent = message;
        showSection('loading');
    } else {
        loading.style.display = 'none';
    }
}

function showNotification(message, type = 'info') {
    // Crear notificación
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
        <span>${message}</span>
        <button onclick="this.parentElement.remove()" style="background:none;border:none;color:inherit;margin-left:10px;cursor:pointer;">&times;</button>
    `;
    
    // Agregar estilos si no existen
    if (!document.querySelector('.notification-styles')) {
        const style = document.createElement('style');
        style.className = 'notification-styles';
        style.textContent = `
            .notification {
                position: fixed;
                top: 20px;
                right: 20px;
                background: white;
                padding: 15px 20px;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                display: flex;
                align-items: center;
                gap: 10px;
                z-index: 1001;
                animation: slideInRight 0.3s ease-out;
                max-width: 400px;
            }
            .notification-success { border-left: 4px solid #28a745; }
            .notification-error { border-left: 4px solid #dc3545; }
            .notification-info { border-left: 4px solid #17a2b8; }
            @keyframes slideInRight {
                from { transform: translateX(100%); }
                to { transform: translateX(0); }
            }
        `;
        document.head.appendChild(style);
    }
    
    document.body.appendChild(notification);
    
    // Remover después de 5 segundos
    setTimeout(() => {
        if (notification.parentElement) {
            notification.remove();
        }
    }, 5000);
}

// Funciones de navegación
function goBack() {
    showSection('form-section');
}

function goHome() {
    showSection('form-section');
    resetForm();
}

function newAnalysis() {
    showSection('form-section');
    resetForm();
}

function resetForm() {
    // Limpiar formulario
    document.querySelectorAll('input, select').forEach(field => {
        if (field.type !== 'file') {
            field.value = '';
        }
        field.closest('.form-group').classList.remove('error', 'success');
    });
    
    // Limpiar inputs de archivo
    document.getElementById('file-input').value = '';
    document.getElementById('camera-input').value = '';
    selectedFile = null;
    
    // Resetear preview de imagen
    const captureArea = document.getElementById('capture-area');
    const preview = document.getElementById('camera-preview');
    
    preview.innerHTML = `
        <i class="fas fa-camera camera-icon"></i>
        <p>Selecciona una imagen para analizar</p>
    `;
    
    captureArea.classList.remove('has-image');
    
    // Deshabilitar botón de análisis
    const analyzeBtn = document.getElementById('analyze-btn');
    analyzeBtn.disabled = true;
    analyzeBtn.innerHTML = '<i class="fas fa-search"></i> Analizar imagen';
    
    currentResults = {};
}

// Funciones de acción
function editResults() {
    showNotification('Modo de edición activado. Haga clic en los números para modificar.', 'info');
}

async function uploadData() {
    if (Object.keys(currentResults).length === 0) {
        showNotification('No hay datos para subir', 'error');
        return;
    }
    
    showConfirmModal(
        'Subir datos',
        '¿Está seguro de que desea subir los datos al servidor?',
        async () => {
            try {
                showLoading(true, 'Subiendo datos al servidor...');
                
                // Simular subida (aquí integrarías con tu API real)
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                showLoading(false);
                showSection('success-message');
                
                // Volver al inicio después de 3 segundos
                setTimeout(() => {
                    newAnalysis();
                }, 3000);
                
            } catch (error) {
                showLoading(false);
                showNotification('Error al subir datos', 'error');
            }
        }
    );
}

async function saveData() {
    if (Object.keys(currentResults).length === 0) {
        showNotification('No hay datos para guardar', 'error');
        return;
    }
    
    try {
        const saveData = {
            timestamp: new Date().toISOString(),
            distribucion: document.getElementById('distribucion').value,
            guia_sii: document.getElementById('guia-sii').value,
            lote: document.getElementById('lote').value,
            num_frutos: document.getElementById('num-frutos').value,
            results: currentResults,
            total_cherries: Object.values(currentResults).reduce((sum, val) => sum + val, 0),
            zones_analyzed: availableZones.length
        };
        
        const response = await fetch('/save_results', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(saveData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Datos guardados correctamente en: ' + data.filename, 'success');
        } else {
            showNotification('Error al guardar: ' + data.error, 'error');
        }
        
    } catch (error) {
        showNotification('Error de conexión al guardar', 'error');
    }
}

function addDefect() {
    document.getElementById('add-defect-modal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('add-defect-modal').style.display = 'none';
    // Limpiar campos del modal
    document.getElementById('defect-type').value = '';
    document.getElementById('defect-count').value = '1';
}

function confirmAddDefect() {
    const defectType = document.getElementById('defect-type').value;
    const defectCount = parseInt(document.getElementById('defect-count').value);
    
    if (!defectType) {
        showNotification('Seleccione un tipo de defecto', 'error');
        return;
    }
    
    if (isNaN(defectCount) || defectCount < 1) {
        showNotification('Ingrese una cantidad válida', 'error');
        return;
    }
    
    // Agregar o actualizar defecto
    currentResults[defectType] = (currentResults[defectType] || 0) + defectCount;
    
    // Actualizar display
    const mockData = {
        results: currentResults,
        total_cherries: Object.values(currentResults).reduce((sum, val) => sum + val, 0),
        timestamp: new Date().toLocaleString(),
        zones_loaded: availableZones.length,
        processed_image: document.querySelector('.analyzed-image')?.src || null
    };
    
    displayResults(mockData);
    closeModal();
    showNotification(`Agregado: ${defectType} (+${defectCount})`, 'success');
}

function deleteData() {
    showConfirmModal(
        'Eliminar datos',
        '¿Está seguro de que desea eliminar todos los datos del análisis actual? Esta acción no se puede deshacer.',
        () => {
            currentResults = {};
            newAnalysis();
            showNotification('Datos eliminados correctamente', 'success');
        }
    );
}

function goToHistory() {
    showNotification('Función de historial en desarrollo', 'info');
}

// Funciones para modal de confirmación
function showConfirmModal(title, message, callback) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-modal').style.display = 'flex';
    confirmCallback = callback;
}

function closeConfirmModal() {
    document.getElementById('confirm-modal').style.display = 'none';
    confirmCallback = null;
}

function confirmAction() {
    if (confirmCallback) {
        confirmCallback();
    }
    closeConfirmModal();
}

// Cerrar modales al hacer clic fuera
document.addEventListener('click', function(event) {
    const addModal = document.getElementById('add-defect-modal');
    const confirmModal = document.getElementById('confirm-modal');
    
    if (event.target === addModal) {
        closeModal();
    }
    
    if (event.target === confirmModal) {
        closeConfirmModal();
    }
});

// Atajos de teclado
document.addEventListener('keydown', function(event) {
    // ESC para cerrar modales
    if (event.key === 'Escape') {
        closeModal();
        closeConfirmModal();
    }
    
    // Enter para confirmar en modales
    if (event.key === 'Enter') {
        const addModal = document.getElementById('add-defect-modal');
        const confirmModal = document.getElementById('confirm-modal');
        
        if (addModal.style.display === 'flex') {
            confirmAddDefect();
        }
        
        if (confirmModal.style.display === 'flex') {
            confirmAction();
        }
    }
});