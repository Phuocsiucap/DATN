import os
from dotenv import load_dotenv

load_dotenv()

class Settings:
    MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
    DB_NAME = os.getenv("DB_NAME", "crawler_db")
    COLLECTION_NAME = os.getenv("COLLECTION_NAME", "articles")
    API_BASE = os.getenv("API_BASE", "http://localhost:8000")
    
    # AI
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

    # Facebook
    FB_PAGE_ID = os.getenv("FB_PAGE_ID")
    FB_ACCESS_TOKEN = os.getenv("FB_ACCESS_TOKEN")

    # TikTok
    TIKTOK_ACCESS_TOKEN = os.getenv("TIKTOK_ACCESS_TOKEN")

settings = Settings()
