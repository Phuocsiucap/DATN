from sqlalchemy import create_engine, text

DATABASE_URL = "postgresql+psycopg2://postgres:postgres@127.0.0.1:5432/socialcontent"

def reset_db():
    engine = create_engine(DATABASE_URL, echo=True)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE;"))
        conn.execute(text("CREATE SCHEMA public;"))
    engine.dispose()
    print("Database reset successfully.")

if __name__ == "__main__":
    reset_db()
