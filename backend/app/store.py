import json
import re
import sqlite3
import threading
import uuid
from pathlib import Path

from qdrant_client import QdrantClient, models
from sklearn.feature_extraction.text import HashingVectorizer


class Store:
    """SQLite is canonical; Qdrant is a rebuildable local vector index."""

    def __init__(self, directory: str):
        Path(directory).mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(str(Path(directory) / 'research.db'), check_same_thread=False)
        self.db.execute('CREATE TABLE IF NOT EXISTS papers (id TEXT PRIMARY KEY, data TEXT NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, data TEXT NOT NULL)')
        self.db.commit()
        self.vectorizer = HashingVectorizer(n_features=2048, alternate_sign=False, stop_words='english', norm='l2')
        self.index = QdrantClient(':memory:')
        self.index.create_collection('passages', vectors_config=models.VectorParams(size=2048, distance=models.Distance.COSINE))
        for paper in self.papers():
            self._index(paper)

    def embed(self, text):
        return self.vectorizer.transform([text]).toarray()[0].tolist()

    @staticmethod
    def chunks(text):
        words = text.split()
        return [' '.join(words[i:i + 180]) for i in range(0, len(words), 140)]

    def _index(self, paper):
        points = []
        for n, passage in enumerate(self.chunks(paper['text'])):
            cid = str(uuid.uuid5(uuid.NAMESPACE_URL, paper['id'] + ':' + str(n)))
            points.append(models.PointStruct(id=cid, vector=self.embed(passage), payload={
                'paper_id': paper['id'], 'title': paper['title'], 'text': passage, 'chunk': n,
                'source_url': paper['source_url'], 'source_type': paper['source_type']}))
        if points:
            self.index.upsert('passages', points)

    def add(self, paper):
        paper = dict(paper)
        paper['text'] = re.sub(r'\s+', ' ', paper['text']).strip()
        paper['id'] = str(uuid.uuid5(uuid.NAMESPACE_URL, paper['title'].casefold().strip() + paper['text']))
        with self.lock:
            self.db.execute('INSERT OR REPLACE INTO papers VALUES (?, ?)', (paper['id'], json.dumps(paper)))
            self.db.commit()
            self._index(paper)
        return paper

    def papers(self):
        with self.lock:
            return [json.loads(r[0]) for r in self.db.execute('SELECT data FROM papers ORDER BY rowid DESC')]

    def search(self, query, paper_ids=None, limit=8):
        if paper_ids == []:
            return []
        filt = models.Filter(must=[models.FieldCondition(key='paper_id', match=models.MatchAny(any=paper_ids))]) if paper_ids else None
        with self.lock:
            hits = self.index.query_points('passages', query=self.embed(query), query_filter=filt, limit=limit, score_threshold=0.025).points
        return [dict(h.payload, id=str(h.id), score=round(h.score, 4)) for h in hits]

    def save_review(self, review):
        with self.lock:
            self.db.execute('INSERT OR REPLACE INTO reviews VALUES (?, ?)', (review['id'], json.dumps(review)))
            self.db.commit()

    def reviews(self):
        with self.lock:
            return [json.loads(r[0]) for r in self.db.execute('SELECT data FROM reviews ORDER BY rowid DESC')]

    def delete(self, paper_id):
        with self.lock:
            self.db.execute('DELETE FROM papers WHERE id=?', (paper_id,))
            self.db.commit()
            self.index.delete('passages', models.FilterSelector(filter=models.Filter(must=[models.FieldCondition(key='paper_id', match=models.MatchValue(value=paper_id))])))

    def close(self):
        self.index.close()
        self.db.close()
