"""
CivicVision AI — backend
-------------------------
A small FastAPI service that classifies citizen-submitted civic issue
reports using the Anthropic API, and routes them to the right department.

Run locally:
    pip install -r requirements.txt
    cp .env.example .env        # then paste your real API key into .env
    uvicorn main:app --reload

The frontend only ever talks to this backend over HTTP — the API key
never touches the browser.
"""

import json
import os
import re
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")

app = FastAPI(title="CivicVision AI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

# Fixed taxonomy — kept in Python so department names / icons stay
# consistent no matter what the model outputs. The model only decides
# which key fits and how urgent the report sounds.
ISSUE_TYPES = {
    "pothole":     {"icon": "🚧", "label": "Pothole / Road Damage",   "dept": "Public Works Department"},
    "drainage":    {"icon": "💧", "label": "Drainage Overflow",        "dept": "Water & Sewerage Board"},
    "garbage":     {"icon": "🗑️", "label": "Garbage Overflow",         "dept": "Sanitation Department"},
    "streetlight": {"icon": "💡", "label": "Broken Streetlight",       "dept": "Electricity Board"},
    "general":     {"icon": "🏗️", "label": "General Infrastructure Issue", "dept": "Municipal Corporation"},
}

URGENCY_WORDS = [
    "large", "major", "severe", "dangerous", "flooding", "collapsed", "broken",
    "urgent", "huge", "deep", "overflowing", "blocking", "accident", "unsafe",
]


class AnalyzeRequest(BaseModel):
    description: str
    location: Optional[str] = None


def band_from_score(score: int):
    """Same thresholds as the frontend's offline classifier, so behavior is predictable either way."""
    if score >= 85:
        return "Critical", "sev-critical", "P1", "p1"
    if score >= 68:
        return "High", "sev-high", "P2", "p2"
    if score >= 50:
        return "Medium", "sev-medium", "P3", "p3"
    return "Low", "sev-low", "P4", "p4"


def offline_classify(description: str, location: Optional[str]):
    """Pure heuristic fallback — used if no API key is configured or the API call fails."""
    text = description.lower()
    keyword_map = {
        "pothole": ["pothole", "road", "crack", "asphalt", "pavement", "pot hole"],
        "drainage": ["drain", "water", "flood", "sewage", "sewer", "overflow", "clog", "stagnant"],
        "garbage": ["garbage", "trash", "waste", "dump", "litter", "rubbish"],
        "streetlight": ["light", "lamp", "dark", "streetlight", "electric", "wire", "pole"],
    }
    best_key, best_hits = "general", 0
    for key, words in keyword_map.items():
        hits = sum(1 for w in words if w in text)
        if hits > best_hits:
            best_key, best_hits = key, hits

    base_scores = {"pothole": 66, "drainage": 70, "garbage": 58, "streetlight": 48, "general": 42}
    urgency_hits = sum(1 for w in URGENCY_WORDS if w in text)
    score = base_scores[best_key] + urgency_hits * 7 + min(len(text) / 20, 10) + (6 if best_hits > 1 else 0)
    score = max(28, min(99, round(score)))

    severity, sev_class, priority, p_class = band_from_score(score)
    dept = ISSUE_TYPES[best_key]["dept"]
    explanation = (
        f"Classified as {ISSUE_TYPES[best_key]['label'].lower()} "
        f"{f'in {location}' if location else 'at the reported location'} using keyword matching "
        f"(offline mode — no AI model configured). Routed to the {dept}."
    )
    return build_response(best_key, score, severity, sev_class, priority, p_class, explanation, location)


def build_response(key, score, severity, sev_class, priority, p_class, explanation, location):
    t = ISSUE_TYPES.get(key, ISSUE_TYPES["general"])
    return {
        "type": {"icon": t["icon"], "label": t["label"], "dept": t["dept"]},
        "score": score,
        "severity": severity,
        "sevClass": sev_class,
        "priority": priority,
        "pClass": p_class,
        "explanation": explanation,
        "location": location,
    }


def ai_classify(description: str, location: Optional[str]):
    """Calls the Anthropic API to classify the report. Raises on any failure so the caller can fall back."""
    from anthropic import Anthropic  # imported lazily so the app still runs without the package during dev

    client = Anthropic(api_key=ANTHROPIC_API_KEY)

    system_prompt = (
        "You triage citizen-submitted civic infrastructure reports for a city government system. "
        "Given a description and optional location, respond with ONLY a JSON object — no prose, "
        "no markdown fences — matching exactly this shape:\n"
        '{"issue_key": one of "pothole" | "drainage" | "garbage" | "streetlight" | "general", '
        '"score": integer 0-100 (higher = more urgent/severe), '
        '"explanation": one or two sentences explaining the classification and why it got that score}'
    )
    user_prompt = f"Description: {description}\nLocation: {location or 'not provided'}"

    message = client.messages.create(
        model=MODEL,
        max_tokens=300,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )

    raw_text = "".join(block.text for block in message.content if block.type == "text")
    match = re.search(r"\{.*\}", raw_text, re.DOTALL)
    if not match:
        raise ValueError(f"Model did not return JSON: {raw_text!r}")
    parsed = json.loads(match.group(0))

    key = parsed.get("issue_key") if parsed.get("issue_key") in ISSUE_TYPES else "general"
    score = max(0, min(100, int(parsed.get("score", 50))))
    severity, sev_class, priority, p_class = band_from_score(score)
    explanation = parsed.get("explanation", "").strip() or "No explanation returned by the model."

    return build_response(key, score, severity, sev_class, priority, p_class, explanation, location)


@app.get("/api/health")
def health():
    return {"status": "ok", "ai_enabled": bool(ANTHROPIC_API_KEY)}


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest):
    if not req.description or len(req.description.strip()) < 6:
        raise HTTPException(status_code=400, detail="Description is too short to analyze.")

    if ANTHROPIC_API_KEY:
        try:
            return ai_classify(req.description, req.location)
        except Exception as exc:  # noqa: BLE001 — deliberately broad: any AI failure should fall back, not 500
            print(f"[civicvision] AI classification failed, falling back to offline mode: {exc}")

    return offline_classify(req.description, req.location)
