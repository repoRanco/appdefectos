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
from dotenv import load_dotenv

# Importar funciones de base de datos
from database import (
    create_tables, test_db_connection, save_analysis_result, 
    get_analysis_history, sync_pending_data, save_to_local_cache,
    get_local_history, DB_AVAILABLE
)

# Cargar variables de entorno
load_dotenv()

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

@app.route('/history')
def history():
    """Página de historial"""
    return send_from_directory('../frontend/src/components', 'history.html')

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
        
        # Preparar datos para guardar en base de datos
        analysis_data = {
            "source_type": "uploaded_file",
            "source_name": file.filename,
            "confidence_used": confidence
        }
        
        form_data = {
            "user": request.form.get('user', 'Unknown'),
            "profile": profile,
            "distribucion": distribucion,
            "analysis_type": profile.replace('_', '-'),
            "guia_sii": request.form.get('guia_sii', ''),
            "lote": request.form.get('lote', ''),
            "num_frutos": int(request.form.get('num_frutos', 0)),
            "num_proceso": request.form.get('num_proceso'),
            "id_caja": request.form.get('id_caja')
        }
        
        results_data = {
            "results": filtered_results,
            "total_cherries": total_detections,
            "confidence_used": confidence,
            "zones_loaded": len(zones),
            "processed_image": f"/static/{processed_filename}",
            "detections_by_zone": detections_by_zone,
            "image_size": f"{img_width}x{img_height}",
            "zones_available": list(zones.keys())
        }
        
        # Guardar en base de datos (PostgreSQL o local)
        try:
            analysis_id, saved_to_main_db = save_analysis_result(analysis_data, form_data, results_data)
            db_status = "saved_to_postgresql" if saved_to_main_db else "saved_to_local_cache"
            print(f"✅ Análisis guardado: {db_status}, ID: {analysis_id}")
        except Exception as e:
            print(f"⚠️ Error guardando análisis: {e}")
            analysis_id = None
            db_status = "save_failed"

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
            "zones_available": list(zones.keys()),
            "analysis_id": analysis_id,
            "database_status": db_status,
            "db_connected": DB_AVAILABLE
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

@app.route('/capture_local_camera', methods=['POST'])
def capture_local_camera():
    """Endpoint para capturar foto desde cámara local y analizarla inmediatamente"""
    try:
        data = request.get_json(force=True, silent=True) or {}
        
        # Obtener perfil y distribución del request
        profile = data.get('profile', 'qc_recepcion')
        distribucion = data.get('distribucion', 'roja')
        camera_type = data.get('camera_type', 'usb')  # 'usb' o 'raspberry'
        camera_index = int(data.get('camera_index', 0))  # Índice de cámara (0 = predeterminada)
        
        # Cargar zonas dinámicamente según perfil y distribución
        zones = load_zones(profile, distribucion)
        if not zones:
            return jsonify({"success": False, "error": "No se pudieron cargar las zonas"})

        print(f"📷 Capturando desde cámara {camera_type} índice: {camera_index}")
        
        frame = None
        
        # Intentar captura con Raspberry Pi Camera Module primero
        if camera_type == 'raspberry':
            try:
                print("🍓 Intentando captura con Raspberry Pi Camera Module...")
                
                # Método 1: Usar libcamera-still (Raspberry Pi OS Bullseye+)
                import subprocess
                import tempfile
                
                with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as temp_file:
                    temp_path = temp_file.name
                
                # Comando libcamera-still para Raspberry Pi Camera Module
                cmd = [
                    'libcamera-still',
                    '-o', temp_path,
                    '--width', '1920',
                    '--height', '1080',
                    '--timeout', '2000',  # 2 segundos timeout
                    '--nopreview',
                    '--immediate'
                ]
                
                    try:
                        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
                        if result.returncode == 0:
                            # Leer imagen capturada
                            frame = cv2.imread(temp_path)
                            if frame is not None:
                                print("✅ Captura exitosa con libcamera-still")
                            os.unlink(temp_path)  # Eliminar archivo temporal
                        else:
                            print(f"⚠️ libcamera-still falló: {result.stderr}")
                            print("ℹ️ Intentando captura con OpenCV como alternativa...")
                    except subprocess.TimeoutExpired:
                        print("⚠️ Timeout en libcamera-still")
                        print("ℹ️ Intentando captura con OpenCV como alternativa...")
                    except FileNotFoundError:
                        print("⚠️ libcamera-still no encontrado")
                        print("ℹ️ libcamera-apps no está instalado. Instala con: sudo apt install libcamera-apps")
                        print("ℹ️ Intentando captura con OpenCV como alternativa...")
                
                # Método 2: Intentar con raspistill (Raspberry Pi OS Legacy)
                if frame is None:
                    print("🔄 Intentando con raspistill...")
                    cmd = [
                        'raspistill',
                        '-o', temp_path,
                        '-w', '1920',
                        '-h', '1080',
                        '-t', '2000',  # 2 segundos timeout
                        '-n',  # No preview
                        '--immediate'
                    ]
                    
                    try:
                        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
                        if result.returncode == 0:
                            frame = cv2.imread(temp_path)
                            if frame is not None:
                                print("✅ Captura exitosa con raspistill")
                            os.unlink(temp_path)
                        else:
                            print(f"⚠️ raspistill falló: {result.stderr}")
                            print("ℹ️ Continuando con OpenCV...")
                    except subprocess.TimeoutExpired:
                        print("⚠️ Timeout en raspistill")
                        print("ℹ️ Continuando con OpenCV...")
                    except FileNotFoundError:
                        print("⚠️ raspistill no encontrado")
                        print("ℹ️ Continuando con OpenCV...")
                
            except Exception as e:
                print(f"⚠️ Error en captura Raspberry Pi: {e}")
        
        # Si no se pudo capturar con Raspberry Pi o es cámara USB, usar OpenCV
        if frame is None:
            print("🔄 Intentando captura con OpenCV...")
            
            # Si camera_type es raspberry, forzar índice 0
            opencv_index = 0 if camera_type == 'raspberry' else camera_index
            
            # Intentar abrir cámara local con OpenCV
            cap = cv2.VideoCapture(opencv_index)
            
            if not cap.isOpened():
                # Intentar con diferentes índices si el especificado falla
                print(f"⚠️ No se pudo abrir cámara en índice {opencv_index}, probando otros...")
                found_camera = False
                for i in range(3):  # Probar índices 0, 1, 2
                    if i == opencv_index:
                        continue  # Ya probamos este
                    cap = cv2.VideoCapture(i)
                    if cap.isOpened():
                        opencv_index = i
                        camera_index = i
                        print(f"✅ Cámara OpenCV encontrada en índice: {i}")
                        found_camera = True
                        break
                    cap.release()
                
                if not found_camera:
                    return jsonify({
                        "success": False,
                        "error": "No se pudo acceder a ninguna cámara",
                        "suggestions": [
                            "Para Raspberry Pi: Verifica que la cámara esté habilitada con 'sudo raspi-config'",
                            "Para Raspberry Pi: Instala libcamera-tools: 'sudo apt install libcamera-apps'",
                            "Para Raspberry Pi: Ejecuta: sudo bash install_libcamera.sh",
                            "Para USB: Verifica que la cámara esté conectada",
                            "Asegúrate de que no esté siendo usada por otra aplicación",
                            "Ejecuta: ls /dev/video* para ver cámaras disponibles"
                        ]
                    })
            
            # Configurar resolución de cámara
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
            
            # Capturar frame
            ret, frame = cap.read()
            cap.release()
            
            if not ret or frame is None:
                return jsonify({
                    "success": False,
                    "error": "No se pudo capturar imagen de la cámara",
                    "suggestions": [
                        "Verifica que la cámara esté funcionando correctamente",
                        "Para Raspberry Pi: Prueba 'libcamera-hello' para verificar la cámara",
                        "Prueba cerrar otras aplicaciones que puedan estar usando la cámara"
                    ]
                })
            
            print("✅ Captura exitosa con OpenCV")
        
        print(f"📐 Imagen capturada: {frame.shape[1]}x{frame.shape[0]}")
        
        # Procesar imagen igual que en analyze_cherries
        confidence = 0.8
        results = model.predict(frame, conf=confidence, verbose=False)
        
        zone_counts = {name: 0 for name in zones.keys()}
        total_detections = 0
        detections_by_zone = {}
        
        # Obtener dimensiones de la imagen
        img_height, img_width = frame.shape[:2]
        img_size = (img_width, img_height)
        zones_reference_size = (1920, 1080)
        
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
                        continue
                    
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
        
        # Dibujar zonas y detecciones
        processed_img = draw_zones_and_detections(
            frame.copy(),
            results[0].boxes,
            scaled_zones_for_drawing,
            confidence_threshold=confidence
        )
        
        # Guardar imagen procesada
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        processed_filename = f"analysis_{timestamp}_local_camera_conf80.jpg"
        processed_path = os.path.join("static", processed_filename)
        cv2.imwrite(processed_path, processed_img)
        
        # Filtrar solo zonas con detecciones > 0
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
            "zones_available": list(zones.keys()),
            "camera_used": camera_index
        })
        
    except Exception as e:
        print(f"❌ Error en captura de cámara local: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)})

@app.route('/test_rtsp', methods=['POST'])
def test_rtsp():
    """Endpoint para probar conectividad RTSP sin análisis"""
    try:
        data = request.get_json(force=True, silent=True) or {}
        rtsp_url = data.get('rtsp_url', '').strip()
        if not rtsp_url:
            return jsonify({"success": False, "error": "Falta 'rtsp_url' en el payload"}), 400

        print(f"🔍 Probando conectividad RTSP: {rtsp_url}")
        
        # Configurar opciones más agresivas para test
        ffmpeg_options = [
            "rtsp_transport;tcp",
            "stimeout;5000000",            # 5 segundos timeout para test
            "max_delay;100000",            # Buffer mínimo
            "buffer_size;16384",           # Buffer muy pequeño
            "analyzeduration;500000",      # 0.5 segundos análisis
            "probesize;16384",             # Probe size mínimo
            "fflags;nobuffer"
        ]
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "|".join(ffmpeg_options)
        
        # Intentar conexión rápida
        cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
        
        if not cap.isOpened():
            return jsonify({
                "success": False,
                "error": "No se pudo conectar al stream RTSP",
                "diagnostics": {
                    "url": rtsp_url,
                    "connection": "failed",
                    "suggestions": [
                        "Verifica que la URL sea correcta",
                        "Confirma que el puerto 8554 esté abierto",
                        "Prueba la URL en VLC primero",
                        "Verifica que la cámara esté transmitiendo"
                    ]
                }
            })
        
        # Intentar leer un frame
        start_time = time.time()
        frame_captured = False
        frame_info = {}
        
        for i in range(10):  # Máximo 10 intentos
            ret, frame = cap.read()
            if ret and frame is not None:
                frame_captured = True
                h, w = frame.shape[:2]
                frame_info = {
                    "width": w,
                    "height": h,
                    "channels": frame.shape[2] if len(frame.shape) > 2 else 1,
                    "size_mb": (frame.nbytes / 1024 / 1024)
                }
                break
            time.sleep(0.1)
        
        cap.release()
        connection_time = time.time() - start_time
        
        if frame_captured:
            return jsonify({
                "success": True,
                "message": "Conexión RTSP exitosa",
                "diagnostics": {
                    "url": rtsp_url,
                    "connection": "success",
                    "connection_time": f"{connection_time:.2f}s",
                    "frame_info": frame_info,
                    "status": "ready_for_analysis"
                }
            })
        else:
            return jsonify({
                "success": False,
                "error": "Conexión establecida pero no se pudo capturar frame",
                "diagnostics": {
                    "url": rtsp_url,
                    "connection": "partial",
                    "connection_time": f"{connection_time:.2f}s",
                    "suggestions": [
                        "La cámara puede estar configurada pero no transmitiendo",
                        "Verifica el codec de video (H.264 recomendado)",
                        "Prueba reducir la resolución de la cámara"
                    ]
                }
            })
            
    except Exception as e:
        return jsonify({
            "success": False,
            "error": f"Error en test RTSP: {str(e)}",
            "diagnostics": {
                "url": rtsp_url if 'rtsp_url' in locals() else "unknown",
                "connection": "error",
                "suggestions": [
                    "Verifica la conectividad de red",
                    "Confirma que el servidor RTSP esté ejecutándose",
                    "Prueba con una herramienta externa como VLC"
                ]
            }
        })

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
        
        # Parámetros para manejar cámaras de alta resolución
        max_resolution = data.get('max_resolution', '1920x1080')  # Resolución máxima deseada
        auto_resize = data.get('auto_resize', True)  # Auto-redimensionar para cámaras de alta resolución

        # Configurar opciones de FFmpeg para RTSP con manejo robusto de errores H.264
        # Opciones específicas para manejar corrupción de stream y errores de decodificación
        ffmpeg_options = [
            "rtsp_transport;tcp",           # Forzar TCP para evitar pérdida de paquetes UDP
            "stimeout;15000000",           # 15 segundos timeout (aumentado para streams problemáticos)
            "max_delay;1000000",           # 1 segundo jitter buffer (aumentado)
            "buffer_size;65536",           # Buffer más grande para manejar variaciones
            "analyzeduration;2000000",     # 2 segundos análisis (más tiempo para streams corruptos)
            "probesize;65536",             # Probe size más grande
            "fflags;nobuffer+discardcorrupt", # Sin buffering + descartar frames corruptos
            "flags;low_delay",             # Baja latencia
            "err_detect;ignore_err",       # Ignorar errores menores de decodificación
            "skip_frame;nokey"             # Saltar frames no-key si hay problemas
        ]
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "|".join(ffmpeg_options)

        last_error = None
        img = None

        # Configuraciones progresivamente más tolerantes para streams problemáticos
        rtsp_configs = [
            {
                "name": "Configuración Estándar",
                "options": [
                    "rtsp_transport;tcp",
                    "stimeout;15000000",
                    "max_delay;1000000",
                    "buffer_size;65536",
                    "analyzeduration;2000000",
                    "probesize;65536",
                    "fflags;nobuffer+discardcorrupt",
                    "flags;low_delay",
                    "err_detect;ignore_err"
                ]
            },
            {
                "name": "Configuración Tolerante",
                "options": [
                    "rtsp_transport;tcp",
                    "stimeout;20000000",
                    "max_delay;2000000",
                    "buffer_size;131072",
                    "analyzeduration;3000000",
                    "probesize;131072",
                    "fflags;nobuffer+discardcorrupt+genpts",
                    "flags;low_delay",
                    "err_detect;ignore_err+crccheck",
                    "skip_frame;nokey"
                ]
            },
            {
                "name": "Configuración Robusta",
                "options": [
                    "rtsp_transport;tcp",
                    "stimeout;30000000",
                    "max_delay;5000000",
                    "buffer_size;262144",
                    "analyzeduration;5000000",
                    "probesize;262144",
                    "fflags;nobuffer+discardcorrupt+genpts+igndts",
                    "flags;low_delay+global_header",
                    "err_detect;ignore_err+crccheck+bitstream",
                    "skip_frame;nokey",
                    "thread_type;frame"
                ]
            }
        ]

        for attempt in range(retries + 1):
            print(f"📡 Intento {attempt+1}/{retries+1} conectando RTSP: {rtsp_url}")
            
            # Usar configuración progresivamente más tolerante
            config_index = min(attempt, len(rtsp_configs) - 1)
            current_config = rtsp_configs[config_index]
            
            print(f"🔧 Usando {current_config['name']}")
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "|".join(current_config['options'])

            if use_gstreamer:
                # Pipeline GStreamer para RTSP H264 por TCP (requiere OpenCV con GStreamer)
                pipeline = (
                    f"rtspsrc location={rtsp_url} protocols=tcp latency=0 ! "
                    "rtph264depay ! h264parse config-interval=-1 ! "
                    "avdec_h264 skip-frame=1 ! videoconvert ! "
                    "appsink drop=true sync=false max-buffers=1"
                )
                cap = cv2.VideoCapture(pipeline, cv2.CAP_GSTREAMER)
            else:
                cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)

            if not cap.isOpened():
                last_error = "No se pudo abrir el stream RTSP"
                print(f"⚠️  {last_error}")
                time.sleep(2.0)  # Espera más larga entre intentos
                continue

            # Configurar resolución si es posible (para cámaras de alta resolución)
            if auto_resize and max_resolution:
                try:
                    max_width, max_height = map(int, max_resolution.split('x'))
                    cap.set(cv2.CAP_PROP_FRAME_WIDTH, max_width)
                    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, max_height)
                    print(f"🎥 Configurando resolución RTSP a: {max_width}x{max_height}")
                except Exception as e:
                    print(f"⚠️ No se pudo configurar resolución: {e}")

            # Configuraciones adicionales para manejar streams corruptos
            try:
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                cap.set(cv2.CAP_PROP_FPS, 15)  # Limitar FPS para reducir carga
            except Exception:
                pass

            start_time = time.time()
            frames_read = 0
            valid_frames = 0
            img = None

            # Intentar capturar múltiples frames y usar el mejor
            while time.time() - start_time < timeout_sec:
                try:
                    ok, frame = cap.read()
                    if ok and frame is not None:
                        frames_read += 1
                        
                        # Validar que el frame no esté completamente corrupto
                        if frame.shape[0] > 100 and frame.shape[1] > 100:  # Tamaño mínimo razonable
                            # Verificar que no sea completamente negro o blanco
                            mean_val = np.mean(frame)
                            if 10 < mean_val < 245:  # Rango razonable de intensidad
                                valid_frames += 1
                                img = frame
                                
                                # Si tenemos suficientes frames válidos, usar este
                                if valid_frames >= max(1, warmup_frames // 2):
                                    print(f"✅ Frame válido capturado (intento {valid_frames})")
                                    break
                        
                        # Si hemos leído muchos frames sin éxito, continuar
                        if frames_read > warmup_frames * 2:
                            break
                            
                except Exception as frame_error:
                    print(f"⚠️ Error leyendo frame: {frame_error}")
                    time.sleep(0.05)
                    continue
                
                # Espera corta para no bloquear CPU
                time.sleep(0.02)

            cap.release()

            if img is not None and valid_frames > 0:
                print(f"✅ Captura exitosa con {current_config['name']} ({valid_frames} frames válidos)")
                break

            last_error = f"Timeout o frames corruptos en RTSP (>{timeout_sec}s, {valid_frames} frames válidos)"
            print(f"⚠️  {last_error}")
            time.sleep(2.0)

        if img is None:
            return jsonify({
                "success": False,
                "error": last_error or "No se pudo capturar frame del RTSP",
                "hints": [
                    "Verifica la URL y que el puerto 8554 esté accesible desde este host",
                    "Prueba en VLC/ffplay: usa transporte TCP",
                    "Si usas MediaMTX, valida que la ruta /cam1 exista y esté publicando",
                    "Puedes llamar con use_gstreamer=true si tienes GStreamer instalado",
                    "Para cámaras de 12MP, usa max_resolution='1920x1080' para mejor rendimiento"
                ]
            }), 504

        # Obtener dimensiones originales
        original_height, original_width = img.shape[:2]
        print(f"📐 Imagen RTSP original: {original_width}x{original_height}")
        
        # Auto-redimensionar si la imagen es demasiado grande (cámaras de alta resolución)
        if auto_resize and max_resolution:
            max_width, max_height = map(int, max_resolution.split('x'))
            
            # Si la imagen es significativamente más grande que la resolución máxima
            if original_width > max_width * 1.5 or original_height > max_height * 1.5:
                print(f"🔄 Redimensionando imagen de alta resolución: {original_width}x{original_height} -> {max_width}x{max_height}")
                
                # Calcular ratio manteniendo aspecto
                ratio = min(max_width / original_width, max_height / original_height)
                new_width = int(original_width * ratio)
                new_height = int(original_height * ratio)
                
                img = cv2.resize(img, (new_width, new_height), interpolation=cv2.INTER_AREA)
                print(f"✅ Imagen redimensionada a: {new_width}x{new_height}")

        # Guardar imagen original capturada (sin procesamiento)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        original_filename = f"capture_{timestamp}_rtsp_original.jpg"
        original_path = os.path.join("static", original_filename)
        cv2.imwrite(original_path, img)
        print(f"📁 Imagen original RTSP guardada: {original_path}")

        # Ejecutar el modelo
        results = model.predict(img, conf=confidence, verbose=False)

        zone_counts = {name: 0 for name in zones.keys()}
        total_detections = 0
        detections_by_zone = {}

        # Obtener dimensiones de la imagen RTSP
        img_height, img_width = img.shape[:2]
        img_size = (img_width, img_height)
        
        # Las zonas fueron creadas en una imagen de 1280x720, usar esto como referencia
        zones_reference_size = (1280, 720)  # Tamaño real donde se crearon las zonas
        
        # Calcular el factor de escala basado en el tamaño real de referencia
        scale_factor_x = img_width / 1280
        scale_factor_y = img_height / 720
        avg_scale_factor = (scale_factor_x + scale_factor_y) / 2
        
        print(f"📐 Tamaño de imagen RTSP: {img_width}x{img_height}")
        print(f"📏 Tamaño de referencia de zonas: {zones_reference_size}")
        print(f"📏 Factor de escala promedio: {avg_scale_factor:.2f}")
        
        # Siempre escalar las zonas desde 1280x720 al tamaño actual de la imagen
        if abs(avg_scale_factor - 1.0) > 0.1:  # Si hay diferencia significativa
            scaled_zones_for_drawing = scale_zones_to_image(zones, zones_reference_size, img_size)
            print(f"🔄 Escalando zonas desde {zones_reference_size} a {img_size}")
            print(f"📏 Factores de escala: X={scale_factor_x:.3f}, Y={scale_factor_y:.3f}")
        else:
            # La imagen tiene un tamaño muy similar a 1280x720, usar zonas sin escalar
            scaled_zones_for_drawing = zones
            print(f"✅ Tamaño similar a referencia (1280x720), usando zonas sin escalar")
 
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

        # Guardar imagen procesada (con análisis)
        processed_filename = f"analysis_{timestamp}_rtsp_conf80.jpg"
        processed_path = os.path.join("static", processed_filename)
        cv2.imwrite(processed_path, processed_img)
        print(f"📁 Imagen procesada RTSP guardada: {processed_path}")

        filtered_results = {k: v for k, v in zone_counts.items() if v > 0}

        return jsonify({
            "success": True,
            "results": filtered_results,
            "total_cherries": total_detections,
            "confidence_used": confidence,
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "zones_loaded": len(zones),
            "processed_image": f"/static/{processed_filename}",
            "original_image": f"/static/{original_filename}",
            "detections_by_zone": detections_by_zone
        })

    except Exception as e:
        print(f"❌ Error en análisis RTSP: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)})

# Nuevos endpoints para base de datos e historial
@app.route('/get_analysis_history', methods=['GET'])
def get_analysis_history_endpoint():
    """Obtener historial de análisis"""
    try:
        limit = int(request.args.get('limit', 50))
        user_name = request.args.get('user_name')
        analysis_type = request.args.get('analysis_type')
        
        history = get_analysis_history(limit, user_name, analysis_type)
        
        return jsonify({
            "success": True,
            "history": history,
            "count": len(history),
            "db_connected": DB_AVAILABLE
        })
        
    except Exception as e:
        print(f"❌ Error obteniendo historial: {e}")
        return jsonify({"success": False, "error": str(e)})

@app.route('/sync_pending_data', methods=['POST'])
def sync_pending_data_endpoint():
    """Sincronizar datos pendientes del caché local a PostgreSQL"""
    try:
        user_name = request.json.get('user_name') if request.json else None
        
        result = sync_pending_data()
        
        return jsonify({
            "success": True,
            "sync_result": result,
            "db_connected": DB_AVAILABLE
        })
        
    except Exception as e:
        print(f"❌ Error en sincronización: {e}")
        return jsonify({"success": False, "error": str(e)})

@app.route('/get_local_history', methods=['GET'])
def get_local_history_endpoint():
    """Obtener historial del caché local"""
    try:
        limit = int(request.args.get('limit', 50))
        
        history = get_local_history(limit)
        
        return jsonify({
            "success": True,
            "history": history,
            "count": len(history),
            "source": "local_cache"
        })
        
    except Exception as e:
        print(f"❌ Error obteniendo historial local: {e}")
        return jsonify({"success": False, "error": str(e)})

@app.route('/database_status', methods=['GET'])
def database_status():
    """Verificar estado de conexión a la base de datos"""
    try:
        connection_ok, message = test_db_connection()
        
        return jsonify({
            "success": True,
            "db_connected": connection_ok,
            "connection_message": message,
            "db_available": DB_AVAILABLE
        })
        
    except Exception as e:
        print(f"❌ Error verificando estado de base de datos: {e}")
        return jsonify({
            "success": False,
            "error": str(e),
            "db_connected": False,
            "db_available": DB_AVAILABLE
        })

@app.route('/clear_local_cache', methods=['POST'])
def clear_local_cache():
    """Limpiar caché local (solo registros sincronizados)"""
    try:
        from database import get_local_session, LocalCache
        
        local_db = get_local_session()
        
        # Solo eliminar registros que ya fueron sincronizados
        synced_records = local_db.query(LocalCache)\
            .filter(LocalCache.status == 'synced')\
            .all()
        
        count = len(synced_records)
        
        for record in synced_records:
            local_db.delete(record)
        
        local_db.commit()
        local_db.close()
        
        return jsonify({
            "success": True,
            "message": f"Se eliminaron {count} registros sincronizados del caché local"
        })
        
    except Exception as e:
        print(f"❌ Error limpiando caché local: {e}")
        return jsonify({"success": False, "error": str(e)})

@app.route('/force_upload_analysis', methods=['POST'])
def force_upload_analysis():
    """Forzar subida de análisis a PostgreSQL desde el frontend"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({"success": False, "error": "No se enviaron datos"})
        
        analysis_data = data.get('analysis_data', {})
        form_data = data.get('form_data', {})
        results_data = data.get('results_data', {})
        
        # Guardar directamente en PostgreSQL
        analysis_id, success = save_analysis_result(analysis_data, form_data, results_data)
        
        if success:
            return jsonify({
                "success": True,
                "analysis_id": analysis_id,
                "message": "Análisis subido exitosamente a PostgreSQL"
            })
        else:
            return jsonify({
                "success": False,
                "error": "No se pudo subir a PostgreSQL, guardado en caché local",
                "cache_id": analysis_id
            })
            
    except Exception as e:
        print(f"❌ Error en forzar subida: {e}")
        return jsonify({"success": False, "error": str(e)})

@app.route('/save_to_cache', methods=['POST'])
def save_to_cache_endpoint():
    """Guardar análisis específicamente en caché local"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({"success": False, "error": "No se enviaron datos"})
        
        analysis_data = data.get('analysis_data', {})
        form_data = data.get('form_data', {})
        results_data = data.get('results_data', {})
        
        # Guardar solo en caché local
        cache_id, success = save_to_local_cache(analysis_data, form_data, results_data)
        
        if cache_id:
            return jsonify({
                "success": True,
                "cache_id": cache_id,
                "message": "Análisis guardado en caché local para sincronización posterior"
            })
        else:
            return jsonify({
                "success": False,
                "error": "No se pudo guardar en caché local"
            })
            
    except Exception as e:
        print(f"❌ Error guardando en caché: {e}")
        return jsonify({"success": False, "error": str(e)})

if __name__ == '__main__':
    print("🚀 Iniciando servidor RancoQC...")
    
    # Inicializar base de datos
    try:
        create_tables()
        connection_ok, message = test_db_connection()
        if connection_ok:
            print(f"✅ Base de datos conectada: {message}")
        else:
            print(f"⚠️ Base de datos: {message}")
            print("📁 Usando SQLite local como fallback")
    except Exception as e:
        print(f"⚠️ Error inicializando base de datos: {e}")
        print("📁 Continuando con SQLite local")
    
    # Nota: las zonas se cargan dinámicamente ahora
    print("🌐 Accede a: http://localhost:5001")
    
    # Verificar que el modelo existe
    if os.path.exists(MODEL_PATH):
        print(f"✅ Modelo YOLO encontrado: {MODEL_PATH}")
    else:
        print(f"❌ Modelo YOLO NO encontrado: {MODEL_PATH}")
        print("   Por favor, coloca tu archivo best.pt en la carpeta del proyecto")
    
    app.run(debug=True, host='0.0.0.0', port=5001)
