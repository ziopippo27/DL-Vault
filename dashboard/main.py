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

app = FastAPI(title="Halcon Dataset Control Room")

class ExportFilterRequest(BaseModel):
    control_type: str | None = None
    machine_serials: list[str] | None = None
    format_type: list[str] | None = None
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
        conn.close()
        
        if not img_path.exists():
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
                    
                    # Colori stile Frontend (#00f3ff con trasparenza per il fill)
                    outline_color = (0, 243, 255, 255)
                    fill_color = (0, 243, 255, 45) # Riempimento ad alta trasparenza
                    
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
