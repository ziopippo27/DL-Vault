import sqlite3
from pathlib import Path

def init_db():
    db_path = Path("halcon_dataset.db")
    
    print(f"Initializing database at: {db_path.absolute()}")
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Abilita Write-Ahead Logging per accessi concorrenti
    cursor.execute("PRAGMA journal_mode=WAL;")
    cursor.execute("PRAGMA foreign_keys=ON;")

    # Create images table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_hash TEXT UNIQUE NOT NULL,
            folder_path TEXT NOT NULL,
            file_name TEXT NOT NULL,
            matricola_commento TEXT,
            control_type TEXT NOT NULL,
            station TEXT NOT NULL,
            machine_serial TEXT NOT NULL,
            format_type TEXT NOT NULL,
            upload_date TEXT NOT NULL,
            folder_class TEXT NOT NULL,
            detection_mode TEXT,
            timestamp_export TEXT NOT NULL,
            image_width INTEGER,
            image_height INTEGER
        )
    """)

    # Create bounding_boxes table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS bounding_boxes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            image_id INTEGER NOT NULL,
            label TEXT NOT NULL,
            class_name TEXT,
            annotation_type TEXT DEFAULT 'bbox',
            segmentation_json TEXT,
            row1 REAL NOT NULL,
            col1 REAL NOT NULL,
            row2 REAL NOT NULL,
            col2 REAL NOT NULL,
            FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
        )
    """)
    
    try:
        cursor.execute("ALTER TABLE bounding_boxes ADD COLUMN annotation_type TEXT DEFAULT 'bbox'")
        cursor.execute("ALTER TABLE bounding_boxes ADD COLUMN segmentation_json TEXT")
    except sqlite3.OperationalError:
        # Le colonne esistono già, procedi oltre
        pass

    # Create performance indexes
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_file_hash ON images(file_hash)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_format_type ON images(format_type)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_label ON bounding_boxes(label)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_class_name ON bounding_boxes(class_name)")
    
    # Nuovi Indici per Ottimizzazione Ricerche (V2)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_taxonomy ON images(control_type, station, machine_serial, format_type);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_class_date ON images(folder_class, upload_date);")

    # Nuove Tabelle per Dataset Builder (V2)
    cursor.execute('''CREATE TABLE IF NOT EXISTS dataset_exports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        export_name TEXT UNIQUE NOT NULL,
        export_date TEXT NOT NULL,
        total_images INTEGER NOT NULL DEFAULT 0,
        detection_mode_filter TEXT,
        notes TEXT
    )''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS export_items (
        export_id INTEGER NOT NULL,
        image_id INTEGER NOT NULL,
        FOREIGN KEY (export_id) REFERENCES dataset_exports(id) ON DELETE CASCADE,
        FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
        PRIMARY KEY (export_id, image_id)
    )''')

    cursor.execute("CREATE INDEX IF NOT EXISTS idx_export_img ON export_items(image_id);")

    conn.commit()
    conn.close()
    
    print("Database aggiornato allo schema V3 (Dataset Builder, Indici e Supporto Segmentazione).")

if __name__ == "__main__":
    init_db()
