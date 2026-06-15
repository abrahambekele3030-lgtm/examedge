import json
import os
import re
import matplotlib.pyplot as plt
import numpy as np

manifest_path = r"e:\website\visuals_manifest.json"
out_dir = r"e:\website\images"
os.makedirs(out_dir, exist_ok=True)

with open(manifest_path, 'r', encoding='utf-8') as f:
    visuals = json.load(f)

# Keep track of updated files
updated_files = set()

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
        updated_files.add(file_path)

def generate_number_line(v):
    qid = v['question_id']
    desc = v['visual_description'].lower()
    
    # Defaults
    start, end = -10, 10
    
    # Try to find range "from X to Y"
    m = re.search(r'from\s+(-?\d+)\s+to\s+(-?\d+)', desc)
    if m:
        start, end = int(m.group(1)), int(m.group(2))
        # Add padding
        start -= 1
        end += 1
    
    fig, ax = plt.subplots(figsize=(8, 2))
    
    # Draw main line
    ax.axhline(0, color='black', linewidth=2)
    
    # Ticks
    ticks = np.arange(start, end + 1)
    ax.set_xticks(ticks)
    ax.set_xticklabels([str(t) for t in ticks], fontsize=12)
    ax.set_yticks([])
    
    # Arrows on ends
    ax.plot(start, 0, '<k', markersize=8)
    ax.plot(end, 0, '>k', markersize=8)
    
    # Parse points
    # Closed circles: "closed circle at X", "filled circles at X and Y", "point at X"
    closed_points = [float(x) for x in re.findall(r'closed circle at\s+(-?\d+(?:\.\d+)?)', desc)]
    closed_points += [float(x) for x in re.findall(r'filled circle at\s+(-?\d+(?:\.\d+)?)', desc)]
    # "points at X and Y"
    m_pts = re.search(r'points\s+at\s+(-?\d+(?:\.\d+)?)\s+and\s+(-?\d+(?:\.\d+)?)', desc)
    if m_pts and "open" not in desc:
        closed_points.extend([float(m_pts.group(1)), float(m_pts.group(2))])
    
    open_points = [float(x) for x in re.findall(r'open circle at\s+(-?\d+(?:\.\d+)?)', desc)]
    
    # Specific edge cases parsed via qid
    if qid == 'G11_Math_U2_Q045': # Open at -1, Closed at 2. Positive to left of -1, right of 2
        open_points = [-1]
        closed_points = [2]
        ax.plot([-1, start], [0, 0], 'r-', linewidth=4)
        ax.plot([2, end], [0, 0], 'r-', linewidth=4)
        ax.plot(-1, 0, 'w', marker='o', markersize=10, markeredgecolor='r', markeredgewidth=2)
        ax.plot(2, 0, 'r', marker='o', markersize=10)
    elif qid == 'G9_Math_U1_Q010': # open at \sqrt{2}
        closed_points = [1, 2]
        open_points = []
        ax.plot(1.414, 0, 'w', marker='o', markersize=10, markeredgecolor='b', markeredgewidth=2)
        ax.text(1.414, 0.2, r'$\sqrt{2}$', ha='center')
    elif qid == 'G9_Math_U1_Q019': # between -3 and 8
        closed_points = [-3, 8]
        ax.plot([-3, 8], [0, 0], 'b-', linewidth=4)
    elif qid == 'G9_Math_U1_Q020': # distance 7 between -3 and 4
        closed_points = [-3, 4]
        ax.annotate('7 units', xy=(-3, 0.2), xytext=(4, 0.2), arrowprops=dict(arrowstyle='<->', color='r'))
    elif qid == 'G9_Math_U1_Q038': # sqrt 10
        ax.plot(3.162, 0, 'ko', markersize=8)
        ax.text(3.162, 0.2, r'$\sqrt{10}$', ha='center')
    elif qid == 'G9_Math_U1_Q040': # |x|=8
        closed_points = [-8, 8]
        ax.annotate('8', xy=(-8, 0.2), xytext=(0, 0.2), arrowprops=dict(arrowstyle='<->'))
        ax.annotate('8', xy=(0, 0.2), xytext=(8, 0.2), arrowprops=dict(arrowstyle='<->'))
    elif qid == 'G9_Math_U1_Q041': # > 5
        open_points = [5]
        ax.plot([5, end], [0, 0], 'b-', linewidth=4)
    elif qid == 'G9_Math_U1_Q055': # |2 - sqrt(8)|
        open_points = [-0.828]
        closed_points = [0, 0.828]
        ax.text(-0.828, 0.2, r'$2-\sqrt{8}$', ha='center')
        ax.text(0.828, 0.2, r'$\sqrt{8}-2$', ha='center')
    elif qid == 'G9_Math_U1_Q057': # 44.5 to 45.5
        closed_points = [44.5]
        open_points = [45.5]
        ax.plot([44.5, 45.5], [0, 0], 'b-', linewidth=4)
    elif qid == 'G9_Math_U2_Q034': # x = -2/3 and x = 4
        closed_points = [-0.667, 4]
        ax.text(-0.667, 0.2, r'$-2/3$', ha='center')
    elif qid == 'G9_Math_U2_Q043': # x=7 and x=-21
        closed_points = [7, -21]
        ax.set_xticks(np.arange(-25, 15, 5))
        ax.set_xlim(-25, 10)
    else:
        # Generic rendering for others
        for cp in closed_points:
            ax.plot(cp, 0, 'b', marker='o', markersize=10)
        for op in open_points:
            ax.plot(op, 0, 'w', marker='o', markersize=10, markeredgecolor='b', markeredgewidth=2)

    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['left'].set_visible(False)
    ax.spines['bottom'].set_position('zero')
    
    plt.tight_layout()
    filename = f"{qid}_visual.png"
    filepath = os.path.join(out_dir, filename)
    plt.savefig(filepath, dpi=150)
    plt.close()
    
    update_json(v['file'], qid, filename)
    print(f"Generated {filename}")

count = 0
for v in visuals:
    if v['visual_type'] == 'number_line':
        generate_number_line(v)
        count += 1

print(f"Finished generating {count} number lines.")
print(f"Updated {len(updated_files)} JSON files.")
