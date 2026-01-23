// State
let images = []; 
let currentImageIndex = -1;
let classes = [];
let currentClassIndex = 0;
let currentJobId = null; 

// Editting State
let selectedBoxIndex = -1; 
let interactionMode = 'NONE'; 
let resizeHandle = null; 
let dragStartX = 0;
let dragStartY = 0;
let originalBoxState = null; 

// Canvas & Drawing State
const canvas = document.getElementById('editorCanvas');
const ctx = canvas.getContext('2d');
let startX = 0;
let startY = 0;
let currentMouseX = 0;
let currentMouseY = 0;

// DOM Elements
const saveProjectBtn = document.getElementById('saveProjectBtn');
const importJobBtn = document.getElementById('importJobBtn');
const importJobInput = document.getElementById('importJobInput');
const importZipBtn = document.getElementById('importZipBtn');
const importZipInput = document.getElementById('importZipInput');
const clearWorkspaceBtn = document.getElementById('clearWorkspaceBtn');
const jobListEl = document.getElementById('jobList');

const imageInput = document.getElementById('imageInput');
const imageList = document.getElementById('imageList');
const classList = document.getElementById('classList');
const newClassInput = document.getElementById('newClassInput');
const addClassBtn = document.getElementById('addClassBtn');
const exportBtn = document.getElementById('exportBtn');
const statusInfo = document.getElementById('statusinfo');
const selectionControls = document.getElementById('selectionControls');
const reassignClassSelect = document.getElementById('reassignClassSelect');

// YOLO Import Elements
const importYoloBtn = document.getElementById('importYoloBtn');
const importYoloInput = document.getElementById('importYoloInput');

// New DOM Elements for Job Selection
const jobSelectionScreen = document.getElementById('jobSelectionScreen');
const workspaceContainer = document.getElementById('workspaceContainer');
const jobSelectionList = document.getElementById('jobSelectionList');
const createJobBtn = document.getElementById('createJobBtn');
const newJobNameInput = document.getElementById('newJobNameInput');
const backToJobsBtn = document.getElementById('backToJobsBtn');

// --- Initialization ---

async function init() {
    // Hide local-only features or re-purpose them
    if (importJobBtn) importJobBtn.parentElement.style.display = 'none'; 
    if (saveProjectBtn) saveProjectBtn.style.display = 'none'; 
    if (clearWorkspaceBtn) clearWorkspaceBtn.style.display = 'none'; 
    
    // Modify UI text
    const sectionTitle = document.querySelector('.section h3');
    if (sectionTitle) sectionTitle.textContent = 'Job Images';

    // Event Listeners
    imageInput.addEventListener('change', handleImageUpload);
    addClassBtn.addEventListener('click', addNewClass);
    exportBtn.addEventListener('click', exportData);
    
    // YOLO Import
    if (importYoloBtn) {
        importYoloBtn.addEventListener('click', () => importYoloInput.click());
        importYoloInput.addEventListener('change', handleYoloImport);
    }
    
    // Job Creation
    createJobBtn.addEventListener('click', createJob);
    
    // Back Button
    backToJobsBtn.addEventListener('click', () => {
        workspaceContainer.style.display = 'none';
        jobSelectionScreen.style.display = 'flex';
        currentJobId = null;
        images = [];
        ctx.clearRect(0,0, canvas.width, canvas.height);
        loadJobList();
    });

    reassignClassSelect.addEventListener('change', (e) => {
        if (currentImageIndex !== -1 && selectedBoxIndex !== -1) {
            images[currentImageIndex].boxes[selectedBoxIndex].classIndex = parseInt(e.target.value);
            drawCanvas();
            saveCurrentAnnotation();
        }
    });

    document.addEventListener('keydown', handleKeyDown);

    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    
    await loadJobList();
}

async function loadJobList() {
    try {
        const res = await fetch('/api/jobs');
        const jobs = await res.json();
        
        jobSelectionList.innerHTML = '';
        jobs.forEach(job => {
            const div = document.createElement('div');
            div.className = 'job-card';
            div.innerHTML = `<div><strong>${job.name}</strong></div> <div>${job.count} imgs</div>`;
            div.onclick = () => selectJob(job.id);
            jobSelectionList.appendChild(div);
        });
        
    } catch (err) {
        console.error(err);
        jobSelectionList.innerHTML = '<div style="color:red; paading:10px;">Failed to load jobs.</div>';
    }
}

async function createJob() {
    const name = newJobNameInput.value.trim();
    if (!name) return;
    
    try {
        const res = await fetch('/api/jobs', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ name: name })
        });
        const data = await res.json();
        if (data.status === 'ok') {
            newJobNameInput.value = '';
            loadJobList();
        }
    } catch (err) {
        alert("Failed to create job.");
    }
}

async function selectJob(id) {
    currentJobId = id;
    jobSelectionScreen.style.display = 'none';
    workspaceContainer.style.display = 'flex';
    
    await loadServerData(id);
}

async function loadServerData(jobId) {
    statusInfo.textContent = "Loading Job...";
    try {
        const res = await fetch(`/api/jobs/${jobId}/init`);
        const data = await res.json();
        
        classes = data.classes;
        images = data.images;
        
        if (classes.length === 0) classes.push({name: 'object', color: '#00ff00'});
        
        renderClassList();
        renderImageList();
        
        // Render fake job list just to show count
        jobListEl.innerHTML = `<div class="job-item"><span>Current Job</span> <span class="job-count">${images.length} imgs</span></div>`;
        
        if (images.length > 0) {
            selectImage(0);
        } else {
             ctx.clearRect(0,0, canvas.width, canvas.height);
             statusInfo.textContent = "No images in job.";
             canvas.width = 800; // Reset default
             canvas.height = 600;
        }

    } catch (err) {
        console.error("Failed to load server data", err);
        statusInfo.textContent = "Error connecting to server";
    }
}

// --- Image Handling ---

async function handleImageUpload(e) {
    if (!currentJobId) return;
    const files = e.target.files;
    if (files.length === 0) return;

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
        formData.append('images', files[i]);
    }

    statusInfo.textContent = "Uploading...";
    
    try {
        const res = await fetch(`/api/jobs/${currentJobId}/upload`, {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (data.status === 'ok') {
            // Refresh
            await loadServerData(currentJobId);
            statusInfo.textContent = `Uploaded ${files.length} images.`;
        }
    } catch(err) {
        alert("Upload failed");
    }
    // Clear input
    e.target.value = '';
}

async function handleYoloImport(e) {
    if (!currentJobId) return;
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    statusInfo.textContent = "Importing YOLO dataset...";
    
    try {
        const res = await fetch(`/api/jobs/${currentJobId}/import_yolo`, {
            method: 'POST',
            body: formData
        });
        
        // Check if response is OK
        if (!res.ok) {
            if (res.status === 413) {
                throw new Error('ZIP file too large. Maximum upload size is 10GB.');
            }
            throw new Error(`Server error: ${res.status}`);
        }
        
        const data = await res.json();
        
        if (data.status === 'ok') {
            // Refresh to show imported images and annotations
            await loadServerData(currentJobId);
            statusInfo.textContent = data.message || `Imported ${data.imported} images with pre-annotations`;
            
            if (data.skipped > 0) {
                alert(`Import complete!\nImported: ${data.imported}\nSkipped: ${data.skipped} (missing images or invalid format)`);
            }
        } else {
            alert(`Import failed: ${data.error || 'Unknown error'}`);
            statusInfo.textContent = "Import failed";
        }
    } catch(err) {
        console.error('Import error:', err);
        alert("Import failed: " + err.message);
        statusInfo.textContent = "Import failed";
    }
    
    // Clear input
    e.target.value = '';
}

function renderImageList() {
    imageList.innerHTML = '';
    images.forEach((img, index) => {
        const div = document.createElement('div');
        const boxCount = img.boxes ? img.boxes.length : 0;
        div.className = `image-item ${index === currentImageIndex ? 'active' : ''} ${boxCount > 0 ? 'annotated' : ''}`;
        div.textContent = img.name;
        div.onclick = () => selectImage(index);
        imageList.appendChild(div);
    });
}

function selectImage(index) {
    if (index < 0 || index >= images.length) return;
    
    currentImageIndex = index;
    selectedBoxIndex = -1;
    updateSelectionUI();
    const imgData = images[index];
    
    renderImageList();

    const img = new Image();
    img.onload = () => {
        imgData.width = img.width;
        imgData.height = img.height;
        
        canvas.width = img.width;
        canvas.height = img.height;
        drawCanvas();
    };
    img.src = imgData.url; // URL from server
    
    const count = imgData.boxes ? imgData.boxes.length : 0;
    statusInfo.textContent = `${imgData.name} (${count} objects)`;
}

// --- Drawing & Canvas Logic ---
const HANDLE_SIZE = 6;

function drawCanvas() {
    if (currentImageIndex === -1) return;
    const imgData = images[currentImageIndex];
    if (!imgData.url) return;
    
    const img = new Image();
    img.src = imgData.url;
    // We assume it's loaded because we redraw on image load.
    ctx.drawImage(img, 0, 0);

    const boxes = imgData.boxes || [];

    boxes.forEach((box, idx) => {
        if (box.classIndex >= classes.length) box.classIndex = 0;

        const cls = classes[box.classIndex];
        const isSelected = (idx === selectedBoxIndex);
        
        const color = cls ? cls.color : '#fff';
        const name = cls ? cls.name : '?';

        drawBox(box.x, box.y, box.w, box.h, color, name, isSelected);
        
        if (isSelected) {
            drawHandles(box.x, box.y, box.w, box.h, color);
        }
    });

    if (interactionMode === 'DRAW') {
        const width = currentMouseX - startX;
        const height = currentMouseY - startY;
        const cls = classes[currentClassIndex];
        const c = cls ? cls.color : '#00ff00';
        const n = cls ? cls.name : 'object';
        drawBox(startX, startY, width, height, c, n, true); 
    }
}

function drawBox(x, y, w, h, color, label, isSelected) {
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 3 : 2;
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]); 

    if (isSelected) {
        ctx.fillStyle = color + "33"; 
        ctx.fillRect(x,y,w,h);
    }
    
    ctx.fillStyle = color;
    const text = label;
    const textWidth = ctx.measureText(text).width;
    const textHeight = 16;
    
    let drawX = x;
    let drawY = y;
    if (w < 0) { drawX = x + w; }
    if (h < 0) { drawY = y + h; }

    ctx.fillRect(drawX, drawY - textHeight, textWidth + 4, textHeight);
    
    ctx.fillStyle = isLight(color) ? '#000' : '#fff';
    ctx.font = '12px Arial';
    ctx.textBaseline = 'top';
    ctx.fillText(text, drawX + 2, drawY - textHeight + 2);
}

function drawHandles(x, y, w, h, color) {
    let nx = x, ny = y, nw = w, nh = h;
    if (w < 0) { nx = x + w; nw = Math.abs(w); }
    if (h < 0) { ny = y + h; nh = Math.abs(h); }

    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;

    const handles = [
        [nx, ny], [nx + nw/2, ny], [nx + nw, ny],
        [nx + nw, ny + nh/2], [nx + nw, ny + nh],
        [nx + nw/2, ny + nh], [nx, ny + nh],
        [nx, ny + nh/2]
    ];

    handles.forEach(p => {
        ctx.fillRect(p[0] - HANDLE_SIZE/2, p[1] - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
        ctx.strokeRect(p[0] - HANDLE_SIZE/2, p[1] - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
    });
}

function isLight(color) {
    if (!color) return true;
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const brightness = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return brightness > 155;
}

function getMousePos(evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (evt.clientX - rect.left) * scaleX,
        y: (evt.clientY - rect.top) * scaleY
    };
}

function pointInRect(px, py, rx, ry, rw, rh) {
    let x = rx, y = ry, w = rw, h = rh;
    if (w < 0) { x += w; w = Math.abs(w); }
    if (h < 0) { y += h; h = Math.abs(h); }
    return px >= x && px <= x + w && py >= y && py <= y + h;
}

function getHandleRects(x, y, w, h) {
    let nx = x, ny = y, nw = w, nh = h;
    if (w < 0) { nx = x + w; nw = Math.abs(w); }
    if (h < 0) { ny = y + h; nh = Math.abs(h); }
    const hw = HANDLE_SIZE / 2;
    return {
        'nw': {x: nx - hw, y: ny - hw, w: HANDLE_SIZE, h: HANDLE_SIZE},
        'n': {x: nx + nw/2 - hw, y: ny - hw, w: HANDLE_SIZE, h: HANDLE_SIZE},
        'ne': {x: nx + nw - hw, y: ny - hw, w: HANDLE_SIZE, h: HANDLE_SIZE},
        'e': {x: nx + nw - hw, y: ny + nh/2 - hw, w: HANDLE_SIZE, h: HANDLE_SIZE},
        'se': {x: nx + nw - hw, y: ny + nh - hw, w: HANDLE_SIZE, h: HANDLE_SIZE},
        's': {x: nx + nw/2 - hw, y: ny + nh - hw, w: HANDLE_SIZE, h: HANDLE_SIZE},
        'sw': {x: nx - hw, y: ny + nh - hw, w: HANDLE_SIZE, h: HANDLE_SIZE},
        'w': {x: nx - hw, y: ny + nh/2 - hw, w: HANDLE_SIZE, h: HANDLE_SIZE},
    }
}

function hitTest(x, y) {
    if (currentImageIndex < 0 || !images[currentImageIndex]) return null;
    const boxes = images[currentImageIndex].boxes || [];
    
    if (selectedBoxIndex !== -1 && boxes[selectedBoxIndex]) {
        const box = boxes[selectedBoxIndex];
        const handles = getHandleRects(box.x, box.y, box.w, box.h);
        for (const [key, r] of Object.entries(handles)) {
            if (pointInRect(x, y, r.x, r.y, r.w, r.h)) {
                return { type: 'handle', index: selectedBoxIndex, handle: key };
            }
        }
    }
    
    for (let i = boxes.length - 1; i >= 0; i--) {
        const box = boxes[i];
        if (pointInRect(x, y, box.x, box.y, box.w, box.h)) {
            return { type: 'box', index: i };
        }
    }
    
    return null;
}

function handleMouseDown(e) {
    if (currentImageIndex === -1) return;
    if (e.button !== 0) return; 

    const pos = getMousePos(e);
    startX = pos.x;
    startY = pos.y;
    currentMouseX = pos.x;
    currentMouseY = pos.y;
    
    const hit = hitTest(pos.x, pos.y);
    
    if (hit) {
        if (hit.type === 'handle') {
            interactionMode = 'RESIZE';
            resizeHandle = hit.handle;
            selectedBoxIndex = hit.index;
            const b = images[currentImageIndex].boxes[selectedBoxIndex];
            originalBoxState = { ...b };
        } else if (hit.type === 'box') {
            interactionMode = 'MOVE';
            selectedBoxIndex = hit.index;
            dragStartX = pos.x;
            dragStartY = pos.y;
            const b = images[currentImageIndex].boxes[selectedBoxIndex];
            originalBoxState = { ...b };
        }
    } else {
        interactionMode = 'DRAW';
        selectedBoxIndex = -1; 
    }

    updateSelectionUI();
    drawCanvas();
}

function handleMouseMove(e) {
    const pos = getMousePos(e);
    currentMouseX = pos.x;
    currentMouseY = pos.y;

    if (interactionMode === 'NONE') {
        const hit = hitTest(pos.x, pos.y);
        if (hit && hit.type === 'handle') {
            canvas.style.cursor = getCursorForHandle(hit.handle);
        } else if (hit && hit.type === 'box') {
            canvas.style.cursor = 'move';
        } else {
            canvas.style.cursor = 'crosshair';
        }
    }

    if (interactionMode === 'DRAW') {
        drawCanvas();
    } else if (interactionMode === 'MOVE') {
        if (selectedBoxIndex === -1) return;
        const dx = currentMouseX - dragStartX;
        const dy = currentMouseY - dragStartY;
        const box = images[currentImageIndex].boxes[selectedBoxIndex];
        
        box.x = originalBoxState.x + dx;
        box.y = originalBoxState.y + dy;
        drawCanvas();
    } else if (interactionMode === 'RESIZE') {
        if (selectedBoxIndex === -1) return;
        const box = images[currentImageIndex].boxes[selectedBoxIndex];
        const dx = currentMouseX - startX;
        const dy = currentMouseY - startY;
        
        const ob = originalBoxState;
        
        let newX = ob.x;
        let newY = ob.y;
        let newW = ob.w;
        let newH = ob.h;

        let left = (ob.w > 0) ? ob.x : ob.x + ob.w;
        let right = (ob.w > 0) ? ob.x + ob.w : ob.x;
        let top = (ob.h > 0) ? ob.y : ob.y + ob.h;
        let bottom = (ob.h > 0) ? ob.y + ob.h : ob.y;
        
        const deltaX = currentMouseX - startX;
        const deltaY = currentMouseY - startY;

        if (resizeHandle.includes('e')) right = (ob.w > 0 ? ob.x + ob.w : ob.x) + deltaX;
        if (resizeHandle.includes('w')) left = (ob.w > 0 ? ob.x : ob.x + ob.w) + deltaX;
        if (resizeHandle.includes('s')) bottom = (ob.h > 0 ? ob.y + ob.h : ob.y) + deltaY;
        if (resizeHandle.includes('n')) top = (ob.h > 0 ? ob.y : ob.y + ob.h) + deltaY;

        box.x = left;
        box.y = top;
        box.w = right - left;
        box.h = bottom - top;
        
        drawCanvas();
    }
}

function getCursorForHandle(h) {
    switch(h) {
        case 'n': case 's': return 'ns-resize';
        case 'e': case 'w': return 'ew-resize';
        case 'nw': case 'se': return 'nwse-resize';
        case 'ne': case 'sw': return 'nesw-resize';
        default: return 'default';
    }
}

function handleMouseUp(e) {
    let changed = false;
    
    if (interactionMode === 'DRAW') {
        let w = currentMouseX - startX;
        let h = currentMouseY - startY;
        let x = startX;
        let y = startY;

        if (w < 0) { x += w; w = Math.abs(w); }
        if (h < 0) { y += h; h = Math.abs(h); }

        if (w > 5 && h > 5) {
             if (!images[currentImageIndex].boxes) images[currentImageIndex].boxes = [];
             images[currentImageIndex].boxes.push({
                classIndex: currentClassIndex,
                x: x,
                y: y,
                w: w,
                h: h
            });
            selectedBoxIndex = images[currentImageIndex].boxes.length - 1; 
            changed = true;
        }
    }
    
    if (interactionMode === 'RESIZE' || interactionMode === 'MOVE') {
         if (selectedBoxIndex !== -1) {
             const b = images[currentImageIndex].boxes[selectedBoxIndex];
             if (b.w < 0) { b.x += b.w; b.w = Math.abs(b.w); }
             if (b.h < 0) { b.y += b.h; b.h = Math.abs(b.h); }
             changed = true;
         }
    }

    interactionMode = 'NONE';
    resizeHandle = null;
    
    updateSelectionUI();
    renderImageList(); 
    drawCanvas();
    updateStatus();

    if (changed) {
        saveCurrentAnnotation();
    }
}

async function saveCurrentAnnotation() {
    if (currentImageIndex === -1 || !currentJobId) return;
    const img = images[currentImageIndex];
    if (!img) return;

    try {
        await fetch(`/api/jobs/${currentJobId}/annotations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                imageName: img.name,
                boxes: img.boxes
            })
        });
    } catch(err) {
        console.error("Save failed", err);
    }
}

function updateSelectionUI() {
    if (selectedBoxIndex !== -1 && images[currentImageIndex].boxes && images[currentImageIndex].boxes[selectedBoxIndex]) {
        selectionControls.style.display = 'block';
        reassignClassSelect.innerHTML = '';
        classes.forEach((c, i) => {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = c.name;
            if (i === images[currentImageIndex].boxes[selectedBoxIndex].classIndex) {
                opt.selected = true;
            }
            reassignClassSelect.appendChild(opt);
        });
    } else {
        selectionControls.style.display = 'none';
        reassignClassSelect.innerHTML = '';
    }
}

function updateStatus() {
    if (currentImageIndex !== -1) {
        const count = images[currentImageIndex].boxes ? images[currentImageIndex].boxes.length : 0;
        statusInfo.textContent = `${images[currentImageIndex].name} (${count} objects)`;
    } else {
        statusInfo.textContent = "No image selected";
    }
}

// --- Class Management ---

function renderClassList() {
    classList.innerHTML = '';
    classes.forEach((c, index) => {
        const div = document.createElement('div');
        div.className = `class-item ${index === currentClassIndex ? 'selected' : ''}`;
        
        div.innerHTML = `
            <div style="display:flex; align-items:center;">
                <span class="color-indicator" style="background-color: ${c.color}"></span>
                ${c.name}
            </div>
            <div style="display:flex; align-items:center;">
                <span style="font-size: 0.8em; color: #666; margin-right:5px;">ID: ${index}</span>
                <span class="delete-class-btn" data-index="${index}" title="Delete Class">✕</span>
            </div>
        `;
        
        div.addEventListener('click', (e) => {
            if (e.target.classList.contains('delete-class-btn')) return; 
            currentClassIndex = index;
            renderClassList();
        });
        
        const delBtn = div.querySelector('.delete-class-btn');
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteClass(index);
        });

        classList.appendChild(div);
    });
    
    updateSelectionUI();
}

async function addNewClass() {
    const name = newClassInput.value.trim();
    if (!name) return;
    
    const color = getRandomColor();
    
    classes.push({ name, color });
    newClassInput.value = '';
    currentClassIndex = classes.length - 1;
    
    await saveClasses();
    renderClassList();
}

async function deleteClass(index) {
    if (!confirm(`Delete class "${classes[index].name}"? This removes all boxes of this class.`)) return;
    
    classes.splice(index, 1);
    if (currentClassIndex >= classes.length) currentClassIndex = Math.max(0, classes.length - 1);
    
    // We can't easily iterate all images on server. 
    // BUT we have 'images' valid locally now, although paging could be an issue in future.
    // For now, we update local images and force save them? 
    // Or just save class list and let individual image logic handle bad class indices?
    // The drawing logic handles (if index >= classes.length -> 0).
    
    // Proper way: Iterate loaded images, fix indices, save them.
    for (let img of images) {
        if (!img.boxes) continue;
        const oldLen = img.boxes.length;
        
        img.boxes = img.boxes.filter(b => b.classIndex !== index);
        img.boxes.forEach(b => {
             if (b.classIndex > index) b.classIndex--;
        });
        
        if (img.boxes.length !== oldLen) {
            // Save this image
             await fetch(`/api/jobs/${currentJobId}/annotations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    imageName: img.name,
                    boxes: img.boxes
                })
            });
        }
    }
    
    await saveClasses();
    renderClassList();
    drawCanvas();
    updateStatus();
    renderImageList();
}

async function saveClasses() {
    try {
        await fetch('/api/classes', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(classes)
        });
    } catch(err) {
        console.error("Failed to save classes", err);
    }
}

function getRandomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

// --- Navigation ---

function handleKeyDown(e) {
    if (document.activeElement.tagName === 'INPUT') return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        if (currentImageIndex < images.length - 1) {
            selectImage(currentImageIndex + 1);
        }
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        if (currentImageIndex > 0) {
            selectImage(currentImageIndex - 1);
        }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedBoxIndex !== -1) {
            images[currentImageIndex].boxes.splice(selectedBoxIndex, 1);
            selectedBoxIndex = -1;
            drawCanvas();
            renderImageList();
            updateStatus();
            updateSelectionUI();
            saveCurrentAnnotation();
        }
    }
}

// --- Export ---
function exportData() {
    if (currentJobId) {
        window.location.href = `/api/export?job_id=${currentJobId}`;
    } else {
        window.location.href = '/api/export'; // All
    }
}

init();
