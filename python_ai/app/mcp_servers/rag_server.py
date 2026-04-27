"""Knowledge-base MCP server backed by Chroma Cloud (per-tenant collection)."""

from __future__ import annotations

from ..rag import RagIndex
from .base import McpError, McpServer


class RagMcpServer(McpServer):
    server_name = "knowledge_base"

    def __init__(self, index: RagIndex):
        self.index = index
        super().__init__()

    def _register_tools(self) -> None:
        self._tool(
            "search_knowledge",
            (
                "Retrieve the most relevant snippets from the user's workspace via vector "
                "search (Chroma Cloud, per-tenant collection, Gemini embeddings). Use this "
                "when the user asks something factual or open-ended about their own data."
            ),
            {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "top_k": {"type": "integer", "minimum": 1, "maximum": 8, "default": 4},
                    "source": {
                        "type": "string",
                        "enum": ["project", "invoice", "alert", "email"],
                        "description": "Optional: only search within one source type.",
                    },
                    "client": {
                        "type": "string",
                        "description": "Optional: only search docs tagged with this client name.",
                    },
                },
                "required": ["query"],
                "additionalProperties": False,
            },
            self._search,
        )

    def _search(self, query: str, top_k: int = 4, source: str | None = None, client: str | None = None) -> dict:
        where: dict = {}
        if source: where["source"] = {"$eq": source}
        if client: where["client"] = {"$eq": client}
        results = self.index.search(query, top_k=top_k, where=where or None)
        if not results:
            raise McpError("knowledge base is empty for that query — user may have no workspace data yet")
        return {
            "query": query,
            "filter": where or None,
            "results": [
                {
                    "id": d.id,
                    "source": d.source,
                    "title": d.title,
                    "text": d.text,
                    "score": round(s, 3),
                    "metadata": {k: v for k, v in (d.metadata or {}).items() if k != "title"},
                }
                for d, s in results
            ],
        }
