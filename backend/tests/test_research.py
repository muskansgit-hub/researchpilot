import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.pipeline import verify_claims


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.delenv('LLM_API_KEY', raising=False)
    with TestClient(create_app(str(tmp_path))) as client:
        yield client


def test_end_to_end_review_and_history(client):
    papers = client.post('/api/demo').json()
    assert len(papers) == 3
    assert len(client.post('/api/demo').json()) == 3
    assert len(client.get('/api/papers').json()) == 3
    response = client.post('/api/reviews', json={'question': 'How does retrieval support generation?'})
    assert response.status_code == 201
    review = response.json()
    assert review['mode'] == 'extractive'
    assert review['claims']
    sources = {e['id']: e for e in review['evidence']}
    for claim in review['claims']:
        assert claim['quote'] in sources[claim['evidence_id']]['text']
        assert claim['verification'] == 'exact extract'
    assert client.get('/api/reviews').json()[0]['id'] == review['id']
    assert len(review['trace']) == 3


def test_verifier_rejects_invented_quotes_and_ids():
    evidence = [{'id': 'a', 'paper_id': 'p', 'title': 'Paper', 'text': 'Retrieval selects relevant passages from a corpus.', 'source_url': None}]
    claims = [{'text': 'Invented', 'quote': 'Retrieval solves every problem in science.', 'evidence_id': 'a'},
              {'text': 'Invented', 'quote': evidence[0]['text'], 'evidence_id': 'fake'}]
    assert verify_claims(claims, evidence) == []


def test_scope_comparison_graph_and_delete(client):
    papers = client.post('/api/demo').json()
    ids = [p['id'] for p in papers]
    r = client.post('/api/reviews', json={'question': 'retrieval generation', 'paper_ids': [ids[0]]}).json()
    assert {e['paper_id'] for e in r['evidence']} == {ids[0]}
    result = client.post('/api/compare', json={'paper_ids': ids[:2]}).json()
    assert len(result) == 2
    assert client.get('/api/graph').json()['edges']
    assert client.delete('/api/papers/' + ids[0]).status_code == 204
    assert len(client.get('/api/papers').json()) == 2
    assert client.post('/api/reviews', json={'question': 'retrieval', 'paper_ids': [ids[0]]}).status_code == 422


def test_empty_evidence_and_bad_input(client):
    r = client.post('/api/reviews', json={'question': 'No papers in this library'}).json()
    assert r['claims'] == []
    assert r['warnings']
    assert client.post('/api/papers/pdf', files={'file': ('fake.pdf', b'not a PDF')}).status_code == 422
    assert client.post('/api/reviews', json={'question': 'x'}).status_code == 422
    assert client.post('/api/compare', json={'paper_ids': ['a']}).status_code == 422


def test_restart_rebuilds_index(tmp_path):
    app = create_app(str(tmp_path))
    with TestClient(app) as client:
        client.post('/api/demo')
        client.post('/api/reviews', json={'question': 'retrieval generation'})
    with TestClient(create_app(str(tmp_path))) as client:
        assert len(client.get('/api/papers').json()) == 3
        assert len(client.get('/api/reviews').json()) == 1
        assert client.post('/api/reviews', json={'question': 'retrieval generation'}).json()['claims']


def test_paste_import_and_url_validation(client):
    paper = {'title': 'Independent retrieval study', 'text': 'Retrieval identifies relevant documents for grounded evidence and generation.', 'source_url': 'https://example.org/paper'}
    assert client.post('/api/papers', json=paper).status_code == 201
    assert client.post('/api/papers', json=paper).status_code == 201
    assert len(client.get('/api/papers').json()) == 1
    paper['source_url'] = 'javascript:alert(1)'
    assert client.post('/api/papers', json=paper).status_code == 422


def test_pdf_text_extraction(client):
    import io
    from pypdf import PdfWriter
    from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
    stream = DecodedStreamObject()
    stream.set_data(b'BT /F1 12 Tf 50 700 Td (Retrieval provides relevant evidence for scientific question answering.) Tj ET')
    page[NameObject('/Contents')] = writer._add_object(stream)
    data = io.BytesIO()
    writer.write(data)
    response = client.post('/api/papers/pdf', files={'file': ('study.pdf', data.getvalue(), 'application/pdf')})
    assert response.status_code == 201
    assert 'Retrieval provides' in response.json()['text']
    assert response.json()['source_type'] == 'PDF'


def test_discovery_parsing_and_provider_failure(client, monkeypatch):
    import httpx
    class Response:
        text = '''<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>A test paper</title><id>http://arxiv.org/abs/1234.5678</id><published>2024-01-01</published><author><name>A Researcher</name></author><summary>A sufficient abstract about retrieval and evidence in academic research systems.</summary></entry></feed>'''
        def raise_for_status(self):
            pass
    monkeypatch.setattr('app.main.httpx.get', lambda *a, **k: Response())
    result = client.get('/api/discover?query=retrieval').json()
    assert result[0]['year'] == 2024
    assert result[0]['source_type'] == 'abstract'
    assert result[0]['source_url'].startswith('https:')
    assert client.post('/api/papers', json=result[0]).status_code == 201
    def fail(*a, **k):
        raise httpx.ConnectError('unavailable')
    monkeypatch.setattr('app.main.httpx.get', fail)
    assert client.get('/api/discover?query=retrieval').status_code == 502


def test_model_claim_validation_and_failure_fallback(client, monkeypatch):
    import json
    import httpx
    client.post('/api/demo')
    monkeypatch.setenv('LLM_API_KEY', 'test-key')
    def completion(self, url, **kwargs):
        data = json.loads(kwargs['json']['messages'][1]['content'])
        e = data['evidence'][0]
        content = {'claims': [{'text': 'A qualified interpretation.', 'quote': e['text'], 'evidence_id': e['id']}, {'text': 'Unsupported.', 'quote': 'This sentence does not exist in any source.', 'evidence_id': e['id']}]}
        return httpx.Response(200, request=httpx.Request('POST', url), json={'choices': [{'message': {'content': json.dumps(content)}}]})
    monkeypatch.setattr('app.pipeline.httpx.Client.post', completion)
    # TestClient uses httpx.Client too, so issue this request through its generic method.
    r = client.request('POST', '/api/reviews', json={'question': 'retrieval generation'}).json()
    assert r['mode'] == 'llm-assisted'
    assert len(r['claims']) == 1
    assert 'interpretation needs review' in r['claims'][0]['verification']
    assert 'removed' in r['warnings'][0]
    def fail(*args, **kwargs):
        raise httpx.ConnectError('unavailable')
    monkeypatch.setattr('app.pipeline.httpx.Client.post', fail)
    r = client.request('POST', '/api/reviews', json={'question': 'retrieval generation'}).json()
    assert r['mode'] == 'extractive'
    assert r['claims']
    assert 'unavailable' in r['warnings'][0]
