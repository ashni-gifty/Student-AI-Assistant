# Student AI Assistant

Django REST Framework backend, React (Vite) frontend, ChromaDB for retrieval, OpenAI API for answers.

## Run the backend
    cd backend
    python -m venv venv && source venv/bin/activate      # Windows: venv\Scripts\activate
    pip install -r requirements.txt
    export OPENAI_API_KEY=your_key                    # Windows: set OPENAI_API_KEY=your_key
    python manage.py makemigrations api
    python manage.py migrate
    python manage.py runserver

Password reset codes are printed in this terminal (console email backend). Set SMTP settings in config/settings.py for real email.

## Run the frontend
    cd frontend
    npm install
    npm run dev

Open http://localhost:5173. To point at another API URL, set VITE_API (for example http://localhost:8000/api).

## How tokens are kept low
- Documents are split into small chunks and embedded locally by ChromaDB (no API cost).
- Chat sends only the top 4 chunks (700 characters each) plus the last 4 short messages.
- Summaries send only chunk headings (first line plus 3 keywords, made locally, at most 60), never document text.
- MCQs send at most 8 chunks of 500 characters.
- Every prompt is hard-capped at 9000 characters (MAX_PROMPT_CHARS in settings.py).
- The agent stops after 6 steps, clamps tool inputs, and returns only short confirmations to the model.

## Notes
- If the best chunk is not close enough to the question (RELEVANCE_MAX), the app searches the web and shows the links used.
- .txt and .docx files have no real pages, so "page" means a 3000-character section.
- Scanned PDFs (images only) have no text to read and are rejected.
- The model is gpt-4o-mini by default. Change it with the LLM_MODEL environment variable.
