import json
with open(r'C:\Users\riccardo.frasson\Desktop\Pharma\Gestionale Datasets\dashboard\static\script.js', 'r', encoding='utf-8') as f:
    content = f.read()

target1 = '''    async function populateFilters() {
        try {
            const res = await fetch('/api/taxonomy-options');
            const data = await res.json();
            if (data.status !== 'success') return;
            
            const opts = data.options;
            fillDropdown('af-control-type', 'Controllo', opts.control_type || []);
            fillDropdown('af-station', 'Stazione', opts.station || []);
            fillDropdown('af-machine-serial', 'Seriale', opts.machine_serial || []);
            fillDropdown('af-format-type', 'Formato', opts.format_type || []);
            
            classNames = opts.class_name || [];
            renderClassChecklist(classNames);
            
        } catch (err) {
            console.error('Errore popolamento filtri:', err);
        }
    }
    
    function fillDropdown(id, placeholder, values) {
        const select = document.getElementById(id);
        if (!select) return;
        select.innerHTML = <option value=""> + placeholder + </option>;
        values.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v;
            opt.textContent = v;
            select.appendChild(opt);
        });
    }'''

replacement1 = '''    async function populateFilters() {
        try {
            const res = await fetch('/api/taxonomy-options');
            const data = await res.json();
            if (data.status !== 'success') return;
            
            const opts = data.options;
            renderFilterChecklist('list-control-type', opts.control_type || [], 'control');
            renderFilterChecklist('list-station', opts.station || [], 'station');
            renderFilterChecklist('list-machine-serial', opts.machine_serial || [], 'serial');
            renderFilterChecklist('list-format-type', opts.format_type || [], 'format');
            
            classNames = opts.class_name || [];
            renderClassChecklist(classNames);
            
        } catch (err) {
            console.error('Errore popolamento filtri:', err);
        }
    }
    
    function renderFilterChecklist(containerId, items, group) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        container.innerHTML = '';
        if (items.length === 0) {
            container.innerHTML = '<div style="padding: 12px; color: var(--text-muted); font-size: 0.9rem;">Nessun dato</div>';
            return;
        }
        
        items.forEach((v, i) => {
            const id = cb- + group + - + i;
            const item = document.createElement('div');
            item.className = 'halcon-class-item';
            item.innerHTML = 
                <input type="checkbox" id=" + id + " class="halcon-cb filter-cb" data-group=" + group + " data-value=" + v + " checked>
                <label for=" + id + " class="halcon-class-name" style="margin-left: 8px;"> + v + </label>
            ;
            
            container.appendChild(item);
            
            item.addEventListener('click', (e) => {
                if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'LABEL') {
                    const cb = item.querySelector('input');
                    cb.checked = !cb.checked;
                    cb.dispatchEvent(new Event('change'));
                }
            });
        });
    }'''

if target1.replace('','') in content.replace('',''):
    print('Target 1 matched somehow')

# Let's use string find
idx = content.find('async function populateFilters() {')
if idx != -1:
    end_idx = content.find('function renderClassChecklist')
    if end_idx != -1:
        content = content[:idx] + replacement1.replace('', '\\') + '\n    ' + content[end_idx:]
        print('populateFilters replaced')
    else: print('end idx not found')
else: print('start idx not found')

target_leaf = '''    // Se è foglia, metti un badge
    if (isLeaf) {
        const badge = document.createElement('span');
        badge.className = 'leaf-badge';
        const isRaw = ['UNLABELED', 'NESSUNA_ANNOTAZIONE', 'RAW', 'UNANNOTATED'].includes(value);
        badge.textContent = isRaw ? 'RAW' : 'LBL';
        if (isRaw) badge.style.backgroundColor = '#94a3b8';
        label.appendChild(badge);
    }'''

repl_leaf = '''    // Se è foglia, metti un badge
    if (isLeaf) {
        const badge = document.createElement('span');
        badge.className = 'leaf-badge';
        const isRaw = ['UNLABELED', 'NESSUNA_ANNOTAZIONE', 'RAW', 'UNANNOTATED'].includes(value);
        badge.textContent = isRaw ? 'RAW' : 'LBL';
        if (isRaw) {
            badge.style.backgroundColor = '#848cac';
            badge.style.color = '#fff';
        } else {
            badge.style.backgroundColor = 'var(--primary-color)';
            badge.style.color = '#0f172a';
            badge.style.fontWeight = 'bold';
        }
        label.appendChild(badge);
    }'''

if target_leaf in content:
    content = content.replace(target_leaf, repl_leaf)
    print('Leaf replaced')
else: print('Leaf not found')

idx_btn = content.find('btnApply.addEventListener(\'click\', async () => {')
if idx_btn != -1:
    end_btn = content.find('const res = await fetch(\'/api/taxonomy-stats\', {')
    if end_btn != -1:
        new_btn = '''btnApply.addEventListener('click', async () => {
            // Gather checked filters
            const getCheckedValues = (group) => {
                const vals = [];
                document.querySelectorAll(input[data-group=""]:checked).forEach(cb => vals.push(cb.dataset.value));
                return vals.length > 0 ? vals : null;
            };
            
            const controlTypes = getCheckedValues('control');
            const stations = getCheckedValues('station');
            const machineSerials = getCheckedValues('serial');
            const formatTypes = getCheckedValues('format');
            
            // Gather checked classes
            const selectedClasses = [];
            document.querySelectorAll('.halcon-class-cb:checked:not([data-group])').forEach(cb => {
                if (cb.dataset.class) selectedClasses.push(cb.dataset.class);
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
            btnApply.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i> Ricerca...';
            
            try {
                '''
        content = content[:idx_btn] + new_btn.replace('','\\') + content[end_btn:]
        print('Apply replaced')

idx_clear = content.find('btnClear.addEventListener(\'click\', () => {')
if idx_clear != -1:
    end_clear = content.find('});', idx_clear) + 3
    new_clear = '''btnClear.addEventListener('click', () => {
            document.querySelectorAll('input.filter-cb').forEach(cb => cb.checked = true);
            if (cbAnyClass) {
                cbAnyClass.checked = true;
                cbAnyClass.indeterminate = false;
            }
            if (cbUnlabeled) cbUnlabeled.checked = false;
            document.querySelectorAll('.halcon-class-cb:not([data-group])').forEach(cb => cb.checked = true);
            lastClassDistribution = {};
        });'''
    content = content[:idx_clear] + new_clear + content[end_clear:]
    print('Clear replaced')

with open(r'C:\Users\riccardo.frasson\Desktop\Pharma\Gestionale Datasets\dashboard\static\script.js', 'w', encoding='utf-8') as f:
    f.write(content)
