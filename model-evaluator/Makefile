.PHONY: install dev backend frontend test build

install:
	cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
	cd frontend && npm install

backend:
	cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

dev:
	$(MAKE) -j2 backend frontend

test:
	cd backend && .venv/bin/python -m pytest -q
	cd frontend && npm run typecheck

build:
	cd frontend && npm run build
