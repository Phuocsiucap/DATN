from functools import lru_cache

from pymongo import MongoClient

from common.core.config import get_settings


@lru_cache
def get_mongo_client() -> MongoClient:
    settings = get_settings()
    return MongoClient(settings.mongo_uri, serverSelectionTimeoutMS=5000, connectTimeoutMS=5000)


def get_mongo_db():
    settings = get_settings()
    return get_mongo_client()[settings.mongo_db]


def processed_documents():
    return get_mongo_db()["processed_documents"]


def series_contexts():
    return get_mongo_db()["series_contexts"]
