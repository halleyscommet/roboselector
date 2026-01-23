import os
import json
import zipfile
import io
import shutil
import time
from flask import Flask, render_template, request, jsonify, send_from_directory, send_file
from PIL import Image

app = Flask(__name__)

# Configuration - No upload size limit
app.config['MAX_CONTENT_LENGTH'] = None  # No limit
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
JOBS_DIR = os.path.join(DATA_DIR, 'jobs')
CLASSES_FILE = os.path.join(DATA_DIR, 'classes.json')

# Ensure directories exist
os.makedirs(JOBS_DIR, exist_ok=True)

# Migration: If old structure exists, move it to 'default' job
OLD_IMAGES_DIR = os.path.join(DATA_DIR, 'images')
OLD_ANNOTATIONS_DIR = os.path.join(DATA_DIR, 'annotations')

if os.path.exists(OLD_IMAGES_DIR):
    default_job_path = os.path.join(JOBS_DIR, 'default')
    os.makedirs(default_job_path, exist_ok=True)
    
    # Move images folder if it's not already linked/moved
    # Actually shutil.move moves the directory itself
    if not os.path.exists(os.path.join(default_job_path, 'images')):
        shutil.move(OLD_IMAGES_DIR, os.path.join(default_job_path, 'images'))
    
    if os.path.exists(OLD_ANNOTATIONS_DIR) and not os.path.exists(os.path.join(default_job_path, 'annotations')):
        shutil.move(OLD_ANNOTATIONS_DIR, os.path.join(default_job_path, 'annotations'))
        
    # Create meta
    if not os.path.exists(os.path.join(default_job_path, 'meta.json')):
        with open(os.path.join(default_job_path, 'meta.json'), 'w') as f:
            json.dump({'name': 'Default Job', 'created': 0}, f)

if not os.path.exists(CLASSES_FILE):
    with open(CLASSES_FILE, 'w') as f:
        json.dump([{'name': 'object', 'color': '#00ff00'}], f)

# Error handler for file too large
@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'Upload too large. Maximum size is 10GB.'}), 413

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/data/jobs/<job_id>/images/<path:filename>')
def serve_image(job_id, filename):
    return send_from_directory(os.path.join(JOBS_DIR, job_id, 'images'), filename)

@app.route('/api/jobs', methods=['GET'])
def list_jobs():
    jobs = []
    if os.path.exists(JOBS_DIR):
        for dirname in os.listdir(JOBS_DIR):
            dirpath = os.path.join(JOBS_DIR, dirname)
            if os.path.isdir(dirpath):
                meta_path = os.path.join(dirpath, 'meta.json')
                meta = {}
                if os.path.exists(meta_path):
                    try:
                        with open(meta_path, 'r') as f:
                            meta = json.load(f)
                    except:
                        pass
                
                # count images
                img_count = 0
                img_dir = os.path.join(dirpath, 'images')
                if os.path.exists(img_dir):
                     img_count = len([n for n in os.listdir(img_dir) if not n.startswith('.')])

                jobs.append({
                    'id': dirname,
                    'name': meta.get('name', dirname),
                    'count': img_count
                })
    return jsonify(jobs)

@app.route('/api/jobs', methods=['POST'])
def create_job():
    data = request.json
    name = data.get('name', 'New Job')
    
    # Simple ID generation
    job_id = f"job_{int(time.time())}"
    
    job_path = os.path.join(JOBS_DIR, job_id)
    os.makedirs(os.path.join(job_path, 'images'), exist_ok=True)
    os.makedirs(os.path.join(job_path, 'annotations'), exist_ok=True)
    
    with open(os.path.join(job_path, 'meta.json'), 'w') as f:
        json.dump({'name': name, 'created': time.time()}, f)
        
    return jsonify({'status': 'ok', 'id': job_id})

@app.route('/api/jobs/<job_id>/upload', methods=['POST'])
def upload_images(job_id):
    files = request.files.getlist('images')
    uploaded = []
    
    job_dir = os.path.join(JOBS_DIR, job_id)
    if not os.path.exists(job_dir):
        return jsonify({'error': 'Job not found'}), 404
    
    images_dir = os.path.join(job_dir, 'images')
    
    for file in files:
        if file.filename == '':
            continue
        
        # Save file
        path = os.path.join(images_dir, file.filename)
        file.save(path)
        
        # dimensions
        width, height = 0, 0
        try:
            with Image.open(path) as im:
                width, height = im.size
        except:
            pass
            
        uploaded.append({
            'name': file.filename,
            'url': f'/data/jobs/{job_id}/images/{file.filename}',
            'width': width,
            'height': height,
            'boxes': []
        })
        
    return jsonify({'status': 'ok', 'images': uploaded})

@app.route('/api/jobs/<job_id>/import_yolo', methods=['POST'])
def import_yolo_dataset(job_id):
    """Import YOLO format dataset (ZIP with images/ and labels/ folders)"""
    
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    job_dir = os.path.join(JOBS_DIR, job_id)
    if not os.path.exists(job_dir):
        return jsonify({'error': 'Job not found'}), 404
    
    images_dir = os.path.join(job_dir, 'images')
    annotations_dir = os.path.join(job_dir, 'annotations')
    os.makedirs(images_dir, exist_ok=True)
    os.makedirs(annotations_dir, exist_ok=True)
    
    try:
        # Read ZIP file
        zip_bytes = io.BytesIO(file.read())
        
        imported_count = 0
        skipped_count = 0
        
        with zipfile.ZipFile(zip_bytes, 'r') as zf:
            # First, extract all images
            image_files = {}
            for zip_info in zf.namelist():
                # Skip directories and hidden files
                if zip_info.endswith('/') or os.path.basename(zip_info).startswith('.'):
                    continue
                
                # Check if it's an image in images/ folder or root
                if zip_info.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.bmp')):
                    filename = os.path.basename(zip_info)
                    
                    # Extract image
                    img_path = os.path.join(images_dir, filename)
                    with zf.open(zip_info) as source, open(img_path, 'wb') as target:
                        target.write(source.read())
                    
                    # Get image dimensions
                    width, height = 0, 0
                    try:
                        with Image.open(img_path) as im:
                            width, height = im.size
                    except:
                        pass
                    
                    image_files[filename] = {'width': width, 'height': height}
                    imported_count += 1
            
            # Now process label files
            for zip_info in zf.namelist():
                # Skip directories and hidden files
                if zip_info.endswith('/') or os.path.basename(zip_info).startswith('.'):
                    continue
                
                # Check if it's a label file
                if zip_info.lower().endswith('.txt'):
                    label_filename = os.path.basename(zip_info)
                    
                    # Skip classes.txt
                    if label_filename.lower() == 'classes.txt':
                        continue
                    
                    # Find corresponding image
                    base_name = os.path.splitext(label_filename)[0]
                    img_filename = None
                    
                    for img_name in image_files.keys():
                        if os.path.splitext(img_name)[0] == base_name:
                            img_filename = img_name
                            break
                    
                    if img_filename is None:
                        skipped_count += 1
                        continue
                    
                    width = image_files[img_filename]['width']
                    height = image_files[img_filename]['height']
                    
                    if width == 0 or height == 0:
                        skipped_count += 1
                        continue
                    
                    # Parse YOLO format
                    with zf.open(zip_info) as f:
                        yolo_lines = f.read().decode('utf-8').strip().split('\n')
                    
                    boxes = []
                    for line in yolo_lines:
                        line = line.strip()
                        if not line:
                            continue
                        
                        parts = line.split()
                        if len(parts) < 5:
                            continue
                        
                        try:
                            class_idx = int(parts[0])
                            x_center_norm = float(parts[1])
                            y_center_norm = float(parts[2])
                            w_norm = float(parts[3])
                            h_norm = float(parts[4])
                            
                            # Convert from YOLO format (normalized center coords) 
                            # to internal format (top-left coords in pixels)
                            x_center = x_center_norm * width
                            y_center = y_center_norm * height
                            box_width = w_norm * width
                            box_height = h_norm * height
                            
                            x = x_center - box_width / 2
                            y = y_center - box_height / 2
                            
                            boxes.append({
                                'classIndex': class_idx,
                                'x': x,
                                'y': y,
                                'w': box_width,
                                'h': box_height
                            })
                        except (ValueError, IndexError):
                            continue
                    
                    # Save annotation
                    if boxes:
                        ann_path = os.path.join(annotations_dir, f"{img_filename}.json")
                        with open(ann_path, 'w') as f:
                            json.dump(boxes, f, indent=2)
        
        return jsonify({
            'status': 'ok',
            'imported': imported_count,
            'skipped': skipped_count,
            'message': f'Imported {imported_count} images with annotations'
        })
        
    except zipfile.BadZipFile:
        return jsonify({'error': 'Invalid ZIP file'}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/jobs/<job_id>/annotations', methods=['POST'])
def save_annotation(job_id):
    # Expects { imageName, boxes }
    data = request.json
    image_name = data.get('imageName')
    boxes = data.get('boxes')
    
    if not image_name:
        return jsonify({'error': 'No image name'}), 400
        
    job_dir = os.path.join(JOBS_DIR, job_id)
    annotations_dir = os.path.join(job_dir, 'annotations')
    if not os.path.exists(annotations_dir):
         os.makedirs(annotations_dir, exist_ok=True)
        
    path = os.path.join(annotations_dir, f"{image_name}.json")
    with open(path, 'w') as f:
        json.dump(boxes, f, indent=2)
        
    return jsonify({'status': 'saved'})

@app.route('/api/jobs/<job_id>/init', methods=['GET'])
def get_job_data(job_id):
    # Load Classes (Global)
    try:
        with open(CLASSES_FILE, 'r') as f:
            classes = json.load(f)
    except:
        classes = [{'name': 'object', 'color': '#00ff00'}]

    # Job Paths
    job_dir = os.path.join(JOBS_DIR, job_id)
    if not os.path.exists(job_dir):
        return jsonify({'error': 'Job not found'}), 404
        
    images_dir = os.path.join(job_dir, 'images')
    annotations_dir = os.path.join(job_dir, 'annotations')
    
    # Load Images
    images = []
    if os.path.exists(images_dir):
        for filename in os.listdir(images_dir):
            if filename.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.bmp')):
                img_path = os.path.join(images_dir, filename)
                
                # Get annotations
                boxes = []
                ann_path = os.path.join(annotations_dir, f"{filename}.json")
                if os.path.exists(ann_path):
                    try:
                        with open(ann_path, 'r') as f:
                            boxes = json.load(f)
                    except:
                        pass
                
                # fast size check
                width, height = 0, 0
                try:
                    with Image.open(img_path) as im:
                        width, height = im.size
                except:
                    pass

                images.append({
                    'name': filename,
                    'url': f'/data/jobs/{job_id}/images/{filename}',
                    'width': width,
                    'height': height,
                    'boxes': boxes
                })
    
    # Sort images by name
    images.sort(key=lambda x: x['name'])

    return jsonify({
        'classes': classes,
        'images': images
    })

@app.route('/api/classes', methods=['POST'])
def save_classes():
    data = request.json
    if data:
        with open(CLASSES_FILE, 'w') as f:
            json.dump(data, f, indent=2)
    return jsonify({'status': 'ok'})

@app.route('/api/export', methods=['GET'])
def export_dataset():
    # Optional: ?job_id=<id>
    target_job_id = request.args.get('job_id')
    
    # Create valid YOLO export
    memory_file = io.BytesIO()
    with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
        
        # 1. Classes
        with open(CLASSES_FILE, 'r') as f:
            classes = json.load(f)
        class_names = [c['name'] for c in classes]
        zf.writestr('classes.txt', '\n'.join(class_names))
        
        # 2. Images and Labels
        img_folder = 'images/'
        lbl_folder = 'labels/'
        
        # Determine which jobs to include
        job_dirs = []
        if target_job_id:
             p = os.path.join(JOBS_DIR, target_job_id)
             if os.path.exists(p):
                 job_dirs.append(p)
        else:
             if os.path.exists(JOBS_DIR):
                 job_dirs = [os.path.join(JOBS_DIR, d) for d in os.listdir(JOBS_DIR) if os.path.isdir(os.path.join(JOBS_DIR, d))]

        for job_path in job_dirs:
            images_dir = os.path.join(job_path, 'images')
            annotations_dir = os.path.join(job_path, 'annotations')
            
            if not os.path.exists(images_dir):
                continue
                
            for filename in os.listdir(images_dir):
                if not filename.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.bmp')):
                    continue
                    
                img_path = os.path.join(images_dir, filename)
                
                # Write Image
                zf.write(img_path, f"{img_folder}{filename}")
                
                # Load annotation
                ann_path = os.path.join(annotations_dir, f"{filename}.json")
                if os.path.exists(ann_path):
                    with open(ann_path, 'r') as f:
                        boxes = json.load(f)
                    
                    # We need dimensions to normalize
                    width, height = 0, 0
                    try:
                        with Image.open(img_path) as im:
                            width, height = im.size
                    except:
                        pass
                    
                    if width > 0 and height > 0 and boxes:
                        yolo_lines = []
                        dw = 1.0 / width
                        dh = 1.0 / height
                        
                        for box in boxes:
                            cls_idx = box.get('classIndex', 0)
                            if cls_idx >= len(class_names):
                                cls_idx = 0
                            
                            bx, by, bw, bh = box['x'], box['y'], box['w'], box['h']
                            
                            # Normalize
                            x_center = bx + bw / 2.0
                            y_center = by + bh / 2.0
                            
                            nx = x_center * dw
                            ny = y_center * dh
                            nw = bw * dw
                            nh = bh * dh
                            
                            yolo_lines.append(f"{cls_idx} {nx:.6f} {ny:.6f} {nw:.6f} {nh:.6f}")
                        
                        txt_name = os.path.splitext(filename)[0] + ".txt"
                        zf.writestr(f"{lbl_folder}{txt_name}", '\n'.join(yolo_lines))

    memory_file.seek(0)
    return send_file(
        memory_file,
        mimetype='application/zip',
        as_attachment=True,
        download_name='yolo_dataset.zip'
    )

if __name__ == '__main__':
    # Port 5001 to avoid conflict with macOS AirPlay (port 5000)
    # Host 0.0.0.0 allows access from other computers on the network
    app.run(debug=True, host='0.0.0.0', port=5001)
