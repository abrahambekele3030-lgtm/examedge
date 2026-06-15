import os
import json

data_dir = r"e:\website\data"
out_file = r"e:\website\visuals_manifest.json"

visuals = []

for root, _, files in os.walk(data_dir):
    for f in files:
        if f.endswith('.json'):
            path = os.path.join(root, f)
            try:
                with open(path, 'r', encoding='utf-8-sig') as file:
                    data = json.load(file)
                    
                for q in data.get('questions', []):
                    vs = q.get('visual_system', {})
                    if vs and vs.get('requires_visual'):
                        visuals.append({
                            'file': path,
                            'question_id': q.get('question_id'),
                            'question_text': q.get('question'),
                            'visual_type': vs.get('visual_type'),
                            'visual_description': vs.get('visual_description'),
                            'subject': q.get('subject')
                        })
            except Exception as e:
                pass

with open(out_file, 'w', encoding='utf-8') as f:
    json.dump(visuals, f, indent=2)

print(f"Extracted {len(visuals)} visuals to {out_file}")
