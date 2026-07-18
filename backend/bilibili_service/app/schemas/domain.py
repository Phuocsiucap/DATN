from enum import StrEnum


class Niche(StrEnum):
    generic = "generic"
    short_film = "short_film"
    cooking = "cooking"
    smart_home = "smart_home"
    gadgets = "gadgets"


class JobStatus(StrEnum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class PipelineStage(StrEnum):
    queued = "queued"
    keyword = "keyword"
    downloading = "downloading"
    transcribing = "transcribing"
    translating = "translating"
    rendering = "rendering"
    completed = "completed"
    failed = "failed"
