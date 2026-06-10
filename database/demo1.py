from pymongo import MongoClient
import os
from dotenv import load_dotenv

load_dotenv()
MONGO_URI = os.getenv("MONGO_URI")
DB_NAME = os.getenv("DB_NAME")
COLLECTION_NAME = os.getenv("COLLECTION_NAME")
print(MONGO_URI)
client = MongoClient(MONGO_URI)
db = client[DB_NAME]
collection = db[COLLECTION_NAME]

try:
    client.admin.command('ping')
    print("✅ Kết nối MongoDB thành công")
except Exception as e:
    print("❌ Lỗi kết nối:", e)