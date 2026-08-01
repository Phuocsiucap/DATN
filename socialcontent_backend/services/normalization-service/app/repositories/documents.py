from __future__ import annotations

from typing import Any

from bson import ObjectId

from common.db.mongo import processed_documents, raw_documents


class NormalizationDocumentRepository:
    def get_raw(self, raw_document_id: str) -> dict[str, Any] | None:
        return raw_documents().find_one({"_id": ObjectId(raw_document_id)})

    def insert_processed(self, document: dict[str, Any]) -> str:
        result = processed_documents().insert_one(document)
        return str(result.inserted_id)
