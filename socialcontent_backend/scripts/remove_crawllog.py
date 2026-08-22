import re
with open('common/db/models.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Remove CrawlLog class
content = re.sub(r'class CrawlLog\(Base\):.*?    job = relationship\("CrawlJob", back_populates="logs"\)\n\n\n', '', content, flags=re.DOTALL)
# Remove relationship in CrawlJob
content = re.sub(r'    logs = relationship\("CrawlLog", back_populates="job", cascade="all, delete-orphan"\)\n', '', content)

with open('common/db/models.py', 'w', encoding='utf-8') as f:
    f.write(content)
