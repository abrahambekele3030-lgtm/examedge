import asyncio
import sys
from playwright.async_api import async_playwright

async def run_tests():
    print("Starting automated tests...")
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        
        # Load the application
        print("Loading http://localhost:8080/")
        await page.goto("http://localhost:8080/")
        
        # Wait for the loader to disappear and questions to appear
        print("Waiting for app to load questions...")
        try:
            await page.wait_for_selector("#app:not(.hidden)", timeout=15000)
            await page.wait_for_selector(".question-card", timeout=5000)
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
            let matches = t2.match(/\\\\\\\\\\(x\\\\\\^2\\\\\\\\\\)/g); // match \\(x^2\\)
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
        
        # Wait for MathJax to process the page
        await page.wait_for_timeout(2000)
        
        # Check if MathJax containers exist in the question area
        mathjax_count = await page.locator("mjx-container").count()
        print(f"Found {mathjax_count} MathJax elements on the page.")
        
        if mathjax_count == 0:
            print("ERROR: No MathJax elements found. Rendering might have failed.")
        else:
            print("MathJax rendered successfully!")
            
        # Test 4: Open explanation and verify formulas
        print("Testing explanations and formulas...")
        
        # Find an option button and click it to reveal explanation
        options = await page.locator(".option-btn").all()
        if options:
            await options[0].click()
            await page.wait_for_timeout(1000)
            
            # Check if explanation panel is visible
            exp_visible = await page.locator(".explanation-panel").is_visible()
            if exp_visible:
                print("Explanation panel opened successfully.")
                
                # Check for formula blocks
                formula_blocks = await page.locator(".formula-code").count()
                print(f"Found {formula_blocks} formula blocks.")
                
                # Verify formula doesn't say [object Object]
                if formula_blocks > 0:
                    formula_text = await page.locator(".formula-code").first.inner_text()
                    if "[object Object]" in formula_text:
                        print("ERROR: Formula block rendered as [object Object]")
                    else:
                        print(f"Formula block rendered correctly: {formula_text}")
            else:
                print("ERROR: Explanation panel not visible after clicking option.")
                
        # Test 5: Verify search math
        print("Testing search...")
        await page.click("#nav-search")
        await page.wait_for_timeout(500)
        await page.fill("#search-input", "sequence")
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(1000)
        
        search_results = await page.locator(".search-result-item").count()
        print(f"Found {search_results} search results for 'sequence'.")
        
        await browser.close()
        print("All tests completed.")

if __name__ == "__main__":
    asyncio.run(run_tests())
