# RancoQC - Sistema de Análisis de Cerezas

Sistema completo de análisis de calidad de cerezas con interfaz web moderna basado en el prototipo de diseño proporcionado.

## 🚀 Características

- **Sistema de Login**: Autenticación con usuarios predefinidos
- **Dashboard Principal**: Interfaz moderna con selección de módulos
- **Análisis de Cerezas**: Detección automática usando YOLO con zonas definidas
- **Múltiples Módulos**: QC Recepción, Packing QC, y Contramuestras
- **Interfaz Responsive**: Diseño adaptable para dispositivos móviles
- **Gestión de Resultados**: Guardar, editar, subir y eliminar análisis

## 📁 Estructura del Proyecto

```
cherries/
├── backend/                 # Servidor Flask
│   ├── app.py              # Aplicación principal1
│   ├── best.pt             # Modelo YOLO entrenado
│   ├── zones.json          # Definición de zonas
│   ├── requirements.txt    # Dependencias Python
│   ├── static/            # Imágenes procesadas
│   └── results/           # Resultados guardados
├── frontend/               # Interfaz de usuario
│   └── src/
│       ├── components/    # Páginas HTML
│       │   ├── login.html
│       │   ├── dashboard.html
│       │   └── analysis.html
│       ├── styles/        # Archivos CSS
│       │   ├── login.css
│       │   ├── dashboard.css
│       │   └── analysis.css
│       └── js/           # JavaScript
│           ├── login.js
│           ├── dashboard.js
│           └── analysis.js
└── README.md
```

## 🛠️ Instalación

### Prerrequisitos

- Python 3.8+
- pip
- Modelo YOLO entrenado (`best.pt`)

### Pasos de Instalación

1. **Clonar o descargar el proyecto**
   ```bash
   cd cherries
   ```

2. **Instalar dependencias del backend**
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

3. **Verificar archivos necesarios**
   - Asegúrate de que `best.pt` esté en la carpeta `backend/`
   - Verifica que `zones.json` contenga las zonas definidas

4. **Iniciar el servidor**
   ```bash
   python app.py
   ```

5. **Acceder a la aplicación**
   - Abrir navegador en: `http://localhost:5001`

## 👥 Usuarios de Prueba

El sistema incluye usuarios predefinidos para testing:

| Usuario | Contraseña | Rol | Permisos |
|---------|------------|-----|----------|
| `mocaris@ranco.cl` | `ranco2025` | Admin | Completos |
| `admin@ranco.cl` | `admin123` | Admin | Completos |
| `control@ranco.cl` | `control123` | Control | Limitados |

## 🎯 Flujo de Uso

### 1. Login
- Acceder con uno de los usuarios predefinidos
- El sistema valida credenciales y redirige al dashboard

### 2. Dashboard
- Seleccionar módulo (QC Recepción, Packing QC, Contramuestras)
- Ver actividad reciente
- Acceder a funciones administrativas (solo admins)

### 3. Análisis
- Completar formulario según el módulo seleccionado
- Subir imagen de cerezas
- El sistema procesa con YOLO y muestra resultados
- Opciones para editar, guardar, subir o eliminar

### 4. Resultados
- Visualización de imagen procesada con detecciones
- Lista de defectos encontrados por zona
- Información estadística del análisis

## 🔧 Configuración

### Zonas de Análisis
Editar `backend/zones.json` para definir las zonas de detección:

```json
{
  "named_zones": [
    {
      "name": "Zona 1",
      "poly": [[x1, y1], [x2, y2], [x3, y3], [x4, y4]]
    }
  ]
}
```

### Modelo YOLO
- Colocar el modelo entrenado como `backend/best.pt`
- El modelo debe estar entrenado para detectar cerezas
- Confianza fija en 80% (configurable en el código)

## 📱 Características de la Interfaz

### Diseño Responsive
- Adaptable a móviles y tablets
- Navegación intuitiva con footer fijo
- Iconos Font Awesome para mejor UX

### Validación de Formularios
- Validación en tiempo real
- Indicadores visuales de estado
- Mensajes de error informativos

### Gestión de Estados
- Loading states durante procesamiento
- Notificaciones de éxito/error
- Persistencia de datos en localStorage

## 🚨 Solución de Problemas

### Error: Modelo no encontrado
```
❌ Modelo YOLO NO encontrado: best.pt
```
**Solución**: Colocar el archivo `best.pt` en la carpeta `backend/`

### Error: Zonas no cargadas
```
⚠️ No se cargaron zonas. Verifica zones.json
```
**Solución**: Verificar formato y contenido de `backend/zones.json`

### Error: Puerto en uso
```
Address already in use
```
**Solución**: Cambiar puerto en `app.py` o cerrar proceso existente

### Problemas de CORS
**Solución**: Verificar que CORS esté habilitado en `app.py`

## 🔄 Desarrollo

### Agregar Nuevos Módulos
1. Actualizar `moduleConfig` en `dashboard.js`
2. Agregar campos específicos en `analysis.html`
3. Modificar lógica en `setupModuleInterface()`

### Personalizar Estilos
- Editar archivos CSS en `frontend/src/styles/`
- Variables CSS para colores principales
- Clases utilitarias para componentes

### Extender Funcionalidad
- Agregar nuevos endpoints en `backend/app.py`
- Crear nuevas páginas en `frontend/src/components/`
- Implementar nuevas funciones en archivos JS

## 📊 API Endpoints

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/` | GET | Redirige al login |
| `/login` | GET | Página de login |
| `/dashboard` | GET | Dashboard principal |
| `/analysis` | GET | Página de análisis |
| `/analyze_cherries` | POST | Procesar imagen |
| `/get_zones` | GET | Obtener zonas |
| `/save_results` | POST | Guardar resultados |

## 🎨 Diseño

El diseño sigue el prototipo proporcionado en el PDF:
- Colores: Azul (#1e3a8a) y Rojo (#dc3545)
- Tipografía: System fonts (Apple/Segoe UI)
- Layout: Mobile-first responsive
- Componentes: Cards, modales, formularios

## 📝 Notas Técnicas

- **Backend**: Flask con YOLO para detección
- **Frontend**: HTML5, CSS3, JavaScript vanilla
- **Almacenamiento**: localStorage para datos offline
- **Imágenes**: Procesadas y guardadas en `/static`
- **Resultados**: JSON guardados en `/results`

## 🤝 Contribución

Para contribuir al proyecto:
1. Seguir la estructura de carpetas establecida
2. Mantener consistencia en el diseño
3. Documentar cambios importantes
4. Probar en diferentes dispositivos

## 📄 Licencia

Proyecto interno de Ranco para análisis de calidad de cerezas.
