
// --- GLOBAL CUSTOM DROPDOWN LOGIC ---
document.addEventListener('focusin', (e) => {
    if (e.target.classList && e.target.classList.contains('custom-autocomplete-input')) {
        document.querySelectorAll('.custom-autocomplete-list').forEach(l => l.classList.remove('show'));
        const list = e.target.closest('.custom-autocomplete-container')?.querySelector('.custom-autocomplete-list');
        // Apri solo se c'è almeno un suggerimento reale (ignorando spazi vuoti)
        if (list && list.innerHTML.trim() !== '') {
            list.classList.add('show');
        }
    }
});
document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-autocomplete-container')) {
        document.querySelectorAll('.custom-autocomplete-list').forEach(l => l.classList.remove('show'));
    }
});

let showBoxes = true;
let statsChartInstance = null;

document.addEventListener('DOMContentLoaded', () => {
    fetchTaxonomy();
    setupModal();
    setupTreeSearch();
    setupFilters();
    setupViewerStaticEvents();
    setupImportModal();
});

function setupViewerStaticEvents() {
    document.addEventListener('click', (e) => {
        if (e.target.id === 'btn-toggle-boxes') {
            showBoxes = !showBoxes;
            e.target.className = showBoxes ? 'bx bx-show' : 'bx bx-hide';
            renderSingleImage(currentSelectedIndex, true);
        } else if (e.target.id === 'btn-toggle-drawer') {
            const drawer = document.getElementById('stats-drawer');
            if (drawer) {
                drawer.classList.toggle('open');
                e.target.className = drawer.classList.contains('open') ? 'bx bxs-up-arrow' : 'bx bxs-down-arrow';
            }
        } else if (e.target.id === 'btn-reset-view') {
            scale = 1;
            pointX = 0;
            pointY = 0;
            const viewerImg = document.getElementById('viewer-img');
            if (viewerImg) {
                viewerImg.style.transform = `translate(0px, 0px) scale(1)`;
            }
        }
    });

    const viewerImg = document.getElementById('viewer-img');
    const viewerArea = document.querySelector('.viewport-image-area');
    
    if (viewerImg && viewerArea) {
        viewerArea.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            // Get mouse position relative to the container
            const rect = viewerArea.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            const zoomFactor = e.deltaY < 0 ? 1.1 : (1 / 1.1);
            
            // Calculate new scale, constrained
            let newScale = scale * zoomFactor;
            newScale = Math.min(Math.max(0.1, newScale), 50); // allow deep zoom
            
            const actualFactor = newScale / scale;
            
            // Pan to keep the point under the mouse stationary
            pointX = mouseX - (mouseX - pointX) * actualFactor;
            pointY = mouseY - (mouseY - pointY) * actualFactor;
            
            scale = newScale;
            viewerImg.style.transform = `translate(${pointX}px, ${pointY}px) scale(${scale})`;
            viewerImg.style.transformOrigin = "0 0"; // Important for this math
        });
        
        viewerArea.addEventListener('mousedown', (e) => {
            if (e.button !== 0 && e.button !== 1) return; // Allow left or middle click
            e.preventDefault();
            panning = true;
            viewerArea.style.cursor = 'grabbing';
            start = { x: e.clientX - pointX, y: e.clientY - pointY };
        });
        
        window.addEventListener('mousemove', (e) => {
            if (!panning) return;
            e.preventDefault();
            pointX = e.clientX - start.x;
            pointY = e.clientY - start.y;
            viewerImg.style.transform = `translate(${pointX}px, ${pointY}px) scale(${scale})`;
            viewerImg.style.transformOrigin = "0 0";
        });
        
        window.addEventListener('mouseup', () => {
            if (panning) {
                panning = false;
                viewerArea.style.cursor = 'grab';
            }
        });
        
        // Setup initial cursor
        viewerArea.style.cursor = 'grab';
    }
}

function setupTreeSearch() {
    const treeSearch = document.getElementById('tree-search');
    if (treeSearch) {
        treeSearch.addEventListener('keyup', (e) => {
            const term = e.target.value.toLowerCase();
            const nodes = document.querySelectorAll('.tree-node');
            
            if (term === '') {
                nodes.forEach(n => {
                    n.style.display = 'block';
                    n.classList.remove('expanded');
                });
                return;
            }
            
            nodes.forEach(n => n.style.display = 'none');
            
            nodes.forEach(n => {
                const text = n.querySelector('.tree-label').textContent.toLowerCase();
                if (text.includes(term)) {
                    n.style.display = 'block';
                    
                    const descendants = n.querySelectorAll('.tree-node');
                    descendants.forEach(d => d.style.display = 'block');
                    
                    let parent = n.parentElement.closest('.tree-node');
                    while (parent) {
                        parent.style.display = 'block';
                        parent.classList.add('expanded');
                        parent = parent.parentElement.closest('.tree-node');
                    }
                }
            });
        });
    }
}

function setupFilters() {
    const pills = document.querySelectorAll('.pill');
    pills.forEach(pill => {
        pill.addEventListener('click', (e) => {
            pills.forEach(p => p.classList.remove('active'));
            const target = e.target;
            target.classList.add('active');
            
            const filter = target.getAttribute('data-filter');
            const items = document.querySelectorAll('.image-list-item');
            
            items.forEach(item => {
                if (filter === 'ALL') {
                    item.style.display = 'flex';
                } else {
                    // Cerca il meta-tag che contiene LBL o RAW
                    const tags = item.querySelectorAll('.meta-tag');
                    let hasTag = false;
                    tags.forEach(t => {
                        if (t.textContent === filter) hasTag = true;
                    });
                    
                    if (hasTag) {
                        item.style.display = 'flex';
                    } else {
                        item.style.display = 'none';
                    }
                }
            });
        });
    });
}

const state = {
    selectedPath: {}
};

let scale = 1, panning = false, pointX = 0, pointY = 0, start = { x: 0, y: 0 };

// Modal Setup
function setupModal() {
    const modal = document.getElementById('image-modal');
    const closeBtn = document.querySelector('.close-modal');

    if(closeBtn) {
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }

    if(modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    }
}

// 1. Fetch Taxonomy
async function fetchTaxonomy() {
    const treeContainer = document.getElementById('taxonomy-tree');
    try {
        const response = await fetch('/api/taxonomy');
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();
        
        treeContainer.innerHTML = '';
        if (Object.keys(data).length === 0) {
            treeContainer.innerHTML = '<div class="loading">Nessun dato nel database.</div>';
            return;
        }

        const treeHTML = buildTree(data, ['control_type', 'station', 'machine_serial', 'format_type', 'upload_date', 'folder_class'], 0);
        treeContainer.appendChild(treeHTML);
        
    } catch (error) {
        console.error('Error fetching taxonomy:', error);
        treeContainer.innerHTML = '<div class="loading">Errore nel caricamento della tassonomia.</div>';
    }
}

// 2. Build Recursive Tree DOM
function buildTree(nodeData, levelNames, currentLevelIndex) {
    const container = document.createElement('div');
    container.className = 'tree-children';
    // Il primo livello è sempre visibile
    if (currentLevelIndex === 0) {
        container.style.display = 'block';
        container.style.marginLeft = '0';
        container.style.borderLeft = 'none';
        container.style.paddingLeft = '0';
    }

    const currentLevelName = levelNames[currentLevelIndex];
    const isLeafLevel = (currentLevelIndex === levelNames.length - 1);

    if (Array.isArray(nodeData)) {
        // È il livello foglia (folder_class)
        nodeData.forEach(leafVal => {
            const nodeEl = createNodeElement(leafVal, currentLevelName, true, leafVal, currentLevelIndex === 0, currentLevelIndex);
            container.appendChild(nodeEl);
        });
    } else {
        // Oggetto intermedio
        for (const [key, childData] of Object.entries(nodeData)) {
            const nodeEl = createNodeElement(key, currentLevelName, false, null, currentLevelIndex === 0, currentLevelIndex);
            const childrenEl = buildTree(childData, levelNames, currentLevelIndex + 1);
            nodeEl.appendChild(childrenEl);
            container.appendChild(nodeEl);
        }
    }

    return container;
}

function createNodeElement(value, levelName, isLeaf, leafVal = null, isLevelZero = false, levelIndex = 0) {
    const node = document.createElement('div');
    node.className = 'tree-node';
    node.setAttribute('data-value', value);
    node.setAttribute('data-level', levelIndex);
    if (!isLevelZero) node.classList.add('sub-level');

    const label = document.createElement('div');
    label.className = 'tree-label';
    
    // Icona a sinistra solo per livello 0
    if (isLevelZero) {
        const iconLeft = document.createElement('i');
        iconLeft.className = 'bx bx-camera tree-icon-left';
        label.appendChild(iconLeft);
    }

    // Testo
    const text = document.createElement('span');
    text.textContent = value;
    label.appendChild(text);
    
    // Chevron a destra solo per livello 0 se ha figli
    if (isLevelZero && !isLeaf) {
        const iconRight = document.createElement('i');
        iconRight.className = 'bx bx-chevron-right tree-icon-right';
        label.appendChild(iconRight);
    }

    // Se è foglia, metti un badge
    if (isLeaf) {
        const badge = document.createElement('span');
        badge.className = 'leaf-badge';
        const isRaw = ['UNLABELED', 'NESSUNA_ANNOTAZIONE', 'RAW', 'UNANNOTATED'].includes(value);
        badge.textContent = isRaw ? 'RAW' : 'LBL';
        if (isRaw) badge.style.backgroundColor = '#94a3b8';
        label.appendChild(badge);
    }

    node.appendChild(label);

    // Event Listener
    label.addEventListener('click', (e) => {
        e.stopPropagation(); // Evita bubble up
        
        // Se ha figli, fai toggle (accordion)
        if (!isLeaf) {
            node.classList.toggle('expanded');
        }
        
        // Seleziona il nodo
        document.querySelectorAll('.tree-label').forEach(el => el.classList.remove('active'));
        label.classList.add('active');
        
        // Ricostruisci il path navigando verso l'alto
        const pathData = {};
        let currNode = node;
        const levelKeys = ['control_type', 'station', 'machine_serial', 'format_type', 'upload_date', 'folder_class'];
        let idx = parseInt(currNode.getAttribute('data-level'));
        
        while (currNode && currNode.classList.contains('tree-node') && idx >= 0) {
            pathData[levelKeys[idx]] = currNode.getAttribute('data-value');
            idx--;
            currNode = currNode.parentElement.closest('.tree-node');
        }
        
        fetchImages(pathData);
        updateBreadcrumb(pathData);
    });

    return node;
}

// 3. Update Breadcrumb
function updateBreadcrumb(pathData) {
    const bc = document.getElementById('breadcrumb');
    const levelKeys = ['control_type', 'station', 'machine_serial', 'format_type', 'upload_date', 'folder_class'];
    const parts = [];
    levelKeys.forEach(k => {
        if (pathData[k]) {
            if (k === 'folder_class') parts.push(`<span>${pathData[k]}</span>`);
            else parts.push(pathData[k]);
        }
    });
    
    bc.innerHTML = parts.join(' / ');
}

let currentImages = [];
let currentSelectedIndex = 0;

let currentFetchController = null;

async function fetchImages(pathData) {
    if (currentFetchController) {
        currentFetchController.abort();
    }
    currentFetchController = new AbortController();
    const signal = currentFetchController.signal;

    const viewer = document.getElementById('image-viewer');
    const imageList = document.getElementById('image-list');
    const stats = document.getElementById('gallery-stats');
    
    // Reset filtri pill a ALL
    document.querySelectorAll('.pill').forEach(p => {
        if (p.getAttribute('data-filter') === 'ALL') {
            p.classList.add('active');
        } else {
            p.classList.remove('active');
        }
    });
    
    document.getElementById('viewport-card').style.display = 'none';
    const emptyState = document.getElementById('viewer-empty-state');
    emptyState.style.display = 'block';
    emptyState.textContent = 'Caricamento elenco immagini...';
    
    stats.textContent = '';
    
    imageList.innerHTML = '<div class="loading" style="padding: 16px;">Caricamento...</div>';

    try {
        const params = new URLSearchParams(pathData);
        const response = await fetch(`/api/images?${params.toString()}`, { signal });
        if (!response.ok) throw new Error('Network response was not ok');
        const images = await response.json();
        currentImages = images;

        stats.textContent = `${images.length} immagini trovate`;

        if (images.length === 0) {
            emptyState.textContent = 'Nessuna immagine in questa cartella.';
            imageList.innerHTML = '<div class="empty-state" style="padding: 16px;">Nessuna immagine</div>';
            updateChart();
            return;
        }

        imageList.innerHTML = '';
        images.forEach((img, index) => {
            const item = document.createElement('div');
            item.className = 'image-list-item';
            
            const sampleName = `Sample #${String(index + 1).padStart(3, '0')}`;
            item.title = img.file_name;
            item.id = `img-item-${index}`;
            item.onclick = () => renderSingleImage(index);
            
            const textSpan = document.createElement('span');
            textSpan.textContent = sampleName;
            
            const badgeContainer = document.createElement('div');
            badgeContainer.style.display = 'flex';
            badgeContainer.style.gap = '8px';
            
            const badgeSpan = document.createElement('span');
            badgeSpan.className = 'meta-tag';
            const w = img.width || '?';
            const h = img.height || '?';
            badgeSpan.textContent = `${w}x${h}`;
            
            const badgeSpan2 = document.createElement('span');
            badgeSpan2.className = 'meta-tag';
            const detMode = ['UNANNOTATED', 'NESSUNA_ANNOTAZIONE', 'RAW', 'UNLABELED'].includes(img.detection_mode) ? 'RAW' : 'LBL';
            badgeSpan2.textContent = detMode;
            badgeSpan2.style.backgroundColor = detMode === 'RAW' ? 'rgba(255,255,255,0.1)' : 'rgba(3, 243, 255, 0.2)';
            
            badgeContainer.appendChild(badgeSpan);
            badgeContainer.appendChild(badgeSpan2);
            
            item.appendChild(textSpan);
            item.appendChild(badgeContainer);
            
            imageList.appendChild(item);
        });
        
        // Show first image automatically
        renderSingleImage(0);
        updateChart();

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Fetch abortita (nuova richiesta in arrivo).');
            return;
        }
        console.error('Error fetching images:', error);
        emptyState.textContent = 'Errore nel caricamento delle immagini.';
        imageList.innerHTML = '<div class="empty-state" style="padding: 16px;">Errore</div>';
    }
}

function updateChart() {
    const ctx = document.getElementById('statsChart');
    if (!ctx) return;
    
    if (statsChartInstance) {
        statsChartInstance.destroy();
    }
    
    if (currentImages.length === 0) return;
    
    // Aggregazione per classe
    const classCounts = {};
    let rawCount = 0;
    let lblCount = 0;
    const uniqueDates = new Set();
    const uniqueStations = new Set();
    
    currentImages.forEach(img => {
        const cls = img.folder_class || 'Sconosciuta';
        classCounts[cls] = (classCounts[cls] || 0) + 1;
        
        if (img.detection_mode === 'UNANNOTATED') rawCount++;
        else lblCount++;
        
        if (img.upload_date) uniqueDates.add(img.upload_date);
        if (img.station) uniqueStations.add(img.station);
    });
    
    const labels = Object.keys(classCounts);
    const data = Object.values(classCounts);
    
    // Genera una palette di colori tech
    const palette = ['#00f3ff', '#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e', '#f59e0b', '#10b981', '#848cac'];
    const backgroundColors = labels.map((_, i) => palette[i % palette.length]);
    
    statsChartInstance = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: backgroundColors,
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'left',
                    labels: { color: '#ffffff', boxWidth: 12 }
                }
            }
        }
    });
    
    // Aggiorna pannello info extra
    const extraInfo = document.getElementById('drawer-extra-info');
    if (extraInfo) {
        extraInfo.innerHTML = `
            <h3 style="color: white; margin-bottom: 12px; font-weight: 600; font-size: 1.1rem;">Riepilogo Dataset</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div>
                    <div style="font-size: 0.8rem; text-transform: uppercase;">Totale Immagini</div>
                    <div style="color: white; font-size: 1.2rem; font-weight: bold;">${currentImages.length}</div>
                </div>
                <div>
                    <div style="font-size: 0.8rem; text-transform: uppercase;">Classi Distinte</div>
                    <div style="color: white; font-size: 1.2rem; font-weight: bold;">${labels.length}</div>
                </div>
                <div>
                    <div style="font-size: 0.8rem; text-transform: uppercase;">Annotate (LBL)</div>
                    <div style="color: #00f3ff; font-size: 1.2rem; font-weight: bold;">${lblCount}</div>
                </div>
                <div>
                    <div style="font-size: 0.8rem; text-transform: uppercase;">Grezze (RAW)</div>
                    <div style="color: #848cac; font-size: 1.2rem; font-weight: bold;">${rawCount}</div>
                </div>
            </div>
            
            <div style="margin-top: 16px; font-size: 0.85rem; padding-top: 12px; border-top: 1px solid var(--glass-border);">
                <div><strong>Stazioni di origine:</strong> ${Array.from(uniqueStations).join(', ') || 'N/D'}</div>
                <div style="margin-top: 4px;"><strong>Date Acquisizione:</strong> ${Array.from(uniqueDates).join(', ') || 'N/D'}</div>
            </div>
        `;
    }
}

function renderSingleImage(indexStr, preserveView = false) {
    const index = parseInt(indexStr);
    if(isNaN(index)) return;
    
    const img = currentImages[index];
    if(!img) return;
    
    currentSelectedIndex = index;
    
    // Aggiorna la classe active nella lista a destra e fai scroll
    document.querySelectorAll('.image-list-item').forEach(el => el.classList.remove('active'));
    const activeItem = document.getElementById(`img-item-${index}`);
    if (activeItem) {
        activeItem.classList.add('active');
        activeItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    
    const width = img.width || '?';
    const height = img.height || '?';
    const detMode = ['UNANNOTATED', 'NESSUNA_ANNOTAZIONE', 'RAW', 'UNLABELED'].includes(img.detection_mode) ? 'RAW' : 'LBL';
    
    // Mostra il viewport card e nascondi empty state
    document.getElementById('viewer-empty-state').style.display = 'none';
    const card = document.getElementById('viewport-card');
    card.style.display = 'flex';
    
    // Mostra/Nascondi pulsanti
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    if(btnPrev) {
        btnPrev.style.display = index > 0 ? 'flex' : 'none';
        btnPrev.onclick = () => renderSingleImage(index - 1);
    }
    if(btnNext) {
        btnNext.style.display = index < currentImages.length - 1 ? 'flex' : 'none';
        btnNext.onclick = () => renderSingleImage(index + 1);
    }
    
    // Update image
    const viewerImg = document.getElementById('viewer-img');
    
    viewerImg.onload = () => {
        viewerImg.style.transformOrigin = "0 0";
        viewerImg.style.transform = `translate(${pointX}px, ${pointY}px) scale(${scale})`;
    };
    
    viewerImg.src = `/api/render/${img.id}?draw_boxes=${showBoxes}`;
    viewerImg.alt = img.file_name;
    
    // Update status bar
    document.getElementById('statusbar-filename').textContent = img.file_name;
    document.getElementById('statusbar-resolution').textContent = `${width}x${height}`;
    
    const badge = document.getElementById('statusbar-detmode');
    badge.textContent = detMode;
    badge.style.backgroundColor = detMode === 'RAW' ? 'rgba(255,255,255,0.1)' : 'rgba(3, 243, 255, 0.2)';
    
    // Reset Pan & Zoom
    if (!preserveView) {
        scale = 1;
        panning = false;
        pointX = 0;
        pointY = 0;
        start = { x: 0, y: 0 };
    }
    
    // Also enforce immediately (useful if image is cached)
    viewerImg.style.transformOrigin = "0 0";
    viewerImg.style.transform = `translate(${pointX}px, ${pointY}px) scale(${scale})`;
}

// Global Keyboard Navigation
document.addEventListener('keydown', (e) => {
    if(currentImages.length === 0) return;
    
    if (e.key === 'ArrowLeft' && currentSelectedIndex > 0) {
        renderSingleImage(currentSelectedIndex - 1);
    } else if (e.key === 'ArrowRight' && currentSelectedIndex < currentImages.length - 1) {
        renderSingleImage(currentSelectedIndex + 1);
    }
});

function setupImportModal() {
    const btnOpen = document.getElementById('btn-open-import');
    const modal = document.getElementById('import-modal');
    const btnClose = document.querySelector('.close-import');
    const btnExecute = document.getElementById('btn-execute-import');
    const statusDiv = document.getElementById('import-status');
    const hdictSelect = document.getElementById('hdict-select');
    const btnRefresh = document.getElementById('btn-refresh-dicts');

    async function fetchDicts() {
        if (!hdictSelect) return;
        const dataList = document.getElementById('list-hdicts');
        hdictSelect.placeholder = 'Caricamento dizionari...';
        try {
            const response = await fetch('/api/dropzone-dicts');
            const data = await response.json();
            
            if (dataList) dataList.innerHTML = '';
            if (data.status === 'success' && data.files.length > 0) {
                hdictSelect.placeholder = 'Seleziona dizionario...';
                const htmlList = data.files.map(file => `<div class="custom-autocomplete-item" data-val="${file}">${file}</div>`).join('');
                if (dataList) {
                    dataList.innerHTML = htmlList;
                    dataList.querySelectorAll('.custom-autocomplete-item').forEach(item => {
                        item.addEventListener('click', (e) => {
                            hdictSelect.value = e.target.dataset.val;
                            dataList.classList.remove('show');
                        });
                    });
                }
            } else {
                hdictSelect.placeholder = data.message || 'Nessun file .hdict trovato';
            }
        } catch (err) {
            hdictSelect.placeholder = 'Errore di connessione';
            console.error(err);
        }
    }

    async function fetchTaxonomyOptions() {
        try {
            const res = await fetch('/api/taxonomy-options');
            const data = await res.json();
            if (data.status === 'success') {
                const populate = (id, items) => {
                    const dl = document.getElementById(id);
                    if (!dl) return;
                    dl.innerHTML = '';
                    items.forEach(val => {
                        const opt = document.createElement('option');
                        opt.value = val;
                        dl.appendChild(opt);
                    });
                };
                populate('list-control-type', data.options.control_type || []);
                populate('list-station', data.options.station || []);
                populate('list-machine-serial', data.options.machine_serial || []);
                populate('list-format-type', data.options.format_type || []);
            }
        } catch (err) {
            console.error("Errore fetch taxonomy:", err);
        }
    }

    if(btnRefresh) {
        btnRefresh.addEventListener('click', fetchDicts);
    }

    if(btnOpen && modal) {
        btnOpen.addEventListener('click', () => {
            if(document.getElementById('tax-control-type')) document.getElementById('tax-control-type').value = '';
            if(document.getElementById('tax-station')) document.getElementById('tax-station').value = '';
            if(document.getElementById('tax-machine-serial')) document.getElementById('tax-machine-serial').value = '';
            if(document.getElementById('tax-format-type')) document.getElementById('tax-format-type').value = '';
            if(document.getElementById('tax-matricola')) document.getElementById('tax-matricola').value = '';
            statusDiv.textContent = '';
            
            modal.classList.add('show');
            fetchDicts();
            fetchTaxonomyOptions();
        });
    }
    
    if(btnClose) {
        btnClose.addEventListener('click', () => {
            modal.classList.remove('show');
        });
    }
    
    const conflictModal = document.getElementById('conflict-modal');
    const btnCloseConflict = document.getElementById('btn-close-conflict');
    const btnCancelConflict = document.getElementById('btn-cancel-conflict');
    const btnConfirmConflict = document.getElementById('btn-confirm-conflict');
    
    const handleConflictCancel = () => {
        if (conflictModal) conflictModal.classList.remove('show');
        const executeBtn = document.getElementById('btn-execute-import');
        if (executeBtn) executeBtn.disabled = false;
        const statusDiv = document.getElementById('import-status');
        if (statusDiv) {
            statusDiv.textContent = 'Risoluzione conflitti annullata.';
            statusDiv.style.color = 'var(--text-muted)';
        }
    };
    
    if (btnCloseConflict) btnCloseConflict.addEventListener('click', handleConflictCancel);
    if (btnCancelConflict) btnCancelConflict.addEventListener('click', handleConflictCancel);
    
    // Funzione helper per l'importazione finale
    async function executeFinalImport(payload, btn, skipNavigation) {
        try {
            const response = await fetch('/api/import-network', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            const data = await response.json();
            
            if (data.status === 'success') {
                statusDiv.textContent = data.message;
                statusDiv.style.color = 'var(--primary-color)';
                
                fetchDicts(); // refresh list after import
                fetchTaxonomyOptions(); // refresh taxonomy
                await fetchTaxonomy(); // refresh the sidebar tree
                
                // Chiudi modale dopo 1.5 secondi
                setTimeout(() => {
                    modal.classList.remove('show');
                    if (conflictModal) conflictModal.classList.remove('show');
                    
                    if (!skipNavigation && data.data && data.data.final_taxonomy) {
                        // Espandi la gerarchia verso il nuovo dataset (usando la tassonomia finale applicata)
                        const finalTax = data.data.final_taxonomy;
                        const pathArray = [finalTax.control_type, finalTax.station, finalTax.machine_serial, finalTax.format_type];
                        let currentContainer = document.getElementById('taxonomy-tree');
                        
                        for (let i = 0; i < pathArray.length; i++) {
                            const val = pathArray[i];
                            const nodes = Array.from(currentContainer.querySelectorAll(`.tree-node[data-level="${i}"]`));
                            const node = nodes.find(n => n.getAttribute('data-value') === val);
                            
                            if (node) {
                                if (!node.classList.contains('expanded')) {
                                    node.classList.add('expanded');
                                }
                                currentContainer = node;
                                
                                if (i === pathArray.length - 1) {
                                    const label = node.querySelector('.tree-label');
                                    if (label) {
                                        label.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                        label.click();
                                    }
                                }
                            } else {
                                break;
                            }
                        }
                    }
                }, 1500);
                
                // Reset fields except those usually persistent
                document.getElementById('tax-matricola').value = '';
            } else {
                statusDiv.textContent = data.message || "Errore sconosciuto";
                statusDiv.style.color = '#ef4444';
            }
        } catch (error) {
            statusDiv.textContent = 'Errore di rete durante la connessione.';
            statusDiv.style.color = '#ef4444';
            console.error(error);
        } finally {
            if (btn) btn.disabled = false;
        }
    }
    
    if(btnExecute) {
        btnExecute.addEventListener('click', async () => {
            if (hdictSelect && !hdictSelect.value) {
                statusDiv.textContent = 'Nessun dizionario selezionato.';
                statusDiv.style.color = '#ef4444';
                return;
            }
            
            const ctrlType = document.getElementById('tax-control-type').value.trim();
            const station = document.getElementById('tax-station').value.trim();
            const serial = document.getElementById('tax-machine-serial').value.trim();
            const format = document.getElementById('tax-format-type').value.trim();
            const matricola = document.getElementById('tax-matricola').value.trim();
            
            if (!ctrlType || !station || !serial || !format) {
                statusDiv.textContent = 'Compila tutti i campi tassonomici obbligatori (*).';
                statusDiv.style.color = '#ef4444';
                return;
            }
            
            btnExecute.disabled = true;
            statusDiv.textContent = 'Analisi dizionario in corso (Dry-Run)...';
            statusDiv.style.color = 'var(--text-muted)';
            
            const deleteSource = document.getElementById('delete-source').checked;
            const selectedFile = hdictSelect ? hdictSelect.value : "";
            
            const payload = {
                hdict_file: selectedFile, 
                delete_source: deleteSource,
                control_type: ctrlType,
                station: station,
                machine_serial: serial,
                format_type: format,
                matricola: matricola,
                check_only: true, // Eseguiamo solo il check prima!
                update_duplicates: false,
                merge_new_with_old_date: false
            };
            
            try {
                const response = await fetch('/api/import-network', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                
                const data = await response.json();
                
                if (data.status === 'success') {
                    // Controllo Conflitti
                    if (data.duplicate_count > 0) {
                        statusDiv.textContent = 'Azione richiesta: Risoluzione Conflitti.';
                        statusDiv.style.color = '#f59e0b';
                        
                        document.getElementById('conflict-desc').innerHTML = `L'analisi ha rilevato <strong>${data.duplicate_count} doppioni</strong> e <strong>${data.new_count} nuove immagini</strong>.<br>Come vuoi procedere?`;
                        
                        const dupSection = document.getElementById('conflict-duplicates-section');
                        dupSection.style.display = 'block';
                        
                        const newSection = document.getElementById('conflict-new-section');
                        newSection.style.display = (data.new_count > 0) ? 'block' : 'none';
                        
                        conflictModal.classList.add('show');
                        
                        // Setup event listener per la conferma (rimuovi vecchi listener prima)
                        const newConfirmBtn = btnConfirmConflict.cloneNode(true);
                        btnConfirmConflict.parentNode.replaceChild(newConfirmBtn, btnConfirmConflict);
                        
                        newConfirmBtn.addEventListener('click', () => {
                            newConfirmBtn.disabled = true;
                            newConfirmBtn.textContent = 'Importazione in corso...';
                            
                            payload.check_only = false;
                            
                            // Leggi le scelte dell'utente
                            const optDup = document.querySelector('input[name="opt-duplicates"]:checked').value;
                            payload.update_duplicates = (optDup === 'update');
                            
                            if (data.new_count > 0) {
                                const optNew = document.querySelector('input[name="opt-new"]:checked').value;
                                payload.merge_new_with_old_date = (optNew === 'merge');
                            }
                            
                            statusDiv.textContent = 'Import finale in corso, attendere... (il processo potrebbe richiedere alcuni minuti)';
                            statusDiv.style.color = 'var(--text-muted)';
                            
                            const skipNav = (data.new_count === 0 && !payload.update_duplicates);
                            executeFinalImport(payload, newConfirmBtn, skipNav);
                        });
                        
                    } else {
                        // Zero doppioni, vai liscio!
                        statusDiv.textContent = 'Nessun conflitto rilevato. Import in corso, attendere...';
                        payload.check_only = false;
                        executeFinalImport(payload, btnExecute, false);
                    }
                } else {
                    statusDiv.textContent = data.message || "Errore sconosciuto durante l'analisi";
                    statusDiv.style.color = '#ef4444';
                    btnExecute.disabled = false;
                }
            } catch (error) {
                statusDiv.textContent = 'Errore di rete durante la connessione.';
                statusDiv.style.color = '#ef4444';
                console.error(error);
                btnExecute.disabled = false;
            }
        });
    }
}


/* --- DATASET BUILDER WIZARD LOGIC --- */
let currentExportStep = 1;
let exportFilters = {
    control_type: null,
    machine_serials: [],
    format_type: []
};
let classMapping = {};

document.addEventListener('DOMContentLoaded', () => {
    // Setup Dataset Builder Modal
    const btnOpenExport = document.getElementById('btn-open-export');
    const btnCloseExport = document.getElementById('btn-close-export');
    const exportModal = document.getElementById('export-modal');
    
    if (btnOpenExport && exportModal) {
        btnOpenExport.addEventListener('click', () => {
            exportModal.classList.add('show');
            currentExportStep = 1;
            exportFilters = { control_type: null, machine_serials: [], format_type: [] };
            
            
            document.getElementById('btn-export-generate').style.display = 'none';
            fetchExportFilters(currentExportStep);
        });
    }
    
    if (btnCloseExport && exportModal) {
        btnCloseExport.addEventListener('click', () => {
            exportModal.classList.remove('show');
        });
    }

    const btnNext = document.getElementById('btn-export-next');
    const btnPrev = document.getElementById('btn-export-prev');
    const btnGenerate = document.getElementById('btn-export-generate');

    if (btnNext) {
        btnNext.addEventListener('click', () => {
            if (currentExportStep < 4) {
                // Raccogli i dati dello step corrente prima di avanzare
                if (currentExportStep === 1) {
                    const selected = document.querySelector('.export-option-card.selected');
                    if (!selected) { alert('Seleziona un Control Type'); return; }
                    exportFilters.control_type = selected.dataset.value;
                } else if (currentExportStep === 2) {
                    const selected = Array.from(document.querySelectorAll('.export-option-card.selected')).map(el => el.dataset.value);
                    if (selected.length === 0) { alert('Seleziona almeno un seriale'); return; }
                    exportFilters.machine_serials = selected;
                } else if (currentExportStep === 3) {
                    const selected = Array.from(document.querySelectorAll('.export-option-card.selected')).map(el => el.dataset.value);
                    if (selected.length === 0) { alert('Seleziona almeno un Formato'); return; }
                    exportFilters.format_type = selected; // Now an array
                }
                
                currentExportStep++;
                fetchExportFilters(currentExportStep);
            }
        });
    }

    if (btnPrev) {
        btnPrev.addEventListener('click', () => {
            if (currentExportStep > 1) {
                currentExportStep--;
                fetchExportFilters(currentExportStep);
            }
        });
    }

    if (btnGenerate) {
        btnGenerate.addEventListener('click', () => {
            // Raccogli il class mapping in anticipo
            classMapping = {};
            document.querySelectorAll('.class-toggle-pill.included').forEach(pill => {
                const originalClass = pill.dataset.original;
                const inputEl = document.getElementById(`input-map-${originalClass}`);
                const newClass = inputEl ? inputEl.value.trim() : originalClass;
                if (newClass) {
                    classMapping[originalClass] = newClass;
                }
            });
            
            // Apri modale per chiedere il nome
            const nameModal = document.getElementById('export-name-modal');
            const nameInput = document.getElementById('final-export-name-input');
            nameInput.value = '';
            nameModal.classList.add('show');
            nameInput.focus();
        });
    }
    
    // Gestione Modale Nome Export
    const btnCancelExportName = document.getElementById('btn-cancel-export-name');
    const btnConfirmExportName = document.getElementById('btn-confirm-export-name');
    const nameModal = document.getElementById('export-name-modal');
    
    if (btnCancelExportName) {
        btnCancelExportName.addEventListener('click', () => {
            nameModal.classList.remove('show');
        });
    }
    
    if (btnConfirmExportName) {
        btnConfirmExportName.addEventListener('click', () => {
            const exportName = document.getElementById('final-export-name-input').value.trim();
            if (!exportName) {
                alert("Devi inserire un nome per il dataset.");
                return;
            }
            
            nameModal.classList.remove('show');
            document.getElementById('export-modal').classList.remove('show'); // Chiudi anche il wizard base
            
            const payload = {
                export_name: exportName,
                filters: exportFilters,
                class_mapping: classMapping
            };

            console.log("=== DATASET BUILDER PAYLOAD ===");
            console.log(JSON.stringify(payload, null, 2));
            console.log("===============================");
            alert(`Payload di export "${exportName}" generato! Controlla la console.`);
        });
    }
});

async function fetchExportFilters(step) {
    const container = document.getElementById('export-step-content');
    container.innerHTML = '<div class="loading">Caricamento opzioni...</div>';
    
    // Aggiorna timeline
    document.querySelectorAll('.wizard-step').forEach(el => {
        const s = parseInt(el.dataset.step);
        el.classList.remove('active', 'completed');
        if (s === step) el.classList.add('active');
        else if (s < step) el.classList.add('completed');
    });

    // Aggiorna bottoni
    document.getElementById('btn-export-prev').style.display = step > 1 ? 'block' : 'none';
    document.getElementById('btn-export-next').style.display = step < 4 ? 'block' : 'none';
    document.getElementById('btn-export-generate').style.display = step === 4 ? 'block' : 'none';
    

    // Prepara la richiesta a cascata
    let reqBody = {
        control_type: step > 1 ? exportFilters.control_type : null,
        machine_serials: step > 2 ? exportFilters.machine_serials : null,
        format_type: step > 3 ? exportFilters.format_type : null
    };

    try {
        const response = await fetch('/api/export/filters', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reqBody)
        });
        
        if (!response.ok) throw new Error('Errore nel caricamento filtri');
        const data = await response.json();
        
        renderExportStep(step, data.options);
    } catch (e) {
        container.innerHTML = `<div class="loading" style="color: #ff4757;">Errore: ${e.message}</div>`;
    }
}

function renderExportStep(step, options) {
    const container = document.getElementById('export-step-content');
    
    if (!options || options.length === 0) {
        container.innerHTML = '<div class="loading">Nessuna opzione disponibile per questa selezione.</div>';
        return;
    }

    if (step === 1) {
        // Single Selection (Control Type / Format Type)
        let html = `<h3 style="margin-top:0; color:var(--text-color);">Seleziona ${step === 1 ? 'Control Type' : 'Format Type'}</h3>`;
        html += `<div class="export-options-grid">`;
        options.forEach(opt => {
            html += `<div class="export-option-card single-select" data-value="${opt}">${opt}</div>`;
        });
        html += `</div>`;
                container.innerHTML = html;
        
        document.querySelectorAll('.class-include-cb').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const inputEl = document.getElementById(`input-map-${e.target.dataset.original}`);
                if (inputEl) {
                    inputEl.disabled = !e.target.checked;
                    inputEl.style.opacity = e.target.checked ? '1' : '0.4';
                }
            });
        });

        document.querySelectorAll('.export-option-card.single-select').forEach(card => {
            card.addEventListener('click', (e) => {
                document.querySelectorAll('.export-option-card.single-select').forEach(c => c.classList.remove('selected'));
                e.target.classList.add('selected');
            });
        });
    } else if (step === 2 || step === 3) {
        // Multi Selection (Machine Serials / Format)
        let html = `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                        <h3 style="margin:0; color:var(--text-color);">Seleziona ${step === 2 ? "Machine Serials" : "Format Type"}</h3>
                        <button class="glass-btn glass-btn-primary" id="btn-select-all-serials" style="padding: 8px 16px; font-size: 0.9rem; border-radius: 8px; border: 1px solid rgba(0, 243, 255, 0.4); background: rgba(0, 243, 255, 0.1); color: #00f3ff; font-weight: 500; transition: all 0.2s;"><i class='bx bx-check-double'></i> Select All</button>
                    </div>`;
        html += `<div class="export-options-grid">`;
        options.forEach(opt => {
            html += `<div class="export-option-card multi-select" data-value="${opt}">${opt}</div>`;
        });
        html += `</div>`;
                container.innerHTML = html;
        
        document.querySelectorAll('.class-include-cb').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const inputEl = document.getElementById(`input-map-${e.target.dataset.original}`);
                if (inputEl) {
                    inputEl.disabled = !e.target.checked;
                    inputEl.style.opacity = e.target.checked ? '1' : '0.4';
                }
            });
        });

        let allSelected = false;
        document.getElementById('btn-select-all-serials').addEventListener('click', () => {
            allSelected = !allSelected;
            document.querySelectorAll('.export-option-card.multi-select').forEach(card => {
                if(allSelected) card.classList.add('selected');
                else card.classList.remove('selected');
            });
        });

        document.querySelectorAll('.export-option-card.multi-select').forEach(card => {
            card.addEventListener('click', (e) => {
                e.target.classList.toggle('selected');
            });
        });
    } else if (step === 4) {
        // Class Mapping
        let html = `<h3 style="margin-top:0; color:var(--text-color);">Class Aggregation & Mapping</h3>
                    <p style="color: rgba(255,255,255,0.6); margin-bottom: 16px;">Clicca sul nome della Classe Originale per includerla/escluderla dall'export. Modifica il campo a destra per ridenominarla.</p>`;
        
        
        // Strumento Bulk Mapping e Reset
        html += `<div class="paint-bucket-bar" style="display: flex; justify-content: space-between; margin: 0 auto 16px auto; align-items: center; background: rgba(0, 243, 255, 0.05); border: 1px solid rgba(0, 243, 255, 0.2); padding: 12px 24px; border-radius: 8px; max-width: 1000px;">
                    <div style="display: flex; gap: 16px; align-items: center;">
                        <i class='bx bx-layer' style="font-size: 1.5rem; color: #00f3ff;"></i>
                        <span style="color: #00f3ff; font-weight: 600;">Bulk Apply:</span>
                        <div class="custom-autocomplete-container" style="width: 250px;">
                            <input type="text" id="paint-bucket-input" class="glass-input custom-autocomplete-input" placeholder="Classe Target..." style="width: 100%;" autocomplete="off">
                            <div class="custom-autocomplete-list"></div>
                        </div>
                        <span style="color: rgba(255,255,255,0.6); font-size: 0.9rem;">(Inserisci il nome qui e clicca sulle righe per applicarlo)</span>
                    </div>
                    <button class="glass-btn" id="btn-reset-mapping" style="padding: 8px 16px; border-radius: 8px; border-color: rgba(255,87,87,0.5); color: #ff4757; transition: all 0.2s;"><i class='bx bx-reset'></i> Reset Mapping</button>
                </div>`;
        
        html += `<table class="class-mapping-table" style="width: 100%; max-width: 1000px; margin: 0 auto; user-select: none;">
                    <thead><tr><th style="width: 45%;">Classe Originale (Clicca per Escludere)</th><th style="width: 10%;"></th><th style="width: 45%;">Nuovo Nome Export</th></tr></thead>
                    <tbody>`;
        options.forEach(opt => {
            html += `<tr class="mapping-row" style="cursor: cell;">
                        <td>
                            <div class="class-toggle-pill included" data-original="${opt}" style="background: rgba(0,243,255,0.15); border: 1px solid #00f3ff; color: #00f3ff; padding: 10px 16px; border-radius: 8px; cursor: pointer; display: inline-block; transition: all 0.2s; font-weight: bold;">
                                <i class='bx bx-check' style="margin-right: 4px;"></i>${opt}
                            </div>
                        </td>
                        <td style="text-align: center; pointer-events: none;"><div class="mapping-arrow" style="font-size: 1.5rem; color: #00f3ff;"><i class='bx bx-right-arrow-alt'></i></div></td>
                        <td>
                            <div class="custom-autocomplete-container">
                                <input type="text" class="glass-input class-mapping-input custom-autocomplete-input" id="input-map-${opt}" data-original="${opt}" value="${opt}" style="width: 100%; padding: 12px; font-size: 1.05rem;" autocomplete="off">
                                <div class="custom-autocomplete-list"></div>
                            </div>
                        </td>
                     </tr>`;
        });
        html += `</tbody></table>`;
        container.innerHTML = html;
        
        // Logica Secchiello + Animazione marcata
        document.querySelectorAll('.mapping-row').forEach(row => {
            row.addEventListener('click', (e) => {
                // Ignora click su pill, input o dropdown
                if (e.target.closest('.class-toggle-pill') || e.target.closest('.custom-autocomplete-container')) {
                    return;
                }
                
                const bucketVal = document.getElementById('paint-bucket-input').value.trim();
                if (bucketVal) {
                    const inputEl = row.querySelector('.class-mapping-input');
                    if (inputEl && !inputEl.disabled) {
                        inputEl.value = bucketVal;
                        
                        // Feedback visivo potente
                        row.classList.remove('painted-feedback');
                        void row.offsetWidth; // trigger reflow per riavviare animazione
                        row.classList.add('painted-feedback');
                        
                        updateCustomDropdowns();
                    }
                }
            });
        });

        // Logica Reset
        document.getElementById('btn-reset-mapping').addEventListener('click', () => {
            document.querySelectorAll('.class-mapping-input').forEach(inp => {
                inp.value = inp.dataset.original;
            });
            document.querySelectorAll('.class-toggle-pill').forEach(pill => {
                if (!pill.classList.contains('included')) {
                    pill.click(); // Riattiva se disattivata
                }
            });
            updateCustomDropdowns();
        });

        // Logica Dropdown Personalizzato (mostra sempre tutto senza filtrare)
        const updateCustomDropdowns = () => {
            const suggestions = new Set();
            document.querySelectorAll('.class-mapping-input').forEach(inp => {
                const val = inp.value.trim();
                if (val) suggestions.add(val);
            });
            const bucketInput = document.getElementById('paint-bucket-input');
            if (bucketInput && bucketInput.value.trim()) {
                suggestions.add(bucketInput.value.trim());
            }
            
            const htmlList = Array.from(suggestions).map(val => `<div class="custom-autocomplete-item" data-val="${val}">${val}</div>`).join('');
            
            // Aggiorna solo le tendine dentro lo step 4 (Class Mapping)
            document.querySelectorAll('#export-step-content .custom-autocomplete-list').forEach(list => {
                list.innerHTML = htmlList;
                // Assegna evento click agli item del dropdown
                list.querySelectorAll('.custom-autocomplete-item').forEach(item => {
                    item.addEventListener('click', (e) => {
                        const val = e.target.dataset.val;
                        const input = list.parentElement.querySelector('.custom-autocomplete-input');
                        input.value = val;
                        list.classList.remove('show');
                        updateCustomDropdowns();
                        e.stopPropagation();
                    });
                });
            });
        };

        // Gli eventi focusin e click fuori sono gestiti globalmente.
        // Aggiungiamo solo l'evento input per aggiornare la lista.
        document.querySelectorAll('.class-mapping-input.custom-autocomplete-input').forEach(inp => {
            inp.addEventListener('input', updateCustomDropdowns);
        });

        updateCustomDropdowns();
        
        document.querySelectorAll('.class-toggle-pill').forEach(pill => {
            pill.addEventListener('click', (e) => {
                const el = e.currentTarget;
                const original = el.dataset.original;
                const inputEl = document.getElementById(`input-map-${original}`);
                const arrow = el.parentElement.nextElementSibling.querySelector('.mapping-arrow');
                
                if (el.classList.contains('included')) {
                    // Turn to excluded
                    el.classList.remove('included');
                    el.style.background = 'rgba(255,255,255,0.05)';
                    el.style.borderColor = 'rgba(255,255,255,0.1)';
                    el.style.color = 'rgba(255,255,255,0.4)';
                    el.innerHTML = `<i class='bx bx-x' style="margin-right: 4px;"></i>${original}`;
                    
                    if (inputEl) {
                        inputEl.disabled = true;
                        inputEl.style.opacity = '0.3';
                    }
                    if (arrow) arrow.style.color = 'rgba(255,255,255,0.1)';
                } else {
                    // Turn to included
                    el.classList.add('included');
                    el.style.background = 'rgba(0,243,255,0.15)';
                    el.style.borderColor = '#00f3ff';
                    el.style.color = '#00f3ff';
                    el.innerHTML = `<i class='bx bx-check' style="margin-right: 4px;"></i>${original}`;
                    
                    if (inputEl) {
                        inputEl.disabled = false;
                        inputEl.style.opacity = '1';
                    }
                    if (arrow) arrow.style.color = '#00f3ff';
                }
            });
        });
    }
}
