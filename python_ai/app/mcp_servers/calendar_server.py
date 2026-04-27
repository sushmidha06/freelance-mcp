"""Google Calendar MCP server.

Auth model: the user pastes their **Calendar Secret iCal URL** into Settings →
Integrations → Calendar. Calendar doesn't support app passwords like Gmail does;
the secret iCal address is the simplest read-only credential Google offers
that doesn't require an OAuth dance.

Tools:
  Read:
- list_upcoming_events(days=7, limit=20)
- search_events(query, days=14)
  Write (one-click confirm via Google Calendar prefill URL — Google's "render"
  flow opens a pre-filled event-creation page; the user clicks "Save"):
- draft_event(title, start, end?, location?, description?, attendees?)

We parse the .ics manually (no extra deps) — minimal subset is enough to
extract SUMMARY, DTSTART, DTEND, LOCATION.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import httpx

from ..node_client import NodeClient
from .base import McpError, McpServer


@dataclass
class Event:
    summary: str
    start: datetime | None
    end: datetime | None
    location: str
    description: str


def _parse_dt(raw: str) -> datetime | None:
    """Best-effort iCal date/datetime parse."""
    if not raw:
        return None
    raw = raw.split(":")[-1].strip()
    # All-day: YYYYMMDD
    if len(raw) == 8 and raw.isdigit():
        return datetime.strptime(raw, "%Y%m%d").replace(tzinfo=timezone.utc)
    # UTC: 20260425T130000Z
    try:
        if raw.endswith("Z"):
            return datetime.strptime(raw, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
        return datetime.strptime(raw, "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _parse_ical(text: str) -> list[Event]:
    events: list[Event] = []
    current: dict[str, str] | None = None
    # Unfold continuation lines (RFC 5545: a line starting with whitespace is a continuation)
    lines = []
    for raw_line in text.splitlines():
        if raw_line.startswith((" ", "\t")) and lines:
            lines[-1] += raw_line[1:]
        else:
            lines.append(raw_line)
    for line in lines:
        if line == "BEGIN:VEVENT":
            current = {}
        elif line == "END:VEVENT" and current is not None:
            events.append(Event(
                summary=current.get("SUMMARY", ""),
                start=_parse_dt(current.get("DTSTART", "")),
                end=_parse_dt(current.get("DTEND", "")),
                location=current.get("LOCATION", ""),
                description=current.get("DESCRIPTION", "")[:280],
            ))
            current = None
        elif current is not None and ":" in line:
            key, val = line.split(":", 1)
            key = key.split(";", 1)[0]
            current[key] = val
    return events


class CalendarMcpServer(McpServer):
    server_name = "calendar"

    def __init__(self, node: NodeClient):
        self.node = node
        self._cached_url: str | None = None
        super().__init__()

    def _ical_url(self) -> str:
        if self._cached_url:
            return self._cached_url
        conn = self.node.get_connection("calendar")
        if not conn:
            raise McpError("Google Calendar is not connected. Ask the user to connect it in Integrations.")
        url = (conn.get("secrets") or {}).get("icalUrl")
        if not url:
            raise McpError("Calendar connection is missing the iCal secret URL.")
        self._cached_url = url
        return url

    def _fetch_events(self) -> list[Event]:
        url = self._ical_url()
        with httpx.Client(timeout=20.0, follow_redirects=True) as c:
            r = c.get(url)
            if r.status_code != 200:
                raise McpError(f"calendar fetch failed: HTTP {r.status_code}")
            return _parse_ical(r.text)

    def _register_tools(self) -> None:
        self._tool(
            "list_upcoming_events",
            "List upcoming events from the user's Google Calendar.",
            {
                "type": "object",
                "properties": {
                    "days": {"type": "integer", "minimum": 1, "maximum": 30, "default": 7},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 20},
                },
                "additionalProperties": False,
            },
            self._upcoming,
        )
        self._tool(
            "search_events",
            "Search the user's calendar for events whose summary contains the query (case-insensitive).",
            {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "days": {"type": "integer", "minimum": 1, "maximum": 60, "default": 14},
                },
                "required": ["query"],
                "additionalProperties": False,
            },
            self._search,
        )
        self._tool(
            "draft_event",
            (
                "Draft a new Google Calendar event. Returns a one-click URL the user "
                "opens to review and save the event in Google Calendar (the iCal "
                "connection is read-only, so we propose rather than write directly). "
                "Use ISO-8601 datetimes (e.g. 2026-04-26T15:00:00) — assume the user's "
                "current timezone if not specified."
            ),
            {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Event title (e.g. 'Discovery call with Acme')"},
                    "start": {"type": "string", "description": "ISO-8601 start datetime"},
                    "end":   {"type": "string", "description": "ISO-8601 end datetime. Defaults to +30 minutes."},
                    "location":    {"type": "string"},
                    "description": {"type": "string"},
                    "attendees":   {"type": "array", "items": {"type": "string"}, "description": "Email addresses to invite."},
                },
                "required": ["title", "start"],
                "additionalProperties": False,
            },
            self._draft_event,
        )

    def _upcoming(self, days: int = 7, limit: int = 20) -> dict:
        now = datetime.now(timezone.utc)
        until = now + timedelta(days=days)
        events = [
            e for e in self._fetch_events()
            if e.start and now <= e.start <= until
        ]
        events.sort(key=lambda e: e.start or now)
        out = events[:limit]
        return {
            "count": len(out),
            "events": [self._render(e) for e in out],
        }

    def _search(self, query: str, days: int = 14) -> dict:
        q = (query or "").lower().strip()
        if not q:
            raise McpError("query is required")
        now = datetime.now(timezone.utc)
        until = now + timedelta(days=days)
        events = [
            e for e in self._fetch_events()
            if e.start and now <= e.start <= until and q in (e.summary or "").lower()
        ]
        events.sort(key=lambda e: e.start or now)
        return {"query": query, "count": len(events), "events": [self._render(e) for e in events]}

    def _draft_event(
        self,
        title: str,
        start: str,
        end: str | None = None,
        location: str | None = None,
        description: str | None = None,
        attendees: list[str] | None = None,
    ) -> dict:
        if not title or not title.strip():
            raise McpError("title is required")
        try:
            start_dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
        except ValueError:
            raise McpError(f"invalid start datetime: {start}")
        if end:
            try:
                end_dt = datetime.fromisoformat(end.replace("Z", "+00:00"))
            except ValueError:
                raise McpError(f"invalid end datetime: {end}")
        else:
            end_dt = start_dt + timedelta(minutes=30)

        # Google Calendar event-render URL accepts dates in YYYYMMDDTHHMMSSZ.
        def _fmt(dt: datetime) -> str:
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

        params = [
            ("action", "TEMPLATE"),
            ("text", title.strip()),
            ("dates", f"{_fmt(start_dt)}/{_fmt(end_dt)}"),
        ]
        if location: params.append(("location", location))
        if description: params.append(("details", description))
        if attendees:
            params.append(("add", ",".join(attendees)))

        url = "https://calendar.google.com/calendar/render?" + "&".join(
            f"{k}={quote(str(v))}" for k, v in params
        )
        return {
            "title": title.strip(),
            "start": start_dt.isoformat(),
            "end": end_dt.isoformat(),
            "url": url,
            "instructions": (
                "Click the URL to open Google Calendar with this event pre-filled. "
                "Review the details and click 'Save' to add it to your calendar."
            ),
        }

    @staticmethod
    def _render(e: Event) -> dict:
        return {
            "summary": e.summary,
            "start": e.start.isoformat() if e.start else None,
            "end":   e.end.isoformat()   if e.end   else None,
            "location": e.location,
            "description": e.description,
        }
