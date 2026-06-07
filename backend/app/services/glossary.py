"""Glossary service for managing terminology and matching enabled terms."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class GlossaryTerm:
    """A terminology entry with its preferred translation."""

    id: str
    source_term: str
    target_term: str
    description: str = ""
    enabled: bool = True


class GlossaryService:
    """In-memory glossary service used by the realtime translation pipeline."""

    def __init__(self) -> None:
        self._terms: dict[str, GlossaryTerm] = {}

    def add_term(
        self,
        source_term: str,
        target_term: str,
        description: str = "",
    ) -> GlossaryTerm:
        """Create a new glossary term and store it in memory."""
        term = GlossaryTerm(
            id=str(uuid.uuid4()),
            source_term=source_term.strip(),
            target_term=target_term.strip(),
            description=description.strip(),
            enabled=True,
        )
        self._terms[term.id] = term
        logger.info("Added glossary term %s -> %s", term.source_term, term.target_term)
        return term

    def remove_term(self, term_id: str) -> bool:
        """Remove a term by id and return whether it existed."""
        term = self._terms.pop(term_id, None)
        if term is None:
            logger.warning("Attempted to remove unknown glossary term id=%s", term_id)
            return False

        logger.info("Removed glossary term %s", term.source_term)
        return True

    def list_terms(self) -> list[GlossaryTerm]:
        """Return enabled glossary terms."""
        return [term for term in self._terms.values() if term.enabled]

    def get_all(self) -> list[GlossaryTerm]:
        """Return all glossary terms, including disabled ones."""
        return list(self._terms.values())

    def enable_term(self, term_id: str, enabled: bool) -> GlossaryTerm | None:
        """Enable or disable a term and return the updated term if found."""
        term = self._terms.get(term_id)
        if term is None:
            logger.warning("Attempted to update unknown glossary term id=%s", term_id)
            return None

        term.enabled = enabled
        logger.info(
            "%s glossary term %s",
            "Enabled" if enabled else "Disabled",
            term.source_term,
        )
        return term

    def match_terms(self, text: str) -> list[tuple[GlossaryTerm, int]]:
        """Return enabled glossary matches ordered by position, then longest term."""
        matches: list[tuple[GlossaryTerm, int]] = []

        for term in self.list_terms():
            start_index = text.find(term.source_term)
            if start_index == -1:
                continue
            matches.append((term, start_index))

        matches.sort(key=lambda item: (item[1], -len(item[0].source_term)))

        if matches:
            logger.debug("Matched %s glossary terms in text", len(matches))

        return matches

    def clear(self) -> None:
        """Clear all in-memory terms."""
        term_count = len(self._terms)
        self._terms.clear()
        logger.info("Cleared %s glossary terms", term_count)
