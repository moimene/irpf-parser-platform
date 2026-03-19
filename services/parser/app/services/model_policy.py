from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal

ModelRole = Literal[
    "structured_extraction",
    "orchestration",
    "patrimonio",
    "rentas",
    "legal",
    "review",
    "critic",
    "adjudication",
]


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _default_model() -> str:
    return os.getenv("OPENAI_MODEL", "gpt-4o").strip()


def get_model_for_role(role: ModelRole) -> str:
    role_env = {
        "structured_extraction": "OPENAI_MODEL_STRUCTURED",
        "orchestration": "OPENAI_MODEL_ORCHESTRATION",
        "patrimonio": "OPENAI_MODEL_PATRIMONIO",
        "rentas": "OPENAI_MODEL_RENTAS",
        "legal": "OPENAI_MODEL_LEGAL",
        "review": "OPENAI_MODEL_REVIEW",
        "critic": "OPENAI_MODEL_CRITIC",
        "adjudication": "OPENAI_MODEL_ADJUDICATION",
    }[role]
    return os.getenv(role_env, _default_model()).strip()


@dataclass(frozen=True)
class ReasoningLoopSettings:
    enable_critic_pass: bool
    enable_adjudication: bool
    max_retry_passes: int
    min_signal_threshold: int


def get_reasoning_loop_settings() -> ReasoningLoopSettings:
    return ReasoningLoopSettings(
        enable_critic_pass=_env_bool("EXTRACTOR_LOOP_ENABLE_CRITIC", True),
        enable_adjudication=_env_bool("EXTRACTOR_LOOP_ENABLE_ADJUDICATION", True),
        max_retry_passes=max(0, int(os.getenv("EXTRACTOR_LOOP_MAX_RETRIES", "1"))),
        min_signal_threshold=max(1, int(os.getenv("EXTRACTOR_LOOP_MIN_SIGNAL_THRESHOLD", "3"))),
    )
