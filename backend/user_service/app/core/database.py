from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from backend.user_service.app.core.config import settings

# Lấy URL kết nối từ environment (bạn cần đổi tên hoặc parse thủ công nếu settings chưa có)
# Giả sử settings đã được thiết lập để parse DATABASE_URL
import os
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg2://postgres:phuocnguyen@localhost:5432/SocialContentHub")

engine = create_engine(DATABASE_URL, echo=False)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
