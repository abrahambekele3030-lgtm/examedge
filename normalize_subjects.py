import os
import json

data_dir = r"e:\website\data"
modified_files = 0

for root, _, files in os.walk(data_dir):
    for f in files:
        if f.endswith('.json'):
            path = os.path.join(root, f)
            changed = False
            try:
                with open(path, 'r', encoding='utf-8-sig') as file:
                    data = json.load(file)
                    
                for q in data.get('questions', []):
                    if q.get('subject') == 'PHYSICS':
                        q['subject'] = 'Physics'
                        changed = True
                        
                if changed:
                    with open(path, 'w', encoding='utf-8-sig') as file:
                        json.dump(data, file, indent=2, ensure_ascii=False)
                    modified_files += 1
            except Exception as e:
                print(f"Error processing {path}: {e}")

print(f"Normalized subject in {modified_files} files.")
