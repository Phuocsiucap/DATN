from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from sqlalchemy.types import UserDefinedType


class Vector(UserDefinedType):
    """Minimal SQLAlchemy type for PostgreSQL pgvector columns.

    This avoids depending on the Python pgvector package in every service image.
    The database still uses the pgvector extension and vector column type.
    """

    cache_ok = True

    def __init__(self, dim: int | None = None) -> None:
        self.dim = dim

    def get_col_spec(self, **_: Any) -> str:
        return f"VECTOR({self.dim})" if self.dim else "VECTOR"

    def bind_processor(self, dialect: Any):
        def process(value: Any) -> str | None:
            if value is None:
                return None
            if hasattr(value, "tolist"):
                value = value.tolist()
            if isinstance(value, str):
                return value
            if isinstance(value, Iterable):
                return "[" + ",".join(str(float(item)) for item in value) + "]"
            raise TypeError(f"Cannot bind value as pgvector: {type(value)!r}")

        return process

    def result_processor(self, dialect: Any, coltype: Any):
        def process(value: Any) -> list[float] | None:
            if value is None:
                return None
            if hasattr(value, "tolist"):
                value = value.tolist()
            if isinstance(value, str):
                raw = value.strip().strip("[]")
                if not raw:
                    return []
                return [float(part.strip()) for part in raw.split(",") if part.strip()]
            if isinstance(value, Iterable):
                return [float(item) for item in value]
            return value

        return process
