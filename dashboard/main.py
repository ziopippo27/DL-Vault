from fastapi import FastAPI, Query, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
import sqlite3
from pathlib import Path
import os
import io
import traceback
try:
    from PIL import Image, ImageDraw
except ImportError:
    pass

HALCON_CLASS_COLORS = [
    '#e6194b', '#f58231', '#ffe119', '#3cb44b', '#42d4f4',
    '#4363d8', '#911eb4', '#f032e6', '#00f3ff', '#dcbeff',
    '#9a6324', '#aaffc3', '#808000', '#ffd8b1', '#000075'
]

_CLASS_COLOR_CACHE = {}

def get_class_color_hex(class_name, cursor):
    global _CLASS_COLOR_CACHE
    if not _CLASS_COLOR_CACHE:
        cursor.execute("SELECT DISTINCT class_name FROM bounding_boxes WHERE class_name IS NOT NULL AND class_name != '' ORDER BY class_name")
        all_classes = [r[0] for r in cursor.fetchall()]
        for i, c in enumerate(all_classes):
            _CLASS_COLOR_CACHE[c] = HALCON_CLASS_COLORS[i % len(HALCON_CLASS_COLORS)]
            
    return _CLASS_COLOR_CACHE.get(class_name, '#00f3ff')

def hex_to_rgba(hex_color, alpha=255):
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4)) + (alpha,)


app = FastAPI(title="Halcon Dataset Control Room")

class ExportFilterRequest(BaseModel):
    control_type: str | None = None
    machine_serials: list[str] | None = None
    format_type: list[str] | None = None

class GlobalSearchQuery(BaseModel):
    control_types: list[str] | None = None
    stations: list[str] | None = None
    machine_serials: list[str] | None = None
    format_types: list[str] | None = None
    classes: list[str] | None = None
    include_unlabeled: bool | None = False

# Configurazione percorsi
BASE_DIR = Path(__file__).parent.parent
DB_PATH = BASE_DIR / "halcon_dataset.db"
DATASET_DIR = BASE_DIR / "dataset_archive"
STATIC_DIR = Path(__file__).parent / "static"

# Assicuriamoci che le directory esistano
DATASET_DIR.mkdir(parents=True, exist_ok=True)
STATIC_DIR.mkdir(parents=True, exist_ok=True)

# Mount delle cartelle statiche
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
app.mount("/dataset", StaticFiles(directory=str(DATASET_DIR)), name="dataset")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

@app.get("/")
def read_root():
    """Restituisce la UI della Control Room."""
    return FileResponse(str(STATIC_DIR / "index.html"))

@app.get("/api/taxonomy")
def get_taxonomy():
    """
    Restituisce l'albero della tassonomia a 6 livelli.
    Costruisce una struttura annidata per facilitare l'interfaccia ad albero (Accordion).
    """
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT DISTINCT control_type, station, machine_serial, format_type, upload_date, folder_class
        FROM images
        WHERE control_type IS NOT NULL
        ORDER BY control_type, station, machine_serial, format_type, upload_date, folder_class
    """)
    rows = cursor.fetchall()
    conn.close()

    taxonomy_tree = {}
    
    for row in rows:
        c_type, stat, m_serial, f_type, u_date, f_class = row
        
        if c_type not in taxonomy_tree:
            taxonomy_tree[c_type] = {}
        if stat not in taxonomy_tree[c_type]:
            taxonomy_tree[c_type][stat] = {}
        if m_serial not in taxonomy_tree[c_type][stat]:
            taxonomy_tree[c_type][stat][m_serial] = {}
        if f_type not in taxonomy_tree[c_type][stat][m_serial]:
            taxonomy_tree[c_type][stat][m_serial][f_type] = {}
        if u_date not in taxonomy_tree[c_type][stat][m_serial][f_type]:
            taxonomy_tree[c_type][stat][m_serial][f_type][u_date] = []
            
        if f_class and f_class not in taxonomy_tree[c_type][stat][m_serial][f_type][u_date]:
            taxonomy_tree[c_type][stat][m_serial][f_type][u_date].append(f_class)

    return taxonomy_tree

@app.get("/api/images")
def get_images(
    control_type: str = Query(None),
    station: str = Query(None),
    machine_serial: str = Query(None),
    format_type: str = Query(None),
    upload_date: str = Query(None),
    folder_class: str = Query(None)
):
    """
    Restituisce le immagini filtrate in base ai parametri gerarchici forniti.
    Restituisce anche i metadati (width, height, detection_mode).
    """
    conn = get_db()
    cursor = conn.cursor()
    
    query = """
        SELECT id, file_name, folder_path, control_type, station, machine_serial, 
               format_type, upload_date, folder_class, detection_mode, 
               image_width, image_height
        FROM images
        WHERE 1=1
    """
    params = []
    
    if control_type:
        query += " AND control_type = ?"
        params.append(control_type)
    if station:
        query += " AND station = ?"
        params.append(station)
    if machine_serial:
        query += " AND machine_serial = ?"
        params.append(machine_serial)
    if format_type:
        query += " AND format_type = ?"
        params.append(format_type)
    if upload_date:
        query += " AND upload_date = ?"
        params.append(upload_date)
    if folder_class:
        query += " AND folder_class = ?"
        params.append(folder_class)
        
    query += " ORDER BY file_name ASC"
    
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    
    results = []
    for r in rows:
        # Costruiamo il percorso web mappato dalla mount '/dataset'
        # folder_path nel DB è un percorso assoluto o relativo.
        # Possiamo ricostruirlo dai 6 livelli per maggiore sicurezza,
        # dato che sappiamo la struttura esatta:
        rel_path = f"{r['control_type']}/{r['station']}/{r['machine_serial']}/{r['format_type']}/{r['upload_date']}/{r['folder_class']}/{r['file_name']}"
        web_url = f"/dataset/{rel_path}"
        
        img_width = r['image_width']
        img_height = r['image_height']
        
        if img_width is None or img_height is None:
            try:
                # Usa il percorso fisico partendo dalla folder_path registrata nel DB
                physical_path = Path(r['folder_path']) / r['file_name']
                if physical_path.exists():
                    with Image.open(physical_path) as tmp_img:
                        w, h = tmp_img.size
                        img_width = w if img_width is None else img_width
                        img_height = h if img_height is None else img_height
            except Exception:
                pass
        
        results.append({
            "id": r["id"],
            "file_name": r["file_name"],
            "url": web_url,
            "control_type": r["control_type"],
            "station": r["station"],
            "machine_serial": r["machine_serial"],
            "format_type": r["format_type"],
            "upload_date": r["upload_date"],
            "folder_class": r["folder_class"],
            "detection_mode": r["detection_mode"],
            "width": img_width,
            "height": img_height
        })
        
    return results

@app.get("/api/render/{image_id}")
def render_image(image_id: int, draw_boxes: bool = True):
    """
    Legge l'immagine fisica (anche formati industriali come BMP/TIFF), 
    disegna le bounding box se presenti, e restituisce un JPEG on-the-fly.
    """
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # 1. Fetch path dell'immagine
        cursor.execute("SELECT folder_path, file_name FROM images WHERE id = ?", (image_id,))
        img_row = cursor.fetchone()
        
        if not img_row:
            conn.close()
            raise HTTPException(status_code=404, detail="Image not found in DB")
            
        img_path = Path(img_row["folder_path"]) / img_row["file_name"]
        
        # 2. Fetch bounding boxes
        cursor.execute("SELECT class_name, row1, col1, row2, col2 FROM bounding_boxes WHERE image_id = ?", (image_id,))
        bboxes = cursor.fetchall()
        
        if not img_path.exists():
            conn.close()
            raise HTTPException(status_code=404, detail="Physical image file not found on disk")
            
        # 3. Apri immagine con PIL e usa RGBA per supportare la trasparenza
        with Image.open(img_path) as img:
            rgba_img = img.convert("RGBA")
            overlay = Image.new("RGBA", rgba_img.size, (255, 255, 255, 0))
            draw = ImageDraw.Draw(overlay)
            
            # 4. Disegna le bounding box
            if draw_boxes:
                for box in bboxes:
                    # Coordinate: row1 (y1), col1 (x1), row2 (y2), col2 (x2)
                    r1, c1, r2, c2 = int(box["row1"]), int(box["col1"]), int(box["row2"]), int(box["col2"])
                    label = box["class_name"] or "UNK"
                    
                    # Calcola il colore basato sulla classe
                    hex_c = get_class_color_hex(label, cursor)
                    outline_color = hex_to_rgba(hex_c, 255)
                    fill_color = hex_to_rgba(hex_c, 45)
                    
                    # Disegna rettangolo con perimetro pieno e riempimento traslucido
                    draw.rectangle([c1, r1, c2, r2], outline=outline_color, fill=fill_color, width=3)
                    
                    # Sfondo per il testo per renderlo più leggibile
                    text_bbox = draw.textbbox((c1, max(0, r1 - 15)), label)
                    draw.rectangle([text_bbox[0]-2, text_bbox[1]-2, text_bbox[2]+2, text_bbox[3]+2], fill=outline_color)
                    draw.text((c1, max(0, r1 - 15)), label, fill=(0, 0, 0, 255))
            
            # Unisci l'overlay traslucido all'immagine originale
            final_img = Image.alpha_composite(rgba_img, overlay).convert("RGB")
            
            # 5. Salva in un buffer BytesIO in formato JPEG
            buf = io.BytesIO()
            final_img.save(buf, format="JPEG")
            
            # 6. Restituisci il binario con l'header corretto
            conn.close()
            return Response(content=buf.getvalue(), media_type="image/jpeg")
            
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

import sys
import json

CONFIG_PATH = BASE_DIR / "config.json"

def get_dropzone_path():
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                config_data = json.load(f)
                return config_data.get("DROPZONE_PATH")
        except Exception as e:
            print(f"Errore lettura config.json: {e}")
    return None

# Integrazione col motore di importazione
SRC_DIR = BASE_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.append(str(SRC_DIR))
try:
    from import_hdict import import_hdict
except ImportError:
    import_hdict = None

class ImportRequest(BaseModel):
    hdict_file: str
    delete_source: bool
    control_type: str
    station: str
    machine_serial: str
    format_type: str
    matricola: str = ""
    check_only: bool = False
    update_duplicates: bool = False
    merge_new_with_old_date: bool = False

@app.get("/api/taxonomy-options")
def get_taxonomy_options():
    try:
        conn = sqlite3.connect("halcon_dataset.db", timeout=10.0)
        cursor = conn.cursor()
        
        options = {}
        for col in ["control_type", "station", "machine_serial", "format_type"]:
            cursor.execute(f"SELECT DISTINCT {col} FROM images WHERE {col} IS NOT NULL")
            options[col] = [row[0] for row in cursor.fetchall() if row[0].strip() != ""]
        
        cursor.execute("SELECT DISTINCT class_name FROM bounding_boxes WHERE class_name IS NOT NULL AND class_name != '' ORDER BY class_name")
        options["class_name"] = [row[0] for row in cursor.fetchall()]
            
        conn.close()
        return {"status": "success", "options": options}
    except Exception as e:
        return {"status": "error", "message": f"Errore DB: {str(e)}", "options": {}}

@app.get("/api/dropzone-dicts")
def get_dropzone_dicts():
    dz_path = get_dropzone_path()
    if not dz_path:
        return {"status": "error", "message": "DROPZONE_PATH non configurato in config.json.", "files": []}
        
    dropzone_dir = Path(dz_path)
    if not dropzone_dir.exists() or not dropzone_dir.is_dir():
        return {"status": "error", "message": f"Cartella DropZone non trovata sul server: {dz_path}", "files": []}
        
    hdict_files = list(dropzone_dir.rglob("*.hdict"))
    # Return relative paths to the DropZone root so they look clean in UI
    rel_files = [str(f.relative_to(dropzone_dir)) for f in hdict_files]
    
    return {"status": "success", "files": rel_files}

@app.post("/api/import-network")
def import_network(req: ImportRequest):
    dz_path = get_dropzone_path()
    if not dz_path:
        return {"status": "error", "message": "DROPZONE_PATH non configurato in config.json."}
        
    dropzone_dir = Path(dz_path)
    if not dropzone_dir.exists() or not dropzone_dir.is_dir():
        return {"status": "error", "message": f"Cartella DropZone non trovata sul server: {dz_path}"}
        
    if import_hdict is None:
        return {"status": "error", "message": "Motore import_hdict non disponibile."}
        
    if not req.hdict_file:
        return {"status": "error", "message": "Nessun dizionario selezionato."}
        
    hdict_file = dropzone_dir / req.hdict_file
    if not hdict_file.exists() or not hdict_file.is_file():
        return {"status": "error", "message": f"Dizionario non trovato: {req.hdict_file}"}
    
    try:
        # Avvia l'ingestione reale con tassonomia dinamica e risoluzione conflitti
        result = import_hdict(
            hdict_path_str=str(hdict_file),
            control_type=req.control_type,
            station=req.station,
            machine_serial=req.machine_serial,
            format_type=req.format_type,
            matricola=req.matricola,
            delete_source=req.delete_source,
            check_only=req.check_only,
            update_duplicates=req.update_duplicates,
            merge_new_with_old_date=req.merge_new_with_old_date
        )
        
        if req.check_only:
            return {
                "status": "success",
                "duplicate_count": result.get("duplicate_count", 0),
                "new_count": result.get("new_count", 0)
            }
            
        msg = f"Ingestione completata per {hdict_file.name}! {result.get('imported', 0)} archiviate, {result.get('updated', 0)} aggiornate. File puliti: {result.get('cleaned_files', 0)}"
        return {"status": "success", "message": msg, "data": result}
    except Exception as e:
        traceback.print_exc()
        return {"status": "error", "message": f"Errore durante l'ingestione: {str(e)}"}

@app.post("/api/export/filters")
def get_export_filters(req: ExportFilterRequest):
    """ Restituisce le opzioni disponibili per il livello successivo del Dataset Builder """
    try:
        conn = get_db()
        c = conn.cursor()
        
        # 1) Nessun filtro -> Restituisci control_types
        if not req.control_type:
            c.execute("SELECT DISTINCT control_type FROM images WHERE control_type IS NOT NULL AND control_type != '' ORDER BY control_type")
            opts = [row[0] for row in c.fetchall()]
            return {"next_step": "control_type", "options": opts}
            
        # 2) control_type -> Restituisci machine_serials
        if req.control_type and not req.machine_serials:
            c.execute("SELECT DISTINCT machine_serial FROM images WHERE control_type = ? AND machine_serial IS NOT NULL AND machine_serial != '' ORDER BY machine_serial", (req.control_type,))
            opts = [row[0] for row in c.fetchall()]
            return {"next_step": "machine_serials", "options": opts}
            
        # 3) control_type + machine_serials -> Restituisci format_types
        if req.control_type and req.machine_serials and not req.format_type:
            placeholders = ",".join("?" * len(req.machine_serials))
            query = f"SELECT DISTINCT format_type FROM images WHERE control_type = ? AND machine_serial IN ({placeholders}) AND format_type IS NOT NULL AND format_type != '' ORDER BY format_type"
            c.execute(query, [req.control_type] + req.machine_serials)
            opts = [row[0] for row in c.fetchall()]
            return {"next_step": "format_type", "options": opts}
            
        # 4) Tutto presente -> Restituisci class_names dai bounding_boxes associati
        if req.control_type and req.machine_serials and req.format_type:
            placeholders_s = ",".join("?" * len(req.machine_serials))
            placeholders_f = ",".join("?" * len(req.format_type))
            query = f"""
                SELECT DISTINCT b.class_name 
                FROM bounding_boxes b
                JOIN images i ON b.image_id = i.id
                WHERE i.control_type = ? 
                  AND i.machine_serial IN ({placeholders_s})
                  AND i.format_type IN ({placeholders_f})
                  AND b.class_name IS NOT NULL 
                  AND b.class_name != ''
                ORDER BY b.class_name
            """
            c.execute(query, [req.control_type] + req.machine_serials + req.format_type)
            opts = [row[0] for row in c.fetchall()]
            return {"next_step": "classes", "options": opts}

    except Exception as e:
        print(f"Error in /api/export/filters: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if 'conn' in locals():
            conn.close()

@app.post("/api/search")
def global_search(req: GlobalSearchQuery):
    """Motore di ricerca globale con filtri sfaccettati e distribuzione classi."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # We always LEFT JOIN with bounding_boxes if we are filtering by class or unlabeled
        has_class_filter = req.classes is not None or req.include_unlabeled
        
        select_cols = """i.id, i.file_name, i.folder_path, i.control_type, i.station, 
                         i.machine_serial, i.format_type, i.upload_date, i.folder_class, 
                         i.detection_mode, i.image_width, i.image_height"""
        
        if has_class_filter:
            query = f"SELECT DISTINCT {select_cols} FROM images i LEFT JOIN bounding_boxes b ON b.image_id = i.id WHERE 1=1"
        else:
            query = f"SELECT {select_cols} FROM images i WHERE 1=1"
        
        params = []
        
        if req.control_types is not None:
            if len(req.control_types) > 0:
                ph = ','.join(['?'] * len(req.control_types))
                query += f" AND i.control_type IN ({ph})"
                params.extend(req.control_types)
            else:
                query += " AND 1=0"
        
        if req.stations is not None:
            if len(req.stations) > 0:
                ph = ','.join(['?'] * len(req.stations))
                query += f" AND i.station IN ({ph})"
                params.extend(req.stations)
            else:
                query += " AND 1=0"
        
        if req.machine_serials is not None:
            if len(req.machine_serials) > 0:
                ph = ','.join(['?'] * len(req.machine_serials))
                query += f" AND i.machine_serial IN ({ph})"
                params.extend(req.machine_serials)
            else:
                query += " AND 1=0"
        
        if req.format_types is not None:
            if len(req.format_types) > 0:
                ph = ','.join(['?'] * len(req.format_types))
                query += f" AND i.format_type IN ({ph})"
                params.extend(req.format_types)
            else:
                query += " AND 1=0"
        
        if has_class_filter:
            class_conditions = []
            
            if req.classes:
                ph = ','.join(['?'] * len(req.classes))
                class_conditions.append(f"b.class_name IN ({ph})")
                params.extend(req.classes)
                
            if req.include_unlabeled:
                class_conditions.append("b.id IS NULL")
                
            if class_conditions:
                query += " AND (" + " OR ".join(class_conditions) + ")"
            else:
                # Se l'utente ha deselezionato tutto (sia le classi che 'Not Labeled')
                query += " AND 1=0"
        
        query += " ORDER BY i.file_name ASC"
        
        cursor.execute(query, params)
        rows = cursor.fetchall()
        
        results = []
        image_ids = []
        for r in rows:
            rel_path = f"{r['control_type']}/{r['station']}/{r['machine_serial']}/{r['format_type']}/{r['upload_date']}/{r['folder_class']}/{r['file_name']}"
            web_url = f"/dataset/{rel_path}"
            
            results.append({
                "id": r["id"],
                "file_name": r["file_name"],
                "url": web_url,
                "control_type": r["control_type"],
                "station": r["station"],
                "machine_serial": r["machine_serial"],
                "format_type": r["format_type"],
                "upload_date": r["upload_date"],
                "folder_class": r["folder_class"],
                "detection_mode": r["detection_mode"],
                "width": r["image_width"],
                "height": r["image_height"]
            })
            image_ids.append(r["id"])
        
        # Distribuzione classi per le immagini trovate
        class_distribution = {}
        if image_ids:
            chunk_size = 900
            for i in range(0, len(image_ids), chunk_size):
                chunk = image_ids[i:i + chunk_size]
                ph = ','.join(['?'] * len(chunk))
                cursor.execute(f"""
                    SELECT class_name, COUNT(*) as cnt 
                    FROM bounding_boxes 
                    WHERE image_id IN ({ph}) AND class_name IS NOT NULL AND class_name != ''
                    GROUP BY class_name 
                """, chunk)
                for row in cursor.fetchall():
                    cname = row["class_name"]
                    class_distribution[cname] = class_distribution.get(cname, 0) + row["cnt"]
            
            # Sort descending by count
            class_distribution = dict(sorted(class_distribution.items(), key=lambda item: item[1], reverse=True))
        
        conn.close()
        return {
            "status": "success",
            "images": results,
            "total": len(results),
            "class_distribution": class_distribution
        }
    except Exception as e:
        traceback.print_exc()
        return {"status": "error", "message": str(e), "images": [], "total": 0, "class_distribution": {}}


@app.post("/api/facets")
def get_facets(req: GlobalSearchQuery):
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        def build_facet_query(target_field, exclude_field):
            has_class_filter = False
            if exclude_field != 'classes':
                has_class_filter = req.classes is not None or req.include_unlabeled
            if target_field.startswith('b.'):
                has_class_filter = True
                
            if has_class_filter:
                query = f"SELECT DISTINCT {target_field} FROM images i LEFT JOIN bounding_boxes b ON b.image_id = i.id WHERE 1=1"
            else:
                query = f"SELECT DISTINCT {target_field} FROM images i WHERE 1=1"
                
            params = []
            
            if exclude_field != 'control_types' and req.control_types is not None:
                if len(req.control_types) > 0:
                    ph = ','.join(['?'] * len(req.control_types))
                    query += f" AND i.control_type IN ({ph})"
                    params.extend(req.control_types)
                else:
                    query += " AND 1=0"
                    
            if exclude_field != 'stations' and req.stations is not None:
                if len(req.stations) > 0:
                    ph = ','.join(['?'] * len(req.stations))
                    query += f" AND i.station IN ({ph})"
                    params.extend(req.stations)
                else:
                    query += " AND 1=0"
                    
            if exclude_field != 'machine_serials' and req.machine_serials is not None:
                if len(req.machine_serials) > 0:
                    ph = ','.join(['?'] * len(req.machine_serials))
                    query += f" AND i.machine_serial IN ({ph})"
                    params.extend(req.machine_serials)
                else:
                    query += " AND 1=0"
                    
            if exclude_field != 'format_types' and req.format_types is not None:
                if len(req.format_types) > 0:
                    ph = ','.join(['?'] * len(req.format_types))
                    query += f" AND i.format_type IN ({ph})"
                    params.extend(req.format_types)
                else:
                    query += " AND 1=0"
                    
            if exclude_field != 'classes' and has_class_filter:
                class_conditions = []
                if req.classes:
                    ph = ','.join(['?'] * len(req.classes))
                    class_conditions.append(f"b.class_name IN ({ph})")
                    params.extend(req.classes)
                if req.include_unlabeled:
                    class_conditions.append("b.id IS NULL")
                if class_conditions:
                    query += " AND (" + " OR ".join(class_conditions) + ")"
                else:
                    query += " AND 1=0"
            
            query += f" AND {target_field} IS NOT NULL AND {target_field} != ''"
            cursor.execute(query, params)
            return [row[0] for row in cursor.fetchall()]

        control_types = build_facet_query('i.control_type', 'control_types')
        stations = build_facet_query('i.station', 'stations')
        machine_serials = build_facet_query('i.machine_serial', 'machine_serials')
        format_types = build_facet_query('i.format_type', 'format_types')
        classes = build_facet_query('b.class_name', 'classes')
        
        unlabeled_count = 0
        q_unl = "SELECT COUNT(*) FROM images i LEFT JOIN bounding_boxes b ON b.image_id = i.id WHERE b.id IS NULL"
        params_unl = []
        if req.control_types is not None and len(req.control_types) > 0:
            ph = ','.join(['?'] * len(req.control_types))
            q_unl += f" AND i.control_type IN ({ph})"
            params_unl.extend(req.control_types)
        elif req.control_types is not None:
            q_unl += " AND 1=0"
            
        if req.stations is not None and len(req.stations) > 0:
            ph = ','.join(['?'] * len(req.stations))
            q_unl += f" AND i.station IN ({ph})"
            params_unl.extend(req.stations)
        elif req.stations is not None:
            q_unl += " AND 1=0"
            
        if req.machine_serials is not None and len(req.machine_serials) > 0:
            ph = ','.join(['?'] * len(req.machine_serials))
            q_unl += f" AND i.machine_serial IN ({ph})"
            params_unl.extend(req.machine_serials)
        elif req.machine_serials is not None:
            q_unl += " AND 1=0"
            
        if req.format_types is not None and len(req.format_types) > 0:
            ph = ','.join(['?'] * len(req.format_types))
            q_unl += f" AND i.format_type IN ({ph})"
            params_unl.extend(req.format_types)
        elif req.format_types is not None:
            q_unl += " AND 1=0"
            
        cursor.execute(q_unl, params_unl)
        unlabeled_count = cursor.fetchone()[0]
            
        conn.close()
        return {
            "status": "success",
            "facets": {
                "control_type": control_types,
                "station": stations,
                "machine_serial": machine_serials,
                "format_type": format_types,
                "class_name": classes,
                "unlabeled_available": unlabeled_count > 0
            }
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"status": "error", "message": str(e)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)


@app.post("/api/export-dataset")
def export_dataset_endpoint(req: dict):
    try:
        from src.export_for_training import export_dataset_api
        export_name = req.get("export_name", "dataset_export")
        filters = req.get("filters", {})
        class_mapping = req.get("class_mapping", {})
        
        result = export_dataset_api(export_name, filters, class_mapping)
        return result
    except ValueError as ve:
        return {"status": "error", "message": str(ve)}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"status": "error", "message": f"Errore durante l'esportazione: {str(e)}"}

