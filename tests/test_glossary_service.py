from backend.app.services.glossary import GlossaryService


def test_add_and_list_only_enabled_terms() -> None:
    service = GlossaryService()

    created = service.add_term(
        source_term="  对象存储  ",
        target_term="  Object Storage  ",
        description="  七牛云核心存储产品  ",
    )

    enabled_terms = service.list_terms()
    all_terms = service.get_all()

    assert created.source_term == "对象存储"
    assert created.target_term == "Object Storage"
    assert created.description == "七牛云核心存储产品"
    assert created.enabled is True
    assert enabled_terms == [created]
    assert all_terms == [created]


def test_disabled_terms_do_not_match_text() -> None:
    service = GlossaryService()
    term = service.add_term("七牛云", "Qiniu Cloud")

    service.enable_term(term.id, False)

    assert service.match_terms("七牛云对象存储服务") == []
    assert service.list_terms() == []
    assert service.get_all() == [term]


def test_match_terms_prefers_longer_term_at_same_position() -> None:
    service = GlossaryService()
    shorter = service.add_term("对象存储", "Object Storage")
    longer = service.add_term("对象存储服务", "Object Storage Service")

    matches = service.match_terms("对象存储服务支持海量文件")

    assert matches == [(longer, 0), (shorter, 0)]


def test_match_terms_are_sorted_by_position() -> None:
    service = GlossaryService()
    first = service.add_term("七牛云", "Qiniu Cloud")
    second = service.add_term("对象存储", "Object Storage")

    matches = service.match_terms("七牛云的对象存储服务")

    assert matches == [(first, 0), (second, 4)]


def test_remove_term_returns_true_only_for_existing_term() -> None:
    service = GlossaryService()
    term = service.add_term("空间", "Bucket")

    assert service.remove_term(term.id) is True
    assert service.remove_term(term.id) is False
    assert service.get_all() == []


def test_clear_removes_all_terms() -> None:
    service = GlossaryService()
    service.add_term("对象存储", "Object Storage")
    service.add_term("空间", "Bucket")

    service.clear()

    assert service.list_terms() == []
    assert service.get_all() == []
