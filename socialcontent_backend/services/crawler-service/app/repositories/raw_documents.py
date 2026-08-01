from __future__ import annotations

from typing import Any

from common.db.mongo import raw_documents


class RawDocumentRepository:
    def insert(self, document: dict[str, Any]) -> str:
        result = raw_documents().insert_one(document)
        return str(result.inserted_id)

    def insert_many(self, documents: list[dict[str, Any]]) -> list[str]:
        if not documents:
            return []
        result = raw_documents().insert_many(documents)
        return [str(document_id) for document_id in result.inserted_ids]
