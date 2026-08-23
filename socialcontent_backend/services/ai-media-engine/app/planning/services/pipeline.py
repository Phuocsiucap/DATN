from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from common.db.models import (
    ContentItem,
    MediaWorkflow,
    KafkaTask,
    PlanningRun,
    PlanningCandidate,
    ContentSeries,
    PromptRun,
    SocialProfileStrategy,
    Story,
)
from common.db.mongo import planning_inputs, planning_outputs, series_contexts
from common.events.envelope import build_event
from common.events.kafka import publish
from common.events.topics import (
    PLANNING_CONTEXT_COMPLETED,
    PROJECT_RUN_COMPLETED,
    PROJECT_RUN_FAILED,
    PLANNING_SERIES_COMPLETED,
)

from .ai_planner import AIPlannerService
from .embeddings import EmbeddingService
from common.utils.token_calculator import calculate_token_cost


DEFAULT_STORY_IMAGES = [
    "assets/images/001-signal-room.png",
    "assets/images/002-alien-tower.png",
    "assets/images/003-final-light.png",
]
DEFAULT_STORY_EFFECTS = ["slow-zoom", "pan-right", "pan-left", "push-in"]


class PlanningPipeline:
    consumer_name = "planning-orchestrator"

    def handle_workflow_run_created(self, db: Session, message: dict[str, Any]) -> None:
        pass
