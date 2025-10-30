// Usuarios predefinidos para el prototipo
const USERS = {
    'mocaris@ranco.cl': {
        password: 'ranco2025',
        name: 'Mary Ocaris',
        role: 'admin',
        facility: 'FacilitieTemporada',
        module: 'Packing QC'
    },
    'admin@ranco.cl': {
        password: 'admin123',
        name: 'Administrador',
        role: 'admin',
        facility: 'Central',
        module: 'Control Total'
    },
    'control@ranco.cl': {
        password: 'control123',
        name: 'Usuario Control',
        role: 'control',
        facility: 'FacilitieTemporada',
        module: 'QC Recepción'
    }
};

// Actualizar hora en tiempo real
function updateTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('es-CL', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
    });
    document.getElementById('current-time').textContent = timeString;
}

// Inicializar la aplicación
document.addEventListener('DOMContentLoaded', function() {
    updateTime();
    setInterval(updateTime, 1000);
    
    // Verificar si ya hay una sesión activa
    const currentUser = localStorage.getItem('rancoqc_user');
    if (currentUser) {
        redirectToMain();
        return;
    }
    
    // Configurar el formulario de login
    const loginForm = document.getElementById('loginForm');
    loginForm.addEventListener('submit', handleLogin);
    
    // Agregar eventos de teclado
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            const activeElement = document.activeElement;
            if (activeElement.tagName === 'INPUT') {
                handleLogin(e);
            }
        }
    });
    
    // Auto-completar usuario de ejemplo
    const usuarioInput = document.getElementById('usuario');
    usuarioInput.addEventListener('focus', function() {
        if (!this.value) {
            this.value = 'mocaris@ranco.cl';
        }
    });
});

// Manejar el login
async function handleLogin(e) {
    e.preventDefault();
  
    const usuario = document.getElementById('usuario').value.trim();
    const password = document.getElementById('password').value;
    const loginBtn = document.querySelector('.login-btn');
    const loadingOverlay = document.getElementById('loadingOverlay');
  
    if (!usuario || !password) { showError('Por favor, complete todos los campos'); return; }
    if (!isValidEmail(usuario)) { showError('Por favor, ingrese un email válido'); return; }
  
    loginBtn.classList.add('loading');
    loadingOverlay.style.display = 'flex';
  
    try {
      // Autenticar contra el backend
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',         // IMPORTANTE: envía/recibe cookie de sesión
        body: JSON.stringify({ username: usuario, password })
      });
  
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Credenciales incorrectas');
      }
  
      const data = await res.json(); // { success, role, is_admin }
  
      // Opcional: info para UI (puedes mapear role→module/facility si lo necesitas)
      const sessionData = {
        email: usuario,
        role: data.role,
        is_admin: data.is_admin,
        loginTime: new Date().toISOString()
      };
      localStorage.setItem('rancoqc_user', JSON.stringify(sessionData));
  
      loginBtn.classList.remove('loading');
      loginBtn.classList.add('success');
      loginBtn.innerHTML = '<i class="fas fa-check"></i> ¡Bienvenido!';
  
      setTimeout(() => {
        loadingOverlay.style.display = 'none';
        redirectToMain();
      }, 600);
  
    } catch (error) {
      loginBtn.classList.remove('loading');
      loadingOverlay.style.display = 'none';
      showError(error.message || 'Error al iniciar sesión');
      document.getElementById('password').value = '';
      document.getElementById('password').focus();
    }
  }

// Validar email
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Mostrar mensaje de error
function showError(message) {
    const errorMessage = document.getElementById('errorMessage');
    const errorText = document.getElementById('errorText');
    
    errorText.textContent = message;
    errorMessage.style.display = 'block';
    
    // Auto-ocultar después de 5 segundos
    setTimeout(() => {
        hideError();
    }, 5000);
    
    // Agregar efecto de vibración en móviles
    if (navigator.vibrate) {
        navigator.vibrate([100, 50, 100]);
    }
}

// Ocultar mensaje de error
function hideError() {
    const errorMessage = document.getElementById('errorMessage');
    errorMessage.style.display = 'none';
}

// Redirigir a la aplicación principal
function redirectToMain() {
    // En un entorno real, esto sería una redirección del servidor
    // Por ahora, redirigimos a la página de análisis
    window.location.href = 'dashboard.html';
}

// Cerrar sesión
function logout() {
    localStorage.removeItem('rancoqc_user');
    window.location.href = 'login.html';
}

// Obtener datos del usuario actual
function getCurrentUser() {
    const userData = localStorage.getItem('rancoqc_user');
    return userData ? JSON.parse(userData) : null;
}

// Verificar si el usuario tiene permisos de administrador
function isAdmin() {
    const user = getCurrentUser();
    return user && user.role === 'admin';
}

// Verificar si hay sesión activa
function isLoggedIn() {
    return getCurrentUser() !== null;
}

// Funciones de utilidad para otras páginas
window.RancoQC = {
    getCurrentUser,
    isAdmin,
    isLoggedIn,
    logout,
    USERS
};

// Manejar errores globales
window.addEventListener('error', function(e) {
    console.error('Error en la aplicación:', e.error);
    showError('Ha ocurrido un error inesperado');
});

// Manejar pérdida de conexión
window.addEventListener('online', function() {
    hideError();
});

window.addEventListener('offline', function() {
    showError('Sin conexión a internet');
});

// Prevenir envío múltiple del formulario
let isSubmitting = false;

document.addEventListener('submit', function(e) {
    if (isSubmitting) {
        e.preventDefault();
        return false;
    }
    isSubmitting = true;
    
    setTimeout(() => {
        isSubmitting = false;
    }, 2000);
});

// Efectos visuales adicionales
document.addEventListener('DOMContentLoaded', function() {
    // Animación de entrada para los elementos del formulario
    const formElements = document.querySelectorAll('.form-group, .login-btn');
    formElements.forEach((element, index) => {
        element.style.opacity = '0';
        element.style.transform = 'translateY(20px)';
        
        setTimeout(() => {
            element.style.transition = 'all 0.5s ease-out';
            element.style.opacity = '1';
            element.style.transform = 'translateY(0)';
        }, index * 100);
    });
    
    // Efecto de focus en los inputs
    const inputs = document.querySelectorAll('input');
    inputs.forEach(input => {
        input.addEventListener('focus', function() {
            this.parentElement.classList.add('focused');
        });
        
        input.addEventListener('blur', function() {
            if (!this.value) {
                this.parentElement.classList.remove('focused');
            }
        });
    });
});

// Funciones para mostrar información de usuarios disponibles
function showAvailableUsers() {
    const userList = Object.keys(USERS).map(email => {
        const user = USERS[email];
        return `${email} (${user.name}) - Rol: ${user.role}`;
    }).join('\n');
    
    alert(`Usuarios disponibles para prueba:\n\n${userList}\n\nContraseñas:\n- mocaris@ranco.cl: ranco2025\n- admin@ranco.cl: admin123\n- control@ranco.cl: control123`);
}

// Agregar botón de ayuda (solo para desarrollo)
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    document.addEventListener('DOMContentLoaded', function() {
        const helpBtn = document.createElement('button');
        helpBtn.innerHTML = '<i class="fas fa-question-circle"></i> Ver usuarios de prueba';
        helpBtn.className = 'btn btn-secondary';
        helpBtn.style.position = 'fixed';
        helpBtn.style.bottom = '20px';
        helpBtn.style.left = '20px';
        helpBtn.style.zIndex = '1000';
        helpBtn.style.fontSize = '12px';
        helpBtn.style.padding = '8px 12px';
        helpBtn.onclick = showAvailableUsers;
        
        document.body.appendChild(helpBtn);
    });
}
