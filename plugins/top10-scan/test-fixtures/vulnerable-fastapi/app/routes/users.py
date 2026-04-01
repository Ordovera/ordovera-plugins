from fastapi import APIRouter, HTTPException
from sqlalchemy import create_engine, text
import httpx

router = APIRouter()

engine = create_engine("sqlite:///app.db")


@router.get("/{user_id}")
def get_user(user_id: str):
    # A05: SQL injection via f-string interpolation
    # A01: No ownership check - any user can view any profile
    query = f"SELECT * FROM users WHERE id = '{user_id}'"
    try:
        with engine.connect() as conn:
            result = conn.execute(text(query))
            row = result.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="User not found")
            return dict(row._mapping)
    except Exception as e:
        # A10: Database error details leaked to client
        return {"error": str(e)}


@router.put("/{user_id}")
def update_user(user_id: str, name: str, bio: str):
    # A05: SQL injection via f-string
    # A01: No ownership check
    query = f"UPDATE users SET name = '{name}', bio = '{bio}' WHERE id = '{user_id}'"
    try:
        with engine.connect() as conn:
            conn.execute(text(query))
        return {"message": "Updated"}
    except:
        # A10: Bare except swallows error silently
        return {"message": "Updated"}


@router.post("/fetch-avatar")
def fetch_avatar(url: str):
    # A10: No timeout on external HTTP call
    # SSRF: User-provided URL fetched without validation
    try:
        response = httpx.get(url)
        return {"status": response.status_code, "length": len(response.content)}
    except:
        # A10: Bare except swallows all errors
        pass
    return {"error": "Failed to fetch"}


@router.post("/login")
def login(email: str, password: str):
    from app.auth import hash_password, create_token

    hashed = hash_password(password)
    query = f"SELECT id, role FROM users WHERE email = '{email}' AND password = '{hashed}'"
    try:
        with engine.connect() as conn:
            result = conn.execute(text(query))
            row = result.fetchone()
            if not row:
                return {"error": "Invalid credentials"}
            token = create_token(str(row[0]), row[1])
            return {"token": token}
    except Exception as e:
        # A10: Leaked internal error
        return {"error": f"Database error: {e}"}
