import json
import os
import matplotlib.pyplot as plt
import numpy as np

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
    if vtype not in ['coordinate_graph', 'scientific_graph', 'bar_chart', 'line_graph']:
        continue
        
    fig, ax = plt.subplots(figsize=(6, 4))
    
    desc = v['visual_description'].lower()
    
    if vtype == 'coordinate_graph' or vtype == 'scientific_graph':
        # Generic coordinate system styling
        ax.axhline(0, color='black', linewidth=1)
        ax.axvline(0, color='black', linewidth=1)
        ax.grid(True, linestyle='--', alpha=0.6)
        
        # Simple heuristic plotting based on words in description
        if 'exponential' in desc or '2^x' in desc or 'curve' in desc:
            x = np.linspace(-3, 3, 100)
            y = 2**x
            ax.plot(x, y, 'b-', linewidth=2)
            if 'log' in desc:
                x2 = np.linspace(0.1, 3, 100)
                y2 = np.log2(x2)
                ax.plot(x2, y2, 'r-', linewidth=2)
                ax.plot(x, x, 'k--', alpha=0.5)
        elif 'vector' in desc or 'arrow' in desc:
            ax.quiver(0, 0, 5, 2, angles='xy', scale_units='xy', scale=1, color='b')
            if 'two' in desc:
                ax.quiver(0, 0, 1, 4, angles='xy', scale_units='xy', scale=1, color='r')
            ax.set_xlim(-1, 6)
            ax.set_ylim(-1, 5)
        elif 'energy' in desc or 'activation' in desc:
            x = np.linspace(0, 10, 100)
            y = 10 + 20*np.exp(-(x-4)**2) - x
            ax.plot(x, y, 'g-', linewidth=2)
            ax.set_xticks([])
            ax.set_yticks([])
            ax.set_ylabel('Potential Energy')
            ax.set_xlabel('Reaction Progress')
        else:
            x = np.linspace(-5, 5, 100)
            y = x**2 - 4
            ax.plot(x, y, 'b-', linewidth=2)
            
    elif vtype == 'bar_chart':
        categories = ['A', 'B', 'C', 'D']
        values = [10, 24, 16, 32]
        ax.bar(categories, values, color='skyblue', edgecolor='black')
        
    elif vtype == 'line_graph':
        x = [1, 2, 3, 4, 5]
        y = [2, 3, 5, 7, 11]
        ax.plot(x, y, marker='o', linestyle='-', color='purple')
        ax.grid(True, linestyle='--', alpha=0.6)
        
    plt.title(f"Mathematical Diagram ({vtype})", fontsize=10)
    plt.tight_layout()
    filename = f"{qid}_{vtype}.png"
    filepath = os.path.join(out_dir, filename)
    plt.savefig(filepath, dpi=150)
    plt.close()
    
    update_json(v['file'], qid, filename)
    count += 1

print(f"Generated {count} graphs and charts.")
