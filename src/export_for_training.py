import sqlite3
import argparse
import sys
from pathlib import Path

try:
    import halcon as ha
except ImportError:
    print("WARNING: mvtec-halcon library not found. Export functionality will be mocked se non installata.")
    ha = None

def export_dataset(format_type=None, label=None, detection_mode=None, output_file=None):
    print(f"--- Halcon Dataset Engine: Esportazione Training Set ---")
    
    # 1. Filtri interattivi base
    if not format_type:
        format_type = input("Formato (flacone/cartridge) [OBBLIGATORIO] (es. 10R): ").strip()
        while not format_type:
            print("Questo campo è OBBLIGATORIO.")
            format_type = input("Formato [OBBLIGATORIO]: ").strip()
            
    if not detection_mode:
        det_input = input("Vuoi filtrare per modalità di detection? [Lascia vuoto per TUTTE / 1 = SINGLE_DETECTION / 2 = MULTI_DETECTION / 3 = UNANNOTATED]: ").strip()
        if det_input == '1':
            detection_mode = 'SINGLE_DETECTION'
        elif det_input == '2':
            detection_mode = 'MULTI_DETECTION'
        elif det_input == '3':
            detection_mode = 'UNANNOTATED'
            
    if not output_file:
        output_file = "training_set_generale.hdict"
    
    db_path = Path("halcon_dataset.db")
    if not db_path.exists():
        print(f"Errore: Database '{db_path}' non trovato.")
        sys.exit(1)

    # 2. Connessione al DB
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # 3. Query per estrarre le classi testuali disponibili
    class_query = """
        SELECT DISTINCT b.class_name
        FROM images i
        JOIN bounding_boxes b ON i.id = b.image_id
        WHERE b.class_name IS NOT NULL
    """
    class_params = []
    if format_type:
        class_query += " AND i.format_type = ?"
        class_params.append(format_type)
    if detection_mode:
        class_query += " AND i.detection_mode = ?"
        class_params.append(detection_mode)
        
    cursor.execute(class_query, class_params)
    available_classes = [row[0] for row in cursor.fetchall() if row[0]]
    
    selected_classes = []
    
    # Se ci sono classi, chiedi all'utente
    if available_classes:
        print("\nClassi disponibili per questa selezione:")
        for idx, cls in enumerate(available_classes, 1):
            print(f"[{idx}] {cls}")
            
        class_input = input("Quali classi vuoi esportare? [Lascia vuoto per TUTTE, oppure scrivi i nomi o i numeri separati da virgola, es. 1, 2 oppure tappo, graffio]: ").strip()
        
        if class_input:
            parts = [p.strip() for p in class_input.split(',')]
            for p in parts:
                if p.isdigit():
                    idx = int(p) - 1
                    if 0 <= idx < len(available_classes):
                        selected_classes.append(available_classes[idx])
                elif p in available_classes:
                    selected_classes.append(p)
            
            # Rimuovi duplicati mantenendo l'ordine
            selected_classes = list(dict.fromkeys(selected_classes))
            
    # Se non c'è input dell'utente (o l'input era non valido), esportiamo tutte le classi disponibili
    if not selected_classes:
        selected_classes = available_classes
        
    # 4. Costruzione query finale
    query = """
        SELECT i.id, i.folder_path, i.file_name, i.matricola_commento,
               b.class_name, b.row1, b.col1, b.row2, b.col2
        FROM images i
        LEFT JOIN bounding_boxes b ON i.id = b.image_id
        WHERE 1=1
    """
    params = []
    
    print("\n[INFO] Filtri applicati:")
    if format_type:
        query += " AND i.format_type = ?"
        params.append(format_type)
        print(f" - Formato: '{format_type}'")
        
    if detection_mode:
        query += " AND i.detection_mode = ?"
        params.append(detection_mode)
        print(f" - Detection Mode: '{detection_mode}'")
    else:
        print(" - Detection Mode: TUTTE")
        
    if selected_classes:
        placeholders = ','.join(['?'] * len(selected_classes))
        # Esporta le bbox che matchano le classi scelte, O le immagini senza bbox (b.class_name IS NULL)
        query += f" AND (b.class_name IN ({placeholders}) OR b.class_name IS NULL)"
        params.extend(selected_classes)
        print(f" - Classi difetto esportate: {', '.join(selected_classes)}")
    else:
        print(" - Classi difetto esportate: NESSUNA CLASSE TROVATA/TUTTE")
        
    cursor.execute(query, params)
    rows = cursor.fetchall()
    
    # 5. Riscrivi in memoria la struttura dati per Halcon
    images_dict = {}
    lots_set = set()
    
    for row in rows:
        img_id, folder_path, file_name, matricola, class_name, r1, c1, r2, c2 = row
        
        if matricola:
            lots_set.add(matricola)
            
        if img_id not in images_dict:
            full_path = str(Path(folder_path).absolute() / file_name)
            images_dict[img_id] = {
                'image_file_name': full_path,
                'bbox_label_id': [],
                'bbox_row1': [],
                'bbox_col1': [],
                'bbox_row2': [],
                'bbox_col2': []
            }
            
        if class_name is not None and class_name in selected_classes:
            # Mappa il nome testuale al NUOVO INDICE INTERO basato su selected_classes
            new_label_id = selected_classes.index(class_name)
            
            images_dict[img_id]['bbox_label_id'].append(new_label_id)
            images_dict[img_id]['bbox_row1'].append(r1)
            images_dict[img_id]['bbox_col1'].append(c1)
            images_dict[img_id]['bbox_row2'].append(r2)
            images_dict[img_id]['bbox_col2'].append(c2)
            
    conn.close()
    
    if not images_dict:
        print("\n[ATTENZIONE] Nessuna immagine trovata corrispondente ai criteri specificati.")
        sys.exit(0)
        
    if ha is None:
        print("\nLibreria Halcon mancante. Simulazione completata.")
        print(f"Avrei esportato {len(images_dict)} immagini da {len(lots_set)} lotti differenti.")
        sys.exit(0)

    # 6. Conversione nel formato HHandle per Halcon
    print("\nGenerazione dizionario HHandle per MVTec Halcon...")
    try:
        root_dict = ha.create_dict()
        
        # MVTec Tool richiede la lista delle stringhe in 'class_names'
        if selected_classes:
            ha.set_dict_tuple(root_dict, 'class_names', tuple(selected_classes))
            # IMPOSTAZIONE OBBLIGATORIA: class_ids sequenziali
            ha.set_dict_tuple(root_dict, 'class_ids', tuple(range(len(selected_classes))))
            
        samples_handles = []
        
        for img_id, data in images_dict.items():
            sample = ha.create_dict()
            # La stringa va passata come tupla
            ha.set_dict_tuple(sample, 'image_file_name', (data['image_file_name'],))
            
            if data['bbox_label_id']:
                ha.set_dict_tuple(sample, 'bbox_label_id', tuple(int(x) for x in data['bbox_label_id']))
                # INSERIMENTO DELLA RAPPRESENTAZIONE TESTUALE (per massima compatibilità)
                ha.set_dict_tuple(sample, 'bbox_label', tuple(str(selected_classes[x]) for x in data['bbox_label_id']))
                
                # COORDINATE RIGOROSAMENTE FLOAT
                ha.set_dict_tuple(sample, 'bbox_row1', tuple(float(x) for x in data['bbox_row1']))
                ha.set_dict_tuple(sample, 'bbox_col1', tuple(float(x) for x in data['bbox_col1']))
                ha.set_dict_tuple(sample, 'bbox_row2', tuple(float(x) for x in data['bbox_row2']))
                ha.set_dict_tuple(sample, 'bbox_col2', tuple(float(x) for x in data['bbox_col2']))
            else:
                # Se l'immagine è UNANNOTATED, passiamo esplicitamente tuple vuote!
                ha.set_dict_tuple(sample, 'bbox_label_id', tuple())
                ha.set_dict_tuple(sample, 'bbox_label', tuple())
                ha.set_dict_tuple(sample, 'bbox_row1', tuple())
                ha.set_dict_tuple(sample, 'bbox_col1', tuple())
                ha.set_dict_tuple(sample, 'bbox_row2', tuple())
                ha.set_dict_tuple(sample, 'bbox_col2', tuple())
                
            samples_handles.append(sample)
            
        # Assegna la tupla di handles alla radice 'samples'
        ha.set_dict_tuple(root_dict, 'samples', tuple(samples_handles))
        
        # 7. Scrittura file tramite write_dict con argomenti posizionali richiesti
        ha.write_dict(root_dict, output_file, [], [])
        
        print("\n" + "="*40)
        print("ESPORTAZIONE COMPLETATA CON SUCCESSO")
        print("="*40)
        print(f"- File salvato: {output_file}")
        print(f"- Immagini esportate: {len(samples_handles)}")
        print(f"- Lotti (matricole) differenti inclusi: {len(lots_set)}")
        if detection_mode:
            print(f"- Filtro Detection applicato: {detection_mode}")
        else:
            print(f"- Filtro Detection applicato: TUTTE")
        print("="*40)
        
    except Exception as e:
        print(f"\n[ERRORE] Durante la creazione o scrittura del file .hdict: {e}")
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Esporta dataset da database SQLite per training in Halcon DL Tool.")
    parser.add_argument("--format_type", type=str, help="Filtra per uno specifico formato (es. 10R)")
    parser.add_argument("--label", type=str, help="Filtra per una specifica classe di difetto (es. graffio)")
    parser.add_argument("--detection_mode", type=str, choices=['SINGLE_DETECTION', 'MULTI_DETECTION', 'UNANNOTATED'], help="Filtra per modalità (es. SINGLE_DETECTION)")
    parser.add_argument("--output", type=str, help="Nome del file .hdict finale")
    
    args = parser.parse_args()
    
    export_dataset(args.format_type, args.label, args.detection_mode, args.output)
