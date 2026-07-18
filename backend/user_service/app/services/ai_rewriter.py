from openai import AsyncOpenAI
from backend.user_service.app.core.config import settings

_client: AsyncOpenAI | None = None

def get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        api_key = settings.OPENAI_API_KEY
        if not api_key:
            raise ValueError("OPENAI_API_KEY not set in .env")
        _client = AsyncOpenAI(api_key=api_key)
    return _client

PLATFORM_PROMPTS = {
    "facebook": """Bạn là copywriter mạng xã hội. Viết lại bài báo sau thành post Facebook hấp dẫn:
- Mở đầu bằng hook gây chú ý (emoji)
- 3-4 đoạn ngắn, dễ đọc
- Kết thúc bằng câu hỏi tương tác với độc giả
- Thêm 5-7 hashtag phù hợp
- Tối đa 500 từ""",

    "tiktok": """Bạn là copywriter TikTok. Viết caption cho video TikTok từ bài báo sau:
- Hook 1 câu đầu cực mạnh
- Nội dung ngắn gọn 2-3 điểm chính
- CTA (call to action) cuối
- 10-15 hashtag trending
- Tối đa 200 từ""",
}

async def rewrite_for_platform(article: dict, platform: str) -> str:
    """Rewrite article content for a specific social platform."""
    prompt = PLATFORM_PROMPTS.get(platform, PLATFORM_PROMPTS["facebook"])
    content = f"Tiêu đề: {article.get('title', '')}\n\nNội dung: {article.get('content', '')[:2000]}"

    try:
        response = await get_client().chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": content}
            ],
            max_tokens=600,
            temperature=0.7
        )
        return response.choices[0].message.content
    except Exception as e:
        print(f"AI rewrite error: {e}")
        return f"{article.get('title', '')}\n\n{article.get('content', '')[:300]}..."

async def score_trending(article: dict) -> float:
    """Score article trending potential 0.0 - 1.0."""
    try:
        response = await get_client().chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "Rate this article's viral/trending potential from 0.0 to 1.0. Reply with ONLY a decimal number."},
                {"role": "user", "content": f"{article.get('title', '')} - {article.get('content', '')[:500]}"}
            ],
            max_tokens=5,
            temperature=0
        )
        return float(response.choices[0].message.content.strip())
    except Exception:
        return 0.5
