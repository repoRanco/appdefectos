from flask import Flask, request, jsonify, render_template, redirect, send_from_directory
from flask_cors import CORS
from ultralytics import YOLO
import cv2
import numpy as np
import json
import os
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont
import time

app = Flask(__name__)
CORS(app)  # Permitir requests desde frontend

# Cargar modelo entrenado
MODEL_PATH = "best.pt"  # Cambia por tu ruta
model = YOLO(MODEL_PATH)

# Crear carpetas necesarias
os.makedirs('static', exist_ok=True)
os.makedirs('results', exist_ok=True)

# Definir perfiles disponibles
AVAILABLE_PROFILES = {
    "qc_recepcion": {
        "name": "QC Recepción",
        "file": "zones_qc_recepcion.json",
        "description": "Control de calidad en recepción"
    },
    "packing_qc": {
        "name": "Packing QC", 
        "file": "zones_packing_qc.json",
        "description": "Control de calidad en empaque"
    },
    "contramuestra": {
        "name": "Contramuestra",
        "file": "zones_contramuestra.json", 
        "description": "Análisis de contramuestras"
    }
}

# Cargar zonas desde JSON basado en perfil y distribución
def load_zones(profile="qc_recepcion", distribucion="roja"):
    """Carga zonas específicas según el perfil de usuario y tipo de fruta"""
    try:
        # Validar perfil
        if profile not in AVAILABLE_PROFILES:
            print(f"⚠️ Perfil '{profile}' no encontrado, usando QC Recepción por defecto")
            profile = "qc_recepcion"
        
        # Validar distribución
        if distribucion not in ["roja", "bicolor"]:
            print(f"⚠️ Distribución '{distribucion}' no válida, usando 'roja' por defecto")
            distribucion = "roja"
        
        # Construir nombre de archivo específico
        if profile == "packing_qc":
            # Packing usa las mismas zonas que contramuestra
            zone_file = f"zones_contramuestra_{distribucion}.json"
            print(f"📁 Packing QC usando zonas de contramuestra: {zone_file}")
        else:
            zone_file = f"zones_{profile}_{distribucion}.json"
        
        print(f"📁 Cargando zonas para perfil: {AVAILABLE_PROFILES[profile]['name']} - {distribucion}")
        print(f"📄 Archivo: {zone_file}")
        
        with open(zone_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
            # Si el JSON tiene estructura "named_zones", extraer
            if "named_zones" in data:
                zones = {}
                for zone in data["named_zones"]:
                    # Convertir poly de [[x,y], [x,y]] a lista plana
                    poly_points = []
                    for point in zone["poly"]:
                        poly_points.append([int(point[0]), int(point[1])])
                    zones[zone["name"]] = poly_points
                return zones
            else:
                # Si ya está en formato directo
                return data
                
    except FileNotFoundError:
        print(f"❌ Error: {zone_file} no encontrado")
        # Intentar fallback con archivo genérico del perfil
        try:
            fallback_file = AVAILABLE_PROFILES[profile]["file"]
            print(f"🔄 Intentando fallback: {fallback_file}")
            with open(fallback_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if "named_zones" in data:
                    zones = {}
                    for zone in data["named_zones"]:
                        poly_points = []
                        for point in zone["poly"]:
                            poly_points.append([int(point[0]), int(point[1])])
                        zones[zone["name"]] = poly_points
                    return zones
                return data
        except:
            # Último fallback con zones.json
            try:
                print("🔄 Último fallback: zones.json")
                with open('zones.json', 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    if "named_zones" in data:
                        zones = {}
                        for zone in data["named_zones"]:
                            poly_points = []
                            for point in zone["poly"]:
                                poly_points.append([int(point[0]), int(point[1])])
                            zones[zone["name"]] = poly_points
                        return zones
                    return data
            except:
                return {}
    except Exception as e:
        print(f"❌ Error cargando zonas: {e}")
        return {}

# Las zonas se cargarán dinámicamente en cada análisis
zones = {}

def resize_image_to_standard(img, target_size=(1920, 1080)):
    """Redimensiona la imagen a resolución estándar 1920x1080"""
    target_width, target_height = target_size
    current_height, current_width = img.shape[:2]
    
    print(f"📐 Redimensionando imagen: {current_width}x{current_height} -> {target_width}x{target_height}")
    
    # Redimensionar imagen manteniendo aspecto y rellenando con negro si es necesario
    resized_img = cv2.resize(img, (target_width, target_height))
    
    return resized_img

def scale_zones_to_image(zones, reference_size, target_size):
    """Escala las zonas desde el tamaño de referencia al tamaño de la imagen actual"""
    ref_width, ref_height = reference_size
    target_width, target_height = target_size
    
    # Calcular factores de escala
    scale_x = target_width / ref_width
    scale_y = target_height / ref_height
    
    print(f"🔄 Escalando zonas: {ref_width}x{ref_height} -> {target_width}x{target_height}")
    print(f"📏 Factores de escala: X={scale_x:.3f}, Y={scale_y:.3f}")
    
    scaled_zones = {}
    for zone_name, poly in zones.items():
        scaled_poly = []
        for point in poly:
            scaled_x = int(point[0] * scale_x)
            scaled_y = int(point[1] * scale_y)
            scaled_poly.append([scaled_x, scaled_y])
        scaled_zones[zone_name] = scaled_poly
    
    return scaled_zones

def remove_duplicate_detections(detections, min_distance=50):
    """Elimina detecciones duplicadas que están muy cerca entre sí"""
    if len(detections) <= 1:
        return detections
    
    filtered_detections = []
    
    for i, detection in enumerate(detections):
        bbox = detection.xyxy[0].tolist()
        x1, y1, x2, y2 = bbox
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        
        is_duplicate = False
        for filtered_detection in filtered_detections:
            filtered_bbox = filtered_detection.xyxy[0].tolist()
            fx1, fy1, fx2, fy2 = filtered_bbox
            fcx, fcy = (fx1 + fx2) / 2, (fy1 + fy2) / 2
            
            # Calcular distancia entre centros
            distance = np.sqrt((cx - fcx)**2 + (cy - fcy)**2)
            
            if distance < min_distance:
                # Es duplicado, mantener el de mayor confianza
                if float(detection.conf[0]) > float(filtered_detection.conf[0]):
                    # Reemplazar con el de mayor confianza
                    filtered_detections.remove(filtered_detection)
                    break
                else:
                    is_duplicate = True
                    break
        
        if not is_duplicate:
            filtered_detections.append(detection)
    
    print(f"🔄 Detecciones filtradas: {len(detections)} -> {len(filtered_detections)}")
    return filtered_detections

def assign_zone(bbox, zones, img_size=None, zones_reference_size=(1920, 1080)):
    """Asigna una detección a una zona basada en el centro del bounding box"""
    try:
        # Calcular centro del bounding box
        x1, y1, x2, y2 = bbox
        cx = int((x1 + x2) / 2)
        cy = int((y1 + y2) / 2)
        
        print(f"🎯 Verificando punto ({cx}, {cy}) en zonas...")
        
        # Escalar zonas si se proporciona el tamaño de imagen
        zones_to_use = zones
        if img_size is not None:
            zones_to_use = scale_zones_to_image(zones, zones_reference_size, img_size)
        
        for zone_name, poly in zones_to_use.items():
            try:
                # Convertir polígono a formato numpy
                polygon = np.array(poly, np.int32)
                
                # Verificar si el punto está dentro del polígono
                inside = cv2.pointPolygonTest(polygon, (cx, cy), False)
                
                if inside >= 0:  # >= 0 significa dentro o en el borde
                    print(f"✅ Punto ({cx}, {cy}) está en zona: {zone_name}")
                    return zone_name
                    
            except Exception as e:
                print(f"❌ Error procesando zona {zone_name}: {e}")
                continue
        
        print(f"⚠️ Punto ({cx}, {cy}) no está en ninguna zona")
        return "Sin clasificar"
        
    except Exception as e:
        print(f"❌ Error en assign_zone: {e}")
        return "Sin clasificar"

def detect_image_shift(img, reference_features=None):
    """Detecta el desplazamiento de la imagen comparando características"""
    try:
        # Convertir a escala de grises
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # Detectar características usando ORB
        orb = cv2.ORB_create(nfeatures=500)
        keypoints, descriptors = orb.detectAndCompute(gray, None)
        
        if reference_features is None or descriptors is None:
            return (0, 0), {"keypoints": keypoints, "descriptors": descriptors}
        
        # Comparar con características de referencia
        ref_descriptors = reference_features.get("descriptors")
        if ref_descriptors is None:
            return (0, 0), {"keypoints": keypoints, "descriptors": descriptors}
        
        # Encontrar coincidencias
        bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
        matches = bf.match(descriptors, ref_descriptors)
        matches = sorted(matches, key=lambda x: x.distance)
        
        if len(matches) < 10:
            print("⚠️ Pocas coincidencias encontradas para detectar desplazamiento")
            return (0, 0), {"keypoints": keypoints, "descriptors": descriptors}
        
        # Obtener puntos correspondientes
        src_pts = np.float32([keypoints[m.queryIdx].pt for m in matches[:20]]).reshape(-1, 1, 2)
        dst_pts = np.float32([reference_features["keypoints"][m.trainIdx].pt for m in matches[:20]]).reshape(-1, 1, 2)
        
        # Calcular transformación
        M, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)
        
        if M is not None:
            # Extraer desplazamiento
            dx = M[0, 2]
            dy = M[1, 2]
            print(f"📐 Desplazamiento detectado: dx={dx:.1f}, dy={dy:.1f}")
            return (dx, dy), {"keypoints": keypoints, "descriptors": descriptors}
        
    except Exception as e:
        print(f"❌ Error detectando desplazamiento: {e}")
    
    return (0, 0), {"keypoints": keypoints if 'keypoints' in locals() else None, 
                    "descriptors": descriptors if 'descriptors' in locals() else None}

def adjust_zones_for_shift(zones, shift_x, shift_y):
    """Ajusta las zonas basado en el desplazamiento detectado"""
    if abs(shift_x) < 5 and abs(shift_y) < 5:
        return zones  # No ajustar para desplazamientos pequeños
    
    adjusted_zones = {}
    for zone_name, poly in zones.items():
        adjusted_poly = []
        for point in poly:
            adjusted_x = int(point[0] + shift_x)
            adjusted_y = int(point[1] + shift_y)
            adjusted_poly.append([adjusted_x, adjusted_y])
        adjusted_zones[zone_name] = adjusted_poly
    
    print(f"🔄 Zonas ajustadas por desplazamiento: dx={shift_x:.1f}, dy={shift_y:.1f}")
    return adjusted_zones

def draw_zones_and_detections(img, detections, zones, confidence_threshold=0.8):
    """Dibuja las zonas (polígonos) y detecciones en la imagen sin escalado de polígonos"""
    # Convertir de OpenCV (BGR) a PIL (RGB)
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    pil_img = Image.fromarray(img_rgb)
    draw = ImageDraw.Draw(pil_img)
    
    # Intentar cargar una fuente, si no usar la por defecto
    try:
        font = ImageFont.truetype("arial.ttf", 16)
        font_small = ImageFont.truetype("arial.ttf", 12)
    except:
        try:
            font = ImageFont.load_default()
            font_small = ImageFont.load_default()
        except:
            font = None
            font_small = None
    
    # Colores para las zonas
    zone_colors = [
        (255, 0, 0, 60),    # Rojo semi-transparente
        (0, 255, 0, 60),    # Verde semi-transparente
        (0, 0, 255, 60),    # Azul semi-transparente
        (255, 255, 0, 60),  # Amarillo semi-transparente
        (255, 0, 255, 60),  # Magenta semi-transparente
        (0, 255, 255, 60),  # Cian semi-transparente
        (255, 165, 0, 60),  # Naranja semi-transparente
        (128, 0, 128, 60),  # Púrpura semi-transparente
        (255, 192, 203, 60), # Rosa semi-transparente
        (0, 128, 128, 60),  # Verde azulado semi-transparente
        (128, 128, 0, 60),  # Oliva semi-transparente
        (255, 20, 147, 60), # Rosa profundo semi-transparente
        (70, 130, 180, 60), # Azul acero semi-transparente
        (255, 69, 0, 60),   # Rojo naranja semi-transparente
        (50, 205, 50, 60),  # Verde lima semi-transparente
        (138, 43, 226, 60), # Violeta azul semi-transparente
    ]
    
    # Dibujar zonas de fondo (polígonos)
    print(f"🎨 Dibujando {len(zones)} zonas...")
    for i, (zone_name, poly) in enumerate(zones.items()):
        try:
            color = zone_colors[i % len(zone_colors)]
            
            # Convertir polígono a tuplas para PIL
            polygon_points = []
            for point in poly:
                polygon_points.append((int(point[0]), int(point[1])))
            
            # Crear overlay para transparencia
            overlay = Image.new('RGBA', pil_img.size, (255, 255, 255, 0))
            overlay_draw = ImageDraw.Draw(overlay)
            
            # Dibujar polígono relleno
            overlay_draw.polygon(polygon_points, fill=color)
            
            # Combinar con la imagen original
            pil_img = Image.alpha_composite(pil_img.convert('RGBA'), overlay).convert('RGB')
            draw = ImageDraw.Draw(pil_img)
            
            # Dibujar borde del polígono
            draw.polygon(polygon_points, outline=color[:3], width=2)
            
            # Etiqueta de la zona (en el primer punto)
            if polygon_points:
                label_x, label_y = polygon_points[0]
                if font_small:
                    draw.text((label_x + 5, label_y + 5), zone_name, fill=(0, 0, 0), font=font_small)
                else:
                    draw.text((label_x + 5, label_y + 5), zone_name, fill=(0, 0, 0))
                    
        except Exception as e:
            print(f"❌ Error dibujando zona {zone_name}: {e}")
            continue
    
    # Dibujar detecciones contra los polígonos tal como vienen del JSON
    detections_count = len(detections) if detections is not None else 0
    print(f"🔍 Dibujando {detections_count} detecciones...")
    
    if detections_count > 0:
        for i, box in enumerate(detections):
            try:
                x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                conf = float(box.conf[0])
                
                # Solo dibujar si supera el umbral de confianza
                if conf < confidence_threshold:
                    continue
                
                # Determinar zona revisando directamente contra 'zones' del JSON
                cx, cy = int((x1 + x2) // 2), int((y1 + y2) // 2)
                zone_name = "Sin clasificar"
                for zname, poly in zones.items():
                    polygon = np.array(poly, np.int32)
                    inside = cv2.pointPolygonTest(polygon, (cx, cy), False)
                    if inside >= 0:
                        zone_name = zname
                        break
                
                if zone_name == "Sin clasificar":
                    continue
                
                # Dibujar bounding box
                draw.rectangle([x1, y1, x2, y2], outline=(255, 0, 0), width=3)
                
                # Etiqueta con confianza y zona
                label = f"Cherry {conf:.2f}\n{zone_name}"
                
                # Fondo para el texto
                if font_small:
                    bbox = draw.textbbox((x1, y1-50), label, font=font_small)
                    draw.rectangle(bbox, fill=(255, 255, 255, 200))
                    draw.text((x1, y1-50), label, fill=(0, 0, 0), font=font_small)
                else:
                    draw.rectangle([x1, y1-50, x1+150, y1], fill=(255, 255, 255, 200))
                    draw.text((x1, y1-50), label, fill=(0, 0, 0))
                    
            except Exception as e:
                print(f"❌ Error dibujando detección {i}: {e}")
                continue
    
    # Convertir de vuelta a OpenCV
    return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

@app.route('/')
def index():
    """Página principal - redirigir al login"""
    return redirect('/login')

@app.route('/login')
def login():
    """Página de login"""
    return send_from_directory('../frontend/src/components', 'login.html')

@app.route('/dashboard')
def dashboard():
    """Página principal del dashboard"""
    return send_from_directory('../frontend/src/components', 'dashboard.html')

@app.route('/analysis')
def analysis():
    """Página de análisis"""
    return send_from_directory('../frontend/src/components', 'analysis.html')

@app.route('/<page>.html')
def redirect_html(page):
    """Redirige rutas con .html a su equivalente sin extensión"""
    return redirect(f'/{page}', code=301)

# Servir archivos estáticos del frontend
@app.route('/styles/<path:filename>')
def serve_styles(filename):
    return send_from_directory('../frontend/src/styles', filename)

@app.route('/js/<path:filename>')
def serve_js(filename):
    return send_from_directory('../frontend/src/js', filename)

@app.route('/components/<path:filename>')
def serve_components(filename):
    return send_from_directory('../frontend/src/components', filename)

@app.route('/public/<path:filename>')
def serve_public(filename):
    """Servir archivos estáticos del directorio frontend/public"""
    return send_from_directory('../frontend/public', filename)

@app.route('/analyze_cherries', methods=['POST'])
def analyze_cherries():
    try:
        if 'image' not in request.files:
            return jsonify({"success": False, "error": "No se envió imagen"})
        
        file = request.files['image']
        if file.filename == '':
            return jsonify({"success": False, "error": "Archivo vacío"})
        
        # Obtener perfil y distribución del request
        profile = request.form.get('profile', 'qc_recepcion')
        distribucion = request.form.get('distribucion', 'roja')
        
        # Cargar zonas dinámicamente según perfil y distribución
        zones = load_zones(profile, distribucion)
        if not zones:
            return jsonify({"success": False, "error": "No se pudieron cargar las zonas"})
        
        confidence = 0.8 # fijo
        print(f"🎯 Confianza forzada a: {confidence}")
        print(f"📁 Zonas cargadas dinámicamente: {len(zones)}")
        
        # Convertir a formato OpenCV
        img_array = np.frombuffer(file.read(), np.uint8)
        img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        
        if img is None:
            return jsonify({"success": False, "error": "Imagen inválida"})
        
        results = model.predict(img, conf=confidence, verbose=False)
        
        zone_counts = {name: 0 for name in zones.keys()}
        total_detections = 0
        detections_by_zone = {}
        
        # Obtener dimensiones de la imagen
        img_height, img_width = img.shape[:2]
        img_size = (img_width, img_height)
        zones_reference_size = (1920, 1080)  # Tamaño de referencia para las zonas
        print(f"📐 Tamaño de imagen: {img_width}x{img_height}")
        print(f"📏 Tamaño de referencia de zonas: {zones_reference_size}")
        
        # Escalar zonas para el dibujo
        scaled_zones_for_drawing = scale_zones_to_image(zones, zones_reference_size, img_size)
 
        if len(results[0].boxes) > 0:
            # Filtrar detecciones duplicadas
            filtered_boxes = remove_duplicate_detections(results[0].boxes, min_distance=50)
            print(f"🔄 Detecciones después de filtrar duplicados: {len(filtered_boxes)}")
            
            for i, box in enumerate(filtered_boxes):
                try:
                    bbox = box.xyxy[0].tolist()
                    conf_score = float(box.conf[0])
                    
                    if conf_score < confidence:
                        continue
                    
                    # Determinar zona usando escalado apropiado
                    zone_name = assign_zone(bbox, zones, img_size, zones_reference_size)
                    if zone_name == "Sin clasificar":
                        continue  # descartar si no está en zona
                    
                    # sumar dentro de zona
                    zone_counts[zone_name] += 1
                    if zone_name not in detections_by_zone:
                        detections_by_zone[zone_name] = []
                    detections_by_zone[zone_name].append({
                        "bbox": bbox,
                        "conf": conf_score
                    })
                    total_detections += 1
                
                except Exception as e:
                    print(f"❌ Error procesando detección {i}: {e}")
                    continue
            
            # Usar las detecciones filtradas para el dibujo
            results[0].boxes = filtered_boxes
        
        processed_img = draw_zones_and_detections(
            img.copy(),
            results[0].boxes,
            scaled_zones_for_drawing,
            confidence_threshold=confidence
        )
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        processed_filename = f"analysis_{timestamp}_conf80.jpg"
        processed_path = os.path.join("static", processed_filename)
        cv2.imwrite(processed_path, processed_img)
        
        # filtrar solo zonas con > 0
        filtered_results = {k: v for k, v in zone_counts.items() if v > 0}
        
        print(f"📊 Resultados por zona: {filtered_results}")
        print(f"📁 Imagen procesada guardada: {processed_path}")
        
        return jsonify({
            "success": True,
            "results": filtered_results,
            "total_cherries": total_detections,
            "confidence_used": confidence,
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "zones_loaded": len(zones),
            "processed_image": f"/static/{processed_filename}",
            "detections_by_zone": detections_by_zone,
            "image_size": f"{img_width}x{img_height}",
            "zones_available": list(zones.keys())
        })
        
    except Exception as e:
        print(f"❌ Error en análisis: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)})

@app.route('/get_profiles', methods=['GET'])
def get_profiles():
    """Endpoint para obtener los perfiles disponibles"""
    return jsonify({
        "success": True,
        "profiles": AVAILABLE_PROFILES
    })

@app.route('/get_zones', methods=['GET'])
def get_zones():
    """Endpoint para obtener las zonas disponibles según perfil"""
    profile = request.args.get('profile', 'qc_recepcion')
    current_zones = load_zones(profile)
    
    profile_info = AVAILABLE_PROFILES.get(profile, {})
    
    return jsonify({
        "success": True,
        "profile": profile,
        "profile_name": profile_info.get("name", "Desconocido"),
        "profile_description": profile_info.get("description", ""),
        "zones": list(current_zones.keys()),
        "zones_count": len(current_zones),
        "zones_details": current_zones
    })

@app.route('/upload_zones', methods=['POST'])
def upload_zones():
    """Endpoint para subir nuevas zonas para un perfil específico"""
    try:
        if 'zones_file' not in request.files:
            return jsonify({"success": False, "error": "No se envió archivo de zonas"})
        
        file = request.files['zones_file']
        profile = request.form.get('profile', 'qc_recepcion')
        
        if file.filename == '':
            return jsonify({"success": False, "error": "Archivo vacío"})
        
        if not file.filename.endswith('.json'):
            return jsonify({"success": False, "error": "El archivo debe ser un JSON"})
        
        # Validar que el perfil existe
        if profile not in AVAILABLE_PROFILES:
            return jsonify({"success": False, "error": f"Perfil '{profile}' no válido"})
        
        # Leer y validar el contenido JSON
        try:
            zones_data = json.loads(file.read().decode('utf-8'))
        except json.JSONDecodeError as e:
            return jsonify({"success": False, "error": f"JSON inválido: {str(e)}"})
        
        # Validar estructura del JSON
        if "named_zones" not in zones_data:
            return jsonify({"success": False, "error": "El JSON debe tener una estructura 'named_zones'"})
        
        # Validar que cada zona tenga nombre y polígono
        for zone in zones_data["named_zones"]:
            if "name" not in zone or "poly" not in zone:
                return jsonify({"success": False, "error": "Cada zona debe tener 'name' y 'poly'"})
        
        # Guardar el archivo
        zone_file = AVAILABLE_PROFILES[profile]["file"]
        with open(zone_file, 'w', encoding='utf-8') as f:
            json.dump(zones_data, f, ensure_ascii=False, indent=2)
        
        # Cargar las nuevas zonas para verificar
        new_zones = load_zones(profile)
        
        return jsonify({
            "success": True,
            "message": f"Zonas actualizadas para perfil {AVAILABLE_PROFILES[profile]['name']}",
            "profile": profile,
            "zones_count": len(new_zones),
            "zones": list(new_zones.keys())
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})

@app.route('/save_results', methods=['POST'])
def save_results():
    """Guardar resultados en archivo JSON"""
    try:
        data = request.json
        
        # Crear directorio si no existe
        os.makedirs('results', exist_ok=True)
        
        # Guardar con timestamp
        filename = f"results/analysis_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        return jsonify({"success": True, "filename": filename})
    
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})

@app.route('/update_confidence', methods=['POST'])
def update_confidence():
    """Endpoint para probar diferentes niveles de confianza"""
    try:
        data = request.json
        new_confidence = float(data.get('confidence', 0.8))
        
        # Validar rango
        new_confidence = max(0.1, min(0.95, new_confidence))
        
        return jsonify({
            "success": True,
            "confidence": new_confidence,
            "message": f"Confianza actualizada a {new_confidence}"
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})

@app.route('/analyze_rtsp', methods=['POST'])
def analyze_rtsp():
    try:
        data = request.get_json(force=True, silent=True) or {}
        rtsp_url = data.get('rtsp_url', '').strip()
        if not rtsp_url:
            return jsonify({"success": False, "error": "Falta 'rtsp_url' en el payload"}), 400

        # Obtener perfil y distribución del request
        profile = data.get('profile', 'qc_recepcion')
        distribucion = data.get('distribucion', 'roja')
        
        # Cargar zonas dinámicamente según perfil y distribución
        zones = load_zones(profile, distribucion)
        if not zones:
            return jsonify({"success": False, "error": "No se pudieron cargar las zonas"})

        confidence = 0.8
        timeout_sec = float(data.get('timeout_sec', 12))  # subir timeout por redes Wi‑Fi
        warmup_frames = int(data.get('warmup_frames', 8))
        retries = int(data.get('retries', 2))
        use_gstreamer = bool(data.get('use_gstreamer', False))

        # Forzar transporte TCP y timeouts internos de FFmpeg (microsegundos)
        # stimeout: timeout de socket, max_delay: jitter buffer, buffer_size: tamaño de buffer
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|stimeout;20000000|max_delay;500000|buffer_size;102400"

        last_error = None
        img = None

        for attempt in range(retries + 1):
            print(f"📡 Intento {attempt+1}/{retries+1} conectando RTSP: {rtsp_url}")

            if use_gstreamer:
                # Pipeline GStreamer para RTSP H264 por TCP (requiere OpenCV con GStreamer)
                pipeline = (
                    f"rtspsrc location={rtsp_url} protocols=tcp ! "
                    "rtph264depay ! h264parse ! avdec_h264 ! videoconvert ! appsink drop=true sync=false"
                )
                cap = cv2.VideoCapture(pipeline, cv2.CAP_GSTREAMER)
            else:
                cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)

            if not cap.isOpened():
                last_error = "No se pudo abrir el stream RTSP"
                print(f"⚠️  {last_error}")
                time.sleep(1.0)
                continue

            # Reducir buffering si la implementación lo soporta
            try:
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            except Exception:
                pass

            start_time = time.time()
            frames_read = 0
            img = None

            while time.time() - start_time < timeout_sec:
                ok, frame = cap.read()
                if ok and frame is not None:
                    frames_read += 1
                    if frames_read >= warmup_frames:
                        img = frame
                        break
                else:
                    # Espera corta para no bloquear CPU
                    time.sleep(0.02)

            cap.release()

            if img is not None:
                break

            last_error = f"Timeout leyendo frame del RTSP (>{timeout_sec}s)"
            print(f"⚠️  {last_error}")
            time.sleep(1.0)

        if img is None:
            return jsonify({
                "success": False,
                "error": last_error or "No se pudo capturar frame del RTSP",
                "hints": [
                    "Verifica la URL y que el puerto 8554 esté accesible desde este host",
                    "Prueba en VLC/ffplay: usa transporte TCP",
                    "Si usas MediaMTX, valida que la ruta /cam1 exista y esté publicando",
                    "Puedes llamar con use_gstreamer=true si tienes GStreamer instalado"
                ]
            }), 504

        # Ejecutar el modelo
        results = model.predict(img, conf=confidence, verbose=False)

        zone_counts = {name: 0 for name in zones.keys()}
        total_detections = 0
        detections_by_zone = {}

        # Obtener dimensiones de la imagen RTSP
        img_height, img_width = img.shape[:2]
        img_size = (img_width, img_height)
        zones_reference_size = (1920, 1080)  # Tamaño de referencia para las zonas
        print(f"📐 Tamaño de imagen RTSP: {img_width}x{img_height}")
        print(f"📏 Tamaño de referencia de zonas: {zones_reference_size}")

        # Escalar zonas para el dibujo
        scaled_zones_for_drawing = scale_zones_to_image(zones, zones_reference_size, img_size)
 
        if len(results[0].boxes) > 0:
            # Filtrar detecciones duplicadas
            filtered_boxes = remove_duplicate_detections(results[0].boxes, min_distance=50)
            print(f"🔄 Detecciones RTSP después de filtrar duplicados: {len(filtered_boxes)}")
            
            for i, box in enumerate(filtered_boxes):
                try:
                    bbox = box.xyxy[0].tolist()
                    conf_score = float(box.conf[0])
                    if conf_score < confidence:
                        continue
                    # Determinar zona usando escalado apropiado
                    zone_name = assign_zone(bbox, zones, img_size, zones_reference_size)
                    if zone_name == "Sin clasificar":
                        continue
                    zone_counts[zone_name] += 1
                    if zone_name not in detections_by_zone:
                        detections_by_zone[zone_name] = []
                    detections_by_zone[zone_name].append({"bbox": bbox, "conf": conf_score})
                    total_detections += 1
                except Exception as e:
                    print(f"❌ Error procesando detección {i}: {e}")
                    continue
            
            # Usar las detecciones filtradas para el dibujo
            results[0].boxes = filtered_boxes

        processed_img = draw_zones_and_detections(
            img.copy(),
            results[0].boxes,
            scaled_zones_for_drawing,
            confidence_threshold=confidence
        )

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        processed_filename = f"analysis_{timestamp}_rtsp_conf80.jpg"
        processed_path = os.path.join("static", processed_filename)
        cv2.imwrite(processed_path, processed_img)

        filtered_results = {k: v for k, v in zone_counts.items() if v > 0}

        return jsonify({
            "success": True,
            "results": filtered_results,
            "total_cherries": total_detections,
            "confidence_used": confidence,
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "zones_loaded": len(zones),
            "processed_image": f"/static/{processed_filename}",
            "detections_by_zone": detections_by_zone
        })

    except Exception as e:
        print(f"❌ Error en análisis RTSP: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)})

if __name__ == '__main__':
    print("🚀 Iniciando servidor RancoQC...")
    # Nota: las zonas se cargan dinámicamente ahora
    print("🌐 Accede a: http://localhost:5001")
    
    # Verificar que el modelo existe
    if os.path.exists(MODEL_PATH):
        print(f"✅ Modelo YOLO encontrado: {MODEL_PATH}")
    else:
        print(f"❌ Modelo YOLO NO encontrado: {MODEL_PATH}")
        print("   Por favor, coloca tu archivo best.pt en la carpeta del proyecto")
    
    app.run(debug=True, host='0.0.0.0', port=5001)
