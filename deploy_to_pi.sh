#!/bin/bash

# Script para desplegar código actualizado a Raspberry Pi
# Uso: bash deploy_to_pi.sh

# Configuración
PI_USER="pi"
PI_HOST="172.31.30.161"
PI_PATH="~/appdefectos/backend"

echo "🚀 Desplegando código a Raspberry Pi..."
echo "📡 Conectando a ${PI_USER}@${PI_HOST}..."
echo ""

# Copiar archivo app.py
echo "📁 Copiando app.py..."
scp backend/app.py ${PI_USER}@${PI_HOST}:${PI_PATH}/app.py

# Verificar que se copió correctamente
if [ $? -eq 0 ]; then
    echo "✅ app.py copiado exitosamente"
else
    echo "❌ Error copiando app.py"
    exit 1
fi

# Reiniciar servicio Flask (si está como servicio)
echo ""
echo "🔄 Reiniciando servidor Flask..."
ssh ${PI_USER}@${PI_HOST} "cd ${PI_PATH} && pkill -f 'python.*app.py' || true"

# Esperar un momento
sleep 2

# Iniciar servidor Flask en background
echo "▶️  Iniciando servidor Flask..."
ssh ${PI_USER}@${PI_HOST} "cd ${PI_PATH} && nohup python app.py > /tmp/flask.log 2>&1 &"

echo ""
echo "✅ Despliegue completado!"
echo "📝 Logs disponibles en: /tmp/flask.log"
echo ""
echo "Para ver los logs en tiempo real:"
echo "  ssh ${PI_USER}@${PI_HOST} 'tail -f /tmp/flask.log'"
echo ""