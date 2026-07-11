import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from urllib.parse import urljoin, quote

router = APIRouter()

@router.get("")
async def video_proxy(request: Request, url: str = Query(..., description="The video URL to proxy")):
    if not url.startswith("http"):
        raise HTTPException(status_code=400, detail="Invalid URL")

    headers = {
        "Referer": "https://vnexpress.net/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    }

    base_proxy_url = str(request.base_url).rstrip("/") + "/api/proxy?url="

    async with httpx.AsyncClient() as client:
        try:
            if ".m3u8" in url:
                res = await client.get(url, headers=headers, timeout=10.0)
                if res.status_code != 200:
                    raise HTTPException(status_code=res.status_code, detail="Proxy failed")
                
                rewritten_lines = []
                for line in res.text.splitlines():
                    if line.strip() and not line.startswith("#"):
                        absolute_uri = urljoin(url, line.strip())
                        rewritten_uri = f"{base_proxy_url}{quote(absolute_uri)}"
                        rewritten_lines.append(rewritten_uri)
                    else:
                        rewritten_lines.append(line)
                
                return Response(content="\n".join(rewritten_lines), media_type="application/vnd.apple.mpegurl")

            # For video chunks (.ts) or other media types, just stream the response
            req = client.build_request("GET", url, headers=headers)
            res = await client.send(req, stream=True)
            
            return StreamingResponse(
                res.aiter_raw(),
                status_code=res.status_code,
                media_type=res.headers.get("content-type", "video/MP2T")
            )
            
        except httpx.RequestError as e:
            raise HTTPException(status_code=500, detail=str(e))
