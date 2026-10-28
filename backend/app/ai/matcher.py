"""IdeaGraphMatcher: decide whether extracted events concern existing ideas.

Three layers (deterministic, fully testable — no LLM calls here):
1. exact id match: event.related_idea_ids validated against project ideas
2. lexical match: title+body similarity against every idea (token overlap +
   difflib ratio)
3. ambiguity guard: close scores or mid-band similarity -> needs_review

A title being merely similar never merges two hypotheses automatically; only
strong unambiguous matches set a target, everything else is left for review.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher

from .. import schemas

STRONG_MATCH = 0.62
AMBIGUOUS_GAP = 0.08
REVIEW_BAND_LOW = 0.45

TOKEN = re.compile(r"[a-z0-9]+|[\u4e00-\u9fff]")


def _tokens(text: str) -> set[str]:
    return set(TOKEN.findall(text.lower()))


def similarity(a: str, b: str) -> float:
    ta, tb = _tokens(a), _tokens(b)
    overlap = len(ta & tb) / max(1, len(ta | tb))
    ratio = SequenceMatcher(None, a.lower(), b.lower()).ratio()
    return max(overlap, ratio * 0.9)


class MatchResult:
    def __init__(self, idea_id: int | None, status: str, score: float, candidates: list[tuple[int, float]]):
        self.idea_id = idea_id
        self.status = status  # matched | new | needs_review
        self.score = score
        self.candidates = candidates  # [(idea_id, score)] top 3, for the review UI


def match_event(event, ideas: list[schemas.IdeaRead]) -> MatchResult:
    details = event.details or {}
    event_text = (
        f"{event.title} {event.description} "
        f"{details.get('new_title') or ''} {(details.get('new_body') or '')[:400]}"
    )

    # layer 1: explicit ids referenced by the extractor (validated)
    valid_ids = {idea.id for idea in ideas}
    explicit = [i for i in event.related_idea_ids if i in valid_ids]
    if len(explicit) == 1:
        return MatchResult(explicit[0], "matched", 1.0, [(explicit[0], 1.0)])
    if len(explicit) > 1:
        # multiple explicit targets are legitimate for merge events; the
        # proposal builder reads them from related_idea_ids directly.
        return MatchResult(explicit[0], "matched", 1.0, [(i, 1.0) for i in explicit])

    # layer 2: lexical scoring
    scored: list[tuple[int, float]] = []
    for idea in ideas:
        current = next((v for v in idea.versions if v.id == idea.current_version_id), None)
        idea_text = f"{idea.title} {current.body if current else ''}"
        scored.append((idea.id, similarity(event_text, idea_text)))
    scored.sort(key=lambda pair: pair[1], reverse=True)

    if not scored:
        return MatchResult(None, "new", 0.0, [])

    best_id, best = scored[0]
    second = scored[1][1] if len(scored) > 1 else 0.0

    # layer 3: ambiguity guards
    if best >= STRONG_MATCH and best - second >= AMBIGUOUS_GAP:
        return MatchResult(best_id, "matched", best, scored[:3])
    if best >= REVIEW_BAND_LOW:
        return MatchResult(None, "needs_review", best, scored[:3])
    return MatchResult(None, "new", best, scored[:3])


def current_version_of(idea: schemas.IdeaRead) -> int | None:
    return idea.current_version_id
