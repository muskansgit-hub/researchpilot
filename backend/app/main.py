import io
import os
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
import xml.etree.ElementTree as ET

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, HttpUrl
from pypdf import PdfReader

from .store import Store
from .pipeline import run_review

load_dotenv()


class PaperInput(BaseModel):
    title: str = Field(min_length=3, max_length=500)
    authors: str = Field(default='', max_length=1000)
    year: int = Field(default=2026, ge=1800, le=2100)
    source_url: HttpUrl | None = None
    text: str = Field(min_length=40, max_length=500000)
    source_type: Literal['pasted text', 'abstract'] = 'pasted text'


class ReviewInput(BaseModel):
    question: str = Field(min_length=5, max_length=2000)
    paper_ids: list[str] | None = Field(default=None, max_length=30)


class CompareInput(BaseModel):
    paper_ids: list[str] = Field(min_length=2, max_length=4)
    question: str = Field(default='What are the methods, findings, and limitations?', min_length=5, max_length=2000)


DEMO = [
    {'title': 'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks', 'authors': 'Lewis et al.', 'year': 2020, 'source_url': 'https://arxiv.org/abs/2005.11401', 'text': 'DEMO: Curated explanatory notes, not verbatim paper text. Retrieval-augmented generation combines a retriever over an external document collection with a sequence-to-sequence generator. Retrieved passages condition generation and provide access to knowledge beyond model parameters. The paper studies knowledge-intensive natural language processing tasks. A retrieved passage is not a guarantee that a generated answer is supported by that passage.'},
    {'title': 'Dense Passage Retrieval for Open-Domain Question Answering', 'authors': 'Karpukhin et al.', 'year': 2020, 'source_url': 'https://arxiv.org/abs/2004.04906', 'text': 'DEMO: Curated explanatory notes, not verbatim paper text. Dense passage retrieval encodes questions and passages into vectors using separate encoders. Similarity search selects passages for open-domain question answering. The retrieval component can be trained with positive and negative passage examples. Retrieval quality and answer generation quality are distinct aspects of a question answering system.'},
    {'title': 'Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection', 'authors': 'Asai et al.', 'year': 2023, 'source_url': 'https://arxiv.org/abs/2310.11511', 'text': 'DEMO: Curated explanatory notes, not verbatim paper text. Self-RAG trains a language model to retrieve passages and evaluate its generations using reflection tokens. The approach includes decisions about whether retrieval is needed and whether retrieved passages support generated content. Citation support and relevance are evaluated as part of the generation process. Self-reflection can still be incorrect and does not replace independent evidence checking.'},
]


def create_app(data_dir=None):
    @asynccontextmanager
    async def lifespan(app):
        app.state.store = Store(data_dir or os.getenv('DATA_DIR', 'data'))
        yield
        app.state.store.close()

    app = FastAPI(title='ResearchPilot', version='1.0.0', lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=['http://localhost:5173', 'http://127.0.0.1:5173'], allow_methods=['*'], allow_headers=['*'])

    @app.get('/api/health')
    def health():
        return {'status': 'ok', 'synthesis': 'llm-assisted' if os.getenv('LLM_API_KEY') else 'extractive', 'retrieval': 'local hashing vectors / Qdrant'}

    @app.get('/api/papers')
    def papers():
        return app.state.store.papers()

    @app.post('/api/papers', status_code=201)
    def add_paper(body: PaperInput):
        return app.state.store.add(body.model_dump(mode='json'))

    @app.delete('/api/papers/{paper_id}', status_code=204)
    def delete(paper_id: str):
        app.state.store.delete(paper_id)

    @app.post('/api/demo')
    def demo():
        return [app.state.store.add(dict(p, source_type='demo notes')) for p in DEMO]

    @app.post('/api/papers/pdf', status_code=201)
    def upload(file: UploadFile = File(...)):
        raw = file.file.read(15 * 1024 * 1024 + 1)
        if len(raw) > 15 * 1024 * 1024:
            raise HTTPException(413, 'PDF must be smaller than 15 MB.')
        if not raw.startswith(b'%PDF'):
            raise HTTPException(422, 'Please upload a valid PDF.')
        try:
            reader = PdfReader(io.BytesIO(raw))
            if len(reader.pages) > 300:
                raise ValueError('PDF exceeds 300 pages.')
            text = '\n'.join(p.extract_text() or '' for p in reader.pages)
            title = str((reader.metadata or {}).get('/Title') or Path(file.filename or 'Uploaded paper').stem)
            if len(text.strip()) < 40:
                raise ValueError('No readable text found. Scanned PDFs require OCR before import.')
            if len(text) > 500000:
                raise ValueError('Extracted text exceeds 500,000 characters.')
        except Exception as exc:
            raise HTTPException(422, str(exc) if isinstance(exc, ValueError) else 'Unable to extract this PDF.') from exc
        return app.state.store.add({'title': title[:500], 'authors': '', 'year': None, 'source_url': None, 'text': text, 'source_type': 'PDF'})

    @app.get('/api/discover')
    def discover(query: str = '', limit: int = 6):
        if not 3 <= len(query) <= 300:
            raise HTTPException(422, 'Search must contain 3–300 characters.')
        # Fixed host: arbitrary server-side URLs are never fetched.
        terms = re.findall(r'[\w-]+', query)[:25]
        try:
            response = httpx.get('https://export.arxiv.org/api/query', params={'search_query': ' AND '.join('all:' + t for t in terms), 'max_results': min(max(limit, 1), 12)}, timeout=25, headers={'User-Agent': 'ResearchPilot/1.0'})
            response.raise_for_status()
            root = ET.fromstring(response.text)
        except (httpx.HTTPError, ET.ParseError) as exc:
            raise HTTPException(502, 'arXiv is unavailable or rate-limiting requests. Try again later, or import text/PDF.') from exc
        ns = {'a': 'http://www.w3.org/2005/Atom'}
        results = []
        for entry in root.findall('a:entry', ns):
            results.append({'title': ' '.join(entry.findtext('a:title', '', ns).split()),
                            'authors': ', '.join(a.findtext('a:name', '', ns) for a in entry.findall('a:author', ns)),
                            'year': int(entry.findtext('a:published', '2026', ns)[:4]),
                            'source_url': entry.findtext('a:id', '', ns).replace('http:', 'https:'),
                            'text': ' '.join(entry.findtext('a:summary', '', ns).split()), 'source_type': 'abstract'})
        return results

    def validate_ids(ids):
        known = {p['id'] for p in app.state.store.papers()}
        if ids is not None and (not ids or not set(ids).issubset(known)):
            raise HTTPException(422, 'Select existing papers from your library.')

    @app.post('/api/reviews', status_code=201)
    def review(body: ReviewInput):
        validate_ids(body.paper_ids)
        return run_review(app.state.store, body.question, body.paper_ids)

    @app.get('/api/reviews')
    def reviews():
        return app.state.store.reviews()

    @app.post('/api/compare')
    def compare(body: CompareInput):
        validate_ids(body.paper_ids)
        if len(set(body.paper_ids)) < 2:
            raise HTTPException(422, 'Select at least two different papers.')
        by_id = {p['id']: p for p in app.state.store.papers()}
        return [{'paper': by_id[pid], 'passages': app.state.store.search(body.question, [pid], 3)} for pid in dict.fromkeys(body.paper_ids)]

    @app.get('/api/graph')
    def graph():
        papers = app.state.store.papers()
        concepts = ['retrieval', 'generation', 'language model', 'question answering', 'citation', 'learning', 'evaluation', 'evidence', 'neural', 'attention']
        nodes = [{'id': p['id'], 'label': p['title'], 'type': 'paper'} for p in papers]
        edges = []
        for concept in concepts:
            members = [p for p in papers if concept in p['text'].lower()]
            if members:
                nodes.append({'id': 'concept:' + concept, 'label': concept, 'type': 'concept'})
                edges.extend({'source': p['id'], 'target': 'concept:' + concept, 'relation': 'mentions'} for p in members)
        return {'nodes': nodes, 'edges': edges, 'method': 'Deterministic concept mentions in imported text. Edges are not citation links or causal claims.'}

    frontend = Path(__file__).resolve().parents[2] / 'frontend' / 'dist'
    if frontend.exists():
        app.mount('/', StaticFiles(directory=str(frontend), html=True), name='frontend')
    return app


app = create_app()
