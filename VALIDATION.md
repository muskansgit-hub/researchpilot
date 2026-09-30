# Validation

Validated locally on Windows with Python 3.13 and Chrome.

- Backend: 9 integration tests passed, including genuine PDF text extraction, quote provenance rejection, model response verification with a mocked provider, provider-failure fallback, persistence, scoping, comparison, graph, and input handling.
- Frontend: TypeScript checking and Vite production build passed.
- Browser: desktop/mobile research flow, exact-evidence expansion, comparison, graph, history, Markdown export, paper import, filtering, and deletion.
- Dependency consistency: `pip check` passed; npm installation reported zero vulnerabilities.
- Live external integration: arXiv search for `retrieval` returned HTTP 200 and a real paper abstract.
- Docker: configuration provided, but the local Docker engine was unavailable, so container execution was not tested.
- Paid model synthesis: mocked success/failure paths tested; no user API key was available for a live model call.

The default retrieval backend uses lexical hashing vectors. Source quote matching is tested; semantic entailment and retrieval quality have not been benchmarked. Demo material is labeled explanatory notes throughout import and source data.
