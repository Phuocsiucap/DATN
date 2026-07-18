from pydantic import BaseModel

class PublishRequest(BaseModel):
    link: str
    platforms: list[str] = ["facebook"]
    profile_ids: list[int] = []
