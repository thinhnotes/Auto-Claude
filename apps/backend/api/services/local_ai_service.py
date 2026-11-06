"""
Local AI Service & Anthropic Messages Bridge
============================================

Connects Aperant Web UI & Backend (Insights, Ideation, Roadmap, Claude Agent SDK)
to the host's Local AI infrastructure:
1. AMD Instinct MI50 GPU (`llama-moe` @ `http://127.0.0.1:8089/v1` — `gemma-4`, `qwen3.8-moe`)
2. Unified Local CLIProxy (`http://127.0.0.1:8317/v1` & `https://gcliproxy.notesvnn.click/v1`
   with `CLIPROXY_API_KEY=hungthinh-secret-key` — `gemma-4`, `qwen3.8-moe`,
   `qwen2.5-coder:14b`, `gpt-6-luna`, `gpt-5.6-luna`, `gemini-3.5-flash`)
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from typing import Any, AsyncGenerator

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from ..shared import _STORE_DIR

logger = logging.getLogger(__name__)

local_ai_router = APIRouter(tags=["local-ai"])

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

MI50_BASE_URL = os.environ.get("LOCAL_AI_MI50_URL", "http://127.0.0.1:8089/v1").rstrip("/")
CLIPROXY_LOCAL_URL = os.environ.get("LOCAL_AI_CLIPROXY_LOCAL_URL", "http://127.0.0.1:8317/v1").rstrip("/")
CLIPROXY_PUBLIC_URL = os.environ.get("LOCAL_AI_CLIPROXY_URL", "https://gcliproxy.notesvnn.click/v1").rstrip("/")
CLIPROXY_API_KEY = os.environ.get("LOCAL_AI_CLIPROXY_KEY", "hungthinh-secret-key")
DEFAULT_LOCAL_MODEL = os.environ.get("LOCAL_AI_DEFAULT_MODEL", "gemma-4")

LOCAL_AI_MODELS: list[dict[str, Any]] = [
    {
        "id": "gemma-4",
        "label": "Local MI50 GPU — Gemma 4 (26B MoE)",
        "provider": "mi50-gpu",
        "description": "100% Offline trên AMD Instinct MI50 16GB (llama-moe)",
    },
    {
        "id": "qwen3.8-moe",
        "label": "Local MI50 GPU — Qwen 3.8 MoE",
        "provider": "mi50-gpu",
        "description": "Mô hình MoE tối ưu lập trình & suy luận trên MI50 GPU",
    },
    {
        "id": "qwen2.5-coder:14b",
        "label": "Local Ollama — Qwen 2.5 Coder 14B",
        "provider": "local-ollama",
        "description": "Chuyên gia phân tích mã nguồn & sinh code cục bộ",
    },
    {
        "id": "gpt-6-luna",
        "label": "Local CLIProxy — GPT-6 Luna",
        "provider": "cliproxy",
        "description": "Tốc độ cao qua Local CLIProxy (8317 / gcliproxy.notesvnn.click)",
    },
    {
        "id": "gpt-5.6-luna",
        "label": "Local CLIProxy — GPT-5.6 Luna",
        "provider": "cliproxy",
        "description": "Model suy luận nhanh qua Local CLIProxy",
    },
]

# Map Claude model aliases from UI/SDK to active Local AI model
CLAUDE_MODEL_MAP: dict[str, str] = {
    "opus": "qwen3.8-moe",
    "sonnet": "gemma-4",
    "haiku": "gemma-4",
    "claude-sonnet-4-20250514": "gemma-4",
    "claude-opus-4-20250514": "qwen3.8-moe",
    "claude-3-5-sonnet-20241022": "gemma-4",
    "claude-3-5-haiku-20241022": "gemma-4",
}


def resolve_local_model(requested_model: str | None = None) -> str:
    """Resolve a requested model name or alias into a valid Local AI model."""
    settings_path = _STORE_DIR / "settings.json"
    configured_default = DEFAULT_LOCAL_MODEL
    if settings_path.is_file():
        try:
            data = json.loads(settings_path.read_text(encoding="utf-8"))
            dm = data.get("defaultModel")
            if dm and dm not in CLAUDE_MODEL_MAP:
                configured_default = dm
        except Exception:
            pass

    if not requested_model:
        return configured_default
    if requested_model in CLAUDE_MODEL_MAP:
        return configured_default if configured_default != DEFAULT_LOCAL_MODEL else CLAUDE_MODEL_MAP[requested_model]
    if requested_model.startswith("claude-"):
        return configured_default
    return requested_model


def _candidate_endpoints_for_model(model: str) -> list[tuple[str, str, str]]:
    """Return ordered list of (name, base_url, api_key) endpoints to try."""
    candidates: list[tuple[str, str, str]] = []
    if model in ("gemma-4", "gemma4"):
        candidates.append(("mi50-direct", MI50_BASE_URL, "sk-local-mi50"))
    candidates.append(("cliproxy-local", CLIPROXY_LOCAL_URL, CLIPROXY_API_KEY))
    candidates.append(("cliproxy-public", CLIPROXY_PUBLIC_URL, CLIPROXY_API_KEY))
    return candidates


async def complete_local_ai_chat(
    messages: list[dict[str, Any]],
    model: str | None = None,
    system_prompt: str | None = None,
    max_tokens: int = 2048,
    temperature: float = 0.3,
) -> dict[str, Any]:
    """Run a non-streaming chat completion against Local AI with automatic failover."""
    target_model = resolve_local_model(model)
    full_messages: list[dict[str, Any]] = []
    if system_prompt:
        full_messages.append({"role": "system", "content": system_prompt})
    full_messages.extend(messages)

    last_error = "No endpoints attempted"
    for ep_name, base_url, api_key in _candidate_endpoints_for_model(target_model):
        url = f"{base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": target_model,
            "messages": full_messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": False,
            "chat_template_kwargs": {"enable_thinking": False},
        }
        try:
            # Direct loopback calls bypass HTTP_PROXY
            trust_env = not ("127.0.0.1" in base_url or "localhost" in base_url)
            async with httpx.AsyncClient(timeout=90.0, trust_env=trust_env) as client:
                resp = await client.post(url, headers=headers, json=payload)
                if resp.status_code == 200:
                    data = resp.json()
                    choice = (data.get("choices") or [{}])[0]
                    msg = choice.get("message") or {}
                    text = msg.get("content") or msg.get("reasoning_content") or ""
                    return {
                        "ok": True,
                        "text": text,
                        "model": data.get("model", target_model),
                        "endpoint": ep_name,
                        "usage": data.get("usage", {}),
                    }
                last_error = f"{ep_name} HTTP {resp.status_code}: {resp.text[:200]}"
        except Exception as exc:
            last_error = f"{ep_name} error: {exc}"
            continue

    # Final fallback: try gpt-6-luna on cliproxy if primary model timed out
    if target_model != "gpt-6-luna":
        for ep_name, base_url, api_key in [
            ("cliproxy-local-fallback", CLIPROXY_LOCAL_URL, CLIPROXY_API_KEY),
            ("cliproxy-public-fallback", CLIPROXY_PUBLIC_URL, CLIPROXY_API_KEY),
        ]:
            try:
                trust_env = not ("127.0.0.1" in base_url or "localhost" in base_url)
                async with httpx.AsyncClient(timeout=60.0, trust_env=trust_env) as client:
                    resp = await client.post(
                        f"{base_url}/chat/completions",
                        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                        json={
                            "model": "gpt-6-luna",
                            "messages": full_messages,
                            "max_tokens": max_tokens,
                            "temperature": temperature,
                            "stream": False,
                        },
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        choice = (data.get("choices") or [{}])[0]
                        msg = choice.get("message") or {}
                        text = msg.get("content") or msg.get("reasoning_content") or ""
                        return {
                            "ok": True,
                            "text": text,
                            "model": "gpt-6-luna",
                            "endpoint": ep_name,
                            "usage": data.get("usage", {}),
                        }
            except Exception:
                continue

    return {
        "ok": False,
        "text": f"[Local AI Error] Không thể kết nối tới Local AI ({last_error})",
        "model": target_model,
        "endpoint": "none",
        "usage": {},
    }


async def stream_local_ai_chat(
    messages: list[dict[str, Any]],
    model: str | None = None,
    system_prompt: str | None = None,
    max_tokens: int = 2048,
    temperature: float = 0.3,
) -> AsyncGenerator[str, None]:
    """Stream text chunks from Local AI with automatic failover."""
    result = await complete_local_ai_chat(
        messages=messages,
        model=model,
        system_prompt=system_prompt,
        max_tokens=max_tokens,
        temperature=temperature,
    )
    text = result.get("text", "")
    # Yield in smooth chunks for responsive UI streaming
    chunk_size = 36
    for i in range(0, len(text), chunk_size):
        yield text[i : i + chunk_size]


# ---------------------------------------------------------------------------
# Local AI Status & Profile Selection Endpoints
# ---------------------------------------------------------------------------


class SelectModelRequest(BaseModel):
    model: str


@local_ai_router.get("/api/local-ai/status")
async def get_local_ai_status() -> dict[str, Any]:
    """Check live connectivity to MI50 GPU and Local CLIProxy endpoints."""
    active_model = resolve_local_model(None)
    endpoints_status: list[dict[str, Any]] = []

    checks = [
        ("AMD Instinct MI50 GPU (llama-moe)", MI50_BASE_URL, "sk-local-mi50"),
        ("Local CLIProxy (127.0.0.1:8317)", CLIPROXY_LOCAL_URL, CLIPROXY_API_KEY),
        ("Public CLIProxy (gcliproxy.notesvnn.click)", CLIPROXY_PUBLIC_URL, CLIPROXY_API_KEY),
    ]

    for label, base_url, api_key in checks:
        t0 = time.monotonic()
        online = False
        models_found: list[str] = []
        err_msg = None
        try:
            trust_env = not ("127.0.0.1" in base_url or "localhost" in base_url)
            async with httpx.AsyncClient(timeout=4.0, trust_env=trust_env) as client:
                r = await client.get(
                    f"{base_url}/models",
                    headers={"Authorization": f"Bearer {api_key}"},
                )
                if r.status_code == 200:
                    online = True
                    body = r.json()
                    models_found = [m.get("id", "") for m in (body.get("data") or [])[:12]]
                else:
                    err_msg = f"HTTP {r.status_code}"
        except Exception as exc:
            err_msg = str(exc)

        latency_ms = round((time.monotonic() - t0) * 1000, 1)
        endpoints_status.append(
            {
                "name": label,
                "url": base_url,
                "online": online,
                "latencyMs": latency_ms if online else None,
                "models": models_found,
                "error": err_msg,
            }
        )

    return {
        "success": True,
        "data": {
            "activeModel": active_model,
            "availableModels": LOCAL_AI_MODELS,
            "endpoints": endpoints_status,
        },
    }


@local_ai_router.post("/api/local-ai/select")
async def select_local_ai_model(body: SelectModelRequest) -> dict[str, Any]:
    """Persist the chosen Local AI default model into settings.json."""
    settings_path = _STORE_DIR / "settings.json"
    settings_data: dict[str, Any] = {}
    if settings_path.is_file():
        try:
            settings_data = json.loads(settings_path.read_text(encoding="utf-8"))
        except Exception:
            settings_data = {}

    settings_data["defaultModel"] = body.model
    _STORE_DIR.mkdir(parents=True, exist_ok=True)
    settings_path.write_text(json.dumps(settings_data, indent=2), encoding="utf-8")
    return {
        "success": True,
        "data": {"activeModel": body.model},
    }


# ---------------------------------------------------------------------------
# Anthropic Messages API Bridge (/v1/messages) for Claude Agent SDK
# ---------------------------------------------------------------------------


def _extract_anthropic_messages(body: dict[str, Any]) -> tuple[str | None, list[dict[str, str]]]:
    """Convert Anthropic /v1/messages request body into OpenAI messages format."""
    system_prompt = None
    raw_sys = body.get("system")
    if isinstance(raw_sys, str):
        system_prompt = raw_sys
    elif isinstance(raw_sys, list):
        parts = [b.get("text", "") for b in raw_sys if isinstance(b, dict) and b.get("type") == "text"]
        system_prompt = "\n".join(p for p in parts if p)

    oa_messages: list[dict[str, str]] = []
    for msg in body.get("messages") or []:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if isinstance(content, str):
            oa_messages.append({"role": role, "content": content})
        elif isinstance(content, list):
            text_parts = []
            for block in content:
                if isinstance(block, dict):
                    if block.get("type") == "text":
                        text_parts.append(block.get("text", ""))
                    elif block.get("type") == "tool_result":
                        text_parts.append(str(block.get("content", "")))
            oa_messages.append({"role": role, "content": "\n".join(text_parts)})
    return system_prompt, oa_messages


@local_ai_router.post("/v1/messages")
async def anthropic_messages_bridge(request: Request):
    """Anthropic-compatible /v1/messages endpoint bridged to Local AI."""
    body = await request.json()
    requested_model = body.get("model")
    stream = bool(body.get("stream", False))
    max_tokens = int(body.get("max_tokens", 2048))
    temperature = float(body.get("temperature", 0.3))

    system_prompt, oa_messages = _extract_anthropic_messages(body)
    result = await complete_local_ai_chat(
        messages=oa_messages,
        model=requested_model,
        system_prompt=system_prompt,
        max_tokens=max_tokens,
        temperature=temperature,
    )

    msg_id = f"msg_local_{uuid.uuid4().hex[:20]}"
    text = result.get("text", "")
    resolved_model = result.get("model", resolve_local_model(requested_model))

    if not stream:
        return JSONResponse(
            {
                "id": msg_id,
                "type": "message",
                "role": "assistant",
                "model": resolved_model,
                "content": [{"type": "text", "text": text}],
                "stop_reason": "end_turn",
                "stop_sequence": None,
                "usage": {
                    "input_tokens": 128,
                    "output_tokens": max(1, len(text) // 4),
                },
            }
        )

    async def _sse_generator() -> AsyncGenerator[str, None]:
        start_evt = {
            "type": "message_start",
            "message": {
                "id": msg_id,
                "type": "message",
                "role": "assistant",
                "model": resolved_model,
                "content": [],
                "stop_reason": None,
                "stop_sequence": None,
                "usage": {"input_tokens": 128, "output_tokens": 1},
            },
        }
        yield f"event: message_start\ndata: {json.dumps(start_evt)}\n\n"

        block_start = {
            "type": "content_block_start",
            "index": 0,
            "content_block": {"type": "text", "text": ""},
        }
        yield f"event: content_block_start\ndata: {json.dumps(block_start)}\n\n"

        chunk_size = 48
        for i in range(0, max(1, len(text)), chunk_size):
            piece = text[i : i + chunk_size]
            delta_evt = {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "text_delta", "text": piece},
            }
            yield f"event: content_block_delta\ndata: {json.dumps(delta_evt, ensure_ascii=False)}\n\n"

        block_stop = {"type": "content_block_stop", "index": 0}
        yield f"event: content_block_stop\ndata: {json.dumps(block_stop)}\n\n"

        msg_delta = {
            "type": "message_delta",
            "delta": {"stop_reason": "end_turn", "stop_sequence": None},
            "usage": {"output_tokens": max(1, len(text) // 4)},
        }
        yield f"event: message_delta\ndata: {json.dumps(msg_delta)}\n\n"
        yield 'event: message_stop\ndata: {"type": "message_stop"}\n\n'

    return StreamingResponse(_sse_generator(), media_type="text/event-stream")


@local_ai_router.post("/v1/messages/count_tokens")
async def anthropic_count_tokens(request: Request) -> dict[str, Any]:
    """Token count helper for Claude Agent SDK."""
    body = await request.json()
    _, oa_messages = _extract_anthropic_messages(body)
    total_chars = sum(len(m.get("content", "")) for m in oa_messages)
    return {"input_tokens": max(1, total_chars // 4)}
