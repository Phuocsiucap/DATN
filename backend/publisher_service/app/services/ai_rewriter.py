from __future__ import annotations

from openai import AsyncOpenAI

from backend.publisher_service.app.core.config import settings

_client: AsyncOpenAI | None = None


def get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        if not settings.openai_api_key:
            raise ValueError("OPENAI_API_KEY not set")
        _client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _client


PLATFORM_PROMPTS = {
    "facebook": """Bạn là copywriter mạng xã hội. Viết lại bài báo sau thành post Facebook hấp dẫn:
- Mở đầu bằng hook gây chú ý
- 3-4 đoạn ngắn, dễ đọc
- Kết thúc bằng câu hỏi tương tác với độc giả
- Thêm 5-7 hashtag phù hợp
- Tối đa 500 từ""",
    "tiktok": """Bạn là copywriter TikTok. Viết caption cho video TikTok từ bài báo sau:
- Hook 1 câu đầu cực mạnh
- Nội dung ngắn gọn 2-3 điểm chính
- CTA cuối
- 10-15 hashtag trending
- Tối đa 200 từ""",
}


async def rewrite_for_platform(article: dict, platform: str) -> str:
    prompt = PLATFORM_PROMPTS.get(platform, PLATFORM_PROMPTS["facebook"])
    content = f"Tiêu đề: {article.get('title', '')}\n\nNội dung: {str(article.get('content', ''))[:2000]}"
    try:
        response = await get_client().chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": content},
            ],
            max_tokens=600,
            temperature=0.7,
        )
        return response.choices[0].message.content or ""
    except Exception as exc:
        print(f"AI rewrite error: {exc}")
        return f"{article.get('title', '')}\n\n{str(article.get('content', ''))[:300]}..."
