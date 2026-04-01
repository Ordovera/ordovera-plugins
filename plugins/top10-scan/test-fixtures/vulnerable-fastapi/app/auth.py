import hashlib
from jose import jwt

# A07: Hardcoded weak JWT secret
SECRET_KEY = "secret123"
ALGORITHM = "HS256"


def create_token(user_id: str, role: str) -> str:
    # A07: No expiration set on token
    payload = {"sub": user_id, "role": role}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str) -> dict:
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])


def hash_password(password: str) -> str:
    # A07: MD5 for password hashing instead of bcrypt/argon2
    return hashlib.md5(password.encode()).hexdigest()


def verify_password(plain: str, hashed: str) -> bool:
    return hash_password(plain) == hashed
