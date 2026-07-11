import httpx
import asyncio

async def main():
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "http://127.0.0.1:8000/api/publish",
            json={
                "link": "https://vnexpress.net/doi-tuyen-anh-nguy-co-di-de-kho-ve-truoc-mexico-5093561.html",
                "platforms": ["tiktok"]
            },
            timeout=120
        )
        print("Status code:", resp.status_code)
        print("Response:", resp.json())

asyncio.run(main())
