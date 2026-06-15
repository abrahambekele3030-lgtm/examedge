import re
import json
import os

print("=== Starting Math Rendering Logic Tests ===")

def formatText(text):
    if text is None:
        return ''
    str_text = str(text)

    # Extract math blocks
    mathBlocks = []
    
    # Python equivalent of the JS regex
    # /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\begin\{[a-zA-Z*]+\}[\s\S]*?\\end\{[a-zA-Z*]+\}|\$[\s\S]*?\$|\\\([\s\S]*?\\\))/g
    math_pattern = re.compile(r'(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\begin\{[a-zA-Z*]+\}[\s\S]*?\\end\{[a-zA-Z*]+\}|\$[\s\S]*?\$|\\\([\s\S]*?\\\))')
    
    def repl_math(match):
        mathBlocks.append(match.group(1))
        return f"__MATH_BLOCK_{len(mathBlocks) - 1}__"
        
    str_text = math_pattern.sub(repl_math, str_text)

    # Apply markdown
    str_text = re.sub(r'(^|\s)\*\*([^\s].*?[^\s]|\S)\*\*(?=\s|$|[.,!?])', r'\1<strong>\2</strong>', str_text)
    str_text = re.sub(r'(^|\s)\*([^\s].*?[^\s]|\S)\*(?=\s|$|[.,!?])', r'\1<em>\2</em>', str_text)
    str_text = re.sub(r'`(.+?)`', r'<code class="inline-code">\1</code>', str_text)
    str_text = str_text.replace('\n', '<br>')

    # Restore math blocks using split/join equivalent
    for i, block in enumerate(mathBlocks):
        str_text = str_text.replace(f"__MATH_BLOCK_{i}__", block)

    return str_text

def assert_equal(actual, expected, test_name):
    if actual == expected:
        print(f"[PASS] {test_name}")
    else:
        print(f"[FAIL] {test_name}\n  Expected: {expected}\n  Actual:   {actual}")

# Test 1: Markdown doesn't corrupt math
test1_input = "value **bold** and \\(A_n\\)"
test1_expected = "value <strong>bold</strong> and \\(A_n\\)"
assert_equal(formatText(test1_input), test1_expected, "Test 1: Markdown + Math")

# Test 2: Multiple identical math blocks
test2_input = "First \\(x^2\\), second \\(x^2\\)"
test2_expected = "First \\(x^2\\), second \\(x^2\\)"
assert_equal(formatText(test2_input), test2_expected, "Test 2: Multiple Identical Math Blocks")

# Test 3: Markdown asterisks collision
test3_input = "Solve 14 *d* where \\(d = 2\\)"
test3_expected = "Solve 14 <em>d</em> where \\(d = 2\\)"
assert_equal(formatText(test3_input), test3_expected, "Test 3: Asterisk Collision")

print("\n=== Validating Data Integrity ===")
data_file = r"e:\website\data\Mathematics\Grade_12\Unit_1\R1.json"
try:
    with open(data_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    formulas_found = 0
    corrupt_formulas = 0
    for q in data.get('questions', []):
        exp = q.get('explanations_tiered', {})
        fa = exp.get('formula_analysis', [])
        if isinstance(fa, list):
            for item in fa:
                formulas_found += 1
                if not isinstance(item, (str, dict)):
                    corrupt_formulas += 1
                    
    print(f"Scanned {len(data.get('questions', []))} questions.")
    print(f"Found {formulas_found} formula analysis items.")
    print(f"Found {corrupt_formulas} corrupt items.")
    if corrupt_formulas == 0:
        print("[PASS] Data integrity checks passed.")
except Exception as e:
    print(f"[FAIL] Data read error: {e}")

print("Tests completed.")
