from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class ClientCommand(BaseModel):
    version: Literal["1.0"]
    type: str
    sequence: int = Field(ge=1)
    payload: dict[str, Any] = Field(default_factory=dict)


class ServerEvent(BaseModel):
    version: Literal["1.0"] = "1.0"
    type: str
    session_id: str
    trace_id: str
    sequence: int = Field(ge=1)
    timestamp: datetime
    payload: dict[str, Any]
