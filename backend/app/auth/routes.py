"""
Authentication routes: signup, login, logout, and "who am I" lookup.

Mounted at prefix "/auth" (see app/main.py).
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.schemas import MessageResponse, Token, UserLogin, UserResponse, UserSignup
from app.auth.security import (
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from app.database.database import get_db
from app.database.models import User

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=Token, status_code=status.HTTP_201_CREATED)
def signup(payload: UserSignup, db: Session = Depends(get_db)):
    """
    Register a new user.

    - Validates username/email/password shape via UserSignup (including the
      password/confirm_password match check).
    - Rejects duplicate email or username with a clear 400 error.
    - Returns an access token immediately so the frontend can log the user
      straight into the dashboard after signup, without a second login step.
    """
    existing_email = db.query(User).filter(User.email == payload.email).first()
    if existing_email is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An account with this email already exists.",
        )

    existing_username = db.query(User).filter(User.username == payload.username).first()
    if existing_username is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This username is already taken.",
        )

    user = User(
        username=payload.username,
        email=payload.email,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # Defends against a race condition between the existence checks
        # above and the commit (e.g. two simultaneous signups with the same
        # email), which the unique constraints on the columns will catch.
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An account with this email or username already exists.",
        )
    db.refresh(user)

    access_token = create_access_token(subject=user.id)
    return Token(access_token=access_token, user=UserResponse.model_validate(user))


@router.post("/login", response_model=Token)
def login(payload: UserLogin, db: Session = Depends(get_db)):
    """
    Authenticate a user by email + password and issue a new access token.
    """
    user = db.query(User).filter(User.email == payload.email).first()

    # Deliberately use the same error message whether the email doesn't
    # exist or the password is wrong, so the response doesn't leak which
    # emails are registered.
    invalid_credentials = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Incorrect email or password.",
    )

    if user is None:
        raise invalid_credentials

    if not verify_password(payload.password, user.password_hash):
        raise invalid_credentials

    access_token = create_access_token(subject=user.id)
    return Token(access_token=access_token, user=UserResponse.model_validate(user))


@router.post("/logout", response_model=MessageResponse)
def logout(current_user: User = Depends(get_current_user)):
    """
    Log out the current user.

    This API uses stateless JWTs: the server does not keep a session table,
    so there is nothing server-side to invalidate. A valid, unexpired token
    remains technically valid until it expires (ACCESS_TOKEN_EXPIRE_MINUTES).
    "Logging out" is therefore enforced by the client discarding the stored
    token (see frontend js/auth.js), and this endpoint exists so the
    frontend has a concrete call to make and to confirm the token was valid
    at the time of logout. If you later need true server-side revocation
    (e.g. for a "log out all devices" feature), that requires adding a token
    blacklist/allowlist table — flagged here rather than silently faked.
    """
    return MessageResponse(message=f"User '{current_user.username}' logged out successfully.")


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    """Return the currently authenticated user's profile."""
    return UserResponse.model_validate(current_user)
