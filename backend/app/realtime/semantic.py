from dataclasses import dataclass, field


_TERMINAL_PUNCTUATION = "。！？!?."
_SOFT_BOUNDARY_PUNCTUATION = "，,；;：:"


@dataclass
class SemanticSegmenter:
    """Collect confirmed source fragments and emit complete semantic units."""

    max_buffer_length: int = 80
    _buffer: list[str] = field(default_factory=list)

    def push(self, text: str) -> list[str]:
        normalized = self._normalize(text)
        if not normalized:
            return []

        self._buffer.append(normalized)
        if self._should_flush(normalized):
            return self._flush_buffer()

        if self._buffer_length() >= self.max_buffer_length and self._has_soft_boundary():
            return self._flush_at_soft_boundary()

        return []

    def flush(self) -> list[str]:
        return self._flush_buffer()

    def reset(self) -> None:
        self._buffer.clear()

    def is_empty(self) -> bool:
        return not self._buffer

    def _should_flush(self, text: str) -> bool:
        return text.endswith(tuple(_TERMINAL_PUNCTUATION))

    def _buffer_length(self) -> int:
        return len(self._joined_buffer())

    def _has_soft_boundary(self) -> bool:
        return any(
            punctuation in self._joined_buffer()
            for punctuation in _SOFT_BOUNDARY_PUNCTUATION
        )

    def _flush_at_soft_boundary(self) -> list[str]:
        text = self._joined_buffer()
        boundary_index = max(text.rfind(punctuation) for punctuation in _SOFT_BOUNDARY_PUNCTUATION)
        if boundary_index == -1:
            return self._flush_buffer()

        emitted = text[: boundary_index + 1].strip()
        remainder = text[boundary_index + 1 :].strip()
        self._buffer = [remainder] if remainder else []
        return [emitted] if emitted else []

    def _flush_buffer(self) -> list[str]:
        if not self._buffer:
            return []

        emitted = self._joined_buffer().strip()
        self._buffer.clear()
        return [emitted] if emitted else []

    @staticmethod
    def _normalize(text: str) -> str:
        return " ".join(str(text).strip().split())

    def _joined_buffer(self) -> str:
        if not self._buffer:
            return ""

        fragments: list[str] = []
        for fragment in self._buffer:
            if not fragments:
                fragments.append(fragment)
                continue

            previous = fragments[-1]
            if self._needs_space(previous, fragment):
                fragments.append(" ")
            fragments.append(fragment)

        return "".join(fragments)

    @staticmethod
    def _needs_space(previous: str, current: str) -> bool:
        if not previous or not current:
            return False
        return previous[-1].isalnum() and current[0].isalnum()
