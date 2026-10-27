import hashlib
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db_conn import get_db
from app.models.models import User
from app.schemas.schemas import UserAuthSchema, UserCreateSchema

router = APIRouter()
SECRET_KEY = "SETU_NER_SECRET_KEY_SIH26002"

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return hash_password(plain_password) == hashed_password

# ----------------- AUTH ROUTER -----------------
@router.post("/api/auth/register")
def register(user_data: UserCreateSchema, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == user_data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    hashed_pwd = hash_password(user_data.password)
    user = User(
        name=user_data.name,
        email=user_data.email,
        password_hash=hashed_pwd,
        role=user_data.role,
        phone=user_data.phone,
        language=user_data.language
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = f"token_sim_{user.id}_{user.role}"
    return {"token": token, "user": {"id": user.id, "name": user.name, "email": user.email, "role": user.role}}

@router.post("/api/auth/login")
def login(auth_data: UserAuthSchema, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == auth_data.email).first()
    if not user or not verify_password(auth_data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = f"token_sim_{user.id}_{user.role}"
    return {"token": token, "user": {"id": user.id, "name": user.name, "email": user.email, "role": user.role}}
