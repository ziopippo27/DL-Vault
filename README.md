# Halcon Dataset Engine

An interactive, terminal-based Python application for cataloging, managing, and filtering Computer Vision datasets for MVTec Halcon DL Tool.

## Architecture

- **/dataset_archive/**: Stores the temporal folders with images and their corresponding `.hdict` backup files.
- **/dropzone/**: Temporary folder where the operator copies images and `.hdict` files exported by Halcon prior to import.
- **/src/**: Contains all Python scripts for the system.
- **halcon_dataset.db**: The local SQLite database holding metadata and bounding box information.

## Phases
1. **init_db**: Initializes the SQLite database.
2. **import_hdict**: Interactively imports datasets and records metadata.
3. **export_for_training**: Filters and exports datasets into an `.hdict` file for MVTec Halcon DL training.
