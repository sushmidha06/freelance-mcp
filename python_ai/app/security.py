from __future__ import annotations

import time
from typing import Optional

import jwt
from fastapi import Header, HTTPException, status

from .settings import settings


def sign_service_token(user_id: str, email: str | None = None, ttl_seconds: int = 300) -> str:
    """Mirror of Node `signServiceToken`. Only used internally when Python
    calls back into the Node backend to fetch per-user data."""
    if not settings.JWT_SHARED_SECRET:
        raise RuntimeError("JWT_SHARED_SECRET not configured")
    now = int(time.time())
    payload = {
        "userId": user_id,
        "email": email or "",
        "iat": now,
        "exp": now + ttl_seconds,
    }
    return jwt.encode(payload, settings.JWT_SHARED_SECRET, algorithm="HS256")


def verify_service_token(token: str) -> dict:
    if not settings.JWT_SHARED_SECRET:
        raise HTTPException(status_code=500, detail="JWT not configured")
    try:
        return jwt.decode(token, settings.JWT_SHARED_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail=f"invalid token: {exc}") from exc


def require_user(authorization: Optional[str] = Header(default=None)) -> dict:
    """FastAPI dependency. Extracts & verifies the service JWT issued by the Node backend.
    Returns a dict with at least `userId`."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing bearer token")
    token = authorization[len("Bearer ") :]
    claims = verify_service_token(token)
    if "userId" not in claims:
        raise HTTPException(status_code=401, detail="token missing userId")
    return claims
