import sqlite3
import shutil
import hashlib
import re
from pathlib import Path
from datetime import datetime
import sys

try:
    import halcon as ha
except ImportError:
    print("WARNING: mvtec-halcon library not found. L'importazione fallirà se non si utilizza un mock.")
    ha = None

try:
    from PIL import Image
except ImportError:
    Image = None
    print("WARNING: Pillow (PIL) non installata. Le dimensioni dell'immagine non verranno estratte.")

def compute_sha256(file_path):
    """Calcola l'hash SHA-256 di un file in blocchi più grandi per ridurre latenza di rete."""
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for byte_block in iter(lambda: f.read(1024 * 1024), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()

def clean_text(raw_val):
    """Pulisce il testo per l'uso nei percorsi di Windows, accettando anche numeri puri."""
    if not raw_val:
        return ""
    clean_val = re.sub(r'[^a-zA-Z0-9_-]', '', raw_val.strip().replace(" ", "_"))
    return clean_val

def get_input(prompt_text, mandatory=False):
    """Utility function to get input from the user, ensuring mandatory fields are filled."""
    while True:
        val = input(prompt_text).strip()
        if not val and mandatory:
            print("Questo campo è OBBLIGATORIO. Per favore, inserisci un valore.")
        else:
            return val

def ask_with_suggestions(prompt_title, db_column, cursor):
    """Mostra un menu interattivo con le opzioni esistenti nel DB per un dato campo."""
    # Estrai valori esistenti
    try:
        cursor.execute(f"SELECT DISTINCT {db_column} FROM images WHERE {db_column} IS NOT NULL AND {db_column} != ''")
        existing_values = [row[0] for row in cursor.fetchall()]
    except Exception:
        existing_values = []
        
    print(f"\n--- {prompt_title.upper()} ---")
    if existing_values:
        for i, val in enumerate(existing_values, 1):
            print(f"[{i}] {val}")
    print("[0] + AGGIUNGI NUOVO / DIGITA TESTO")
    
    while True:
        choice = input(f"Scegli un'opzione per '{prompt_title}' [0-{len(existing_values)}]: ").strip()
        
        # 1. Se ha digitato ESATTAMENTE un numero che corrisponde a un'opzione del menu
        if choice.isdigit():
            idx = int(choice)
            if idx == 0:
                # Opzione 0: Inserimento libero
                while True:
                    new_val = get_input(f"Inserisci nuovo valore per '{prompt_title}': ", mandatory=True)
                    cleaned = clean_text(new_val)
                    if cleaned:
                        return cleaned
                    print("Valore non valido. Usa lettere o numeri.")
            elif 1 <= idx <= len(existing_values):
                return existing_values[idx - 1]
                
        # 2. Se ha digitato qualcos'altro (testo libero o un numero fuori range che vale come testo)
        if choice:
            cleaned = clean_text(choice)
            if cleaned:
                return cleaned
            
        print("Scelta non valida. Riprova.")

def get_keys(obj):
    if isinstance(obj, dict):
        return list(obj.keys())
    elif ha and isinstance(obj, ha.HHandle):
        return list(ha.get_dict_param(obj, 'keys', []))
    return []

def get_value(obj, key):
    if isinstance(obj, dict):
        return obj.get(key)
    elif ha and isinstance(obj, ha.HHandle):
        keys = get_keys(obj)
        if key in keys:
            return ha.get_dict_tuple(obj, key)
    return None

def set_value(obj, key, val):
    if isinstance(obj, dict):
        obj[key] = val
    elif ha and isinstance(obj, ha.HHandle):
        if not isinstance(val, (list, tuple)):
            val = (val,)
        ha.set_dict_tuple(obj, key, val)

def get_first_valid(obj, possible_keys):
    for k in possible_keys:
        val = get_value(obj, k)
        if val is not None:
            return val
    return None

def import_hdict(hdict_path_str=None, control_type=None, station=None, machine_serial=None, format_type=None, matricola=None, delete_source=True, check_only=False, update_duplicates=False, merge_new_with_old_date=False):
    print("--- Halcon Dataset Engine: Importazione Interattiva a 6 Livelli ---")
    
    db_path = Path("halcon_dataset.db")
    if not db_path.exists():
        db_path = Path(__file__).parent.parent / "halcon_dataset.db"
        if not db_path.exists():
            raise RuntimeError(f"Database {db_path} non trovato. Esegui 'python src/init_db.py'.")

    conn = sqlite3.connect(db_path, timeout=60.0)
    cursor = conn.cursor()
    
    if hdict_path_str is None:
        hdict_path_str = get_input("Percorso del file .hdict da importare: ", mandatory=True)
        
    if not check_only:
        if control_type is None:
            control_type = ask_with_suggestions("Tipo di Controllo", "control_type", cursor)
        if station is None:
            station = ask_with_suggestions("Stazione", "station", cursor)
        if machine_serial is None:
            machine_serial = ask_with_suggestions("Seriale Macchina", "machine_serial", cursor)
        if format_type is None:
            format_type = ask_with_suggestions("Formato (flacone/cartridge)", "format_type", cursor)
        if matricola is None:
            matricola = get_input("Matricola, lotto o commento [OPZIONALE]: ", mandatory=False)
            matricola = clean_text(matricola) if matricola else ""

    hdict_path = Path(hdict_path_str)
    if not hdict_path.exists():
        raise FileNotFoundError(f"Il file .hdict '{hdict_path}' non esiste.")
        
    hdict_parent = hdict_path.parent

    now = datetime.now()
    upload_date = now.strftime("%Y-%m-%d")
    timestamp_str = now.strftime("%Y-%m-%d_%H-%M")
    
    if ha is None:
        raise RuntimeError("Libreria 'mvtec-halcon' mancante. Impossibile leggere il file .hdict.")
        
    try:
        hdict_data = ha.read_dict(str(hdict_path), [], [])
    except Exception as e:
        raise RuntimeError(f"Errore durante la lettura del file .hdict: {e}")

    samples = None
    root_keys = get_keys(hdict_data)
    
    if isinstance(hdict_data, (dict, ha.HHandle)):
        possible_keys = ["samples", "images", "samples_list", "data"]
        for key in possible_keys:
            if key in root_keys:
                samples = get_value(hdict_data, key)
                break
        
        if samples is None or len(samples) == 0:
            raise RuntimeError("Impossibile trovare la lista dei campioni nel dizionario.")
    elif isinstance(hdict_data, (list, tuple)):
        samples = list(hdict_data)
    else:
        samples = [hdict_data]
        
    samples_list = list(samples) if isinstance(samples, (list, tuple)) else [samples]
    class_names_tuple = get_value(hdict_data, 'class_names')
    if class_names_tuple is not None and not isinstance(class_names_tuple, (list, tuple)):
        class_names_tuple = [class_names_tuple]
    
    total_bboxes = 0
    imported_images_count = 0
    updated_images_count = 0
    duplicate_count = 0
    new_count = 0
    first_old_upload_date = None
    first_old_control_type = None
    first_old_station = None
    first_old_machine_serial = None
    first_old_format_type = None
    first_old_matricola = None
    
    file_cache = {}
    for f in hdict_parent.rglob("*"):
        if f.is_file() and not f.name.startswith('.') and f.suffix.lower() not in ['.db', '.hdict', '.txt']:
            if f.stem not in file_cache:
                file_cache[f.stem] = f
                
    files_to_remove = []
    
    hash_cache = {}
    
    import tempfile
    local_temp_dir = Path(tempfile.mkdtemp(prefix="dlvault_local_"))
    local_file_cache = {}
    
    # Primo passaggio: Trova la tassonomia del primo doppione per eventuali ereditarietà o merge per eventuali ereditarietà o merge
    for sample in samples_list:
        if not isinstance(sample, (dict, ha.HHandle)): continue
        original_img_path_val = get_first_valid(sample, ['image_file_name', 'image_path', 'file_name'])
        original_img_path_str = str(original_img_path_val[0]) if isinstance(original_img_path_val, (list, tuple)) else str(original_img_path_val or "")
        if not original_img_path_str: continue
        real_source_path = file_cache.get(Path(original_img_path_str).stem)
        if real_source_path:
            file_name_only = real_source_path.name
            if check_only:
                cursor.execute("SELECT upload_date, control_type, station, machine_serial, format_type, matricola_commento FROM images WHERE file_name = ?", (file_name_only,))
            else:
                if real_source_path not in hash_cache:
                    hash_cache[real_source_path] = compute_sha256(real_source_path)
                file_hash = hash_cache[real_source_path]
                cursor.execute("SELECT upload_date, control_type, station, machine_serial, format_type, matricola_commento FROM images WHERE file_hash = ?", (file_hash,))
            existing_record = cursor.fetchone()
            if existing_record:
                first_old_upload_date = existing_record[0]
                first_old_control_type = existing_record[1]
                first_old_station = existing_record[2]
                first_old_machine_serial = existing_record[3]
                first_old_format_type = existing_record[4]
                first_old_matricola = existing_record[5]
                break

    # Se l'utente ha scelto "Mantieni" (update_duplicates = False) e ci sono doppioni,
    # le nuove immagini DEVONO ereditare la tassonomia del dataset originale per non essere orfane.
    if not update_duplicates and first_old_upload_date:
        control_type = first_old_control_type or control_type
        station = first_old_station or station
        machine_serial = first_old_machine_serial or machine_serial
        format_type = first_old_format_type or format_type
        matricola = first_old_matricola or matricola
    
    for sample in samples_list:
        if not isinstance(sample, (dict, ha.HHandle)): continue
            
        original_img_path_val = get_first_valid(sample, ['image_file_name', 'image_path', 'file_name'])
        original_img_path_str = str(original_img_path_val[0]) if isinstance(original_img_path_val, (list, tuple)) else str(original_img_path_val or "")
        if not original_img_path_str: continue
            
        real_source_path = file_cache.get(Path(original_img_path_str).stem)
        if real_source_path:
            file_name_only = real_source_path.name
            
            row1s = get_value(sample, 'bbox_row1')
            labels = get_first_valid(sample, ['bbox_label', 'bbox_label_id']) or []
            if row1s is not None and not isinstance(row1s, (list, tuple)): labels = [labels]
                
            unique_classes = set()
            if row1s is not None and len(row1s if isinstance(row1s, (list, tuple)) else [row1s]) > 0:
                for lbl in (labels if isinstance(labels, (list, tuple)) else [labels]):
                    class_name = str(class_names_tuple[lbl]) if (isinstance(lbl, int) and class_names_tuple and 0 <= lbl < len(class_names_tuple)) else (str(lbl) if isinstance(lbl, str) else None)
                    if class_name: unique_classes.add(class_name)
                        
            if len(unique_classes) == 0:
                folder_class = "RAW"
                detection_mode = "NESSUNA_ANNOTAZIONE"
            elif len(unique_classes) == 1:
                folder_class = list(unique_classes)[0]
                detection_mode = "SINGOLA_CLASSE"
            else:
                folder_class = "MIX"
                detection_mode = "MULTI_CLASSE"
            if check_only:
                cursor.execute("SELECT id, folder_path, upload_date FROM images WHERE file_name = ?", (file_name_only,))
                existing_record = cursor.fetchone()
                file_hash = None
            else:
                if real_source_path not in hash_cache:
                    if real_source_path not in local_file_cache:
                        temp_file_path = local_temp_dir / file_name_only
                        shutil.copy2(str(real_source_path), str(temp_file_path))
                        local_file_cache[real_source_path] = temp_file_path
                    hash_cache[real_source_path] = compute_sha256(local_file_cache[real_source_path])
                file_hash = hash_cache[real_source_path]
                
                img_width, img_height = 0, 0
                if Image is not None:
                    try:
                        with Image.open(local_file_cache.get(real_source_path, real_source_path)) as img:
                            img_width, img_height = img.size
                    except Exception: pass
                
                cursor.execute("SELECT id, folder_path, upload_date FROM images WHERE file_hash = ?", (file_hash,))
                existing_record = cursor.fetchone()
            
            base_dataset_dir = db_path.parent / "dataset_archive"
            if existing_record:
                duplicate_count += 1
                if check_only:
                    continue
                    
                image_id, old_folder_path, old_upload_date = existing_record
                final_upload_date = old_upload_date
                
                if update_duplicates:
                    dest_folder = base_dataset_dir / control_type / station / machine_serial / format_type / final_upload_date / folder_class
                    dest_folder.mkdir(parents=True, exist_ok=True)
                    dest_img_path = dest_folder / file_name_only
                    
                    cursor.execute("""
                        UPDATE images 
                        SET folder_path = ?, file_name = ?, matricola_commento = ?, control_type = ?, station = ?, machine_serial = ?, format_type = ?, 
                            upload_date = ?, folder_class = ?, detection_mode = ?, timestamp_export = ?, image_width = ?, image_height = ?
                        WHERE id = ?
                    """, (str(dest_folder.absolute()), file_name_only, matricola, control_type, station, machine_serial, format_type, final_upload_date, folder_class, detection_mode, timestamp_str, img_width, img_height, image_id))
                    
                    if old_folder_path != str(dest_folder.absolute()):
                        if Path(old_folder_path).joinpath(file_name_only).exists():
                            shutil.move(str(Path(old_folder_path).joinpath(file_name_only)), str(dest_img_path))
                else:
                    dest_folder = Path(old_folder_path)
                    dest_img_path = dest_folder / file_name_only
                    
                cursor.execute("DELETE FROM bounding_boxes WHERE image_id = ?", (image_id,))
                updated_images_count += 1
                files_to_remove.append(real_source_path)
                
            else:
                new_count += 1
                if check_only:
                    continue
                    
                final_upload_date = upload_date
                dest_folder = base_dataset_dir / control_type / station / machine_serial / format_type / final_upload_date / folder_class
                dest_folder.mkdir(parents=True, exist_ok=True)
                dest_img_path = dest_folder / file_name_only
                
                source_to_copy = local_file_cache.get(real_source_path, real_source_path)
                shutil.copy2(str(source_to_copy), str(dest_img_path))
                files_to_remove.append(real_source_path)
                    
                cursor.execute("""
                    INSERT INTO images (file_hash, folder_path, file_name, matricola_commento, control_type, station, machine_serial, format_type, upload_date, folder_class, detection_mode, timestamp_export, image_width, image_height)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (file_hash, str(dest_folder.absolute()), file_name_only, matricola, control_type, station, machine_serial, format_type, final_upload_date, folder_class, detection_mode, timestamp_str, img_width, img_height))
                
                image_id = cursor.lastrowid
                imported_images_count += 1
                
            if not check_only:
                new_absolute_path = str(dest_img_path.absolute())
                for k in ['image_file_name', 'image_path', 'file_name']:
                    if k in get_keys(sample): set_value(sample, k, new_absolute_path)
                
                if row1s is not None:
                    col1s = get_value(sample, 'bbox_col1') or []
                    row2s = get_value(sample, 'bbox_row2') or []
                    col2s = get_value(sample, 'bbox_col2') or []
                    if not isinstance(row1s, (list, tuple)):
                        row1s, col1s, row2s, col2s, labels = [row1s], [col1s], [row2s], [col2s], [labels]
                    for r1, c1, r2, c2, lbl in zip(row1s, col1s, row2s, col2s, labels):
                        cname = str(class_names_tuple[lbl]) if (isinstance(lbl, int) and class_names_tuple and 0 <= lbl < len(class_names_tuple)) else (str(lbl) if isinstance(lbl, str) else None)
                        cursor.execute("INSERT INTO bounding_boxes (image_id, label, class_name, row1, col1, row2, col2) VALUES (?, ?, ?, ?, ?, ?, ?)", (image_id, str(lbl), cname, float(r1), float(c1), float(r2), float(c2)))
                        total_bboxes += 1

    if check_only:
        conn.close()
        shutil.rmtree(str(local_temp_dir), ignore_errors=True)
        return {"duplicate_count": duplicate_count, "new_count": new_count, "imported": 0, "updated": 0, "bboxes": 0, "cleaned_files": 0}

    conn.commit()
    conn.close()
    
    cleaned_files_count = 0
    hdict_cleaned = False
    if imported_images_count > 0 or updated_images_count > 0:
        backup_dir = dest_folder.parent if 'dest_folder' in locals() else (db_path.parent / "dataset_archive")
        hdict_backup_path = backup_dir / hdict_path.name
        try:
            ha.write_dict(hdict_data, str(hdict_backup_path), [], [])
            if delete_source:
                try: hdict_path.unlink(); hdict_cleaned = True
                except Exception: pass
                for f in files_to_remove:
                    try: f.unlink(); cleaned_files_count += 1
                    except Exception: pass
                try:
                    dirs = sorted([d for d in hdict_parent.rglob("*") if d.is_dir()], key=lambda x: len(x.parts), reverse=True)
                    for d in dirs:
                        if d.name.lower() != 'dropzone':
                            try: d.rmdir()
                            except OSError: pass
                except Exception: pass
        except Exception as e:
            print(f"\n[ERRORE] Impossibile salvare il file .hdict: {e}")
            shutil.rmtree(str(local_temp_dir), ignore_errors=True)
            raise
    
    for old_file in files_to_remove:
        try:
            if old_file.exists(): old_file.unlink()
        except Exception: pass

    shutil.rmtree(str(local_temp_dir), ignore_errors=True)
    return {
        "imported": imported_images_count,
        "updated": updated_images_count,
        "bboxes": total_bboxes,
        "cleaned_files": len(files_to_remove),
        "final_taxonomy": {
            "control_type": control_type,
            "station": station,
            "machine_serial": machine_serial,
            "format_type": format_type
        }
    }

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", action="store_true")
    parser.add_argument("--hdict", type=str)
    args, unknown = parser.parse_known_args()
    
    if args.test:
        import_hdict(args.hdict, "test", "test", "test", "test", "test")
    else:
        import_hdict(args.hdict)
