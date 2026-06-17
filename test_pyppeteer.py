import asyncio
import sys
from pyppeteer import launch

async def run_tests():
    print("Starting automated tests with pyppeteer...")
    browser = await launch(headless=True)
    page = await browser.newPage()
    
    print("Loading http://localhost:8080/")
    await page.goto("http://localhost:8080/")
    
    print("Waiting for app to load questions...")
    try:
        await page.waitForSelector("#app:not(.hidden)", timeout=15000)
        await page.waitForSelector(".question-card", timeout=5000)
        print("App loaded successfully.")
    except Exception as e:
        print(f"Failed to load app: {e}")
        await browser.close()
        sys.exit(1)
        
    print("Running unit tests inside browser context...")
    results = await page.evaluate("""() => {
        let passed = 0;
        let failed = 0;
        let errors = [];
        
        function assert(condition, message) {
            if (!condition) {
                failed++;
                errors.push(message);
            } else {
                passed++;
            }
        }
        
        // Test 1: formatText doesn't corrupt math when markdown is nearby
        let t1 = formatText("value **bold** and \\\\(A_n\\\\)");
        assert(t1.includes("<strong>bold</strong>"), "Test 1a failed: " + t1);
        assert(t1.includes("\\\\(A_n\\\\)"), "Test 1b failed: Math block corrupted: " + t1);
        
        // Test 2: Multiple identical math blocks
        let t2 = formatText("First \\\\(x^2\\\\), second \\\\(x^2\\\\)");
        assert(t2.indexOf("\\\\(x^2\\\\)") !== -1 && t2.lastIndexOf("\\\\(x^2\\\\)") !== t2.indexOf("\\\\(x^2\\\\)"), "Test 2 failed: " + t2);
        
        // Test 3: MathJax is loaded
        assert(window.MathJax !== undefined, "Test 3 failed: MathJax not loaded");
        
        return {passed, failed, errors};
    }""")
    
    print(f"Unit Test Results: {results['passed']} passed, {results['failed']} failed.")
    for err in results['errors']:
        print(f"ERROR: {err}")
        
    if results['failed'] > 0:
        print("Unit tests failed!")
        await browser.close()
        sys.exit(1)
        
    print("Testing UI Math rendering...")
    await page.waitForTimeout(2000)
    
    mathjax_count = await page.evaluate("document.querySelectorAll('mjx-container').length")
    print(f"Found {mathjax_count} MathJax elements on the page.")
    
    if mathjax_count == 0:
        print("ERROR: No MathJax elements found. Rendering might have failed.")
    else:
        print("MathJax rendered successfully!")
        
    print("Testing explanations and formulas...")
    await page.evaluate("""() => {
        const opts = document.querySelectorAll('.option-btn');
        if (opts.length > 0) opts[0].click();
    }""")
    await page.waitForTimeout(1000)
    
    exp_visible = await page.evaluate("document.querySelector('.explanation-panel') !== null")
    if exp_visible:
        print("Explanation panel opened successfully.")
        
        formula_blocks = await page.evaluate("document.querySelectorAll('.formula-code').length")
        print(f"Found {formula_blocks} formula blocks.")
        
        if formula_blocks > 0:
            formula_text = await page.evaluate("document.querySelector('.formula-code').innerText")
            if "[object Object]" in formula_text:
                print("ERROR: Formula block rendered as [object Object]")
            else:
                print(f"Formula block rendered correctly: {formula_text}")
    else:
        print("ERROR: Explanation panel not visible after clicking option.")
        
    print("Testing search...")
    await page.evaluate("document.getElementById('nav-search').click()")
    await page.waitForTimeout(500)
    await page.type("#search-input", "sequence")
    await page.keyboard.press("Enter")
    await page.waitForTimeout(1000)
    
    search_results = await page.evaluate("document.querySelectorAll('.search-result-item').length")
    print(f"Found {search_results} search results for 'sequence'.")
    
    await browser.close()
    print("All tests completed.")

if __name__ == "__main__":
    asyncio.run(run_tests())
