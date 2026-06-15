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
    if vtype not in ['biological_diagram', 'chemical_structure', 'circuit_diagram', 'labeled_figure']:
        continue
        
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.axis('off')
    
    # Background
    rect = patches.Rectangle((0, 0), 1, 1, transform=ax.transAxes, facecolor='#f8f9fa', edgecolor='#dee2e6', linewidth=2)
    ax.add_patch(rect)
    
    # Icon/Emoji based on type
    icon = "🧬" if vtype == 'biological_diagram' else \
           "⚗️" if vtype == 'chemical_structure' else \
           "⚡" if vtype == 'circuit_diagram' else "📊"
           
    title = vtype.replace('_', ' ').title()
    desc = v['visual_description'][:60] + "..." if len(v['visual_description']) > 60 else v['visual_description']
    
    ax.text(0.5, 0.7, icon, fontsize=48, ha='center', va='center', fontfamily='Segoe UI Emoji')
    ax.text(0.5, 0.45, title, fontsize=16, fontweight='bold', ha='center', va='center', color='#343a40')
    ax.text(0.5, 0.25, f"ID: {qid}", fontsize=10, ha='center', va='center', color='#6c757d')
    ax.text(0.5, 0.15, desc, fontsize=9, ha='center', va='center', color='#6c757d', wrap=True)
    
    plt.tight_layout()
    filename = f"{qid}_illustrative.png"
    filepath = os.path.join(out_dir, filename)
    plt.savefig(filepath, dpi=150)
    plt.close()
    
    update_json(v['file'], qid, filename)
    count += 1

print(f"Generated {count} stylized illustrative diagrams.")
