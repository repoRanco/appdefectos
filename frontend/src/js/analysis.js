// Variables globales
let currentUser = null;
let currentModule = null;
let analysisType = null;
let selectedImage = null;
let analysisResults = null;
let currentStream = null;
let availableCameras = [];
let currentCameraIndex = 0;
let currentProfile = 'qc_recepcion'; // Perfil actual seleccionado
let availableProfiles = {}; // Perfiles disponibles

// Constante para identificar la opción de nuevo defecto
const NEW_DEFECT_VALUE = '__NEW_DEFECT__';

// ===== Utilidades de Sesión (CAMBIO) =====
async function syncSessionUser() {
    try {
        const r = await fetch('/api/session_check', { credentials: 'include' });
        if (!r.ok) throw new Error('No auth');
        const data = await r.json(); // { authenticated, email, role, is_admin, name? }
        if (data.authenticated) {
            const uiUser = {
                email: data.email,
                name: data.name || data.email,
                role: data.role,
                is_admin: data.is_admin,
                loginTime: new Date().toISOString()
            };
            localStorage.setItem('rancoqc_user', JSON.stringify(uiUser));
            return uiUser;
        }
    } catch (e) {
        console.warn('syncSessionUser falló:', e.message);
    }
    return null;
}

function getCurrentUser() {
    const userData = localStorage.getItem('rancoqc_user');
    return userData ? JSON.parse(userData) : null;
}

function getSafeUserName() {
    const u = currentUser || getCurrentUser();
    if (u?.name && u.name.trim()) return u.name.trim();
    if (u?.email && u.email.trim()) return u.email.trim();
    return null;
}

// Inicializar la aplicación
document.addEventListener('DOMContentLoaded', function() {
    initializeAnalysis();
});

// Inicializar análisis
async function initializeAnalysis() {
    // Verificar autenticación (prioriza sesión del servidor) (CAMBIO)
    currentUser = getCurrentUser();
    if (!currentUser) {
        currentUser = await syncSessionUser();
    }
    if (!currentUser) {
        window.location.href = 'login.html';
        return;
    }
    
    // Obtener tipo de análisis y módulo
    analysisType = localStorage.getItem('rancoqc_analysis_type') || 'qc-recepcion';
    currentModule = localStorage.getItem('rancoqc_current_module') || 'qc-recepcion';
    
    // Mapear tipos de análisis a perfiles
    const analysisToProfile = {
        'qc-recepcion': 'qc_recepcion',
        'packing-qc': 'packing_qc',
        'contramuestra': 'contramuestra'
    };
    
    // Establecer perfil actual basado en el tipo de análisis
    currentProfile = analysisToProfile[analysisType] || 'qc_recepcion';
    
    // Configurar interfaz
    setupUserInterface();
    setupModuleInterface();
    updateTime();
    setInterval(updateTime, 1000);
    
    // Configurar selector de perfil
    setupProfileSelector();
    
    // Configurar eventos
    setupEventListeners();
    
    // Configurar validación de formulario
    setupFormValidation();
}

// Configurar selector de perfil basado en el análisis seleccionado
function setupProfileSelector() {
    const profileSelect = document.getElementById('profile-select');
    if (!profileSelect) return;
    
    // Mapear tipos de análisis a valores del selector
    const analysisToSelectValue = {
        'qc-recepcion': 'qc_recepcion',
        'packing-qc': 'packing_qc',
        'contramuestra': 'contramuestra'
    };
    
    const selectValue = analysisToSelectValue[analysisType];
    if (selectValue) {
        profileSelect.value = selectValue;
        // Disparar evento de cambio para actualizar la interfaz
        onProfileChange();
    }
}

// Configurar interfaz de usuario
function setupUserInterface() {
    const userNameElement = document.getElementById('user-name');
    if (userNameElement && currentUser) {
        userNameElement.textContent = currentUser.name || currentUser.email || 'Usuario';
    }
}

// Configurar interfaz del módulo
function setupModuleInterface() {
    const moduleTitleElement = document.getElementById('module-title');
    const packingOnlyElements = document.querySelectorAll('.packing-only');
    
    const moduleConfig = {
        'qc-recepcion': {
            title: 'QC Recepción T25',
            showPackingFields: false
        },
        'packing-qc': {
            title: 'Packing QC T25',
            showPackingFields: true
        },
        'contramuestras': {
            title: 'Contramuestras T25',
            showPackingFields: false
        }
    };
    
    const config = moduleConfig[analysisType] || moduleConfig['qc-recepcion'];
    
    if (moduleTitleElement) {
        moduleTitleElement.textContent = config.title;
    }
    
    // Mostrar/ocultar campos específicos de Packing QC
    packingOnlyElements.forEach(element => {
        element.style.display = config.showPackingFields ? 'flex' : 'none';
    });
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

// Configurar event listeners
function setupEventListeners() {
    // File inputs
    const fileInput = document.getElementById('file-input');
    const cameraInput = document.getElementById('camera-input');
    
    if (fileInput) {
        fileInput.addEventListener('change', handleFileSelect);
    }
    
    if (cameraInput) {
        cameraInput.addEventListener('change', handleFileSelect);
    }
    
    // Capture area click
    const captureArea = document.getElementById('capture-area');
    if (captureArea) {
        captureArea.addEventListener('click', function() {
            if (!selectedImage) {
                fileInput?.click();
            }
        });
    }
    
    // Form validation
    const formInputs = document.querySelectorAll('#distribucion, #guia-sii, #lote, #num-frutos');
    formInputs.forEach(input => {
        input.addEventListener('change', validateForm);
        input.addEventListener('input', validateForm);
    });
    
    // Modal events
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('modal')) {
            closeModal();
        }
    });
    
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeModal();
        }
    });

    // Update camera help text when camera type changes
    const cameraTypeSelect = document.getElementById('camera-type');
    if (cameraTypeSelect) {
        cameraTypeSelect.addEventListener('change', function() {
            const help = document.getElementById('camera-help-text');
            if (!help) return;
            if (this.value === 'raspberry') {
                help.textContent = 'Raspberry Pi: usa libcamera/raspistill para capturar con el Camera Module.';
            } else {
                help.textContent = 'USB: Cámaras conectadas por USB. Raspberry Pi: usa libcamera/raspistill para capturar con el Camera Module.';
            }
        });
    }
}

// Configurar validación de formulario
function setupFormValidation() {
    const form = document.querySelector('.form-section');
    if (form) {
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            if (validateForm()) {
                analyzeImage();
            }
        });
    }
}

// Manejar selección de archivo
function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Validar tipo de archivo
    if (!file.type.startsWith('image/')) {
        showNotification('Por favor selecciona un archivo de imagen válido', 'error');
        return;
    }
    
    // Validar tamaño (máximo 10MB)
    if (file.size > 10 * 1024 * 1024) {
        showNotification('La imagen es demasiado grande. Máximo 10MB', 'error');
        return;
    }
    
    selectedImage = file;
    displayImagePreview(file);
    validateForm();
}

// Mostrar vista previa de imagen
function displayImagePreview(file) {
    const reader = new FileReader();
    
    reader.onload = function(e) {
        const captureArea = document.getElementById('capture-area');
        const cameraPreview = document.getElementById('camera-preview');
        const imagePreviewContainer = document.getElementById('image-preview-container');
        const imagePreview = document.getElementById('image-preview');
        const imageInfo = document.getElementById('image-info');
        
        if (captureArea && cameraPreview && imagePreviewContainer && imagePreview && imageInfo) {
            // Ocultar vista previa de cámara
            cameraPreview.style.display = 'none';
            
            // Mostrar imagen
            imagePreview.src = e.target.result;
            imagePreview.onload = function() {
                const size = formatFileSize(file.size);
                const dimensions = `${this.naturalWidth}x${this.naturalHeight}`;
                imageInfo.textContent = `${file.name} - ${size} - ${dimensions}`;
            };
            
            imagePreviewContainer.style.display = 'flex';
            captureArea.classList.add('has-image');
            
            // Animación
            imagePreview.classList.add('image-selected');
            setTimeout(() => {
                imagePreview.classList.remove('image-selected');
            }, 300);
        }
    };
    
    reader.readAsDataURL(file);
}

// Validar formulario
function validateForm() {
    const distribucion = document.getElementById('distribucion').value;
    const guiaSii = document.getElementById('guia-sii').value.trim();
    const lote = document.getElementById('lote').value.trim();
    const numFrutos = document.getElementById('num-frutos').value.trim();
    const analyzeBtn = document.getElementById('analyze-btn');
    
    // Validaciones específicas para Packing QC
    let packingValid = true;
    if (analysisType === 'packing-qc') {
        const numProceso = document.getElementById('num-proceso').value.trim();
        const idCaja = document.getElementById('id-caja').value.trim();
        packingValid = numProceso && idCaja;
    }
    
    const isValid = distribucion && guiaSii && lote && numFrutos && selectedImage && packingValid;
    
    if (analyzeBtn) {
        analyzeBtn.disabled = !isValid;
    }
    
    // Actualizar estilos de validación
    updateFieldValidation('distribucion', distribucion);
    updateFieldValidation('guia-sii', guiaSii);
    updateFieldValidation('lote', lote);
    updateFieldValidation('num-frutos', numFrutos);
    
    if (analysisType === 'packing-qc') {
        updateFieldValidation('num-proceso', document.getElementById('num-proceso').value.trim());
        updateFieldValidation('id-caja', document.getElementById('id-caja').value.trim());
    }
    
    return isValid;
}

// Actualizar validación de campo
function updateFieldValidation(fieldId, value) {
    const field = document.getElementById(fieldId);
    const formGroup = field?.parentElement;
    
    if (formGroup) {
        formGroup.classList.remove('error', 'success');
        if (value) {
            formGroup.classList.add('success');
        } else if (field === document.activeElement || field.value !== '') {
            formGroup.classList.add('error');
        }
    }
}

// Función para manejar cambio de perfil
function onProfileChange() {
    const profileSelect = document.getElementById('profile-select');
    if (!profileSelect) return;
    
    const selectedProfile = profileSelect.value;
    if (!selectedProfile) return;
    
    currentProfile = selectedProfile;
    
    // Actualizar título del módulo según perfil
    const moduleTitle = document.getElementById('module-title');
    const profileNames = {
        'qc_recepcion': 'QC Recepción T25',
        'packing_qc': 'Packing QC T25',
        'contramuestra': 'Contramuestra T25'
    };
    
    if (moduleTitle) {
        moduleTitle.textContent = profileNames[selectedProfile] || 'Análisis T25';
    }
    
    // Mostrar/ocultar campos específicos de Packing QC
    const packingOnlyElements = document.querySelectorAll('.packing-only');
    packingOnlyElements.forEach(element => {
        element.style.display = selectedProfile === 'packing_qc' ? 'flex' : 'none';
    });
    
    // Actualizar analysisType para compatibilidad
    analysisType = selectedProfile.replace('_', '-');
    
    // Mostrar notificación
    const profileDisplayNames = {
        'qc_recepcion': 'QC Recepción',
        'packing_qc': 'Packing QC',
        'contramuestra': 'Contramuestra'
    };
    
    showNotification(`Perfil cambiado a: ${profileDisplayNames[selectedProfile]}`, 'success');
    
    // Revalidar formulario
    validateForm();
}

// Analizar imagen
async function analyzeImage() {
    if (!selectedImage || !validateForm()) {
        showNotification('Por favor completa todos los campos y selecciona una imagen', 'error');
        return;
    }
    
    // Verificar que se haya seleccionado un perfil
    if (!currentProfile) {
        showNotification('Por favor selecciona un perfil de análisis', 'error');
        return;
    }

    // Verificar usuario seguro (CAMBIO)
    const userName = getSafeUserName();
    if (!userName) {
        showNotification('Sesión inválida. Inicia sesión nuevamente.', 'error');
        window.location.href = 'login.html';
        return;
    }
    
    // Mostrar loading
    showLoading();
    hideSection('form-section');
    hideSection('results-section');
    hideSection('success-message');
    
    try {
        // Preparar datos del formulario
        const formData = new FormData();
        formData.append('image', selectedImage);
        formData.append('profile', currentProfile); // Agregar perfil seleccionado
        formData.append('distribucion', document.getElementById('distribucion').value); // Agregar distribución
        
        // Agregar metadatos
        const metadata = {
            distribucion: document.getElementById('distribucion').value,
            guia_sii: document.getElementById('guia-sii').value,
            lote: document.getElementById('lote').value,
            num_frutos: parseInt(document.getElementById('num-frutos').value),
            analysis_type: analysisType,
            module: currentModule,
            profile: currentProfile,
            user: userName, // CAMBIO
            timestamp: new Date().toISOString()
        };
        
        // Agregar campos específicos de Packing QC
        if (analysisType === 'packing-qc') {
            metadata.num_proceso = document.getElementById('num-proceso').value;
            metadata.id_caja = document.getElementById('id-caja').value;
        }
        
        formData.append('metadata', JSON.stringify(metadata));
        
        // Actualizar estado de loading
        updateLoadingStatus('Enviando imagen al servidor...');
        
        // Llamar al backend (CAMBIO: credentials)
        const response = await fetch('/analyze_cherries', {
            method: 'POST',
            body: formData,
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`Error del servidor: ${response.status}`);
        }
        
        updateLoadingStatus('Procesando resultados...');
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.error || 'Error en el análisis');
        }
        
        // Guardar resultados
        analysisResults = result;
        
        // Mostrar resultados
        hideLoading();
        displayResults(result);
        
    } catch (error) {
        console.error('Error en análisis:', error);
        hideLoading();
        showSection('form-section');
        showNotification(`Error en el análisis: ${error.message}`, 'error');
    }
}

// Capturar y analizar desde cámara local
async function captureFromLocalCamera() {
    try {
        // Validar formulario primero
        const distribucion = document.getElementById('distribucion').value;
        if (!distribucion) {
            showNotification('Por favor selecciona una distribución (Roja/Bicolor)', 'error');
            return;
        }

        if (!currentProfile) {
            showNotification('Por favor selecciona un perfil de análisis', 'error');
            return;
        }

        const userName = getSafeUserName(); // CAMBIO
        if (!userName) {
            showNotification('Sesión inválida. Inicia sesión nuevamente.', 'error');
            window.location.href = 'login.html';
            return;
        }

        const cameraType = document.getElementById('camera-type').value || 'usb';
        const cameraIndex = parseInt(document.getElementById('camera-index').value) || 0;

        // Mostrar loading
        showLoading();
        hideSection('results-section');
        updateLoadingStatus(`Accediendo a cámara ${cameraType.toUpperCase()}...`);

        // Llamar endpoint backend (CAMBIO: credentials)
        const response = await fetch('/capture_local_camera', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                profile: currentProfile,
                distribucion: distribucion,
                camera_type: cameraType,
                camera_index: cameraIndex,
                user: userName // CAMBIO
            })
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Error del servidor: ${response.status} ${text}`);
        }

        updateLoadingStatus('Procesando imagen capturada...');
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.error || 'Error en la captura de cámara local');
        }

        // Guardar resultados
        analysisResults = result;
        hideLoading();
        displayResults(result);

        // Mostrar notificación de éxito
        const cameraName = `Cámara ${result.camera_used || cameraIndex}`;
        if ((result.total_cherries || 0) === 0) {
            showNotification(`Captura OK desde ${cameraName}, pero no se detectaron cerezas. Revisa encuadre/iluminación.`, 'info');
        } else {
            showNotification(`Análisis completado desde ${cameraName}: ${result.total_cherries} detecciones`, 'success');
        }

        // Ocultar formulario y mostrar resultados
        hideSection('form-section');

    } catch (err) {
        console.error('Error en captura de cámara local:', err);
        hideLoading();
        showNotification(`Error captura local: ${err.message}`, 'error');
        
        // Mostrar sugerencias específicas
        if (err.message.includes('No se pudo acceder')) {
            showNotification('Verifica que la cámara esté conectada y no esté siendo usada por otra aplicación', 'info');
        }
    }
}

// Capturar directamente usando Raspberry Pi (libcamera)
async function captureFromRaspberry() {
    const cameraTypeEl = document.getElementById('camera-type');
    if (cameraTypeEl) {
        cameraTypeEl.value = 'raspberry';
        const event = new Event('change');
        cameraTypeEl.dispatchEvent(event);
    }
    // Forzar índice 0 por defecto para Raspberry, si existe selector
    const cameraIndexEl = document.getElementById('camera-index');
    if (cameraIndexEl) {
        cameraIndexEl.value = '0';
    }
    await captureFromLocalCamera();
}

// Analizar desde RTSP
async function analyzeFromRTSP() {
    try {
        const rtspInput = document.getElementById('rtsp-url');
        if (!rtspInput) {
            showNotification('No se encontró el campo RTSP en la interfaz', 'error');
            return;
        }
        const rtspUrl = rtspInput.value.trim();
        if (!rtspUrl) {
            showNotification('Ingresa el URL RTSP de la cámara', 'error');
            return;
        }

        const userName = getSafeUserName(); // CAMBIO
        if (!userName) {
            showNotification('Sesión inválida. Inicia sesión nuevamente.', 'error');
            window.location.href = 'login.html';
            return;
        }

        // Mostrar loading
        showLoading();
        hideSection('results-section');
        updateLoadingStatus('Conectando a la cámara RTSP...');

        // Llamar endpoint backend (CAMBIO: credentials)
        const response = await fetch('/analyze_rtsp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                rtsp_url: rtspUrl,
                timeout_sec: 8,
                warmup_frames: 5,
                profile: currentProfile,
                distribucion: document.getElementById('distribucion').value,
                max_resolution: '1920x1080',
                auto_resize: true,
                user: userName // CAMBIO
            })
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Error del servidor: ${response.status} ${text}`);
        }

        updateLoadingStatus('Procesando resultados del frame...');
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || 'Error en el análisis RTSP');
        }

        analysisResults = result;
        hideLoading();
        displayResults(result);

        // Mostrar aviso si no hubo detecciones
        if ((result.total_cherries || 0) === 0) {
            showNotification('Conexión OK, pero no se detectaron cerezas dentro de zonas. Revisa encuadre/iluminación.', 'info');
        } else {
            showNotification('Análisis RTSP completado', 'success');
        }
    } catch (err) {
        console.error('Error en análisis RTSP:', err);
        hideLoading();
        showNotification(`Error RTSP: ${err.message}`, 'error');
    }
}

// Mostrar resultados
function displayResults(results) {
    // Actualizar información general
    document.getElementById('total-cherries').textContent = results.total_cherries || 0;
    document.getElementById('analysis-timestamp').textContent = results.timestamp || '-';
    document.getElementById('zones-analyzed').textContent = results.zones_loaded || 0;
    
    // Mostrar imagen original (si está disponible, típicamente para RTSP)
    if (results.original_image) {
        const originalImageContainer = document.getElementById('original-image-container');
        const originalImage = document.getElementById('original-image');
        
        if (originalImageContainer && originalImage) {
            originalImage.src = results.original_image;
            originalImage.onload = function() {
                this.classList.add('loaded');
            };
            originalImageContainer.style.display = 'block';
            
            // Actualizar información de la imagen original
            const imageInfo = originalImageContainer.querySelector('.image-analysis-info');
            if (imageInfo && results.image_size) {
                // Actualizar el último span con el tamaño de imagen
                const spans = imageInfo.querySelectorAll('span');
                if (spans.length >= 3) {
                    spans[2].innerHTML = `<i class="fas fa-expand-arrows-alt"></i> ${results.image_size}`;
                }
            }
        }
    } else {
        // Ocultar contenedor de imagen original si no hay imagen original
        const originalImageContainer = document.getElementById('original-image-container');
        if (originalImageContainer) {
            originalImageContainer.style.display = 'none';
        }
    }
    
    // Mostrar imagen analizada
    if (results.processed_image) {
        const analyzedImageContainer = document.getElementById('analyzed-image-container');
        const analyzedImage = document.getElementById('analyzed-image');
        
        if (analyzedImageContainer && analyzedImage) {
            analyzedImage.src = results.processed_image;
            analyzedImage.onload = function() {
                this.classList.add('loaded');
            };
            analyzedImageContainer.style.display = 'block';
        }
    }
    
    // Mostrar lista de defectos
    displayDefectsList(results.results || {});
    
    // Mostrar sección de resultados
    showSection('results-section');
    
    // Scroll a resultados
    document.getElementById('results-section').scrollIntoView({ 
        behavior: 'smooth' 
    });
}

// Mostrar lista de defectos
function displayDefectsList(defects) {
    const defectsList = document.getElementById('defects-list');
    
    if (!defectsList) return;
    
    if (Object.keys(defects).length === 0) {
        defectsList.innerHTML = `
            <div class="no-defects">
                <i class="fas fa-check-circle"></i>
                <h4>¡Excelente!</h4>
                <p>No se detectaron defectos en esta muestra</p>
            </div>
        `;
        return;
    }
    
    // Usar los nombres exactos de las zonas como aparecen en los resultados
    const defectsHTML = Object.entries(defects).map(([zoneName, count]) => {
        const defectName = zoneName;
        
        // Generar descripción basada en el perfil actual
        let description = 'Defecto detectado en zona específica';
        
        // Descripciones específicas por perfil
        if (currentProfile === 'qc_recepcion' || currentProfile === 'contramuestra') {
            const qcDescriptions = {
                'FRUTO DOBLE': 'Desarrollo anormal con duplicación',
                'HIJUELO': 'Brote secundario no deseado',
                'DAÑO TRIPS': 'Daño específico por trips',
                'DAÑO PLAGA': 'Daño causado por insectos plaga',
                'VIROSIS': 'Síntomas de infección viral',
                'FRUTO DEFORME': 'Desarrollo anormal de la forma',
                'HC ESTRELLA': 'Hendidura característica en forma de estrella',
                'RUSSET': 'Rugosidad superficial característica',
                'HC MEDIALUNA': 'Hendidura en forma de media luna',
                'HC SATURA': 'Hendidura de sutura saturada',
                'PICADA DE PAJARO': 'Perforaciones causadas por aves',
                'HERIDA ABIERTA': 'Lesión abierta en la superficie',
                'PUDRICION HUMEDA': 'Deterioro por hongos con humedad',
                'PUDRICION SECA': 'Deterioro sin presencia de humedad',
                'FRUTO DESHIDRATADO': 'Pérdida excesiva de humedad',
                'CRACKING CICATRIZADO': 'Grietas que han cicatrizado',
                'SUTURA DE FORMA': 'Defecto en la línea de sutura',
                'FRUTO SIN PEDICELO': 'Ausencia del tallo del fruto',
                'MACHUCON': 'Daño físico por golpes o presión'
            };
            description = qcDescriptions[zoneName.toUpperCase()] || description;
        } else if (currentProfile === 'packing_qc') {
            const packingDescriptions = {
                'BANDEJA_1': 'Detecciones en bandeja 1',
                'BANDEJA_2': 'Detecciones en bandeja 2',
                'BANDEJA_3': 'Detecciones en bandeja 3',
                'BANDEJA_4': 'Detecciones en bandeja 4',
                'CONTROL_CALIDAD': 'Detecciones en zona de control de calidad',
                'DESCARTE': 'Detecciones en zona de descarte',
                'EMPAQUE_FINAL': 'Detecciones en zona de empaque final',
                'ETIQUETADO': 'Detecciones en zona de etiquetado'
            };
            description = packingDescriptions[zoneName.toUpperCase()] || description;
        }
        
        const countClass = count === 0 ? 'zero' : count <= 3 ? 'medium' : 'high';
        
        return `
            <div class="defect-item">
                <div class="defect-info">
                    <div class="defect-name">${defectName}</div>
                    <div class="defect-description">${description}</div>
                </div>
                <div class="defect-count-container">
                    <button class="defect-count-btn decrease" onclick="adjustDefectCount('${zoneName}', -1)" title="Disminuir">
                        <i class="fas fa-minus"></i>
                    </button>
                    <div class="defect-count ${countClass}">${count}</div>
                    <button class="defect-count-btn increase" onclick="adjustDefectCount('${zoneName}', 1)" title="Aumentar">
                        <i class="fas fa-plus"></i>
                    </button>
                </div>
                <div class="defect-actions">
                    <button class="defect-edit-btn" onclick="editDefect('${zoneName}', ${count})" title="Editar manualmente">
                        <i class="fas fa-edit"></i>
                        Editar
                    </button>
                </div>
            </div>
        `;
    }).join('');
    
    defectsList.innerHTML = defectsHTML;
}

// Ajustar contador de defectos
function adjustDefectCount(defectType, change) {
    if (!analysisResults || !analysisResults.results) {
        showNotification('No hay resultados para modificar', 'error');
        return;
    }
    
    const currentCount = analysisResults.results[defectType] || 0;
    const newCount = Math.max(0, currentCount + change);
    
    // Actualizar resultados
    analysisResults.results[defectType] = newCount;
    
    // Recalcular total
    analysisResults.total_cherries = Object.values(analysisResults.results).reduce((a, b) => a + b, 0);
    
    // Actualizar interfaz
    displayDefectsList(analysisResults.results);
    document.getElementById('total-cherries').textContent = analysisResults.total_cherries;
    
    // Mostrar notificación
    const action = change > 0 ? 'incrementado' : 'decrementado';
    showNotification(`${defectType} ${action} a ${newCount}`, 'success');
}

// Funciones de navegación y acciones
function goBack() {
    if (confirm('¿Estás seguro de que deseas volver? Se perderán los datos no guardados.')) {
        window.location.href = 'dashboard.html';
    }
}

function goHome() {
    window.location.href = 'dashboard.html';
}

function goToHistory() {
    window.location.href = 'history.html';
}

function showSettings() {
    window.location.href = 'settings.html';
}

function newAnalysis() {
    if (confirm('¿Deseas iniciar un nuevo análisis? Se perderán los datos actuales.')) {
        // Limpiar datos
        selectedImage = null;
        analysisResults = null;
        
        // Resetear formulario
        document.querySelector('.form-section')?.reset();
        
        // Resetear vista previa
        const captureArea = document.getElementById('capture-area');
        const cameraPreview = document.getElementById('camera-preview');
        const imagePreviewContainer = document.getElementById('image-preview-container');
        
        if (captureArea && cameraPreview && imagePreviewContainer) {
            captureArea.classList.remove('has-image');
            cameraPreview.style.display = 'block';
            imagePreviewContainer.style.display = 'none';
        }
        
        // Mostrar formulario
        showSection('form-section');
        hideSection('results-section');
        hideSection('success-message');
        
        // Validar formulario
        validateForm();
    }
}

// Acciones de resultados
function editResults() {
    showNotification('Función de edición en desarrollo', 'info');
}

async function uploadData() {
    if (!analysisResults) {
        showNotification('No hay datos para subir', 'error');
        return;
    }

    const userName = getSafeUserName(); // CAMBIO
    if (!userName) {
        showNotification('Sesión inválida. Inicia sesión nuevamente.', 'error');
        window.location.href = 'login.html';
        return;
    }
    
    try {
        showNotification('Subiendo datos a PostgreSQL...', 'info');
        
        // Preparar datos para enviar
        const uploadPayload = {
            analysis_data: {
                source_type: "uploaded_file",
                confidence_used: analysisResults.confidence_used || 0.8
            },
            form_data: {
                user: userName, // CAMBIO
                profile: currentProfile,
                distribucion: document.getElementById('distribucion').value,
                analysis_type: analysisType,
                guia_sii: document.getElementById('guia-sii').value,
                lote: document.getElementById('lote').value,
                num_frutos: parseInt(document.getElementById('num-frutos').value),
                num_proceso: document.getElementById('num-proceso')?.value || null,
                id_caja: document.getElementById('id-caja')?.value || null
            },
            results_data: {
                results: analysisResults.results || {},
                total_cherries: analysisResults.total_cherries || 0,
                confidence_used: analysisResults.confidence_used || 0.8,
                zones_loaded: analysisResults.zones_loaded || 0,
                processed_image: analysisResults.processed_image || null,
                detections_by_zone: analysisResults.detections_by_zone || {},
                image_size: analysisResults.image_size || null,
                zones_available: analysisResults.zones_available || []
            }
        };
        
        // Enviar al endpoint de forzar subida (CAMBIO: credentials)
        const response = await fetch('/force_upload_analysis', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(uploadPayload)
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification(`Datos subidos exitosamente a PostgreSQL (ID: ${result.analysis_id})`, 'success');
            
            // Actualizar estado del análisis
            if (analysisResults) {
                analysisResults.database_status = 'saved_to_postgresql';
                analysisResults.analysis_id = result.analysis_id;
                analysisResults.synced = true;
            }
            
            showSuccessMessage();
        } else {
            throw new Error(result.error || 'Error desconocido en la subida');
        }
        
    } catch (error) {
        console.error('Error subiendo datos:', error);
        showNotification('Error subiendo datos: ' + error.message, 'error');
        
        // Si falla PostgreSQL, intentar guardar en caché local
        try {
            const cacheResponse = await fetch('/save_to_cache', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include', // CAMBIO
                body: JSON.stringify(uploadPayload)
            });
            
            const cacheResult = await cacheResponse.json();
            
            if (cacheResult.success) {
                showNotification('Datos guardados en caché local para sincronización posterior', 'warning');
            }
            
        } catch (cacheError) {
            console.error('Error guardando en caché:', cacheError);
        }
    }
}

function saveData() {
    if (!analysisResults) {
        showNotification('No hay datos para guardar', 'error');
        return;
    }

    const userName = getSafeUserName(); // CAMBIO
    if (!userName) {
        showNotification('Sesión inválida. Inicia sesión nuevamente.', 'error');
        window.location.href = 'login.html';
        return;
    }
    
    try {
        // Exportar a Excel
        exportToExcel();
        
        // También guardar en localStorage para acceso offline
        const saveData = {
            ...analysisResults,
            form_data: {
                distribucion: document.getElementById('distribucion').value,
                guia_sii: document.getElementById('guia-sii').value,
                lote: document.getElementById('lote').value,
                num_frutos: document.getElementById('num-frutos').value,
                analysis_type: analysisType,
                module: currentModule
            },
            saved_at: new Date().toISOString(),
            user: userName // CAMBIO
        };
        
        const saveKey = `analysis_${Date.now()}`;
        localStorage.setItem(`rancoqc_saved_${saveKey}`, JSON.stringify(saveData));
        
        showNotification('Análisis exportado a Excel y guardado localmente', 'success');
        
    } catch (error) {
        console.error('Error guardando:', error);
        showNotification('Error al guardar el análisis', 'error');
    }
}

// Exportar datos a Excel
function exportToExcel() {
    if (!analysisResults) {
        showNotification('No hay datos para exportar', 'error');
        return;
    }
    
    try {
        // Preparar datos para Excel
        const formData = {
            distribucion: document.getElementById('distribucion').value,
            guia_sii: document.getElementById('guia-sii').value,
            lote: document.getElementById('lote').value,
            num_frutos: document.getElementById('num-frutos').value,
            analysis_type: analysisType,
            module: currentModule
        };
        
        // Agregar campos específicos de Packing QC si aplica
        if (analysisType === 'packing-qc') {
            formData.num_proceso = document.getElementById('num-proceso').value;
            formData.id_caja = document.getElementById('id-caja').value;
        }
        
        // Crear datos para la hoja de Excel
        const worksheetData = [];
        
        // Encabezado de información general
        worksheetData.push(['REPORTE DE ANÁLISIS RANCOQC']);
        worksheetData.push(['']);
        worksheetData.push(['INFORMACIÓN GENERAL']);
        worksheetData.push(['Usuario:', getSafeUserName() || '']); // CAMBIO
        worksheetData.push(['Fecha y Hora:', new Date().toLocaleString('es-CL')]);
        worksheetData.push(['Módulo:', formData.module.toUpperCase()]);
        worksheetData.push(['Tipo de Análisis:', formData.analysis_type.replace('-', ' ').toUpperCase()]);
        worksheetData.push(['']);
        
        // Información del formulario
        worksheetData.push(['DATOS DE LA MUESTRA']);
        worksheetData.push(['Distribución:', formData.distribucion]);
        worksheetData.push(['Guía SII:', formData.guia_sii]);
        worksheetData.push(['Lote:', formData.lote]);
        worksheetData.push(['Número de Frutos:', formData.num_frutos]);
        
        if (analysisType === 'packing-qc') {
            worksheetData.push(['Número de Proceso:', formData.num_proceso]);
            worksheetData.push(['ID de Caja:', formData.id_caja]);
        }
        
        worksheetData.push(['']);
        
        // Resultados del análisis
        worksheetData.push(['RESULTADOS DEL ANÁLISIS']);
        worksheetData.push(['Total de Defectos Detectados:', analysisResults.total_cherries || 0]);
        worksheetData.push(['Zonas Analizadas:', analysisResults.zones_loaded || 0]);
        worksheetData.push(['']);
        
        // Detalle de defectos
        worksheetData.push(['DETALLE DE DEFECTOS']);
        worksheetData.push(['Zona/Defecto', 'Cantidad', 'Porcentaje']);
        
        const totalDefects = analysisResults.total_cherries || 1; // Evitar división por cero
        
        Object.entries(analysisResults.results || {}).forEach(([zoneName, count]) => {
            const percentage = ((count / totalDefects) * 100).toFixed(2);
            worksheetData.push([zoneName, count, `${percentage}%`]);
        });
        
        // Crear archivo CSV (compatible con Excel)
        const csvContent = worksheetData.map(row => 
            row.map(cell => `"${cell}"`).join(',')
        ).join('\n');
        
        // Crear y descargar archivo
        const blob = new Blob(['\ufeff' + csvContent], { 
            type: 'text/csv;charset=utf-8;' 
        });
        
        const link = document.createElement('a');
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
        const filename = `RancoQC_Analisis_${formData.lote}_${timestamp}.csv`;
        
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }
        
        showNotification(`Archivo Excel exportado: ${filename}`, 'success');
        
    } catch (error) {
        console.error('Error exportando a Excel:', error);
        showNotification('Error al exportar a Excel', 'error');
    }
}

function deleteData() {
    if (confirm('¿Estás seguro de que deseas eliminar este análisis?')) {
        // Limpiar datos
        selectedImage = null;
        analysisResults = null;
        
        showNotification('Análisis eliminado', 'success');
        newAnalysis();
    }
}

function addDefect() {
    const modal = document.getElementById('add-defect-modal');
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
}

function editDefect(defectType, currentCount) {
    const modal = document.getElementById('add-defect-modal');
    const defectTypeSelect = document.getElementById('defect-type');
    const defectCountInput = document.getElementById('defect-count');
    
    if (modal && defectTypeSelect && defectCountInput) {
        defectTypeSelect.value = defectType;
        defectCountInput.value = currentCount;
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
}

// ===== FUNCIONES PARA AGREGAR NUEVO DEFECTO =====

// Función para abrir el modal de agregar defecto manual (MEJORADA CON NUEVO DEFECTO)
async function addManualDefect() {
    try {
        if (!analysisResults) {
            showNotification('No hay resultados de análisis para modificar', 'error');
            return;
        }
        
        // Cargar defectos disponibles para el perfil actual
        await loadDefectsForProfile(currentProfile);
        
        const modal = document.getElementById('add-defect-modal');
        const defectTypeSelect = document.getElementById('defect-type');
        const defectCountInput = document.getElementById('defect-count');
        const newDefectSection = document.getElementById('new-defect-section');
        const newDefectNameInput = document.getElementById('new-defect-name');
        const persistNewDefectCheckbox = document.getElementById('persist-new-defect');
        
        if (!modal || !defectTypeSelect || !defectCountInput) {
            console.error('Elementos del modal no encontrados');
            return;
        }
        
        // Limpiar y poblar el selector con defectos del perfil
        defectTypeSelect.innerHTML = '<option value="">Seleccionar...</option>';
        
        availableDefects.forEach(defect => {
            const option = document.createElement('option');
            option.value = defect;
            option.textContent = defect;
            defectTypeSelect.appendChild(option);
        });
        
        // Agregar opción para crear nuevo defecto
        const createNewOption = document.createElement('option');
        createNewOption.value = NEW_DEFECT_VALUE;
        createNewOption.textContent = '+ Crear nuevo defecto…';
        createNewOption.style.fontWeight = 'bold';
        createNewOption.style.color = '#0066cc';
        defectTypeSelect.appendChild(createNewOption);
        
        // Resetear valores
        defectCountInput.value = 1;
        if (newDefectSection) newDefectSection.style.display = 'none';
        if (newDefectNameInput) newDefectNameInput.value = '';
        if (persistNewDefectCheckbox) persistNewDefectCheckbox.checked = true;
        
        // Listener para mostrar/ocultar sección de nuevo defecto
        defectTypeSelect.onchange = function() {
            if (this.value === NEW_DEFECT_VALUE) {
                if (newDefectSection) {
                    newDefectSection.style.display = 'block';
                    if (newDefectNameInput) newDefectNameInput.focus();
                }
            } else {
                if (newDefectSection) {
                    newDefectSection.style.display = 'none';
                    if (newDefectNameInput) newDefectNameInput.value = '';
                }
            }
        };
        
        // Mostrar modal
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        
    } catch (error) {
        console.error('Error abriendo agregar defecto:', error);
        showNotification('Error al abrir agregar defecto: ' + error.message, 'error');
    }
}

// Función para cerrar el modal de agregar defecto
function closeAddDefectModal() {
    const modal = document.getElementById('add-defect-modal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = '';
    }
}

// Función para confirmar y agregar el defecto (MEJORADA CON NUEVO DEFECTO)
async function confirmAddDefect() {
    try {
        const defectTypeSelect = document.getElementById('defect-type');
        const defectCountInput = document.getElementById('defect-count');
        const newDefectNameInput = document.getElementById('new-defect-name');
        const persistNewDefectCheckbox = document.getElementById('persist-new-defect');
        
        if (!defectTypeSelect || !defectCountInput) {
            showNotification('Error: elementos del formulario no encontrados', 'error');
            return;
        }
        
        let defectName = defectTypeSelect.value;
        const count = parseInt(defectCountInput.value || '1', 10);
        
        // Validar que se haya seleccionado un defecto
        if (!defectName) {
            showNotification('Debes seleccionar un tipo de defecto', 'warning');
            defectTypeSelect.focus();
            return;
        }
        
        // Validar cantidad
        if (!Number.isFinite(count) || count < 1) {
            showNotification('La cantidad debe ser un número mayor o igual a 1', 'warning');
            defectCountInput.focus();
            return;
        }
        
        // Si eligió crear nuevo defecto
        if (defectName === NEW_DEFECT_VALUE) {
            const newName = (newDefectNameInput?.value || '').trim();
            
            if (!newName) {
                showNotification('Debes ingresar el nombre del nuevo defecto', 'warning');
                if (newDefectNameInput) newDefectNameInput.focus();
                return;
            }
            
            // Validar que no exista ya
            if (availableDefects.includes(newName)) {
                showNotification('Este defecto ya existe en el perfil', 'warning');
                return;
            }
            
            defectName = newName;
            
            // Persistir en el perfil si está marcado
            if (persistNewDefectCheckbox?.checked) {
                try {
                    await persistDefectInProfile(defectName, currentProfile);
                    // Agregar a la lista local
                    availableDefects.push(defectName);
                    showNotification(`Nuevo defecto "${defectName}" guardado en el perfil`, 'success');
                } catch (error) {
                    console.warn('No se pudo persistir el defecto:', error);
                    showNotification('El defecto se usará pero no se guardó en el perfil', 'warning');
                }
            }
        }
        
        // Actualizar resultados
        if (analysisResults && analysisResults.results) {
            // Si ya existe el defecto, sumar; si no, crearlo
            if (analysisResults.results[defectName]) {
                analysisResults.results[defectName] += count;
            } else {
                analysisResults.results[defectName] = count;
            }
            
            // Recalcular total
            analysisResults.total_cherries = Object.values(analysisResults.results).reduce((a, b) => a + b, 0);
            
            // Actualizar interfaz
            displayDefectsList(analysisResults.results);
            document.getElementById('total-cherries').textContent = analysisResults.total_cherries;
            
            showNotification(`${defectName} agregado: +${count} (Total: ${analysisResults.results[defectName]})`, 'success');
            
            // Marcar como modificado
            analysisResults.manual_modifications = true;
        }
        
        closeAddDefectModal();
        
    } catch (error) {
        console.error('Error agregando defecto manual:', error);
        showNotification('Error al agregar defecto: ' + (error.message || 'Desconocido'), 'error');
    }
}

// Persistir el nuevo defecto en el perfil (ajusta a tu API real)
async function persistDefectInProfile(defectName, profileName) {
    try {
        // Ejemplo de endpoint: POST /api/profiles/{profile}/defects
        const res = await fetch(`/api/profiles/${encodeURIComponent(profileName)}/defects`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ defect: defectName })
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`No se pudo guardar el defecto en el perfil (${res.status}): ${text}`);
        }
        const result = await res.json();
        console.log('Defecto persistido:', result);
    } catch (e) {
        // No bloquear la acción principal si falló persistir; solo avisar
        console.warn('No se pudo persistir el nuevo defecto:', e);
        throw e;
    }
}

// Funciones de utilidad
function showLoading() {
    const loading = document.getElementById('loading');
    if (loading) {
        loading.style.display = 'flex';
    }
}

function hideLoading() {
    const loading = document.getElementById('loading');
    if (loading) {
        loading.style.display = 'none';
    }
}

function updateLoadingStatus(message) {
    const loadingStatus = document.getElementById('loading-status');
    if (loadingStatus) {
        loadingStatus.textContent = message;
    }
}

function showSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (section) {
        section.style.display = 'block';
    }
}

function hideSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (section) {
        section.style.display = 'none';
    }
}

function showSuccessMessage() {
    hideSection('form-section');
    hideSection('results-section');
    showSection('success-message');
    
    // Auto-ocultar después de 5 segundos
    setTimeout(() => {
        hideSection('success-message');
        showSection('form-section');
    }, 5000);
}

function closeModal() {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        modal.style.display = 'none';
    });
    document.body.style.overflow = 'auto';
}

function closeConfirmModal() {
    closeModal();
}

function confirmAction() {
    // Implementar según la acción específica
    closeModal();
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function logout() {
    if (confirm('¿Estás seguro de que deseas cerrar sesión?')) {
        // Cerrar sesión en backend opcionalmente
        fetch('/api/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
        localStorage.removeItem('rancoqc_user');
        localStorage.removeItem('rancoqc_analysis_type');
        localStorage.removeItem('rancoqc_current_module');
        window.location.href = 'login.html';
    }
}

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
            .notification.warning { background: #fef3c7; border-left: 4px solid #f59e0b; }
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

// Manejar errores globales
window.addEventListener('error', function(e) {
    console.error('Error en análisis:', e.error);
    showNotification('Ha ocurrido un error inesperado', 'error');
});

// Manejar pérdida de conexión
window.addEventListener('offline', function() {
    showNotification('Sin conexión a internet. Los datos se guardarán localmente.', 'error');
});

window.addEventListener('online', function() {
    showNotification('Conexión restaurada', 'success');
});

// Prevenir navegación accidental
window.addEventListener('beforeunload', function(e) {
    if (selectedImage && !analysisResults) {
        e.preventDefault();
        e.returnValue = '¿Estás seguro de que deseas salir? Se perderá el análisis en progreso.';
        return e.returnValue;
    }
});

// Exportar funciones para uso global
window.AnalysisApp = {
    analyzeImage,
    goBack,
    goHome,
    goToHistory,
    showSettings,
    newAnalysis,
    editResults,
    uploadData,
    saveData,
    deleteData,
    addDefect,
    editDefect,
    confirmAddDefect,
    closeModal,
    closeConfirmModal,
    confirmAction,
    logout,
    showNotification
};

// Hacer funciones globales para uso en HTML
window.onProfileChange = onProfileChange;
window.analyzeImage = analyzeImage;
window.analyzeFromRTSP = analyzeFromRTSP;
window.captureFromLocalCamera = captureFromLocalCamera;
window.captureFromRaspberry = captureFromRaspberry;
window.goBack = goBack;
window.goHome = goHome;
window.goToHistory = goToHistory;
window.showSettings = showSettings;
window.newAnalysis = newAnalysis;
window.editResults = editResults;
window.uploadData = uploadData;
window.saveData = saveData;
window.deleteData = deleteData;
window.addDefect = addDefect;
window.editDefect = editDefect;
window.confirmAddDefect = confirmAddDefect;
window.adjustDefectCount = adjustDefectCount;
window.exportToExcel = exportToExcel;
window.closeModal = closeModal;
window.closeAddDefectModal = closeAddDefectModal;
window.closeConfirmModal = closeConfirmModal;
window.confirmAction = confirmAction;
window.logout = logout;

// ===== CAMERA FUNCTIONS =====

// Abrir cámara en vivo
async function openLiveCamera() {
    try {
        const modal = document.getElementById('camera-modal');
        const video = document.getElementById('live-camera');
        const cameraStatus = document.querySelector('.camera-status');
        const cameraLoading = document.querySelector('.camera-loading');
        
        if (!modal || !video) {
            showNotification('Error: Elementos de cámara no encontrados', 'error');
            return;
        }
        
        // Mostrar modal
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        
        // Mostrar loading
        if (cameraLoading) {
            cameraLoading.style.display = 'block';
        }
        
        // Actualizar estado
        if (cameraStatus) {
            cameraStatus.className = 'camera-status inactive';
            cameraStatus.innerHTML = '<i class="fas fa-circle"></i> Iniciando cámara...';
        }
        
        // Obtener dispositivos de cámara disponibles
        await getCameraDevices();
        
        // Iniciar cámara
        await startCamera();
        
    } catch (error) {
        console.error('Error abriendo cámara:', error);
        showNotification(`Error al acceder a la cámara: ${error.message}`, 'error');
        closeLiveCamera();
    }
}

// Obtener dispositivos de cámara disponibles
async function getCameraDevices() {
    try {
        // Solicitar permisos primero
        await navigator.mediaDevices.getUserMedia({ video: true });
        
        // Obtener lista de dispositivos
        const devices = await navigator.mediaDevices.enumerateDevices();
        availableCameras = devices.filter(device => device.kind === 'videoinput');
        
        // Actualizar selector de cámara
        updateCameraSelector();
        
        console.log(`Encontradas ${availableCameras.length} cámaras:`, availableCameras);
        
    } catch (error) {
        console.error('Error obteniendo dispositivos:', error);
        throw new Error('No se pudo acceder a los dispositivos de cámara');
    }
}

// Actualizar selector de cámara
function updateCameraSelector() {
    const selector = document.querySelector('.camera-device-selector select');
    
    if (!selector || availableCameras.length === 0) return;
    
    selector.innerHTML = '';
    
    availableCameras.forEach((camera, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = camera.label || `Cámara ${index + 1}`;
        selector.appendChild(option);
    });
    
    // Event listener para cambio de cámara
    selector.addEventListener('change', async (e) => {
        currentCameraIndex = parseInt(e.target.value);
        await switchCamera();
    });
}

// Iniciar cámara
async function startCamera() {
    try {
        const video = document.getElementById('live-camera');
        const cameraStatus = document.querySelector('.camera-status');
        const cameraLoading = document.querySelector('.camera-loading');
        
        if (!video) return;
        
        // Detener stream anterior si existe
        if (currentStream) {
            currentStream.getTracks().forEach(track => track.stop());
        }
        
        // Configurar constraints
        const constraints = {
            video: {
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                facingMode: 'environment' // Preferir cámara trasera en móviles
            }
        };
        
        // Si hay cámaras específicas disponibles, usar la seleccionada
        if (availableCameras.length > 0 && availableCameras[currentCameraIndex]) {
            constraints.video.deviceId = { exact: availableCameras[currentCameraIndex].deviceId };
        }
        
        // Obtener stream
        currentStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // Asignar al video
        video.srcObject = currentStream;
        
        // Esperar a que el video esté listo
        await new Promise((resolve) => {
            video.onloadedmetadata = () => {
                video.play();
                resolve();
            };
        });
        
        // Ocultar loading
        if (cameraLoading) {
            cameraLoading.style.display = 'none';
        }
        
        // Actualizar estado
        if (cameraStatus) {
            cameraStatus.className = 'camera-status active';
            cameraStatus.innerHTML = '<i class="fas fa-circle"></i> Cámara activa';
        }
        
        showNotification('Cámara iniciada correctamente', 'success');
        
    } catch (error) {
        console.error('Error iniciando cámara:', error);
        
        // Ocultar loading
        const cameraLoading = document.querySelector('.camera-loading');
        if (cameraLoading) {
            cameraLoading.style.display = 'none';
        }
        
        // Actualizar estado
        const cameraStatus = document.querySelector('.camera-status');
        if (cameraStatus) {
            cameraStatus.className = 'camera-status inactive';
            cameraStatus.innerHTML = '<i class="fas fa-circle"></i> Error en cámara';
        }
        
        throw new Error('No se pudo iniciar la cámara');
    }
}

// Cambiar cámara
async function switchCamera() {
    try {
        if (availableCameras.length <= 1) {
            showNotification('Solo hay una cámara disponible', 'info');
            return;
        }
        
        // Cambiar al siguiente índice
        if (currentCameraIndex >= availableCameras.length - 1) {
            currentCameraIndex = 0;
        } else {
            currentCameraIndex++;
        }
        
        // Actualizar selector
        const selector = document.querySelector('.camera-device-selector select');
        if (selector) {
            selector.value = currentCameraIndex;
        }
        
        // Reiniciar cámara con nuevo dispositivo
        await startCamera();
        
        const cameraName = availableCameras[currentCameraIndex].label || `Cámara ${currentCameraIndex + 1}`;
        showNotification(`Cambiado a: ${cameraName}`, 'success');
        
    } catch (error) {
        console.error('Error cambiando cámara:', error);
        showNotification('Error al cambiar de cámara', 'error');
    }
}

// Capturar foto desde cámara en vivo
function captureFromLiveCamera() {
    try {
        const video = document.getElementById('live-camera');
        const canvas = document.getElementById('camera-canvas');
        
        if (!video || !canvas || !currentStream) {
            showNotification('Error: Cámara no disponible', 'error');
            return;
        }
        
        // Configurar canvas
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        // Capturar frame actual
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Convertir a blob
        canvas.toBlob((blob) => {
            if (blob) {
                // Crear archivo desde blob
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const file = new File([blob], `camera-capture-${timestamp}.jpg`, {
                    type: 'image/jpeg',
                    lastModified: Date.now()
                });
                
                // Usar como imagen seleccionada
                selectedImage = file;
                displayImagePreview(file);
                validateForm();
                
                // Cerrar modal de cámara
                closeLiveCamera();
                
                showNotification('Foto capturada correctamente', 'success');
                
                // Efecto visual de captura
                const captureEffect = document.createElement('div');
                captureEffect.style.cssText = `
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: white;
                    z-index: 9999;
                    opacity: 0.8;
                    pointer-events: none;
                `;
                document.body.appendChild(captureEffect);
                
                setTimeout(() => {
                    document.body.removeChild(captureEffect);
                }, 200);
                
            } else {
                showNotification('Error al capturar la foto', 'error');
            }
        }, 'image/jpeg', 0.9);
        
    } catch (error) {
        console.error('Error capturando foto:', error);
        showNotification('Error al capturar la foto', 'error');
    }
}

// Cerrar cámara en vivo
function closeLiveCamera() {
    try {
        const modal = document.getElementById('camera-modal');
        const video = document.getElementById('live-camera');
        
        // Detener stream
        if (currentStream) {
            currentStream.getTracks().forEach(track => track.stop());
            currentStream = null;
        }
        
        // Limpiar video
        if (video) {
            video.srcObject = null;
        }
        
        // Cerrar modal
        if (modal) {
            modal.style.display = 'none';
        }
        
        document.body.style.overflow = 'auto';
        
        // Reset variables
        availableCameras = [];
        currentCameraIndex = 0;
        
    } catch (error) {
        console.error('Error cerrando cámara:', error);
    }
}

// Verificar soporte de cámara
function checkCameraSupport() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.warn('API de cámara no soportada en este navegador');
        return false;
    }
    return true;
}

// Agregar funciones de cámara a las globales
window.openLiveCamera = openLiveCamera;
window.closeLiveCamera = closeLiveCamera;
window.captureFromLiveCamera = captureFromLiveCamera;
window.switchCamera = switchCamera;

// Agregar al objeto AnalysisApp
window.AnalysisApp.openLiveCamera = openLiveCamera;
window.AnalysisApp.closeLiveCamera = closeLiveCamera;
window.AnalysisApp.captureFromLiveCamera = captureFromLiveCamera;
window.AnalysisApp.switchCamera = switchCamera;
window.AnalysisApp.captureFromRaspberry = captureFromRaspberry;

// Verificar soporte al cargar
document.addEventListener('DOMContentLoaded', function() {
    if (!checkCameraSupport()) {
        // Ocultar botón de cámara en vivo si no hay soporte
        const liveCameraBtn = document.querySelector('.btn-live-camera');
        if (liveCameraBtn) {
            liveCameraBtn.style.display = 'none';
        }
        console.warn('Funcionalidad de cámara deshabilitada: no soportada por el navegador');
    }
});

// ===== MANUAL ENTRY FUNCTIONS =====

// Variables para ingreso manual
let manualDefects = {};
let availableDefects = [];

// Abrir modal de ingreso manual
async function openManualEntry() {
    try {
        // Validar que se haya seleccionado un perfil
        if (!currentProfile) {
            showNotification('Por favor selecciona un perfil de análisis primero', 'error');
            return;
        }
        
        // Validar formulario básico
        const distribucion = document.getElementById('distribucion').value;
        if (!distribucion) {
            showNotification('Por favor selecciona una distribución (Roja/Bicolor)', 'error');
            return;
        }
        
        // Cargar defectos disponibles para el perfil actual
        await loadDefectsForProfile(currentProfile);
        
        // Configurar modal
        const modal = document.getElementById('manual-entry-modal');
        const profileName = document.getElementById('manual-profile-name');
        
        if (modal && profileName) {
            const profileDisplayNames = {
                'qc_recepcion': 'QC Recepción',
                'packing_qc': 'Packing QC',
                'contramuestra': 'Contramuestra'
            };
            
            profileName.textContent = profileDisplayNames[currentProfile] || currentProfile;
            
            // Resetear defectos manuales
            manualDefects = {};
            availableDefects.forEach(defect => {
                manualDefects[defect] = 0;
            });
            
            // Mostrar lista de defectos
            displayManualDefectsList();
            updateManualTotal();
            
            // Mostrar modal
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }
        
    } catch (error) {
        console.error('Error abriendo ingreso manual:', error);
        showNotification('Error al abrir ingreso manual: ' + error.message, 'error');
    }
}

// Cargar defectos para el perfil actual
async function loadDefectsForProfile(profile) {
    try {
        const response = await fetch(`/api/defects/${profile}`, { credentials: 'include' }); // CAMBIO
        const result = await response.json();
        
        if (result.success) {
            availableDefects = result.defects;
            console.log(`Defectos cargados para ${profile}:`, availableDefects);
        } else {
            throw new Error(result.error || 'Error cargando defectos');
        }
        
    } catch (error) {
        console.error('Error cargando defectos:', error);
        showNotification('Error cargando defectos: ' + error.message, 'error');
        
        // Fallback a defectos por defecto
        availableDefects = [
            'FRUTO DOBLE', 'HIJUELO', 'DAÑO TRIPS', 'DAÑO PLAGA', 'VIROSIS',
            'FRUTO DEFORME', 'HC ESTRELLA', 'RUSSET', 'HC MEDIALUNA', 'HC SATURA',
            'PICADA DE PAJARO', 'HERIDA ABIERTA', 'PUDRICION HUMEDA', 'PUDRICION SECA',
            'FRUTO DESHIDRATADO', 'CRACKING CICATRIZADO', 'SUTURA DE FORMA',
            'FRUTO SIN PEDICELO', 'MACHUCON'
        ];
    }
}

// Mostrar lista de defectos para ingreso manual
function displayManualDefectsList() {
    const container = document.getElementById('defects-manual-list');
    if (!container) return;
    
    const defectsHTML = availableDefects.map(defect => {
        const count = manualDefects[defect] || 0;
        const countClass = count === 0 ? 'zero' : count <= 3 ? 'medium' : 'high';
        
        return `
            <div class="manual-defect-item">
                <div class="defect-info">
                    <div class="defect-name">${defect}</div>
                    <div class="defect-description">Ingreso manual</div>
                </div>
                <div class="defect-count-container">
                    <button class="defect-count-btn decrease" onclick="adjustManualDefectCount('${defect}', -1)" title="Disminuir">
                        <i class="fas fa-minus"></i>
                    </button>
                    <div class="defect-count ${countClass}" id="manual-count-${defect.replace(/\s+/g, '-')}">${count}</div>
                    <button class="defect-count-btn increase" onclick="adjustManualDefectCount('${defect}', 1)" title="Aumentar">
                        <i class="fas fa-plus"></i>
                    </button>
                </div>
                <div class="defect-actions">
                    <input type="number" class="manual-input" min="0" value="${count}" 
                           onchange="setManualDefectCount('${defect}', this.value)"
                           placeholder="0">
                </div>
            </div>
        `;
    }).join('');
    
    container.innerHTML = defectsHTML;
    
    // Agregar estilos si no existen
    if (!document.querySelector('#manual-entry-styles')) {
        const styles = document.createElement('style');
        styles.id = 'manual-entry-styles';
        styles.textContent = `
            .manual-defect-item {
                display: flex;
                align-items: center;
                padding: 12px;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
                margin-bottom: 8px;
                background: white;
            }
            
            .manual-defect-item .defect-info {
                flex: 1;
                padding-right: 12px;
            }
            
            .manual-defect-item .defect-name {
                font-weight: 600;
                color: #374151;
                font-size: 0.9rem;
            }
            
            .manual-defect-item .defect-description {
                font-size: 0.8rem;
                color: #6b7280;
            }
            
            .manual-defect-item .defect-count-container {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-right: 12px;
            }
            
            .manual-defect-item .defect-actions {
                min-width: 80px;
            }
            
            .manual-input {
                width: 70px;
                padding: 4px 8px;
                border: 1px solid #d1d5db;
                border-radius: 4px;
                text-align: center;
                font-size: 0.9rem;
            }
            
            .manual-totals {
                background: #f9fafb;
                padding: 16px;
                border-radius: 8px;
                margin-top: 16px;
                text-align: center;
            }
            
            .manual-entry-info {
                background: #dbeafe;
                padding: 12px;
                border-radius: 8px;
                margin-bottom: 16px;
            }
            
            .manual-entry-info p {
                margin: 4px 0;
            }
        `;
        document.head.appendChild(styles);
    }
}

// Ajustar contador manual de defectos
function adjustManualDefectCount(defectType, change) {
    const currentCount = manualDefects[defectType] || 0;
    const newCount = Math.max(0, currentCount + change);
    
    manualDefects[defectType] = newCount;
    
    // Actualizar interfaz
    const countElement = document.getElementById(`manual-count-${defectType.replace(/\s+/g, '-')}`);
    const inputElement = document.querySelector(`input[onchange*="${defectType}"]`);
    
    if (countElement) {
        countElement.textContent = newCount;
        countElement.className = `defect-count ${newCount === 0 ? 'zero' : newCount <= 3 ? 'medium' : 'high'}`;
    }
    
    if (inputElement) {
        inputElement.value = newCount;
    }
    
    updateManualTotal();
}

// Establecer contador manual de defectos
function setManualDefectCount(defectType, value) {
    const count = Math.max(0, parseInt(value) || 0);
    manualDefects[defectType] = count;
    
    // Actualizar interfaz
    const countElement = document.getElementById(`manual-count-${defectType.replace(/\s+/g, '-')}`);
    
    if (countElement) {
        countElement.textContent = count;
        countElement.className = `defect-count ${count === 0 ? 'zero' : count <= 3 ? 'medium' : 'high'}`;
    }
    
    updateManualTotal();
}

// Actualizar total manual
function updateManualTotal() {
    const total = Object.values(manualDefects).reduce((sum, count) => sum + count, 0);
    const totalElement = document.getElementById('manual-total-defects');
    
    if (totalElement) {
        totalElement.textContent = total;
    }
}

// Cerrar modal de ingreso manual
function closeManualEntry() {
    const modal = document.getElementById('manual-entry-modal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
    
    // Resetear datos
    manualDefects = {};
    availableDefects = [];
}

// Enviar análisis manual
async function submitManualEntry() {
    try {
        // Validar que hay datos
        const total = Object.values(manualDefects).reduce((sum, count) => sum + count, 0);
        if (total === 0) {
            showNotification('Debe ingresar al menos un defecto', 'error');
            return;
        }
        
        // Validar formulario
        const distribucion = document.getElementById('distribucion').value;
        const guiaSii = document.getElementById('guia-sii').value.trim();
        const lote = document.getElementById('lote').value.trim();
        const numFrutos = document.getElementById('num-frutos').value.trim();
        
        if (!distribucion || !guiaSii || !lote || !numFrutos) {
            showNotification('Por favor completa todos los campos del formulario', 'error');
            return;
        }

        const userName = getSafeUserName(); // CAMBIO
        if (!userName) {
            showNotification('Sesión inválida. Inicia sesión nuevamente.', 'error');
            window.location.href = 'login.html';
            return;
        }
        
        // Filtrar solo defectos con cantidad > 0
        const filteredDefects = {};
        Object.entries(manualDefects).forEach(([defect, count]) => {
            if (count > 0) {
                filteredDefects[defect] = count;
            }
        });
        
        // Preparar datos para enviar
        const manualData = {
            user: userName, // CAMBIO
            profile: currentProfile,
            distribucion: distribucion,
            guia_sii: guiaSii,
            lote: lote,
            num_frutos: parseInt(numFrutos),
            defects: filteredDefects
        };
        
        // Agregar campos específicos de Packing QC
        if (currentProfile === 'packing_qc') {
            manualData.num_proceso = document.getElementById('num-proceso')?.value || '';
            manualData.id_caja = document.getElementById('id-caja')?.value || '';
        }
        
        showNotification('Guardando análisis manual...', 'info');
        
        // Enviar al backend (CAMBIO: credentials)
        const response = await fetch('/manual_analysis', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(manualData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            // Simular resultados de análisis
            analysisResults = {
                results: result.results,
                total_cherries: result.total_cherries,
                confidence_used: 1.0,
                zones_loaded: Object.keys(result.results).length,
                processed_image: null,
                detections_by_zone: {},
                image_size: null,
                zones_available: Object.keys(result.results),
                timestamp: result.timestamp,
                analysis_type: 'manual',
                database_status: result.database_status,
                analysis_id: result.analysis_id
            };
            
            // Cerrar modal
            closeManualEntry();
            
            // Ocultar formulario y mostrar resultados
            hideSection('form-section');
            displayResults(analysisResults);
            
            showNotification(`Análisis manual guardado con ${total} defectos`, 'success');
            
        } else {
            throw new Error(result.error || 'Error desconocido');
        }
        
    } catch (error) {
        console.error('Error enviando análisis manual:', error);
        showNotification('Error guardando análisis manual: ' + error.message, 'error');
    }
}

// Agregar funciones al objeto global
window.openManualEntry = openManualEntry;
window.closeManualEntry = closeManualEntry;
window.submitManualEntry = submitManualEntry;
window.adjustManualDefectCount = adjustManualDefectCount;
window.setManualDefectCount = setManualDefectCount;
window.addManualDefect = addManualDefect;2