import os
import json
from collections import defaultdict

data_dir = r"e:\website\data"

subjects = defaultdict(int)
visuals_needed = 0
visual_types = defaultdict(int)

for root, _, files in os.walk(data_dir):
    for f in files:
        if f.endswith('.json'):
            path = os.path.join(root, f)
            try:
                with open(path, 'r', encoding='utf-8-sig') as file:
                    data = json.load(file)
                    for q in data.get('questions', []):
                        subj = q.get('subject', 'Unknown')
                        subjects[subj] += 1
                        
                        vs = q.get('visual_system', {})
                        if vs and vs.get('requires_visual'):
                            visuals_needed += 1
                            v_type = vs.get('visual_type', 'unknown')
                            visual_types[v_type] += 1
            except Exception as e:
                pass

print("=== Subject Counts ===")
for k, v in subjects.items():
    print(f"'{k}': {v}")

print("\n=== Visuals Needed ===")
print(f"Total files/questions needing visuals: {visuals_needed}")
for k, v in visual_types.items():
    print(f"'{k}': {v}")
