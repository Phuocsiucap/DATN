from __future__ import annotations

from typing import Any

from common.db.mongo import processed_documents


class NormalizationDocumentRepository:
    def insert_processed(self, document: dict[str, Any]) -> str:
        result = processed_documents().insert_one(document)
        return str(result.inserted_id)

    def insert_processed_many(self, documents: list[dict[str, Any]]) -> list[str]:
        if not documents:
            return []
        result = processed_documents().insert_many(documents)
        return [str(document_id) for document_id in result.inserted_ids]
