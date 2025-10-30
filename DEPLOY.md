# Instrucciones para Desplegar Código a Raspberry Pi

## Problema Actual

El servidor Flask en la Raspberry Pi está usando una versión antigua del código que todavía busca `libcamera-still` y `raspistill`. El código local ya está actualizado para usar solo `rpicam-still`.

## Solución: Copiar archivo actualizado

### Opción 1: Usando SCP desde tu Mac

```bash
# Copiar archivo app.py a Raspberry Pi
scp backend/app.py pi@172.31.30.161:~/appdefectos/backend/app.py

# Luego reiniciar el servidor Flask en la Raspberry Pi
ssh pi@172.31.30.161 "cd ~/appdefectos/backend && pkill -f 'python.*app.py' && python app.py"
```

### Opción 2: Manual

1. Abrir el archivo `backend/app.py` local en tu editor
2. Copiar todo el contenido (Cmd+A, Cmd+C)
3. SSH a la Raspberry Pi:
   ```bash
   ssh pi@172.31.30.161
   ```
4. Navegar al directorio:
   ```bash
   cd ~/appdefectos/backend
   ```
5. Hacer backup del archivo actual:
   ```bash
   cp app.py app.py.backup
   ```
6. Editar el archivo:
   ```bash
   nano app.py
   ```
7. Pegar el contenido nuevo (Cmd+V o click derecho > pegar)
8. Guardar (Ctrl+X, Y, Enter)
9. Reiniciar Flask:
   ```bash
   # Detener proceso actual
   pkill -f 'python.*app.py'
   
   # Iniciar de nuevo
   python app.py
   ```

### Opción 3: Verificar que rpicam-still está instalado

En la Raspberry Pi, ejecutar:

```bash
# Verificar instalación
which rpicam-still

# Si no existe, instalar
sudo apt update
sudo apt install -y libcamera-apps libcamera-tools

# Probar manualmente
rpicam-still -o test.jpg --immediate -n --quality=100

# Verificar que la imagen se capturó
ls -lh test.jpg
```

## Verificar que funciona

Después de copiar el archivo y reiniciar Flask, deberías ver en los logs:

```
🍓 Usando comando: rpicam-still
🍓 Ejecutando: rpicam-still --immediate --timeout=1200 ...
✅ Imagen capturada exitosamente: 3280x2464
```

En lugar de los mensajes antiguos sobre libcamera-still y raspistill.

