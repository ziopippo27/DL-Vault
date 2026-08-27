from fastapi.testclient import TestClient
from dashboard.main import app
import sqlite3
import traceback

def run_test():
    client = TestClient(app)
    
    try:
        conn = sqlite3.connect("halcon_dataset.db")
        cursor = conn.cursor()
        # Prendiamo un'immagine a caso che abbia preferibilmente delle bounding box, 
        # altrimenti una qualsiasi.
        cursor.execute("""
            SELECT i.id 
            FROM images i 
            LEFT JOIN bounding_boxes b ON i.id = b.image_id
            WHERE i.folder_path IS NOT NULL
            ORDER BY b.id DESC
            LIMIT 1
        """)
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            print("Database vuoto o nessuna immagine trovata per il test.")
            return
            
        image_id = row[0]
        print(f"Avvio test rendering per image_id: {image_id}")
        
        response = client.get(f"/api/render/{image_id}")
        print(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            print(f"SUCCESSO! Ricevuti {len(response.content)} bytes di dati (Formato: {response.headers.get('content-type')}).")
        else:
            print(f"ERRORE RILEVATO: {response.text}")
            
    except Exception as e:
        print("Eccezione durante il test:")
        traceback.print_exc()

if __name__ == "__main__":
    run_test()
