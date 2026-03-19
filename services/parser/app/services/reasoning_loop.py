from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any

from openai import AsyncOpenAI

from app.services.model_policy import get_model_for_role, get_reasoning_loop_settings

logger = logging.getLogger(__name__)


@dataclass
class RetryGuidance:
    needs_retry: bool = False
    confidence: float = 0.0
    retry_instructions: str = ""
    missing_signals: list[str] = field(default_factory=list)
    adjudication_notes: list[str] = field(default_factory=list)


def _safe_json_loads(raw: str) -> dict[str, Any]:
    try:
        parsed = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


async def build_retry_guidance(
    client: AsyncOpenAI,
    *,
    source_text: str,
    current_output: dict[str, Any],
    objective: str,
    schema_hint: str,
    context_label: str,
    timeout: float = 60.0,
) -> RetryGuidance:
    settings = get_reasoning_loop_settings()
    if not settings.enable_critic_pass or settings.max_retry_passes <= 0:
        return RetryGuidance()

    system_prompt = (
        "You are the critic pass of a financial document extraction pipeline. "
        "You do not re-extract data. You only decide whether a focused retry is warranted.\n\n"
        "Return JSON with: needs_retry (bool), confidence (0-1), missing_signals (array of short strings), "
        "retry_instructions (string), adjudication_notes (array of short strings).\n"
        "Only request retry when there are likely omissions, wrong section assumptions, or contradictions."
    )

    user_prompt = (
        f"Context label: {context_label}\n"
        f"Objective: {objective}\n"
        f"Schema hint: {schema_hint}\n\n"
        "SOURCE TEXT / CONTEXT:\n"
        f"{source_text}\n\n"
        "CURRENT JSON OUTPUT:\n"
        f"{json.dumps(current_output, ensure_ascii=False)}"
    )

    try:
        response = await asyncio.wait_for(
            client.chat.completions.create(
                model=get_model_for_role("critic"),
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.0,
                max_tokens=1200,
            ),
            timeout=timeout,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Critic pass failed for %s: %s", context_label, exc)
        return RetryGuidance()

    data = _safe_json_loads(response.choices[0].message.content or "{}")
    return RetryGuidance(
        needs_retry=bool(data.get("needs_retry")),
        confidence=float(data.get("confidence", 0.0) or 0.0),
        retry_instructions=str(data.get("retry_instructions", "") or "").strip(),
        missing_signals=[
            str(item)
            for item in data.get("missing_signals", [])
            if str(item).strip()
        ],
        adjudication_notes=[
            str(item)
            for item in data.get("adjudication_notes", [])
            if str(item).strip()
        ],
    )
