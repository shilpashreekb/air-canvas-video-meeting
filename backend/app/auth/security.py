"""
Security utilities: password hashing and JWT access tokens.

Design notes:
- Passwords are hashed with bcrypt via passlib. Plaintext passwords are never
  stored or logged anywhere.
- Auth is stateless JWT: the server signs a token containing the user's id
  and issues it on login. Protected routes verify the token's signature and
  expiry on every request via `get_current_user`. There is no server-side
  session table — see `logout()` in routes.py for what "logout" means under
  this model.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.config import settings
from app.database.database import get_db
from app.database.models import User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# tokenUrl is only used to populate the "Authorize" flow in the interactive
# /docs UI — this dependency itself just reads the Authorization: Bearer
# header from any incoming request, regardless of how /auth/login accepts
# credentials.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login", auto_error=False)


def hash_password(plain_password: str) -> str:
    """Hash a plaintext password for storage. Never store the plaintext itself."""
    return pwd_context.hash(plain_password)


def verify_password(plain_password: str, password_hash: str) -> bool:
    """Check a plaintext password against a stored bcrypt hash."""
    return pwd_context.verify(plain_password, password_hash)


def create_access_token(subject: int, expires_delta: Optional[timedelta] = None) -> str:
    """
    Create a signed JWT for the given user id (`subject`).

    The token payload contains:
        sub: the user's id (as a string, per JWT convention)
        exp: expiry timestamp
        iat: issued-at timestamp
    """
    if expires_delta is None:
        expires_delta = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    now = datetime.now(timezone.utc)
    expire = now + expires_delta

    payload = {
        "sub": str(subject),
        "iat": now,
        "exp": expire,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> int:
    """
    Decode and validate a JWT, returning the user id encoded in it.

    Raises HTTPException(401) if the token is missing, malformed, expired,
    or has an invalid signature.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        user_id_raw = payload.get("sub")
        if user_id_raw is None:
            raise credentials_exception
        return int(user_id_raw)
    except (JWTError, ValueError):
        raise credentials_exception


def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    """
    FastAPI dependency for protected routes. Extracts and validates the
    bearer token, then loads and returns the corresponding User row.

    Usage:
        @router.get("/protected")
        def protected_route(current_user: User = Depends(get_current_user)):
            ...
    """
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated. Provide a Bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = decode_access_token(token)

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User for this token no longer exists.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user
