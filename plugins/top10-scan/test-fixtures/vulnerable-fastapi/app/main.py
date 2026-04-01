from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import users, admin

app = FastAPI(
    title="VulnerableAPI",
    # A02: Debug mode enabled
    debug=True,
)

# A02: CORS allows all origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users.router, prefix="/users", tags=["users"])

# A01: Admin routes with no auth dependency
app.include_router(admin.router, prefix="/admin", tags=["admin"])
