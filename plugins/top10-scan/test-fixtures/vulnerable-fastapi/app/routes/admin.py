from fastapi import APIRouter
from sqlalchemy import create_engine, text

router = APIRouter()

engine = create_engine("sqlite:///app.db")


# A01: No auth dependency - anyone can access admin routes
@router.get("/users")
def list_all_users():
    with engine.connect() as conn:
        result = conn.execute(text("SELECT id, email, name, role FROM users"))
        return [dict(row._mapping) for row in result]


# A01: No auth on destructive action
@router.delete("/users/{user_id}")
def delete_user(user_id: str):
    # A05: SQL injection
    query = f"DELETE FROM users WHERE id = '{user_id}'"
    with engine.connect() as conn:
        conn.execute(text(query))
    return {"message": "Deleted"}
