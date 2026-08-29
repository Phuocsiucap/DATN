import sys
from pathlib import Path

# Add backend root to path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from sqlalchemy import text, inspect
from common.db.session import engine
from common.db.mongo import get_mongo_db

PRESERVED_TABLES = {
    "users",
    "user_roles",
    "roles",
    "social_profiles",
    "social_profile_strategies",
    "alembic_version",
}

def clean_database():
    inspector = inspect(engine)
    all_tables = set(inspector.get_table_names())
    tables_to_truncate = [t for t in all_tables if t not in PRESERVED_TABLES]

    print("=== PRESERVED TABLES ===")
    with engine.connect() as conn:
        for t in sorted(PRESERVED_TABLES.intersection(all_tables)):
            count = conn.execute(text(f'SELECT COUNT(*) FROM "{t}"')).scalar()
            print(f"  [KEEP] {t}: {count} rows")

    print("\n=== TRUNCATING TABLES ===")
    with engine.begin() as conn:
        for t in tables_to_truncate:
            count = conn.execute(text(f'SELECT COUNT(*) FROM "{t}"')).scalar()
            conn.execute(text(f'TRUNCATE TABLE "{t}" CASCADE;'))
            print(f"  [CLEARED] {t}: {count} rows deleted")

    print("\n=== CLEARING MONGO COLLECTIONS ===")
    try:
        mongo_db = get_mongo_db()
        for col in mongo_db.list_collection_names():
            count = mongo_db[col].count_documents({})
            mongo_db[col].delete_many({})
            print(f"  [CLEARED MONGO] {col}: {count} documents deleted")
    except Exception as e:
        print(f"  Mongo error: {e}")

    print("\n=== CLEANUP COMPLETE ===")

if __name__ == "__main__":
    clean_database()
