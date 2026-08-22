import sys
import re

with open('common/db/models.py', 'r', encoding='utf-8') as f:
    content = f.read()

content = re.sub(r'from sqlalchemy import \((.*?)\)', lambda m: 'from sqlalchemy import (' + m.group(1).replace('JSON,', '') + ')', content, flags=re.DOTALL)
content = content.replace('from sqlalchemy.dialects.postgresql import UUID', 'from sqlalchemy.dialects.postgresql import UUID, JSONB')

content = content.replace('Column("metadata", JSON', 'Column("metadata", JSONB')
content = content.replace('Column(JSON,', 'Column(JSONB,')
content = content.replace('Column(JSON)', 'Column(JSONB)')

if 'from pgvector.sqlalchemy import Vector' not in content:
    content = content.replace('from sqlalchemy.dialects.postgresql import UUID, JSONB', 'from sqlalchemy.dialects.postgresql import UUID, JSONB\nfrom pgvector.sqlalchemy import Vector')
    content = content.replace('embedding = Column(JSONB, nullable=False)', 'embedding = Column(Vector(512), nullable=False)')

# Fix circular FK: MediaWorkflow.content_plan_id
# original: content_plan_id = Column(UUID(as_uuid=True), ForeignKey("content_plans.id", ondelete="SET NULL"), nullable=True, unique=True, index=True)
content = content.replace('ForeignKey("content_plans.id", ondelete="SET NULL")', 'None # REMOVED CIRCULAR FK')

with open('common/db/models.py', 'w', encoding='utf-8') as f:
    f.write(content)
print('Updated models.py')
