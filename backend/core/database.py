from pymongo import MongoClient
from pymongo.errors import ConfigurationError, ConnectionFailure
from backend.core.config import settings

_client: MongoClient | None = None

def get_client() -> MongoClient:
    global _client
    if _client is None:
        _client = MongoClient(
            settings.MONGO_URI,
            serverSelectionTimeoutMS=5000,
            connectTimeoutMS=5000,
        )
    return _client

def get_collection(name: str | None = None):
    db = get_client()[settings.DB_NAME]
    return db[name or settings.COLLECTION_NAME]

# Lazy proxies — không kết nối ngay khi import
class _LazyCollection:
    def __init__(self, name: str):
        self._name = name
        self._col = None

    def _get(self):
        if self._col is None:
            self._col = get_collection(self._name)
        return self._col

    def __getattr__(self, item):
        return getattr(self._get(), item)

articles_col = _LazyCollection("articles")
publish_log_col = _LazyCollection("publish_log")
