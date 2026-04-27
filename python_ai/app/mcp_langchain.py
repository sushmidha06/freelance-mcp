"""Adapter that wraps MCP server tools as LangChain `StructuredTool`s,
so the Gemini function-calling agent can invoke them transparently."""

from __future__ import annotations

from typing import Any

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field, create_model

from .mcp_servers.base import McpServer


def _schema_to_pydantic(name: str, schema: dict) -> type[BaseModel]:
    """Translate a (small subset of) JSON Schema into a Pydantic model
    so LangChain/Gemini can render the function signature."""
    fields: dict[str, tuple[Any, Any]] = {}
    props = (schema or {}).get("properties", {}) or {}
    required = set((schema or {}).get("required", []) or [])
    type_map = {"string": str, "integer": int, "number": float, "boolean": bool, "object": dict, "array": list}
    for key, spec in props.items():
        py_type = type_map.get(spec.get("type", "string"), str)
        default = ... if key in required else spec.get("default", None)
        fields[key] = (py_type, Field(default=default, description=spec.get("description", "")))
    if not fields:
        # Pydantic won't allow a totally empty model in some versions; add a dummy optional
        return create_model(f"{name}Args")
    return create_model(f"{name}Args", **fields)


def mcp_server_to_langchain_tools(server: McpServer, namespace: str | None = None) -> list[StructuredTool]:
    """Expose every tool on an MCP server as a LangChain StructuredTool."""
    ns = namespace or server.server_name
    out: list[StructuredTool] = []
    for tool in server.list_tools():
        tool_name = f"{ns}__{tool['name']}"
        args_model = _schema_to_pydantic(tool_name, tool.get("inputSchema") or {})

        def _make_callable(_server: McpServer, _tool_name: str):
            def _call(**kwargs):
                # Strip None defaults to keep arg payload tight
                cleaned = {k: v for k, v in kwargs.items() if v is not None}
                result = _server.call_tool(_tool_name, cleaned)
                # LangChain tools must return strings (or serialisable); MCP
                # response is {content: [TextContent], isError}.
                texts = [c.get("text", "") for c in (result.get("content") or []) if c.get("type") == "text"]
                if result.get("isError"):
                    return "ERROR: " + "\n".join(texts)
                return "\n".join(texts) or "(empty)"
            return _call

        out.append(
            StructuredTool.from_function(
                name=tool_name,
                description=tool["description"],
                args_schema=args_model,
                func=_make_callable(server, tool["name"]),
            )
        )
    return out
