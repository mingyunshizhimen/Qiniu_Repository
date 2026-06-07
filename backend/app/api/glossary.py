from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field

from backend.app.services.glossary import GlossaryService, GlossaryTerm, get_glossary_service

router = APIRouter(prefix="/glossary", tags=["glossary"])


class GlossaryTermResponse(BaseModel):
    id: str
    source_term: str
    target_term: str
    description: str
    enabled: bool


class CreateGlossaryTermRequest(BaseModel):
    source_term: str = Field(min_length=1)
    target_term: str = Field(min_length=1)
    description: str = ""


class UpdateGlossaryTermRequest(BaseModel):
    enabled: bool


def _serialize_term(term: GlossaryTerm) -> GlossaryTermResponse:
    return GlossaryTermResponse(
        id=term.id,
        source_term=term.source_term,
        target_term=term.target_term,
        description=term.description,
        enabled=term.enabled,
    )


@router.get("/terms", response_model=list[GlossaryTermResponse])
def list_glossary_terms(
    glossary_service: Annotated[GlossaryService, Depends(get_glossary_service)],
    enabled_only: bool = Query(default=False),
) -> list[GlossaryTermResponse]:
    terms = glossary_service.list_terms() if enabled_only else glossary_service.get_all()
    return [_serialize_term(term) for term in terms]


@router.post(
    "/terms",
    response_model=GlossaryTermResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_glossary_term(
    request: CreateGlossaryTermRequest,
    glossary_service: Annotated[GlossaryService, Depends(get_glossary_service)],
) -> GlossaryTermResponse:
    term = glossary_service.add_term(
        source_term=request.source_term,
        target_term=request.target_term,
        description=request.description,
    )
    return _serialize_term(term)


@router.patch("/terms/{term_id}", response_model=GlossaryTermResponse)
def update_glossary_term(
    term_id: str,
    request: UpdateGlossaryTermRequest,
    glossary_service: Annotated[GlossaryService, Depends(get_glossary_service)],
) -> GlossaryTermResponse:
    term = glossary_service.enable_term(term_id, request.enabled)
    if term is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Glossary term not found.",
        )
    return _serialize_term(term)


@router.delete("/terms", status_code=status.HTTP_405_METHOD_NOT_ALLOWED)
def delete_without_id() -> None:
    raise HTTPException(
        status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
        detail="Delete requires a glossary term id.",
    )


@router.delete("/terms/{term_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_glossary_term(
    term_id: str,
    glossary_service: Annotated[GlossaryService, Depends(get_glossary_service)],
) -> Response:
    removed = glossary_service.remove_term(term_id)
    if not removed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Glossary term not found.",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
