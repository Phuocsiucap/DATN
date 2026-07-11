import asyncio
from playwright.async_api import async_playwright

async def main():
    try:
        async with async_playwright() as p:
            print("Launching...")
            browser = await p.chromium.launch_persistent_context(
                user_data_dir=r'D:\DATN\tiktok_profile', 
                headless=False, 
                channel='chrome'
            )
            print("Launched!")
            await asyncio.sleep(2)
            await browser.close()
    except Exception as e:
        print(f"Error: {e}")

asyncio.run(main())
