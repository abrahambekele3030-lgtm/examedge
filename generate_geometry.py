import json
import os
import matplotlib.pyplot as plt
import matplotlib.patches as patches

manifest_path = r"e:\website\visuals_manifest.json"
out_dir = r"e:\website\images"
os.makedirs(out_dir, exist_ok=True)

with open(manifest_path, 'r', encoding='utf-8') as f:
    visuals = json.load(f)

def update_json(file_path, question_id, image_filename):
    with open(file_path, 'r', encoding='utf-8-sig') as f:
        data = json.load(f)
    changed = False
    for q in data.get('questions', []):
        if q.get('question_id') == question_id:
            vs = q.get('visual_system', {})
            vs['image_url'] = f"images/{image_filename}"
            q['visual_system'] = vs
            changed = True
    if changed:
        with open(file_path, 'w', encoding='utf-8-sig') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

count = 0
for v in visuals:
    vtype = v['visual_type']
    qid = v['question_id']
    if vtype != 'geometry_diagram':
        continue
        
    fig, ax = plt.subplots(figsize=(5, 5))
    ax.set_aspect('equal')
    ax.axis('off')
    
    desc = v['visual_description'].lower()
    
    # Generic beautiful geometry art based on keywords
    if 'circle' in desc and 'triangle' in desc:
        circ = patches.Circle((0.5, 0.5), 0.4, fill=False, edgecolor='blue', linewidth=2)
        poly = patches.Polygon([[0.1, 0.1], [0.9, 0.1], [0.5, 0.8]], fill=False, edgecolor='red', linewidth=2)
        ax.add_patch(circ)
        ax.add_patch(poly)
    elif 'circle' in desc and 'square' in desc:
        circ = patches.Circle((0.5, 0.5), 0.4, fill=False, edgecolor='blue', linewidth=2)
        rect = patches.Rectangle((0.1, 0.1), 0.8, 0.8, fill=False, edgecolor='green', linewidth=2)
        ax.add_patch(circ)
        ax.add_patch(rect)
    elif 'circle' in desc and ('chord' in desc or 'secant' in desc or 'tangent' in desc):
        circ = patches.Circle((0.5, 0.5), 0.4, fill=False, edgecolor='blue', linewidth=2)
        ax.add_patch(circ)
        ax.plot([0.2, 0.8], [0.8, 0.2], 'k-', linewidth=1.5)
        ax.plot([0.1, 0.9], [0.5, 0.5], 'k-', linewidth=1.5)
        ax.plot(0.5, 0.5, 'ko', markersize=4)
        ax.text(0.52, 0.52, 'O')
    elif 'vector' in desc or 'plane' in desc:
        ax.arrow(0.2, 0.2, 0.6, 0.6, head_width=0.05, head_length=0.1, fc='blue', ec='blue')
        ax.arrow(0.2, 0.2, 0.6, 0.0, head_width=0.05, head_length=0.1, fc='red', ec='red')
    else:
        # Default abstract geometry
        circ = patches.Circle((0.5, 0.5), 0.3, fill=False, edgecolor='purple', linewidth=2)
        poly = patches.Polygon([[0.2, 0.2], [0.8, 0.2], [0.5, 0.8]], fill=False, edgecolor='orange', linewidth=2)
        ax.add_patch(circ)
        ax.add_patch(poly)
        
    plt.title(f"Geometry Diagram ({qid})", fontsize=10)
    plt.tight_layout()
    filename = f"{qid}_geometry.png"
    filepath = os.path.join(out_dir, filename)
    plt.savefig(filepath, dpi=150)
    plt.close()
    
    update_json(v['file'], qid, filename)
    count += 1

print(f"Generated {count} geometry diagrams.")
