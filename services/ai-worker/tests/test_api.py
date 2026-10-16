"""Unit tests for FastAPI REST API endpoints."""

import json
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app, update_job_status, job_store


@pytest.fixture
def client():
    return TestClient(app)


def test_api_root_endpoint(client):
    """Verifies service health check and feature list."""
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "transcription" in data["supported_features"]
    assert "karaoke_captions" in data["supported_features"]


def test_api_status_404_on_unknown_job(client):
    """Verifies 404 response for unknown job IDs."""
    response = client.get("/api/v1/pipeline/status/non_existent_job_12345")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_api_job_status_in_memory_and_disk(client, tmp_path):
    """Verifies job status update, in-memory caching, and retrieval."""
    test_job_id = "test_job_status_001"
    update_job_status(
        job_id=test_job_id,
        status_code="TRANSCRIBING",
        progress_pct=25,
        stage_message="Transcribing test audio...",
        extra={"test_field": "val123"}
    )

    response = client.get(f"/api/v1/pipeline/status/{test_job_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["job_id"] == test_job_id
    assert data["status"] == "TRANSCRIBING"
    assert data["progress_pct"] == 25
    assert data["test_field"] == "val123"


def test_api_list_jobs(client):
    """Verifies job listing endpoint."""
    test_job_id = "test_job_list_002"
    update_job_status(
        job_id=test_job_id,
        status_code="COMPLETED",
        progress_pct=100,
        stage_message="Finished",
    )

    response = client.get("/api/v1/pipeline/jobs")
    assert response.status_code == 200
    data = response.json()
    assert data["total_jobs"] >= 1
    job_ids = [j["job_id"] for j in data["jobs"]]
    assert test_job_id in job_ids


def test_api_pipeline_start_enqueues_background_task(client):
    """Verifies POST /api/v1/pipeline/start enqueues a background worker."""
    with patch("app.main.execute_pipeline_worker") as mock_worker:
        response = client.post(
            "/api/v1/pipeline/start",
            json={
                "video_path": "storage/raw/test.mp4",
                "job_id": "test_start_job_003",
                "render_video": False,
            }
        )
        assert response.status_code == 202
        data = response.json()
        assert data["job_id"] == "test_start_job_003"
        assert data["status"] == "PENDING"
