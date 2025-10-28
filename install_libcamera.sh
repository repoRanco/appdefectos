#!/bin/bash

# Script para instalar libcamera en Raspberry Pi
# Ejecutar con: sudo bash install_libcamera.sh

echo "🍓 Instalando libcamera para Raspberry Pi..."
echo ""

# Verificar que estamos en Raspberry Pi
if ! grep -q "Raspberry Pi" /proc/cpuinfo; then
    echo "⚠️ Este script está diseñado para Raspberry Pi"
    read -p "¿Continuar de todas formas? (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Actualizar sistema
echo "📦 Actualizando paquetes..."
sudo apt update

# Instalar libcamera-apps
echo "📦 Instalando libcamera-apps..."
sudo apt install -y libcamera-apps libcamera-tools

# Verificar instalación
echo ""
echo "🔍 Verificando instalación..."

if command -v libcamera-still &> /dev/null; then
    echo "✅ libcamera-still instalado correctamente"
    libcamera-still --version 2>&1 | head -n 1 || echo "Versión no disponible"
else
    echo "❌ libcamera-still no se instaló correctamente"
fi

# Verificar si raspistill está disponible (sistemas legacy)
if command -v raspistill &> /dev/null; then
    echo "✅ raspistill también está disponible"
fi

# Verificar cámaras disponibles
echo ""
echo "📷 Verificando cámaras..."
if ls /dev/video* 2>/dev/null | grep -q video; then
    echo "Dispositivos de video encontrados:"
    ls -la /dev/video*
else
    echo "⚠️ No se encontraron dispositivos /dev/video*"
    echo "   La cámara puede no estar conectada o habilitada"
fi

# Información adicional
echo ""
echo "📋 Para habilitar la cámara (si está deshabilitada):"
echo "   1. Ejecuta: sudo raspi-config"
echo "   2. Selecciona 'Interface Options' > 'Camera' > 'Enable'"
echo "   3. Reinicia el sistema con: sudo reboot"
echo ""
echo "✅ Instalación completada!"

