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

document.addEventListener('DOMContentLoaded', async () => {
    await initClassColors();
    fetchTaxonomy();
    setupModal();
    setupTreeSearch();
    setupAdvancedFilters();
    setupFilters();
    setupViewerStaticEvents();
    setupImportModal();
});

function setupViewerStaticEvents() {
    document.addEventListener('click', (e) => {
        if (e.target.id === 'btn-toggle-boxes') {
            showBoxes = !showBoxes;
            e.target.className = showBoxes ? 'bx bx-show' : 'bx bx-hide';
            
            const singleView = document.getElementById('single-view');
            if (singleView && singleView.style.display !== 'none') {
                renderSingleImage(currentSelectedIndex, true);
            }
            
            document.querySelectorAll('.masonry-card img').forEach(img => {
                const url = new URL(img.src, window.location.origin);
                url.searchParams.set('draw_boxes', showBoxes);
                img.src = url.toString();
            });
        } else if (e.target.closest('#btn-toggle-drawer')) {
            const drawer = document.getElementById('stats-drawer');
            const btn = e.target.closest('#btn-toggle-drawer');
            if (drawer && btn) {
                drawer.classList.toggle('open');
                const icon = btn.querySelector('.toggle-icon');
                if (icon) {
                    icon.className = drawer.classList.contains('open') ? 'bx bx-chevron-down toggle-icon' : 'bx bx-chevron-up toggle-icon';
                }
                btn.classList.toggle('active', drawer.classList.contains('open'));
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

let lastClassDistribution = {};

const HALCON_CLASS_COLORS = [
    '#e6194b', '#f58231', '#ffe119', '#3cb44b', '#42d4f4',
    '#4363d8', '#911eb4', '#f032e6', '#00f3ff', '#dcbeff',
    '#9a6324', '#aaffc3', '#808000', '#ffd8b1', '#000075'
];

let classColorMap = {};

async function initClassColors() {
    try {
        const res = await fetch('/api/taxonomy-options');
        const data = await res.json();
        if (data.status === 'success' && data.options && data.options.class_name) {
            data.options.class_name.forEach((cls, idx) => {
                classColorMap[cls] = HALCON_CLASS_COLORS[idx % HALCON_CLASS_COLORS.length];
            });
        }
    } catch (e) {
        console.error('Error init class colors:', e);
    }
}

function getClassColor(className) {
    if (!className) return 'rgba(255,255,255,0.2)';
    if (!classColorMap[className]) {
        const idx = Object.keys(classColorMap).length;
        classColorMap[className] = HALCON_CLASS_COLORS[idx % HALCON_CLASS_COLORS.length];
    }
    return classColorMap[className];
}

function renderStatsBlock(statsData) {}

function setupAdvancedFilters() {
    const btnToggle = document.getElementById('btn-toggle-filters');
    const panel = document.getElementById('advanced-filters-panel');
    const btnClose = document.getElementById('btn-close-organizer');
    const btnApply = document.getElementById('btn-apply-filters');
    const btnClear = document.getElementById('btn-clear-filters');
    const cbAnyClass = document.getElementById('cb-any-class');
    const cbUnlabeled = document.getElementById('cb-unlabeled');
    const dynamicContainer = document.getElementById('halcon-classes-dynamic');
    
    if (!btnToggle || !panel) return;
    
    // Toggle panel
    const togglePanel = async (forceShow) => {
        const isVisible = panel.style.display !== 'none';
        if (typeof forceShow === 'boolean') {
            panel.style.display = forceShow ? 'flex' : 'none';
        } else {
            panel.style.display = isVisible ? 'none' : 'flex';
        }
        
        btnToggle.classList.toggle('filter-active', panel.style.display !== 'none');
        
        if (panel.style.display !== 'none') {
            await populateFilters();
        }
    };
    
    btnToggle.addEventListener('click', togglePanel);
    if (btnClose) btnClose.addEventListener('click', () => togglePanel(false));
    
    let filtersLoaded = false;
    
    async function populateFilters() {
        if (filtersLoaded) return;
        try {
            const res = await fetch('/api/taxonomy-options');
            const data = await res.json();
            if (data.status !== 'success') return;
            
            const opts = data.options;
            renderGenericChecklist('list-control-type', 'cb-ctrl', opts.control_type || []);
            renderGenericChecklist('list-station', 'cb-sta', opts.station || []);
            renderGenericChecklist('list-machine-serial', 'cb-ser', opts.machine_serial || []);
            renderGenericChecklist('list-format-type', 'cb-fmt', opts.format_type || []);
            
            window.allTaxonomyClasses = opts.class_name || [];
            renderClassChecklist(opts.class_name || []);
            filtersLoaded = true;
        } catch (err) {
            console.error('Errore popolamento filtri:', err);
        }
    }
    
    function triggerFilters() {
        // Debounce if necessary, or just run it
        if(btnApply) btnApply.click();
    }
    
    function renderGenericChecklist(containerId, prefix, items) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';
        items.forEach((item, i) => {
            const id = `${prefix}-${i}`;
            const div = document.createElement('div');
            div.className = 'halcon-class-item';
            div.innerHTML = `
                <input type="checkbox" id="${id}" class="halcon-cb ${prefix}-cb" data-val="${item}" checked style="--cb-color: var(--primary-color);">
                <span class="halcon-color-swatch" style="background: var(--primary-color);"></span>
                <label for="${id}" class="halcon-class-name">${item}</label>
            `;
            container.appendChild(div);
            
            const cb = div.querySelector('input');
            div.addEventListener('click', (e) => {
                if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'LABEL' && !div.classList.contains('disabled-facet')) {
                    cb.checked = !cb.checked;
                    triggerFilters();
                }
            });
            cb.addEventListener('change', () => {
                triggerFilters();
            });
        });
    }
    
    function renderClassChecklist(classes) {
        if (!dynamicContainer) return;
        dynamicContainer.innerHTML = '';
        classes.forEach((cls, i) => {
            const color = getClassColor(cls);
            const id = `cb-class-${i}`;
            
            const item = document.createElement('div');
            item.className = 'halcon-class-item';
            item.innerHTML = `
                <input type="checkbox" id="${id}" class="halcon-cb halcon-class-cb" data-class="${cls}" checked style="--cb-color: ${color};">
                <span class="halcon-color-swatch" style="background: ${color};"></span>
                <label for="${id}" class="halcon-class-name">${cls}</label>
            `;
            
            dynamicContainer.appendChild(item);
            
            const cb = item.querySelector('.halcon-class-cb');
            
            cb.addEventListener('change', () => {
                syncAnyClassToggle();
                triggerFilters();
            });
            
            item.addEventListener('click', (e) => {
                if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'LABEL' && !item.classList.contains('disabled-facet')) {
                    cb.checked = !cb.checked;
                    syncAnyClassToggle();
                    triggerFilters();
                }
            });
        });
    }
    
    function syncAnyClassToggle() {
        const allCbs = document.querySelectorAll('.halcon-class-cb');
        const allChecked = Array.from(allCbs).every(cb => cb.checked);
        const noneChecked = Array.from(allCbs).every(cb => !cb.checked);
        if(cbAnyClass) {
            cbAnyClass.checked = allChecked;
            cbAnyClass.indeterminate = !allChecked && !noneChecked;
        }
    }
    
    if (cbAnyClass) {
        cbAnyClass.addEventListener('change', () => {
            const checked = cbAnyClass.checked;
            document.querySelectorAll('.halcon-class-cb').forEach(cb => {
                cb.checked = checked;
            });
            triggerFilters();
        });
    }
    if (cbUnlabeled) {
        cbUnlabeled.addEventListener('change', () => {
            triggerFilters();
        });
        const unlItem = cbUnlabeled.closest('.halcon-class-item');
        if(unlItem) {
            unlItem.addEventListener('click', (e) => {
                if(e.target.tagName !== 'INPUT' && e.target.tagName !== 'LABEL' && !unlItem.classList.contains('disabled-facet')) {
                    triggerFilters();
                }
            });
        }
    }
    
    const getCheckedValues = (selector) => {
        return Array.from(document.querySelectorAll(selector + ':checked')).map(cb => cb.dataset.val);
    };
    
    // Apply filters
    if (btnApply) {
        btnApply.style.display = 'none'; // Hide apply button since it's auto-updating
        
        btnApply.addEventListener('click', async () => {
            const controlTypes = getCheckedValues('.cb-ctrl-cb');
            const stations = getCheckedValues('.cb-sta-cb');
            const machineSerials = getCheckedValues('.cb-ser-cb');
            const formatTypes = getCheckedValues('.cb-fmt-cb');
            
            const selectedClasses = [];
            document.querySelectorAll('.halcon-class-cb:checked').forEach(cb => {
                selectedClasses.push(cb.dataset.class);
            });
            
            const includeUnlabeled = cbUnlabeled && cbUnlabeled.checked;
            
            const payload = {
                control_types: controlTypes,
                stations: stations,
                machine_serials: machineSerials,
                format_types: formatTypes,
                classes: selectedClasses,
                include_unlabeled: includeUnlabeled
            };
            
            btnApply.disabled = true;
            
            try {
                // Fetch facets first to update UI quickly
                fetch('/api/facets', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }).then(res => res.json()).then(data => {
                    if(data.status === 'success') {
                        const f = data.facets;
                        
                        const updateFacet = (selector, availableSet) => {
                            document.querySelectorAll(selector).forEach(cb => {
                                const val = cb.dataset.val || cb.dataset.class;
                                const item = cb.closest('.halcon-class-item');
                                if(!availableSet.includes(val)) {
                                    item.classList.add('disabled-facet');
                                    item.style.opacity = '0.3';
                                } else {
                                    item.classList.remove('disabled-facet');
                                    item.style.opacity = '1';
                                }
                            });
                        };
                        
                        updateFacet('.cb-ctrl-cb', f.control_type);
                        updateFacet('.cb-sta-cb', f.station);
                        updateFacet('.cb-ser-cb', f.machine_serial);
                        updateFacet('.cb-fmt-cb', f.format_type);
                        updateFacet('.halcon-class-cb', f.class_name);
                        
                        const unlItem = cbUnlabeled ? cbUnlabeled.closest('.halcon-class-item') : null;
                        if(unlItem) {
                            if(!f.unlabeled_available) {
                                unlItem.classList.add('disabled-facet');
                                unlItem.style.opacity = '0.3';
                            } else {
                                unlItem.classList.remove('disabled-facet');
                                unlItem.style.opacity = '1';
                            }
                        }
                    }
                });
                
                // Fetch search results
                const response = await fetch('/api/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await response.json();
                
                if (data.status === 'success') {
                    lastClassDistribution = data.class_distribution || {};
                    
                    const bc = document.getElementById('breadcrumb');
                    bc.innerHTML = `<i class="bx bx-filter-alt" style="margin-right: 4px;"></i> Risultati Data Organizer <span style="color: var(--text-muted); font-size: 0.85rem;">(${data.total} immagini)</span>`;
                    
                    const images = data.images;
                    currentImages = images;
                    
                    const stats = document.getElementById('gallery-stats');
                    stats.textContent = `${images.length} immagini trovate`;
                    
                    const imageList = document.getElementById('masonry-view');
                    const sidebarList = document.getElementById('image-list');
                    const emptyState = document.getElementById('viewer-empty-state');
                    
                    if (images.length === 0) {
                        emptyState.style.display = 'block';
                        emptyState.textContent = 'Nessuna immagine corrisponde ai filtri.';
                        document.getElementById('single-view').style.display = 'none';
                        imageList.style.display = 'none';
                        if(sidebarList) sidebarList.innerHTML = '<div class="empty-state" style="padding: 16px;">Nessun risultato</div>';
                        updateChart();
                        return;
                    }
                    
                    imageList.innerHTML = '';
                    if(sidebarList) sidebarList.innerHTML = '';
                    
                    emptyState.style.display = 'none';
                    document.getElementById('single-view').style.display = 'none';
                    imageList.style.display = 'grid'; // ensure it's shown
                    
                    images.forEach((img, index) => {
                        // 1) Masonry Card
                        const card = document.createElement('div');
                        card.className = 'masonry-card';
                        card.title = img.file_name;
                        card.id = `grid-item-${index}`;
                        card.onclick = () => selectImage(index);
                        card.ondblclick = () => renderSingleImage(index);
                        
                        const imgEl = document.createElement('img');
                        imgEl.src = `/api/render/${img.id}?draw_boxes=${showBoxes}`;
                        imgEl.loading = 'lazy';
                        
                        const overlay = document.createElement('div');
                        overlay.className = 'masonry-card-overlay';
                        
                        const title = document.createElement('div');
                        title.className = 'masonry-card-title';
                        title.textContent = img.file_name;
                        
                        const badges = document.createElement('div');
                        badges.className = 'masonry-card-badges';
                        
                        const badgeSpan = document.createElement('span');
                        badgeSpan.className = 'meta-tag';
                        badgeSpan.textContent = `${img.width || '?'}x${img.height || '?'}`;
                        
                        const badgeSpan2 = document.createElement('span');
                        badgeSpan2.className = 'meta-tag';
                        const detMode = ['UNANNOTATED', 'NESSUNA_ANNOTAZIONE', 'RAW', 'UNLABELED'].includes(img.detection_mode) ? 'RAW' : 'LBL';
                        if (detMode === 'LBL') {
                            const cName = img.folder_class || 'LBL';
                            const color = getClassColor(cName);
                            badgeSpan2.textContent = cName;
                            badgeSpan2.style.backgroundColor = `${color}33`; // 20% opacity
                            badgeSpan2.style.color = color;
                            badgeSpan2.style.borderColor = color;
                            badgeSpan2.style.border = `1px solid ${color}`;
                        } else {
                            badgeSpan2.textContent = 'RAW';
                            badgeSpan2.style.backgroundColor = 'rgba(255,255,255,0.1)';
                        }
                        
                        badges.appendChild(badgeSpan);
                        badges.appendChild(badgeSpan2);
                        
                        overlay.appendChild(title);
                        overlay.appendChild(badges);
                        
                        card.appendChild(imgEl);
                        card.appendChild(overlay);
                        
                        imageList.appendChild(card);
                        
                        // 2) Sidebar List Item
                        if(sidebarList) {
                            const item = document.createElement('div');
                            item.className = 'image-list-item';
                            item.title = img.file_name;
                            item.id = `list-item-${index}`;
                            item.onclick = () => selectImage(index);
                            item.ondblclick = () => renderSingleImage(index);
                            
                            const textSpan = document.createElement('span');
                            textSpan.textContent = `Sample #${String(index + 1).padStart(3, '0')}`;
                            
                            const sBadges = document.createElement('div');
                            sBadges.style.display = 'flex';
                            sBadges.style.gap = '8px';
                            
                            const sb1 = document.createElement('span');
                            sb1.className = 'meta-tag';
                            sb1.textContent = `${img.width || '?'}x${img.height || '?'}`;
                            
                            const sb2 = document.createElement('span');
                            sb2.className = 'meta-tag';
                            if (detMode === 'LBL') {
                                const cName = img.folder_class || 'LBL';
                                const color = getClassColor(cName);
                                sb2.textContent = cName;
                                sb2.style.backgroundColor = `${color}33`;
                                sb2.style.color = color;
                                sb2.style.borderColor = color;
                                sb2.style.border = `1px solid ${color}`;
                            } else {
                                sb2.textContent = 'RAW';
                                sb2.style.backgroundColor = 'rgba(255,255,255,0.1)';
                            }
                            
                            sBadges.appendChild(sb1);
                            sBadges.appendChild(sb2);
                            item.appendChild(textSpan);
                            item.appendChild(sBadges);
                            
                            sidebarList.appendChild(item);
                        }
                    });
                    
                    updateChart();
                    
                } else {
                    alert('Errore ricerca: ' + (data.message || 'Sconosciuto'));
                }
            } catch (err) {
                console.error('Errore ricerca:', err);
                alert('Errore di rete durante la ricerca.');
            } finally {
                btnApply.disabled = false;
            }
        });
    }
    
    // Clear filters
    if (btnClear) {
        btnClear.style.width = '100%';
        btnClear.innerHTML = '<i class="bx bx-reset"></i> Resetta Tutto';
        btnClear.addEventListener('click', () => {
            document.querySelectorAll('.halcon-cb').forEach(cb => cb.checked = true);
            if(cbUnlabeled) cbUnlabeled.checked = false;
            if(cbAnyClass) {
                cbAnyClass.checked = true;
                cbAnyClass.indeterminate = false;
            }
            lastClassDistribution = {};
            triggerFilters();
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
            const items = document.querySelectorAll('.masonry-card, .image-list-item');
            
            items.forEach(item => {
                if (filter === 'ALL') {
                    // ripristina la visualizzazione in base al tipo
                    if(item.classList.contains('masonry-card')) {
                        item.style.display = 'block';
                    } else {
                        item.style.display = 'flex';
                    }
                } else {
                    // Cerca il meta-tag che contiene LBL o RAW
                    const tags = item.querySelectorAll('.meta-tag');
                    let isRaw = false;
                    tags.forEach(t => {
                        if (t.textContent === 'RAW') isRaw = true;
                    });
                    
                    let hasTag = false;
                    if (filter === 'RAW') {
                        hasTag = isRaw;
                    } else if (filter === 'LBL') {
                        hasTag = !isRaw;
                    }
                    
                    if (hasTag) {
                        if(item.classList.contains('masonry-card')) {
                            item.style.display = 'block';
                        } else {
                            item.style.display = 'flex';
                        }
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
function buildTree(nodeData, levelNames, currentLevelIndex, parentPath = '') {
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
            const currentPath = parentPath ? `${parentPath}/${leafVal}` : leafVal;
            const nodeEl = createNodeElement(leafVal, currentLevelName, true, leafVal, currentLevelIndex === 0, currentLevelIndex, currentPath);
            container.appendChild(nodeEl);
        });
    } else {
        // Oggetto intermedio
        for (const [key, childData] of Object.entries(nodeData)) {
            const currentPath = parentPath ? `${parentPath}/${key}` : key;
            const nodeEl = createNodeElement(key, currentLevelName, false, null, currentLevelIndex === 0, currentLevelIndex, currentPath);
            const childrenEl = buildTree(childData, levelNames, currentLevelIndex + 1, currentPath);
            nodeEl.appendChild(childrenEl);
            container.appendChild(nodeEl);
        }
    }

    return container;
}

function createNodeElement(value, levelName, isLeaf, leafVal = null, isLevelZero = false, levelIndex = 0, fullPath = '') {
    const node = document.createElement('div');
    node.className = 'tree-node';
    node.setAttribute('data-value', value);
    node.setAttribute('data-level', levelIndex);
    node.setAttribute('data-path', fullPath);
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

        const imageList = document.getElementById('masonry-view');
        const sidebarList = document.getElementById('image-list');
        
        if (images.length === 0) {
            emptyState.style.display = 'block';
            emptyState.textContent = 'Nessuna immagine in questa cartella.';
            document.getElementById('single-view').style.display = 'none';
            imageList.style.display = 'none';
            if(sidebarList) sidebarList.innerHTML = '<div class="empty-state" style="padding: 16px;">Nessuna immagine</div>';
            updateChart();
            return;
        }

        imageList.innerHTML = '';
        if(sidebarList) sidebarList.innerHTML = '';
        
        emptyState.style.display = 'none';
        document.getElementById('single-view').style.display = 'none';
        imageList.style.display = 'grid'; // ensure it's shown

        images.forEach((img, index) => {
            // 1) Masonry Card
            const card = document.createElement('div');
            card.className = 'masonry-card';
            card.title = img.file_name;
            card.id = `grid-item-${index}`;
            card.onclick = () => selectImage(index);
            card.ondblclick = () => renderSingleImage(index);
            
            const imgEl = document.createElement('img');
            imgEl.src = `/api/render/${img.id}?draw_boxes=${showBoxes}`;
            imgEl.loading = 'lazy';
            
            const overlay = document.createElement('div');
            overlay.className = 'masonry-card-overlay';
            
            const title = document.createElement('div');
            title.className = 'masonry-card-title';
            title.textContent = img.file_name;
            
            const badges = document.createElement('div');
            badges.className = 'masonry-card-badges';
            
            const badgeSpan = document.createElement('span');
            badgeSpan.className = 'meta-tag';
            const w = img.width || '?';
            const h = img.height || '?';
            badgeSpan.textContent = `${w}x${h}`;
            
            const badgeSpan2 = document.createElement('span');
            badgeSpan2.className = 'meta-tag';
            const detMode = ['UNANNOTATED', 'NESSUNA_ANNOTAZIONE', 'RAW', 'UNLABELED'].includes(img.detection_mode) ? 'RAW' : 'LBL';
            if (detMode === 'LBL') {
                const cName = img.folder_class || 'LBL';
                const color = getClassColor(cName);
                badgeSpan2.textContent = cName;
                badgeSpan2.style.backgroundColor = `${color}33`; // 20% opacity
                badgeSpan2.style.color = color;
                badgeSpan2.style.borderColor = color;
                badgeSpan2.style.border = `1px solid ${color}`;
            } else {
                badgeSpan2.textContent = 'RAW';
                badgeSpan2.style.backgroundColor = 'rgba(255,255,255,0.1)';
            }
            
            badges.appendChild(badgeSpan);
            badges.appendChild(badgeSpan2);
            
            overlay.appendChild(title);
            overlay.appendChild(badges);
            
            card.appendChild(imgEl);
            card.appendChild(overlay);
            
            imageList.appendChild(card);
            
            // 2) Sidebar List Item
            if(sidebarList) {
                const item = document.createElement('div');
                item.className = 'image-list-item';
                item.title = img.file_name;
                item.id = `list-item-${index}`;
                item.onclick = () => selectImage(index);
                item.ondblclick = () => renderSingleImage(index);
                
                const textSpan = document.createElement('span');
                textSpan.textContent = `Sample #${String(index + 1).padStart(3, '0')}`;
                
                const sBadges = document.createElement('div');
                sBadges.style.display = 'flex';
                sBadges.style.gap = '8px';
                
                const sb1 = document.createElement('span');
                sb1.className = 'meta-tag';
                sb1.textContent = `${w}x${h}`;
                
                const sb2 = document.createElement('span');
                sb2.className = 'meta-tag';
                if (detMode === 'LBL') {
                    const cName = img.folder_class || 'LBL';
                    const color = getClassColor(cName);
                    sb2.textContent = cName;
                    sb2.style.backgroundColor = `${color}33`;
                    sb2.style.color = color;
                    sb2.style.borderColor = color;
                    sb2.style.border = `1px solid ${color}`;
                } else {
                    sb2.textContent = 'RAW';
                    sb2.style.backgroundColor = 'rgba(255,255,255,0.1)';
                }
                
                sBadges.appendChild(sb1);
                sBadges.appendChild(sb2);
                item.appendChild(textSpan);
                item.appendChild(sBadges);
                
                sidebarList.appendChild(item);
            }
        });
        
        updateChart();

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Fetch abortita (nuova richiesta in arrivo).');
            return;
        }
        console.error('Error fetching images:', error);
        const emptyState = document.getElementById('viewer-empty-state');
        const imageList = document.getElementById('masonry-view');
        const sidebarList = document.getElementById('image-list');
        if (emptyState) {
            emptyState.style.display = 'block';
            emptyState.textContent = 'Errore nel caricamento delle immagini.';
        }
        if (imageList) imageList.style.display = 'none';
        if (sidebarList) sidebarList.innerHTML = '<div class="empty-state" style="padding: 16px;">Errore</div>';
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
    
    const backgroundColors = labels.map(label => getClassColor(label));
    
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
            layout: {
                padding: {
                    right: 20
                }
            },
            plugins: {
                legend: {
                    position: 'right',
                    labels: { 
                        color: '#ffffff', 
                        boxWidth: 12,
                        font: { size: 11 },
                        padding: 15
                    }
                }
            }
        }
    });
    
    // Aggiorna pannello info extra
    const extraInfo = document.getElementById('drawer-extra-info');
    if (extraInfo) {
        let html = `
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
        
        // Imbalance Bars (from class_distribution or from folder_class counts)
        const distSource = Object.keys(lastClassDistribution).length > 0 ? lastClassDistribution : classCounts;
        const distEntries = Object.entries(distSource);
        
        if (distEntries.length > 0) {
            const totalAnnotations = distEntries.reduce((sum, [, cnt]) => sum + cnt, 0);
            const maxCount = Math.max(...distEntries.map(([, cnt]) => cnt));
            
            html += `<div class="imbalance-section">
                <h4><i class='bx bx-bar-chart-alt-2' style="color: #00f3ff;"></i> Distribuzione Classi</h4>`;
            
            distEntries.forEach(([className, count]) => {
                const pct = totalAnnotations > 0 ? (count / totalAnnotations * 100) : 0;
                const barWidth = maxCount > 0 ? (count / maxCount * 100) : 0;
                
                let fillClass = '';
                let valueClass = '';
                if (pct < 2) {
                    fillClass = 'critical';
                    valueClass = 'critical-text';
                } else if (pct < 5) {
                    fillClass = 'warning';
                    valueClass = 'warning-text';
                }
                
                html += `<div class="imbalance-bar">
                    <span class="bar-label" title="${className}">${className}</span>
                    <div class="bar-track">
                        <div class="bar-fill ${fillClass}" style="width: ${barWidth}%;"></div>
                    </div>
                    <span class="bar-value ${valueClass}">${count} (${pct.toFixed(1)}%)</span>
                </div>`;
            });
            
            html += `</div>`;
        }
        
        extraInfo.innerHTML = html;
    }
}

function selectImage(indexStr) {
    const index = parseInt(indexStr);
    if(isNaN(index)) return;
    
    const img = currentImages[index];
    if(!img) return;
    
    currentSelectedIndex = index;
    
    document.querySelectorAll('.masonry-card, .image-list-item').forEach(el => el.classList.remove('active'));
    
    const activeGridItem = document.getElementById(`grid-item-${index}`);
    if (activeGridItem) {
        activeGridItem.classList.add('active');
        // evito scrollIntoView qui per evitare salti improvvisi in galleria al click
    }
    
    const activeListItem = document.getElementById(`list-item-${index}`);
    if (activeListItem) {
        activeListItem.classList.add('active');
        activeListItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    
    const width = img.width || '?';
    const height = img.height || '?';
    const detMode = ['UNANNOTATED', 'NESSUNA_ANNOTAZIONE', 'RAW', 'UNLABELED'].includes(img.detection_mode) ? 'RAW' : 'LBL';
    
    document.getElementById('statusbar-filename').textContent = img.file_name;
    document.getElementById('statusbar-resolution').textContent = `${width}x${height}`;
    
    const badge = document.getElementById('statusbar-detmode');
    if (detMode === 'LBL') {
        const cName = img.folder_class || 'LBL';
        const color = getClassColor(cName);
        badge.textContent = cName;
        badge.style.backgroundColor = `${color}33`;
        badge.style.color = color;
        badge.style.borderColor = color;
        badge.style.border = `1px solid ${color}`;
    } else {
        badge.textContent = 'RAW';
        badge.style.backgroundColor = 'rgba(255,255,255,0.1)';
        badge.style.color = 'var(--text-color)';
        badge.style.border = 'none';
    }
}

function renderSingleImage(indexStr, preserveView = false) {
    const index = parseInt(indexStr);
    if(isNaN(index)) return;
    
    const img = currentImages[index];
    if(!img) return;
    
    selectImage(indexStr);
    
    // Mostra il single-view e nascondi masonry-view
    document.getElementById('masonry-view').style.display = 'none';
    document.getElementById('single-view').style.display = 'flex';
    document.getElementById('single-view').style.flexDirection = 'column';
    document.getElementById('single-view').style.flex = '1';
    document.getElementById('single-view').style.position = 'relative';
    
    // Mostra sidebar a destra solo in single-view
    const rightSidebar = document.getElementById('right-sidebar');
    if(rightSidebar) rightSidebar.style.display = 'flex';
    
    document.getElementById('viewer-empty-state').style.display = 'none';
    const card = document.getElementById('viewport-card');
    card.style.display = 'flex';
    
    // Configura tasto back
    const btnBack = document.getElementById('btn-back-to-grid');
    if(btnBack) {
        btnBack.onclick = () => {
            document.getElementById('single-view').style.display = 'none';
            document.getElementById('masonry-view').style.display = 'grid';
            if(rightSidebar) rightSidebar.style.display = 'none';
        };
    }
    
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

let currentImportStep = 1;
let importFilters = {
    hdict_file: '',
    control_type: '',
    station: '',
    machine_serial: '',
    format_type: '',
    matricola: '',
    delete_source: false
};
let importOptionsData = {
    dicts: [],
    control_type: [],
    station: [],
    machine_serial: [],
    format_type: []
};

function setupImportModal() {
    const btnOpen = document.getElementById('btn-open-import');
    const modal = document.getElementById('import-modal');
    const btnExecute = document.getElementById('btn-execute-import');
    const statusDiv = document.getElementById('import-status');
    const btnNext = document.getElementById('btn-import-next');
    const btnPrev = document.getElementById('btn-import-prev');

    async function fetchDicts() {
        try {
            const response = await fetch('/api/dropzone-dicts');
            const data = await response.json();
            if (data.status === 'success') {
                importOptionsData.dicts = data.files || [];
            }
        } catch (err) {
            console.error(err);
        }
    }

    async function fetchTaxonomyOptions() {
        try {
            const res = await fetch('/api/taxonomy-options');
            const data = await res.json();
            if (data.status === 'success') {
                importOptionsData.control_type = data.options.control_type || [];
                importOptionsData.station = data.options.station || [];
                importOptionsData.machine_serial = data.options.machine_serial || [];
                importOptionsData.format_type = data.options.format_type || [];
            }
        } catch (err) {
            console.error("Errore fetch taxonomy:", err);
        }
    }

    if(btnOpen && modal) {
        btnOpen.addEventListener('click', async () => {
            modal.classList.add('show');
            currentImportStep = 1;
            importFilters = { hdict_file: '', control_type: '', station: '', machine_serial: '', format_type: '', matricola: '', delete_source: false };
            
            const btnExecute = document.getElementById('btn-execute-import');
            btnExecute.style.display = 'none';
            btnExecute.disabled = false;
            
            document.getElementById('import-status').textContent = 'Caricamento dati in corso...';
            
            await fetchDicts();
            await fetchTaxonomyOptions();
            document.getElementById('import-status').textContent = '';
            renderImportStep(currentImportStep);
        });
    }
    
    document.querySelectorAll('.close-import').forEach(btn => {
        btn.addEventListener('click', () => {
            modal.classList.remove('show');
        });
    });
    
    if (btnNext) {
        btnNext.addEventListener('click', () => {
            if (currentImportStep === 1) {
                const selected = document.querySelector('#import-step-content .export-option-card.selected');
                if (!selected) { alert('Seleziona un Dizionario'); return; }
                importFilters.hdict_file = selected.dataset.value;
            } else if (currentImportStep === 2) {
                const selected = document.querySelector('#import-step-content .export-option-card.selected');
                const customInput = document.getElementById('custom-control-type').value.trim();
                if (customInput) {
                    importFilters.control_type = customInput;
                } else if (selected) {
                    importFilters.control_type = selected.dataset.value;
                } else {
                    alert('Seleziona o inserisci un Tipo Controllo'); return;
                }
            } else if (currentImportStep === 3) {
                const selStation = document.querySelector('#import-step-content .export-option-card.station-card.selected');
                const customStation = document.getElementById('custom-station').value.trim();
                if (customStation) {
                    importFilters.station = customStation;
                } else if (selStation) {
                    importFilters.station = selStation.dataset.value;
                } else {
                    alert('Seleziona o inserisci una Stazione'); return;
                }

                const selSerial = document.querySelector('#import-step-content .export-option-card.serial-card.selected');
                const customSerial = document.getElementById('custom-serial').value.trim();
                if (customSerial) {
                    importFilters.machine_serial = customSerial;
                } else if (selSerial) {
                    importFilters.machine_serial = selSerial.dataset.value;
                } else {
                    alert('Seleziona o inserisci un Seriale Macchina'); return;
                }
            }
            
            if (currentImportStep < 4) {
                currentImportStep++;
                renderImportStep(currentImportStep);
            }
        });
    }

    if (btnPrev) {
        btnPrev.addEventListener('click', () => {
            if (currentImportStep > 1) {
                currentImportStep--;
                renderImportStep(currentImportStep);
            }
        });
    }

    function renderImportStep(step) {
        const container = document.getElementById('import-step-content');
        
        document.querySelectorAll('#import-wizard-timeline .wizard-step').forEach(el => {
            const s = parseInt(el.dataset.step);
            el.classList.remove('active', 'completed');
            if (s === step) el.classList.add('active');
            else if (s < step) el.classList.add('completed');
        });

        document.getElementById('btn-import-prev').style.display = step > 1 ? 'block' : 'none';
        document.getElementById('btn-import-next').style.display = step < 4 ? 'block' : 'none';
        document.getElementById('btn-execute-import').style.display = step === 4 ? 'flex' : 'none';
        
        let html = '';
        if (step === 1) {
            html += `<h3 style="margin-top:0; color:var(--text-color);">Seleziona Dizionario (.hdict)</h3>`;
            html += `<div class="export-options-grid">`;
            importOptionsData.dicts.forEach(opt => {
                html += `<div class="export-option-card single-select" data-value="${opt}">${opt}</div>`;
            });
            html += `</div>`;
            if (importOptionsData.dicts.length === 0) {
                html += `<p style="color:var(--text-muted); margin-top: 16px;">Nessun dizionario trovato. Ricarica o aggiungi file nella DropZone.</p>`;
            }
        } else if (step === 2) {
            html += `<h3 style="margin-top:0; color:var(--text-color);">Seleziona Tipo Controllo</h3>`;
            html += `<div class="export-options-grid">`;
            importOptionsData.control_type.forEach(opt => {
                html += `<div class="export-option-card single-select" data-value="${opt}">${opt}</div>`;
            });
            html += `</div>`;
            html += `<div style="margin-top: 24px;">
                        <h4 style="color: rgba(255,255,255,0.7); margin-bottom: 8px;">Oppure inserisci nuovo:</h4>
                        <input type="text" id="custom-control-type" class="glass-input" placeholder="+ Nuovo Tipo Controllo" style="width: 100%; max-width: 400px;">
                     </div>`;
        } else if (step === 3) {
            html += `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 32px;">`;
            
            html += `<div>
                        <h3 style="margin-top:0; color:var(--text-color);">Stazione</h3>
                        <div class="export-options-grid" style="grid-template-columns: 1fr;">`;
            importOptionsData.station.forEach(opt => {
                html += `<div class="export-option-card station-card single-select" data-value="${opt}">${opt}</div>`;
            });
            html += `   </div>
                        <div style="margin-top: 16px;">
                            <input type="text" id="custom-station" class="glass-input" placeholder="+ Nuova Stazione" style="width: 100%;">
                        </div>
                     </div>`;
                     
            html += `<div>
                        <h3 style="margin-top:0; color:var(--text-color);">Seriale Macchina</h3>
                        <div class="export-options-grid" style="grid-template-columns: 1fr;">`;
            importOptionsData.machine_serial.forEach(opt => {
                html += `<div class="export-option-card serial-card single-select" data-value="${opt}">${opt}</div>`;
            });
            html += `   </div>
                        <div style="margin-top: 16px;">
                            <input type="text" id="custom-serial" class="glass-input" placeholder="+ Nuovo Seriale" style="width: 100%;">
                        </div>
                     </div>`;
                     
            html += `</div>`;
        } else if (step === 4) {
            html += `<h3 style="margin-top:0; color:var(--text-color);">Seleziona Formato</h3>`;
            html += `<div class="export-options-grid">`;
            importOptionsData.format_type.forEach(opt => {
                html += `<div class="export-option-card format-card single-select" data-value="${opt}">${opt}</div>`;
            });
            html += `</div>`;
            html += `<div style="margin-top: 16px;">
                        <input type="text" id="custom-format" class="glass-input" placeholder="+ Nuovo Formato" style="width: 100%; max-width: 400px;">
                     </div>`;
                     
            html += `<div style="height: 1px; background: rgba(255,255,255,0.1); margin: 32px 0;"></div>`;
            html += `<div class="input-wrapper" style="margin-bottom: 24px;">
                        <input type="text" id="tax-matricola" class="glass-input" placeholder="Matricola / Lotto / Commento (Opzionale)" autocomplete="off" style="width: 100%; padding: 12px; font-size: 1.05rem;">
                     </div>`;
            html += `<label style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 12px; background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 8px; transition: background 0.2s; width: fit-content;">
                        <input type="checkbox" id="delete-source" style="accent-color: #ef4444; width: 18px; height: 18px; cursor: pointer;">
                        <span style="font-size: 0.9rem; color: #ef4444; font-weight: 500;">Svuota la cartella DropZone al termine dell'importazione</span>
                     </label>`;
        }
        container.innerHTML = html;
        
        if (step === 1 || step === 2) {
            container.querySelectorAll('.export-option-card.single-select').forEach(card => {
                card.addEventListener('click', (e) => {
                    container.querySelectorAll('.export-option-card.single-select').forEach(c => c.classList.remove('selected'));
                    e.target.classList.add('selected');
                    const customInput = container.querySelector('input[type="text"]');
                    if (customInput) customInput.value = '';
                });
            });
            const customInput = container.querySelector('input[type="text"]');
            if (customInput) {
                customInput.addEventListener('input', () => {
                    container.querySelectorAll('.export-option-card.single-select').forEach(c => c.classList.remove('selected'));
                });
            }
        } else if (step === 3) {
            container.querySelectorAll('.station-card').forEach(card => {
                card.addEventListener('click', (e) => {
                    container.querySelectorAll('.station-card').forEach(c => c.classList.remove('selected'));
                    e.target.classList.add('selected');
                    document.getElementById('custom-station').value = '';
                });
            });
            document.getElementById('custom-station').addEventListener('input', () => {
                container.querySelectorAll('.station-card').forEach(c => c.classList.remove('selected'));
            });

            container.querySelectorAll('.serial-card').forEach(card => {
                card.addEventListener('click', (e) => {
                    container.querySelectorAll('.serial-card').forEach(c => c.classList.remove('selected'));
                    e.target.classList.add('selected');
                    document.getElementById('custom-serial').value = '';
                });
            });
            document.getElementById('custom-serial').addEventListener('input', () => {
                container.querySelectorAll('.serial-card').forEach(c => c.classList.remove('selected'));
            });
        } else if (step === 4) {
            container.querySelectorAll('.format-card').forEach(card => {
                card.addEventListener('click', (e) => {
                    container.querySelectorAll('.format-card').forEach(c => c.classList.remove('selected'));
                    e.target.classList.add('selected');
                    document.getElementById('custom-format').value = '';
                });
            });
            document.getElementById('custom-format').addEventListener('input', () => {
                container.querySelectorAll('.format-card').forEach(c => c.classList.remove('selected'));
            });
            
            // Save state on change for step 4 since there's no "next" step
            document.getElementById('tax-matricola').addEventListener('input', (e) => {
                importFilters.matricola = e.target.value.trim();
            });
            document.getElementById('delete-source').addEventListener('change', (e) => {
                importFilters.delete_source = e.target.checked;
            });
        }
        
        if (step === 1 && importFilters.hdict_file) {
            const card = container.querySelector(`.export-option-card[data-value="${importFilters.hdict_file}"]`);
            if (card) card.classList.add('selected');
        } else if (step === 2 && importFilters.control_type) {
            const card = container.querySelector(`.export-option-card[data-value="${importFilters.control_type}"]`);
            if (card) card.classList.add('selected');
            else document.getElementById('custom-control-type').value = importFilters.control_type;
        } else if (step === 3) {
            if (importFilters.station) {
                const card = container.querySelector(`.station-card[data-value="${importFilters.station}"]`);
                if (card) card.classList.add('selected');
                else document.getElementById('custom-station').value = importFilters.station;
            }
            if (importFilters.machine_serial) {
                const card = container.querySelector(`.serial-card[data-value="${importFilters.machine_serial}"]`);
                if (card) card.classList.add('selected');
                else document.getElementById('custom-serial').value = importFilters.machine_serial;
            }
        } else if (step === 4) {
            if (importFilters.format_type) {
                const card = container.querySelector(`.format-card[data-value="${importFilters.format_type}"]`);
                if (card) card.classList.add('selected');
                else document.getElementById('custom-format').value = importFilters.format_type;
            }
            if (importFilters.matricola) {
                document.getElementById('tax-matricola').value = importFilters.matricola;
            }
            if (importFilters.delete_source) {
                document.getElementById('delete-source').checked = importFilters.delete_source;
            }
        }
    }
    
    const conflictModal = document.getElementById('conflict-modal');
    const btnCloseConflict = document.getElementById('btn-close-conflict');
    const btnCancelConflict = document.getElementById('btn-cancel-conflict');
    const btnConfirmConflict = document.getElementById('btn-confirm-conflict');
    
    const handleConflictCancel = () => {
        if (conflictModal) conflictModal.classList.remove('show');
        if (btnExecute) btnExecute.disabled = false;
        if (statusDiv) {
            statusDiv.textContent = 'Risoluzione conflitti annullata.';
            statusDiv.style.color = 'var(--text-muted)';
        }
    };
    
    if (btnCloseConflict) btnCloseConflict.addEventListener('click', handleConflictCancel);
    if (btnCancelConflict) btnCancelConflict.addEventListener('click', handleConflictCancel);
    
    async function executeFinalImport(payload, btn, skipNavigation) {
        const originalText = btn ? btn.textContent : '';
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Importazione in corso (minuti)...';
        }
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
                
                fetchDicts();
                fetchTaxonomyOptions();
                await fetchTaxonomy();
                
                setTimeout(() => {
                    modal.classList.remove('show');
                    if (conflictModal) conflictModal.classList.remove('show');
                    
                    if (!skipNavigation && data.data && data.data.final_taxonomy) {
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
                
                importFilters.matricola = ''; // reset matricola
            } else {
                statusDiv.textContent = data.message || "Errore sconosciuto";
                statusDiv.style.color = '#ef4444';
            }
        } catch (error) {
            statusDiv.textContent = 'Errore di rete durante la connessione.';
            statusDiv.style.color = '#ef4444';
            console.error(error);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        }
    }
    
    if(btnExecute) {
        btnExecute.addEventListener('click', async () => {
            // Raccogli dati step 4
            const selFormat = document.querySelector('#import-step-content .export-option-card.format-card.selected');
            const customFormat = document.getElementById('custom-format').value.trim();
            if (customFormat) {
                importFilters.format_type = customFormat;
            } else if (selFormat) {
                importFilters.format_type = selFormat.dataset.value;
            } else {
                alert('Seleziona o inserisci un Formato'); return;
            }
            importFilters.matricola = document.getElementById('tax-matricola').value.trim();
            importFilters.delete_source = document.getElementById('delete-source').checked;
            
            if (!importFilters.control_type || !importFilters.station || !importFilters.machine_serial || !importFilters.format_type) {
                statusDiv.textContent = 'Mancano campi tassonomici obbligatori.';
                statusDiv.style.color = '#ef4444';
                return;
            }
            
            btnExecute.disabled = true;
            statusDiv.textContent = 'Analisi dizionario in corso (Dry-Run)...';
            statusDiv.style.color = 'var(--text-muted)';
            
            const payload = {
                hdict_file: importFilters.hdict_file, 
                delete_source: importFilters.delete_source,
                control_type: importFilters.control_type,
                station: importFilters.station,
                machine_serial: importFilters.machine_serial,
                format_type: importFilters.format_type,
                matricola: importFilters.matricola,
                check_only: true,
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
                    if (data.duplicate_count > 0) {
                        statusDiv.textContent = 'Azione richiesta: Risoluzione Conflitti.';
                        statusDiv.style.color = '#f59e0b';
                        
                        document.getElementById('conflict-desc').innerHTML = `L'analisi ha rilevato <strong>${data.duplicate_count} doppioni</strong> e <strong>${data.new_count} nuove immagini</strong>.<br>Come vuoi procedere?`;
                        
                        const dupSection = document.getElementById('conflict-duplicates-section');
                        dupSection.style.display = 'block';
                        
                        const newSection = document.getElementById('conflict-new-section');
                        newSection.style.display = (data.new_count > 0) ? 'block' : 'none';
                        
                        conflictModal.classList.add('show');
                        
                        const currentConfirmBtn = document.getElementById('btn-confirm-conflict');
                        const newConfirmBtn = currentConfirmBtn.cloneNode(true);
                        newConfirmBtn.disabled = false;
                        newConfirmBtn.textContent = 'Conferma Importazione';
                        currentConfirmBtn.parentNode.replaceChild(newConfirmBtn, currentConfirmBtn);
                        
                        newConfirmBtn.addEventListener('click', () => {
                            newConfirmBtn.disabled = true;
                            newConfirmBtn.textContent = 'Importazione in corso...';
                            
                            payload.check_only = false;
                            
                            const optDup = document.querySelector('input[name="opt-duplicates"]:checked').value;
                            payload.update_duplicates = (optDup === 'update');
                            
                            if (data.new_count > 0) {
                                const optNew = document.querySelector('input[name="opt-new"]:checked').value;
                                payload.merge_new_with_old_date = (optNew === 'merge');
                            }
                            
                            statusDiv.textContent = 'Import finale in corso, attendere...';
                            statusDiv.style.color = 'var(--text-muted)';
                            
                            const skipNav = (data.new_count === 0 && !payload.update_duplicates);
                            executeFinalImport(payload, newConfirmBtn, skipNav);
                        });
                        
                    } else {
                        statusDiv.textContent = 'Nessun conflitto rilevato. Import in corso...';
                        payload.check_only = false;
                        executeFinalImport(payload, btnExecute, false);
                    }
                } else {
                    statusDiv.textContent = data.message || "Errore sconosciuto";
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
            
            const payload = {
                export_name: exportName,
                filters: exportFilters,
                class_mapping: classMapping
            };
            
            btnConfirmExportName.disabled = true;
            btnConfirmExportName.textContent = 'Esportazione in corso...';

            fetch('/api/export-dataset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') {
                    nameModal.classList.remove('show');
                    document.getElementById('export-modal').classList.remove('show'); // Chiudi il wizard
                    alert(`✅ Esportazione Completata!\n${data.message}\nImmagini esportate: ${data.exported_count}\nClassi esportate: ${data.classes.join(', ')}`);
                } else {
                    alert(`❌ Errore durante l'esportazione:\n${data.message}`);
                }
            })
            .catch(err => {
                alert(`❌ Errore di connessione:\n${err.message}`);
            })
            .finally(() => {
                btnConfirmExportName.disabled = false;
                btnConfirmExportName.textContent = 'Conferma Nome';
            });
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


