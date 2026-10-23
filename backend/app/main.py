import uvicorn
from dotenv import load_dotenv
load_dotenv()  # loads backend/.env if present — never commit that file (see .env.example)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.db_conn import engine, Base, SessionLocal
from app.routers import router as api_router
from app.database_seed import seed_database

Base.metadata.create_all(bind=engine)

# Seed database on boot
db = SessionLocal()
seed_database(db)
db.close()

app = FastAPI(
    title="SETU-NER Intelligence Platform API",
    description="AI-Based Smart Logistics & Accessibility Intelligence Platform for North Eastern Region (SIH26002)",
    version="2.0.0"
)

# Enable CORS for local frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

@app.get("/")
def root():
    return {
        "platform": "SETU-NER AI Logistics Platform",
        "status": "OPERATIONAL",
        "version": "2.0.0",
        "docs_url": "/docs"
    }

@app.get("/health")
def health_check():
    return {"status": "healthy", "database": "connected", "grid": "NER-ONLINE"}

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
