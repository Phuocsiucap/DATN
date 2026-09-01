from __future__ import annotations

import json
import logging
from http import HTTPStatus
from typing import Any, TypeVar

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger(__name__)

T = TypeVar("T")


class Pagination(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    page: int = Field(ge=1)
    limit: int = Field(ge=1)
    total: int = Field(ge=0)
    total_pages: int = Field(alias="totalPages", ge=0)


class AppError(Exception):
    """Application error with a stable, client-facing error code."""

    def __init__(
        self,
        message: str,
        *,
        code: str,
        status_code: int = 400,
        errors: list[dict[str, str | None]] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.errors = errors
        self.headers = headers


def success_response(
    data: T | None = None,
    *,
    message: str = "Request completed successfully",
    pagination: Pagination | dict[str, int] | None = None,
) -> dict[str, Any]:
    response: dict[str, Any] = {
        "success": True,
        "message": message,
        "data": data,
    }
    if pagination is not None:
        parsed = pagination if isinstance(pagination, Pagination) else Pagination.model_validate(pagination)
        response["pagination"] = parsed.model_dump(by_alias=True)
    return response


def error_response(
    message: str,
    *,
    code: str,
    errors: list[dict[str, str | None]] | None = None,
) -> dict[str, Any]:
    response: dict[str, Any] = {
        "success": False,
        "message": message,
        "code": code,
        "data": None,
    }
    if errors:
        response["errors"] = errors
    return response


class ApiResponseEnvelopeMiddleware:
    """Wrap every JSON response while leaving files, streams and empty responses intact."""

    _EXCLUDED_PATHS = {"/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"}

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] != "http"
            or scope.get("method") == "HEAD"
            or scope.get("path") in self._EXCLUDED_PATHS
        ):
            await self.app(scope, receive, send)
            return

        response_start: Message | None = None
        body_parts: list[bytes] = []

        async def send_with_envelope(message: Message) -> None:
            nonlocal response_start
            if message["type"] == "http.response.start":
                if _is_json_response(message) and int(message["status"]) not in {204, 304}:
                    response_start = message
                    return
                await send(message)
                return

            if message["type"] != "http.response.body" or response_start is None:
                await send(message)
                return

            body_parts.append(message.get("body", b""))
            if message.get("more_body", False):
                return

            body = b"".join(body_parts)
            payload = json.loads(body.decode("utf-8")) if body else None
            if not _is_api_envelope(payload):
                status_code = int(response_start["status"])
                if status_code >= 400:
                    detail = payload.get("detail", payload) if isinstance(payload, dict) else payload
                    error = StarletteHTTPException(status_code=status_code, detail=detail)
                    message, code, errors = _parse_http_exception(error)
                    payload = error_response(message, code=code, errors=errors)
                else:
                    payload = success_response(
                        payload,
                        message=_success_message(scope.get("method", "GET"), status_code, payload),
                        pagination=_pagination_from_payload(payload),
                    )
            encoded = json.dumps(
                payload,
                ensure_ascii=False,
                allow_nan=False,
                separators=(",", ":"),
            ).encode("utf-8")
            response_start["headers"] = _replace_content_length(response_start.get("headers", []), len(encoded))
            await send(response_start)
            await send({"type": "http.response.body", "body": encoded, "more_body": False})

        await self.app(scope, receive, send_with_envelope)


def configure_api_responses(app: FastAPI) -> None:
    """Install the shared response contract on a FastAPI application."""

    app.add_middleware(ApiResponseEnvelopeMiddleware)
    app.add_exception_handler(AppError, _app_error_handler)
    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)
    app.add_exception_handler(RequestValidationError, _validation_exception_handler)
    app.add_exception_handler(Exception, _unhandled_exception_handler)
    _configure_openapi(app)


async def _app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=error_response(exc.message, code=exc.code, errors=exc.errors),
        headers=exc.headers,
    )


async def _http_exception_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    message, code, errors = _parse_http_exception(exc)
    return JSONResponse(
        status_code=exc.status_code,
        content=error_response(message, code=code, errors=errors),
        headers=exc.headers,
    )


async def _validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    errors = []
    for item in exc.errors():
        location = [str(part) for part in item.get("loc", ())]
        if location and location[0] in {"body", "query", "path", "header", "cookie"}:
            location = location[1:]
        errors.append(
            {
                "field": ".".join(location) or None,
                "message": str(item.get("msg") or "Invalid value"),
            }
        )
    return JSONResponse(
        status_code=422,
        content=error_response("Validation failed", code="VALIDATION_ERROR", errors=errors),
    )


async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled API exception for %s %s", request.method, request.url.path, exc_info=exc)
    return JSONResponse(
        status_code=500,
        content=error_response("Internal server error", code="INTERNAL_SERVER_ERROR"),
    )


def _parse_http_exception(exc: StarletteHTTPException) -> tuple[str, str, list[dict[str, str | None]] | None]:
    detail = exc.detail
    code = _status_error_code(exc.status_code)
    errors = None
    if isinstance(detail, dict):
        message = str(detail.get("message") or detail.get("detail") or detail.get("error") or _status_message(exc.status_code))
        if detail.get("code"):
            code = str(detail["code"])
        candidate_errors = detail.get("errors")
        if isinstance(candidate_errors, list):
            errors = [item for item in candidate_errors if isinstance(item, dict)]
    elif isinstance(detail, str) and detail:
        message = detail
    else:
        message = _status_message(exc.status_code)
    return message, code, errors


def _status_error_code(status_code: int) -> str:
    return {
        400: "BAD_REQUEST",
        401: "UNAUTHORIZED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        405: "METHOD_NOT_ALLOWED",
        409: "CONFLICT",
        413: "PAYLOAD_TOO_LARGE",
        415: "UNSUPPORTED_MEDIA_TYPE",
        422: "VALIDATION_ERROR",
        429: "TOO_MANY_REQUESTS",
        500: "INTERNAL_SERVER_ERROR",
        502: "BAD_GATEWAY",
        503: "SERVICE_UNAVAILABLE",
        504: "GATEWAY_TIMEOUT",
    }.get(status_code, "HTTP_ERROR")


def _status_message(status_code: int) -> str:
    try:
        return HTTPStatus(status_code).phrase
    except ValueError:
        return "Request failed"


def _success_message(method: str, status_code: int, payload: Any) -> str:
    if isinstance(payload, dict) and isinstance(payload.get("message"), str):
        return payload["message"]
    if status_code == 201:
        return "Created successfully"
    return {
        "GET": "Get data successfully",
        "POST": "Request processed successfully",
        "PUT": "Updated successfully",
        "PATCH": "Updated successfully",
        "DELETE": "Deleted successfully",
    }.get(method.upper(), "Request completed successfully")


def _is_json_response(message: Message) -> bool:
    for name, value in message.get("headers", []):
        if name.lower() != b"content-type":
            continue
        media_type = value.decode("latin-1").split(";", 1)[0].strip().lower()
        return media_type == "application/json" or media_type.endswith("+json")
    return False


def _is_api_envelope(payload: Any) -> bool:
    return (
        isinstance(payload, dict)
        and isinstance(payload.get("success"), bool)
        and isinstance(payload.get("message"), str)
        and "data" in payload
    )


def _pagination_from_payload(payload: Any) -> dict[str, int] | None:
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        return None
    total = payload.get("total")
    limit = payload.get("limit")
    if not isinstance(total, int) or isinstance(total, bool) or total < 0:
        return None
    if not isinstance(limit, int) or isinstance(limit, bool) or limit < 1:
        return None
    page = payload.get("page")
    if not isinstance(page, int) or isinstance(page, bool) or page < 1:
        offset = payload.get("offset")
        if not isinstance(offset, int) or isinstance(offset, bool) or offset < 0:
            return None
        page = offset // limit + 1
    return {
        "page": page,
        "limit": limit,
        "total": total,
        "totalPages": (total + limit - 1) // limit,
    }


def _replace_content_length(headers: list[tuple[bytes, bytes]], length: int) -> list[tuple[bytes, bytes]]:
    result = [(name, value) for name, value in headers if name.lower() != b"content-length"]
    result.append((b"content-length", str(length).encode("ascii")))
    return result


def _configure_openapi(app: FastAPI) -> None:
    original_openapi = app.openapi

    def openapi_with_envelopes() -> dict[str, Any]:
        if app.openapi_schema is not None:
            return app.openapi_schema
        schema = original_openapi()
        components = schema.setdefault("components", {}).setdefault("schemas", {})
        components.update(_response_component_schemas())
        for path_item in schema.get("paths", {}).values():
            for operation in path_item.values():
                if not isinstance(operation, dict):
                    continue
                responses = operation.get("responses", {})
                for status_code, response in responses.items():
                    json_content = response.get("content", {}).get("application/json")
                    if not json_content or str(status_code) in {"204", "304"}:
                        continue
                    original_schema = json_content.get("schema", {})
                    if str(status_code).startswith("2"):
                        json_content["schema"] = _success_openapi_schema(original_schema)
                    else:
                        json_content["schema"] = {"$ref": "#/components/schemas/ApiErrorResponse"}
                responses.setdefault(
                    "default",
                    {
                        "description": "Error response",
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/ApiErrorResponse"}
                            }
                        },
                    },
                )
        app.openapi_schema = schema
        return schema

    app.openapi = openapi_with_envelopes


def _success_openapi_schema(data_schema: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": "ApiResponse",
        "type": "object",
        "required": ["success", "message", "data"],
        "properties": {
            "success": {"type": "boolean", "const": True},
            "message": {"type": "string"},
            "data": {"anyOf": [data_schema, {"type": "null"}]},
            "pagination": {"$ref": "#/components/schemas/Pagination"},
        },
    }


def _response_component_schemas() -> dict[str, Any]:
    return {
        "Pagination": {
            "type": "object",
            "required": ["page", "limit", "total", "totalPages"],
            "properties": {
                "page": {"type": "integer", "minimum": 1},
                "limit": {"type": "integer", "minimum": 1},
                "total": {"type": "integer", "minimum": 0},
                "totalPages": {"type": "integer", "minimum": 0},
            },
        },
        "ApiErrorDetail": {
            "type": "object",
            "required": ["message"],
            "properties": {
                "field": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                "message": {"type": "string"},
            },
        },
        "ApiErrorResponse": {
            "type": "object",
            "required": ["success", "message", "code", "data"],
            "properties": {
                "success": {"type": "boolean", "const": False},
                "message": {"type": "string"},
                "code": {"type": "string"},
                "data": {"type": "null"},
                "errors": {
                    "type": "array",
                    "items": {"$ref": "#/components/schemas/ApiErrorDetail"},
                },
            },
        },
    }
