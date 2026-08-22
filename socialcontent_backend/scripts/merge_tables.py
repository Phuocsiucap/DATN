import re

with open('common/db/models.py', 'r', encoding='utf-8') as f:
    content = f.read()

unified_class = '''class MediaWorkflow(Base):
    __tablename__ = "media_workflows"

    id = uuid_pk()
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    profile_id = Column(UUID(as_uuid=True), ForeignKey("social_profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    series_id = Column(UUID(as_uuid=True), ForeignKey("content_series.id", ondelete="SET NULL"), nullable=True, index=True)
    
    title = Column(Text, nullable=False)
    status = Column(String(40), default="DRAFT", nullable=False, index=True)
    current_stage = Column(String(80), nullable=True)
    progress_percent = Column(Numeric(5, 2), default=0, nullable=False)
    
    # --- Content Plan fields ---
    planning_mode = Column(String(40), nullable=True, index=True)
    content_angle = Column(Text, nullable=True)
    target_audience = Column(Text, nullable=True)
    tone = Column(Text, nullable=True)
    format = Column(String(60), nullable=True)
    target_duration_seconds = Column(Integer, nullable=True)
    recommended_part_count = Column(Integer, nullable=True)
    confidence_score = Column(Numeric(5, 2), default=0, nullable=False)
    risk_level = Column(String(40), nullable=True)
    ai_reasoning = Column(JSONB, nullable=False, default=list)
    production_requirements = Column(JSONB, nullable=False, default=dict)
    
    # --- Video Draft fields ---
    draft_json = Column(JSONB, nullable=False, default=dict)
    
    # --- Approvals & References ---
    approved_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    
    primary_content_id = Column(UUID(as_uuid=True), ForeignKey("content_items.id", ondelete="SET NULL"), nullable=True, index=True)
    primary_story_id = Column(UUID(as_uuid=True), ForeignKey("stories.id", ondelete="SET NULL"), nullable=True, index=True)
    metadata_json = Column("metadata", JSONB, nullable=False, default=dict)
    
    created_at = now_col()
    updated_at = updated_col()

    sources = relationship("WorkflowSource", back_populates="media_workflow", cascade="all, delete-orphan")
    candidates = relationship("WorkflowCandidate", back_populates="media_workflow", cascade="all, delete-orphan")
    parts = relationship("WorkflowPart", back_populates="media_workflow", cascade="all, delete-orphan")
    runs = relationship("WorkflowRun", back_populates="media_workflow", cascade="all, delete-orphan")
    artifacts = relationship("WorkflowArtifact", back_populates="media_workflow", cascade="all, delete-orphan")
    series = relationship("ContentSeries", back_populates="media_workflows")
    feedback = relationship("PlanningFeedback", back_populates="media_workflow", cascade="all, delete-orphan")
'''

# Remove MediaWorkflow
content = re.sub(r'class MediaWorkflow\(Base\):.*?    feedback = relationship\("PlanningFeedback", back_populates="content_plan", cascade="all, delete-orphan"\)\n\n\n', '', content, flags=re.DOTALL)

# Remove MediaWorkflow
content = re.sub(r'class MediaWorkflow\(Base\):.*?    updated_at = updated_col\(\)\n\n\n', '', content, flags=re.DOTALL)

# Replace MediaWorkflow (old ContentProject) with the unified class
content = re.sub(r'class MediaWorkflow\(Base\):.*?    series = relationship\("ContentSeries", back_populates="media_workflows"\)\n', unified_class, content, flags=re.DOTALL)

# Update PlanningFeedback relationship
content = content.replace('content_plan_id = Column(UUID(as_uuid=True), ForeignKey("content_plans.id"', 'media_workflow_id = Column(UUID(as_uuid=True), ForeignKey("media_workflows.id"')
content = content.replace('content_plan = relationship("MediaWorkflow"', 'media_workflow = relationship("MediaWorkflow"')

with open('common/db/models.py', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done modifying models.py')
