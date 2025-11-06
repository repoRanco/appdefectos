import cv2
import json
import numpy as np
from pathlib import Path
import argparse

# ---- CONFIG: define la rejilla por bandeja ----
# Notas: El flujo de bandejas (verde) ha sido deshabilitado. Solo se usarán zonas nombradas (naranjas).

REF_IMAGE = "backend/static/capture_20251106_144414_rtsp_original.jpg"
OUT_JSON  = "zonas.json"
OUT_PREVIEW = "zones_preview.png"

points_per_tray = {}  # se llenará con 4 puntos por bandeja

def point_in_poly(pt, poly):
    """Devuelve True si el punto (x,y) está dentro del polígono poly."""
    contour = np.array(poly, dtype=np.int32)
    return cv2.pointPolygonTest(contour, (float(pt[0]), float(pt[1])), False) >= 0

def poly_centroid(poly):
    """Centroid aproximado para ubicar la etiqueta."""
    arr = np.array(poly, dtype=np.float32)
    c = arr.mean(axis=0)
    return int(c[0]), int(c[1])

def click_points(img, tray_name):
    clone = img.copy()
    pts = []

    def mouse(event, x, y, flags, param):
        nonlocal pts
        if event == cv2.EVENT_LBUTTONDOWN and len(pts) < 4:
            pts.append([x, y])
            cv2.circle(clone, (x, y), 5, (0, 255, 0), -1)
            cv2.putText(clone, str(len(pts)), (x+6, y-6), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0,255,0), 2)
            cv2.imshow("Calibrar - " + tray_name, clone)

    cv2.imshow("Calibrar - " + tray_name, clone)
    cv2.setMouseCallback("Calibrar - " + tray_name, mouse)
    print(f"[{tray_name}] Haz CLICK en 4 esquinas: sup-izq, sup-der, inf-der, inf-izq")
    while True:
        key = cv2.waitKey(1) & 0xFF
        if len(pts) == 4:
            break
        if key == 27:  # ESC para cancelar
            pts = []
            break
    cv2.destroyWindow("Calibrar - " + tray_name)
    return pts

def grid_polygons_from_corners(corners, rows, cols):
    """
    corners: 4 puntos [x,y] en orden: TL, TR, BR, BL
    Retorna lista de celdas como polígonos (4 vértices) fila por fila.
    """
    TL, TR, BR, BL = [np.array(p, dtype=np.float32) for p in corners]
    # Interpolación bilineal de la cuadrícula
    polys = []
    for r in range(rows):
        ty = r / rows
        ty2 = (r + 1) / rows
        left_top    = TL + (BL - TL) * ty
        right_top   = TR + (BR - TR) * ty
        left_bottom = TL + (BL - TL) * ty2
        right_bottom= TR + (BR - TR) * ty2
        for c in range(cols):
            tx = c / cols
            tx2 = (c + 1) / cols
            p00 = left_top    + (right_top    - left_top)    * tx
            p01 = left_top    + (right_top    - left_top)    * tx2
            p10 = left_bottom + (right_bottom - left_bottom) * tx
            p11 = left_bottom + (right_bottom - left_bottom) * tx2
            poly = np.stack([p00, p01, p11, p10], axis=0).astype(float).tolist()
            polys.append(poly)
    return polys

def draw_named_zones(img, named_zones):
    vis = img.copy()
    for z in named_zones:
        poly = z.get("poly", [])
        name = z.get("name", "")
        if not poly:
            continue
        cnt = np.array(poly, dtype=np.int32)
        cv2.polylines(vis, [cnt], True, (0, 140, 255), 2)
        cx, cy = poly_centroid(poly)
        label = name if name else "zona"
        cv2.putText(vis, label, (cx + 5, cy - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0,140,255), 2)
    return vis

def named_zones_ui(base_img, existing_named):
    """UI para crear zonas libres (4 puntos) y nombrarlas.
    Controles:
      - Click izq: agregar punto al polígono actual
      - ENTER/SPACE: si hay >=4 puntos, cerrar polígono (toma los primeros 4) y pedir nombre
      - z: deshacer último punto
      - r: reset del polígono actual
      - q/ESC: salir y devolver las zonas
    Muestra también las zonas ya existentes y las que se vayan creando.
    """
    zones = list(existing_named) if existing_named else []
    tmp_points = []
    win = "Zonas nombradas (4 esquinas)"

    def current_preview():
        vis = base_img.copy()
        # dibujar zonas existentes
        for z in zones:
            cnt = np.array(z["poly"], dtype=np.int32)
            cv2.polylines(vis, [cnt], True, (0, 140, 255), 2)
            cx, cy = poly_centroid(z["poly"]) 
            cv2.putText(vis, z.get("name", "zona"), (cx+5, cy-5), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0,140,255), 2)
        # dibujar polígono en curso
        if len(tmp_points) > 0:
            pts = np.array(tmp_points, dtype=np.int32)
            cv2.polylines(vis, [pts], False, (255, 0, 0), 2)
            for i, (x, y) in enumerate(tmp_points):
                cv2.circle(vis, (x, y), 4, (255, 0, 0), -1)
                cv2.putText(vis, str(i+1), (x+6, y-6), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255,0,0), 1)
        # leyenda
        
        return vis

    def on_mouse(event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN:
            tmp_points.append((x, y))
            cv2.imshow(win, current_preview())

    cv2.imshow(win, current_preview())
    cv2.setMouseCallback(win, on_mouse)
    print("god")

    while True:
        cv2.imshow(win, current_preview())
        k = cv2.waitKey(10) & 0xFF
        if k in (ord('q'), 27):
            break
        elif k == ord('z'):
            if tmp_points:
                tmp_points.pop()
        elif k == ord('r'):
            tmp_points = []
        elif k in (13, 32):
            if len(tmp_points) >= 4:
                poly = [list(map(float, p)) for p in tmp_points[:4]]
                try:
                    name = input("Nombre para esta zona (4 esquinas): ").strip()
                except EOFError:
                    name = ""
                if not name:
                    name = f"zona_{len(zones)+1}"
                zones.append({"name": name, "poly": poly})
                print(f"[Zonas libres] Zona '{name}' agregada.")
                tmp_points = []
    cv2.destroyWindow(win)
    return zones

def name_cells_ui(base_img, tray_name, cells):
    """Deshabilitado: flujo de celdas verdes no se usa más."""
    return [""] * len(cells)

def draw_preview_image(base_img, trays, named_zones):
    vis_all = base_img.copy()
    # Solo dibujar zonas libres nombradas (naranjas)
    for z in named_zones or []:
        poly = z.get("poly", [])
        name = z.get("name", "")
        if not poly:
            continue
        cnt = np.array(poly, dtype=np.int32)
        cv2.polylines(vis_all, [cnt], True, (0, 140, 255), 2)
        cx, cy = poly_centroid(poly)
        label = name if name else "zona"
        cv2.putText(vis_all, label, (cx + 5, cy - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0,140,255), 2)
    return vis_all

def main():
    parser = argparse.ArgumentParser(description="Calibrar zonas y/o asignar zonas libres nombradas")
    parser.add_argument("--named-only", action="store_true", help="(Por compatibilidad) Abre solo la UI de zonas nombradas")
    parser.add_argument("--preview-only", action="store_true", help="Generar solo la previsualización desde zones.json sin UI")
    args = parser.parse_args()

    if not Path(REF_IMAGE).exists():
        raise FileNotFoundError(f"No se encuentra {REF_IMAGE}")

    img = cv2.imread(REF_IMAGE)

    # Si existe un JSON previo, cargarlo para continuar donde se dejó
    existing_named = []
    existing_data = None
    if Path(OUT_JSON).exists():
        try:
            existing_data = json.loads(Path(OUT_JSON).read_text(encoding="utf-8"))
            if isinstance(existing_data, dict):
                existing_named = existing_data.get("named_zones", []) or []
        except Exception:
            existing_named = []

    # Solo previsualización (sin UI)
    if args.preview_only:
        vis_all = draw_preview_image(img, [], existing_named)
        try:
            img_path = Path(REF_IMAGE)
            out_name = img_path.with_suffix("")
            out_img_path = img_path.with_name(f"{out_name.name}_zones.png")
        except Exception:
            out_img_path = Path(OUT_PREVIEW)
        cv2.imwrite(str(out_img_path), vis_all)
        print(f"Previsualización guardada en {out_img_path}")
        return

    # Flujo por defecto y --named-only: solo zonas nombradas
    named_zones = named_zones_ui(img, existing_named)
    payload = {"named_zones": named_zones}
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    print(f"Zonas guardadas en {OUT_JSON}")

    # Guardar imagen de previsualización global con todas las zonas (solo naranjas)
    vis_all = draw_preview_image(img, [], named_zones)

    # Derivar nombre de salida a partir de la imagen si se desea
    try:
        img_path = Path(REF_IMAGE)
        out_name = img_path.with_suffix("")
        out_img_path = img_path.with_name(f"{out_name.name}_zones.png")
    except Exception:
        out_img_path = Path(OUT_PREVIEW)

    cv2.imwrite(str(out_img_path), vis_all)
    print(f"Previsualización guardada en {out_img_path}")

if __name__ == "__main__":
    main()
