from __future__ import annotations

from typing import Any

from bson import ObjectId

from common.db.mongo import processed_documents


class ProcessedDocumentRepository:
    def get(self, processed_document_id: str) -> dict[str, Any] | None:
        return processed_documents().find_one({"_id": ObjectId(processed_document_id)})
